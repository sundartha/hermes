import { MS_PER_MINUTE } from "../utils/timer.js";

const RESERVE_MINUTEN = 15;

export const ZEITPLAN_RESERVE_MS = RESERVE_MINUTEN * MS_PER_MINUTE;

interface Herzschlag {
  intervallMs: number;
  seitMs: number;
  zuletztMs: number | null;
  jetztMs: number;
}

export function herzschlagUeberfaellig({ intervallMs, seitMs, zuletztMs, jetztMs }: Herzschlag): boolean {
  const letzter = Math.max(seitMs, zuletztMs ?? seitMs);
  return jetztMs - letzter > intervallMs + ZEITPLAN_RESERVE_MS;
}
