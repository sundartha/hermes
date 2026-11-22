import { test } from "node:test";
import assert from "node:assert/strict";

import { speicherBereiche } from "../../src/store.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const SCHREIBFEHLER_LOG = "[pg] mandant-sperre schreiben fehlgeschlagen:";
const STAMMDATEN_SQL = `SELECT owner_name, first_name, country, default_language, timezone, private_number FROM tenant WHERE id = $1`;
const EIGENE_NUMMER = "+4915123456789";
const ZWEITE_NUMMER = "+4915198765432";

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
  const tenant = `t_stamm_${laufendeNummer}`;
  await gemeinsam.query(`INSERT INTO tenant (id, status, country) VALUES ($1, 'active', 'DE')`, [tenant]);
  const a = await instanz(runnerFuer(gemeinsam));
  const b = await instanz(runnerFuer(gemeinsam, vorQuery));
  return { a, b, tenant };
}

const zeile = async (tenantId) => (await gemeinsam.query(STAMMDATEN_SQL, [tenantId])).rows[0];
const nameSetzen = (speicher, tenantId) =>
  speicherBereiche(speicher).mandantProfil.identitaetSetzen(tenantId, { firstName: "Ada", lastName: "Lovelace" });

test("Kriterium 1: Name von A und eigene Nummer von B stehen nach den letzten Flushs beide in der Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  await nameSetzen(a, tenant);
  await a.drainFlushes();
  b.setPrivateNumber(tenant, EIGENE_NUMMER);
  await b.drainFlushes();
  a.save();
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  const stand = await zeile(tenant);
  assert.equal(stand.owner_name, "Ada Lovelace");
  assert.equal(stand.first_name, "Ada");
  assert.equal(stand.private_number, EIGENE_NUMMER);
});

test("Kriterium 2: ein letzter Flush einer veralteten Instanz setzt Name, Land, Zeitzone, Sprache und Nummer nicht zurück", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  await nameSetzen(a, tenant);
  a.setTenantGeo(tenant, { country: "DE", defaultLanguage: "en", timezone: "Europe/Vienna" });
  a.setPrivateNumber(tenant, EIGENE_NUMMER);
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.deepEqual(await zeile(tenant), {
    owner_name: "Ada Lovelace",
    first_name: "Ada",
    country: "DE",
    default_language: "en",
    timezone: "Europe/Vienna",
    private_number: EIGENE_NUMMER,
  });
});

test("Kriterium 2: das Löschen der eigenen Nummer überlebt den letzten Flush einer veralteten Instanz", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.setPrivateNumber(tenant, EIGENE_NUMMER);
  await a.drainFlushes();

  a.setPrivateNumber(tenant, null);
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal((await zeile(tenant)).private_number, null);
});

test("Kriterium 2: ein Teil-Patch der Geodaten ändert nur die genannten Spalten", async () => {
  const { a, tenant } = await zweiInstanzen();
  a.setTenantGeo(tenant, { country: "AT", defaultLanguage: "en", timezone: "Europe/Vienna" });
  await a.drainFlushes();

  a.setTenantGeo(tenant, { timezone: "Europe/Berlin" });
  await a.drainFlushes();

  const stand = await zeile(tenant);
  assert.equal(stand.timezone, "Europe/Berlin");
  assert.equal(stand.country, "AT");
  assert.equal(stand.default_language, "en");
});

test("Kriterium 2: eine zweite Nummer von A bleibt vor dem Flush von B bestehen", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  b.setPrivateNumber(tenant, EIGENE_NUMMER);
  await b.drainFlushes();

  a.setPrivateNumber(tenant, ZWEITE_NUMMER);
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal((await zeile(tenant)).private_number, ZWEITE_NUMMER);
});

const SCHREIBWEGE = [
  ["Name", /^UPDATE tenant SET owner_name = /, (speicher, tenant) => nameSetzen(speicher, tenant)],
  ["Geodaten", /^UPDATE tenant SET country = /, (speicher, tenant) => speicher.setTenantGeo(tenant, { country: "AT" })],
  ["eigene Nummer", /^UPDATE tenant SET private_number = /, (speicher, tenant) => speicher.setPrivateNumber(tenant, EIGENE_NUMMER)],
];

