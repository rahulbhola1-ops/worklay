import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { createDb, sql, changed, isUniqueViolation } from './db/index.mjs';
import { migrateToLatest } from './db/migrate.mjs';
import { createPayments, PLATFORM_FEE } from './payments.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load settings such as DATABASE_URL and GOOGLE_CLIENT_ID from a local .env file if there is one.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* no .env file */ }
const app = express();

// PostgreSQL through Kysely. Pending migrations run on start unless MIGRATE_ON_START=false
// (Kysely takes a lock, so several servers starting at once is safe).
const db = createDb();
if (process.env.MIGRATE_ON_START !== 'false') await migrateToLatest(db);

// Card payments through Stripe Connect; disabled (manual payouts) without STRIPE_SECRET_KEY.
const payments = createPayments({ db, notify, publicOrigin });
const MIN_PAYOUT = 20;
const netOf = amount => Math.round(Number(amount) * (1 - PLATFORM_FEE) * 100) / 100;

payments.registerRoutes(app, { me }); // before express.json: the Stripe webhook needs the raw body
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(express.json({ limit: '5mb' }));

const CITIES = {
  Tallinn: ['Haabersti','Kesklinn','Kristiine','Lasnamäe','Mustamäe','Nõmme','Pirita','Põhja-Tallinn'],
  Tartu: ['Annelinn','Karlova','Kesklinn','Maarjamõisa','Ropka','Supilinn','Tammelinn','Ülejõe'],
  Pärnu: ['Kesklinn','Raeküla','Rannarajoon','Vana-Pärnu','Ülejõe'],
  Narva: ['Kalevi','Kesklinn','Kreenholm','Pähklimäe','Soldino'],
  'Kohtla-Järve': ['Ahtme','Järve','Sompa'],
  Viljandi: ['Kesklinn','Paalalinn','Peetrimõisa']
};

function sid(v) { return v === null || v === undefined ? null : String(v); }
function iso(v) { return v ? new Date(v).toISOString().replace('.000Z', 'Z') : new Date().toISOString(); }
const list = v => (Array.isArray(v) ? v : []);
const json = v => JSON.stringify(v); // jsonb columns take JSON text
const skillList = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');

function parseCookies(req) {
  const out = {};
  for (const pair of (req.headers.cookie || '').split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}
async function me(req) {
  const token = parseCookies(req).worklay_auth;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (await db.selectFrom('wl_sessions as s').innerJoin('wl_users as u', 'u.id', 's.user_id').selectAll('u')
    .where('s.token_hash', '=', tokenHash(token)).where('s.expires_at', '>', sql`now()`).executeTakeFirst()) || null;
}
function setAuth(res, token) {
  res.append('Set-Cookie', `worklay_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`);
}
async function login(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.insertInto('wl_sessions').values({ token_hash: tokenHash(token), user_id: userId, expires_at: sql`now() + interval '30 days'` }).execute();
  setAuth(res, token);
}
function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}
function passwordVerify(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, parts[1], 64);
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}
// `ex` lets callers write the notification inside their transaction.
async function notify(userId, type, text, link = '', ex = db) {
  await ex.insertInto('wl_notifications').values({ user_id: userId, type, text, link }).execute();
}

/* ---------- Sign in with Google (OAuth 2.0 authorization code flow + PKCE) ----------
   Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. The redirect URI to register in Google
   Cloud Console is <site origin>/api/auth/google/callback; set PUBLIC_URL in production so it
   doesn't depend on request headers. */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const googleEnabled = () => !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const OAUTH_COOKIE = 'worklay_oauth';

function publicOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim();
  return `${proto}://${host}`;
}
const googleRedirectUri = req => publicOrigin(req) + '/api/auth/google/callback';
const isHttps = req => publicOrigin(req).startsWith('https://');

