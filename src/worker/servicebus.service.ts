import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ServiceBusClient,
  ServiceBusSender,
  ServiceBusReceiver,
  ServiceBusReceivedMessage,
} from '@azure/service-bus';

// ─── Job payload type ──────────────────────────────────────────────────────────

export interface TranscribeJobData {
  /** Record UUID to process */
  recordId: string;
  /** Path or URL to the stored video/audio file */
  blobUrl: string | null;
}

export const TRANSCRIPTION_QUEUE = 'transcription';

/**
 * Thin wrapper around Azure Service Bus for the transcription pipeline.
 *
 * When `USE_MOCK_DATA=true` or no connection string is configured, enqueue
 * operations are logged but not actually sent.
 */
@Injectable()
export class ServiceBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceBusService.name);
  // @azure/service-bus transitive deps use @ts-nocheck, causing the TS
  // language server to flag these as "error types". tsc --noEmit (with
  // skipLibCheck) passes cleanly. Using optional properties avoids the
  // union-with-error-type diagnostic.
  private client?: ServiceBusClient;
  private sender?: ServiceBusSender;
  private receiver?: ServiceBusReceiver;
  private readonly connectionString: string | undefined;
  private readonly useMock: boolean;
  private messageHandler: ((data: TranscribeJobData) => Promise<void>) | null = null;

  constructor(private readonly config: ConfigService) {
    this.connectionString = this.config.get<string>('SERVICE_BUS_CONNECTION_STRING');
    this.useMock = this.config.get<string>('USE_MOCK_DATA') === 'true' || !this.connectionString;
  }

  onModuleInit() {
    if (this.useMock) {
      this.logger.log('Service Bus: mock mode (no connection string or USE_MOCK_DATA=true)');
      return;
    }

    this.client = new ServiceBusClient(this.connectionString!);
    this.sender = this.client.createSender(TRANSCRIPTION_QUEUE);
    this.logger.log(`Service Bus sender initialised for queue "${TRANSCRIPTION_QUEUE}"`);
  }

  async onModuleDestroy() {
    await this.sender?.close();
    await this.receiver?.close();
    await this.client?.close();
  }

  /** Enqueue a transcription job for the given record. */
  async enqueueTranscription(data: TranscribeJobData): Promise<void> {
    if (this.useMock) {
      this.logger.log(`[Mock] Would enqueue transcription for record ${data.recordId}`);
      return;
    }

    await this.sender!.sendMessages({
      body: data,
      contentType: 'application/json',
      subject: 'transcribe',
    });
    this.logger.log(`Enqueued transcription job for record ${data.recordId}`);
  }

  /**
   * Start receiving messages. Called by TranscriptionProcessor on module init.
   */
  startReceiving(handler: (data: TranscribeJobData) => Promise<void>): void {
    this.messageHandler = handler;

    if (this.useMock) {
      this.logger.log('[Mock] Service Bus receiver registered (no-op)');
      return;
    }

    if (!this.client) return;

    this.receiver = this.client.createReceiver(TRANSCRIPTION_QUEUE);
    this.receiver.subscribe({
      processMessage: async (message: ServiceBusReceivedMessage) => {
        const data = message.body as TranscribeJobData;
        this.logger.log(`Received transcription job for record ${data.recordId}`);

        try {
          await this.messageHandler!(data);
          await this.receiver!.completeMessage(message);
        } catch (err) {
          this.logger.error(`Job failed for record ${data.recordId}: ${(err as Error).message}`);
          // Message will be retried by Service Bus dead-letter / retry policy
        }
      },
      processError: (args): Promise<void> => {
        this.logger.error(`Service Bus receiver error: ${args.error.message}`);
        return Promise.resolve();
      },
    });

    this.logger.log('Service Bus receiver started');
  }
}
