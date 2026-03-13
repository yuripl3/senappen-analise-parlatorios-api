import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CosmosService } from './database/cosmos.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly cosmos: CosmosService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description: 'Returns API status and database connectivity.',
  })
  @ApiOkResponse({ schema: { example: { status: 'ok', db: 'connected' } } })
  async health() {
    await this.cosmos.getDatabase().read();
    return { status: 'ok', db: 'connected' };
  }
}
