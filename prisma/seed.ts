/**
 * Prisma seed script — creates the 6 demo users used by mock data.
 * Run with: npm run db:seed
 *
 * All users share the password: senhaSegura123
 */

import { PrismaClient } from '../src/generated/prisma/client';
import { UserRole } from '../src/generated/prisma/enums';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const BCRYPT_ROUNDS = 12;

const DEMO_USERS: Array<{
  id: string;
  name: string;
  email: string;
  roles: UserRole[];
  active: boolean;
}> = [
  {
    id: 'mock-u1',
    name: 'Ana Silva',
    email: 'ana.silva@sistema.gov.br',
    roles: [UserRole.supervisor, UserRole.admin],
    active: true,
  },
  {
    id: 'mock-u2',
    name: 'Pedro Rocha',
    email: 'pedro.rocha@sistema.gov.br',
    roles: [UserRole.analyst],
    active: true,
  },
  {
    id: 'mock-u3',
    name: 'Carlos Lima',
    email: 'carlos.lima@sistema.gov.br',
    roles: [UserRole.uploader],
    active: true,
  },
  {
    id: 'mock-u4',
    name: 'Fernanda Costa',
    email: 'fernanda.costa@sistema.gov.br',
    roles: [UserRole.analyst, UserRole.supervisor],
    active: true,
  },
  {
    id: 'mock-u5',
    name: 'Marcos Teixeira',
    email: 'marcos.t@sistema.gov.br',
    roles: [UserRole.uploader],
    active: false,
  },
  {
    id: 'mock-u6',
    name: 'Juliana Neves',
    email: 'juliana.n@sistema.gov.br',
    roles: [UserRole.analyst],
    active: true,
  },
];

async function main() {
  console.log('Seeding demo users...');
  const passwordHash = await bcrypt.hash('senhaSegura123', BCRYPT_ROUNDS);
  console.log('Password hashed.');

  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        name: user.name,
        email: user.email,
        roles: user.roles,
        active: user.active,
        passwordHash,
      },
      create: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        active: user.active,
        passwordHash,
      },
    });
    console.log(`  ✓ ${user.email} (${user.roles.join(', ')})`);
  }

  console.log('\nSeeding complete. Login password for all users: senhaSegura123');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
