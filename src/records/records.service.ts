import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AnalysisStatus } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { QueryRecordsDto } from './dto/query-records.dto';
import { assertValidTransition } from '@/common/helpers/status-transition.helper';

@Injectable()
export class RecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryRecordsDto) {
    const {
      page = 1,
      limit = 20,
      status,
      retentionStatus,
      visitorType,
      unit,
      uploadedById,
      from,
      to,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.RecordWhereInput = {
      ...(status && { analysisStatus: status }),
      ...(retentionStatus && { retentionStatus }),
      ...(visitorType && { visitorType }),
      ...(unit && { unit: { contains: unit, mode: Prisma.QueryMode.insensitive } }),
      ...(uploadedById && { uploadedById }),
      ...(from || to
        ? {
            recordedAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.record.count({ where }),
      this.prisma.record.findMany({
        where,
        skip,
        take: limit,
        orderBy: { recordedAt: 'desc' },
        include: { uploadedBy: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const record = await this.prisma.record.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        auditLogs: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true, roles: true } } },
        },
      },
    });

    if (!record) throw new NotFoundException(`Record ${id} not found`);
    return record;
  }

  create(dto: CreateRecordDto, uploadedById: string) {
    return this.prisma.record.create({
      data: {
        ...dto,
        recordedAt: new Date(dto.recordedAt),
        mediaAvailable: dto.mediaAvailable ?? false,
        uploadedById,
        analysisStatus: AnalysisStatus.uploaded,
      },
    });
  }

  async updateStatus(id: string, dto: UpdateStatusDto, actorId: string) {
    const record = await this.prisma.record.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Record ${id} not found`);

    assertValidTransition(record.analysisStatus, dto.status);

    const [updated] = await this.prisma.$transaction([
      this.prisma.record.update({
        where: { id },
        data: {
          analysisStatus: dto.status,
          ...(dto.analystDecision && { analystDecision: dto.analystDecision }),
          ...(dto.justification &&
            (dto.status === AnalysisStatus.confirmed_human ||
              dto.status === AnalysisStatus.rejected_human) && {
              analystJustification: dto.justification,
              analysisConfirmedAt: new Date(),
              analystId: actorId,
            }),
          ...(dto.justification &&
            (dto.status === AnalysisStatus.approved ||
              dto.status === AnalysisStatus.rejected_supervisor) && {
              supervisorJustification: dto.justification,
              supervisorDecidedAt: new Date(),
              supervisorId: actorId,
            }),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          recordId: id,
          userId: actorId,
          action: `status_transition`,
          previousStatus: record.analysisStatus,
          nextStatus: dto.status,
          notes: dto.notes,
        },
      }),
    ]);

    return updated;
  }
}
