import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";

const HTTP_OK = 200;

function startKennzahlenAttrappe() {
  const verbindungen = [];
  const attrappe = net.createServer((verbindung) => {
    verbindungen.push(verbindung);
    verbindung.destroy();
  });
  return new Promise((resolve) => {
    attrappe.listen(0, "127.0.0.1", () => {
      const adresse = `postgres://kennzahlen_leser@127.0.0.1:${attrappe.address().port}/hermes`;
      resolve({ adresse, verbindungen, stop: () => new Promise((fertig) => attrappe.close(fertig)) });
    });
  });
}

test("B4: mit Dateispeicher und gesetzter Kennzahlen-Adresse öffnet der Start keine Verbindung dorthin, und der Dienst bleibt gesund", async () => {
  const attrappe = await startKennzahlenAttrappe();
  const server = await startServer({ env: { STORE_BACKEND: "json", KENNZAHLEN_DATABASE_URL: attrappe.adresse } });
  try {
    const antwort = await abrufMitFrist(`${server.localUrl}/healthz`);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(attrappe.verbindungen.length, 0);
  } finally {
    await server.stop();
    await attrappe.stop();
  }
});
