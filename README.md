# Worklay

Worklay is a Node.js application using Vite, TanStack Router, Express, and PostgreSQL (through
[Kysely](https://kysely.dev)). The interface supports English and Estonian; use the flag menu in
the top navigation to switch languages.

## Run locally

You need Node.js and Docker Desktop (for the database).

```powershell
npm install
Copy-Item .env.example .env   # first time only; the DATABASE_URL in it matches npm run db:up
npm run db:up                 # starts PostgreSQL in Docker
npm run dev
```

Open `http://127.0.0.1:5173/`. The server applies any pending database migrations when it starts.
`npm run db:down` stops the database; its data is kept for next time.

## Database

All data lives in PostgreSQL. The schema is defined by migrations in `db/migrations/`
(`0001_initial.mjs`, …), applied in order and recorded in the `kysely_migration` table.

| Command | What it does |
|---|---|
| `npm run db:migrate` | apply pending migrations (also happens on server start) |
| `npm run db:migrate:down` | undo the most recent migration |

Migrations are written in plain SQL. To change the schema, add a new file such as
`db/migrations/0002_add_something.mjs` that lists its SQL statements and exports `up(db)` and
`down(db)`; copy the pattern from `0001_initial.mjs`. Each migration runs in a transaction. Never
edit a migration that has already run on the live site.

Set `MIGRATE_ON_START=false` to stop the server from migrating automatically.

## Production build

```powershell
npm run build
npm start
```

With Docker, `docker compose up -d --build` starts the app and its database; see [DEPLOY.md](DEPLOY.md).

## Sign in with Google (optional)

The "Continue with Google" button only appears when Google credentials are configured.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), set up the
   OAuth consent screen, then create an **OAuth client ID** of type **Web application**.
2. Add these **Authorized redirect URIs**:
   - `http://127.0.0.1:5173/api/auth/google/callback` for `npm run dev` and `npm start`
   - `https://your-domain/api/auth/google/callback` for production
3. Copy `.env.example` to `.env` and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   In production also set `PUBLIC_URL` (e.g. `https://your-domain`).
4. Restart the server.

New Google users go to their profile settings to add a city and area. If someone signs in with
Google using an email that already has a Worklay account, the Google account is linked to it.

## Card payments with Stripe Connect (optional)

When Stripe is configured, customers pay by card when they order a service or award a project.
Worklay holds the money until the customer approves the work, then sends the freelancer's share
(the price minus the 10% platform fee) to their Stripe account, and Stripe pays it out to their
bank. Without Stripe keys the site keeps the manual payout flow.

1. Create a Stripe account at https://dashboard.stripe.com/register and stay in **test mode**.
2. Enable **Connect** (Dashboard → Connect → Get started) and choose "platform or marketplace".
   Freelancer accounts are created with Accounts v2 (Express dashboard, Stripe covers losses).
3. Copy the **secret key** (`sk_test_…`) from https://dashboard.stripe.com/test/apikeys into
   `STRIPE_SECRET_KEY` in `.env`.
4. Webhooks keep orders up to date when the customer closes the browser before returning.
   Locally, install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and run:
   ```powershell
   stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,account.updated --forward-to 127.0.0.1:5173/api/payments/webhook --forward-connect-to 127.0.0.1:5173/api/payments/webhook
   ```
   Put the `whsec_…` secret it prints into `STRIPE_WEBHOOK_SECRET`. In production, add an
   endpoint `https://your-domain/api/payments/webhook` in the Stripe dashboard (events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, and the Connect event
   `account.updated`) and use its signing secret.
5. Restart the server. Test cards: `4242 4242 4242 4242`, any future date, any CVC.

Refunds and disputes are handled in the Stripe dashboard.

## Profile photos (Cloudflare R2, optional)

Users can upload a profile photo (JPG, PNG or WebP, up to 3 MB) under **Dashboard → Profile
settings**. Photos are stored in the R2 bucket `worklay` as `avatars/<user id>/<random>.<ext>`;
uploading a new photo or removing it deletes the old file. The server checks the file contents,
so other file types are refused even if renamed.

1. Cloudflare dashboard → **R2 Object Storage** → **Manage API tokens** → **Create API token**.
   Permission **Object Read & Write**, limited to the `worklay` bucket.
2. Put the values in `.env`: `R2_ACCOUNT_ID` (the long id in the bucket's S3 API address),
   `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
3. Restart the server. The upload button appears in Profile settings.

The bucket can stay private: the app serves photos at `/api/files/...` with long browser caching.
If you connect a custom domain to the bucket (bucket → Settings → Custom Domains), set
`R2_PUBLIC_URL` to it and photos are linked there directly instead.

## Local services: categories, onboarding and bookings

**Categories** live in the database (`wl_categories`, `wl_subcategories`, seeded by migration
`0004`). Each has a `service_type` (`REMOTE`, `ON_SITE`, `HYBRID`), `requires_verification`, the
`required_documents` for verification, and suggested `perks`. Home & Cleaning, Childcare & Family
and Driving & Transport require a government ID (Driving also a driver's licence).

**Onboarding** (`#/onboarding`): after signing up, freelancers set up their service profile in steps:
1. category, subcategories, speciality and, for on-site work, city, area, travel radius and areas covered
2. pricing type (hourly, package/session, per event), price, unit label and perks
3. weekly availability (time windows per day), booking slot length and same-day bookings
4. verification uploads, only for categories that require it

Everything is editable later from Profile settings.

**Verification**: documents (`wl_verification_documents`) are reviewed at `#/admin/verifications`.
Files are stored in the database only until they're approved or rejected, then deleted; the record
of the check stays. A freelancer is `verified` once the newest document of each required type is
approved.

**Bookings** (`wl_bookings`): clients pick a date, a free time and (for hourly work) a duration on
the freelancer's profile. Free times come from the weekly availability minus existing bookings
(`GET /api?r=slots&freelancer=…&date=…&duration=…`, logic in `scheduling.mjs`, Estonian local time).
Same-day bookings are only offered if the freelancer accepts them. A database exclusion constraint
makes double bookings impossible. With Stripe configured, the client pays when requesting; the
money is refunded if the freelancer declines or the booking is cancelled, and released to the
freelancer (minus the platform fee) when the client marks it completed. Freelancers confirm or
decline under **Dashboard → Bookings**; confirmed bookings can be cancelled by the client up to
24 hours before the start.