app.get('/api/auth/google', (req, res) => {
  if (!googleEnabled()) return res.redirect('/#/?auth_error=google_disabled');
  const state = crypto.randomBytes(24).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const intent = req.query.intent === 'work' ? 'work' : 'hire';
  const value = encodeURIComponent(JSON.stringify({ state, verifier, intent }));
  res.append('Set-Cookie', `${OAUTH_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${isHttps(req) ? '; Secure' : ''}`);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: googleRedirectUri(req), response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const fail = code => res.redirect('/#/?auth_error=' + code);
  res.append('Set-Cookie', `${OAUTH_COOKIE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`);
  let saved = null;
  try { saved = JSON.parse(parseCookies(req)[OAUTH_COOKIE] || 'null'); } catch (e) {}
  if (!googleEnabled()) return fail('google_disabled');
  if (!saved || typeof req.query.state !== 'string' || saved.state !== req.query.state) return fail('google_state');
  if (req.query.error || typeof req.query.code !== 'string') return fail('google_cancelled');
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: req.query.code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: googleRedirectUri(req), grant_type: 'authorization_code', code_verifier: saved.verifier }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) { console.error('Google token exchange failed:', tok.error || r.status); return fail('google_failed'); }
    // The ID token came straight from Google's token endpoint over TLS, so its claims can be
    // trusted without checking the signature; still check who issued it and for whom.
    const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'));
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || claims.aud !== GOOGLE_CLIENT_ID || claims.exp * 1000 < Date.now() || !claims.sub) return fail('google_failed');
    if (!claims.email || claims.email_verified !== true) return fail('google_unverified');

    const email = String(claims.email).toLowerCase(), googleId = String(claims.sub);
    let u = await db.selectFrom('wl_users').select('id').where('google_id', '=', googleId).executeTakeFirst();
    let created = false;
    if (!u) {
      u = await db.selectFrom('wl_users').select('id').where('email', '=', email).executeTakeFirst();
      if (u) await db.updateTable('wl_users').set({ google_id: googleId }).where('id', '=', u.id).execute(); // link existing account (Google verified the email)
      else {
        u = await db.insertInto('wl_users')
          .values({ name: String(claims.name || email.split('@')[0]).slice(0, 60), email, pw_hash: '', google_id: googleId, is_freelancer: saved.intent === 'work' })
          .returning('id').executeTakeFirstOrThrow();
        created = true;
      }
    }
    await login(res, u.id);
    return res.redirect(created ? '/#/dashboard/settings?welcome=google' : '/#/?signed_in=google');
  } catch (error) {
    console.error(error);
    return fail('google_failed');
  }
});

/* ---------- JSON API: /api?r=<route> ---------- */
const bad = (res, error, status = 400) => res.status(status).json({ error });

