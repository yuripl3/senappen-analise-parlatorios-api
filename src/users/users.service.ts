import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { MOCK_USERS } from '@/mock/mock-data';

const BCRYPT_ROUNDS = 12;

function mapUser(u: { id: string; name: string; email: string; roles: string[]; active: boolean; lastLogin: Date | null }) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatDate = (d: Date) =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles,
    active: u.active,
    lastLogin: u.lastLogin ? formatDate(u.lastLogin) : 'Nunca',
  };
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  roles: true,
  active: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
  // never expose passwordHash
} as const;

@Injectable()
export class UsersService {
  private readonly useMockData: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.useMockData = this.config.get<string>('USE_MOCK_DATA') === 'true';
  }

  findAll() {
    if (this.useMockData) {
      return Promise.resolve(MOCK_USERS.map(mapUser));
    }
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { name: 'asc' },
    }).then((users) => users.map(mapUser));
  }

  async findOne(id: string) {
    if (this.useMockData) {
      const user = MOCK_USERS.find((u) => u.id === id);
      if (!user) throw new NotFoundException(`User ${id} not found`);
      return mapUser(user);
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return mapUser(user);
  }

  async findByEmail(email: string) {
    // Always hits DB — needed by AuthService for real password validation
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException(`Email ${dto.email} is already in use`);

    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        roles: dto.roles,
        active: dto.active ?? true,
      },
      select: USER_SELECT,
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id); // throws 404 if not found

    if (dto.email) {
      const conflict = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id } },
      });
      if (conflict) throw new ConflictException(`Email ${dto.email} is already in use`);
    }

    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_SELECT,
    });
  }
}
