import { test } from "node:test";
import assert from "node:assert/strict";

import { speicherBereiche } from "../../src/store.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const SCHREIBFEHLER_LOG = "[pg] ausfall schreiben fehlgeschlagen:";
const OFFENE_SQL = `SELECT code, last_attempt_at, reported_at, delivered_channels FROM outage_alert
  WHERE code = $1 AND closed_at IS NULL`;
const ALLE_SQL = `SELECT count(*)::int AS anzahl FROM outage_alert WHERE code = $1`;
const JETZT_MS = Date.parse("2026-09-01T10:00:00.000Z");
const FRUEHER_MS = JETZT_MS - 60_000;

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
let schlange = Promise.resolve();

function runnerFuer(vorQuery = () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return gemeinsam.query(text, params);
    },
    exec: (sql) => gemeinsam.exec(sql),
  };
  return {
    withClient: (fn) => {
      const lauf = schlange.then(() => fn(client));
      schlange = lauf.then(
        () => {},
        () => {},
      );
      return lauf;
    },
  };
}

async function instanz(vorQuery) {
  const speicher = makePgStoreMitSperre(runnerFuer(vorQuery));
  await speicher.init();
  return { speicher, ausfall: speicherBereiche(speicher).ausfall };
}

await instanz();
let laufendeNummer = 0;

async function zweiInstanzen(vorQuery) {
  laufendeNummer += 1;
  const code = `not-placed:zwei-instanzen-${laufendeNummer}`;
  return { a: await instanz(), b: await instanz(vorQuery), code };
}

const offene = async (code) => (await gemeinsam.query(OFFENE_SQL, [code])).rows;
const alle = async (code) => {
  const { rows } = await gemeinsam.query(ALLE_SQL, [code]);
  return rows[0].anzahl;
};

async function letzteFlushs(...instanzen) {
  for (const { speicher } of instanzen) {
    await speicher.drainFlushes();
    speicher.save();
    await speicher.drainFlushes();
  }
}

test("Kriterium 1: gleichzeitiges Reservieren auf zwei Instanzen liefert genau einmal true und legt eine offene Zeile an", async () => {
  const { a, b, code } = await zweiInstanzen();
  const frei = (marker) => !marker || Date.parse(marker.lastAttemptAt ?? 0) < JETZT_MS - 30_000;
  let versendet = 0;

  const ergebnisse = await Promise.all(
    [a, b].map(async ({ ausfall }) => {
      const reserviert = await ausfall.sendeplatzReservieren({ bucket: code, nowMs: JETZT_MS, frei });
      if (reserviert) versendet += 1;
      return reserviert;
    }),
  );

  assert.deepEqual(ergebnisse.sort(), [false, true]);
  assert.equal(versendet, 1);
  assert.equal((await offene(code)).length, 1);
  assert.equal(await alle(code), 1);
  assert.equal(await a.ausfall.sendeplatzReserviert({ bucket: code, nowMs: JETZT_MS }), true);
  assert.equal(await a.ausfall.sendeplatzReserviert({ bucket: code, nowMs: JETZT_MS + 1 }), false);
});

test("Kriterium 2: der letzte Flush von B löscht den Marker von A nicht, B sieht ihn", async () => {
  const { a, b, code } = await zweiInstanzen();

  await a.ausfall.notizClaimen({ code, nowMs: JETZT_MS });
  await letzteFlushs(a, b);

  assert.equal((await offene(code)).length, 1);
  const marker = await b.ausfall.offenerMarker({ code });
  assert.equal(marker.code, code);
  assert.equal(marker.firstSeenAt, "2026-09-01T10:00:00.000Z");
  assert.equal(marker.lastAttemptAt, null);
  assert.equal(marker.closedAt, null);
});

