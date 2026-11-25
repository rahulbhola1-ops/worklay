/* Payments through Stripe Connect.

   How money moves ("separate charges and transfers"):
   1. A customer buys a service or awards a project and pays the full price by card on a
      Stripe Checkout page. The money lands in Worklay's Stripe balance.
   2. When the customer approves the work (or APPROVAL_DAYS pass after the freelancer marked it as
      done and nobody reported a problem), the payment is "released": the freelancer's
      share (price minus the platform fee) is transferred to their Stripe account,
      and Stripe pays it out to their bank automatically.
   3. If the freelancer hasn't finished Stripe onboarding yet, released money waits in
      wl_users.balance and is transferred as soon as their account is ready.

   Payment statuses: pending → (processing →) paid → released → transferring → transferred,
   or pending/processing → cancelled, or paid → refunding → refunded.

   Kinds: 'order' (service package), 'project' (awarded project) and 'booking' (date/time booking:
   paid when requested, refunded if the freelancer declines or it's cancelled, released when the
   client marks it completed).

   Without STRIPE_SECRET_KEY the module is disabled and the site keeps its manual flow.
   The wl_payments table and the Stripe columns on wl_users are created by db/migrations. */
import Stripe from 'stripe';
import crypto from 'node:crypto';
import { sql, changed } from './db/index.mjs';
import { APPROVAL_DAYS } from './terms.mjs';

export const PLATFORM_FEE = 0.10;
const CHECKOUT_MINUTES = 30; // Stripe's minimum session lifetime
const cents = eur => Math.round(Number(eur) * 100);
const round2 = n => Math.round(n * 100) / 100;
const iso = v => (v ? new Date(v).toISOString() : null);
const HOUR = 3600_000, REMIND_DAYS = 2; // reminders go out this many days before a deadline
const hoursAgo = h => sql`now() - make_interval(hours => ${h}::int)`;
// The job behind each kind of payment: table, id column on wl_payments, status while it's delivered, status when finished.
const JOBS = {
  order: { table: 'wl_orders', column: 'order_id', open: 'delivered', done: 'completed', link: '#/dashboard/orders' },
  project: { table: 'wl_projects', column: 'project_id', open: 'awarded', done: 'completed', link: '#/dashboard/projects' },
  booking: { table: 'wl_bookings', column: 'booking_id', open: 'CONFIRMED', done: 'COMPLETED', link: '#/dashboard/bookings' },
};

