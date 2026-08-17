// ---- Pin: Vorlagen-Platzhalter gegen tatsaechlich gesendete dynamic_variables --------
// Owner-Auftrag 15.08.2026 (Phase 2), woertlich: "Die neun dynamic_variables werden gegen
// src/ verglichen, nicht nur Vorlage gegen Testdefinitionen. Ein umbenannter Name bliebe
// heute gruen - beim echten Anbieter bricht das Gespraech stumm ab. Genau das ist am
// 14.08. passiert."
//
// BELEGT in tasks/spike2-messung.jsonl (NICHT spike1b-messung.jsonl - die Datei traegt
// keinen Fund dazu, s. Rueckgabe-Bericht dieser Aufgabe), Zeile 7 und 12:
//   Zeile 7  "termination_reason":"Missing required dynamic variables in first message:
//            {'owner_name'}","fehlercode":1008
//   Zeile 12 "Fehlt die Variable, beendet ElevenLabs das Gespraech unmittelbar nach dem
//            Abheben mit Code 1008 - der Angerufene hoert Stille. Die Variable MUSS in
//            conversation_initiation_client_data.dynamic_variables stehen; auf oberster
//            Ebene wird sie ohne Fehlermeldung verworfen."
// Ein Platzhalter, den der Prompt der Vorlage benutzt, aber den outbound.js nicht
// mitschickt, ist GENAU dieser Fall - reproduzierbar ohne echten Anruf (CLAUDE.md
// "Wurzel statt Symptom").
//
// ZWEI MENGEN, ECHT GEWONNEN, KEINE VON HAND GEPFLEGTE LISTE (Auftragsgrenze):
//   Seite A  {{name}}-Vorkommen aus dem TEXT der echten Agenten-Vorlage
//            (agent.conversation_config.agent.prompt.prompt + .first_message - dieselben
//            zwei Quellen, die die Vorlage selbst unter _besitz.felder fuer den Eintrag
//            "dynamic_variables" nennt) - per Regex aus der Datei extrahiert.
//   Seite B  die Schluessel des dynamic_variables-Objekts, das
//            src/elevenlabs/outbound.js (makeElevenLabsOutbound().originateCall)
//            WIRKLICH ueber den einzigen Netzzugriff dieses Wegs an den Anbieter
//            schickt - abgegriffen ueber eine Attrappen-fetch (globalThis.fetch
//            monkey-gepatcht, KEIN Netzzugriff, KEIN echter Anruf). FAKE_ORIGINATE_
//            ELEVENLABS scheidet hier aus: der Schalter ueberspringt den ganzen
//            Aufruf-Ausdruck inklusive dynamicVariables(...) (s. outbound.js
//            originateCall, ternary), es gaebe also nichts abzugreifen.
// Beide Mengen muessen deckungsgleich sein: ein Name in A ohne Gegenstueck in B ist der
// Close-1008-Fall; ein Name in B ohne Gegenstueck in A ist toter Ballast.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";

const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";
const EXPECTED_VARIABLE_COUNT = 9;

// ---- Seite A: {{name}} aus dem WIRKLICHEN Vorlagentext --------------------------------
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function placeholderNamesIn(text) {
  const gefunden = new Set();
  for (const treffer of text.matchAll(PLACEHOLDER_PATTERN)) gefunden.add(treffer[1]);
  return gefunden;
}

function templatePlaceholderNames() {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const agent = vorlage.agent.conversation_config.agent;
  const promptText = agent.prompt.prompt;
  const firstMessage = agent.first_message;
  return new Set([...placeholderNamesIn(promptText), ...placeholderNamesIn(firstMessage)]);
}

// ---- Seite B: das ECHTE dynamic_variables-Objekt, per Attrappen-fetch abgegriffen -----
const FAKE_CONVERSATION_ID = "conv_pin_test";
const FAKE_RESULT_POLL_MS = 5;

// Ein vollstaendiger Auftrag: jedes Feld belegt, das irgendein Baustein von
// dynamicVariables (outbound.js) liest - sonst wuerde ein leeres Feld einen Block
// ausduennen (z.B. constraintsText/backgroundText liefern bei leerem Input "") und Seite
// B faelschlich verkleinern, ohne dass das etwas mit dem eigentlichen Abgleich zu tun hat.
const PIN_TENANT = "tenant-pin";
const PIN_FROM = "+15550000001";

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