app.all('/api', upload.single('doc'), async (req, res) => {
  const route = String(req.query.r || '');
  const data = req.method === 'POST' ? (req.body || {}) : {};
  try {
    const user = await me(req);
    const requireLogin = () => { if (!user) bad(res, 'Please log in first.', 401); return user; };
    const requireAdmin = () => { if (!user || user.role !== 'admin') { bad(res, 'Admins only.', 403); return null; } return user; };

    if (req.method === 'GET' && route === 'bootstrap') return res.json(await bootstrap(user));
    if (req.method === 'GET' && route === 'admin/doc') {
      if (!requireAdmin()) return;
      const doc = await db.selectFrom('wl_documents').selectAll().where('user_id', '=', Number(req.query.id) || 0).executeTakeFirst();
      if (!doc) return bad(res, 'Document not found.', 404);
      res.setHeader('Content-Type', doc.mime);
      return res.send(doc.data);
    }
    if (req.method !== 'POST') return bad(res, 'Not found.', 404);

    switch (route) {
      case 'auth/register': {
        if (!data.email || !data.password) return bad(res, 'Email and password are required.');
        if (String(data.password).length < 8) return bad(res, 'Password must be at least 8 characters.');
        try {
          const u = await db.insertInto('wl_users').values({
            name: String(data.name || ''), email: String(data.email).toLowerCase(), pw_hash: passwordHash(String(data.password)),
            title: String(data.title || ''), city: String(data.city || ''), area: String(data.area || ''),
            is_freelancer: data.intent === 'work', category: String(data.category || ''),
          }).returning('id').executeTakeFirstOrThrow();
          await login(res, u.id);
          return res.json({ ok: true, id: sid(u.id) });
        } catch (e) {
          if (isUniqueViolation(e)) return bad(res, 'An account already exists with that email.');
          throw e;
        }
      }
      case 'auth/login': {
        const u = await db.selectFrom('wl_users').select(['id', 'pw_hash']).where('email', '=', String(data.email || '').toLowerCase()).executeTakeFirst();
        if (!u || !passwordVerify(String(data.password || ''), u.pw_hash)) return bad(res, 'Invalid email or password.', 401);
        await login(res, u.id);
        return res.json({ ok: true, id: sid(u.id) });
      }
      case 'auth/logout': {
        const token = parseCookies(req).worklay_auth;
        if (token) await db.deleteFrom('wl_sessions').where('token_hash', '=', tokenHash(token)).execute();
        res.setHeader('Set-Cookie', 'worklay_auth=; Path=/; HttpOnly; Max-Age=0');
        return res.json({ ok: true });
      }
      case 'profile/update': {
        const u = requireLogin(); if (!u) return;
        try {
          await db.updateTable('wl_users').set({
            name: String(data.name || u.name), email: String(data.email || u.email).toLowerCase(), title: String(data.title || ''),
            city: String(data.city || ''), area: String(data.area || ''), is_freelancer: !!data.isFreelancer, category: String(data.category || ''),
            rate: Number(data.rate || 0), bio: String(data.bio || ''), skills: json(skillList(data.skills)),
          }).where('id', '=', u.id).execute();
        } catch (e) {
          if (isUniqueViolation(e)) return bad(res, 'Another account already uses that email.');
          throw e;
        }
        return res.json({ ok: true });
      }
      case 'project/create': {
        const u = requireLogin(); if (!u) return;
        const p = await db.insertInto('wl_projects').values({
          owner_id: u.id, title: String(data.title || ''), category: String(data.category || ''), description: String(data.description || ''),
          budget_min: Number(data.min || 0), budget_max: Number(data.max || 0), deadline: String(data.deadline || ''), skills: json(skillList(data.skills)),
          city: String(data.city || ''), area: String(data.area || ''), remote: !!data.remote,
        }).returning('id').executeTakeFirstOrThrow();
        return res.json({ ok: true, id: sid(p.id) });
      }
      case 'service/create': {
        const u = requireLogin(); if (!u) return;
        const s = await db.insertInto('wl_services').values({
          seller_id: u.id, title: String(data.title || ''), category: String(data.category || ''), emoji: String(data.emoji || '💼'),
          description: String(data.description || ''), packages: json(list(data.packages)),
        }).returning('id').executeTakeFirstOrThrow();
        return res.json({ ok: true, id: sid(s.id) });
      }
      case 'proposal/create': {
        const u = requireLogin(); if (!u) return;
        try {
          const p = await db.insertInto('wl_proposals').values({
            project_id: Number(data.projectId) || 0, seller_id: u.id, amount: Number(data.amount || 0), days: Number(data.days || 1), cover: String(data.cover || ''),
          }).returning('id').executeTakeFirstOrThrow();
          return res.json({ ok: true, id: sid(p.id) });
        } catch (e) {
          if (isUniqueViolation(e)) return bad(res, 'You already sent a proposal for this project.');
          throw e;
        }
      }
      case 'proposal/award': return mutateProjectAward(req, res, requireLogin(), data);
      case 'project/complete': return mutateProjectComplete(res, requireLogin(), data);
      case 'order/create': return mutateOrder(req, res, requireLogin(), data);
      case 'order/deliver': return mutateOrderStatus(res, requireLogin(), data, 'delivered');
      case 'order/accept': return mutateOrderStatus(res, requireLogin(), data, 'completed');
      case 'review/create': {
        const u = requireLogin(); if (!u) return;
        const orderId = Number(data.orderId || 0) || null, projectId = Number(data.projectId || 0) || null;
        let targetUser = Number(data.targetUser || 0);
        if (!targetUser && orderId) targetUser = (await db.selectFrom('wl_orders').select('seller_id').where('id', '=', orderId).executeTakeFirst())?.seller_id || 0;
        if (!targetUser && projectId) targetUser = (await db.selectFrom('wl_projects').select('awarded_to').where('id', '=', projectId).executeTakeFirst())?.awarded_to || 0;
        if (!targetUser) return bad(res, 'Who are you reviewing?');
        await db.insertInto('wl_reviews').values({ target_user: targetUser, from_user: u.id, order_id: orderId, project_id: projectId, rating: Number(data.rating || 0), text: String(data.text || '') }).execute();
        return res.json({ ok: true });
      }
      case 'message/send': {
        const u = requireLogin(); if (!u) return;
        const to = Number(data.to) || 0;
        await db.insertInto('wl_messages').values({ from_id: u.id, to_id: to, text: String(data.text || '') }).execute();
        await notify(to, 'message', `${u.name} sent you a message.`);
        return res.json({ ok: true });
      }
      case 'message/read': {
        const u = requireLogin(); if (!u) return;
        await db.updateTable('wl_messages').set({ is_read: true }).where('to_id', '=', u.id).where('from_id', '=', Number(data.with) || 0).execute();
        return res.json({ ok: true });
      }
      case 'notification/read': {
        const u = requireLogin(); if (!u) return;
        await db.updateTable('wl_notifications').set({ is_read: true }).where('id', '=', Number(data.id) || 0).where('user_id', '=', u.id).execute();
        return res.json({ ok: true });
      }
      case 'notification/read-all': {
        const u = requireLogin(); if (!u) return;
        await db.updateTable('wl_notifications').set({ is_read: true }).where('user_id', '=', u.id).execute();
        return res.json({ ok: true });
      }
      case 'wishlist/toggle': {
        const u = requireLogin(); if (!u) return;
        const key = { user_id: u.id, kind: String(data.kind || ''), item_id: Number(data.id) || 0 };
        const removed = changed(await db.deleteFrom('wl_wishlist').where('user_id', '=', key.user_id).where('kind', '=', key.kind).where('item_id', '=', key.item_id).executeTakeFirst());
        if (!removed) await db.insertInto('wl_wishlist').values(key).onConflict(oc => oc.doNothing()).execute();
        return res.json({ ok: true, saved: !removed });
      }
      case 'follow/toggle': {
        const u = requireLogin(); if (!u) return;
        const followee = Number(data.id) || 0;
        const removed = changed(await db.deleteFrom('wl_follows').where('follower', '=', u.id).where('followee', '=', followee).executeTakeFirst());
        if (!removed) await db.insertInto('wl_follows').values({ follower: u.id, followee }).onConflict(oc => oc.doNothing()).execute();
        return res.json({ ok: true, following: !removed });
      }
      case 'payout/request': {
        const u = requireLogin(); if (!u) return;
        if (payments.enabled) return bad(res, 'Payouts are sent automatically through Stripe.');
        const amount = Math.round(Number(data.amount || 0) * 100) / 100;
        if (!(amount >= MIN_PAYOUT)) return bad(res, `The minimum payout is €${MIN_PAYOUT}.`);
        if (!String(data.details || '').trim()) return bad(res, 'Please enter your account details.');
        const ok = await db.transaction().execute(async trx => {
          const r = await trx.updateTable('wl_users').set({ balance: sql`balance - ${amount}` }).where('id', '=', u.id).where('balance', '>=', amount).executeTakeFirst();
          if (!changed(r)) return false;
          await trx.insertInto('wl_payouts').values({ user_id: u.id, amount, method: String(data.method || ''), details: String(data.details || '') }).execute();
          return true;
        });
        if (!ok) return bad(res, 'You can’t withdraw more than your available balance.');
        return res.json({ ok: true });
      }
      case 'order/cancel': {
        const u = requireLogin(); if (!u) return;
        const o = await db.selectFrom('wl_orders').selectAll().where('id', '=', Number(data.id) || 0).executeTakeFirst();
        if (!o || o.buyer_id !== u.id) return bad(res, 'Order not found.', 404);
        if (o.status !== 'awaiting_payment') return bad(res, 'Only unpaid orders can be cancelled here. Contact support for paid orders.');
        const p = await db.selectFrom('wl_payments').selectAll().where('kind', '=', 'order').where('order_id', '=', o.id).where('status', 'in', ['pending', 'processing']).executeTakeFirst();
        if (p) await payments.cancelPayment(p);
        await db.updateTable('wl_orders').set({ status: 'cancelled' }).where('id', '=', o.id).where('status', '=', 'awaiting_payment').execute();
        return res.json({ ok: true });
      }
      case 'payments/connect': {
        const u = requireLogin(); if (!u) return;
        if (!payments.enabled) return bad(res, 'Card payments are not set up.');
        return res.json({ ok: true, url: await payments.onboardingLink(req, u) });
      }
      case 'payments/status': {
        const u = requireLogin(); if (!u) return;
        if (!payments.enabled) return res.json({ ok: true });
        return res.json({ ok: true, ...await payments.refreshAccount(u) });
      }
      case 'payments/dashboard': {
        const u = requireLogin(); if (!u) return;
        if (!payments.enabled) return bad(res, 'Card payments are not set up.');
        return res.json({ ok: true, url: await payments.dashboardLink(u) });
      }
      case 'contact/send':
        await db.insertInto('wl_contacts').values({ name: String(data.name || ''), email: String(data.email || ''), message: String(data.message || '') }).execute();
        return res.json({ ok: true });
      case 'verification/submit': {
        const u = requireLogin(); if (!u) return;
        if (!req.file) return bad(res, 'Please choose a file.');
        await db.transaction().execute(async trx => {
          await trx.insertInto('wl_documents').values({ user_id: u.id, mime: req.file.mimetype, data: req.file.buffer })
            .onConflict(oc => oc.column('user_id').doUpdateSet(eb => ({ mime: eb.ref('excluded.mime'), data: eb.ref('excluded.data') }))).execute();
          await trx.updateTable('wl_users').set({ ver_status: 'pending', ver_doc_type: String(data.docType || 'ID card'), ver_file: 'stored', ver_file_name: req.file.originalname, ver_submitted: sql`now()` })
            .where('id', '=', u.id).execute();
        });
        return res.json({ ok: true });
      }
      case 'admin/verify': {
        if (!requireAdmin()) return;
        const target = Number(data.id) || 0;
        await db.transaction().execute(async trx => {
          await trx.updateTable('wl_users').set({ ver_status: data.ok ? 'verified' : 'rejected', ver_reason: String(data.reason || ''), ver_file: null }).where('id', '=', target).execute();
          await trx.deleteFrom('wl_documents').where('user_id', '=', target).execute();
        });
        return res.json({ ok: true });
      }
      case 'admin/payout-paid': {
        if (!requireAdmin()) return;
        await db.updateTable('wl_payouts').set({ status: 'paid' }).where('id', '=', Number(data.id) || 0).execute();
        return res.json({ ok: true });
      }
      default: return bad(res, 'Not found.', 404);
    }
  } catch (error) {
    console.error(error);
    if (res.headersSent) return;
    const fromStripe = typeof error.type === 'string' && error.type.startsWith('Stripe');
    return res.status(fromStripe ? 502 : 500).json({ error: fromStripe ? `Payment provider error: ${error.message}` : 'Something went wrong. Please try again.' });
  }
});

