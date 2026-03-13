import { BadRequestException } from '@nestjs/common';
import { AnalysisStatus } from '@/common/constants/enums';

/**
 * Valid status transitions for the record lifecycle.
 *
 *  uploaded → processing_ai → clean | flagged_ai
 *  flagged_ai → under_review → confirmed_human | rejected_human
 *  confirmed_human → approved | rejected_supervisor
 */
const ALLOWED_TRANSITIONS: Record<string, AnalysisStatus[]> = {
  [AnalysisStatus.uploaded]: [AnalysisStatus.processing_ai],
  [AnalysisStatus.processing_ai]: [AnalysisStatus.clean, AnalysisStatus.flagged_ai],
  [AnalysisStatus.flagged_ai]: [AnalysisStatus.under_review],
  [AnalysisStatus.under_review]: [AnalysisStatus.confirmed_human, AnalysisStatus.rejected_human],
  [AnalysisStatus.confirmed_human]: [AnalysisStatus.approved, AnalysisStatus.rejected_supervisor],
  // Terminal states — no outgoing transitions
  [AnalysisStatus.clean]: [],
  [AnalysisStatus.rejected_human]: [],
  [AnalysisStatus.approved]: [],
  [AnalysisStatus.rejected_supervisor]: [],
};

/**
 * Returns whether the transition from `current` to `next` is valid.
 */
export function isValidTransition(current: AnalysisStatus, next: AnalysisStatus): boolean {
  return ALLOWED_TRANSITIONS[current as string].includes(next);
}

/**
 * Asserts a transition is valid, throwing a 400 if not.
 */
export function assertValidTransition(current: AnalysisStatus, next: AnalysisStatus): void {
  if (!isValidTransition(current, next)) {
    throw new BadRequestException(
      `Invalid status transition: ${current} → ${next}. ` +
        `Allowed: ${ALLOWED_TRANSITIONS[current as string].join(', ') || 'none (terminal state)'}`,
    );
  }
}

/**
 * Returns the list of statuses a record can transition to from `current`.
 */
export function getAllowedNextStatuses(current: AnalysisStatus): AnalysisStatus[] {
  return ALLOWED_TRANSITIONS[current as string];
}
