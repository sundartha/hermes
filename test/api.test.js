import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, defaultSettings } from "../src/store/defaults.js";
import { makeDefaultState, updateSettings } from "../src/store/state-ops.js";

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("Body-Size-Limit 100kb", async (t) => {
  const srv = await startServer();
  try {
    await t.test("POST mit 200kb-Body -> 413", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls`, {
        objective: "x".repeat(200 * 1024),
      });
      assert.equal(res.status, 413);
    });

    await t.test("kleiner Body unveraendert 2xx", async () => {
      const res = await fetch(`${srv.localUrl}/voice/turn?callId=missing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SpeechResult: "" }),
      });
      assert.equal(res.status, 200);
    });

    await t.test("urlencoded mit 200kb-Body -> 413", async () => {
      const res = await fetch(`${srv.localUrl}/voice/turn?callId=missing`, {
        method: "POST",
        body: new URLSearchParams({ SpeechResult: "x".repeat(200 * 1024) }),
      });
      assert.equal(res.status, 413);
    });
  } finally {
    await srv.stop();
  }
});

test("Eingabe-Validierung /api/calls", async (t) => {
  const srv = await startServer({ env: { ALLOWED_NUMBERS: "+4915112345678" } });
  const call = (body) => postJson(`${srv.localUrl}/api/calls`, body);
  try {
    await t.test("fehlende Pflichtfelder -> 400", async () => {
      assert.equal((await call({})).status, 400);
      assert.equal((await call({ to: "+4915112345678" })).status, 400);
      assert.equal((await call({ objective: "Termin" })).status, 400);
    });

    await t.test("ungueltige Nummern -> 400 mit Fehlertext", async () => {
      for (const to of ["12345", "+012345678", "+49abc123456", "+4915112345678901234", "+49"]) {
        const res = await call({ to, objective: "Termin" });
        assert.equal(res.status, 400, `Nummer ${to} muss abgelehnt werden`);
        assert.match((await res.json()).error, /E\.164/);
      }
    });

    await t.test(
      "Nummer wird normalisiert (Spaces/Bindestriche), Gate bleibt (Denylist -> 403)",
      async () => {
        const res = await call({ to: "+49 900 1234-5678", objective: "Termin" });
        assert.equal(res.status, 403);
      },
    );

    await t.test("Overlong-Strings -> 400", async () => {
      const base = { to: "+4915112345678" };
      assert.equal((await call({ ...base, objective: "x".repeat(501) })).status, 400);
      assert.equal(
        (await call({ ...base, objective: "Termin", briefing: "x".repeat(2001) })).status,
        400,
      );
      assert.equal(
        (await call({ ...base, objective: "Termin", constraints: "x".repeat(2001) })).status,
        400,
      );
    });
  } finally {
    await srv.stop();
  }
});

test("Settings-Whitelist (Store-Ebene, updateSettings)", () => {
  const s = makeDefaultState();
  s.settings[BOOTSTRAP_TENANT_ID] = defaultSettings();

  const res1 = updateSettings(s, BOOTSTRAP_TENANT_ID, { evil: "x", allowBooking: "nein" });
  assert.equal(res1.changed.includes("evil"), false, "unbekannter Key wird ignoriert");
  assert.equal(res1.changed.includes("allowBooking"), false, "falscher Typ wird ignoriert");
  assert.equal("evil" in s.settings[BOOTSTRAP_TENANT_ID], false);
  assert.equal(
    s.settings[BOOTSTRAP_TENANT_ID].allowBooking,
    true,
    "String 'nein' darf das Boolean nicht ueberschreiben",
  );

  const res2 = updateSettings(s, BOOTSTRAP_TENANT_ID, { allowBooking: false });
  assert.ok(res2.changed.includes("allowBooking"), "bekannter Key mit korrektem Typ wird uebernommen");
  assert.equal(s.settings[BOOTSTRAP_TENANT_ID].allowBooking, false);
});

test("GET /api/tenant-data/export liefert Owner-Daten ohne streamToken", async (t) => {
  const srv = await startServer({
    seed: seedState({
      calls: [
        seedCall({
          id: "call_x",
          tenantId: BOOTSTRAP_TENANT_ID,
          streamToken: "geheim-token",
          summary: "Zusammenfassung",
        }),
      ],
    }),
  });
  try {
    await t.test("200 mit erwarteten Feldern, Calls ohne streamToken", async () => {
      const res = await fetch(`${srv.localUrl}/api/tenant-data/export`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.tenantId, BOOTSTRAP_TENANT_ID);
      assert.equal(typeof body.exportedAt, "string");
      assert.ok(
        Array.isArray(body.calls) &&
          Array.isArray(body.actionItems) &&
          Array.isArray(body.notifications),
      );
      assert.equal(body.calls.length, 1, "Owner-Call im Export");
      assert.equal("streamToken" in body.calls[0], false, "streamToken darf NIE geleakt werden");
      assert.equal(body.calls[0].summary, "Zusammenfassung");
    });
  } finally {
    await srv.stop();
  }
});
