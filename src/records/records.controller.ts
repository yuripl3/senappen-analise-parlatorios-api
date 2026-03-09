import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RecordsService } from './records.service';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { QueryRecordsDto } from './dto/query-records.dto';

// TODO: replace with real auth guard — actor ID will come from JWT payload
const MOCK_ACTOR_ID = 'system';

@ApiTags('records')
@Controller('records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  @ApiOperation({
    summary: 'List records',
    description: 'Returns a paginated list of visit records with optional filters.',
  })
  @ApiOkResponse({ description: 'Paginated list of records.' })
  findAll(@Query() query: QueryRecordsDto) {
    return this.recordsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a record',
    description: 'Returns full record detail including audit log.',
  })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiOkResponse({ description: 'Record detail.' })
  findOne(@Param('id') id: string) {
    return this.recordsService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a record',
    description: 'Creates a new visit record. Status starts at `uploaded`.',
  })
  @ApiCreatedResponse({ description: 'Created record.' })
  create(@Body() dto: CreateRecordDto) {
    // TODO: extract uploadedById from JWT
    return this.recordsService.create(dto, MOCK_ACTOR_ID);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Transition record status',
    description:
      'Advances or changes the analysis status following the allowed state machine. ' +
      'Pass `analystDecision` when transitioning to `confirmed_human` or `rejected_human`. ' +
      'Pass `justification` for analyst and supervisor decisions.',
  })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiOkResponse({ description: 'Updated record.' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    // TODO: extract actorId from JWT
    return this.recordsService.updateStatus(id, dto, MOCK_ACTOR_ID);
  }
}
