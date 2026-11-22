import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { config as basisKonfiguration } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.js";
import { speicherBereiche } from "../../src/store.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../../src/worker/provisioning.js";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { makeConfigOverrides } from "../helpers.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const { withConfigOverrides } = makeConfigOverrides(basisKonfiguration);
const MANDANT = "t_kauf_besitz";
const NUMMER_ID = "num_kauf_besitz";
const E164 = "+12025550191";
const KENNUNG_A = "a-host:00000000-0000-4000-8000-0000000000a1";
const KENNUNG_B = "b-host:00000000-0000-4000-8000-0000000000b2";
const KENNUNG_C = "c-host:00000000-0000-4000-8000-0000000000c3";
const EINMAL = 1;
const konfig = withConfigNamespaces({
  ...OHNE_EL_ZUGANG,
  paymentEnabled: false,
  provisioningEnabled: true,
  maxNumbers: 50,
  maxNumbersPerTenant: 1,
  provisioningRedriveMaxAgeMs: 3_600_000,
  geoEnabled: false,
  provisioningCountry: "US",
  forceNumberCountry: "",
});

function einzelverbindung(db) {
  let kette = Promise.resolve();
  return {
    withClient(arbeit) {
      const lauf = kette.then(() => arbeit({ query: (text, werte) => db.query(text, werte), exec: (sql) => db.exec(sql) }));
      kette = lauf.catch(() => {});
      return lauf;
    },
  };
}

const kontext = (db) => db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);

async function lesen(db, text, werte = []) {
  await kontext(db);
  return (await db.query(text, werte)).rows;
}

function auftragId({ store }) {
  const [auftrag] = store.load().provisioningJobs;
  return auftrag.id;
}
async function besitzerDesAuftrags(db) {
  const [zeile] = await lesen(db, "SELECT instanz FROM provisioning_job");
  return zeile.instanz;
}

async function aufbau() {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = einzelverbindung(db);
  await makePgStoreMitSperre(runner).init();
  await kontext(db);
  await db.query("INSERT INTO tenant (id, status, idp_subject, country, kyc_level) VALUES ($1, 'active', $1, 'US', 'card')", [MANDANT]);
  await db.query("INSERT INTO number (id, tenant_id, provider, status, country, language) VALUES ($1, $2, 'telnyx', 'requested', 'US', 'en')", [NUMMER_ID, MANDANT]);
  return { db, runner, bestellungen: [], zustand: { lesbar: true } };
}

async function instanz(umgebung, kennung, kauf = konfig) {
  const { db, runner, bestellungen, zustand } = umgebung;
  const store = makePgStoreMitSperre(runner, { kennung });
  await store.init();
  store.besitzLage = async () => {
    if (!zustand.lesbar) return { eigene: kennung, lebende: null };
    const { rows } = await db.query("SELECT kennung FROM instanz_lebenszeichen");
    return { eigene: kennung, lebende: rows.map((zeile) => zeile.kennung) };
  };
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  const einreihungen = mock.method(queue, "enqueue");
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: kauf,
    queue,
    billing: {},
    metering: {},
    numberProvisioning: () => ({
      searchNumbers: async () => [{ e164: E164 }],
      orderNumber: async ({ e164 }) => {
        bestellungen.push(kennung);
        return { e164, providerNumberId: "pn_besitz" };
      },
    }),
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob,
    markProvisioningJob,
    classifyQueuedProvisioningJobs,
    findNumber,
  });
  return { store, orchestrator, einreihungen };
}

const findNumber = (zustand, id) => zustand.numbers.find((nummer) => nummer.id === id);
const recordProvisioningJob = () => null;
const classifyQueuedProvisioningJobs = (zustand) => ({
  close: [],
  hold: [],
  redrive: zustand.provisioningJobs.filter((job) => job.status === "queued" && findNumber(zustand, job.numberId)?.status === "requested"),
});

function markProvisioningJob(zustand, id, status) {
  Object.assign(zustand.provisioningJobs.find((job) => job.id === id), { status });
}

