import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "./antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { antwortVon, mitInstanzenAufPostgres, signierteZustellung } from "../anrufe/zwei-instanzen-postgres.js";
import {
  anrufAnBis,
  mitZweiHermesAufPostgres,
  neueAnrufe,
  postgresVorhanden,
  rufeAnMit,
  seedeVerbrauch,
  zeilenBis,
} from "../anrufe/hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const WARTEGRENZE_MS = 5_000;
const WARTEGRENZE_PUFFER_MS = 3_000;
const FRIST_MS = 4_000;
const ENDE_FRIST_MS = 6_000;
const SPERR_ENDE_FRIST_MS = 20_000;
const DECKE_CENT = 100;
const TARIF_CENT = "30";
const BOOT_NUMMER = "+15005550006";
const ANRUFER = "+4915112345678";
const ANRUFE_SQL = "SELECT id, max_duration_s FROM call WHERE direction = 'inbound' ORDER BY seq";
const beendet = (anruf) => anruf.status !== "active";
const WACHE_ENV = Object.freeze({
  DEFAULT_TENANT_BUDGET_CENTS: String(DECKE_CENT),
  VOICE_TARIFF_DOMESTIC_CENTS: TARIF_CENT,
  VOICE_TARIFF_DEFAULT_CENTS: TARIF_CENT,
  VOICE_TARIFF_INBOUND_CENTS: TARIF_CENT,
  BUDGET_WATCHDOG_INTERVAL_MS: "200",
});

function umgebung(signer) {
  return {
    ...WACHE_ENV,
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
  };
}

function eingehend(signer, instanz, nr) {
  const rumpf = new URLSearchParams({ CallSid: `CAauffrischen${nr}`, From: ANRUFER, To: BOOT_NUMMER }).toString();
  const zeitstempel = String(nowSeconds());
  return abrufMitFrist(
    `${instanz.localUrl}/voice/incoming`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
        "telnyx-timestamp": zeitstempel,
      },
      body: rumpf,
    },
    { wartezeitMs: WARTEGRENZE_MS + WARTEGRENZE_PUFFER_MS + WARTEGRENZE_MS },
  );
}

const abgewiesen = (instanz) => (instanz.stdout.match(/\[inbound\] kostendecke/g) ?? []).length;
const eingehendeAnrufe = async (sql) => (await sql(ANRUFE_SQL)).rows;

test(
  "Zwei Prozesse: bucht Prozess A bis zur Decke, weist Prozess B den eingehenden Anruf mit gueltiger Signatur ohne Neustart ab",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const signer = makeTelnyxSigner();
    await mitZweiHermesAufPostgres(t, { env: umgebung(signer) }, async ({ b, sql }) => {
      const erster = await eingehend(signer, b, 1);
      assert.equal(erster.status, HTTP_OK);
      assert.equal(abgewiesen(b), 0);
      await zeilenBis(() => eingehendeAnrufe(sql), (zeilen) => zeilen.length === 1);
      await seedeVerbrauch(sql, DECKE_CENT);
      const zweiter = await eingehend(signer, b, 2);
      assert.equal(zweiter.status, HTTP_OK);
      assert.equal(abgewiesen(b), 1);
      assert.equal((await eingehendeAnrufe(sql)).length, 1);
    });
  },
);

test(
  "Zwei Prozesse: die Reserve eines ausgehenden Anrufs in Prozess A kuerzt die Max-Dauer eines eingehenden Anrufs in Prozess B",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const signer = makeTelnyxSigner();
    const { ziel } = neueAnrufe();
    await mitZweiHermesAufPostgres(t, { env: umgebung(signer) }, async ({ a, b, sql }) => {
      assert.equal((await eingehend(signer, b, 1)).status, HTTP_OK);
      const [ohne] = await zeilenBis(() => eingehendeAnrufe(sql), (zeilen) => zeilen.length === 1);
      assert.equal(ohne.max_duration_s, 4 * 60);
      assert.equal((await rufeAnMit(a, { to: ziel(), max_duration_s: 600 })).status, HTTP_OK);
      assert.equal((await eingehend(signer, b, 2)).status, HTTP_OK);
      const zeilen = await zeilenBis(() => eingehendeAnrufe(sql), (liste) => liste.length === 2);
      assert.equal(zeilen[1].max_duration_s, 2 * 60);
    });
  },
);

