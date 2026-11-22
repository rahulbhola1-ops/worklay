/* One-off import of an old SQLite database (worklay.sqlite) into PostgreSQL.

   npm run db:import-sqlite -- [path/to/worklay.sqlite]

   - Runs the migrations first, then copies every table, keeping the original ids.
   - Refuses to run if the Postgres database already has users (so it can't duplicate data).
   - Converts 0/1 flags to booleans, text dates (UTC) to timestamps and JSON text to jsonb.
   - Rows that point at records which no longer exist are skipped (or the link is cleared if
     it's optional) and listed at the end, because Postgres enforces foreign keys. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createDb, sql } from './index.mjs';
import { migrateToLatest } from './migrate.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* no .env */ }
const sqlitePath = path.resolve(process.argv[2] || process.env.DB_PATH || path.join(root, 'worklay.sqlite'));

const BOOL = new Set(['is_freelancer', 'remote', 'is_read', 'stripe_payouts_ready']);
const JSONB = new Set(['skills', 'packages']);
const TIME = new Set(['created_at', 'expires_at', 'ver_submitted', 'paid_at', 'released_at']);

// Tables in dependency order. `required` links must exist or the row is skipped;
// `optional` links are cleared when they point nowhere.
const TABLES = [
  { name: 'wl_users' },
  { name: 'wl_sessions', required: { user_id: 'wl_users' } },
  { name: 'wl_documents', required: { user_id: 'wl_users' } },
  { name: 'wl_services', required: { seller_id: 'wl_users' } },
  { name: 'wl_projects', required: { owner_id: 'wl_users' }, optional: { awarded_to: 'wl_users' } },
  { name: 'wl_proposals', required: { project_id: 'wl_projects', seller_id: 'wl_users' } },
  { name: 'wl_orders', required: { service_id: 'wl_services', buyer_id: 'wl_users', seller_id: 'wl_users' } },
  { name: 'wl_reviews', required: { target_user: 'wl_users', from_user: 'wl_users' }, optional: { service_id: 'wl_services', order_id: 'wl_orders', project_id: 'wl_projects' } },
  { name: 'wl_messages', required: { from_id: 'wl_users', to_id: 'wl_users' } },
  { name: 'wl_notifications', required: { user_id: 'wl_users' } },
  { name: 'wl_wishlist', required: { user_id: 'wl_users' } },
  { name: 'wl_follows', required: { follower: 'wl_users', followee: 'wl_users' } },
  { name: 'wl_payouts', required: { user_id: 'wl_users' } },
  { name: 'wl_payments', required: { buyer_id: 'wl_users', seller_id: 'wl_users' }, optional: { order_id: 'wl_orders', project_id: 'wl_projects', proposal_id: 'wl_proposals' } },
  { name: 'wl_contacts' },
  { name: 'wl_posts' },
];

function toTime(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  const d = new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s) ? s.replace(' ', 'T') + 'Z' : s); // SQLite CURRENT_TIMESTAMP is UTC
  return Number.isNaN(d.getTime()) ? null : d;
}
function toJson(v) {
  try { const x = typeof v === 'string' ? JSON.parse(v) : v; return JSON.stringify(Array.isArray(x) ? x : []); } catch { return '[]'; }
}

const lite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const db = createDb();
const problems = [];
try {
  await migrateToLatest(db);
  const { n } = await db.selectFrom('wl_users').select(eb => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
  if (n > 0) throw new Error(`The Postgres database already has ${n} users. Import only into an empty database.`);

  const pgColumns = new Map();
  for (const t of await db.introspection.getTables()) pgColumns.set(t.name, new Set(t.columns.map(c => c.name)));
  const liteTables = new Set(lite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  const ids = new Map(); // table → Set of imported ids

  await db.transaction().execute(async trx => {
    for (const t of TABLES) {
      if (!liteTables.has(t.name)) { console.log(`- ${t.name}: not in the SQLite file, skipped`); continue; }
      const cols = pgColumns.get(t.name);
      const rows = lite.prepare(`SELECT * FROM "${t.name}"`).all();
      const out = [];
      for (const row of rows) {
        const missing = Object.entries(t.required || {}).find(([col, ref]) => !ids.get(ref)?.has(row[col]));
        if (missing) { problems.push(`${t.name} ${row.id ?? JSON.stringify(row)}: skipped, ${missing[0]}=${row[missing[0]]} doesn't exist`); continue; }
        const rec = {};
        for (const [k, v] of Object.entries(row)) {
          if (!cols.has(k)) continue; // column no longer used
          rec[k] = BOOL.has(k) ? !!v : JSONB.has(k) ? toJson(v) : TIME.has(k) ? toTime(v) : v;
        }
        for (const [col, ref] of Object.entries(t.optional || {})) {
          if (rec[col] != null && !ids.get(ref)?.has(rec[col])) { problems.push(`${t.name} ${row.id}: cleared ${col}=${rec[col]} (doesn't exist)`); rec[col] = null; }
        }
        if (t.name === 'wl_users' && !rec.pw_hash) rec.pw_hash = '';
        out.push(rec);
      }
      for (let i = 0; i < out.length; i += 500) await trx.insertInto(t.name).values(out.slice(i, i + 500)).execute();
      if (out.length && 'id' in out[0]) ids.set(t.name, new Set(out.map(r => r.id)));
      console.log(`✓ ${t.name}: ${out.length} of ${rows.length} rows`);
    }
    // Continue numbering after the imported ids.
    for (const t of TABLES) {
      if (!pgColumns.get(t.name)?.has('id')) continue;
      await sql`select setval(pg_get_serial_sequence(${t.name}, 'id'), coalesce((select max(id) from ${sql.table(t.name)}), 0) + 1, false)`.execute(trx);
    }
  });

  console.log(problems.length ? `\n${problems.length} row(s) needed attention:\n  ${problems.join('\n  ')}` : '\nNo problems found.');
  console.log('Import finished.');
} catch (e) {
  console.error('Import failed, nothing was imported:', e.message);
  process.exitCode = 1;
} finally {
  lite.close();
  await db.destroy();
}