const lebt = (db, kennung) => db.query("INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um) VALUES ($1, now()) ON CONFLICT (kennung) DO UPDATE SET gemeldet_um = now()", [kennung]);
const stirbt = (db, kennung) => db.query("DELETE FROM instanz_lebenszeichen WHERE kennung = $1", [kennung]);

async function abgleichenUndAbarbeiten(...instanzen) {
  await Promise.all(instanzen.map((eine) => eine.orchestrator.reconcileOrphanedProvisioning()));
  for (const eine of instanzen) await eine.orchestrator.runProvisioningDrainExclusive();
  for (const eine of instanzen) await eine.store.drainFlushes();
}

function meldungen(t) {
  const gesammelt = [];
  for (const art of ["log", "warn", "error"]) t.mock.method(console, art, (...teile) => gesammelt.push(teile.map(String).join(" ")));
  return gesammelt;
}

async function auftragVonA(umgebung) {
  const a = await instanz(umgebung, KENNUNG_A);
  await lebt(umgebung.db, KENNUNG_A);
  assert.equal((await a.orchestrator.queueProvisioning(NUMMER_ID, MANDANT)).ok, true);
  await a.store.drainFlushes();
  return a;
}

test("Nummernkauf: ein neuer Auftrag traegt die Kennung der anlegenden Instanz, der Gesamt-Flush schreibt sie nicht", async () => {
  const umgebung = await aufbau();
  const a = await auftragVonA(umgebung);
  assert.equal(await besitzerDesAuftrags(umgebung.db), KENNUNG_A);
  const [auftrag] = a.store.load().provisioningJobs;
  auftrag.instanz = "fremd-gesetzt";
  a.store.save();
  await a.store.drainFlushes();
  assert.equal(await besitzerDesAuftrags(umgebung.db), KENNUNG_A);
});

test("Nummernkauf: B stoesst den Auftrag der lebenden A nicht an, weder beim Start noch im Takt", async (t) => {
  const umgebung = await aufbau();
  const logs = meldungen(t);
  const fruehB = await instanz(umgebung, KENNUNG_B);
  const a = await auftragVonA(umgebung);
  const spaetB = await instanz(umgebung, KENNUNG_C);
  await lebt(umgebung.db, KENNUNG_B);
  await lebt(umgebung.db, KENNUNG_C);
  await abgleichenUndAbarbeiten(fruehB, spaetB);
  assert.deepEqual(umgebung.bestellungen, []);
  assert.equal(await besitzerDesAuftrags(umgebung.db), KENNUNG_A);
  const jobId = auftragId(a);
  assert.equal(logs.filter((zeile) => zeile === `[provision-reconcile] fremd job=${jobId}`).length, 2, logs.join("|"));
});

test("Nummernkauf: faellt A aus, bestellt eine lebende B im Takt genau einmal und traegt sich ein, auch wenn B und C gleichzeitig laufen", async () => {
  const umgebung = await aufbau();
  const fruehB = await instanz(umgebung, KENNUNG_B);
  const c = await instanz(umgebung, KENNUNG_C);
  await auftragVonA(umgebung);
  await lebt(umgebung.db, KENNUNG_B);
  await lebt(umgebung.db, KENNUNG_C);
  await stirbt(umgebung.db, KENNUNG_A);
  await abgleichenUndAbarbeiten(fruehB, c);
  assert.equal(umgebung.bestellungen.length, EINMAL);
  assert.ok([KENNUNG_B, KENNUNG_C].includes(await besitzerDesAuftrags(umgebung.db)));
  assert.equal(umgebung.bestellungen[0], await besitzerDesAuftrags(umgebung.db));
  assert.deepEqual(await lesen(umgebung.db, "SELECT status FROM provisioning_job"), [{ status: "done" }]);
});

