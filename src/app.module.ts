import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation';

import { AppController } from './app.controller';
import { CosmosModule } from './database/cosmos.module';
import { KeyVaultModule } from './config/keyvault.module';
import { RecordsModule } from './records/records.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { WorkerModule } from './worker/worker.module';
import { RetentionModule } from './retention/retention.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    CosmosModule,
    KeyVaultModule,
    AuthModule,
    RecordsModule,
    UsersModule,
    WorkerModule,
    RetentionModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
