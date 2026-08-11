// WW-F2 (tasks/PLAN-WERKZEUGWAHL.md, W3): das Nachfassen - eine Runde, die eine Handlung
// nur ANKUENDIGT und kein Werkzeug aufruft, bekommt GENAU EINEN erzwungenen Nachfass-Zug.
// Gegenstand sind die sechs bindenden Bedingungen des Auftrags:
//   B1 kein zusaetzlicher Roundtrip, wenn nichts angekuendigt wurde (WW-F2-2/-3)
//   B2 harte Obergrenze: hoechstens EIN Nachfassen je Zug (WW-F2-4)
//   B3 keine Ueberkorrektur: ohne Ankuendigung kein erzwungener Werkzeugaufruf (WW-F2-2)
//   B4 sprachunabhaengig ueber alle drei Produktsprachen (WW-F2-8/-9)
//   B5 fail-closed: scheitert der Nachfass-Zug, endet der Zug mit dem Bestandstext (WW-F2-5)
//   B6 end_call ist im Nachfass-Zug NIE waehlbar (WW-F2-1)
//
// Naht wie test/al-p4-side-effect-tool-loop.test.js: lokaler node:http-Anthropic-Mock,
// ANTHROPIC_BASE_URL + DATA_DIR VOR dem ersten config-Import, danach dynamischer Import
// von src/store.js / src/claude.js. Kein Server-Spawn, kein Netz (P12/R).
//
// Testname-Praefix "WW-F2-" trifft KEIN Katalog-Praefix aus package.json
// config.i18nCatalogPattern - diese Tests laufen in `npm test`, wo Rot zaehlt (Lehre
// catalog-id-prefix-misroutes-tests).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall, makeConfigOverrides } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { LOCALES } from "../src/i18n/locales.js";
import { announcesToolAction, followUpToolsFor } from "../src/tool-follow-up.js";

const OWNER = "Jonas Beispiel";
// Die live gemessene Ankuendigungs-Form aus dem Fuenf-Arm-Experiment (Arm A0).
const ANNOUNCEMENT = "Ich gebe das an Jonas weiter.";
const NO_ANNOUNCEMENT = "Donnerstag um siebzehn Uhr passt gut.";
const HTTP_BAD_REQUEST = 400;
// Nicht klassifiziert -> gilt als informationsliefernd, der Loop laeuft weiter (AL-P4-6).
const UNCLASSIFIED_TOOL = "look_up_not_yet_built";
const LANGUAGES = ["de", "en", "fr"];

