// GQ-S1 Sonde A (Befund B-1): Herkunft eines Shim-Turns unterscheidbar machen - zwei
// Sprech-Turns der Spracherkennung ("extends") vs. ein doppelt zugestellter Request
// ("same"). Zwei Ebenen: (1) reine makeTurnTextProbe()-Logik (kein Netz, kein Spawn,
// P12), (2) der Draht im echten Shim-Handler (turn_probe-Logzeile).
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole } from "./helpers.js";
import { makeTurnTextProbe, TURN_TEXT_RELATION } from "../src/telnyx-turn-probe.js";
import {
  fakeStore,
  makeCall,
  agentTurnSpy,
  makeHandler,
  validReq,
  fakeRes,
  voiceControlSpy,
} from "./telnyx-shim-harness.js";

// === Ebene 1: reine Probe-Logik =========================================================

test("GQ-S1-1: erster Turn eines Calls -> first, gapMs null, chars = Textlaenge", () => {
  const observe = makeTurnTextProbe();
  const result = observe("call_1", "Hallo, ich moechte einen Termin.");
  assert.equal(result.prevRelation, TURN_TEXT_RELATION.FIRST);
  assert.equal(result.gapMs, null);
  assert.equal(result.chars, "Hallo, ich moechte einen Termin.".length);
});

test("GQ-S1-2: same / extends / other ueber eine Folge von Turns desselben Calls", () => {
  const observe = makeTurnTextProbe();
  const base = "Ich haette gern einen Termin";

  observe("call_2", base);
  const repeat = observe("call_2", base);
  assert.equal(repeat.prevRelation, TURN_TEXT_RELATION.SAME, "identischer Text -> same");

  const extended = observe("call_2", base + " naechste Woche Dienstag");
  assert.equal(extended.prevRelation, TURN_TEXT_RELATION.EXTENDS, "Vorgaenger ist Praefix -> extends");

  const sameLenOther = observe("call_2", "X".repeat((base + " naechste Woche Dienstag").length));
  assert.equal(sameLenOther.prevRelation, TURN_TEXT_RELATION.OTHER, "gleiche Laenge, anderer Inhalt -> other");

  const shorterOther = observe("call_2", "Ganz etwas anderes");
  assert.equal(shorterOther.prevRelation, TURN_TEXT_RELATION.OTHER, "unabhaengiger Text -> other");
});

test("GQ-S1-3: zwei callIds beeinflussen sich nicht", () => {
  const observe = makeTurnTextProbe();
  observe("call_a", "Text A");
  const first = observe("call_b", "Text B");
  assert.equal(first.prevRelation, TURN_TEXT_RELATION.FIRST, "zweiter Call bleibt first");
});

test("GQ-S1-4: Grenzfaelle - leer/null, textHash-Form, kein Klartext im Hash", () => {
  const observe = makeTurnTextProbe();
  const empty = observe("call_edge", "");
  assert.equal(empty.chars, 0);
  assert.match(empty.textHash, /^[0-9a-f]{8}$|^-$/);

  const nullish = observe("call_edge2", null);
  assert.equal(nullish.chars, 0, "kein String -> leerer Text, kein Wurf");
  assert.match(nullish.textHash, /^[0-9a-f]{8}$|^-$/);

  const real = observe("call_edge3", "geheimer Wortlaut");
  assert.match(real.textHash, /^[0-9a-f]{8}$/);
  assert.ok(!real.textHash.includes("geheim"), "Hash enthaelt den Klartext nicht");
});

// === Ebene 2: der Draht im Shim-Handler ================================================

test("GQ-S1-5: EIN Handler-Lauf -> genau eine turn_probe-Zeile mit den erwarteten Feldern, kein Text", async () => {
  const call = makeCall({ id: "call_wire1", callControlId: "cc_wire1" });
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Antwortsatz, der nie im Log stehen darf.", endCall: false });
  const handler = makeHandler({ store, agentTurn });

  const spokenText = "Der Anrufer sagt genau diesen Satz.";
  const lines = await captureConsole(() =>
    handler(validReq(call, { messages: [{ role: "user", content: spokenText }] }), fakeRes()),
  );

  const probeLines = lines.filter((l) => l.includes("[telnyx-shim] turn_probe"));
  assert.equal(probeLines.length, 1);
  const line = probeLines[0];
  for (const key of ["callId", "turnSeq", "chars", "prevRelation", "messagesCount", "lastRole"])
    assert.ok(line.includes(`"${key}"`), `Zeile muss ${key} tragen`);
  assert.ok(!line.includes(spokenText), "der gesprochene Text darf nie in der Zeile landen");
  assert.ok(!line.includes("Antwortsatz"), "auch die gehoerte KI-Antwort darf nie landen");
});

