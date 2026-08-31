// KV2-4 (tasks/kostenv2/spec-kv2-4.md): der ElevenLabs-Beleg, synchron und vorlaeufig.
// REIN + EIN Schreibaufruf: entscheidet aus der Anbieter-Antwort, ob ein Beleg entsteht,
// und legt ihn samt der erwarteten telnyx_sip-Zeile ins Kosten-Buch. Kein Netz-IO - die
// Antwort liegt in persistProviderResult bereits vollstaendig im Speicher.

import { REIFE } from "../store/defaults.js";
import { isBelegRef } from "../store/cost-evidence.js";
import { KOSTENART, KOSTENARTEN } from "../billing/kostenarten.js";
// AKZEPTIERTE SCHULD (SCOPE, s. Phasenbericht KV2-4): parseDecimalToMicroCents ist
// fachlich ein generischer Dezimalgeld-Parser (rechnet aus CENTS_PER_EUR *
// MICRO_CENTS_PER_CENT, kein Telnyx-Spezifikum), liegt aber unter adapters/telnyx. Ein
// Umzug nach src/billing/ ist reiner Refactor ohne Verhaltensaenderung und NICHT Teil
// dieser Phase - hier zaehlt: EIN Rundungspfad fuer jeden Anbieter-Geldwert im System.
import { parseDecimalToMicroCents } from "../telephony/adapters/telnyx/cost-parse.js";

export const EL_BELEG_QUELLE = "elevenlabs_conversation";

export const EL_BELEG_ABLEHNUNG = Object.freeze({
  FEHLT: "cost_fiat_fehlt",
  KEIN_FLOAT: "cost_fiat_kein_float",
  NEGATIV: "cost_fiat_negativ",
  NULL_BEI_DAUER: "cost_fiat_null_bei_dauer_groesser_null",
  NULL_DAUER_UNKLAR: "cost_fiat_null_bei_unbrauchbarer_dauer",
  UNKONVERTIERBAR: "cost_fiat_nicht_in_mikro_cents_ueberfuehrbar",
});

// Ist wert eine nicht-negative Ganzzahl? Reines Praedikat, Baustein der 0-Faelle unten -
// call_duration_secs kann als Anbieter-Feld jeden Typ tragen, nicht nur eine Zahl.
function istNichtNegativeGanzzahl(wert) {
  return Number.isSafeInteger(wert) && wert >= 0;
}

// Der Sonderfall cost_fiat === 0: (b) unterscheidet nach der Mengenangabe
// (call_duration_secs). Eigene Funktion (G30), weil die Fallunterscheidung sonst
// elBelegBetrag auf drei Ebenen verschachteln wuerde.
function elBelegBeiNullkosten(dauerSekunden) {
  if (!istNichtNegativeGanzzahl(dauerSekunden)) {
    // Fail-closed (nicht woertlich in (b), einzige tragfaehige Ausloesung): eine
    // ungemessene Mengenangabe darf nie stillschweigend in den guenstigeren Zweig
    // (Betrag 0) fallen. Matrix 4.6 kennt nur "Menge > 0" und "Menge 0".
    return { ablehnung: EL_BELEG_ABLEHNUNG.NULL_DAUER_UNKLAR };
  }
  if (dauerSekunden > 0) return { ablehnung: EL_BELEG_ABLEHNUNG.NULL_BEI_DAUER };
  return { mikroCents: 0 };
}

