// OC-P3 (PLAN-OWNER-CALL): Gleichlauf der uebrigen Outbound-Wege (Budget-Erst-Turn,
// Budget-/Realtime-Systemprompt, Telnyx-Assistant-Shim) mit dem OC-P2-Praedikat
// (call.calleeIsOwner). Kein Katalog-ID-Praefix, kein ABNAHME-Praefix (Testnamen tragen
// "OC-P3-" am Anfang, faellt nicht unter i18nCatalogPattern, package.json:8 geprueft).
//
// DATA_DIR/config.js muessen VOR jedem store-gebundenen Import gebunden werden (Lehre
// test/al-p1-agent-turn-callerturns.test.js Kopfkommentar: ein statischer Import, der
// transitiv src/config.js zieht, wuerde config.server.dataDir dauerhaft auf den Default
// binden). Deshalb: EIN before()-Hook setzt DATA_DIR zuerst, ALLE store-gebundenen Module
// (claude.js, i18n/locales.js, telnyx-call-control-ingest.js, telnyx-shim-harness.js)
// werden dort dynamisch importiert. test/_outbound-harness.js ist die einzige Ausnahme:
// es spawnt einen Kindprozess (eigenes DATA_DIR ueber env), zieht in diesem Prozess kein
// src/config.js - statischer Import oben ist unbedenklich (Muster disclosure-outbound.test.js).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tempDataDir,
  seedState,
  seedCall,
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_LAST_NAME,
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { TRANSLITERATION_STEMS } from "./umlaut-stems-helper.js";
import {
  runOutbound,
  assertDisclosureInGather,
  DISCLOSURE_JONAS,
  GATHER_OPEN,
  HANGUP_TAG,
} from "./_outbound-harness.js";

