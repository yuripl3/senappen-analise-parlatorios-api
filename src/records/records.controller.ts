import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RecordsService } from './records.service';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { QueryRecordsDto } from './dto/query-records.dto';
import { UploadRecordDto } from './dto/upload-record.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { JwtPayload } from '@/auth/decorators/current-user.decorator';

@ApiTags('records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
    summary: 'Create a record (JSON)',
    description: 'Creates a new visit record without a file. Status starts at `uploaded`.',
  })
  @ApiCreatedResponse({ description: 'Created record.' })
  create(@Body() dto: CreateRecordDto, @CurrentUser() actor: JwtPayload) {
    return this.recordsService.create(dto, actor.sub);
  }

  @Post('upload')
  @ApiOperation({
    summary: 'Upload video + metadata',
    description:
      'Accepts a multipart/form-data request with a `video` file field and the record ' +
      'metadata fields. Saves the file locally under `storage/videos/` and creates the record.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ description: 'Created record with media.' })
  @UseInterceptors(FileInterceptor('video', { limits: { fileSize: 2 * 1024 * 1024 * 1024 } }))
  uploadRecord(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadRecordDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.recordsService.upload(file, dto, actor.sub);
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
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.recordsService.updateStatus(id, dto, actor.sub);
  }
}
