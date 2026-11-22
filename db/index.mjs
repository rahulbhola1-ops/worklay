/* Database connection: PostgreSQL through Kysely.
   Set DATABASE_URL, e.g. postgres://worklay:secret@127.0.0.1:5432/worklay */
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

// Return numbers instead of strings for numeric/bigint columns. Money is stored as
// numeric(12,2), which fits safely in a JS number; COUNT(*) returns bigint.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, v => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, v => (v === null ? null : Number(v)));

export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set. See .env.example.');
  const pool = new pg.Pool({ connectionString, max: Number(process.env.DATABASE_POOL_SIZE || 10) });
  pool.on('error', e => console.error('Postgres pool error:', e.message));
  return new Kysely({ dialect: new PostgresDialect({ pool }) });
}

export { sql };

// Rows changed by an UPDATE/DELETE run with executeTakeFirst() (Kysely reports a bigint).
export const changed = r => Number(r?.numUpdatedRows ?? r?.numDeletedRows ?? 0);
// Postgres error code for unique_violation.
export const isUniqueViolation = e => e && e.code === '23505';
