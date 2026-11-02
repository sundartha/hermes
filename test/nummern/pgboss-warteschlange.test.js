import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung, wackeligeWarteschlange } from "../gemeinsam/pgboss-umgebung.js";

const KIND = "provision_number";
const FEHLVERSUCHE = 4;
const ABLAUF_MS = 30 * 60 * 1000;

const auftrag = (nummer) => ({
  kind: KIND,
  payload: { numberId: nummer },
  idempotencyKey: `provision_${nummer}`,
});

async function mitAbsturz(t, nummer) {
  const clock = neueUhr();
  const umgebung = await pgBossUmgebung(t, { clock });
  const id = await umgebung.queue.enqueue(auftrag(nummer));
  return { ...umgebung, clock, id };
}

test("K1-1: pg-boss stellt einen Auftrag zu, drain führt ihn aus, jobStatus meldet done", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const id = await queue.enqueue(auftrag("num_1"));
  assert.equal(await queue.jobStatus(id), "queued");
  const gesehen = [];
  assert.equal(await queue.drain(async (job) => gesehen.push(job)), 1);
  const [job] = gesehen;
  assert.deepEqual(
    [job.kind, job.payload, job.idempotencyKey],
    [KIND, { numberId: "num_1" }, "provision_num_1"],
  );
  assert.equal(await queue.jobStatus(id), "done");
});

test("K1-2: derselbe idempotencyKey legt keinen zweiten wartenden Auftrag an", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const erster = await queue.enqueue(auftrag("num_2"));
  assert.equal(await queue.enqueue(auftrag("num_2")), erster);
  assert.equal(await queue.drain(async () => undefined), 1);
});

test("K1-3: enqueue ohne idempotencyKey wird abgelehnt", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  await assert.rejects(
    umgebung.queue.enqueue({ kind: KIND, payload: {}, idempotencyKey: "" }),
    TypeError,
  );
});

test("K1-4: ein Fehlschlag setzt den Auftrag zurück in die Warteschlange, er ist nicht verloren", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const id = await queue.enqueue(auftrag("num_4"));
  const scheitern = async () => {
    throw new Error("Anbieter nicht erreichbar");
  };
  assert.equal(await queue.drain(scheitern), 1);
  assert.equal(await queue.jobStatus(id), "queued");
});

test("K1-5: nach Absturz mitten im Auftrag wird er nach Ablauf erneut zugestellt", async (t) => {
  const umgebung = await mitAbsturz(t, "num_5");
  const { db, queue, clock, id } = umgebung;
  await db.abfragen(
    "UPDATE pgboss.job SET state = 'active', started_on = to_timestamp($1 / 1000.0) WHERE name = $2",
    [clock.now(), KIND],
  );
  assert.equal(
    await queue.drain(async () => assert.fail("Auftrag darf noch nicht fällig sein")),
    0,
  );
  await clock.tick(ABLAUF_MS);
  const gesehen = [];
  assert.equal(await queue.drain(async (job) => gesehen.push(job.idempotencyKey)), 1);
  assert.deepEqual(gesehen, ["provision_num_5"]);
  assert.equal(await queue.jobStatus(id), "done");
});

test("K1-6: nach dem vierten Fehlversuch landet der Auftrag in der Totpost-Ablage und kommt nicht wieder", async (t) => {
  const umgebung = await mitAbsturz(t, "num_6");
  const { db, queue, clock, id } = umgebung;
  let versuche = 0;
  const scheitern = async () => {
    versuche += 1;
    throw new Error("Anbieter nicht erreichbar");
  };
  for (let runde = 1; runde <= FEHLVERSUCHE; runde += 1) {
    assert.equal(await queue.drain(scheitern), 1, `Versuch ${runde} wird zugestellt`);
    await clock.tick(ABLAUF_MS);
  }
  assert.equal(versuche, FEHLVERSUCHE);
  assert.equal(await queue.drain(scheitern), 0);
  assert.equal(await queue.jobStatus(id), "failed");
  const { rows } = await db.abfragen("SELECT data FROM pgboss.job WHERE name = $1", [
    `${KIND}_totpost`,
  ]);
  assert.deepEqual(
    rows.map((zeile) => zeile.data.idempotencyKey),
    ["provision_num_6"],
  );
});

