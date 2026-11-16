import { uebernehmeOhneArmierung } from "./reattach.ts";

const HOECHSTDAUER = "hoechstdauer";
const MAX_VERSUCHE = 3;

interface Anruf {
  id: string;
  status?: string;
}

interface Treffer {
  callId: string;
  versuche: number;
}

interface FristenLaufAbhaengigkeiten {
  store: {
    faelligeFristen: (anfrage: { art: string; limitJeMandant: number; leaseMs: number }) => Promise<Treffer[]>;
    getCall: (callId: string) => Anruf | null | undefined;
    attachActiveCall: (callId: string) => Promise<Anruf | null | undefined>;
  };
  beende: (call: Anruf) => Promise<unknown>;
  limitJeMandant: number;
  leaseMs: number;
}

interface TaktErgebnis {
  beendet: number;
  offen: number;
  gelesen: boolean;
}

export function makeFristenLauf({ store, beende, limitJeMandant, leaseMs }: FristenLaufAbhaengigkeiten) {
  function offen(callId: string, versuche: number): "offen" {
    if (versuche >= MAX_VERSUCHE) console.error(`[fristen] Beenden nach ${String(versuche)} Versuchen nicht gelungen: ${callId}`);
    return "offen";
  }

  async function bearbeite({ callId, versuche }: Treffer): Promise<"beendet" | "offen" | "weg"> {
    try {
      const call = await uebernehmeOhneArmierung(callId, store.attachActiveCall);
      if (!call) return "weg";
      await beende(call);
    } catch (fehler) {
      console.error(`[fristen] Beenden fehlgeschlagen: ${callId}`, String(fehler));
      return offen(callId, versuche);
    }
    return store.getCall(callId)?.status === "active" ? offen(callId, versuche) : "beendet";
  }

  async function takt(): Promise<TaktErgebnis> {
    let treffer: Treffer[];
    try {
      treffer = await store.faelligeFristen({ art: HOECHSTDAUER, limitJeMandant, leaseMs });
    } catch (fehler) {
      console.error(`[fristen] Takt: faellige Fristen lesen fehlgeschlagen: ${Reflect.get(Object(fehler), "message")}`);
      return { beendet: 0, offen: 0, gelesen: false };
    }
    const ergebnisse = await Promise.all(treffer.map(bearbeite));
    return {
      beendet: ergebnisse.filter((ergebnis) => ergebnis === "beendet").length,
      offen: ergebnisse.filter((ergebnis) => ergebnis === "offen").length,
      gelesen: true,
    };
  }

  return { takt };
}
