import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const A = "t_vfs_a";
const B = "t_vfs_b";
const LEASE_MS = 30_000;
const ANFRAGE = { art: "vorspann", limitJeMandant: 10, leaseMs: LEASE_MS };
const VOR = () => new Date(Date.now() - 60_000).toISOString();
const NACH = () => new Date(Date.now() + 3_600_000).toISOString();

const { speicher } = await jsonSpeicherImDatenordner("hermes-vorspann-fristen-");
await speicher.oeffneSpeicher();

const anlegen = (tenantId, callId) =>
  speicher.vorspannZustand.anlegen({ tenantId, callId, token: "tok", text: "satz", ttlMs: 60_000 });
const kurz = (treffer, vorsatz) =>
  treffer.filter((eintrag) => eintrag.callId.startsWith(vorsatz)).map((eintrag) => `${eintrag.callId}:${eintrag.frist}`).sort();

test("Vorspann-Fristen im JSON-Speicher: faellige Fristen mit Art, nicht kuenftige, nicht gesetzte, nicht ohne Zeile", async () => {
  await anlegen(A, "s_a");
  await anlegen(B, "s_b");
  await speicher.setzeVorspannFrist({ tenantId: A, callId: "s_a", frist: "klingel", faelligAt: VOR() });
  await speicher.setzeVorspannFrist({ tenantId: A, callId: "s_a", frist: "wiedergabe", faelligAt: NACH() });
  await speicher.setzeVorspannFrist({ tenantId: B, callId: "s_b", frist: "elBein", faelligAt: VOR() });
  await speicher.setzeVorspannFrist({ tenantId: B, callId: "s_weg", frist: "elBein", faelligAt: VOR() });
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(kurz(treffer, "s_"), ["s_a:klingel", "s_b:elBein"]);
  const a = treffer.find((eintrag) => eintrag.callId === "s_a");
  assert.equal(a.tenantId, A);
  assert.equal(a.versuche, 1);
});

test("Vorspann-Fristen im JSON-Speicher: Lease sperrt, geleerte Frist ist nie faellig, gestellte Frist zaehlt neu", async () => {
  await anlegen(A, "l_a");
  await speicher.setzeVorspannFrist({ tenantId: A, callId: "l_a", frist: "klingel", faelligAt: VOR() });
  assert.deepEqual(kurz(await speicher.faelligeFristen(ANFRAGE), "l_"), ["l_a:klingel"]);
  assert.deepEqual(kurz(await speicher.faelligeFristen(ANFRAGE), "l_"), []);
  await speicher.setzeVorspannFrist({ tenantId: A, callId: "l_a", frist: "klingel", faelligAt: VOR() });
  assert.deepEqual(kurz(await speicher.faelligeFristen({ ...ANFRAGE, leaseMs: 0 }), "l_"), []);
  await speicher.leereVorspannFrist({ tenantId: A, callId: "l_a", frist: "klingel" });
  assert.deepEqual(kurz(await speicher.faelligeFristen(ANFRAGE), "l_"), []);
});

test("Vorspann-Fristen im JSON-Speicher: die Zeile loeschen nimmt die Frist mit, das Limit gilt je Mandant und Frist", async () => {
  await anlegen(A, "d_a");
  await speicher.setzeVorspannFrist({ tenantId: A, callId: "d_a", frist: "elBein", faelligAt: VOR() });
  await speicher.vorspannZustand.loesche({ tenantId: A, callId: "d_a" });
  assert.deepEqual(kurz(await speicher.faelligeFristen(ANFRAGE), "d_"), []);
  for (const id of ["m_1", "m_2", "m_3"]) {
    await anlegen(A, id);
    await speicher.setzeVorspannFrist({ tenantId: A, callId: id, frist: "wiedergabe", faelligAt: VOR() });
  }
  assert.equal(kurz(await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 2 }), "m_").length, 2);
});