function pinCall() {
  return {
    id: "call-pin-1",
    tenantId: PIN_TENANT,
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
// load + numberRecordByE164 fuer die Sprach-/Stimmwahl, recordElevenlabsConversationId,
// recordSipCallId, markAnswered) - plus getCall als Absicherung fuer den re-armierten
// Poll-Takt (s.u.). Kein echter Store: dieser Test ist reine Einheit gegen outbound.js,
// keine Server-/Store-Integration.
function pinStore() {
  return {
    tenantContext: () => ({ ownerName: "Pin Testowner" }),
    tenantTimezone: () => "Europe/Berlin",
    load: () => PIN_STATE,
    numberRecordByE164: (e164) => (e164 === PIN_FROM ? PIN_NUMBER : null),
    recordElevenlabsConversationId: () => {},
    // Join-Schluessel zur Telefonie-Rechnung: hier ein No-op - dieser Test misst den
    // gesendeten Anfragekoerper, nicht die Persistenz (test/el-sip-call-id-join.test.js).
    // Die Attrappe muss die Methode aber kennen, sonst wirft der Anrufstart einen
    // TypeError, NACHDEM der Anruf schon losgelaufen waere.
    recordSipCallId: () => {},
    markAnswered: () => {},
    getCall: () => null,
  };
}

function pinConfig() {
  return {
    voice: {
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
    telnyx: { telnyxElevenLabs: { voiceId: "pin-plattform-stimme" } },
    // Muss false sein: der Fake-Schalter ueberspringt dynamicVariables(...) komplett
    // (s. Modul-Kopf) - mit ihm gaebe es kein Objekt zum Abgreifen.
    safety: { fakeOriginateElevenlabs: false },
  };
}

// Ersetzt globalThis.fetch fuer die Dauer EINES originateCall-Aufrufs und faengt den
// Rumpf des einzigen POSTs ab (KEIN echtes Netz, KEIN echter Anruf - Auftragsgrenze).
// startOutboundCall (convai.js) ruft fetchImpl mit genau { method, body, headers, signal }
// auf; body ist bereits JSON.stringify(...), hier wieder geparst.
async function sentDynamicVariables() {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ conversation_id: FAKE_CONVERSATION_ID }) };
  };

  try {
    const { originateCall } = makeElevenLabsOutbound({
      store: pinStore(),
      config: pinConfig(),
      terminateAndBillCall: async () => {},
      billThunk: () => async () => {},
      finishCall: async () => {},
    });
    await originateCall(pinCall());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(capturedBody, "kein Anrufstart ausgeloest - die Attrappe hat keinen Request gesehen");
  const rumpf = capturedBody.conversation_initiation_client_data;
  assert.ok(rumpf?.dynamic_variables, "dynamic_variables fehlt im gesendeten Rumpf");
  return rumpf.dynamic_variables;
}

function fehlendeUndUeberzaehlige(seiteA, seiteB) {
  const fehlend = [...seiteA].filter((name) => !seiteB.has(name));
  const ueberzaehlig = [...seiteB].filter((name) => !seiteA.has(name));
  return { fehlend, ueberzaehlig };
}

test("EL-VORLAGE-VARIABLEN: Platzhalter der Vorlage und gesendete dynamic_variables sind deckungsgleich (neun Namen)", async () => {
  const seiteA = templatePlaceholderNames();
  const gesendet = await sentDynamicVariables();
  const seiteB = new Set(Object.keys(gesendet));

  assert.equal(
    seiteA.size,
    EXPECTED_VARIABLE_COUNT,
    `Vorlage benutzt ${seiteA.size} Platzhalter statt der erwarteten ${EXPECTED_VARIABLE_COUNT}: ${[...seiteA].sort().join(", ")}`,
  );
  assert.equal(
    seiteB.size,
    EXPECTED_VARIABLE_COUNT,
    `outbound.js sendet ${seiteB.size} dynamic_variables statt der erwarteten ${EXPECTED_VARIABLE_COUNT}: ${[...seiteB].sort().join(", ")}`,
  );

  const { fehlend, ueberzaehlig } = fehlendeUndUeberzaehlige(seiteA, seiteB);
  assert.deepEqual(
    fehlend,
    [],
    `Vorlage benutzt {{${fehlend.join("}}, {{")}}} - outbound.js schickt das NICHT mit. ` +
      "Das ist der Close-1008-Fall (tasks/spike2-messung.jsonl:12): der Platzhalter " +
      "bleibt unaufgeloest, der Anbieter bricht das Gespraech vor dem ersten Wort ab.",
  );
  assert.deepEqual(
    ueberzaehlig,
    [],
    `outbound.js sendet ${ueberzaehlig.join(", ")} zusaetzlich - die Vorlage benutzt das ` +
      "nirgends. Toter Ballast, keine Platzhalter-Aufloesung haengt daran.",
  );
});
