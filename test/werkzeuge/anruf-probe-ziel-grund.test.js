import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN, PROBE_TELNYX_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const STAGING = "https://hermes-staging-erpv.onrender.com";
const NUMMER = "+12544670400";
const GUT = {
  annahmeSekunden: 4,
  begruessung:
    "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Probe GmbH. Das Gespräch wird für meinen Auftraggeber zusammengefasst.",
  sprache: "de",
  auftraggeber: "Probe GmbH",
  dauerSekunden: 30,
  status: "completed",
};

async function lauf({ adresse = STAGING, eigene = NUMMER, ziel = NUMMER, fehler = false }) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "e".repeat(40),
    STAGING_URL: adresse,
    STAGING_PROBE_ZIEL: ziel,
    STAGING_PROBE_TELNYX_KEY: PROBE_TELNYX_SCHLUESSEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({
      eigeneNummer: eigene,
      eigeneNummerFehler: fehler,
      stand: { erstversuche: 0, anrufe: 0 },
      messungen: [GUT],
    }),
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  const zeilen = ausgabe.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::"));
  return { code, zeilen, gewaehlt: zeilen.filter((zeile) => zeile.startsWith("ANRUF")).length };
}

const ABGELEHNT = [
  ["Adresse ist Live", { adresse: "https://vodafone-agent.onrender.com" }, "probe_ziel_unerlaubt: adresse_nicht_staging"],
  ["Adresse unlesbar", { adresse: "kein-url" }, "probe_ziel_unerlaubt: adresse_nicht_staging"],
  ["Nummer fehlt", { eigene: null }, "probe_ziel_unerlaubt: nummer_nicht_lesbar"],
  ["Nummer leer", { eigene: "" }, "probe_ziel_unerlaubt: nummer_nicht_lesbar"],
  ["Abruf scheitert", { fehler: true }, "probe_ziel_unerlaubt: nummer_nicht_lesbar"],
  [
    "andere Ziffer",
    { eigene: "+12544670400", ziel: "+12544671234" },
    "probe_ziel_unerlaubt: nummer_weicht_ab eigene=0400 ziel=1234",
  ],
  ["Nummer ist keine Zeichenkette", { eigene: 12544670400 }, "probe_ziel_unerlaubt: nummer_nicht_lesbar"],
  [
    "Nichtziffer am Ende zählt nicht zu den letzten vier",
    { eigene: "+12544670400", ziel: "+12544671234x" },
    "probe_ziel_unerlaubt: nummer_weicht_ab eigene=0400 ziel=1234",
  ],
  [
    "fehlendes Plus",
    { eigene: "+12544670400", ziel: "12544670400" },
    "probe_ziel_unerlaubt: nummer_weicht_ab eigene=0400 ziel=0400",
  ],
];

for (const [name, abweichung, erwartet] of ABGELEHNT) {
  test(`Anrufprobe nennt den Grund getrennt: ${name}`, async () => {
    const { code, zeilen, gewaehlt } = await lauf(abweichung);
    assert.equal(code, 1);
    assert.equal(gewaehlt, 0);
    assert.ok(zeilen.includes(erwartet), zeilen.join("\n"));
    assert.equal(zeilen.join("\n").includes("2544670"), false);
  });
}

const SCHREIBWEISE = [
  ["Leerzeichen und Bindestrich", "+1 254 467-0400"],
  ["Rand-Leerraum und Zeilenende", " +12544670400\n"],
  ["Klammern und Punkte", "+1 (254) 467.0400"],
];

for (const [name, ziel] of SCHREIBWEISE) {
  test(`Anrufprobe gleicht nur die Schreibweise der Zielnummer an: ${name}`, async () => {
    const { code, gewaehlt } = await lauf({ ziel });
    assert.equal(code, 0);
    assert.equal(gewaehlt, 1);
  });
}
