// ---- Erwartungstabelle der Live-Probe gegen die Routen-Politik (PLAN-AUTH-GATE P2) --
// scripts/probe-auth.sh misst den deployten Zustand, src/route-policy.js beschreibt den
// Quellstand. Beide reden ueber dieselben Routen - also darf es nur EINE Wahrheit geben.
// Ohne diesen Test koennte eine Route in der Politik "haengt am Gate" heissen und in der
// Probe "ist oeffentlich, 200 ist in Ordnung"; die Probe liefe gruen ueber genau die
// offene Tuer, die sie finden soll. Der Test kennt keine Statuscodes des Produkts - er
// prueft die Zuordnung, nicht das Verhalten.
//
// Die Probe ist ein Shell-Skript ohne Laufzeit-Kopplung an src/ (sie muss gegen einen
// FREMDEN Deploy laufen, dessen Code hier gar nicht liegt). Die Tabelle wird deshalb aus
// dem Skript gelesen, nicht importiert.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GATE_ONLY_ROUTES, PUBLIC_ROUTES, routeKey } from "../src/route-policy.js";

const PROBE_SKRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "probe-auth.sh",
);
// Der Tabellenblock im Skript (Here-Doc). Beide Marken stehen dort jeweils allein.
const TABELLE_START = "<<'TABELLE'";
const TABELLE_ENDE = "TABELLE";
const SPALTEN = 6;
// Arten aus dem Skript-Kopf. "sitzung" = darf ohne Sitzung nicht bedienbar sein.
const ART = Object.freeze({
  SITZUNG: "sitzung",
  OEFFENTLICH: "oeffentlich",
  STATISCH: "statisch",
  FEHLT: "fehlt",
});
// Antwortende Schicht. "gate" ist die Sammelsicherung, die dieser Plan aufloest.
const ANTWORTET = Object.freeze({
  GATE: "gate",
  WEBAUTH: "webauth",
  MCPAUTH: "mcpauth",
  KEINE: "keine",
});
// Fuer sitzungspflichtige Routen ist NUR das ein bestandener Zustand (W6): 404 waere
// eine nicht gemountete Route, 2xx eine offene Tuer.
const SCHUTZ_STATUS = Object.freeze(["401", "403"]);

function leseTabelle() {
  const zeilen = fs.readFileSync(PROBE_SKRIPT, "utf8").split("\n");
  const start = zeilen.findIndex((zeile) => zeile.includes(TABELLE_START));
  assert.ok(start >= 0, `Tabellenanfang ${TABELLE_START} nicht in ${PROBE_SKRIPT} gefunden`);
  const ende = zeilen.indexOf(TABELLE_ENDE, start + 1);
  assert.ok(ende > start, `Tabellenende '${TABELLE_ENDE}' nicht in ${PROBE_SKRIPT} gefunden`);

  return zeilen.slice(start + 1, ende).map((zeile, index) => {
    const felder = zeile.split("|");
    assert.equal(
      felder.length,
      SPALTEN,
      `Zeile ${index + 1} der Erwartungstabelle hat ${felder.length} statt ${SPALTEN} Spalten: ${zeile}`,
    );
    const [art, methode, pfad, status, antwortet, begruendung] = felder;
    return {
      art,
      methode,
      pfad,
      status,
      antwortet,
      begruendung,
      schluessel: routeKey(methode, pfad),
    };
  });
}

const TABELLE = leseTabelle();
const TABELLEN_SCHLUESSEL = new Map(TABELLE.map((zeile) => [zeile.schluessel, zeile]));
const PUBLIC_KEYS = new Set(PUBLIC_ROUTES.map((r) => routeKey(r.method, r.path)));
const GATE_ONLY_KEYS = new Set(GATE_ONLY_ROUTES.map((r) => routeKey(r.method, r.path)));

test("Probe-Tabelle: jede Zeile ist wohlgeformt und kommt genau einmal vor", () => {
  assert.ok(TABELLE.length > 0, "Die Erwartungstabelle ist leer - die Probe misst nichts.");
  assert.equal(
    TABELLEN_SCHLUESSEL.size,
    TABELLE.length,
    "Doppelte Zeilen in der Erwartungstabelle - eine davon ist tot und wird nie gepflegt.",
  );
  const unbekannteArt = TABELLE.filter((zeile) => !Object.values(ART).includes(zeile.art));
  assert.deepEqual(
    unbekannteArt.map((zeile) => `${zeile.schluessel} (${zeile.art})`),
    [],
    `Unbekannte ART. Erlaubt: ${Object.values(ART).join(", ")}.`,
  );
  const unbekannteSchicht = TABELLE.filter(
    (zeile) => !Object.values(ANTWORTET).includes(zeile.antwortet),
  );
  assert.deepEqual(
    unbekannteSchicht.map((zeile) => `${zeile.schluessel} (${zeile.antwortet})`),
    [],
    `Unbekannte antwortende Schicht. Erlaubt: ${Object.values(ANTWORTET).join(", ")}.`,
  );
  const kaputterStatus = TABELLE.filter((zeile) => !/^[1-5][0-9]{2}$/.test(zeile.status));
  assert.deepEqual(
    kaputterStatus.map((zeile) => `${zeile.schluessel} -> ${zeile.status}`),
    [],
    "Erwarteter Status ist kein HTTP-Statuscode.",
  );
});

