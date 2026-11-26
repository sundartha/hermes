import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ROOT } from "../helpers.js";

const REGELDATEI = "docs/betrieb/grafana/betriebsregeln.json";
const ALARME = "docs/betrieb/alarme";
const KOPIERT = [REGELDATEI, "docs/betrieb/grafana/alarmregeln.json", ALARME, "src/utils"];

function kopiere() {
  assert.ok(fs.existsSync(path.join(ROOT, REGELDATEI)), "betriebsregeln.json fehlt");
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "betriebsregeln-"));
  for (const pfad of KOPIERT) {
    fs.cpSync(path.join(ROOT, pfad), path.join(wurzel, pfad), { recursive: true });
  }
  return wurzel;
}

function pruefe(wurzel, ...argumente) {
  const aufruf = [path.join(ROOT, "scripts", "betrieb-pruefen.mjs"), "--wurzel", wurzel];
  const lauf = spawnSync(process.execPath, [...aufruf, ...argumente], { encoding: "utf8" });
  return [lauf.status, lauf.stderr.trim()];
}

function mitDatei(datei, aendere) {
  const wurzel = kopiere();
  const ziel = path.join(wurzel, datei);
  fs.writeFileSync(ziel, aendere(fs.readFileSync(ziel, "utf8")));
  return pruefe(wurzel);
}

function mitRegel(uid, alt, neu) {
  const ersetzt = (regel) => JSON.parse(JSON.stringify(regel).replace(alt, neu));
  return mitDatei(REGELDATEI, (text) =>
    JSON.stringify(JSON.parse(text).map((regel) => (regel.uid === uid ? ersetzt(regel) : regel))),
  );
}

const ABWEICHUNGEN = [
  [/"params":\[/, '"params":[7'],
  [/"type":"[gl]t"/, '"type":"within_range"'],
  [/"for":"\d+m"/, '"for":"1h"'],
  [/"noDataState":"\w+"/, '"noDataState":"NoData"'],
  [/"soll":\{[^}]*\},/, ""],
  [/"dauer":"\d+m",(.*),"for":"\d+m"/, "$1"],
];

function pruefeRegel(uid, ...kennzahlen) {
  for (const [alt, neu] of ABWEICHUNGEN) {
    const befund = `${uid}: Schwelle, Dauer oder noDataState weicht von soll ab`;
    assert.deepEqual(mitRegel(uid, alt, neu), [1, befund], String(alt));
  }
  for (const name of kennzahlen) {
    for (const fremd of [`${name}x`, name.replace("hermes_", "hermez_")]) {
      const befund = `${uid}: Kennzahl ${fremd} gibt es nicht`;
      assert.deepEqual(mitRegel(uid, name, fremd), [1, befund]);
    }
  }
  const leer = mitRegel(uid, /"expr":"[^"]*"/, '"expr":"vector(0)"');
  assert.deepEqual(leer, [1, `${uid}: expr nennt keine Kennzahl`]);
  const seite = `${ALARME}/${uid}.md`;
  for (const titel of ["Symptom", "Prüfen", "Beheben", "Eskalieren"]) {
    const lauf = mitDatei(seite, (text) => text.replace(`## ${titel}\n`, "## Weiter\n"));
    assert.deepEqual(lauf, [1, `${uid}: Abschnitt "## ${titel}" fehlt in ${seite}`]);
  }
  const wurzel = kopiere();
  fs.rmSync(path.join(wurzel, seite));
  assert.deepEqual(pruefe(wurzel), [1, `${uid}: Seite ${seite} fehlt`]);
}

test("die Betriebsregeln sind grün, auch mit Panel-Prüfung", () => {
  assert.deepEqual(pruefe(kopiere()), [0, ""]);
  assert.deepEqual(pruefe(ROOT, "--panels"), [0, ""]);
});

test("heartbeat-fehlt: Abweichung an Regel oder Seite ist rot", () => {
  pruefeRegel("heartbeat-fehlt", "hermes_eventloop_delay_p99");
});

test("warteschlange-alter: Abweichung an Regel oder Seite ist rot", () => {
  pruefeRegel("warteschlange-alter", "hermes_queue_oldest_age");
});

test("kapazitaet-leitungen: Abweichung an Regel oder Seite ist rot", () => {
  pruefeRegel("kapazitaet-leitungen", "hermes_lines_occupied", "hermes_lines_capacity");
});

test("datenbank-speichern-fehlt: Abweichung an Regel oder Seite ist rot", () => {
  pruefeRegel("datenbank-speichern-fehlt", "hermes_store_save_failed_total");
});

test("eine Kennzahl, die die Quellen nicht mehr liefern, macht ihre Regel rot", () => {
  const lauf = mitDatei("src/utils/betriebsmessung.js", (text) =>
    text.replace('"hermes.queue.oldest_age"', '"hermes.queue.anders"'),
  );
  const befund = "warteschlange-alter: Kennzahl hermes_queue_oldest_age gibt es nicht";
  assert.deepEqual(lauf, [1, befund]);
});
