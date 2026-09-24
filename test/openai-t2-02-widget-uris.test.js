// T2-02 (T-34): cache-feste, sprachunabhaengige Resource-URIs. Pin-Test fuer
// src/ui/widget-versions.json (S7 der Spec):
//   (a) SHA-256(widgetHtml(id)) == Pin der hoechsten Version je Widget, mit
//       Positiv-Kontrolle (ein veraendertes Byte MUSS genau einen Fund ergeben -
//       sonst prueft der Test nichts, Lehre pruefkommando-ohne-positiv-kontrolle).
//   (b) keine zwei Versionen desselben Widgets teilen einen Hash.
//   (c) jedes Widget hat einen Pin, kein Pin ohne Widget.
//   (d) Groessenbudget: das Widget-HTML darf gegenueber der a941d23-Baseline
//       (vor T2-02) hoechstens um einen benannten Faktor wachsen.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALL,
  hasWidget,
  widgetHtml,
  widgetVersion,
} from "../src/ui/widget-catalog.js";

const ALL_WIDGET_IDS = [WIDGET_AGENT_STATUS, WIDGET_MY_NUMBER, WIDGET_CALLS, WIDGET_CALL];

const PINS_PATH = fileURLToPath(new URL("../src/ui/widget-versions.json", import.meta.url));

function loadPins() {
  return JSON.parse(readFileSync(PINS_PATH, "utf8"));
}

function sha256Of(html) {
  return crypto.createHash("sha256").update(html, "utf8").digest("hex");
}

// Reine Pruefloglogik (S7 (a)/(b)): welche Widget-Ids tragen einen veralteten Pin -
// der SHA-256 des AUSGELIEFERTEN HTML weicht vom Pin der hoechsten Version ab?
// htmlById: { widgetId -> html }. pins: das geparste widget-versions.json (inkl.
// "_comment", wird uebersprungen). Kein Netz-/Datei-Zugriff hier (F.I.R.S.T. - die
// Positiv-Kontrolle mutiert nur htmlById, nie die Pin-Datei).
export function stalePins(htmlById, pins) {
  const stale = [];
  for (const [widgetId, html] of Object.entries(htmlById)) {
    const versions = pins[widgetId];
    if (!versions || typeof versions !== "object") {
      stale.push(widgetId);
      continue;
    }
    const highest = Math.max(...Object.keys(versions).map(Number));
    if (sha256Of(html) !== versions[String(highest)]) stale.push(widgetId);
  }
  return stale;
}

test("S7(a) Pin-Test: SHA-256(widgetHtml(id)) == Pin der hoechsten Version - HTML-Aenderung verlangt eine neue Version", () => {
  const pins = loadPins();
  const htmlById = Object.fromEntries(ALL_WIDGET_IDS.map((id) => [id, widgetHtml(id)]));

  assert.deepEqual(
    stalePins(htmlById, pins),
    [],
    "veralteter Pin gefunden - Regel: neue Version anhaengen (naechste ganze Zahl), " +
      "alten Eintrag NIE ueberschreiben (s. widget-versions.json _comment)",
  );
});

test("S7(a) Positiv-Kontrolle: ein veraendertes Byte im HTML ergibt GENAU einen Fund", () => {
  const pins = loadPins();
  const htmlById = Object.fromEntries(ALL_WIDGET_IDS.map((id) => [id, widgetHtml(id)]));

  // Build: erst die unveraenderte Menge (muss leer sein, sonst ist die
  // Kontrolle selbst nicht aussagekraeftig).
  assert.deepEqual(stalePins(htmlById, pins), [], "Ausgangslage muss sauber sein");

  // Operate: ein Byte in GENAU einem Widget-HTML aendern.
  const mutated = { ...htmlById, [WIDGET_MY_NUMBER]: `${htmlById[WIDGET_MY_NUMBER]} ` };

  // Check: GENAU dieses eine Widget faellt auf, kein anderes.
  assert.deepEqual(stalePins(mutated, pins), [WIDGET_MY_NUMBER]);
});

