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
const TABELLE_START = "<<'TABELLE'";
const TABELLE_ENDE = "TABELLE";
const SPALTEN = 6;
const ART = Object.freeze({
  SITZUNG: "sitzung",
  OEFFENTLICH: "oeffentlich",
  STATISCH: "statisch",
  FEHLT: "fehlt",
});
const ANTWORTET = Object.freeze({
  INTERNAL: "internal",
  WEBAUTH: "webauth",
  MCPAUTH: "mcpauth",
  KEINE: "keine",
});
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
    if (!inPublic && zeile.art === ART.OEFFENTLICH)
      widerspruch.push(
        `${zeile.schluessel}: ART='oeffentlich', steht aber nicht in PUBLIC_ROUTES`,
      );
    if ((inPublic || inGateOnly) && zeile.art === ART.STATISCH)
      widerspruch.push(`${zeile.schluessel}: ART='statisch', ist aber eine Express-Route`);
    if (inPublic && zeile.antwortet !== ANTWORTET.KEINE)
      widerspruch.push(`${zeile.schluessel}: PUBLIC_ROUTES, aber ANTWORTET='${zeile.antwortet}'`);
    if (zeile.antwortet === ANTWORTET.INTERNAL && zeile.art !== ART.SITZUNG)
      widerspruch.push(`${zeile.schluessel}: ANTWORTET='internal', aber ART='${zeile.art}'`);
    if (zeile.art === ART.SITZUNG && zeile.antwortet === ANTWORTET.KEINE)
      widerspruch.push(
        `${zeile.schluessel}: sitzungspflichtig, aber ANTWORTET='keine' - dann sichert nichts`,
      );
    if (zeile.art === ART.FEHLT && (zeile.antwortet !== ANTWORTET.KEINE || zeile.status !== "404"))
      widerspruch.push(
        `${zeile.schluessel}: ART='fehlt', aber ANTWORTET='${zeile.antwortet}'/STATUS='${zeile.status}' (erwartet KEINE/404)`,
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

const IN_P4_GELOESCHT = [
  { method: "POST", path: "/api/settings" },
  { method: "POST", path: "/api/action-items/:id/toggle" },
  { method: "POST", path: "/api/calendar" },
  { method: "GET", path: "/api/profiles" },
  { method: "POST", path: "/api/profiles" },
  { method: "DELETE", path: "/api/profiles/:tenantId" },
];

test("AUTH-P4-8: die sechs in P4 geloeschten Routen stehen nicht mehr in der Politik und sind Negativkontrolle der Probe", () => {
  for (const { method, path } of IN_P4_GELOESCHT) {
    const schluessel = routeKey(method, path);
    assert.equal(
      GATE_ONLY_KEYS.has(schluessel),
      false,
      `${schluessel}: steht noch in GATE_ONLY_ROUTES - in AUTH-P4 geloescht, aber die Politik nicht nachgezogen`,
    );
    const zeile = TABELLEN_SCHLUESSEL.get(schluessel);
    assert.ok(zeile, `${schluessel}: fehlt in der Probe-Tabelle - keine Negativkontrolle mehr`);
    assert.equal(zeile.art, ART.FEHLT, `${schluessel}: ART muss 'fehlt' sein`);
    assert.equal(zeile.status, "404", `${schluessel}: erwarteter Status muss 404 sein (kein Gate mehr, das maskiert)`);
    assert.equal(zeile.antwortet, ANTWORTET.KEINE, `${schluessel}: ANTWORTET muss 'keine' sein`);
  }
});

const IN_P5_ABGESICHERT = [
  { method: "POST", path: "/api/calls" },
  { method: "POST", path: "/api/calls/:id/cancel" },
  { method: "GET", path: "/api/calls/:id/consult" },
  { method: "POST", path: "/api/calls/:id/consult/answer" },
  { method: "GET", path: "/api/state" },
  { method: "GET", path: "/api/calls/:id" },
  { method: "GET", path: "/api/tenant-data/export" },
];

test("AUTH-P5-7: die sieben in P5 abgesicherten Routen stehen nicht mehr in der Politik, die Probe-Zeile zeigt internalOnly", () => {
  for (const { method, path } of IN_P5_ABGESICHERT) {
    const schluessel = routeKey(method, path);
    assert.equal(
      GATE_ONLY_KEYS.has(schluessel),
      false,
      `${schluessel}: steht noch in GATE_ONLY_ROUTES - in AUTH-P5 mit internalOnly abgesichert, aber die Politik nicht nachgezogen`,
    );
    const zeile = TABELLEN_SCHLUESSEL.get(schluessel);
    assert.ok(zeile, `${schluessel}: fehlt in der Probe-Tabelle`);
    assert.equal(zeile.art, ART.SITZUNG, `${schluessel}: ART muss 'sitzung' bleiben`);
    assert.equal(
      zeile.status,
      "403",
      `${schluessel}: erwarteter Status ist seit AUTH-P7 403 - internalOnly ist die einzige Sicherung`,
    );
    assert.equal(zeile.antwortet, ANTWORTET.INTERNAL, `${schluessel}: ANTWORTET muss 'internal' sein`);
  }
});

const IN_P6_ABGESICHERT = [
  { method: "POST", path: "/api/billing/flush-meters" },
  { method: "POST", path: "/api/billing/cost-truing/sweep" },
  { method: "GET", path: "/api/billing/cost-drift" },
  { method: "GET", path: "/api/billing/platform-costs" },
  { method: "POST", path: "/api/onboard" },
  { method: "POST", path: "/api/onboard/retry" },
];

test("AUTH-P6-9: die sechs in P6 abgesicherten Betreiber-Routen stehen nicht mehr in der Politik, die Probe-Zeile zeigt webAuthMw", () => {
  for (const { method, path } of IN_P6_ABGESICHERT) {
    const schluessel = routeKey(method, path);
    assert.equal(
      GATE_ONLY_KEYS.has(schluessel),
      false,
      `${schluessel}: steht noch in GATE_ONLY_ROUTES - in AUTH-P6 mit webAuthMw+adminMw abgesichert, aber die Politik nicht nachgezogen`,
    );
    const zeile = TABELLEN_SCHLUESSEL.get(schluessel);
    assert.ok(zeile, `${schluessel}: fehlt in der Probe-Tabelle`);
    assert.equal(zeile.art, ART.SITZUNG, `${schluessel}: ART muss 'sitzung' bleiben`);
    assert.equal(
      zeile.status,
      "401",
      `${schluessel}: erwarteter Status bleibt 401 - webAuthMw antwortet jetzt, wo frueher das Gate antwortete`,
    );
    assert.equal(zeile.antwortet, ANTWORTET.WEBAUTH, `${schluessel}: ANTWORTET muss 'webauth' sein`);
  }
});

test("AUTH-P7-6: GATE_ONLY_ROUTES ist leer - keine Route haengt mehr allein an einer Sammelsicherung", () => {
  assert.deepEqual(
    GATE_ONLY_ROUTES,
    [],
    "Das Legacy-Checkout-Paar traegt seit AUTH-P7 internalOnly und ist in die Klasse AUTH gewandert; " +
      "ein neuer Eintrag hier waere eine Route ohne eigene Sicherung.",
  );
});

const IN_IE6_S1_GELOESCHT = [{ method: "POST", path: "/v1/chat/completions" }];

test("IE6-S1-10: der in IE6-S1 geloeschte Shim-Endpunkt steht nicht mehr in der Politik und ist Negativkontrolle der Probe", () => {
  for (const { method, path } of IN_IE6_S1_GELOESCHT) {
    const schluessel = routeKey(method, path);
    assert.equal(
      PUBLIC_KEYS.has(schluessel),
      false,
      `${schluessel}: steht noch in PUBLIC_ROUTES - in IE6-S1 geloescht, aber die Politik nicht nachgezogen`,
    );
    const zeile = TABELLEN_SCHLUESSEL.get(schluessel);
    assert.ok(zeile, `${schluessel}: fehlt in der Probe-Tabelle - keine Negativkontrolle mehr`);
    assert.equal(zeile.art, ART.FEHLT, `${schluessel}: ART muss 'fehlt' sein`);
    assert.equal(zeile.status, "404", `${schluessel}: erwarteter Status ist 404`);
    assert.equal(zeile.antwortet, ANTWORTET.KEINE, `${schluessel}: ANTWORTET muss 'keine' sein`);
  }
});
