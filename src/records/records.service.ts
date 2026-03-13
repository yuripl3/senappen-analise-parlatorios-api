import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CosmosService } from '@/database/cosmos.service';
import {
  AnalysisStatus,
  RetentionStatus,
  UserRole,
  VisitorType,
  hasMinRole,
} from '@/common/constants/enums';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { QueryRecordsDto } from './dto/query-records.dto';
import { UploadRecordDto } from './dto/upload-record.dto';
import { BulkActionDto, BulkActionType } from './dto/bulk-action.dto';
import { assertValidTransition } from '@/common/helpers/status-transition.helper';
import { MOCK_RECORDS, MOCK_USER_MAP } from '@/mock/mock-data';
import {
  mapMockRecord,
  mapMockRecordDetail,
  mapRecord,
  mapRecordDetail,
} from './mappers/record.mapper';
import { StorageService } from '@/storage/storage.service';
import { ServiceBusService } from '@/worker/servicebus.service';
import type { JwtPayload } from '@/auth/decorators/current-user.decorator';

/** Shape of a record document stored in Cosmos DB */
interface CosmosRecordDoc {
  id: string;
  detaineeName: string;
  detaineeCode: string | null;
  visitorName: string;
  visitorType: VisitorType;
  unit: string;
  vivencia: string | null;
  equipment: string;
  blobUrl: string | null;
  mediaAvailable: boolean;
  recordedAt: string;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
  uploadedById: string;
  uploadedBy: { id: string; name: string };
  analysisStatus: AnalysisStatus;
  retentionStatus: RetentionStatus;
  aiScore: number | null;
  transcription: unknown;
  canonicalAnalysis: unknown;
  userComments?: unknown;
  archivedAt: string | null;
  archivedBy: { id: string; name: string; role?: string } | null;
  archivedById: string | null;
}

export interface CosmosAuditLogDoc {
  id: string;
  recordId: string | null;
  userId: string;
  user: { id: string; name: string; role: string };
  action: string;
  notes: string | null;
  createdAt: string;
}

@Injectable()
export class RecordsService {
  private readonly logger = new Logger(RecordsService.name);
  private readonly useMockData: boolean;

  constructor(
    private readonly cosmos: CosmosService,
    private readonly config: ConfigService,
    private readonly storageService: StorageService,
    private readonly serviceBus: ServiceBusService,
  ) {
    this.useMockData = this.config.get<string>('USE_MOCK_DATA') === 'true';
  }

