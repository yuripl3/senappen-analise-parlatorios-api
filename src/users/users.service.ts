import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { CosmosService } from '@/database/cosmos.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { MOCK_USERS } from '@/mock/mock-data';

const BCRYPT_ROUNDS = 12;

interface CosmosUserDoc {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  units: string[];
  active: boolean;
  lastLogin: Date | string | null;
  createdAt?: string;
  updatedAt?: string;
}

function mapUser(u: {
  id: string;
  name: string;
  email: string;
  role: string;
  units: string[];
  active: boolean;
  lastLogin: Date | string | null;
}) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatDate = (d: Date) =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const lastLoginDate =
    u.lastLogin instanceof Date ? u.lastLogin : u.lastLogin ? new Date(u.lastLogin) : null;

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    units: u.units ?? [],
    active: u.active,
    lastLogin: lastLoginDate ? formatDate(lastLoginDate) : 'Nunca',
  };
}

@Injectable()
export class UsersService {
  private readonly useMockData: boolean;

  constructor(
    private readonly cosmos: CosmosService,
    private readonly config: ConfigService,
  ) {
    this.useMockData = this.config.get<string>('USE_MOCK_DATA') === 'true';
  }

  findAll() {
    if (this.useMockData) {
      return Promise.resolve(MOCK_USERS.map(mapUser));
    }
    return this.cosmos.users.items
      .query<CosmosUserDoc>({
        query:
          'SELECT c.id, c.name, c.email, c.role, c.units, c.active, c.lastLogin FROM c ORDER BY c.name ASC',
      })
      .fetchAll()
      .then(({ resources }) => resources.map(mapUser));
  }

  async findOne(id: string) {
    if (this.useMockData) {
      const user = MOCK_USERS.find((u) => u.id === id);
      if (!user) throw new NotFoundException(`User ${id} not found`);
      return mapUser(user);
    }
    const { resource: user } = await this.cosmos.users.item(id, id).read<CosmosUserDoc>();
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return mapUser(user);
  }

  async findByEmail(email: string) {
    if (this.useMockData) {
      return MOCK_USERS.find((u) => u.email === email) ?? null;
    }
    const { resources } = await this.cosmos.users.items
      .query<CosmosUserDoc>({
        query: 'SELECT * FROM c WHERE c.email = @email',
        parameters: [{ name: '@email', value: email }],
      })
      .fetchAll();
    return resources[0] ?? null;
  }

  async create(dto: CreateUserDto) {
    const existing = await this.findByEmail(dto.email);
    if (existing) throw new ConflictException(`Email ${dto.email} is already in use`);

    const now = new Date().toISOString();
    const doc = {
      id: crypto.randomUUID(),
      name: dto.name,
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      role: dto.role,
      units: dto.units ?? [],
      active: dto.active ?? true,
      lastLogin: null,
      createdAt: now,
      updatedAt: now,
    };

    const { resource } = await this.cosmos.users.items.create(doc);
    return mapUser(resource!);
  }

  async update(id: string, dto: UpdateUserDto) {
    const { resource: user } = await this.cosmos.users.item(id, id).read<CosmosUserDoc>();
    if (!user) throw new NotFoundException(`User ${id} not found`);

    if (dto.email && dto.email !== user.email) {
      const conflict = await this.findByEmail(dto.email);
      if (conflict && conflict.id !== id) {
        throw new ConflictException(`Email ${dto.email} is already in use`);
      }
    }

    const updatedDoc = {
      ...user,
      ...dto,
      updatedAt: new Date().toISOString(),
    };

    const { resource } = await this.cosmos.users.item(id, id).replace(updatedDoc);
    return mapUser(resource as CosmosUserDoc);
  }

  async findAllAuditLogs(params: { page?: number; limit?: number; search?: string }) {
    const { page = 1, limit = 50, search } = params;
    const skip = (page - 1) * limit;

    if (this.useMockData) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }

    // Build query with optional search
    const conditions: string[] = [];
    const parameters: { name: string; value: string | number | boolean }[] = [];

    if (search) {
      conditions.push(
        '(CONTAINS(LOWER(c.action), @search) OR CONTAINS(LOWER(c.user.name), @search))',
      );
      parameters.push({ name: '@search', value: search.toLowerCase() });
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const { resources: countResult } = await this.cosmos.auditLogs.items
      .query({ query: `SELECT VALUE COUNT(1) FROM c ${whereClause}`, parameters })
      .fetchAll();
    const total = countResult[0] ?? 0;

    // Paginated
    const { resources: logs } = await this.cosmos.auditLogs.items
      .query({
        query: `SELECT * FROM c ${whereClause} ORDER BY c.createdAt DESC OFFSET @skip LIMIT @limit`,
        parameters: [
          ...parameters,
          { name: '@skip', value: skip },
          { name: '@limit', value: limit },
        ],
      })
      .fetchAll();

    return {
      data: logs.map((log: Record<string, unknown>) => ({
        id: log.id as string,
        recordId: (log.recordId as string) ?? undefined,
        userId: log.userId as string,
        user: ((log.user as { name?: string })?.name as string) ?? 'Unknown',
        userRole: ((log.user as { role?: string })?.role as string) ?? 'unknown',
        action: log.action as string,
        previousStatus: log.previousStatus as string,
        nextStatus: log.nextStatus as string,
        notes: log.notes as string,
        timestamp: log.createdAt as string,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