test("K1-9: ein neuer Prozess findet die Aufträge des alten, auch ohne eigenes enqueue", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  await umgebung.queue.enqueue(auftrag("num_9"));
  await umgebung.queue.stop();
  const gesehen = [];
  const verarbeitet = await umgebung
    .weitereQueue()
    .drain(async (job) => gesehen.push(job.idempotencyKey));
  assert.equal(verarbeitet, 1);
  assert.deepEqual(gesehen, ["provision_num_9"]);
});

const warteschlangenZeile = async (db, name) => {
  const { rows } = await db.abfragen(
    "SELECT policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, retention_seconds, deletion_seconds, dead_letter FROM pgboss.queue WHERE name = $1",
    [name],
  );
  return rows[0];
};

const ausgabenNachSchluessel = async (db) => {
  const { rows } = await db.abfragen(
    "SELECT singleton_key, output FROM pgboss.job WHERE name = $1 ORDER BY singleton_key",
    [KIND],
  );
  return Object.fromEntries(rows.map((zeile) => [zeile.singleton_key, zeile.output]));
};

test("K1-10: pg-boss legt keinen eigenen Zeitplaner an, es gibt nur die Warteschlangen des Nummernkaufs", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  await umgebung.queue.start();
  const vorher = await umgebung.db.abfragen("SELECT name FROM pgboss.queue");
  assert.deepEqual(vorher.rows, []);
  await umgebung.queue.enqueue(auftrag("num_10"));
  const { rows } = await umgebung.db.abfragen("SELECT name FROM pgboss.queue ORDER BY name");
  assert.deepEqual(
    rows.map((zeile) => zeile.name),
    [KIND, `${KIND}_totpost`],
  );
});

test("K1-11: der Nummernkauf wird höchstens vierfach versucht, läuft nach 5 Minuten ab und landet danach 30 Tage in der Totpost-Ablage", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  await umgebung.queue.enqueue(auftrag("num_11"));
  assert.deepEqual(await warteschlangenZeile(umgebung.db, KIND), {
    policy: "exclusive",
    retry_limit: 3,
    retry_delay: 30,
    retry_backoff: true,
    retry_delay_max: 600,
    expire_seconds: 300,
    retention_seconds: 604800,
    deletion_seconds: 86400,
    dead_letter: `${KIND}_totpost`,
  });
  const totpost = await warteschlangenZeile(umgebung.db, `${KIND}_totpost`);
  assert.equal(totpost.retention_seconds, 30 * 24 * 3600);
  assert.equal(totpost.deletion_seconds, 30 * 24 * 3600);
});

test("K1-12: ein Fehler der Datenbankverbindung wird mit Meldung geloggt statt den Prozess zu beenden", async (t) => {
  const meldungen = [];
  const logger = { error: (...teile) => meldungen.push(teile) };
  const umgebung = await pgBossUmgebung(t, { logger });
  const instanz = await umgebung.queue.start();
  instanz.emit("error", new Error("Verbindung verloren"));
  assert.deepEqual(meldungen, [["[queue] pg-boss:", "Verbindung verloren"]]);
});

test("K1-13: ein scheiternder Handler hinterlässt seine Fehlermeldung am Auftrag, auch bei Nicht-Error-Werten", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const ursachen = {
    provision_a: new Error("Anbieter nicht erreichbar"),
    provision_b: "Textfehler",
    provision_c: null,
  };
  for (const nummer of ["a", "b", "c"]) await queue.enqueue(auftrag(nummer));
  const scheitern = async (job) => {
    throw ursachen[job.idempotencyKey];
  };
  assert.equal(await queue.drain(scheitern), 3);
  assert.deepEqual(await ausgabenNachSchluessel(umgebung.db), {
    provision_a: { message: "Anbieter nicht erreichbar" },
    provision_b: { message: "Textfehler" },
    provision_c: { message: "null" },
  });
});

test("K1-14: jobStatus meldet laufend als queued, abgebrochen als failed und unbekannt als null", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const laufend = await queue.enqueue(auftrag("num_14a"));
  const abgebrochen = await queue.enqueue(auftrag("num_14b"));
  const instanz = await queue.start();
  await instanz.cancel(KIND, abgebrochen.slice(KIND.length + 1));
  const gesehen = [];
  await queue.drain(async (job) => gesehen.push(await queue.jobStatus(laufend), job.id));
  assert.deepEqual(gesehen, ["queued", laufend]);
  assert.equal(await queue.jobStatus(abgebrochen), "failed");
  assert.equal(await queue.jobStatus(`${KIND}/00000000-0000-4000-8000-000000000000`), null);
});

