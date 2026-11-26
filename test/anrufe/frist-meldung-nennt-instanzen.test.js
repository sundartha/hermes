import assert from "node:assert/strict";
import { test } from "node:test";

import { attrappenFehler, laufendeAusgaben } from "../gemeinsam/instanz-ausgabe.js";
import { startServer } from "../helpers.js";
import { zeilenBis } from "./hermes-mit-postgres.js";

const KURZE_FRIST_MS = 50;
const ABBRUCH_FEHLT = "[notification] deadlock detected";
const BINDUNG_FEHLT = "Anruf call_frist Schritt Bindung: zeile fehlt";

async function fristMeldung() {
  const fehler = await zeilenBis(
    async () => 1,
    () => false,
    KURZE_FRIST_MS,
  ).then(
    () => null,
    (grund) => grund,
  );
  assert.ok(fehler, "zeilenBis muss nach der Frist fehlschlagen");
  return fehler.message;
}

test("Frist von zeilenBis bei zwei laufenden Hermes-Instanzen: die Meldung enthält die Ausgabe beider", async (t) => {
  const instanzen = [];
  t.after(() => Promise.all(instanzen.map((instanz) => instanz.stop())));
  instanzen.push(await startServer());
  instanzen.push(await startServer());
  const meldung = await fristMeldung();
  const abschnitte = meldung.split(/--- Ausgabe Instanz \d ---/).slice(1);
  assert.deepEqual(
    abschnitte.map((abschnitt) => /laeuft auf http:\/\/localhost:(\d+)/.exec(abschnitt)?.[1]),
    instanzen.map((instanz) => String(instanz.port)),
    meldung,
  );
});

test("Frist von zeilenBis: Zustand, Instanz-Ausgaben, Webhook-Spuren und Fehler der Attrappe stehen in dieser Reihenfolge in der Meldung", async (t) => {
  const ausgaben = [{ text: "instanz-eins" }, { text: ABBRUCH_FEHLT }];
  ausgaben.forEach((ausgabe) => laufendeAusgaben.add(ausgabe));
  attrappenFehler.add(BINDUNG_FEHLT);
  t.after(() => {
    ausgaben.forEach((ausgabe) => laufendeAusgaben.delete(ausgabe));
    attrappenFehler.delete(BINDUNG_FEHLT);
  });
  assert.equal(
    (await fristMeldung()).replace(/nach \d+ ms/, "nach N ms"),
    [
      "Zustand per SQL nach N ms nicht erreicht: 1",
      "--- Ausgabe Instanz 1 ---",
      "instanz-eins",
      "--- Ausgabe Instanz 2 ---",
      ABBRUCH_FEHLT,
      "Webhook-Spuren der laufenden Server:",
      "(keine)",
      "Fehler der Attrappe:",
      BINDUNG_FEHLT,
    ].join("\n"),
  );
});
