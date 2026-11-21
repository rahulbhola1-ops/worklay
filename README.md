# Worklay

Worklay is a local Node.js application using Vite, TanStack Router, Express, and SQLite.
The interface supports English and Estonian; use the flag menu in the top navigation to switch languages.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Production build

```powershell
npm run build
npm start
```

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