/* Everything the front end needs, filtered to what the current visitor may see. */
async function bootstrap(user) {
  const mid = user ? user.id : 0;
  const admin = !!user && user.role === 'admin';
  if (payments.enabled) await payments.cleanupAbandoned();
  const none = Promise.resolve([]);

  const [users, orderStats, projectStats, services, projects, proposals, orders, reviews, messages, notifications, wishlist, follows, payouts, posts, paymentList, payoutSummary] = await Promise.all([
    db.selectFrom('wl_users').selectAll().orderBy('id').execute(),
    db.selectFrom('wl_orders').select(['seller_id', sql`count(*) filter (where status in ('in_queue', 'delivered'))`.as('in_queue'), sql`count(*) filter (where status = 'completed')`.as('done')]).groupBy('seller_id').execute(),
    db.selectFrom('wl_projects').select(['awarded_to', sql`count(*)`.as('done')]).where('status', '=', 'completed').where('awarded_to', 'is not', null).groupBy('awarded_to').execute(),
    db.selectFrom('wl_services').selectAll().orderBy('id', 'desc').execute(),
    db.selectFrom('wl_projects as p').selectAll('p')
      .select(eb => eb.selectFrom('wl_proposals as x').select(eb.fn.countAll().as('n')).whereRef('x.project_id', '=', 'p.id').as('proposal_count'))
      .orderBy('p.id', 'desc').execute(),
    mid ? db.selectFrom('wl_proposals').selectAll()
      .where(eb => eb.or([eb('seller_id', '=', mid), eb('project_id', 'in', eb.selectFrom('wl_projects').select('id').where('owner_id', '=', mid))]))
      .orderBy('id', 'desc').execute() : none,
    // Sellers don't see orders until they're paid; nobody sees cancelled checkouts.
    mid ? db.selectFrom('wl_orders').selectAll().where('status', '<>', 'cancelled')
      .where(eb => eb.or([eb('buyer_id', '=', mid), eb.and([eb('seller_id', '=', mid), eb('status', '<>', 'awaiting_payment')])]))
      .orderBy('id', 'desc').execute() : none,
    db.selectFrom('wl_reviews').selectAll().orderBy('id', 'desc').execute(),
    mid ? db.selectFrom('wl_messages').selectAll().where(eb => eb.or([eb('from_id', '=', mid), eb('to_id', '=', mid)])).orderBy('id').execute() : none,
    mid ? db.selectFrom('wl_notifications').selectAll().where('user_id', '=', mid).orderBy('id', 'desc').limit(100).execute() : none,
    mid ? db.selectFrom('wl_wishlist').select(['kind', 'item_id']).where('user_id', '=', mid).execute() : none,
    mid ? db.selectFrom('wl_follows').select('followee').where('follower', '=', mid).execute() : none,
    admin ? db.selectFrom('wl_payouts').selectAll().orderBy('id', 'desc').execute()
      : mid ? db.selectFrom('wl_payouts').selectAll().where('user_id', '=', mid).orderBy('id', 'desc').execute() : none,
    db.selectFrom('wl_posts').selectAll().orderBy('id', 'desc').execute(),
    payments.enabled && mid ? payments.listFor(mid, admin) : none,
    payments.enabled && user ? payments.summary(user) : Promise.resolve(null),
  ]);

  const oStats = new Map(orderStats.map(r => [r.seller_id, r]));
  const pStats = new Map(projectStats.map(r => [r.awarded_to, r.done]));
  return {
    me: user ? sid(user.id) : null,
    users: users.map(u => {
      const self = u.id === mid;
      const out = {
        id: sid(u.id), name: u.name, title: u.title, country: u.country, city: u.city, area: u.area,
        bio: u.bio || '', skills: list(u.skills), isFreelancer: u.is_freelancer,
        category: u.category, rate: u.rate, role: u.role, color: u.color, joined: iso(u.created_at),
        verification: { status: u.ver_status },
        stats: { inQueue: oStats.get(u.id)?.in_queue || 0, doneServices: oStats.get(u.id)?.done || 0, doneProjects: pStats.get(u.id) || 0 },
        balance: self ? u.balance : 0,
      };
      if (self && payoutSummary) out.payouts = payoutSummary;
      if (self || admin) {
        out.email = u.email;
        out.verification = { status: u.ver_status, docType: u.ver_doc_type, fileName: u.ver_file_name, submitted: u.ver_submitted ? iso(u.ver_submitted) : null, reason: u.ver_reason, hasDoc: !!u.ver_file };
      }
      return out;
    }),
    services: services.map(s => ({ id: sid(s.id), sellerId: sid(s.seller_id), title: s.title, category: s.category, emoji: s.emoji, color: s.color, description: s.description, packages: list(s.packages), created: iso(s.created_at) })),
    projects: projects.map(p => ({
      id: sid(p.id), ownerId: sid(p.owner_id), title: p.title, category: p.category, description: p.description,
      budgetMin: p.budget_min, budgetMax: p.budget_max, deadline: p.deadline, skills: list(p.skills),
      city: p.city, area: p.area, remote: p.remote, status: p.status, awardedTo: sid(p.awarded_to),
      awardedAmount: p.awarded_amount, proposalCount: p.proposal_count, created: iso(p.created_at),
    })),
    proposals: proposals.map(p => ({ id: sid(p.id), projectId: sid(p.project_id), sellerId: sid(p.seller_id), amount: p.amount, days: p.days, cover: p.cover, status: p.status, created: iso(p.created_at) })),
    orders: orders.map(o => ({ id: sid(o.id), serviceId: sid(o.service_id), pkg: o.pkg, buyerId: sid(o.buyer_id), sellerId: sid(o.seller_id), price: o.price, status: o.status, created: iso(o.created_at) })),
    reviews: reviews.map(r => ({ id: sid(r.id), targetUser: sid(r.target_user), from: sid(r.from_user), serviceId: sid(r.service_id), orderId: sid(r.order_id), projectId: sid(r.project_id), rating: r.rating, text: r.text, date: iso(r.created_at) })),
    messages: messages.map(m => ({ id: sid(m.id), from: sid(m.from_id), to: sid(m.to_id), text: m.text, read: m.is_read, date: iso(m.created_at) })),
    notifications: notifications.map(n => ({ id: sid(n.id), userId: sid(n.user_id), type: n.type, text: n.text, link: n.link, read: n.is_read, date: iso(n.created_at) })),
    wishlist: wishlist.map(w => ({ kind: w.kind, id: sid(w.item_id) })),
    follows: follows.map(f => sid(f.followee)),
    payouts: payouts.map(p => ({ id: sid(p.id), userId: sid(p.user_id), amount: p.amount, method: p.method, details: p.details, status: p.status, created: iso(p.created_at) })),
    posts: posts.map(p => ({ id: sid(p.id), title: p.title, emoji: p.emoji, color: p.color, excerpt: p.excerpt, body: p.body, created: iso(p.created_at) })),
    payments: paymentList,
    config: { cities: CITIES, fee: PLATFORM_FEE, minPayout: MIN_PAYOUT, payoutMethods: ['PayPal', 'Payoneer', 'Bank transfer'], googleAuth: googleEnabled(), cardPayments: payments.enabled },
  };
}

