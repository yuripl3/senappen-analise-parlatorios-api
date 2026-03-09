# Análise de Parlatorios — API

REST API for the Brazilian prison visitor-recording analysis system. Handles video uploads, audio extraction, AI transcription, LLM-based conversation analysis, and the analyst/supervisor review workflow.

Built with **NestJS 11**, **PostgreSQL 16** (via Prisma 7), and a **BullMQ/Redis** async processing pipeline.

The companion React frontend lives in `../analise-parlatorios/`.

---

## Prerequisites

| Tool | Version |
| ---- | ------- |
| Node.js | 20+ |
| Docker + Docker Compose | any recent |
| PostgreSQL | 16 (provided via Docker) |
| Redis | 7 (provided via Docker) |

---

## Quick Start

```sh
# 1. Copy environment variables
cp .env.example .env
# Edit .env if you need non-default credentials

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
| `PORT` | No | HTTP server port | `3000` |
| `DATABASE_URL` | **Yes** | Full PostgreSQL connection string used by the app at runtime | `postgresql://root:1234@localhost:5432/senappen?schema=public` |
| `POSTGRES_USER` | **Yes** | PostgreSQL user (docker-compose only) | `root` |
| `POSTGRES_PASSWORD` | **Yes** | PostgreSQL password (docker-compose only) | `1234` |
| `POSTGRES_DB` | **Yes** | PostgreSQL database name (docker-compose only) | `senappen` |
| `POSTGRES_PORT` | No | Host port mapped to PostgreSQL container | `5432` |
| `REDIS_URL` | No | Full Redis URL — takes priority over host/port | `redis://localhost:6379` |
| `REDIS_HOST` | No | Redis host (fallback when `REDIS_URL` is unset) | `localhost` |
| `REDIS_PORT` | No | Redis port (fallback when `REDIS_URL` is unset) | `6379` |
| `WORKER_CONCURRENCY` | No | Number of concurrent BullMQ job processors | `5` |
| `UPLOAD_DIR` | No | Directory for storing uploaded video files | `./tmp/videos` |

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
├── ConfigModule (global)   — reads .env; all modules can inject ConfigService
├── PrismaModule (global)   — exposes PrismaService; injected anywhere without re-importing
└── Feature modules (TBD)   — records, uploads, workers, auth, …
```

### Database — Prisma driver-adapter pattern

This project uses `@prisma/adapter-pg` instead of the legacy connection-URL approach. The `datasource` block in `prisma/schema.prisma` does **not** contain a `url` — the connection string is injected at runtime via `DATABASE_URL`:

```typescript
// src/database/prisma.service.ts
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
super({ adapter });
```

`prisma.config.ts` provides the datasource URL specifically for CLI operations (`prisma migrate`, `prisma studio`).

Generated Prisma client lives in `src/generated/prisma/` — import from there, not from `@prisma/client`.

## Infrastructure

### Azure

This project uses Azure for file storage and AI services:

- **Azure Blob Storage** — stores uploaded video files (SDK: `@azure/storage-blob`, not yet installed)
- **Azure AI Speech** — audio transcription (SDK: `microsoft-cognitiveservices-speech-sdk`, not yet installed)
- **LLM / conversation analysis** — handled by a separate AI team microservice; this API integrates via HTTP

### Local queue (BullMQ + Redis)

`src/worker/queue.ts` exports `createRedisConnection()`, a factory that returns a BullMQ-compatible IORedis instance. It prioritises `REDIS_URL` and falls back to `REDIS_HOST:REDIS_PORT`.

Planned pipeline:

```text
POST /upload  →  [video file saved]  →  BullMQ queue
                                              ↓
                                    Worker: extract audio
                                              ↓
                                    Worker: AI transcription (Azure AI Speech)
                                              ↓
                                    Worker: LLM analysis (AI team microservice)
                                              ↓
                                    Record status: flagged_ai | clean
```

> **Future migration — Azure Service Bus**: since the rest of the infrastructure runs on Azure, the queue layer could be migrated from Redis/BullMQ to **Azure Service Bus** for a fully managed, zero-infra alternative. Azure Service Bus offers dead-letter queues, sessions, and topic/subscription fan-out natively, removing the Redis instance from production operations. The migration cost is low while no workers are built yet — worth considering before the worker pipeline is implemented. The trade-off is that local development requires the [Azure Service Bus emulator](https://learn.microsoft.com/en-us/azure/service-bus-messaging/overview-emulator) or a live Azure namespace instead of a simple Docker container.

### Record status machine

```text
uploaded → processing_ai → clean | flagged_ai
flagged_ai → under_review → confirmed_human | rejected_human
confirmed_human → approved | rejected_supervisor
```

These status values are shared with the frontend (`AnalysisStatus` in `src/lib/types.ts`). Keep them in sync when adding new statuses.

### API Documentation (Swagger)

Swagger UI is auto-generated from decorators at **<http://localhost:3000/docs>**. Always annotate new endpoints with `@ApiTags`, `@ApiOperation`, `@ApiProperty` on DTOs, and the appropriate response decorators.

---

## Current Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/health` | API status and database connectivity |
| `GET` | `/records` | Paginated list of records (supports filters: `status`, `unit`, `visitorType`, `from`, `to`, `page`, `limit`) |
| `GET` | `/records/:id` | Record detail with full audit log |
| `POST` | `/records` | Create a new record (status starts at `uploaded`) |
| `PATCH` | `/records/:id/status` | Transition record status through the state machine |
| `GET` | `/users` | List all users (passwordHash excluded) |
| `GET` | `/users/:id` | Get user by ID |
| `POST` | `/users` | Create a user |
| `PATCH` | `/users/:id` | Update user name, email, roles, or active status |

> All endpoints are currently **unprotected**. Authentication is on the roadmap.

---

## Roadmap

- [ ] Prisma schema — define `Record`, `User`, `AuditLog`, and related models
- [ ] Authentication — JWT or session-based auth
- [ ] `POST /upload` — video file ingestion + BullMQ job dispatch
- [ ] Worker entry point (`src/worker/worker.bootstrap.ts`) — BullMQ processors
- [ ] Records CRUD + status transition endpoints
- [ ] Analyst review endpoints (`FocusMode` workflow)
- [ ] Supervisor approval endpoints
- [ ] Admin endpoints (users, audit logs, retention policies)
