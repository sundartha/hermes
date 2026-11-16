import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const A = "t_fs_a";
const B = "t_fs_b";
const JETZT = Date.parse("2030-01-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const LEASE_MS = 30_000;
const ANFRAGE = { art: "hoechstdauer", jetztMs: JETZT, limitJeMandant: 10, leaseMs: LEASE_MS };

const { speicher } = await jsonSpeicherImDatenordner("hermes-fristen-");
await speicher.oeffneSpeicher();

function anruf(tenantId, { status = "active", faellig = -MINUTE_MS, lease = null } = {}) {
  const call = speicher.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId });
  call.status = status;
  call.fristHoechstdauerAt = faellig === null ? undefined : new Date(JETZT + faellig).toISOString();
  call.fristLeaseBis = lease === null ? undefined : new Date(JETZT + lease).toISOString();
  return call.id;
}

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Fristen im JSON-Speicher: faellige aktive Anrufe aller Mandanten, nicht beendete, kuenftige, fristlose", async () => {
  const a = anruf(A);
  const b = anruf(B, { faellig: -2 * MINUTE_MS });
  anruf(A, { status: "completed" });
  anruf(A, { faellig: MINUTE_MS });
  anruf(B, { faellig: null });
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(treffer), [a, b].sort());
  const gefunden = treffer.find((eintrag) => eintrag.callId === b);
  assert.deepEqual(gefunden, { callId: b, tenantId: B, faelligAt: new Date(JETZT - 2 * MINUTE_MS).toISOString(), versuche: 1 });
});

test("Fristen im JSON-Speicher: Lease sperrt bis zu ihrem Ende, danach kommt der Anruf mit gezaehltem Versuch wieder", async () => {
  const id = anruf(A);
  assert.ok(ids(await speicher.faelligeFristen(ANFRAGE)).includes(id));
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes(id));
  assert.ok(!ids(await speicher.faelligeFristen({ ...ANFRAGE, jetztMs: JETZT + LEASE_MS - 1 })).includes(id));
  const wieder = (await speicher.faelligeFristen({ ...ANFRAGE, jetztMs: JETZT + LEASE_MS })).find((eintrag) => eintrag.callId === id);
  assert.equal(wieder.versuche, 2);
  assert.equal(speicher.getCall(id).fristLeaseBis, new Date(JETZT + 2 * LEASE_MS).toISOString());
});

test("Fristen im JSON-Speicher: eine Frist genau zur Jetzt-Zeit ist faellig, eine Millisekunde spaeter nicht", async () => {
  const genau = anruf(A, { faellig: 0 });
  const spaeter = anruf(A, { faellig: 1 });
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(treffer.includes(genau));
  assert.ok(!treffer.includes(spaeter));
});

test("Fristen im JSON-Speicher: das Limit gilt je Mandant, der aelteste Anruf kommt zuerst", async () => {
  const aAlt = anruf(A, { faellig: -9 * MINUTE_MS });
  anruf(A, { faellig: -8 * MINUTE_MS });
  const bAlt = anruf(B, { faellig: -9 * MINUTE_MS });
  anruf(B, { faellig: -8 * MINUTE_MS });
  const treffer = ids(await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 }));
  assert.deepEqual(treffer, [aAlt, bAlt].sort());
});

test("Fristen im JSON-Speicher: eine unbekannte Art wirft", async () => {
  await assert.rejects(speicher.faelligeFristen({ ...ANFRAGE, art: "unbekannt" }), /unbekannte Frist: unbekannt/);
});

test("Fristen im JSON-Speicher: bei gleicher Frist kommt die kleinere Anruf-ID zuerst", async () => {
  const erster = anruf(B, { faellig: -20 * MINUTE_MS });
  const zweiter = anruf(B, { faellig: -20 * MINUTE_MS });
  const treffer = (await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((eintrag) => [erster, zweiter].includes(eintrag.callId));
  assert.deepEqual(ids(treffer), [[erster, zweiter].sort()[0]]);
});
