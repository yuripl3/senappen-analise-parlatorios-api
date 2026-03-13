import { Module } from '@nestjs/common';
import { ServiceBusService } from './servicebus.service';
import { AiService } from './ai.service';
import { TranscriptionProcessor } from './transcription.processor';

@Module({
  providers: [ServiceBusService, AiService, TranscriptionProcessor],
  exports: [ServiceBusService],
})
export class WorkerModule {}
