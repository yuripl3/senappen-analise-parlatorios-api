import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '@/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

// TODO: replace with bcrypt once auth module is implemented
function hashPassword(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
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
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
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
        passwordHash: hashPassword(dto.password),
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
