/* Transactional email through Brevo (https://www.brevo.com), used for the welcome email and for
   reminders about finished work.

   Needs BREVO_API_KEY (Brevo → SMTP & API → API keys) and MAIL_FROM_EMAIL, an address on a sender
   or domain verified in Brevo (Brevo → Senders, domains & dedicated IPs). MAIL_FROM_NAME defaults
   to "Worklay". Without the key or sender, emails are switched off and only logged. */

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createMailer() {
  const apiKey = process.env.BREVO_API_KEY || '';
  const fromEmail = process.env.MAIL_FROM_EMAIL || '';
  const fromName = process.env.MAIL_FROM_NAME || 'Worklay';
  const enabled = !!(apiKey && fromEmail);

  async function send({ to, name, subject, html, text, tags = [] }) {
    if (!enabled) { console.log(`[mail] off (set BREVO_API_KEY and MAIL_FROM_EMAIL): would send "${subject}" to ${to}`); return; }
    const r = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: to, ...(name ? { name } : {}) }],
        subject, htmlContent: html, textContent: text, tags,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Brevo send failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  }

  // Welcome email after sign-up. Freelancers are pointed at their service profile, clients at
  // finding someone. `origin` is the site's public address, e.g. https://worklay.com.
  function welcomeContent({ name, isFreelancer }, origin) {
    const first = String(name || '').trim().split(/\s+/)[0] || 'there';
    const cta = isFreelancer
      ? { url: `${origin}/#/onboarding`, label: 'Finish your service profile', line: 'Finish your service profile (category, prices and hours) so clients can find and book you.' }
      : { url: `${origin}/#/freelancers`, label: 'Find a freelancer', line: 'Browse local freelancers, compare prices and book the one you like.' };
    const subject = 'Welcome to Worklay';
    const text = `Hi ${first},\n\nThanks for joining Worklay!\n\n${cta.line}\n${cta.url}\n\nIf you have any questions, just reply to this email.\n\nThe Worklay team`;
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<h1 style="margin:0 0 16px;font-size:22px">Welcome to Worklay, ${escapeHtml(first)}!</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">Thanks for joining. ${escapeHtml(cta.line)}</p>
<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escapeHtml(cta.label)}</a></p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#52606d">If you have any questions, just reply to this email.<br>The Worklay team</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
    return { subject, html, text };
  }

  // Fire and forget: never let email problems slow down or break sign-up.
  function sendWelcome(user, origin) {
    const { subject, html, text } = welcomeContent(user, origin);
    send({ to: user.email, name: user.name, subject, html, text, tags: ['welcome'] })
      .catch(e => console.error('[mail] welcome email failed:', e.message));
  }

  // Short message with one button, e.g. "please check the finished work". Never throws.
  function sendNote(user, { subject, line, link, label }, origin) {
    const first = String(user.name || '').trim().split(/\s+/)[0] || 'there', url = `${origin}/${link}`;
    const text = `Hi ${first},\n\n${line}\n\n${url}\n\nThe Worklay team`;
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(subject)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">Hi ${escapeHtml(first)},<br><br>${escapeHtml(line)}</p>
<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escapeHtml(label)}</a></p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#52606d">The Worklay team</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
    return send({ to: user.email, name: user.name, subject, html, text, tags: ['payment'] }).catch(e => console.error('[mail] note failed:', e.message));
  }

  return { enabled, send, sendWelcome, sendNote };
}
