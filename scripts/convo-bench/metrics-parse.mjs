const METRICS_LINE_RE = /^\[metrics\] (\w+) (\{.*\})$/;

export function parseMetricsLog(stdout) {
  const out = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(METRICS_LINE_RE);
    if (!m) continue;
    try {
      out.push({ kind: m[1], payload: JSON.parse(m[2]) });
    } catch {
    }
  }
  return out;
}
