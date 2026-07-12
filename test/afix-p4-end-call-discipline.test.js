// Phase afix-p4 (end_call-Disziplin, RCA-Wurzel R3): Das enge Verbot sitzt am Tool-
// Entscheidungspunkt - in der description des end_call-Tools (Lehre call-quality-chain).
// Geprueft wird (i) dass die Regel bis in den TATSAECHLICH gesendeten Anthropic-Request
// durchschlaegt (Wire-Ebene, nicht String-in-String) und (ii) dass genau der Fall, den sie
// adressiert (substanzielles, aber unverstaendliches Kauderwelsch), vom bestehenden
// suppressEndCall-Seam NICHT gedeckt ist - die Prompt-Regel ist dort der einzige Schutz.
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
let requests = [];
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
const textOnly = (text) => message([{ type: "text", text }]);
const textPlusEndCall = (text) =>
  message([{ type: "text", text }, { type: "tool_use", id: "tu_end", name: "end_call", input: {} }]);

let server;
before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push(JSON.parse(body));
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

// T-P4-1: Wire-Ebene - die Disziplin-Regel erreicht das Modell im echten Turn-Request.
test("T-P4-1 end_call-Tool-Description traegt Verabschiedung UND Verstaendnis-Bedingung und geht so ans Modell", async () => {
  requests = [];
  nextResponse = textOnly("Alles klar.");
  await agentTurn(store.getCall(CALL_KAUDERWELSCH), "Guten Tag, worum geht es?");
  const endCallTool = requests[0].tools.find((t) => t.name === "end_call");
  assert.ok(endCallTool, "end_call-Tool fehlt im gesendeten Request");
  assert.match(
    endCallTool.description,
    /NACHDEM du dich verabschiedet hast/,
    "(a) Verabschiedung-vor-end_call fehlt",
  );
  assert.match(
    endCallTool.description,
    /verstanden hast/,
    "(b) Verstaendnis-Bedingung fehlt am Tool-Entscheidungspunkt",
  );
  assert.match(endCallTool.description, /GENAU EINMAL nach/, "(b) EINE Nachfrage statt Auflegen fehlt");
});

// T-P4-2: Abgrenzung zum Seam - Kauderwelsch ist substanziell, suppressEndCall greift NICHT
// (die Prompt-Regel ist dort der einzige Schutz); an seiner echten Grenze (keine Aeusserung)
// greift der Seam unveraendert weiter.
test("T-P4-2 Kauderwelsch passiert suppressEndCall (Positiv), Stille wird weiter unterdrueckt (Negativ)", async () => {
  requests = [];
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
