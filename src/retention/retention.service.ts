import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { UpdateRetentionPolicyDto } from './dto/update-retention-policy.dto';

const POLICY_ID = 'global';

@Injectable()
export class RetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    // Upsert: ensure the singleton row always exists
    return this.prisma.retentionPolicy.upsert({
      where: { id: POLICY_ID },
      create: {
        id: POLICY_ID,
        standardRetentionDays: 30,
        extendedRetentionDays: 90,
      },
      update: {},
    });
  }

  async update(dto: UpdateRetentionPolicyDto, actorId: string) {
    return this.prisma.retentionPolicy.upsert({
      where: { id: POLICY_ID },
      create: {
        id: POLICY_ID,
        standardRetentionDays: dto.standardRetentionDays ?? 30,
        extendedRetentionDays: dto.extendedRetentionDays ?? 90,
        updatedById: actorId,
      },
      update: {
        ...(dto.standardRetentionDays != null && {
          standardRetentionDays: dto.standardRetentionDays,
        }),
        ...(dto.extendedRetentionDays != null && {
          extendedRetentionDays: dto.extendedRetentionDays,
        }),
        updatedById: actorId,
      },
    });
  }
}
