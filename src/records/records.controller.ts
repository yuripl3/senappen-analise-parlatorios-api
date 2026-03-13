import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
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
import { BulkActionDto } from './dto/bulk-action.dto';
import { UpdateUserCommentsDto } from './dto/update-user-comments.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { JwtPayload } from '@/auth/decorators/current-user.decorator';
import { UserRole } from '@/common/constants/enums';

@ApiTags('records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  @Roles(UserRole.leitor)
  @ApiOperation({
    summary: 'List records',
    description:
      'Returns a paginated list of visit records with optional filters. Unit-scoped for non-admins.',
  })
  @ApiOkResponse({ description: 'Paginated list of records.' })
  findAll(@Query() query: QueryRecordsDto, @CurrentUser() actor: JwtPayload) {
    return this.recordsService.findAll(query, actor);
  }

  @Get(':id')
  @Roles(UserRole.leitor)
  @ApiOperation({
    summary: 'Get a record',
    description: 'Returns full record detail including audit log. Unit-scoped for non-admins.',
  })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiOkResponse({ description: 'Record detail.' })
  findOne(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.recordsService.findOne(id, actor);
  }

  @Get(':id/stream')
  @Roles(UserRole.leitor)
  @ApiOperation({
    summary: 'Stream the video file for a record',
    description:
      'Returns the video binary for the given record. Supports Range requests for seeking.',
  })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiOkResponse({ description: 'Video binary stream.' })
  async streamVideo(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const blobUrl = await this.recordsService.getBlobUrl(id);
    if (!blobUrl) throw new NotFoundException('Video not available for this record');

    // For local storage, resolve the path relative to cwd
    if (!blobUrl.startsWith('http')) {
      const filePath = path.resolve(process.cwd(), blobUrl);
      if (!fs.existsSync(filePath)) {
        throw new NotFoundException('Video file not found on disk');
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'video/mp4',
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
        });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    // For Azure URLs, redirect
    res.redirect(blobUrl);
  }

  @Get(':id/audit')
  @Roles(UserRole.analista)
  @ApiOperation({
    summary: 'Get audit log for a record',
    description: 'Returns the full audit log history for a specific record. Analyst+ only.',
  })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiOkResponse({ description: 'Audit log entries.' })
  getAudit(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.recordsService.getAudit(id, actor);
  }

  @Post()
  @Roles(UserRole.cadastrador)
  @ApiOperation({
    summary: 'Create a record (JSON)',
    description: 'Creates a new visit record without a file. Status starts at `uploaded`.',
  })
  @ApiCreatedResponse({ description: 'Created record.' })
  create(@Body() dto: CreateRecordDto, @CurrentUser() actor: JwtPayload) {
    return this.recordsService.create(dto, actor.sub);
  }

  @Post('upload')
  @Roles(UserRole.cadastrador)
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

  @Post('bulk-action')
  @Roles(UserRole.supervisor)
  @ApiOperation({
    summary: 'Bulk archive or restore records',
    description: 'Performs an archive or restore action on multiple records at once.',
  })
  @ApiOkResponse({ description: 'Result with succeeded and failed IDs.' })
  bulkAction(@Body() dto: BulkActionDto, @CurrentUser() actor: JwtPayload) {
    return this.recordsService.bulkAction(dto, actor.sub);
  }

  @Patch(':id/status')
  @Roles(UserRole.analista)
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

  @Patch(':id/archive')
  @Roles(UserRole.admin)
  @ApiOperation({
    summary: 'Archive a record',
    description: 'Sets retentionStatus to `archived`, records archivedAt and archivedById.',
  })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiOkResponse({ description: 'Archived record.' })
  archive(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.recordsService.archive(id, actor.sub);
  }

  @Patch(':id/restore')
  @Roles(UserRole.admin)
  @ApiOperation({
    summary: 'Restore an archived record',
    description: 'Resets retentionStatus to `retention_standard` and clears archive fields.',
  })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiOkResponse({ description: 'Restored record.' })
  restore(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.recordsService.restore(id, actor.sub);
  }

  @Patch(':id/user-comments')
  @Roles(UserRole.analista)
  @ApiOperation({
    summary: "Update per-line user comments on a record's transcription",
    description: 'Stores user-authored per-line comments/tags alongside the AI transcription.',
  })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiOkResponse({ description: 'Updated user comments.' })
  updateUserComments(@Param('id') id: string, @Body() dto: UpdateUserCommentsDto) {
    return this.recordsService.updateUserComments(id, dto.comments);
  }

  @Delete(':id')
  @Roles(UserRole.cadastrador)
  @ApiOperation({
    summary: 'Delete a record',
    description:
      'Deletes a record. Permission depends on user role:\n' +
      '- cadastrador: own records only, before confirmed_human/rejected_human status.\n' +
      '- analista: own records in initial statuses.\n' +
      '- supervisor: any record within their units.\n' +
      '- admin: unrestricted.',
  })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiOkResponse({ description: 'Deleted record ID.' })
  remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.recordsService.remove(id, actor);
  }
}
