import { mock, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const SICHT = "kennzahlen.messwerte";
const FEHLER_TEXT = "Sicht kaputt";
const SICHT_ANLEGEN = "sicht-anlegen";

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: ["kennzahlen_leser"],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
});

function mitProtokoll(scheitertBeiSicht) {
  const befehle = [];
  const Basis = pg.Pool;
  pg.Pool = class ProtokollPool extends Basis {
    async connect() {
      const client = await super.connect();
      const echteAbfrage = client.query;
      return {
        ...client,
        query: (text, parameter) => {
          const istSicht = String(text).includes(SICHT);
          if (istSicht && scheitertBeiSicht) return Promise.reject(new Error(FEHLER_TEXT));
          befehle.push(istSicht ? SICHT_ANLEGEN : String(text).trim());
          return echteAbfrage(text, parameter);
        },
      };
    }
  };
  const beenden = () => {
    pg.Pool = Basis;
  };
  return { befehle, beenden };
}

function kennzahlenAbschnitt(befehle) {
  const rolle = befehle.findIndex((text) => text.startsWith("SELECT 1 FROM pg_roles"));
  return befehle.slice(rolle + 1, rolle + 4);
}

test("Beim Start wird die Sicht zwischen BEGIN und COMMIT angelegt", async () => {
  const hermes = laufendesHermes();
  const { befehle, beenden } = mitProtokoll(false);
  try {
    await hermes.schemaErneutAnwenden();
  } finally {
    beenden();
  }
  assert.deepEqual(kennzahlenAbschnitt(befehle), ["BEGIN", SICHT_ANLEGEN, "COMMIT"]);
});

test("Scheitert die Sicht, wird zurückgerollt und der Start meldet die Ursache mit dem Kennzahlen-Text", async () => {
  const hermes = laufendesHermes();
  const { befehle, beenden } = mitProtokoll(true);
  const meldungen = [];
  mock.method(console, "error", (...teile) => {
    meldungen.push(teile.join(" "));
  });
  mock.method(process, "exit", () => undefined);
  try {
    await hermes.schemaErneutAnwenden();
  } finally {
    beenden();
    mock.restoreAll();
  }
  assert.deepEqual(kennzahlenAbschnitt(befehle).slice(0, 2), ["BEGIN", "ROLLBACK"]);
  assert.ok(
    meldungen.some((zeile) => zeile.endsWith("Ursache: Kennzahlen-Sicht fehlgeschlagen: Sicht kaputt")),
    meldungen.join("\n"),
  );
});
