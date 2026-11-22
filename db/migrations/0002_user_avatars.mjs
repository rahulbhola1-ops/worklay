/* Profile photos: the R2 object key of each user's current photo (NULL = no photo). */
import { sql } from 'kysely';

export async function up(db) {
  await sql.raw('ALTER TABLE wl_users ADD COLUMN avatar_key text').execute(db);
}

export async function down(db) {
  await sql.raw('ALTER TABLE wl_users DROP COLUMN IF EXISTS avatar_key').execute(db);
}
