# Banjara Backend API

The server behind Banjara's Expo mobile app and Next.js admin dashboard. It handles
accounts, provider registration, transport, hotels, tour packages, guides, bookings,
payments, image storage, messages and notifications.

This guide describes the implementation in this repository. A feature appearing in
the app does not necessarily mean an external service is connected: for example,
Easypaisa currently uses manual transfer verification, not the Easypaisa gateway API.

For diagrams covering the mobile app, customer website, admin, backend, storage and
their end-to-end flows, read the **[App Architecture](../ARCHITECTURE.md)**.

## Start here

- [How the backend works](#how-the-backend-works)
- [What happens when you start it](#what-happens-when-you-start-it)
- [Where to find the code](#where-to-find-the-code)
- [How the main features work](#how-the-main-features-work)
- [Database records and relationships](#database-records-and-relationships)
- [API areas](#api-areas)
- [Setup](#setup) and [environment variables](#environment-variables)
- [Local MongoDB and tests](#testing)
- [Connecting the phone](#frontend-connection)
- [Troubleshooting](#troubleshooting)
- [Deployment notes](#deployment-notes)

## How the backend works

The **mobile app** displays screens and sends requests. The **admin dashboard** sends
requests to the same backend. The backend validates those requests, checks who is
allowed to perform the action, applies business rules, and reads or writes records.

There are three separate kinds of communication:

1. **HTTP REST API:** ordinary operations such as login, searching trips, saving a
   vehicle, making a booking and submitting payment proof. Routes start with `/api`.
2. **Socket.IO:** live chat, typing/read events, notifications and trip-location
   updates. It uses the same HTTP server and port, with its own socket handshake.
3. **External services:** the backend sends image files to Supabase Storage and can
   call geocoding, OCR and Expo push services where configured.

**MongoDB stores the application records. Supabase Storage stores uploaded files.**
This backend uses its own MongoDB-backed accounts and JWT authentication; it does
not use Supabase Auth or Supabase Postgres as its application database. MongoDB
Compass is a viewer/editor for MongoDB, not the process that starts the database.

### Example: the customer makes a booking

The request moves through these layers:

```text
Expo app: POST /api/bookings + Authorization header + booking details
  -> src/app.ts: common middleware and /api/bookings route mount
  -> src/routes/booking.routes.ts: authentication, customer role, input validation
  -> src/controllers/booking.controller.ts: calls the service, formats the response
  -> src/services/booking.service.ts: checks inventory and calculates the price
  -> src/models/: saves Booking and Payment, updates seats or room availability
  -> JSON response: app displays the saved booking and next payment step
```

The app does not directly write MongoDB records. Hiding a button in the app is also
not an authorization check: backend middleware and services decide what is allowed.

Before the feature handler, Express applies security headers, the configured CORS
policy, body parsing, payload sanitization, request logging and a global rate limit.
Routes can add their own authentication, role checks, Zod validation and upload or
login limits. The JSON body limit is 2 MB; multipart images have separate limits.

### Response format

Successful responses normally contain `success`, `message` and `data`:

```json
{
  "success": true,
  "message": "Banjara API is ready",
  "data": { "database": "connected" }
}
```

Errors normally contain `success: false`, `message` and `errors`. Zod validation
errors include field paths so the app can explain what needs correcting. Common
status codes are `401` for missing/expired authentication, `403` for denied access,
`404` for missing resources, `409` for conflicts and `422` for invalid input. Some
ownership checks intentionally return `404` to avoid exposing another user's record.
An unknown API path returns `404`; unexpected errors are logged and return `500`.
Requests reaching the request logger receive an `x-request-id` for tracing.

## What happens when you start it

1. `npm run dev` first runs the `predev` script. On Windows, it starts/reuses the
   managed local MongoDB only when the development URI matches the local
   `banjara-test` replica-set configuration described below. Atlas and other URIs
   skip this automatic startup.
2. `src/config/env.ts` loads `.env`, parses settings and applies production checks.
3. `src/server.ts` connects to MongoDB through `src/config/database.ts`. The
   database check also determines whether transactions are available.
4. `createApp()` installs the Express middleware and API routes. The server attaches
   Socket.IO and listens on `0.0.0.0`, using port `5000` by default.
5. After listening, the server starts background jobs unless disabled or in tests.

On `SIGINT`/`SIGTERM`, shutdown stops recurring jobs, closes HTTP/socket connections
and disconnects MongoDB. There is a 10-second forced-exit timeout. Stopping the API
does not delete saved records and does not automatically stop the separate local
MongoDB process.

## Where to find the code

- [`src/server.ts`](src/server.ts): starts and shuts down the running server.
- [`src/app.ts`](src/app.ts): shared middleware, health checks and route mounts.
- [`src/config/`](src/config/): environment, MongoDB and Supabase clients.
- [`src/routes/`](src/routes/): URL paths, HTTP methods and per-route middleware.
- [`src/controllers/`](src/controllers/): reads request values, calls services and
  sends responses. Start here after identifying a route.
- [`src/validators/`](src/validators/): Zod schemas for accepted input fields.
- [`src/services/`](src/services/): business rules, ownership checks, database
  operations and external-service calls. Most feature behavior lives here.
- [`src/models/`](src/models/): Mongoose document schemas, relationships and indexes.
- [`src/middleware/`](src/middleware/): JWT authentication, roles, validation,
  upload parsing, rate limits and error responses.
- [`src/types/`](src/types/): shared TypeScript shapes and status names.
- [`src/utils/`](src/utils/): tokens, pricing-related helpers, transaction wrapper,
  booking numbers, QR data, logging, image checks and CNIC text processing.
- [`src/sockets/socket.ts`](src/sockets/socket.ts): authenticated real-time events.
- [`src/jobs/scheduler.ts`](src/jobs/scheduler.ts): recurring maintenance work.
- [`src/seed/`](src/seed/): admin bootstrap and destructive development utilities.
- [`scripts/`](scripts/): local MongoDB startup, diagnostics and storage migration.
- [`test/`](test/): automated tests; configuration is
  [`vitest.config.mts`](vitest.config.mts).

For example, to understand payment confirmation, open `payment.routes.ts`, then
`payment.controller.ts`, then `payment.service.ts`, and finally the `Payment` and
`Booking` models. Follow the same naming pattern for most other features.

## How the main features work

### Accounts and login

[`auth.service.ts`](src/services/auth.service.ts) hashes passwords with bcrypt,
checks login credentials and issues access/refresh JWTs. Default lifetimes are
15 minutes and 7 days respectively. The current refresh token is stored as a hash;
refreshing replaces that stored hash, and logout removes it. Logout does not by
itself revoke an already-issued access JWT before its expiry.

Protected HTTP requests send `Authorization: Bearer <accessToken>`. Authentication
checks the token and loads the current active user from MongoDB. A provider's
`providerId` is resolved from their profile. A **User ID and ProviderProfile ID are
different identifiers**; they must not be used interchangeably.

Password reset uses hashed, expiring, single-use codes. The production delivery
integration still needs configuration; see [Password reset delivery seam](#password-reset-delivery-seam).

### Provider signup and transportation progress

[`provider.service.ts`](src/services/provider.service.ts) manages the business
profile. [`transportOnboarding.service.ts`](src/services/transportOnboarding.service.ts)
calculates the next required transportation step from saved records:

```text
business -> location -> transport -> vehicle -> verification -> review -> submitted
```

The server checks business fields, a confirmed valid map location, transport details
and pricing, the completed primary vehicle, and identity-verification results.
Checkpoint requests validate prerequisite steps and save progress transactionally.
Final submission sets `submittedAt` only when the required data is complete.

`GET /api/providers/me` returns `onboardingProgress`, including `nextStep`,
`completedSteps`, `vehicleId` and submission status. The app uses this to resume
onboarding after a reload. Only data successfully saved to the backend is covered
by this progress calculation; unsent typing remains the frontend draft's concern.
Submitting an application and admin approval are separate events.

CNIC endpoints under `/api/verification` process multipart images. OCR uses
Tesseract locally or the configured HTTP OCR provider; `auto` chooses HTTP when an
OCR key exists. The verification service compares extracted fields with submitted
details and saves the result. This is image/text matching, not an implemented
NADRA database lookup.

### Transport, hotels, tours and guides

- **Transport:** a provider owns vehicles, routes, pickup points and trips. Trips
  have inventory, times and prices and reference a vehicle. Creating a trip requires
  an approved, active vehicle. See `vehicle.service.ts`, `trip.service.ts` and
  `tripSeat.service.ts`.
- **Hotels:** a provider owns hotels and rooms. `RoomAvailability` stores dated
  inventory/rates. Hotel booking reserves inventory across the stay dates; provider
  endpoints also handle check-in/check-out. See `hotel.service.ts`,
  `room.service.ts` and `availability.service.ts`.
- **Tour packages:** `TourItinerary` describes the package being booked. See
  `tourItinerary.service.ts` and the package branch in `booking.service.ts`.
- **Guides:** guide details/services and date/time/pricing information feed guide
  bookings. See `guide.service.ts` and the guide branch in `booking.service.ts`.
- **Locations:** `location.service.ts` provides place search, reverse geocoding,
  nearby businesses and saved business pins. GeoJSON coordinates use
  `[longitude, latitude]`; API/UI fields may instead be named latitude/longitude.

The client has an approval-dependent provider experience, but do not assume every
provider API is protected by a global approval gate. `requireRole('provider')`
checks the account role. `requireApprovedProvider` exists but is not attached to
routes currently; specific services apply their own status checks.

### Bookings, inventory and payments

[`booking.service.ts`](src/services/booking.service.ts) supports `transport`,
`hotel`, `package` and `guide` bookings. It derives prices from the relevant saved
service data, adds the configured tax/service fee, saves a booking and creates its
payment record. If creation fails after an inventory reservation, compensating
cleanup attempts to release that reservation and remove partial records.

The current transfer flow is:

```text
Booking saved as pending; transfer Payment starts unpaid
  -> customer selects a provider receiving account: payment_initiated
  -> customer transfers money outside Banjara and submits proof: proof_submitted
  -> provider/admin checks receipt of funds and confirms
  -> Payment.status = confirmed
  -> Booking.paymentStatus = paid; Booking.bookingStatus = confirmed
```

The receiving account must belong to the booking's provider. Proof includes private
receipt references, a transaction reference and the paid amount. Confirmation checks
the amount and active inventory hold. Duplicate transfer references are checked
within the provider/channel/receiving-account scope. A provider can report a problem,
which sets the payment to `rejected` and gives a bounded correction window.

**A Payment document's status and a Booking document's paymentStatus are separate
fields.** For example, successful confirmation stores `confirmed` on Payment and
`paid` on Booking. Do not treat every status label as interchangeable.

Payment initiation, confirmation, corrections, cancellation and expiry use database
transactions where implemented, keeping payment, booking and inventory updates
together. Transportation checkpoints also use transactions. Use a replica set for
complete local testing, even if browsing works against standalone MongoDB.

Bank transfer, Easypaisa, JazzCash and Raast currently require manual proof and
confirmation. There is **no live Easypaisa API integration or automatic gateway
verification** in this code. `PAYMENT_SECRET` alone does not enable one. Card and
generic gateway-wallet checkout are rejected. Cash/pay-at-hotel remain unpaid until
collection; a saved booking alone is not evidence that money was received.

The default transfer proof window is 30 minutes. Expiry jobs release eligible
stale holds; reopening instructions does not extend the original window. Refund
requests become `refund_pending`; the provider sends the refund outside Banjara
and records evidence through the refund-completion endpoint.

### Images and removal

The app uploads through authenticated `/api/uploads` endpoints rather than receiving
the server's privileged Supabase key. Multer holds incoming files in memory with a
5 MB per-file limit. Public image uploads validate actual image bytes, generate a
server-side filename and save under `<folder>/<userId>/<filename>`.

Vehicle, hotel, avatar and similar photos use the configured public images bucket.
Payment receipts/payment-chat images use a separate private bucket and stable
storage references. After checking payment access, the API signs temporary preview
URLs. The public bucket is unsuitable for confidential evidence.

Deleting a photo in the UI calls `DELETE /api/uploads`. The backend checks ownership
and saved references before deleting. A file still used by a saved record is retained
until the edit removes those references. Pending requests are persisted and retried;
see [Uploaded photo removal](#uploaded-photo-removal) for the details.

### Chat, trip tracking and notifications

Socket.IO authenticates using the access token in `handshake.auth.token` or a bearer
header. It joins a private `user:<id>` room. Conversation and trip joins check access;
clients cannot simply subscribe to another user's data by guessing a room name.

Important event names include `joinConversation`, `sendMessage`, `receiveMessage`,
`typing`, `messageRead`, `joinTrip`, `driverLocationUpdate` and `tripStatusUpdate`.
There are also compatibility aliases such as `join_conversation` and `new_message`.
Ordinary chat messages are persisted by the message service before broadcast.
Trip location/status socket updates are live broadcasts; they do not themselves
replace the REST/database operations that persist a trip's business state.

`notification.service.ts` saves in-app notifications, emits `notification:new` and
attempts Expo push delivery for registered device tokens according to preferences.
It already contains a push sender; actual delivery depends on device registration,
permissions and the running client environment. Saving a notification does not
guarantee that a phone displayed a push notification.

### Background jobs

The in-process scheduler expires stale payments, sends pending-booking reminders
and retries requested photo removals. Defaults are a first pass after about 5 seconds,
then a 60-second interval (minimum 15 seconds). Pending booking reminders default to
10 minutes. Removed-photo cleanup processes up to 25 queued items per tick.

Set `JOBS_ENABLED=false` to disable these jobs. While the backend is stopped, this
scheduler does not run; restarting it resumes processing eligible saved records.

## Database records and relationships

These are **Mongoose model names**; Compass collection names are generally the
lowercase plural versions, such as `providerprofiles` and `roomavailabilities`.

- `User`: account identity, role, password/refresh-token hashes and preferences.
- `ProviderProfile`: business information, services, location, transport details,
  identity results, approval and onboarding progress; linked by `userId`.
- `Vehicle`, `Route`, `PickupPoint`, `Trip`: transport inventory owned through
  `providerId`; trips reference vehicles and may reference routes/pickup points.
- `Hotel`, `Room`, `RoomAvailability`: hotel ownership, room types and daily inventory.
- `TourItinerary`, `ServiceCatalog`: package and service information.
- `Booking`: customer/provider relationship, service-specific booking snapshot,
  totals, booking/payment status and linked `paymentId`.
- `Payment`, `ProviderPaymentAccount`, `PaymentMessage`: payment history, provider
  receiving accounts and payment-specific conversations/evidence.
- `Message`: normal user-to-user chat, separate from payment chat.
- `Notification`, `DeviceToken`: saved notifications and push destinations.
- `Review`, `Favorite`, `SupportTicket`: feedback, saved items and support cases.
- `PasswordResetToken`, `Counter`, `AdminAuditLog`, `MediaDeletion`: reset codes,
  counters, administrative audit history and durable photo-removal requests.

Deleting one collection manually does not automatically clean up all related
records or Supabase objects. Use the application flows for ordinary changes.

## API areas

All prefixes below include `/api`. For each group's exact methods, validation and
access rules, use its file in [`src/routes/`](src/routes/).

- `/auth`, `/users`: registration, sessions and account/profile management.
- `/providers`: public profiles/catalog, registration, saved onboarding, business
  edits, provider dashboard, bookings and earnings.
- `/businesses`: place search, reverse geocoding, nearby results and business locations.
- `/vehicles`, `/trips`, `/routes`, `/pickup-points`: transportation management/search.
- `/hotels`, `/rooms`, `/availability`: accommodation search and inventory management.
- `/tour-itineraries`, `/services`, `/guides`: packages and service/guide information.
- `/bookings`: creating bookings, viewing owned bookings, cancellation and tickets.
- `/payments`: receiving accounts, initiation, proof, confirmation, issues, refunds
  and payment chat. Here `/:id` means the **payment ID**, not the booking ID.
- `/reviews`, `/favorites`: feedback and saved items.
- `/discover`: public Explore feed — one normalized card list per service with server-side sort/filter (see below).
- `/messages`, `/notifications`, `/support`: communication and support.
- `/verification`: provider CNIC extraction, matching and status.
- `/uploads`: authenticated single/multiple image upload and removal.
- `/admin`: administrative operations; see `admin.routes.ts` for its access checks.
- `/health`, `/ready`: process liveness and MongoDB connection readiness.

Useful requests when tracing a transportation booking:

```text
GET  /api/trips/search
GET  /api/providers/public/:id
POST /api/bookings
GET  /api/bookings/my-bookings
GET  /api/payments/:id
POST /api/payments/:id/initiate
POST /api/payments/:id/proof
POST /api/payments/:id/confirm
GET  /api/bookings/:id/ticket
```

These are request paths, not a sequence that bypasses the role or prerequisite checks.

### Discover (Explore feed)

`GET /api/discover` is public and returns the same card shape for every Explore service,
so the web and mobile apps stop duplicating sort/filter rules. Code:
[`src/discover/`](src/discover/) (contract and rules) and
[`discover.service.ts`](src/services/discover.service.ts).

| Query | Meaning |
|---|---|
| `service` | `transport` (default), `hotels`, `tours`, `guides`, `restaurants` |
| `q`, `city` | Text search and destination filter (matched literally, never as a regex) |
| `category` | Sub-type: vehicle class (`car`, `jeep`, `suv`, `van`, `mini_bus`, `bus`, `other`), residence (`hotel`, `guest_house`, `lodge`), guide `male`/`female`, or tour `trek`/`expedition`/`summit`. Unknown values are ignored |
| `order` | `recommended` (default), `price`, `rating`, `soonest` — only those the service offers |
| `only` | Comma-separated quick filters: `topRated`, `verified`, `freeCancel`, `breakfast` |
| `limit` | 1–300, default 40 |
| `view` | `list` (default) or `map`. `map` returns only listings that have a location, and adds `bounds` (`[[south, west], [north, east]]`) |
| `bbox` | Map viewport `west,south,east,north`. Only listings inside it are returned. Malformed values are ignored |

Every card carries `location: { lat, lng, address, approximate? }` (or `null`). Rides pin at the first
pickup point and add `route` (departure and destination) so a map can draw the journey. **Guides are
deliberately blurred** to a ~1 km grid, flagged `approximate: true`, with the address replaced by
"&lt;city&gt; (approximate area)" — a guide's saved location may be their home.

The response is `{ service, total, items[], options, applied }`. `options` lists the `sorts`, `toggles` and
`categories` (only those with listings) the service offers, so clients render chips from it
instead of hard-coding labels. Tours offer categories only; restaurants offer sorts and toggles only.
Unknown or unsupported `order`/`only` values are ignored and reported back in `applied`.
Each item carries `target: { type, id, providerId }`; clients build their own routes from it.
Transport returns one card per vehicle (lowest fare) for future, bookable trips only.

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
- **MongoDB**: a **replica set** is required for payment transitions (including local development).
- **Deployment**: use `npm ci` against the committed lockfile.

## Setup

```bash
npm ci
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.
Copy the example only for initial setup; do not overwrite an existing configured
`.env`. Keep `.env` and credentials out of version control.

Generate the two JWT secrets (must be >= 32 chars and different from each other):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or: openssl rand -hex 32
```

Replace the JWT placeholders with two independently generated secrets. For the
existing Windows local replica set, set:

```env
MONGODB_URI=mongodb://127.0.0.1:27018/banjara?replicaSet=banjara-test&directConnection=true
```

The checked-in `.env.example` still defaults to standalone port `27017`; change
that value for full booking/payment/onboarding testing. Alternatively use your
Atlas connection string. Then start:

```bash
npm run dev
```

API: `http://localhost:5000/api`
Liveness: `GET /api/health` (reports that Express is responding)
Readiness: `GET /api/ready` (503 when MongoDB is disconnected)

Readiness currently checks the MongoDB connection only; it does not certify
Supabase, OCR, push delivery or transaction capability. For a local read-only check:

```powershell
Invoke-RestMethod http://localhost:5000/api/health
Invoke-RestMethod http://localhost:5000/api/ready
```

Keep this terminal running while using the app. `Ctrl+C` stops the API; `npm run dev`
starts it again. Expo Metro on port 8081 is a separate process and does not start
this backend.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no | API and Socket.IO listen port; defaults to `5000` |
| `NODE_ENV` | default provided | `development` / `production` / `test`; defaults to development |
| `MONGODB_URI` | yes | Must not be localhost in production |
| `JWT_ACCESS_SECRET` | yes | >= 32 chars, distinct |
| `JWT_REFRESH_SECRET` | yes | >= 32 chars, distinct |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | no | Default `15m` access and `7d` refresh lifetimes |
| `CLIENT_URL` / `CLIENT_ORIGINS` | defaults provided | CORS + Socket.IO browser origins; set for your deployment |
| `PAYMENT_SECRET` | production | Mock default is rejected in production; does not enable a gateway |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` | for uploads | Storage only |
| `SUPABASE_PAYMENT_BUCKET` | for payment files | Private receipts bucket; default `banjara-payments-private` |
| `EXPO_NOTIFICATION_KEY` | no | Optional bearer token used by the existing Expo push sender |
| `GEOCODER_USER_AGENT` | no | Nominatim/Photon User-Agent |
| `PLATFORM_FEE_RATE`, `TAX_RATE`, `SERVICE_FEE` | no | Pricing knobs |
| `OCR_PROVIDER`, `OCR_API_KEY`, `OCR_API_URL` | no | CNIC OCR mode and optional HTTP provider settings |
| `JOBS_ENABLED`, `JOBS_INTERVAL_MS` | no | Enable maintenance and set its interval |
| `PENDING_BOOKING_REMINDER_MINUTES` | no | Age of pending bookings before reminders |
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
| `npm run clear` | **Destructive** — deletes documents from the model list in `src/seed/clear.ts` |
| `npm run check:runtime` | Checks the runtime via `scripts/check-runtime.ts` |
| `npm run db:local` | Starts/reuses the managed Windows MongoDB replica set |
| `npm run migrate:payment-files` | Dry-run legacy public-payment-file migration; `-- --apply` performs it |

`seed:dev` clears its listed records and creates a development admin; it is not
required for normal startup. Prefer `bootstrap` when you need a first admin without
clearing data. `clear` does not drop the database, cover every newer model, or erase
Supabase Storage. Review these scripts before using them; do not use them to repair
a connection error.

## First admin

`npm run bootstrap` creates an admin **only if none exists**, using `ADMIN_EMAIL` and
`ADMIN_PASSWORD`. It never prints the password. There is deliberately no
admin-creation HTTP endpoint.

## Customer-visible demo marketplace

The separate, **insert-only** demo seed prepares four providers in each category:
Transportation, Lodging, Tour Operators, Guides and Restaurants (20 provider
accounts total). It does not run the destructive `seed:dev` or `clear` scripts.

Preview the planned records without database/storage writes:

```bash
npm run seed:demo
```

Insert missing demo records and upload their public stock photos:

```bash
npm run seed:demo -- --apply
npm run verify:demo
```

The command is restricted to non-production, loopback MongoDB and requires a
replica set. It uses the configured public Supabase image bucket, checks public
image serving, and never changes bucket permissions or uses the payment bucket.
It is a backend data utility; Expo Go remains the mobile testing environment.

The initial catalog includes:

- 20 provider accounts and approved business profiles, with four providers in each
  category and locations across Hunza, Skardu, Gilgit and Islamabad.
- 8 approved vehicles, 4 routes, 8 boarding/drop-off points and 16 scheduled trips
  across today, tomorrow, three days ahead and seven days ahead. Shared seats,
  private vehicles and round trips are represented.
- 4 approved lodging properties, 8 room types and 60 days of dated availability
  per room type (480 initial daily inventory records).
- 8 published tour itineraries with day plans, prices, images and inclusions.
- 4 guide profiles with two offered services each, languages, seven-day weekly
  schedules and a 90-day availability window.
- 4 restaurants with menus, hours, images and two sample offers each.
- Clearly labelled dummy bank receiving accounts for exercising the existing
  manual-transfer screens. No real payment account or gateway is configured.

Generated emails/password and provider names are saved in
`DEMO-ACCOUNTS.local.md`; the credential file and `.local-demo/` directory are
ignored by Git. The applied-run summary is `.local-demo/report.json`, and API
verification writes `.local-demo/verification.json`. Keep these local credentials
out of published documentation.

All businesses, contact details, registration/insurance/identity information and
approvals are synthetic fixtures. Images are illustrative stock photographs,
including stock portraits, not genuine provider documents or property photography.
No customer reviews or completed financial transactions are invented. Never send
real money to the demo receiving accounts.

Re-running uses deterministic IDs and insert-only upserts. Existing accounts,
passwords, provider edits, booked seats and dated room inventory are preserved.
New run dates can add fresh trip/day inventory records; this does not reset guide
profile windows or other existing edits. An unrelated account ID/email collision
aborts the database transaction. Originals are fingerprinted around the load to
check that preexisting records remain unchanged.

The focused regression suite is:

```bash
npx vitest run test/demo-catalog.test.ts
```

It uses an isolated in-memory replica set, validates customer-visible catalogs and
all provider logins, creates test bookings for all four bookable service types,
and checks re-run preservation/collision protection. `verify:demo` checks the
applied local catalog, logs into/out of the demo providers, and checks public
profiles, trips, dated hotel-room results, packages and guide availability. It
does not create reservations in your app database.

## MongoDB replica set requirement

Payment confirmation, cancellation, rejection and expiry use MongoDB transactions.
Use MongoDB Atlas or a configured replica set. Production refuses to start against a
standalone node; development can start for browsing, but payment mutations return
503 until a replica set is available. Tests use an isolated in-memory replica set.

## Private payment receipts and manual refunds

Card and gateway-wallet checkout are disabled until a real gateway verifies funds.
Bank, Easypaisa, JazzCash and Raast transfers require customer proof and provider
confirmation. Cash/pay-at-hotel remains unpaid until collected.

New receipts and payment-chat images use a separate **private** Supabase bucket,
`SUPABASE_PAYMENT_BUCKET` (default `banjara-payments-private`). The service key must
be allowed to create/manage that bucket. Do not use the public images bucket here.
The API stores stable private references, checks upload ownership, and signs
15-minute preview URLs only after checking payment access. Deploy the backend and
mobile client together; older clients cannot submit public receipt URLs.

Existing public receipts require a one-time migration before launch:

```bash
npm run migrate:payment-files
npm run migrate:payment-files -- --apply
```

The first command is read-only. The second copies each file in the public bucket's
`payments/` folder into private storage, verifies its bytes, then removes the public
copy. Legacy database URLs are resolved to private copies without rewriting booking
history. Previously distributed/cached public URLs may require CDN cache purging;
deleting an origin object cannot recall files already downloaded.

Refund requests become `refund_pending`. BANJARA does not send money. Providers
return funds in their bank/wallet and use **Record refund evidence** to attach the
return transfer reference and private receipt. The customer sees the recorded refund
and can use payment chat if funds have not arrived.

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

`createBooking` uses compensating cleanup on creation failures. Later confirmation,
cancellation, payment correction and expiry share transactions across payment,
booking and inventory. An expired payment cannot restart its released hold.
Transaction references are unique per provider/receiving account; amount mismatches
must be resolved before confirmation. Notifications run after commit.

## Auth

- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password`, `/api/auth/reset-password`

Send: `Authorization: Bearer <accessToken>`

## Roles

- `customer` — book transport/hotels, reviews, favorites
- `provider` — business onboarding and service management; the approval state is
  separate from the role (`verificationStatus=pending` by default). Route/service
  checks vary; see the approval-gate explanation above.
- `admin` — approve providers, dashboard stats

## Testing

For the persistent Windows test database and API, run:

```powershell
npm run dev
```

When development `MONGODB_URI` points to the managed local `banjara-test` database,
the `predev` hook starts the installed MongoDB Community Server as a single-member
replica set bound to loopback on port **27018**, then starts the API. It reuses an
already-running instance and waits for a writable primary before starting the API.
Other database connections skip this automatic startup. `npm run dev:local` is an
alias for the same command.
Database files and logs stay in ignored `.local-mongodb/`. After a PC restart,
run this command again. `npm run db:local` starts just the database and also works
when it is already running.

In MongoDB Compass, connect with:

```text
mongodb://127.0.0.1:27018/banjara?replicaSet=banjara-test&directConnection=true
```

Use the same URI for `MONGODB_URI` in `.env`. The original standalone database on
port 27017 is a separate preserved copy; new application changes appear on 27018.
This loopback-only setup is for local testing. Production requires a secured
replica set or Atlas.

```bash
npm test
```

Vitest runs against an in-memory single-member replica set (`mongodb-memory-server`).
The concurrency suites should be trusted only after repeated runs
(`npx vitest run <file> --repeats 20`).

## Uploaded photo removal

Photo pickers remove uploaded files through authenticated `DELETE /api/uploads`
with `{ "reference": "<uploaded URL or private storageRef>" }`. The API accepts only
the signed-in user's paths in the configured Supabase project and buckets. Unused
uploads are deleted immediately. Referenced photos stay available until the edit
is saved and every saved reference is removed; submitted payment evidence stays
protected while its payment/history/chat references exist.

Pending removals persist in `mediadeletions` and retry through the background jobs
(`JOBS_ENABLED=true`, default). Storage failures are retried with backoff. Jobs
process at most 25 removals per tick and do not apply requests from another project.

`npx vitest run test/media-deletion.test.ts` checks ownership, retained references,
retries and the authenticated route using isolated MongoDB and mocked Storage.
`npx tsx scripts/verify-media-deletion.ts` additionally uploads and removes two real
temporary Supabase images using a disposable MongoDB instance; it leaves the app's
database untouched and cleans up only its own test objects.

## Frontend connection

For a client running on the backend PC:

```env
EXPO_PUBLIC_API_URL=http://localhost:5000/api
```

Android emulator: `http://10.0.2.2:5000/api`. Physical device: use the PC LAN IP.

For Expo Go on a phone, configure `Banjara/.env` with:

```env
EXPO_PUBLIC_API_URL=http://YOUR_PC_LAN_IP:5000/api
```

Replace `YOUR_PC_LAN_IP` with the PC's current Wi-Fi/Ethernet IPv4 address. Keep the
phone and PC on a reachable network and allow the backend through the appropriate
Windows firewall profile. Open `/api/health` at that LAN address in the phone's
browser to check connectivity. Reload Expo Go after changing the frontend env.
The backend's database URI remains the PC's MongoDB URI; do not replace it with the
phone's address. `0.0.0.0` is the listen address, not the URL to enter on the phone.

The browser-based admin also uses the API; add its browser origin to `CLIENT_URL`
or `CLIENT_ORIGINS` when needed. Neither the app nor admin should receive the
backend JWT signing secrets or Supabase privileged storage key.

## Troubleshooting

### `EADDRINUSE: address already in use ...:5000`

Another process is already listening on the API port, often another backend
terminal. Identify it before stopping anything:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5000 |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Inspect the reported process with `Get-Process -Id <OwningProcess>`. If it is your
existing Banjara backend, use that running instance or stop it with `Ctrl+C` in its
terminal before starting another. If you change `PORT`, update client API URLs too.

### `ECONNREFUSED 127.0.0.1:27018`

Nothing reachable is accepting MongoDB connections at that address. From this
backend directory, run `npm run db:local`, inspect `.local-mongodb/mongod.log` if it
fails, then run `npm run dev`. MongoDB Community Server must be installed; Compass
alone does not provide `mongod`. Use the replica-set URI in [Testing](#testing).

### `Payments require a MongoDB replica set`

The API reached MongoDB, but that database is standalone or the configured replica
set is not ready. Use the local `banjara-test` connection or Atlas. A working
Compass connection to port 27017 does not prove that port 27018 is running, and
opening Compass does not convert standalone MongoDB into a replica set.

### The phone cannot reach the API

Check that the backend terminal reports a successful start, then test the PC LAN
`/api/health` URL from the phone. Check the current LAN IP, Wi-Fi reachability,
firewall, port and frontend `EXPO_PUBLIC_API_URL`. A Metro QR code working does not
prove that the separate API on port 5000 is reachable.

### Image upload fails or photos do not load

Check the backend's configured Supabase project, server-only secret/service-role
key, exact bucket names and network reachability. Public photos use the public
bucket; payment files require the separate private bucket and an authorized signed
preview. An expired private preview URL must be refreshed through the API. Restart
the backend after changing server env. Inspect backend logs without sharing keys.

### Signup resumes at an earlier step, or payment confirmation fails

Inspect the returned `onboardingProgress` or payment error rather than forcing a
dashboard redirect or editing status flags in Compass. The saved primary vehicle,
transport details, identity checks, inventory hold or paid amount may not satisfy
the server's prerequisites. A successful photo upload alone does not save or
submit the entire registration form.

## Deployment notes

1. Set strong, distinct JWT secrets and a production `MONGODB_URI`; the process exits
   on invalid production env.
2. Use a MongoDB replica set.
3. Put the API behind HTTPS.
4. Configure Supabase Storage and a real payment gateway when ready.
5. Configure/test registered devices and the existing Expo push sender; supply
   `EXPO_NOTIFICATION_KEY` if your Expo push access setup requires it.
6. Configure the password-reset delivery provider.
7. Deploy a single instance unless a shared rate-limit/presence store is added.
