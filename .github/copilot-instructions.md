# Copilot Instructions — Análise de Parlatorios API

## Project Overview
NestJS 11 REST API for the Brazilian prison visitor-recording analysis system ("parlatorios" = visiting rooms). It will handle: video uploads, audio extraction, AI transcription, LLM-based analysis, and analyst/supervisor review workflows. A BullMQ/Redis job queue drives the async processing pipeline.

The companion React frontend lives in `../senappen-analise-parlatorios/`. Its Copilot instructions are in `senappen-analise-parlatorios/.github/copilot-instructions.md`.

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | NestJS 11 (Express adapter) |
| ORM | Prisma 7 (driver-adapter pattern — see below) |
| Database | PostgreSQL 16 |
| Queue | BullMQ 5 + Redis 7 via ioredis |
| File storage | Azure Blob Storage (`@azure/storage-blob`) |
| Audio transcription | Azure AI Speech (`microsoft-cognitiveservices-speech-sdk`) |
| LLM analysis | AI team microservice (external HTTP call — no SDK here) |
| Validation (HTTP) | `class-validator` + `class-transformer` |
| Validation (internal) | `zod` 4 |
| API docs | Swagger (`@nestjs/swagger`) at `GET /docs` |
| Path alias | `@/` → `src/` |

## Key Commands

```sh
npm run start:dev    # hot-reload dev server (port 3000)
npm run start:prod   # run compiled dist/
npm run build        # compile to dist/

npm run db:migrate   # prisma migrate dev (create + apply migration)
npm run db:studio    # open Prisma Studio GUI

npm run test         # jest unit tests
npm run test:e2e     # jest e2e tests (test/jest-e2e.json)
npm run test:cov     # coverage report

npm run lint         # eslint --fix
npm run format       # prettier --write
```

> **Always run `docker compose up -d` first** to start PostgreSQL and Redis before `npm run start:dev`.

## Environment Variables

Copy `.env.example` to `.env` before starting.

| Variable | Purpose | Example |
|----------|---------|---------|
| `PORT` | HTTP server port | `3000` |
| `DATABASE_URL` | Full PostgreSQL connection string | `postgresql://root:1234@localhost:5432/senappen?schema=public` |
| `POSTGRES_USER` | docker-compose DB user | `root` |
| `POSTGRES_PASSWORD` | docker-compose DB password | `1234` |
| `POSTGRES_DB` | docker-compose DB name | `senappen` |
| `POSTGRES_PORT` | docker-compose host port | `5432` |
| `REDIS_HOST` | Redis host (fallback) | `localhost` |
| `REDIS_PORT` | Redis port (fallback) | `6379` |
| `REDIS_URL` | Full Redis URL (takes priority) | `redis://localhost:6379` |
| `WORKER_CONCURRENCY` | BullMQ worker concurrency | `5` |
| `UPLOAD_DIR` | Directory for uploaded video files | `./tmp/videos` |

## Architecture

### Module structure
```
AppModule
├── ConfigModule (global)        — @nestjs/config, reads .env
├── PrismaModule (global)        — exposes PrismaService everywhere
└── (feature modules — TBD)
```

### PrismaService — driver-adapter pattern
`PrismaService` uses `@prisma/adapter-pg` (the Prisma driver adapter) instead of the legacy `datasource url` field in `schema.prisma`. **Do not** add a `url` to the `datasource` block in `prisma/schema.prisma` — the connection string is injected at runtime via `DATABASE_URL`.

```typescript
// CORRECT — already implemented in src/database/prisma.service.ts
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
super({ adapter });

// WRONG — do not add this to schema.prisma
datasource db {
  url = env("DATABASE_URL")  // ❌ not needed with driver adapter
}
```

`prisma.config.ts` defines the CLI datasource for `prisma migrate` commands (separate from runtime).

### BullMQ worker
`src/worker/queue.ts` exports `createRedisConnection()` — a factory for BullMQ-compatible IORedis instances. The worker entry point (`src/worker/worker.bootstrap.ts`) does not yet exist. When creating it, use `createRedisConnection()` as the IORedis provider for all `Queue` and `Worker` instances.

### Swagger
OpenAPI docs are auto-generated at `GET /docs`. When adding new endpoints:
- Decorate controllers with `@ApiTags('module-name')`
- Decorate each route with `@ApiOperation({ summary: '...' })`
- Decorate response shapes with `@ApiOkResponse`, `@ApiCreatedResponse`, etc.
- Decorate all DTO properties with `@ApiProperty()`

