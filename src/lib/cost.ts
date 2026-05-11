/**
 * Játékos fizetendő összegének becslése — `modules/utils.py::estimate_cost_for_player` portja.
 */

export interface CostEstimate {
  precise: number;
  simple: number;
  hourlyRate: number;
  duration: number;
  avgAttendees: number;
  costPerSessionPrecise: number;
}

/**
 * - Pontosabb: (óradíj × időtartam) / résztvevőszám × alkalmak
 * - Egyszerű:  alkalmak × 2 300 Ft
 */
export function estimateCost(sessionCount: number, year: number, avgAttendees?: number): CostEstimate {
  const hourlyRate = year <= 2024 ? 14_000 : 16_000;
  const duration = 1.5;
  const attendees = avgAttendees && avgAttendees > 0 ? avgAttendees : 12.0;
  const costPerSessionPrecise = (hourlyRate * duration) / attendees;
  return {
    precise: sessionCount * costPerSessionPrecise,
    simple: sessionCount * 2_300,
    hourlyRate,
    duration,
    avgAttendees: attendees,
    costPerSessionPrecise,
  };
}

/** "85 200 Ft" formátum (szóköz ezres elválasztó). */
export function formatHuf(amount: number): string {
  return `${Math.round(amount).toLocaleString('hu-HU').replace(/[  ]/g, ' ')} Ft`;
}

/** "85 200" (Ft nélkül). */
export function formatNumber(amount: number): string {
  return Math.round(amount).toLocaleString('hu-HU').replace(/[  ]/g, ' ');
}