const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`; // == "Jonas Beispiel", Bench-Owner
const NO_NAME_TENANT_ID = "t_oc_p3_no_name";
const OUTBOUND = "outbound";

// Golden-Fixture (5.2): aus UNBERUEHRTEM master abgegriffen, VOR jedem OC-P3-Edit.
// Zeile 2 des Prompts (uhrabhaengig) ist bereits maskiert - maskSecondLine unten
// erzeugt beim Vergleich dieselbe Maskierung.
const GOLDEN = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "oc-p3-nichtowner-golden.json"),
    "utf8",
  ),
);
function maskSecondLine(text) {
  const lines = text.split("\n");
  lines[1] = "[MASKED-NOW-LINE]";
  return lines.join("\n");
}

// Ein Ziel OHNE Leerzeichen laeuft in den "keine Wortgrenze"-Zweig von trimGoalForSpeech
// und wird auf EXAKT die Kappe geschnitten (Muster test/al-p5-opening.test.js). Die Zahl
// ist bewusst groesser als jede denkbare Kappe (G25).
const GOAL_OVERLENGTH_CHAR_COUNT = 200;
const GOAL_WITHOUT_WORD_BOUNDARY = "a".repeat(GOAL_OVERLENGTH_CHAR_COUNT);
const HTTP_STATUS_OK = 200;
const GOLDEN_GOAL = "Naechsten freien Termin fuer einen Herrenhaarschnitt bei Petra vereinbaren";
const OWNER_FRAGMENT = { de: "im Auftrag von", fr: "pour le compte de", en: "on behalf of" };
const LANGS = ["de", "fr", "en"];

let systemPrompt, openingText, disclosureSentence;
let LOCALES, localeFor;
let makeCallControlIngest;
let ingestTimeoutDeps, makeHandler, fakeStore, makeCall, agentTurnSpy, validReq, fakeRes;

before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER },
        // A11: ein Owner-Ziel-Tenant OHNE Namen - der Fail-closed-Fall (kein Namens-Rueckfall).
        { id: NO_NAME_TENANT_ID, status: "active" },
      ],
    }),
  );
  ({ systemPrompt, openingText, disclosureSentence } = await import("../src/claude.js"));
  ({ LOCALES, localeFor } = await import("../src/i18n/locales.js"));
  ({ makeCallControlIngest } = await import("../src/telnyx-call-control-ingest.js"));
  ({ ingestTimeoutDeps, makeHandler, fakeStore, makeCall, agentTurnSpy, validReq, fakeRes } =
    await import("./telnyx-shim-harness.js"));
});

const ownerCall = (over = {}) =>
  seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: OUTBOUND, calleeIsOwner: true, ...over });
const foreignCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: OUTBOUND, ...over });

// ---------------------------------------------------------------------------
// Block A: openingText
// ---------------------------------------------------------------------------

const OWNER_GOAL = {
  de: "Einen Rueckruftermin fuer naechste Woche vereinbaren",
  fr: "Convenir d'un rendez-vous de rappel la semaine prochaine",
  en: "Arrange a callback appointment for next week",
};

for (const lang of LANGS) {
  test(`OC-P3-A openingText Owner-Ziel ${lang} mit Anliegen: Owner-Begruessung, keine Offenlegung`, () => {
    const call = ownerCall({ language: lang, goal: OWNER_GOAL[lang] });
    const text = openingText(call);
    const opening = localeFor(lang).ownerOpening(OWNER_TEST_FIRST_NAME);
    assert.ok(text.startsWith(opening), `${lang}: Owner-Begruessung fehlt am Anfang: ${text}`);
    assert.ok(!text.includes(disclosureSentence(call)), `${lang}: Offenlegung darf nicht vorkommen: ${text}`);
    assert.ok(
      !text.includes(OWNER_FRAGMENT[lang]),
      `${lang}: Fremd-Fragment "${OWNER_FRAGMENT[lang]}" darf nicht vorkommen: ${text}`,
    );
  });
}

test("OC-P3-A4 openingText Owner-Ziel de, ueberlanges Anliegen: Kappe beisst wie im Bestand", () => {
  const call = ownerCall({ language: "de", goal: GOAL_WITHOUT_WORD_BOUNDARY });
  const text = openingText(call);
  const opening = localeFor("de").ownerOpening(OWNER_TEST_FIRST_NAME);
  assert.ok(text.startsWith(opening), `Owner-Begruessung fehlt: ${text}`);
  assert.ok(!/[.!?]{2}/.test(text), `doppeltes Satz-Endzeichen: ${text}`);
  assert.ok(text.endsWith("."), `Eroeffnung endet nicht auf genau einem Punkt: ${text}`);
});

test("OC-P3-A5 openingText Owner-Ziel de, leeres Anliegen: nur die Begruessung", () => {
  const call = ownerCall({ language: "de", goal: "" });
  assert.equal(openingText(call), localeFor("de").ownerOpening(OWNER_TEST_FIRST_NAME));
});

test("OC-P3-A6 openingText Owner-Ziel de, Ich-Satz-Anliegen: Passthrough-Zweig von bridgePhrase unveraendert", () => {
  const goal = "Ich moechte wissen ob der Termin noch frei ist";
  const call = ownerCall({ language: "de", goal });
  const text = openingText(call);
  const opening = localeFor("de").ownerOpening(OWNER_TEST_FIRST_NAME);
  assert.ok(text.startsWith(`${opening} Ich`), `Ich-Satz muss woertlich direkt folgen: ${text}`);
  assert.ok(!text.includes("Es geht um Folgendes"), `Bruecken-Floskel darf im Ich-Zweig nicht stehen: ${text}`);
});

for (const lang of LANGS) {
  test(`OC-P3-A openingText Fremd-Ziel ${lang}: byte-identisch zum Golden`, () => {
    const call = foreignCall({ language: lang, goal: GOLDEN_GOAL });
    assert.equal(openingText(call), GOLDEN.openingText[lang].mitGoal);
  });
}

const FAIL_CLOSED_VARIANTS = [undefined, false, "true", 1];
for (const variant of FAIL_CLOSED_VARIANTS) {
  test(`OC-P3-A10 fail-closed calleeIsOwner=${JSON.stringify(variant)} -> Offenlegung`, () => {
    const over = variant === undefined ? {} : { calleeIsOwner: variant };
    const call = seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: OUTBOUND, language: "de", goal: "", ...over });
    assert.equal(openingText(call), disclosureSentence(call));
  });
}

test("OC-P3-A11 Owner-Ziel, Tenant ohne Vornamen: kein Namens-Rueckfall, volle Offenlegung", () => {
  const call = seedCall({
    tenantId: NO_NAME_TENANT_ID,
    direction: OUTBOUND,
    calleeIsOwner: true,
    language: "de",
    goal: "",
  });
  const text = openingText(call);
  assert.equal(text, disclosureSentence(call));
  assert.ok(!text.startsWith("Hallo"), `darf keine Owner-Anrede tragen: ${text}`);
});

// ---------------------------------------------------------------------------
// Block B: systemPrompt
// ---------------------------------------------------------------------------

for (const lang of LANGS) {
  test(`OC-P3-B systemPrompt Owner-Ziel ${lang}: Owner-SITUATION ersetzt die Bestandszeile`, () => {
    const call = ownerCall({ language: lang });
    const prompt = systemPrompt(call);
    const localePrompt = LOCALES[lang].prompt;
    const ownerSituation = localePrompt.situationOutboundOwner({ owner: OWNER_TEST_FIRST_NAME });
    const bestandSituation = localePrompt.situationOutbound({ call, owner: OWNER_TEST_FIRST_NAME });
    assert.ok(prompt.includes(ownerSituation), `${lang}: Owner-SITUATION fehlt`);
    assert.ok(!prompt.includes(bestandSituation), `${lang}: Bestands-SITUATION darf nicht rendern`);
  });
}

for (const lang of LANGS) {
  test(`OC-P3-B systemPrompt Owner-Ziel ${lang}: Owner-Identitaetszeile ersetzt die Bestandszeile`, () => {
    const call = ownerCall({ language: lang });
    const prompt = systemPrompt(call);
    const localePrompt = LOCALES[lang].prompt;
    const disclosure = disclosureSentence(call);
    const ownerIdentity = localePrompt.identityLines.outboundOwner({ owner: OWNER_TEST_FIRST_NAME, disclosure });
    const bestandIdentity = localePrompt.identityLines.outbound(OWNER_TEST_FIRST_NAME);
    assert.ok(prompt.includes(ownerIdentity), `${lang}: Owner-Identitaetszeile fehlt`);
    assert.ok(!prompt.includes(bestandIdentity), `${lang}: Bestands-Identitaetszeile darf nicht rendern`);
  });
}

for (const lang of LANGS) {
  test(`OC-P3-B systemPrompt Owner-Ziel ${lang}: Pflicht-Rueckfallzeile traegt den woertlichen Offenlegungssatz`, () => {
    const call = ownerCall({ language: lang });
    const prompt = systemPrompt(call);
    const disclosure = disclosureSentence(call);
    assert.equal(disclosure, LOCALES[lang].disclosure(OWNER), `${lang}: disclosureSentence-Quelle abweichend`);
    assert.ok(prompt.includes(disclosure), `${lang}: Offenlegungssatz fehlt woertlich in der Rueckfallzeile`);
  });
}

for (const lang of LANGS) {
  test(`OC-P3-B systemPrompt Fremd-Ziel outbound ${lang}: byte-identisch zum Golden`, () => {
    const call = foreignCall({ language: lang });
    assert.equal(maskSecondLine(systemPrompt(call)), GOLDEN.systemPrompt[lang].outbound);
  });
}

for (const lang of LANGS) {
  test(`OC-P3-B systemPrompt Inbound ${lang}: byte-identisch zum Golden, calleeIsOwner ohne Wirkung`, () => {
    const withOwnerFlag = seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: lang, direction: "inbound", calleeIsOwner: true });
    const withoutOwnerFlag = seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: lang, direction: "inbound" });
    assert.equal(maskSecondLine(systemPrompt(withOwnerFlag)), GOLDEN.systemPrompt[lang].inbound);
    assert.equal(maskSecondLine(systemPrompt(withoutOwnerFlag)), GOLDEN.systemPrompt[lang].inbound);
  });
}

// ---------------------------------------------------------------------------
// Block C: /voice/outbound Ende-zu-Ende (TeXML-Rendering, ohne echten Anruf)
// ---------------------------------------------------------------------------

const OWNER_OPENING_DE = "Hallo Jonas, hier ist dein KI-Assistent.";
const SAY_OPEN_DE = '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">';

test("OC-P3-C1 /voice/outbound Owner-Ziel: Say-Praefix ist die Owner-Begruessung, keine Offenlegung, kein Hangup", async () => {
  const { body: twiml, status } = await runOutbound({ provider: "telnyx", call: { calleeIsOwner: true } });
  assert.equal(status, HTTP_STATUS_OK);
  const sayIdx = twiml.indexOf(SAY_OPEN_DE + OWNER_OPENING_DE);
  const gatherIdx = twiml.indexOf(GATHER_OPEN);
  assert.ok(sayIdx !== -1, `Owner-Begruessung als Say-Praefix fehlt: ${twiml}`);
  assert.ok(gatherIdx !== -1, `Gather fehlt: ${twiml}`);
  assert.ok(gatherIdx < sayIdx, `Owner-Say muss IM Gather stehen: ${twiml}`);
  assert.ok(!twiml.includes(DISCLOSURE_JONAS), `Offenlegung darf beim Owner-Ziel nicht erscheinen: ${twiml}`);
  assert.ok(!twiml.includes(HANGUP_TAG), `/voice/outbound darf nicht auflegen: ${twiml}`);
});

test("OC-P3-C2 /voice/outbound Fremd-Ziel: unveraendert (Offenlegung als Say-Praefix im Gather)", async () => {
  const { body: twiml, status } = await runOutbound({ provider: "telnyx" });
  assert.equal(status, HTTP_STATUS_OK);
  assertDisclosureInGather(twiml);
  assert.ok(!twiml.includes(HANGUP_TAG), `/voice/outbound darf nicht auflegen: ${twiml}`);
});

// ---------------------------------------------------------------------------
// Block D: Telnyx-Assistant-Speak-Node (call.answered -> onAnswered)
// ---------------------------------------------------------------------------

// Minimaler Antrieb wie test/telnyx-p8-opening-contract.test.js (dort NICHT veraendert -
// nachgebaut). ACHTUNG (gemessene Falle, s. Plan 5.3 Block D): dort seedet das Vorbild
// OHNE Tenant -> firstName "" -> der Owner-Zweig faellt fail-closed durch. Dieser Test
// braucht den echten, benannten Tenant (oben in before() geseedet), sonst waere D1
// gruen-aus-dem-falschen-Grund.
async function driveAnswered(call) {
  const speakCalls = [];
  const handler = makeCallControlIngest({
    store: { getCall: (id) => (id === call.id ? call : null), markAnswered() {} },
    voiceControl: () => ({
      async speak(payload) {
        speakCalls.push(payload);
      },
      async startAssistant() {},
    }),
    finishCall: async () => {},
    openingText,
    localeFor,
    ...ingestTimeoutDeps(),
  });
  const body = { data: { event_type: "call.answered", payload: { call_control_id: "cc_1" } } };
  await handler({ query: { callId: call.id }, body }, { sendStatus() {} });
  return speakCalls[0];
}

const telnyxAssistantCall = (over = {}) => ({
  id: "call_oc_p3_shim",
  status: "active",
  provider: "telnyx",
  direction: OUTBOUND,
  language: "de",
  tenantId: BOOTSTRAP_TENANT_ID,
  goal: "Testziel",
  ...over,
});

test("OC-P3-D1 Telnyx-Assistant-Pfad: Owner-Ziel spricht Owner-Begruessung, keine Offenlegung", async () => {
  const call = telnyxAssistantCall({ calleeIsOwner: true });
  const speak = await driveAnswered(call);
  assert.equal(speak.text, openingText(call), "Speak-Node == openingText(call) (eine Quelle wie Budget-Pfad)");
  assert.ok(speak.text.startsWith(localeFor("de").ownerOpening(OWNER_TEST_FIRST_NAME)));
  assert.ok(!speak.text.includes(disclosureSentence(call)));
});

test("OC-P3-D2 Telnyx-Assistant-Pfad: Fremd-Ziel byte-identisch zum Bestand (Offenlegung)", async () => {
  const call = telnyxAssistantCall();
  const speak = await driveAnswered(call);
  assert.equal(speak.text, openingText(call));
  assert.ok(speak.text.startsWith(disclosureSentence(call)));
});

// ---------------------------------------------------------------------------
// Block F: Telnyx-Assistant-Shim-Beleg (Spec 2.3/Abnahme 8) - der Shim reicht
// denselben Call-Datensatz an agentTurn -> systemPrompt weiter.
// ---------------------------------------------------------------------------

test("OC-P3-F1 Shim reicht denselben Call-Datensatz mit calleeIsOwner an agentTurn weiter", async () => {
  const call = makeCall({ tenantId: BOOTSTRAP_TENANT_ID, calleeIsOwner: true, language: "de" });
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  await handler(validReq(call), fakeRes());
  assert.equal(agentTurn.calls.length, 1);
  const seenCall = agentTurn.calls[0].call;
  assert.equal(seenCall, call, "agentTurn bekommt dieselbe Store-Referenz");
  assert.equal(seenCall.calleeIsOwner, true);
});

test("OC-P3-F2 systemPrompt(<vom Shim gesehener Call>) traegt Owner-SITUATION + Rueckfallzeile", async () => {
  const call = makeCall({ tenantId: BOOTSTRAP_TENANT_ID, calleeIsOwner: true, language: "de" });
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  await handler(validReq(call), fakeRes());
  const seenCall = agentTurn.calls[0].call;
  const prompt = systemPrompt(seenCall);
  const localePrompt = LOCALES.de.prompt;
  assert.ok(prompt.includes(localePrompt.situationOutboundOwner({ owner: OWNER_TEST_FIRST_NAME })));
  assert.ok(prompt.includes(disclosureSentence(seenCall)));
});

// ---------------------------------------------------------------------------
// Block E: Umlaute/Akzente im Owner-Zweig (die Bestands-Ratsche cq-p5-prompt-redesign
// rendert NIE mit calleeIsOwner - s. dortigen Kommentar an seedCall(...) - und deckt den
// neuen Zweig deshalb nicht ab).
// ---------------------------------------------------------------------------

// FR-Transliterations-Denylist: kuratiert wie test/cq-p5-prompt-redesign.test.js (dort
// nicht veraendert - dieselbe Definition hier, da nicht zentral exportiert).
const FR_TRANSLITERATION_STEMS = /\betre\b|\bmeme\b|\bresponsable\b|\bnumero\b/i;
const REAL_UMLAUT = /[äöüÄÖÜ]/u;
const REAL_ACCENT = /[éèêëàâäùûüôöîïç]/iu;

test("OC-P3-E1 DE-Owner-Prompt traegt keine Umlaut-Transliteration", () => {
  const prompt = systemPrompt(ownerCall({ language: "de" }));
  const hit = prompt.match(TRANSLITERATION_STEMS);
  assert.equal(hit, null, `Transliteration "${hit?.[0]}" gefunden`);
});

test("OC-P3-E2 Gegenprobe - DE-Owner-Prompt traegt echte Umlaut-Zeichen", () => {
  assert.match(systemPrompt(ownerCall({ language: "de" })), REAL_UMLAUT);
});

test("OC-P3-E3 FR-Owner-Prompt traegt keine Akzent-Transliteration", () => {
  const prompt = systemPrompt(ownerCall({ language: "fr" }));
  const hit = prompt.match(FR_TRANSLITERATION_STEMS);
  assert.equal(hit, null, `Transliteration "${hit?.[0]}" gefunden`);
});

test("OC-P3-E4 Gegenprobe - FR-Owner-Prompt traegt echte Akzent-Zeichen", () => {
  assert.match(systemPrompt(ownerCall({ language: "fr" })), REAL_ACCENT);
});

// EN: keine Gegenprobe (Spec 6E) - der vorgeschriebene EN-Wortlaut (situationOutboundOwner/
// identityLines.outboundOwner) traegt strukturell kein Sonderzeichen; der Wortlaut wird
// dafuer nicht gebogen.
