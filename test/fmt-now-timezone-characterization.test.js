// FMT-01 (tasks/i18n-tests/10-zeit-format-daten.md).
//
// CHARAKTERISIERUNG (Regel 5 des Workflow-Auftrags): dieser Test pinnt den HEUTIGEN
// Mechanismus GRUEN als Regressionsschutz - er behauptet NICHT den Sollzustand. Der
// Sollzustand (ein Tenant-/Anrufer-Zeitzonen-Feld im Datenmodell) traegt Cluster D18a der
// kanonischen Liste (tasks/i18n-tests/00-kanonische-liste.md) als roten SOLL-Test **FMT-28**
// (Owner-Entscheidung 7.6, "entblockt" - ausserhalb dieses Blocks/dieser Welle). Ein
// zweiter, hier zusaetzlich gruen gepinnter Ist-Zustand waere sonst genau die Ist-Pin-Falle
// aus Regel 5: ein spaeterer FMT-28-Fix wuerde diesen Test faelschlich als Regression zeigen
// - deshalb hier ausdruecklich nur der MECHANISMUS (kein timeZone-Key), nicht der Wunschwert.
//
// Reiner Quelltext-Vertrag (kein Server/Store/config-Import noetig): der `now`-Baustein
// in src/claude.js:promptInputs() berechnet das Datum ueber Date.prototype.toLocaleString
// OHNE eine timeZone-Option - das Ergebnis haengt an der Server-Prozess-Zeitzone
// (Intl.DateTimeFormat().resolvedOptions().timeZone), nicht an Tenant/Anrufer.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const claudeSrc = fs.readFileSync(path.join(ROOT, "src/claude.js"), "utf8");

test("Charakterisierung FMT-01: now-Options-Block in claude.js traegt keine timeZone-Option (Server-TZ, kein Tenant-/Anrufer-Bezug)", () => {
  const marker = "now: new Date().toLocaleString(loc.dateLocale, {";
  const blockStart = claudeSrc.indexOf(marker);
  assert.notEqual(blockStart, -1, "now-Options-Block nicht gefunden - wurde claude.js umgebaut?");
  const blockEnd = claudeSrc.indexOf("}),", blockStart);
  assert.notEqual(blockEnd, -1, "Ende des now-Options-Blocks nicht gefunden");
  const block = claudeSrc.slice(blockStart, blockEnd);
  assert.ok(
    !block.includes("timeZone"),
    `now-Options-Block enthaelt bereits eine timeZone-Option - FMT-28 nachziehen (Sollzustand-Test), ` +
      `dieser Charakterisierungstest ist dann obsolet: ${block}`,
  );
});