test("Kriterium 3: ein von A geschlossener Marker ist auf B weg, ein neuer Claim legt eine neue offene Zeile an", async () => {
  const { a, b, code } = await zweiInstanzen();
  await a.ausfall.notizClaimen({ code, nowMs: FRUEHER_MS });

  await a.ausfall.markerSchliessen({ code, nowMs: JETZT_MS });

  assert.equal(await b.ausfall.offenerMarker({ code }), undefined);
  await b.ausfall.notizClaimen({ code, nowMs: JETZT_MS + 1000 });
  assert.equal((await offene(code)).length, 1);
  assert.equal(await alle(code), 2);
});

test("Kriterium 4: selbsttestClaimen liefert bei zwei Instanzen genau einmal true", async () => {
  const { a, b, code } = await zweiInstanzen();
  const faellig = (marker) => !marker || Date.parse(marker.lastAttemptAt ?? 0) < JETZT_MS - 30_000;

  const ergebnisse = await Promise.all(
    [a, b].map(({ ausfall }) => ausfall.selbsttestClaimen({ bucket: code, nowMs: JETZT_MS, faellig })),
  );

  assert.deepEqual(ergebnisse.sort(), [false, true]);
  assert.equal(await alle(code), 1);
});

test("Kriterium 4: holdEskalationClaimen liefert bei zwei Instanzen genau einmal true", async () => {
  const { a, b, code } = await zweiInstanzen();

  const ergebnisse = await Promise.all(
    [a, b].map(({ ausfall }) => ausfall.holdEskalationClaimen({ bucket: code, nowMs: JETZT_MS })),
  );

  assert.deepEqual(ergebnisse.sort(), [false, true]);
  assert.equal(await alle(code), 1);
});

test("Kriterium 4: beanspruchMarker liefert bei zwei Instanzen genau einmal true und hält lastSeenAt fest", async () => {
  const { a, b, code } = await zweiInstanzen();
  const istFaellig = (marker) => !marker;

  const ergebnisse = await Promise.all(
    [a, b].map(({ ausfall }) => ausfall.beanspruchMarker({ code, nowMs: JETZT_MS, istFaellig })),
  );

  assert.deepEqual(ergebnisse.sort(), [false, true]);
  assert.equal(await alle(code), 1);
  assert.equal((await offene(code))[0].last_attempt_at, null);
});

test("Marker: alarmVersendet trägt Versuch, Zustellung und Kanäle ein, ein späterer Versuch ohne Kanäle lässt Zustellung stehen", async () => {
  const { a, code } = await zweiInstanzen();

  await a.ausfall.alarmVersendet({ code, nowMs: FRUEHER_MS, channels: ["audit", "mail"] });
  await a.ausfall.alarmVersendet({ code, nowMs: JETZT_MS, channels: [] });

  const [zeile] = await offene(code);
  assert.equal(zeile.delivered_channels, "audit,mail");
  assert.equal(zeile.reported_at.toISOString(), new Date(FRUEHER_MS).toISOString());
  assert.equal(zeile.last_attempt_at.toISOString(), new Date(JETZT_MS).toISOString());
  const marker = await a.ausfall.offenerMarker({ code });
  assert.equal(marker.lastSeenAt, "2026-09-01T10:00:00.000Z");
  assert.equal(marker.reportedAt, "2026-09-01T09:59:00.000Z");
});

test("Marker: urteilClaimen reicht den Marker an beurteile und claimt nur bei Alarm", async () => {
  const { a, code } = await zweiInstanzen();
  const gesehen = [];
  const beurteile = (eingabe) => {
    gesehen.push(eingabe);
    return { alarm: gesehen.length === 2 };
  };
  const istAlarm = (ergebnis) => ergebnis.alarm;

  await a.ausfall.urteilClaimen({ bucket: code, nowMs: JETZT_MS, beurteile, istAlarm });
  assert.equal(await alle(code), 0);
  const ergebnis = await a.ausfall.urteilClaimen({ bucket: code, nowMs: JETZT_MS, beurteile, istAlarm });

  assert.deepEqual(ergebnis, { alarm: true });
  assert.equal(gesehen[0].marker, undefined);
  assert.ok(Array.isArray(gesehen[0].calls));
  assert.equal((await offene(code)).length, 1);
});