  async findAll(query: QueryRecordsDto, actor?: JwtPayload) {
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

    // ── Mock mode ──────────────────────────────────────────────────────────
    if (this.useMockData) {
      const skip = (page - 1) * limit;
      let items = MOCK_RECORDS.filter((r) => {
        if (status && r.analysisStatus !== status) return false;
        if (retentionStatus && r.retentionStatus !== retentionStatus) return false;
        if (unit && !r.unit.toLowerCase().includes(unit.toLowerCase())) return false;
        if (from && r.recordedAt < new Date(from)) return false;
        if (to && r.recordedAt > new Date(to)) return false;
        // Unit scoping: non-admin users can only see records from their units
        if (actor && !hasMinRole(actor.role, UserRole.admin) && actor.units.length > 0) {
          if (!actor.units.some((u) => r.unit.toLowerCase().includes(u.toLowerCase())))
            return false;
        }
        return true;
      });
      const total = items.length;
      items = items.slice(skip, skip + limit);
      return {
        data: items.map(mapMockRecord),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    // ── Cosmos DB mode ─────────────────────────────────────────────────────
    const conditions: string[] = [];
    const parameters: { name: string; value: string | number | boolean }[] = [];

    // Unit scoping: non-admin users see only records from their assigned units
    if (actor && !hasMinRole(actor.role, UserRole.admin) && actor.units.length > 0) {
      conditions.push('ARRAY_CONTAINS(@actorUnits, c.unit)');
      parameters.push({ name: '@actorUnits', value: actor.units as unknown as string });
    }

    if (status) {
      conditions.push('c.analysisStatus = @status');
      parameters.push({ name: '@status', value: status });
    }
    if (retentionStatus) {
      conditions.push('c.retentionStatus = @retentionStatus');
      parameters.push({ name: '@retentionStatus', value: retentionStatus });
    }
    if (visitorType) {
      conditions.push('c.visitorType = @visitorType');
      parameters.push({ name: '@visitorType', value: visitorType });
    }
    if (unit) {
      conditions.push('CONTAINS(LOWER(c.unit), @unit)');
      parameters.push({ name: '@unit', value: unit.toLowerCase() });
    }
    if (uploadedById) {
      conditions.push('c.uploadedById = @uploadedById');
      parameters.push({ name: '@uploadedById', value: uploadedById });
    }
    if (from) {
      conditions.push('c.recordedAt >= @from');
      parameters.push({ name: '@from', value: new Date(from).toISOString() });
    }
    if (to) {
      conditions.push('c.recordedAt <= @to');
      parameters.push({ name: '@to', value: new Date(to).toISOString() });
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const { resources: countResult } = await this.cosmos.records.items
      .query({
        query: `SELECT VALUE COUNT(1) FROM c ${whereClause}`,
        parameters,
      })
      .fetchAll();
    const total = countResult[0] ?? 0;

    // Paginated query using OFFSET/LIMIT
    const skip = (page - 1) * limit;
    const { resources: items } = await this.cosmos.records.items
      .query<CosmosRecordDoc>({
        query: `SELECT * FROM c ${whereClause} ORDER BY c.recordedAt DESC OFFSET @skip LIMIT @limit`,
        parameters: [
          ...parameters,
          { name: '@skip', value: skip },
          { name: '@limit', value: limit },
        ],
      })
      .fetchAll();

    return {
      data: items.map((r: CosmosRecordDoc) => mapRecord(this.toRawRecord(r))),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Returns the blobUrl for video streaming. */
  async getBlobUrl(id: string): Promise<string | null> {
    if (this.useMockData) {
      const record = MOCK_RECORDS.find((r) => r.id === id);
      return record?.blobUrl ?? null;
    }
    try {
      const { resource } = await this.cosmos.records.item(id, id).read<CosmosRecordDoc>();
      return resource?.blobUrl ?? null;
    } catch {
      return null;
    }
  }

  async findOne(id: string, actor?: JwtPayload) {
    // ── Mock mode ──────────────────────────────────────────────────────────
    if (this.useMockData) {
      const record = MOCK_RECORDS.find((r) => r.id === id);
      if (!record) throw new NotFoundException(`Record ${id} not found`);
      this.assertUnitAccess(record.unit, actor);
      return mapMockRecordDetail(record);
    }

    // ── Cosmos DB mode ─────────────────────────────────────────────────────
    const { resource: record } = await this.cosmos.records.item(id, id).read<CosmosRecordDoc>();
    if (!record) throw new NotFoundException(`Record ${id} not found`);
    this.assertUnitAccess(record.unit, actor);

    // Fetch audit logs for this record
    const { resources: auditLogs } = await this.cosmos.auditLogs.items
      .query<CosmosAuditLogDoc>({
        query: 'SELECT * FROM c WHERE c.recordId = @recordId ORDER BY c.createdAt ASC',
        parameters: [{ name: '@recordId', value: id }],
      })
      .fetchAll();

    return mapRecordDetail(this.toRawRecordWithDetail(record, auditLogs));
  }

  async create(dto: CreateRecordDto, uploadedById: string) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const uploaderName = await this.getUserName(uploadedById);

    const doc = {
      id,
      ...dto,
      recordedAt: new Date(dto.recordedAt).toISOString(),
      mediaAvailable: dto.mediaAvailable ?? false,
      uploadedById,
      uploadedBy: { id: uploadedById, name: uploaderName },
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
      blobUrl: null,
      archivedAt: null,
      archivedById: null,
      archivedBy: null,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const { resource } = await this.cosmos.records.items.create(doc);
    return resource;
  }

  /** Handles multipart/form-data upload: saves file via StorageService, creates record. */
  async upload(file: Express.Multer.File | undefined, dto: UploadRecordDto, uploadedById: string) {
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
        visitorType: dto.visitorType,
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

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const uploaderName = await this.getUserName(uploadedById);

    const doc = {
      id,
      ...dto,
      recordedAt: new Date(dto.recordedAt).toISOString(),
      mediaAvailable: !!file,
      blobUrl,
      uploadedById,
      uploadedBy: { id: uploadedById, name: uploaderName },
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
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const { resource: record } = await this.cosmos.records.items.create(doc);

    // Enqueue transcription job (fire-and-forget)
    await this.serviceBus.enqueueTranscription({ recordId: id, blobUrl });

    return record;
  }

  async updateStatus(id: string, dto: UpdateStatusDto, actorId: string) {
    const { resource: record } = await this.cosmos.records.item(id, id).read<CosmosRecordDoc>();
    if (!record) throw new NotFoundException(`Record ${id} not found`);

    assertValidTransition(record.analysisStatus, dto.status);

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      analysisStatus: dto.status,
      updatedAt: now,
    };

    if (dto.analystDecision) {
      updates.analystDecision = dto.analystDecision;
    }
    if (
      dto.justification &&
      (dto.status === AnalysisStatus.confirmed_human ||
        dto.status === AnalysisStatus.rejected_human)
    ) {
      updates.analystJustification = dto.justification;
      updates.analysisConfirmedAt = now;
      updates.analystId = actorId;
    }
    if (
      dto.justification &&
      (dto.status === AnalysisStatus.approved || dto.status === AnalysisStatus.rejected_supervisor)
    ) {
      updates.supervisorJustification = dto.justification;
      updates.supervisorDecidedAt = now;
      updates.supervisorId = actorId;
    }

    // Update record
    const updatedDoc = { ...record, ...updates };
    const { resource: updated } = await this.cosmos.records.item(id, id).replace(updatedDoc);

    // Write audit log
    await this.cosmos.auditLogs.items.create({
      id: crypto.randomUUID(),
      recordId: id,
      userId: actorId,
      user: {
        id: actorId,
        name: await this.getUserName(actorId),
        role: await this.getUserRole(actorId),
      },
      action: 'status_transition',
      previousStatus: record.analysisStatus,
      nextStatus: dto.status,
      notes: dto.notes ?? null,
      createdAt: now,
    });

    return updated;
  }

  // ── Archive / Restore ──────────────────────────────────────────────────────

  async archive(id: string, actorId: string) {
    const { resource: record } = await this.cosmos.records.item(id, id).read<CosmosRecordDoc>();
    if (!record) throw new NotFoundException(`Record ${id} not found`);

    const now = new Date().toISOString();
    const archiverName = await this.getUserName(actorId);
    const archiverRole = await this.getUserRole(actorId);

    const updatedDoc = {
      ...record,
      retentionStatus: RetentionStatus.archived,
      archivedAt: now,
      archivedById: actorId,
      archivedBy: { id: actorId, name: archiverName, role: archiverRole },
      updatedAt: now,
    };

    const { resource: updated } = await this.cosmos.records.item(id, id).replace(updatedDoc);

    await this.cosmos.auditLogs.items.create({
      id: crypto.randomUUID(),
      recordId: id,
      userId: actorId,
      user: { id: actorId, name: archiverName, role: archiverRole },
      action: 'archive',
      previousStatus: null,
      nextStatus: null,
      notes: 'Record archived',
      createdAt: now,
    });

    return updated;
  }

  async restore(id: string, actorId: string) {
    const { resource: record } = await this.cosmos.records.item(id, id).read<CosmosRecordDoc>();
    if (!record) throw new NotFoundException(`Record ${id} not found`);

    const now = new Date().toISOString();
    const updatedDoc = {
      ...record,
      retentionStatus: RetentionStatus.retention_standard,
      archivedAt: null,
      archivedById: null,
      archivedBy: null,
      updatedAt: now,
    };

    const { resource: updated } = await this.cosmos.records.item(id, id).replace(updatedDoc);

    await this.cosmos.auditLogs.items.create({
      id: crypto.randomUUID(),
      recordId: id,
      userId: actorId,
      user: {
        id: actorId,
        name: await this.getUserName(actorId),
        role: await this.getUserRole(actorId),
      },
      action: 'restore',
      previousStatus: null,
      nextStatus: null,
      notes: 'Record restored from archive',
      createdAt: now,
    });

    return updated;
  }

  async bulkAction(dto: BulkActionDto, actorId: string) {
    const fn =
      dto.action === BulkActionType.archive
        ? (id: string) => this.archive(id, actorId)
        : (id: string) => this.restore(id, actorId);

    const results = await Promise.allSettled(dto.ids.map((id) => fn(id)));
    const succeeded = dto.ids.filter((_, i) => results[i].status === 'fulfilled');
    const failed = dto.ids.filter((_, i) => results[i].status === 'rejected');

    return { succeeded, failed };
  }

  // ── Audit log ──────────────────────────────────────────────────────────────

  async getAudit(id: string, actor?: JwtPayload) {
    const { resource } = await this.cosmos.records.item(id, id).read<CosmosRecordDoc>();
    if (!resource) throw new NotFoundException(`Record ${id} not found`);
    this.assertUnitAccess(resource.unit, actor);

    const { resources: logs } = await this.cosmos.auditLogs.items
      .query<CosmosAuditLogDoc>({
        query: 'SELECT * FROM c WHERE c.recordId = @recordId ORDER BY c.createdAt ASC',
        parameters: [{ name: '@recordId', value: id }],
      })
      .fetchAll();

    return logs;
  }

  // ── User comments (per-line) ──────────────────────────────────────────────

  async updateUserComments(id: string, comments: unknown[]) {
    if (this.useMockData) {
      return { id, userComments: comments };
    }

    const { resource: record } = await this.cosmos.records.item(id, id).read<CosmosRecordDoc>();
    if (!record) throw new NotFoundException(`Record ${id} not found`);

    const updatedDoc = { ...record, userComments: comments, updatedAt: new Date().toISOString() };
    const { resource: updated } = await this.cosmos.records.item(id, id).replace(updatedDoc);

    return { id: updated!.id, userComments: updated!.userComments };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Throws ForbiddenException if the actor is not admin and the record's unit
   * is not in the actor's assigned units.
   */
  private assertUnitAccess(recordUnit: string, actor?: JwtPayload): void {
    if (!actor) return;
    if (hasMinRole(actor.role, UserRole.admin)) return;
    if (actor.units.length === 0) return; // no unit restriction
    const allowed = actor.units.some((u) => u.toLowerCase() === recordUnit.toLowerCase());
    if (!allowed) {
      throw new ForbiddenException('Acesso negado: registro fora das suas unidades.');
    }
  }

  /**
   * Statuses considered "pre-analysis" — records in these statuses can be
   * deleted by a cadastrador (owner) or analista (owner).
   */
  private static readonly PRE_ANALYSIS_STATUSES: ReadonlySet<AnalysisStatus> = new Set([
    AnalysisStatus.uploaded,
    AnalysisStatus.processing_ai,
    AnalysisStatus.clean,
    AnalysisStatus.flagged_ai,
    AnalysisStatus.under_review,
  ]);

  /**
   * Delete a record with role-based permission enforcement:
   * - cadastrador: own records only, status before confirmed_human/rejected_human
   * - analista: own records in initial/pre-analysis statuses
   * - supervisor: any record within their units (broad)
   * - admin: unrestricted
   */
  async remove(id: string, actor: JwtPayload) {
    const { resource: record } = await this.cosmos.records.item(id, id).read<CosmosRecordDoc>();
    if (!record) throw new NotFoundException(`Record ${id} not found`);

    // Unit access check (non-admin must be in the record's unit)
    this.assertUnitAccess(record.unit, actor);

    const role = actor.role;
    const isOwner = record.uploadedById === actor.sub;
    const preAnalysis = RecordsService.PRE_ANALYSIS_STATUSES.has(record.analysisStatus);

    if (hasMinRole(role, UserRole.admin)) {
      // admin — unrestricted
    } else if (hasMinRole(role, UserRole.supervisor)) {
      // supervisor — any record within their units (already checked above)
    } else if (hasMinRole(role, UserRole.analista)) {
      // analista — own records in pre-analysis statuses
      if (!isOwner) {
        throw new ForbiddenException('Analista só pode excluir seus próprios registros.');
      }
      if (!preAnalysis) {
        throw new ForbiddenException('Analista não pode excluir registros já analisados.');
      }
    } else if (hasMinRole(role, UserRole.cadastrador)) {
      // cadastrador — own records only, before confirmed_human/rejected_human
      if (!isOwner) {
        throw new ForbiddenException('Cadastrador só pode excluir seus próprios registros.');
      }
      if (!preAnalysis) {
        throw new ForbiddenException('Cadastrador não pode excluir registros já analisados.');
      }
    } else {
      throw new ForbiddenException('Leitor não pode excluir registros.');
    }

    // Perform deletion
    await this.cosmos.records.item(id, id).delete();

    // Write audit log
    const now = new Date().toISOString();
    await this.cosmos.auditLogs.items.create({
      id: crypto.randomUUID(),
      recordId: id,
      userId: actor.sub,
      user: { id: actor.sub, name: actor.name, role: actor.role },
      action: 'delete',
      previousStatus: record.analysisStatus,
      nextStatus: null,
      notes: `Record deleted by ${actor.role}`,
      createdAt: now,
    });

    return { id, deleted: true };
  }

  private async getUserName(userId: string): Promise<string> {
    try {
      const { resource } = await this.cosmos.users.item(userId, userId).read<{ name?: string }>();
      return resource?.name ?? 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  private async getUserRole(userId: string): Promise<string> {
    try {
      const { resource } = await this.cosmos.users.item(userId, userId).read<{ role?: string }>();
      return resource?.role ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /** Convert Cosmos DB document to the shape expected by record.mapper.ts */
  private toRawRecord(doc: CosmosRecordDoc) {
    return {
      id: doc.id,
      detaineeName: doc.detaineeName,
      detaineeCode: doc.detaineeCode ?? null,
      visitorName: doc.visitorName,
      visitorType: doc.visitorType,
      unit: doc.unit,
      vivencia: doc.vivencia ?? null,
      equipment: doc.equipment,
      blobUrl: doc.blobUrl ?? null,
      mediaAvailable: doc.mediaAvailable ?? false,
      recordedAt: new Date(doc.recordedAt),
      uploadedAt: new Date(doc.uploadedAt ?? doc.createdAt),
      uploadedBy: doc.uploadedBy ?? { id: doc.uploadedById, name: 'Unknown' },
      analysisStatus: doc.analysisStatus,
      retentionStatus: doc.retentionStatus,
      aiScore: doc.aiScore ?? null,
      transcription: doc.transcription ?? null,
      canonicalAnalysis: doc.canonicalAnalysis ?? null,
      archivedAt: doc.archivedAt ? new Date(doc.archivedAt) : null,
      archivedBy: doc.archivedBy ?? null,
    };
  }

  private toRawRecordWithDetail(doc: CosmosRecordDoc, auditLogs: CosmosAuditLogDoc[]) {
    return {
      ...this.toRawRecord(doc),
      userComments: doc.userComments ?? null,
      auditLogs: auditLogs.map((log: CosmosAuditLogDoc) => ({
        id: log.id,
        recordId: log.recordId ?? null,
        userId: log.userId,
        user: log.user ?? { id: log.userId, name: 'Unknown', role: 'unknown' },
        action: log.action,
        notes: log.notes ?? null,
        createdAt: new Date(log.createdAt),
      })),
    };
  }
}
