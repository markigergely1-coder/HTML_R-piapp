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
    console.log('Indul az email alapú számlafeldolgozás...');
    
    // 1. Gmail IMAP kapcsolat
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: GMAIL_USER.value(),
        pass: GMAIL_PASS.value(),
      },
      logger: false, // Ne szemetelje tele a logot
    });

    try {
      await client.connect();
      console.log('IMAP kapcsolat sikeres.');

      // 2. Olvasatlan levelek keresése a megadott feladótól
      const lock = await client.getMailboxLock('INBOX');
      try {
        const searchCriteria = {
          from: EMAIL_SENDER,
          subject: 'Számla',
          seen: false, // Csak az olvasatlanok
        };

        const messages = client.fetch(searchCriteria, { source: true, uid: true });
        let newInvoiceCount = 0;

        for await (const msg of messages) {
          console.log(`Új levél feldolgozása, UID: ${msg.uid}`);
          
          if (!msg.source) {
            console.log('Nincs levél forrás, ugrás...');
            continue;
          }

          const parsedMail = await simpleParser(msg.source);
          const emailDate = parsedMail.date || new Date();
          
          let invoiceSaved = false;

          // Csatolmányok keresése
          for (const attachment of parsedMail.attachments) {
            if (attachment.contentType === 'application/pdf') {
              console.log(`PDF csatolmány találva: ${attachment.filename}`);
              
              const pdfData = await pdfParse(attachment.content as Buffer);
              const text = pdfData.text;

              // Regex az összeg kinyerésére
              const regex = /(Végösszeg|Fizetendő|Összesen)\s*:?\s*([\d\s\.]+)\s*(Ft|HUF)/i;
              const match = regex.exec(text);
              
              let amount: number | null = null;
              if (match) {
                const amountStr = match[2].replace(/[\s\xa0\.]/g, '');
                amount = parseInt(amountStr, 10);
              } else {
                // Alternatív fallback keresés
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
                // Hónap számítása: Mindig az email érkezésének ELŐZŐ hónapja
                let targetMonth = emailDate.getMonth(); // 0-indexed, so getMonth() is the previous month (1-12 in our logic)!
                let targetYear = emailDate.getFullYear();
                
                // Ha január van (getMonth() == 0), akkor a célhónap december (12), és előző év.
                if (targetMonth === 0) {
                  targetMonth = 12;
                  targetYear -= 1;
                }

                // Csekkoljuk a duplikációkat a Firestore-ban
                const db = admin.firestore();
                const invoicesRef = db.collection(FIRESTORE_INVOICES);
                
                // Lekérjük az összeset (mivel valószínűleg nem sok van) vagy specifikusan egyet.
                // Itt most ellenőrizzük az évet és a hónapot, és az összeget.
                const querySnapshot = await invoicesRef
                  .where('target_year', '==', targetYear)
                  .where('target_month', '==', targetMonth)
                  .where('amount', '==', amount)
                  .get();

                if (!querySnapshot.empty) {
                  console.log(`Már létező számla a Firestore-ban: ${targetYear}. ${targetMonth} hó, ${amount} Ft. Nem mentem újra.`);
                } else {
                  // Hozzáadjuk a Firestore-hoz
                  const invDateStr = emailDate.toISOString().split('T')[0]; // YYYY-MM-DD
                  
                  await invoicesRef.add({
                    inv_date: invDateStr,
                    target_year: targetYear,
                    target_month: targetMonth,
                    amount: amount,
                    filename: attachment.filename || 'szamla.pdf'
                  });
                  console.log(`+ Rögzítve a Firestore-ba: ${targetYear}. ${targetMonth}. hóhoz, ${amount} Ft`);
                  newInvoiceCount++;
                }
                
                invoiceSaved = true;
                break; // Csak az első PDF-et dolgozzuk fel elemenként
              } else {
                console.log('Nem található összeg a PDF-ben.');
              }
            }
          }

          // Ha sikeresen feldolgoztuk, megjelöljük olvasottként
          if (invoiceSaved) {
            await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });
            console.log(`Levél (UID: ${msg.uid}) olvasottnak jelölve.`);
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
