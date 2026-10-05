import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { entscheiden, pruefen } from "../../tools/auftrag/pruefer-befehle.mjs";
import { probeDirectory } from "./probe-repo.js";
import {
  ciLauf,
  prueferLauf,
  scheinSha,
  setzeAusloeser,
  workflowAbfrage,
} from "./pruefer/hilfen.mjs";

const HEAD = scheinSha("d");
const FREMDE_NUMMER = 77;
const EXIT_HERKUNFT = 1;
const GEFAELSCHT = ".github/workflows/probe-b.yml";

function scheinGithub() {
  const gesendet = [];
  const gefragt = [];
  return {
    gesendet,
    gefragt,
    hole: async (pfad) => {
      gefragt.push(pfad);
      return workflowAbfrage(pfad);
    },
    alle: async () => [],
    sende: async (methode, pfad, daten) => {
      gesendet.push({ methode, pfad, daten });
      return {};
    },
  };
}

function ordnerMitErgebnis(context) {
  const ergebnis = { format: 1, head: HEAD, branch: "fix/zahl", commits: [] };
  return probeDirectory(context, { "ergebnis.json": JSON.stringify(ergebnis) });
}

async function entscheideNachNachstellung(context) {
  const ordner = ordnerMitErgebnis(context);
  const nachstellung = probeDirectory(context, {});
  const github = scheinGithub();
  const status = await entscheiden({ ergebnis: ordner, nachstellung }, ordner, { github });
  return { status, github };
}

test("ein gleichnamiger Workflow aus einem PR setzt keinen Status", async (context) => {
  setzeAusloeser(
    context,
    prueferLauf({ path: GEFAELSCHT, event: "pull_request", workflow_id: FREMDE_NUMMER }),
  );
  const { status, github } = await entscheideNachNachstellung(context);
  assert.equal(status, EXIT_HERKUNFT);
  assert.deepEqual(github.gesendet, []);
});

test("ein Lauf von pruefer-pruefen.yml mit Ereignis pull_request setzt keinen Status", async (context) => {
  setzeAusloeser(context, prueferLauf({ event: "pull_request" }));
  const { status, github } = await entscheideNachNachstellung(context);
  assert.equal(status, EXIT_HERKUNFT);
  assert.deepEqual(github.gesendet, []);
});

test("ein Lauf mit passendem Pfad, aber fremder Workflow-Nummer setzt keinen Status", async (context) => {
  setzeAusloeser(
    context,
    prueferLauf({
      path: ".github/workflows/pruefer-pruefen.yml@probe.yml",
      workflow_id: FREMDE_NUMMER,
    }),
  );
  const { status, github } = await entscheideNachNachstellung(context);
  assert.equal(status, EXIT_HERKUNFT);
  assert.deepEqual(github.gesendet, []);
});

test("ohne Ereignisdaten setzt entscheiden keinen Status", async (context) => {
  delete process.env.GITHUB_EVENT_PATH;
  const { status, github } = await entscheideNachNachstellung(context);
  assert.equal(status, EXIT_HERKUNFT);
  assert.deepEqual(github.gesendet, []);
});

test("ein echter Lauf von pruefer-pruefen.yml setzt den Status nach der Nachstellung", async (context) => {
  setzeAusloeser(context, prueferLauf());
  const { status, github } = await entscheideNachNachstellung(context);
  assert.equal(status, 0);
  assert.deepEqual(
    github.gesendet.map(({ pfad, daten }) => [pfad, daten.state]),
    [[`/statuses/${HEAD}`, "success"]],
  );
});

test("melden setzt keinen Status, wenn der grüne CI-Lauf aus einem gleichnamigen Workflow stammt", async (context) => {
  setzeAusloeser(context, ciLauf({ path: GEFAELSCHT, workflow_id: FREMDE_NUMMER }));
  const ordner = ordnerMitErgebnis(context);
  const github = scheinGithub();
  const status = await entscheiden({ ergebnis: ordner, head: HEAD }, ordner, { github });
  assert.equal(status, EXIT_HERKUNFT);
  assert.deepEqual(github.gesendet, []);
});

test("ein gleichnamiger CI-Workflow startet keine Prüfung und schreibt kein Ergebnis", async (context) => {
  setzeAusloeser(context, ciLauf({ path: GEFAELSCHT, workflow_id: FREMDE_NUMMER }));
  const aus = join(probeDirectory(context, {}), "ergebnis");
  const github = scheinGithub();
  const optionen = { head: HEAD, "pr-branch": "fix/zahl", aus };
  const status = await pruefen(optionen, aus, { github });
  assert.equal(status, EXIT_HERKUNFT);
  assert.equal(existsSync(aus), false);
  assert.deepEqual(github.gefragt, []);
});
