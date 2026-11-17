import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const A = "t_fas_a";
const B = "t_fas_b";
const JETZT = Date.parse("2030-01-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const LEASE_MS = 30_000;
const ANFRAGE = { art: "abfrage", jetztMs: JETZT, limitJeMandant: 10, leaseMs: LEASE_MS };

const { speicher } = await jsonSpeicherImDatenordner("hermes-fristen-abfrage-");
await speicher.oeffneSpeicher();

const zeitpunkt = (abstandMs) => (abstandMs === null ? undefined : new Date(JETZT + abstandMs).toISOString());

function anruf(tenantId, { status = "active", abfrage = null, abfrageLease = null, andereLease = null } = {}) {
  const call = speicher.createCall({ direction: "inbound", from: "+49", to: "+49", tenantId });
  Object.assign(call, {
    status,
    answeredAt: new Date(JETZT - 10 * MINUTE_MS).toISOString(),
    fristAbfrageAt: zeitpunkt(abfrage),
    fristAbfrageLeaseBis: zeitpunkt(abfrageLease),
    fristLeaseBis: zeitpunkt(andereLease),
    fristGeldLeaseBis: zeitpunkt(andereLease),
    fristReserveLeaseBis: zeitpunkt(andereLease),
  });
  return call.id;
}

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Abfrage-Frist im JSON-Speicher: faellige Abfragen aktiver Anrufe aller Mandanten, nicht kuenftige, nicht beendete und nicht Anrufe ohne Frist", async () => {
  const a = anruf(A, { abfrage: -MINUTE_MS });
  const b = anruf(B, { abfrage: -2 * MINUTE_MS });
  anruf(A, { abfrage: MINUTE_MS });
  anruf(A, { abfrage: -MINUTE_MS, status: "completed" });
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

test("Abfrage-Frist im JSON-Speicher: die eigene Lease sperrt, die anderen Leases nicht, und sie zaehlt eigene Versuche", async () => {
  const frei = anruf(A, { abfrage: -MINUTE_MS, andereLease: MINUTE_MS });
  const gesperrt = anruf(A, { abfrage: -MINUTE_MS, abfrageLease: MINUTE_MS });
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(treffer.includes(frei));
  assert.ok(!treffer.includes(gesperrt));
  const call = speicher.getCall(frei);
  assert.equal(call.fristAbfrageLeaseBis, new Date(JETZT + LEASE_MS).toISOString());
  assert.equal(call.fristAbfrageVersuche, 1);
  assert.equal(call.fristVersuche, undefined);
  assert.equal(call.fristReserveVersuche, undefined);
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes(frei));
});

test("Abfrage-Frist im JSON-Speicher: das Limit gilt je Mandant, die aelteste Abfrage kommt zuerst", async () => {
  const aAlt = anruf(A, { abfrage: -9 * MINUTE_MS });
  anruf(A, { abfrage: -8 * MINUTE_MS });
  const treffer = (await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((eintrag) => eintrag.callId === aAlt);
  assert.deepEqual(ids(treffer), [aAlt]);
});

test("Abfrage-Frist im JSON-Speicher: die Reserve-Abfrage liest die Abfrage-Frist nicht", async () => {
  const id = anruf(B, { abfrage: -MINUTE_MS });
  assert.ok(!ids(await speicher.faelligeFristen({ ...ANFRAGE, art: "reserve" })).includes(id));
});

test("Abfrage-Frist schreiben im JSON-Speicher: setzt die Frist eines aktiven Anrufs und die Versuche zurueck, ein beendeter und ein unbekannter Anruf bleiben unveraendert", async () => {
  const aktiv = anruf(A, { abfrage: -MINUTE_MS });
  speicher.getCall(aktiv).fristAbfrageVersuche = 2;
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeAbfrageFrist({ callId: aktiv, tenantId: A, faelligAt });
  assert.equal(speicher.getCall(aktiv).fristAbfrageAt, faelligAt);
  assert.equal(speicher.getCall(aktiv).fristAbfrageVersuche, 0);
  const beendet = anruf(A, { status: "completed", abfrage: -MINUTE_MS });
  await speicher.setzeAbfrageFrist({ callId: beendet, tenantId: A, faelligAt });
  assert.equal(speicher.getCall(beendet).fristAbfrageAt, zeitpunkt(-MINUTE_MS));
  await speicher.setzeAbfrageFrist({ callId: "call_gibt_es_nicht", tenantId: A, faelligAt });
});
