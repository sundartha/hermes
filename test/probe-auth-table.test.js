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

// AUTH-P4-8 (Befund B3 aus dem Umsetzungsplan): die Bestandsregeln oben halten (1)
// route-policy.js und (3) probe-auth.sh nur in EINER Richtung zusammen - wird die
// Probe auf 'fehlt' gedreht, aber GATE_ONLY_ROUTES vergessen, feuert die Regel
// "ANTWORTET='gate', aber ART!='sitzung'/'fehlt'" und der Lauf wird rot. Die
// haeufigere Gegenrichtung (Route geloescht, Politik nachgezogen, aber das Shell-
// Skript vergessen) faellt durch beide Bestandsregeln, weil GATE_ONLY_ROUTES dann
// schon leer ist und 'inGateOnly' fuer keine der sechs Zeilen mehr greift. Dieser
// Test schliesst genau diese Luecke: er verlangt explizit, dass die sechs
// geloeschten Routen NICHT mehr in der Politik stehen UND als Negativkontrolle
// (art=fehlt, status=401, antwortet=gate) in der Probe-Tabelle auftauchen.
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
    assert.equal(zeile.status, "401", `${schluessel}: erwarteter Status muss 401 sein (Gate maskiert, ab P7 404)`);
    assert.equal(zeile.antwortet, ANTWORTET.GATE, `${schluessel}: ANTWORTET muss 'gate' sein`);
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
// ("die Liste muss leer sein") waere eine Behauptung statt einer Messung. H10 (Plan
// Abschnitt 6): die Probe-Tabelle bleibt fuer diese sieben Zeilen UNVERAENDERT (ART
// sitzung, STATUS 401, ANTWORTET gate) - das Basic-Auth-Gate antwortet einer Anfrage
// ohne Sitzung und ohne Credentials VOR internalOnly, der 403 wird erst mit P7
// sichtbar und ist hier ausschliesslich in test/auth-p5-internal-only.test.js gepinnt.
test("AUTH-P5-7: die sieben in P5 abgesicherten Routen stehen nicht mehr in der Politik, die Probe-Zeile bleibt unveraendert (H10)", () => {
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
      "401",
      `${schluessel}: erwarteter Status bleibt 401 - das Gate antwortet VOR internalOnly (H10, kein Defekt)`,
    );
    assert.equal(zeile.antwortet, ANTWORTET.GATE, `${schluessel}: ANTWORTET muss 'gate' bleiben`);
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
// erzwungen (Muster AUTH-P5-7). H10: die Probe-Tabelle bleibt fuer diese sechs Zeilen
// UNVERAENDERT (ART sitzung, STATUS 401, ANTWORTET gate) - der Mount bleibt HINTER dem
// Basic-Auth-Gate (Plan Abschnitt 3), das Gate antwortet einer Anfrage ohne Sitzung und
// ohne Credentials weiterhin VOR webAuthMw/adminMw; der 401 OHNE Basic-Challenge wird
// erst mit P7 sichtbar (dort gepinnt). Zusaetzlich wird GENAU der Zwischenstand
// gemessen, den P7 vorfindet: nur noch das Legacy-Checkout-Paar in GATE_ONLY_ROUTES.
test("AUTH-P6-9: die sechs in P6 abgesicherten Betreiber-Routen stehen nicht mehr in der Politik, die Probe-Zeile bleibt unveraendert (H10)", () => {
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
      `${schluessel}: erwarteter Status bleibt 401 - das Gate antwortet VOR webAuthMw/adminMw (H10, kein Defekt)`,
    );
    assert.equal(zeile.antwortet, ANTWORTET.GATE, `${schluessel}: ANTWORTET muss 'gate' bleiben`);
  }
});

test("AUTH-P6-9: GATE_ONLY_ROUTES enthaelt nach dieser Phase nur noch das Legacy-Checkout-Paar", () => {
  assert.deepEqual(
    GATE_ONLY_ROUTES.map((r) => routeKey(r.method, r.path)),
    ["POST /api/billing/setup-checkout", "GET /api/billing/checkout-return"],
    "Der Zwischenstand fuer P7 muss GENAU aus dem Legacy-Checkout-Paar bestehen (P9 leert es).",
  );
});
