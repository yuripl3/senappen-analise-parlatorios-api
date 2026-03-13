import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { CosmosService } from '@/database/cosmos.service';

// ─── Mock user data ─────────────────────────────────────────────────────────
const HASHED_PASSWORD = bcrypt.hashSync('validPass123', 10);

const ACTIVE_USER = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  passwordHash: HASHED_PASSWORD,
  role: 'analista',
  units: ['Unidade A'],
  active: true,
  lastLogin: null,
};

const INACTIVE_USER = { ...ACTIVE_USER, id: 'user-2', active: false };

// ─── Helpers ────────────────────────────────────────────────────────────────
function createMockCosmos() {
  return {
    users: {
      items: {
        query: jest.fn().mockReturnValue({
          fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
        }),
      },
      item: jest.fn().mockReturnValue({
        read: jest.fn().mockResolvedValue({ resource: null }),
        replace: jest.fn().mockResolvedValue(undefined),
      }),
    },
  };
}

function createMockJwt() {
  return {
    sign: jest.fn().mockReturnValue('mock-token'),
    verify: jest.fn(),
  };
}

function createMockConfig() {
  return {
    getOrThrow: jest.fn().mockReturnValue('test-jwt-secret-at-least-16'),
  };
}

/** Helper: make the cosmos query return a specific user */
function mockQueryReturns(cosmos: ReturnType<typeof createMockCosmos>, user: typeof ACTIVE_USER | null) {
  cosmos.users.items.query.mockReturnValue({
    fetchAll: jest.fn().mockResolvedValue({ resources: user ? [user] : [] }),
  });
}

/** Helper: make cosmos item().read() return a specific user */
function mockItemRead(cosmos: ReturnType<typeof createMockCosmos>, user: typeof ACTIVE_USER | null) {
  cosmos.users.item.mockReturnValue({
    read: jest.fn().mockResolvedValue({ resource: user }),
    replace: jest.fn().mockResolvedValue(undefined),
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('AuthService', () => {
  let service: AuthService;
  let cosmos: ReturnType<typeof createMockCosmos>;
  let jwt: ReturnType<typeof createMockJwt>;
  let config: ReturnType<typeof createMockConfig>;

  beforeEach(async () => {
    cosmos = createMockCosmos();
    jwt = createMockJwt();
    config = createMockConfig();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: CosmosService, useValue: cosmos },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('should return tokens and user data for valid credentials', async () => {
      mockQueryReturns(cosmos, ACTIVE_USER);
      cosmos.users.item.mockReturnValue({
        read: jest.fn(),
        replace: jest.fn().mockResolvedValue(undefined),
      });
      jwt.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      const result = await service.login({
        email: 'test@example.com',
        password: 'validPass123',
      });

      expect(result.access_token).toBe('access-token');
      expect(result.refresh_token).toBe('refresh-token');
      expect(result.user).toEqual({
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        role: 'analista',
        units: ['Unidade A'],
      });
    });

    it('should update lastLogin on successful login', async () => {
      mockQueryReturns(cosmos, ACTIVE_USER);
      const replaceFn = jest.fn().mockResolvedValue(undefined);
      cosmos.users.item.mockReturnValue({ read: jest.fn(), replace: replaceFn });

      await service.login({ email: 'test@example.com', password: 'validPass123' });

      expect(cosmos.users.item).toHaveBeenCalledWith('user-1', 'user-1');
      expect(replaceFn).toHaveBeenCalledWith(
        expect.objectContaining({ lastLogin: expect.any(String) }),
      );
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      mockQueryReturns(cosmos, null);

      await expect(service.login({ email: 'nobody@example.com', password: 'any' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for inactive user', async () => {
      mockQueryReturns(cosmos, INACTIVE_USER);

      await expect(
        service.login({ email: 'test@example.com', password: 'validPass123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      mockQueryReturns(cosmos, ACTIVE_USER);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrongPassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should sign access token with correct payload', async () => {
      mockQueryReturns(cosmos, ACTIVE_USER);
      cosmos.users.item.mockReturnValue({
        read: jest.fn(),
        replace: jest.fn().mockResolvedValue(undefined),
      });

      await service.login({ email: 'test@example.com', password: 'validPass123' });

      const expectedPayload = {
        sub: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'analista',
        units: ['Unidade A'],
      };

      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(jwt.sign).toHaveBeenNthCalledWith(1, expectedPayload);
      expect(jwt.sign).toHaveBeenNthCalledWith(
        2,
        { ...expectedPayload, type: 'refresh' },
        { expiresIn: 7 * 24 * 60 * 60 },
      );
    });
  });

  describe('refresh', () => {
    const validRefreshPayload = {
      sub: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'analista',
      units: ['Unidade A'],
      type: 'refresh',
    };

    it('should return new tokens for valid refresh token', async () => {
      jwt.verify.mockReturnValue(validRefreshPayload);
      mockItemRead(cosmos, ACTIVE_USER);
      jwt.sign.mockReturnValueOnce('new-access').mockReturnValueOnce('new-refresh');

      const result = await service.refresh('valid-refresh-token');

      expect(result.access_token).toBe('new-access');
      expect(result.refresh_token).toBe('new-refresh');
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('invalid');
      });

      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for non-refresh token type', async () => {
      jwt.verify.mockReturnValue({ ...validRefreshPayload, type: 'access' });

      await expect(service.refresh('access-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw NotFoundException for inactive user', async () => {
      jwt.verify.mockReturnValue(validRefreshPayload);
      mockItemRead(cosmos, INACTIVE_USER);

      await expect(service.refresh('valid-token')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for non-existent user', async () => {
      jwt.verify.mockReturnValue(validRefreshPayload);
      mockItemRead(cosmos, null);

      await expect(service.refresh('valid-token')).rejects.toThrow(NotFoundException);
    });
  });
});
