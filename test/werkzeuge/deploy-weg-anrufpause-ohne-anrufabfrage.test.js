import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { anrufpause } from "../../tools/deploy-weg/deploy.mjs";
import { NACHKONTROLLE_LAUF_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

async function produktionStarten() {
  const anfragen = [];
  const stand = { an: false };
  const antwort = createServer((anfrage, rueckgabe) => {
    const pfad = new URL(anfrage.url, "http://127.0.0.1").pathname;
    anfragen.push(`${anfrage.method} ${pfad}`);
    const teile = [];
    anfrage.on("data", (teil) => teile.push(teil));
    anfrage.on("end", () => {
      let status = 404;
      let koerper = {};
      if (pfad === "/healthz") {
        status = 200;
        koerper = { ok: true, commit: "a".repeat(40) };
      }
      if (pfad === "/intern/anrufpause") {
        if (anfrage.method === "POST") stand.an = JSON.parse(Buffer.concat(teile).toString()).an;
        status = 200;
        koerper = { an: stand.an };
      }
      rueckgabe.writeHead(status, { "content-type": "application/json" });
      rueckgabe.end(JSON.stringify(koerper));
    });
  });
  server.push(antwort);
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  return { adresse: `http://127.0.0.1:${antwort.address().port}`, anfragen };
}

test("Anrufpause setzt und liest die Pause und fragt keine laufenden Anrufe ab", async () => {
  const { adresse, anfragen } = await produktionStarten();
  const zeilen = [];
  const ergebnis = await anrufpause({
    einstellungen: {
      produktionUrl: adresse,
      deployToken: NACHKONTROLLE_LAUF_TOKEN,
      inActions: false,
    },
    an: true,
    uhr: { jetzt: () => 0, warten: async () => {} },
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
  });
  assert.equal(ergebnis, true);
  assert.equal(anfragen.includes("POST /intern/anrufpause"), true);
  assert.equal(anfragen.includes("GET /intern/anrufpause"), true);
  assert.equal(anfragen.includes("GET /intern/anrufe-laufend"), false);
  assert.equal(
    zeilen.some((zeile) => zeile.includes("Anrufpause angefordert: HTTP 200")),
    true,
  );
  assert.equal(
    zeilen.some((zeile) => zeile.includes("Anrufpause in Produktion: ja")),
    true,
  );
  assert.equal(
    zeilen.some((zeile) => zeile.includes("Laufende Anrufe")),
    false,
  );
});
