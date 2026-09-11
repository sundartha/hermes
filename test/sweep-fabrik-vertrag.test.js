// ZUSATZAUFTRAG A (E3b-Concern, E4 zugewiesen): die Rueckgabe-Form der Sweep-Fabriken
// (makeOutageWatch/makeDriftWatch) wird von KEINEM Bestandstest gegen die Methoden
// geprueft, die runSweepTick TATSAECHLICH ruft. Faellt ein Zweig aus einer Fabrik, bleibt
// die Suite gruen, waehrend der Tick in Produktion bei JEDEM Lauf SYNCHRON wirft (der
// Wurf liegt VOR dem Promise, das .catch() faengt ihn nicht) - test/kv-m4-monthly-
// cross-check.test.js#KV-M4-8 faengt das NICHT, weil dieser Test eine EIGENE Attrappe
// baut, nie die echte Fabrik.
//
// Die SOLL-Liste wird NICHT getippt, sondern aus dem Quelltext von runSweepTick GELESEN
// (Regex auf outageWatch.<name>()/driftWatch.<name>()) - eine getippte zweite Liste
// koennte von der Verdrahtung abdriften, ohne dass ein Test es merkt (G5).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeOutageWatch } from "../src/telephony/outage-report.js";
import { makeDriftWatch } from "../src/telephony/outbound-drift-watch.js";
import { makePaidWithoutNumberWatch } from "../src/billing/paid-without-number-watch.js";
import { runSweepTick } from "../src/boot.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOT_SRC = fs.readFileSync(path.join(REPO_ROOT, "src", "boot.js"), "utf8");

// Aus dem Quelltext GELESEN, nicht getippt (s. Modul-Doc).
function gerufeneMethoden(objektName) {
  const re = new RegExp(`${objektName}\\s*\\.(\\w+)\\(`, "g");
  const namen = [...BOOT_SRC.matchAll(re)].map((treffer) => treffer[1]);
  assert.ok(namen.length > 0, `keine Methodenaufrufe fuer ${objektName} in boot.js gefunden - Regex oder Datei veraltet?`);
  return [...new Set(namen)];
}

// A-3 (Gegenprobe im Test selbst, Blocker-Liste 2): belegt, dass DIESE Pruefung
// ueberhaupt etwas prueft - ein Objekt ohne die erwartete Methode MUSS sie zum Scheitern
// bringen.
function pruefeVertrag(objekt, erwarteteMethoden, objektName) {
  for (const name of erwarteteMethoden) {
    assert.equal(
      typeof objekt[name],
      "function",
      `${objektName}.${name} fehlt oder ist keine Funktion - runSweepTick ruft sie aber auf`,
    );
  }
}

function fakeDeps() {
  return {
    store: {
      load: () => ({ outageAlerts: [], calls: [], platformNumberUse: [] }),
      save: () => {},
      withStoreLock: (fn) => fn(),
    },
    config: withConfigNamespaces({
      outageAlertWindowMs: 0,
      outageAlertSelfTestIntervalMs: 0,
      platformHoldEscalationMaxAgeMs: 0,
      outboundDriftMinIntervalMs: 0,
    }),
    audit: () => {},
    messaging: () => ({}),
    mailer: { sendMail: async () => {} },
  };
}

test("Z-A1: jede von runSweepTick auf outageWatch gerufene Methode existiert auf makeOutageWatch(...) und ist eine Funktion", () => {
  const methoden = gerufeneMethoden("outageWatch");
  const outageWatch = makeOutageWatch(fakeDeps());
  pruefeVertrag(outageWatch, methoden, "outageWatch");
});

test("Z-A2: jede von runSweepTick auf driftWatch gerufene Methode existiert auf makeDriftWatch(...) und ist eine Funktion", () => {
  const methoden = gerufeneMethoden("driftWatch");
  const driftWatch = makeDriftWatch({ ...fakeDeps(), telnyxRead: {}, elRead: {} });
  pruefeVertrag(driftWatch, methoden, "driftWatch");
});

test("Z-A3: Gegenprobe - ein Objekt, dem eine Methode fehlt, laesst pruefeVertrag scheitern (belegt, dass die Pruefung wirklich etwas prueft)", () => {
  const methoden = gerufeneMethoden("outageWatch");
  const unvollstaendig = { ...makeOutageWatch(fakeDeps()) };
  delete unvollstaendig[methoden[0]];
  assert.throws(() => pruefeVertrag(unvollstaendig, methoden, "outageWatch"));
});

test("Z-A4: runSweepTick mit einer Fabrik-Rueckgabe, der eine Methode fehlt, WIRFT SYNCHRON (der Produktionsschaden, ausgefuehrt statt behauptet)", () => {
  const vollstaendigesOutageWatch = makeOutageWatch(fakeDeps());
  const unvollstaendigesOutageWatch = { ...vollstaendigesOutageWatch };
  delete unvollstaendigesOutageWatch.runHoldEscalationSweep;
  const vollstaendigesDriftWatch = makeDriftWatch({ ...fakeDeps(), telnyxRead: {}, elRead: {} });
  assert.throws(
    () =>
      runSweepTick({
        costTruing: { runCostTruingSweep: async () => ({}) },
        provisioning: { settleDueNumberMonthMeters: async () => ({}) },
        costCrossCheck: { runMonthlyCrossCheck: async () => ({}) },
        outageWatch: unvollstaendigesOutageWatch,
        driftWatch: vollstaendigesDriftWatch,
      }),
    /runHoldEscalationSweep is not a function/,
    "ein fehlender Zweig muss runSweepTick SYNCHRON zum Werfen bringen - genau der Produktionsschaden, den GP-1 belegt",
  );
});

test("Z-A5: jede von runSweepTick auf paidWithoutNumberWatch gerufene Methode existiert auf makePaidWithoutNumberWatch(...) und ist eine Funktion", () => {
  const methoden = gerufeneMethoden("paidWithoutNumberWatch");
  const watch = makePaidWithoutNumberWatch({
    store: fakeDeps().store,
    config: withConfigNamespaces({ paidWithoutNumberGraceMs: 0 }),
    audit: () => {},
  });
  pruefeVertrag(watch, methoden, "paidWithoutNumberWatch");
});
