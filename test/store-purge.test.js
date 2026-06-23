// P8: Roh-Transkript-Purge nach Summary (#7, DSGVO-Datenminimierung). Prueft die
// Fachlogik purgeTranscript am state-ops-Seam (reine Mutation, kein DATA_DIR/
// Modul-Singleton -> jeder Test baut seinen eigenen frischen Plain-State via
// seedState() -> hart Independent, F.I.R.S.T.) PLUS einen json.js-Persistenz-
// Durchstich (save -> reload -> Transkript leer, Summary erhalten).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { purgeTranscript } from "../src/store/state-ops.js";

const AT = "2026-01-01T00:00:00Z";

// Frischer Plain-State pro Aufruf (kein geteilter Modul-Zustand) mit zwei
// abgeschlossenen Calls (beide mit Transkript + Summary) und einem Action Item.
function freshState() {
  return seedState({
    calls: [
      seedCall({
        id: "call1",
        status: "completed",
        summary: "Zusammenfassung 1",
        objectiveAchieved: true,
        actionItemIds: ["ai1"],
        transcript: [{ role: "agent", text: "Hallo", at: AT }],
      }),
      seedCall({
        id: "call2",
        status: "completed",
        summary: "Zusammenfassung 2",
        transcript: [{ role: "caller", text: "Geheim", at: AT }],
      }),
    ],
    actionItems: [
      { id: "ai1", callId: "call1", text: "Rueckruf", type: "todo", done: false, createdAt: AT },
    ],
  });
}

const getCall = (s, id) => s.calls.find((c) => c.id === id);

test("purgeTranscript leert NUR das Transkript des Ziel-Calls", () => {
  const s = freshState();
  assert.equal(purgeTranscript(s, "call1"), true);
  assert.deepEqual(getCall(s, "call1").transcript, [], "Ziel-Call hat leeres Transkript");
  assert.deepEqual(
    getCall(s, "call2").transcript,
    [{ role: "caller", text: "Geheim", at: AT }],
    "anderer Call bleibt unangetastet",
  );
});

test("purgeTranscript laesst Summary + objectiveAchieved + Action Items unangetastet", () => {
  const s = freshState();
  purgeTranscript(s, "call1");
  assert.equal(getCall(s, "call1").summary, "Zusammenfassung 1");
  assert.equal(getCall(s, "call1").objectiveAchieved, true);
  assert.deepEqual(getCall(s, "call1").actionItemIds, ["ai1"]);
  assert.equal(s.actionItems.length, 1, "Action Items bleiben erhalten");
});

test("purgeTranscript auf unbekannte callId -> false (kein Effekt)", () => {
  const s = freshState();
  assert.equal(purgeTranscript(s, "call_missing"), false);
  // Bestehende Calls unveraendert (kein Save-Effekt im Backend, da changed=false)
  assert.equal(getCall(s, "call1").transcript.length, 1);
});

test("purgeTranscript auf bereits leeres Transkript -> false (idempotent, Grenzfall)", () => {
  const s = freshState();
  assert.equal(purgeTranscript(s, "call1"), true);
  assert.equal(purgeTranscript(s, "call1"), false, "zweiter Aufruf meldet keine Aenderung");
});

// ---- json.js-Persistenz-Durchstich (Lesepfad nach Purge: leer + Summary) ----
let store;
before(async () => {
  const dataDir = tempDataDir(freshState());
  process.env.DATA_DIR = dataDir;
  store = await import("../src/store.js");
});

test("json-Persistenz: getCall nach Purge liefert leeres transcript + erhaltene Summary", () => {
  store.purgeTranscript("call1");
  const got = store.getCall("call1");
  assert.deepEqual(got.transcript, [], "Lesepfad (API/MCP) liefert leeres Transkript");
  assert.equal(got.summary, "Zusammenfassung 1", "Summary ueberlebt at rest");
  // Re-Load aus dem Spiegel: andere Calls unberuehrt persistiert
  assert.equal(store.getCall("call2").transcript.length, 1);
});
