/* Database migrations (Kysely Migrator).
   Migrations live in db/migrations as <number>_<name>.mjs and run in name order. Kysely records
   them in the kysely_migration table and takes a lock, so concurrent runs are safe.

   npm run db:migrate        apply all pending migrations
   npm run db:migrate:down   undo the most recent migration */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Migrator } from 'kysely/migration'; // moved out of the main entry in Kysely 0.29

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Like Kysely's FileMigrationProvider, but imports by file URL so it also works on Windows.
const provider = {
  async getMigrations() {
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter(f => /^\d+_.+\.mjs$/.test(f)).sort();
    const out = {};
    for (const f of files) out[f.replace(/\.mjs$/, '')] = await import(pathToFileURL(path.join(MIGRATIONS_DIR, f)).href);
    return out;
  },
};

function report({ error, results }) {
  for (const r of results || []) console.log(`${r.status === 'Success' ? '✓' : '✗'} ${r.direction === 'Down' ? 'reverted' : 'applied'} ${r.migrationName}${r.status === 'Success' ? '' : ' (' + r.status + ')'}`);
  if (error) throw error;
}

export async function migrateToLatest(db) {
  const r = await new Migrator({ db, provider }).migrateToLatest();
  if (!r.results?.length && !r.error) console.log('Database is up to date.');
  report(r);
}

export async function migrateDown(db) {
  report(await new Migrator({ db, provider }).migrateDown());
}

// CLI: node db/migrate.mjs [up|down]
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')); } catch { /* no .env */ }
  const { createDb } = await import('./index.mjs');
  const db = createDb();
  try {
    if (process.argv[2] === 'down') await migrateDown(db); else await migrateToLatest(db);
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}
