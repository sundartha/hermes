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
} from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { TRANSLITERATION_STEMS } from "../umlaut-stems-helper.js";

const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;
const NO_NAME_TENANT_ID = "t_oc_p3_no_name";
const OUTBOUND = "outbound";

const GOLDEN = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "oc-p3-nichtowner-golden.json"),
    "utf8",
  ),
);
function maskSecondLine(text) {
  const lines = text.split("\n");
  lines[1] = "[MASKED-NOW-LINE]";
  return lines.join("\n");
}

const LANGS = ["de", "fr", "en"];

let systemPrompt, disclosureSentence;
let LOCALES;

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
  ({ systemPrompt, disclosureSentence } = await import("../../src/claude.js"));
  ({ LOCALES } = await import("../../src/i18n/locales.ts"));
});

const ownerCall = (over = {}) =>
  seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: OUTBOUND, calleeIsOwner: true, ...over });
const foreignCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: OUTBOUND, ...over });

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
