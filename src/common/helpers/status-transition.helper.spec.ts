import { BadRequestException } from '@nestjs/common';
import {
  isValidTransition,
  assertValidTransition,
  getAllowedNextStatuses,
} from './status-transition.helper';

// We reference the enum values as plain strings since the helper casts them
type AS = string;

const TERMINAL: AS[] = ['clean', 'rejected_human', 'approved', 'rejected_supervisor'];

describe('status-transition.helper', () => {
  describe('isValidTransition', () => {
    const validCases: [AS, AS][] = [
      ['uploaded', 'processing_ai'],
      ['processing_ai', 'clean'],
      ['processing_ai', 'flagged_ai'],
      ['flagged_ai', 'under_review'],
      ['under_review', 'confirmed_human'],
      ['under_review', 'rejected_human'],
      ['confirmed_human', 'approved'],
      ['confirmed_human', 'rejected_supervisor'],
    ];

    it.each(validCases)(
      'should allow %s → %s',
      (current, next) => {
        expect(isValidTransition(current as any, next as any)).toBe(true);
      },
    );

    const invalidCases: [AS, AS][] = [
      ['uploaded', 'clean'],
      ['uploaded', 'flagged_ai'],
      ['processing_ai', 'under_review'],
      ['flagged_ai', 'clean'],
      ['under_review', 'approved'],
      ['confirmed_human', 'clean'],
      ['clean', 'uploaded'],
      ['approved', 'rejected_supervisor'],
    ];

    it.each(invalidCases)(
      'should reject %s → %s',
      (current, next) => {
        expect(isValidTransition(current as any, next as any)).toBe(false);
      },
    );

    it.each(TERMINAL)(
      'should reject any transition FROM terminal state %s',
      (terminal) => {
        const allStatuses: AS[] = [
          'uploaded', 'processing_ai', 'clean', 'flagged_ai',
          'under_review', 'confirmed_human', 'rejected_human',
          'approved', 'rejected_supervisor',
        ];
        for (const s of allStatuses) {
          expect(isValidTransition(terminal as any, s as any)).toBe(false);
        }
      },
    );
  });

  describe('assertValidTransition', () => {
    it('should not throw for valid transitions', () => {
      expect(() =>
        assertValidTransition('uploaded' as any, 'processing_ai' as any),
      ).not.toThrow();
    });

    it('should throw BadRequestException for invalid transitions', () => {
      expect(() =>
        assertValidTransition('uploaded' as any, 'approved' as any),
      ).toThrow(BadRequestException);
    });

    it('should include current and next status in error message', () => {
      try {
        assertValidTransition('clean' as any, 'uploaded' as any);
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
        assertValidTransition('uploaded' as any, 'clean' as any);
        fail('Expected BadRequestException');
      } catch (e) {
        expect((e as BadRequestException).message).toContain('processing_ai');
      }
    });
  });

  describe('getAllowedNextStatuses', () => {
    it('should return [processing_ai] for uploaded', () => {
      expect(getAllowedNextStatuses('uploaded' as any)).toEqual(['processing_ai']);
    });

    it('should return [clean, flagged_ai] for processing_ai', () => {
      expect(getAllowedNextStatuses('processing_ai' as any)).toEqual(['clean', 'flagged_ai']);
    });

    it('should return [under_review] for flagged_ai', () => {
      expect(getAllowedNextStatuses('flagged_ai' as any)).toEqual(['under_review']);
    });

    it('should return [confirmed_human, rejected_human] for under_review', () => {
      expect(getAllowedNextStatuses('under_review' as any)).toEqual([
        'confirmed_human',
        'rejected_human',
      ]);
    });

    it('should return [approved, rejected_supervisor] for confirmed_human', () => {
      expect(getAllowedNextStatuses('confirmed_human' as any)).toEqual([
        'approved',
        'rejected_supervisor',
      ]);
    });

    it.each(TERMINAL)('should return empty array for terminal state %s', (terminal) => {
      expect(getAllowedNextStatuses(terminal as any)).toEqual([]);
    });
  });
});
