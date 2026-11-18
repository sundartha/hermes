import assert from "node:assert/strict";
import { test } from "node:test";

import { registerTools } from "../../src/mcp-tools.js";
import { starteAttrappe } from "./attrappen-server.js";

const AUFTRAG = "Ich möchte einen Haarschnitt für Donnerstagvormittag buchen.";

function werkzeugeOhneServer() {
  const handlers = new Map();
  const konfig = new Map();
  registerTools(
    {
      registerTool: (name, config, handler) => {
        handlers.set(name, handler);
        konfig.set(name, config);
      },
      registerResource() {},
    },
    { identity: null },
  );
  return { handlers, konfig };
}

async function mitGateway(aktion) {
  const empfangen = [];
  const attrappe = await starteAttrappe((anfrage, antwortStrom) => {
    const teile = [];
    anfrage.on("data", (teil) => teile.push(teil));
    anfrage.on("end", () => {
      empfangen.push(Buffer.concat(teile).toString());
      antwortStrom.writeHead(200, { "content-type": "application/json" });
      antwortStrom.end(JSON.stringify({ callId: "call_n1", startedAt: "2026-11-18T08:00:00.000Z" }));
    });
  });
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = attrappe.url;
  try {
    return await aktion(werkzeugeOhneServer(), empfangen);
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await attrappe.close();
  }
}

const starte = (zusatz) => async ({ handlers }) =>
  (await handlers.get("place_call")({ to: "+49 211 5550142", objective: AUFTRAG, ...zusatz })).structuredContent;

test("anruf-name-gegenstelle K3: place_call gibt den Namen der Gegenstelle ohne Leerraum am Rand zurück", async () => {
  const daten = await mitGateway(starte({ recipient_name: "  Salon Mia " }));
  assert.equal(daten.recipient_name, "Salon Mia");
});

test("anruf-name-gegenstelle K3: ohne Namen oder mit leerem Namen liefert place_call null", async () => {
  assert.equal((await mitGateway(starte({}))).recipient_name, null);
  assert.equal((await mitGateway(starte({ recipient_name: "   " }))).recipient_name, null);
});

test("anruf-name-gegenstelle K3: der Name geht nicht an den Anrufweg des Servers", async () => {
  const gesendet = await mitGateway(async (werkzeuge, empfangen) => {
    await starte({ recipient_name: "Salon Mia" })(werkzeuge);
    return JSON.stringify(empfangen);
  });
  assert.doesNotMatch(gesendet, /Salon Mia|recipient_name/);
});

test("anruf-name-gegenstelle K3: das Eingabefeld ist optional und auf 80 Zeichen begrenzt", async () => {
  const { konfig } = werkzeugeOhneServer();
  const feld = konfig.get("place_call").inputSchema.recipient_name;
  assert.equal(feld.isOptional(), true);
  assert.equal(feld.safeParse("a".repeat(80)).success, true);
  assert.equal(feld.safeParse("a".repeat(81)).success, false);
  assert.equal(konfig.get("place_call").outputSchema.recipient_name.isNullable(), true);
});
