import { Global, Module } from '@nestjs/common';
import { CosmosService } from './cosmos.service';

@Global()
@Module({
  providers: [CosmosService],
  exports: [CosmosService],
})
export class CosmosModule {}