// REIN, kein Wurf, kein Log, kein Store (P6). Liefert ENTWEDER { mikroCents } ODER
// { ablehnung } - ein discriminated result statt null, damit der Aufrufer den GRUND
// melden kann, ohne die Pruefung zu wiederholen (G5).
export function elBelegBetrag(metadata) {
  const costFiat = metadata?.cost_fiat;
  if (costFiat === undefined || costFiat === null) return { ablehnung: EL_BELEG_ABLEHNUNG.FEHLT };
  if (typeof costFiat !== "number" || !Number.isFinite(costFiat))
    return { ablehnung: EL_BELEG_ABLEHNUNG.KEIN_FLOAT };
  if (costFiat < 0) return { ablehnung: EL_BELEG_ABLEHNUNG.NEGATIV };
  if (costFiat === 0) return elBelegBeiNullkosten(metadata?.call_duration_secs);
  const mikroCents = parseDecimalToMicroCents(String(costFiat));
  return mikroCents === null ? { ablehnung: EL_BELEG_ABLEHNUNG.UNKONVERTIERBAR } : { mikroCents };
}

// Schreibt die erwartete telnyx_sip-Zeile - UNABHAENGIG vom EL-Betrag: "wir erwarten
// einen SIP-Beleg" ist eine Aussage ueber das Profil el_convai_sip, nicht ueber
// ElevenLabs' Kostenfeld.
function recordTelnyxSipErwartet(store, callId) {
  store.recordCallCostEvidence({ callId, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.ERWARTET });
}

// Schreibt die EL-Belegzeile (Zustand vorlaeufig). Eigene Funktion (G30), damit
// recordElevenLabsKostenBelege nur noch die Reihenfolge der drei Schritte zeigt.
function recordElBeleg({ store, callId, conversation, mikroCents, belegNachreifbar }) {
  store.recordCallCostEvidence({
    callId,
    traeger: KOSTENART.ELEVENLABS_CONVAI,
    reife: REIFE.VORLAEUFIG,
    betragMikroCents: mikroCents,
    waehrung: KOSTENARTEN[KOSTENART.ELEVENLABS_CONVAI].waehrung, // EINE Quelle (G5)
    quelle: EL_BELEG_QUELLE,
    belegRef: isBelegRef(conversation?.conversation_id) ? conversation.conversation_id : null,
    // Jetzt, nicht call.endedAt: auf dem regulaeren Weg laeuft persistProviderResult VOR
    // store.endCallRecord, endedAt existiert an dieser Stelle noch nicht. Eine 0 waere
    // hier eine erfundene Messung.
    gemessenAt: new Date().toISOString(),
    // Das ganze Rohobjekt: costEvidenceValuePatch projiziert es zwingend durch die
    // detail-Allowlist (PII-Riegel, einziger Schreibweg). Ein vorgefiltertes Objekt
    // koennte die Allowlist umgehen, das Rohobjekt kann es nicht.
    detail: conversation,
    nachreifbar: belegNachreifbar,
  });
}

// Schreibt die Belegzeilen EINES EL-Gespraechs. Ein Argument (F1). belegNachreifbar ist
// ein DATENFELD der Zeile, keine Verhaltensweiche (kein G15/F3-Selektor): es steuert
// keine if-Verzweigung, es wird persistiert.
export function recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar }) {
  try {
    recordTelnyxSipErwartet(store, callId);
    const ergebnis = elBelegBetrag(conversation?.metadata);
    if ("ablehnung" in ergebnis) {
      console.warn(`[el-kosten-beleg] kein EL-Beleg (call=${callId}): grund=${ergebnis.ablehnung}`);
      return;
    }
    recordElBeleg({ store, callId, conversation, mikroCents: ergebnis.mikroCents, belegNachreifbar });
  } catch (fehler) {
    // FAIL-SOFT, und zwar zwingend: persistProviderResult laeuft aus
    // pollConversationResult, das als `void fn()` aus einem setTimeout gestartet wird -
    // eine hier entkommende Ausnahme wuerde terminateAndBillCall nie erreichen, der Anruf
    // waere weder terminalisiert noch abgerechnet. Dieses Buch hat in dieser Phase KEINEN
    // Leser; es darf den Geldpfad unter keinen Umstaenden anhalten.
    console.error(`[el-kosten-beleg] Belegschreibung fehlgeschlagen (call=${callId}): ${fehler.message}`);
  }
}
