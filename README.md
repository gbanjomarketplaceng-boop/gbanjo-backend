# Gbanjo backend

NestJS 11 · Prisma 7 (PostgreSQL via the `pg` driver adapter) · Redis (ioredis) · BullMQ.

Modules so far: **authentication** and **users**. See [docs/auth.md](docs/auth.md) for flows, endpoints and error codes, and the live API docs at `http://localhost:4000/api/docs`.

## Run it

You need **Node 20+**, **PostgreSQL** and **Redis** running on your machine.

### 1. PostgreSQL

Install it from https://www.postgresql.org/download/windows/ (keep the default port 5432).
Then open **SQL Shell (psql)** from the Start menu, log in as `postgres`, and run:

```sql
CREATE USER gbanjo WITH PASSWORD 'gbanjo' CREATEDB;
CREATE DATABASE gbanjo OWNER gbanjo;
```

(`CREATEDB` lets `prisma migrate dev` create its temporary shadow database.)

### 2. Redis

Redis has no official Windows build. Pick one:

- **Memurai** (https://www.memurai.com/get-memurai) — a Redis-compatible Windows service. Install it and it runs on port 6379.
- **WSL** — in an Ubuntu terminal: `sudo apt install redis-server`, then `sudo service redis-server start`.

Check it with `redis-cli ping` (or `memurai-cli ping`) → `PONG`.

### 3. The API

```bash
cp .env.example .env      # skip if .env already exists; change the values if your setup differs
npm install               # also runs `prisma generate`
npm run prisma:deploy     # creates the tables
npm run start:dev
```

In `.env`, set `JWT_ACCESS_SECRET` to a long random string:
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
With `OTP_DEV_CODE=1234` every SMS code is `1234` in development; codes are also printed in the API log.

Check it: `GET http://localhost:4000/api/health` → `{"status":"ok","database":"up","redis":"up"}`
(returns 503 if either is down).

## What's wired up

| Piece | Where | How to use it |
| --- | --- | --- |
| Env validation (zod) | `src/config/env.validation.ts` | App won't start with missing/invalid vars. Add new vars to the schema. |
| Prisma | `prisma/schema.prisma`, `prisma.config.ts`, `src/prisma/` | Add models, run `npm run prisma:migrate -- --name init`, inject `PrismaService`. |
| Redis client | `src/redis/` | `constructor(@Inject(REDIS) private redis: Redis)` |
| BullMQ | `src/queue/queue.module.ts` | In a feature module: `BullModule.registerQueue({ name: "emails" })`, then a `@Processor("emails")` class extending `WorkerHost`. |
| Health check | `src/modules/health/health.controller.ts` | `GET /api/health` |
| Auth | `src/modules/auth/` | Global JWT guard — mark open routes with `@Public()`, read the user with `@CurrentUser()` |
| Errors | `src/common/filters/all-exceptions.filter.ts` | Throw `AppException(status, "CODE", "message", details?)` |
| Rate limits | `ThrottlerModule` (Redis) in `app.module.ts` | `@Throttle({ default: { limit, ttl } })` per route |
| API docs | `src/config/swagger.ts` | `/api/docs`; annotate DTOs with `@ApiProperty` |

The generated Prisma client goes to `src/generated/prisma` (git-ignored) — import it from
`../generated/prisma/client`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run start:dev` | Run with reload |
| `npm run build` / `npm run start:prod` | Compile to `dist/` and run it |
| `npm run prisma:migrate` | Create + apply a migration (development) |
| `npm run prisma:deploy` | Apply existing migrations (fresh database, CI, production) |
| `npm test` / `npm run test:e2e` | Unit tests / auth flow tests (needs a `gbanjo_test` database) |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:studio` | Browse the database |
| `npm run lint` | ESLint |
