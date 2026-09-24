// E3 (S3-A1/T-27): der place_call-Hop braucht eine Frist, die STRUKTURELL groesser ist als
// das Vorwahl-Budget des Servers (Klingelphase + Briefing + Eroeffnungszeile, je ohne
// Backoff), sonst kappt ein Zeitablauf einen Anrufstart, der tatsaechlich zustande kommt.
// Reiner Import, kein Server, kein Netz (P12 R/F).
import test from "node:test";
import assert from "node:assert/strict";
import {
  registerTools,
  PLACE_CALL_HOP_TIMEOUT_MS,
} from "../src/mcp-tools.js";
import { MCP_TEXTS } from "../src/i18n/mcp-texts.js";
import { SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { config } from "../src/config.js";
import { REQUEST_TIMEOUT_MS } from "../src/elevenlabs/convai.js";
import { DEDUP_WINDOW_MS, findDuplicateOutboundCall } from "../src/telephony/call-dedup.js";

// G25: benannte Konstanten statt Magic Numbers.
const BRIEFING_STEPS = 2; // Briefing + Eroeffnungszeile, je EINMAL, kein Backoff (s.o.)
const ONE_SECOND_MS = 1000;
const FIVE_SECONDS_MS = 5000;

function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    // Einziger Registrierweg ist registerTool (src/mcp-tools.js uiTool); ein
    // server.tool()-Aufruf wuerde hier absichtlich mit TypeError scheitern.
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

// ==================== 1: strukturelle Ungleichung, aus der LIVE-config gerechnet ====================
test("1: PLACE_CALL_HOP_TIMEOUT_MS liegt STRUKTURELL ueber dem Vorwahl-Budget des Servers", () => {
  // Positiv-Kontrolle: ohne sie priefte die Ungleichung unten nichts (beide Summanden > 0).
  assert.ok(REQUEST_TIMEOUT_MS > 0, "REQUEST_TIMEOUT_MS muss positiv sein");
  assert.ok(config.llm.briefingTimeoutMs > 0, "config.llm.briefingTimeoutMs muss positiv sein");

  const vorwahlBudget = REQUEST_TIMEOUT_MS + BRIEFING_STEPS * config.llm.briefingTimeoutMs;
  assert.ok(
    PLACE_CALL_HOP_TIMEOUT_MS > vorwahlBudget,
    `PLACE_CALL_HOP_TIMEOUT_MS (${PLACE_CALL_HOP_TIMEOUT_MS}) muss > Vorwahl-Budget (${vorwahlBudget}) sein`,
  );
});

// ==================== 2: Fenster >= Frist ====================
test("2: DEDUP_WINDOW_MS ist mindestens so gross wie PLACE_CALL_HOP_TIMEOUT_MS", () => {
  assert.ok(
    DEDUP_WINDOW_MS >= PLACE_CALL_HOP_TIMEOUT_MS,
    "ein Host-Retry NACH unserem Fristablauf muss noch im Dedup-Fenster landen",
  );
});

// ==================== 3: Abbruch-Zweig, 3 Sprachen ====================
test("3: ein Zeitablauf auf place_call wird zu call_start_unconfirmed, sprachabhaengig", async () => {
  const prevFetch = globalThis.fetch;
  // T2-13 (N-10): der vorgeschaltete Bestaetigungs-Hop (POST /api/call-confirmations)
  // muss ERFOLGREICH antworten, sonst zeitablaeuft schon ER (mit dem generischen
  // HOP_TIMEOUT-Text) - der hier eigentlich gepruefte Zeitablauf gehoert zum ECHTEN
  // Anrufstart (POST /api/calls, PLACE_CALL_HOP_TIMEOUT_MS/CALL_START_UNCONFIRMED).
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/call-confirmations")) {
      return { ok: true, status: 200, json: async () => ({ preview: {}, confirmed: true }) };
    }
    const err = new Error("timed out");
    err.name = "TimeoutError";
    throw err;
  };
  try {
    for (const language of SUPPORTED_LANGUAGES) {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant_hopfrist", language });
      const result = await handlers.get("place_call")({ to: "+491511234", objective: "Test" });
      assert.equal(result.isError, true, `language=${language} muss isError sein`);
      const expected = MCP_TEXTS[language].errors.call_start_unconfirmed;
      assert.equal(result.content[0].text, expected, `language=${language}`);
    }
  } finally {
    globalThis.fetch = prevFetch;
  }
});

