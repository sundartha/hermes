import assert from "node:assert/strict";
import { test } from "node:test";

import { probeDirectory } from "../werkzeuge/probe-repo.js";
import { werkzeugLaufen } from "./werkzeug-probe.js";

const GEPINNTE_ACTION = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const ZEILE_AUSLOESER = 3;
const ZEILE_ACTION = 10;
const EXIT_OK = 0;
const EXIT_BEFUND = 1;

function workflow({ ausloeser = "pull_request", action = GEPINNTE_ACTION } = {}) {
  const kopf = ["name: Probe", "on:", `  ${ausloeser}:`, "permissions:", "  contents: read"];
  const job = ["jobs:", "  probe:", "    runs-on: ubuntu-latest", "    steps:"];
  return [...kopf, ...job, `      - uses: ${action}`, ""].join("\n");
}

function pruefen(context, inhalt) {
  const verzeichnis = probeDirectory(context, { "probe.yml": inhalt });
  return werkzeugLaufen("workflows-pruefen.mjs", [verzeichnis]);
}

async function assertNurVerstossAbgelehnt(context, verstoss, zeile) {
  assert.equal((await pruefen(context, workflow())).status, EXIT_OK);
  const lauf = await pruefen(context, workflow(verstoss));
  assert.equal(lauf.status, EXIT_BEFUND, lauf.ausgabe);
  assert.match(lauf.ausgabe, new RegExp(`probe\\.yml:${zeile}: `));
}

test("SG-18 Workflow mit pull_request_target wird abgelehnt", (context) =>
  assertNurVerstossAbgelehnt(context, { ausloeser: "pull_request_target" }, ZEILE_AUSLOESER));

test("SG-20 Action mit Tag statt Commit-SHA wird abgelehnt", (context) =>
  assertNurVerstossAbgelehnt(context, { action: "actions/checkout@v4" }, ZEILE_ACTION));
