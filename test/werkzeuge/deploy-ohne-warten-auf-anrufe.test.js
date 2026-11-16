import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { deploy } from "../../tools/deploy-weg/deploy.mjs";
import { NACHKONTROLLE_LAUF_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const ALT = "a".repeat(40);
const NEU = "b".repeat(40);
const DEPLOY_ID = "dep-abc123";
const MINUTE_MS = 60_000;
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

function zeit() {
  const stand = { t: 0, wartezeiten: [] };
  return {
    stand,
    jetzt: () => stand.t,
    warten: async (ms) => {
      stand.wartezeiten.push(ms);
      stand.t += ms;
    },
  };
}

async function produktionStarten({ laufend, schlafend, nieWach }) {
  const anfragen = [];
  const zustand = { deployAusgeloest: false, statusAbrufe: 0, healthzAbrufe: 0 };
  const antworten = new Map([
    [
      "GET /healthz",
      () => {
        zustand.healthzAbrufe += 1;
        if (nieWach || (schlafend && zustand.healthzAbrufe === 1)) return [503, {}];
        return [200, { ok: true, commit: zustand.deployAusgeloest ? NEU : ALT }];
      },
    ],
    ["GET /intern/anrufe-laufend", () => [200, { laufend }]],
    ["GET /services/srv-1/deploys", () => [200, []]],
    [
      "POST /services/srv-1/deploys",
      () => {
        zustand.deployAusgeloest = true;
        return [201, { id: DEPLOY_ID }];
      },
    ],
    [
      `GET /services/srv-1/deploys/${DEPLOY_ID}`,
      () => {
        zustand.statusAbrufe += 1;
        return [200, { status: zustand.statusAbrufe === 1 ? "update_in_progress" : "live" }];
      },
    ],
    [`POST /services/srv-1/deploys/${DEPLOY_ID}/cancel`, () => [200, {}]],
  ]);
  const antwort = createServer((anfrage, rueckgabe) => {
    const pfad = new URL(anfrage.url, "http://127.0.0.1").pathname;
    anfragen.push(`${anfrage.method} ${pfad}`);
    anfrage.resume();
    anfrage.on("end", () => {
      const [status, koerper] = (antworten.get(`${anfrage.method} ${pfad}`) ?? (() => [404, {}]))();
      rueckgabe.writeHead(status, { "content-type": "application/json" });
      rueckgabe.end(JSON.stringify(koerper));
    });
  });
  server.push(antwort);
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  return { adresse: `http://127.0.0.1:${antwort.address().port}`, anfragen };
}

async function deployLaufen(optionen) {
  const { adresse, anfragen } = await produktionStarten(optionen);
  const uhr = zeit();
  const zeilen = [];
  const ergebnis = await deploy({
    einstellungen: {
      renderUrl: adresse,
      renderSchluessel: NACHKONTROLLE_LAUF_TOKEN,
      serviceId: "srv-1",
      produktionUrl: adresse,
      deployToken: NACHKONTROLLE_LAUF_TOKEN,
    },
    commit: NEU,
    produktion: ALT,
    frischGeweckt: optionen.frischGeweckt ?? false,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    uhr,
  });
  return { ergebnis, anfragen, zeilen, uhr };
}

test("Deploy bei laufenden Anrufen läuft sofort, ohne Anrufe abzufragen und ohne Abbruch beim Umschalten", async () => {
  const { ergebnis, anfragen, zeilen } = await deployLaufen({ laufend: 3 });
  assert.equal(ergebnis, true);
  assert.equal(anfragen.includes("POST /services/srv-1/deploys"), true);
  assert.equal(anfragen.includes("GET /intern/anrufe-laufend"), false);
  assert.equal(anfragen.includes(`POST /services/srv-1/deploys/${DEPLOY_ID}/cancel`), false);
  assert.equal(
    zeilen.some((zeile) => zeile.includes("Deploy-Status: update_in_progress")),
    true,
  );
});

test("Deploy bei frisch geweckter Produktion hat kein Ruhefenster und wartet keine Minute auf Anrufe", async () => {
  const { ergebnis, anfragen, zeilen, uhr } = await deployLaufen({
    laufend: 0,
    schlafend: true,
    frischGeweckt: true,
  });
  assert.equal(ergebnis, true);
  assert.equal(anfragen.includes("GET /intern/anrufe-laufend"), false);
  assert.equal(
    zeilen.some((zeile) => zeile.includes("Ruhefenster") || zeile.includes("ohne laufende Anrufe")),
    false,
  );
  assert.equal(uhr.stand.t < MINUTE_MS, true);
  assert.equal(
    zeilen.some((zeile) => zeile.includes("Produktion hat geschlafen und ist frisch geweckt")),
    true,
  );
});

test("Deploy bei Produktion, die nicht aufwacht, endet rot und löst nichts aus", async () => {
  const { ergebnis, anfragen, zeilen } = await deployLaufen({ laufend: 0, nieWach: true });
  assert.equal(ergebnis, false);
  assert.equal(anfragen.includes("POST /services/srv-1/deploys"), false);
  assert.equal(
    zeilen.some((zeile) => zeile.includes("nicht aufgewacht")),
    true,
  );
});
