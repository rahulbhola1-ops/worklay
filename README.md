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
