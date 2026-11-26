import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgStore, nutzungAuffrischenVon, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";
import { nutzungAuffrischen } from "../../src/store.js";
import { NUTZUNG_AUFFRISCHEN_FRIST_MS } from "../../src/begriffe/speicher.ts";

const FRIST_MS = NUTZUNG_AUFFRISCHEN_FRIST_MS;
const LESEN = "FROM usage";

function runnerFuer(db, vorQuery = async () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

const meldungenSammeln = (t) => {
  const meldungen = [];
  t.mock.method(console, "error", (...teile) => meldungen.push(teile.join(" ")));
  return meldungen;
};

test("Auffrischen: antwortet die Datenbank nicht binnen der Frist, ist die Antwort false und die Frist wird gemeldet", async (t) => {
  const db = await pgliteAlsRolleOhneSuperuser();
  let haengen = false;
  const store = makePgStore(
    runnerFuer(db, (text) => (haengen && text.includes(LESEN) ? new Promise(() => {}) : Promise.resolve())),
  );
  await store.init();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await new Promise((fertig) => setImmediate(fertig));
  const meldungen = meldungenSammeln(t);
  haengen = true;
  let antwort;
  const offen = nutzungAuffrischenVon(store.load(), BOOTSTRAP_TENANT_ID).then((wert) => {
    antwort = wert;
  });
  t.mock.timers.tick(FRIST_MS - 1);
  await new Promise((fertig) => setImmediate(fertig));
  assert.equal(antwort, undefined);
  t.mock.timers.tick(1);
  await offen;
  assert.equal(antwort, false);
  assert.deepEqual(meldungen, ["[nutzung] Auffrischung nicht binnen der Frist, Pruefung mit dem Stand des Prozesses"]);
});

test("Auffrischen: scheitert das Lesen, ist die Antwort false und der Grund wird gemeldet", async (t) => {
  const db = await pgliteAlsRolleOhneSuperuser();
  let kaputt = false;
  const store = makePgStore(
    runnerFuer(db, async (text) => {
      if (kaputt && text.includes(LESEN)) throw new Error("Leitung weg");
    }),
  );
  await store.init();
  kaputt = true;
  const meldungen = meldungenSammeln(t);
  assert.equal(await nutzungAuffrischenVon(store.load(), BOOTSTRAP_TENANT_ID), false);
  assert.deepEqual(meldungen, ["[nutzung] Auffrischung fehlgeschlagen, Pruefung mit dem Stand des Prozesses: Leitung weg"]);
});

test("Auffrischen: der JSON-Speicher hat nichts nachzuladen und antwortet true", async () => {
  assert.strictEqual(await nutzungAuffrischen(BOOTSTRAP_TENANT_ID), true);
});
