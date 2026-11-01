export const SCHADEN_FEHLER = "fehler";
export const SCHADEN_EVENT_LOOP = "event-loop";
export const SCHADEN_POOL = "pool";

const gemeldet = new Set();

export function meldeSchaden(grund) {
  gemeldet.add(grund);
}

export function gemeldeterSchaden() {
  return gemeldet.values().next().value ?? null;
}

export function starteLoopWache({ taktMs, taktJeFenster, grenzeMs, fensterFolge, uhr }) {
  let letzterTakt = uhr();
  let taktImFenster = 0;
  let groessterVerzug = 0;
  let schlechteFenster = 0;
  setInterval(() => {
    const aktuell = uhr();
    groessterVerzug = Math.max(groessterVerzug, aktuell - letzterTakt - taktMs);
    letzterTakt = aktuell;
    taktImFenster += 1;
    if (taktImFenster < taktJeFenster) return;
    schlechteFenster = groessterVerzug > grenzeMs ? schlechteFenster + 1 : 0;
    taktImFenster = 0;
    groessterVerzug = 0;
  }, taktMs).unref();
  return () => schlechteFenster >= fensterFolge;
}

export function macheStauPruefung({ zustand, grenzeMs, uhr }) {
  let stauSeit = null;
  return () => {
    const pool = zustand?.();
    if (!pool || pool.wartend === 0) {
      stauSeit = null;
      return false;
    }
    stauSeit ??= uhr();
    return uhr() - stauSeit >= grenzeMs;
  };
}
