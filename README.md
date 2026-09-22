# Banjara Backend API

Production-oriented REST + Socket.IO backend for the Banjara travel marketplace (transport + hotels).

## Tech stack

- Node.js (see `.nvmrc` / `engines`) + Express 5 + TypeScript
- MongoDB + Mongoose 9
- JWT access/refresh tokens + bcrypt
- Zod validation
- Helmet, CORS, rate limiting, mongo sanitize, pino structured logging
- Socket.IO (chat + live trip tracking)
- Supabase Storage for image uploads (credentials optional)

## Requirements

- **Node**: `>=22.12 <25` (`.nvmrc` pins `24`). Mongoose 9 requires Node >= 20.19; the
  Vitest 5 toolchain requires `^22.12` or `^24`, so the 22/24 line is the single
  supported runtime for build, test and production.
- **MongoDB**: a **replica set** is strongly recommended (see below).
- **Deployment**: use `npm ci` against the committed lockfile.

## Setup

```bash
npm ci
cp .env.example .env
```

Generate the two JWT secrets (must be >= 32 chars and different from each other):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or: openssl rand -hex 32
```

Then set `MONGODB_URI` and start:

```bash
npm run dev
```

API: `http://localhost:5000/api`
Liveness: `GET /api/health` (always 200 while the process is up)
Readiness: `GET /api/ready` (503 when MongoDB is disconnected)

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `development` / `production` / `test` |
| `MONGODB_URI` | yes | Must not be localhost in production |
| `JWT_ACCESS_SECRET` | yes | >= 32 chars, distinct |
| `JWT_REFRESH_SECRET` | yes | >= 32 chars, distinct |
| `CLIENT_URL` / `CLIENT_ORIGINS` | yes | CORS + Socket.IO origins |
| `PAYMENT_SECRET` | yes | Placeholder is rejected in production |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` | for uploads | Storage only |
| `EXPO_NOTIFICATION_KEY` | no | Push notifications (not wired) |
| `GEOCODER_USER_AGENT` | no | Nominatim/Photon User-Agent |
| `PLATFORM_FEE_RATE`, `TAX_RATE`, `SERVICE_FEE` | no | Pricing knobs |
| `ALLOW_DESTRUCTIVE_SEED` | no | Required (set to `yes`) to seed a non-local DB |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | bootstrap only | Used by `npm run bootstrap` |
| `LOG_LEVEL` | no | pino level; defaults to `info` in production |

In production the process **exits non-zero** if the environment fails validation
(short/placeholder/identical JWT secrets, mock payment secret, localhost Mongo/CLIENT_URL).

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Start API with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run start` | Run compiled server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Vitest against an in-memory replica set |
| `npm run seed:dev` | **Destructive** dev seed (admin only) |
| `npm run bootstrap` | Idempotent admin bootstrap from env (safe in production) |
| `npm run clear` | **Destructive** — removes all collections |

## First admin

`npm run bootstrap` creates an admin **only if none exists**, using `ADMIN_EMAIL` and
`ADMIN_PASSWORD`. It never prints the password. There is deliberately no
admin-creation HTTP endpoint.

## MongoDB replica set requirement

Several code paths assume realistic concurrency, and the test harness runs a
single-member replica set (`MongoMemoryReplSet`) because a standalone `mongod` cannot
run multi-document transactions. The booking flow currently uses **compensating
actions** rather than transactions (see below), so a standalone node will boot with a
prominent warning — but a replica set is recommended for production and is required if
the booking flow is ever made transactional (`TRANSACTIONS_REQUIRED` in
`src/config/database.ts`).

## Single-instance constraint

- HTTP rate limits use `express-rate-limit`'s default **in-memory** store, and Socket.IO
  presence + the per-sender message throttle are process-local. Running more than one
  instance multiplies the effective limits and breaks presence. **Deploy a single
  instance**, or swap in a shared store first. The limiter and presence code are
  structured so a store can be added without touching call sites.
- `app.set('trust proxy', 1)` is correct for a **single** reverse proxy. If the owner
  deploys behind Cloudflare *plus* a platform proxy, the hop count changes and per-IP
  limiting silently keys on the wrong address.

## Password reset delivery seam

Reset tokens are hashed, expire in 15 minutes, are single-use, and are throttled
per account. No delivery provider is wired: `src/services/notification/passwordResetDelivery.ts`
logs the token in non-production and **throws in production**, making the missing
provider a loud failure rather than a silent hole. Configure a provider there before
relying on password reset in production.

## Booking consistency

`createBooking` is not wrapped in a MongoDB transaction (production topology was
unconfirmed at remediation time). It uses compensating actions on each failure branch
and moves notifications off the critical path. Wrapping it in a transaction is
recommended once a replica set is guaranteed; set `TRANSACTIONS_REQUIRED = true` and
pass a session through every model call.

## Auth

- `POST /api/auth/register`, `/login`, `/refresh`, `/logout`, `/me`
- `POST /api/auth/forgot-password`, `/reset-password`

Send: `Authorization: Bearer <accessToken>`

## Roles

- `customer` — book transport/hotels, reviews, favorites
- `provider` — manage vehicles/trips/hotels/rooms after **admin approval**
  (`verificationStatus=pending` by default)
- `admin` — approve providers, dashboard stats

## Testing

```bash
npm test
```

Vitest runs against an in-memory single-member replica set (`mongodb-memory-server`).
The concurrency suites should be trusted only after repeated runs
(`npx vitest run <file> --repeats 20`).

## Frontend connection

```
EXPO_PUBLIC_API_URL=http://localhost:5000/api
```

Android emulator: `http://10.0.2.2:5000/api`. Physical device: use the PC LAN IP.

## Deployment notes

1. Set strong, distinct JWT secrets and a production `MONGODB_URI`; the process exits
   on invalid production env.
2. Use a MongoDB replica set.
3. Put the API behind HTTPS.
4. Configure Supabase Storage and a real payment gateway when ready.
5. Wire Expo push notifications via `EXPO_NOTIFICATION_KEY`.
6. Configure the password-reset delivery provider.
7. Deploy a single instance unless a shared rate-limit/presence store is added.
