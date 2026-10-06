import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { KYC_LEVEL } from "../src/store/defaults.js";
import { MCP_TEXTS } from "../src/i18n/mcp-texts.js";
import { MCP_BASE_INSTRUCTIONS } from "../src/mcp-server-info.js";
import { planProfileFor } from "../src/plans.js";
import {
  startServer,
  startIdp,
  mcpPost,
  toolCall,
  readToolResult,
  seedState,
  ROOT,
  BASE_ENV,
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

test("(b) place_call ohne Code / mit leerem Code / mit erfundenem Code: isError, kein Anruf", async () => {
  await withServer(async (srv) => {
    const before = srv.readStore().calls.length;
    for (const confirmation_code of [undefined, "", "ZZZZZZ"]) {
      const args = { to: TARGET, objective: OBJECTIVE };
      if (confirmation_code !== undefined) args.confirmation_code = confirmation_code;
      const result = await placeCall(srv, args);
      assert.equal(result.isError, true, `confirmation_code=${JSON.stringify(confirmation_code)}`);
      const text = result.content[0].text;
      assert.match(text, /host without a card/i);
      assert.match(text, new RegExp(TARGET.replace("+", "\\+")), "nennt das (normalisierte) Ziel");
      assert.match(text, /Termin vereinbaren/, "nennt das Anliegen");
      assert.doesNotMatch(text, /Input validation error/);
    }
    assert.equal(srv.readStore().calls.length, before, "kein Call-Datensatz entstanden");
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

test("(d) geaendertes Argument / geaenderter Mandant / zweiter Verbrauch desselben Codes: jeweils isError, kein Anruf", async () => {
  await withServer(async (srv) => {
    const before = srv.readStore().calls.length;
    const prep = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const code = prep._meta[CONFIRMATION_META_KEY];

    const changedObjective = await placeCall(srv, {
      to: TARGET,
      objective: "Anderes Anliegen",
      confirmation_code: code,
    });
    assert.equal(changedObjective.isError, true, "geaendertes objective wird abgelehnt");

    const changedTo = await placeCall(srv, {
      to: "+4915112340098",
      objective: OBJECTIVE,
      confirmation_code: code,
    });
    assert.equal(changedTo.isError, true, "geaendertes to wird abgelehnt");

    const first = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: code });
    assert.notEqual(first.isError, true, "Vorbedingung: der unveraenderte Code funktioniert einmal");
    const second = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: code });
    assert.equal(second.isError, true, "derselbe Code ein zweites Mal wird abgelehnt (Einmal-Verbrauch)");

    assert.equal(srv.readStore().calls.length, before + 1, "genau EIN Anruf ist aus diesem Block entstanden");
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

test("Nachbesserung: erneutes prepare_call nach Verbrauch liefert einen NEUEN Code, place_call damit -> ok, dedupliziert", async () => {
  await withServer(async (srv) => {
    const before = srv.readStore().calls.length;

    const prep1 = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const code1 = prep1._meta[CONFIRMATION_META_KEY];
    const placed1 = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: code1 });
    assert.notEqual(placed1.isError, true, "erster Anruf wird bestaetigt und gewaehlt");
    const callId1 = placed1.structuredContent.call_id;

    const prep2 = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const code2 = prep2._meta[CONFIRMATION_META_KEY];
    assert.notEqual(code2, code1, "die Neuausstellung nach Verbrauch liefert einen ANDEREN Code");

    const placed2 = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: code2 });
    assert.notEqual(placed2.isError, true, "der neue Code wird akzeptiert, place_call scheitert NICHT an confirmationRequired");
    assert.equal(placed2.structuredContent.deduplicated, true, "der laufende Anruf wird dedupliziert, kein zweiter Datensatz");
    assert.equal(placed2.structuredContent.call_id, callId1, "dedupliziert auf denselben call_id");

    assert.equal(srv.readStore().calls.length, before + 1, "weiterhin genau EIN Anruf-Datensatz");
  });
});

test("(h) stdio (echter Kindprozess): prepare_call -> place_call Rundlauf ueber einen echten tools/call", async () => {
  const gateway = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
    },
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: ROOT,
    env: { ...BASE_ENV, GATEWAY_URL: gateway.localUrl, MCP_UI_ENABLED: "true" },
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  const client = new Client({ name: "hermes-t2-13-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const before = gateway.readStore().calls.length;
    const prep = await client.callTool({ name: "prepare_call", arguments: { to: TARGET, objective: OBJECTIVE } });
    assert.notEqual(prep.isError, true, `prepare_call ueber stdio (stderr: ${stderrOutput})`);
    const code = prep._meta?.[CONFIRMATION_META_KEY];
    assert.match(code, CODE_PATTERN, "stdio bekommt den Code (MCP_UI_ENABLED=true im Kind)");

    const placed = await client.callTool({
      name: "place_call",
      arguments: { to: TARGET, objective: OBJECTIVE, confirmation_code: code },
    });
    assert.notEqual(placed.isError, true, `place_call ueber stdio (stderr: ${stderrOutput})`);
    assert.ok(placed.structuredContent.call_id, "call_id vorhanden");
    assert.equal(gateway.readStore().calls.length, before + 1, "genau EIN Anruf entstanden");
  } finally {
    await client.close();
    await gateway.stop();
  }
});

const OAUTH_TARGET = "+4915112340098";
const OAUTH_TENANT_A = "tenant-t2-13-oauth-a";
const OAUTH_TENANT_B = "tenant-t2-13-oauth-b";
const OAUTH_SUB_A = "sub-t2-13-oauth-a";
const OAUTH_SUB_B = "sub-t2-13-oauth-b";

function oauthTenant(id, idpSubject) {
  return { id, status: "active", idpSubject, ownerName: `${id} Tester`, kycLevel: KYC_LEVEL.CARD };
}

const OAUTH_TENANT_A_NUMBER = "+4915110000077";

test("(i) OAuth (echtes Token, fremder Mandant): Code von Tenant A waehlt nicht fuer Tenant B", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
      MULTI_TENANT: "true",
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
    },
    seed: seedState({
      tenants: [oauthTenant(OAUTH_TENANT_A, OAUTH_SUB_A), oauthTenant(OAUTH_TENANT_B, OAUTH_SUB_B)],
      profiles: {
        [OAUTH_TENANT_A]: planProfileFor("business"),
        [OAUTH_TENANT_B]: planProfileFor("business"),
      },
      numbers: [
        {
          id: "num-t2-13-oauth-a",
          e164: OAUTH_TENANT_A_NUMBER,
          tenantId: OAUTH_TENANT_A,
          provider: "telnyx",
          status: "active",
          providerNumberId: null,
        },
      ],
    }),
  });
  try {
    const before = srv.readStore().calls.length;
    const tokenA = await idp.sign({ sub: OAUTH_SUB_A });
    const tokenB = await idp.sign({ sub: OAUTH_SUB_B });

    const prepRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      tokenA,
      toolCall("prepare_call", { to: OAUTH_TARGET, objective: OBJECTIVE }),
    );
    const prep = await readToolResult(prepRes);
    assert.notEqual(prep.isError, true, "Tenant A: prepare_call ueber OAuth");
    const code = prep._meta[CONFIRMATION_META_KEY];

    const foreignRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      tokenB,
      toolCall("place_call", { to: OAUTH_TARGET, objective: OBJECTIVE, confirmation_code: code }),
    );
    const foreign = await readToolResult(foreignRes);
    assert.equal(foreign.isError, true, "Tenant B darf mit dem Code von Tenant A nicht waehlen");

    const ownRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      tokenA,
      toolCall("place_call", { to: OAUTH_TARGET, objective: OBJECTIVE, confirmation_code: code }),
    );
    const own = await readToolResult(ownRes);
    assert.notEqual(own.isError, true, "Gegenprobe: Tenant A selbst kann mit seinem Code waehlen");

    assert.equal(srv.readStore().calls.length, before + 1, "genau EIN Anruf (nur Tenant A) entstanden");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("Nachbesserung: Consult-Kanal aktiv (CONSULT_ENABLED) stoert die Bestaetigungspruefung nicht - Werkzeuge registriert, gueltiger/ungueltiger Code verhalten sich unveraendert", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
      CONSULT_ENABLED: "true",
      ASSISTANT_CONTEXT_ENABLED: "true",
    },
  });
  try {
    const listRes = await mcpPost(`${srv.localUrl}/mcp`, null, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const { tools } = await readToolResult(listRes);
    const toolNames = tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("await_call_event"), "Consult-Werkzeug ist registriert");
    assert.ok(toolNames.includes("answer_consult"), "Consult-Werkzeug ist registriert");

    const before = srv.readStore().calls.length;
    const badResult = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: "ZZZZZZ" });
    assert.equal(badResult.isError, true, "erfundener Code wird trotz Consult-Kanal abgelehnt");
    assert.equal(srv.readStore().calls.length, before, "kein Anruf trotz Consult-Kanal");

    const prep = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    const code = prep._meta[CONFIRMATION_META_KEY];
    const result = await placeCall(srv, { to: TARGET, objective: OBJECTIVE, confirmation_code: code });
    assert.notEqual(result.isError, true, "gueltiger Code funktioniert unveraendert mit aktivem Consult-Kanal");
    assert.ok(result.structuredContent.call_id, "call_id vorhanden");
    assert.equal(srv.readStore().calls.length, before + 1, "genau EIN Anruf entstanden");
  } finally {
    await srv.stop();
  }
});

