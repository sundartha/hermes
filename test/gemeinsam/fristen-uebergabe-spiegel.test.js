import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const A = "t_fus_a";
const B = "t_fus_b";
const JETZT = Date.parse("2030-01-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const LEASE_MS = 30_000;
const ANFRAGE = { art: "uebergabe", jetztMs: JETZT, limitJeMandant: 10, leaseMs: LEASE_MS };

const { speicher } = await jsonSpeicherImDatenordner("hermes-fristen-uebergabe-");
await speicher.oeffneSpeicher();

const zeitpunkt = (abstandMs) => (abstandMs === null ? undefined : new Date(JETZT + abstandMs).toISOString());

function anruf(tenantId, { status = "active", uebergabe = null, uebergabeLease = null, andereLease = null } = {}) {
  const call = speicher.createCall({ direction: "inbound", from: "+49", to: "+49", tenantId });
  Object.assign(call, {
    status,
    answeredAt: new Date(JETZT - 10 * MINUTE_MS).toISOString(),
    fristUebergabeAt: zeitpunkt(uebergabe),
    fristUebergabeLeaseBis: zeitpunkt(uebergabeLease),
    fristLeaseBis: zeitpunkt(andereLease),
    fristGeldLeaseBis: zeitpunkt(andereLease),
    fristReserveLeaseBis: zeitpunkt(andereLease),
    fristAbfrageLeaseBis: zeitpunkt(andereLease),
  });
  return call.id;
}

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Uebergabe-Frist im JSON-Speicher: faellige Uebergaben aktiver Anrufe aller Mandanten, nicht kuenftige, nicht beendete und nicht Anrufe ohne Frist", async () => {
  const a = anruf(A, { uebergabe: -MINUTE_MS });
  const b = anruf(B, { uebergabe: -2 * MINUTE_MS });
  anruf(A, { uebergabe: MINUTE_MS });
  anruf(A, { uebergabe: -MINUTE_MS, status: "completed" });
  anruf(A);
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(treffer), [a, b].sort());
  assert.deepEqual(treffer.find((eintrag) => eintrag.callId === b), {
    callId: b,
    tenantId: B,
    faelligAt: new Date(JETZT - 2 * MINUTE_MS).toISOString(),
    versuche: 1,
  });
});

test("Uebergabe-Frist im JSON-Speicher: die eigene Lease sperrt, die anderen Leases nicht, und sie zaehlt eigene Versuche", async () => {
  const frei = anruf(A, { uebergabe: -MINUTE_MS, andereLease: MINUTE_MS });
  const gesperrt = anruf(A, { uebergabe: -MINUTE_MS, uebergabeLease: MINUTE_MS });
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(treffer.includes(frei));
  assert.ok(!treffer.includes(gesperrt));
  const call = speicher.getCall(frei);
  assert.equal(call.fristUebergabeLeaseBis, new Date(JETZT + LEASE_MS).toISOString());
  assert.equal(call.fristUebergabeVersuche, 1);
  assert.equal(call.fristVersuche, undefined);
  assert.equal(call.fristAbfrageVersuche, undefined);
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes(frei));
});

test("Uebergabe-Frist im JSON-Speicher: das Limit gilt je Mandant, die aelteste Uebergabe kommt zuerst", async () => {
  const aAlt = anruf(A, { uebergabe: -9 * MINUTE_MS });
  anruf(A, { uebergabe: -8 * MINUTE_MS });
  const treffer = (await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((eintrag) => eintrag.callId === aAlt);
  assert.deepEqual(ids(treffer), [aAlt]);
});

test("Uebergabe-Frist im JSON-Speicher: die Abfrage-Art liest die Uebergabe-Frist nicht", async () => {
  const id = anruf(B, { uebergabe: -MINUTE_MS });
  assert.ok(!ids(await speicher.faelligeFristen({ ...ANFRAGE, art: "abfrage" })).includes(id));
});

test("Uebergabe-Frist schreiben im JSON-Speicher: setzt die Frist eines aktiven Anrufs und die Versuche zurueck, ein beendeter und ein unbekannter Anruf bleiben unveraendert", async () => {
  const aktiv = anruf(A, { uebergabe: -MINUTE_MS });
  speicher.getCall(aktiv).fristUebergabeVersuche = 2;
  const faelligAt = "2029-05-06T07:08:09.000Z";
  await speicher.setzeUebergabeFrist({ callId: aktiv, tenantId: A, faelligAt });
  assert.equal(speicher.getCall(aktiv).fristUebergabeAt, faelligAt);
  assert.equal(speicher.getCall(aktiv).fristUebergabeVersuche, 0);
  const beendet = anruf(A, { status: "completed", uebergabe: -MINUTE_MS });
  await speicher.setzeUebergabeFrist({ callId: beendet, tenantId: A, faelligAt });
  assert.equal(speicher.getCall(beendet).fristUebergabeAt, zeitpunkt(-MINUTE_MS));
  await speicher.setzeUebergabeFrist({ callId: "call_gibt_es_nicht", tenantId: A, faelligAt });
});

test("Uebergabe-Frist schreiben im JSON-Speicher: die fruehere Frist gilt, null leert, und ein Anruf aendert nie den anderen", async () => {
  const erster = anruf(A);
  const zweiter = anruf(A, { uebergabe: MINUTE_MS });
  await speicher.setzeUebergabeFrist({ callId: erster, tenantId: A, faelligAt: "2031-01-01T00:00:00.000Z" });
  assert.equal(speicher.getCall(erster).fristUebergabeAt, "2031-01-01T00:00:00.000Z");
  await speicher.setzeUebergabeFrist({ callId: erster, tenantId: A, faelligAt: "2032-01-01T00:00:00.000Z" });
  assert.equal(speicher.getCall(erster).fristUebergabeAt, "2031-01-01T00:00:00.000Z");
  await speicher.setzeUebergabeFrist({ callId: erster, tenantId: A, faelligAt: "2030-06-01T00:00:00.000Z" });
  assert.equal(speicher.getCall(erster).fristUebergabeAt, "2030-06-01T00:00:00.000Z");
  assert.equal(speicher.getCall(zweiter).fristUebergabeAt, zeitpunkt(MINUTE_MS));
  await speicher.setzeUebergabeFrist({ callId: erster, tenantId: A, faelligAt: null });
  assert.equal(speicher.getCall(erster).fristUebergabeAt, null);
  assert.equal(speicher.getCall(zweiter).fristUebergabeAt, zeitpunkt(MINUTE_MS));
});
