import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { createDb, sql, changed, isUniqueViolation, isExclusionViolation } from './db/index.mjs';
import { cleanWeekly, generateSlots, durationOptions, priceFor, localNow, isDate, toMinutes, toTime, daysBetween } from './scheduling.mjs';
import { migrateToLatest } from './db/migrate.mjs';
import { createPayments, PLATFORM_FEE } from './payments.mjs';
import { createStorage, detectImage } from './storage.mjs';
import { createMailer } from './mail.mjs';
import { createNotifications } from './notifications.mjs';
import { createSeo } from './seo.mjs';
import { TERMS_VERSION, APPROVAL_DAYS } from './terms.mjs';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load settings such as DATABASE_URL and GOOGLE_CLIENT_ID from a local .env file if there is one.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* no .env file */ }
const app = express();
app.disable('x-powered-by');

/* ---------- Security headers ----------
   CSP: scripts only from this site (no inline scripts or eval); inline style attributes are allowed
   because the interface uses them. Images may come from any https host (profile photos on R2).
   Stripe Checkout and Google sign-in are full-page redirects, so they need no CSP entries. */
app.use((req, res, next) => {
  const https = isHttps(req);
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
    "font-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; '));
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

/* ---------- Rate limiting for sign-in and sign-up (in memory, per server process) ---------- */
const attempts = new Map(); // key -> { count, resetAt }
function clientIp(req) {
  // Behind Cloudflare / a reverse proxy the real address is in these headers.
  return String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
}
function tooManyAttempts(key, max, windowMs) {
  const now = Date.now(), a = attempts.get(key);
  if (!a || a.resetAt < now) { attempts.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  a.count += 1;
  return a.count > max;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (a.resetAt < now) attempts.delete(k); }, 10 * 60_000).unref();

// PostgreSQL through Kysely. Pending migrations run on start unless MIGRATE_ON_START=false
// (Kysely takes a lock, so several servers starting at once is safe).
const db = createDb();
if (process.env.MIGRATE_ON_START !== 'false') await migrateToLatest(db);

// Emails through Brevo (welcome and notifications); switched off (logged only) without BREVO_API_KEY.
const mailer = createMailer();
// Notifications on the site, emailed too when they are about bookings, orders, projects or payments.
const notifications = createNotifications({ db, mailer, origin: (process.env.PUBLIC_URL || 'https://worklay.com').replace(/\/+$/, '') });
const { notify } = notifications;
// Card payments through Stripe Connect; disabled (manual payouts) without STRIPE_SECRET_KEY.
const payments = createPayments({ db, notify, publicOrigin });
const MIN_PAYOUT = 20;
// Profile photos in Cloudflare R2; uploads are switched off without R2 keys.
const storage = createStorage();
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
// Pay for work nobody objected to, then finish interrupted transfers and refunds and retry failed ones.
let paymentJob = false;
async function retryPayments() {
  if (paymentJob) return;
  paymentJob = true;
  try { await payments.autoRelease(); await payments.retryStuck(); }
  catch (e) { console.error('Payment job failed', e.message); }
  finally { paymentJob = false; }
}
if (payments.enabled) { setTimeout(retryPayments, 30_000).unref(); setInterval(retryPayments, 10 * 60_000).unref(); }
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

/* ---------- Categories (wl_categories / wl_subcategories) ---------- */
let categoryCache = { at: 0, list: [] };
async function categories() {
  if (Date.now() - categoryCache.at < 60_000) return categoryCache.list;
  const [cats, subs] = await Promise.all([
    db.selectFrom('wl_categories').selectAll().orderBy('sort_order').execute(),
    db.selectFrom('wl_subcategories').selectAll().orderBy('sort_order').execute(),
  ]);
  categoryCache = { at: Date.now(), list: cats.map(c => ({
    id: c.id, name: c.name, nameEt: c.name_et, nameRu: c.name_ru, status: c.status, createdBy: sid(c.created_by), icon: c.icon, color: c.color, serviceType: c.service_type,
    requiresVerification: c.requires_verification, requiredDocuments: list(c.required_documents), perks: list(c.perks),
    subcategories: subs.filter(x => x.category_id === c.id).map(x => ({ id: x.id, name: x.name, nameEt: x.name_et, nameRu: x.name_ru })),
  })) };
  return categoryCache.list;
}
const forgetCategories = () => { categoryCache = { at: 0, list: [] }; };
const CATEGORY_ICONS = ['🧩', '🛠️', '🎨', '💡', '🐾', '🌱', '🍳', '🧵', '🚲', '🏋️', '📦', '🖥️', '🎭', '🧘', '🔧', '📐', '🎁', '🧑‍🏫'];
const CATEGORY_COLORS = ['#eef1ff', '#e3f8ee', '#fff0e7', '#f0ebff', '#fdf1e1', '#e7f7f6', '#ffe9ee'];
const MAX_OWN_CATEGORIES = 3;
const cleanName = v => String(v ?? '').replace(/\s+/g, ' ').trim();
// Letters, digits and simple punctuation only: category names are shown all over the site.
const validCategoryName = n => n.length >= 3 && n.length <= 40 && /^[\p{L}\p{N}][\p{L}\p{N} &,'’().+/-]*$/u.test(n) && /\p{L}{2}/u.test(n);
const nameKey = n => cleanName(n).toLowerCase();
// A category or one of its subcategories with this name, in any language.
async function findCategoryByName(name) {
  const key = nameKey(name), cats = await categories(), names = x => [x.name, x.nameEt, x.nameRu].filter(Boolean).map(nameKey);
  const direct = cats.find(c => names(c).includes(key));
  if (direct) return { category: direct, subcategory: null };
  for (const c of cats) { const sub = c.subcategories.find(x => names(x).includes(key)); if (sub) return { category: c, subcategory: sub }; }
  return null;
}
const categoryById = async id => (await categories()).find(c => c.id === id) || null;
// Documents needed to be verified: the category's, or a government ID for the optional badge.
const requiredDocsFor = cat => (cat?.requiredDocuments?.length ? cat.requiredDocuments : ['GOVERNMENT_ID']);

/* ---------- Freelancer profile (onboarding) ---------- */
const PRICING_TYPES = ['HOURLY', 'FIXED_PACKAGE', 'PER_EVENT'];
const SLOT_MINUTES = [30, 45, 60, 90, 120, 180, 240, 300, 360, 480];
const DOC_TYPES = ['GOVERNMENT_ID', 'DRIVERS_LICENSE', 'BACKGROUND_CHECK'];
const DOC_LABELS = { GOVERNMENT_ID: 'government ID', DRIVERS_LICENSE: 'driver’s licence', BACKGROUND_CHECK: 'background check' };
// Unique, trimmed, non-empty strings, capped in count and length.
const cleanList = (v, max, len = 40) => [...new Set((Array.isArray(v) ? v : []).map(x => String(x ?? '').trim().slice(0, len)).filter(Boolean))].slice(0, max);
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

// Columns to save from the onboarding form; `cur` is the user's current row.
async function cleanProfile(data, cur) {
  const cat = await categoryById(String(data.category ?? cur.category ?? ''));
  const city = CITIES[data.city] ? String(data.city) : '', area = (CITIES[city] || []).includes(data.area) ? String(data.area) : '';
  const subIds = new Set((cat?.subcategories || []).map(x => x.id));
  const tutoring = cat?.id === 'tutoring';
  return {
    category: cat ? cat.id : '',
    subcategories: json(cleanList(data.subcategories, 10).filter(x => subIds.has(x))),
    custom_subcategories: json(cleanList(data.customSubcategories, 8)),
    ...(data.skills === undefined ? {} : { skills: json(cleanList(data.skills, 20)) }),
    title: String(data.title ?? '').trim().slice(0, 60),
    specialty: String(data.specialty ?? '').trim().slice(0, 80),
    city, area,
    service_areas: json(cleanList(data.serviceAreas, 40).filter(a => (CITIES[city] || []).includes(a))),
    travel_radius_km: clampInt(data.travelRadiusKm, 0, 300, 15),
    tutor_subjects: json(tutoring ? cleanList(data.tutorSubjects, 30) : []),
    tutor_levels: json(tutoring ? cleanList(data.tutorLevels, 12) : []),
    pricing_type: PRICING_TYPES.includes(data.pricingType) ? data.pricingType : 'HOURLY',
    price_amount: Math.min(100000, Math.max(0, Math.round((Number(data.priceAmount) || 0) * 100) / 100)),
    price_unit_label: String(data.priceUnitLabel ?? '').trim().slice(0, 40) || null,
    service_perks: json(cleanList(data.servicePerks, 12, 60)),
    weekly_availability: json(cleanWeekly(data.weeklyAvailability)),
    slot_duration_minutes: SLOT_MINUTES.includes(Number(data.slotDurationMinutes)) ? Number(data.slotDurationMinutes) : 60,
    available_for_urgent: !!data.availableForUrgent,
  };
}

// The newest document of each type for a user.
async function latestDocuments(userId, ex = db) {
  const docs = await ex.selectFrom('wl_verification_documents').select(['id', 'document_type', 'status', 'reason', 'uploaded_at'])
    .where('user_id', '=', userId).orderBy('uploaded_at', 'desc').orderBy('id', 'desc').execute();
  const latest = {};
  for (const d of docs) if (!latest[d.document_type]) latest[d.document_type] = d;
  return latest;
}

// What still stops a freelancer from finishing onboarding.
async function onboardingProblem(p, userId) {
  const cat = await categoryById(p.category);
  if (!cat) return 'Please choose a category.';
  if (!p.specialty) return 'Please tell customers your speciality.';
  if (cat.serviceType !== 'REMOTE' && (!p.city || !p.area)) return 'Please choose your city and area.';
  if (cat.id === 'tutoring' && !JSON.parse(p.tutor_subjects).length) return 'Please choose at least one subject you teach.';
  if (cat.id === 'tutoring' && !JSON.parse(p.tutor_levels).length) return 'Please choose at least one class or level you teach.';
  if (!(p.price_amount > 0)) return 'Please set your price.';
  if (!Object.keys(JSON.parse(p.weekly_availability)).length) return 'Please set the days and hours you are available.';
  if (cat.requiresVerification) {
    const latest = await latestDocuments(userId);
    const missing = cat.requiredDocuments.find(t => !latest[t] || latest[t].status === 'REJECTED');
    if (missing) return `Please upload your ${DOC_LABELS[missing]} for verification.`;
  }
  return null;
}

// Work out a user's verification status from their newest documents and their category.
async function recomputeVerification(userId, ex = db) {
  const u = await ex.selectFrom('wl_users').select('category').where('id', '=', userId).executeTakeFirst();
  const latest = await latestDocuments(userId, ex);
  const need = requiredDocsFor(await categoryById(u?.category)).map(t => latest[t]);
  const rejected = need.find(d => d && d.status === 'REJECTED');
  const status = need.every(d => d && d.status === 'APPROVED') ? 'verified' : rejected ? 'rejected' : need.some(d => d && d.status === 'PENDING') ? 'pending' : 'none';
  await ex.updateTable('wl_users').set({ ver_status: status, ver_reason: rejected ? rejected.reason : null }).where('id', '=', userId).execute();
  return status;
}

/* Pay the freelancer for approved work. Stripe: release the held payment. Manual mode (or jobs from
   before Stripe): credit the balance. Returns false if there was nothing to pay, e.g. it was refunded. */
async function settle(ref, sellerId, amount) {
  if (await payments.release(ref)) return true;
  if (!sellerId || await payments.hasPayment(ref)) return false;
  await db.updateTable('wl_users').set({ balance: sql`balance + ${netOf(amount)}` }).where('id', '=', sellerId).execute();
  return true;
}

// Documents and proof: real photos or PDFs, judged by their contents.
const detectFile = buf => detectImage(buf) || (buf.subarray(0, 5).toString('latin1') === '%PDF-' ? { type: 'application/pdf' } : null);
const MAX_PROOFS = 5; // per person and payment
const addProof = (ex, paymentId, userId, file, kind) => ex.insertInto('wl_payment_proofs').values({ payment_id: paymentId, user_id: userId, file_name: String(file.originalname || '').slice(0, 120), mime: kind.type, data: file.buffer }).execute();

/* ---------- Bookings ---------- */
const ACTIVE_BOOKING = ['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'];
const bookable = f => !!(f && f.is_freelancer && f.onboarding_completed_at);
const busyFor = (freelancerId, date, ex = db) => ex.selectFrom('wl_bookings').select(['start_time as start', 'end_time as end'])
  .where('freelancer_id', '=', freelancerId).where('booking_date', '=', date).where('status', 'in', ACTIVE_BOOKING).execute();
// Minutes from now (Estonian time) until a booking starts; negative once it has started.
const minutesUntil = b => { const n = localNow(); return daysBetween(n.date, b.booking_date) * 1440 + toMinutes(b.start_time) - n.minutes; };
const getBooking = id => db.selectFrom('wl_bookings').selectAll().where('id', '=', Number(id) || 0).executeTakeFirst();

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
const SECURE_COOKIES = String(process.env.PUBLIC_URL || '').startsWith('https://');
function setAuth(res, token) {
  res.append('Set-Cookie', `worklay_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${SECURE_COOKIES ? '; Secure' : ''}`);
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
          .values({ name: String(claims.name || email.split('@')[0]).slice(0, 60), email, pw_hash: '', google_id: googleId, is_freelancer: saved.intent === 'work', terms_version: TERMS_VERSION, terms_accepted_at: sql`now()` })
          .returning('id').executeTakeFirstOrThrow();
        created = true;
        mailer.sendWelcome({ email, name: String(claims.name || ''), isFreelancer: saved.intent === 'work' }, publicOrigin(req));
      }
    }
    await login(res, u.id);
    return res.redirect(created ? (saved.intent === 'work' ? '/#/onboarding?welcome=google' : '/#/dashboard/settings?welcome=google') : '/#/?signed_in=google');
  } catch (error) {
    console.error(error);
    return fail('google_failed');
  }
});