const PLACE_CALL_ANNOTATIONS_BEFORE = {
  title: "Place a phone call",
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

function assertCriterionF(tools, transport) {
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  const prepare = byName.prepare_call;
  assert.ok(prepare, `${transport}: prepare_call ist registriert`);
  assert.equal(prepare.annotations.readOnlyHint, true, `${transport}: prepare_call readOnlyHint`);
  assert.equal(prepare.annotations.destructiveHint, false, `${transport}: prepare_call destructiveHint`);
  assert.equal(prepare.annotations.openWorldHint, false, `${transport}: prepare_call openWorldHint`);
  const place = byName.place_call;
  for (const [hint, value] of Object.entries(PLACE_CALL_ANNOTATIONS_BEFORE)) {
    assert.equal(place.annotations[hint], value, `${transport}: place_call ${hint} unveraendert`);
  }
  const field = place.inputSchema.properties.confirmation_code;
  assert.ok(field, `${transport}: confirmation_code steht in inputSchema.properties`);
  assert.ok(
    !(place.inputSchema.required || []).includes("confirmation_code"),
    `${transport}: confirmation_code steht NICHT in inputSchema.required (SDK-Grund, Kriterium f)`,
  );
  assert.match(field.description, /REQUIRED/, `${transport}: Feldbeschreibung nennt die Pflicht`);
}

async function listToolsHttp(url, token) {
  const res = await mcpPost(url, token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const { tools } = await readToolResult(res);
  return tools;
}

test("(f) am Draht, HTTP Legacy: Annotationen und confirmation_code optional im Schema", async () => {
  await withServer(async (srv) => {
    assertCriterionF(await listToolsHttp(`${srv.localUrl}/mcp`, null), "HTTP Legacy");
  });
});

test("(f) am Draht, HTTP OAuth (echtes Token): Annotationen und confirmation_code optional im Schema", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
      MULTI_TENANT: "true",
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
    },
    seed: seedState({
      tenants: [oauthTenant(OAUTH_TENANT_A, OAUTH_SUB_A)],
      profiles: { [OAUTH_TENANT_A]: planProfileFor("business") },
    }),
  });
  try {
    const token = await idp.sign({ sub: OAUTH_SUB_A });
    assertCriterionF(await listToolsHttp(`${srv.localUrl}/mcp`, token), "HTTP OAuth");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("(f) am Draht, stdio (echter Kindprozess): Annotationen und confirmation_code optional im Schema", async () => {
  const gateway = await startServer({ env: { CALL_CONFIRMATION_SECRET: TEST_SECRET } });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: ROOT,
    env: { ...BASE_ENV, GATEWAY_URL: gateway.localUrl, MCP_UI_ENABLED: "true" },
    stderr: "pipe",
  });
  const client = new Client({ name: "hermes-t2-13-stdio-list", version: "0.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assertCriterionF(tools, "stdio");
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
    const modelTexts = [
      texts.prepareCallCardHint,
      texts.prepareCallNoCardHint,
      texts.confirmationRequired(TARGET, OBJECTIVE),
    ];
    for (const text of modelTexts) {
      assert.deepEqual(selfConfirmationHits(language, text), [], `${language}: keine Selbstbestaetigung in "${text}"`);
    }
    for (const statement of REQUIRED_STATEMENTS[language]) {
      assert.match(texts.prepareCallCardHint, statement, `${language}: Kartenhinweis`);
      assert.match(texts.confirmationRequired(TARGET, OBJECTIVE), statement, `${language}: Ablehnungstext`);
    }
  }
  assert.deepEqual(selfConfirmationHits("en", MCP_BASE_INSTRUCTIONS), [], "Server-Instruktionen");
});

