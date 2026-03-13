import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { CosmosService } from './database/cosmos.service';

const mockCosmosService = {
  getDatabase: jest.fn().mockReturnValue({
    read: jest.fn().mockResolvedValue({ resource: { id: 'senappen' } }),
  }),
};

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: CosmosService, useValue: mockCosmosService }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return status ok when DB is reachable', async () => {
      const result = await appController.health();
      expect(result).toEqual({ status: 'ok', db: 'connected' });
    });

    it('should call getDatabase().read() to verify the DB connection', async () => {
      await appController.health();
      expect(mockCosmosService.getDatabase).toHaveBeenCalled();
    });
  });
});
