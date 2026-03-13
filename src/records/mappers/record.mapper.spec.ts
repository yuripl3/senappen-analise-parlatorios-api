import { mapAuditLog, mapRecord, mapRecordDetail } from './record.mapper';

// ─── Factories ──────────────────────────────────────────────────────────────
function makeRawRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    detaineeName: 'João Silva',
    detaineeCode: 'DET-001',
    visitorName: 'Maria Souza',
    visitorType: 'VISITA_SOCIAL_PRESENCIAL',
    unit: 'Unidade A',
    vivencia: 'Bloco B',
    equipment: 'Câmera 01',
    blobUrl: 'https://storage.example.com/video.mp4',
    mediaAvailable: true,
    recordedAt: new Date('2025-01-15T10:00:00Z'),
    uploadedAt: new Date('2025-01-15T12:00:00Z'),
    uploadedBy: { id: 'user-1', name: 'Admin User' },
    analysisStatus: 'flagged_ai',
    retentionStatus: 'retention_standard',
    aiScore: 0.87,
    transcription: null,
    canonicalAnalysis: null,
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

function makeRawAuditLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    recordId: 'rec-1',
    userId: 'user-1',
    user: { id: 'user-1', name: 'Admin User', roles: ['admin'] },
    action: 'status_transition',
    notes: null as string | null | undefined,
    createdAt: new Date('2025-01-15T14:30:00Z'),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('record.mapper', () => {
  describe('mapAuditLog', () => {
    it('should map basic audit log fields', () => {
      const log = makeRawAuditLog();
      const result = mapAuditLog(log);

      expect(result.id).toBe('log-1');
      expect(result.user).toBe('Admin User');
      expect(result.userRole).toBe('admin');
      expect(result.action).toBe('status_transition');
    });

    it('should append notes to action when present', () => {
      const log = makeRawAuditLog({ notes: 'Record archived' });
      const result = mapAuditLog(log);

      expect(result.action).toBe('status_transition — Record archived');
    });

    it('should format timestamp as dd/MM/yyyy HH:mm in local time', () => {
      const log = makeRawAuditLog({ createdAt: new Date('2025-03-10T08:05:00Z') });
      const result = mapAuditLog(log);

      // The exact formatted string depends on timezone — just validate the pattern
      expect(result.timestamp).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    });

    it('should default to analyst role when roles array is empty', () => {
      const log = makeRawAuditLog({ user: { id: 'u', name: 'Test', roles: [] } });
      const result = mapAuditLog(log);

      expect(result.userRole).toBe('analyst');
    });
  });

  describe('mapRecord', () => {
    it('should map all basic fields', () => {
      const raw = makeRawRecord();
      const result = mapRecord(raw as any);

      expect(result.id).toBe('rec-1');
      expect(result.detainee).toEqual({ id: 'DET-001', name: 'João Silva' });
      expect(result.visitor).toEqual({ name: 'Maria Souza', type: 'Visita social presencial' });
      expect(result.unit).toBe('Unidade A');
      expect(result.vivencia).toBe('Bloco B');
      expect(result.equipment).toBe('Câmera 01');
      expect(result.analysisStatus).toBe('flagged_ai');
      expect(result.retentionStatus).toBe('retention_standard');
      expect(result.aiScore).toBe(0.87);
      expect(result.mediaAvailable).toBe(true);
    });

    it('should use record id as detainee.id when detaineeCode is null', () => {
      const raw = makeRawRecord({ detaineeCode: null });
      const result = mapRecord(raw as any);

      expect(result.detainee.id).toBe('rec-1');
    });

    it('should set vivencia to undefined when null', () => {
      const raw = makeRawRecord({ vivencia: null });
      const result = mapRecord(raw as any);

      expect(result.vivencia).toBeUndefined();
    });

    it('should set aiScore to undefined when null', () => {
      const raw = makeRawRecord({ aiScore: null });
      const result = mapRecord(raw as any);

      expect(result.aiScore).toBeUndefined();
    });

    it('should compute daysUntilDeletion for retention_standard', () => {
      // Use a record date far in the future so daysUntilDeletion > 0
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const raw = makeRawRecord({
        recordedAt: futureDate,
        retentionStatus: 'retention_standard',
      });
      const result = mapRecord(raw as any);

      expect(typeof result.daysUntilDeletion).toBe('number');
      expect(result.daysUntilDeletion).toBeGreaterThan(0);
    });

    it('should return null for daysUntilDeletion with permanent_retention', () => {
      const raw = makeRawRecord({ retentionStatus: 'permanent_retention' });
      const result = mapRecord(raw as any);

      expect(result.daysUntilDeletion).toBeNull();
    });

    it('should return 0 for daysUntilDeletion for expired records', () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      const raw = makeRawRecord({
        recordedAt: pastDate,
        retentionStatus: 'retention_standard',
      });
      const result = mapRecord(raw as any);

      expect(result.daysUntilDeletion).toBe(0);
    });

    it('should format archivedAt and archivedBy when present', () => {
      const raw = makeRawRecord({
        archivedAt: new Date('2025-02-20T00:00:00Z'),
        archivedBy: { id: 'u2', name: 'Supervisor', roles: ['supervisor'] },
      });
      const result = mapRecord(raw as any);

      expect(result.archivedAt).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(result.archivedBy).toBe('Supervisor (supervisor)');
    });

    it('should omit archivedAt/archivedBy when null', () => {
      const raw = makeRawRecord();
      const result = mapRecord(raw as any);

      expect(result.archivedAt).toBeUndefined();
      expect(result.archivedBy).toBeUndefined();
    });

    it('should map visitor type labels correctly', () => {
      const typeCases = [
        ['ATENDIMENTO_JURIDICO', 'Atendimento Jurídico'],
        ['VISITA_SOCIAL_PRESENCIAL', 'Visita social presencial'],
        ['VISITA_SOCIAL_VIRTUAL', 'Visita social virtual'],
      ] as const;

      for (const [input, expected] of typeCases) {
        const raw = makeRawRecord({ visitorType: input });
        const result = mapRecord(raw as any);
        expect(result.visitor.type).toBe(expected);
      }
    });
  });

  describe('mapRecordDetail', () => {
    it('should include base record fields plus detail fields', () => {
      const raw = {
        ...makeRawRecord(),
        auditLogs: [makeRawAuditLog()],
        transcription: {
          lines: [{ timestamp: '00:00', speaker: 'Detento', text: 'Hello' }],
          canonicalLines: [{ timestamp: '00:00', speaker: 'Detento', text: 'Hello canonical' }],
          flaggedSegments: [{ start: '00:00', end: '00:05', text: 'flagged', reason: 'test' }],
        },
        canonicalAnalysis: { recordId: 'rec-1', generatedAt: '2025-01-15', sections: [] },
        userComments: [{ lineIndex: 0, tagged: true, comment: 'Check this' }],
      };

      const result = mapRecordDetail(raw as any);

      expect(result.id).toBe('rec-1');
      expect(result.auditLogs).toHaveLength(1);
      expect(result.transcriptionLines).toHaveLength(1);
      expect(result.canonicalLines).toHaveLength(1);
      expect(result.flaggedSegments).toHaveLength(1);
      expect(result.canonicalAnalysis).toEqual({
        recordId: 'rec-1',
        generatedAt: '2025-01-15',
        sections: [],
      });
      expect(result.userComments).toEqual([{ lineIndex: 0, tagged: true, comment: 'Check this' }]);
    });

    it('should return null for transcription fields when transcription is null', () => {
      const raw = {
        ...makeRawRecord({ transcription: null }),
        auditLogs: [],
      };

      const result = mapRecordDetail(raw as any);

      expect(result.transcriptionLines).toBeNull();
      expect(result.canonicalLines).toBeNull();
      expect(result.flaggedSegments).toBeNull();
    });

    it('should return null for userComments when not present', () => {
      const raw = {
        ...makeRawRecord(),
        auditLogs: [],
      };

      const result = mapRecordDetail(raw as any);

      expect(result.userComments).toBeNull();
    });
  });
});