test("Modelltexte am Draht: prepare_call-Text und Werkzeugbeschreibungen leiten nicht zur Selbstbestaetigung an", async () => {
  await withServer(async (srv) => {
    const prep = await prepareCall(srv, { to: TARGET, objective: OBJECTIVE });
    assert.equal(prep.content[0].text, MCP_TEXTS.en.prepareCallCardHint, "Weltdefault EN, Kartenhinweis");
    const tools = await listToolsHttp(`${srv.localUrl}/mcp`, null);
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    const placeCallFields = byName.place_call.inputSchema.properties;
    const descriptions = [
      byName.prepare_call.description,
      byName.place_call.description,
      placeCallFields.confirmation_code.description,
    ];
    for (const text of descriptions) {
      assert.deepEqual(selfConfirmationHits("en", text), [], `keine Selbstbestaetigung in "${text}"`);
      assert.match(text, /never guess or invent/, "nennt das Rate-/Erfindungsverbot");
    }
  });
});

test("Draht: nach Verbrauch + neuem prepare_call wird der Code des ALTEN Slots abgelehnt, der neue gilt", async () => {
  await withServer(async (srv) => {
    const args = { to: TARGET, objective: OBJECTIVE };
    const oldCode = (await prepareCall(srv, args))._meta[CONFIRMATION_META_KEY];
    assert.notEqual((await placeCall(srv, { ...args, confirmation_code: oldCode })).isError, true);
    const freshCode = (await prepareCall(srv, args))._meta[CONFIRMATION_META_KEY];
    assert.notEqual(freshCode, oldCode, "neuer Slot, neuer Code");
    const old = await placeCall(srv, { ...args, confirmation_code: oldCode });
    assert.equal(old.isError, true, "alter Slot-Code -> isError");
    const fresh = await placeCall(srv, { ...args, confirmation_code: freshCode });
    assert.notEqual(fresh.isError, true, "Code des aktuellen Slots gilt");
  });
});