// S7(a)-Ledger (Review-Befund): der Test oben prueft nur "Hash der HOECHSTEN Version
// passt zum ausgelieferten HTML" - wer den BESTEHENDEN v1-Eintrag in-place ueberschreibt
// (statt v2 anzuhaengen), besteht ihn trotzdem, waehrend die URI (ui://hermes/<id>/
// v1.html) unveraendert bleibt und ChatGPT bis zu 1 h das ALTE HTML aus dem Cache
// bedient - genau der Fall, den T-34 verhindern soll. KNOWN_PINS friert deshalb die
// HEUTE bekannten (Widget, Version, Hash)-Paare hart ein: APPEND-ONLY, nie aendern oder
// loeschen - eine spaetere Phase ergaenzt hier NUR einen neuen Eintrag, wenn sie
// bewusst eine neue Version anhaengt. Ein ueberschriebener Hash wird dadurch unabhaengig
// davon rot, welche Version pins[widgetId] gerade als hoechste fuehrt.
const KNOWN_PINS = {
  [WIDGET_AGENT_STATUS]: {
    "1": "8304aed2dd3dd12c73ae8319eb0f8ba742d70c265e9b45a1eed956a048736f5c",
    "2": "32fed2e0273a1afeae313926acc13dc4d1eab53e919d57d7e4bc9c7fbbb687ee",
    // T2-12-Review-Nachtrag (Kommentar-Fix wing-canvas-mount-idle.js, roh eingebettet).
    "3": "e7ea14f82f9efee46548f3f6db89042045c5558995f129c8ddcd7b4c7d7fdf48",
  },
  [WIDGET_MY_NUMBER]: {
    "1": "caaebb738f0b60c5f5fabe5bdb8b4b04e1e563c04a8c08324c78e127fbde31c7",
    // T2-11 (Umbenennung get_my_number -> get_agent_number).
    "2": "877d0e0a5b585ea4825be97a8fb52711c948bb86fecf65c52354dbc63ee9af3e",
    "3": "16ed6203a37e8239145bab68cb13d44732c79a6bb8033839fca72f4c76790528",
    // T2-12-Review-Nachtrag (Kommentar-Fix wing-canvas-mount-idle.js, roh eingebettet).
    "4": "8632be41d7a08f6cc37bba79d368f0a964119a81bcd66136880c01e6d5c9f36a",
  },
  [WIDGET_CALLS]: {
    "1": "f65f989627c621bef2c9813d7198383fb6faa744af7cd396d31f97889bdf6555",
    "2": "33b00db2fbcb0bd4eea89cc6a564291154487ed4ee38395aa39683602914fcd9",
    // T2-12-Review-Nachtrag (Kommentar-Fix wing-canvas-mount-idle.js, roh eingebettet).
    "3": "8ebd105b6122a6f4b0ab6e7de0ea1e8ff230a4300c83f9e63d43b861604c97d9",
  },
  [WIDGET_CALL]: {
    "1": "d4cc20704fe287449dd3d445f937ec1fb7f6f4480624f3740866764b478c4f81",
    // T2-11 (Umbenennung get_transcript -> get_call_result).
    "2": "c2ef262dbabc0e64100045331ad7a4beff93d004b2368381f9f834a471586936",
    "3": "64bf5d21c4b039f07e236052f437ff2d7be6b719a0c5ad059684312700f58e86",
  },
};

test("S7(a)-Ledger: bekannte (Widget, Version, Hash)-Paare bleiben unveraendert - kein Ueberschreiben statt Anhaengen", () => {
  const pins = loadPins();
  for (const [widgetId, versions] of Object.entries(KNOWN_PINS)) {
    for (const [version, hash] of Object.entries(versions)) {
      assert.equal(
        pins[widgetId]?.[version],
        hash,
        `${widgetId} v${version}: eingefrorener Hash hat sich geaendert - eine neue Version anhaengen, ` +
          "NIE einen bestehenden Eintrag ueberschreiben (sonst zeigt eine gecachte URI stillschweigend anderen Inhalt)",
      );
    }
  }
});

test("S7(b) keine zwei Versionen desselben Widgets teilen einen Hash", () => {
  const pins = loadPins();
  for (const widgetId of ALL_WIDGET_IDS) {
    const versions = pins[widgetId];
    const hashes = Object.values(versions);
    assert.equal(
      new Set(hashes).size,
      hashes.length,
      `${widgetId}: zwei Versionen mit demselben Hash - eine neue Version muss inhaltlich neu sein`,
    );
  }
});

test("S7(c) jedes Widget hat einen Pin, kein Pin ohne Widget", () => {
  const pins = loadPins();
  const pinnedIds = Object.keys(pins).filter((key) => !key.startsWith("_"));

  for (const widgetId of ALL_WIDGET_IDS) {
    assert.ok(hasWidget(widgetId), `${widgetId}: kein Pin - hasWidget() muesste fail-closed auf Stufe-0-only fallen`);
    assert.ok(Object.prototype.hasOwnProperty.call(pins, widgetId), `${widgetId}: kein Eintrag in widget-versions.json`);
  }
  assert.deepEqual(
    [...pinnedIds].sort(),
    [...ALL_WIDGET_IDS].sort(),
    "widget-versions.json traegt einen Pin fuer ein Widget, das der Katalog nicht kennt (oder umgekehrt)",
  );
});

test("S1 hasWidget() faellt fail-closed auf Stufe-0-only, wenn ein Pin fehlt", () => {
  assert.equal(hasWidget("kein-solches-widget"), false);
  assert.equal(widgetVersion("kein-solches-widget"), null);
});

// S7 (d): Groessenbudget. Baselines gemessen an a941d23 (letzter Commit VOR T2-02),
// groesste (und einzige) Fassung je Widget in Byte - benannte Konstanten statt
// verstreuter Magic Numbers (G25). BUDGET_FACTOR als benannte Konstante: Erwartung
// laut Spec-Pre-Mortem 7 ist ca. +1-3% (das eingebettete I18N_SCRIPT traegt jetzt
// ALLE Sprachtabellen statt nur einer) - 1.10 laesst Luft, ohne einen echten
// Aufblaeh-Regressionsfehler zu verdecken.
const BASELINE_BYTES_A941D23 = {
  [WIDGET_AGENT_STATUS]: 214943,
  [WIDGET_MY_NUMBER]: 213294,
  [WIDGET_CALLS]: 214450,
  [WIDGET_CALL]: 247763,
};
const BUDGET_FACTOR = 1.1;

test("S7(d) Groessenbudget: hoechstens +10% gegenueber der a941d23-Baseline (Bestandsgrenze 260KB fuer call.html bleibt gueltig)", () => {
  for (const widgetId of ALL_WIDGET_IDS) {
    const size = Buffer.byteLength(widgetHtml(widgetId), "utf8");
    const budget = BASELINE_BYTES_A941D23[widgetId] * BUDGET_FACTOR;
    assert.ok(
      size <= budget,
      `${widgetId}: ${size} Byte ueberschreitet das Budget ${budget} Byte (Baseline ${BASELINE_BYTES_A941D23[widgetId]} * ${BUDGET_FACTOR})`,
    );
  }
});
