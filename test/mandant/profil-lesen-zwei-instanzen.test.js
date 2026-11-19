import { test } from "node:test";
import assert from "node:assert/strict";

import {
  einstellungenNachladenVon,
  makePgStoreMitSperre,
  pgliteAlsRolleOhneSuperuser,
} from "../pg-helpers.js";

const NACHLADEN_FEHLER_LOG = "[pg] profil nachladen fehlgeschlagen:";
const LESEN = /FROM profile WHERE tenant_id/;
const KURZE_FRIST_MS = 60;
const GROSSZUEGIGE_FRIST_MS = 60_000;

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

async function instanz(runner, optionen) {
  const speicher = makePgStoreMitSperre(runner, optionen);
  await speicher.init();
  return Object.assign(speicher, {
    einstellungenNachladen: (tenantId) => einstellungenNachladenVon(speicher.load(), tenantId),
  });
}

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
await instanz(runnerFuer(gemeinsam));
let laufendeNummer = 0;

async function zweiInstanzen(vorQuery, optionen = { einstellungenFristMs: GROSSZUEGIGE_FRIST_MS }) {
  laufendeNummer += 1;
  const tenant = `profil-lesen-${laufendeNummer}`;
  const a = await instanz(runnerFuer(gemeinsam));
  const b = await instanz(runnerFuer(gemeinsam, vorQuery), optionen);
  return { a, b, tenant };
}

function tor() {
  let freigeben;
  const offen = new Promise((weiter) => (freigeben = weiter));
  return { offen, freigeben };
}

test("Kriterium 1: B liest nach dem Nachladen das Profil, das A gesetzt hat", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  assert.equal(b.resolveProfile(tenant).allowConsult, false);

  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();
  await b.einstellungenNachladen(tenant);

  assert.equal(b.resolveProfile(tenant).allowConsult, true);
  assert.deepEqual(Object.keys(b.listProfiles()).filter((id) => id === tenant), [tenant]);
});

test("Kriterium 2: B liest nach dem Nachladen den Standard, wenn A das Profil gelöscht hat", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();
  await b.einstellungenNachladen(tenant);
  assert.equal(b.resolveProfile(tenant).allowConsult, true);

  a.deleteProfile(tenant);
  await a.drainFlushes();
  await b.einstellungenNachladen(tenant);

  assert.equal(b.resolveProfile(tenant).allowConsult, false);
  assert.equal(Object.keys(b.listProfiles()).includes(tenant), false);
});

test("Kriterium 3: ein lokal offenes Schreiben wird vom Nachladen nicht überschrieben", async () => {
  const schranke = tor();
  const zustand = { halten: false };
  const { a, b, tenant } = await zweiInstanzen(async (text) => {
    if (zustand.halten && /INSERT INTO profile/.test(text)) await schranke.offen;
  });
  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();

  zustand.halten = true;
  b.setProfile(tenant, { allowLookup: true });
  await b.einstellungenNachladen(tenant);

  assert.equal(b.resolveProfile(tenant).allowLookup, true);
  assert.equal(b.resolveProfile(tenant).allowConsult, false);
  schranke.freigeben();
  await b.drainFlushes();
});

test("Kriterium 3: ein Schreiben, das während des Lesens beginnt, wird nicht vom älteren Stand überschrieben", async () => {
  const lesen = tor();
  const gestartet = tor();
  const zustand = { halten: false };
  const { a, b, tenant } = await zweiInstanzen(async (text) => {
    if (zustand.halten && LESEN.test(text)) {
      gestartet.freigeben();
      await lesen.offen;
    }
  });
  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();

  zustand.halten = true;
  const nachladen = b.einstellungenNachladen(tenant);
  await gestartet.offen;
  b.setProfile(tenant, { allowLookup: true });
  lesen.freigeben();
  await nachladen;

  assert.equal(b.resolveProfile(tenant).allowLookup, true);
  assert.equal(b.resolveProfile(tenant).allowConsult, false);
  await b.drainFlushes();
});

