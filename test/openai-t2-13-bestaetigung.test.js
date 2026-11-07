import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { MCP_TEXTS } from "../src/i18n/mcp-texts.js";
import { MCP_BASE_INSTRUCTIONS } from "../src/mcp-server-info.js";
import {
  startServer,
  mcpPost,
  toolCall,
  readToolResult,
  stdioServerTransport,
} from "./helpers.js";

const TEST_SECRET = "openai-t2-13-abnahme-test-secret-mind-32-zeichen";
const TARGET = "+4915112340099";
const OBJECTIVE = "Termin vereinbaren";
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const CONFIRMATION_META_KEY = "hermes/confirmation_code";

async function withServer(run) {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
    },
  });
  try {
    await run(srv);
  } finally {
    await srv.stop();
  }
}

async function prepareCall(srv, args) {
  const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("prepare_call", args));
  return readToolResult(res);
}

async function placeCall(srv, args) {
  const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", args));
  return readToolResult(res);
}

function sha256OfFile(path) {
  return createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}

test("(a) prepare_call: Code in _meta, NICHT in content/structuredContent; structuredContent.to normalisiert", async () => {
  await withServer(async (srv) => {
    const result = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    assert.notEqual(result.isError, true, "prepare_call darf kein isError sein");
    const code = result._meta?.[CONFIRMATION_META_KEY];
    assert.match(code, CODE_PATTERN, "der Code passt auf das Crockford-Base32-Alphabet, Laenge 6");
    assert.ok(!JSON.stringify(result.content).includes(code), "Code steht nicht im Modelltext");
    assert.ok(
      !JSON.stringify(result.structuredContent).includes(code),
      "Code steht nicht in structuredContent",
    );
    assert.ok(JSON.stringify({ leak: code }).includes(code), "Positiv-Kontrolle: includes() findet einen eingebauten Code");
    assert.equal(result.structuredContent.status, "awaiting_confirmation");
    assert.equal(result.structuredContent.to, TARGET, "to bleibt E.164 (bereits normalisiert eingegeben)");
  });
});

test("(c) gueltiger Code: place_call waehlt, call_id vorhanden, danach get_call_status funktioniert", async () => {
  await withServer(async (srv) => {
    const prep = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const confirmation_code = prep._meta[CONFIRMATION_META_KEY];
    const result = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent.call_id, "call_id vorhanden");
    const statusRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("get_call_status", { call_id: result.structuredContent.call_id }),
    );
    const status = await readToolResult(statusRes);
    assert.notEqual(status.isError, true, "get_call_status funktioniert mit dieser call_id");
  });
});

test("(e) prepare_call veraendert den Store nicht (sha256 vorher/nachher gleich), keine Codewert-Spur im Log", async () => {
  await withServer(async (srv) => {
    const storePath = srv.dataDir ? `${srv.dataDir}/store.json` : null;
    const before = storePath && fs.existsSync(storePath) ? sha256OfFile(storePath) : null;
    const result = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const code = result._meta[CONFIRMATION_META_KEY];
    if (before) {
      const after = sha256OfFile(storePath);
      assert.equal(after, before, "prepare_call schreibt nichts in den Store");
    }
    assert.doesNotMatch(srv.stdout + srv.stderr, new RegExp(code), "der Codewert steht in keiner Server-Logzeile");
  });
});

test("(f) gueltiger Code umgeht kein Gate: OUTBOUND_FROZEN lehnt weiterhin ab, kein Anruf", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
      OUTBOUND_FROZEN: "true",
    },
  });
  try {
    const before = srv.readStore().calls.length;
    const prep = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const code = prep._meta[CONFIRMATION_META_KEY];
    const result = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: code });
    assert.equal(result.isError, true, "OUTBOUND_FROZEN blockt trotz gueltigem Code");
    assert.equal(srv.readStore().calls.length, before, "kein Anruf trotz gueltigem Code");
  } finally {
    await srv.stop();
  }
});

test("(g) ohne CALL_CONFIRMATION_SECRET: prepare_call ist isError, kein Anruf moeglich", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true", ALLOWED_COUNTRY_CODES: "*", MCP_UI_ENABLED: "true" },
  });
  try {
    const result = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    assert.equal(result.isError, true, "ohne Secret ist prepare_call isError");
    assert.doesNotMatch(result.content[0].text, /CALL_CONFIRMATION_SECRET/, "kein Env-Name im Client-Text");
  } finally {
    await srv.stop();
  }
});

