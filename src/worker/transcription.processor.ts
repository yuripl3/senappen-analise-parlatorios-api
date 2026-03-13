import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { PrismaService } from '@/database/prisma.service';
import { AnalysisStatus } from '@/generated/prisma/enums';
import { AiService } from './ai.service';
import { TRANSCRIPTION_QUEUE, TranscribeJobData, createRedisConnection } from './queue';

/**
 * BullMQ Worker for the transcription pipeline.
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
export class TranscriptionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscriptionProcessor.name);
  private worker!: Worker;
  private readonly useMockData: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiService: AiService,
  ) {
    this.useMockData = this.config.get<string>('USE_MOCK_DATA') === 'true';
  }

  onModuleInit() {
    this.worker = new Worker<TranscribeJobData>(TRANSCRIPTION_QUEUE, (job) => this.process(job), {
      connection: createRedisConnection(),
      concurrency: Number(this.config.get('WORKER_CONCURRENCY')) || 5,
    });

    this.worker.on('completed', (job) =>
      this.logger.log(`Job ${job.id} completed (record ${job.data.recordId})`),
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Job ${job?.id} failed: ${err.message}`),
    );

    this.logger.log('TranscriptionProcessor started');
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  // ─── Core processing ────────────────────────────────────────────────────────

  private async process(job: Job<TranscribeJobData>): Promise<void> {
    const { recordId, blobUrl } = job.data;
    this.logger.log(`Processing record ${recordId} (blobUrl: ${blobUrl ?? 'none'})`);

    // 1. Mark as processing_ai
    await this.prisma.record.update({
      where: { id: recordId },
      data: { analysisStatus: AnalysisStatus.processing_ai },
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
    await this.prisma.record.update({
      where: { id: recordId },
      data: {
        analysisStatus: nextStatus,
        aiScore: result.aiScore,
        transcription: {
          lines: result.transcriptionLines,
          canonicalLines: result.canonicalLines,
          flaggedSegments: result.flaggedSegments,
        } as object,
        canonicalAnalysis: result.canonicalAnalysis as object,
      },
    });

    // 6. Audit log
    await this.prisma.auditLog.create({
      data: {
        recordId,
        userId: 'system',
        action: 'ai_processing_complete',
        previousStatus: AnalysisStatus.processing_ai,
        nextStatus,
        notes: `aiScore=${result.aiScore}`,
      },
    });
  }

  // ─── Audio extraction ────────────────────────────────────────────────────────

  /**
   * Extract mono PCM/MP3 audio from `blobUrl`.
   * Supports local file paths (`storage/videos/...`).
   * Returns the extracted audio as a Buffer.
   */
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
