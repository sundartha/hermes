import { uebernehmeOhneArmierung } from "./reattach.ts";

const HOECHSTDAUER = "hoechstdauer";
const GELD = "geld";
const MAX_VERSUCHE = 3;

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

interface FristenLaufAbhaengigkeiten {
  store: {
    faelligeFristen: (anfrage: { art: string; limitJeMandant: number; leaseMs: number }) => Promise<Treffer[]>;
    getCall: (callId: string) => Anruf | null | undefined;
    attachActiveCall: (callId: string) => Promise<Anruf | null | undefined>;
    setzeGeldFrist: (frist: { callId: string; tenantId: string; faelligAt: string }) => Promise<unknown>;
  };
  beende: (call: Anruf) => Promise<unknown>;
  geld?: GeldAbhaengigkeiten;
  limitJeMandant: number;
  leaseMs: number;
}

interface TaktErgebnis {
  beendet: number;
  offen: number;
  gelesen: boolean;
}

export function makeFristenLauf({ store, beende, limitJeMandant, leaseMs, geld }: FristenLaufAbhaengigkeiten): {
  takt: () => Promise<TaktErgebnis>;
  geldTakt: () => Promise<TaktErgebnis>;
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

  async function lies(art: string): Promise<Treffer[] | null> {
    try {
      return await store.faelligeFristen({ art, limitJeMandant, leaseMs });
    } catch (fehler) {
      console.error(`[fristen] Takt: faellige Fristen lesen fehlgeschlagen: ${String(Reflect.get(Object(fehler), "message"))}`);
      return null;
    }
  }

  async function runde(
    art: string,
    faellig: (treffer: Treffer) => Promise<boolean>,
    beendeAnruf: (call: Anruf) => Promise<unknown>,
  ): Promise<TaktErgebnis> {
    const treffer = await lies(art);
    if (!treffer) return { beendet: 0, offen: 0, gelesen: false };
    const ergebnisse = await Promise.all(treffer.map(async (eintrag) => bearbeite(eintrag, faellig, beendeAnruf)));
    return {
      beendet: ergebnisse.filter((ergebnis) => ergebnis === "beendet").length,
      offen: ergebnisse.filter((ergebnis) => ergebnis === "offen").length,
      gelesen: true,
    };
  }

  return {
    takt: async () => runde(HOECHSTDAUER, hoechstdauerFaellig, beende),
    geldTakt: async () => (geld ? runde(GELD, geldFaellig(geld), geld.beende) : { beendet: 0, offen: 0, gelesen: true }),
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

async function beideRunden(lauf: { takt: () => Promise<unknown>; geldTakt: () => Promise<unknown> }): Promise<void> {
  try {
    await lauf.takt();
  } finally {
    await lauf.geldTakt();
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
    beideRunden(lauf)
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
