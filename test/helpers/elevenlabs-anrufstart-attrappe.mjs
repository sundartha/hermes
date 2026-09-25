// Die Attrappe fuer EINEN ElevenLabs-Anrufstart: Store, Config, Auftrag - und der
// Abgriff des einzigen POSTs, den dieser Weg macht.
//
// GETEILT von test/el-vorlage-variablen-abgleich.test.js (misst die NAMEN der
// dynamischen Variablen) und test/elevenlabs-torzustand.test.js (misst den WERT einer
// davon). Beide brauchen denselben vollstaendig belegten Auftrag; zwei eigene Attrappen
// wuerden gegeneinander driften, und driftet die eine, hoert genau eine der beiden Suiten
// still auf zu messen, ohne rot zu werden (dieselbe Begruendung wie bei
// helpers/elevenlabs-push-attrappe.mjs).
//
// KEIN NETZ, KEIN ANRUF: globalThis.fetch wird fuer die Dauer eines Aufrufs ersetzt und
// danach zurueckgegeben.
import assert from "node:assert/strict";

export const PIN_TENANT = "tenant-pin";
export const PIN_FROM = "+15550000001";
const FAKE_CONVERSATION_ID = "conv_pin_test";
const FAKE_RESULT_POLL_MS = 5;

// Die Nummer, ueber die dieser Anruf hinausgeht - zugleich der Geo-Anker, an dem der
// Anrufstart Sprache und Stimme ableitet (src/elevenlabs/call-locale.js).
const PIN_NUMBER = Object.freeze({
  e164: PIN_FROM,
  tenantId: PIN_TENANT,
  status: "active",
  provider: "telnyx",
});

// Der Store-Zustand, aus dem die Ableitung liest: ein Tenant mit GESETZTER Sprache. Eine
// Attrappe mit leerem Zustand liefe still auf den Weltdefault und beruehrte die Ableitung
// nie - die Attrappe traegt hier eine echte Antwort (Lehre b1-messwerkzeug-attrappe).
const PIN_STATE = Object.freeze({
  tenants: [{ id: PIN_TENANT, defaultLanguage: "de" }],
  settings: {},
  numbers: [PIN_NUMBER],
});

// Ein vollstaendiger Auftrag: jedes Feld belegt, das irgendein Baustein von
// dynamicVariables (outbound.js) liest - sonst wuerde ein leeres Feld einen Block
// ausduennen (z.B. constraintsText/backgroundText liefern bei leerem Input "") und die
// gemessene Menge faelschlich verkleinern.
export function pinCall() {
  return {
    id: "call-pin-1",
    tenantId: PIN_TENANT,
    // Richtung + Status wie am echten createCall-Datensatz (state-ops.js): das
    // Recherche-Tor (Thema B) liest beide als Sicherheitsfaktoren - eine Attrappe
    // ohne sie misst nur den fail-closed-Ast.
    direction: "outbound",
    status: "active",
    from: PIN_FROM,
    to: "+491737250000",
    goal: "Termin vereinbaren",
    constraints: "hoechstens 40 Euro zusagen",
    context: {
      summary: "Rueckruf wegen Reklamation",
      recipient_relationship: "Kundendienst",
      desired_outcome: "Ersatztermin",
      key_facts: ["Vertragsnummer 123", "bereits einmal verschoben"],
    },
    briefing: "Kunde hat bereits zweimal angerufen.",
    mandate: {
      decide_freely: "Ersatztermin frei waehlen",
      fallback_order: "sonst Nachricht hinterlassen",
    },
  };
}

// Nur die Methoden, die originateCall wirklich aufruft (tenantContext, tenantTimezone,
// load + numberRecordByE164 fuer die Sprach-/Stimmwahl, resolveProfile fuer den
// Torzustand, recordElevenlabsConversationId, recordSipCallId, markAnswered) - plus
// getCall als Absicherung fuer den re-armierten Poll-Takt. Kein echter Store: reine
// Einheit gegen outbound.js, keine Server-/Store-Integration.
//
// profil ist ein PROFIL und keine fertige Ja/Nein-Antwort: der Torzustand muss durch die
// echte Torkette (consultAllowedForCall) laufen, sonst prueft ein Test die Attrappe statt das
// Tor (Lehre b1-messwerkzeug-attrappe).
//
// tenantContext liefert seit OC-P2 auch firstName - der Anrufstart liest ihn fuer die
// Owner-Eroeffnung. UEBERSCHREIBBAR, damit die Fail-closed-Treppe den Fall "leerer
// Vorname" ueberhaupt herstellen kann; der Default bleibt eine echte Antwort und kein
// eingebauter Rueckfall (Lehre b1-messwerkzeug-attrappe).
export function pinStore({
  profil = { allowConsult: true },
  tenantContext = () => ({ ownerName: "Pin Testowner", firstName: "Pin" }),
} = {}) {
  return {
    tenantContext,
    tenantTimezone: () => "Europe/Berlin",
    load: () => PIN_STATE,
    numberRecordByE164: (e164) => (e164 === PIN_FROM ? PIN_NUMBER : null),
    resolveProfile: () => profil,
    recordElevenlabsConversationId: () => {},
    // Join-Schluessel zur Telefonie-Rechnung: hier ein No-op - diese Attrappe misst den
    // gesendeten Anfragekoerper, nicht die Persistenz (test/el-sip-call-id-join.test.js).
    // Die Methode muss aber existieren, sonst wirft der Anrufstart einen TypeError,
    // NACHDEM der Anruf schon losgelaufen waere.
    recordSipCallId: () => {},
    // ST3: Zaehlfeld der Stimmen-Detektoren - dieselbe Begruendung wie recordSipCallId
    // direkt darueber (der Ergebnisweg zaehlt, diese Attrappe misst den Anfragekoerper).
    recordElDetectorCounts: () => {},
    // OUTBOUND-E5: dieselbe Begruendung wie recordSipCallId direkt darueber - die
    // Absender-Auswahl (absenderFuerAnruf) ruft beide VOR dem Netzzugriff; ohne die
    // Methoden wirft der Anrufstart einen TypeError, bevor die Attrappe je den
    // Anfragekoerper sieht.
    recordFromRegistrationSource: () => {},
    recordActualSender: () => {},
    markAnswered: () => {},
    getCall: () => null,
  };
}

