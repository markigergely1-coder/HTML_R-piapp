/**
 * Firebase Functions — Cloud backend.
 *
 * Funkciók:
 *   - sendBillingEmails: Gmail SMTP-n keresztül elküld N db személyre szabott
 *     emailt, és opcionálisan egy admin összesítőt PDF csatolmánnyal.
 *   - tuesdayReminder:      schedulált push (kedd 9:00) — re-export ./notifications-ből
 *   - onCancellation:       Firestore trigger — re-export
 *   - onAttendanceFullTeam: Firestore trigger — re-export
 *
 * Secrets (firebase functions:secrets:set GMAIL_USER, GMAIL_PASS):
 *   - GMAIL_USER: a küldő Gmail cím (pl. ropiplabda.app@gmail.com)
 *   - GMAIL_PASS: a Gmail App Password (NEM a fiók-jelszó!)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';

// Runtime: Node.js 22 (upgraded from 20)
setGlobalOptions({ region: 'europe-west1', maxInstances: 3 });

// Firebase Admin SDK inicializálás (csak egyszer)
admin.initializeApp();

// Push notification function-ök re-exportja
export { tuesdayReminder, onCancellation, onAttendanceFullTeam } from './notifications';

// Diagnosztika oldalról hívható teszt push (admin-only).
// A megadott member összes engedélyezett eszközére küld push-t, NEM ellenőrzi
// a prefs-et (mert tesztelni akarjuk a működést). Visszatér eszköz-szintű
// részletekkel: melyik eszköz fogadta, melyik bukott el, miért.
import { sendRawPushToMember } from './notifications';

interface TestPushResult {
  sent: number;
  failed: number;
  devices: { device: string; ok: boolean; reason?: string }[];
}

export const sendTestPush = onCall(
  { cors: true, timeoutSeconds: 30 },
  async (req): Promise<TestPushResult> => {
    const userEmail = req.auth?.token?.email?.toLowerCase() ?? '';
    if (!userEmail) {
      throw new HttpsError('unauthenticated', 'Bejelentkezés szükséges.');
    }
    if (!ADMIN_EMAILS.has(userEmail)) {
      throw new HttpsError('permission-denied', 'Csak admin küldhet teszt push-t.');
    }
    const memberId = (req.data?.memberId as string | undefined)?.trim();
    if (!memberId) {
      throw new HttpsError('invalid-argument', 'memberId paraméter szükséges.');
    }
    const result = await sendRawPushToMember(memberId, {
      title: '🧪 Teszt push',
      body: `Diagnosztika — ${new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' })}`,
      tag: `test-${Date.now()}`,
      url: '/#/diagnostics',
    });
    return result;
  },
);

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_PASS = defineSecret('GMAIL_PASS');

// Admin emailek (whitelist) — szinkron a frontend `auth.ts`-szel
const ADMIN_EMAILS = new Set([
  'markigergely1@gmail.com',
  'annemaryaf@gmail.com',
]);

interface PersonalEmail {
  to: string;
  name: string;
  count: number;
  amount: number;
  /** Opcionális vendég-részletek a "Saját + vendég X" bontáshoz */
  guestDetails?: {
    ownCount: number;
    ownCost: number;
    guests: { name: string; count: number; cost: number }[];
  };
}

interface SendBillingEmailsInput {
  year: number;
  monthName: string;
  personal: PersonalEmail[];
  adminEmail?: string;       // ha megadva, küld admin összesítőt is
  adminSummaryRows?: { name: string; count: number; amount: number }[];
  /** Base64 encoded PDF (admin email csatolmánynak) */
  pdfBase64?: string;
}

interface SendResult {
  totalRequested: number;
  personalSent: number;
  personalFailed: { to: string; reason: string }[];
  adminSent: boolean;
  adminError?: string;
}

