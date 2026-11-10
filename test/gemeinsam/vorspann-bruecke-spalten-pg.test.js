import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { neuePglite } from "../pglite-helfer.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const BRUECKE_ZEIT = "2026-11-10T10:00:00.000Z";
const EL_BEIN = "v3:el-bein-1";
const MAIL_ZEIT = "2026-11-10T11:00:00.000Z";
const BOOTSTRAP = "owner";
const HTTP_OK = 200;
const SPEICHER_OEFFNER = [
  () => import("../../src/store.js?bruecke-spalten-1").then(oeffneSpeicherAn),
  () => import("../../src/store.js?bruecke-spalten-2").then(oeffneSpeicherAn),
  () => import("../../src/store.js?bruecke-spalten-3").then(oeffneSpeicherAn),
  () => import("../../src/store.js?bruecke-spalten-4").then(oeffneSpeicherAn),
  () => import("../../src/store.js?bruecke-spalten-5").then(oeffneSpeicherAn),
  () => import("../../src/store.js?bruecke-spalten-6").then(oeffneSpeicherAn),
];

let zaehler = 0;

async function speicherOeffnen(db) {
  const echterPool = pg.Pool;
  process.env.DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "hermes-bruecke-spalten-"));
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
  poolAufPglite(db);
  try {
    return await SPEICHER_OEFFNER[zaehler++]();
  } finally {
    pg.Pool = echterPool;
  }
}

async function neueDatenbank() {
  const db = await neuePglite();
  const store = await speicherOeffnen(db);
  return { db, store };
}

const neuerAnruf = () => ({
  direction: "outbound",
  from: "+4930111222333",
  to: "+4915112345678",
  goal: "Bruecke-Spalten-Roundtrip",
  tenantId: BOOTSTRAP,
});

test("K1+K3: bridgedAt und elCallControlId ueberleben Reopen und spaetere Flushes, Nachbarspalten verrutschen nicht", async () => {
  const { db, store } = await neueDatenbank();
  const call = store.createCall(neuerAnruf());
  const stehend = store.getCall(call.id);
  stehend.bridgedAt = BRUECKE_ZEIT;
  stehend.elCallControlId = EL_BEIN;
  stehend.callerIsOwner = true;
  stehend.notPlacedMailSentAt = MAIL_ZEIT;
  await store.save();
  await store.drainFlushes();

  const erster = await speicherOeffnen(db);
  const geladen = erster.getCall(call.id);
  assert.equal(geladen.bridgedAt, BRUECKE_ZEIT);
  assert.equal(geladen.elCallControlId, EL_BEIN);
  assert.equal(geladen.callerIsOwner, true);
  assert.equal(geladen.notPlacedMailSentAt, MAIL_ZEIT);

  erster.recordFailureReason(call.id, "unreachable:probe");
  await erster.save();
  await erster.drainFlushes();
  const zweiter = await speicherOeffnen(db);
  assert.equal(zweiter.getCall(call.id).bridgedAt, BRUECKE_ZEIT);
  assert.equal(zweiter.getCall(call.id).elCallControlId, EL_BEIN);
});

test("K2: ohne Werte sind beide Felder null", async () => {
  const { db, store } = await neueDatenbank();
  const call = store.createCall(neuerAnruf());
  await store.save();
  await store.drainFlushes();
  const geladen = (await speicherOeffnen(db)).getCall(call.id);
  assert.equal(geladen.bridgedAt, null);
  assert.equal(geladen.elCallControlId, null);
});

test("K5: die Kundensicht der Anrufabfrage enthaelt keines der beiden Felder", async () => {
  const { store } = await neueDatenbank();
  const call = store.createCall(neuerAnruf());
  const stehend = store.getCall(call.id);
  stehend.bridgedAt = BRUECKE_ZEIT;
  stehend.elCallControlId = EL_BEIN;
  const { makeReadRoutes } = await import("../../src/routes/api-read.js");
  const { withConfigNamespaces } = await import("../config-namespaces-helper.js");
  const app = express();
  app.use(
    makeReadRoutes({
      store,
      config: withConfigNamespaces({ claudeModel: "claude-haiku-4-5", voiceEngine: "budget" }),
      audit: () => {},
      tenant: {
        requestTenant: () => BOOTSTRAP,
        requireTenant: () => BOOTSTRAP,
        tenantOwnsCall: (angerufen, mandant) => angerufen.tenantId === mandant,
      },
    }),
  );
  const server = await new Promise((fertig) => {
    const lauscher = app.listen(0, () => fertig(lauscher));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls/${call.id}`);
    assert.equal(antwort.status, HTTP_OK);
    const sicht = await antwort.json();
    assert.equal(sicht.id, call.id);
    assert.equal("bridgedAt" in sicht, false);
    assert.equal("elCallControlId" in sicht, false);
  } finally {
    await new Promise((zu) => server.close(zu));
  }
});
