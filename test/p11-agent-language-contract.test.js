import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";

let systemPrompt, toolDefs, agentToolNames, execTool, endCallWaitInstruction, openingText;
let LOCALES, SUPPORTED_LANGUAGES;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  await import("../src/config.js");
  ({ systemPrompt, toolDefs, agentToolNames, execTool, endCallWaitInstruction, openingText } =
    await import("../src/claude.js"));
  ({ LOCALES, SUPPORTED_LANGUAGES } = await import("../src/i18n/locales.js"));
});

const call = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, ...over });

const GERMAN_HEADINGS = [
  "SITUATION:",
  "SO SPRICHST DU:",
  "WENN ETWAS UNKLAR IST:",
  "DEINE GRENZEN:",
  "SO KOMMST DU ZUM ERGEBNIS:",
];

const STRING_FIELDS = [
  "goalLabel",
  "briefingLabel",
  "constraintsLabel",
  "outcomeOutbound",
  "outcomeInbound",
];
const FUNCTION_FIELDS = [
  "persona",
  "situationOutbound",
  "situationOutboundOwner",
  "situationInbound",
  "speechRules",
  "clarificationRules",
  "consultRules",
];

test("P11-1 jede unterstuetzte Sprache traegt den vollstaendigen Prompt-Vertrag", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const p = LOCALES[lang].prompt;
    assert.ok(p, `${lang}: locale.prompt fehlt`);
    for (const f of STRING_FIELDS) {
      assert.equal(typeof p[f], "string", `${lang}: prompt.${f} ist kein String`);
      assert.ok(p[f].length > 0, `${lang}: prompt.${f} ist leer`);
    }
    for (const f of FUNCTION_FIELDS) {
      assert.equal(typeof p[f], "function", `${lang}: prompt.${f} ist keine Funktion`);
    }
    for (const f of [
      "heading",
      "personalData",
      "bankData",
      "noCalendar",
      "noBooking",
      "noBookingWithMandate",
      "noLookup",
      "noLookupWithConsult",
      "noAskingCounterpartAboutOwnerWithConsult",
      "toolThrift",
    ]) {
      assert.ok(f in p.boundaries, `${lang}: prompt.boundaries.${f} fehlt`);
    }
    for (const f of [
      "scopeLabel",
      "scopeRules",
      "constraintsPrecedence",
      "fallbackLabel",
      "fallbackRules",
      "outOfScopeLabel",
      "outOfScopeRules",
      "outOfScopeSentence",
      "outOfScopeSentenceWithConsult",
    ]) {
      assert.ok(f in p.mandate, `${lang}: prompt.mandate.${f} fehlt`);
    }
    for (const f of ["take_message", "decline", "accept_best"]) {
      assert.equal(
        typeof p.mandate.outOfScopeSentence[f],
        "function",
        `${lang}: prompt.mandate.outOfScopeSentence.${f} ist keine Funktion`,
      );
    }
    for (const f of ["heading", "summary", "relationship", "outcome", "facts", "guardrail"]) {
      assert.ok(f in p.background, `${lang}: prompt.background.${f} fehlt`);
    }
    for (const f of ["heading", "entryPrefix", "guardrail"]) {
      assert.ok(f in p.memory, `${lang}: prompt.memory.${f} fehlt`);
    }
    for (const f of ["endCallDescription", "endCallReasonParam", "takeMessageDescription", "takeMessageParam"]) {
      assert.equal(typeof p.tools[f], "string", `${lang}: prompt.tools.${f} ist kein String`);
      assert.ok(p.tools[f].length > 0, `${lang}: prompt.tools.${f} ist leer`);
    }
    for (const f of ["directionLabel", "goalLabel", "transcriptLabel", "agentRole", "callerRole"]) {
      assert.equal(typeof p.summaryInput[f], "string", `${lang}: prompt.summaryInput.${f} ist kein String`);
    }
    assert.equal(typeof p.turnControl.openingBootstrap.outbound, "string");
    assert.equal(typeof p.turnControl.openingBootstrap.inbound, "string");
    assert.equal(typeof p.turnControl.silentTurn, "string");
    assert.equal(typeof p.turnControl.endCallWait, "string");
    assert.equal(typeof p.turnControl.takeMessageResult, "string");
    assert.equal(typeof p.turnControl.unknownTool, "string");
  }
});

