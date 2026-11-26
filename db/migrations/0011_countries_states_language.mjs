/* Other countries: which one a user or project belongs to, the region, and the user's own language.
   country_code decides currency, lists and whether online payment is possible. Everyone so far is in
   Estonia. (wl_users.country, an older free-text column, is not used for this.) */
import { sql } from 'kysely';

const UP = [
  `ALTER TABLE wl_users
     ADD COLUMN country_code text NOT NULL DEFAULT 'EE' CHECK (country_code ~ '^[A-Z]{2}$'),
     ADD COLUMN state text NOT NULL DEFAULT '',
     ADD COLUMN lang text NOT NULL DEFAULT ''`,
  `ALTER TABLE wl_projects
     ADD COLUMN country_code text NOT NULL DEFAULT 'EE' CHECK (country_code ~ '^[A-Z]{2}$'),
     ADD COLUMN state text NOT NULL DEFAULT ''`,
  `CREATE INDEX wl_users_place ON wl_users (country_code, state, city) WHERE is_freelancer`,
];

const DOWN = [
  'DROP INDEX IF EXISTS wl_users_place',
  'ALTER TABLE wl_projects DROP COLUMN IF EXISTS state, DROP COLUMN IF EXISTS country_code',
  'ALTER TABLE wl_users DROP COLUMN IF EXISTS lang, DROP COLUMN IF EXISTS state, DROP COLUMN IF EXISTS country_code',
];

const run = async (db, statements) => { for (const s of statements) await sql.raw(s).execute(db); };

export const up = db => run(db, UP);
export const down = db => run(db, DOWN);
