import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { CosmosService } from '@/database/cosmos.service';
import { MOCK_USERS } from '@/mock/mock-data';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './decorators/current-user.decorator';

import { UserRole } from '@/common/constants/enums';

interface CosmosUserDoc {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  units: string[];
  active: boolean;
  lastLogin: string | null;
}

@Injectable()
export class AuthService {
  private readonly useMockData: boolean;

  constructor(
    private readonly cosmos: CosmosService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.useMockData = this.config.get<string>('USE_MOCK_DATA') === 'true';
  }

  // ─── Login ───────────────────────────────────────────────────────────────

  async login(dto: LoginDto) {
    const user = await this.findUserByEmail(dto.email);

    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Update lastLogin
    const updatedUser = { ...user, lastLogin: new Date().toISOString() };
    if (!this.useMockData) {
      await this.cosmos.users.item(user.id, user.id).replace(updatedUser);
    }

    return this.buildTokenResponse(updatedUser);
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

    let user: CosmosUserDoc | undefined;
    if (this.useMockData) {
      const mock = MOCK_USERS.find((u) => u.id === payload.sub);
      if (mock) {
        user = {
          ...mock,
          lastLogin: mock.lastLogin?.toISOString() ?? null,
        };
      }
    } else {
      const { resource } = await this.cosmos.users
        .item(payload.sub, payload.sub)
        .read<CosmosUserDoc>();
      user = resource;
    }
    if (!user || !user.active) {
      throw new NotFoundException('Usuário não encontrado ou inativo.');
    }

    return this.buildTokenResponse(user);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findUserByEmail(email: string): Promise<CosmosUserDoc | null> {
    if (this.useMockData) {
      const mock = MOCK_USERS.find((u) => u.email === email);
      if (!mock) return null;
      return {
        ...mock,
        lastLogin: mock.lastLogin?.toISOString() ?? null,
      };
    }
    const { resources } = await this.cosmos.users.items
      .query<CosmosUserDoc>({
        query: 'SELECT * FROM c WHERE c.email = @email',
        parameters: [{ name: '@email', value: email }],
      })
      .fetchAll();
    return resources[0] ?? null;
  }

  private buildTokenResponse(user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    units?: string[];
  }) {
    const basePayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      units: user.units ?? [],
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
        role: user.role,
        units: user.units ?? [],
      },
    };
  }
}
