import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";

import { BASE_ENV, OWNER_TEST_FIRST_NAME, ROOT, makeTelnyxSigner, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { calleeVon, hebeAb, legeAnruf, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";
import { ereignis as meldeEreignis, starteAnbieter } from "./vorspann-zwei-instanzen-hilfen.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";

const TENANT_ID = seedCall().tenantId;
const WARTE_FRIST_MS = 8_000;
const ZEITGRENZE_MS = 120_000;
const KLINGEL_FRIST_MS = 1637;
const TAKT_MS = 200;
const STANDARD_KLINGEL_MS = 75_000;
const HTTP_OK = 200;
const KLINGEL_LEER_SQL = "SELECT frist_klingel_at FROM vorspann_zustand WHERE call_id = $1";
const ZEITGEBER = [
  "const echt = globalThis.setTimeout;",
  "globalThis.setTimeout = (fn, ms, ...rest) => {",
  `  if (ms === ${KLINGEL_FRIST_MS} || ms === ${STANDARD_KLINGEL_MS}) console.log('klingel-timer ms=' + ms);`,
  "  return echt(fn, ms, ...rest);",
  "};",
].join("\n");

const umgebung = {};

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...vorspannUmgebung({ attrappe: umgebung.attrappe, signer: umgebung.signer, publicUrl: "https://agent.test", kennung: "5928-4c" }),
    VORSPANN_KLINGEL_FRIST_MS: String(KLINGEL_FRIST_MS),
    FRISTEN_TAKT_MS: String(TAKT_MS),
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(ZEITGEBER)}`,
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

const anrufIn = (callId) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === callId);
};
const istCalleeAuflegen = (callId) => (pfad) => pfad.includes(calleeVon(callId)) && pfad.endsWith("/actions/hangup");
const calleeAufgelegt = (callId) => {
  const { pfade } = umgebung.attrappe;
  return pfade.filter(istCalleeAuflegen(callId)).length;
};

test("5928-4c K7: wird das Bein nicht abgehoben, legt der Fristen-Takt es nach der Klingelfrist einmal auf und der Anruf endet no-answer, ohne Timer im Prozess", async () => {
  const callId = await legeAnruf(umgebung.srv, neueAnrufNummer(20));
  await waitUntil(() => anrufIn(callId).status !== "active", { timeoutMs: WARTE_FRIST_MS });

  const call = anrufIn(callId);
  assert.equal(call.status, "failed");
  assert.equal(call.failureReason, "no-answer");
  assert.equal(call.answeredAt ?? null, null);
  assert.equal(calleeAufgelegt(callId), 1);
  assert.equal(umgebung.srv.stdout.includes("klingel-timer"), false);
  assert.equal(umgebung.srv.stdout.includes("rueckfall grund=zustand_fehlt"), false);
});

test("5928-4c K7: ein abgehobener Anruf bleibt nach der Klingelfrist aktiv und sein Bein wird nicht aufgelegt", async () => {
  const abgehoben = await legeAnruf(umgebung.srv, neueAnrufNummer(21));
  assert.equal((await hebeAb(umgebung.srv, umgebung.signer, abgehoben)).status, HTTP_OK);
  const spaeter = await legeAnruf(umgebung.srv, neueAnrufNummer(22));
  await waitUntil(() => anrufIn(spaeter).status !== "active", { timeoutMs: WARTE_FRIST_MS });

  assert.equal(anrufIn(spaeter).failureReason, "no-answer");
  assert.equal(anrufIn(abgehoben).status, "active");
  assert.ok(anrufIn(abgehoben).answeredAt);
  assert.equal(calleeAufgelegt(abgehoben), 0);
});

const SKRIPT = [
  'import("./src/config.ts").then(({ config }) =>',
  "  process.stdout.write(String(config.voice.elevenLabsOutbound.vorspannKlingelFristMs)));",
].join("\n");

const KONFIGURATION = [
  ["ohne Angabe gilt der Standard", {}, 75000],
  ["kleinster Wert 100", { VORSPANN_KLINGEL_FRIST_MS: "100" }, 100],
  ["99 unterschreitet das Minimum, es gilt der Standard", { VORSPANN_KLINGEL_FRIST_MS: "99" }, 75000],
  ["genau der Standard", { VORSPANN_KLINGEL_FRIST_MS: "75000" }, 75000],
  ["75001 wird auf den Standard gekappt", { VORSPANN_KLINGEL_FRIST_MS: "75001" }, 75000],
];

for (const [name, env, erwartet] of KONFIGURATION) {
  test(`5928-4c Klingelfrist-Konfiguration: ${name}`, () => {
    const ausgabe = execFileSync(process.execPath, ["--input-type=module", "-e", SKRIPT], {
      cwd: ROOT,
      env: kindUmgebung({ ...BASE_ENV, NODE_ENV: "test", ...env }),
      encoding: "utf8",
    });
    assert.equal(Number(ausgabe), erwartet);
  });
}

const STATUS_SQL = "SELECT status, failure_reason FROM call WHERE id = $1";
const KLINGEL_SQL = `SELECT frist_klingel_at > now() + interval '70 seconds' AS weit,
  frist_klingel_at < now() + interval '80 seconds' AS nah FROM vorspann_zustand WHERE call_id = $1`;
const ZIEL = "+4915112399021";

async function mitAnbieter(t, zusatz, lauf) {
  const signer = makeTelnyxSigner();
  const { attrappe, aufrufe } = await starteAnbieter();
  t.after(() => attrappe.close());
  const env = {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    ELEVENLABS_API_BASE: attrappe.url,
    TELNYX_API_BASE: attrappe.url,
    ...zusatz,
  };
  await mitZweiHermesAufPostgres(t, { env }, (instanzen) => lauf({ ...instanzen, signer, aufrufe }));
}

async function platziere(a, sql) {
  const start = await abrufMitFrist(`${a.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren" }),
  });
  assert.equal(start.status, HTTP_OK);
  const { rows } = await sql("SELECT id FROM call WHERE to_e164 = $1", [ZIEL]);
  assert.equal(rows.length, 1);
  return rows[0].id;
}