test("K1-15: enqueue ohne Textschlüssel wird abgewiesen und nennt den idempotencyKey", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  for (const schluessel of [undefined, null, 42])
    await assert.rejects(
      umgebung.queue.enqueue({ kind: KIND, payload: {}, idempotencyKey: schluessel }),
      { name: "TypeError", message: /idempotencyKey/ },
    );
});

test("K1-16: ein wiederholtes enqueue liefert die Kennung des Auftrags mit demselben Schlüssel, nicht irgendeines anderen", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const erster = await queue.enqueue(auftrag("num_16a"));
  const zweiter = await queue.enqueue(auftrag("num_16b"));
  assert.notEqual(erster, zweiter);
  assert.equal(await queue.enqueue(auftrag("num_16a")), erster);
  assert.equal(await queue.enqueue(auftrag("num_16b")), zweiter);
});

test("K1-17: scheitert der Start an der Datenbank, wird er beim nächsten Gebrauch neu versucht und stop wirft nicht", async (t) => {
  const { queue, zustand } = await wackeligeWarteschlange(t);
  await assert.rejects(queue.start(), /Datenbank nicht erreichbar/);
  await queue.stop();
  await assert.rejects(queue.enqueue(auftrag("num_17")), /Datenbank nicht erreichbar/);
  zustand.ausfall = false;
  assert.equal(typeof (await queue.enqueue(auftrag("num_17"))), "string");
  assert.equal(await queue.drain(async () => undefined), 1);
});

test("K1-17b: stop während ein Start scheitert, wirft nicht und lässt einen neuen Start zu", async (t) => {
  const { queue, zustand } = await wackeligeWarteschlange(t);
  const start = queue.start();
  const stopp = queue.stop();
  await assert.rejects(start, /Datenbank nicht erreichbar/);
  await stopp;
  zustand.ausfall = false;
  assert.equal(typeof (await queue.enqueue(auftrag("num_17b"))), "string");
});

function zaehlendesAnlegen(instanz, aufrufe, scheiternBeimErsten = false) {
  const original = instanz.createQueue.bind(instanz);
  let offen = scheiternBeimErsten;
  return async (name, optionen) => {
    aufrufe.push(name);
    if (offen) {
      offen = false;
      throw new Error("Anlegen fehlgeschlagen");
    }
    return original(name, optionen);
  };
}

test("K1-18: die Warteschlange wird je Instanz einmal angelegt; ein Fehlschlag beim Anlegen wird beim nächsten enqueue wiederholt", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const totpost = `${KIND}_totpost`;
  const aufrufe = [];
  const erste = await queue.start();
  erste.createQueue = zaehlendesAnlegen(erste, aufrufe, true);
  await assert.rejects(queue.enqueue(auftrag("num_18a")), /Anlegen fehlgeschlagen/);
  await queue.enqueue(auftrag("num_18a"));
  await queue.enqueue(auftrag("num_18b"));
  assert.deepEqual(aufrufe, [totpost, totpost, KIND]);
  await queue.stop();
  const neue = await queue.start();
  assert.notEqual(neue, erste, "nach stop startet start() eine neue Instanz");
  const neueAufrufe = [];
  neue.createQueue = zaehlendesAnlegen(neue, neueAufrufe);
  await queue.enqueue(auftrag("num_18c"));
  assert.deepEqual(neueAufrufe, [totpost, KIND]);
});

test("K1-19: stop fährt pg-boss geordnet herunter: laufende Aufträge bis zu 20 Sekunden abwarten, dann Verbindungen schließen", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const instanz = await umgebung.queue.start();
  const original = instanz.stop.bind(instanz);
  const optionen = [];
  instanz.stop = (gegeben) => {
    optionen.push(gegeben);
    return original(gegeben);
  };
  await umgebung.queue.stop();
  assert.deepEqual(optionen, [{ graceful: true, timeout: 20000, close: true }]);
});

test("K1-20: drain holt die Aufträge in Gruppen zu höchstens 5, nicht alle auf einmal", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue, db } = umgebung;
  for (let nummer = 1; nummer <= 7; nummer += 1) await queue.enqueue(auftrag(`num_20_${nummer}`));
  const gleichzeitigAktiv = [];
  const zaehlen = async () => {
    const { rows } = await db.abfragen("SELECT count(*)::int AS n FROM pgboss.job WHERE state = 'active'");
    gleichzeitigAktiv.push(rows[0].n);
  };
  assert.equal(await queue.drain(zaehlen), 7);
  assert.deepEqual(gleichzeitigAktiv, [5, 4, 3, 2, 1, 2, 1]);
});