test("Kriterium 3: solange ein zweites Schreiben noch offen ist, liest das Nachladen nicht", async () => {
  const schranke = tor();
  const zweites = tor();
  const zustand = { eingefuegt: 0 };
  const { a, b, tenant } = await zweiInstanzen(async (text) => {
    if (!/INSERT INTO profile/.test(text)) return;
    zustand.eingefuegt += 1;
    if (zustand.eingefuegt < 2) return;
    zweites.freigeben();
    await schranke.offen;
  });
  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();
  zustand.eingefuegt = 0;

  b.setProfile(tenant, { allowLookup: true });
  b.setProfile(tenant, { allowLookup: false });
  await zweites.offen;
  await b.einstellungenNachladen(tenant);

  assert.equal(b.resolveProfile(tenant).allowConsult, false);
  schranke.freigeben();
  await b.drainFlushes();
});

test("Kriterium 3: ein offenes Löschen wird vom Nachladen nicht rückgängig gemacht", async () => {
  const schranke = tor();
  const zustand = { halten: false };
  const { a, b, tenant } = await zweiInstanzen(async (text) => {
    if (zustand.halten && /DELETE FROM profile/.test(text)) await schranke.offen;
  });
  b.setProfile(tenant, { allowConsult: true });
  await b.drainFlushes();
  a.setProfile(tenant, { allowLookup: true });
  await a.drainFlushes();

  zustand.halten = true;
  b.deleteProfile(tenant);
  await b.einstellungenNachladen(tenant);

  assert.equal(b.resolveProfile(tenant).allowConsult, false);
  assert.equal(b.resolveProfile(tenant).allowLookup, false);
  schranke.freigeben();
  await b.drainFlushes();
});

test("Kriterium 3: nach dem Schreiben liest das Nachladen wieder", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  b.setProfile(tenant, { allowLookup: true });
  await b.drainFlushes();
  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();

  await b.einstellungenNachladen(tenant);

  assert.equal(b.resolveProfile(tenant).allowConsult, true);
  assert.equal(b.resolveProfile(tenant).allowLookup, true);
});

test("Kriterium 4: scheitert das Lesen, bleibt die Kopie, der Fehler steht im Log und der Aufrufer bekommt keinen", async (t) => {
  const zustand = { kaputt: false };
  const { a, b, tenant } = await zweiInstanzen((text) => {
    if (zustand.kaputt && LESEN.test(text)) throw new Error("Datenbank weg");
  });
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  b.setProfile(tenant, { allowLookup: true });
  await b.drainFlushes();
  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();

  zustand.kaputt = true;
  await b.einstellungenNachladen(tenant);

  assert.equal(b.resolveProfile(tenant).allowLookup, true);
  assert.equal(b.resolveProfile(tenant).allowConsult, false);
  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) => aufruf.arguments[0] === NACHLADEN_FEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
    ),
  );
});

test("Kriterium 4: hängt das Lesen länger als die Frist, bleibt die Kopie und der Aufruf kehrt zurück", async (t) => {
  const haengt = tor();
  const zustand = { halten: false };
  const { a, b, tenant } = await zweiInstanzen(
    async (text) => {
      if (zustand.halten && LESEN.test(text)) await haengt.offen;
    },
    { einstellungenFristMs: KURZE_FRIST_MS },
  );
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();

  zustand.halten = true;
  await b.einstellungenNachladen(tenant);

  assert.equal(b.resolveProfile(tenant).allowConsult, false);
  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) => aufruf.arguments[0] === NACHLADEN_FEHLER_LOG && aufruf.arguments[1] === "Frist abgelaufen",
    ),
  );
  haengt.freigeben();
});

test("Kriterium 4: zwei Nachladen desselben Mandanten lesen nacheinander, nicht gleichzeitig", async () => {
  const lesen = tor();
  const zaehler = { laufend: 0, hoechstens: 0, gesamt: 0 };
  const { a, b, tenant } = await zweiInstanzen(async (text) => {
    if (!LESEN.test(text)) return;
    zaehler.gesamt += 1;
    zaehler.laufend += 1;
    zaehler.hoechstens = Math.max(zaehler.hoechstens, zaehler.laufend);
    await lesen.offen;
    zaehler.laufend -= 1;
  });
  a.setProfile(tenant, { allowConsult: true });
  await a.drainFlushes();

  const eins = b.einstellungenNachladen(tenant);
  const zwei = b.einstellungenNachladen(tenant);
  lesen.freigeben();
  await Promise.all([eins, zwei]);

  assert.equal(zaehler.hoechstens, 1);
  assert.equal(zaehler.gesamt, 2);
  assert.equal(b.resolveProfile(tenant).allowConsult, true);
});
