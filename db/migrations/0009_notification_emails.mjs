/* Emails for notifications. The notification row is also the email queue, so an email only goes out
   if the booking, order or payment it belongs to was really saved.

   email_state: NULL (no email for this one), pending → sending → sent, or failed / skipped.
   email_next_at: when to try (again). A row left in "sending" by a crash is picked up after it passes. */
import { sql } from 'kysely';

const UP = [
  `ALTER TABLE wl_notifications
     ADD COLUMN subject text NOT NULL DEFAULT '',
     ADD COLUMN email_state text CHECK (email_state IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
     ADD COLUMN email_attempts integer NOT NULL DEFAULT 0,
     ADD COLUMN email_next_at timestamptz NOT NULL DEFAULT now()`,
  `CREATE INDEX wl_notifications_email_queue ON wl_notifications (email_next_at) WHERE email_state IN ('pending', 'sending')`,
];

const DOWN = [
  'DROP INDEX IF EXISTS wl_notifications_email_queue',
  'ALTER TABLE wl_notifications DROP COLUMN IF EXISTS email_next_at, DROP COLUMN IF EXISTS email_attempts, DROP COLUMN IF EXISTS email_state, DROP COLUMN IF EXISTS subject',
];

const run = async (db, statements) => { for (const s of statements) await sql.raw(s).execute(db); };

export const up = db => run(db, UP);
export const down = db => run(db, DOWN);
