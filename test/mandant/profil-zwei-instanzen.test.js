import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const SCHREIBFEHLER_LOG = "[pg] profil schreiben fehlgeschlagen:";
const ZEILE_SQL = `SELECT data FROM profile WHERE tenant_id = $1`;

function runnerFuer(db, vorQuery = () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function instanz(runner) {
  const speicher = makePgStoreMitSperre(runner);
  await speicher.init();
  return speicher;
}

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
await instanz(runnerFuer(gemeinsam));
let laufendeNummer = 0;

async function zweiInstanzen(vorQuery) {
  laufendeNummer += 1;
  const tenant = `profil-mandant-${laufendeNummer}`;
  const a = await instanz(runnerFuer(gemeinsam));
  const b = await instanz(runnerFuer(gemeinsam, vorQuery));
  return { a, b, tenant };
}

const gespeichert = async (tenantId) => {
  const { rows } = await gemeinsam.query(ZEILE_SQL, [tenantId]);
  return rows[0]?.data ?? null;
};

async function letzteFlushs(...instanzen) {
  for (const speicher of instanzen) {
    await speicher.drainFlushes();
    speicher.save();
    await speicher.drainFlushes();
  }
}

test("Kriterium 1: ein Profil von A bleibt nach den letzten Flushs beider Instanzen in der Datenbank", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setProfile(tenant, { allowConsult: true });
  await letzteFlushs(a, b);

  assert.deepEqual(await gespeichert(tenant), { allowConsult: true });
});

test("Kriterium 2: getrennt gesetzte Felder von A und B stehen beide in data", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();
  b.setProfile(tenant, { allowLookup: true });
  await letzteFlushs(a, b);

  assert.deepEqual(await gespeichert(tenant), { allowConsult: true, allowLookup: true });
});

test("Kriterium 3: ein von A gelöschtes Profil bleibt nach dem letzten Flush von B weg", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();
  assert.equal(a.deleteProfile(tenant), true);
  await letzteFlushs(a, b);

  assert.equal(await gespeichert(tenant), null);
});

test("Kriterium 4: scheitert das gezielte Schreiben, steht der Fehler im Log und der Aufrufer bekommt keinen", async (t) => {
  const zustand = { kaputt: false };
  const { b, tenant } = await zweiInstanzen((text) => {
    if (zustand.kaputt && /INSERT INTO profile/.test(text)) throw new Error("Datenbank weg");
  });
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  const ergebnis = b.setProfile(tenant, { allowConsult: true });
  await b.drainFlushes();

  assert.deepEqual(ergebnis.changed, ["allowConsult"]);
  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) => aufruf.arguments[0] === SCHREIBFEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
    ),
  );
  assert.equal(await gespeichert(tenant), null);
});

test("Kriterium 4: scheitert das Löschen, steht der Fehler im Log und der Aufrufer bekommt true", async (t) => {
  const zustand = { kaputt: false };
  const { b, tenant } = await zweiInstanzen((text) => {
    if (zustand.kaputt && /DELETE FROM profile/.test(text)) throw new Error("Datenbank weg");
  });
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  b.setProfile(tenant, { allowConsult: true });
  await b.drainFlushes();

  zustand.kaputt = true;
  const ok = b.deleteProfile(tenant);
  await b.drainFlushes();

  assert.equal(ok, true);
  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) => aufruf.arguments[0] === SCHREIBFEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
    ),
  );
  assert.deepEqual(await gespeichert(tenant), { allowConsult: true });
});

test("Kriterium 5: das Löschen eines unbekannten Profils schreibt nichts", async () => {
  const abfragen = [];
  const { b, tenant } = await zweiInstanzen((text) => abfragen.push(text));
  abfragen.length = 0;

  const ok = b.deleteProfile(tenant);
  await b.drainFlushes();

  assert.equal(ok, false);
  assert.equal(abfragen.filter((text) => /DELETE FROM profile/.test(text)).length, 0);
});

test("Kriterium 5: ein Patch ohne erlaubte Schlüssel legt wie bisher ein leeres Profil an", async () => {
  const { b, tenant } = await zweiInstanzen();

  const ergebnis = b.setProfile(tenant, { unbekannt: 1 });
  await letzteFlushs(b);

  assert.deepEqual(ergebnis.changed, []);
  assert.deepEqual(await gespeichert(tenant), {});
});
