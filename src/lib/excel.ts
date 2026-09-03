/**
 * Excel generálás a havi elszámoláshoz.
 *
 * SheetJS (xlsx) könyvtárat használ. Két sheet-et hoz létre:
 *  1. „Összesítő" — személyenkénti összegzés (Név, Részvétel, Fizetendő)
 *  2. „Bontás" — alkalomkénti bontás (Dátum, Költség/alkalom, Létszám, Költség/fő)
 */

import * as XLSX from 'xlsx';
import type { SettlementPersonRow, SettlementBreakdownRow } from './firestore';

export interface ExcelSettlementInput {
  year: number;
  monthName: string;
  perPerson: SettlementPersonRow[];
  breakdown?: SettlementBreakdownRow[];
  bankFeeApplied?: boolean;
}

/**
 * Generálja az Excel workbook-ot Blob formában (.xlsx).
 */
export function generateSettlementExcel(input: ExcelSettlementInput): Blob {
  const wb = XLSX.utils.book_new();

  // --- Sheet 1: Összesítő (személy × összeg) ---
  const feeSuffix = input.bankFeeApplied ? ' (+1% banki díjjal, Ft)' : ' (Ft)';
  const summaryHeader = ['Név', 'Részvétel', `Fizetendő${feeSuffix}`];
  const summaryRows = input.perPerson.map((p) => [
    p.name,
    p.count,
    Math.round(p.amount),
  ]);

  const totalCount = input.perPerson.reduce((s, p) => s + p.count, 0);
  const totalAmount = input.perPerson.reduce((s, p) => s + p.amount, 0);
  summaryRows.push(['Összesen', totalCount, Math.round(totalAmount)]);

  const titlePrefix = input.bankFeeApplied
    ? `Havi Röplabda Elszámolás (+1% banki költség) — ${input.year}. ${input.monthName}`
    : `Havi Röplabda Elszámolás — ${input.year}. ${input.monthName}`;

  const summaryData = [
    [titlePrefix],
    [],
    summaryHeader,
    ...summaryRows,
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);

  // Oszlopszélességek
  wsSummary['!cols'] = [
    { wch: 30 },  // Név
    { wch: 12 },  // Részvétel
    { wch: input.bankFeeApplied ? 26 : 18 },  // Fizetendő
  ];

  XLSX.utils.book_append_sheet(wb, wsSummary, 'Összesítő');

  // --- Sheet 2: Bontás (alkalmanként) ---
  if (input.breakdown && input.breakdown.length > 0) {
    const costPerPersonHeader = input.bankFeeApplied ? 'Költség / fő (+1% díjjal, Ft)' : 'Költség / fő (Ft)';
    const breakdownHeader = ['Dátum', 'Költség / alkalom (Ft)', 'Létszám', costPerPersonHeader];
    const breakdownRows = input.breakdown.map((b) => [
      b.date,
      Math.round(b.costPerSession),
      b.attendeeCount,
      Math.round(b.costPerPerson),
    ]);

    const breakdownTitle = input.bankFeeApplied
      ? `Bontás alkalmanként (+1% banki költséggel) — ${input.year}. ${input.monthName}`
      : `Bontás alkalmanként — ${input.year}. ${input.monthName}`;

    const breakdownData = [
      [breakdownTitle],
      [],
      breakdownHeader,
      ...breakdownRows,
    ];

    const wsBreakdown = XLSX.utils.aoa_to_sheet(breakdownData);

    wsBreakdown['!cols'] = [
      { wch: 14 },  // Dátum
      { wch: 22 },  // Költség/alkalom
      { wch: 10 },  // Létszám
      { wch: 20 },  // Költség/fő
    ];

    XLSX.utils.book_append_sheet(wb, wsBreakdown, 'Bontás');
  }

  // Workbook → ArrayBuffer → Blob
  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbOut], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Letölti az Excel fájlt a böngészőben. */
export function downloadExcel(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
