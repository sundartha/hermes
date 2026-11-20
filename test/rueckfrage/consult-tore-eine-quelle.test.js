import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

import { planProfileFor } from "../../src/plans.ts";
import {
  EL_OUTBOUND_BOOT_ENV,
  mcpPost,
  readRpcMessage,
  seedCall,
  seedState,
  startIdp,
  startServer,
  toolCall,
} from "../helpers.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = "t_tore";
const SUB = "sub-tore";
const SENDER = "+4915110000092";
const TARGET = "+4915112340098";

const FAELLE = [
  { name: "alles offen", master: "true", kontext: "true", mandant: true, inCall: "true", zu: [] },
  {
    name: "Master zu",
    master: "false",
    kontext: "true",
    mandant: true,
    inCall: "true",
    zu: ["master"],
  },
  {
    name: "Kontext zu",
    master: "true",
    kontext: "false",
    mandant: true,
    inCall: "true",
    zu: ["kontext"],
  },
  {
    name: "Mandant zu",
    master: "true",
    kontext: "true",
    mandant: false,
    inCall: "true",
    zu: ["mandant"],
  },
  {
    name: "In-Call zu",
    master: "true",
    kontext: "true",
    mandant: true,
    inCall: "false",
    zu: ["in_call"],
  },
  {
    name: "Master und Kontext zu",
    master: "false",
    kontext: "false",
    mandant: true,
    inCall: "true",
    zu: ["master", "kontext"],
  },
  {
    name: "Master und Mandant zu",
    master: "false",
    kontext: "true",
    mandant: false,
    inCall: "true",
    zu: ["master", "mandant"],
  },
  {
    name: "Kontext und Mandant zu",
    master: "true",
    kontext: "false",
    mandant: false,
    inCall: "true",
    zu: ["kontext", "mandant"],
  },
  {
    name: "alles zu",
    master: "false",
    kontext: "false",
    mandant: false,
    inCall: "false",
    zu: ["master", "kontext", "mandant", "in_call"],
  },
];

async function placeCall(f) {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      ...EL_OUTBOUND_BOOT_ENV,
      ...vorspannMandantenUmgebung([TENANT]),
      MCP_UI_ENABLED: "true",
      CONSULT_ENABLED: f.master,
      ASSISTANT_CONTEXT_ENABLED: f.kontext,
      IN_CALL_CONSULT_ENABLED: f.inCall,
    },
    seed: seedState({
      tenants: [
        { id: TENANT, idpSubject: SUB, status: "active", ownerName: "Kunde", kycLevel: "card" },
      ],
      profiles: { [TENANT]: { ...planProfileFor("business"), allowConsult: f.mandant } },
      numbers: [
        {
          id: `num_${TENANT}`,
          e164: SENDER,
          tenantId: TENANT,
          provider: "telnyx",
          status: "active",
          providerNumberId: null,
          providerAgentPhoneNumberId: "phnum_tore_1",
        },
      ],
    }),
  });
  try {
    const token = await idp.sign({ sub: SUB });
    const message = await readRpcMessage(
      await mcpPost(
        `${srv.localUrl}/mcp`,
        token,
        toolCall("place_call", { to: TARGET, objective: "Termin" }),
      ),
    );
    const [inhalt] = message.result.content;
    return inhalt.text;
  } finally {
    await srv.stop();
    await idp.close();
  }
}

for (const f of FAELLE) {
  test(`consult-tore: ${f.name} - place_call nennt genau die geschlossenen Tore`, async () => {
    const text = await placeCall(f);
    for (const tor of ["master", "kontext", "mandant", "in_call"]) {
      assert.equal(text.includes(`[${tor}]`), f.zu.includes(tor), `${tor}: ${text}`);
    }
    const allesOffenDreiTore = !["master", "kontext", "mandant"].some((t) => f.zu.includes(t));
    assert.equal(
      text.includes("Werkzeug-Berechtigung") || text.includes("tool permission"),
      allesOffenDreiTore,
      text,
    );
  });
}

const HTTP_FORBIDDEN = 403;
const KOPF = { "x-internal-identity": "alice", "x-internal-tenant": TENANT };

async function antwortStatus(f) {
  const srv = await startServer({
    env: {
      ...vorspannMandantenUmgebung([TENANT]),
      CONSULT_ENABLED: f.master,
      ASSISTANT_CONTEXT_ENABLED: f.kontext,
      IN_CALL_CONSULT_ENABLED: f.inCall,
    },
    seed: seedState({
      calls: [
        seedCall({
          id: "call_tore",
          tenantId: TENANT,
          status: "completed",
          endedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      profiles: { [TENANT]: { allowConsult: f.mandant } },
    }),
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls/call_tore/consult/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...KOPF },
      body: JSON.stringify({ event_id: "c0", answers: ["a"], status: "working" }),
    });
    return res.status;
  } finally {
    await srv.stop();
  }
}

for (const f of FAELLE) {
  test(`consult-tore: ${f.name} - Rueckfrage-Antwort-Route lehnt genau bei einem geschlossenen der drei Tore ab`, async () => {
    const status = await antwortStatus(f);
    const dreiToreOffen = !["master", "kontext", "mandant"].some((t) => f.zu.includes(t));
    assert.equal(status === HTTP_FORBIDDEN, !dreiToreOffen, String(status));
  });
}
