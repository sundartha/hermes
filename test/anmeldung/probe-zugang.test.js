import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EL_OUTBOUND_BOOT_ENV,
  mcpPost,
  readRpcMessage,
  readToolResult,
  seedCall,
  seedState,
  startIdp,
  startServer,
  startServerExpectExit,
  toolCall,
  waitForLog,
  OWNER_TEST_NUMBER,
} from "../helpers.js";
import {
  PROBE_ZUGANG_SCHLUESSEL as TOKEN,
  PROBE_ZUGANG_SCHLUESSEL_ABWEICHEND as ABWEICHEND,
  PROBE_ZUGANG_SCHLUESSEL_ZU_KURZ as ZU_KURZ,
} from "../gemeinsam/erfundene-geheimnisse.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { planProfileFor } from "../../src/plans.ts";

const ENDE = "2026-11-23T10:00:00.000Z";
const PFAD = "/intern/probe/mcp";
const FREMDER_MANDANT = "t_probe_fremd";
const FREMDER_ANRUF = "call_probe_fremd";
const EIGENER_ANRUF = "call_probe_eigen";
const FREMDE_NUMMER = "+4915110000099";
const ZIEL = "+4915112340197";
const ZIEL_ZWEI = "+4915112340198";
const ZIEL_DREI = "+4915112340199";
const ZIEL_VIER = "+4915112340196";
const ABGELEHNT = { error: "unauthorized" };
const SECHS_WERKZEUGE = ["cancel_call", "get_agent_number", "get_call_result", "get_call_status", "list_calls", "place_call"];
const FREMDES_WERKZEUG = "get_agent_status";
const ABRUFE_JE_MINUTE = 30;
const MINDESTLAENGE = 32;
const HTTP_TOO_MANY = 429;
const HTTP_UNAUTH = 401;
const HTTP_OK = 200;
const KARTE = "card";

function seed() {
  const state = seedState({
    tenants: [
      { id: FREMDER_MANDANT, idpSubject: "sub-probe-fremd", status: "active", ownerName: "Fremd Kunde", kycLevel: KARTE },
    ],
    profiles: { [FREMDER_MANDANT]: planProfileFor("business") },
    calls: [
      seedCall({ id: EIGENER_ANRUF, status: "completed", endedAt: ENDE }),
      seedCall({ id: FREMDER_ANRUF, tenantId: FREMDER_MANDANT, status: "completed", endedAt: ENDE }),
    ],
    numbers: [
      {
        id: "num_probe_fremd",
        e164: FREMDE_NUMMER,
        tenantId: FREMDER_MANDANT,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        providerAgentPhoneNumberId: "phnum_probe_fremd",
      },
    ],
  });
  return state;
}

async function mitServer(env, lauf, zustand = seed()) {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      HERMES_PROBE_TOKEN: TOKEN,
      ...EL_OUTBOUND_BOOT_ENV,
      ...vorspannMandantenUmgebung([FREMDER_MANDANT]),
      ...env,
    },
    seed: zustand,
  });
  const probe = (token, body) => mcpPost(`${srv.localUrl}${PFAD}`, token, body);
  const werkzeug = async (name, args) => readToolResult(await probe(TOKEN, toolCall(name, args)));
  try {
    await lauf({ srv, idp, probe, werkzeug });
  } finally {
    await srv.stop();
    await idp.close();
  }
}

test("Probe-Zugang: get_agent_number mit dem richtigen Wert liefert die Nummer des Betreiber-Mandanten", async () => {
  await mitServer({}, async ({ probe }) => {
    const res = await probe(TOKEN, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_OK);
    const ergebnis = (await readRpcMessage(res)).result;
    assert.equal(ergebnis.structuredContent.number, OWNER_TEST_NUMBER.e164);
  });
});

