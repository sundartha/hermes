import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";
import { mcpPost, readToolResult, toolCall } from "../helpers.js";
import { starteLokaleUmgebung } from "../../scripts/last/umgebung.mjs";

const ENDSTATUS = ["completed", "failed", "cancelled", "no_answer", "busy"];
const ANRUF_FRIST_MS = 20_000;
const TESTFRIST = { timeout: 30_000 };

async function rufeWerkzeugAuf({ ziel, token }, name, argumente) {
  const antwort = await mcpPost(`${ziel}/mcp`, token, toolCall(name, argumente));
  return readToolResult(antwort);
}

async function warteAufEndstatus(mcp, callId) {
  const deadline = Date.now() + ANRUF_FRIST_MS;
  let stand;
  do {
    stand = (await rufeWerkzeugAuf(mcp, "get_call_status", { call_id: callId })).structuredContent;
    assert.ok(Date.now() < deadline, `Anruf endete nicht rechtzeitig: ${JSON.stringify(stand)}`);
  } while (!ENDSTATUS.includes(stand?.status));
  return stand;
}

test(
  "Lastlauf-Ablauf place_call -> anruf_status -> anruf_ergebnis: der Vorspann-Weg der Lastlauf-Umgebung liefert eine Anruf-Nummer und der Anruf endet",
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const umgebung = await starteLokaleUmgebung({});
    t.after(() => umgebung.schliessen());
    const mcp = { ziel: umgebung.ziele[0], token: umgebung.konfiguration.tokens[0] };

    const gestartet = await rufeWerkzeugAuf(mcp, "place_call", {
      to: "+4915112340001",
      objective: "Lastlauf-Testanruf",
    });
    assert.equal(gestartet.isError, undefined, "place_call gelingt gegen die Lastlauf-Attrappe (keine abgelehnte Anmeldung)");
    const callId = gestartet.structuredContent?.call_id;
    assert.ok(callId, "place_call liefert eine Anruf-Nummer");

    const endstand = await warteAufEndstatus(mcp, callId);
    assert.equal(endstand.status, "completed", "der simulierte Anruf wird angenommen und sauber beendet");

    const ergebnis = await rufeWerkzeugAuf(mcp, "get_call_result", { call_id: callId });
    assert.equal(ergebnis.isError, undefined, "get_call_result liefert nach dem Ende kein Fehlerergebnis");
    assert.equal(ergebnis.structuredContent?.call_id, callId);
  },
  TESTFRIST,
);
