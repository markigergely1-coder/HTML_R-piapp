/**
 * Email küldés frontend wrapper — hívja a `sendBillingEmails` Cloud Function-t.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

const FUNCTIONS_REGION = 'europe-west1';

export interface PersonalEmail {
  to: string;
  name: string;
  count: number;
  amount: number;
  guestDetails?: {
    ownCount: number;
    ownCost: number;
    guests: { name: string; count: number; cost: number }[];
  };
}

export interface SendBillingEmailsInput {
  year: number;
  monthName: string;
  personal: PersonalEmail[];
  adminEmail?: string;
  adminSummaryRows?: { name: string; count: number; amount: number }[];
  /** Base64 PDF (admin email csatolmány) */
  pdfBase64?: string;
}

export interface SendBillingEmailsResult {
  totalRequested: number;
  personalSent: number;
  personalFailed: { to: string; reason: string }[];
  adminSent: boolean;
  adminError?: string;
}

export async function sendBillingEmails(input: SendBillingEmailsInput): Promise<SendBillingEmailsResult> {
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const fn = httpsCallable<SendBillingEmailsInput, SendBillingEmailsResult>(functions, 'sendBillingEmails');
  const res = await fn(input);
  return res.data;
}

/** Blob → base64 string (PDF csatolmányhoz). */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader result not string'));
        return;
      }
      // `data:application/pdf;base64,XXX` → csak az XXX kell
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
