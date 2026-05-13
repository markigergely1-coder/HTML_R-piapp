/**
 * PDF generálás a havi elszámoláshoz (Python `generate_pdf_bytes` port).
 *
 * jsPDF + jspdf-autotable kombinációval. A jsPDF beépített Helvetica
 * font-ja nem támogatja teljes körűen a magyar ékezeteket — ezért
 * minden szöveget a "safeText" függvény először latin-1 kompatibilis
 * helyettesítésre konvertál (ahogy a Python fallback verzió is).
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { SettlementPersonRow } from './firestore';
import { formatHuf } from './cost';

/**
 * Helyettesíti az ékezetes karaktereket, amik a Helvetica nem támogat
 * direkten, és átkonvertálja a karaktereket latin-1 kompatibilisre.
 * (Az `ő` és `ű` Latin-1-ben nincs, ezért `ö`/`ü`-re cseréljük.)
 */
function safeText(s: string): string {
  return s
    .replace(/ő/g, 'ö')
    .replace(/ű/g, 'ü')
    .replace(/Ő/g, 'Ö')
    .replace(/Ű/g, 'Ü');
}

export function generateSettlementPdf(input: {
  year: number;
  monthName: string;
  perPerson: SettlementPersonRow[];
}): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Cím
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(safeText(`Havi Röplabda Elszámolás — ${input.year}. ${input.monthName}`), 105, 20, {
    align: 'center',
  });

  // Alcím
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110);
  const generatedAt = new Date().toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.text(safeText(`Generálva: ${generatedAt}`), 105, 27, { align: 'center' });
  doc.setTextColor(0);

  // Tábla
  const rows = input.perPerson.map((p) => [
    safeText(p.name),
    String(p.count),
    safeText(formatHuf(p.amount)),
  ]);
  const total = input.perPerson.reduce((s, p) => s + p.amount, 0);
  const totalCount = input.perPerson.reduce((s, p) => s + p.count, 0);

  autoTable(doc, {
    startY: 38,
    head: [[safeText('Név'), safeText('Részvétel'), safeText('Fizetendő')]],
    body: rows,
    foot: [[
      { content: safeText('Összesen'), styles: { fontStyle: 'bold' } },
      { content: String(totalCount), styles: { fontStyle: 'bold', halign: 'center' } },
      { content: safeText(formatHuf(total)), styles: { fontStyle: 'bold', halign: 'right' } },
    ]],
    headStyles: {
      fillColor: [74, 144, 217],   // brand kék (a Streamlit verzióhoz hasonló)
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    footStyles: {
      fillColor: [234, 244, 255],
      textColor: [30, 60, 100],
    },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { halign: 'center', cellWidth: 35 },
      2: { halign: 'right', cellWidth: 45 },
    },
    styles: {
      fontSize: 11,
      cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
    },
    alternateRowStyles: { fillColor: [248, 248, 248] },
  });

  // Footer
  const pageHeight = doc.internal.pageSize.height;
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(safeText('Röpi App Pro — automatikusan generált dokumentum'), 105, pageHeight - 10, {
    align: 'center',
  });

  return doc.output('blob');
}

/** Letölti a PDF-et a böngészőben. */
export function downloadPdf(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
