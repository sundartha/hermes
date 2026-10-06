import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, MANDATE_OUT_OF_SCOPE } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const SCOPE = "Termin an einem Werktag zwischen 9 und 12 Uhr, bis 60 Euro";

const LANGS = Object.freeze({
  de: {
    legacy:
      "- Du buchst KEINE Termine fest. Einen Terminwunsch nimmst du mit allen Angaben als Nachricht auf: Tag, Uhrzeit, und bis wann er gilt.",
    withMandate:
      "- Du buchst KEINE Termine fest. Einen Terminwunsch, den dein SPIELRAUM abdeckt, sagst du selbst zu und gibst ihn NICHT zusätzlich als Nachricht weiter. Für jeden anderen Terminwunsch gilt, was unter AUSSERHALB DEINES SPIELRAUMS steht.",
    noBookingCapability: "- Du buchst KEINE Termine fest.",
    outOfScopeLabel: "AUSSERHALB DEINES SPIELRAUMS:",
    scopeLabel: "DEIN SPIELRAUM:",
    scopeNoMessage: "gibst es NICHT als Nachricht weiter",
    decline: "lehne höflich ab",
  },
  en: {
    legacy:
      "- You do NOT book appointments firmly. You take an appointment request down as a message with all details: day, time, and how long it's valid.",
    withMandate:
      "- You do NOT book appointments firmly. An appointment request your LEEWAY covers, you commit to yourself and do NOT additionally hand off as a message. For every other appointment request, what is stated under OUTSIDE YOUR LEEWAY applies.",
    noBookingCapability: "- You do NOT book appointments firmly.",
    outOfScopeLabel: "OUTSIDE YOUR LEEWAY:",
    scopeLabel: "YOUR LEEWAY:",
    scopeNoMessage: "do NOT hand it off as a message",
    decline: "decline politely",
  },
  fr: {
    legacy:
      "- Tu ne réserves AUCUN rendez-vous de manière ferme. Tu notes une demande de rendez-vous comme message avec tous les détails : jour, heure, et jusqu'à quand elle est valable.",
    withMandate:
      "- Tu ne réserves AUCUN rendez-vous de manière ferme. Une demande de rendez-vous que couvre ta MARGE DE MANŒUVRE, tu t'y engages toi-même et tu ne la transmets PAS en plus comme message. Pour toute autre demande de rendez-vous, ce qui est indiqué sous HORS DE TA MARGE DE MANŒUVRE s'applique.",
    noBookingCapability: "- Tu ne réserves AUCUN rendez-vous de manière ferme.",
    outOfScopeLabel: "HORS DE TA MARGE DE MANŒUVRE :",
    scopeLabel: "TA MARGE DE MANŒUVRE :",
    scopeNoMessage: "tu ne le transmets PAS comme message",
    decline: "décline poliment",
  },
});

const LANGUAGES = Object.keys(LANGS);

let systemPrompt;

before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  await import("../src/config.js");
  ({ systemPrompt } = await import("../src/claude.js"));
});

function promptFor({ language = "de", mandate = null, consultPolling = false } = {}) {
  const now = new Date();
  return systemPrompt(
    seedCall({
      tenantId: BOOTSTRAP_TENANT_ID,
      language,
      direction: "outbound",
      mandate,
      status: "active",
      answeredAt: now.toISOString(),
      startedAt: now.toISOString(),
      consultPolledAtMs: consultPolling ? Date.now() : 0,
    }),
  );
}

const countOf = (text, needle) => text.split(needle).length - 1;
const hasBlock = (prompt, label) => prompt.split("\n").some((line) => line.startsWith(label));
const outOfScopeLine = (prompt, label) => {
  const start = prompt.indexOf(label);
  if (start === -1) return "";
  return prompt.slice(start, prompt.indexOf("\n", start));
};

test("WW-F1-1: ohne Mandat bleibt die Bestandszeile woertlich stehen (byte-identisch, alle Sprachen)", () => {
  for (const language of LANGUAGES) {
    const L = LANGS[language];
    const prompt = promptFor({ language });
    assert.ok(prompt.includes(L.legacy), `${language}: Bestandszeile veraendert`);
    assert.ok(
      !prompt.includes(L.withMandate),
      `${language}: Mandats-Variante rendert ohne Spielraum`,
    );
    assert.ok(!hasBlock(prompt, L.scopeLabel), `${language}: SPIELRAUM-Block ohne Mandat`);
  }
});