test("Probe-Zugang: fehlender, falscher und um ein Zeichen abweichender Wert wird mit 401 abgewiesen, ohne Werkzeug", async () => {
  await mitServer({}, async ({ srv, probe }) => {
    for (const token of [undefined, "falsch", ABWEICHEND, TOKEN.slice(0, -1), `${TOKEN}x`]) {
      const res = await probe(token, toolCall("get_agent_number"));
      assert.equal(res.status, HTTP_UNAUTH, String(token));
      assert.deepEqual(await res.json(), ABGELEHNT);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
    await waitForLog(srv, /auth_failed.*grund=probe_token/);
  });
});

test("Probe-Zugang: ohne gesetzten Wert antwortet die Route auf jeden Aufruf wie bei einem falschen Wert", async () => {
  await mitServer({ HERMES_PROBE_TOKEN: "" }, async ({ probe }) => {
    for (const token of [undefined, "", " ", TOKEN]) {
      const res = await probe(token, toolCall("get_agent_number"));
      assert.equal(res.status, HTTP_UNAUTH, String(token));
      assert.deepEqual(await res.json(), ABGELEHNT);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
  });
});

test("Probe-Zugang: ein Wert unter 32 Zeichen schaltet die Route nicht ein", async () => {
  await mitServer({ HERMES_PROBE_TOKEN: ZU_KURZ }, async ({ probe }) => {
    const res = await probe(ZU_KURZ, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_UNAUTH);
    assert.deepEqual(await res.json(), ABGELEHNT);
  });
});

test("Probe-Zugang: Leerzeichen um den gesetzten Wert werden abgeschnitten", async () => {
  await mitServer({ HERMES_PROBE_TOKEN: ` ${TOKEN} ` }, async ({ probe }) => {
    const res = await probe(TOKEN, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_OK);
  });
});

test("Probe-Zugang: ein Wert mit genau 32 Zeichen schaltet die Route ein", async () => {
  const genau = TOKEN.slice(0, MINDESTLAENGE);
  await mitServer({ HERMES_PROBE_TOKEN: genau }, async ({ probe }) => {
    const res = await probe(genau, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_OK);
  });
});

test("Probe-Zugang: tools/list nennt genau die sechs freigegebenen Werkzeuge, alle im MCP-Vertrag", async () => {
  const vertrag = (await import("../../docs/mcp-vertrag.json", { with: { type: "json" } })).default;
  for (const name of SECHS_WERKZEUGE) assert.ok(vertrag.werkzeuge[name], name);
  await mitServer({}, async ({ probe }) => {
    const { tools } = await readToolResult(await probe(TOKEN, { jsonrpc: "2.0", id: 1, method: "tools/list" }));
    assert.deepEqual(tools.map((t) => t.name).sort(), SECHS_WERKZEUGE);
    const place = tools.find((t) => t.name === "place_call");
    assert.doesNotMatch(place.description, /await_call_event/);
  });
});

test("Probe-Zugang: initialize kennt weder die Rückfrage-Schleife noch die Oberfläche", async () => {
  await mitServer({}, async ({ probe }) => {
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "1" } },
    };
    const { result } = await readRpcMessage(await probe(TOKEN, init));
    assert.doesNotMatch(result.instructions, /await_call_event|consult/i);
    assert.equal(Object.hasOwn(result.capabilities, "extensions"), false);
  });
});

test("Probe-Zugang: ein anderes Werkzeug ist unbekannt und ändert nichts", async () => {
  await mitServer({}, async ({ srv, werkzeug }) => {
    const vorher = srv.readStore().calls.length;
    const antwort = await werkzeug(FREMDES_WERKZEUG, {});
    assert.equal(antwort.isError, true);
    assert.match(antwort.content[0].text, /not found|unknown|unbekannt/i);
    assert.equal(srv.readStore().calls.length, vorher);
  });
});

test("Probe-Zugang: Anrufe eines zweiten Mandanten sind weder abrufbar noch abbrechbar noch gelistet", async () => {
  await mitServer({}, async ({ werkzeug }) => {
    for (const name of ["get_call_status", "get_call_result", "cancel_call"]) {
      const fremd = await werkzeug(name, { call_id: FREMDER_ANRUF });
      assert.equal(fremd.isError, true, name);
    }
    const eigen = await werkzeug("get_call_status", { call_id: EIGENER_ANRUF });
    assert.notEqual(eigen.isError, true);
    const liste = await werkzeug("list_calls", {});
    const ids = JSON.stringify(liste.structuredContent);
    assert.ok(ids.includes(EIGENER_ANRUF));
    assert.equal(ids.includes(FREMDER_ANRUF), false);
  });
});