async function beendeInstanz(srv) {
  const beendet = new Promise((fertig) => srv.child.once("exit", fertig));
  srv.child.kill("SIGTERM");
  await beendet;
}

test("5928-4c K7: ist A beendet und wurde nicht abgehoben, legt B das Bein nach der Klingelfrist auf und vermerkt no-answer", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { VORSPANN_KLINGEL_FRIST_MS: "2500", FRISTEN_TAKT_MS: String(TAKT_MS) }, async ({ a, b, sql, aufrufe }) => {
    const callId = await platziere(a, sql);
    await beendeInstanz(a);
    await zeilenBis(async () => aufrufe.auflegen, (liste) => liste.length === 1);
    const [anruf] = await zeilenBis(async () => (await sql(STATUS_SQL, [callId])).rows, (zeilen) => zeilen[0]?.status === "failed");
    assert.equal(anruf.failure_reason, "no-answer");
    assert.ok(aufrufe.auflegen[0].includes("cc_callee_spaet"));
    assert.equal(b.stdout.split("rueckfall grund=zustand_fehlt").length - 1, 0);
  });
});

test("5928-4c K7: hebt der Angerufene vor der Klingelfrist ab, bleibt der Anruf aktiv und B legt nichts auf", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { VORSPANN_KLINGEL_FRIST_MS: "2500", FRISTEN_TAKT_MS: String(TAKT_MS) }, async ({ a, b, sql, signer, aufrufe }) => {
    const callId = await platziere(a, sql);
    assert.equal((await meldeEreignis(signer, b, { callId, art: "call.answered", kennung: "k" })).status, HTTP_OK);
    await zeilenBis(async () => aufrufe.wiedergaben, (liste) => liste.length === 1);
    await zeilenBis(async () => (await sql(KLINGEL_LEER_SQL, [callId])).rows, (zeilen) => zeilen[0]?.frist_klingel_at === null);
    assert.deepEqual((await sql(STATUS_SQL, [callId])).rows, [{ status: "active", failure_reason: null }]);
    assert.deepEqual(aufrufe.auflegen, []);
  });
});

test("5928-4c K7: nach dem Wahlen steht die Klingelfrist in der Zeile, im Standard etwa 75 Sekunden voraus", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { FRISTEN_TAKT_MS: String(TAKT_MS) }, async ({ a, sql }) => {
    const callId = await platziere(a, sql);
    const { rows } = await sql(KLINGEL_SQL, [callId]);
    assert.deepEqual(rows, [{ weit: true, nah: true }]);
  });
});