test("WW-F1-2: Mandat OHNE decide_freely - kein SPIELRAUM-Block, also weiter die Bestandszeile", () => {
  const mandates = [
    { fallback_order: "zuerst Donnerstag, sonst Freitag" },
    { on_out_of_scope: MANDATE_OUT_OF_SCOPE.TAKE_MESSAGE },
  ];
  for (const language of LANGUAGES) {
    const L = LANGS[language];
    for (const mandate of mandates) {
      const prompt = promptFor({ language, mandate });
      assert.ok(!hasBlock(prompt, L.scopeLabel), `${language}: SPIELRAUM-Block ohne decide_freely`);
      assert.ok(
        prompt.includes(L.legacy),
        `${language}: Bestandszeile fehlt (${JSON.stringify(mandate)})`,
      );
      assert.ok(!prompt.includes(L.withMandate), `${language}: Variante ohne SPIELRAUM-Block`);
    }
  }
});

test("WW-F1-3: INNERHALB des Spielraums - keine zusaetzliche Nachricht, beide Regeln sagen dasselbe", () => {
  for (const language of LANGUAGES) {
    const L = LANGS[language];
    const prompt = promptFor({ language, mandate: { decide_freely: SCOPE } });

    assert.ok(
      !prompt.includes(L.legacy),
      `${language}: die Zeile verlangt weiter unbedingt eine Nachricht`,
    );
    assert.ok(prompt.includes(L.withMandate), `${language}: Mandats-Variante fehlt`);
    assert.equal(
      countOf(prompt, L.noBookingCapability),
      1,
      `${language}: die Buchungs-Zeile steht nicht genau einmal`,
    );
    assert.ok(prompt.includes(L.scopeNoMessage), `${language}: scopeRules-Aussage fehlt`);
  }
});

test("WW-F1-4: AUSSERHALB geht nicht verloren - das Verweisziel rendert und nennt einen konkreten Weg", () => {
  const exits = [
    { on_out_of_scope: MANDATE_OUT_OF_SCOPE.TAKE_MESSAGE, marker: () => "take_message" },
    { on_out_of_scope: MANDATE_OUT_OF_SCOPE.ACCEPT_BEST, marker: () => "take_message" },
    { on_out_of_scope: MANDATE_OUT_OF_SCOPE.DECLINE, marker: (L) => L.decline },
  ];
  for (const language of LANGUAGES) {
    const L = LANGS[language];
    for (const exit of exits) {
      const prompt = promptFor({
        language,
        mandate: { decide_freely: SCOPE, on_out_of_scope: exit.on_out_of_scope },
      });
      assert.ok(
        prompt.includes(L.withMandate),
        `${language}/${exit.on_out_of_scope}: Variante fehlt`,
      );
      const line = outOfScopeLine(prompt, L.outOfScopeLabel);
      assert.ok(line, `${language}/${exit.on_out_of_scope}: Verweisziel rendert nicht`);
      assert.ok(
        line.includes(exit.marker(L)),
        `${language}/${exit.on_out_of_scope}: kein konkreter Weg im Verweisziel: ${line}`,
      );
    }
  }
});

test("WW-F1-5: mit get_consult im Zug nennt das Verweisziel die Rueckfrage - die Buchungs-Zeile bleibt gleich", () => {
  const mandate = { decide_freely: SCOPE, on_out_of_scope: MANDATE_OUT_OF_SCOPE.TAKE_MESSAGE };
  for (const language of LANGUAGES) {
    const L = LANGS[language];
    const prompt = promptFor({ language, mandate, consultPolling: true });
    assert.ok(prompt.includes(L.withMandate), `${language}: Variante haengt am Werkzeugsatz`);
    const line = outOfScopeLine(prompt, L.outOfScopeLabel);
    assert.ok(line.includes("get_consult"), `${language}: Rueckfrage-Weg fehlt im Verweisziel`);
  }
});

test("WW-F1-6: E1-Invariante - 'du buchst KEINE Termine fest' steht in BEIDEN Lagen", () => {
  for (const language of LANGUAGES) {
    const L = LANGS[language];
    for (const mandate of [null, { decide_freely: SCOPE }]) {
      const prompt = promptFor({ language, mandate });
      assert.ok(
        prompt.includes(L.noBookingCapability),
        `${language}: Buchungs-Verbot fehlt (mandate=${JSON.stringify(mandate)})`,
      );
    }
  }
});

test("WW-F1-7: Sprachreinheit - die Mandats-Variante mischt die Sprachen nicht", () => {
  for (const language of LANGUAGES) {
    const prompt = promptFor({ language, mandate: { decide_freely: SCOPE } });
    for (const other of LANGUAGES) {
      if (other === language) continue;
      assert.ok(
        !prompt.includes(LANGS[other].noBookingCapability),
        `${language}: enthaelt die ${other}-Buchungs-Zeile`,
      );
    }
  }
});
