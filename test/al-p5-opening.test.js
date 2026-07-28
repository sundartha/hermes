// AL-P5 (PLAN-ASSISTANT-LEAP.md, Phase 5): die Eroeffnung ist gekuerzt. Diese Datei haelt
// die Zusagen fest, die OHNE echten Anruf entscheidbar sind:
// (1) die Kappe beisst in allen drei Sprachen, in BEIDEN bridgePhrase-Zweigen (Bruecken-
//     Auftraege UND der Ich-/Je-/I-Passthrough-Shape aus place_call.objective, s.
//     src/mcp-tools.js) UND der Erst-Turn benennt den Zweck des Anrufs weiterhin
//     (Plan-Abnahme 3) - die Abnahme am Telefon steht in tasks/al-testcall-checklist.md;
// (2) die Bench-Schwelle BENCH_MAX_OPENING_CHARS bleibt rechnerisch an die Kappe
//     gekoppelt: wird OPENING_GOAL_MAX_CHARS (src/claude.js) veraendert, ohne die
//     Schwelle nachzuziehen, faellt genau dieser Test - die Zahl kann nicht stumm rotten.
// Der Offenlegungssatz wird hier NICHT gepinnt (das tun disclosure-regression/f1-i18n) -
// er ist unveraendert, Regel 2.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  tempDataDir,
  seedState,
  seedCall,
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_LAST_NAME,
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { BENCH_MAX_OPENING_CHARS } from "../scripts/convo-bench/checks.mjs";
import { SCENARIOS, SCENARIO_IDS } from "../scripts/convo-bench/scenarios/index.mjs";

const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`; // == Bench-Owner (runner.mjs)
const OUTBOUND = "outbound";
// Ein Ziel OHNE Leerzeichen laeuft in den "keine Wortgrenze"-Zweig von trimGoalForSpeech
// und wird auf EXAKT die Kappe geschnitten -> die laengstmoegliche Eroeffnung.
const GOAL_WITHOUT_WORD_BOUNDARY = "a".repeat(200);

let openingText, disclosureSentence;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  await import("../src/config.js");
  ({ openingText, disclosureSentence } = await import("../src/claude.js"));
});

const outboundCall = (over = {}) =>
  seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: OUTBOUND, ...over });

// Reale Auftraege an der Schnittgrenze, je Sprache. mustContain = die Woerter, an denen
// ein Mensch den ZWECK erkennt (das tragende Verb/Objekt, NICHT irgendein ueberlebendes
// Praefix-Wort) - sie muessen die Kappe ueberleben. Deckt BEIDE bridgePhrase-Zweige ab
// (src/i18n/locales.js): Imperativ-/Infinitiv-Auftraege bekommen die Bruecke ("Es geht
// um Folgendes: ..."), Ich-/Je-/I-Auftraege (der von place_call.objective mandatierte
// Ich-Satz-Shape, s. src/mcp-tools.js) laufen OHNE Bruecke woertlich durch - beide Zweige
// muessen den Zweck ueberleben lassen (AL-P5-Review-Runde 1).
const BOUNDARY_GOALS = Object.freeze([
  {
    language: "de",
    goal: "Naechsten freien Termin fuer einen Herrenhaarschnitt bei Petra vereinbaren wenn moeglich",
    mustContain: ["Termin", "Herrenhaarschnitt", "vereinbaren"],
  },
  {
    language: "de",
    goal: "Klaeren, ob der Vertrag zum naechsten Monat gekuendigt werden kann und was das kostet",
    mustContain: ["Vertrag", "gekuendigt"],
  },
  {
    language: "fr",
    goal: "Demander si une table pour deux personnes est libre samedi soir vers dix-neuf heures",
    mustContain: ["table pour deux personnes", "libre"],
  },
  {
    language: "en",
    goal: "Ask whether the spare part for the dishwasher has arrived and when it can be collected",
    mustContain: ["spare part", "arrived"],
  },
  // Ich-/Je-/I-Passthrough-Zweig (keine Bruecke, woertlicher Ich-Satz-Shape).
  {
    language: "de",
    goal: "Ich moechte wissen, ob der Vertrag zum naechsten Monat gekuendigt werden kann und was das kostet",
    mustContain: ["Vertrag", "gekuendigt"],
  },
  {
    language: "fr",
    goal: "Je voudrais reserver une table pour deux personnes samedi soir vers dix-neuf heures",
    mustContain: ["reserver", "table pour deux personnes"],
  },
  {
    language: "en",
    goal: "I would like to ask whether the spare part for the dishwasher has arrived yet or is still delayed",
    mustContain: ["spare part", "arrived"],
  },
]);

test("AL-P5-1 gekappte Eroeffnung benennt in de/fr/en weiter den Zweck des Anrufs", () => {
  for (const { language, goal, mustContain } of BOUNDARY_GOALS) {
    const call = outboundCall({ language, goal });
    const text = openingText(call);
    assert.ok(
      text.startsWith(disclosureSentence(call)),
      `${language}: Offenlegung muss der erste Satz bleiben (Regel 2): ${text}`,
    );
    assert.ok(
      !text.includes(goal),
      `${language}: die Kappe muss beissen (Auftrag laenger als die Kappe): ${text}`,
    );
    for (const fragment of mustContain) {
      assert.ok(text.includes(fragment), `${language}: Zweck-Wort "${fragment}" fehlt: ${text}`);
    }
    assert.ok(!/[.!?]{2}/.test(text), `${language}: doppeltes Satz-Endzeichen: ${text}`);
    assert.ok(text.endsWith("."), `${language}: Eroeffnung endet nicht auf genau einem Punkt: ${text}`);
  }
});

test("AL-P5-2 laengstmoegliche DE-Eroeffnung == BENCH_MAX_OPENING_CHARS (Kopplung Kappe <-> Bench-Schwelle)", () => {
  const text = openingText(outboundCall({ language: "de", goal: GOAL_WITHOUT_WORD_BOUNDARY }));
  // Gleichheit statt <=: der Test schlaegt in BEIDE Richtungen an (Kappe hoch ODER runter).
  assert.equal(
    text.length,
    BENCH_MAX_OPENING_CHARS,
    "OPENING_GOAL_MAX_CHARS (src/claude.js) und BENCH_MAX_OPENING_CHARS (convo-bench/checks.mjs) sind auseinandergelaufen",
  );
});

test("AL-P5-3 jedes outbound-Bench-Szenario deklariert die Eroeffnungs-Schwelle, das inbound-Szenario nicht", () => {
  for (const id of SCENARIO_IDS) {
    const scenario = SCENARIOS[id];
    if (scenario.direction === OUTBOUND) {
      assert.equal(scenario.maxOpeningChars, BENCH_MAX_OPENING_CHARS, `${id}: Schwelle fehlt/abweichend`);
    } else {
      // Inbound hat weder Offenlegung noch Bruecke - der n/a-Pfad des Checks bleibt.
      assert.ok(!("maxOpeningChars" in scenario), `${id}: inbound darf keine Eroeffnungs-Schwelle tragen`);
    }
  }
});