test(
  "SG-33 Datenbank der Nutzung antwortet nicht binnen der Frist: eingehender Anruf wird abgewiesen, danach nimmt er wieder an",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const signer = makeTelnyxSigner();
    await mitZweiHermesAufPostgres(t, { env: umgebung(signer) }, async ({ b, sql }) => {
      await sql("BEGIN");
      await sql("LOCK TABLE budget_reservierung IN ACCESS EXCLUSIVE MODE");
      const beginn = Date.now();
      let gesperrt;
      try {
        gesperrt = await eingehend(signer, b, 1);
      } finally {
        await sql("COMMIT");
      }
      const dauerMs = Date.now() - beginn;
      assert.equal(gesperrt.status, HTTP_OK);
      assert.equal(abgewiesen(b), 1);
      assert.match(b.stdout, /\[nutzung\] Auffrischung nicht binnen der Frist, gilt als ueberschritten/);
      assert.ok(dauerMs >= FRIST_MS - 500, `wartet bis zur Frist: ${dauerMs} ms`);
      assert.ok(dauerMs < FRIST_MS + WARTEGRENZE_PUFFER_MS, `wartet nicht laenger: ${dauerMs} ms`);
      assert.equal((await eingehendeAnrufe(sql)).length, 0);
      assert.equal((await eingehend(signer, b, 2)).status, HTTP_OK);
      assert.equal(abgewiesen(b), 1);
      await zeilenBis(() => eingehendeAnrufe(sql), (zeilen) => zeilen.length === 1);
    });
  },
);

test(
  "SG-33 Datenbank der Nutzung lehnt das Lesen ab: eingehender Anruf wird sofort abgewiesen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const signer = makeTelnyxSigner();
    await mitZweiHermesAufPostgres(t, { env: umgebung(signer) }, async ({ b, db, sql }) => {
      await sql(`REVOKE SELECT ON budget_reservierung FROM ${db.rolle}`);
      const beginn = Date.now();
      assert.equal((await eingehend(signer, b, 1)).status, HTTP_OK);
      assert.ok(Date.now() - beginn < FRIST_MS, "der Fehler kommt vor der Frist");
      assert.equal(abgewiesen(b), 1);
      assert.match(b.stdout, /\[nutzung\] Auffrischung fehlgeschlagen, gilt als ueberschritten: .*budget_reservierung/);
      assert.equal((await eingehendeAnrufe(sql)).length, 0);
    });
  },
);

test(
  "Zwei Prozesse: bucht Prozess A waehrend eines laufenden Gespraechs in Prozess B bis zur Decke, beendet die Geld-Wache das Gespraech",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const { ziel } = neueAnrufe();
    await mitZweiHermesAufPostgres(t, { env: WACHE_ENV }, async ({ b, sql }) => {
      const to = ziel();
      assert.equal((await rufeAnMit(b, { to, max_duration_s: 600 })).status, HTTP_OK);
      const laufend = await anrufAnBis(sql, { ziel: to, genug: (anruf) => Boolean(anruf.konversation) });
      assert.equal(laufend.status, "active");
      await seedeVerbrauch(sql, DECKE_CENT);
      const anruf = await anrufAnBis(sql, { ziel: to, genug: beendet, fristMs: ENDE_FRIST_MS });
      assert.equal(anruf.failure_reason, "budget-exhausted");
    });
  },
);

test(
  "SG-33 Datenbank der Nutzung antwortet nicht binnen der Frist: die Geld-Wache beendet das laufende Gespraech",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    const { ziel } = neueAnrufe();
    await mitZweiHermesAufPostgres(t, { env: WACHE_ENV }, async ({ b, sql }) => {
      const to = ziel();
      assert.equal((await rufeAnMit(b, { to, max_duration_s: 600 })).status, HTTP_OK);
      await anrufAnBis(sql, { ziel: to, genug: (anruf) => Boolean(anruf.konversation) });
      await sql("BEGIN");
      await sql("LOCK TABLE budget_reservierung IN ACCESS EXCLUSIVE MODE");
      let anruf;
      try {
        anruf = await anrufAnBis(sql, { ziel: to, genug: beendet, fristMs: SPERR_ENDE_FRIST_MS });
      } finally {
        await sql("COMMIT");
      }
      assert.equal(anruf.failure_reason, "budget-exhausted");
      assert.match(b.stdout, /\[nutzung\] Auffrischung nicht binnen der Frist/);
    });
  },
);

test(
  "Zwei Prozesse: bucht Prozess A bis zur Decke, fragt Prozess B in der Gespraechsrunde das Modell nicht mehr und legt auf",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const env = { DEFAULT_TENANT_BUDGET_CENTS: String(DECKE_CENT) };
    await mitInstanzenAufPostgres(t, { anrufe: ["call_auffrischen"], env }, async ({ instanzen: [, b], sql, signer, modell }) => {
      const zustellung = (token, gesagt) =>
        signierteZustellung(signer, {
          callId: "call_auffrischen",
          token,
          felder: { CallSid: "CA_auffrischen", SpeechResult: gesagt },
        });
      const davor = await antwortVon(b, zustellung("t_davor", "Ich moechte einen Termin"));
      assert.match(davor.xml, /<Gather/);
      assert.equal(modell.count(), 1);
      await seedeVerbrauch(sql, DECKE_CENT);
      const danach = await antwortVon(b, zustellung("t_danach", "Und noch eine Frage"));
      assert.match(danach.xml, /<Hangup/);
      assert.equal(modell.count(), 1);
      assert.match(b.stdout, /\[turn\] abbruch grund=budget_tenant call=call_auffrischen runden=0/);
    });
  },
);
