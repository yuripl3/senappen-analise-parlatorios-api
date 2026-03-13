/**
 * Application enums — replaces Prisma-generated enums.
 *
 * These are plain TypeScript string enums that serve as the single source
 * of truth for both runtime validation and type checking.
 */

// ─── User Roles (hierarchical) ──────────────────────────────────────────────

export enum UserRole {
  leitor = 'leitor',
  cadastrador = 'cadastrador',
  analista = 'analista',
  supervisor = 'supervisor',
  admin = 'admin',
}

/** Hierarchy level per role — higher number = more privileges. */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.leitor]: 1,
  [UserRole.cadastrador]: 2,
  [UserRole.analista]: 3,
  [UserRole.supervisor]: 4,
  [UserRole.admin]: 5,
};

/** Returns `true` when `userRole` is at least as privileged as `minRole`. */
export function hasMinRole(userRole: UserRole | string, minRole: UserRole | string): boolean {
  const userLevel = ROLE_HIERARCHY[userRole as UserRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minRole as UserRole] ?? Infinity;
  return userLevel >= requiredLevel;
}

// ─── Analysis Status ────────────────────────────────────────────────────────

export enum AnalysisStatus {
  uploaded = 'uploaded',
  processing_ai = 'processing_ai',
  clean = 'clean',
  flagged_ai = 'flagged_ai',
  under_review = 'under_review',
  confirmed_human = 'confirmed_human',
  rejected_human = 'rejected_human',
  approved = 'approved',
  rejected_supervisor = 'rejected_supervisor',
}

// ─── Retention Status ───────────────────────────────────────────────────────

export enum RetentionStatus {
  retention_standard = 'retention_standard',
  retention_extended = 'retention_extended',
  permanent_retention = 'permanent_retention',
  archived = 'archived',
}

// ─── Visitor Type ───────────────────────────────────────────────────────────

export enum VisitorType {
  ATENDIMENTO_JURIDICO = 'ATENDIMENTO_JURIDICO',
  VISITA_SOCIAL_PRESENCIAL = 'VISITA_SOCIAL_PRESENCIAL',
  VISITA_SOCIAL_VIRTUAL = 'VISITA_SOCIAL_VIRTUAL',
}

// ─── Analyst Decision ───────────────────────────────────────────────────────

export enum AnalystDecision {
  COM_ALTERACAO = 'COM_ALTERACAO',
  SEM_ALTERACAO = 'SEM_ALTERACAO',
}