## Conventions & Patterns

### Module generation
Use the NestJS CLI to scaffold modules:
```sh
nest g module    <name>
nest g controller <name> --no-spec   # add --no-spec only if manual tests preferred
nest g service   <name>
```

### DTOs
All HTTP request/response bodies must be typed as DTO classes:
- Use `class-validator` decorators (`@IsString()`, `@IsEnum()`, etc.) — the global `ValidationPipe` enforces them automatically.
- Use `@ApiProperty()` on every field for Swagger visibility.
- For internal/service-layer validation, prefer `zod` schemas.

```typescript
// Example pattern
import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRecordDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  visitorName!: string;        // ← always use ! on required properties

  @ApiProperty({ enum: Object.values(VisitorType as Record<string, string>) })  // ← cast required; see note below
  @IsEnum(VisitorType)
  visitorType!: VisitorType;   // ← DTOs have no constructor; ValidationPipe fills them
}
```

> **Why `Object.values(Enum as Record<string, string>)`?** Prisma 7 generates its client with `// @ts-nocheck`. Passing the enum const directly to `@ApiProperty` causes *unsafe assignment*, and passing it to `Object.values()` without a cast causes *unsafe argument of an error typed value*. The two-step fix: cast the const to `Record<string, string>` first, then call `Object.values()`. `@IsEnum(MyEnum)` is unaffected — class-validator handles it at runtime, not via type resolution.
```

### Prisma — adding models
1. Define the model in `prisma/schema.prisma`
2. Run `npm run db:migrate -- --name <description>` to create and apply the migration
3. The `postinstall` hook runs `prisma generate` automatically; run it manually with `npx prisma generate` when needed
4. Import from the correct generated subpath — **not** from `@prisma/client`:
  - Enums → `import { AnalysisStatus } from '@/generated/prisma/enums'`
  - Prisma namespace types (`Prisma.WhereInput`, `Prisma.QueryMode`, etc.) → `import { Prisma } from '@/generated/prisma/client'`
  - PrismaClient class → `import { PrismaClient } from '@/generated/prisma/client'` (already done in `prisma.service.ts`)

### Shared vocabulary with the frontend
These values must stay identical across both projects:

| Concept | Value |
|---------|-------|
| `AnalysisStatus` values | `uploaded`, `processing_ai`, `clean`, `flagged_ai`, `under_review`, `confirmed_human`, `rejected_human`, `approved`, `rejected_supervisor` |
| Role values | `uploader`, `analyst`, `supervisor`, `admin` |
| `RetentionStatus` values | `retention_standard`, `retention_extended`, `permanent_retention`, `archived` |

`VisitorType` enum values are API-internal (`ATENDIMENTO_JURIDICO`, `VISITA_SOCIAL_PRESENCIAL`, `VISITA_SOCIAL_VIRTUAL`). Map them to Portuguese display labels in the application layer — do not expose the internal enum names to the frontend.

### Path alias
Use `@/` for all internal imports:
```typescript
import { PrismaService } from '@/database/prisma.service';
```

## Current State / Roadmap
- **Prisma schema**: `User`, `Record`, `AuditLog` models defined with full enums (`AnalysisStatus`, `UserRole`, `RetentionStatus`, `VisitorType`, `AnalystDecision`). Migration `20260307091807_init_user_record_auditlog` has been applied.
- **Implemented modules**: `RecordsModule` (list, get, create, status transition) and `UsersModule` (list, get, create, update) — both fully wired with Prisma, DTOs, and Swagger decorators.
- **Global infra**: `HttpExceptionFilter` (standardized error shape) and `ResponseInterceptor` (`{ data, meta }` envelope) registered in `main.ts`.
- **Worker pipeline**: `queue.ts` factory is ready; `worker.bootstrap.ts` entry point not yet created.
- **File uploads**: `@types/multer` is installed; Azure Blob Storage upload endpoint not yet implemented.
- **Azure integrations**: Azure Blob Storage and Azure AI Speech SDKs not yet installed — add when building the upload and transcription workers.
- **Auth**: no authentication layer yet — all endpoints are unprotected. JWT guard must be added before any production deployment. Controllers have `// TODO: extract actorId from JWT` markers.
- **Actor ID**: hardcoded as `'system'` in controllers until auth is in place.
- **Actor ID**: hardcoded as `'system'` in controllers until auth is in place.
