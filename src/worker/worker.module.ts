import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { AiService } from './ai.service';
import { TranscriptionProcessor } from './transcription.processor';
import { PrismaModule } from '@/database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [QueueService, AiService, TranscriptionProcessor],
  exports: [QueueService],
})
export class WorkerModule {}
