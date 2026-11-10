import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { OWNER_TEST_FIRST_NAME, seedCall, seedState, startServer, waitUntil as wartebis } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { calleeVon, elVon, hebeAb, legeAnruf, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const WARTE_FRIST_MS = 5_000;
const EINMAL = 1;
const PUBLIC_URL = "https://agent.test";
const STORE_DATEI = "store.json";

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });

const umgebung = { vorElAntwort: async () => {}, zaehler: 0 };

before(async () => {
  umgebung.attrappe = await starteAttrappe(() => umgebung.vorElAntwort());
  umgebung.signer = makeTelnyxSigner();
  umgebung.env = vorspannUmgebung({ attrappe: umgebung.attrappe, signer: umgebung.signer, publicUrl: PUBLIC_URL, kennung: "3553json" });
  umgebung.srv = await startServer({
    env: umgebung.env,
    seed: seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] }),
  });
});

after(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

const anrufIn = (id) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === id);
};

const neuerAnruf = () => legeAnruf(umgebung.srv, neueAnrufNummer((umgebung.zaehler += EINMAL)));
const hebeAbIn = (callId) => hebeAb(umgebung.srv, umgebung.signer, callId);

test("3553-K1: die Kennung des EL-Beins steht nach der Wahl in der Ablage", async () => {
  const callId = await neuerAnruf();
  assert.equal(anrufIn(callId).elCallControlId ?? null, null);
  assert.equal((await hebeAbIn(callId)).status, HTTP_OK);
  await waitUntil(() => anrufIn(callId).elCallControlId === elVon(callId));
});

test("3553-K1: scheitert das Speichern, laeuft der Anruf weiter und der Fehler steht nur im Log", async () => {
  const { srv } = umgebung;
  const datei = path.join(srv.dataDir, STORE_DATEI);
  const sicherung = `${datei}.sicherung`;
  umgebung.vorElAntwort = async () => {
    fs.renameSync(datei, sicherung);
    fs.mkdirSync(datei);
  };
  const callId = await neuerAnruf();
  assert.ok(callId);
  try {
    assert.equal((await hebeAbIn(callId)).status, HTTP_OK);
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] el-bein-speichern fehlgeschlagen call=${callId}:`));
  } finally {
    umgebung.vorElAntwort = async () => {};
    fs.rmSync(datei, { recursive: true, force: true });
    fs.renameSync(sicherung, datei);
  }
  assert.ok(!srv.stdout.includes(`el-wahl fehlgeschlagen call=${callId}`), srv.stdout);
  assert.ok(!srv.stdout.includes(`abheben fehlgeschlagen call=${callId}`), srv.stdout);
});

test("3553-K2: nach einem Neustart kennt Hermes das EL-Bein und legt beim Abbrechen beide Beine auf", async () => {
  const callId = await neuerAnruf();
  assert.equal((await hebeAbIn(callId)).status, HTTP_OK);
  await waitUntil(() => anrufIn(callId).elCallControlId === elVon(callId));
  await umgebung.srv.stop();
  umgebung.srv = await startServer({ env: umgebung.env, dataDir: umgebung.srv.dataDir });
  assert.equal(anrufIn(callId).elCallControlId, elVon(callId));
  const { pfade } = umgebung.attrappe;
  const vorher = pfade.length;
  const beendet = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });
  assert.equal(beendet.status, HTTP_OK);
  const aufgelegt = () => pfade.slice(vorher).filter((pfad) => pfad.endsWith("/actions/hangup")).sort();
  await waitUntil(() => aufgelegt().length >= 2);
  assert.deepEqual(aufgelegt(), [`/v2/calls/${calleeVon(callId)}/actions/hangup`, `/v2/calls/${elVon(callId)}/actions/hangup`]);
});
