// AL-P6: der Tool-Loop in agentTurn fragt VOR JEDER Runde zwei Achsen ab -
//   GELD ab der ERSTEN Runde (Regel 1: ein erschoepfter Cap darf keinen Token mehr kosten;
//        bookTokenUsage laeuft in JEDER Runde, geprueft wurde bisher hoechstens EINMAL vor
//        dem Turn - im /voice/turn-Pfad gar nicht),
//   ZEIT ab der ZWEITEN (die erste laeuft immer, damit eine zu knapp konfigurierte Frist
//        den Agenten nie stumm schaltet).
// Testnamen tragen bewusst KEINE Katalog-ID (AL- matcht i18nCatalogPattern nicht) - sie
// landen im Regressionslauf, wo Rot wirklich Rot heisst.
//
// Naht wie test/al-p4-side-effect-tool-loop.test.js: lokaler node:http-Anthropic-Mock,
// ANTHROPIC_BASE_URL + DATA_DIR VOR dem ersten config-Import, danach dynamischer Import
// von src/store.js / src/claude.js. Kein Server-Spawn, kein Netz (P12/R). Die vier
// Zeit-/Geld-Env-Werte sind hier explizit gepinnt - sonst leckt eine lokale .env herein
// (Lehre test-base-env-drift).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { MAX_TOOL_ROUNDS_PER_TURN } from "../src/turn-budget.js";
import { localeFor } from "../src/i18n/locales.js";

const HALLUCINATED_TOOL = "look_up_not_yet_built"; // nicht klassifiziert -> Loop laeuft weiter
const CALLER_TEXT = "Ja, Donnerstag passt gut";

// Zeitachse dieser Datei: Frist = 15000 (Hardcut) - 10000 (Synthese) - 1500 (Netzreserve)
// = 3500 ms; eine weitere Runde braucht elapsed + 2000 (ein llm-Versuch) <= 3500, also
// elapsed <= 1500 ms. MOCK_DELAY_MS liegt bewusst UNTER dem Versuchs-Timeout (kein
// kuenstlicher LLM-Timeout) und ueber der halben Restfrist - zwei verzoegerte Runden
// reissen die Frist damit sicher, eine nicht.
const SYNTH_TIMEOUT_MS = 10_000;
const LLM_TIMEOUT_MS = 2000;
const MOCK_DELAY_MS = 1000;

// Geldachse: Haiku kostet 1,0 USD je Million Input-Token; mal usdToEur (0,92) sind
// 2 Mio. Token rund 184 ct und 50 Mio. rund 4600 ct. Die kleine Menge reisst nur einen
// eng gesetzten TENANT-Cap, die grosse zusaetzlich den Plattform-Cap (MAX_BUDGET_EUR=30
// = 3000 ct).
const TOKENS_OVER_TENANT_CAP = 2_000_000;
const TOKENS_OVER_LARGE_TENANT_CAP = 4_000_000;
const TOKENS_OVER_PLATFORM_CAP = 50_000_000;
const SMALL_USAGE = { input_tokens: 10, output_tokens: 5 };

function message(content, usage) {
  return {
    id: "msg_alp6",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage,
  };
}

// Werkzeug OHNE begleitenden Text: weder der AL-P4-Ausstieg noch end_call greifen, der
// Loop wuerde also bis MAX_TOOL_ROUNDS_PER_TURN weiterlaufen - genau das braucht diese
// Phase als Messstrecke.
const toolRound = (usage = SMALL_USAGE) =>
  message([{ type: "tool_use", id: "tu1", name: HALLUCINATED_TOOL, input: {} }], usage);

const fatToolRound = (inputTokens) => toolRound({ input_tokens: inputTokens, output_tokens: 5 });

let server;
let queue = [];
let bodies = [];
let delayMs = 0;

let store, agentTurn;

// Faengt die UNCONDITIONAL-Abbruchzeile ab (console.warn, wie alle Gate-Logs des Repos).
// Liefert { result, lines } - so bleibt Build/Operate/Check lesbar (P13).
async function withTurnStopLog(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    const result = await fn();
    return { result, lines: lines.filter((l) => l.startsWith("[turn] abbruch")) };
  } finally {
    console.warn = original;
  }
}

// Setzt den harten Tenant-Cap relativ zum BEREITS gebuchten Verbrauch. Die Tests teilen
// einen Store, der Verbrauch waechst also ueber die Datei hinweg - ein absoluter Cap waere
// von der Ausfuehrungsreihenfolge abhaengig (P12 Independent).
function capWithHeadroom(headroomCents) {
  const capCents = store.usageOf(BOOTSTRAP_TENANT_ID).costCents + headroomCents;
  store.setTenantBudget(BOOTSTRAP_TENANT_ID, { budgetCents: capCents, hardCapCents: capCents });
  return capCents;
}

