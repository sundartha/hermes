import assert from "node:assert/strict";
import test from "node:test";

import { antwortVon, mitInstanzenAufPostgres, signierteZustellung } from "../anrufe/zwei-instanzen-postgres.js";
import {
  anrufAnBis,
  mitZweiHermesAufPostgres,
  neueAnrufe,
  postgresVorhanden,
  rufeAnMit,
  seedeVerbrauch,
} from "../anrufe/hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const ENDE_FRIST_MS = 6_000;
const DECKE_CENT = 100;
const TARIF_CENT = "30";
const beendet = (anruf) => anruf.status !== "active";
const WACHE_ENV = Object.freeze({
  DEFAULT_TENANT_BUDGET_CENTS: String(DECKE_CENT),
  VOICE_TARIFF_DOMESTIC_CENTS: TARIF_CENT,
  VOICE_TARIFF_DEFAULT_CENTS: TARIF_CENT,
  VOICE_TARIFF_INBOUND_CENTS: TARIF_CENT,
  BUDGET_WATCHDOG_INTERVAL_MS: "200",
});

test(
  "SG-33 Zwei Prozesse: bucht Prozess A waehrend eines laufenden Gespraechs in Prozess B bis zur Decke, beendet die Geld-Wache das Gespraech",
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
