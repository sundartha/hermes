import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresVorhanden, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { mitZweiInstanzenMitKostendecke, sendeEnde } from "../anrufe/zwei-instanzen-kernwege-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const TARIF_CENT = 40;
const DECKE_CENT = 80;
const ERSTES_ZIEL = "+4915112399101";
const ZWEITES_ZIEL = "+4915112399102";
const EINMAL = 1;
const GESPRAECH = Object.freeze([
  { role: "agent", message: "Guten Tag, ich rufe wegen des Termins an." },
  { role: "user", message: "Ja, worum geht es genau?" },
]);
const VERBRAUCH_SQL = "SELECT cost_eur * 100 AS cent FROM usage WHERE tenant_id = 'tenant_kernwege'";
const ANRUF_SQL = "SELECT id FROM call WHERE to_e164 = $1";

async function verbrauchNachEnde(t, { endeAuf, naechsterAnrufAuf }) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiInstanzenMitKostendecke(t, { tarifCent: TARIF_CENT, deckeCent: DECKE_CENT }, async (lauf) => {
    const { sql, rufeAn, anbieter } = lauf;
    assert.equal((await rufeAn(lauf[endeAuf], ERSTES_ZIEL)).status, HTTP_OK);
    const [{ id: callId }] = (await sql(ANRUF_SQL, [ERSTES_ZIEL])).rows;
    anbieter.beendeGespraech(`conv_${callId}`, GESPRAECH);
    await sendeEnde(lauf[endeAuf], callId);
    await zeilenBis(
      async () => (await sql(VERBRAUCH_SQL)).rows,
      ([verbrauch]) => Number(verbrauch?.cent) > 0,
    );
    const abgelehnt = await rufeAn(lauf[naechsterAnrufAuf], ZWEITES_ZIEL);
    assert.equal(abgelehnt.status, HTTP_PAYMENT_REQUIRED);
    assert.equal(anbieter.starts().length, EINMAL);
  });
}

test("T10 Ende auf B, danach Start auf A: A lehnt mit der Kostendecke ab und der Anbieter wird nur einmal gerufen", { timeout: ZEITGRENZE_MS }, (t) =>
  verbrauchNachEnde(t, { endeAuf: "b", naechsterAnrufAuf: "a" }));

test("T10 Ende auf A, danach Start auf B: B lehnt mit der Kostendecke ab und der Anbieter wird nur einmal gerufen", { timeout: ZEITGRENZE_MS }, (t) =>
  verbrauchNachEnde(t, { endeAuf: "a", naechsterAnrufAuf: "b" }));