for (const [name, muster, setzen] of SCHREIBWEGE) {
  test(`Kriterium 3: scheitert das gezielte Schreiben von ${name}, steht der Fehler im Log und der Aufrufer bekommt keinen`, async (t) => {
    const zustand = { kaputt: false };
    const { b, tenant } = await zweiInstanzen((text) => {
      if (zustand.kaputt && muster.test(text)) throw new Error("Datenbank weg");
    });
    const fehlerausgabe = t.mock.method(console, "error", () => {});

    zustand.kaputt = true;
    await setzen(b, tenant);
    await b.drainFlushes();

    assert.ok(
      fehlerausgabe.mock.calls.some(
        (aufruf) => aufruf.arguments[0] === SCHREIBFEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
      ),
    );
  });
}

test("Kriterium 2: ein leerer Geodaten-Patch schreibt nichts und meldet keinen Fehler", async (t) => {
  const { a, tenant } = await zweiInstanzen();
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  a.setTenantGeo(tenant, {});
  await a.drainFlushes();

  assert.equal(fehlerausgabe.mock.calls.length, 0);
  assert.equal((await zeile(tenant)).country, "DE");
});

test("Kriterium 2: ohne Namensänderung (Name schon gesetzt) schreibt die Identität nichts", async (t) => {
  const { a, tenant } = await zweiInstanzen();
  await nameSetzen(a, tenant);
  await a.drainFlushes();
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  const anfragen = t.mock.method(a, "stammdatenSchreiben");

  await speicherBereiche(a).mandantProfil.identitaetSetzen(tenant, { firstName: "Neu", lastName: "Name" });
  await a.drainFlushes();

  assert.equal(anfragen.mock.calls.length, 0);
  assert.equal(fehlerausgabe.mock.calls.length, 0);
  assert.equal((await zeile(tenant)).owner_name, "Ada Lovelace");
});

test("Kriterium 2: das Löschen der Mandantendaten entfernt die eigene Nummer auch aus der Zeile", async () => {
  const { a, tenant } = await zweiInstanzen();
  a.setPrivateNumber(tenant, EIGENE_NUMMER);
  await a.drainFlushes();

  const entfernt = await a.eraseTenantData(tenant);
  await a.drainFlushes();

  assert.equal(entfernt.privateNumber, 1);
  assert.equal((await zeile(tenant)).private_number, null);
});

test("Kriterium 2: ein Patch mit nur der Zeitzone lässt das Land stehen, das eine andere Instanz gesetzt hat", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  b.setTenantGeo(tenant, { country: "AT" });
  await b.drainFlushes();

  a.setTenantGeo(tenant, { timezone: "Europe/Vienna" });
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  const stand = await zeile(tenant);
  assert.equal(stand.country, "AT");
  assert.equal(stand.timezone, "Europe/Vienna");
});

test("Kriterium 2: das Löschen von Mandantendaten ohne eigene Nummer entfernt auch die Nummer einer anderen Instanz", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  b.setPrivateNumber(tenant, EIGENE_NUMMER);
  await b.drainFlushes();

  const entfernt = await a.eraseTenantData(tenant);
  await a.drainFlushes();

  assert.equal(entfernt.privateNumber, 0);
  assert.equal((await zeile(tenant)).private_number, null);
});

test("Kriterium 2: das Löschen von Mandantendaten mit nur einem Anruf speichert den Zustand", async () => {
  const abfragen = [];
  const { b: a, tenant } = await zweiInstanzen((text) => abfragen.push(text));
  a.createCall({ direction: "outbound", to: "+4915100000001", goal: "Test", tenantId: tenant });
  await a.drainFlushes();
  abfragen.length = 0;

  const entfernt = await a.eraseTenantData(tenant);
  await a.drainFlushes();

  assert.equal(entfernt.calls, 1);
  assert.equal(entfernt.actionItems, 0);
  assert.ok(abfragen.includes("BEGIN"));
});

test("Kriterium 2: das Löschen von Mandantendaten ohne etwas zu entfernen speichert nichts", async () => {
  const abfragen = [];
  const { b: a, tenant } = await zweiInstanzen((text) => abfragen.push(text));
  await a.drainFlushes();
  abfragen.length = 0;

  const entfernt = await a.eraseTenantData(tenant);
  await a.drainFlushes();

  assert.equal(entfernt.calls, 0);
  assert.equal(entfernt.actionItems, 0);
  assert.equal(entfernt.privateNumber, 0);
  assert.ok(!abfragen.includes("BEGIN"));
  assert.ok(!abfragen.some((text) => /^\s*(UPDATE|INSERT)[^;]*\btenants?\b/i.test(text) && !/private_number/i.test(text)));
});
