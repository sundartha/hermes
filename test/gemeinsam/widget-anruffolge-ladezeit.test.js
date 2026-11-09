import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 300000 };
const TEMPO_KURZ_DURCHLAEUFE = 3;

const laden = () => import("./widget-anruffolge-ladezeit.mjs");

test("Statistik nennt Anzahl, Median, Minimum und Maximum, bei gerader Anzahl den Mittelwert der Mitte", async () => {
  const { statistik } = await laden();
  assert.deepEqual(statistik([30, 10, 20]), { n: 3, median_ms: 20, min_ms: 10, max_ms: 30 });
  assert.deepEqual(statistik([40, 10, 20, 30]), { n: 4, median_ms: 25, min_ms: 10, max_ms: 40 });
  assert.deepEqual(statistik([12.34]), { n: 1, median_ms: 12.3, min_ms: 12.3, max_ms: 12.3 });
});

test("Wiederholung misst standardmäßig 7 Durchläufe ungedrosselt, mit CPU 4x und mit CPU 6x", async () => {
  const { messeLadezeitWiederholt } = await laden();
  const aufrufe = [];
  const messe = async (_chrome, _html, { cpu }) => {
    aufrufe.push(cpu);
    return { fcp_ms: cpu * 10, initialize_ms: cpu, status_ms: cpu * 2, fluegel_ms: cpu * 3 };
  };
  const ergebnis = await messeLadezeitWiederholt("chrome", "<html>", { messe });
  assert.deepEqual(aufrufe, [...Array(7).fill(1), ...Array(7).fill(4), ...Array(7).fill(6)]);
  assert.deepEqual(Object.keys(ergebnis.bedingungen), ["ungedrosselt", "cpu_4x", "cpu_6x"]);
  const { bedingungen } = ergebnis;
  assert.deepEqual(bedingungen.cpu_4x.fcp_ms, { n: 7, median_ms: 40, min_ms: 40, max_ms: 40 });
  assert.deepEqual(bedingungen.cpu_6x.fluegel_ms, { n: 7, median_ms: 18, min_ms: 18, max_ms: 18 });
  assert.equal(bedingungen.ungedrosselt.laeufe.length, 7);
});

test("Ladezeitmessung der Anrufkarte nennt je Bedingung alle vier Zeiten mit Median zwischen Minimum und Maximum", OPTIONS, async () => {
  const { messeLadezeitWiederholt, LADEZEIT_FELDER } = await laden();
  const { call } = await ausgelieferteWidgets();
  const ergebnis = await messeLadezeitWiederholt(chrome, call, { durchlaeufe: TEMPO_KURZ_DURCHLAEUFE });
  assert.deepEqual(Object.keys(ergebnis.bedingungen), ["ungedrosselt", "cpu_4x", "cpu_6x"]);
  for (const [name, bedingung] of Object.entries(ergebnis.bedingungen)) {
    assert.equal(bedingung.laeufe.length, TEMPO_KURZ_DURCHLAEUFE, `${name}: Durchläufe`);
    for (const feld of LADEZEIT_FELDER) {
      const { n, median_ms: median, min_ms: min, max_ms: max } = bedingung[feld];
      assert.equal(n, TEMPO_KURZ_DURCHLAEUFE, `${name} ${feld}: n`);
      assert.ok(min > 0 && Number.isFinite(max), `${name} ${feld}: Werte fehlen`);
      assert.ok(min <= median && median <= max, `${name} ${feld}: Median ${median} nicht zwischen ${min} und ${max}`);
    }
    for (const lauf of bedingung.laeufe) assert.ok(lauf.initialize_ms < lauf.status_ms, `${name}: Statustext vor ui/initialize`);
  }
});
