/* Payments through Stripe Connect.

   How money moves ("separate charges and transfers"):
   1. A customer buys a service or awards a project and pays the full price by card on a
      Stripe Checkout page. The money lands in Worklay's Stripe balance.
   2. When the customer approves the work, the payment is "released": the freelancer's
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

export const PLATFORM_FEE = 0.10;
const CHECKOUT_MINUTES = 30; // Stripe's minimum session lifetime
const cents = eur => Math.round(Number(eur) * 100);
const round2 = n => Math.round(n * 100) / 100;
const iso = v => (v ? new Date(v).toISOString() : null);

export function createPayments({ db, notify, publicOrigin }) {
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
      .values({ kind, order_id: orderId, project_id: projectId, proposal_id: proposalId, booking_id: bookingId, buyer_id: buyer.id, seller_id: sellerId, amount, fee })
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
  const refColumn = { order: 'order_id', project: 'project_id', booking: 'booking_id' };
  const refOf = ({ orderId = null, projectId = null, bookingId = null }) => {
    const kind = orderId ? 'order' : bookingId ? 'booking' : 'project';
    return [kind, orderId ?? bookingId ?? projectId];
  };
  const paymentsFor = ref => { const [kind, id] = refOf(ref); return db.selectFrom('wl_payments').selectAll().where('kind', '=', kind).where(refColumn[kind], '=', id); };
  const paidPaymentFor = ref => paymentsFor(ref).where('status', '=', 'paid').executeTakeFirst();
  // Was this job paid through Stripe at all (whatever happened to the money since)?
  const hasPayment = async ref => !!(await paymentsFor(ref).where('status', 'not in', ['pending', 'cancelled']).executeTakeFirst());

  // The customer approved the work (or an admin decided): the freelancer's share is released and
  // transferred straight away if their payout account is ready. Returns false if nothing was held.
  async function release(ref) {
    const p = await paidPaymentFor(ref);
    if (!p) return false;
    const released = await db.transaction().execute(async trx => {
      const r = await trx.updateTable('wl_payments').set({ status: 'released', released_at: sql`now()` }).where('id', '=', p.id).where('status', '=', 'paid').executeTakeFirst();
      if (!changed(r)) return false;
      await trx.updateTable('wl_users').set({ balance: sql`balance + ${net(p)}` }).where('id', '=', p.seller_id).execute();
      return true;
    });
    if (released) transferPending(p.seller_id).catch(e => console.error('Transfer failed for user', p.seller_id, e.message));
    return released;
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
    return (await q.execute()).map(p => ({
      id: String(p.id), kind: p.kind, orderId: p.order_id ? String(p.order_id) : null, projectId: p.project_id ? String(p.project_id) : null, bookingId: p.booking_id ? String(p.booking_id) : null,
      buyerId: String(p.buyer_id), sellerId: String(p.seller_id), amount: p.amount, fee: p.fee, net: net(p), status: p.status, created: iso(p.created_at),
      problem: p.problem_at ? { reason: p.problem_reason, by: p.problem_by ? String(p.problem_by) : null, at: iso(p.problem_at) } : null,
    }));
  }

  return {
    enabled: !!stripe, startCheckout, cancelPayment, getPayment, release, refund, refundBooking, hasPayment, paidPaymentFor, retryStuck, transferPending, cleanupAbandoned,
    onboardingLink, refreshAccount, dashboardLink, registerRoutes, summary, listFor,
  };
}
