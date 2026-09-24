// P15/T3b - Waechter ueber die MCP-Tool-/Feld-Beschreibungen (Owner-Entscheidung O14).
//
// SYSTEMGRENZE: MODELLSPRACHE != NUTZERSPRACHE. Die Beschreibungen liest das Client-Modell
// (Claude in claude.ai), nicht der Tenant - sie sind EINSPRACHIG ENGLISCH und bekommen
// bewusst KEINE Sprachverzweigung. In ihnen stecken die in der Anrufqualitaets-Kette teuer
// erarbeiteten engen Verbote am Tool-Entscheidungspunkt; eine sinngemaesse Uebersetzung
// haette sie abgeschliffen. Dieser Test haelt drei Dinge fest:
//   (1) kein Deutsch mehr - gegen DIESELBE Stopwortliste wie das Sprachreinheits-Aggregat
//       (test/e2e-06-en-purity-aggregate.test.js). Das ersetzt exakt die Abdeckung, die die
//       R5-Korrektur dort abzieht (der Kanal mcpErrorLiterals misst seither nur noch
//       AUSGELIEFERTEN Text, nicht mehr die bewusst englischen Beschreibungen).
//   (2) die Stopwortliste selbst ist byte-gepinnt - eine spaetere Entschaerfung, die den
//       Aggregat-Test still gruen machen wuerde, schlaegt HIER rot.
//   (3) die Emphase ist erhalten: Anzahl UND Reihenfolge der Grossschreib-Marker je
//       Beschreibung sind gepinnt, dazu die vier riskantesten Negativ-Beispiele. Dieselbe
//       Mechanik, mit der P11 die Verbots-Emphase der gesprochenen Prompts gehalten hat.
//
// Harness wie test/place-call-context-bridge.test.js: ein fakeServer faengt BEIDE
// Registrierungswege (server.tool positionsbasiert, server.registerTool per config) ohne
// echten MCP-Transport ein.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerTools } from "../src/mcp-tools.js";
import { SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { GERMAN_STOPWORDS, ROOT } from "./helpers.js";

// Grossschreib-Marker = Emphase. Ausgenommen sind dokumentierte ABKUERZUNGEN, die nur
// zufaellig gross sind und keine Betonung tragen (G25: benannte Menge statt Inline-Filter).
const NON_EMPHASIS_TOKENS = new Set(["AI", "KYC", "XX", "JSON", "ID"]);
const CAPS_TOKEN = /\b[A-Z]{2,}\b/g;

function capsMarkersOf(text) {
  return (text.match(CAPS_TOKEN) || []).filter((t) => !NON_EMPHASIS_TOKENS.has(t));
}

// Alle Beschreibungen als Pfad -> Text: "<tool>", "<tool>.<feld>", "<tool>.<feld>.<unterfeld>".
function captureDescriptions(ctx = {}) {
  const descriptions = new Map();
  const collect = (name, description, schema) => {
    descriptions.set(name, description || "");
    for (const [field, node] of Object.entries(schema || {})) {
      descriptions.set(`${name}.${field}`, node?.description || "");
      // Optionale Objekt-Felder (mandate/context) tragen ihre Unterfelder erst nach
      // unwrap(); skalare Optionals liefern kein shape und werden uebersprungen.
      const inner = typeof node?.unwrap === "function" ? node.unwrap() : null;
      if (!inner?.shape) continue;
      for (const [sub, subNode] of Object.entries(inner.shape))
        descriptions.set(`${name}.${field}.${sub}`, subNode?.description || "");
    }
  };
  const fakeServer = {
    tool: (name, description, schema) => collect(name, description, schema),
    registerTool: (name, config) => collect(name, config.description, config.inputSchema),
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return descriptions;
}

// Gepinnte Emphase-Inventur: Anzahl UND Reihenfolge je Beschreibungs-Pfad. Leere Listen sind
// bewusst mit aufgefuehrt - eine neu eingeschmuggelte Emphase faellt damit ebenso auf wie
// eine verlorene. Der Bestand vor P15 (deutsch) trug exakt dieselbe Marker-Zahl an
// denselben Satzpositionen (Marker-Inventur im Phasenplan).
const EXPECTED_MARKERS = {
  // T2-13 (N-10): REQUIRES/FIRST/NOT sind die neue Bestaetigungs-Pflicht am Satzanfang
  // (confirmation_code aus prepare_call, sonst wird nicht gewaehlt) - bewusst nachgezogen
  // statt weggeschrieben, Praezedenz max_duration_s/KS-P3. Die drei alten Marker
  // (NOT reversible, just call it, NOT guaranteed/ALWAYS poll) bleiben unveraendert dahinter.
  place_call: ["REQUIRES", "FIRST", "NOT", "NOT", "NOT", "ALWAYS"],
  "place_call.to": ["EXACTLY", "NEVER"],
  "place_call.objective": ["ONE", "VERBATIM", "BEFORE", "NO", "ALWAYS", "FIRST", "NOT"],
  // GQ-B1: die Vertroestungs-Sperre. KNOW ist die Verhaltensgarantie des Feldes (nur
  // Gewusstes ins Briefing) - bewusst nachgezogen statt weggeschrieben, Praezedenz
  // max_duration_s/KS-P3.
  "place_call.briefing": ["SUMMARISE", "NO", "KNOW"],
  "place_call.constraints": [],
  "place_call.mandate": ["MANDATE", "ITSELF", "NOTHING", "NO", "ALWAYS"],
  // GQ-B1: die Vorab-Rueckfrage ist hier gestrichen (sie steht bedingt im Eltern-Feld);
  // die Erfindungs-Sperre bleibt, sie traegt keinen Marker.
  "place_call.mandate.decide_freely": ["WITHOUT", "WITHOUT", "NOT"],
  "place_call.mandate.fallback_order": [],
  "place_call.mandate.on_out_of_scope": ["OUTSIDE", "ONLY"],
  "place_call.context": ["BACKGROUND", "ADDITIONAL", "NEVER", "NO"],
  "place_call.context.summary": [],
  "place_call.context.key_facts": ["NO"],
  "place_call.context.recipient_relationship": [],
  "place_call.context.desired_outcome": [],
  // AL-P13 / 15.08.2026: das fuenfte Kontext-Feld war als einziges nie im zod-Schema
  // deklariert - zod strippt undeklarierte Schluessel STILL, der Eroeffnungs-Consult konnte
  // ueber place_call also nie feuern. Mit der Deklaration kommt ein NEUER Beschreibungs-Pfad
  // hinzu; die Menge wird deshalb erweitert, nicht die Erwartung gesenkt. Die eine Emphase
  // BEFORE ist die Verhaltensgarantie des Feldes (gefragt wird VOR dem Gespraech, waehrend
  // es klingelt) und bleibt gepinnt. Praezedenz max_duration_s/KS-P3, diagnostic/GQ-P11.
  "place_call.context.open_questions": ["BEFORE"],
  // KS-P3 (b): die Beschreibung nannte bis dahin zwei feste Zahlen ("default 180, max 300"),
  // die es seit dieser Phase nicht mehr gibt (die Frist faellt aus dem Restguthaben). Der neue
  // Text traegt EINE Emphase - dass ein Client-Wunsch die Frist nur VERKUERZEN kann. Bewusst
  // nachgezogen statt die Emphase wegzuschreiben: die Aussage ist die eigentliche
  // Verhaltensgarantie dieses Feldes.
  "place_call.max_duration_s": ["SHORTER"],
  // P4a (F-2): das Feld ist zurueck und WIRKSAM (LANG-15 aufgehoben). SPEAKS ist die
  // Verhaltensgarantie (nur die Gespraechssprache, nie die Offenlegung), REJECTED die
  // Ablehnungssemantik (nie stilles Ignorieren, E-3), NOT die harte Gate-Grenze zur
  // Pflicht-Offenlegung. AI steht in NON_EMPHASIS_TOKENS.
  "place_call.language": ["SPEAKS", "REJECTED", "NOT"],
  // GQ-P11: aus dem Opt-in wurde ein Opt-out. Die Emphase wandert entsprechend mit -
  // OWN (die Grenze, die der Server prueft), NOT (das Modell muss nichts mehr setzen),
  // ONLY (der Widerspruch ist der eng begrenzte Fall). Bewusst nachgezogen statt die
  // Emphase wegzuschreiben, Praezedenz max_duration_s/KS-P3.
  "place_call.diagnostic": ["OWN", "NOT", "ONLY"],
  get_call_status: [],
  "get_call_status.call_id": [],
  get_call_result: ["NEVER"],
  "get_call_result.call_id": [],
  // S1-2c (Owner-Auftrag 15.08.2026): die Beschreibung war eine Luege ("Cancels a running
  // call cleanly") - der REST-Pfad zusichert seit S1-4 keinen bestaetigten Leitungs-Abbruch
  // mehr. Die neue, wahrheitsgemaesse Fassung traegt EINE Emphase (NOT guaranteed) -
  // bewusst nachgezogen statt die Emphase wegzuschreiben, Praezedenz max_duration_s/KS-P3.
  cancel_call: ["NOT"],
  "cancel_call.call_id": [],
  get_agent_number: [],
  list_calls: [],
  // INBOX-P3: das Negativ-Verbot am Tool-Entscheidungspunkt (Pre-Mortem R-11). Die drei
  // Marker sind die Verhaltensgarantie des Werkzeugs - CONSUMING (der Abruf verbraucht),
  // NOT appear again (kein zweites Mal), Do NOT use ... use list_calls (die Abgrenzung,
  // ohne die das Modell beim Blaettern die Inbox leerkonsumiert). Bewusst gepinnt, nicht
  // weggeschrieben; Praezedenz max_duration_s/KS-P3.
  check_inbox: ["CONSUMING", "NOT", "NOT"],
  "check_inbox.include_seen": ["NO"],
  list_action_items: [],
  get_agent_status: [],
  // T2-13 (N-10): confirmation_code ist ein neues Pflichtfeld auf place_call (Schema
  // optional, Pflicht im Handler - s. mcp-tools.js). SAME/REQUIRED/NOT sind die
  // Verhaltensgarantien: gleiche Argumente wie prepare_call, Pflicht zum Waehlen,
  // Ablehnung ohne gueltigen Code.
  "place_call.confirmation_code": ["SAME", "REQUIRED", "NOT"],
  // T2-13 (N-10): prepare_call ist neu registriert und teilt sich PLACE_CALL_REQUEST_SCHEMA
  // mit place_call (dieselbe Modul-Konstante) - jedes Feld traegt deshalb DIESELBEN
  // Emphase-Marker wie sein place_call-Gegenstueck oben, unter dem eigenen Pfad-Praefix.
  // Safety-Review T2-13-Nachbesserung: die Beschreibung ist auf den echten Mechanismus
  // zurueckgeschnitten (kein "host with/without card support", stattdessen "card
  // confirmation enabled/disabled for this server" - es gibt keine Host-Erkennung, nur
  // den globalen Schalter MCP_UI_ENABLED, s. Korrektur in mcp-tools.js/PLAN-SECURITY.md).
  // Dadurch faellt ein WITHOUT weg (nur noch einmal im ersten Satz).
  prepare_call: ["WITHOUT", "EVERY"],
  "prepare_call.to": ["EXACTLY", "NEVER"],
  "prepare_call.objective": ["ONE", "VERBATIM", "BEFORE", "NO", "ALWAYS", "FIRST", "NOT"],
  "prepare_call.briefing": ["SUMMARISE", "NO", "KNOW"],
  "prepare_call.constraints": [],
  "prepare_call.mandate": ["MANDATE", "ITSELF", "NOTHING", "NO", "ALWAYS"],
  "prepare_call.mandate.decide_freely": ["WITHOUT", "WITHOUT", "NOT"],
  "prepare_call.mandate.fallback_order": [],
  "prepare_call.mandate.on_out_of_scope": ["OUTSIDE", "ONLY"],
  "prepare_call.context": ["BACKGROUND", "ADDITIONAL", "NEVER", "NO"],
  "prepare_call.context.summary": [],
  "prepare_call.context.key_facts": ["NO"],
  "prepare_call.context.recipient_relationship": [],
  "prepare_call.context.desired_outcome": [],
  "prepare_call.context.open_questions": ["BEFORE"],
  "prepare_call.language": ["SPEAKS", "REJECTED", "NOT"],
  "prepare_call.max_duration_s": ["SHORTER"],
  "prepare_call.diagnostic": ["OWN", "NOT", "ONLY"],
};

test("O14: keine der MCP-Tool-/Feld-Beschreibungen enthaelt noch deutschen Text", () => {
  const descriptions = captureDescriptions();
  assert.ok(descriptions.size > 0, "es wurden ueberhaupt Beschreibungen eingesammelt");
  for (const [pathName, description] of descriptions)
    assert.doesNotMatch(description, GERMAN_STOPWORDS, `${pathName} ist englisch`);
});

// Pre-Mortem 2 (Spec Abschnitt 4): E2E-06 "gruen gemacht" durch Entschaerfen des Tests.
// Die Liste ist der Massstab beider Waechter - wer sie aufweicht, bricht hier byte-genau.
test("O14: die Stopwortliste ist byte-gepinnt (Aufweichen ist verboten)", () => {
  assert.equal(
    GERMAN_STOPWORDS.source,
    "Guten Tag|Hallo|kann gerade nicht|Anruf|Gegenseite|Bitte spaeter erneut|Nachricht|Ungueltige|Anmeldung fehlgeschlagen|Sitzung abgelaufen|Grund|Besitzer|Auftrag",
  );
});

test("O14: die Emphase-Marker sind je Beschreibung nach Anzahl UND Reihenfolge erhalten", () => {
  const descriptions = captureDescriptions();
  assert.deepEqual(
    [...descriptions.keys()].sort(),
    Object.keys(EXPECTED_MARKERS).sort(),
    "die Menge der Beschreibungs-Pfade ist unveraendert",
  );
  for (const [pathName, expected] of Object.entries(EXPECTED_MARKERS))
    assert.deepEqual(capsMarkersOf(descriptions.get(pathName)), expected, pathName);
});

// Die vier Negativ-Beispiele, an denen die Anrufqualitaets-Kette die vagen Auftraege
// abgestellt hat. Sie muessen Beispiele BLEIBEN, nicht zu allgemeinen Hinweisen verwaschen.
test("O14: die Negativ-Beispiele der Qualitaets-Kette stehen woertlich in der EN-Fassung", () => {
  const descriptions = captureDescriptions();
  const objective = descriptions.get("place_call.objective");
  assert.match(objective, /NO bare-infinitive stub like 'Book an appointment'/);
  assert.match(objective, /read out VERBATIM/);
  assert.match(objective, /ask the user FIRST/);
  const decideFreely = descriptions.get("place_call.mandate.decide_freely");
  assert.match(decideFreely, /Hard prohibitions do NOT belong here/);
});

// Die Systemgrenze steht als Kommentar am Kopf von src/mcp-tools.js, damit die naechste
// Phase die Beschreibungen nicht versehentlich wieder in die Lokalisierung zieht.
test("O14: die Systemgrenze Modellsprache != Nutzersprache ist im Code dokumentiert", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/mcp-tools.js"), "utf8");
  assert.match(src, /MODELLSPRACHE != NUTZERSPRACHE/);
});

// LANG-15 (SOLL, gruen nach F-2) - place_call bietet einen WIRKSAMEN Sprachparameter, und
// seine Beschreibung nennt Katalog, Default und die Grenze zur Offenlegung. Entscheidung
// E3 (tasks/i18n-tests/00-kanonische-liste.md, Cluster D11: "entfernen") ist durch die
// Owner-Entscheidung F-2 (2026-09-06, PLAN-ANRUFDEFEKTE.md Abschnitt 6) AUFGEHOBEN: ein
// wirkungsloser Parameter fuehrte das Modell in die Irre (W5) - die Antwort darauf ist ein
// wirksamer Parameter, kein entfernter.
test("LANG-15 (SOLL, gruen nach F-2) - place_call.language nennt den Katalog, lehnt unbekannte Codes ab und bleibt von der Offenlegung getrennt", () => {
  const text = captureDescriptions().get("place_call.language");
  assert.ok(text, "der Pfad existiert");
  for (const code of SUPPORTED_LANGUAGES) assert.ok(text.includes(code), `Katalog nennt ${code}`);
  assert.match(text, /REJECTED/);
  assert.match(text, /disclosure/i);
});

// AL-P13: der Consult-Kanal registriert zwei WEITERE Werkzeuge - aber NUR bei
// freigegebener Faehigkeit. Der Bestands-Lauf oben (registerTools(fakeServer, {}))
// bleibt deshalb unveraendert; hier laeuft ein ZWEITER Capture mit consultAllowed:true.
// Die Stopwortliste wird NICHT angefasst - dieselbe Liste, derselbe Massstab.
const EXPECTED_CONSULT_MARKERS = {
  await_call_event: ["REPEATEDLY", "NEVER"],
  "await_call_event.call_id": [],
  "await_call_event.after_event_id": [],
  // GQ-B2 Fix-Runde 1: "ask the user FIRST" ist raus (Owner ist waehrend des Anrufs
  // abwesend, siehe gq-b1-briefing-openness.test.js GQ-B2-05) - keine neue Emphase kam
  // nach.
  // P2 (SCOPE 2): FIRST/THEN sind neu - die Pflicht zur sofortigen Quittung
  // (status="working") VOR der eigentlichen Antwort.
  answer_consult: ["FIRST", "THEN", "SHORT", "REJECTED", "NOT"],
  "answer_consult.call_id": [],
  "answer_consult.event_id": [],
  "answer_consult.status": [],
  "answer_consult.answers": [],
};

test("O14/AL-P13: die Consult-Werkzeuge erscheinen nur mit Faehigkeit - und sind englisch", () => {
  const withConsult = captureDescriptions({ consultAllowed: true });
  for (const pathName of Object.keys(EXPECTED_CONSULT_MARKERS)) {
    assert.ok(!captureDescriptions().has(pathName), `${pathName} fehlt ohne Faehigkeit`);
    assert.ok(withConsult.has(pathName), `${pathName} erscheint mit Faehigkeit`);
    assert.doesNotMatch(withConsult.get(pathName), GERMAN_STOPWORDS, `${pathName} ist englisch`);
  }
});

test("O14/AL-P13: die Emphase der Consult-Werkzeuge ist nach Anzahl UND Reihenfolge gepinnt", () => {
  const withConsult = captureDescriptions({ consultAllowed: true });
  for (const [pathName, expected] of Object.entries(EXPECTED_CONSULT_MARKERS))
    assert.deepEqual(capsMarkersOf(withConsult.get(pathName)), expected, pathName);
  // Der Schleifen-Hinweis haengt sich an place_call an, OHNE dessen Emphase zu
  // verschieben (der Bestandstext bleibt vorn und unveraendert).
  assert.deepEqual(capsMarkersOf(withConsult.get("place_call")), EXPECTED_MARKERS.place_call);
  assert.ok(withConsult.get("place_call").startsWith(captureDescriptions().get("place_call")));
});
