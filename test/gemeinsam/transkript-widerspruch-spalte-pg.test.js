import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { neuePglite } from "../pglite-helfer.js";
import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const BOOTSTRAP = "owner";
const FRIST_TAGE = 30;
const UEBER_DER_FRIST_MS = 31 * 86400000;
const SPEICHER_OEFFNER = [
  () => import("../../src/store.js?widerspruch-spalte-1").then(oeffneSpeicherAn),
  () => import("../../src/store.js?widerspruch-spalte-2").then(oeffneSpeicherAn),
  () => import("../../src/store.js?widerspruch-spalte-3").then(oeffneSpeicherAn),
  () => import("../../src/store.js?widerspruch-spalte-4").then(oeffneSpeicherAn),
  () => import("../../src/store.js?widerspruch-spalte-5").then(oeffneSpeicherAn),
];

let zaehler = 0;

async function speicherOeffnen(db) {
  const echterPool = pg.Pool;
  process.env.DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "hermes-widerspruch-spalte-"));
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
  poolAufPglite(db);
  try {
    return await SPEICHER_OEFFNER[zaehler++]();
  } finally {
    pg.Pool = echterPool;
  }
}

const neuerAnruf = (felder) => ({
  direction: "outbound",
  from: "+4930111222333",
  to: "+4915112345678",
  goal: "Widerspruch-Roundtrip",
  tenantId: BOOTSTRAP,
  ...felder,
});

test("3821-13: der Widerspruch ueberlebt das Neuladen, ohne ihn bleibt das Feld false", async () => {
  const db = await neuePglite();
  const store = await speicherOeffnen(db);
  const abgelehnt = store.createCall(neuerAnruf({ transcriptDeclined: true }));
  const normal = store.createCall(neuerAnruf({}));
  await store.save();
  await store.drainFlushes();
  const geladen = await speicherOeffnen(db);
  assert.equal(geladen.getCall(abgelehnt.id).transcriptDeclined, true);
  assert.equal(geladen.getCall(normal.id).transcriptDeclined, false);
});

const segmente = async (db, callId) => {
  const { rows } = await db.query(`SELECT count(*) AS n FROM transcript_segment WHERE call_id=$1`, [callId]);
  return Number(rows[0].n);
};

test("3821-16: ein spaeter gesetzter Widerspruch wird gespeichert", async () => {
  const db = await neuePglite();
  const store = await speicherOeffnen(db);
  const call = store.createCall(neuerAnruf({}));
  await store.save();
  await store.drainFlushes();
  store.markTranscriptDeclined(call.id);
  await store.save();
  await store.drainFlushes();
  const geladen = await speicherOeffnen(db);
  assert.equal(geladen.getCall(call.id).transcriptDeclined, true);
});

test("3821-17: der Loeschlauf entfernt mit dem Anruf auch die Zeilen in transcript_segment", async () => {
  const db = await neuePglite();
  const store = await speicherOeffnen(db);
  const call = store.createCall(neuerAnruf({}));
  store.addTranscript(call.id, "caller", "Wortlaut");
  const stehend = store.getCall(call.id);
  stehend.status = "completed";
  stehend.endedAt = new Date(Date.now() - UEBER_DER_FRIST_MS).toISOString();
  await store.save();
  await store.drainFlushes();
  assert.equal(await segmente(db, call.id), 1);
  store.pruneOldData(FRIST_TAGE, 0, 0);
  await store.save();
  await store.drainFlushes();
  assert.equal(await segmente(db, call.id), 0);
});