async function mutateProjectAward(req, res, u, data) {
  if (!u) return;
  const pr = await db.selectFrom('wl_proposals').selectAll().where('id', '=', Number(data.id) || 0).executeTakeFirst();
  if (!pr) return bad(res, 'Proposal not found.', 404);
  const project = await db.selectFrom('wl_projects').selectAll().where('id', '=', pr.project_id).executeTakeFirst();
  if (!project || project.owner_id !== u.id) return bad(res, 'Project owner only.', 403);
  if (project.status !== 'open') return bad(res, 'This project has already been awarded.');
  if (payments.enabled) {
    // The project is awarded once the payment succeeds. Drop any earlier unfinished checkout for it.
    const pending = await db.selectFrom('wl_payments').selectAll().where('kind', '=', 'project').where('project_id', '=', project.id).where('status', '=', 'pending').execute();
    for (const p of pending) await payments.cancelPayment(p);
    const { url } = await payments.startCheckout(req, { kind: 'project', buyer: u, sellerId: pr.seller_id, amount: pr.amount, title: `Project: ${project.title}`, projectId: project.id, proposalId: pr.id });
    return res.json({ ok: true, checkoutUrl: url });
  }
  const awarded = await db.transaction().execute(async trx => {
    const r = await trx.updateTable('wl_projects').set({ status: 'awarded', awarded_to: pr.seller_id, awarded_amount: pr.amount }).where('id', '=', project.id).where('status', '=', 'open').executeTakeFirst();
    if (!changed(r)) return false;
    await trx.updateTable('wl_proposals').set({ status: 'accepted' }).where('id', '=', pr.id).execute();
    await notify(pr.seller_id, 'project', 'You were awarded a project.', `#/project/${project.id}`, trx);
    return true;
  });
  if (!awarded) return bad(res, 'This project has already been awarded.');
  return res.json({ ok: true });
}

