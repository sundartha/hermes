import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { registerTools } from "../../src/mcp-tools.js";
import { makeReadRoutes } from "../../src/routes/api-read.ts";

const OWNER_TENANT = "owner";
const CALL_ID = "call_ende_sofort";
const NACHLAUF_BEGINN = "2026-11-22T18:50:00.000Z";
const LINE_COUNT = 4;

function anruf(felder) {
  return {
    id: CALL_ID,
    tenantId: OWNER_TENANT,
    status: "active",
    answeredAt: "2026-11-22T18:48:00.000Z",
    transcript: Array.from({ length: LINE_COUNT }, (_, index) => ({
      role: "agent",
      text: `Zeile ${index + 1}`,
    })),
    ...felder,
  };
}

async function starteInstanz(gemeinsameDatenbank) {
  const tenant = {
    requestTenant: () => OWNER_TENANT,
    requireTenant: () => OWNER_TENANT,
    tenantOwnsCall: (call, tenantId) => call.tenantId === tenantId,
  };
  const store = { leseCallUngebunden: async (id) => gemeinsameDatenbank.get(id) };
  const app = express();
  app.use(makeReadRoutes({ store, config: {}, audit: () => {}, tenant }));
  return new Promise((listening) => {
    const http = app.listen(0, () => listening(http));
  });
}

async function werkzeuge(server) {
  const handlers = new Map();
  registerTools(
    { registerTool: (name, _c, handler) => handlers.set(name, handler), registerResource() {} },
    {
      identity: null,
      scopedTenant: OWNER_TENANT,
      consultAllowed: true,
      language: "de",
    },
  );
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = (await handlers.get("get_call_status")({ call_id: CALL_ID })).structuredContent;
    const ergebnis = (await handlers.get("get_call_result")({ call_id: CALL_ID }))
      .structuredContent;
    return { status, ergebnis };
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
  }
}

async function mitInstanzen(datenbank, lauf) {
  const a = await starteInstanz(datenbank);
  const b = await starteInstanz(datenbank);
  try {
    return await lauf(a, b);
  } finally {
    await Promise.all([a, b].map((server) => new Promise((closed) => server.close(closed))));
  }
}

test("Anruf mit begonnenem Nachlauf zeigt sofort completed ohne Transkriptzeilen und mit Platzhalter-Ergebnis", async () => {
  const datenbank = new Map([[CALL_ID, anruf({ elNachlaufStartedAt: NACHLAUF_BEGINN })]]);
  await mitInstanzen(datenbank, async (a) => {
    const { status, ergebnis } = await werkzeuge(a);
    assert.equal(status.status, "completed");
    assert.deepEqual(status.last_transcript_lines, []);
    assert.match(ergebnis.result_summary, /Noch keine Zusammenfassung/);
  });
});

test("Nachlauf-Ende bei der anderen Instanz zeigt auch auf der abfragenden Instanz completed", async () => {
  const datenbank = new Map([[CALL_ID, anruf({})]]);
  await mitInstanzen(datenbank, async (a, b) => {
    assert.equal((await werkzeuge(b)).status.status, "in_progress");
    datenbank.set(CALL_ID, anruf({ elNachlaufStartedAt: NACHLAUF_BEGINN }));
    assert.equal((await werkzeuge(b)).status.status, "completed");
    assert.equal((await werkzeuge(a)).status.status, "completed");
  });
});

test("Nach done der Konversation bleibt completed und die echte Zusammenfassung erscheint", async () => {
  const datenbank = new Map([
    [
      CALL_ID,
      anruf({
        status: "completed",
        elNachlaufStartedAt: NACHLAUF_BEGINN,
        summary: "Termin am Donnerstag",
      }),
    ],
  ]);
  await mitInstanzen(datenbank, async (a) => {
    const { status, ergebnis } = await werkzeuge(a);
    assert.equal(status.status, "completed");
    assert.equal(ergebnis.result_summary, "Termin am Donnerstag");
  });
});

test("Anruf ohne Nachlauf zeigt weiter in_progress", async () => {
  const datenbank = new Map([[CALL_ID, anruf({})]]);
  await mitInstanzen(datenbank, async (a) => {
    const { status } = await werkzeuge(a);
    assert.equal(status.status, "in_progress");
    assert.equal(status.last_transcript_lines.length, LINE_COUNT);
  });
});
