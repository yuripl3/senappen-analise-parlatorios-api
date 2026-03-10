import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@/database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './decorators/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ─── Login ───────────────────────────────────────────────────────────────

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Update lastLogin
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return this.buildTokenResponse(user);
  }

  // ─── Refresh token ────────────────────────────────────────────────────────

  async refresh(token: string) {
    let payload: JwtPayload & { type?: string };
    try {
      payload = this.jwt.verify<JwtPayload & { type?: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado.');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token inválido.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new NotFoundException('Usuário não encontrado ou inativo.');
    }

    return this.buildTokenResponse(user);
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  private buildTokenResponse(user: { id: string; name: string; email: string; roles: string[] }) {
    const basePayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    };

    // access_token uses the module-level signOptions (secret + expiresIn: 8h)
    const access_token = this.jwt.sign(basePayload);

    // refresh_token: longer-lived, includes type discriminator
    const refreshSeconds = 7 * 24 * 60 * 60; // 7 days
    const refresh_token = this.jwt.sign(
      { ...basePayload, type: 'refresh' },
      { expiresIn: refreshSeconds },
    );

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles,
      },
    };
  }
}
