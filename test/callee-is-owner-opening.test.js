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

const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;
const NO_NAME_TENANT_ID = "t_oc_p3_no_name";
const OUTBOUND = "outbound";

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

const GOAL_OVERLENGTH_CHAR_COUNT = 200;
const GOAL_WITHOUT_WORD_BOUNDARY = "a".repeat(GOAL_OVERLENGTH_CHAR_COUNT);
const HTTP_STATUS_OK = 200;
const GOLDEN_GOAL = "Naechsten freien Termin fuer einen Herrenhaarschnitt bei Petra vereinbaren";
const OWNER_FRAGMENT = { de: "im Auftrag von", fr: "pour le compte de", en: "on behalf of" };
const LANGS = ["de", "fr", "en"];

let systemPrompt, openingText, disclosureSentence;
let LOCALES, localeFor;

before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER },
        { id: NO_NAME_TENANT_ID, status: "active" },
      ],
    }),
  );
  ({ systemPrompt, openingText, disclosureSentence } = await import("../src/claude.js"));
  ({ LOCALES, localeFor } = await import("../src/i18n/locales.js"));
});

const ownerCall = (over = {}) =>
  seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: OUTBOUND, calleeIsOwner: true, ...over });
const foreignCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: OUTBOUND, ...over });

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