test("P11-1b jede unterstuetzte Sprache traegt identityLines vollstaendig (OC-P3)", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const localePrompt = LOCALES[lang].prompt;
    for (const field of ["inbound", "outbound", "outboundOwner"]) {
      assert.equal(
        typeof localePrompt.identityLines[field],
        "function",
        `${lang}: prompt.identityLines.${field} ist keine Funktion`,
      );
    }
  }
});

test("P11-2 systemPrompt(en) traegt keine deutschen Sektions-Ueberschriften (ex PROMPT-01)", () => {
  for (const direction of ["inbound", "outbound"]) {
    const prompt = systemPrompt(call({ language: "en", direction }));
    const leaked = GERMAN_HEADINGS.filter((h) => prompt.includes(h));
    assert.deepEqual(leaked, [], `en/${direction}: ${leaked.join(", ")}`);
  }
});
test("P11-3 systemPrompt(fr) traegt keine deutschen Sektions-Ueberschriften", () => {
  for (const direction of ["inbound", "outbound"]) {
    const prompt = systemPrompt(call({ language: "fr", direction }));
    const leaked = GERMAN_HEADINGS.filter((h) => prompt.includes(h));
    assert.deepEqual(leaked, [], `fr/${direction}: ${leaked.join(", ")}`);
  }
});
test("P11-4 Gegenprobe: systemPrompt(de) traegt weiterhin alle fuenf Ueberschriften", () => {
  for (const direction of ["inbound", "outbound"]) {
    const prompt = systemPrompt(call({ language: "de", direction }));
    for (const h of GERMAN_HEADINGS) {
      assert.ok(prompt.includes(h), `de/${direction}: Ueberschrift fehlt: ${h}`);
    }
  }
});

test("P11-5 toolDefs(lang)-Namen sind sprachinvariant", () => {
  const expected = ["end_call", "take_message"];
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.deepEqual(
      toolDefs(lang).map((t) => t.name),
      expected,
      `${lang}: Tool-Namen weichen ab`,
    );
  }
  assert.deepEqual(agentToolNames(), expected);
});

test("P11-6 GAP-28-Marker sind je Sprache uebersetzt (nicht leer, ungleich DE fuer en/fr)", () => {
  const deLoc = LOCALES.de.prompt.turnControl;
  const markers = [
    ["openingBootstrap.outbound", (tc) => tc.openingBootstrap.outbound],
    ["openingBootstrap.inbound", (tc) => tc.openingBootstrap.inbound],
    ["silentTurn", (tc) => tc.silentTurn],
    ["endCallWait", (tc) => tc.endCallWait],
    ["takeMessageResult", (tc) => tc.takeMessageResult],
  ];
  for (const lang of SUPPORTED_LANGUAGES) {
    const tc = LOCALES[lang].prompt.turnControl;
    for (const [name, get] of markers) {
      const value = get(tc);
      assert.equal(typeof value, "string", `${lang}: ${name} ist kein String`);
      assert.ok(value.length > 0, `${lang}: ${name} ist leer`);
      if (lang !== "de") {
        assert.notEqual(value, get(deLoc), `${lang}: ${name} ist identisch zu DE (keine Uebersetzung)`);
      }
    }
  }
});

test("P11-7 execTool(take_message) liefert den EN-Text fuer language=en", () => {
  const c = call({ language: "en", id: "call_p11_7" });
  const result = execTool(c, "take_message", { message: "note this" });
  assert.equal(result, LOCALES.en.prompt.turnControl.takeMessageResult);
});
test("P11-8 endCallWaitInstruction liefert den FR-Text fuer language=fr", () => {
  const c = call({ language: "fr" });
  assert.equal(endCallWaitInstruction(c), LOCALES.fr.prompt.turnControl.endCallWait);
});

test("P11-9 jedes Locale traegt eine funktionale, nicht-leere disclosure mit ownerName", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(typeof LOCALES[lang].disclosure, "function", `${lang}: disclosure fehlt`);
    const text = LOCALES[lang].disclosure(OWNER);
    assert.ok(text.length > 0, `${lang}: disclosure ist leer`);
    assert.ok(text.includes(OWNER), `${lang}: disclosure nennt nicht den ownerName`);
  }
});
test("P11-10 openingText beginnt in jeder Sprache mit der Offenlegung", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const c = call({ language: lang, goal: "Testziel" });
    const text = openingText(c);
    const disclosure = LOCALES[lang].disclosure(OWNER);
    assert.ok(text.startsWith(disclosure), `${lang}: openingText beginnt nicht mit der Offenlegung`);
  }
});