test("Marker: offeneMarkerSchliessen schliesst nur die gewählten Marker und zählt sie", async () => {
  const { a, b, code } = await zweiInstanzen();
  const anderer = `${code}-bleibt`;
  await a.ausfall.notizClaimen({ code, nowMs: FRUEHER_MS });
  await a.ausfall.notizClaimen({ code: anderer, nowMs: FRUEHER_MS });

  const anzahl = await b.ausfall.offeneMarkerSchliessen({ istZuSchliessen: (c) => c === code, nowMs: JETZT_MS });

  assert.equal(anzahl, 1);
  assert.equal((await offene(code)).length, 0);
  assert.equal((await offene(anderer)).length, 1);
  const zustand = await b.ausfall.offeneAusfallZustand();
  assert.ok(zustand.outageAlerts.some((alert) => alert.code === anderer));
  assert.ok(!zustand.outageAlerts.some((alert) => alert.code === code));
  assert.ok(Array.isArray(zustand.calls));
});

test("Kriterium 5: ist die Datenbank beim Claim nicht erreichbar, wirft die Operation und der Fehler steht im Log", async (t) => {
  const zustand = { kaputt: false };
  const { b, code } = await zweiInstanzen((text) => {
    if (zustand.kaputt && /outage_alert/.test(text)) throw new Error("Datenbank weg");
  });
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  await assert.rejects(
    b.ausfall.sendeplatzReservieren({ bucket: code, nowMs: JETZT_MS, frei: () => true }),
    /Datenbank weg/,
  );

  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) => aufruf.arguments[0] === SCHREIBFEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
    ),
  );
  zustand.kaputt = false;
  assert.equal(await alle(code), 0);
});

test("Kriterium 5: ein Lesefehler wirft bei offenerMarker und offeneAusfallZustand", async () => {
  const zustand = { kaputt: false };
  const { b, code } = await zweiInstanzen((text) => {
    if (zustand.kaputt && /FROM outage_alert/.test(text)) throw new Error("Lesen weg");
  });

  zustand.kaputt = true;

  await assert.rejects(b.ausfall.offenerMarker({ code }), /Lesen weg/);
  await assert.rejects(b.ausfall.offeneAusfallZustand(), /Lesen weg/);
});

test("Kriterium 6: auf dem JSON-Backend der Fassade laufen offeneAusfallZustand und urteilClaimen ohne Fehler", async () => {
  const fassade = await import("../../src/store.js");
  const ausfall = fassade.speicherBereiche(fassade).ausfall;

  const offen = await ausfall.offeneAusfallZustand();
  const geclaimt = await ausfall.urteilClaimen({
    bucket: "fassade-json-bucket",
    nowMs: JETZT_MS,
    beurteile: () => ({ urteil: "ok" }),
    istAlarm: () => false,
  });

  assert.ok(offen && typeof offen === "object");
  assert.equal(typeof geclaimt, "object");
});

test("Kriterium 23: legt eine andere Instanz den Marker vor dem Anlegen an, liefert sendeplatzReservieren false und es bleibt eine offene Zeile", async () => {
  const zustand = { angelegt: false, code: "" };
  const { b, code } = await zweiInstanzen(async (text) => {
    if (zustand.angelegt || !/^\s*INSERT INTO outage_alert/.test(text)) return;
    zustand.angelegt = true;
    await gemeinsam.query(
      `INSERT INTO outage_alert (id, code, first_seen_at, last_seen_at, last_attempt_at, reported_at, delivered_channels)
       VALUES ($1, $2, $3, $3, $3, $3, $4)`,
      ["otg-andere-instanz", zustand.code, new Date(FRUEHER_MS).toISOString(), "email"],
    );
  });
  zustand.code = code;
  const frei = (marker) => !marker;

  const reserviert = await b.ausfall.sendeplatzReservieren({ bucket: code, nowMs: JETZT_MS, frei });

  assert.equal(zustand.angelegt, true);
  assert.equal(reserviert, false);
  assert.equal((await offene(code)).length, 1);
  assert.equal(await alle(code), 1);
});
