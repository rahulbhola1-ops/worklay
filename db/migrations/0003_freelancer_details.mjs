/* Freelancer details asked at sign-up: speciality, availability (days + times of day),
   the areas they cover in their city, and for tutors the subjects and classes they teach. */
import { sql } from 'kysely';

const UP = [
  `ALTER TABLE wl_users ADD COLUMN specialty text NOT NULL DEFAULT ''`,
  // {"days": ["mon", ...], "times": ["morning" | "afternoon" | "evening", ...]}
  `ALTER TABLE wl_users ADD COLUMN availability jsonb NOT NULL DEFAULT '{"days": [], "times": []}'::jsonb`,
  // Area names in the user's city, e.g. ["Kesklinn", "Kristiine"]
  `ALTER TABLE wl_users ADD COLUMN service_areas jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE wl_users ADD COLUMN tutor_subjects jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE wl_users ADD COLUMN tutor_levels jsonb NOT NULL DEFAULT '[]'::jsonb`,
];

const DOWN = [
  'ALTER TABLE wl_users DROP COLUMN IF EXISTS tutor_levels',
  'ALTER TABLE wl_users DROP COLUMN IF EXISTS tutor_subjects',
  'ALTER TABLE wl_users DROP COLUMN IF EXISTS service_areas',
  'ALTER TABLE wl_users DROP COLUMN IF EXISTS availability',
  'ALTER TABLE wl_users DROP COLUMN IF EXISTS specialty',
];

const run = async (db, statements) => { for (const s of statements) await sql.raw(s).execute(db); };

export const up = db => run(db, UP);
export const down = db => run(db, DOWN);