test("Probe-Zugang: place_call läuft für den Betreiber-Mandanten und bleibt bei OUTBOUND_FROZEN gesperrt", async () => {
  await mitServer({}, async ({ srv, werkzeug }) => {
    const ergebnis = await werkzeug("place_call", { to: ZIEL, objective: "Probe" });
    assert.notEqual(ergebnis.isError, true, JSON.stringify(ergebnis));
    const angelegt = srv.readStore().calls.find((anruf) => anruf.id === ergebnis.structuredContent.call_id);
    assert.equal(angelegt.tenantId, "owner");
    assert.equal(angelegt.requestedBy, "probe");
    assert.doesNotMatch(ergebnis.content[0].text, /consult|await_call_event/i);
  });
  await mitServer({ OUTBOUND_FROZEN: "true" }, async ({ srv, werkzeug }) => {
    const vorher = srv.readStore().calls.length;
    const ergebnis = await werkzeug("place_call", { to: ZIEL_ZWEI, objective: "Probe" });
    assert.equal(ergebnis.isError, true);
    await waitForLog(srv, /place_call_denied .*grund=frozen/);
    assert.equal(srv.readStore().calls.length, vorher);
  });
});

test("Probe-Zugang: die Kostendecke des Betreiber-Mandanten sperrt place_call", async () => {
  const zustand = { ...seed(), tenantBudgets: [{ tenantId: "owner", budgetCents: 0, hardCapCents: 0 }] };
  await mitServer(
    {},
    async ({ srv, werkzeug }) => {
      const vorher = srv.readStore().calls.length;
      const ergebnis = await werkzeug("place_call", { to: ZIEL_DREI, objective: "Probe" });
      assert.equal(ergebnis.isError, true);
      await waitForLog(srv, /place_call_denied .*tenant=owner/);
      assert.equal(srv.readStore().calls.length, vorher);
    },
    zustand,
  );
});

test("Probe-Zugang: /mcp nimmt den Probe-Wert nicht als Anmeldung an", async () => {
  await mitServer({}, async ({ srv }) => {
    const res = await mcpPost(`${srv.localUrl}/mcp`, TOKEN, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_UNAUTH);
  });
});

test("Probe-Zugang: nach 30 Aufrufen je Minute und Adresse antwortet die Route mit 429", async () => {
  await mitServer({}, async ({ probe }) => {
    for (let i = 0; i < ABRUFE_JE_MINUTE; i += 1) {
      const res = await probe("falsch", toolCall("get_agent_number"));
      assert.equal(res.status, HTTP_UNAUTH, String(i));
    }
    const res = await probe(TOKEN, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_TOO_MANY);
  });
});

test("SG-39 Der Probe-Zugang erreicht ohne gesetzten Wert nichts und mit Wert nur sechs Werkzeuge des Betreiber-Mandanten", async () => {
  await mitServer({ HERMES_PROBE_TOKEN: "" }, async ({ srv, probe }) => {
    const vorher = srv.readStore().calls.length;
    const res = await probe(TOKEN, toolCall("place_call", { to: ZIEL_VIER, objective: "Probe" }));
    assert.equal(res.status, HTTP_UNAUTH);
    assert.equal(srv.readStore().calls.length, vorher);
  });
});

test("Start bricht ab, wenn HERMES_PROBE_TOKEN gleich HERMES_DEPLOY_TOKEN oder HERMES_STATUS_TOKEN ist", async () => {
  for (const schluessel of ["HERMES_DEPLOY_TOKEN", "HERMES_STATUS_TOKEN"]) {
    const ergebnis = await startServerExpectExit({
      env: { HERMES_PROBE_TOKEN: TOKEN, [schluessel]: TOKEN },
    });
    assert.notEqual(ergebnis.code, 0, schluessel);
    assert.match(ergebnis.output, /HERMES_PROBE_TOKEN/);
  }
});
