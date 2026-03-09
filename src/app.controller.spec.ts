import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { PrismaService } from './database/prisma.service';

const mockPrismaService = {
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
};

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return status ok when DB is reachable', async () => {
      const result = await appController.health();
      expect(result).toEqual({ status: 'ok', db: 'connected' });
    });

    it('should call $queryRaw to verify the DB connection', async () => {
      await appController.health();
      expect(mockPrismaService.$queryRaw).toHaveBeenCalled();
    });
  });
});
