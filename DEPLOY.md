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
| `PUBLIC_URL` | `https://worklay.com` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in; the Google client must allow `https://worklay.com/api/auth/google/callback` |
| `STRIPE_SECRET_KEY` | live key `sk_live_…` once Stripe live mode is set up; leave empty to keep manual payouts |
| `STRIPE_WEBHOOK_SECRET` | signing secret of the live webhook endpoint `https://worklay.com/api/payments/webhook` |

After changing `.env`, run `docker compose up -d` on the server (or re-run the Deploy action).