before(async () => {
  server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      bodies.push(true);
      const payload = JSON.stringify(queue.shift() || toolRound());
      const respond = () => {
        res.setHeader("content-type", "application/json");
        res.end(payload);
      };
      if (delayMs) setTimeout(respond, delayMs);
      else respond();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-alp6-key";
  process.env.ELEVENLABS_SYNTH_TIMEOUT_MS = String(SYNTH_TIMEOUT_MS);
  process.env.LLM_REQUEST_TIMEOUT_MS = String(LLM_TIMEOUT_MS);
  process.env.LLM_MAX_RETRIES = "2";
  process.env.LLM_BACKOFF_MS = "1";
  process.env.MAX_BUDGET_EUR = "30";
  process.env.DEFAULT_TENANT_BUDGET_CENTS = "1500";
  process.env.PAYMENT_ENABLED = "false";
  process.env.BUDGET_MONTH_ENABLED = "false";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [1, 2, 3, 4, 5, 6].map((n) =>
        seedCall({ id: `call_alp6_${n}`, direction: "outbound", language: "de" }),
      ),
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ agentTurn } = await import("../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("AL-P6-1: die Frist beendet den Tool-Loop vor der letzten Runde", async () => {
  bodies = [];
  delayMs = MOCK_DELAY_MS;
  queue = [toolRound(), toolRound(), toolRound(), toolRound()];
  const call = store.getCall("call_alp6_1");

  const { result: turn, lines } = await withTurnStopLog(() => agentTurn(call, CALLER_TEXT));

  assert.ok(bodies.length >= 1, "die erste Runde laeuft immer");
  assert.ok(
    bodies.length < MAX_TOOL_ROUNDS_PER_TURN,
    `die Frist muss vor der letzten Runde greifen, Runden: ${bodies.length}`,
  );
  assert.equal(turn.stopReason, "deadline");
  assert.ok(turn.speech, "speech faellt auf den Locale-Satz zurueck, nie leer");
  assert.equal(lines.length, 1, `genau eine Abbruchzeile, erhalten: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /\[turn\] abbruch grund=deadline call=call_alp6_1 runden=\d+/);
});

test("AL-P6-2: normale Latenz bindet die Frist nicht", async () => {
  bodies = [];
  delayMs = 0;
  queue = [toolRound(), toolRound(), toolRound(), toolRound()];
  const call = store.getCall("call_alp6_2");

  const turn = await agentTurn(call, CALLER_TEXT);

  assert.equal(bodies.length, MAX_TOOL_ROUNDS_PER_TURN);
  assert.equal(turn.stopReason, null);
});

test("AL-P6-3: ein mitten im Turn erschoepfter Tenant-Cap verhindert die naechste Runde", async () => {
  bodies = [];
  delayMs = 0;
  capWithHeadroom(100);
  queue = [toolRound(), fatToolRound(TOKENS_OVER_TENANT_CAP), toolRound(), toolRound()];
  const call = store.getCall("call_alp6_3");
  const before = store.usageOf(BOOTSTRAP_TENANT_ID).inputTokens;

  const { result: turn, lines } = await withTurnStopLog(() => agentTurn(call, CALLER_TEXT));

  assert.equal(bodies.length, 2, "keine dritte Runde");
  assert.equal(turn.stopReason, "budget_tenant");
  assert.equal(
    store.usageOf(BOOTSTRAP_TENANT_ID).inputTokens - before,
    SMALL_USAGE.input_tokens + TOKENS_OVER_TENANT_CAP,
    "genau zwei Buchungen im Usage-Bucket",
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /grund=budget_tenant/);
});

test("AL-P6-4: ein bereits erschoepfter Cap laesst nicht einmal die erste Runde zu", async () => {
  bodies = [];
  delayMs = 0;
  capWithHeadroom(0); // Verbrauch >= Cap -> gesperrt (budgetExceeded prueft >=)
  queue = [toolRound()];
  const call = store.getCall("call_alp6_4");

  const turn = await agentTurn(call, CALLER_TEXT);

  assert.equal(bodies.length, 0, "kein einziger Anthropic-Request");
  assert.equal(turn.stopReason, "budget_tenant");
  assert.equal(turn.speech, localeFor("de").turnFallbackSpeech.outbound);
  const transcript = store.getCall("call_alp6_4").transcript;
  assert.equal(transcript[transcript.length - 1].role, "agent");
});

test("AL-P6-5: Geld schlaegt Zeit - bei beiden Gruenden gewinnt die Budget-Achse", async () => {
  bodies = [];
  delayMs = MOCK_DELAY_MS; // zwei verzoegerte Runden reissen zusaetzlich die Frist
  capWithHeadroom(300);
  queue = [toolRound(), fatToolRound(TOKENS_OVER_LARGE_TENANT_CAP), toolRound(), toolRound()];
  const call = store.getCall("call_alp6_5");

  const turn = await agentTurn(call, CALLER_TEXT);

  assert.equal(bodies.length, 2);
  assert.equal(
    turn.stopReason,
    "budget_tenant",
    "der Aufrufer muss auflegen (Geld), nicht weitersprechen (Zeit)",
  );
});

// ZULETZT: dieser Test erschoepft den PLATTFORM-Topf (lebenszeit-skaliert, prozessweit) -
// jeder danach laufende Turn dieser Datei wuerde budget_global sehen.
test("AL-P6-6: der Plattform-Notaus sperrt den Loop auch bei freiem Tenant-Cap", async () => {
  bodies = [];
  delayMs = 0;
  const roomyCap = 1_000_000;
  store.setTenantBudget(BOOTSTRAP_TENANT_ID, { budgetCents: roomyCap, hardCapCents: roomyCap });
  queue = [toolRound(), fatToolRound(TOKENS_OVER_PLATFORM_CAP), toolRound(), toolRound()];
  const call = store.getCall("call_alp6_6");

  const turn = await agentTurn(call, CALLER_TEXT);

  assert.equal(bodies.length, 2);
  assert.equal(turn.stopReason, "budget_global");
});
