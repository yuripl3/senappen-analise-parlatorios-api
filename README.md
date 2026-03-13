# Análise de Parlatorios — API

REST API for the Brazilian prison visitor-recording analysis system. Handles video uploads, audio extraction, AI transcription (OpenAI Whisper), LLM-based conversation analysis (GPT-4o), and the analyst/supervisor review workflow.

Built with **NestJS 11**, **PostgreSQL 16** (via Prisma 7), **BullMQ/Redis** async processing pipeline, and **Azure Blob Storage** for file persistence.

The companion React frontend lives in `../senappen-analise-parlatorios/`.

---

## Prerequisites

| Tool | Version |
| ---- | ------- |
| Node.js | 20+ |
| Docker + Docker Compose | any recent |
| PostgreSQL | 16 (provided via Docker) |
| Redis | 7 (provided via Docker) |
| ffmpeg | any recent (required by the transcription worker for audio extraction) |

---

## Quick Start

```sh
# 1. Copy environment variables
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET (min 16 chars)

# 2. Start infrastructure (PostgreSQL + Redis)
docker compose up -d

# 3. Install dependencies
npm install

# 4. Create the database schema (first run)
npm run db:migrate

# 5. Start the dev server
npm run start:dev
```

The API will be available at **<http://localhost:3000>**.  
Swagger UI (OpenAPI docs) is available at **<http://localhost:3000/docs>**.

---

## Environment Variables

Copy `.env.example` to `.env` before starting.

| Variable | Required | Purpose | Default / Example |
| -------- | -------- | ------- | ----------------- |
| `DATABASE_URL` | **Yes** | Full PostgreSQL connection string | `postgresql://root:1234@localhost:5432/senappen?schema=public` |
| `JWT_SECRET` | **Yes** | JWT signing secret (min 16 chars) | — |
| `PORT` | No | HTTP server port | `3000` |
| `POSTGRES_USER` | **Yes** | PostgreSQL user (docker-compose only) | `root` |
| `POSTGRES_PASSWORD` | **Yes** | PostgreSQL password (docker-compose only) | `1234` |
| `POSTGRES_DB` | **Yes** | PostgreSQL database name (docker-compose only) | `senappen` |
| `POSTGRES_PORT` | No | Host port mapped to PostgreSQL container | `5432` |
| `REDIS_URL` | No | Full Redis URL — takes priority over host/port | `redis://localhost:6379` |
| `REDIS_HOST` | No | Redis host (fallback when `REDIS_URL` is unset) | `localhost` |
| `REDIS_PORT` | No | Redis port (fallback when `REDIS_URL` is unset) | `6379` |
| `WORKER_CONCURRENCY` | No | Number of concurrent BullMQ job processors (1–50) | `5` |
| `AZURE_STORAGE_CONNECTION_STRING` | No | Azure Blob connection string (falls back to local `storage/videos/`) | — |
| `AZURE_STORAGE_CONTAINER` | No | Azure Blob container name | `videos` |
| `OPENAI_API_KEY` | No | OpenAI API key for Whisper + GPT-4o | — |
| `USE_MOCK_DATA` | No | Return in-memory mock data instead of querying the database | `false` |
| `USE_MOCK_AI` | No | Skip real OpenAI calls, return mock transcription results | `false` |

> `DATABASE_URL` is read by both the application (`PrismaService`) and the Prisma CLI (`prisma.config.ts`) — keep both in sync.

---

## Available Scripts

| Script | Command | Description |
| ------ | ------- | ----------- |
| `start:dev` | `nest start --watch` | Hot-reload development server |
| `start:prod` | `node dist/main` | Run compiled production build |
| `build` | `nest build` | Compile TypeScript to `dist/` |
| `db:migrate` | `prisma migrate dev` | Create and apply a new database migration |
| `db:studio` | `prisma studio` | Open Prisma Studio (visual DB browser) |
| `test` | `jest` | Run unit tests |
| `test:e2e` | `jest --config ./test/jest-e2e.json` | Run end-to-end tests |
| `test:cov` | `jest --coverage` | Run tests with coverage report |
| `lint` | `eslint ... --fix` | Lint and auto-fix source files |
| `format` | `prettier --write` | Format source files |

---

## Architecture

### Module graph

```text
AppModule
├── ConfigModule (global)   — reads .env with Joi validation
├── PrismaModule (global)   — exposes PrismaService; injected anywhere without re-importing
├── AuthModule              — JWT login/refresh/logout, Passport strategy, guards, role decorators
├── RecordsModule           — CRUD, status transitions, upload, archive, bulk ops, streaming
├── UsersModule             — user management, global audit log
├── RetentionModule         — retention policy configuration
└── WorkerModule            — BullMQ queue + transcription processor (Whisper → GPT-4o pipeline)
```

### Authentication & Authorization

All endpoints (except `GET /health` and `POST /auth/login|refresh`) are protected by `JwtAuthGuard`. Role-based access is enforced via `@Roles()` decorator + `RolesGuard`. Tokens: access (8h), refresh (7d). Passwords are hashed with bcrypt (12 rounds).

### Database — Prisma driver-adapter pattern

This project uses `@prisma/adapter-pg` instead of the legacy connection-URL approach. The `datasource` block in `prisma/schema.prisma` does **not** contain a `url` — the connection string is injected at runtime via `DATABASE_URL`:

```typescript
// src/database/prisma.service.ts
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
super({ adapter });
```

`prisma.config.ts` provides the datasource URL specifically for CLI operations (`prisma migrate`, `prisma studio`).

