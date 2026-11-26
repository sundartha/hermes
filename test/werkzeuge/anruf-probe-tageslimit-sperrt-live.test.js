import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

import { letzterStagingLauf } from "../../tools/deploy-weg/herkunft.mjs";
import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const REPO = "sundartha/hermes";
const NUMMER = "+4930555000199";
const ANRUFER = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const AM_LIMIT = [
  { erstversuche: 5, anrufe: 5 },
  { erstversuche: 1, anrufe: 9 },
];

async function probeAusfuehren(stand) {
  const ausgabeDatei = join(mkdtempSync(join(tmpdir(), "probe-limit-")), "output");
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "f".repeat(40),
    GITHUB_OUTPUT: ausgabeDatei,
    GITHUB_API_URL: "http://127.0.0.1:1",
    GITHUB_REPOSITORY: REPO,
    GITHUB_TOKEN: "t",
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    STAGING_PROBE_ZIEL: NUMMER,
    STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    BETTER_STACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: ANRUFER,
    PROBE_FALL: JSON.stringify({ eigeneNummer: NUMMER, stand, messungen: [null] }),
  };
  const lauf = await promisify(execFile)("node", ["scripts/anruf-probe/probe.mjs"], { env }).then(
    ({ stdout }) => ({ code: 0, stdout }),
    ({ code, stdout }) => ({ code, stdout }),
  );
  return { ...lauf, gewaehltGemerkt: existsSync(ausgabeDatei) };
}

function stagingLauf(conclusion, createdAt) {
  return {
    conclusion,
    created_at: createdAt,
    status: "completed",
    event: "push",
    head_branch: "master",
    head_repository: { full_name: REPO },
    repository: { full_name: REPO },
  };
}

async function sperrgruende(probeCode) {
  const laeufe = [
    stagingLauf("success", "2026-11-01T08:00:00Z"),
    stagingLauf(probeCode === 0 ? "success" : "failure", "2026-11-01T09:00:00Z"),
  ];
  const github = {
    repository: REPO,
    lesen: async () => ({ status: 200, daten: { workflow_runs: laeufe } }),
  };
  const gruende = await letzterStagingLauf({ github });
  return gruende.map(({ schluessel }) => schluessel);
}

test("Probe am Tageslimit: Exit 1 mit probe_tageslimit_erreicht, ohne Anruf und ohne gewaehlt", async () => {
  for (const stand of AM_LIMIT) {
    const { code, stdout, gewaehltGemerkt } = await probeAusfuehren(stand);
    assert.equal(code, 1);
    assert.equal(stdout.split("\n").at(-2), "probe_tageslimit_erreicht");
    assert.doesNotMatch(stdout, /^ANRUF/m);
    assert.equal(gewaehltGemerkt, false);
  }
});

test("Live-Freigabe: der Staging-Lauf einer Probe am Tageslimit sperrt sie", async () => {
  for (const stand of AM_LIMIT) {
    const { code } = await probeAusfuehren(stand);
    assert.deepEqual(await sperrgruende(code), ["rot_staging_letzter_rot"]);
  }
});

test("Live-Freigabe: der Staging-Lauf einer roten Probe sperrt sie", async () => {
  const { code, stdout } = await probeAusfuehren({ erstversuche: 4, anrufe: 8 });
  assert.match(stdout, /^Probe rot: /m);
  assert.deepEqual(await sperrgruende(code), ["rot_staging_letzter_rot"]);
});