test("Nummernkauf: ein Auftrag ohne Besitzer wird uebernommen, ein eigener Auftrag nicht erneut eingereiht", async () => {
  const umgebung = await aufbau();
  const b = await instanz(umgebung, KENNUNG_B);
  await auftragVonA(umgebung);
  await lebt(umgebung.db, KENNUNG_A);
  await lebt(umgebung.db, KENNUNG_B);
  await kontext(umgebung.db);
  await umgebung.db.query("UPDATE provisioning_job SET instanz = NULL");
  await b.orchestrator.reconcileOrphanedProvisioning();
  assert.equal(await besitzerDesAuftrags(umgebung.db), KENNUNG_B);
  assert.equal(b.einreihungen.mock.callCount(), EINMAL);
  await b.orchestrator.reconcileOrphanedProvisioning();
  assert.equal(b.einreihungen.mock.callCount(), EINMAL);
  await b.orchestrator.runProvisioningDrainExclusive();
  assert.deepEqual(umgebung.bestellungen, [KENNUNG_B]);
});

test("Nummernkauf: ist das Lebenszeichen nicht lesbar, haelt B den fremden Auftrag an", async (t) => {
  const umgebung = await aufbau();
  const logs = meldungen(t);
  const b = await instanz(umgebung, KENNUNG_B);
  const a = await auftragVonA(umgebung);
  umgebung.zustand.lesbar = false;
  await abgleichenUndAbarbeiten(b);
  assert.deepEqual(umgebung.bestellungen, []);
  assert.equal(await besitzerDesAuftrags(umgebung.db), KENNUNG_A);
  const jobId = auftragId(a);
  const halt = logs.filter((zeile) => zeile.startsWith(`[provision-reconcile] hold job=${jobId} `) && zeile.endsWith(" grund=lebenszeichen_unlesbar"));
  assert.equal(halt.length, EINMAL, logs.join("|"));
});

test("Nummernkauf: ist der Nummernkauf abgeschaltet, uebernimmt B auch den Auftrag eines ausgefallenen Besitzers nicht", async () => {
  const umgebung = await aufbau();
  const b = await instanz(umgebung, KENNUNG_B, withConfigNamespaces({ ...OHNE_EL_ZUGANG, provisioningEnabled: false, provisioningRedriveMaxAgeMs: 3_600_000 }));
  await auftragVonA(umgebung);
  await stirbt(umgebung.db, KENNUNG_A);
  await abgleichenUndAbarbeiten(b);
  assert.deepEqual(umgebung.bestellungen, []);
  assert.equal(await besitzerDesAuftrags(umgebung.db), KENNUNG_A);
});

test("Nummernkauf: die Uebernahme an Auftraegen ist ein Vertrag der Fassade, ein Speicher ohne Datenbank uebernimmt jeden Auftrag", async () => {
  const bereiche = speicherBereiche({ nummernSql: () => null });
  assert.equal(await bereiche.nummernkauf.uebernimmAuftrag({ tenantId: MANDANT, jobId: "job_x", alt: KENNUNG_A, neu: KENNUNG_B }), true);
  assert.equal(await bereiche.nummernkauf.ladeFremdeOffeneAuftraege(KENNUNG_B), null);
});

test("Nummernkauf: der Auftrag wechselt nur aus dem erwarteten Zustand und nur einmal den Besitzer", async () => {
  const umgebung = await aufbau();
  const a = await auftragVonA(umgebung);
  const b = await instanz(umgebung, KENNUNG_B);
  const jobId = auftragId(a);
  const uebernehmen = (eingabe) => b.store.nummernSql().auftragUebernehmen({ tenantId: MANDANT, jobId, neu: KENNUNG_B, ...eingabe });
  assert.equal(await uebernehmen({ alt: KENNUNG_C }), false);
  assert.equal(await uebernehmen({ alt: null }), false);
  assert.equal(await besitzerDesAuftrags(umgebung.db), KENNUNG_A);
  await kontext(umgebung.db);
  await umgebung.db.query("UPDATE provisioning_job SET status = 'done'");
  assert.equal(await uebernehmen({ alt: KENNUNG_A }), false);
  await umgebung.db.query("UPDATE provisioning_job SET status = 'queued'");
  assert.equal(await uebernehmen({ alt: KENNUNG_A }), true);
  assert.equal(await besitzerDesAuftrags(umgebung.db), KENNUNG_B);
  assert.equal(await uebernehmen({ alt: KENNUNG_A }), false);
});

