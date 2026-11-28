import assert from "node:assert/strict";
import { test } from "node:test";

Object.assign(process.env, {
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
});

const { starteHermesMitPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "postfach@kv2.invalid", vorspannWahlAbgelehnt: true });
const { KOSTENPROFIL } = await import("../../src/billing/kostenarten.ts");
const { EL_CALL_BINDING_SIP_HEADER } = await import("../../src/elevenlabs/inbound-sip-uri.ts");
const { INIT_TOKEN_HEADER, ELEVENLABS_INIT_PATH } = await import("../../src/routes/webhooks-elevenlabs-init.ts");
const { H7C2B4B2_BINDUNGS_TOKEN } = await import("../gemeinsam/erfundene-geheimnisse.js");
const { EL_INBOUND_ACCESS_BOOT_ENV } = await import("../helpers.js");
const { makePgStore } = await import("../pg-helpers.js");
const store = await import("../../src/store.js");

const HTTP_OK = 200;
const ABSENDER = "+4930555000330";
const ZIEL_PORTUGAL = "+351912345678";
const KI_HINWEIS_DE = /KI-Assistent/;

async function anrufEinerAnderenInstanz(db, ueber, bindung) {
  const [mandant] = store.load().tenants;
  mandant.defaultLanguage = "en";
  const runner = { withClient: (arbeit) => arbeit({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }) };
  const fremd = makePgStore(runner);
  await fremd.init();
  const tenantId = mandant.id;
  const call = fremd.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL_PORTUGAL, goal: "Test", tenantId, provider: "telnyx", ...ueber });
  Object.assign(call, {
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: "2026-11-28T10:00:00.000Z",
    streamToken: bindung,
  });
  await fremd.persistCall(call.id);
  return call;
}

async function initAntwort(hermes, bindung) {
  const antwort = await hermes.anfrage(ELEVENLABS_INIT_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", [INIT_TOKEN_HEADER]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN },
    body: JSON.stringify({
      agent_id: "agent_kv2",
      conversation_id: "conv_anrufsprache_pg",
      called_number: ABSENDER,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: bindung },
    }),
  });
  const text = await antwort.text();
  assert.equal(antwort.status, HTTP_OK, text);
  return JSON.parse(text);
}

test("anrufsprache-pg-1: ein ausdruecklich gewaehltes de an +351 hat nach dem Laden aus Postgres Pflichtsatz und agent.language de", async () => {
  const hermes = laufendesHermes();
  await anrufEinerAnderenInstanz(hermes.db, { language: "de", languageExplicit: true }, H7C2B4B2_BINDUNGS_TOKEN);
  const antwort = await initAntwort(hermes, H7C2B4B2_BINDUNGS_TOKEN);
  assert.equal(antwort.conversation_config_override.agent.language, "de");
  assert.match(antwort.dynamic_variables.eroeffnung, KI_HINWEIS_DE, JSON.stringify(antwort.dynamic_variables));
});

test("anrufsprache-pg-2: ohne ausdrueckliche Wahl bleibt der Pflichtsatz nach dem Laden aus Postgres bei der Mandantensprache en", async () => {
  const hermes = laufendesHermes();
  await anrufEinerAnderenInstanz(hermes.db, {}, `${H7C2B4B2_BINDUNGS_TOKEN}-ohne-wahl`);
  const antwort = await initAntwort(hermes, `${H7C2B4B2_BINDUNGS_TOKEN}-ohne-wahl`);
  assert.match(antwort.dynamic_variables.eroeffnung, /^Hello, this is an AI assistant/, JSON.stringify(antwort.dynamic_variables));
});
