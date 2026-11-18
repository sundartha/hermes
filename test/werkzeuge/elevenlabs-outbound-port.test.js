import assert from "node:assert/strict";
import { test } from "node:test";

const ladePort = async () => (await import("../../src/elevenlabs/registry.ts")).elevenlabsOutbound();

test("Der Outbound-Port reicht den Anruf an finishCall weiter und bewertet einen nicht abgeschlossenen Anruf nicht", async () => {
  const port = await ladePort();
  const aufrufe = [];
  const finishCall = async (call) => {
    aufrufe.push(["finish", call.id]);
    return "fertig";
  };
  const summarizeCall = async (call) => aufrufe.push(["summary", call.id]);
  const mitUrteil = port.mitAuftragsurteil({ finishCall, summarizeCall });
  const ergebnis = await mitUrteil({ id: "c1", status: "failed" });
  assert.equal(ergebnis, "fertig");
  assert.deepEqual(aufrufe, [["finish", "c1"]]);
});

test("Der Outbound-Port baut den Anrufstart mit Abbruch- und Nachlauf-Funktionen", async () => {
  const port = await ladePort();
  const outbound = port.makeElevenLabsOutbound({ store: {}, config: { voice: { elevenLabsOutbound: {} } } });
  assert.equal(typeof outbound.endActiveCall, "function");
  assert.equal(typeof outbound.awaitAndPersistInboundElResult, "function");
});

test("Der Outbound-Port baut den Vorspann-Erzeuger als Funktion je Anruf", async () => {
  const port = await ladePort();
  const erzeuger = port.makeVorspannErzeuger({ config: {}, store: {}, synthese: async () => null });
  assert.equal(typeof erzeuger, "function");
});
