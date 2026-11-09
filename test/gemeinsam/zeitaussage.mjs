import assert from "node:assert/strict";

export function assertMindestdauer(gemessenMs, untergrenzeMs, was) {
  assert.ok(Number.isFinite(gemessenMs), `${was}: Messwert fehlt (${gemessenMs})`);
  assert.ok(gemessenMs >= untergrenzeMs, `${was} (${gemessenMs} ms liegt unter der Untergrenze ${untergrenzeMs} ms)`);
}
