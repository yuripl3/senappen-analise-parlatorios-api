import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PrismaService } from '@/database/prisma.service';
import { AnalysisStatus, RetentionStatus, VisitorType } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { QueryRecordsDto } from './dto/query-records.dto';
import { UploadRecordDto } from './dto/upload-record.dto';
import { BulkActionDto, BulkActionType } from './dto/bulk-action.dto';
import { assertValidTransition } from '@/common/helpers/status-transition.helper';
import { MOCK_RECORDS, MOCK_USER_MAP } from '@/mock/mock-data';
import { mapMockRecord, mapMockRecordDetail, mapRecord, mapRecordDetail } from './mappers/record.mapper';
import { StorageService } from '@/storage/storage.service';
import { QueueService } from '@/worker/queue.service';

@Injectable()
export class RecordsService {
  private readonly logger = new Logger(RecordsService.name);
  private readonly useMockData: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storageService: StorageService,
    private readonly queueService: QueueService,
  ) {
    this.useMockData = this.config.get<string>('USE_MOCK_DATA') === 'true';
  }

  async findAll(query: QueryRecordsDto) {
    const {
      page = 1,
      limit = 20,
      status,
      retentionStatus,
      visitorType,
      unit,
      uploadedById,
      from,
      to,
    } = query;
    const skip = (page - 1) * limit;

    // ── Mock mode ──────────────────────────────────────────────────────────
    if (this.useMockData) {
      let items = MOCK_RECORDS.filter((r) => {
        if (status && r.analysisStatus !== status) return false;
        if (retentionStatus && r.retentionStatus !== retentionStatus) return false;
        if (unit && !r.unit.toLowerCase().includes(unit.toLowerCase())) return false;
        if (from && r.recordedAt < new Date(from)) return false;
        if (to && r.recordedAt > new Date(to)) return false;
        return true;
      });
      const total = items.length;
      items = items.slice(skip, skip + limit);
      return {
        data: items.map(mapMockRecord),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    // ── DB mode ────────────────────────────────────────────────────────────
    const where: Prisma.RecordWhereInput = {
      ...(status && { analysisStatus: status }),
      ...(retentionStatus && { retentionStatus }),
      ...(visitorType && { visitorType }),
      ...(unit && { unit: { contains: unit, mode: Prisma.QueryMode.insensitive } }),
      ...(uploadedById && { uploadedById }),
      ...(from || to
        ? {
            recordedAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.record.count({ where }),
      this.prisma.record.findMany({
        where,
        skip,
        take: limit,
        orderBy: { recordedAt: 'desc' },
        include: {
          uploadedBy: { select: { id: true, name: true } },
          archivedBy: { select: { id: true, name: true, roles: true } },
        },
      }),
    ]);

    return {
      data: items.map((r) => mapRecord(r as Parameters<typeof mapRecord>[0])),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Returns the blobUrl for video streaming. */
  async getBlobUrl(id: string): Promise<string | null> {
    if (this.useMockData) {
      const record = MOCK_RECORDS.find((r) => r.id === id);
      return record?.blobUrl ?? null;
    }
    const record = await this.prisma.record.findUnique({
      where: { id },
      select: { blobUrl: true },
    });
    return record?.blobUrl ?? null;
  }

  async findOne(id: string) {
    // ── Mock mode ──────────────────────────────────────────────────────────
    if (this.useMockData) {
      const record = MOCK_RECORDS.find((r) => r.id === id);
      if (!record) throw new NotFoundException(`Record ${id} not found`);
      return mapMockRecordDetail(record);
    }

    // ── DB mode ────────────────────────────────────────────────────────────
    const record = await this.prisma.record.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        archivedBy: { select: { id: true, name: true, roles: true } },
        auditLogs: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true, roles: true } } },
        },
      },
    });

    if (!record) throw new NotFoundException(`Record ${id} not found`);
    return mapRecordDetail(record as Parameters<typeof mapRecordDetail>[0]);
  }

  create(dto: CreateRecordDto, uploadedById: string) {
    return this.prisma.record.create({
      data: {
        ...dto,
        recordedAt: new Date(dto.recordedAt),
        mediaAvailable: dto.mediaAvailable ?? false,
        uploadedById,
        analysisStatus: AnalysisStatus.uploaded,
      },
    });
  }

  /** Handles multipart/form-data upload: saves file via StorageService, creates record. */
  async upload(
    file: Express.Multer.File | undefined,
    dto: UploadRecordDto,
    uploadedById: string,
  ) {
    // ── Mock mode: save file to local disk & push into in-memory array ─────
    if (this.useMockData) {
      let blobUrl: string | null = null;
      if (file) {
        const storageDir = path.resolve('storage', 'videos');
        await fs.mkdir(storageDir, { recursive: true });
        const ext = path.extname(file.originalname) || '.mp4';
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        await fs.writeFile(path.join(storageDir, filename), file.buffer);
        blobUrl = `storage/videos/${filename}`;
        this.logger.log(`[Mock] Saved file to ${blobUrl}`);
      }

      const now = new Date();
      const id = `MOCK-${Date.now()}`;
      const mockUser = MOCK_USER_MAP[uploadedById];

      const newRecord = {
        id,
        detaineeName: dto.detaineeName,
        detaineeCode: dto.detaineeCode ?? null,
        visitorName: dto.visitorName,
        visitorType: dto.visitorType as VisitorType,
        unit: dto.unit,
        vivencia: dto.vivencia ?? null,
        equipment: dto.equipment,
        blobUrl,
        mediaAvailable: !!file,
        recordedAt: new Date(dto.recordedAt),
        uploadedAt: now,
        uploadedById,
        uploadedBy: mockUser
          ? { id: mockUser.id, name: mockUser.name }
          : { id: uploadedById, name: 'Usuário Mock' },
        analysisStatus: AnalysisStatus.uploaded,
        retentionStatus: RetentionStatus.retention_standard,
        aiScore: null,
        analystId: null,
        analystDecision: null,
        analystJustification: null,
        analysisConfirmedAt: null,
        supervisorId: null,
        supervisorDecision: null,
        supervisorJustification: null,
        supervisorDecidedAt: null,
        transcription: null,
        canonicalAnalysis: null,
        userComments: null,
        archivedAt: null,
        archivedById: null,
        archivedBy: null,
        auditLogs: [],
        createdAt: now,
        updatedAt: now,
      };

      MOCK_RECORDS.unshift(newRecord);
      this.logger.log(`[Mock] Created record ${id} — total mock records: ${MOCK_RECORDS.length}`);

      return mapMockRecord(newRecord);
    }

    // ── Real mode: persist file then record ────────────────────────────────
    let blobUrl: string | null = null;
    if (file) {
      blobUrl = await this.storageService.store(
        file.buffer,
        file.originalname,
        file.mimetype || 'video/mp4',
      );
    }

    return this.prisma.record.create({
      data: {
        ...dto,
        recordedAt: new Date(dto.recordedAt),
        mediaAvailable: !!file,
        blobUrl,
        uploadedById,
        analysisStatus: AnalysisStatus.uploaded,
      },
    }).then(async (record) => {
      // Enqueue transcription job (fire-and-forget)
      await this.queueService.enqueueTranscription({ recordId: record.id, blobUrl });
      return record;
    });
  }

  async updateStatus(id: string, dto: UpdateStatusDto, actorId: string) {
    const record = await this.prisma.record.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Record ${id} not found`);

    assertValidTransition(record.analysisStatus, dto.status);

    const [updated] = await this.prisma.$transaction([
      this.prisma.record.update({
        where: { id },
        data: {
          analysisStatus: dto.status,
          ...(dto.analystDecision && { analystDecision: dto.analystDecision }),
          ...(dto.justification &&
            (dto.status === AnalysisStatus.confirmed_human ||
              dto.status === AnalysisStatus.rejected_human) && {
              analystJustification: dto.justification,
              analysisConfirmedAt: new Date(),
              analystId: actorId,
            }),
          ...(dto.justification &&
            (dto.status === AnalysisStatus.approved ||
              dto.status === AnalysisStatus.rejected_supervisor) && {
              supervisorJustification: dto.justification,
              supervisorDecidedAt: new Date(),
              supervisorId: actorId,
            }),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          recordId: id,
          userId: actorId,
          action: `status_transition`,
          previousStatus: record.analysisStatus,
          nextStatus: dto.status,
          notes: dto.notes,
        },
      }),
    ]);

    return updated;
  }

  // ── Archive / Restore ──────────────────────────────────────────────────────

  async archive(id: string, actorId: string) {
    const record = await this.prisma.record.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Record ${id} not found`);

    const [updated] = await this.prisma.$transaction([
      this.prisma.record.update({
        where: { id },
        data: {
          retentionStatus: RetentionStatus.archived,
          archivedAt: new Date(),
          archivedById: actorId,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          recordId: id,
          userId: actorId,
          action: 'archive',
          notes: 'Record archived',
        },
      }),
    ]);

    return updated;
  }

  async restore(id: string, actorId: string) {
    const record = await this.prisma.record.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Record ${id} not found`);

    const [updated] = await this.prisma.$transaction([
      this.prisma.record.update({
        where: { id },
        data: {
          retentionStatus: RetentionStatus.retention_standard,
          archivedAt: null,
          archivedById: null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          recordId: id,
          userId: actorId,
          action: 'restore',
          notes: 'Record restored from archive',
        },
      }),
    ]);

    return updated;
  }

  async bulkAction(dto: BulkActionDto, actorId: string) {
    const fn = dto.action === BulkActionType.archive
      ? (id: string) => this.archive(id, actorId)
      : (id: string) => this.restore(id, actorId);

    const results = await Promise.allSettled(dto.ids.map(fn));
    const succeeded = dto.ids.filter((_, i) => results[i].status === 'fulfilled');
    const failed = dto.ids.filter((_, i) => results[i].status === 'rejected');

    return { succeeded, failed };
  }

  // ── Audit log ──────────────────────────────────────────────────────────────

  async getAudit(id: string) {
    const exists = await this.prisma.record.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException(`Record ${id} not found`);

    const logs = await this.prisma.auditLog.findMany({
      where: { recordId: id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, roles: true } } },
    });

    return logs;
  }

  // ── User comments (per-line) ──────────────────────────────────────────────

  async updateUserComments(id: string, comments: unknown[]) {
    if (this.useMockData) {
      return { id, userComments: comments };
    }

    const exists = await this.prisma.record.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException(`Record ${id} not found`);

    const updated = await this.prisma.record.update({
      where: { id },
      data: { userComments: comments as any },
      select: { id: true, userComments: true },
    });

    return updated;
  }
}
