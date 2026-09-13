// Report-Schicht (Spec §5-iii): JSON-Report pro (Szenario,Repeat) + Aggregat +
// kompakte stdout-Tabellen (Run-Summary + A/B-Vergleich). Reines IO/Formatting, keine
// Fachlogik (die liegt in runner.mjs/checks.mjs/judge.mjs).
import fs from "fs";
import path from "path";

// Schreibt EINEN (Szenario,Repeat)-Report als JSON nach data/convo-bench/<run-id>/
// (data/ ist gitignored). Dateiname wie in der Spec: <scenario>-r<n>.json.
export function writeReport(outDir, result) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${result.meta.scenario}-r${result.meta.repeat_index}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  return file;
}

// Aggregat ueber alle (Szenario,Repeat)-Ergebnisse EINES Laufs.
export function writeSummary(outDir, results) {
  const summary = results.map((r) => ({
    scenario: r.meta.scenario,
    repeat_index: r.meta.repeat_index,
    driver: r.meta.driver,
    direction: r.meta.direction,
    ended_via: r.ended_via,
    turn_count: r.turn_count,
    checks_passed: r.checks.filter((c) => c.pass).length,
    checks_total: r.checks.length,
    judge_overall_flag: r.judge?.overall_flag ?? null,
    cost_usd: r.cost_estimate_usd?.total_usd ?? null,
  }));
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

// IP2/BEW-1: driver+direction direkt an der Zeile mit der Bench-Zahl (checks=X/Y) -
// die Tabelle wird oft isoliert kopiert/gelesen, ohne die Lauf-Kopfzeile daneben.
function fmtRow(r) {
  const passed = r.checks.filter((c) => c.pass).length;
  const scenario = r.meta.scenario.padEnd(20);
  const endedVia = r.ended_via.padEnd(16);
  return `${scenario} r${r.meta.repeat_index}  driver=${r.meta.driver} direction=${r.meta.direction}  turns=${String(r.turn_count).padEnd(3)} ended_via=${endedVia} checks=${passed}/${r.checks.length}  judge=${r.judge?.overall_flag ?? "n/a"}`;
}

export function printSummaryTable(results) {
  console.log("\n[convo-bench] Zusammenfassung:");
  for (const r of results) console.log("  " + fmtRow(r));
  const totalUsd = results.reduce((sum, r) => sum + (r.cost_estimate_usd?.total_usd || 0), 0);
  console.log(`  geschaetzte Gesamtkosten: $${totalUsd.toFixed(4)}`);
}

// Liest alle Report-Dateien EINES run-id-Verzeichnisses (fuer `compare`), ohne
// summary.json (kein Report-Objekt, anderes Schema).
export function readReportDir(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "summary.json")
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

function reportKey(r) {
  return `${r.meta.scenario}-r${r.meta.repeat_index}`;
}

// AL-P8: Check-Werte EINES Reports als id -> value-Map (nur Checks mit gesetztem
// value-Feld, additiver Vertrag s. checks.mjs).
function checkValues(report) {
  const values = new Map();
  for (const c of report?.checks ?? []) {
    if (c.value !== undefined) values.set(c.id, c.value);
  }
  return values;
}

// A/B-Diff-Tabelle (Spec §2 `compare`-Subcommand): baseline (A) im Master-Stand,
// candidate (B) im Arbeits-Worktree, IDENTISCHE Szenarien+scriptedTurns+repeat.
export function printCompareTable(reportsA, reportsB) {
  const a = new Map(reportsA.map((r) => [reportKey(r), r]));
  const b = new Map(reportsB.map((r) => [reportKey(r), r]));
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();

  // AL-P8 (Pre-Mortem): unterschiedliche Treiber sind KEINE vergleichbare Messung -
  // eine Messung gilt nur fuer die Konfiguration, in der sie erhoben wurde.
  const driverA = reportsA[0]?.meta.driver;
  const driverB = reportsB[0]?.meta.driver;
  if (driverA && driverB && driverA !== driverB) {
    console.log(
      `[convo-bench] WARNUNG: A(driver=${driverA}) und B(driver=${driverB}) sind NICHT vergleichbar ` +
        `— eine Messung gilt nur fuer die Konfiguration, in der sie erhoben wurde.`,
    );
  }

  console.log("\n[convo-bench] A/B-Vergleich:");
  for (const key of keys) {
    const ra = a.get(key);
    const rb = b.get(key);
    const passedA = ra ? `${ra.checks.filter((c) => c.pass).length}/${ra.checks.length}` : "-";
    const passedB = rb ? `${rb.checks.filter((c) => c.pass).length}/${rb.checks.length}` : "-";
    console.log(
      `  ${key.padEnd(24)} A: checks=${passedA.padEnd(5)} turns=${ra?.turn_count ?? "-"}` +
        `  |  B: checks=${passedB.padEnd(5)} turns=${rb?.turn_count ?? "-"}`,
    );
    const valuesA = checkValues(ra);
    const valuesB = checkValues(rb);
    for (const id of new Set([...valuesA.keys(), ...valuesB.keys()])) {
      const vA = valuesA.has(id) ? valuesA.get(id) : "-";
      const vB = valuesB.has(id) ? valuesB.get(id) : "-";
      console.log(`      ${id}: ${vA} -> ${vB}`);
    }
  }
}