test("(h) stdio (echter Kindprozess): prepare_call -> place_call Rundlauf ueber einen echten tools/call", async () => {
  const gateway = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
    },
  });
  const { transport, stderr } = stdioServerTransport({ GATEWAY_URL: gateway.localUrl, MCP_UI_ENABLED: "true" });
  const client = new Client({ name: "hermes-t2-13-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const before = gateway.readStore().calls.length;
    const prep = await client.callTool({ name: "prepare_call", arguments: { to: TARGET, objective: OBJECTIVE } });
    assert.notEqual(prep.isError, true, `prepare_call ueber stdio (stderr: ${stderr.text})`);
    const code = prep._meta?.[CONFIRMATION_META_KEY];
    assert.match(code, CODE_PATTERN, "stdio bekommt den Code (MCP_UI_ENABLED=true im Kind)");

    const placed = await client.callTool({
      name: "place_call",
      arguments: { to: TARGET, objective: OBJECTIVE, confirmation_code: code },
    });
    assert.notEqual(placed.isError, true, `place_call ueber stdio (stderr: ${stderr.text})`);
    assert.ok(placed.structuredContent.call_id, "call_id vorhanden");
    assert.equal(gateway.readStore().calls.length, before + 1, "genau EIN Anruf entstanden");
  } finally {
    await client.close();
    await gateway.stop();
  }
});

const SELF_CONFIRMATION_PATTERNS = {
  de: [/\bCode\b[^.;]*\b(pruefen|ablesen|lesen|abschreiben|uebernehmen)\b/i, /\b(pruefe|lies)\b[^.;]*\bCode\b/i],
  en: [/\b(check|read|look at|copy|take)\b[^.;]*\bcode\b/i, /\breveals?\b[^.;]*\bcode\b/i],
  fr: [/\b(vérifiez|lisez|copiez|relevez)\b[^.;]*\bcode\b/i],
};
const REQUIRED_STATEMENTS = {
  de: [/Nutzer[^.]*bestaetig/, /nie einen Code raten oder erfinden/],
  en: [/\buser\b[^.]*confirms?/, /never guess or invent/],
  fr: [/utilisateur[^.]*confirme/, /ne devinez ni n'inventez jamais/],
};
const OLD_CARD_HINTS = {
  de: "Vorschau erstellt. Zum Bestaetigen den Code in der Hermes-Karte pruefen und mit place_call (gleiche Angaben) erneut aufrufen.",
  en: "Preview created. To confirm, check the code in the Hermes card and call place_call again with the same arguments.",
  fr: "Aperçu créé. Pour confirmer, vérifiez le code dans la carte Hermes puis rappelez place_call avec les mêmes arguments.",
};

function selfConfirmationHits(language, text) {
  return SELF_CONFIRMATION_PATTERNS[language].filter((pattern) => pattern.test(text));
}

test("Modelltexte je Sprache: keine Anleitung zur Selbstbestaetigung, Nutzer bestaetigt, nie raten (Positiv-Kontrolle: alter Text wird erkannt)", () => {
  const languages = Object.keys(MCP_TEXTS);
  assert.deepEqual(languages.sort(), Object.keys(SELF_CONFIRMATION_PATTERNS).sort(), "jede Sprache hat Muster");
  for (const language of languages) {
    assert.ok(selfConfirmationHits(language, OLD_CARD_HINTS[language]).length > 0, `${language}: alter Text wird erkannt`);
    const texts = MCP_TEXTS[language];
    const modelTexts = [texts.prepareCallCardHint, texts.prepareCallNoCardHint];
    for (const text of modelTexts) {
      assert.deepEqual(selfConfirmationHits(language, text), [], `${language}: keine Selbstbestaetigung in "${text}"`);
    }
    for (const statement of REQUIRED_STATEMENTS[language]) {
      assert.match(texts.prepareCallCardHint, statement, `${language}: Kartenhinweis`);
    }
  }
  assert.deepEqual(selfConfirmationHits("en", MCP_BASE_INSTRUCTIONS), [], "Server-Instruktionen");
});

test("Boot: zu kurzes CALL_CONFIRMATION_SECRET -> Warnung ohne Wert, prepare_call fail-closed", async () => {
  const shortSecret = "kurzesGeheimnisT213";
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true", MCP_UI_ENABLED: "true", CALL_CONFIRMATION_SECRET: shortSecret },
  });
  try {
    const prep = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    assert.equal(prep.isError, true, "kein Schluessel -> prepare_call isError");
    assert.equal(prep._meta?.[CONFIRMATION_META_KEY], undefined, "kein Code");
    const logs = srv.stdout + srv.stderr;
    assert.match(logs, /CALL_CONFIRMATION_SECRET ist kuerzer als/, "Boot-Warnung fuer zu kurzes Geheimnis");
    assert.ok(!logs.includes(shortSecret), "der Wert steht in keiner Logzeile");
  } finally {
    await srv.stop();
  }
});
