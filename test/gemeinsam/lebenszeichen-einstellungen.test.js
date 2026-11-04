import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit } from "../helpers.js";
import { starteAnbieterServer } from "./anbieter-attrappe.mjs";

const ADRESSE = "HERZSCHLAG_URL";
const TAKT = "HERZSCHLAG_TAKT_MS";
const VERZUG = "HERZSCHLAG_VERZUG_GRENZE_MS";
const FRIST = "HERZSCHLAG_FRIST_MS";
const ALLE_VARIABLEN = [ADRESSE, TAKT, VERZUG, FRIST];

const ZAHL_EINSTELLUNGEN = [
  { variable: TAKT, schluessel: "herzschlagTaktMs", standard: 60_000, untergrenze: 10, obergrenze: 3_600_000 },
  { variable: VERZUG, schluessel: "herzschlagVerzugGrenzeMs", standard: 2_000, untergrenze: 5, obergrenze: 60_000 },
  { variable: FRIST, schluessel: "herzschlagFristMs", standard: 5_000, untergrenze: 10, obergrenze: 60_000 },
];

const UNGUELTIGE_WERTE = ["0", "-1", "keine-zahl"];
const BEISPIEL_ADRESSE = "https://herzschlag.example.test/api/v1/heartbeat/probe";

const TAKT_VERWEIGERT_NICHT =
  "Lebenszeichen-Einstellungen: ungültiger HERZSCHLAG_TAKT_MS verweigert den Start nicht";
const VERZUG_ODER_FRIST_VERWEIGERT_NICHT =
  "Lebenszeichen-Einstellungen: ungültige Verzugsgrenze oder Frist verweigert den Start nicht";

async function konfigurationBei(umgebung, laden) {
  const gesichert = ALLE_VARIABLEN.map((name) => [name, process.env[name]]);
  for (const name of ALLE_VARIABLEN) delete process.env[name];
  Object.assign(process.env, umgebung);
  try {
    const frisch = await laden();
    return { server: frisch.config.server, befunde: frisch.configFatalErrors() };
  } finally {
    for (const [name, wert] of gesichert) {
      if (wert === undefined) delete process.env[name];
      else process.env[name] = wert;
    }
  }
}

function befundeZu(befunde, variable) {
  return befunde.filter((befund) => befund.includes(variable));
}

async function startVersuch(umgebung) {
  try {
    return await startServerExpectExit({ env: umgebung });
  } catch (fehler) {
    return { code: null, output: fehler.message };
  }
}

function umgebungAusWerten(wertVon) {
  return Object.fromEntries(ZAHL_EINSTELLUNGEN.map((zeile) => [zeile.variable, String(wertVon(zeile))]));
}

const alleZahlenAuf = (wert) => umgebungAusWerten(() => wert);

const UNGUELTIGE_KONFIGURATIONEN = [
  { umgebung: alleZahlenAuf("0"), laden: () => import("../../src/config.js?lebenszeichen-null") },
  { umgebung: alleZahlenAuf("-1"), laden: () => import("../../src/config.js?lebenszeichen-negativ") },
  { umgebung: alleZahlenAuf("keine-zahl"), laden: () => import("../../src/config.js?lebenszeichen-keine-zahl") },
  {
    umgebung: umgebungAusWerten(({ untergrenze }) => untergrenze - 1),
    laden: () => import("../../src/config.js?lebenszeichen-unter-untergrenze"),
  },
];

const GUELTIGE_STARTS = [
  {
    beschreibung: "Standardwerte",
    umgebung: {},
    erwartet: ({ standard }) => standard,
    laden: () => import("../../src/config.js?lebenszeichen-standard"),
  },
  {
    beschreibung: "Untergrenzen",
    umgebung: umgebungAusWerten(({ untergrenze }) => untergrenze),
    erwartet: ({ untergrenze }) => untergrenze,
    laden: () => import("../../src/config.js?lebenszeichen-untergrenzen"),
  },
  {
    beschreibung: "Obergrenzen",
    umgebung: umgebungAusWerten(({ obergrenze }) => obergrenze),
    erwartet: ({ obergrenze }) => obergrenze,
    laden: () => import("../../src/config.js?lebenszeichen-obergrenzen"),
  },
];

