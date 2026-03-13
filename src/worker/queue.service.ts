import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { TRANSCRIPTION_QUEUE, TranscribeJobData, createRedisConnection } from './queue';

/**
 * Thin wrapper around the BullMQ `Queue` for the transcription pipeline.
 * Inject this service anywhere you need to enqueue a transcription job.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queue!: Queue<TranscribeJobData>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.queue = new Queue<TranscribeJobData>(TRANSCRIPTION_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
    this.logger.log(`Queue "${TRANSCRIPTION_QUEUE}" initialised`);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  /** Enqueue a transcription job for the given record. */
  async enqueueTranscription(data: TranscribeJobData): Promise<void> {
    await this.queue.add('transcribe', data);
    this.logger.log(`Enqueued transcription job for record ${data.recordId}`);
  }
}