export const sendBillingEmails = onCall(
  {
    secrets: [GMAIL_USER, GMAIL_PASS],
    cors: true,
    timeoutSeconds: 120,
  },
  async (req): Promise<SendResult> => {
    // 1) Auth ellenőrzés
    const userEmail = req.auth?.token?.email?.toLowerCase() ?? '';
    if (!userEmail) {
      throw new HttpsError('unauthenticated', 'Bejelentkezés szükséges.');
    }
    if (!ADMIN_EMAILS.has(userEmail)) {
      throw new HttpsError('permission-denied', 'Csak admin használhatja.');
    }

    // 2) Input validáció
    const input = req.data as SendBillingEmailsInput;
    if (!input || !Array.isArray(input.personal)) {
      throw new HttpsError('invalid-argument', 'Hibás bemenet.');
    }
    if (input.personal.length === 0 && !input.adminEmail) {
      throw new HttpsError('invalid-argument', 'Nincs kit / mit küldeni.');
    }

    // 3) SMTP transport
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER.value(),
        pass: GMAIL_PASS.value(),
      },
    });

    const result: SendResult = {
      totalRequested: input.personal.length,
      personalSent: 0,
      personalFailed: [],
      adminSent: false,
    };

    // 4) Személyes emailek
    for (const p of input.personal) {
      try {
        const html = renderPersonalHtml(input.year, input.monthName, p);
        await transporter.sendMail({
          from: `"Röpi App 🏐" <${GMAIL_USER.value()}>`,
          to: p.to,
          subject: `🏐 Röpi elszámolás — ${input.year}. ${input.monthName}`,
          html,
        });
        result.personalSent++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        result.personalFailed.push({ to: p.to, reason });
      }
    }

    // 5) Admin összesítő (opcionális, PDF-fel)
    if (input.adminEmail) {
      try {
        const html = renderAdminSummaryHtml(input.year, input.monthName, input.adminSummaryRows ?? []);
        const mailOptions: nodemailer.SendMailOptions = {
          from: `"Röpi App 🏐" <${GMAIL_USER.value()}>`,
          to: input.adminEmail,
          subject: `[Admin] 🏐 Teljes elszámolás — ${input.year}. ${input.monthName}`,
          html,
        };
        if (input.pdfBase64) {
          mailOptions.attachments = [
            {
              filename: `Admin_Elszamolas_${input.year}_${input.monthName.replace(/\s+/g, '_')}.pdf`,
              content: input.pdfBase64,
              encoding: 'base64',
              contentType: 'application/pdf',
            },
          ];
        }
        await transporter.sendMail(mailOptions);
        result.adminSent = true;
      } catch (err) {
        result.adminError = err instanceof Error ? err.message : String(err);
      }
    }

    return result;
  },
);

// ─────────────────────────────────────────────────────────────────
// HTML render helpers (Python `send_personal_email` / `send_admin_summary_email` port)
// ─────────────────────────────────────────────────────────────────

function fmtHuf(n: number): string {
  return `${Math.round(n).toLocaleString('hu-HU')} Ft`.replace(/,/g, ' ');
}

