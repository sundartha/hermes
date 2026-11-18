import { test, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, TELNYX_TEST_SIGNATURE_HEADERS, tempDataDir, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_uebergabe_ohne_zuschlag";
const ANRUF = "call_uebergabe_ohne_zuschlag";
const FRIST_BIS_SCHREIBEN_MS = 10_000;
const STANDARD_TAKT_MS = "15000";
const EL_BINDING_AFTER_ANSWER_MS = 8000;
const ANGENOMMEN = "in-progress";

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://uebergabe-ohne-zuschlag-attrappe.invalid/hermes",
  SESSION_SECRET: "uebergabe-ohne-zuschlag-signierwert",
  TELNYX_API_KEY: "KEYtest-uebergabe-ohne-zuschlag",
  TELNYX_API_BASE: "https://telnyx.uebergabe-ohne-zuschlag.invalid",
  TELNYX_ACCOUNT_SID: "AC_uebergabe_ohne_zuschlag",
  FRISTEN_TAKT_MS: STANDARD_TAKT_MS,
});

let store = null;
const anlegen = aufraeumenVormerken(() => store);
const db = await anlegen(await vorlage("leer", async () => {}, []));
await db.exec(`CREATE ROLE uebergabe_ohne_zuschlag_app NOSUPERUSER NOBYPASSRLS;
  GRANT CREATE, USAGE ON SCHEMA public TO uebergabe_ohne_zuschlag_app;
  SET ROLE uebergabe_ohne_zuschlag_app;`);
poolAufPglite(db);

const imMandanten = (anweisung, parameter = []) =>
  db.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.current_tenant', $1, true)", [MANDANT]);
    return (await tx.query(anweisung, parameter)).rows;
  });

store = await import("../../src/store.js");
await store.oeffneSpeicher();
store.load().tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Uebergabe Ohne Zuschlag" });
store.load().numbers.push({
  id: "num_uebergabe_ohne_zuschlag",
  tenantId: MANDANT,
  e164: "+4915799990072",
  provider: "telnyx",
  status: "active",
  providerNumberId: "pnum_uebergabe_ohne_zuschlag",
  country: "DE",
  language: "de",
  paymentIntentId: null,
});
store.save();
await store.drainFlushes();
const server = await serverImportieren();
after(() => {
  server.closeAllConnections();
  server.close();
});

test("Kriterium: die Uebergabe-Frist eines angenommenen Beins steht auf Annahme plus Bindungsfrist, ohne Zuschlag des Boot-Takts", async () => {
  await imMandanten(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, answered_at, provider, max_duration_s,
       twilio_sid, cost_profile)
     VALUES ($1, $2, $3, 'inbound', 'active', now()::text, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'telnyx', 600, 'CA_uebergabe_ohne_zuschlag', 'telnyx_inbound_el_convai')`,
    [ANRUF, MANDANT, `tok_${ANRUF}`],
  );
  const vorher = Date.now();
  const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/voice/el-bein?callId=${ANRUF}`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams({ CallStatus: ANGENOMMEN }),
  });
  assert.equal(antwort.status, 200);
  await waitUntil(
    async () => (await imMandanten("SELECT frist_uebergabe_at FROM call WHERE id = $1", [ANRUF]))[0].frist_uebergabe_at !== null,
    { timeoutMs: FRIST_BIS_SCHREIBEN_MS },
  );
  const [zeile] = await imMandanten("SELECT frist_uebergabe_at AS frist FROM call WHERE id = $1", [ANRUF]);
  const fristMs = new Date(zeile.frist).getTime();
  const nachher = Date.now();
  assert.ok(fristMs >= vorher + EL_BINDING_AFTER_ANSWER_MS, `frist=${zeile.frist}`);
  assert.ok(fristMs <= nachher + EL_BINDING_AFTER_ANSWER_MS, `frist=${zeile.frist}`);
});
