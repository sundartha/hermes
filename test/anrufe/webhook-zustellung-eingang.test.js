import assert from "node:assert/strict";
import { test } from "node:test";

import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { EL_INBOUND_ACCESS_BOOT_ENV, makeTelnyxSigner, nowSeconds, startServer } from "../helpers.js";
import { postgresVorhanden } from "./hermes-mit-postgres.js";
import { WEBHOOK_ZUSTELLUNG_SECRET, mitDatenbankVorDemStart, mitInstanzenAufPostgres, zeilenBis } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const EIN_ANRUF = 1;
const ANRUF_NUMMER = "+15005550006";
const ANRUFER_NUMMER = "+491701111111";
const AGENT_ID = "agent_eingang";
const PASSWORT_A = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD;
const PASSWORT_B = "q".repeat(PASSWORT_A.length);
const ZUSTELLUNGEN_SQL = "SELECT anker, kennung, koerper IS NOT NULL AS beantwortet FROM webhook_zustellung";
const ZUSTELLUNG_ALS_TEXT_SQL = "SELECT z::text AS zeile FROM webhook_zustellung z";
const ANRUFE_SQL = "SELECT count(*)::int AS anzahl FROM call WHERE direction = 'inbound'";

function eingehend(signer, callSid) {
  const rumpf = new URLSearchParams({ CallSid: callSid, To: ANRUF_NUMMER, From: ANRUFER_NUMMER }).toString();
  const zeitstempel = String(nowSeconds());
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
      "telnyx-timestamp": zeitstempel,
    },
    body: rumpf,
  };
}

async function antwortVon(instanz, optionen) {
  const res = await abrufMitFrist(`${instanz.localUrl}/voice/incoming`, optionen);
  return { status: res.status, xml: await res.text() };
}

const passwortIn = (xml) => xml.match(/password="([^"]*)"/)?.[1] ?? null;
const bindungIn = (xml) => xml.match(/X-Hermes-Call-Binding=([0-9a-f]+)/)?.[1] ?? null;

async function mitZweiInstanzenUnterschiedlicherKonfiguration(t, { envB }, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const signer = makeTelnyxSigner();
  const gemeinsam = {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    WEBHOOK_ZUSTELLUNG_SECRET,
  };
  const gestartet = [];
  try {
    gestartet.push(await startServer({ env: pgStartUmgebung(db.adresse, { ...gemeinsam, ...elInboundInitSpawnEnv(AGENT_ID) }) }));
    gestartet.push(await startServer({ env: pgStartUmgebung(db.adresse, { ...gemeinsam, ...envB }) }));
    return await lauf({ a: gestartet[0], b: gestartet[1], signer });
  } finally {
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
  }
}

test("S2: derselbe Anruf-Eingang gleichzeitig an zwei Instanzen legt einen Anruf an, beide liefern dasselbe XML", async (t) => {
  const env = { ...elInboundInitSpawnEnv(AGENT_ID), WEBHOOK_ZUSTELLUNG_SECRET };
  await mitDatenbankVorDemStart(t, { env }, async ({ starte, signer, sql }) => {
    const [a, b] = [await starte(), await starte()];
    const zustellung = eingehend(signer, "CAdoppel01");
    const [vonA, vonB] = await Promise.all([antwortVon(a, zustellung), antwortVon(b, zustellung)]);
    for (const antwort of [vonA, vonB]) {
      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.xml, /<Dial/);
    }
    assert.equal(vonB.xml, vonA.xml);
    await zeilenBis(
      async () => (await sql(ANRUFE_SQL)).rows[0].anzahl,
      (anzahl) => anzahl >= EIN_ANRUF,
    );
    const c = await starte();
    const liste = (await (await abrufMitFrist(`${c.localUrl}/api/state`)).json()).calls;
    assert.equal(liste.length, EIN_ANRUF);
  });
});

test("SG-28 Anruf-Eingang im ElevenLabs-Pfad legt Trunk-Passwort und Bindungs-Token weder im Klartext in webhook_zustellung noch im Log ab", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { env: elInboundInitSpawnEnv(AGENT_ID) },
    async ({ instanzen: [a, b], signer, sql }) => {
      const zustellung = eingehend(signer, "CAgeheim01");
      const antwort = await antwortVon(a, zustellung);
      assert.equal(passwortIn(antwort.xml), PASSWORT_A);
      const token = bindungIn(antwort.xml);
      assert.ok(token);
      const zeilen = await zeilenBis(
        async () => (await sql(ZUSTELLUNGEN_SQL)).rows,
        (rows) => rows.some((zeile) => zeile.beantwortet),
      );
      assert.equal(zeilen.length, EIN_ANRUF);
      assert.equal(zeilen[0].beantwortet, true);
      const gespeichert = (await sql(ZUSTELLUNG_ALS_TEXT_SQL)).rows.map((zeile) => zeile.zeile).join("\n");
      await antwortVon(b, zustellung);
      for (const geheimnis of [PASSWORT_A, token]) {
        assert.equal(gespeichert.includes(geheimnis), false);
        assert.equal(a.stdout.includes(geheimnis), false);
        assert.equal(b.stdout.includes(geheimnis), false);
      }
    },
  );
});

test("Positivkontrolle: bei der Wiederholung liefert eine Instanz mit anderem Trunk-Passwort ihren eigenen Wert", async (t) => {
  const envB = { ...elInboundInitSpawnEnv(AGENT_ID), ELEVENLABS_INBOUND_SIP_PASSWORD: PASSWORT_B };
  await mitZweiInstanzenUnterschiedlicherKonfiguration(t, { envB }, async ({ a, b, signer }) => {
    const zustellung = eingehend(signer, "CAeigen001");
    const vonA = await antwortVon(a, zustellung);
    const vonB = await antwortVon(b, zustellung);
    assert.equal(passwortIn(vonA.xml), PASSWORT_A);
    assert.equal(passwortIn(vonB.xml), PASSWORT_B);
    assert.equal(vonB.xml.replace(PASSWORT_B, PASSWORT_A), vonA.xml);
  });
});

test("Eine Instanz ohne Trunk-Passwort liefert nicht die Antwort einer anderen, sondern verarbeitet selbst", async (t) => {
  await mitZweiInstanzenUnterschiedlicherKonfiguration(t, { envB: {} }, async ({ a, b, signer }) => {
    const zustellung = eingehend(signer, "CAohnepw01");
    const vonA = await antwortVon(a, zustellung);
    assert.match(vonA.xml, /<Dial/);
    const vonB = await antwortVon(b, zustellung);
    assert.equal(vonB.status, HTTP_OK);
    assert.doesNotMatch(vonB.xml, /<Dial/);
    assert.match(vonB.xml, /<Gather|<Say/);
  });
});