function renderPersonalHtml(year: number, monthName: string, p: PersonalEmail): string {
  const firstName = (p.name.split(/\s+/)[0] ?? p.name).trim();
  const hasGuests = !!(p.guestDetails && p.guestDetails.guests.length > 0);

  let detailRows = '';
  if (hasGuests && p.guestDetails) {
    const gd = p.guestDetails;
    detailRows += `
      <tr style="background:#f9f9f9;">
        <td style="padding:10px; color:#555;">👤 Saját részvétel</td>
        <td style="padding:10px; text-align:right; color:#555;">${gd.ownCount} alkalom</td>
      </tr>
      <tr style="background:#f9f9f9;">
        <td style="padding:10px; color:#555;">👤 Saját díj</td>
        <td style="padding:10px; text-align:right; color:#555;">${fmtHuf(gd.ownCost)}</td>
      </tr>`;
    for (const g of gd.guests) {
      detailRows += `
        <tr style="background:#fff8e1;">
          <td style="padding:10px; color:#8a6d00;">🧑‍🤝‍🧑 Vendég: ${escapeHtml(g.name)}</td>
          <td style="padding:10px; text-align:right; color:#8a6d00;">${g.count} alkalom</td>
        </tr>
        <tr style="background:#fff8e1;">
          <td style="padding:10px; color:#8a6d00;">💸 ${escapeHtml(g.name)} díja</td>
          <td style="padding:10px; text-align:right; color:#8a6d00;">${fmtHuf(g.cost)}</td>
        </tr>`;
    }
  }

  return `
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; max-width: 520px; margin: auto;">
        <div style="background: #f8f8f8; border-radius: 12px; padding: 28px;">
          <h2 style="color: #4a90d9; margin-top:0;">🏐 Havi Röpi Elszámolás</h2>
          <p>Szia <strong>${escapeHtml(firstName)}</strong>!</p>
          <p>Elkészült a <strong>${year}. ${escapeHtml(monthName)}</strong> havi elszámolás.</p>
          <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
            <tr style="background:#4a90d9; color:white;">
              <th style="padding:12px; text-align:left;">Megnevezés</th>
              <th style="padding:12px; text-align:right;">Részlet</th>
            </tr>
            ${detailRows}
            <tr style="background:#eaf4ff;">
              <td style="padding:12px;"><strong>📅 Összes részvétel</strong></td>
              <td style="padding:12px; text-align:right;"><strong>${p.count} alkalom</strong></td>
            </tr>
            <tr style="background:#fff;">
              <td style="padding:14px; font-size:1.1em;">💰 <strong>Fizetendő összeg</strong></td>
              <td style="padding:14px; font-size:1.3em; text-align:right; color:#e74c3c;"><strong>${fmtHuf(p.amount)}</strong></td>
            </tr>
          </table>
          ${hasGuests ? '<p style="color:#888; font-size:0.9em;">ℹ️ A fizetendő összeg tartalmazza a vendégeid terembérleti díját is.</p>' : ''}
          <p>Kérlek utald el a fenti összeget a szokásos számlaszámra! 🙏</p>
          <hr style="border:none; border-top:1px solid #ddd; margin:20px 0;">
          <p style="font-size:0.8em; color:#aaa; margin:0;">Ez egy automatikus üzenet — Röpi App Pro 🏐</p>
        </div>
      </body>
    </html>`;
}

function renderAdminSummaryHtml(
  year: number,
  monthName: string,
  rows: { name: string; count: number; amount: number }[],
): string {
  const tableRows = rows.map((r) => `
    <tr>
      <td style="padding:8px; border-bottom:1px solid #eee;">${escapeHtml(r.name)}</td>
      <td style="padding:8px; text-align:center;">${r.count}</td>
      <td style="padding:8px; text-align:right; color:#e74c3c;"><strong>${fmtHuf(r.amount)}</strong></td>
    </tr>
  `).join('');
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return `
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; max-width: 620px; margin: auto;">
        <div style="background: #f8f8f8; border-radius: 12px; padding: 28px;">
          <h2 style="color: #4a90d9; margin-top:0;">📊 Admin Összesítő — ${year}. ${escapeHtml(monthName)}</h2>
          <table style="width:100%; border-collapse: collapse;">
            <tr style="background:#4a90d9; color:white;">
              <th style="padding:10px; text-align:left;">Név</th>
              <th style="padding:10px; text-align:center;">Részvétel</th>
              <th style="padding:10px; text-align:right;">Fizetendő</th>
            </tr>
            ${tableRows}
            <tr style="background:#eaf4ff; font-weight:bold;">
              <td style="padding:10px;">ÖSSZESEN</td>
              <td></td>
              <td style="padding:10px; text-align:right; color:#4a90d9;">${fmtHuf(total)}</td>
            </tr>
          </table>
          <p style="margin-top:20px;">A részletes PDF csatolva. 📎</p>
          <hr style="border:none; border-top:1px solid #ddd; margin:20px 0;">
          <p style="font-size:0.8em; color:#aaa; margin:0;">Röpi App Pro — Admin értesítő 🏐</p>
        </div>
      </body>
    </html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