/* ---------- JSON API: /api?r=<route> ---------- */
const bad = (res, error, status = 400) => res.status(status).json({ error });

/* ---------- Profile photos ---------- */
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } });
app.post('/api/profile/photo', (req, res, next) => photoUpload.single('photo')(req, res, err => {
  if (err) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'The photo is too large (max 3 MB).' : 'The upload failed. Please try again.');
  next();
}), async (req, res) => {
  try {
    const u = await me(req);
    if (!u) return bad(res, 'Please log in first.', 401);
    if (!storage.enabled) return bad(res, 'Photo uploads are not set up.');
    if (!req.file) return bad(res, 'Please choose a photo.');
    const img = detectImage(req.file.buffer); // check the real file contents, not the name
    if (!img) return bad(res, 'Please upload a JPG, PNG or WebP image.');
    const key = `avatars/${u.id}/${crypto.randomUUID()}.${img.ext}`;
    await storage.put(key, req.file.buffer, img.type);
    await db.updateTable('wl_users').set({ avatar_key: key }).where('id', '=', u.id).execute();
    if (u.avatar_key) storage.remove(u.avatar_key).catch(e => console.error('Could not delete old photo', u.avatar_key, e.message));
    return res.json({ ok: true, url: storage.urlFor(key) });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(502).json({ error: 'Could not save the photo. Please try again.' });
  }
});

