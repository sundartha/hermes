// Phase 3.3: Audit-Logging - jede sicherheitsrelevante Aktion erzeugt genau
// eine [audit]-Zeile mit Aktion + Quell-IP, ohne Secrets im Log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, externalIp, seedState, seedCall, waitForLog } from "./helpers.js";
import { maskNumber } from "../src/util.js";

const EXTERNAL_IP = externalIp();
const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const countMatches = (text, re) => (text.match(new RegExp(re, "g")) || []).length;
const sternImMuster = (text) => text.replace(/\*/g, "\\*");

test("Audit-Zeilen fuer Call-Aktionen und Settings", async (t) => {
  // Offline-Diskriminator: 500 = alle Gates passiert (originateCall wirft ohne
  // TELNYX_API_KEY, s. BASE_ENV in helpers.js) - die Audit-Zeile steht da schon im Log.
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "+4915112345678" },
    // E3: eigenes Ziel fuer den Seed-Call, ANDERS als das der ersten Subtest-Wahl
    // (+4915112345678) - sonst waere der Seed-Call (status "active") ein Dedup-Treffer
    // fuer den frischen place_call unten, und die Subtest-Antwort waere 200
    // (dedupliziert) statt 500 (Offline-Diskriminator). Der Cancel-Subtest greift ueber
    // die id, nicht ueber "to" - unberuehrt.
    seed: seedState({ calls: [seedCall({ id: "call_audit1", to: "+4915199999999" })] }),
  });
  try {
    await t.test("place_call: genau eine Zeile mit Aktion + IP + Ziel", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls`, {
        to: "+4915112345678",
        objective: "Termin",
      });
      assert.equal(res.status, 500); // Twilio-Client wirft (nicht-AC SID) - Audit kam davor
      await waitForLog(srv, new RegExp(`\\[audit\\] place_call ip=\\S+ to=${sternImMuster(maskNumber("+4915112345678"))}`));
      assert.equal(
        countMatches(srv.stdout, `\\[audit\\] place_call ip=\\S+ to=${sternImMuster(maskNumber("+4915112345678"))}`),
        1,
      );
      assert.equal(srv.stdout.includes("4915112345678"), false);
    });

    // Denylist-Ablehnung statt Allowlist: seit dem Owner-Boot-Seed (id_verified, Phase
    // outbound-p1) passiert der Owner das Allowlist-Gate ueber Pfad 2 (Subscriber) -> der
    // grund=allowlist-Pfad ist fuer ihn nicht mehr erreichbar. Die Denylist bleibt ein
    // HARTES Gate -> ein Premium-Ziel wird weiter abgewiesen UND auditiert (eine Zeile).
    await t.test("place_call_denied: Denylist-Ablehnung wird auditiert", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls`, {
        to: "+4990012345678",
        objective: "Termin",
      });
      assert.equal(res.status, 403);
      await waitForLog(
        srv,
        new RegExp(`\\[audit\\] place_call_denied ip=\\S+ to=${sternImMuster(maskNumber("+4990012345678"))} grund=denylist`),
      );
      assert.equal(
        countMatches(
          srv.stdout,
          `\\[audit\\] place_call_denied ip=\\S+ to=${sternImMuster(maskNumber("+4990012345678"))} grund=denylist`,
        ),
        1,
      );
      assert.equal(srv.stdout.includes("4990012345678"), false);
    });

    await t.test("cancel_call: genau eine Zeile", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls/call_audit1/cancel`, {});
      assert.equal(res.status, 200);
      await waitForLog(srv, /\[audit\] cancel_call ip=\S+ call=call_audit1/);
      assert.equal(countMatches(srv.stdout, "\\[audit\\] cancel_call ip=\\S+ call=call_audit1"), 1);
    });

    // AUTH-P4: "settings_update: nur Keys im Log, keine Werte" ist entfallen. Das
    // audit("settings_update", ...)-Event wurde AUSSCHLIESSLICH in api-tenant-write.js
    // ausgeloest (verifiziert) - mit POST /api/settings existiert dieses Event nicht
    // mehr. Der ueberlebende Schreibpfad (/api/self-service/settings) auditiert unter
    // anderem Namen (self_service_settings) und loggt ebenfalls nur Keys
    // (src/self-service-routes.js). Ehrliche Luecke: dafuer gibt es heute keinen
    // Audit-Test (braeuchte pglite + Web-Login, fremde Phase) - Befund in
    // PLAN-SECURITY.md, kein Testneubau hier.
  } finally {
    await srv.stop();
  }
});

test("Audit-Zeilen fuer fehlgeschlagene Auth-Versuche", async (t) => {
  const srv = await startServer({
    env: { DASHBOARD_PASSWORD: "super-geheim-pw", MCP_AUTH_TOKEN: "geheimes-mcp-token" },
  });
  try {
    await t.test(
      "abgelehnter externer Zugriff -> genau eine Audit-Zeile",
      { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
      async () => {
        // AUTH-P7: kein Gate mehr davor, das auf einen Basic-Header reagieren
        // koennte - internalOnly weist jeden nicht-lokalen Aufrufer ab, unabhaengig
        // von Credentials.
        const res = await fetch(`${srv.externalUrl}/api/state`);
        assert.equal(res.status, 403);
        await waitForLog(srv, /\[audit\] auth_failed ip=\S+ path=\/api\/state grund=not_local/);
        assert.equal(
          countMatches(srv.stdout, "\\[audit\\] auth_failed ip=\\S+ path=/api/state grund=not_local"),
          1,
        );
      },
    );

    await t.test("MCP-Fehlversuch -> genau eine Zeile", async () => {
      const res = await fetch(`${srv.localUrl}/mcp`, {
        method: "POST",
        headers: { Authorization: "Bearer falsches-token" },
      });
      assert.equal(res.status, 401);
      await waitForLog(srv, /\[audit\] auth_failed ip=\S+ path=\/mcp/);
      assert.equal(countMatches(srv.stdout, "\\[audit\\] auth_failed ip=\\S+ path=/mcp"), 1);
    });

    await t.test("keine Secrets im Log", () => {
      for (const secret of [
        "super-geheim-pw",
        "geheimes-mcp-token",
        "falsches-pw",
        "falsches-token",
      ])
        assert.ok(!srv.stdout.includes(secret), `${secret} darf nicht im Log stehen`);
    });
  } finally {
    await srv.stop();
  }
});
