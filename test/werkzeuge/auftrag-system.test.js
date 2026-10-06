import assert from "node:assert/strict";
import { test } from "node:test";

import { EINSTIEG } from "./pruefer/hilfen.mjs";
import { probeDirectory } from "./probe-repo.js";
import { githubAttrappe, starteZiele, umgebung } from "./ziele/hilfen.mjs";

const AELTESTES = 120;
const JUENGERES = 140;
const PR_NUMMER = 110;

function systemIssue(nummer, erstellt, felder = {}) {
  return { number: nummer, title: `System: G${nummer}`, labels: [{ name: "system" }], state: "open", created_at: erstellt, html_url: `https://github.com/sundartha/hermes/issues/${nummer}`, ...felder };
}

async function system(context, anfang) {
  const github = await githubAttrappe(context, anfang);
  const lauf = await starteZiele(["system"], { cwd: probeDirectory(context, {}), env: umgebung(github), programm: EINSTIEG });
  return { ...lauf, github };
}

test("auftrag-system: ohne offenes system-Issue meldet der Befehl das und endet mit Exit 0", async (context) => {
  const { status, stdout, github } = await system(context, { issues: [systemIssue(AELTESTES, "2026-09-01T00:00:00Z", { state: "closed" })] });
  assert.deepEqual([status, stdout.trim()], [0, "kein offenes system-Issue"]);
  assert.deepEqual(github.zustand.anfragen, ["GET /issues"]);
});

test("auftrag-system: der Befehl wählt das älteste offene system-Issue und überspringt Pull Requests", async (context) => {
  const anfang = {
    issues: [
      systemIssue(PR_NUMMER, "2026-08-01T00:00:00Z", { pull_request: {} }),
      systemIssue(JUENGERES, "2026-09-20T00:00:00Z"),
      systemIssue(AELTESTES, "2026-09-01T00:00:00Z"),
      { ...systemIssue(1, "2026-07-01T00:00:00Z"), labels: [{ name: "pruefer" }] },
    ],
  };
  const { status, stdout } = await system(context, anfang);
  assert.equal(status, 0);
  assert.deepEqual(stdout.trim().split("\n"), [`#${AELTESTES} System: G${AELTESTES}`, `https://github.com/sundartha/hermes/issues/${AELTESTES}`]);
});