test("Nummernkauf: der Abgleich von B schreibt den Kauf der lebenden A nicht in den Spiegel zurueck, nach As Ausfall gibt es keine zweite Bestellung", async () => {
  const umgebung = await aufbau();
  const b = await instanz(umgebung, KENNUNG_B);
  const spiegel = b.store.load();
  spiegel.numbers.splice(0, spiegel.numbers.length, ...spiegel.numbers.filter((nummer) => nummer.id !== NUMMER_ID));
  const a = await auftragVonA(umgebung);
  await lebt(umgebung.db, KENNUNG_B);
  await b.orchestrator.reconcileOrphanedProvisioning();
  await a.orchestrator.runProvisioningDrainExclusive();
  await a.store.drainFlushes();
  b.store.save();
  await b.store.drainFlushes();
  const [auftrag] = await lesen(umgebung.db, "SELECT status, instanz FROM provisioning_job");
  const [nummer] = await lesen(umgebung.db, "SELECT status, e164, provider_number_id FROM number WHERE id = $1", [NUMMER_ID]);
  assert.deepEqual({ ...auftrag }, { status: "done", instanz: KENNUNG_A });
  assert.deepEqual({ ...nummer }, { status: "active", e164: E164, provider_number_id: "pn_besitz" });
  await stirbt(umgebung.db, KENNUNG_A);
  await abgleichenUndAbarbeiten(b);
  assert.deepEqual(umgebung.bestellungen, [KENNUNG_A]);
});

test("Nummernkauf: ein offener fremder Auftrag ohne Nummernzeile loest weder Fehler noch Bestellung aus und bleibt bei A", async (t) => {
  const umgebung = await aufbau();
  const logs = meldungen(t);
  const b = await instanz(umgebung, KENNUNG_B);
  await auftragVonA(umgebung);
  await lebt(umgebung.db, KENNUNG_B);
  await stirbt(umgebung.db, KENNUNG_A);
  await kontext(umgebung.db);
  await umgebung.db.query("ALTER TABLE provisioning_job DROP CONSTRAINT provisioning_job_number_id_fkey");
  await umgebung.db.query("UPDATE provisioning_job SET number_id = $1", ["num_fehlt"]);
  await abgleichenUndAbarbeiten(b);
  assert.deepEqual(umgebung.bestellungen, []);
  assert.equal(b.einreihungen.mock.callCount(), 0);
  assert.equal(await besitzerDesAuftrags(umgebung.db), KENNUNG_A);
  assert.deepEqual(logs.filter((zeile) => zeile.includes("fehlgeschlagen")), [], logs.join("|"));
});

test("Nummernkauf: scheitert der Abgleich, meldet der Takt genau diese Meldung, bestellt nichts und der naechste Takt laeuft weiter", async (t) => {
  const umgebung = await aufbau();
  const fehler = t.mock.method(console, "error", () => {});
  const b = await instanz(umgebung, KENNUNG_B);
  await auftragVonA(umgebung);
  await lebt(umgebung.db, KENNUNG_B);
  await stirbt(umgebung.db, KENNUNG_A);
  const lesbar = b.store.besitzLage;
  b.store.besitzLage = async () => {
    throw new Error("lebenszeichen kaputt");
  };
  await b.orchestrator.reconcileOrphanedProvisioning();
  await b.orchestrator.runProvisioningDrainExclusive();
  assert.deepEqual(fehler.mock.calls.map((aufruf) => aufruf.arguments), [["[provision-reconcile] Abgleich der offenen Auftraege fehlgeschlagen"]]);
  assert.deepEqual(umgebung.bestellungen, []);
  b.store.besitzLage = lesbar;
  await abgleichenUndAbarbeiten(b);
  assert.deepEqual(umgebung.bestellungen, [KENNUNG_B]);
  assert.equal(fehler.mock.callCount(), EINMAL);
});