export function createPayments({ db, notify, publicOrigin, email = async () => {} }) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const stripe = secret ? new Stripe(secret) : null;
  const country = process.env.STRIPE_CONNECT_COUNTRY || 'EE';

  const getPayment = id => db.selectFrom('wl_payments').selectAll().where('id', '=', id).executeTakeFirst();
  const bySession = id => db.selectFrom('wl_payments').selectAll().where('checkout_session_id', '=', id).executeTakeFirst();
  const net = p => round2(p.amount - p.fee);

  // ---- checkout ----
  async function startCheckout(req, { kind, buyer, sellerId, amount, title, orderId = null, projectId = null, proposalId = null, bookingId = null }) {
    const fee = round2(amount * PLATFORM_FEE);
    const { id: pid } = await db.insertInto('wl_payments')
      .values({ kind, order_id: orderId, project_id: projectId, proposal_id: proposalId, booking_id: bookingId, buyer_id: buyer.id, seller_id: sellerId, amount, fee, auto_release: true }) // the buyer has accepted the current Terms
      .returning('id').executeTakeFirstOrThrow();
    const origin = publicOrigin(req);
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cents(amount), product_data: { name: String(title).slice(0, 250) || 'Worklay' } } }],
        customer_email: buyer.email,
        client_reference_id: String(pid),
        metadata: { payment_id: String(pid) },
        payment_intent_data: { transfer_group: `payment_${pid}`, metadata: { payment_id: String(pid) } },
        success_url: `${origin}/api/payments/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/api/payments/cancel?payment=${pid}`,
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60 + 60,
      }, { idempotencyKey: `checkout_${pid}_${crypto.randomUUID()}` });
      await db.updateTable('wl_payments').set({ checkout_session_id: session.id }).where('id', '=', pid).execute();
      return { paymentId: pid, url: session.url };
    } catch (e) {
      await db.updateTable('wl_payments').set({ status: 'cancelled' }).where('id', '=', pid).execute();
      throw e;
    }
  }

  // Called from the webhook and from the return page; safe to run more than once.
  async function applySession(session) {
    const p = await bySession(session.id);
    if (!p) return null;
    if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
      let refundNeeded = false;
      await db.transaction().execute(async trx => {
        const r = await trx.updateTable('wl_payments')
          .set({ status: 'paid', payment_intent_id: String(session.payment_intent || ''), paid_at: sql`now()` })
          .where('id', '=', p.id).where('status', 'in', ['pending', 'processing', 'cancelled']).executeTakeFirst();
        if (!changed(r)) return;
        if (p.kind === 'order') {
          await trx.updateTable('wl_orders').set({ status: 'in_queue' }).where('id', '=', p.order_id).execute();
          await notify(p.seller_id, 'order', 'You have a new paid order.', '#/dashboard/selling', trx);
          return;
        }
        if (p.kind === 'booking') {
          // Paid: the booking now waits for the freelancer to confirm. If it was cancelled meanwhile
          // (the checkout took too long and the slot was freed), give the money back.
          const b = await trx.updateTable('wl_bookings').set({ status: 'PENDING', updated_at: sql`now()` })
            .where('id', '=', p.booking_id).where('status', '=', 'AWAITING_PAYMENT').executeTakeFirst();
          if (!changed(b)) { refundNeeded = true; return; }
          await notify(p.seller_id, 'booking', 'You have a new paid booking request. Please confirm it.', '#/dashboard/bookings', trx);
          return;
        }
        // Lock the project so two payments can't both award it.
        const project = await trx.selectFrom('wl_projects').selectAll().where('id', '=', p.project_id).forUpdate().executeTakeFirst();
        if (!project || project.status !== 'open') { refundNeeded = true; return; }
        await trx.updateTable('wl_projects').set({ status: 'awarded', awarded_to: p.seller_id, awarded_amount: p.amount }).where('id', '=', project.id).execute();
        await trx.updateTable('wl_proposals').set({ status: 'accepted' }).where('id', '=', p.proposal_id).execute();
        await trx.updateTable('wl_proposals').set({ status: 'rejected' }).where('project_id', '=', project.id).where('id', '<>', p.proposal_id).where('status', '=', 'pending').execute();
        await notify(p.seller_id, 'project', 'You were awarded a project. The customer has paid.', `#/project/${project.id}`, trx);
      });
      // The project was awarded through another payment in the meantime: give this one back.
      if (refundNeeded) await refund(p.id, p.kind === 'booking' ? 'The booking was no longer available' : 'Project was already awarded').catch(e => console.error('Refund failed', p.id, e.message));
    } else if (session.status === 'complete' && session.payment_status === 'unpaid') {
      // Delayed payment method (e.g. bank debit): wait for the async webhook.
      await db.updateTable('wl_payments').set({ status: 'processing', payment_intent_id: String(session.payment_intent || '') })
        .where('id', '=', p.id).where('status', '=', 'pending').execute();
    }
    return getPayment(p.id);
  }

  async function cancelPayment(p) {
    await db.transaction().execute(async trx => {
      const r = await trx.updateTable('wl_payments').set({ status: 'cancelled' }).where('id', '=', p.id).where('status', 'in', ['pending', 'processing']).executeTakeFirst();
      if (changed(r) && p.kind === 'order') await trx.updateTable('wl_orders').set({ status: 'cancelled' }).where('id', '=', p.order_id).where('status', '=', 'awaiting_payment').execute();
      if (changed(r) && p.kind === 'booking') await trx.updateTable('wl_bookings').set({ status: 'CANCELLED', updated_at: sql`now()` }).where('id', '=', p.booking_id).where('status', '=', 'AWAITING_PAYMENT').execute();
    });
    if (p.checkout_session_id && p.status === 'pending') stripe.checkout.sessions.expire(p.checkout_session_id).catch(() => {});
  }

  // Claims the payment first, so a refund and a release can never both happen.
  async function refund(paymentId, reason) {
    const p = await getPayment(paymentId);
    if (!p || !p.payment_intent_id) return false;
    const claimed = await db.updateTable('wl_payments').set({ status: 'refunding', processing_at: sql`now()` }).where('id', '=', p.id).where('status', '=', 'paid').executeTakeFirst();
    if (!changed(claimed)) return false;
    try {
      await stripe.refunds.create({ payment_intent: p.payment_intent_id, metadata: { payment_id: String(p.id), reason: String(reason).slice(0, 400) } }, { idempotencyKey: `refund_${p.payment_intent_id}` });
    } catch (e) {
      await db.updateTable('wl_payments').set({ status: 'paid', processing_at: null }).where('id', '=', p.id).where('status', '=', 'refunding').execute();
      throw e;
    }
    await finishRefund(p, reason);
    return true;
  }
  async function finishRefund(p, reason) {
    const r = await db.updateTable('wl_payments').set({ status: 'refunded', processing_at: null }).where('id', '=', p.id).where('status', '=', 'refunding').executeTakeFirst();
    if (changed(r)) await notify(p.buyer_id, 'payment', `Your payment of €${p.amount} was refunded: ${reason}.`, '#/dashboard');
  }

  // Give a held booking payment back (declined or cancelled). Returns false if nothing was paid.
  async function refundBooking(bookingId, reason) {
    const p = await paidPaymentFor({ bookingId });
    return p ? refund(p.id, reason) : false;
  }

  // Abandoned checkouts: free them up so they don't sit in "awaiting payment" forever.
  async function cleanupAbandoned() {
    const stale = await db.selectFrom('wl_payments').selectAll().where('status', '=', 'pending')
      .where('created_at', '<', sql`now() - make_interval(mins => ${CHECKOUT_MINUTES + 5})`).execute();
    for (const p of stale) await cancelPayment(p);
  }

  // ---- releasing money to freelancers ----
  const refOf = ({ orderId = null, projectId = null, bookingId = null }) => {
    const kind = orderId ? 'order' : bookingId ? 'booking' : 'project';
    return [kind, orderId ?? bookingId ?? projectId];
  };
  const paymentsFor = ref => { const [kind, id] = refOf(ref); return db.selectFrom('wl_payments').selectAll().where('kind', '=', kind).where(JOBS[kind].column, '=', id); };
  const paidPaymentFor = ref => paymentsFor(ref).where('status', '=', 'paid').executeTakeFirst();
  // Was this job paid through Stripe at all (whatever happened to the money since)?
  const hasPayment = async ref => !!(await paymentsFor(ref).where('status', 'not in', ['pending', 'cancelled']).executeTakeFirst());

  // The customer approved the work (or an admin decided): the freelancer's share is released and
  // transferred straight away if their payout account is ready. Returns false if nothing was held.
  async function release(ref) {
    const p = await paidPaymentFor(ref);
    if (!p) return false;
    const released = await db.transaction().execute(trx => releaseIn(trx, p));
    if (released) sendSoon(p.seller_id);
    return released;
  }
  // unlessProblem: an automatic release must lose against a problem reported at the same moment.
  async function releaseIn(trx, p, { unlessProblem = false } = {}) {
    let q = trx.updateTable('wl_payments').set({ status: 'released', released_at: sql`now()` }).where('id', '=', p.id).where('status', '=', 'paid');
    if (unlessProblem) q = q.where('problem_at', 'is', null);
    if (!changed(await q.executeTakeFirst())) return false;
    await trx.updateTable('wl_users').set({ balance: sql`balance + ${net(p)}` }).where('id', '=', p.seller_id).execute();
    return true;
  }
  const sendSoon = userId => transferPending(userId).catch(e => console.error('Transfer failed for user', userId, e.message));

  /* ---- automatic payment ----
     Held payments whose job was marked as done at least `hours` ago, with no problem reported. Only
     payments made under the Terms that promise this (auto_release). */
  const silentFor = (kind, hours) => {
    const j = JOBS[kind];
    return db.selectFrom('wl_payments as p').innerJoin(`${j.table} as j`, 'j.id', `p.${j.column}`).selectAll('p').select('j.delivered_at')
      .where('p.kind', '=', kind).where('p.status', '=', 'paid').where('p.auto_release', '=', true).where('p.problem_at', 'is', null)
      .where('j.status', '=', j.open).where('j.delivered_at', '<=', hoursAgo(hours));
  };
  async function autoRelease() {
    for (const kind of Object.keys(JOBS)) {
      const j = JOBS[kind];
      for (const p of await silentFor(kind, APPROVAL_DAYS * 24).execute()) {
        try {
          // Job and payment change together or not at all, whatever the client does meanwhile.
          const done = await db.transaction().execute(async trx => {
            if (!(await releaseIn(trx, p, { unlessProblem: true }))) return false;
            const r = await trx.updateTable(j.table).set({ status: j.done }).where('id', '=', p[j.column]).where('status', '=', j.open).where('delivered_at', '<=', hoursAgo(APPROVAL_DAYS * 24)).executeTakeFirst();
            if (!changed(r)) throw Object.assign(new Error('job changed'), { skip: true });
            await notify(p.seller_id, 'payment', `The client didn’t respond within ${APPROVAL_DAYS} days, so your payment of €${net(p)} was released automatically.`, '#/dashboard/earnings', trx);
            await notify(p.buyer_id, 'payment', `€${p.amount} was released to the freelancer because you didn’t approve the work or report a problem within ${APPROVAL_DAYS} days.`, j.link, trx);
            return true;
          });
          if (done) sendSoon(p.seller_id);
        } catch (e) { if (!e.skip) console.error('Automatic release failed', p.id, e.message); }
      }
      // Remind the client once, shortly before the deadline.
      for (const p of await silentFor(kind, (APPROVAL_DAYS - REMIND_DAYS) * 24).where('p.reminded_at', 'is', null).execute()) {
        const claimed = await db.updateTable('wl_payments').set({ reminded_at: sql`now()` }).where('id', '=', p.id).where('reminded_at', 'is', null).where('status', '=', 'paid').executeTakeFirst();
        if (!changed(claimed)) continue;
        const by = new Date(new Date(p.delivered_at).getTime() + APPROVAL_DAYS * 24 * HOUR);
        await askApproval(p, by, true);
      }
    }
    // Reported problems that Worklay should decide soon.
    const due = await db.selectFrom('wl_payments').selectAll().where('status', '=', 'paid').where('problem_reminded_at', 'is', null)
      .where('problem_at', '<=', hoursAgo((APPROVAL_DAYS - REMIND_DAYS) * 24)).execute();
    for (const p of due) {
      if (!changed(await db.updateTable('wl_payments').set({ problem_reminded_at: sql`now()` }).where('id', '=', p.id).where('problem_reminded_at', 'is', null).executeTakeFirst())) continue;
      for (const a of await db.selectFrom('wl_users').select('id').where('role', '=', 'admin').execute()) await notify(a.id, 'payment', `Payment #${p.id}: please decide the reported problem by ${day(deadline(p.problem_at))}.`, '#/admin');
    }
    // Proof files aren't needed long after the decision; the record that there was one stays.
    await db.updateTable('wl_payment_proofs').set({ data: null }).where('data', 'is not', null).where('uploaded_at', '<', sql`now() - interval '6 months'`)
      .where('payment_id', 'in', db.selectFrom('wl_payments').select('id').where('status', 'in', ['transferred', 'refunded'])).execute();
  }
  const deadline = from => new Date(new Date(from).getTime() + APPROVAL_DAYS * 24 * HOUR);
  const day = d => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Tallinn' }).format(d);

  // Tells the client (on the site and by email) that finished work waits for them. No deadline is
  // mentioned for payments without automatic release.
  async function askApproval(p, by, reminder = false) {
    const link = JOBS[p.kind].link, seller = await db.selectFrom('wl_users').select('name').where('id', '=', p.seller_id).executeTakeFirst();
    const rule = p.auto_release ? ` If you don’t approve it or report a problem by ${day(by)}, the payment of €${p.amount} goes to the freelancer automatically.` : '';
    if (reminder) await notify(p.buyer_id, 'payment', `Reminder: ${seller?.name || 'The freelancer'} marked the work as done.${rule}`, link);
    await email(p.buyer_id, { subject: reminder ? 'Reminder: please check the finished work' : 'Please check the finished work',
      line: `${seller?.name || 'The freelancer'} marked the work as done. Please check it and approve it, or report a problem with proof.${rule}`, link, label: 'Check the work' });
    return rule;
  }
  // Called when the freelancer marks a job as done: emails the client and returns the deadline
  // sentence for the notification ('' if this job isn't paid through Stripe).
  async function delivered(ref) {
    const p = await paidPaymentFor(ref);
    return p && !p.problem_at ? askApproval(p, deadline(new Date())) : '';
  }

  async function markTransferred(p, transferId) {
    const done = await db.transaction().execute(async trx => {
      const r = await trx.updateTable('wl_payments').set({ status: 'transferred', transfer_id: transferId, processing_at: null }).where('id', '=', p.id).where('status', '=', 'transferring').executeTakeFirst();
      if (!changed(r)) return false;
      await trx.updateTable('wl_users').set({ balance: sql`greatest(0, balance - ${net(p)})` }).where('id', '=', p.seller_id).execute();
      return true;
    });
    if (done) await notify(p.seller_id, 'payment', `€${net(p)} was sent to your Stripe account. Stripe will pay it out to your bank.`, '#/dashboard/earnings');
  }

  // Send every released payment to the freelancer's Stripe account, if it can receive money.
  // One failing payment doesn't hold up the others; retryStuck() tries again later.
  async function transferPending(userId) {
    const u = await db.selectFrom('wl_users').select(['stripe_account_id', 'stripe_payouts_ready']).where('id', '=', userId).executeTakeFirst();
    if (!u || !u.stripe_account_id || !u.stripe_payouts_ready) return;
    const due = await db.selectFrom('wl_payments').selectAll().where('seller_id', '=', userId).where('status', '=', 'released').execute();
    for (const p of due) {
      const claimed = await db.updateTable('wl_payments').set({ status: 'transferring', processing_at: sql`now()` }).where('id', '=', p.id).where('status', '=', 'released').executeTakeFirst();
      if (!changed(claimed)) continue; // another request is already sending it
      try {
        const pi = await stripe.paymentIntents.retrieve(p.payment_intent_id);
        const transfer = await stripe.transfers.create({
          amount: cents(net(p)), currency: 'eur', destination: u.stripe_account_id,
          source_transaction: chargeOf(pi), // works before the card funds settle
          transfer_group: `payment_${p.id}`, metadata: { payment_id: String(p.id) },
        }, { idempotencyKey: `transfer_${p.payment_intent_id}` }); // one transfer per customer payment, even on retries
        await markTransferred(p, transfer.id);
      } catch (e) {
        await db.updateTable('wl_payments').set({ status: 'released', processing_at: null }).where('id', '=', p.id).where('status', '=', 'transferring').execute();
        console.error('Transfer failed for payment', p.id, e.message);
      }
    }
  }
  const chargeOf = pi => (typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id);

  /* Runs every few minutes: finishes transfers and refunds that a crash interrupted, retries failed
     transfers, and refunds cancelled jobs whose refund didn't go through. Stripe is asked what
     really happened before anything is sent again, so money can't go out twice. */
  async function retryStuck({ staleMinutes = 10 } = {}) {
    if (!stripe) return;
    const stale = status => db.selectFrom('wl_payments').selectAll().where('status', '=', status)
      .where(eb => eb.or([eb('processing_at', 'is', null), eb('processing_at', '<', sql`now() - make_interval(mins => ${staleMinutes})`)])).execute();
    const attempt = async (p, fn) => { try { await fn(); } catch (e) { console.error('Payment retry failed', p.id, e.message); } };

    for (const p of await stale('transferring')) await attempt(p, async () => {
      const charge = chargeOf(await stripe.paymentIntents.retrieve(p.payment_intent_id));
      const sent = (await stripe.transfers.list({ transfer_group: `payment_${p.id}`, limit: 100 })).data.find(t => t.source_transaction === charge);
      if (sent) await markTransferred(p, sent.id);
      else await db.updateTable('wl_payments').set({ status: 'released', processing_at: null }).where('id', '=', p.id).where('status', '=', 'transferring').execute();
    });
    for (const p of await stale('refunding')) await attempt(p, async () => {
      const done = (await stripe.refunds.list({ payment_intent: p.payment_intent_id, limit: 10 })).data.some(r => ['succeeded', 'pending', 'requires_action'].includes(r.status));
      if (done) await finishRefund(p, 'the payment was returned');
      else await db.updateTable('wl_payments').set({ status: 'paid', processing_at: null }).where('id', '=', p.id).where('status', '=', 'refunding').execute();
    });
    const owed = await db.selectFrom('wl_payments as p').selectAll('p').where('p.status', '=', 'paid').where(eb => eb.or([
      eb('p.booking_id', 'in', eb.selectFrom('wl_bookings').select('id').where('status', '=', 'CANCELLED')),
      eb('p.order_id', 'in', eb.selectFrom('wl_orders').select('id').where('status', '=', 'cancelled')),
      eb('p.project_id', 'in', eb.selectFrom('wl_projects').select('id').where('status', '=', 'cancelled')),
    ])).execute();
    for (const p of owed) await attempt(p, () => refund(p.id, 'the job was cancelled'));
    // Approved, but the server stopped before the money was released.
    const approved = await db.selectFrom('wl_payments as p').selectAll('p').where('p.status', '=', 'paid').where('p.problem_at', 'is', null).where(eb => eb.or([
      eb('p.booking_id', 'in', eb.selectFrom('wl_bookings').select('id').where('status', '=', 'COMPLETED')),
      eb('p.order_id', 'in', eb.selectFrom('wl_orders').select('id').where('status', '=', 'completed')),
      eb('p.project_id', 'in', eb.selectFrom('wl_projects').select('id').where('status', '=', 'completed')),
    ])).execute();
    for (const p of approved) await attempt(p, () => db.transaction().execute(trx => releaseIn(trx, p, { unlessProblem: true })));
    const sellers = await db.selectFrom('wl_payments').select('seller_id').distinct().where('status', '=', 'released').execute();
    for (const { seller_id } of sellers) await transferPending(seller_id).catch(e => console.error('Transfer retry failed for user', seller_id, e.message));
  }

  // ---- freelancer onboarding (Accounts v2, Express dashboard) ----
  // Stripe hosts onboarding and the freelancer's dashboard and covers losses; Worklay collects
  // the fee. The account can receive transfers ("recipient") and, as Stripe requires when it
  // covers losses, also has the "merchant" configuration.
  async function onboardingLink(req, u) {
    let account = u.stripe_account_id;
    if (!account) {
      const a = await stripe.v2.core.accounts.create({
        contact_email: u.email, display_name: String(u.name || u.email).slice(0, 100),
        identity: { country: country.toLowerCase() }, dashboard: 'express',
        defaults: { currency: 'eur', responsibilities: { fees_collector: 'application', losses_collector: 'stripe' } },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
          recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
        },
        metadata: { worklay_user_id: String(u.id) },
      }, { idempotencyKey: `account_${u.id}_${crypto.randomUUID()}` });
      account = a.id;
      await db.updateTable('wl_users').set({ stripe_account_id: account }).where('id', '=', u.id).execute();
    }
    const origin = publicOrigin(req);
    const link = await stripe.v2.core.accountLinks.create({
      account,
      use_case: { type: 'account_onboarding', account_onboarding: {
        refresh_url: `${origin}/api/payments/connect/refresh`,
        return_url: `${origin}/#/dashboard/earnings?stripe=return`,
      } },
    });
    return link.url;
  }

  async function saveAccountState(account) {
    const ready = !!(account.payouts_enabled && account.capabilities?.transfers === 'active');
    const u = await db.selectFrom('wl_users').select(['id', 'stripe_payouts_ready']).where('stripe_account_id', '=', account.id).executeTakeFirst();
    if (!u) return null;
    await db.updateTable('wl_users').set({ stripe_payouts_ready: ready }).where('id', '=', u.id).execute();
    if (ready && !u.stripe_payouts_ready) await notify(u.id, 'payment', 'Payouts are set up. Your earnings will be sent to your bank automatically.', '#/dashboard/earnings');
    if (ready) transferPending(u.id).catch(e => console.error('Transfer failed for user', u.id, e.message));
    return ready;
  }

  async function refreshAccount(u) {
    if (!u.stripe_account_id) return { connected: false, ready: false };
    const account = await stripe.accounts.retrieve(u.stripe_account_id);
    return { connected: true, ready: await saveAccountState(account), detailsSubmitted: !!account.details_submitted };
  }

  async function dashboardLink(u) {
    if (!u.stripe_account_id) throw new Error('Set up payouts first.');
    return (await stripe.accounts.createLoginLink(u.stripe_account_id)).url;
  }

  // ---- HTTP routes (registered before express.json so the webhook gets the raw body) ----
  function registerRoutes(app, { me }) {
    app.post('/api/payments/webhook', (req, res, next) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => { req.rawBody = Buffer.concat(chunks); next(); });
    }, async (req, res) => {
      if (!stripe || !webhookSecret) return res.status(404).end();
      let event;
      try { event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], webhookSecret); }
      catch (e) { return res.status(400).send(`Webhook signature check failed: ${e.message}`); }
      try {
        const o = event.data.object;
        switch (event.type) {
          case 'checkout.session.completed':
          case 'checkout.session.async_payment_succeeded': await applySession(o); break;
          case 'checkout.session.expired':
          case 'checkout.session.async_payment_failed': {
            const p = await bySession(o.id);
            if (p) await cancelPayment(p);
            break;
          }
          case 'account.updated': await saveAccountState(o); break;
        }
        res.json({ received: true });
      } catch (e) {
        console.error('Webhook error', event.type, e);
        res.status(500).end(); // Stripe retries
      }
    });

    // Stripe sends the customer here after paying.
    app.get('/api/payments/return', async (req, res) => {
      if (!stripe || typeof req.query.session_id !== 'string') return res.redirect('/#/');
      try {
        const p = await applySession(await stripe.checkout.sessions.retrieve(req.query.session_id));
        if (!p) return res.redirect('/#/?payment=failed');
        const state = p.status === 'paid' ? 'success' : p.status === 'refunded' ? 'refunded' : 'processing';
        res.redirect(p.kind === 'order' ? `/#/dashboard/orders?payment=${state}` : p.kind === 'booking' ? `/#/dashboard/bookings?payment=${state}` : `/#/project/${p.project_id}?payment=${state}`);
      } catch (e) {
        console.error(e);
        res.redirect('/#/?payment=failed');
      }
    });

    // The customer pressed "back" on the Stripe page.
    app.get('/api/payments/cancel', async (req, res) => {
      const p = await getPayment(Number(req.query.payment) || 0);
      const u = await me(req);
      if (stripe && p && u && p.buyer_id === u.id) await cancelPayment(p);
      if (p && p.kind === 'project') return res.redirect(`/#/project/${p.project_id}?payment=cancelled`);
      if (p && p.kind === 'booking') return res.redirect('/#/dashboard/bookings?payment=cancelled');
      res.redirect('/#/dashboard/orders?payment=cancelled');
    });

    // Stripe sends the freelancer here when an onboarding link has expired.
    app.get('/api/payments/connect/refresh', async (req, res) => {
      const u = await me(req);
      if (!stripe || !u) return res.redirect('/#/dashboard/earnings');
      try { res.redirect(await onboardingLink(req, u)); }
      catch (e) { console.error(e); res.redirect('/#/dashboard/earnings?stripe=error'); }
    });
  }

  // What the dashboard shows the current user.
  async function summary(user) {
    const sumWhere = statuses => sql`coalesce(sum(amount - fee) filter (where status in (${sql.join(statuses)})), 0)`;
    const s = await db.selectFrom('wl_payments').where('seller_id', '=', user.id)
      .select([sumWhere(['paid']).as('held'), sumWhere(['released', 'transferring']).as('waiting'), sumWhere(['transferred']).as('transferred')])
      .executeTakeFirst();
    return { connected: !!user.stripe_account_id, ready: !!user.stripe_payouts_ready, held: round2(s.held), waiting: round2(s.waiting), transferred: round2(s.transferred) };
  }

  async function listFor(userId, admin) {
    let q = db.selectFrom('wl_payments').selectAll().orderBy('id', 'desc');
    q = admin ? q.limit(200) : q.where(eb => eb.or([eb('buyer_id', '=', userId), eb('seller_id', '=', userId)])).where('status', '<>', 'cancelled');
    const rows = await q.execute();
    const proofs = rows.some(p => p.problem_at) ? await db.selectFrom('wl_payment_proofs').select(['id', 'payment_id', 'user_id', 'file_name', 'uploaded_at', sql`data is not null`.as('has_file')])
      .where('payment_id', 'in', rows.filter(p => p.problem_at).map(p => p.id)).orderBy('id').execute() : [];
    return rows.map(p => ({
      id: String(p.id), kind: p.kind, orderId: p.order_id ? String(p.order_id) : null, projectId: p.project_id ? String(p.project_id) : null, bookingId: p.booking_id ? String(p.booking_id) : null,
      buyerId: String(p.buyer_id), sellerId: String(p.seller_id), amount: p.amount, fee: p.fee, net: net(p), status: p.status, created: iso(p.created_at),
      autoRelease: p.auto_release,
      problem: p.problem_at ? { reason: p.problem_reason, by: p.problem_by ? String(p.problem_by) : null, at: iso(p.problem_at), decideBy: deadline(p.problem_at).toISOString(),
        proofs: proofs.filter(x => x.payment_id === p.id).map(x => ({ id: String(x.id), by: String(x.user_id), name: x.file_name, at: iso(x.uploaded_at), hasFile: x.has_file })) } : null,
    }));
  }

  return {
    enabled: !!stripe, startCheckout, cancelPayment, getPayment, release, refund, refundBooking, hasPayment, paidPaymentFor, retryStuck, autoRelease, delivered, transferPending, cleanupAbandoned,
    onboardingLink, refreshAccount, dashboardLink, registerRoutes, summary, listFor,
  };
}
