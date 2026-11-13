import { HTTP_NOT_FOUND } from "../utils/http.ts";
import { REIFE } from "../begriffe/abrechnung.js";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.js";
import { KOSTENART, KOSTENARTEN, KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { EL_BELEG_QUELLE, elBelegBetrag } from "../elevenlabs/kosten-beleg.js";
import type { AbschlussAnruf, AbschlussBeleg } from "./kosten-abschluss.ts";

type ElReifungErgebnis = (typeof EL_REIFUNG_ERGEBNIS)[keyof typeof EL_REIFUNG_ERGEBNIS];

interface ReifungAnruf extends AbschlussAnruf {
  id: string;
}

interface ReifungBeleg extends AbschlussBeleg {
  betragMikroCents: number;
  versuche?: number | undefined;
}

interface ReifungSpeicher {
  callCostEvidence(callId: string): ReifungBeleg[];
  recordCallCostEvidence(eintrag: Record<string, unknown>): unknown;
}

interface ElKostenLeser {
  fetchConversation(conversationId: string | null | undefined): Promise<{ metadata?: unknown } | null | undefined>;
}

interface ReifungEinstellungen {
  elEvidenceMinAgeMinutes: number;
  costTruingMaxAttempts: number;
}

interface ReifungsFenster {
  nowMs: number;
  minAgeMs: number;
  maxVersuche: number;
}

type Kandidatenpruefung =
  | { kandidat: true; zeile: ReifungBeleg }
  | { kandidat: false; grund: string };

export const EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP = 25;

export const EL_REIFUNG_ERGEBNIS = Object.freeze({
  BESTAETIGT: "bestaetigt",
  HOEHER: "hoeher",
  NIEDRIGER: "niedriger",
  UNBESCHAFFBAR: "unbeschaffbar",
  FEHLVERSUCH: "fehlversuch",
});

const ABWEICHENDE_ERGEBNISSE: ReadonlySet<ElReifungErgebnis> = new Set([EL_REIFUNG_ERGEBNIS.HOEHER, EL_REIFUNG_ERGEBNIS.NIEDRIGER]);

export const EL_REIFUNG_SKIP = Object.freeze({
  KEIN_EL_PROFIL: "kein_el_profil",
  KEINE_CONVERSATION_ID: "keine_conversation_id",
  KEINE_EL_ZEILE: "keine_elevenlabs_convai_zeile",
  ZEILE_FERTIG: "zeile_bereits_belegt_oder_terminal",
  NICHT_NACHREIFBAR: "zeile_nicht_nachreifbar",
  ZU_JUNG: "unter_mindestalter",
  VERSUCHE_ERSCHOEPFT: "versuche_erschoepft",
});

interface ZeilenBezug {
  store: ReifungSpeicher;
  call: ReifungAnruf;
  zeile: ReifungBeleg;
}

function fehlerText(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

function providerStatusVon(fehler: unknown): unknown {
  return typeof fehler === "object" && fehler !== null && "providerStatus" in fehler ? fehler.providerStatus : undefined;
}

function elZeileVon(belege: ReifungBeleg[]): ReifungBeleg | undefined {
  return belege.find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
}

function reifbareZeileOderGrund({ call, belege }: {
  call: ReifungAnruf;
  belege: ReifungBeleg[];
}): { zeile: ReifungBeleg } | { grund: string } {
  if (kostenprofilFuerAnruf(call) !== KOSTENPROFIL.EL_CONVAI_SIP)
    return { grund: EL_REIFUNG_SKIP.KEIN_EL_PROFIL };
  if (!call.elevenlabsConversationId) return { grund: EL_REIFUNG_SKIP.KEINE_CONVERSATION_ID };
  const zeile = elZeileVon(belege);
  return zeile ? { zeile } : { grund: EL_REIFUNG_SKIP.KEINE_EL_ZEILE };
}

function zeileNichtReifbarGrund({ zeile, call, nowMs, minAgeMs, maxVersuche }: ReifungsFenster & {
  zeile: ReifungBeleg;
  call: ReifungAnruf;
}): string | null {
  if (zeile.reife !== REIFE.VORLAEUFIG) return EL_REIFUNG_SKIP.ZEILE_FERTIG;
  if (zeile.nachreifbar === false) return EL_REIFUNG_SKIP.NICHT_NACHREIFBAR;
  const endedMs = Date.parse(call.endedAt ?? "");
  if (!Number.isFinite(endedMs) || nowMs - endedMs < minAgeMs) return EL_REIFUNG_SKIP.ZU_JUNG;
  if ((zeile.versuche ?? 0) >= maxVersuche) return EL_REIFUNG_SKIP.VERSUCHE_ERSCHOEPFT;
  return null;
}

export function reifungsKandidat({ call, belege, nowMs, minAgeMs, maxVersuche }: ReifungsFenster & {
  call: ReifungAnruf;
  belege: ReifungBeleg[];
}): Kandidatenpruefung {
  const gefunden = reifbareZeileOderGrund({ call, belege });
  if (!("zeile" in gefunden)) return { kandidat: false, grund: gefunden.grund };
  const { zeile } = gefunden;
  const zeitfensterGrund = zeileNichtReifbarGrund({ zeile, call, nowMs, minAgeMs, maxVersuche });
  return zeitfensterGrund ? { kandidat: false, grund: zeitfensterGrund } : { kandidat: true, zeile };
}

export function reifeErgebnis({ altMikroCents, neuMikroCents }: {
  altMikroCents: number;
  neuMikroCents: number;
}): { mikroCents: number; ergebnis: ElReifungErgebnis } {
  if (neuMikroCents === altMikroCents) return { mikroCents: altMikroCents, ergebnis: EL_REIFUNG_ERGEBNIS.BESTAETIGT };
  if (neuMikroCents > altMikroCents) return { mikroCents: neuMikroCents, ergebnis: EL_REIFUNG_ERGEBNIS.HOEHER };
  return { mikroCents: altMikroCents, ergebnis: EL_REIFUNG_ERGEBNIS.NIEDRIGER };
}

function abstandZumGespraechsendeS(call: ReifungAnruf, nowMs: number): number | null {
  const endedMs = Date.parse(call.endedAt ?? "");
  return Number.isFinite(endedMs) ? Math.round((nowMs - endedMs) / MS_PER_SECOND) : null;
}

function schreibeBelegt({ store, call, zeile, mikroCents, nowMs }: {
  store: ReifungSpeicher;
  call: ReifungAnruf;
  zeile: ReifungBeleg;
  mikroCents: number;
  nowMs: number;
}): void {
  store.recordCallCostEvidence({
    callId: call.id,
    traeger: KOSTENART.ELEVENLABS_CONVAI,
    reife: REIFE.BELEGT,
    betragMikroCents: mikroCents,
    waehrung: KOSTENARTEN[KOSTENART.ELEVENLABS_CONVAI].waehrung,
    quelle: EL_BELEG_QUELLE,
    gemessenAt: new Date(nowMs).toISOString(),
    abstandZumGespraechsendeS: abstandZumGespraechsendeS(call, nowMs),
    versuche: (zeile.versuche ?? 0) + 1,
  });
}

function schreibeUnbeschaffbar({ store, call, zeile }: ZeilenBezug): void {
  store.recordCallCostEvidence({
    callId: call.id,
    traeger: KOSTENART.ELEVENLABS_CONVAI,
    reife: REIFE.VORLAEUFIG,
    nachreifbar: false,
    versuche: (zeile.versuche ?? 0) + 1,
  });
}

function schreibeVersuch({ store, call, zeile }: ZeilenBezug): void {
  store.recordCallCostEvidence({
    callId: call.id,
    traeger: KOSTENART.ELEVENLABS_CONVAI,
    reife: REIFE.VORLAEUFIG,
    versuche: (zeile.versuche ?? 0) + 1,
  });
}

function verarbeiteAntwort({ store, call, zeile, conversation, nowMs }: ZeilenBezug & {
  conversation: { metadata?: unknown } | null | undefined;
  nowMs: number;
}): ElReifungErgebnis {
  const ergebnis = elBelegBetrag(conversation?.metadata);
  if ("ablehnung" in ergebnis) {
    console.warn(`[el-reifung] kein Beleg (call=${call.id}): grund=${ergebnis.ablehnung}`);
    schreibeVersuch({ store, call, zeile });
    return EL_REIFUNG_ERGEBNIS.FEHLVERSUCH;
  }
  const { mikroCents, ergebnis: art } = reifeErgebnis({
    altMikroCents: zeile.betragMikroCents, neuMikroCents: ergebnis.mikroCents,
  });
  schreibeBelegt({ store, call, zeile, mikroCents, nowMs });
  return art;
}

async function reifeEinenAnruf({ candidate, store, elKostenRead, nowMs }: {
  candidate: { call: ReifungAnruf; zeile: ReifungBeleg };
  store: ReifungSpeicher;
  elKostenRead: ElKostenLeser;
  nowMs: number;
}): Promise<ElReifungErgebnis> {
  const { call, zeile } = candidate;
  try {
    const conversation = await elKostenRead.fetchConversation(call.elevenlabsConversationId);
    return verarbeiteAntwort({ store, call, zeile, conversation, nowMs });
  } catch (fehler) {
    try {
      if (providerStatusVon(fehler) === HTTP_NOT_FOUND) {
        console.log(`[el-reifung] unbeschaffbar (call=${call.id}): anbieter meldet HTTP 404`);
        schreibeUnbeschaffbar({ store, call, zeile });
        return EL_REIFUNG_ERGEBNIS.UNBESCHAFFBAR;
      }
      schreibeVersuch({ store, call, zeile });
      return EL_REIFUNG_ERGEBNIS.FEHLVERSUCH;
    } catch (schreibFehler) {
      console.error(`[el-reifung] Belegschreibung fehlgeschlagen (call=${call.id}): ${fehlerText(schreibFehler)}`);
      return EL_REIFUNG_ERGEBNIS.FEHLVERSUCH;
    }
  }
}

export async function reifeElBelege({ candidates, store, elKostenRead, billing, nowMs,
                                       maxAnfragen = EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP }: {
  candidates: ReifungAnruf[];
  store: ReifungSpeicher;
  elKostenRead: ElKostenLeser | null;
  billing: ReifungEinstellungen;
  nowMs: number;
  maxAnfragen?: number;
}): Promise<{ ergebnisse: ElReifungErgebnis[]; abweichungen: number; geprueft: number; uebrig: number }> {
  if (elKostenRead === null) return { ergebnisse: [], abweichungen: 0, geprueft: 0, uebrig: 0 };
  const minAgeMs = billing.elEvidenceMinAgeMinutes * MS_PER_MINUTE;
  const maxVersuche = billing.costTruingMaxAttempts;

  const treffer: { call: ReifungAnruf; zeile: ReifungBeleg }[] = [];
  for (const call of candidates) {
    const belege = store.callCostEvidence(call.id);
    const auswertung = reifungsKandidat({ call, belege, nowMs, minAgeMs, maxVersuche });
    if (auswertung.kandidat) treffer.push({ call, zeile: auswertung.zeile });
  }

  const abgerufen = treffer.slice(0, maxAnfragen);
  const uebrig = treffer.length - abgerufen.length;
  const ergebnisse: ElReifungErgebnis[] = [];
  for (const candidate of abgerufen)
    ergebnisse.push(await reifeEinenAnruf({ candidate, store, elKostenRead, nowMs }));

  const abweichungen = ergebnisse.filter((art) => ABWEICHENDE_ERGEBNISSE.has(art)).length;
  return { ergebnisse, abweichungen, geprueft: abgerufen.length, uebrig };
}
