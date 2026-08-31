// KV2-9 (tasks/PLAN-KOSTEN-V2.md, Phase KV2-9): der ZWEITE, reifende ElevenLabs-Abruf.
// Reines Regelwerk + EINE Orchestrierung ueber einen injizierten Lese-Port. Kein fetch,
// kein config-Import, kein Provider-Wissen ausser dem Port (DIP).
//
// IMPORT-RICHTUNG strikt einseitig (Muster kosten-deckung.js/kosten-abschluss.js/
// kosten-projektion.js): cost-truing.js importiert AUS dieser Datei, NIE umgekehrt -
// sonst ein Zyklus. Diese Datei liegt daneben, damit das gepinnte Lint-Budget von
// cost-truing.js (eslint-suppressions.json, makeCostTruing 292 Zeilen) unberuehrt bleibt.
import { REIFE } from "../store/defaults.js";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.js";
import { KOSTENART, KOSTENARTEN, KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { EL_BELEG_QUELLE, elBelegBetrag } from "../elevenlabs/kosten-beleg.js";

// (e) Drossel. GEMESSEN ist nur eine UNTERE Schranke: 25 Abrufe in wenigen Sekunden ohne
// 429 und ohne jeden Rate-Limit-Header in ueber 60 Antworten (befund-elevenlabs.md 4);
// die reale Grenze bleibt ungemessen. Deshalb ist diese Zahl das gemessene Maximum, nicht
// mehr - und BEWUSST KEINE Env-Variable (Praezedenz SWEEP_REQUESTS_WARN_THRESHOLD in
// cost-truing.js): eine Drossel, die ein Operator hochdrehen kann, ist die Sicherung, die
// an ihre eigene Verletzung angepasst wird. Ein Rueckstau bleibt SICHTBAR (el_uebrig= in
// der Sweep-Zeile), nicht still.
export const EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP = 25;
const HTTP_NICHT_GEFUNDEN = 404; // Praezedenz: telephony/outbound-config-probe.js

// Die fuenf sich gegenseitig ausschliessenden Ausgaenge eines Reifungsversuchs.
export const EL_REIFUNG_ERGEBNIS = Object.freeze({
  BESTAETIGT: "bestaetigt", // (a) gleicher Wert -> belegt, keine Abweichung
  HOEHER: "hoeher", // (b) hoeherer Wert -> belegt mit dem hoeheren, Abweichung
  NIEDRIGER: "niedriger", // (c) niedrigerer Wert -> der HOEHERE bleibt, Abweichung
  UNBESCHAFFBAR: "unbeschaffbar", // (d) HTTP 404 -> vorlaeufig + nachreifbar:false
  FEHLVERSUCH: "fehlversuch", // Netz/5xx/unbrauchbarer cost_fiat -> nur versuche+1
});

// (f) der Abweichungszaehler zaehlt NUR (b)/(c) - (a) ist keine Abweichung, (d)/(e) sind
// gar keine Messung. EINE Quelle statt eines an zwei Stellen gepflegten Vergleichs.
const ABWEICHENDE_ERGEBNISSE = new Set([EL_REIFUNG_ERGEBNIS.HOEHER, EL_REIFUNG_ERGEBNIS.NIEDRIGER]);

// Die Gruende, aus denen ein Anruf in DIESEM Lauf NICHT abgerufen wird (reifungsKandidat).
export const EL_REIFUNG_SKIP = Object.freeze({
  KEIN_EL_PROFIL: "kein_el_profil",
  KEINE_CONVERSATION_ID: "keine_conversation_id",
  KEINE_EL_ZEILE: "keine_elevenlabs_convai_zeile",
  ZEILE_FERTIG: "zeile_bereits_belegt_oder_terminal",
  NICHT_NACHREIFBAR: "zeile_nicht_nachreifbar",
  ZU_JUNG: "unter_mindestalter",
  VERSUCHE_ERSCHOEPFT: "versuche_erschoepft",
});

// Die EL-Belegzeile eines Anrufs, oder undefined. EINE Fundstelle-Regel (G5).
function elZeileVon(belege) {
  return belege.find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
}

// Die ersten drei Fragen von reifungsKandidat (G30/Komplexitaets-Obergrenze): darf dieser
// Anruf ueberhaupt eine EL-Zeile tragen, und hat er eine? Liefert die Zeile ODER null; der
// Aufrufer unterscheidet "kein Kandidat" von "Zeile gefunden" ueber den Rueckgabewert.
function reifbareZeileOderGrund({ call, belege }) {
  if (kostenprofilFuerAnruf(call) !== KOSTENPROFIL.EL_CONVAI_SIP)
    return { grund: EL_REIFUNG_SKIP.KEIN_EL_PROFIL };
  if (!call.elevenlabsConversationId) return { grund: EL_REIFUNG_SKIP.KEINE_CONVERSATION_ID };
  const zeile = elZeileVon(belege);
  return zeile ? { zeile } : { grund: EL_REIFUNG_SKIP.KEINE_EL_ZEILE };
}

// Die vier Zustands-/Zeitfragen an einer bereits gefundenen EL-Zeile (G30). Reihenfolge
// ist eine Aussage (fail-closed zuerst: der Abbruchweg vor der Altersfrage).
function zeileNichtReifbarGrund({ zeile, call, nowMs, minAgeMs, maxVersuche }) {
  if (zeile.reife !== REIFE.VORLAEUFIG) return EL_REIFUNG_SKIP.ZEILE_FERTIG;
  if (zeile.nachreifbar === false) return EL_REIFUNG_SKIP.NICHT_NACHREIFBAR;
  const endedMs = Date.parse(call.endedAt ?? "");
  if (!Number.isFinite(endedMs) || nowMs - endedMs < minAgeMs) return EL_REIFUNG_SKIP.ZU_JUNG;
  if ((zeile.versuche ?? 0) >= maxVersuche) return EL_REIFUNG_SKIP.VERSUCHE_ERSCHOEPFT;
  return null;
}

// Ist dieser Anruf in DIESEM Lauf reifbar? Reihenfolge ist eine Aussage (fail-closed
// zuerst). Liefert { kandidat: true, zeile } ODER { kandidat: false, grund }.
export function reifungsKandidat({ call, belege, nowMs, minAgeMs, maxVersuche }) {
  const { zeile, grund } = reifbareZeileOderGrund({ call, belege });
  if (!zeile) return { kandidat: false, grund };
  const zeitfensterGrund = zeileNichtReifbarGrund({ zeile, call, nowMs, minAgeMs, maxVersuche });
  return zeitfensterGrund ? { kandidat: false, grund: zeitfensterGrund } : { kandidat: true, zeile };
}

// (a)/(b)/(c) an EINER Stelle: der HOEHERE Wert gilt (Plan 4.5, "nach oben immer, nach
// unten nur mit vollstaendiger Menge - und die Menge kann diesen Wert nicht bestaetigen").
// Rein. Eine Zeile, die nie 'belegt' wird, wird bei Fristablauf zwangs-gesettelt und
// verliert die Erstattung GANZ - "stehen lassen bis zur Bestaetigung" ist die teurere
// Fehlrichtung; der beibehaltene hoehere Betrag ist die sichere.
export function reifeErgebnis({ altMikroCents, neuMikroCents }) {
  if (neuMikroCents === altMikroCents) return { mikroCents: altMikroCents, ergebnis: EL_REIFUNG_ERGEBNIS.BESTAETIGT };
  if (neuMikroCents > altMikroCents) return { mikroCents: neuMikroCents, ergebnis: EL_REIFUNG_ERGEBNIS.HOEHER };
  return { mikroCents: altMikroCents, ergebnis: EL_REIFUNG_ERGEBNIS.NIEDRIGER };
}

// Abstand zwischen Gespraechsende und diesem Reifungsversuch, in ganzen Sekunden - die
// O3-Messgroesse ("bei welchem Abstand war der Wert bestaetigt"). Unbrauchbarer endedAt
// -> null (fail-closed, keine erfundene Messung).
function abstandZumGespraechsendeS(call, nowMs) {
  const endedMs = Date.parse(call.endedAt ?? "");
  return Number.isFinite(endedMs) ? Math.round((nowMs - endedMs) / MS_PER_SECOND) : null;
}

// Die Belegzeile auf 'belegt' heben - (a)/(b)/(c). versuche IMMER am neuen Stand.
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

// Der Abbruchweg (d): HTTP 404 -> vorlaeufig BLEIBT (der Betrag zaehlt weiter in die
// Belegsumme), aber nachreifbar faellt auf false - ab dann fuehrt endzustandVon
// (kosten-abschluss.js) den Anruf auf beleg_strukturell_unbeschaffbar. Kein Betrag, kein
// detail: der Anbieter-Datensatz ist weg, es gibt nichts Neues zu belegen.
function schreibeUnbeschaffbar({ store, call, zeile }) {
  store.recordCallCostEvidence({
    callId: call.id,
    traeger: KOSTENART.ELEVENLABS_CONVAI,
    reife: REIFE.VORLAEUFIG,
    nachreifbar: false,
    versuche: (zeile.versuche ?? 0) + 1,
  });
}

// Fehlversuch (Netz/5xx/unbrauchbarer cost_fiat): nur der Zaehler steigt, die Zeile
// bleibt in JEDER anderen Hinsicht unveraendert - ein spaeterer Lauf bekommt eine neue
// Chance.
function schreibeVersuch({ store, call, zeile }) {
  store.recordCallCostEvidence({
    callId: call.id,
    traeger: KOSTENART.ELEVENLABS_CONVAI,
    reife: REIFE.VORLAEUFIG,
    versuche: (zeile.versuche ?? 0) + 1,
  });
}

// EIN Reifungsversuch (Anbieter-Antwort bereits vorliegend). Rein bzgl. Store-Wahl -
// entscheidet nur, WELCHE der drei Schreibformen greift, und liefert das gezaehlte
// Ergebnis. Der Aufrufer (reifeElBelege) leitet die Abweichungszahl aus dem
// zurueckgegebenen Ergebnis-Vokabular ab (kein mutierter Zaehler-Parameter, P6/F2).
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

// EIN Kandidat: ruft den Port, wertet die Antwort, faengt JEDEN Anbieterfehler als
// gezaehltes Ergebnis (Muster telephony/outbound-config-probe.js#attempt - kein Wurf).
// Store-Zugriffe in EINEM try/catch (fail-soft, Muster schreibeSweepKostenbeleg): ein
// Wurf hier braeche die Kandidatenschleife mitten im Geldpfad.
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

/**
 * Der Reifungs-Zweig EINES Sweeps. Fasst ausschliesslich Anrufe an, die der Aufrufer
 * bereits als Kandidaten ausgewaehlt hat (dieselbe Kandidatenbegrenzung wie der
 * Telnyx-Pfad, Abnahme (e)), und setzt hoechstens EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP
 * Anfragen ab. Kein Wurf: jeder Anbieterfehler wird zu einem gezaehlten Ergebnis.
 * elKostenRead === null -> vollstaendiges No-op (Bestandstests, JSON-Setups ohne
 * EL-Konto).
 * @returns {Promise<{ergebnisse: string[], abweichungen: number, geprueft: number, uebrig: number}>}
 */
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

  // (b)/(c) zaehlen als Abweichung, (a) nicht - EIN Zaehl-Schritt ueber das bereits
  // gesammelte Ergebnis-Vokabular statt eines mutierten Zaehler-Parameters (P6/F2).
  const abweichungen = ergebnisse.filter((art) => ABWEICHENDE_ERGEBNISSE.has(art)).length;
  return { ergebnisse, abweichungen, geprueft: abgerufen.length, uebrig };
}
