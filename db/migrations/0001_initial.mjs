/* Initial PostgreSQL schema for Worklay.
   Money is numeric(12,2), times are timestamptz, flags are boolean and lists are jsonb.
   Financial records (orders, payments, payouts) use ON DELETE RESTRICT so they can't vanish
   when a user or listing is deleted; everything else cascades or is set to NULL. */
import { sql } from 'kysely';

const id = col => col.primaryKey().generatedByDefaultAsIdentity(); // "by default" so imports can keep old ids
const money = 'numeric(12, 2)';
const now = sql`now()`;

export async function up(db) {
  await db.schema.createTable('wl_users')
    .addColumn('id', 'integer', id)
    .addColumn('name', 'text', c => c.notNull())
    .addColumn('email', 'text', c => c.notNull().unique())
    .addColumn('pw_hash', 'text', c => c.notNull().defaultTo('')) // empty for Google-only accounts
    .addColumn('google_id', 'text')
    .addColumn('title', 'text', c => c.notNull().defaultTo(''))
    .addColumn('country', 'text', c => c.notNull().defaultTo(''))
    .addColumn('city', 'text', c => c.notNull().defaultTo(''))
    .addColumn('area', 'text', c => c.notNull().defaultTo(''))
    .addColumn('bio', 'text')
    .addColumn('skills', 'jsonb', c => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('is_freelancer', 'boolean', c => c.notNull().defaultTo(false))
    .addColumn('category', 'text', c => c.notNull().defaultTo(''))
    .addColumn('rate', money, c => c.notNull().defaultTo(0))
    .addColumn('role', 'text', c => c.notNull().defaultTo('user'))
    .addColumn('color', 'text', c => c.notNull().defaultTo('#3858FF'))
    .addColumn('balance', money, c => c.notNull().defaultTo(0).check(sql`balance >= 0`))
    .addColumn('ver_status', 'text', c => c.notNull().defaultTo('none'))
    .addColumn('ver_doc_type', 'text')
    .addColumn('ver_file', 'text')
    .addColumn('ver_file_name', 'text')
    .addColumn('ver_submitted', 'timestamptz')
    .addColumn('ver_reason', 'text')
    .addColumn('stripe_account_id', 'text')
    .addColumn('stripe_payouts_ready', 'boolean', c => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('wl_users_google_id').unique().on('wl_users').column('google_id').where(sql.ref('google_id'), 'is not', null).execute();
  await db.schema.createIndex('wl_users_stripe_account').unique().on('wl_users').column('stripe_account_id').where(sql.ref('stripe_account_id'), 'is not', null).execute();

  await db.schema.createTable('wl_sessions')
    .addColumn('token_hash', 'text', c => c.primaryKey())
    .addColumn('user_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('expires_at', 'timestamptz', c => c.notNull())
    .execute();
  await db.schema.createIndex('wl_sessions_user').on('wl_sessions').column('user_id').execute();

  await db.schema.createTable('wl_documents')
    .addColumn('user_id', 'integer', c => c.primaryKey().references('wl_users.id').onDelete('cascade'))
    .addColumn('mime', 'text', c => c.notNull())
    .addColumn('data', 'bytea', c => c.notNull())
    .execute();

  await db.schema.createTable('wl_services')
    .addColumn('id', 'integer', id)
    .addColumn('seller_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('title', 'text', c => c.notNull())
    .addColumn('category', 'text', c => c.notNull())
    .addColumn('emoji', 'text', c => c.notNull().defaultTo('💼'))
    .addColumn('color', 'text', c => c.notNull().defaultTo('#dfe6ff'))
    .addColumn('description', 'text', c => c.notNull())
    .addColumn('packages', 'jsonb', c => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('wl_services_seller').on('wl_services').column('seller_id').execute();

  await db.schema.createTable('wl_projects')
    .addColumn('id', 'integer', id)
    .addColumn('owner_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('title', 'text', c => c.notNull())
    .addColumn('category', 'text', c => c.notNull())
    .addColumn('description', 'text', c => c.notNull())
    .addColumn('budget_min', money, c => c.notNull())
    .addColumn('budget_max', money, c => c.notNull())
    .addColumn('deadline', 'text', c => c.notNull())
    .addColumn('skills', 'jsonb', c => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('city', 'text', c => c.notNull().defaultTo(''))
    .addColumn('area', 'text', c => c.notNull().defaultTo(''))
    .addColumn('remote', 'boolean', c => c.notNull().defaultTo(false))
    .addColumn('status', 'text', c => c.notNull().defaultTo('open'))
    .addColumn('awarded_to', 'integer', c => c.references('wl_users.id').onDelete('set null'))
    .addColumn('awarded_amount', money)
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('wl_projects_owner').on('wl_projects').column('owner_id').execute();
  await db.schema.createIndex('wl_projects_awarded_to').on('wl_projects').column('awarded_to').execute();

  await db.schema.createTable('wl_proposals')
    .addColumn('id', 'integer', id)
    .addColumn('project_id', 'integer', c => c.notNull().references('wl_projects.id').onDelete('cascade'))
    .addColumn('seller_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('amount', money, c => c.notNull())
    .addColumn('days', 'integer', c => c.notNull())
    .addColumn('cover', 'text', c => c.notNull())
    .addColumn('status', 'text', c => c.notNull().defaultTo('pending'))
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .addUniqueConstraint('wl_proposals_project_seller', ['project_id', 'seller_id'])
    .execute();
  await db.schema.createIndex('wl_proposals_seller').on('wl_proposals').column('seller_id').execute();

  await db.schema.createTable('wl_orders')
    .addColumn('id', 'integer', id)
    .addColumn('service_id', 'integer', c => c.notNull().references('wl_services.id').onDelete('restrict'))
    .addColumn('pkg', 'integer', c => c.notNull())
    .addColumn('buyer_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('restrict'))
    .addColumn('seller_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('restrict'))
    .addColumn('price', money, c => c.notNull())
    .addColumn('requirements', 'text')
    .addColumn('status', 'text', c => c.notNull().defaultTo('in_queue'))
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('wl_orders_buyer').on('wl_orders').column('buyer_id').execute();
  await db.schema.createIndex('wl_orders_seller_status').on('wl_orders').columns(['seller_id', 'status']).execute();
  await db.schema.createIndex('wl_orders_service').on('wl_orders').column('service_id').execute();

  await db.schema.createTable('wl_reviews')
    .addColumn('id', 'integer', id)
    .addColumn('target_user', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('from_user', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('service_id', 'integer', c => c.references('wl_services.id').onDelete('set null'))
    .addColumn('order_id', 'integer', c => c.references('wl_orders.id').onDelete('set null'))
    .addColumn('project_id', 'integer', c => c.references('wl_projects.id').onDelete('set null'))
    .addColumn('rating', 'integer', c => c.notNull())
    .addColumn('text', 'text', c => c.notNull())
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('wl_reviews_target').on('wl_reviews').column('target_user').execute();

  await db.schema.createTable('wl_messages')
    .addColumn('id', 'integer', id)
    .addColumn('from_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('to_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('text', 'text', c => c.notNull())
    .addColumn('is_read', 'boolean', c => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('wl_messages_from').on('wl_messages').column('from_id').execute();
  await db.schema.createIndex('wl_messages_to').on('wl_messages').column('to_id').execute();

  await db.schema.createTable('wl_notifications')
    .addColumn('id', 'integer', id)
    .addColumn('user_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('type', 'text', c => c.notNull())
    .addColumn('text', 'text', c => c.notNull())
    .addColumn('link', 'text', c => c.notNull().defaultTo(''))
    .addColumn('is_read', 'boolean', c => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('wl_notifications_user').on('wl_notifications').columns(['user_id', 'id']).execute();

  await db.schema.createTable('wl_wishlist')
    .addColumn('user_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('kind', 'text', c => c.notNull()) // 'service' or 'project'; item_id points into that table
    .addColumn('item_id', 'integer', c => c.notNull())
    .addPrimaryKeyConstraint('wl_wishlist_pk', ['user_id', 'kind', 'item_id'])
    .execute();

  await db.schema.createTable('wl_follows')
    .addColumn('follower', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addColumn('followee', 'integer', c => c.notNull().references('wl_users.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('wl_follows_pk', ['follower', 'followee'])
    .execute();

  await db.schema.createTable('wl_payouts')
    .addColumn('id', 'integer', id)
    .addColumn('user_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('restrict'))
    .addColumn('amount', money, c => c.notNull())
    .addColumn('method', 'text', c => c.notNull())
    .addColumn('details', 'text', c => c.notNull())
    .addColumn('status', 'text', c => c.notNull().defaultTo('pending'))
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('wl_payouts_user').on('wl_payouts').column('user_id').execute();

  await db.schema.createTable('wl_payments')
    .addColumn('id', 'integer', id)
    .addColumn('kind', 'text', c => c.notNull()) // 'order' or 'project'
    .addColumn('order_id', 'integer', c => c.references('wl_orders.id').onDelete('restrict'))
    .addColumn('project_id', 'integer', c => c.references('wl_projects.id').onDelete('restrict'))
    .addColumn('proposal_id', 'integer', c => c.references('wl_proposals.id').onDelete('set null'))
    .addColumn('buyer_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('restrict'))
    .addColumn('seller_id', 'integer', c => c.notNull().references('wl_users.id').onDelete('restrict'))
    .addColumn('amount', money, c => c.notNull())
    .addColumn('fee', money, c => c.notNull())
    .addColumn('status', 'text', c => c.notNull().defaultTo('pending'))
    .addColumn('checkout_session_id', 'text', c => c.unique())
    .addColumn('payment_intent_id', 'text')
    .addColumn('transfer_id', 'text')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .addColumn('paid_at', 'timestamptz')
    .addColumn('released_at', 'timestamptz')
    .execute();
  await db.schema.createIndex('wl_payments_seller_status').on('wl_payments').columns(['seller_id', 'status']).execute();
  await db.schema.createIndex('wl_payments_buyer').on('wl_payments').column('buyer_id').execute();
  await db.schema.createIndex('wl_payments_order').on('wl_payments').column('order_id').execute();
  await db.schema.createIndex('wl_payments_project').on('wl_payments').column('project_id').execute();

  await db.schema.createTable('wl_contacts')
    .addColumn('id', 'integer', id)
    .addColumn('name', 'text', c => c.notNull())
    .addColumn('email', 'text', c => c.notNull())
    .addColumn('message', 'text', c => c.notNull())
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();

  await db.schema.createTable('wl_posts')
    .addColumn('id', 'integer', id)
    .addColumn('title', 'text', c => c.notNull())
    .addColumn('emoji', 'text', c => c.notNull().defaultTo('📝'))
    .addColumn('color', 'text', c => c.notNull().defaultTo('#eef1ff'))
    .addColumn('excerpt', 'text', c => c.notNull())
    .addColumn('body', 'text', c => c.notNull())
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(now))
    .execute();
}

export async function down(db) {
  for (const t of ['wl_posts', 'wl_contacts', 'wl_payments', 'wl_payouts', 'wl_follows', 'wl_wishlist', 'wl_notifications', 'wl_messages',
    'wl_reviews', 'wl_orders', 'wl_proposals', 'wl_projects', 'wl_services', 'wl_documents', 'wl_sessions', 'wl_users']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
