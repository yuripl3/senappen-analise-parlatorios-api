import { Injectable } from '@nestjs/common';
import { CosmosService } from '@/database/cosmos.service';
import { UpdateRetentionPolicyDto } from './dto/update-retention-policy.dto';

const POLICY_ID = 'global';

@Injectable()
export class RetentionService {
  constructor(private readonly cosmos: CosmosService) {}

  async get() {
    try {
      const { resource } = await this.cosmos.retentionPolicy.item(POLICY_ID, POLICY_ID).read();
      if (resource) return resource;
    } catch {
      // Item doesn't exist yet — create default
    }

    // Create default policy
    const defaultPolicy = {
      id: POLICY_ID,
      standardRetentionDays: 30,
      extendedRetentionDays: 90,
      updatedById: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const { resource } = await this.cosmos.retentionPolicy.items.create(defaultPolicy);
    return resource;
  }

  async update(dto: UpdateRetentionPolicyDto, actorId: string) {
    const current = await this.get();
    const updatedDoc = {
      ...current,
      ...(dto.standardRetentionDays != null && {
        standardRetentionDays: dto.standardRetentionDays,
      }),
      ...(dto.extendedRetentionDays != null && {
        extendedRetentionDays: dto.extendedRetentionDays,
      }),
      updatedById: actorId,
      updatedAt: new Date().toISOString(),
    };
    const { resource } = await this.cosmos.retentionPolicy
      .item(POLICY_ID, POLICY_ID)
      .replace(updatedDoc);
    return resource;
  }
}
