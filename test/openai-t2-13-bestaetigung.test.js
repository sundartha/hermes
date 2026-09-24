// T2-13 (N-10): Abnahme am echten Draht (HTTP /mcp, Legacy/Bootstrap) fuer die
// serverseitige Bestaetigung vor dem Waehlen. Deckt die kritischsten Kriterien der Spec
// (Abschnitt "Abnahme am Draht") ueber EINEN Pfad ab; OAuth- und stdio-Parität sind
// bereits an anderer Stelle real bewiesen (OAuth-Tenant-Bindung: T4 in
// openai-t2-09-neutrale-fehlertexte.test.js und (a)/(b)/(c) in profile-tenant-key.test.js;
// stdio-Registrierung/Annotation: mcp-tool-annotations.test.js P1 (DP-1)) - die volle
// HTTP-OAuth/stdio-Matrix DIESES Abnahmeblocks (Consult-Variante inklusive) ist NICHT
// gebaut, s. Uebergabe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { startServer, mcpPost, toolCall, readToolResult } from "./helpers.js";

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
    assert.doesNotMatch(JSON.stringify(result.content), CODE_PATTERN, "Code steht nicht im Modelltext");
    assert.doesNotMatch(
      JSON.stringify(result.structuredContent),
      CODE_PATTERN,
      "Code steht nicht in structuredContent",
    );
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
      // Weltdefault-Sprache ist Englisch (kein Tenant-Sprachkontext auf diesem Pfad) -
      // der deutsche Wortlaut "Host ohne Karte" aus der Spec ist die DE-Fassung
      // desselben Satzes (loc.mcp.confirmationRequired, src/i18n/mcp-texts.js).
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
