# Deploying worklay.com

Every push to `master` (for example, merging a pull request) runs the **Deploy** GitHub Action
(`.github/workflows/deploy.yml`). It connects to the server over SSH, checks out that exact commit,
rebuilds the Docker container and checks that the site responds. Until the secrets below are set,
the action does nothing and shows a warning.

You can also start a deploy by hand: GitHub → **Actions** → **Deploy** → **Run workflow**.

## One-time setup

These steps are done once by whoever manages the server.

### 1. Make sure the server can run the site

In the project folder on the server (for example `/opt/worklay`):

- the repository is cloned and on `master`, and `git fetch` works without a password
  (public repo, or a read-only deploy key added under GitHub → Settings → Deploy keys)
- `docker compose up -d --build` works for the deploy user (the user is in the `docker` group)
- the `.env` file is next to `docker-compose.yml` (see `.env.example`); it is never committed,
  and deploys leave it untouched

### 2. Create a key just for deploys

On your own computer (not the server):

```bash
ssh-keygen -t ed25519 -f worklay_deploy -N "" -C "github-actions-deploy"
```

This creates `worklay_deploy` (private) and `worklay_deploy.pub` (public). On the server, add the
contents of `worklay_deploy.pub` as a new line in `~/.ssh/authorized_keys` of the deploy user.

### 3. Record the server's identity

From a computer you trust, run (replace the host, and add `-p PORT` if SSH isn't on port 22):

```bash
ssh-keyscan -t ed25519,rsa your-server-address
```

Compare the fingerprint with the one shown by `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
on the server. If they match, keep the output for the next step.

### 4. Add the secrets in GitHub

GitHub → repository **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | server address, e.g. `203.0.113.10` or `server.example.com` |
| `DEPLOY_USER` | SSH user, e.g. `deploy` |
| `DEPLOY_PATH` | project folder on the server, e.g. `/opt/worklay` |
| `DEPLOY_SSH_KEY` | the whole contents of the private key file `worklay_deploy` |
| `DEPLOY_KNOWN_HOSTS` | the `ssh-keyscan` output from step 3 |
| `DEPLOY_PORT` | optional, only if SSH isn't on port 22 |

If the site isn't at `https://worklay.com`, add a repository **variable** (same page, Variables tab)
`SITE_URL` with its address.

Then delete the local `worklay_deploy` files, or keep the private key somewhere safe.

### 5. Try it

GitHub → **Actions** → **Deploy** → **Run workflow**. The log ends with `Deployed <commit>` and
`https://worklay.com is up.`

## Settings on the server (`.env`)

| Setting | Notes |
|---|---|
| `POSTGRES_PASSWORD` | **required**: password for the database container; letters and digits only, e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `PUBLIC_URL` | `https://worklay.com` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in; the Google client must allow `https://worklay.com/api/auth/google/callback` |
| `STRIPE_SECRET_KEY` | live key `sk_live_…` once Stripe live mode is set up; leave empty to keep manual payouts |
| `STRIPE_WEBHOOK_SECRET` | signing secret of the live webhook endpoint `https://worklay.com/api/payments/webhook` |

After changing `.env`, run `docker compose up -d` on the server (or re-run the Deploy action).

## Switching the live site from SQLite to PostgreSQL (once)

Older versions stored everything in a SQLite file inside the `worklay-data` Docker volume. The
current version uses a PostgreSQL container instead. To move over without losing data, run these
in the project folder on the server:

1. Add `POSTGRES_PASSWORD=...` to `.env`. Do this **before** merging the Postgres change if the
   automatic deploy is set up: without it, `docker compose` refuses to start, and the old version
   keeps running.
2. Get the new code and start only the database:
   ```bash
   git pull
   docker compose up -d --wait db
   ```
3. Build the new app image, and copy the old data across while the app is stopped, so nobody
   signs up halfway through:
   ```bash
   docker compose stop worklay
   docker compose build worklay
   docker compose run --rm --no-deps worklay node db/import-sqlite.mjs /data/worklay.sqlite
   ```
   It creates the tables, copies every row and lists any rows it had to skip. It refuses to run
   if the Postgres database already has users.
4. Start the app:
   ```bash
   docker compose up -d
   ```
5. Check the site: log in with an existing account and look at a few projects and orders.

The SQLite file stays in the `worklay-data` volume as a backup. Once you're happy, it can be
removed, and `better-sqlite3` can be dropped from `package.json` in a later change.

## Backups

Back up the database regularly, for example daily with cron:

```bash
docker compose exec -T db pg_dump -U worklay -d worklay --format=custom > backup-$(date +%F).dump
```

Restore into an empty database with `pg_restore -U worklay -d worklay --clean backup.dump` (run it
inside the `db` container), and keep copies somewhere other than this server.