// ==================== 4: Gegenprobe - ein anderer Fehlername darf NICHT diesen Text tragen ====================
test("4: ein TypeError bleibt bei seiner eigenen Meldung (Gegenprobe zu isAbortError)", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("network down");
  };
  try {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant_hopfrist2", language: "de" });
    const result = await handlers.get("place_call")({ to: "+491511234", objective: "Test" });
    assert.equal(result.isError, true);
    assert.notEqual(result.content[0].text, MCP_TEXTS.de.errors.call_start_unconfirmed);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

// ==================== 5: findDuplicateOutboundCall - Unit-Tabelle ====================
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const IM_FENSTER = new Date(NOW - ONE_SECOND_MS).toISOString();
const AUSSER_FENSTER = new Date(NOW - DEDUP_WINDOW_MS - ONE_SECOND_MS).toISOString();

test("5: findDuplicateOutboundCall - Treffer, Richtung, Ziel, Fenster, Eingabe-Robustheit", () => {
  const treffer = { direction: "outbound", to: "+491511111111", startedAt: IM_FENSTER };
  assert.equal(
    findDuplicateOutboundCall([treffer], { to: "+491511111111", nowMs: NOW }),
    treffer,
    "Treffer im Fenster",
  );

  const inbound = { direction: "inbound", to: "+491511111111", startedAt: IM_FENSTER };
  assert.equal(
    findDuplicateOutboundCall([inbound], { to: "+491511111111", nowMs: NOW }),
    null,
    "falsche Richtung darf nicht treffen",
  );

  const anderesZiel = { direction: "outbound", to: "+491522222222", startedAt: IM_FENSTER };
  assert.equal(
    findDuplicateOutboundCall([anderesZiel], { to: "+491511111111", nowMs: NOW }),
    null,
    "anderes Ziel darf nicht treffen",
  );

  const ausserFenster = { direction: "outbound", to: "+491511111111", startedAt: AUSSER_FENSTER };
  assert.equal(
    findDuplicateOutboundCall([ausserFenster], { to: "+491511111111", nowMs: NOW }),
    null,
    "ausserhalb des Fensters darf nicht treffen",
  );

  const kaputtesStartedAt = { direction: "outbound", to: "+491511111111", startedAt: "quatsch" };
  assert.equal(
    findDuplicateOutboundCall([kaputtesStartedAt], { to: "+491511111111", nowMs: NOW }),
    null,
    "fehlendes/unparsebares startedAt zaehlt nicht ins Fenster",
  );

  assert.equal(findDuplicateOutboundCall([], { to: "+491511111111", nowMs: NOW }), null, "leere Liste");

  const aelter = { direction: "outbound", to: "+491511111111", startedAt: new Date(NOW - FIVE_SECONDS_MS).toISOString() };
  const neuer = { direction: "outbound", to: "+491511111111", startedAt: new Date(NOW - ONE_SECOND_MS).toISOString() };
  assert.equal(
    findDuplicateOutboundCall([aelter, neuer], { to: "+491511111111", nowMs: NOW }),
    neuer,
    "bei zwei Treffern gewinnt der juengste",
  );

  assert.equal(
    findDuplicateOutboundCall([treffer], { to: "", nowMs: NOW }),
    null,
    "leeres to darf nicht treffen",
  );
  assert.equal(
    findDuplicateOutboundCall(null, { to: "+491511111111", nowMs: NOW }),
    null,
    "Nicht-Array darf nicht werfen",
  );
});