test("Probe-Tabelle: jede Route aus src/route-policy.js wird auch live geprueft", () => {
  const fehlend = [...PUBLIC_KEYS, ...GATE_ONLY_KEYS].filter(
    (schluessel) => !TABELLEN_SCHLUESSEL.has(schluessel),
  );
  assert.deepEqual(
    fehlend,
    [],
    "Diese Routen stehen in src/route-policy.js, aber nicht in der Erwartungstabelle von " +
      "scripts/probe-auth.sh. Die Probe deckt die VOLLSTAENDIGE Routenliste ab " +
      "(Owner-Entscheidung 2026-08-02) - eine ungeprueft gebliebene Route ist genau die, " +
      "bei der niemand merkt, dass sie offen steht.",
  );
});

test("Probe-Tabelle: die Einordnung stimmt mit src/route-policy.js ueberein", () => {
  const widerspruch = [];
  for (const zeile of TABELLE) {
    const inPublic = PUBLIC_KEYS.has(zeile.schluessel);
    const inGateOnly = GATE_ONLY_KEYS.has(zeile.schluessel);
    if (inPublic && zeile.art !== ART.OEFFENTLICH)
      widerspruch.push(`${zeile.schluessel}: PUBLIC_ROUTES, aber ART='${zeile.art}'`);
    if (inGateOnly && zeile.art !== ART.SITZUNG)
      widerspruch.push(`${zeile.schluessel}: GATE_ONLY_ROUTES, aber ART='${zeile.art}'`);
    // Der gefaehrliche Fall: eine Zeile erklaert etwas fuer oeffentlich, das in der
    // Politik nirgends als oeffentlich begruendet ist.
    if (!inPublic && zeile.art === ART.OEFFENTLICH)
      widerspruch.push(
        `${zeile.schluessel}: ART='oeffentlich', steht aber nicht in PUBLIC_ROUTES`,
      );
    if ((inPublic || inGateOnly) && zeile.art === ART.STATISCH)
      widerspruch.push(`${zeile.schluessel}: ART='statisch', ist aber eine Express-Route`);
    // Eine als oeffentlich begruendete Route liegt vor dem Gate oder ist von ihm
    // ausgenommen. Antwortet dort das Gate, ist die Ausnahme bzw. die Mount-Reihenfolge
    // gebrochen - und die Begruendung in PUBLIC_ROUTES stimmt nicht mehr.
    if (inPublic && zeile.antwortet === ANTWORTET.GATE)
      widerspruch.push(`${zeile.schluessel}: PUBLIC_ROUTES, aber ANTWORTET='gate'`);
    if (zeile.antwortet === ANTWORTET.GATE && ![ART.SITZUNG, ART.FEHLT].includes(zeile.art))
      widerspruch.push(`${zeile.schluessel}: ANTWORTET='gate', aber ART='${zeile.art}'`);
    if (zeile.art === ART.SITZUNG && zeile.antwortet === ANTWORTET.KEINE)
      widerspruch.push(
        `${zeile.schluessel}: sitzungspflichtig, aber ANTWORTET='keine' - dann sichert nichts`,
      );
  }
  assert.deepEqual(
    widerspruch,
    [],
    "Erwartungstabelle und Routen-Politik widersprechen sich. Zwei Wahrheiten ueber " +
      "dieselbe Route sind schlimmer als eine falsche: die Probe deckt dann die Politik, " +
      "statt sie zu pruefen.",
  );
});

test("Probe-Tabelle: sitzungspflichtige Routen erwarten 401 oder 403, nie 404 oder 2xx", () => {
  const falsch = TABELLE.filter(
    (zeile) => zeile.art === ART.SITZUNG && !SCHUTZ_STATUS.includes(zeile.status),
  ).map((zeile) => `${zeile.schluessel} -> ${zeile.status}`);
  assert.deepEqual(
    falsch,
    [],
    "Fuer eine sitzungspflichtige Route ist NUR 401/403 ein Bestehen (W6). Ein erwarteter " +
      "404 wuerde eine nicht gemountete Route (guardedBoot fail-open) als Erfolg verbuchen, " +
      "ein erwarteter 2xx eine offene Tuer.",
  );
});

test("Probe-Tabelle: jede Zeile traegt eine Begruendung", () => {
  const ohne = TABELLE.filter((zeile) => zeile.begruendung.trim().length === 0).map(
    (zeile) => zeile.schluessel,
  );
  assert.deepEqual(
    ohne,
    [],
    "Ohne Begruendung ist eine Erwartung nicht pruefbar - beim naechsten Abweichen weiss " +
      "niemand, ob der Wert je stimmte.",
  );
});
