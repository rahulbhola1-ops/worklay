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

## Deployment

The code lives at [github.com/rahulbhola1-ops/worklay](https://github.com/rahulbhola1-ops/worklay).
Every push to `master` (including merged pull requests) runs the Deploy workflow in
`.github/workflows/deploy.yml`, which updates the server over SSH and rebuilds the container. It can
also be started by hand from the Actions tab ("Run workflow"). The workflow needs the `DEPLOY_*`
secrets set in the repository settings; until they are, it skips the deploy with a warning.

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

**When the work is done**: the freelancer clicks **Work is done** (project, order or booking). No
money moves until the client approves; approval sends the freelancer's share automatically.

- **Client silent for 7 days** (`APPROVAL_DAYS` in `terms.mjs`): the work counts as approved and the
  freelancer is paid. The client gets the deadline on the site and by email when the work is marked as
  done, and one reminder 2 days before. Only for card payments made under the Terms that say so
  (`wl_payments.auto_release`); older payments keep waiting for the client or an admin.
- **Report a problem**: stops the automatic payment. Clients must attach proof (photo, screenshot or
  PDF); both sides can add up to 5 files and see each other's. An admin decides at `/admin` within 7
  days (**Pay freelancer** or **Refund client**) and is reminded 2 days before; nothing is decided
  automatically. Proof is stored in `wl_payment_proofs` and deleted after 6 months once decided.

The payment job runs every 10 minutes: it makes the automatic payments, sends reminders and retries.
Transfers and refunds that were interrupted are retried after asking Stripe
whether they already went through. Card disputes (chargebacks) are handled in the Stripe dashboard.

## Terms of Service

The text is in `terms-page.js` (English, Estonian, Russian) and the version in `terms.mjs`. Change
`TERMS_VERSION` when the text changes in a way people must agree to: everyone is then asked to accept
it again before posting, ordering, booking, sending proposals or publishing a profile. The accepted
version and time are stored on the user. Company details come from `LEGAL` in `legal.js`.

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

## Welcome email (Brevo, optional)

New users get a welcome email right after they sign up (email/password or Google). Freelancers are
pointed to their service profile, clients to "Find freelancers". Emails go through Brevo's
transactional API ([mail.mjs](mail.mjs)):

1. In Brevo, verify the sender address or domain (Senders, domains & dedicated IPs).
2. Create an API key (SMTP & API → API keys).
3. Set `BREVO_API_KEY` and `MAIL_FROM_EMAIL` (and optionally `MAIL_FROM_NAME`) in `.env`.

Without them, emails are switched off and the server only logs what it would have sent. Sending
never blocks or breaks sign-up; failures are logged.

## Search engines, accessibility and security

**Page addresses.** Pages have real addresses (`/freelancers`, `/user/12`, `/freelancers?cat=tutoring`).
Old `/#/…` links still work. The app opens in-app links without reloading.

**Server-rendered HTML** ([seo.mjs](seo.mjs)). In production, the server answers every page address
with readable HTML inside `#root`, so crawlers and AI bots that don't run JavaScript still see the
content and links. Each page gets its own `<title>`, description, canonical link and Open Graph tags,
plus JSON-LD:

| Page | Structured data |
|---|---|
| Every public page | `WebSite` (with site search) and `Organization` |
| Freelancer profile (`/user/:id`) | `ProfilePage` with a `Person` |
| Blog post | `BlogPosting` |

Private pages (`/dashboard`, `/messages`, `/admin`, …), customer profiles and unknown addresses are
`noindex`. Unknown addresses return 404.

**Crawler files.** `/robots.txt` allows everything public and disallows `/api` and the private
sections. `/sitemap.xml` lists the main pages, category pages, finished freelancer profiles,
services and blog posts. Both use `PUBLIC_URL` for absolute addresses.

In development (`npm run dev`), Vite serves the pages, so there is no server-rendered HTML. To check
it locally, run `npm run build`, then `PORT=3012 node server.mjs`, and open `http://127.0.0.1:3012`.

**Accessibility (WCAG 2.1 AA).** The fixes are built into the code, with no overlay scripts:
- skip link, landmarks (`header`, `nav`, `main`, `footer`) and heading levels;
- every form label is tied to its control;
- dialogs keep focus inside, close with Escape and return focus to the opener;
- the language and account menus work with the arrow keys;
- icon-only links have names, focus rings are visible, and focus moves to the content on page change;
- text colours meet 4.5:1 contrast, and animations are reduced when the system asks for it.

**Security.** The server sends `Content-Security-Policy` (scripts only from this site), `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` on
HTTPS. It also has these protections:
- the API refuses cross-site POSTs (Origin check);
- sign-in is limited to 10 tries per email and 30 per IP every 15 minutes, and sign-up to 10 per IP
  per hour;
- the session cookie is `Secure` when `PUBLIC_URL` is https.

Access control is done on the server for every API call. `robots.txt` is not a security measure.

## Local services: categories, onboarding and bookings

**Categories** live in the database (`wl_categories`, `wl_subcategories`, seeded by migration
`0004`). Each has a `service_type` (`REMOTE`, `ON_SITE`, `HYBRID`), `requires_verification`, the
`required_documents` for verification, and suggested `perks`. Home & Cleaning, Childcare & Family
and Driving & Transport require a government ID (Driving also a driver's licence). Every category has
subcategories (migration `0006`), which visitors can filter by on the freelancers page.

**Own categories**: freelancers can create up to three categories during onboarding and add their own
specialisations and skills. A name that already exists in any language is reused. A new category works
straight away, but it stays off the home page and out of search engines until an admin approves it at
`/admin/categories` (translate and approve, or merge into another). Categories for on-site work always
require a government ID.

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

<!-- Auto-deploy test: safe to remove. -->
