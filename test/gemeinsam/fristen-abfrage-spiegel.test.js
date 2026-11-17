import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const A = "t_fab_a";
const B = "t_fab_b";
const JETZT = Date.parse("2030-01-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const LEASE_MS = 30_000;
const ANFRAGE = { art: "abfrage", jetztMs: JETZT, limitJeMandant: 10, leaseMs: LEASE_MS };

const { speicher } = await jsonSpeicherImDatenordner("hermes-fristen-abfrage-");
await speicher.oeffneSpeicher();

const zeitpunkt = (abstandMs) => (abstandMs === null ? undefined : new Date(JETZT + abstandMs).toISOString());

function anruf(tenantId, { status = "active", abfrage = null, abfrageLease = null, andereLease = null } = {}) {
  const call = speicher.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId });
  Object.assign(call, {
    status,
    fristAbfrageAt: zeitpunkt(abfrage),
    fristAbfrageLeaseBis: zeitpunkt(abfrageLease),
    fristLeaseBis: zeitpunkt(andereLease),
    fristGeldLeaseBis: zeitpunkt(andereLease),
    fristReserveLeaseBis: zeitpunkt(andereLease),
  });
  return call.id;
}

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Abfrage-Frist im JSON-Speicher: faellige aktive Anrufe aller Mandanten, nicht kuenftige, nicht ohne Frist und nicht beendete", async () => {
  const a = anruf(A, { abfrage: -MINUTE_MS });
  const b = anruf(B, { abfrage: -2 * MINUTE_MS });
  anruf(A, { abfrage: MINUTE_MS });
  anruf(A);
  anruf(B, { abfrage: -MINUTE_MS, status: "completed" });
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
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes(frei));
});

test("Abfrage-Frist im JSON-Speicher: die Hoechstdauer-, Geld- und Reserve-Abfrage ziehen keine Zeile nur wegen der Abfrage-Frist", async () => {
  const id = anruf(B, { abfrage: -MINUTE_MS });
  for (const art of ["geld", "reserve"]) assert.ok(!ids(await speicher.faelligeFristen({ ...ANFRAGE, art })).includes(id));
});

test("Abfrage-Frist schreiben im JSON-Speicher: setzt die Frist eines aktiven Anrufs und die Versuche zurueck, ein beendeter und ein anderer Anruf bleiben", async () => {
  const aktiv = anruf(A, { abfrage: -MINUTE_MS });
  const anderer = anruf(A, { abfrage: MINUTE_MS });
  const beendet = anruf(A, { abfrage: MINUTE_MS, status: "completed" });
  speicher.getCall(aktiv).fristAbfrageVersuche = 2;
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeAbfrageFrist({ callId: aktiv, tenantId: A, faelligAt });
  assert.equal(speicher.getCall(aktiv).fristAbfrageAt, faelligAt);
  assert.equal(speicher.getCall(aktiv).fristAbfrageVersuche, 0);
  assert.equal(speicher.getCall(anderer).fristAbfrageAt, zeitpunkt(MINUTE_MS));
  assert.equal(speicher.getCall(anderer).fristAbfrageVersuche, undefined);
  await speicher.setzeAbfrageFrist({ callId: beendet, tenantId: A, faelligAt });
  assert.equal(speicher.getCall(beendet).fristAbfrageAt, zeitpunkt(MINUTE_MS));
  await speicher.setzeAbfrageFrist({ callId: aktiv, tenantId: A, faelligAt: null });
  assert.equal(speicher.getCall(aktiv).fristAbfrageAt, null);
});
