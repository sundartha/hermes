import assert from "node:assert/strict";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { TELNYX_GAP10_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { nowSeconds } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { WEBHOOK_ZUSTELLUNG_SECRET, mitDatenbankVorDemStart } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANTWORT_FRIST_MS = 3_000;
const FRIST_BIS_UMLEITUNG_MS = 20_000;
const NACHLAUF_MS = 2_000;
const TAKT_MS = 200;
const EINE_UMLEITUNG = 1;
const ABLAGE_TABELLE = "webhook_zustellung";
const KONTO = "acct_beinaus";
const OHNE_ERKENNUNG_ZEILE = "[webhook-idempotenz] wiederholte_zustellung weg=el-bein art=ohne_erkennung";
const KOSTENPROFIL_SQL =
  "UPDATE call SET cost_profile = 'telnyx_outbound_el_convai', twilio_sid = $2, answered_at = now()::text WHERE id = $1";

const sidVon = (anruf) => `tnx_${anruf}`;
const umleitungsPfad = (anruf) => `/v2/texml/Accounts/${KONTO}/Calls/${sidVon(anruf)}`;

function signierterBeinStatus(signer, anruf) {
  const rumpf = new URLSearchParams({ CallStatus: "in-progress", CallSid: sidVon(anruf) }).toString();
  const zeitstempel = String(nowSeconds());
  return {
    pfad: `/voice/el-bein?callId=${anruf}`,
    optionen: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
        "telnyx-timestamp": zeitstempel,
      },
      body: rumpf,
    },
  };
}

function starteTelnyxAttrappe(anruf, umleitungen) {
  return starteAttrappe((anfrage, antwort) => {
    anfrage.resume();
    anfrage.on("end", () => {
      if (anfrage.url === umleitungsPfad(anruf)) umleitungen.push(anfrage.url);
      antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
      antwort.end("{}");
    });
  });
}

async function mitBeinAnruf(t, anruf, lauf) {
  const umleitungen = [];
  const telnyx = await starteTelnyxAttrappe(anruf, umleitungen);
  t.after(() => telnyx.close());
  const env = {
    TELNYX_API_BASE: telnyx.url,
    TELNYX_API_KEY: TELNYX_GAP10_SCHLUESSEL,
    TELNYX_ACCOUNT_SID: KONTO,
    WEBHOOK_ZUSTELLUNG_SECRET,
  };
  await mitDatenbankVorDemStart(t, { anrufe: [anruf], env }, async ({ sql, signer, starte }) => {
    await sql(KOSTENPROFIL_SQL, [anruf, sidVon(anruf)]);
    await lauf({ sql, instanz: await starte(), zustellung: signierterBeinStatus(signer, anruf), umleitungen });
  });
}

async function sendeUndWarteAufUmleitung({ instanz, zustellung, umleitungen }) {
  const beginn = Date.now();
  const antwort = await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen);
  assert.ok(Date.now() - beginn < ANTWORT_FRIST_MS, "el-bein antwortet innerhalb von 3 s");
  assert.equal(antwort.status, HTTP_OK);
  const ende = Date.now() + FRIST_BIS_UMLEITUNG_MS;
  while (umleitungen.length === 0 && Date.now() < ende) await echtWarten(TAKT_MS);
  await echtWarten(NACHLAUF_MS);
  assert.equal(umleitungen.length, EINE_UMLEITUNG);
}

test("el-bein bei gesperrter Ablage: Antwort 200 binnen 3 s, genau eine Umleitung, grund=frist", async (t) => {
  await mitBeinAnruf(t, "call_beinfrist", async (ctx) => {
    await ctx.sql("BEGIN");
    try {
      await ctx.sql(`LOCK TABLE ${ABLAGE_TABELLE} IN ACCESS EXCLUSIVE MODE`);
      await sendeUndWarteAufUmleitung(ctx);
      assert.ok(ctx.instanz.stdout.includes(`${OHNE_ERKENNUNG_ZEILE} grund=frist`), `Logzeile fehlt:\n${ctx.instanz.stdout}`);
    } finally {
      await ctx.sql("ROLLBACK");
    }
  });
});

test("el-bein bei fehlender Ablage: Antwort 200, genau eine Umleitung, grund=fehler statt frist", async (t) => {
  await mitBeinAnruf(t, "call_beinfehler", async (ctx) => {
    await ctx.sql(`DROP TABLE ${ABLAGE_TABELLE}`);
    await sendeUndWarteAufUmleitung(ctx);
    assert.ok(ctx.instanz.stdout.includes(`${OHNE_ERKENNUNG_ZEILE} grund=fehler`), `Logzeile fehlt:\n${ctx.instanz.stdout}`);
    assert.ok(!ctx.instanz.stdout.includes("grund=frist"), "ein Fehler ist keine Frist");
  });
});
