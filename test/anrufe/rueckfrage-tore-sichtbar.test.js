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

const KYC_CARD = "card";
const TENANT = "t_rf_tore";
const SUB = "sub-rf-tore";
const SENDER = "+4915110000091";
const TARGET = "+4915112340091";
const OBJECTIVE = "Termin vereinbaren";
const ALLE_OFFEN = {
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
};

function seed({ allowConsult, defaultLanguage }) {
  return seedState({
    tenants: [
      {
        id: TENANT,
        idpSubject: SUB,
        status: "active",
        ownerName: "Tore Kunde",
        kycLevel: KYC_CARD,
        ...(defaultLanguage ? { defaultLanguage } : {}),
      },
    ],
    profiles: { [TENANT]: { ...planProfileFor("business"), allowConsult } },
    numbers: [
      {
        id: "num_t_rf_tore",
        e164: SENDER,
        tenantId: TENANT,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        providerAgentPhoneNumberId: "phnum_rf_tore_1",
      },
    ],
  });
}

async function placeCall({ env, allowConsult = true, defaultLanguage = "de" }) {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      ...EL_OUTBOUND_BOOT_ENV,
      ...vorspannMandantenUmgebung([TENANT]),
      MCP_UI_ENABLED: "true",
      ...env,
    },
    seed: seed({ allowConsult, defaultLanguage }),
  });
  try {
    const token = await idp.sign({ sub: SUB });
    const result = await readToolResult(
      await mcpPost(
        `${srv.localUrl}/mcp`,
        token,
        toolCall("place_call", { to: TARGET, objective: OBJECTIVE }),
      ),
    );
    return { result, anrufe: srv.readStore().calls.length };
  } finally {
    await srv.stop();
    await idp.close();
  }
}

const TORE = ["master", "kontext", "mandant", "in_call"];
const geschlossen = (text) => TORE.filter((tor) => text.includes(`[${tor}]`));
const ANFANG = {
  de: "Hinweis: Die Rueckfrage an den Auftraggeber ist fuer diesen Anruf NICHT freigegeben (geschlossen: ",
  en: "Note: the consult question to the principal is NOT released for this call (closed: ",
  fr: "Remarque : la question au mandant n'est PAS autorisée pour cet appel (fermé : ",
};
const BERECHTIGUNG_DE =
  "Hinweis: Live-Rueckfragen waehrend des Anrufs erreichen diesen Chat nur, wenn die Werkzeug-Berechtigung des Connectors erteilt ist.";
const hinweis = (sprache, tore) =>
  `${ANFANG[sprache]}${tore.map((tor) => `[${tor}]`).join(", ")}).`;

test("RF-H2-1 alle Tore offen: place_call meldet keine Tor-Sperre und behaelt den Berechtigungs-Hinweis", async () => {
  const { result, anrufe } = await placeCall({ env: ALLE_OFFEN });
  const text = result.content[0].text;
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.deepEqual(geschlossen(text), []);
  assert.ok(text.includes(BERECHTIGUNG_DE));
  assert.equal(text.includes(hinweis("de", ["master"])), false);
  assert.equal(text.includes(ANFANG.de), false);
  assert.equal(anrufe, 1);
});

const FAELLE = [
  { name: "nur master zu", env: { CONSULT_ENABLED: "false" }, allowConsult: true, erwartet: ["master"] },
  { name: "nur kontext zu", env: { ASSISTANT_CONTEXT_ENABLED: "false" }, allowConsult: true, erwartet: ["kontext"] },
  { name: "nur mandant zu", env: {}, allowConsult: false, erwartet: ["mandant"] },
  {
    name: "alle drei zu",
    env: { CONSULT_ENABLED: "false", ASSISTANT_CONTEXT_ENABLED: "false" },
    allowConsult: false,
    erwartet: ["master", "kontext", "mandant"],
  },
  {
    name: "alle vier zu",
    env: { CONSULT_ENABLED: "false", ASSISTANT_CONTEXT_ENABLED: "false", IN_CALL_CONSULT_ENABLED: "false" },
    allowConsult: false,
    erwartet: ["master", "kontext", "mandant", "in_call"],
  },
];

for (const fall of FAELLE) {
  test(`RF-H2-2 ${fall.name}: place_call nennt vor dem Anruf genau die geschlossenen Tore und startet den Anruf`, async () => {
    const { result, anrufe } = await placeCall({
      env: { ...ALLE_OFFEN, ...fall.env },
      allowConsult: fall.allowConsult,
    });
    const text = result.content[0].text;
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.deepEqual(geschlossen(text), fall.erwartet);
    assert.ok(text.includes(hinweis("de", fall.erwartet)));
    assert.equal(text.includes(BERECHTIGUNG_DE), false);
    assert.equal(result.structuredContent.status, "dialing");
    assert.equal(anrufe, 1);
  });
}

test("RF-H2-3 nur das In-Call-Tor zu: place_call nennt in_call neben dem Berechtigungs-Hinweis", async () => {
  const { result, anrufe } = await placeCall({
    env: { ...ALLE_OFFEN, IN_CALL_CONSULT_ENABLED: "false" },
  });
  const text = result.content[0].text;
  assert.deepEqual(geschlossen(text), ["in_call"]);
  assert.ok(text.includes(BERECHTIGUNG_DE));
  assert.ok(text.includes(hinweis("de", ["in_call"])));
  assert.equal(anrufe, 1);
});

for (const sprache of ["en", "fr"]) {
  test(`RF-H2-5 place_call spricht ${sprache}, wenn der Mandant ${sprache} eingestellt hat`, async () => {
    const { result } = await placeCall({
      env: { ...ALLE_OFFEN, CONSULT_ENABLED: "false" },
      defaultLanguage: sprache,
    });
    const text = result.content[0].text;
    assert.ok(text.includes(hinweis(sprache, ["master"])));
    assert.equal(text.includes(hinweis("de", ["master"])), false);
  });
}

async function mehrereToreInSprache(sprache) {
  const { result } = await placeCall({
    env: { ...ALLE_OFFEN, CONSULT_ENABLED: "false" },
    allowConsult: false,
    defaultLanguage: sprache,
  });
  const text = result.content[0].text;
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(text.includes(hinweis(sprache, ["master", "mandant"])));
  assert.equal(text.includes(hinweis("de", ["master", "mandant"])), false);
}

test("RF-H2-6 place_call auf Englisch trennt mehrere geschlossene Tore mit Komma", async () => {
  await mehrereToreInSprache("en");
});

test("RF-H2-7 place_call auf Franzoesisch trennt mehrere geschlossene Tore mit Komma", async () => {
  await mehrereToreInSprache("fr");
});