async function mutateProjectComplete(res, u, data) {
  if (!u) return;
  const p = await db.selectFrom('wl_projects').selectAll().where('id', '=', Number(data.id) || 0).executeTakeFirst();
  if (!p || p.owner_id !== u.id) return bad(res, 'Project owner only.', 403);
  if (p.status !== 'awarded') return bad(res, 'Only projects in progress can be completed.');
  if (!changed(await db.updateTable('wl_projects').set({ status: 'completed' }).where('id', '=', p.id).where('status', '=', 'awarded').executeTakeFirst())) return res.json({ ok: true });
  // Stripe: release the held payment. Manual mode (or projects awarded before Stripe): credit the balance.
  if (!(await payments.release({ projectId: p.id })) && p.awarded_to) await db.updateTable('wl_users').set({ balance: sql`balance + ${netOf(p.awarded_amount || 0)}` }).where('id', '=', p.awarded_to).execute();
  if (p.awarded_to) await notify(p.awarded_to, 'payment', 'The customer approved your work and released the payment.', '#/dashboard/earnings');
  return res.json({ ok: true });
}

async function mutateOrder(req, res, u, data) {
  if (!u) return;
  const service = await db.selectFrom('wl_services').selectAll().where('id', '=', Number(data.serviceId) || 0).executeTakeFirst();
  if (!service) return bad(res, 'Service not found.', 404);
  const pkgIndex = Number(data.pkg) || 0, pkg = list(service.packages)[pkgIndex];
  if (!pkg) return bad(res, 'Package not found.', 404);
  if (service.seller_id === u.id) return bad(res, 'You can’t order your own service.');
  const price = Number(pkg.price || 0);
  const values = { service_id: service.id, pkg: pkgIndex, buyer_id: u.id, seller_id: service.seller_id, price, requirements: String(data.requirements || '') };
  if (payments.enabled) {
    // The seller only sees the order after the payment succeeds.
    const { id: orderId } = await db.insertInto('wl_orders').values({ ...values, status: 'awaiting_payment' }).returning('id').executeTakeFirstOrThrow();
    try {
      const { url } = await payments.startCheckout(req, { kind: 'order', buyer: u, sellerId: service.seller_id, amount: price, title: `${service.title} (${pkg.name || 'Package'})`, orderId });
      return res.json({ ok: true, id: sid(orderId), checkoutUrl: url });
    } catch (e) {
      await db.updateTable('wl_orders').set({ status: 'cancelled' }).where('id', '=', orderId).execute();
      throw e;
    }
  }
  const o = await db.insertInto('wl_orders').values(values).returning('id').executeTakeFirstOrThrow();
  await notify(service.seller_id, 'order', 'You have a new order.', '#/dashboard/orders');
  return res.json({ ok: true, id: sid(o.id) });
}

