import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeRepository } from "./probe-repo.js";
import { API_PFAD, REPO, githubAttrappe, starteWerkzeug } from "./warteschlange/hilfen.mjs";

const SYSTEMSTAND = join(REPO_ROOT, "tools/systemstand.mjs");
const AKTUELLER_STAND = "die Pflicht zum aktuellen Stand im Ruleset aus ist";
const RULESET = 24128981;

function regel(type, parameters) {
  return { type, ruleset_id: RULESET, parameters };
}

function warteschlangenRegel(abweichung = {}) {
  return regel("merge_queue", {
    merge_method: "REBASE",
    max_entries_to_build: 1,
    min_entries_to_merge: 1,
    max_entries_to_merge: 1,
    min_entries_to_merge_wait_minutes: 0,
    grouping_strategy: "ALLGREEN",
    check_response_timeout_minutes: 120,
    ...abweichung,
  });
}

async function ersterSchritt(context, regeln) {
  const ordner = probeRepository(context, {
    "tools/basis/systemstand.json": `${JSON.stringify({ schritte: {} })}\n`,
  });
  const github = await githubAttrappe(context, new Map([[`GET ${API_PFAD}/rules/branches/master`, regeln]]));
  const lauf = await starteWerkzeug([SYSTEMSTAND], {
    cwd: ordner,
    umgebung: {
      GITHUB_API_URL: github.url,
      GH_TOKEN: "probe",
      GITHUB_REPOSITORY: REPO,
      STAGING_URL: "http://127.0.0.1:9",
    },
  });
  return lauf.stdout.split("\n").find((zeile) => zeile.startsWith("Schritt 1a:")) ?? lauf.stderr;
}

const OHNE_STRIKT = regel("required_status_checks", {
  strict_required_status_checks_policy: false,
  required_status_checks: [{ context: "CI" }],
});

test("eine Warteschlange mit ALLGREEN und Gruppengröße 1 gilt wie die Pflicht zum aktuellen Stand", async (context) => {
  const zeile = await ersterSchritt(context, [OHNE_STRIKT, warteschlangenRegel()]);
  assert.ok(!zeile.includes(AKTUELLER_STAND), zeile);
  assert.ok(zeile.includes("die Code-Owner-Pflicht im Ruleset aus ist"), zeile);
});

test("ohne Warteschlange und ohne Pflicht zum aktuellen Stand bleibt die Meldung", async (context) => {
  const zeile = await ersterSchritt(context, [OHNE_STRIKT]);
  assert.ok(zeile.includes(AKTUELLER_STAND), zeile);
});

test("HEADGREEN oder eine Gruppengröße über 1 gelten nicht als gleichwertig", async (context) => {
  const varianten = [{ grouping_strategy: "HEADGREEN" }, { max_entries_to_merge: 2 }];
  for (const abweichung of varianten) {
    const zeile = await ersterSchritt(context, [OHNE_STRIKT, warteschlangenRegel(abweichung)]);
    assert.ok(zeile.includes(AKTUELLER_STAND), `${JSON.stringify(abweichung)}: ${zeile}`);
  }
});