// IP4: der Anker-Test misst gegen die Aufloesung elevenLabsVoiceIdFor(<dieser Wert>,
// profil) - er darf den Wert nicht abschreiben (G5), sonst pinnt er die Attrappe.
export const PIN_PLATTFORM_STIMME = "pin-plattform-stimme";

export function pinConfig() {
  return {
    voice: {
      // SEC-P4: das Plattform-Geheimnis, aus dem der Anrufstart den Mandanten-Token
      // ableitet. Eine ECHTE Antwort und kein Leerwert (Lehre b1-messwerkzeug-attrappe):
      // mit "" liefe die Ableitung in ihren Leerast und der Golden-Vergleich pinnte nur
      // den leeren String statt der Ableitung.
      elevenLabsToolToken: "pin-tool-token",
      elevenLabsOutbound: {
        apiKey: "pin-test-key",
        agentId: "pin-agent",
        agentPhoneNumberId: "pin-phnum",
        apiBase: "https://pin-test.invalid",
        resultPollMs: FAKE_RESULT_POLL_MS,
      },
    },
    // Die global konfigurierte Plattform-Stimme, aus der die Sprach-/Stimmwahl die
    // Stimme dieses Anrufs ableitet (src/elevenlabs/call-locale.js).
    telnyx: { telnyxElevenLabs: { voiceId: PIN_PLATTFORM_STIMME } },
    // Muss false sein: der Fake-Schalter ueberspringt dynamicVariables(...) komplett -
    // mit ihm gaebe es kein Objekt zum Abgreifen.
    safety: { fakeOriginateElevenlabs: false },
  };
}

// Ersetzt globalThis.fetch fuer die Dauer EINES originateCall-Aufrufs und faengt den
// Rumpf des einzigen POSTs ab. startOutboundCall (convai.js) ruft fetchImpl mit genau
// { method, body, headers, signal } auf; body ist bereits JSON.stringify(...), hier
// wieder geparst.
//
// makeElevenLabsOutbound wird uebergeben und nicht hier importiert: die Torzustands-Suite
// setzt Umgebungsvariablen, BEVOR sie das Modul (und mit ihm src/config.js) laedt. Wer
// den Import hierher zoege, verschoebe die Ladereihenfolge in eine Datei, in der sie
// niemand vermutet.
//
// ZWEI AUSFAHRTEN, EIN ABGRIFF (OC-P2): sendeAnrufstartKoerper liefert den GANZEN
// Anfragekoerper (die Uebersteuerung conversation_config_override ist von aussen sonst gar
// nicht erreichbar), sendeAnrufstart weiterhin nur die dynamischen Variablen. Keine zweite
// Attrappe, keine zweite fetch-Ersetzung - zwei Attrappen wuerden driften.
export async function sendeAnrufstartKoerper({
  makeElevenLabsOutbound,
  consultAllowedForCall,
  store = pinStore(),
  // Thema B: das Recherche-Tor, analog consultAllowedForCall - ohne Wert greift der
  // fail-closed Fabrik-Default (lookup_available = "unavailable").
  lookupAvailableFor,
  // Thema A: der Anruf-Datensatz, damit Wert-Tests openingLine/Hash setzen koennen.
  call = pinCall(),
}) {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ conversation_id: FAKE_CONVERSATION_ID }) };
  };

  try {
    const { originateCall } = makeElevenLabsOutbound({
      store,
      config: pinConfig(),
      terminateAndBillCall: async () => {},
      billThunk: () => async () => {},
      finishCall: async () => {},
      // Das ECHTE Tor, vom Aufrufer hereingereicht - bewusst OHNE Default: ein
      // eingebauter Rueckfall waere ein zweites Tor, und der Torzustand wuerde dann
      // gegen eine Attrappe gemessen statt gegen die Entscheidung, die er abbildet.
      consultAllowedForCall,
      lookupAvailableFor,
    });
    await originateCall(call);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(capturedBody, "kein Anrufstart ausgeloest - die Attrappe hat keinen Request gesehen");
  return capturedBody;
}

// Signatur UND Rueckgabe unveraendert - die zwei Bestandsnutzer merken nichts.
export async function sendeAnrufstart(args) {
  const koerper = await sendeAnrufstartKoerper(args);
  const rumpf = koerper.conversation_initiation_client_data;
  assert.ok(rumpf?.dynamic_variables, "dynamic_variables fehlt im gesendeten Rumpf");
  return rumpf.dynamic_variables;
}
