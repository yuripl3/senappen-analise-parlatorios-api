# Copilot Instructions — Análise de Parlatorios API

## Project Overview
NestJS 11 REST API for the Brazilian prison visitor-recording analysis system ("parlatorios" = visiting rooms). Handles video uploads, audio extraction, AI transcription (OpenAI Whisper), LLM-based conversation analysis (GPT-4o), and the analyst/supervisor review workflow. A BullMQ/Redis job queue drives the async processing pipeline. File storage uses Azure Blob Storage with local fallback.

The companion React frontend lives in `../senappen-analise-parlatorios/`. Its Copilot instructions are in `senappen-analise-parlatorios/.github/copilot-instructions.md`.

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | NestJS 11 (Express adapter) |
| ORM | Prisma 7 (driver-adapter pattern — see below) |
| Database | PostgreSQL 16 |
| Queue | BullMQ 5 + Redis 7 via ioredis |
| File storage | Azure Blob Storage (`@azure/storage-blob`) with local fallback |
| AI transcription | OpenAI Whisper (`openai` SDK) |
| AI analysis | OpenAI GPT-4o (`openai` SDK) |
| Audio extraction | fluent-ffmpeg |
| Auth | Passport JWT + bcrypt |
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

| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| `DATABASE_URL` | **Yes** | Full PostgreSQL connection string | `postgresql://root:1234@localhost:5432/senappen?schema=public` |
| `JWT_SECRET` | **Yes** | JWT signing secret (min 16 chars) | — |
| `PORT` | No | HTTP server port | `3000` |
| `POSTGRES_USER` | **Yes** | docker-compose DB user | `root` |
| `POSTGRES_PASSWORD` | **Yes** | docker-compose DB password | `1234` |
| `POSTGRES_DB` | **Yes** | docker-compose DB name | `senappen` |
| `POSTGRES_PORT` | No | docker-compose host port | `5432` |
| `REDIS_HOST` | No | Redis host (fallback) | `localhost` |
| `REDIS_PORT` | No | Redis port (fallback) | `6379` |
| `REDIS_URL` | No | Full Redis URL (takes priority) | `redis://localhost:6379` |
| `WORKER_CONCURRENCY` | No | BullMQ worker concurrency (1–50) | `5` |
| `AZURE_STORAGE_CONNECTION_STRING` | No | Azure Blob conn string (falls back to local) | — |
| `AZURE_STORAGE_CONTAINER` | No | Azure Blob container name | `videos` |
| `OPENAI_API_KEY` | No | OpenAI API key (Whisper + GPT-4o) | — |
| `USE_MOCK_DATA` | No | Return in-memory mock data | `false` |
| `USE_MOCK_AI` | No | Skip real OpenAI calls | `false` |

## Architecture

### Module structure
```
AppModule
├── ConfigModule (global)        — @nestjs/config, reads .env with Joi validation
├── PrismaModule (global)        — exposes PrismaService everywhere
├── AuthModule                   — JWT login/refresh/logout, Passport strategy, guards, role decorators
├── RecordsModule                — CRUD, status transitions, upload, archive, bulk ops, streaming
├── UsersModule                  — user management, global audit log
├── RetentionModule              — retention policy configuration
└── WorkerModule                 — BullMQ queue + transcription processor (Whisper → GPT-4o)
```

### Authentication & Authorization
All endpoints (except `GET /health` and `POST /auth/login|refresh`) are protected by `JwtAuthGuard`. Role-based access uses `@Roles()` decorator + `RolesGuard`. Tokens: access (8h), refresh (7d). Passwords hashed with bcrypt (12 rounds). `actorId` is extracted from the JWT payload via `@CurrentUser()` decorator.

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

### Global middleware (main.ts)
- **`HttpExceptionFilter`** — catches all exceptions, returns `{ statusCode, error, message, path, timestamp }`
- **`ResponseInterceptor`** — wraps responses in `{ data: T }` envelope (paginated responses include `{ data, meta }`)
- **`ValidationPipe`** — `whitelist: true`, `transform: true`
- **CORS** — enabled (no origin restrictions)
- **Swagger** — at `/docs` with Bearer auth configured

### BullMQ worker pipeline
The `WorkerModule` contains the full transcription pipeline:

| Component | File | Role |
|-----------|------|------|
| Queue factory | `src/worker/queue.ts` | IORedis factory, queue name, job data types |
| Queue service | `src/worker/queue.service.ts` | Enqueues transcription jobs (3 retries, exponential backoff) |
| Processor | `src/worker/transcription.processor.ts` | Consumes queue: extract audio → Whisper → GPT-4o → update record |
| AI service | `src/worker/ai.service.ts` | Wraps OpenAI SDK (Whisper + GPT-4o). Falls back to mock if `USE_MOCK_AI=true` |

### Storage
`StorageService` (`src/storage/`) uploads files to **Azure Blob Storage** and generates SAS URLs for playback. Falls back to local `storage/videos/` when `AZURE_STORAGE_CONNECTION_STRING` is not set.

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

### Record status state machine
```
uploaded → processing_ai → clean | flagged_ai
flagged_ai → under_review → confirmed_human | rejected_human
confirmed_human → approved | rejected_supervisor

Terminal states: clean, rejected_human, approved, rejected_supervisor
```
Transition validation is enforced by `src/common/helpers/status-transition.helper.ts` via `assertValidTransition()`.

### Path alias
Use `@/` for all internal imports:
```typescript
import { PrismaService } from '@/database/prisma.service';
```

## Current State
- **Prisma schema**: `User`, `Record`, `AuditLog`, `RetentionPolicy` models with full enums (`AnalysisStatus`, `UserRole`, `RetentionStatus`, `VisitorType`, `AnalystDecision`). Four migrations applied.
- **All feature modules implemented**: `AuthModule`, `RecordsModule`, `UsersModule`, `RetentionModule`, `WorkerModule`.
- **Auth**: JWT-based with Passport strategy, bcrypt passwords, `@Roles()` guard, `@CurrentUser()` decorator. Actor ID extracted from JWT.
- **Records**: Full CRUD, status transitions, multipart upload (2 GB), video streaming, archive/restore, bulk operations, per-line user comments on transcriptions.
- **Worker pipeline**: Complete — BullMQ queue → ffmpeg audio extraction → OpenAI Whisper transcription → GPT-4o analysis → status update. Mock AI fallback available.
- **Storage**: Azure Blob Storage with SAS URL generation, local fallback for development.
- **Global infra**: `HttpExceptionFilter`, `ResponseInterceptor` (`{ data, meta }` envelope), `ValidationPipe`, Swagger at `/docs` with Bearer auth.
- **Mock data**: `src/mock/mock-data.ts` provides development data when `USE_MOCK_DATA=true`.
