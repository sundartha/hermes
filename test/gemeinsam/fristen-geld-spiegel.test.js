import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const A = "t_fgs_a";
const B = "t_fgs_b";
const JETZT = Date.parse("2030-01-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const LEASE_MS = 30_000;
const ANFRAGE = { art: "geld", jetztMs: JETZT, limitJeMandant: 10, leaseMs: LEASE_MS };

const { speicher } = await jsonSpeicherImDatenordner("hermes-fristen-geld-");
await speicher.oeffneSpeicher();

const zeitpunkt = (abstandMs) => (abstandMs === null ? undefined : new Date(JETZT + abstandMs).toISOString());

function anruf(tenantId, { status = "active", geld = null, abgehobenVorMs = null, hoechstdauerLease = null, geldLease = null } = {}) {
  const call = speicher.createCall({ direction: "inbound", from: "+49", to: "+49", tenantId });
  Object.assign(call, {
    status,
    fristGeldAt: zeitpunkt(geld),
    answeredAt: zeitpunkt(abgehobenVorMs === null ? null : -abgehobenVorMs) ?? null,
    fristLeaseBis: zeitpunkt(hoechstdauerLease),
    fristGeldLeaseBis: zeitpunkt(geldLease),
  });
  return call.id;
}

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Geld-Frist im JSON-Speicher: faellige aktive Anrufe aller Mandanten, nicht beendete, kuenftige", async () => {
  const a = anruf(A, { geld: -MINUTE_MS });
  const b = anruf(B, { geld: -2 * MINUTE_MS });
  anruf(A, { status: "completed", geld: -MINUTE_MS });
  anruf(A, { geld: MINUTE_MS });
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(treffer), [a, b].sort());
  assert.deepEqual(treffer.find((eintrag) => eintrag.callId === b), {
    callId: b,
    tenantId: B,
    faelligAt: new Date(JETZT - 2 * MINUTE_MS).toISOString(),
    versuche: 1,
  });
});

test("Geld-Frist im JSON-Speicher: ohne Frist ist ein abgehobener Anruf faellig, ein nie abgehobener nicht", async () => {
  const abgehoben = anruf(A, { abgehobenVorMs: MINUTE_MS });
  const klingelt = anruf(A);
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.ok(ids(treffer).includes(abgehoben));
  assert.ok(!ids(treffer).includes(klingelt));
  assert.equal(treffer.find((eintrag) => eintrag.callId === abgehoben).faelligAt, new Date(JETZT - MINUTE_MS).toISOString());
});

test("Geld-Frist im JSON-Speicher: die eigene Lease sperrt, die Hoechstdauer-Lease nicht, und sie zaehlt eigene Versuche", async () => {
  const frei = anruf(A, { geld: -MINUTE_MS, hoechstdauerLease: MINUTE_MS });
  const gesperrt = anruf(A, { geld: -MINUTE_MS, geldLease: MINUTE_MS });
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(treffer.includes(frei));
  assert.ok(!treffer.includes(gesperrt));
  const call = speicher.getCall(frei);
  assert.equal(call.fristGeldLeaseBis, new Date(JETZT + LEASE_MS).toISOString());
  assert.equal(call.fristGeldVersuche, 1);
  assert.equal(call.fristVersuche, undefined);
  assert.equal(call.fristLeaseBis, new Date(JETZT + MINUTE_MS).toISOString());
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes(frei));
});

test("Geld-Frist im JSON-Speicher: das Limit gilt je Mandant, der aelteste Anruf kommt zuerst", async () => {
  const aAlt = anruf(A, { geld: -9 * MINUTE_MS });
  anruf(A, { geld: -8 * MINUTE_MS });
  const treffer = (await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((eintrag) => eintrag.callId === aAlt);
  assert.deepEqual(ids(treffer), [aAlt]);
});

test("Geld-Frist schreiben im JSON-Speicher: setzt die Frist eines aktiven Anrufs und die Versuche zurueck, einen beendeten laesst sie unveraendert", async () => {
  const aktiv = anruf(A, { geld: -MINUTE_MS });
  speicher.getCall(aktiv).fristGeldVersuche = 2;
  const beendet = anruf(A, { status: "completed" });
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeGeldFrist({ callId: aktiv, tenantId: A, faelligAt });
  await speicher.setzeGeldFrist({ callId: beendet, tenantId: A, faelligAt });
  assert.equal(speicher.getCall(aktiv).fristGeldAt, faelligAt);
  assert.equal(speicher.getCall(aktiv).fristGeldVersuche, 0);
  assert.equal(speicher.getCall(beendet).fristGeldAt, undefined);
  await speicher.setzeGeldFrist({ callId: "call_gibt_es_nicht", tenantId: A, faelligAt });
});
