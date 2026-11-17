import assert from "node:assert/strict";
import test from "node:test";

import { LEITUNGSPLATZ_DB_FRIST_MS } from "../../src/begriffe/speicher.js";
import { makePostgresLeitungsplaetze } from "../../src/store/leitungsplaetze-pg.js";

const ANFRAGE = Object.freeze({ tenantId: "tenant_frist", weg: "elevenlabs", hoechstzahlKunde: 2 });
const BELEGEN = Object.freeze({ callId: "call_frist", tenantId: "tenant_frist", weg: "elevenlabs", maxDauerS: 60, hoechstzahlKunde: 2 });
const SCHRITT_VOR_FRIST_MS = 1;
const NIE = new Promise(() => {});

function clientMit(hangtBei) {
  const aufrufe = [];
  return {
    aufrufe,
    query: async (text) => {
      aufrufe.push(text);
      if (text === hangtBei) return NIE;
      return { rows: [] };
    },
    release: () => aufrufe.push("release"),
  };
}

const runnerMit = (client) => ({ withClient: (arbeit) => arbeit(client) });
const runnerOhneVerbindung = { withClient: () => NIE };

async function nachFrist(t, frage) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let antwort;
  const offen = frage().then((wert) => {
    antwort = { wert };
  });
  t.mock.timers.tick(LEITUNGSPLATZ_DB_FRIST_MS - SCHRITT_VOR_FRIST_MS);
  await Promise.resolve();
  assert.equal(antwort, undefined, "vor Ablauf der Frist keine Antwort");
  t.mock.timers.tick(SCHRITT_VOR_FRIST_MS);
  await offen;
  return antwort.wert;
}

for (const [name, runner] of [
  ["Verbindung kommt nicht zustande", runnerOhneVerbindung],
  ["BEGIN haengt", runnerMit(clientMit("BEGIN"))],
]) {
  test(`${name}: Pruefen lehnt nach genau der Frist ab`, async (t) => {
    const leitungen = makePostgresLeitungsplaetze(runner);
    const meldung = t.mock.method(console, "error", () => {});
    assert.equal(await nachFrist(t, () => leitungen.pruefenAusgehend(ANFRAGE)), "anbieter_voll");
    assert.match(meldung.mock.calls[0].arguments[1], /^Frist von 5000 ms ueberschritten$/);
  });

  test(`${name}: Belegen liefert anbieter_voll nach genau der Frist`, async (t) => {
    const leitungen = makePostgresLeitungsplaetze(runner);
    t.mock.method(console, "error", () => {});
    assert.deepEqual(await nachFrist(t, () => leitungen.belegenAusgehend(BELEGEN)), { entscheidung: "anbieter_voll" });
  });
}

test("normale Datenbank: Belegen ist frei und committet, ohne die Frist abzuwarten", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = clientMit(null);
  const ergebnis = await makePostgresLeitungsplaetze(runnerMit(client)).belegenAusgehend(BELEGEN);
  assert.deepEqual(ergebnis, { entscheidung: "frei" });
  assert.equal(client.aufrufe.at(-1), "COMMIT");
  assert.ok(client.aufrufe.includes("BEGIN"));
});
