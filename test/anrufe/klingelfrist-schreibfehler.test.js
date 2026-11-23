import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { OWNER_TEST_FIRST_NAME, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { calleeVon, legeAnruf, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const WARTE_FRIST_MS = 5_000;
const KLINGEL_FRIST_MS = 60_000;
const ERSETZE_VON = "setzeVorspannFrist: vorspann.setze,";
const ERSETZE_DURCH = 'setzeVorspannFrist: (a) => (a.frist === "klingel" && a.faelligAt ? Promise.reject(new Error("db weg")) : vorspann.setze(a)),';
const HAKEN = [
  "export async function load(url, kontext, weiter) {",
  "  const ergebnis = await weiter(url, kontext);",
  `  if (url.endsWith('/src/store/vorspann-fristen-sql.js')) ergebnis.source = String(ergebnis.source).replace(${JSON.stringify(ERSETZE_VON)}, ${JSON.stringify(ERSETZE_DURCH)});`,
  "  return ergebnis;",
  "}",
].join("\n");
const SCHREIBFEHLER = [
  "import { register } from 'node:module';",
  `register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(HAKEN)}));`,
].join("\n");

const umgebung = {};

async function starte(zusatz) {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...vorspannUmgebung({ attrappe: umgebung.attrappe, signer: umgebung.signer, publicUrl: "https://agent.test", kennung: "6072-klingel" }),
    VORSPANN_KLINGEL_FRIST_MS: String(KLINGEL_FRIST_MS),
    ...zusatz,
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
}

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

const anrufIn = (callId) => umgebung.srv.readStore().calls.find((eintrag) => eintrag.id === callId);
const aufgelegt = (callId) => umgebung.attrappe.pfade.filter((pfad) => pfad.includes(calleeVon(callId)) && pfad.endsWith("/actions/hangup")).length;

test("6072: scheitert das Schreiben der Klingelfrist, legt Hermes das Bein auf und der Anruf endet als no-answer ohne Annahme", async () => {
  await starte({ NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(SCHREIBFEHLER)}` });
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(20));
  await waitUntil(() => anrufIn(callId).status !== "active", { timeoutMs: WARTE_FRIST_MS });

  const call = anrufIn(callId);
  assert.equal(call.status, "failed");
  assert.equal(call.failureReason, "no-answer");
  assert.equal(aufgelegt(callId), 1);
  assert.equal(call.answeredAt ?? null, null);
});

test("6072: gelingt das Schreiben der Klingelfrist, klingelt das Bein weiter und der Anruf bleibt aktiv", async () => {
  await starte({});
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(21));
  await waitUntil(() => umgebung.attrappe.waehlbefehle.includes(`vorspann-${callId}`), { timeoutMs: WARTE_FRIST_MS });

  assert.equal(anrufIn(callId).status, "active");
  assert.equal(aufgelegt(callId), 0);
});
