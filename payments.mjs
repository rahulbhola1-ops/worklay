/* Payments through Stripe Connect.

   How money moves ("separate charges and transfers"):
   1. A customer buys a service or awards a project and pays the full price by card on a
      Stripe Checkout page. The money lands in Worklay's Stripe balance.
   2. When the customer approves the work, the payment is "released": the freelancer's
      share (price minus the platform fee) is transferred to their Stripe Express account,
      and Stripe pays it out to their bank automatically.
   3. If the freelancer hasn't finished Stripe onboarding yet, released money waits in
      wl_users.balance and is transferred as soon as their account is ready.

   Payment statuses: pending → (processing →) paid → released → transferring → transferred,
   or pending/processing → cancelled.

   Without STRIPE_SECRET_KEY the module is disabled and the site keeps its manual flow. */
import Stripe from 'stripe';
import crypto from 'node:crypto';

export const PLATFORM_FEE = 0.10;
const CHECKOUT_MINUTES = 30; // Stripe's minimum session lifetime
const cents = eur => Math.round(Number(eur) * 100);
const round2 = n => Math.round(n * 100) / 100;

export function createPayments({ db, notify, publicOrigin }) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const stripe = secret ? new Stripe(secret) : null;
  const country = process.env.STRIPE_CONNECT_COUNTRY || 'EE';

  // ---- schema ----
  db.exec(`CREATE TABLE IF NOT EXISTS wl_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, order_id INTEGER NULL, project_id INTEGER NULL, proposal_id INTEGER NULL,
    buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL, amount REAL NOT NULL, fee REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    checkout_session_id TEXT NULL, payment_intent_id TEXT NULL, transfer_id TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TEXT NULL, released_at TEXT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS wl_payments_session ON wl_payments(checkout_session_id)');
  const userCols = db.prepare('PRAGMA table_info(wl_users)').all().map(c => c.name);
  if (!userCols.includes('stripe_account_id')) db.exec('ALTER TABLE wl_users ADD COLUMN stripe_account_id TEXT NULL');
  if (!userCols.includes('stripe_payouts_ready')) db.exec('ALTER TABLE wl_users ADD COLUMN stripe_payouts_ready INTEGER NOT NULL DEFAULT 0');

  const getPayment = id => db.prepare('SELECT * FROM wl_payments WHERE id=?').get(id);
  const net = p => round2(p.amount - p.fee);

  // ---- checkout ----
  async function startCheckout(req, { kind, buyer, sellerId, amount, title, orderId = null, projectId = null, proposalId = null }) {
    const fee = round2(amount * PLATFORM_FEE);
    const pid = db.prepare('INSERT INTO wl_payments(kind,order_id,project_id,proposal_id,buyer_id,seller_id,amount,fee) VALUES (?,?,?,?,?,?,?,?)')
      .run(kind, orderId, projectId, proposalId, buyer.id, sellerId, amount, fee).lastInsertRowid;
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
      db.prepare('UPDATE wl_payments SET checkout_session_id=? WHERE id=?').run(session.id, pid);
      return { paymentId: pid, url: session.url };
    } catch (e) {
      db.prepare("UPDATE wl_payments SET status='cancelled' WHERE id=?").run(pid);
      throw e;
    }
  }

  // Called from the webhook and from the return page; safe to run more than once.
  function applySession(session) {
    const p = db.prepare('SELECT * FROM wl_payments WHERE checkout_session_id=?').get(session.id);
    if (!p) return null;
    if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
      let refundNeeded = false;
      db.transaction(() => {
        const r = db.prepare("UPDATE wl_payments SET status='paid',payment_intent_id=?,paid_at=datetime('now') WHERE id=? AND status IN ('pending','processing','cancelled')")
          .run(String(session.payment_intent || ''), p.id);
        if (!r.changes) return;
        if (p.kind === 'order') {
          db.prepare("UPDATE wl_orders SET status='in_queue' WHERE id=?").run(p.order_id);
          notify(p.seller_id, 'order', 'You have a new paid order.', '#/dashboard/selling');
        } else {
          const project = db.prepare('SELECT * FROM wl_projects WHERE id=?').get(p.project_id);
          if (!project || project.status !== 'open') { refundNeeded = true; return; }
          db.prepare("UPDATE wl_projects SET status='awarded',awarded_to=?,awarded_amount=? WHERE id=?").run(p.seller_id, p.amount, project.id);
          db.prepare("UPDATE wl_proposals SET status='accepted' WHERE id=?").run(p.proposal_id);
          db.prepare("UPDATE wl_proposals SET status='rejected' WHERE project_id=? AND id<>? AND status='pending'").run(project.id, p.proposal_id);
          notify(p.seller_id, 'project', 'You were awarded a project. The customer has paid.', `#/project/${project.id}`);
        }
      })();
      // The project was awarded through another payment in the meantime: give this one back.
      if (refundNeeded) refund(p.id, 'Project was already awarded').catch(e => console.error('Refund failed', p.id, e.message));
    } else if (session.status === 'complete' && session.payment_status === 'unpaid') {
      // Delayed payment method (e.g. bank debit): wait for the async webhook.
      db.prepare("UPDATE wl_payments SET status='processing',payment_intent_id=? WHERE id=? AND status='pending'").run(String(session.payment_intent || ''), p.id);
    }
    return getPayment(p.id);
  }

  function cancelPayment(p) {
    db.transaction(() => {
      const r = db.prepare("UPDATE wl_payments SET status='cancelled' WHERE id=? AND status IN ('pending','processing')").run(p.id);
      if (r.changes && p.kind === 'order') db.prepare("UPDATE wl_orders SET status='cancelled' WHERE id=? AND status='awaiting_payment'").run(p.order_id);
    })();
    if (p.checkout_session_id && p.status === 'pending') stripe.checkout.sessions.expire(p.checkout_session_id).catch(() => {});
  }

  async function refund(paymentId, reason) {
    const p = getPayment(paymentId);
    if (!p || !p.payment_intent_id || p.status !== 'paid') return;
    await stripe.refunds.create({ payment_intent: p.payment_intent_id, metadata: { payment_id: String(p.id), reason } }, { idempotencyKey: `refund_${p.payment_intent_id}` });
    db.prepare("UPDATE wl_payments SET status='refunded' WHERE id=?").run(p.id);
    notify(p.buyer_id, 'payment', `Your payment of €${p.amount} was refunded: ${reason}.`, '#/dashboard');
  }

  // Abandoned checkouts: free them up so they don't sit in "awaiting payment" forever.
  function cleanupAbandoned() {
    const stale = db.prepare(`SELECT * FROM wl_payments WHERE status='pending' AND created_at < datetime('now','-${CHECKOUT_MINUTES + 5} minutes')`).all();
    stale.forEach(cancelPayment);
  }

  // ---- releasing money to freelancers ----
  // Called when the customer approves the work. Returns false if there was no paid payment.
  function release({ orderId = null, projectId = null }) {
    const p = orderId
      ? db.prepare("SELECT * FROM wl_payments WHERE kind='order' AND order_id=? AND status='paid'").get(orderId)
      : db.prepare("SELECT * FROM wl_payments WHERE kind='project' AND project_id=? AND status='paid'").get(projectId);
    if (!p) return false;
    db.transaction(() => {
      const r = db.prepare("UPDATE wl_payments SET status='released',released_at=datetime('now') WHERE id=? AND status='paid'").run(p.id);
      if (r.changes) db.prepare('UPDATE wl_users SET balance=balance+? WHERE id=?').run(net(p), p.seller_id);
    })();
    transferPending(p.seller_id).catch(e => console.error('Transfer failed for user', p.seller_id, e.message));
    return true;
  }

  // Send every released payment to the freelancer's Stripe account, if it can receive money.
  async function transferPending(userId) {
    const u = db.prepare('SELECT * FROM wl_users WHERE id=?').get(userId);
    if (!u || !u.stripe_account_id || !u.stripe_payouts_ready) return;
    const due = db.prepare("SELECT * FROM wl_payments WHERE seller_id=? AND status='released'").all(userId);
    for (const p of due) {
      if (!db.prepare("UPDATE wl_payments SET status='transferring' WHERE id=? AND status='released'").run(p.id).changes) continue;
      try {
        const pi = await stripe.paymentIntents.retrieve(p.payment_intent_id);
        const transfer = await stripe.transfers.create({
          amount: cents(net(p)), currency: 'eur', destination: u.stripe_account_id,
          source_transaction: typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id, // works before the card funds settle
          transfer_group: `payment_${p.id}`, metadata: { payment_id: String(p.id) },
        }, { idempotencyKey: `transfer_${p.payment_intent_id}` }); // one transfer per customer payment, even on retries
        db.transaction(() => {
          db.prepare("UPDATE wl_payments SET status='transferred',transfer_id=? WHERE id=?").run(transfer.id, p.id);
          db.prepare('UPDATE wl_users SET balance=MAX(0,balance-?) WHERE id=?').run(net(p), userId);
        })();
        notify(userId, 'payment', `€${net(p)} was sent to your Stripe account. Stripe will pay it out to your bank.`, '#/dashboard/earnings');
      } catch (e) {
        db.prepare("UPDATE wl_payments SET status='released' WHERE id=?").run(p.id);
        throw e;
      }
    }
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
      db.prepare('UPDATE wl_users SET stripe_account_id=? WHERE id=?').run(account, u.id);
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

  function saveAccountState(account) {
    const ready = account.payouts_enabled && account.capabilities?.transfers === 'active' ? 1 : 0;
    const u = db.prepare('SELECT * FROM wl_users WHERE stripe_account_id=?').get(account.id);
    if (!u) return null;
    db.prepare('UPDATE wl_users SET stripe_payouts_ready=? WHERE id=?').run(ready, u.id);
    if (ready && !u.stripe_payouts_ready) notify(u.id, 'payment', 'Payouts are set up. Your earnings will be sent to your bank automatically.', '#/dashboard/earnings');
    if (ready) transferPending(u.id).catch(e => console.error('Transfer failed for user', u.id, e.message));
    return !!ready;
  }

  async function refreshAccount(u) {
    if (!u.stripe_account_id) return { connected: false, ready: false };
    const account = await stripe.accounts.retrieve(u.stripe_account_id);
    return { connected: true, ready: saveAccountState(account), detailsSubmitted: !!account.details_submitted };
  }

  async function dashboardLink(u) {
    if (!u.stripe_account_id) throw new Error('Set up payouts first.');
    return (await stripe.accounts.createLoginLink(u.stripe_account_id)).url;
  }

  // ---- HTTP routes (registered before express.json so the webhook gets the raw body) ----
  function registerRoutes(app, { me }) {
    app.post('/api/payments/webhook', (req, res, next) => {
      // express.raw would also work; reading the stream keeps this file free of extra imports.
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => { req.rawBody = Buffer.concat(chunks); next(); });
    }, (req, res) => {
      if (!stripe || !webhookSecret) return res.status(404).end();
      let event;
      try { event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], webhookSecret); }
      catch (e) { return res.status(400).send(`Webhook signature check failed: ${e.message}`); }
      try {
        const o = event.data.object;
        switch (event.type) {
          case 'checkout.session.completed':
          case 'checkout.session.async_payment_succeeded': applySession(o); break;
          case 'checkout.session.expired':
          case 'checkout.session.async_payment_failed': {
            const p = db.prepare('SELECT * FROM wl_payments WHERE checkout_session_id=?').get(o.id);
            if (p) cancelPayment(p);
            break;
          }
          case 'account.updated': saveAccountState(o); break;
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
        const p = applySession(await stripe.checkout.sessions.retrieve(req.query.session_id));
        if (!p) return res.redirect('/#/?payment=failed');
        const state = p.status === 'paid' ? 'success' : p.status === 'refunded' ? 'refunded' : 'processing';
        res.redirect(p.kind === 'order' ? `/#/dashboard/orders?payment=${state}` : `/#/project/${p.project_id}?payment=${state}`);
      } catch (e) {
        console.error(e);
        res.redirect('/#/?payment=failed');
      }
    });

    // The customer pressed "back" on the Stripe page.
    app.get('/api/payments/cancel', (req, res) => {
      const p = getPayment(Number(req.query.payment));
      const u = me(req);
      if (stripe && p && u && p.buyer_id === u.id) cancelPayment(p);
      if (p && p.kind === 'project') return res.redirect(`/#/project/${p.project_id}?payment=cancelled`);
      res.redirect('/#/dashboard/orders?payment=cancelled');
    });

    // Stripe sends the freelancer here when an onboarding link has expired.
    app.get('/api/payments/connect/refresh', async (req, res) => {
      const u = me(req);
      if (!stripe || !u) return res.redirect('/#/dashboard/earnings');
      try { res.redirect(await onboardingLink(req, u)); }
      catch (e) { console.error(e); res.redirect('/#/dashboard/earnings?stripe=error'); }
    });
  }

  // What the dashboard shows the current user.
  function summary(userId) {
    const sum = (where, ...args) => round2(db.prepare(`SELECT COALESCE(SUM(amount-fee),0) s FROM wl_payments WHERE ${where}`).get(...args).s);
    const u = db.prepare('SELECT stripe_account_id,stripe_payouts_ready FROM wl_users WHERE id=?').get(userId) || {};
    return {
      connected: !!u.stripe_account_id, ready: !!u.stripe_payouts_ready,
      held: sum("seller_id=? AND status='paid'", userId),
      waiting: sum("seller_id=? AND status IN ('released','transferring')", userId),
      transferred: sum("seller_id=? AND status='transferred'", userId),
    };
  }

  function listFor(userId, admin) {
    const rows = admin
      ? db.prepare('SELECT * FROM wl_payments ORDER BY id DESC LIMIT 200').all()
      : db.prepare('SELECT * FROM wl_payments WHERE (buyer_id=? OR seller_id=?) AND status<>\'cancelled\' ORDER BY id DESC').all(userId, userId);
    return rows.map(p => ({
      id: String(p.id), kind: p.kind, orderId: p.order_id ? String(p.order_id) : null, projectId: p.project_id ? String(p.project_id) : null,
      buyerId: String(p.buyer_id), sellerId: String(p.seller_id), amount: p.amount, fee: p.fee, net: net(p), status: p.status,
      created: new Date(p.created_at.replace(' ', 'T') + 'Z').toISOString(),
    }));
  }

  return {
    enabled: !!stripe, startCheckout, cancelPayment, getPayment, release, cleanupAbandoned,
    onboardingLink, refreshAccount, dashboardLink, registerRoutes, summary, listFor,
  };
}
