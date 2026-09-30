import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GESTOPPT,
  ROTPROBEN_DIR,
  cases,
  fakeGitHub,
  isInstalled,
  manifests,
  runCase,
} from "../../tools/pruefungen-messen.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const MIN_CHECKS = 14;

async function verdicts(id, manifest) {
  const server = await fakeGitHub();
  try {
    const context = { root: REPO_ROOT, fake: `http://127.0.0.1:${server.address().port}` };
    const results = [];
    for (const [path, fall] of cases(REPO_ROOT, `${ROTPROBEN_DIR}/${id}`)) {
      results.push([path, await runCase(context, manifest.probe, fall)]);
    }
    return results;
  } finally {
    server.close();
  }
}

const checks = [...manifests(REPO_ROOT)];

test("jede Prüfung der Pflicht-Checks hat Rot-Proben", () => {
  assert.ok(checks.length >= MIN_CHECKS, `nur ${checks.length} Prüfungen mit Rot-Proben`);
  for (const [id] of checks) {
    assert.ok(cases(REPO_ROOT, `${ROTPROBEN_DIR}/${id}`).size > 0, `${id} hat keine Rot-Probe`);
  }
});

for (const [id, manifest] of checks.filter(
  ([, { benoetigt }]) => !benoetigt || isInstalled(benoetigt),
)) {
  test(`die heutige Prüfung „${manifest.titel}“ stoppt jede ihrer Rot-Proben`, async () => {
    const notStopped = (await verdicts(id, manifest)).filter(([, verdict]) => verdict !== GESTOPPT);
    assert.deepEqual(notStopped, []);
  });
}
