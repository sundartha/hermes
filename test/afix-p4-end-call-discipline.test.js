// Phase afix-p4 (end_call-Disziplin, RCA-Wurzel R3): Das enge Verbot sitzt am Tool-
// Entscheidungspunkt - in der description des end_call-Tools (Lehre call-quality-chain).
// Ob die Formulierung das Modell tatsaechlich zur richtigen Entscheidung bewegt, ist per
// Unit-Test nicht zeigbar (kein echter Modell-Aufruf hier, nur ein statischer Mock) - dafuer
// gibt es das Bench-Szenario "kauderwelsch-erstantwort" (Check no_hangup_on_unintelligible_
// reply, scripts/convo-bench/), das den echten Live-Defekt gegen ein Modell nachstellt.
// Dieser Test prueft stattdessen die Abgrenzung zum bestehenden JS-Seam: genau der Fall,
// den die Prompt-Regel adressiert (substanzielles, aber unverstaendliches Kauderwelsch),
// wird von suppressEndCall NICHT gedeckt - die Prompt-Regel ist dort der einzige Schutz.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const CALL_KAUDERWELSCH = "call_afix_p4_kw";
const CALL_STILL = "call_afix_p4_still";
// Unverstaendliche, aber SUBSTANZIELLE Aeusserung (>= CALLER_SUBSTANCE_MIN_LEN=2) im
// Artefakt-Stil der RCA - genau deshalb greift suppressEndCall hier nicht.
const KAUDERWELSCH = "zonne dat wel eh nietig zo maar";

let nextResponse;
let agentTurn, store;

function message(content) {
  return {
    id: "msg_afix_p4",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}
const textPlusEndCall = (text) =>
  message([{ type: "text", text }, { type: "tool_use", id: "tu_end", name: "end_call", input: {} }]);

let server;
before(async () => {
  server = http.createServer((req, res) => {
    // Request-Body wird nicht ausgewertet (kein Test liest ihn) - nur konsumieren, damit
    // "end" feuert, und die per Test gesetzte nextResponse liefern.
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(nextResponse));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-afix-p4-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({
          id: CALL_KAUDERWELSCH,
          tenantId: BOOTSTRAP_TENANT_ID,
          direction: "outbound",
          goal: "Erfragen, ob es morgen regnet",
          transcript: [{ role: "agent", text: "Guten Tag." }],
        }),
        seedCall({
          id: CALL_STILL,
          tenantId: BOOTSTRAP_TENANT_ID,
          direction: "outbound",
          goal: "Erfragen, ob es morgen regnet",
          transcript: [{ role: "agent", text: "Guten Tag." }],
        }),
      ],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ agentTurn } = await import("../src/claude.js"));
});
after(async () => {
  await new Promise((r) => server.close(r));
});

// T-P4-2: Abgrenzung zum Seam - Kauderwelsch ist substanziell, suppressEndCall greift NICHT
// (die Prompt-Regel ist dort der einzige Schutz); an seiner echten Grenze (keine Aeusserung)
// greift der Seam unveraendert weiter.
test("T-P4-2 Kauderwelsch passiert suppressEndCall (Positiv), Stille wird weiter unterdrueckt (Negativ)", async () => {
  nextResponse = textPlusEndCall("Auf Wiederhoeren.");
  const withGibberish = await agentTurn(store.getCall(CALL_KAUDERWELSCH), KAUDERWELSCH);
  assert.equal(
    withGibberish.endCall,
    true,
    "Kauderwelsch ist substanziell -> der Seam gibt end_call frei; nur die Prompt-Regel schuetzt hier",
  );

  nextResponse = textPlusEndCall("Auf Wiederhoeren.");
  const withSilence = await agentTurn(store.getCall(CALL_STILL), null);
  assert.equal(withSilence.endCall, false, "ohne substanzielle Aeusserung bleibt suppressEndCall unveraendert wirksam");
});