Generated Prisma client lives in `src/generated/prisma/` — import from there, not from `@prisma/client`.

### Global middleware

- **`HttpExceptionFilter`** — catches all exceptions, returns `{ statusCode, error, message, path, timestamp }`
- **`ResponseInterceptor`** — wraps responses in `{ data: T }` envelope (paginated responses include `{ data, meta }`)
- **`ValidationPipe`** — `whitelist: true`, `transform: true`

## Infrastructure

### Azure Blob Storage

File storage uses **Azure Blob Storage** (`@azure/storage-blob`). The `StorageService` uploads files and generates time-limited SAS URLs for playback. If `AZURE_STORAGE_CONNECTION_STRING` is not configured, it falls back to local `storage/videos/` for development.

### AI Pipeline (BullMQ + Redis)

`src/worker/queue.ts` exports `createRedisConnection()`, a factory that returns a BullMQ-compatible IORedis instance. It prioritises `REDIS_URL` and falls back to `REDIS_HOST:REDIS_PORT`.

The transcription pipeline runs automatically after each upload:

```text
POST /records/upload  →  [file saved to Azure / local]  →  BullMQ queue
                                                                  ↓
                                                    Worker: extract mono MP3 via ffmpeg
                                                                  ↓
                                                    Worker: OpenAI Whisper transcription
                                                                  ↓
                                                    Worker: GPT-4o canonical analysis + flagging
                                                                  ↓
                                                    Record status: clean (score < 60) | flagged_ai (score >= 60)
```

Jobs retry up to 3 times with exponential backoff (5s base). Set `USE_MOCK_AI=true` to skip real OpenAI calls during development.

> **Future migration — Azure Service Bus**: the queue layer could be migrated from Redis/BullMQ to **Azure Service Bus** for a fully managed, zero-infra alternative. The trade-off is that local development requires the [Azure Service Bus emulator](https://learn.microsoft.com/en-us/azure/service-bus-messaging/overview-emulator) or a live Azure namespace instead of a simple Docker container.

### Record status machine

```text
uploaded → processing_ai → clean | flagged_ai
flagged_ai → under_review → confirmed_human | rejected_human
confirmed_human → approved | rejected_supervisor

Terminal states: clean, rejected_human, approved, rejected_supervisor
```

These status values are shared with the frontend (`AnalysisStatus` in `src/lib/types.ts`). Keep them in sync when adding new statuses. Transition validation is enforced by `src/common/helpers/status-transition.helper.ts`.

### Retention policy

A global `RetentionPolicy` record (id `"global"`) configures standard (default 30 days) and extended (default 90 days) retention periods. Records can also be set to permanent retention or archived.

| `RetentionStatus` | Description |
| ------------------- | ------------- |
| `retention_standard` | Standard retention (configurable days) |
| `retention_extended` | Extended retention (configurable days) |
| `permanent_retention` | Retained permanently |
| `archived` | Archived |

### API Documentation (Swagger)

Swagger UI is auto-generated from decorators at **<http://localhost:3000/docs>** with Bearer auth configured. Always annotate new endpoints with `@ApiTags`, `@ApiOperation`, `@ApiProperty` on DTOs, and the appropriate response decorators.

---

## Endpoints

### Health

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/health` | No | API status and database connectivity |

### Auth (`/auth`)

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/auth/login` | No | Authenticate, returns `{ access_token, refresh_token, user }` |
| `POST` | `/auth/refresh` | No | Exchange refresh token for new access + refresh tokens |
| `POST` | `/auth/logout` | JWT | Stateless logout (client discards tokens) |

### Records (`/records`) — All JWT-protected

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/records` | Paginated list with filters (`status`, `retentionStatus`, `visitorType`, `unit`, `uploadedById`, `from`, `to`, `page`, `limit`) |
| `GET` | `/records/:id` | Full record detail including audit log |
| `GET` | `/records/:id/stream` | Video streaming with Range support (local) or redirect (Azure SAS URL) |
| `GET` | `/records/:id/audit` | Audit log history for a specific record |
| `POST` | `/records` | Create a new record (JSON body, no file — status starts at `uploaded`) |
| `POST` | `/records/upload` | Multipart upload: video file + metadata (2 GB limit). Enqueues transcription job. |
| `POST` | `/records/bulk-action` | Bulk archive or restore multiple records |
| `PATCH` | `/records/:id/status` | Transition analysis status through the state machine |
| `PATCH` | `/records/:id/archive` | Archive a record |
| `PATCH` | `/records/:id/restore` | Restore an archived record |
| `PATCH` | `/records/:id/user-comments` | Update per-line user comments on transcription |

### Users (`/users`) — All JWT-protected + RolesGuard

| Method | Path | Roles | Description |
| ------ | ---- | ----- | ----------- |
| `GET` | `/users` | Any authenticated | List all users (passwordHash excluded) |
| `GET` | `/users/:id` | Any authenticated | Get user by ID |
| `GET` | `/users/audit-logs` | admin | Global audit log (paginated, searchable) |
| `POST` | `/users` | admin | Create user (bcrypt 12 rounds) |
| `PATCH` | `/users/:id` | Any authenticated | Update user (name, email, roles, active) |

### Retention (`/retention`) — All JWT-protected + RolesGuard

| Method | Path | Roles | Description |
| ------ | ---- | ----- | ----------- |
| `GET` | `/retention` | Any authenticated | Get current global retention policy |
| `PATCH` | `/retention` | admin | Update retention policy settings |
