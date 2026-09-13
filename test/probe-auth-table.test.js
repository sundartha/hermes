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
// Antwortende Schicht. "gate" (die Sammelsicherung, die dieser Plan aufloest) ist seit
// AUTH-P7 aufgeloest und aus der Tabelle verschwunden - Ersatz ist "internal"
// (internalOnly).
const ANTWORTET = Object.freeze({
  INTERNAL: "internal",
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
    // Eine als oeffentlich begruendete Route antwortet SELBST. Antwortet dort
    // stattdessen eine Auth-Schicht, ist die Begruendung in PUBLIC_ROUTES falsch.
    if (inPublic && zeile.antwortet !== ANTWORTET.KEINE)
      widerspruch.push(`${zeile.schluessel}: PUBLIC_ROUTES, aber ANTWORTET='${zeile.antwortet}'`);
    if (zeile.antwortet === ANTWORTET.INTERNAL && zeile.art !== ART.SITZUNG)
      widerspruch.push(`${zeile.schluessel}: ANTWORTET='internal', aber ART='${zeile.art}'`);
    if (zeile.art === ART.SITZUNG && zeile.antwortet === ANTWORTET.KEINE)
      widerspruch.push(
        `${zeile.schluessel}: sitzungspflichtig, aber ANTWORTET='keine' - dann sichert nichts`,
      );
    // AUTH-P7: nichts maskiert einen fehlenden Pfad mehr - ein 'fehlt' MUSS mit 404
    // und ohne antwortende Schicht auftreten, sonst haengt dort noch eine Sammelsicherung.
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

// Die sechs in AUTH-P4 geloeschten Routen als EINE benannte Konstante (keine dritte
// Wahrheit - die Behauptung "diese sechs sind weg" gibt es sonst nirgends).
const IN_P4_GELOESCHT = [
  { method: "POST", path: "/api/settings" },
  { method: "POST", path: "/api/action-items/:id/toggle" },
  { method: "POST", path: "/api/calendar" },
  { method: "GET", path: "/api/profiles" },
  { method: "POST", path: "/api/profiles" },
  { method: "DELETE", path: "/api/profiles/:tenantId" },
];

// AUTH-P4-8 (Befund B3 aus dem Umsetzungsplan, seit AUTH-P7 eingeloest): die
// Bestandsregeln oben halten (1) route-policy.js und (3) probe-auth.sh zusammen -
// vergisst eine Aenderung GATE_ONLY_ROUTES oder die Probe-Tabelle, feuert eine der
// Widerspruchsregeln. Dieser Test schliesst die urspruengliche Luecke weiterhin: er
// verlangt explizit, dass die sechs geloeschten Routen NICHT mehr in der Politik
// stehen UND als Negativkontrolle (art=fehlt, status=404, antwortet=keine) in der
// Probe-Tabelle auftauchen - seit AUTH-P7 maskiert kein Gate diesen 404 mehr.
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

// Die sieben in AUTH-P5 mit internalOnly abgesicherten Routen als EINE benannte
// Konstante (keine dritte Wahrheit - die Behauptung "diese sieben sind jetzt AUTH"
// gibt es sonst nirgends).
const IN_P5_ABGESICHERT = [
  { method: "POST", path: "/api/calls" },
  { method: "POST", path: "/api/calls/:id/cancel" },
  { method: "GET", path: "/api/calls/:id/consult" },
  { method: "POST", path: "/api/calls/:id/consult/answer" },
  { method: "GET", path: "/api/state" },
  { method: "GET", path: "/api/calls/:id" },
  { method: "GET", path: "/api/tenant-data/export" },
];

// AUTH-P5-7: ohne diesen Test ist das Entfernen aus GATE_ONLY_ROUTES NICHT maschinell
// erzwungen - ein vergessener Restposten bliebe gruen, und P7s harte Vorbedingung
// ("die Liste muss leer sein") waere eine Behauptung statt einer Messung. Seit AUTH-P7
// (Gate-Wegfall) ist internalOnly die alleinige Sicherung dieser sieben Routen: die
// Probe-Zeile wechselt auf STATUS 403, ANTWORTET internal - der H10-Zwischenstand
// ("das Gate antwortet VOR internalOnly, 403 erst ab P7 sichtbar") ist eingeloest.
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

// Die sechs in AUTH-P6 mit webAuthMw+adminMw abgesicherten Betreiber-Routen als EINE
// benannte Konstante (keine dritte Wahrheit - die Behauptung "diese sechs sind jetzt
// AUTH" gibt es sonst nirgends).
const IN_P6_ABGESICHERT = [
  { method: "POST", path: "/api/billing/flush-meters" },
  { method: "POST", path: "/api/billing/cost-truing/sweep" },
  { method: "GET", path: "/api/billing/cost-drift" },
  { method: "GET", path: "/api/billing/platform-costs" },
  { method: "POST", path: "/api/onboard" },
  { method: "POST", path: "/api/onboard/retry" },
];

// AUTH-P6-9: ohne diesen Test ist das Entfernen aus GATE_ONLY_ROUTES NICHT maschinell
// erzwungen (Muster AUTH-P5-7). Der STATUS bleibt 401 (webAuthMw antwortet einer
// Anfrage ohne Sitzung genauso wie das frueher gefallene Gate) - das P7-Delta ist der
// Schichtwechsel (ANTWORTET gate -> webauth), NICHT der Status.
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

// AUTH-P7-6: die harte Vorbedingung von P7 ("GATE_ONLY_ROUTES muss leer sein, bevor das
// Gate faellt") ist jetzt eine Zusage fuer die Zeit NACH dem Gate-Wegfall - die Liste
// bleibt als MECHANISMUS stehen (src/route-policy.js), jeder neue Eintrag heisst, dass
// eine Route wieder allein an einer Sammelsicherung haengt, die es nicht mehr gibt.
test("AUTH-P7-6: GATE_ONLY_ROUTES ist leer - keine Route haengt mehr allein an einer Sammelsicherung", () => {
  assert.deepEqual(
    GATE_ONLY_ROUTES,
    [],
    "Das Legacy-Checkout-Paar traegt seit AUTH-P7 internalOnly und ist in die Klasse AUTH gewandert; " +
      "ein neuer Eintrag hier waere eine Route ohne eigene Sicherung.",
  );
});

// IE6-S1: der Telnyx-Assistant-Shim ist geloescht. Negativkontrolle wie AUTH-P4-8.
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
