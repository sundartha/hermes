import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const A = "t_frs_a";
const B = "t_frs_b";
const JETZT = Date.parse("2030-01-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const LEASE_MS = 30_000;
const ANFRAGE = { art: "reserve", jetztMs: JETZT, limitJeMandant: 10, leaseMs: LEASE_MS };

const { speicher } = await jsonSpeicherImDatenordner("hermes-fristen-reserve-");
await speicher.oeffneSpeicher();

const zeitpunkt = (abstandMs) => (abstandMs === null ? undefined : new Date(JETZT + abstandMs).toISOString());

function anruf(tenantId, { status = "completed", reserve = null, reserveLease = null, andereLease = null } = {}) {
  const call = speicher.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId });
  Object.assign(call, {
    status,
    fristReserveAt: zeitpunkt(reserve),
    fristReserveLeaseBis: zeitpunkt(reserveLease),
    fristLeaseBis: zeitpunkt(andereLease),
    fristGeldLeaseBis: zeitpunkt(andereLease),
  });
  return call.id;
}

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Reserve-Frist im JSON-Speicher: faellige Reserven aller Mandanten, auch beendeter Anrufe, nicht kuenftige und nicht Anrufe ohne Frist", async () => {
  const a = anruf(A, { reserve: -MINUTE_MS });
  const b = anruf(B, { reserve: -2 * MINUTE_MS, status: "active" });
  anruf(A, { reserve: MINUTE_MS });
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

test("Reserve-Frist im JSON-Speicher: die eigene Lease sperrt, die anderen Leases nicht, und sie zaehlt eigene Versuche", async () => {
  const frei = anruf(A, { reserve: -MINUTE_MS, andereLease: MINUTE_MS });
  const gesperrt = anruf(A, { reserve: -MINUTE_MS, reserveLease: MINUTE_MS });
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(treffer.includes(frei));
  assert.ok(!treffer.includes(gesperrt));
  const call = speicher.getCall(frei);
  assert.equal(call.fristReserveLeaseBis, new Date(JETZT + LEASE_MS).toISOString());
  assert.equal(call.fristReserveVersuche, 1);
  assert.equal(call.fristVersuche, undefined);
  assert.equal(call.fristGeldVersuche, undefined);
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes(frei));
});

test("Reserve-Frist im JSON-Speicher: das Limit gilt je Mandant, die aelteste Reserve kommt zuerst", async () => {
  const aAlt = anruf(A, { reserve: -9 * MINUTE_MS });
  anruf(A, { reserve: -8 * MINUTE_MS });
  const treffer = (await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((eintrag) => eintrag.callId === aAlt);
  assert.deepEqual(ids(treffer), [aAlt]);
});

test("Reserve-Frist im JSON-Speicher: die Hoechstdauer- und die Geld-Abfrage finden einen beendeten Anruf mit Reserve-Frist nicht", async () => {
  const id = anruf(B, { reserve: -MINUTE_MS });
  for (const art of ["hoechstdauer", "geld"]) assert.ok(!ids(await speicher.faelligeFristen({ ...ANFRAGE, art })).includes(id));
});

test("Reserve-Frist schreiben im JSON-Speicher: setzt die Frist auch eines beendeten Anrufs und die Versuche zurueck", async () => {
  const beendet = anruf(A, { reserve: -MINUTE_MS });
  speicher.getCall(beendet).fristReserveVersuche = 2;
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeReserveFrist({ callId: beendet, tenantId: A, faelligAt });
  assert.equal(speicher.getCall(beendet).fristReserveAt, faelligAt);
  assert.equal(speicher.getCall(beendet).fristReserveVersuche, 0);
  await speicher.setzeReserveFrist({ callId: "call_gibt_es_nicht", tenantId: A, faelligAt });
});

test("Reserve-Frist schreiben im JSON-Speicher: null leert die Frist, ein anderer Anruf bleibt unveraendert", async () => {
  const eins = anruf(A, { reserve: MINUTE_MS });
  const zwei = anruf(A, { reserve: MINUTE_MS });
  await speicher.setzeReserveFrist({ callId: zwei, tenantId: A, faelligAt: null });
  assert.equal(speicher.getCall(zwei).fristReserveAt, null);
  assert.equal(speicher.getCall(eins).fristReserveAt, zeitpunkt(MINUTE_MS));
  assert.equal(speicher.getCall(zwei).fristReserveVersuche, 0);
  assert.equal(speicher.getCall(eins).fristReserveVersuche, undefined);
});
