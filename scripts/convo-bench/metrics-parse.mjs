// Parst `[metrics] <kind> <json>`-Zeilen aus dem Server-stdout (src/metrics.js,
// LOG_PREFIX="[metrics]") in eine strukturierte Liste. Reine Funktion, kein IO - der
// Aufrufer uebergibt srv.stdout (Kindprozess-stdout aus test/helpers.js:startServer).
const METRICS_LINE_RE = /^\[metrics\] (\w+) (\{.*\})$/;

export function parseMetricsLog(stdout) {
  const out = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(METRICS_LINE_RE);
    if (!m) continue;
    try {
      out.push({ kind: m[1], payload: JSON.parse(m[2]) });
    } catch {
      // Kaputte/abgeschnittene Zeile (sollte praktisch nie vorkommen) -> ueberspringen
      // statt die gesamte Bench abstuerzen zu lassen (Metrics sind informativ).
    }
  }
  return out;
}
