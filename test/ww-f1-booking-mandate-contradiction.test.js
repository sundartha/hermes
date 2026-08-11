// WW-F1 (tasks/PLAN-WERKZEUGWAHL.md, Befund tasks/befund-toolwahl-7-szenariopruefung.md
// Abschnitt 2): der Selbstwiderspruch im System-Prompt. Zwei Bloecke gaben fuer DENSELBEN
// Fall gegenteilige Anweisungen, und beide rendern in derselben Anfrage:
//
//   boundaries.noBooking (unbedingt): "Einen Terminwunsch nimmst du mit allen Angaben
//                                      als Nachricht auf."
//   mandate.scopeRules (im SPIELRAUM): "... und gibst es NICHT als Nachricht weiter."
//
// Gepinnt werden BEIDE Richtungen, in allen drei Sprachen:
//   (1) INNERHALB des Spielraums -> keine zusaetzliche Nachricht; die Buchungs-Zeile
//       und der SPIELRAUM-Block sagen dasselbe.
//   (2) AUSSERHALB -> der Wunsch geht NICHT verloren: die Buchungs-Zeile verweist auf
//       den AUSSERHALB-Block, der bei gesetztem decide_freely IMMER mitrendert und dort
//       seinen konkreten Weg nennt (Rueckfrage, Nachricht, Ablehnung, Bestes annehmen).
//       Ein Verweis auf einen fehlenden Block waere schlimmer als der alte Widerspruch.
//
// Naht wie test/ww-p3-consult-prompt-routing.test.js: rein in-process, kein Server-Spawn,
// kein Netz; der Call-Datensatz wird nicht persistiert.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (package.json
// config.i18nCatalogPattern) - Praefix ist "WW-F1-<n>:".
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, MANDATE_OUT_OF_SCOPE } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const SCOPE = "Termin an einem Werktag zwischen 9 und 12 Uhr, bis 60 Euro";

// Wortlaute bewusst als Literal und NICHT aus LOCALES gelesen: ein Test, der seine
// Erwartung aus derselben Quelle zieht wie der Code, bemerkt eine Umformulierung dieser
// Quelle nicht - und genau davor schuetzen die Pins hier.
const LANGS = Object.freeze({
  de: {
    // Bestandszeile (ohne Spielraum) - der unbedingte Nachricht-Zwang.
    legacy:
      "- Du buchst KEINE Termine fest. Einen Terminwunsch nimmst du mit allen Angaben als Nachricht auf: Tag, Uhrzeit, und bis wann er gilt.",
    withMandate:
      "- Du buchst KEINE Termine fest. Einen Terminwunsch, den dein SPIELRAUM abdeckt, sagst du selbst zu und gibst ihn NICHT zusätzlich als Nachricht weiter. Für jeden anderen Terminwunsch gilt, was unter AUSSERHALB DEINES SPIELRAUMS steht.",
    // E1 (Owner-Entscheidung): die Faehigkeits-Aussage steht in BEIDEN Lagen.
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
  // Der Bootstrap-Tenant traegt allowConsult (OWNER_PROFILE); die Feature-Schalter
  // muessen dazukommen, sonst laesst sich die Consult-Achse nicht anschalten.
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  await import("../src/config.js");
  ({ systemPrompt } = await import("../src/claude.js"));
});

// consultPolledAtMs = jetzt -> ein MCP-Client wartet -> get_consult steht im Zug.
// Fehlt der Poll, faellt consultAvailableFor fail-closed auf false.
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
// Zeilenanfang statt includes: "YOUR LEEWAY:" ist ein Teilstring von "OUTSIDE YOUR
// LEEWAY:" (ebenso im FR), ein includes-Treffer wuerde den falschen Block melden.
const hasBlock = (prompt, label) => prompt.split("\n").some((line) => line.startsWith(label));
// Die Zeile des AUSSERHALB-Blocks, in der sein Weg steht (Label + Satz stehen in
// derselben Zeile, s. claude.js mandateSection).
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
    // Ohne Spielraum darf die Zeile auch nicht auf einen Block verweisen, den es nicht
    // gibt - die Gegenprobe zum Verweis in WW-F1-4.
    assert.ok(!hasBlock(prompt, L.scopeLabel), `${language}: SPIELRAUM-Block ohne Mandat`);
  }
});

test("WW-F1-2: Mandat OHNE decide_freely - kein SPIELRAUM-Block, also weiter die Bestandszeile", () => {
  // Nur fallback_order bzw. nur on_out_of_scope: mandateSection rendert den
  // SPIELRAUM-Block nicht, es gibt nichts zu widersprechen. Eine Variante, die auf
  // "deinen SPIELRAUM" zeigt, waere hier ein Verweis ins Leere.
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

    // Der unbedingte Nachricht-Zwang ist weg ...
    assert.ok(
      !prompt.includes(L.legacy),
      `${language}: die Zeile verlangt weiter unbedingt eine Nachricht`,
    );
    // ... und durch die fallunterscheidende Variante ersetzt.
    assert.ok(prompt.includes(L.withMandate), `${language}: Mandats-Variante fehlt`);
    assert.equal(
      countOf(prompt, L.noBookingCapability),
      1,
      `${language}: die Buchungs-Zeile steht nicht genau einmal`,
    );
    // Der SPIELRAUM-Block steht unveraendert daneben - jetzt ohne Gegenrede.
    assert.ok(prompt.includes(L.scopeNoMessage), `${language}: scopeRules-Aussage fehlt`);
  }
});

test("WW-F1-4: AUSSERHALB geht nicht verloren - das Verweisziel rendert und nennt einen konkreten Weg", () => {
  // Fuer JEDEN Ausgang: der Block, auf den die Buchungs-Zeile verweist, steht im selben
  // Prompt und sagt konkret, was zu tun ist. Genau hier laege der Schaden, waere die
  // Aufloesung falsch: ein ausserhalb liegender Terminwunsch ohne Weg verschwindet
  // spurlos - schlimmer als das Doppelfeuern, das die Phase behebt.
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
  // Die Buchungs-Zeile haengt am SPIELRAUM, nicht am Werkzeugsatz: sie verweist auf den
  // AUSSERHALB-Block, und DER nennt den heute richtigen Weg (WW-P3).
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
