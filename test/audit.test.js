// Phase 3.3: Audit-Logging - jede sicherheitsrelevante Aktion erzeugt genau
// eine [audit]-Zeile mit Aktion + Quell-IP, ohne Secrets im Log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, externalIp, seedState, seedCall, waitForLog } from "./helpers.js";

const EXTERNAL_IP = externalIp();
const postJson = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const countMatches = (text, re) => (text.match(new RegExp(re, "g")) || []).length;

test("Audit-Zeilen fuer Call-Aktionen und Settings", async (t) => {
  // TWILIO_ACCOUNT_SID leer: calls.create() wirft synchron ("username is
  // required") VOR jedem Netzzugriff - die Audit-Zeile steht da schon im Log.
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "+4915112345678", TWILIO_ACCOUNT_SID: "" },
    seed: seedState({ calls: [seedCall({ id: "call_audit1" })] }),
  });
  try {
    await t.test("place_call: genau eine Zeile mit Aktion + IP + Ziel", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls`, { to: "+4915112345678", objective: "Termin" });
      assert.equal(res.status, 500); // Twilio-Client wirft (leere SID) - Audit kam davor
      await waitForLog(srv, /\[audit\] place_call ip=\S+ to=\+4915112345678/);
      assert.equal(countMatches(srv.stdout, "\\[audit\\] place_call ip=\\S+ to=\\+4915112345678"), 1);
    });

    await t.test("place_call_denied: Allowlist-Ablehnung wird auditiert", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls`, { to: "+4915199999999", objective: "Termin" });
      assert.equal(res.status, 403);
      await waitForLog(srv, /\[audit\] place_call_denied ip=\S+ to=\+4915199999999 grund=allowlist/);
      assert.equal(countMatches(srv.stdout, "\\[audit\\] place_call_denied ip=\\S+ to=\\+4915199999999 grund=allowlist"), 1);
    });

    await t.test("cancel_call: genau eine Zeile", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls/call_audit1/cancel`, {});
      assert.equal(res.status, 200);
      await waitForLog(srv, /\[audit\] cancel_call ip=\S+ call=call_audit1/);
      assert.equal(countMatches(srv.stdout, "\\[audit\\] cancel_call ip=\\S+ call=call_audit1"), 1);
    });

    await t.test("settings_update: nur Keys im Log, keine Werte", async () => {
      const res = await postJson(`${srv.localUrl}/api/settings`, { greeting: "GEHEIMER-FREITEXT", allowBooking: false });
      assert.equal(res.status, 200);
      await waitForLog(srv, /\[audit\] settings_update ip=\S+ keys=/);
      assert.equal(countMatches(srv.stdout, "\\[audit\\] settings_update ip=\\S+ keys="), 1);
      assert.match(srv.stdout, /settings_update ip=\S+ keys=greeting,allowBooking/);
      assert.ok(!srv.stdout.includes("GEHEIMER-FREITEXT"), "Settings-Werte duerfen nicht im Log stehen");
    });
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
      "Basic-Auth-Fehlversuch (extern) -> genau eine Zeile",
      { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
      async () => {
        const res = await fetch(`${srv.externalUrl}/api/state`, {
          headers: { Authorization: "Basic " + Buffer.from("admin:falsches-pw").toString("base64") },
        });
        assert.equal(res.status, 401);
        await waitForLog(srv, /\[audit\] auth_failed ip=\S+ path=\/api\/state/);
        assert.equal(countMatches(srv.stdout, "\\[audit\\] auth_failed ip=\\S+ path=/api/state"), 1);
      }
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
      for (const secret of ["super-geheim-pw", "geheimes-mcp-token", "falsches-pw", "falsches-token"])
        assert.ok(!srv.stdout.includes(secret), `${secret} darf nicht im Log stehen`);
    });
  } finally {
    await srv.stop();
  }
});
