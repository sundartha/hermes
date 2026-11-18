import assert from "node:assert/strict";
import { test } from "node:test";

import { planProfileFor } from "../../src/plans.ts";
import {
  mcpPost,
  readToolResult,
  seedState,
  startIdp,
  startServer,
  toolCall,
  EL_OUTBOUND_BOOT_ENV,
} from "../helpers.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { registerTools } from "../../src/mcp-tools.js";
import { starteJsonAttrappe } from "./attrappen-server.js";

const TENANT = "t_na_eins";
const FREMD = "t_na_zwei";
const SUB = "sub-na-eins";
const SUB_FREMD = "sub-na-zwei";
const ABSENDER = { [TENANT]: "+4915110000091", [FREMD]: "+4915110000092" };
const ZIEL_EINGABE = "+49 211 5550142";
const ZIEL_NORMALISIERT = "+492115550142";
const AUFTRAG = "Ich möchte einen Haarschnitt für Donnerstagvormittag buchen.";

const kunde = (id, idpSubject) => ({ id, idpSubject, status: "active", ownerName: `${id} Kunde`, kycLevel: "card" });

function seed() {
  return seedState({
    tenants: [kunde(TENANT, SUB), kunde(FREMD, SUB_FREMD)],
    profiles: { [TENANT]: planProfileFor("business"), [FREMD]: planProfileFor("business") },
    numbers: Object.entries(ABSENDER).map(([tenantId, e164]) => ({
      id: `num_${tenantId}`,
      e164,
      tenantId,
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: "phnum_h2t1_1",
    })),
  });
}

async function mitServer(lauf) {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      ...EL_OUTBOUND_BOOT_ENV,
      ...vorspannMandantenUmgebung(Object.keys(ABSENDER)),
      MCP_UI_ENABLED: "true",
    },
    seed: seed(),
  });
  const werkzeug = async (sub, name, args) =>
    readToolResult(await mcpPost(`${srv.localUrl}/mcp`, await idp.sign({ sub }), toolCall(name, args)));
  try {
    await lauf({ werkzeug });
  } finally {
    await srv.stop();
    await idp.close();
  }
}

test("anruf-nummer-auftrag K1: place_call, get_call_status und get_call_result nennen Nummer und Auftrag des Anrufs", async () => {
  await mitServer(async ({ werkzeug }) => {
    const gestartet = await werkzeug(SUB, "place_call", { to: ZIEL_EINGABE, objective: AUFTRAG });
    assert.notEqual(gestartet.isError, true, JSON.stringify(gestartet));
    assert.equal(gestartet.structuredContent.to, ZIEL_NORMALISIERT);
    assert.equal(gestartet.structuredContent.objective, AUFTRAG);
    const callId = gestartet.structuredContent.call_id;

    const status = await werkzeug(SUB, "get_call_status", { call_id: callId });
    assert.equal(status.structuredContent.to, ZIEL_NORMALISIERT);
    assert.equal(status.structuredContent.objective, AUFTRAG);

    const abgebrochen = await werkzeug(SUB, "cancel_call", { call_id: callId });
    assert.notEqual(abgebrochen.isError, true, JSON.stringify(abgebrochen));
    const ergebnis = await werkzeug(SUB, "get_call_result", { call_id: callId });
    assert.notEqual(ergebnis.isError, true, JSON.stringify(ergebnis));
    assert.equal(ergebnis.structuredContent.to, ZIEL_NORMALISIERT);
    assert.equal(ergebnis.structuredContent.objective, AUFTRAG);
  });
});

test("anruf-nummer-auftrag K1: ein fremder Mandant bekommt weder Nummer noch Auftrag eines fremden Anrufs", async () => {
  await mitServer(async ({ werkzeug }) => {
    const gestartet = await werkzeug(SUB, "place_call", { to: ZIEL_EINGABE, objective: AUFTRAG });
    const callId = gestartet.structuredContent.call_id;
    const fremd = await werkzeug(SUB_FREMD, "get_call_status", { call_id: callId });
    assert.equal(fremd.isError, true);
    assert.doesNotMatch(JSON.stringify(fremd), /5550142|Haarschnitt/);
  });
});

function werkzeugeOhneServer() {
  const handlers = new Map();
  registerTools({ registerTool: (name, config, handler) => handlers.set(name, handler), registerResource() {} }, { identity: null });
  return handlers;
}

async function mitGateway(antwort, aktion) {
  const attrappe = await starteJsonAttrappe(antwort);
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = attrappe.url;
  try {
    return await aktion(werkzeugeOhneServer());
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await attrappe.close();
  }
}

test("anruf-nummer-auftrag K1: ein Anruf ohne Nummer und Auftrag liefert null statt undefined", async () => {
  const status = await mitGateway({ status: "active", transcript: [] }, (tools) => tools.get("get_call_status")({ call_id: "call_1" }));
  assert.equal(status.structuredContent.to, null);
  assert.equal(status.structuredContent.objective, null);
  const gestartet = await mitGateway({ callId: "call_2", startedAt: "2026-11-18T08:00:00.000Z" }, (tools) =>
    tools.get("place_call")({ to: ZIEL_EINGABE, objective: AUFTRAG }),
  );
  assert.equal(gestartet.structuredContent.to, null);
  assert.equal(gestartet.structuredContent.objective, null);
});

test("anruf-nummer-auftrag K1: eingeschränkte Daten im Auftrag werden beim Lesen maskiert", async () => {
  const goal = "Zahle mit 4111 1111 1111 1111 und buche";
  const status = await mitGateway({ status: "active", transcript: [], to: ZIEL_NORMALISIERT, goal }, (tools) =>
    tools.get("get_call_status")({ call_id: "call_1" }),
  );
  assert.equal(status.structuredContent.to, ZIEL_NORMALISIERT);
  assert.doesNotMatch(status.structuredContent.objective, /4111/);
  assert.match(status.structuredContent.objective, /^Zahle mit .+ und buche$/);
});

test("anruf-nummer-auftrag K1: ein erneuter place_call an dieselbe Nummer liefert dieselben Felder als deduplizierter Anruf", async () => {
  await mitServer(async ({ werkzeug }) => {
    await werkzeug(SUB, "place_call", { to: ZIEL_EINGABE, objective: AUFTRAG });
    const zweiter = await werkzeug(SUB, "place_call", { to: ZIEL_EINGABE, objective: AUFTRAG });
    assert.equal(zweiter.structuredContent.deduplicated, true);
    assert.equal(zweiter.structuredContent.to, ZIEL_NORMALISIERT);
    assert.equal(zweiter.structuredContent.objective, AUFTRAG);
  });
});
