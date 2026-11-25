/* Notifications: shown on the site, and emailed when they are about bookings, orders, projects or
   payments. Chat messages and account notices stay on the site only.

   Emails are sent from the wl_notifications table by deliverEmails(), which runs every few seconds
   and only sees saved (committed) rows. Failed sends are tried again; sending never slows down or
   breaks the page. Without Brevo keys nothing is queued. */
import { sql } from './db/index.mjs';

const EMAILED = { booking: 'Update about your booking', order: 'Update about your order', project: 'Update about your project', payment: 'Update about your payment' };
const BUTTON = { booking: 'Open booking', order: 'Open order', project: 'Open project', payment: 'Open Worklay' };
const RETRY_MINUTES = [1, 5, 30, 120]; // then give up
const MAX_AGE_HOURS = 48; // older news is not worth an email any more (e.g. after a long outage)
const MAX_PER_HOUR = 30; // per recipient; the rest waits
const BATCH = 10;

// Names and titles are written by users: stop them from turning into links in an email from Worklay.
export const defang = s => String(s).replace(/\s+/g, ' ').replace(/:\/\//g, ':​//').replace(/([\p{L}\p{N}_-])\.(?=\p{L}{2})/gu, '$1.​').replace(/@/g, '@​').trim().slice(0, 900);

export function createNotifications({ db, mailer, origin }) {
  // `ex` lets callers write the notification inside their transaction.
  async function notify(userId, type, text, link = '', ex = db, subject = '') {
    await ex.insertInto('wl_notifications')
      .values({ user_id: userId, type, text, link, subject, email_state: mailer.enabled && EMAILED[type] ? 'pending' : null }).execute();
  }

  // Claims a few waiting emails; SKIP LOCKED keeps two servers from taking the same one.
  const claim = () => sql`
    UPDATE wl_notifications n SET email_state = 'sending', email_attempts = n.email_attempts + 1, email_next_at = now() + interval '5 minutes'
    WHERE n.id IN (SELECT id FROM wl_notifications WHERE email_state IN ('pending', 'sending') AND email_next_at <= now()
                   ORDER BY email_next_at, id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
    RETURNING n.id, n.user_id, n.type, n.text, n.link, n.subject, n.email_attempts, n.created_at`.execute(db).then(r => r.rows.sort((a, b) => a.id - b.id));
  const finish = (id, set) => db.updateTable('wl_notifications').set(set).where('id', '=', id).where('email_state', '=', 'sending').execute();

  async function sendOne(n) {
    if (Date.now() - new Date(n.created_at) > MAX_AGE_HOURS * 3600_000) return finish(n.id, { email_state: 'skipped' });
    const { sent } = await db.selectFrom('wl_notifications').select(sql`count(*)::int`.as('sent')).where('user_id', '=', n.user_id).where('email_state', '=', 'sent').where('created_at', '>', sql`now() - interval '1 hour'`).executeTakeFirstOrThrow();
    if (sent >= MAX_PER_HOUR) return finish(n.id, { email_state: 'pending', email_attempts: n.email_attempts - 1, email_next_at: sql`now() + interval '15 minutes'` });
    const u = await db.selectFrom('wl_users').select(['name', 'email']).where('id', '=', n.user_id).executeTakeFirst();
    if (!u) return finish(n.id, { email_state: 'skipped' });
    try {
      await mailer.sendNote(u, { subject: n.subject || EMAILED[n.type], line: defang(n.text), link: n.link || '#/notifications', label: BUTTON[n.type] || 'Open Worklay' }, origin);
      await finish(n.id, { email_state: 'sent' });
    } catch (e) {
      const wait = RETRY_MINUTES[n.email_attempts - 1];
      const hopeless = e.status === 400 || wait === undefined; // 400: Brevo rejected this address or message
      console.error(`[mail] notification ${n.id} ${hopeless ? 'given up' : 'will be retried'}:`, e.message);
      await finish(n.id, hopeless ? { email_state: 'failed' } : { email_state: 'pending', email_next_at: sql`now() + make_interval(mins => ${wait}::int)` });
    }
  }

  let running = false;
  async function deliverEmails() {
    if (!mailer.enabled || running) return;
    running = true;
    try {
      for (let batch; (batch = await claim()).length;) for (const n of batch) await sendOne(n);
    } catch (e) { console.error('[mail] queue failed:', e.message); } finally { running = false; }
  }
  // Every 10 seconds while the server runs.
  const start = () => { if (mailer.enabled) setInterval(deliverEmails, 10_000).unref(); };

  return { notify, deliverEmails, start };
}
