import { BadRequestException } from '@nestjs/common';
import {
  isValidTransition,
  assertValidTransition,
  getAllowedNextStatuses,
} from './status-transition.helper';
import { AnalysisStatus } from '@/common/constants/enums';

const TERMINAL: AnalysisStatus[] = [
  AnalysisStatus.clean,
  AnalysisStatus.rejected_human,
  AnalysisStatus.approved,
  AnalysisStatus.rejected_supervisor,
];

describe('status-transition.helper', () => {
  describe('isValidTransition', () => {
    const validCases: [AnalysisStatus, AnalysisStatus][] = [
      [AnalysisStatus.uploaded, AnalysisStatus.processing_ai],
      [AnalysisStatus.processing_ai, AnalysisStatus.clean],
      [AnalysisStatus.processing_ai, AnalysisStatus.flagged_ai],
      [AnalysisStatus.flagged_ai, AnalysisStatus.under_review],
      [AnalysisStatus.under_review, AnalysisStatus.confirmed_human],
      [AnalysisStatus.under_review, AnalysisStatus.rejected_human],
      [AnalysisStatus.confirmed_human, AnalysisStatus.approved],
      [AnalysisStatus.confirmed_human, AnalysisStatus.rejected_supervisor],
    ];

    it.each(validCases)('should allow %s → %s', (current, next) => {
      expect(isValidTransition(current, next)).toBe(true);
    });

    const invalidCases: [AnalysisStatus, AnalysisStatus][] = [
      [AnalysisStatus.uploaded, AnalysisStatus.clean],
      [AnalysisStatus.uploaded, AnalysisStatus.flagged_ai],
      [AnalysisStatus.processing_ai, AnalysisStatus.under_review],
      [AnalysisStatus.flagged_ai, AnalysisStatus.clean],
      [AnalysisStatus.under_review, AnalysisStatus.approved],
      [AnalysisStatus.confirmed_human, AnalysisStatus.clean],
      [AnalysisStatus.clean, AnalysisStatus.uploaded],
      [AnalysisStatus.approved, AnalysisStatus.rejected_supervisor],
    ];

    it.each(invalidCases)('should reject %s → %s', (current, next) => {
      expect(isValidTransition(current, next)).toBe(false);
    });

    it.each(TERMINAL)('should reject any transition FROM terminal state %s', (terminal) => {
      const allStatuses: AnalysisStatus[] = [
        AnalysisStatus.uploaded,
        AnalysisStatus.processing_ai,
        AnalysisStatus.clean,
        AnalysisStatus.flagged_ai,
        AnalysisStatus.under_review,
        AnalysisStatus.confirmed_human,
        AnalysisStatus.rejected_human,
        AnalysisStatus.approved,
        AnalysisStatus.rejected_supervisor,
      ];
      for (const s of allStatuses) {
        expect(isValidTransition(terminal, s)).toBe(false);
      }
    });
  });

  describe('assertValidTransition', () => {
    it('should not throw for valid transitions', () => {
      expect(() =>
        assertValidTransition(AnalysisStatus.uploaded, AnalysisStatus.processing_ai),
      ).not.toThrow();
    });

    it('should throw BadRequestException for invalid transitions', () => {
      expect(() => assertValidTransition(AnalysisStatus.uploaded, AnalysisStatus.approved)).toThrow(
        BadRequestException,
      );
    });

    it('should include current and next status in error message', () => {
      try {
        assertValidTransition(AnalysisStatus.clean, AnalysisStatus.uploaded);
        fail('Expected BadRequestException');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain('clean');
        expect((e as BadRequestException).message).toContain('uploaded');
        expect((e as BadRequestException).message).toContain('terminal state');
      }
    });

    it('should list allowed transitions in error message', () => {
      try {
        assertValidTransition(AnalysisStatus.uploaded, AnalysisStatus.clean);
        fail('Expected BadRequestException');
      } catch (e) {
        expect((e as BadRequestException).message).toContain('processing_ai');
      }
    });
  });

  describe('getAllowedNextStatuses', () => {
    it('should return [processing_ai] for uploaded', () => {
      expect(getAllowedNextStatuses(AnalysisStatus.uploaded)).toEqual([
        AnalysisStatus.processing_ai,
      ]);
    });

    it('should return [clean, flagged_ai] for processing_ai', () => {
      expect(getAllowedNextStatuses(AnalysisStatus.processing_ai)).toEqual([
        AnalysisStatus.clean,
        AnalysisStatus.flagged_ai,
      ]);
    });

    it('should return [under_review] for flagged_ai', () => {
      expect(getAllowedNextStatuses(AnalysisStatus.flagged_ai)).toEqual([
        AnalysisStatus.under_review,
      ]);
    });

    it('should return [confirmed_human, rejected_human] for under_review', () => {
      expect(getAllowedNextStatuses(AnalysisStatus.under_review)).toEqual([
        AnalysisStatus.confirmed_human,
        AnalysisStatus.rejected_human,
      ]);
    });

    it('should return [approved, rejected_supervisor] for confirmed_human', () => {
      expect(getAllowedNextStatuses(AnalysisStatus.confirmed_human)).toEqual([
        AnalysisStatus.approved,
        AnalysisStatus.rejected_supervisor,
      ]);
    });

    it.each(TERMINAL)('should return empty array for terminal state %s', (terminal) => {
      expect(getAllowedNextStatuses(terminal)).toEqual([]);
    });
  });
});
