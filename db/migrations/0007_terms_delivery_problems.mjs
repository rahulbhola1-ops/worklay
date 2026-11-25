/* Terms of Service acceptance, "work done" marks, and payment problems.

   wl_users.terms_version / terms_accepted_at: which version of the Terms the user accepted, and when.
   delivered_at: when the freelancer marked the work as done (orders use their "delivered" status).
   wl_payments.problem_*: a client or freelancer asked Worklay to look at a held payment.
   wl_payments.processing_at: when a transfer or refund was started, so one interrupted by a crash
   can be found and finished. New payment status: refunding. */
import { sql } from 'kysely';

const UP = [
  'ALTER TABLE wl_users ADD COLUMN terms_version text, ADD COLUMN terms_accepted_at timestamptz',
  'ALTER TABLE wl_projects ADD COLUMN delivered_at timestamptz',
  'ALTER TABLE wl_bookings ADD COLUMN delivered_at timestamptz',
  `ALTER TABLE wl_payments
     ADD COLUMN problem_reason text,
     ADD COLUMN problem_by integer REFERENCES wl_users (id) ON DELETE SET NULL,
     ADD COLUMN problem_at timestamptz,
     ADD COLUMN processing_at timestamptz`,
  `CREATE INDEX wl_payments_open ON wl_payments (status) WHERE status IN ('paid', 'released', 'transferring', 'refunding')`,
];

const DOWN = [
  'DROP INDEX IF EXISTS wl_payments_open',
  `UPDATE wl_payments SET status = 'paid' WHERE status = 'refunding'`,
  'ALTER TABLE wl_payments DROP COLUMN IF EXISTS processing_at, DROP COLUMN IF EXISTS problem_at, DROP COLUMN IF EXISTS problem_by, DROP COLUMN IF EXISTS problem_reason',
  'ALTER TABLE wl_bookings DROP COLUMN IF EXISTS delivered_at',
  'ALTER TABLE wl_projects DROP COLUMN IF EXISTS delivered_at',
  'ALTER TABLE wl_users DROP COLUMN IF EXISTS terms_accepted_at, DROP COLUMN IF EXISTS terms_version',
];

const run = async (db, statements) => { for (const s of statements) await sql.raw(s).execute(db); };

export const up = db => run(db, UP);
export const down = db => run(db, DOWN);
