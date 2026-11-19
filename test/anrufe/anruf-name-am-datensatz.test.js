import assert from "node:assert/strict";
import { test } from "node:test";

import { planProfileFor } from "../../src/plans.ts";
import {
  mcpPost,
  readToolResult,
  seedState,
  startIdp,
  startServer,
  waitForStoreState,
  toolCall,
  EL_OUTBOUND_BOOT_ENV,
} from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = "t_nd_eins";
const SUB = "sub-nd-eins";
const ABSENDER = "+4915110000093";
const AUFTRAG = "Ich möchte einen Haarschnitt für Donnerstagvormittag buchen.";

function seed() {
  return seedState({
    tenants: [{ id: TENANT, idpSubject: SUB, status: "active", ownerName: "Nd Kunde", kycLevel: "card" }],
    profiles: { [TENANT]: { ...planProfileFor("business"), maxCallsPerHour: 100 } },
    numbers: [
      {
        id: "num_nd",
        e164: ABSENDER,
        tenantId: TENANT,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        providerAgentPhoneNumberId: "phnum_h2t1_1",
      },
    ],
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
      ...vorspannMandantenUmgebung([TENANT]),
      MCP_UI_ENABLED: "true",
    },
    seed: seed(),
  });
  const platziere = async (to, zusatz) => {
    const antwort = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, await idp.sign({ sub: SUB }), toolCall("place_call", { to, objective: AUFTRAG, ...zusatz })),
    );
    assert.notEqual(antwort.isError, true, JSON.stringify(antwort));
    assert.ok(antwort.structuredContent, JSON.stringify(antwort));
    const callId = antwort.structuredContent.call_id;
    const zustand = await waitForStoreState(srv, (store) => store.calls.some((c) => c.id === callId));
    return zustand.calls.find((c) => c.id === callId);
  };
  const direkt = async (to, zusatz) => {
    const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Tenant": TENANT },
      body: JSON.stringify({ to, objective: AUFTRAG, ...zusatz }),
    });
    assert.equal(antwort.status, 200, await antwort.clone().text());
    const { callId } = await antwort.json();
    const zustand = await waitForStoreState(srv, (store) => store.calls.some((c) => c.id === callId));
    return zustand.calls.find((c) => c.id === callId);
  };
  try {
    await lauf({ platziere, direkt });
  } finally {
    await srv.stop();
    await idp.close();
  }
}

test("name-am-anruf: place_call mit Namen legt den Namen ohne Leerraum am Rand am Anrufdatensatz ab", async () => {
  await mitServer(async ({ platziere }) => {
    const anruf = await platziere("+49 211 5550142", { recipient_name: "  Salon Mia " });
    assert.equal(anruf.recipientName, "Salon Mia");
  });
});

test("name-am-anruf: place_call ohne oder mit leerem Namen lässt den Namen am Anrufdatensatz null", async () => {
  await mitServer(async ({ platziere }) => {
    assert.equal((await platziere("+49 211 5550143", {})).recipientName, null);
    assert.equal((await platziere("+49 211 5550144", { recipient_name: "   " })).recipientName, null);
  });
});

test("name-am-anruf: die Anruf-Route nimmt einen Namen mit genau 80 Zeichen an", async () => {
  await mitServer(async ({ direkt }) => {
    const achtzig = "a".repeat(80);
    assert.equal((await direkt("+49 211 5550145", { recipient_name: achtzig })).recipientName, achtzig);
  });
});

test("name-am-anruf: die Anruf-Route verwirft einen Namen mit 81 Zeichen", async () => {
  await mitServer(async ({ direkt }) => {
    assert.equal((await direkt("+49 211 5550146", { recipient_name: "a".repeat(81) })).recipientName, null);
  });
});

test("name-am-anruf: die Anruf-Route verwirft einen Namen, der kein Text ist", async () => {
  await mitServer(async ({ direkt }) => {
    assert.equal((await direkt("+49 211 5550147", { recipient_name: 42 })).recipientName, null);
  });
});
