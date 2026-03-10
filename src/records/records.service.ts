import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PrismaService } from '@/database/prisma.service';
import { AnalysisStatus } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { QueryRecordsDto } from './dto/query-records.dto';
import { UploadRecordDto } from './dto/upload-record.dto';
import { assertValidTransition } from '@/common/helpers/status-transition.helper';
import { MOCK_RECORDS } from '@/mock/mock-data';
import { mapMockRecord, mapMockRecordDetail, mapRecord, mapRecordDetail } from './mappers/record.mapper';

@Injectable()
export class RecordsService {
  private readonly useMockData: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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

  /** Handles multipart/form-data upload: saves file locally, creates record. */
  async upload(
    file: Express.Multer.File | undefined,
    dto: UploadRecordDto,
    uploadedById: string,
  ) {
    // ── Mock mode: skip file save & DB, return a stub ──────────────────────
    if (this.useMockData) {
      return {
        id: `MOCK-${Date.now()}`,
        ...dto,
        mediaAvailable: !!file,
        blobUrl: file ? `storage/videos/mock-${Date.now()}${path.extname(file.originalname)}` : null,
        analysisStatus: AnalysisStatus.uploaded,
        uploadedAt: new Date().toISOString(),
      };
    }

    // ── Real mode: persist file then record ────────────────────────────────
    let blobUrl: string | null = null;
    if (file) {
      const storageDir = path.resolve(process.cwd(), 'storage', 'videos');
      await fs.mkdir(storageDir, { recursive: true });
      const ext = path.extname(file.originalname) || '.mp4';
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const filePath = path.join(storageDir, filename);
      await fs.writeFile(filePath, file.buffer);
      blobUrl = `storage/videos/${filename}`;
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
}
