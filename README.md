# Banjara Backend API

Production-oriented REST + Socket.IO backend for the Banjara travel marketplace (transport + hotels).

## Tech stack

- Node.js + Express + TypeScript
- MongoDB + Mongoose
- JWT access/refresh tokens + bcrypt
- Zod validation
- Helmet, CORS, rate limiting, mongo sanitize
- Socket.IO (chat + live trip scaffolding)
- Supabase Storage for image uploads (credentials optional)

## Setup

```bash
cd banjara-backend
cp .env.example .env
npm install
```

Generate the two JWT secrets (must be >= 32 chars and different from each other):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Ensure MongoDB is running locally (or set `MONGODB_URI`).

```bash
npm run seed
npm run dev
```

API: `http://localhost:5000/api`  
Health: `GET /api/health`

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Start API with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run start` | Run compiled server |
| `npm run seed` | Seed demo users/providers/trips/hotels |
| `npm run typecheck` / `npm run lint` | TypeScript checks |

## Seed accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@banjara.com` | `demo1234` |
| Customer | `ayesha.khan@email.com` | `demo1234` |
| Transport provider | `provider@hunzatravel.com` | `demo1234` |
| Hotel provider | `stay@karimabadresort.com` | `demo1234` |

## Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

Send: `Authorization: Bearer <accessToken>`

## Roles

- `customer` — book transport/hotels, reviews, favorites
- `provider` — manage vehicles/trips/hotels/rooms after **admin approval** (`verificationStatus=pending` by default)
- `admin` — approve providers, dashboard stats

## Booking flow (transport)

1. Search trips `GET /api/trips/search`
2. Create booking `POST /api/bookings` with seats
3. Mock payment verifies
4. Seats reserved → booked
5. Ticket `GET /api/bookings/:id/ticket`

Hotel bookings use room availability locking across date ranges.

## Frontend connection

In the Expo app:

```
EXPO_PUBLIC_API_URL=http://localhost:5000/api
```

Use Android emulator host `http://10.0.2.2:5000/api` when needed.
On a physical device, use your PC LAN IP (e.g. `http://192.168.1.100:5000/api`).

### CORS

Configure allowed browser origins:

```
CLIENT_URL=http://localhost:8081
CLIENT_ORIGINS=http://localhost:19006,http://127.0.0.1:8081
```

Native apps typically send no `Origin` header and are allowed. Do not set a permanent `origin: "*"`.

### Provider dashboard

- `GET /api/providers/dashboard`
- `GET /api/providers/earnings`
- `GET /api/providers/bookings`
- `PUT /api/providers/bookings/:id/status` (`confirmed` | `cancelled` | `completed` | `rejected`)

## Socket.IO events

- `joinConversation`, `sendMessage`, `receiveMessage`, `typing`, `stopTyping`, `messageRead`
- `joinTrip`, `driverLocationUpdate`, `tripStatusUpdate`, `leaveTrip`

## Deployment notes

1. Set strong JWT secrets (>= 32 chars, distinct) and production `MONGODB_URI`. The
   process exits on startup if production env validation fails.
2. Prefer MongoDB replica set for multi-document transactions
3. Put API behind HTTPS
4. Configure Supabase Storage and a real payment gateway when ready
5. Wire Expo push notifications via `EXPO_NOTIFICATION_KEY`
