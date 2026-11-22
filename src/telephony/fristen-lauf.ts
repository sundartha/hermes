import { uebernehmeOhneArmierung } from "./reattach.ts";

const HOECHSTDAUER = "hoechstdauer";
const GELD = "geld";
const RESERVE = "reserve";
const ABFRAGE = "abfrage";
const UEBERGABE = "uebergabe";
const MAX_VERSUCHE = 3;
const LESEFEHLER_BIS_ENDE = 2;

interface Anruf {
  id: string;
  twilioSid: string;
  status?: string;
}

interface Treffer {
  callId: string;
  tenantId: string;
  versuche: number;
}

interface GeldAbhaengigkeiten {
  intervalMs: number;
  jetzt: () => number;
  blockingAxisFor: (mandant: { tenantId: string }) => unknown;
  beende: (call: Anruf) => Promise<unknown>;
}

interface ReserveAbhaengigkeiten {
  freigeben: (call: { id: string; tenantId: string }) => unknown;
}

interface AbfrageAbhaengigkeiten {
  pollen: (callId: string) => Promise<unknown>;
}

interface UebergabeAbhaengigkeiten {
  umleiten: (callId: string) => Promise<unknown>;
}

interface FristenLaufAbhaengigkeiten {
  store: {
    faelligeFristen: (anfrage: { art: string; limitJeMandant: number; leaseMs: number }) => Promise<Treffer[]>;
    getCall: (callId: string) => (Anruf & { tenantId: string }) | null | undefined;
    attachActiveCall: (callId: string) => Promise<Anruf | null | undefined>;
    setzeGeldFrist: (frist: { callId: string; tenantId: string; faelligAt: string }) => Promise<unknown>;
    setzeReserveFrist: (frist: { callId: string; tenantId: string; faelligAt: string | null }) => Promise<unknown>;
    setzeUebergabeFrist: (frist: { callId: string; tenantId: string; faelligAt: string | null }) => Promise<unknown>;
  };
  beende: (call: Anruf) => Promise<unknown>;
  geld?: GeldAbhaengigkeiten;
  reserve?: ReserveAbhaengigkeiten;
  abfrage?: AbfrageAbhaengigkeiten;
  uebergabe?: UebergabeAbhaengigkeiten;
  abgelaufeneHier?: () => Anruf[];
  limitJeMandant: number;
  leaseMs: number;
}

interface TaktErgebnis {
  beendet: number;
  offen: number;
  gelesen: boolean;
}

async function beendeAlle(
  anrufe: Anruf[],
  beende: (call: Anruf) => Promise<unknown>,
): Promise<{ beendet: number; offen: number }> {
  const ergebnisse = await Promise.all(
    anrufe.map(async (call) => {
      try {
        await beende(call);
        return "beendet";
      } catch (fehler) {
        console.error(`[fristen] Beenden fehlgeschlagen: ${call.id}`, String(fehler));
        return "offen";
      }
    }),
  );
  return {
    beendet: ergebnisse.filter((ergebnis) => ergebnis === "beendet").length,
    offen: ergebnisse.filter((ergebnis) => ergebnis === "offen").length,
  };
}

