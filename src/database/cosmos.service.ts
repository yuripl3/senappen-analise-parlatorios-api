/**
 * Cosmos DB service — replaces PrismaService.
 *
 * Provides typed access to Cosmos DB containers through a single
 * injectable service exposed as a global NestJS module.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosClient, Database, Container } from '@azure/cosmos';

export const CONTAINER_USERS = 'users';
export const CONTAINER_RECORDS = 'records';
export const CONTAINER_AUDIT_LOGS = 'auditLogs';
export const CONTAINER_RETENTION_POLICY = 'retentionPolicy';

@Injectable()
export class CosmosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CosmosService.name);
  private client!: CosmosClient;
  private db!: Database;

  /** Typed container accessors */
  users!: Container;
  records!: Container;
  auditLogs!: Container;
  retentionPolicy!: Container;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const useMock = this.config.get<string>('USE_MOCK_DATA') === 'true';
    const endpoint = this.config.get<string>('COSMOS_ENDPOINT');
    const key = this.config.get<string>('COSMOS_KEY');

    if (useMock || !endpoint || !key) {
      this.logger.log('Cosmos DB: skipped (mock mode or missing credentials)');
      return;
    }

    const databaseId = this.config.get<string>('COSMOS_DATABASE') || 'senappen';

    this.client = new CosmosClient({ endpoint, key });

    // Ensure database exists
    const { database } = await this.client.databases.createIfNotExists({ id: databaseId });
    this.db = database;

    // Ensure containers exist with partition keys
    this.users = await this.ensureContainer(CONTAINER_USERS, '/id');
    this.records = await this.ensureContainer(CONTAINER_RECORDS, '/id');
    this.auditLogs = await this.ensureContainer(CONTAINER_AUDIT_LOGS, '/recordId');
    this.retentionPolicy = await this.ensureContainer(CONTAINER_RETENTION_POLICY, '/id');

    this.logger.log(`Cosmos DB connected — database: ${databaseId}`);
  }

  onModuleDestroy() {
    this.client?.dispose();
  }

  /** Get the raw Database object for advanced operations. */
  getDatabase(): Database {
    return this.db;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async ensureContainer(id: string, partitionKey: string): Promise<Container> {
    const { container } = await this.db.containers.createIfNotExists({
      id,
      partitionKey: { paths: [partitionKey] },
    });
    return container;
  }
}
