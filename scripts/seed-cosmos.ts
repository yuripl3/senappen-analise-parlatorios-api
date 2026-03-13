/**
 * Cosmos DB seed script — creates 8 demo users used by mock data.
 * Run with: npx ts-node -r tsconfig-paths/register scripts/seed-cosmos.ts
 *
 * All users share the password: senhaSegura123
 */

import { CosmosClient } from '@azure/cosmos';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const BCRYPT_ROUNDS = 12;

const DEMO_USERS = [
  {
    id: 'mock-u1',
    name: 'Ana Silva',
    email: 'ana.silva@sistema.gov.br',
    role: 'admin',
    units: [],
    active: true,
  },
  {
    id: 'mock-u2',
    name: 'Pedro Rocha',
    email: 'pedro.rocha@sistema.gov.br',
    role: 'analista',
    units: ['CDP Guarulhos', 'Penitenciária I de Hortolândia'],
    active: true,
  },
  {
    id: 'mock-u3',
    name: 'Carlos Lima',
    email: 'carlos.lima@sistema.gov.br',
    role: 'cadastrador',
    units: ['CDP Guarulhos'],
    active: true,
  },
  {
    id: 'mock-u4',
    name: 'Fernanda Costa',
    email: 'fernanda.costa@sistema.gov.br',
    role: 'supervisor',
    units: ['CDP Guarulhos', 'Penitenciária I de Hortolândia', 'CPP Presidente Prudente'],
    active: true,
  },
  {
    id: 'mock-u5',
    name: 'Marcos Teixeira',
    email: 'marcos.t@sistema.gov.br',
    role: 'cadastrador',
    units: ['Penitenciária I de Hortolândia'],
    active: false,
  },
  {
    id: 'mock-u6',
    name: 'Juliana Neves',
    email: 'juliana.n@sistema.gov.br',
    role: 'analista',
    units: ['CPP Presidente Prudente'],
    active: true,
  },
  {
    id: 'mock-u7',
    name: 'Maria Souza',
    email: 'maria.souza@sistema.gov.br',
    role: 'leitor',
    units: ['CDP Guarulhos'],
    active: true,
  },
  {
    id: 'mock-u8',
    name: 'Ricardo Alves',
    email: 'ricardo.alves@sistema.gov.br',
    role: 'leitor',
    units: ['Penitenciária I de Hortolândia'],
    active: true,
  },
];

async function main() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  const databaseId = process.env.COSMOS_DATABASE ?? 'senappen';

  if (!endpoint || !key) {
    console.error('COSMOS_ENDPOINT and COSMOS_KEY must be set in .env');
    process.exit(1);
  }

  const client = new CosmosClient({ endpoint, key });

  // Create database if needed
  const { database } = await client.databases.createIfNotExists({ id: databaseId });
  console.log(`Database: ${databaseId}`);

  // Create users container if needed
  const { container } = await database.containers.createIfNotExists({
    id: 'users',
    partitionKey: { paths: ['/id'] },
  });
  console.log('Container: users');

  // Hash password once
  const passwordHash = await bcrypt.hash('senhaSegura123', BCRYPT_ROUNDS);
  console.log('Password hashed.\n');

  const now = new Date().toISOString();

  for (const user of DEMO_USERS) {
    const doc = {
      ...user,
      passwordHash,
      lastLogin: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await container.items.upsert(doc);
      console.log(`  ✓ ${user.email} (${user.role})`);
    } catch (err) {
      console.error(`  ✗ ${user.email}: ${(err as Error).message}`);
    }
  }

  // Create default retention policy
  const { container: retentionContainer } = await database.containers.createIfNotExists({
    id: 'retentionPolicy',
    partitionKey: { paths: ['/id'] },
  });

  await retentionContainer.items.upsert({
    id: 'global',
    standardRetentionDays: 30,
    extendedRetentionDays: 90,
    updatedById: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log('  ✓ Default retention policy created');

  console.log('\nSeeding complete. Login password for all users: senhaSegura123');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
