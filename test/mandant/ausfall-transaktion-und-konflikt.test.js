import { test } from "node:test";
import assert from "node:assert/strict";

import { speicherBereiche } from "../../src/store.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const JETZT_MS = Date.parse("2026-09-01T10:00:00.000Z");
const JETZT_ISO = "2026-09-01T10:00:00.000Z";
const TRANSAKTION = /^(BEGIN|COMMIT|ROLLBACK)$/;
const db = await pgliteAlsRolleOhneSuperuser();
let laufendeNummer = 0;

async function ausfallMit(abfangen) {
  const protokoll = [];
  const client = {
    query: async (text, params) => {
      protokoll.push({ text, params });
      const ersatz = await abfangen(text, params, protokoll);
      return ersatz ?? db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  const speicher = makePgStoreMitSperre({ withClient: (fn) => fn(client) });
  await speicher.init();
  protokoll.length = 0;
  laufendeNummer += 1;
  return {
    ausfall: speicherBereiche(speicher).ausfall,
    protokoll,
    code: `not-placed:transaktion-${laufendeNummer}`,
  };
}

const transaktionen = (protokoll) =>
  protokoll.map((eintrag) => eintrag.text).filter((text) => TRANSAKTION.test(text));
const anzahlMit = (protokoll, muster) =>
  protokoll.filter((eintrag) => muster.test(eintrag.text)).length;

test("Ausfall-SQL: ein Claim läuft in BEGIN und COMMIT und legt eine Zeile mit otg-Kennung an", async () => {
  const { ausfall, protokoll, code } = await ausfallMit(() => undefined);

  await ausfall.notizClaimen({ code, nowMs: JETZT_MS });

  assert.deepEqual(transaktionen(protokoll), ["BEGIN", "COMMIT"]);
  const { rows } = await db.query(`SELECT id FROM outage_alert WHERE code = $1`, [code]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].id, /^otg_/);
});

test("Ausfall-SQL: wirft die Arbeit, wird zurückgerollt, nicht bestätigt, und der Fehler kommt an", async (t) => {
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  const { ausfall, protokoll, code } = await ausfallMit((text) => {
    if (/FOR UPDATE/.test(text)) throw new Error("Arbeit kaputt");
  });

  await assert.rejects(ausfall.notizClaimen({ code, nowMs: JETZT_MS }), /Arbeit kaputt/);

  assert.deepEqual(transaktionen(protokoll), ["BEGIN", "ROLLBACK"]);
  assert.equal(fehlerausgabe.mock.calls.length, 1);
});

test("Ausfall-SQL: wirft auch das Zurückrollen, kommt der ursprüngliche Fehler an", async (t) => {
  t.mock.method(console, "error", () => {});
  const { ausfall, protokoll, code } = await ausfallMit(async (text) => {
    if (/FOR UPDATE/.test(text)) throw new Error("Arbeit kaputt");
    if (text === "ROLLBACK") {
      await db.query(text);
      throw new Error("Rollback kaputt");
    }
  });

  await assert.rejects(ausfall.notizClaimen({ code, nowMs: JETZT_MS }), /Arbeit kaputt/);

  assert.deepEqual(transaktionen(protokoll), ["BEGIN", "ROLLBACK"]);
});

test("Ausfall-SQL: verliert der Claim das Anlegen an einen anderen, wird dessen Marker aktualisiert statt doppelt angelegt", async () => {
  const fremd = {
    id: "otg_fremd",
    code: "",
    first_seen_at: new Date(JETZT_MS - 1000),
    last_seen_at: null,
  };
  const { ausfall, protokoll, code } = await ausfallMit((text) => {
    if (/INSERT INTO outage_alert/.test(text)) {
      assert.ok(anzahlMit(protokoll, /INSERT INTO outage_alert/) <= 1, "zweites Anlegen");
      return { rows: [] };
    }
    if (/FOR UPDATE/.test(text) && anzahlMit(protokoll, /FOR UPDATE/) === 2)
      return { rows: [{ ...fremd, code }] };
  });

  const reserviert = await ausfall.sendeplatzReservieren({
    bucket: code,
    nowMs: JETZT_MS,
    frei: () => true,
  });

  assert.equal(reserviert, true);
  assert.equal(anzahlMit(protokoll, /INSERT INTO outage_alert/), 1);
  const aktualisierungen = protokoll.filter((eintrag) =>
    /^UPDATE outage_alert SET last_seen_at/.test(eintrag.text),
  );
  assert.equal(aktualisierungen.length, 1);
  assert.equal(aktualisierungen[0].params[0], "otg_fremd");
  assert.equal(aktualisierungen[0].params[1], JETZT_ISO);
  assert.equal(aktualisierungen[0].params[2], JETZT_ISO);
  assert.deepEqual(transaktionen(protokoll), ["BEGIN", "COMMIT"]);
});

test("Ausfall-SQL: Zeitstempel, die als Text aus der Datenbank kommen, erscheinen unverändert im Marker", async () => {
  const zeile = {
    id: "otg_text",
    code: "c",
    first_seen_at: "2026-09-01T08:00:00.000Z",
    last_seen_at: "2026-09-01T09:00:00.000Z",
    last_attempt_at: "2026-09-01T09:30:00.000Z",
    reported_at: "2026-09-01T09:45:00.000Z",
    delivered_channels: "audit",
    closed_at: "2026-09-01T09:50:00.000Z",
  };
  const { ausfall } = await ausfallMit((text) =>
    /FROM outage_alert/.test(text) ? { rows: [zeile] } : undefined,
  );

  const zustand = await ausfall.offeneAusfallZustand();

  assert.deepEqual(zustand.outageAlerts, [
    {
      id: "otg_text",
      code: "c",
      firstSeenAt: "2026-09-01T08:00:00.000Z",
      lastSeenAt: "2026-09-01T09:00:00.000Z",
      lastAttemptAt: "2026-09-01T09:30:00.000Z",
      reportedAt: "2026-09-01T09:45:00.000Z",
      deliveredChannels: "audit",
      closedAt: "2026-09-01T09:50:00.000Z",
    },
  ]);
});
