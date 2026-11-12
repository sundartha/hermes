import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";
const ADRESSE = "postgres://kennzahlen-leser-attrappe.invalid/hermes";

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
  unterKennzahlenLeser: true,
  kennzahlenAdresse: ADRESSE,
  ohneStartanruf: true,
});

const { registerTools } = await import("../../src/mcp-tools.js");
const { BOOTSTRAP_TENANT_ID } = await import("../../src/store/defaults.js");

function werkzeuge() {
  const handlers = new Map();
  registerTools({ registerTool: (name, _config, handler) => handlers.set(name, handler), registerResource() {} }, { identity: null });
  return handlers;
}

test("B1: der Kennzahlen-Lauf lässt get_call_status eines laufenden Anrufs auf in_progress", async () => {
  const store = await import("../../src/store.js");
  const call = store.createCall({ direction: "outbound", from: "+4930000001", to: "+4930000002", tenantId: BOOTSTRAP_TENANT_ID });
  Object.assign(call, { status: "active", startedAt: zeitpunkt(0, "09:00:00"), answeredAt: zeitpunkt(0, "09:01:00") });
  store.save();
  await store.drainFlushes();

  const { anfrage } = laufendesHermes();
  process.env.GATEWAY_URL = new URL((await anfrage("/healthz")).url).origin;
  const status = werkzeuge().get("get_call_status");
  const vorher = await status({ call_id: call.id });
  assert.equal(vorher.structuredContent.status, "in_progress");

  await store.kennzahlenTakt();

  const nachher = await status({ call_id: call.id });
  assert.equal(nachher.structuredContent.status, "in_progress");
  assert.equal(nachher.structuredContent.call_id, call.id);
});
