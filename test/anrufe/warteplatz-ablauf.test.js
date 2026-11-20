import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "../pg-helpers.js";
import * as speicher from "../../src/store.js";

const { LEITUNGSPLATZ_ENTSCHEIDUNG } = speicher;
const MS_JE_S = 1000;
const ABLAUF_S = 150;
const KUNDE = "kunde_a";

const wartend = (callId) => ({ callId, tenantId: KUNDE });

test("Warteplatz im Speicher: vergessener Platz ist nach Wartefrist plus Puffer frei, eine Sekunde davor noch belegt", async () => {
  let jetztMs = 1_000_000;
  const plaetze = speicher.makeLeitungsplaetze({ jetztMs: () => jetztMs });
  for (let index = 0; index < speicher.WARTENDE_JE_KUNDE; index += 1) await plaetze.belegenWartend(wartend(`w${index}`));
  jetztMs += (ABLAUF_S - 1) * MS_JE_S;
  assert.equal(await plaetze.belegenWartend(wartend("x")), LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL);
  jetztMs += MS_JE_S;
  assert.equal(await plaetze.belegenWartend(wartend("x")), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI);
});

test("Warteplatz in Postgres: der Ablauf wird mit Wartefrist plus Puffer in Sekunden eingetragen", async () => {
  const { runner } = await makePgTestStore();
  const ablaeufe = [];
  const beobachtet = {
    withClient: (arbeit) =>
      runner.withClient((client) =>
        arbeit({
          query: (sql, werte) => {
            if (/INSERT INTO leitungsplatz/.test(sql)) ablaeufe.push(werte[3]);
            return client.query(sql, werte);
          },
        }),
      ),
  };
  const plaetze = speicher.makePostgresLeitungsplaetze(beobachtet);
  assert.equal(await plaetze.belegenWartend(wartend("pg_w")), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI);
  assert.deepEqual(ablaeufe, [ABLAUF_S]);
});