test("Lebenszeichen: ein ungültiger Takt verweigert den Start und nennt die Variable", async () => {
  for (const wert of UNGUELTIGE_WERTE) {
    const { code, output } = await startVersuch({ [TAKT]: wert });
    assert.equal(code, 1, TAKT_VERWEIGERT_NICHT);
    assert.ok(output.includes(TAKT), `${TAKT}=${wert}: Meldung nennt die Variable nicht:\n${output}`);
  }
});

test("Lebenszeichen: eine ungültige Verzugsgrenze oder Frist verweigert den Start und nennt die Variable", async () => {
  for (const wert of UNGUELTIGE_WERTE) {
    const { code, output } = await startVersuch({ [VERZUG]: wert, [FRIST]: wert });
    assert.equal(code, 1, VERZUG_ODER_FRIST_VERWEIGERT_NICHT);
    for (const variable of [VERZUG, FRIST]) {
      assert.ok(output.includes(variable), `${variable}=${wert}: Meldung nennt die Variable nicht:\n${output}`);
    }
  }
});

test("Lebenszeichen: 0, negativ, keine Zahl und knapp unter der Untergrenze ergeben je Variable einen Befund mit ihrem Namen", async () => {
  for (const { umgebung, laden } of UNGUELTIGE_KONFIGURATIONEN) {
    const { befunde } = await konfigurationBei(umgebung, laden);
    for (const { variable } of ZAHL_EINSTELLUNGEN) {
      assert.equal(befundeZu(befunde, variable).length, 1, `${variable}=${umgebung[variable]}`);
    }
  }
});

test("Lebenszeichen: Standardwerte und Werte an den Grenzen starten den Dienst mit genau diesen Werten", async () => {
  for (const { beschreibung, umgebung, erwartet, laden } of GUELTIGE_STARTS) {
    const { server, befunde } = await konfigurationBei(umgebung, laden);
    for (const zeile of ZAHL_EINSTELLUNGEN) {
      assert.equal(server[zeile.schluessel], erwartet(zeile), `${beschreibung}: ${zeile.variable}`);
      assert.deepEqual(befundeZu(befunde, zeile.variable), [], `${beschreibung}: ${zeile.variable}`);
    }
    const dienst = await startServer({ env: umgebung });
    await dienst.stop();
  }
});

test("Lebenszeichen: ein Wert über der Obergrenze bleibt ohne Befund auf der Obergrenze", async () => {
  const { server, befunde } = await konfigurationBei(
    umgebungAusWerten(({ obergrenze }) => obergrenze + 1),
    () => import("../../src/config.js?lebenszeichen-ueber-obergrenze"),
  );
  for (const { variable, schluessel, obergrenze } of ZAHL_EINSTELLUNGEN) {
    assert.equal(server[schluessel], obergrenze, variable);
    assert.deepEqual(befundeZu(befunde, variable), [], variable);
  }
});

test("Lebenszeichen: die Adresse kommt unverändert in die Einstellung, ohne Wert ist sie leer", async () => {
  const mitAdresse = await konfigurationBei(
    { [ADRESSE]: BEISPIEL_ADRESSE },
    () => import("../../src/config.js?lebenszeichen-mit-adresse"),
  );
  assert.equal(mitAdresse.server.herzschlagUrl, BEISPIEL_ADRESSE);

  const ohneAdresse = await konfigurationBei({}, () => import("../../src/config.js?lebenszeichen-ohne-adresse"));
  assert.equal(ohneAdresse.server.herzschlagUrl, "");
});

test("[NIE2] ein ungültiger Takt verweigert den Start, nennt die Variable und meldet nichts an die Adresse", async () => {
  const empfaenger = await starteAnbieterServer(({ res, vermerke }) => {
    vermerke("meldung");
    res.end();
  });
  try {
    for (const wert of UNGUELTIGE_WERTE) {
      const { code, output } = await startVersuch({ [TAKT]: wert, [ADRESSE]: empfaenger.url });
      assert.equal(code, 1, `${TAKT}=${wert}: der Dienst lief weiter statt abzubrechen:\n${output}`);
      assert.ok(output.includes(TAKT), `${TAKT}=${wert}: Meldung nennt die Variable nicht:\n${output}`);
      assert.deepEqual(empfaenger.anfragen, [], `${TAKT}=${wert}: Meldung trotz verweigertem Start`);
    }
  } finally {
    await empfaenger.close();
  }
});
