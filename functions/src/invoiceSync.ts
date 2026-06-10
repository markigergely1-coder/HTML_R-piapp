import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import pdfParse from 'pdf-parse';

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_PASS = defineSecret('GMAIL_PASS');
const EMAIL_SENDER = 'korsoandi@szmg.hu';
const FIRESTORE_INVOICES = 'invoices';

export const syncInvoicesFromEmail = onSchedule(
  {
    schedule: '0 7,12,18 * * *',
    timeZone: 'Europe/Budapest',
    secrets: [GMAIL_USER, GMAIL_PASS],
    timeoutSeconds: 300,
  },
  async (event) => {
    console.log('Indul az email alapú számlafeldolgozás (ÖSSZES email ellenőrzésével)...');
    
    // 1. Meglévő számlák lekérése a Firestore-ból (hogy tudjuk, mit NE töltsünk le)
    const db = admin.firestore();
    const invoicesRef = db.collection(FIRESTORE_INVOICES);
    const existingDocs = await invoicesRef.get();
    
    // Készítünk egy gyors keresőtömböt az eddigi hónapokhoz (pl. "2026-12")
    const existingMonths = new Set<string>();
    existingDocs.forEach(doc => {
      const data = doc.data();
      existingMonths.add(`${data.target_year}-${data.target_month}`);
    });

    console.log(`Firestore-ból betöltve ${existingMonths.size} db korábbi számla hónap.`);

    // 2. Gmail IMAP kapcsolat
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: GMAIL_USER.value(),
        pass: GMAIL_PASS.value(),
      },
      logger: false,
    });

    try {
      await client.connect();
      console.log('IMAP kapcsolat sikeres.');

      const lock = await client.getMailboxLock('INBOX');
      try {
        const searchCriteria = {
          from: EMAIL_SENDER,
          subject: 'Számla'
          // Nincs 'seen: false', tehát az összeset megtalálja
        };

        // CSAK A FEJLÉCEKET (envelope) kérjük le először, hogy gyors legyen és ne egye a RAM-ot
        const messages = client.fetch(searchCriteria, { envelope: true, uid: true });
        let newInvoiceCount = 0;

        for await (const msg of messages) {
          if (!msg.envelope) continue;
          const emailDate = msg.envelope.date || new Date();
          
          // Kiszámoljuk a cél hónapot ugyanazzal a logikával
          let targetMonth = emailDate.getMonth(); // 0-indexed -> ez lesz az előző hónap 1-indexed formája!
          let targetYear = emailDate.getFullYear();
          if (targetMonth === 0) {
            targetMonth = 12;
            targetYear -= 1;
          }

          const monthKey = `${targetYear}-${targetMonth}`;

          // Ellenőrizzük, hogy ez a hónap már benne van-e az adatbázisban
          if (existingMonths.has(monthKey)) {
            console.log(`[SKIPPED] ${monthKey} már megvan az adatbázisban (UID: ${msg.uid}). Nem töltjük le a PDF-et.`);
            continue; // Ugrás a következőre (PDF letöltése nélkül!)
          }

          console.log(`[FELDOLGOZÁS] Új vagy hiányzó hónap: ${monthKey} (UID: ${msg.uid}). PDF letöltése...`);
          
          // Csak most kérjük le a teljes levelet a PDF-el együtt, ha még nincs meg az adatbázisban!
          const fullMsg = await client.fetchOne(msg.uid, { source: true });
          if (!fullMsg || !fullMsg.source) {
             console.log('Hiba a levél letöltésekor, ugrás...');
             continue;
          }

          const parsedMail = await simpleParser(fullMsg.source);
          let invoiceSaved = false;

          for (const attachment of parsedMail.attachments) {
            if (attachment.contentType === 'application/pdf') {
              const pdfData = await pdfParse(attachment.content as Buffer);
              const text = pdfData.text;

              const regex = /(Végösszeg|Fizetendő|Összesen)\s*:?\s*([\d\s\.]+)\s*(Ft|HUF)/i;
              const match = regex.exec(text);
              
              let amount: number | null = null;
              if (match) {
                const amountStr = match[2].replace(/[\s\xa0\.]/g, '');
                amount = parseInt(amountStr, 10);
              } else {
                const altRegex = /(?<!\d)([\d\s\.]+)\s*(Ft|HUF)/ig;
                let altMatch;
                let lastAltMatch = null;
                while ((altMatch = altRegex.exec(text)) !== null) {
                  lastAltMatch = altMatch;
                }
                if (lastAltMatch) {
                  const amountStr = lastAltMatch[1].replace(/[\s\xa0\.]/g, '');
                  amount = parseInt(amountStr, 10);
                }
              }

              if (amount) {
                const invDateStr = emailDate.toISOString().split('T')[0];
                
                await invoicesRef.add({
                  inv_date: invDateStr,
                  target_year: targetYear,
                  target_month: targetMonth,
                  amount: amount,
                  filename: attachment.filename || 'szamla.pdf'
                });
                
                console.log(`+ Rögzítve a Firestore-ba: ${targetYear}. ${targetMonth}. hóhoz, ${amount} Ft`);
                existingMonths.add(monthKey); // Hozzáadjuk a set-hez, hogy ezen a futáson belül se töltsük le újra
                newInvoiceCount++;
                invoiceSaved = true;
                break;
              }
            }
          }
        }
        
        console.log(`Feldolgozás kész. ${newInvoiceCount} új számla rögzítve.`);

      } finally {
        lock.release();
      }
    } catch (err) {
      console.error('Hiba az email feldolgozása közben:', err);
    } finally {
      await client.logout();
    }
  }
);