test("GQ-S1-6: derselbe Handler zweimal, zweiter Request mit verlaengertem Text -> extends + numerisches gapMs", async () => {
  const call = makeCall({ id: "call_wire2", callControlId: "cc_wire2" });
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "ok", endCall: false });
  const handler = makeHandler({ store, agentTurn });

  const first = "Ich haette gern einen Termin";
  await handler(validReq(call, { messages: [{ role: "user", content: first }] }), fakeRes());

  const lines = await captureConsole(() =>
    handler(
      validReq(call, { messages: [{ role: "user", content: first + " am Dienstag" }] }),
      fakeRes(),
    ),
  );
  const probeLine = lines.find((l) => l.includes("[telnyx-shim] turn_probe"));
  assert.ok(probeLine, "zweite Zeile muss existieren");
  assert.ok(probeLine.includes('"prevRelation":"extends"'));
  assert.match(probeLine, /"gapMs":\d+/, "gapMs muss eine Zahl sein");
});

test("GQ-S1-7: x-telnyx-request-id wird nur als Hash geloggt, gleiche ID -> gleicher Hash", async () => {
  const call = makeCall({ id: "call_wire3", callControlId: "cc_wire3" });
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "ok", endCall: false });
  const handler = makeHandler({ store, agentTurn });
  const requestId = "req-abc-123";

  function reqWithHeader(id) {
    const r = validReq(call, { messages: [{ role: "user", content: "Text" }] });
    r.headers["x-telnyx-request-id"] = id;
    return r;
  }

  const linesA = await captureConsole(() => handler(reqWithHeader(requestId), fakeRes()));
  const lineA = linesA.find((l) => l.includes("[telnyx-shim] turn_probe"));
  assert.ok(lineA.includes("x-telnyx-request-id"), "Header-NAME muss in der Zeile stehen");
  assert.ok(!lineA.includes(requestId), "der rohe Header-WERT darf nie in der Zeile stehen");

  const linesB = await captureConsole(() => handler(reqWithHeader(requestId), fakeRes()));
  const lineB = linesB.find((l) => l.includes("[telnyx-shim] turn_probe"));
  const hashA = lineA.match(/"x-telnyx-request-id":"([0-9a-f-]+)"/)[1];
  const hashB = lineB.match(/"x-telnyx-request-id":"([0-9a-f-]+)"/)[1];
  assert.equal(hashA, hashB, "gleiche Request-ID -> gleicher Hash");

  const linesC = await captureConsole(() => handler(reqWithHeader("req-xyz-789"), fakeRes()));
  const lineC = linesC.find((l) => l.includes("[telnyx-shim] turn_probe"));
  const hashC = lineC.match(/"x-telnyx-request-id":"([0-9a-f-]+)"/)[1];
  assert.notEqual(hashA, hashC, "verschiedene Request-ID -> verschiedener Hash");
});

test("GQ-S1-8: turn_probe steht auch, wenn ein spaeteres Gate (Budget) den Turn sofort beendet", async () => {
  const call = makeCall({ id: "call_wire4", callControlId: "cc_wire4" });
  const store = fakeStore({ call, budgetExceeded: true });
  const agentTurn = agentTurnSpy({ speech: "sollte nie erreicht werden", endCall: false });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });

  const lines = await captureConsole(() =>
    handler(validReq(call, { messages: [{ role: "user", content: "Text" }] }), fakeRes()),
  );

  assert.ok(
    lines.some((l) => l.includes("[telnyx-shim] turn_probe")),
    "turn_probe muss VOR dem Budget-Gate stehen",
  );
  assert.ok(
    !lines.some((l) => l.includes("[telnyx-shim] turn_ok")),
    "turn_ok darf hier NICHT stehen - der Turn wurde vom Budget-Gate beendet",
  );
});
