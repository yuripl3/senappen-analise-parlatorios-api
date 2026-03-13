import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { CosmosService } from '@/database/cosmos.service';
import { AnalysisStatus } from '@/common/constants/enums';
import { AiService } from './ai.service';
import { ServiceBusService, TranscribeJobData } from './servicebus.service';

/**
 * Transcription pipeline processor.
 *
 * Steps for each job:
 *  1. Set record status to `processing_ai`
 *  2. Extract mono MP3 audio from the stored video via ffmpeg
 *  3. Call AiService.analyse() → Whisper + GPT-4o (or mock)
 *  4. Persist transcription, canonical analysis, aiScore
 *  5. Transition status: `processing_ai → clean | flagged_ai`
 *  6. Write audit log
 */
@Injectable()
export class TranscriptionProcessor implements OnModuleInit {
  private readonly logger = new Logger(TranscriptionProcessor.name);
  private readonly useMockData: boolean;

  constructor(
    private readonly cosmos: CosmosService,
    private readonly config: ConfigService,
    private readonly aiService: AiService,
    private readonly serviceBus: ServiceBusService,
  ) {
    this.useMockData = this.config.get<string>('USE_MOCK_DATA') === 'true';
  }

  onModuleInit() {
    // Register as message handler for Service Bus
    this.serviceBus.startReceiving((data) => this.process(data));
    this.logger.log('TranscriptionProcessor started');
  }

  // ─── Core processing ────────────────────────────────────────────────────────

  private async process(data: TranscribeJobData): Promise<void> {
    const { recordId, blobUrl } = data;
    this.logger.log(`Processing record ${recordId} (blobUrl: ${blobUrl ?? 'none'})`);

    // 1. Mark as processing_ai
    const { resource: record } = await this.cosmos.records.item(recordId, recordId).read();
    if (!record) {
      this.logger.warn(`Record ${recordId} not found — skipping`);
      return;
    }

    const now = new Date().toISOString();
    await this.cosmos.records.item(recordId, recordId).replace({
      ...record,
      analysisStatus: AnalysisStatus.processing_ai,
      updatedAt: now,
    });

    let audioBuffer: Buffer | null = null;

    // 2. Extract audio (skip for mock mode or missing media)
    if (blobUrl && !this.useMockData) {
      try {
        audioBuffer = await this.extractAudio(blobUrl);
        this.logger.log(`Extracted ${audioBuffer.length} bytes of audio from ${blobUrl}`);
      } catch (err) {
        this.logger.warn(
          `Audio extraction failed: ${(err as Error).message} — proceeding with null buffer (mock AI)`,
        );
      }
    }

    // 3. AI analysis
    const result = await this.aiService.analyse(
      audioBuffer ?? Buffer.alloc(0),
      blobUrl ? path.basename(blobUrl, path.extname(blobUrl)) + '.mp3' : 'audio.mp3',
    );

    // 4. Determine next status (>= 60 → flagged_ai, else clean)
    const nextStatus = result.aiScore >= 60 ? AnalysisStatus.flagged_ai : AnalysisStatus.clean;

    // 5. Persist result and transition status
    const { resource: currentRecord } = await this.cosmos.records.item(recordId, recordId).read();
    await this.cosmos.records.item(recordId, recordId).replace({
      ...currentRecord,
      analysisStatus: nextStatus,
      aiScore: result.aiScore,
      transcription: {
        lines: result.transcriptionLines,
        canonicalLines: result.canonicalLines,
        flaggedSegments: result.flaggedSegments,
      },
      canonicalAnalysis: result.canonicalAnalysis,
      updatedAt: new Date().toISOString(),
    });

    // 6. Audit log
    await this.cosmos.auditLogs.items.create({
      id: crypto.randomUUID(),
      recordId,
      userId: 'system',
      user: { id: 'system', name: 'Sistema', role: 'admin' },
      action: 'ai_processing_complete',
      previousStatus: AnalysisStatus.processing_ai,
      nextStatus,
      notes: `aiScore=${result.aiScore}`,
      createdAt: new Date().toISOString(),
    });
  }

  // ─── Audio extraction ────────────────────────────────────────────────────────

  private extractAudio(blobUrl: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const inputPath = path.isAbsolute(blobUrl) ? blobUrl : path.resolve(process.cwd(), blobUrl);

      const tmpFile = path.join(os.tmpdir(), `senappen-audio-${Date.now()}.mp3`);

      ffmpeg(inputPath)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(16_000)
        .format('mp3')
        .on('error', reject)
        .on('end', async () => {
          try {
            const buf = await fs.readFile(tmpFile);
            await fs.unlink(tmpFile).catch(() => undefined);
            resolve(buf);
          } catch (e) {
            reject(e);
          }
        })
        .save(tmpFile);
    });
  }
}
