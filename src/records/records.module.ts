import { Module } from '@nestjs/common';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';
import { StorageModule } from '@/storage/storage.module';
import { WorkerModule } from '@/worker/worker.module';

@Module({
  imports: [StorageModule, WorkerModule],
  controllers: [RecordsController],
  providers: [RecordsService],
  exports: [RecordsService],
})
export class RecordsModule {}
