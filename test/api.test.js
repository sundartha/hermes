// Phase 2.2 (Body-Size-Limits), 2.4 (Settings-Whitelist), 2.6 (Eingabe-Validierung).
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
    // AUTH-P4: POST /api/settings ist geloescht - der Deckel ist eine express.json-
    // Middleware-Eigenschaft (VOR jedem Handler), kein settings-spezifisches Verhalten.
    // Traeger jetzt POST /api/calls: der Parser wirft, bevor irgendein Handler
    // (inkl. Validierung) laeuft - der 413 selbst belegt das, ein gueltiger Body ist
    // fuer diesen Test nicht noetig.
    await t.test("POST mit 200kb-Body -> 413", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls`, {
        objective: "x".repeat(200 * 1024),
      });
      assert.equal(res.status, 413);
    });

    // Traeger POST /voice/turn?callId=missing (offline, kein Seiteneffekt - derselbe
    // Traeger, den der urlencoded-Sub-Test darunter fuer den anderen Parser nutzt):
    // ein kleiner JSON-Body muss den Deckel unbeschadet passieren.
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
      "Nummer wird normalisiert (Spaces/Bindestriche), Gate bleibt (Denylist -> 403)",
      async () => {
        // Mit Trennzeichen, normalisiert -> +4990012345678 (Premium): gueltiges Format
        // (kein 400), aber von der Denylist gesperrt -> 403. Denylist statt Allowlist, weil
        // der Owner seit dem Boot-Seed (id_verified, Phase outbound-p1) das Allowlist-Gate
        // als Subscriber passiert; die Denylist bleibt das greifende harte Gate.
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
      // caller_name entfernt (G1, Owner-Entscheidung #3): das Feld existiert nicht mehr,
      // ein angehaengtes caller_name wird vom zod-Schema verworfen (kein 400).
    });
  } finally {
    await srv.stop();
  }
});

// AUTH-P4: "Eingabe-Validierung /api/calendar" ist ersatzlos entfallen. Die dortigen
// Regeln (ungueltige Datumswerte, end<=start) waren ROUTE-LOKAL (isNaN, Vergleich) im
// jetzt geloeschten Handler und sind mit ihm weg. Der geteilte Anteil (invalidText fuer
// title) lebt in src/routes/_validation.js weiter und hat mit
// src/telephony/outbound-gates.js einen eigenen, weiterhin getesteten Konsumenten.

// AUTH-P4: "Settings-Whitelist" (HTTP-Naht POST /api/settings) ist geloescht. Die
// Zusage (unbekannter Key/falscher Typ werden ignoriert) gibt es auf Store-Ebene noch
// nicht (verifiziert) - ersatzloses Streichen waere ein echter Zusagen-Verlust, deshalb
// auf updateSettings umgestellt (Muster test/f1-geo-store.test.js).
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

// VOICE-09 (tasks/i18n-tests/03-telefonie-render.md): die POSITIVE Haelfte ("language='en'
// wird gesetzt") ist seit W2-B1 end-to-end belegt - test/language-switch-midcall.test.js
// prueft die Wirkung auf den naechsten Anruf. Hier stand die NEGATIVE Haelfte (unbekannter
// Code wird ignoriert, kein Fehler): AUTH-P4 loescht die einzige HTTP-Naht (POST
// /api/settings), die dieser Mechanismus-Test maessen konnte - die Zusage haelt
// test/f1-geo-store.test.js ("updateSettings: bekannte Sprache uebernommen; ... Freitext/
// unbekannt ignoriert") bereits auf der Store-Ebene (verifiziert), also kein Zusagen-
// Verlust. Der test:gates-Katalog verliert damit einen Mechanismus-Test (Bericht).

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