// Serves photos from the private bucket. Every upload gets a new random name, so browsers and
// Cloudflare can cache each file forever.
app.get('/api/files/avatars/:uid/:file', async (req, res) => {
  const { uid, file } = req.params;
  if (!storage.enabled || !/^\d+$/.test(uid) || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(file)) return res.status(404).end();
  try {
    const obj = await storage.get(`avatars/${uid}/${file}`);
    if (!obj) return res.status(404).end();
    res.setHeader('Content-Type', obj.headers.get('content-type') || 'application/octet-stream');
    if (obj.headers.get('content-length')) res.setHeader('Content-Length', obj.headers.get('content-length'));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    Readable.fromWeb(obj.body).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(502).end();
  }
});

app.all('/api', upload.single('doc'), async (req, res) => {
  const route = String(req.query.r || '');
  const data = req.method === 'POST' ? (req.body || {}) : {};
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  // Cross-site request forgery: changes must come from Worklay's own pages. Browsers always send
  // Origin on cross-site POSTs; same-origin requests and non-browser clients may omit it.
  if (req.method === 'POST' && req.headers.origin) {
    let ok = false;
    try { const o = new URL(req.headers.origin); ok = o.host === String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim() || o.origin === publicOrigin(req); } catch { ok = false; }
    if (!ok) return bad(res, 'Request blocked.', 403);
  }
  if (req.method === 'POST' && (route === 'auth/login' || route === 'auth/register')) {
    const ip = clientIp(req), email = String(data.email || '').toLowerCase();
    const limited = route === 'auth/login'
      ? tooManyAttempts(`login:${ip}`, 30, 15 * 60_000) || tooManyAttempts(`login:${email}`, 10, 15 * 60_000)
      : tooManyAttempts(`register:${ip}`, 10, 60 * 60_000);
    if (limited) return bad(res, 'Too many attempts. Please wait a few minutes and try again.', 429);
  }
  try {
    const user = await me(req);
    const requireLogin = () => { if (!user) bad(res, 'Please log in first.', 401); return user; };
    // Logged in and has accepted the current Terms of Service.
    const requireTerms = () => {
      const u = requireLogin(); if (!u) return null;
      if (u.terms_version !== TERMS_VERSION) { res.status(403).json({ error: 'Please accept the updated Terms of Service first.', code: 'TERMS' }); return null; }
      return u;
    };
    const requireAdmin = () => { if (!user || user.role !== 'admin') { bad(res, 'Admins only.', 403); return null; } return user; };

    if (req.method === 'GET' && route === 'bootstrap') return res.json(await bootstrap(user));
    if (req.method === 'GET' && route === 'admin/verification-file') {
      if (!requireAdmin()) return;
      const doc = await db.selectFrom('wl_verification_documents').select(['mime', 'data', 'file_name']).where('id', '=', Number(req.query.id) || 0).executeTakeFirst();
      if (!doc || !doc.data) return bad(res, 'This file is no longer stored (documents are deleted once reviewed).', 404);
      res.setHeader('Content-Type', doc.mime);
      res.setHeader('Content-Disposition', `inline; filename="${String(doc.file_name).replace(/[^\w.-]/g, '_') || 'document'}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(doc.data);
    }
    // Proof attached to a reported problem: only the two sides of the payment and admins may see it.
    if (req.method === 'GET' && route === 'payment/proof-file') {
      const u = requireLogin(); if (!u) return;
      const x = await db.selectFrom('wl_payment_proofs as x').innerJoin('wl_payments as p', 'p.id', 'x.payment_id').select(['x.mime', 'x.data', 'x.file_name', 'p.buyer_id', 'p.seller_id']).where('x.id', '=', Number(req.query.id) || 0).executeTakeFirst();
      if (!x || (u.role !== 'admin' && u.id !== x.buyer_id && u.id !== x.seller_id)) return bad(res, 'File not found.', 404);
      if (!x.data) return bad(res, 'This file is no longer stored.', 404);
      res.setHeader('Content-Type', x.mime);
      res.setHeader('Content-Disposition', `inline; filename="${String(x.file_name).replace(/[^\w.-]/g, '_') || 'proof'}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(x.data);
    }
    // Bookable start times for one freelancer on one date.
    if (req.method === 'GET' && route === 'slots') {
      if (payments.enabled) await payments.cleanupAbandoned();
      const f = await db.selectFrom('wl_users').selectAll().where('id', '=', Number(req.query.freelancer) || 0).executeTakeFirst();
      if (!bookable(f)) return bad(res, 'This freelancer is not taking bookings.', 404);
      const options = durationOptions(f.pricing_type, f.slot_duration_minutes);
      const duration = options.includes(Number(req.query.duration)) ? Number(req.query.duration) : options[0];
      const date = String(req.query.date || '');
      const r = generateSlots({ weekly: f.weekly_availability, slotMinutes: f.slot_duration_minutes, durationMinutes: duration, date,
        busy: isDate(date) ? await busyFor(f.id, date) : [], urgent: f.available_for_urgent });
      return res.json({ ok: true, date, duration, durationOptions: options, slots: r.slots, reason: r.reason, price: priceFor(f.pricing_type, f.price_amount, duration) });
    }
    if (req.method !== 'POST') return bad(res, 'Not found.', 404);

    switch (route) {
      case 'auth/register': {
        if (!data.email || !data.password) return bad(res, 'Email and password are required.');
        if (String(data.password).length < 8) return bad(res, 'Password must be at least 8 characters.');
        if (data.terms !== true) return bad(res, 'Please accept the Terms of Service.');
        // Freelancers fill in their service profile on the onboarding page right after signing up.
        const work = data.intent === 'work', category = (await categoryById(String(data.category || ''))) ? String(data.category) : '';
        try {
          const u = await db.insertInto('wl_users').values({
            name: String(data.name || ''), email: String(data.email).toLowerCase(), pw_hash: passwordHash(String(data.password)),
            title: String(data.title || ''), city: String(data.city || ''), area: String(data.area || ''),
            is_freelancer: work, category: work ? category : '', terms_version: TERMS_VERSION, terms_accepted_at: sql`now()`,
          }).returning('id').executeTakeFirstOrThrow();
          await login(res, u.id);
          mailer.sendWelcome({ email: String(data.email).toLowerCase(), name: String(data.name || ''), isFreelancer: work }, publicOrigin(req));
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
        res.setHeader('Set-Cookie', `worklay_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE_COOKIES ? '; Secure' : ''}`);
        return res.json({ ok: true });
      }
      case 'profile/update': {
        const u = requireLogin(); if (!u) return;
        try {
          const city = String(data.city || '');
          await db.updateTable('wl_users').set({
            name: String(data.name || u.name), email: String(data.email || u.email).toLowerCase(), title: String(data.title || ''),
            city, area: String(data.area || ''), is_freelancer: !!data.isFreelancer, bio: String(data.bio || ''), skills: json(skillList(data.skills)),
            service_areas: json(list(u.service_areas).filter(a => (CITIES[city] || []).includes(a))), // areas only make sense within the city
          }).where('id', '=', u.id).execute();
        } catch (e) {
          if (isUniqueViolation(e)) return bad(res, 'Another account already uses that email.');
          throw e;
        }
        return res.json({ ok: true });
      }
      case 'profile/photo-remove': {
        const u = requireLogin(); if (!u) return;
        if (u.avatar_key) {
          await db.updateTable('wl_users').set({ avatar_key: null }).where('id', '=', u.id).execute();
          if (storage.enabled) storage.remove(u.avatar_key).catch(e => console.error('Could not delete photo', u.avatar_key, e.message));
        }
        return res.json({ ok: true });
      }
      case 'project/create': {
        const u = requireTerms(); if (!u) return;
        const p = await db.insertInto('wl_projects').values({
          owner_id: u.id, title: String(data.title || ''), category: String(data.category || ''), description: String(data.description || ''),
          budget_min: Number(data.min || 0), budget_max: Number(data.max || 0), deadline: String(data.deadline || ''), skills: json(skillList(data.skills)),
          city: String(data.city || ''), area: String(data.area || ''), remote: !!data.remote,
        }).returning('id').executeTakeFirstOrThrow();
        return res.json({ ok: true, id: sid(p.id) });
      }
      case 'service/create': {
        const u = requireTerms(); if (!u) return;
        const s = await db.insertInto('wl_services').values({
          seller_id: u.id, title: String(data.title || ''), category: String(data.category || ''), emoji: String(data.emoji || '💼'),
          description: String(data.description || ''), packages: json(list(data.packages)),
        }).returning('id').executeTakeFirstOrThrow();
        return res.json({ ok: true, id: sid(s.id) });
      }
      case 'proposal/create': {
        const u = requireTerms(); if (!u) return;
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
      case 'proposal/award': return mutateProjectAward(req, res, requireTerms(), data);
      case 'project/complete': return mutateProjectComplete(res, requireLogin(), data);
      case 'order/create': return mutateOrder(req, res, requireTerms(), data);
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
      case 'terms/accept': {
        const u = requireLogin(); if (!u) return;
        if (data.version !== TERMS_VERSION) return bad(res, 'The terms have changed. Please reload the page.');
        await db.updateTable('wl_users').set({ terms_version: TERMS_VERSION, terms_accepted_at: sql`now()` }).where('id', '=', u.id).execute();
        return res.json({ ok: true });
      }
      // A freelancer adds a category that doesn't exist yet. If one with that name does, it's used instead.
      case 'category/create': {
        const u = requireTerms(); if (!u) return;
        if (!u.is_freelancer) return bad(res, 'Only freelancers can add a category.');
        const name = cleanName(data.name);
        if (!validCategoryName(name)) return bad(res, 'Please enter a category name of 3 to 40 letters.');
        if (!['REMOTE', 'ON_SITE', 'HYBRID'].includes(data.serviceType)) return bad(res, 'Please choose where you work.');
        const found = await findCategoryByName(name);
        if (found) return res.json({ ok: true, existing: true, id: found.category.id, name: found.category.name, subcategoryId: found.subcategory?.id || null });
        const onSite = data.serviceType !== 'REMOTE'; // in people's homes: same ID check as other on-site trust categories
        const id = 'own-' + crypto.randomBytes(6).toString('hex');
        try {
          const created = await db.transaction().execute(async trx => {
            await trx.selectFrom('wl_users').select('id').where('id', '=', u.id).forUpdate().execute();
            const { n } = await trx.selectFrom('wl_categories').select(eb => eb.fn.countAll().as('n')).where('created_by', '=', u.id).executeTakeFirstOrThrow();
            if (Number(n) >= MAX_OWN_CATEGORIES) return false;
            await trx.insertInto('wl_categories').values({
              id, name, name_et: name, name_ru: name, icon: CATEGORY_ICONS.includes(data.icon) ? data.icon : CATEGORY_ICONS[0], color: CATEGORY_COLORS[u.id % CATEGORY_COLORS.length],
              service_type: data.serviceType, requires_verification: onSite, required_documents: json(onSite ? ['GOVERNMENT_ID'] : []), sort_order: 1000, status: 'NEW', created_by: u.id,
            }).execute();
            for (const a of await trx.selectFrom('wl_users').select('id').where('role', '=', 'admin').execute()) await notify(a.id, 'system', `${u.name} created a new category: ${name}`, '#/admin/categories', trx);
            return true;
          });
          if (!created) return bad(res, `You can create up to ${MAX_OWN_CATEGORIES} categories. Contact us if you need more.`);
        } catch (e) {
          if (!isUniqueViolation(e)) throw e; // someone else just created it
          forgetCategories();
          const same = await findCategoryByName(name);
          if (!same) throw e;
          return res.json({ ok: true, existing: true, id: same.category.id, name: same.category.name, subcategoryId: null });
        }
        forgetCategories();
        return res.json({ ok: true, existing: false, id, name });
      }
      case 'admin/category': {
        if (!requireAdmin()) return;
        const cat = await categoryById(String(data.id || ''));
        if (!cat) return bad(res, 'Category not found.', 404);
        if (data.action === 'merge') { // move everyone to another category and remove this one
          if (!cat.id.startsWith('own-')) return bad(res, 'Only categories created by freelancers can be merged.');
          const target = await categoryById(String(data.target || ''));
          if (!target || target.id === cat.id) return bad(res, 'Please choose another category to merge into.');
          const moved = await db.transaction().execute(async trx => {
            const users = await trx.updateTable('wl_users').set({ category: target.id, subcategories: json([]) }).where('category', '=', cat.id).returning('id').execute();
            for (const t of ['wl_services', 'wl_projects']) await trx.updateTable(t).set({ category: target.id }).where('category', '=', cat.id).execute();
            await trx.updateTable('wl_bookings').set({ service_category_id: target.id }).where('service_category_id', '=', cat.id).execute();
            // Keep what they called it as one of their own specialisations.
            for (const { id } of users) {
              const row = await trx.selectFrom('wl_users').select('custom_subcategories').where('id', '=', id).executeTakeFirst();
              await trx.updateTable('wl_users').set({ custom_subcategories: json(cleanList([cat.name, ...list(row.custom_subcategories)], 8)) }).where('id', '=', id).execute();
              await notify(id, 'system', `Your category “${cat.name}” was merged into “${target.name}”. It is now listed as your specialisation.`, '#/onboarding', trx);
            }
            await trx.deleteFrom('wl_categories').where('id', '=', cat.id).execute();
            return users.map(x => x.id);
          });
          forgetCategories();
          for (const id of moved) await recomputeVerification(id);
          return res.json({ ok: true, moved: moved.length });
        }
        if (data.action !== 'save') return bad(res, 'Unknown action.');
        const names = { name: cleanName(data.name), name_et: cleanName(data.nameEt), name_ru: cleanName(data.nameRu) };
        if (!Object.values(names).every(validCategoryName)) return bad(res, 'Names must be 3 to 40 letters.');
        const needsId = !!data.requiresVerification;
        try {
          await db.updateTable('wl_categories').set({ ...names, status: 'APPROVED', requires_verification: needsId,
            required_documents: json(needsId ? (cat.requiredDocuments.length ? cat.requiredDocuments : ['GOVERNMENT_ID']) : []) }).where('id', '=', cat.id).execute();
        } catch (e) { if (isUniqueViolation(e)) return bad(res, 'Another category already has that name.'); throw e; }
        forgetCategories();
        if (needsId !== cat.requiresVerification) for (const { id } of await db.selectFrom('wl_users').select('id').where('category', '=', cat.id).execute()) await recomputeVerification(id);
        if (cat.status === 'NEW' && cat.createdBy) await notify(Number(cat.createdBy), 'system', `Your category “${names.name}” was approved.`, '#/onboarding');
        return res.json({ ok: true });
      }
      // The freelancer says the work is done; the client is asked to approve it, which pays them.
      case 'project/deliver': {
        const u = requireLogin(); if (!u) return;
        const pr = await db.selectFrom('wl_projects').selectAll().where('id', '=', Number(data.id) || 0).executeTakeFirst();
        if (!pr || pr.awarded_to !== u.id) return bad(res, 'Project not found.', 404);
        const r = await db.updateTable('wl_projects').set({ delivered_at: sql`now()` }).where('id', '=', pr.id).where('status', '=', 'awarded').where('delivered_at', 'is', null).executeTakeFirst();
        if (!changed(r)) return bad(res, 'This project can’t be marked as done.');
        await notify(pr.owner_id, 'project', `${u.name} marked “${pr.title}” as done. Please check the work and release the payment.${await payments.delivered({ projectId: pr.id })}`, `#/project/${pr.id}`, db, 'Work is done: please check it');
        return res.json({ ok: true });
      }
      case 'booking/deliver': {
        const u = requireLogin(); if (!u) return;
        const b = await getBooking(data.id);
        if (!b || b.freelancer_id !== u.id) return bad(res, 'Booking not found.', 404);
        if (minutesUntil(b) > 0) return bad(res, 'You can mark the booking as done once it has started.');
        const r = await db.updateTable('wl_bookings').set({ delivered_at: sql`now()`, updated_at: sql`now()` }).where('id', '=', b.id).where('status', '=', 'CONFIRMED').where('delivered_at', 'is', null).executeTakeFirst();
        if (!changed(r)) return bad(res, 'This booking can’t be marked as done.');
        await notify(b.client_id, 'booking', `${u.name} marked your booking on ${b.booking_date} as done. Please approve it to release the payment.${await payments.delivered({ bookingId: b.id })}`, '#/dashboard/bookings', db, 'Work is done: please check it');
        return res.json({ ok: true });
      }
      // Either side asks Worklay to look at a payment that is still held. Clients must attach proof;
      // the automatic payment stops until an admin decides.
      case 'payment/problem': {
        const u = requireLogin(); if (!u) return;
        const reason = String(data.reason || '').trim().slice(0, 1000);
        if (reason.length < 10) return bad(res, 'Please describe the problem in a sentence or two.');
        const pay = await payments.getPayment(Number(data.id) || 0);
        if (!pay || (pay.buyer_id !== u.id && pay.seller_id !== u.id)) return bad(res, 'Payment not found.', 404);
        const proof = req.file ? detectFile(req.file.buffer) : null;
        if (req.file && !proof) return bad(res, 'Please upload a photo (JPG, PNG, WebP) or a PDF.');
        if (!proof && pay.buyer_id === u.id) return bad(res, 'Please add proof, such as a photo or a screenshot of your messages.');
        const saved = await db.transaction().execute(async trx => {
          const r = await trx.updateTable('wl_payments').set({ problem_reason: reason, problem_by: u.id, problem_at: sql`now()` }).where('id', '=', pay.id).where('status', '=', 'paid').where('problem_at', 'is', null).executeTakeFirst();
          if (changed(r) && proof) await addProof(trx, pay.id, u.id, req.file, proof);
          return changed(r);
        });
        if (!saved) return bad(res, pay.problem_at ? 'A problem has already been reported for this payment.' : 'This payment is no longer held.');
        const other = pay.buyer_id === u.id ? pay.seller_id : pay.buyer_id;
        await notify(other, 'payment', `${u.name} reported a problem with a payment of €${pay.amount}. The money stays held and Worklay decides within ${APPROVAL_DAYS} days. You can add your own proof.`, '#/dashboard', db, 'A problem was reported');
        for (const a of await db.selectFrom('wl_users').select('id').where('role', '=', 'admin').execute()) await notify(a.id, 'payment', `Payment #${pay.id}: ${u.name} reported a problem. Please decide within ${APPROVAL_DAYS} days.`, '#/admin', db, 'A problem was reported');
        return res.json({ ok: true });
      }
      // More proof for a reported problem, from either side.
      case 'payment/proof': {
        const u = requireLogin(); if (!u) return;
        if (!req.file) return bad(res, 'Please choose a file.');
        const kind = detectFile(req.file.buffer);
        if (!kind) return bad(res, 'Please upload a photo (JPG, PNG, WebP) or a PDF.');
        const error = await db.transaction().execute(async trx => {
          const pay = await trx.selectFrom('wl_payments').selectAll().where('id', '=', Number(data.id) || 0).forUpdate().executeTakeFirst(); // the lock keeps the limit exact
          if (!pay || (pay.buyer_id !== u.id && pay.seller_id !== u.id)) return 'Payment not found.';
          if (!pay.problem_at || pay.status !== 'paid') return 'Proof can only be added while Worklay is looking at a problem.';
          const { n } = await trx.selectFrom('wl_payment_proofs').select(sql`count(*)::int`.as('n')).where('payment_id', '=', pay.id).where('user_id', '=', u.id).executeTakeFirstOrThrow();
          if (n >= MAX_PROOFS) return `You can add up to ${MAX_PROOFS} files.`;
          await addProof(trx, pay.id, u.id, req.file, kind);
          return null;
        });
        return error ? bad(res, error) : res.json({ ok: true });
      }
      // An admin decides a held payment: pay the freelancer or refund the client.
      case 'admin/payment-resolve': {
        if (!requireAdmin()) return;
        const pay = await payments.getPayment(Number(data.id) || 0);
        if (!pay) return bad(res, 'Payment not found.', 404);
        if (!payments.enabled) return bad(res, 'Card payments are not set up.');
        if (pay.status !== 'paid') return bad(res, 'This payment is no longer held.');
        const job = { order: ['wl_orders', pay.order_id, 'completed', 'cancelled', 'orderId'], project: ['wl_projects', pay.project_id, 'completed', 'cancelled', 'projectId'], booking: ['wl_bookings', pay.booking_id, 'COMPLETED', 'CANCELLED', 'bookingId'] }[pay.kind];
        const [table, jobId, done, cancelled, key] = job;
        const note = String(data.note || '').trim().slice(0, 300);
        const release = data.action === 'release';
        if (!release && data.action !== 'refund') return bad(res, 'Unknown action.');
        const ok = release ? await payments.release({ [key]: jobId }) : await payments.refund(pay.id, note || 'decided by Worklay');
        if (!ok) return bad(res, 'This payment is no longer held.');
        await db.updateTable(table).set({ status: release ? done : cancelled }).where('id', '=', jobId).execute();
        await notify(pay.seller_id, 'payment', release ? `Worklay released your payment of €${netOf(pay.amount)}.${note ? ' ' + note : ''}` : `Worklay refunded a payment of €${pay.amount} to the client.${note ? ' ' + note : ''}`, '#/dashboard/earnings', db, release ? 'Your payment was released' : 'A payment was refunded');
        if (release) await notify(pay.buyer_id, 'payment', `Worklay released your payment of €${pay.amount} to the freelancer.${note ? ' ' + note : ''}`, '#/dashboard', db, 'Your payment was released to the freelancer');
        return res.json({ ok: true });
      }
      case 'onboarding/save': {
        const u = requireLogin(); if (!u) return;
        if (data.complete && !requireTerms()) return;
        const p = await cleanProfile(data, u);
        if (data.complete) { const problem = await onboardingProblem(p, u.id); if (problem) return bad(res, problem); }
        await db.updateTable('wl_users').set({ ...p, ...(data.complete ? { is_freelancer: true, onboarding_completed_at: sql`coalesce(onboarding_completed_at, now())` } : {}) })
          .where('id', '=', u.id).execute();
        if (p.category !== u.category) await recomputeVerification(u.id); // the documents needed depend on the category
        return res.json({ ok: true });
      }
      case 'verification/document': {
        const u = requireLogin(); if (!u) return;
        const type = String(data.documentType || '');
        if (!DOC_TYPES.includes(type)) return bad(res, 'Please choose the document type.');
        if (!req.file) return bad(res, 'Please choose a file.');
        const kind = detectFile(req.file.buffer);
        if (!kind) return bad(res, 'Please upload a photo (JPG, PNG, WebP) or a PDF.');
        await db.insertInto('wl_verification_documents').values({ user_id: u.id, document_type: type, file_name: String(req.file.originalname || '').slice(0, 120), mime: kind.type, data: req.file.buffer }).execute();
        await recomputeVerification(u.id);
        return res.json({ ok: true });
      }
      case 'admin/verification-review': {
        const admin = requireAdmin(); if (!admin) return;
        const doc = await db.selectFrom('wl_verification_documents').select(['id', 'user_id', 'document_type', 'status']).where('id', '=', Number(data.id) || 0).executeTakeFirst();
        if (!doc) return bad(res, 'Document not found.', 404);
        if (doc.status !== 'PENDING') return bad(res, 'This document has already been reviewed.');
        const status = await db.transaction().execute(async trx => {
          // The file is deleted once reviewed; the record of the check stays.
          await trx.updateTable('wl_verification_documents').set({ status: data.ok ? 'APPROVED' : 'REJECTED', reason: data.ok ? null : String(data.reason || '').slice(0, 300), data: null, reviewed_at: sql`now()`, reviewed_by: admin.id })
            .where('id', '=', doc.id).execute();
          return recomputeVerification(doc.user_id, trx);
        });
        await notify(doc.user_id, 'system', data.ok
          ? (status === 'verified' ? 'Your documents were approved. You are now verified ✓' : `Your ${DOC_LABELS[doc.document_type]} was approved.`)
          : `Your ${DOC_LABELS[doc.document_type]} was not approved${data.reason ? ': ' + String(data.reason).slice(0, 300) : ''}. Please upload it again.`, '#/dashboard/verification');
        return res.json({ ok: true, status });
      }
      case 'booking/create': {
        const u = requireTerms(); if (!u) return;
        const f = await db.selectFrom('wl_users').selectAll().where('id', '=', Number(data.freelancerId) || 0).executeTakeFirst();
        if (!bookable(f)) return bad(res, 'This freelancer is not taking bookings.');
        if (f.id === u.id) return bad(res, 'You can’t book yourself.');
        const cat = await categoryById(f.category);
        if (cat?.requiresVerification && f.ver_status !== 'verified') return bad(res, 'This freelancer can take bookings once Worklay has verified their documents.');
        const duration = Number(data.duration), date = String(data.date || ''), start = String(data.start || '');
        if (!durationOptions(f.pricing_type, f.slot_duration_minutes).includes(duration)) return bad(res, 'Please choose a valid duration.');
        const address = String(data.address || '').trim().slice(0, 200), notes = String(data.notes || '').trim().slice(0, 1000) || null;
        if (cat?.serviceType !== 'REMOTE' && address.length < 5) return bad(res, 'Please enter the address where the work will happen.');
        const price = priceFor(f.pricing_type, f.price_amount, duration);
        if (!(price > 0)) return bad(res, 'This freelancer hasn’t set a price yet.');
        let bookingId = null;
        try {
          bookingId = await db.transaction().execute(async trx => {
            // One booking at a time per freelancer; the exclusion constraint is the final safety net.
            await trx.selectFrom('wl_users').select('id').where('id', '=', f.id).forUpdate().execute();
            const r = generateSlots({ weekly: f.weekly_availability, slotMinutes: f.slot_duration_minutes, durationMinutes: duration, date, busy: isDate(date) ? await busyFor(f.id, date, trx) : [], urgent: f.available_for_urgent });
            if (!r.slots.some(x => x.start === start)) return null;
            const b = await trx.insertInto('wl_bookings').values({
              client_id: u.id, freelancer_id: f.id, service_category_id: cat?.id ?? null, booking_date: date, start_time: start,
              end_time: toTime(toMinutes(start) + duration), duration_minutes: duration, total_price: price, address: address || 'Online', notes,
              status: payments.enabled ? 'AWAITING_PAYMENT' : 'PENDING',
            }).returning('id').executeTakeFirstOrThrow();
            return b.id;
          });
        } catch (e) { if (!isExclusionViolation(e)) throw e; }
        if (!bookingId) return bad(res, 'Sorry, that time is no longer available. Please pick another time.', 409);
        if (payments.enabled) {
          try {
            const { url } = await payments.startCheckout(req, { kind: 'booking', buyer: u, sellerId: f.id, amount: price, title: `Booking with ${f.name}: ${date} ${start}`, bookingId });
            return res.json({ ok: true, id: sid(bookingId), checkoutUrl: url });
          } catch (e) {
            await db.updateTable('wl_bookings').set({ status: 'CANCELLED', updated_at: sql`now()` }).where('id', '=', bookingId).execute();
            throw e;
          }
        }
        await notify(f.id, 'booking', `${u.name} requested a booking on ${date} at ${start} (€${price}). Please confirm it.`, '#/dashboard/bookings', db, 'New booking request');
        await notify(u.id, 'booking', `Your booking request to ${f.name} for ${date} at ${start} (€${price}) was sent. We’ll let you know when they answer.`, '#/dashboard/bookings', db, 'Your booking request was sent');
        return res.json({ ok: true, id: sid(bookingId) });
      }
      case 'booking/respond': {
        const u = requireLogin(); if (!u) return;
        const b = await getBooking(data.id);
        if (!b || b.freelancer_id !== u.id) return bad(res, 'Booking not found.', 404);
        const accept = !!data.accept;
        const r = await db.updateTable('wl_bookings').set(accept ? { status: 'CONFIRMED', updated_at: sql`now()` } : { status: 'CANCELLED', cancelled_by: u.id, cancel_reason: String(data.reason || 'Declined by the freelancer').slice(0, 300), updated_at: sql`now()` })
          .where('id', '=', b.id).where('status', '=', 'PENDING').executeTakeFirst();
        if (!changed(r)) return bad(res, 'This booking can’t be changed any more.');
        if (!accept) await payments.refundBooking(b.id, 'The freelancer declined the booking');
        await notify(b.client_id, 'booking', accept ? `Your booking on ${b.booking_date} at ${b.start_time} was confirmed ✓` : `Your booking on ${b.booking_date} at ${b.start_time} was declined${payments.enabled ? ' and refunded' : ''}.`, '#/dashboard/bookings', db, accept ? 'Your booking is confirmed' : 'Your booking was declined');
        return res.json({ ok: true });
      }
      case 'booking/cancel': {
        const u = requireLogin(); if (!u) return;
        const b = await getBooking(data.id);
        const isClient = b && b.client_id === u.id, isFreelancer = b && b.freelancer_id === u.id;
        if (!isClient && !isFreelancer) return bad(res, 'Booking not found.', 404);
        if (!ACTIVE_BOOKING.includes(b.status)) return bad(res, 'This booking can’t be cancelled any more.');
        if (b.status === 'AWAITING_PAYMENT' && !isClient) return bad(res, 'This booking can’t be cancelled any more.');
        if (isClient && b.status === 'CONFIRMED' && minutesUntil(b) < 24 * 60) return bad(res, 'Confirmed bookings can be cancelled up to 24 hours before the start. Please message the freelancer.');
        if (b.status === 'AWAITING_PAYMENT') {
          const p = await db.selectFrom('wl_payments').selectAll().where('kind', '=', 'booking').where('booking_id', '=', b.id).where('status', 'in', ['pending', 'processing']).executeTakeFirst();
          if (p) await payments.cancelPayment(p);
        }
        const r = await db.updateTable('wl_bookings').set({ status: 'CANCELLED', cancelled_by: u.id, cancel_reason: String(data.reason || '').slice(0, 300) || null, updated_at: sql`now()` })
          .where('id', '=', b.id).where('status', 'in', ACTIVE_BOOKING).executeTakeFirst();
        if (!changed(r)) return bad(res, 'This booking can’t be cancelled any more.');
        const refunded = await payments.refundBooking(b.id, `Booking cancelled by the ${isClient ? 'client' : 'freelancer'}`);
        if (b.status !== 'AWAITING_PAYMENT') await notify(isClient ? b.freelancer_id : b.client_id, 'booking', `The booking on ${b.booking_date} at ${b.start_time} was cancelled by ${u.name}${refunded ? '; the payment was refunded' : ''}.`, '#/dashboard/bookings', db, 'A booking was cancelled');
        return res.json({ ok: true, refunded });
      }
      case 'booking/complete': {
        const u = requireLogin(); if (!u) return;
        const b = await getBooking(data.id);
        if (!b || b.client_id !== u.id) return bad(res, 'Booking not found.', 404);
        if (b.status !== 'CONFIRMED') return bad(res, 'Only confirmed bookings can be marked as completed.');
        if (minutesUntil(b) > 0) return bad(res, 'You can mark the booking as completed once it has started.');
        if (!changed(await db.updateTable('wl_bookings').set({ status: 'COMPLETED', updated_at: sql`now()` }).where('id', '=', b.id).where('status', '=', 'CONFIRMED').executeTakeFirst())) return res.json({ ok: true });
        if (await settle({ bookingId: b.id }, b.freelancer_id, b.total_price)) await notify(b.freelancer_id, 'payment', `The client marked the booking on ${b.booking_date} as completed and released the payment.`, '#/dashboard/earnings', db, 'Your work was approved');
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

  const [users, orderStats, projectStats, services, projects, proposals, orders, reviews, messages, notifications, wishlist, follows, payouts, posts, paymentList, payoutSummary, bookings, myDocuments, pendingDocuments, categoryList, contacts] = await Promise.all([
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
    // Freelancers don't see a booking until it's paid.
    mid ? db.selectFrom('wl_bookings').selectAll()
      .where(eb => eb.or([eb('client_id', '=', mid), eb.and([eb('freelancer_id', '=', mid), eb('status', '<>', 'AWAITING_PAYMENT')])]))
      .orderBy('booking_date', 'desc').orderBy('start_time', 'desc').execute() : none,
    mid ? db.selectFrom('wl_verification_documents').select(['id', 'document_type', 'status', 'reason', 'uploaded_at']).where('user_id', '=', mid).orderBy('uploaded_at', 'desc').execute() : none,
    admin ? db.selectFrom('wl_verification_documents').select(['id', 'user_id', 'document_type', 'file_name', 'mime', 'uploaded_at', sql`data is not null`.as('has_file')])
      .where('status', '=', 'PENDING').orderBy('uploaded_at').execute() : none,
    categories(),
    admin ? db.selectFrom('wl_contacts').selectAll().orderBy('id', 'desc').limit(200).execute() : none,
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
        category: u.category, role: u.role, color: u.color, joined: iso(u.created_at), avatarUrl: storage.urlFor(u.avatar_key),
        specialty: u.specialty, subcategories: list(u.subcategories), customSubcategories: list(u.custom_subcategories), serviceAreas: list(u.service_areas), travelRadiusKm: u.travel_radius_km,
        tutorSubjects: list(u.tutor_subjects), tutorLevels: list(u.tutor_levels),
        pricingType: u.pricing_type, priceAmount: u.price_amount, priceUnitLabel: u.price_unit_label, servicePerks: list(u.service_perks),
        weeklyAvailability: u.weekly_availability || {}, slotDurationMinutes: u.slot_duration_minutes, availableForUrgent: u.available_for_urgent,
        onboarded: !!u.onboarding_completed_at,
        verification: { status: u.ver_status },
        stats: { inQueue: oStats.get(u.id)?.in_queue || 0, doneServices: oStats.get(u.id)?.done || 0, doneProjects: pStats.get(u.id) || 0 },
        balance: self ? u.balance : 0,
      };
      if (self && payoutSummary) out.payouts = payoutSummary;
      if (self || admin) {
        out.email = u.email;
        out.termsAccepted = u.terms_version === TERMS_VERSION;
        out.verification = { status: u.ver_status, reason: u.ver_reason };
      }
      return out;
    }),
    services: services.map(s => ({ id: sid(s.id), sellerId: sid(s.seller_id), title: s.title, category: s.category, emoji: s.emoji, color: s.color, description: s.description, packages: list(s.packages), created: iso(s.created_at) })),
    projects: projects.map(p => ({
      id: sid(p.id), ownerId: sid(p.owner_id), title: p.title, category: p.category, description: p.description,
      budgetMin: p.budget_min, budgetMax: p.budget_max, deadline: p.deadline, skills: list(p.skills),
      city: p.city, area: p.area, remote: p.remote, status: p.status, awardedTo: sid(p.awarded_to),
      awardedAmount: p.awarded_amount, deliveredAt: p.delivered_at && (p.owner_id === mid || p.awarded_to === mid) ? iso(p.delivered_at) : null, proposalCount: p.proposal_count, created: iso(p.created_at),
    })),
    proposals: proposals.map(p => ({ id: sid(p.id), projectId: sid(p.project_id), sellerId: sid(p.seller_id), amount: p.amount, days: p.days, cover: p.cover, status: p.status, created: iso(p.created_at) })),
    orders: orders.map(o => ({ id: sid(o.id), serviceId: sid(o.service_id), pkg: o.pkg, buyerId: sid(o.buyer_id), sellerId: sid(o.seller_id), price: o.price, status: o.status, deliveredAt: iso(o.delivered_at), created: iso(o.created_at) })),
    reviews: reviews.map(r => ({ id: sid(r.id), targetUser: sid(r.target_user), from: sid(r.from_user), serviceId: sid(r.service_id), orderId: sid(r.order_id), projectId: sid(r.project_id), rating: r.rating, text: r.text, date: iso(r.created_at) })),
    messages: messages.map(m => ({ id: sid(m.id), from: sid(m.from_id), to: sid(m.to_id), text: m.text, read: m.is_read, date: iso(m.created_at) })),
    notifications: notifications.map(n => ({ id: sid(n.id), userId: sid(n.user_id), type: n.type, text: n.text, link: n.link, read: n.is_read, date: iso(n.created_at) })),
    wishlist: wishlist.map(w => ({ kind: w.kind, id: sid(w.item_id) })),
    follows: follows.map(f => sid(f.followee)),
    payouts: payouts.map(p => ({ id: sid(p.id), userId: sid(p.user_id), amount: p.amount, method: p.method, details: p.details, status: p.status, date: iso(p.created_at) })),
    posts: posts.map(p => ({ id: sid(p.id), title: p.title, emoji: p.emoji, color: p.color, excerpt: p.excerpt, body: p.body, created: iso(p.created_at) })),
    payments: paymentList,
    bookings: bookings.map(b => ({
      id: sid(b.id), clientId: sid(b.client_id), freelancerId: sid(b.freelancer_id), categoryId: b.service_category_id,
      date: b.booking_date, start: b.start_time, end: b.end_time, duration: b.duration_minutes, totalPrice: b.total_price,
      address: b.address, notes: b.notes, status: b.status, cancelledBy: sid(b.cancelled_by), cancelReason: b.cancel_reason, deliveredAt: b.delivered_at ? iso(b.delivered_at) : null, created: iso(b.created_at),
    })),
    contacts: contacts.map(c => ({ id: sid(c.id), name: c.name, email: c.email, message: c.message, date: iso(c.created_at) })),
    myDocuments: myDocuments.map(d => ({ id: sid(d.id), type: d.document_type, status: d.status, reason: d.reason, uploaded: iso(d.uploaded_at) })),
    pendingDocuments: pendingDocuments.map(d => ({ id: sid(d.id), userId: sid(d.user_id), type: d.document_type, fileName: d.file_name, mime: d.mime, uploaded: iso(d.uploaded_at), hasFile: d.has_file })),
    config: { categories: categoryList, categoryIcons: CATEGORY_ICONS, termsVersion: TERMS_VERSION, approvalDays: APPROVAL_DAYS, slotMinutes: SLOT_MINUTES, cities: CITIES, fee: PLATFORM_FEE, minPayout: MIN_PAYOUT, payoutMethods: ['PayPal', 'Payoneer', 'Bank transfer'], googleAuth: googleEnabled(), cardPayments: payments.enabled, photoUploads: storage.enabled, maxPhotoMb: MAX_PHOTO_BYTES / 1024 / 1024 },
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
    await notify(pr.seller_id, 'project', `You were awarded the project “${project.title}”.`, `#/project/${project.id}`, trx, 'You were awarded a project');
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
  if (await settle({ projectId: p.id }, p.awarded_to, p.awarded_amount || 0)) await notify(p.awarded_to, 'payment', `The customer approved your work on “${p.title}” and released the payment.`, '#/dashboard/earnings', db, 'Your work was approved');
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
  await notify(service.seller_id, 'order', `${u.name} ordered “${service.title}” (€${price}).`, '#/dashboard/selling', db, 'New order');
  await notify(u.id, 'order', `Your order of “${service.title}” (€${price}) was sent to the freelancer.`, '#/dashboard/orders', db, 'Your order was placed');
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
  if (!changed(await db.updateTable('wl_orders').set({ status, ...(status === 'delivered' ? { delivered_at: sql`now()` } : {}) }).where('id', '=', o.id).where('status', 'in', from).executeTakeFirst())) return res.json({ ok: true });
  if (status === 'delivered') await notify(o.buyer_id, 'order', `Your order was delivered. Please review and approve it.${await payments.delivered({ orderId: o.id })}`, '#/dashboard/orders', db, 'Work is done: please check it');
  if (status === 'completed') {
    if (await settle({ orderId: o.id }, o.seller_id, o.price)) await notify(o.seller_id, 'payment', 'The buyer approved your delivery and released the payment.', '#/dashboard/earnings', db, 'Your work was approved');
  }
  return res.json({ ok: true });
}

// Unknown API addresses get a 404 instead of the web page.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// robots.txt, sitemap.xml and server-rendered public pages (see seo.mjs).
const seo = createSeo({ db, categories, publicOrigin, cities: CITIES, indexHtmlPath: path.join(__dirname, 'dist', 'index.html') });
app.get('/robots.txt', seo.robots);
app.get('/sitemap.xml', (req, res, next) => seo.sitemap(req, res).catch(next));

if (!process.argv.includes('--dev')) {
  // index: false so "/" goes through the page renderer instead of the raw index.html.
  app.use(express.static(path.join(__dirname, 'dist'), { index: false }));
  app.get('/{*path}', (req, res, next) => seo.renderPage(req, res).catch(next));
}

const port = process.argv.includes('--dev') ? 3001 : Number(process.env.PORT || 5173);
notifications.start();
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Worklay Node API listening on port ${port}`));

// Close the database pool cleanly when Docker or Ctrl+C stops the server.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); db.destroy().finally(() => process.exit(0)); });
}
