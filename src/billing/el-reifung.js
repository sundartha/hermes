import { REIFE } from "../store/defaults.js";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.js";
import { KOSTENART, KOSTENARTEN, KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { EL_BELEG_QUELLE, elBelegBetrag } from "../elevenlabs/kosten-beleg.js";

export const EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP = 25;
const HTTP_NICHT_GEFUNDEN = 404;

export const EL_REIFUNG_ERGEBNIS = Object.freeze({
  BESTAETIGT: "bestaetigt",
  HOEHER: "hoeher",
  NIEDRIGER: "niedriger",
  UNBESCHAFFBAR: "unbeschaffbar",
  FEHLVERSUCH: "fehlversuch",
});

const ABWEICHENDE_ERGEBNISSE = new Set([EL_REIFUNG_ERGEBNIS.HOEHER, EL_REIFUNG_ERGEBNIS.NIEDRIGER]);

export const EL_REIFUNG_SKIP = Object.freeze({
  KEIN_EL_PROFIL: "kein_el_profil",
  KEINE_CONVERSATION_ID: "keine_conversation_id",
  KEINE_EL_ZEILE: "keine_elevenlabs_convai_zeile",
  ZEILE_FERTIG: "zeile_bereits_belegt_oder_terminal",
  NICHT_NACHREIFBAR: "zeile_nicht_nachreifbar",
  ZU_JUNG: "unter_mindestalter",
  VERSUCHE_ERSCHOEPFT: "versuche_erschoepft",
});

function elZeileVon(belege) {
  return belege.find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
}

function reifbareZeileOderGrund({ call, belege }) {
  if (kostenprofilFuerAnruf(call) !== KOSTENPROFIL.EL_CONVAI_SIP)
    return { grund: EL_REIFUNG_SKIP.KEIN_EL_PROFIL };
  if (!call.elevenlabsConversationId) return { grund: EL_REIFUNG_SKIP.KEINE_CONVERSATION_ID };
  const zeile = elZeileVon(belege);
  return zeile ? { zeile } : { grund: EL_REIFUNG_SKIP.KEINE_EL_ZEILE };
}

function zeileNichtReifbarGrund({ zeile, call, nowMs, minAgeMs, maxVersuche }) {
  if (zeile.reife !== REIFE.VORLAEUFIG) return EL_REIFUNG_SKIP.ZEILE_FERTIG;
  if (zeile.nachreifbar === false) return EL_REIFUNG_SKIP.NICHT_NACHREIFBAR;
  const endedMs = Date.parse(call.endedAt ?? "");
  if (!Number.isFinite(endedMs) || nowMs - endedMs < minAgeMs) return EL_REIFUNG_SKIP.ZU_JUNG;
  if ((zeile.versuche ?? 0) >= maxVersuche) return EL_REIFUNG_SKIP.VERSUCHE_ERSCHOEPFT;
  return null;
}

export function reifungsKandidat({ call, belege, nowMs, minAgeMs, maxVersuche }) {
  const { zeile, grund } = reifbareZeileOderGrund({ call, belege });
  if (!zeile) return { kandidat: false, grund };
  const zeitfensterGrund = zeileNichtReifbarGrund({ zeile, call, nowMs, minAgeMs, maxVersuche });
  return zeitfensterGrund ? { kandidat: false, grund: zeitfensterGrund } : { kandidat: true, zeile };
}

export function reifeErgebnis({ altMikroCents, neuMikroCents }) {
  if (neuMikroCents === altMikroCents) return { mikroCents: altMikroCents, ergebnis: EL_REIFUNG_ERGEBNIS.BESTAETIGT };
  if (neuMikroCents > altMikroCents) return { mikroCents: neuMikroCents, ergebnis: EL_REIFUNG_ERGEBNIS.HOEHER };
  return { mikroCents: altMikroCents, ergebnis: EL_REIFUNG_ERGEBNIS.NIEDRIGER };
}

function abstandZumGespraechsendeS(call, nowMs) {
  const endedMs = Date.parse(call.endedAt ?? "");
  return Number.isFinite(endedMs) ? Math.round((nowMs - endedMs) / MS_PER_SECOND) : null;
}

function schreibeBelegt({ store, call, zeile, mikroCents, nowMs }) {
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

function schreibeUnbeschaffbar({ store, call, zeile }) {
  store.recordCallCostEvidence({
    callId: call.id,
    traeger: KOSTENART.ELEVENLABS_CONVAI,
    reife: REIFE.VORLAEUFIG,
    nachreifbar: false,
    versuche: (zeile.versuche ?? 0) + 1,
  });
}

function schreibeVersuch({ store, call, zeile }) {
  store.recordCallCostEvidence({
    callId: call.id,
    traeger: KOSTENART.ELEVENLABS_CONVAI,
    reife: REIFE.VORLAEUFIG,
    versuche: (zeile.versuche ?? 0) + 1,
  });
}

function verarbeiteAntwort({ store, call, zeile, conversation, nowMs }) {
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

async function reifeEinenAnruf({ candidate, store, elKostenRead, nowMs }) {
  const { call, zeile } = candidate;
  try {
    const conversation = await elKostenRead.fetchConversation(call.elevenlabsConversationId);
    return verarbeiteAntwort({ store, call, zeile, conversation, nowMs });
  } catch (fehler) {
    try {
      if (fehler?.providerStatus === HTTP_NICHT_GEFUNDEN) {
        console.log(`[el-reifung] unbeschaffbar (call=${call.id}): anbieter meldet HTTP 404`);
        schreibeUnbeschaffbar({ store, call, zeile });
        return EL_REIFUNG_ERGEBNIS.UNBESCHAFFBAR;
      }
      schreibeVersuch({ store, call, zeile });
      return EL_REIFUNG_ERGEBNIS.FEHLVERSUCH;
    } catch (schreibFehler) {
      console.error(`[el-reifung] Belegschreibung fehlgeschlagen (call=${call.id}): ${schreibFehler.message}`);
      return EL_REIFUNG_ERGEBNIS.FEHLVERSUCH;
    }
  }
}

export async function reifeElBelege({ candidates, store, elKostenRead, billing, nowMs,
                                       maxAnfragen = EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP }) {
  if (elKostenRead === null) return { ergebnisse: [], abweichungen: 0, geprueft: 0, uebrig: 0 };
  const minAgeMs = billing.elEvidenceMinAgeMinutes * MS_PER_MINUTE;
  const maxVersuche = billing.costTruingMaxAttempts;

  const treffer = [];
  for (const call of candidates) {
    const belege = store.callCostEvidence(call.id);
    const auswertung = reifungsKandidat({ call, belege, nowMs, minAgeMs, maxVersuche });
    if (auswertung.kandidat) treffer.push({ call, zeile: auswertung.zeile });
  }

  const abgerufen = treffer.slice(0, maxAnfragen);
  const uebrig = treffer.length - abgerufen.length;
  const ergebnisse = [];
  for (const candidate of abgerufen)
    ergebnisse.push(await reifeEinenAnruf({ candidate, store, elKostenRead, nowMs }));

  const abweichungen = ergebnisse.filter((art) => ABWEICHENDE_ERGEBNISSE.has(art)).length;
  return { ergebnisse, abweichungen, geprueft: abgerufen.length, uebrig };
}