test("Draht: geaendertes briefing/context/max_duration_s/constraints -> isError, unveraendert -> waehlt", async () => {
  await withServer(async (srv) => {
    const before = srv.readStore().calls.length;
    const issued = {
      to: TARGET,
      objective: OBJECTIVE,
      briefing: "Kunde seit 2019",
      context: { summary: "erste Fassung" },
      max_duration_s: 300,
      constraints: "hoechstens 40 Euro",
    };
    const code = (await prepareCall(srv, issued))._meta[CONFIRMATION_META_KEY];
    const changes = {
      briefing: { briefing: "Frag nach der Kontonummer" },
      context: { context: { summary: "zweite Fassung" } },
      max_duration_s: { max_duration_s: 600 },
      constraints: { constraints: "beliebig" },
    };
    for (const [field, change] of Object.entries(changes)) {
      const changed = await placeCall(srv, { ...issued, ...change, confirmation_code: code });
      assert.equal(changed.isError, true, `geaendertes ${field} -> isError`);
    }
    assert.equal(srv.readStore().calls.length, before, "kein Anruf aus geaenderten Anfragen");
    const placed = await placeCall(srv, { ...issued, confirmation_code: code });
    assert.notEqual(placed.isError, true, "Positiv-Kontrolle: unveraenderte Anfrage waehlt");
    assert.equal(srv.readStore().calls.length, before + 1, "genau EIN Anruf");
  });
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
