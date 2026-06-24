// Phase 2.2 (Body-Size-Limits), 2.4 (Settings-Whitelist), 2.6 (Eingabe-Validierung).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

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
      const res = await postJson(`${srv.localUrl}/api/settings`, {
        greeting: "x".repeat(200 * 1024),
      });
      assert.equal(res.status, 413);
    });

    await t.test("kleiner Body unveraendert 2xx", async () => {
      const res = await postJson(`${srv.localUrl}/api/settings`, { greeting: "Hallo Test" });
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
  // Allowlist gesetzt: Validierungsfehler (400) muessen VOR dem Gate (403) greifen,
  // der Twilio-Erfolgspfad wird bewusst nicht getestet (echter API-Call).
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
      "Nummer wird normalisiert (Spaces/Bindestriche), Allowlist-Gate bleibt",
      async () => {
        // gueltiges Format, aber nicht in der Allowlist -> 403 (nicht 400)
        const res = await call({ to: "+49 151 9999-9999", objective: "Termin" });
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
      // caller_name entfernt (G1, Owner-Entscheidung #3): das Feld existiert nicht mehr,
      // ein angehaengtes caller_name wird vom zod-Schema verworfen (kein 400).
    });
  } finally {
    await srv.stop();
  }
});

test("Eingabe-Validierung /api/calendar", async (t) => {
  const srv = await startServer();
  const cal = (body) => postJson(`${srv.localUrl}/api/calendar`, body);
  try {
    await t.test("ungueltige Datumswerte -> 400", async () => {
      const res = await cal({ title: "Test", start: "morgen", end: "uebermorgen" });
      assert.equal(res.status, 400);
    });

    await t.test("end <= start -> 400", async () => {
      const res = await cal({
        title: "Test",
        start: "2026-07-01T11:00:00Z",
        end: "2026-07-01T10:00:00Z",
      });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /end muss nach start/);
      const same = await cal({
        title: "Test",
        start: "2026-07-01T10:00:00Z",
        end: "2026-07-01T10:00:00Z",
      });
      assert.equal(same.status, 400);
    });

    await t.test("title zu lang -> 400", async () => {
      const res = await cal({
        title: "x".repeat(201),
        start: "2026-07-01T10:00:00Z",
        end: "2026-07-01T11:00:00Z",
      });
      assert.equal(res.status, 400);
    });

    await t.test("gueltiger Eintrag -> 200 und im Store", async () => {
      const res = await cal({
        title: "Zahnarzt",
        start: "2026-07-01T10:00:00Z",
        end: "2026-07-01T11:00:00Z",
      });
      assert.equal(res.status, 200);
      const ev = await res.json();
      assert.ok(ev.id);
      // readStore() liest den rohen (migrierten) Store: calendar ist seit I2 eine
      // Map tenantId -> [events]; der Owner-Bucket traegt die Laufzeit-Termine.
      assert.ok(srv.readStore().calendar[BOOTSTRAP_TENANT_ID].some((e) => e.id === ev.id));
    });
  } finally {
    await srv.stop();
  }
});

test("Settings-Whitelist", async (t) => {
  const srv = await startServer();
  try {
    await t.test("unbekannter Key + falscher Typ werden ignoriert", async () => {
      const res = await postJson(`${srv.localUrl}/api/settings`, {
        evil: "x",
        allowBooking: "nein",
      });
      assert.equal(res.status, 200);
      const settings = await res.json();
      assert.equal("evil" in settings, false);
      assert.equal(
        settings.allowBooking,
        true,
        "String 'nein' darf das Boolean nicht ueberschreiben",
      );
      // readStore() liest den rohen (migrierten) Store: settings ist seit I2 eine
      // Map tenantId -> Bucket. Die HTTP-Response (oben) bleibt flach.
      const stored = srv.readStore().settings[BOOTSTRAP_TENANT_ID];
      assert.equal("evil" in stored, false);
      assert.equal(stored.allowBooking, true);
    });

    await t.test("bekannter Key mit korrektem Typ wird uebernommen", async () => {
      const res = await postJson(`${srv.localUrl}/api/settings`, { allowBooking: false });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).allowBooking, false);
      assert.equal(srv.readStore().settings[BOOTSTRAP_TENANT_ID].allowBooking, false);
    });
  } finally {
    await srv.stop();
  }
});

// P8b: Auskunft/Export (Art. 15/20). Read-only Owner-Tenant-Export hinter der
// /api/*-Basic-Auth, Calls OHNE streamToken (publicCall-Invariante wie /api/state).
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
