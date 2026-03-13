import { Global, Module } from '@nestjs/common';
import { KeyVaultService } from './keyvault.service';

@Global()
@Module({
  providers: [KeyVaultService],
  exports: [KeyVaultService],
})
export class KeyVaultModule {}
