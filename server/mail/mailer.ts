// Outgoing email: Resend or SMTP in production. In development without a
// provider, messages are captured in the local outbox at /dev/outbox.
import { mail, mailMode } from '../env.ts';
import { db, schema } from '../db/client.ts';
import { log } from '../log.ts';

export interface MailMessage {
  to: string;
  subject: string;
  heading: string;
  intro: string;
  actionLabel: string;
  link: string;
  footnote: string;
}

// Loaded only when SMTP is configured (Supabase blocks SMTP ports; use Resend there).
let smtp: Promise<import('nodemailer').Transporter> | null = null;
const smtpTransport = () => (smtp ??= import('nodemailer').then((m) => m.default.createTransport(mail.smtpUrl)));

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

function renderText(m: MailMessage) {
  return `${m.heading}\n\n${m.intro}\n\n${m.actionLabel}: ${m.link}\n\n${m.footnote}\n\n— Lumera Creative workspace\n`;
}

function renderHtml(m: MailMessage) {
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:#1d1c20">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fbfaf6;border:1px solid #e4dfd4;border-radius:12px">
  <tr><td style="padding:32px 32px 8px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6f6a61">Lumera Creative</div>
  <h1 style="font-size:22px;font-weight:600;margin:12px 0 8px">${esc(m.heading)}</h1>
  <p style="font-size:15px;line-height:1.55;color:#48453f;margin:0 0 24px">${esc(m.intro)}</p>
  <a href="${esc(m.link)}" style="display:inline-block;background:#1d1c20;color:#f7f4ec;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600">${esc(m.actionLabel)}</a>
  <p style="font-size:13px;line-height:1.5;color:#6f6a61;margin:24px 0 32px">${esc(m.footnote)}</p></td></tr></table>
  </td></tr></table></body></html>`;
}

export async function sendMail(m: MailMessage): Promise<void> {
  if (mailMode === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mail.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: mail.from, to: [m.to], subject: m.subject, text: renderText(m), html: renderHtml(m) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.error('mail.resend_failed', { status: res.status });
      throw new Error(`Email provider responded ${res.status}`);
    }
    return;
  }
  if (mailMode === 'smtp') {
    await (await smtpTransport()).sendMail({ from: mail.from, to: m.to, subject: m.subject, text: renderText(m), html: renderHtml(m) });
    return;
  }
  await db.insert(schema.devOutbox).values({ toAddress: m.to, subject: m.subject, text: renderText(m), link: m.link });
  log.info('mail.dev_outbox', { subject: m.subject, open: '/dev/outbox' });
}

export const templates = {
  verify: (to: string, name: string, link: string): MailMessage => ({
    to,
    subject: 'Confirm your email for Lumera Creative',
    heading: `Confirm your email, ${name.split(' ')[0]}`,
    intro: 'Confirm this address to finish creating your Lumera Creative account. The link works for 24 hours.',
    actionLabel: 'Confirm email',
    link,
    footnote: 'If you didn’t create an account, you can ignore this email — nothing will happen.',
  }),
  reset: (to: string, link: string): MailMessage => ({
    to,
    subject: 'Reset your Lumera Creative password',
    heading: 'Reset your password',
    intro: 'Someone asked to reset the password for this account. The link works for one hour and signs out your other sessions.',
    actionLabel: 'Choose a new password',
    link,
    footnote: 'If this wasn’t you, ignore this email. Your password stays the same.',
  }),
  invite: (to: string, orgName: string, inviter: string, role: string, link: string): MailMessage => ({
    to,
    subject: `${inviter} invited you to ${orgName}`,
    heading: `Join ${orgName}`,
    intro: `${inviter} invited you to the ${orgName} workspace as ${role === 'admin' ? 'an admin' : 'a member'}. Create an account or sign in with this email address to accept. The invitation expires in 7 days.`,
    actionLabel: 'Accept invitation',
    link,
    footnote: 'Didn’t expect this? You can ignore it; the invitation expires on its own.',
  }),
  assigned: (to: string, actor: string, taskTitle: string, link: string): MailMessage => ({
    to,
    subject: `${actor} assigned you “${taskTitle}”`,
    heading: 'New task assigned to you',
    intro: `${actor} assigned you “${taskTitle}” in Lumera Creative.`,
    actionLabel: 'Open task',
    link,
    footnote: 'You can turn off assignment emails in Settings → Notifications.',
  }),
};
