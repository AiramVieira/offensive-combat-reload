// Outgoing e-mail through Gmail's SMTP (an app password, not the account password). Without SMTP settings
// (development, tests) messages are kept in `outbox` and the link is printed on the console instead.
import nodemailer from 'nodemailer';
import { CONFIG } from './config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export const outbox: Mail[] = [];

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

export async function sendMail(mail: Mail) {
  if (!CONFIG.smtp.user || !CONFIG.smtp.appPassword) {
    outbox.push(mail);
    if (outbox.length > 50) outbox.shift();
    if (process.env.NODE_ENV !== 'test') console.log(`[email] SMTP não configurado; mensagem para ${mail.to}:\n${mail.text}`);
    return;
  }
  transport ??= nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: CONFIG.smtp.user, pass: CONFIG.smtp.appPassword },
  });
  await transport.sendMail({ from: `Offensive Combat <${CONFIG.smtp.from}>`, to: mail.to, subject: mail.subject, text: mail.text });
}