export function makeFristenLauf({
  store, beende, limitJeMandant, leaseMs, geld, reserve, abfrage, uebergabe, abgelaufeneHier,
}: FristenLaufAbhaengigkeiten): {
  takt: () => Promise<TaktErgebnis>;
  geldTakt: () => Promise<TaktErgebnis>;
  reserveTakt: () => Promise<TaktErgebnis>;
  abfrageTakt: () => Promise<TaktErgebnis>;
  uebergabeTakt: () => Promise<TaktErgebnis>;
} {
  function offen(callId: string, versuche: number): "offen" {
    if (versuche >= MAX_VERSUCHE) console.error(`[fristen] Beenden nach ${String(versuche)} Versuchen nicht gelungen: ${callId}`);
    return "offen";
  }

  const hoechstdauerFaellig = (): Promise<boolean> => Promise.resolve(true);

  const geldFaellig = (wache: GeldAbhaengigkeiten) => async ({ callId, tenantId }: Treffer): Promise<boolean> => {
    if (await wache.blockingAxisFor({ tenantId })) return true;
    const faelligAt = new Date(wache.jetzt() + wache.intervalMs).toISOString();
    await store.setzeGeldFrist({ callId, tenantId, faelligAt });
    return false;
  };

  async function bearbeite(
    treffer: Treffer,
    faellig: (treffer: Treffer) => Promise<boolean>,
    beendeAnruf: (call: Anruf) => Promise<unknown>,
  ): Promise<"beendet" | "offen" | "weg"> {
    const { callId, versuche } = treffer;
    try {
      if (!(await faellig(treffer))) return "weg";
      const call = await uebernehmeOhneArmierung(callId, store.attachActiveCall);
      if (!call) return "weg";
      await beendeAnruf(call);
    } catch (fehler) {
      console.error(`[fristen] Beenden fehlgeschlagen: ${callId}`, String(fehler));
      return offen(callId, versuche);
    }
    return store.getCall(callId)?.status === "active" ? offen(callId, versuche) : "beendet";
  }

  async function gibReserveFrei(wache: ReserveAbhaengigkeiten, { callId, tenantId, versuche }: Treffer): Promise<"beendet" | "offen"> {
    try {
      await wache.freigeben(store.getCall(callId) ?? { id: callId, tenantId });
      await store.setzeReserveFrist({ callId, tenantId, faelligAt: null });
    } catch (fehler) {
      console.error(`[fristen] Reserve freigeben fehlgeschlagen: ${callId}`, String(fehler));
      return offen(callId, versuche);
    }
    return "beendet";
  }

  async function starteAbfrage(wache: AbfrageAbhaengigkeiten, { callId, versuche }: Treffer): Promise<"weg" | "offen"> {
    try {
      await wache.pollen(callId);
    } catch (fehler) {
      console.error(`[fristen] Abfrage starten fehlgeschlagen: ${callId}`, String(fehler));
      return offen(callId, versuche);
    }
    return "weg";
  }

  async function leiteUm(wache: UebergabeAbhaengigkeiten, { callId, tenantId, versuche }: Treffer): Promise<"weg" | "offen"> {
    try {
      await wache.umleiten(callId);
      await store.setzeUebergabeFrist({ callId, tenantId, faelligAt: null });
    } catch (fehler) {
      console.error(`[fristen] Uebergabe umleiten fehlgeschlagen: ${callId}`, String(fehler));
      return offen(callId, versuche);
    }
    return "weg";
  }

  async function lies(art: string): Promise<Treffer[] | null> {
    try {
      return await store.faelligeFristen({ art, limitJeMandant, leaseMs });
    } catch (fehler) {
      console.error(`[fristen] Takt: faellige Fristen lesen fehlgeschlagen: ${String(Reflect.get(Object(fehler), "message"))}`);
      return null;
    }
  }

  async function runde(art: string, bearbeiter: (treffer: Treffer) => Promise<"beendet" | "offen" | "weg">): Promise<TaktErgebnis> {
    const treffer = await lies(art);
    if (!treffer) return { beendet: 0, offen: 0, gelesen: false };
    const ergebnisse = await Promise.all(treffer.map(bearbeiter));
    return {
      beendet: ergebnisse.filter((ergebnis) => ergebnis === "beendet").length,
      offen: ergebnisse.filter((ergebnis) => ergebnis === "offen").length,
      gelesen: true,
    };
  }

  const nichts = { beendet: 0, offen: 0, gelesen: true };

  let lesefehlerInFolge = 0;

  async function hoechstdauerTakt(): Promise<TaktErgebnis> {
    const ergebnis = await runde(HOECHSTDAUER, async (treffer) => bearbeite(treffer, hoechstdauerFaellig, beende));
    lesefehlerInFolge = ergebnis.gelesen ? 0 : lesefehlerInFolge + 1;
    if (lesefehlerInFolge < LESEFEHLER_BIS_ENDE) return ergebnis;
    return { ...ergebnis, ...(await beendeAlle(abgelaufeneHier?.() ?? [], beende)) };
  }

  return {
    takt: hoechstdauerTakt,
    geldTakt: async () => (geld ? runde(GELD, async (treffer) => bearbeite(treffer, geldFaellig(geld), geld.beende)) : nichts),
    reserveTakt: async () => (reserve ? runde(RESERVE, async (treffer) => gibReserveFrei(reserve, treffer)) : nichts),
    abfrageTakt: async () => (abfrage ? runde(ABFRAGE, async (treffer) => starteAbfrage(abfrage, treffer)) : nichts),
    uebergabeTakt: async () => (uebergabe ? runde(UEBERGABE, async (treffer) => leiteUm(uebergabe, treffer)) : nichts),
  };
}

interface Uhr<Takt extends { unref: () => unknown }> {
  setzeTakt: (aufgabe: () => void, ms: number) => Takt;
  loescheTakt: (takt: Takt) => void;
}

interface FristenTaktAbhaengigkeiten<Takt extends { unref: () => unknown }> extends FristenLaufAbhaengigkeiten {
  taktMs: number;
  uhr: Uhr<Takt>;
}

function starteAbfrageRunde(abfrageTakt: () => Promise<unknown>): void {
  abfrageTakt().catch((fehler: unknown) => {
    console.error(`[fristen] Abfrage-Runde abgebrochen: ${String(fehler)}`);
  });
}

async function alleRunden(lauf: {
  takt: () => Promise<unknown>;
  geldTakt: () => Promise<unknown>;
  reserveTakt: () => Promise<unknown>;
  abfrageTakt: () => Promise<unknown>;
  uebergabeTakt: () => Promise<unknown>;
}): Promise<void> {
  try {
    await lauf.takt();
  } finally {
    try {
      await lauf.geldTakt();
    } finally {
      try {
        await lauf.reserveTakt();
      } finally {
        try {
          starteAbfrageRunde(lauf.abfrageTakt);
        } finally {
          await lauf.uebergabeTakt();
        }
      }
    }
  }
}

export function starteFristenTakt<Takt extends { unref: () => unknown }>({
  taktMs,
  uhr,
  ...abhaengigkeiten
}: FristenTaktAbhaengigkeiten<Takt>): { stoppen: () => void } {
  const lauf = makeFristenLauf(abhaengigkeiten);
  let laeuft = false;
  const takt = uhr.setzeTakt(() => {
    if (laeuft) return;
    laeuft = true;
    alleRunden(lauf)
      .catch((fehler: unknown) => {
        console.error(`[fristen] Takt abgebrochen: ${String(fehler)}`);
      })
      .finally(() => {
        laeuft = false;
      });
  }, taktMs);
  takt.unref();
  return {
    stoppen: () => {
      uhr.loescheTakt(takt);
    },
  };
}