async function mutateOrderStatus(res, u, data, status) {
  if (!u) return;
  const o = await db.selectFrom('wl_orders').selectAll().where('id', '=', Number(data.id) || 0).executeTakeFirst();
  if (!o) return bad(res, 'Order not found.', 404);
  if (status === 'delivered' && o.seller_id !== u.id) return bad(res, 'Seller only.', 403);
  if (status === 'completed' && o.buyer_id !== u.id) return bad(res, 'Buyer only.', 403);
  const from = status === 'delivered' ? ['in_queue'] : ['in_queue', 'delivered'];
  if (!from.includes(o.status)) return bad(res, 'This order can’t be changed any more.');
  if (!changed(await db.updateTable('wl_orders').set({ status }).where('id', '=', o.id).where('status', 'in', from).executeTakeFirst())) return res.json({ ok: true });
  if (status === 'delivered') await notify(o.buyer_id, 'order', 'Your order was delivered. Please review and approve it.', '#/dashboard/orders');
  if (status === 'completed') {
    // Stripe: release the held payment. Manual mode (or orders placed before Stripe): credit the balance.
    if (!(await payments.release({ orderId: o.id }))) await db.updateTable('wl_users').set({ balance: sql`balance + ${netOf(o.price)}` }).where('id', '=', o.seller_id).execute();
    await notify(o.seller_id, 'payment', 'The buyer approved your delivery and released the payment.', '#/dashboard/earnings');
  }
  return res.json({ ok: true });
}

if (!process.argv.includes('--dev')) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.use((req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
}

const port = process.argv.includes('--dev') ? 3001 : Number(process.env.PORT || 5173);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Worklay Node API listening on port ${port}`));

// Close the database pool cleanly when Docker or Ctrl+C stops the server.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); db.destroy().finally(() => process.exit(0)); });
}
