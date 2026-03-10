/**
 * Transforms Prisma Record objects (with included relations) into
 * the flat, FE-compatible shape consumed by the React frontend.
 */

import { VisitorType, RetentionStatus, AnalysisStatus, UserRole } from '@/generated/prisma/enums';
import type { MockAuditLog, MockRecord } from '@/mock/mock-data';

// ─── Date formatting ──────────────────────────────────────────────────────────

function formatBrDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBrDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ─── VisitorType label ────────────────────────────────────────────────────────

const VISITOR_TYPE_LABELS: Record<VisitorType, string> = {
  [VisitorType.ATENDIMENTO_JURIDICO]: 'Atendimento Jurídico',
  [VisitorType.VISITA_SOCIAL_PRESENCIAL]: 'Visita social presencial',
  [VisitorType.VISITA_SOCIAL_VIRTUAL]: 'Visita social virtual',
};

// ─── daysUntilDeletion computation ───────────────────────────────────────────

const RETENTION_DAYS: Partial<Record<RetentionStatus, number>> = {
  [RetentionStatus.retention_standard]: 30,
  [RetentionStatus.retention_extended]: 90,
};

function computeDaysUntilDeletion(
  recordedAt: Date,
  retentionStatus: RetentionStatus,
): number | null {
  const days = RETENTION_DAYS[retentionStatus];
  if (days === undefined) return null; // permanent_retention or archived
  const deletionDate = new Date(recordedAt);
  deletionDate.setDate(deletionDate.getDate() + days);
  const diffMs = deletionDate.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// ─── AuditLog mapper ─────────────────────────────────────────────────────────

type RawAuditLog =
  | MockAuditLog
  | {
      id: string;
      recordId: string | null;
      userId: string;
      user: { id: string; name: string; roles: string[] | readonly string[] };
      action: string;
      notes?: string | null;
      createdAt: Date;
    };

export function mapAuditLog(log: RawAuditLog) {
  return {
    id: log.id,
    recordId: log.recordId ?? undefined,
    user: log.user.name,
    userRole: (log.user.roles[0] as UserRole) ?? UserRole.analyst,
    action: log.notes ? log.action + ' — ' + log.notes : log.action,
    timestamp: formatBrDate(log.createdAt),
  };
}

// ─── Record input type (matches Prisma findMany/findUnique with includes) ─────

type RawRecord = {
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
  recordedAt: Date;
  uploadedAt: Date;
  uploadedBy: { id: string; name: string };
  analysisStatus: AnalysisStatus;
  retentionStatus: RetentionStatus;
  aiScore: number | null;
  transcription: unknown;
  canonicalAnalysis: unknown;
  archivedAt: Date | null;
  archivedBy?: { id: string; name: string; roles?: string[] | readonly string[] } | null;
  auditLogs?: RawAuditLog[];
};

// ─── List view mapper ─────────────────────────────────────────────────────────

export function mapRecord(r: RawRecord) {
  return {
    id: r.id,
    detainee: {
      id: r.detaineeCode ?? r.id,
      name: r.detaineeName,
    },
    visitor: {
      name: r.visitorName,
      type: VISITOR_TYPE_LABELS[r.visitorType] ?? r.visitorType,
    },
    unit: r.unit,
    vivencia: r.vivencia ?? undefined,
    recordedAt: formatBrDate(r.recordedAt),
    uploadedAt: formatBrDate(r.uploadedAt),
    uploadedBy: r.uploadedBy.name,
    equipment: r.equipment,
    analysisStatus: r.analysisStatus,
    retentionStatus: r.retentionStatus,
    aiScore: r.aiScore ?? undefined,
    daysUntilDeletion: computeDaysUntilDeletion(r.recordedAt, r.retentionStatus),
    mediaAvailable: r.mediaAvailable,
    archivedAt: r.archivedAt ? formatBrDateOnly(r.archivedAt) : undefined,
    archivedBy: r.archivedBy
      ? `${r.archivedBy.name} (${r.archivedBy.roles?.[0] ?? 'staff'})`
      : undefined,
  };
}

// ─── Detail view mapper — includes auditLogs and transcription fields ──────────

type RawRecordWithDetail = RawRecord & {
  auditLogs: RawAuditLog[];
};

export function mapRecordDetail(r: RawRecordWithDetail) {
  const base = mapRecord(r);

  // Parse transcription JSON field
  type TranscriptionPayload = {
    lines?: unknown[];
    canonicalLines?: unknown[];
    flaggedSegments?: unknown[];
  };
  const txn = r.transcription as TranscriptionPayload | null;

  return {
    ...base,
    auditLogs: r.auditLogs.map(mapAuditLog),
    transcriptionLines: txn?.lines ?? null,
    canonicalLines: txn?.canonicalLines ?? null,
    flaggedSegments: txn?.flaggedSegments ?? null,
    canonicalAnalysis: r.canonicalAnalysis ?? null,
  };
}

// ─── Convenience re-export for mock records ───────────────────────────────────

export function mapMockRecord(r: MockRecord) {
  return mapRecord(r as unknown as RawRecord);
}

export function mapMockRecordDetail(r: MockRecord) {
  return mapRecordDetail(r as unknown as RawRecordWithDetail);
}
