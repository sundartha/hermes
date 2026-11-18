import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "../helpers.js";
import { captureToolHandlers } from "./werkzeug-registrierung.js";

const ANRUFE_DIESEN_MONAT = 33;
const MS_PRO_STUNDE = 3600000;

let srv;
let gatewayVorher;

function anrufe() {
  const monatsbeginn = new Date();
  monatsbeginn.setUTCDate(1);
  monatsbeginn.setUTCHours(0, 0, 0, 0);
  const heute = Array.from({ length: ANRUFE_DIESEN_MONAT }, (_, i) =>
    seedCall({ id: `call_monat_${i}`, status: "completed", startedAt: new Date(monatsbeginn.getTime() + i * MS_PRO_STUNDE).toISOString() }),
  );
  const vormonat = seedCall({ id: "call_vormonat", status: "completed", startedAt: new Date(monatsbeginn.getTime() - MS_PRO_STUNDE).toISOString() });
  return [...heute, vormonat];
}

before(async () => {
  srv = await startServer({ seed: seedState({ calls: anrufe() }) });
  gatewayVorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = srv.localUrl;
});

after(async () => {
  if (gatewayVorher === undefined) delete process.env.GATEWAY_URL;
  else process.env.GATEWAY_URL = gatewayVorher;
  await srv.stop();
});

test("get_agent_status zählt alle Anrufe des Monats, auch wenn /api/state nur die 30 neuesten liefert", async () => {
  const ergebnis = await captureToolHandlers({ language: "de" }).get("get_agent_status")();
  assert.equal(ergebnis.structuredContent.callsThisMonth, ANRUFE_DIESEN_MONAT);
});