function message(content, stopReason) {
  return {
    id: "msg_wwf2",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

const textOnly = (text) => message([{ type: "text", text }], "end_turn");
const toolOnly = (name, input = {}) =>
  message([{ type: "tool_use", id: "tu1", name, input }], "tool_use");
// Faellt die queue leer, antwortet der Mock mit einem MARKIERTEN Text - ein ungewollter
// Zusatz-Roundtrip faellt damit in bodies.length UND im speech auf.
const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";
// Sentinel der queue: diese Runde antwortet mit einem harten 4xx (kein Retry, kein
// Breaker-Ausschlag) - so scheitert GENAU der Nachfass-Zug.
const PROVIDER_REFUSES = Symbol("provider-refuses");

let server;
let queue = [];
let bodies = [];

let store, agentTurn, config, withConfig;
before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      const next = queue.shift();
      res.setHeader("content-type", "application/json");
      if (next === PROVIDER_REFUSES) {
        res.statusCode = HTTP_BAD_REQUEST;
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error" } }));
        return;
      }
      res.end(JSON.stringify(next || textOnly(UNWANTED_EXTRA_ROUNDTRIP_MARKER)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-wwf2-key";
  process.env.TOOL_FOLLOW_UP_ENABLED = "true";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: Array.from({ length: 6 }, (_, i) =>
        seedCall({ id: `call_wwf2_${i + 1}`, direction: "outbound", language: "de" }),
      ),
    }),
  );
  ({ config } = await import("../src/config.js"));
  ({ withConfig } = makeConfigOverrides(config));
  store = await import("../src/store.js");
  ({ agentTurn } = await import("../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("WW-F2-1 (a) angekuendigte Handlung ohne Werkzeug -> EIN erzwungener Nachfass-Zug fuehrt sie aus, ohne end_call", async () => {
  bodies = [];
  queue = [textOnly(ANNOUNCEMENT), toolOnly("take_message", { message: "Rueckruf gewuenscht" })];
  const call = store.getCall("call_wwf2_1");
  const turn = await agentTurn(call, "Kann Jonas das bestaetigen?");

  assert.equal(bodies.length, 2, "genau ein zusaetzlicher Roundtrip");
  assert.equal(turn.roundtrips, 2);
  assert.deepEqual(turn.toolNames, ["take_message"], "die angekuendigte Handlung ist ausgefuehrt");
  assert.equal(
    store.getCall("call_wwf2_1").actionItemIds.length,
    1,
    "der Seiteneffekt ist wirklich passiert - nicht nur angefordert",
  );

  // Der Draht der ERSTEN Runde bleibt byte-identisch zum Bestand (B1).
  assert.equal("tool_choice" in bodies[0], false, "Runde 1 traegt kein tool_choice");
  // Der Nachfass-Zug erzwingt eine Wahl - und end_call ist nicht darunter (B6).
  assert.deepEqual(bodies[1].tool_choice, { type: "any" });
  assert.deepEqual(
    bodies[1].tools.map((t) => t.name),
    ["take_message"],
  );
  // Die eigene Aeusserung steht in der Kette, der Steuertext haelt sie auf einem user-Turn.
  assert.deepEqual(bodies[1].messages.at(-1), {
    role: "user",
    content: LOCALES.de.prompt.followUp.nudge,
  });
  assert.equal(bodies[1].messages.at(-2).role, "assistant");
});

test("WW-F2-2 (b) Lage OHNE angekuendigte Handlung -> kein Nachfassen, kein Zusatz-Roundtrip, kein erzwungenes Werkzeug", async () => {
  bodies = [];
  queue = [textOnly(NO_ANNOUNCEMENT)];
  const call = store.getCall("call_wwf2_2");
  const turn = await agentTurn(call, "Donnerstag um fuenf haetten wir frei.");

  assert.equal(bodies.length, 1, "so schnell wie heute - genau ein Modellaufruf");
  assert.equal(turn.roundtrips, 1);
  assert.deepEqual(turn.toolNames, [], "keine Ueberkorrektur: nichts wurde erzwungen");
  assert.equal("tool_choice" in bodies[0], false);
  assert.equal(turn.speech, NO_ANNOUNCEMENT);
});

test("WW-F2-3 Flag AUS = Bestand: dieselbe Ankuendigung loest nichts aus", async () => {
  bodies = [];
  queue = [textOnly(ANNOUNCEMENT)];
  const call = store.getCall("call_wwf2_3");
  const turn = await withConfig("toolFollowUpEnabled", false, () =>
    agentTurn(call, "Kann Jonas das bestaetigen?"),
  );

  assert.equal(bodies.length, 1);
  assert.equal(turn.roundtrips, 1);
  assert.equal("tool_choice" in bodies[0], false);
});

test("WW-F2-4 (c) Obergrenze B2: zweimal Nachfassen ist unmoeglich - auch wenn der Nachfass-Zug wieder nur redet", async () => {
  bodies = [];
  // Beide Runden liefern denselben ankuendigenden Text ohne Werkzeug. Waere die Obergrenze
  // nicht strukturell, liefe die Schleife bis MAX_TOOL_ROUNDS_PER_TURN durch.
  queue = [textOnly(ANNOUNCEMENT), textOnly(ANNOUNCEMENT)];
  const call = store.getCall("call_wwf2_4");
  const turn = await agentTurn(call, "Kann Jonas das bestaetigen?");

  assert.equal(bodies.length, 2, "hoechstens EIN Nachfassen je Zug");
  assert.equal(turn.roundtrips, 2);
  assert.equal(
    bodies.filter((b) => "tool_choice" in b).length,
    1,
    "genau eine erzwungene Runde im ganzen Zug",
  );
  assert.equal(turn.speech, ANNOUNCEMENT, "der Zug endet mit der Textantwort, nicht in Stille");
});

test("WW-F2-5 (B5) scheitert der Nachfass-Zug, endet der Zug mit dem Bestandstext statt zu werfen", async () => {
  bodies = [];
  queue = [textOnly(ANNOUNCEMENT), PROVIDER_REFUSES];
  const call = store.getCall("call_wwf2_5");
  const turn = await agentTurn(call, "Kann Jonas das bestaetigen?");

  assert.equal(bodies.length, 2, "der Nachfass-Zug wurde versucht");
  assert.equal(turn.speech, ANNOUNCEMENT, "gesprochen wird der Text der Vorrunde - nie Stille");
  assert.equal(turn.endCall, false);
  assert.deepEqual(turn.toolNames, []);
});

test("WW-F2-6 der Nachfass-Zug loest sich NICHT selbst aus: nach ihm laeuft die Schleife regulaer weiter", async () => {
  bodies = [];
  // Der Nachfass-Zug fordert ein INFORMATIONSLIEFERNDES (hier: unklassifiziertes) Werkzeug
  // an - der Bestandspfad legt danach eine dritte Runde nach (AL-P4-6). Genau dort faellt
  // ein klebriger Zwang auf: Runde 3 muss wieder der volle, freie Bestandssatz sein.
  queue = [textOnly(ANNOUNCEMENT), toolOnly(UNCLASSIFIED_TOOL), textOnly("Alles klar.")];
  const call = store.getCall("call_wwf2_6");
  const turn = await agentTurn(call, "Kann Jonas das bestaetigen?");

  assert.equal(bodies.length, 3);
  assert.equal(turn.roundtrips, 3);
  assert.equal(
    bodies.filter((b) => "tool_choice" in b).length,
    1,
    "nur die Nachfass-Runde war erzwungen",
  );
  assert.ok(
    bodies[2].tools.some((t) => t.name === "end_call"),
    "Runde 3 ist wieder der volle, freie Bestandssatz",
  );
});

// ---------- reine Entscheidungs-Tests (ohne Modell, ohne Netz) ----------

test("WW-F2-7 followUpToolsFor: jede einzelne Bedingung ist fail-closed", () => {
  const tools = [{ name: "take_message" }];
  const base = {
    enabled: true,
    alreadyUsed: false,
    text: ANNOUNCEMENT,
    language: "de",
    candidateTools: tools,
  };
  assert.deepEqual(followUpToolsFor(base), tools, "Gutfall");
  assert.equal(followUpToolsFor({ ...base, enabled: false }), null, "Flag aus");
  assert.equal(followUpToolsFor({ ...base, alreadyUsed: true }), null, "Obergrenze B2");
  assert.equal(followUpToolsFor({ ...base, candidateTools: [] }), null, "nichts zu erzwingen");
  assert.equal(followUpToolsFor({ ...base, text: NO_ANNOUNCEMENT }), null, "keine Ankuendigung");
  assert.equal(followUpToolsFor({ ...base, text: "" }), null, "kein Text");
});

test("WW-F2-8 (B4) die Erkennung traegt in allen drei Produktsprachen - je ein Treffer und ein Nicht-Treffer", () => {
  const cases = {
    de: {
      // Beide live gemessenen Formen, dazu die transliterierte Schreibweise.
      hits: [
        "Ich gebe das an Jonas weiter.",
        "Da müsste ich Rücksprache halten, ob Jonas das akzeptiert.",
        "Da muesste ich Ruecksprache halten.",
      ],
      misses: ["Donnerstag um siebzehn Uhr passt gut.", "Guten Tag, ich rufe im Auftrag an."],
    },
    en: {
      hits: ["I will pass it on to Jonas.", "Let me check with Jonas first."],
      misses: ["Thursday at five works fine.", "I look forward to hearing from you."],
    },
    fr: {
      hits: ["Je vais en parler à Jonas.", "Je transmets la demande."],
      misses: ["Jeudi dix-sept heures, cela convient.", "Bonjour, j'appelle pour un rendez-vous."],
    },
  };
  for (const lang of LANGUAGES) {
    for (const hit of cases[lang].hits)
      assert.equal(announcesToolAction(hit, lang), true, `${lang}: nicht erkannt - ${hit}`);
    for (const miss of cases[lang].misses)
      assert.equal(announcesToolAction(miss, lang), false, `${lang}: falsch erkannt - ${miss}`);
  }
});

test("WW-F2-9 Sprach-Paritaet: markers und nudge existieren in jeder Sprache, der Steuertext nennt KEIN Werkzeug", () => {
  const TOOL_NAMES = ["end_call", "take_message", "get_consult", "look_up"];
  for (const lang of LANGUAGES) {
    const followUp = LOCALES[lang].prompt.followUp;
    // WW-F4: die Marker liegen nach Zielwerkzeug partitioniert vor - fuer die Form-Zusage
    // dieses Tests zaehlt die Vereinigung, genau wie fuer announcesToolAction.
    const markers = [...followUp.consultMarkers, ...followUp.messageMarkers];
    assert.ok(markers.length > 0, `${lang}: markers`);
    for (const parts of markers)
      assert.ok(
        Array.isArray(parts) && parts.length > 0 && parts.every((p) => typeof p === "string" && p),
        `${lang}: ein Marker ist keine nicht-leere Teile-Liste`,
      );
    assert.equal(typeof followUp.nudge, "string");
    assert.ok(
      followUp.nudge.startsWith("[") && followUp.nudge.endsWith("]"),
      `${lang}: kein Steuertext`,
    );
    // Ein Steuertext, der ein Werkzeug beim Namen nennt, zeigt in dem Zug, in dem es nicht
    // angeboten ist, ins Leere - genau die Prompt-Asymmetrie aus W2.
    for (const name of TOOL_NAMES)
      assert.equal(followUp.nudge.includes(name), false, `${lang}: nudge nennt ${name}`);
  }
});
