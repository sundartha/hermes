import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { entscheiden } from "../../tools/deploy-weg/entscheiden.mjs";

const REPO = "sundartha/hermes";
const COMMIT = "a".repeat(40);
const KOPF = "b".repeat(40);
const PRODUKTION = "c".repeat(40);
const GEMERGT = "2026-11-01T10:00:00Z";
const VOR_MERGE = "2026-11-01T09:00:00Z";
const VOR_MERGE_SPAET = "2026-11-01T09:30:00Z";
const NACH_MERGE = "2026-11-01T10:05:00Z";
const NACH_MERGE_SPAET = "2026-11-01T10:10:00Z";
const GITHUB_ACTIONS_APP = 15368;
const PFLICHT_CHECKS = ["Testschutz", "Freigabe-Prüfung"];
const NICHTS = { deploy: false, hoertest: false };
const UHR = { jetzt: () => 0, warten: async () => {} };
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

function lauf(name, conclusion, startedAt) {
  return { name, conclusion, started_at: startedAt, app: { id: GITHUB_ACTIONS_APP } };
}

function gruene(startedAt) {
  return PFLICHT_CHECKS.map((name) => lauf(name, "success", startedAt));
}

function standardRouten(optionen) {
  const checks = optionen.checks ?? gruene(VOR_MERGE);
  return new Map([
    ["/healthz", { commit: PRODUKTION }],
    [
      `/repos/${REPO}/commits/${COMMIT}/pulls`,
      [
        {
          merged_at: GEMERGT,
          merge_commit_sha: COMMIT,
          head: { sha: KOPF },
          base: { ref: "master", repo: { full_name: REPO } },
        },
      ],
    ],
    [
      `/repos/${REPO}/rules/branches/master`,
      [
        {
          type: "required_status_checks",
          parameters: { required_status_checks: PFLICHT_CHECKS.map((context) => ({ context })) },
        },
      ],
    ],
    [`/repos/${REPO}/commits/${KOPF}/check-runs`, { check_runs: checks }],
    [`/repos/${REPO}/compare/master...${COMMIT}`, { status: optionen.gegenMaster ?? "identical" }],
    [`/repos/${REPO}/compare/${PRODUKTION}...${COMMIT}`, { status: "ahead" }],
    [
      `/repos/${REPO}/actions/workflows/staging.yml/runs`,
      { workflow_runs: optionen.stagingLaeufe ?? [] },
    ],
  ]);
}

async function starten(optionen) {
  const routen = standardRouten(optionen);
  for (const pfad of optionen.fehler ?? []) routen.set(pfad, null);
  const anfragen = [];
  const antwort = createServer((anfrage, rueckgabe) => {
    const pfad = new URL(anfrage.url, "http://127.0.0.1").pathname;
    anfragen.push(pfad);
    const daten = routen.get(pfad);
    rueckgabe.writeHead(daten === undefined || daten === null ? 500 : 200, {
      "content-type": "application/json",
    });
    rueckgabe.end(JSON.stringify(daten ?? {}));
  });
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  server.push(antwort);
  return { adresse: `http://127.0.0.1:${antwort.address().port}`, anfragen };
}

function stagingLauf(conclusion) {
  return {
    conclusion,
    event: "push",
    head_branch: "master",
    head_sha: COMMIT,
    head_repository: { full_name: REPO },
    repository: { full_name: REPO },
  };
}

function einstellungen(adresse) {
  return {
    githubUrl: adresse,
    githubToken: "t",
    repository: REPO,
    akteure: [],
    inActions: false,
    ref: null,
    ausgabeDatei: null,
    repoDir: ".",
    produktionUrl: adresse,
  };
}

async function laufen(optionen, ereignis) {
  const { adresse, anfragen } = await starten(optionen);
  const zeilen = [];
  const aufrufe = [];
  const vergleichen = async () => {
    aufrufe.push("abdruck");
    return { geaendert: false, teile: [] };
  };
  const ergebnis = await entscheiden({
    einstellungen: einstellungen(adresse),
    ereignis,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    vergleichen,
    uhr: UHR,
  });
  return { ergebnis, zeilen, anfragen, aufrufe };
}

function stagingEreignis(conclusion) {
  return { name: "workflow_run", nutzlast: { workflow_run: stagingLauf(conclusion) } };
}

function handEreignis() {
  return {
    name: "workflow_dispatch",
    nutzlast: {
      inputs: { commit: COMMIT },
      ref: "refs/heads/master",
      repository: { full_name: REPO },
      sender: { login: "Antonio20045" },
    },
  };
}

function enthalten(zeilen, teil) {
  return zeilen.some((zeile) => zeile.includes(teil));
}

function ohnePruefung(anfragen) {
  return !anfragen.some((pfad) => /\/(pulls|check-runs)$/.test(pfad));
}

test("abgebrochener Staging-Lauf eines überholten Commits ist kein Rot und deployt nichts", async () => {
  const { ergebnis, zeilen, anfragen, aufrufe } = await laufen(
    { gegenMaster: "behind" },
    stagingEreignis("cancelled"),
  );
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.deploy, false);
  assert.equal(ergebnis.hoertest, false);
  assert.equal(enthalten(zeilen, "überholt"), true);
  assert.equal(enthalten(zeilen, "Rot:"), false);
  assert.equal(ohnePruefung(anfragen), true);
  assert.deepEqual(aufrufe, []);
});

test("abgebrochener Staging-Lauf eines Commits, den niemand überholt hat, bleibt rot", async () => {
  const { ergebnis, zeilen } = await laufen(
    { gegenMaster: "identical" },
    stagingEreignis("cancelled"),
  );
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.deploy, false);
  assert.equal(enthalten(zeilen, "Rot: der Staging-Lauf ist nicht grün (cancelled)"), true);
});

test("abgebrochener Staging-Lauf mit GitHub-Fehler beim Vergleich bleibt rot", async () => {
  const pfad = `/repos/${REPO}/compare/master...${COMMIT}`;
  const { ergebnis, zeilen } = await laufen({ fehler: [pfad] }, stagingEreignis("cancelled"));
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.deploy, false);
  assert.equal(
    enthalten(zeilen, "Rot: die GitHub-API antwortet im Schritt master mit HTTP 500"),
    true,
  );
  assert.equal(enthalten(zeilen, "Rot: der Staging-Lauf ist nicht grün (cancelled)"), true);
});

test("fehlgeschlagener Staging-Lauf bleibt rot, auch wenn der Commit überholt ist", async () => {
  const { ergebnis, zeilen, anfragen } = await laufen(
    { gegenMaster: "behind" },
    stagingEreignis("failure"),
  );
  assert.equal(ergebnis.ok, false);
  assert.equal(enthalten(zeilen, "Rot: der Staging-Lauf ist nicht grün (failure)"), true);
  assert.equal(enthalten(zeilen, "überholt"), false);
  assert.equal(anfragen.includes(`/repos/${REPO}/compare/master...${COMMIT}`), true);
});

test("Staging-Lauf mit Zeitüberschreitung bleibt rot, auch wenn der Commit überholt ist", async () => {
  const { ergebnis, zeilen } = await laufen(
    { gegenMaster: "behind" },
    stagingEreignis("timed_out"),
  );
  assert.equal(ergebnis.ok, false);
  assert.equal(enthalten(zeilen, "Rot: der Staging-Lauf ist nicht grün (timed_out)"), true);
  assert.equal(enthalten(zeilen, "überholt"), false);
});

test("Staging-Lauf ohne Ergebnis bleibt rot, auch wenn der Commit überholt ist", async () => {
  const { ergebnis, zeilen } = await laufen({ gegenMaster: "behind" }, stagingEreignis(null));
  assert.equal(ergebnis.ok, false);
  assert.equal(enthalten(zeilen, "Rot: der Staging-Lauf ist nicht grün (offen)"), true);
  assert.equal(enthalten(zeilen, "überholt"), false);
});

test("grüner Staging-Lauf mit grünen Pflicht-Checks wird ausgeliefert", async () => {
  const { ergebnis, zeilen } = await laufen({}, stagingEreignis("success"));
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.deploy, true);
  assert.equal(enthalten(zeilen, "Rot:"), false);
});

test("abgebrochener älterer Check ist kein Rot, wenn ein neuerer Lauf nach dem Merge grün ist", async () => {
  const checks = [
    lauf("Testschutz", "cancelled", VOR_MERGE),
    lauf("Testschutz", "success", NACH_MERGE),
    lauf("Freigabe-Prüfung", "cancelled", VOR_MERGE),
    lauf("Freigabe-Prüfung", "success", NACH_MERGE),
  ];
  const { ergebnis, zeilen } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.deploy, true);
  assert.equal(enthalten(zeilen, "Rot:"), false);
});

test("abgebrochener älterer Check ist kein Rot, wenn ein neuerer Lauf vor dem Merge grün ist", async () => {
  const checks = [
    lauf("Testschutz", "cancelled", VOR_MERGE),
    lauf("Testschutz", "success", VOR_MERGE_SPAET),
    ...PFLICHT_CHECKS.slice(1).map((name) => lauf(name, "success", VOR_MERGE)),
  ];
  const { ergebnis } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.deploy, true);
});

test("fehlgeschlagener Check vor dem Merge wird durch einen grünen Lauf nach dem Merge nicht grün", async () => {
  const checks = [
    lauf("Testschutz", "failure", VOR_MERGE),
    lauf("Testschutz", "success", NACH_MERGE),
    ...gruene(VOR_MERGE).slice(1),
  ];
  const { ergebnis, zeilen } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.deploy, false);
  assert.equal(
    enthalten(zeilen, "Rot: Pflicht-Check Testschutz ist nicht success (failure)"),
    true,
  );
});

test("älteres failure vor dem Merge ist kein Rot, wenn ein neuerer Lauf vor dem Merge grün ist", async () => {
  const checks = [
    lauf("Testschutz", "failure", VOR_MERGE),
    lauf("Testschutz", "success", VOR_MERGE_SPAET),
    ...PFLICHT_CHECKS.slice(1).map((name) => lauf(name, "success", VOR_MERGE)),
  ];
  const { ergebnis, zeilen } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.deploy, true);
  assert.equal(enthalten(zeilen, "Rot:"), false);
});

test("failure und danach cancelled vor dem Merge bleiben rot, auch wenn ein Lauf nach dem Merge grün ist", async () => {
  const checks = [
    lauf("Testschutz", "failure", VOR_MERGE),
    lauf("Testschutz", "cancelled", VOR_MERGE_SPAET),
    lauf("Testschutz", "success", NACH_MERGE),
    ...gruene(VOR_MERGE).slice(1),
  ];
  const { ergebnis, zeilen } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.deploy, false);
  assert.equal(
    enthalten(zeilen, "Rot: Pflicht-Check Testschutz ist nicht success (cancelled)"),
    true,
  );
});

test("abgebrochener Check bleibt rot, wenn der grüne Lauf nach dem Merge älter ist als er", async () => {
  const checks = [
    lauf("Freigabe-Prüfung", "success", NACH_MERGE),
    lauf("Freigabe-Prüfung", "cancelled", NACH_MERGE_SPAET),
    ...gruene(VOR_MERGE).slice(0, 1),
  ];
  const { ergebnis, zeilen } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, false);
  assert.equal(
    enthalten(zeilen, "Rot: Pflicht-Check Freigabe-Prüfung ist nicht success (cancelled)"),
    true,
  );
});

test("abgebrochener neuester Check ohne neueren Lauf bleibt rot", async () => {
  const checks = [lauf("Testschutz", "cancelled", VOR_MERGE), ...gruene(VOR_MERGE).slice(1)];
  const { ergebnis, zeilen } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, false);
  assert.equal(
    enthalten(zeilen, "Rot: Pflicht-Check Testschutz ist nicht success (cancelled)"),
    true,
  );
});

test("Check, der nur nach dem Merge grün lief, fehlt weiterhin", async () => {
  const checks = [lauf("Testschutz", "success", NACH_MERGE), ...gruene(VOR_MERGE).slice(1)];
  const { ergebnis, zeilen } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, false);
  assert.equal(enthalten(zeilen, "Rot: Pflicht-Check Testschutz fehlt auf dem PR-Kopf"), true);
});

test("Check, der nur nach dem Merge fehlschlug, bleibt rot", async () => {
  const checks = [lauf("Testschutz", "failure", NACH_MERGE), ...gruene(VOR_MERGE).slice(1)];
  const { ergebnis, zeilen } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, false);
  assert.equal(
    enthalten(zeilen, "Rot: Pflicht-Check Testschutz ist nicht success (failure)"),
    true,
  );
});

test("Hand-Start ohne grünen Staging-Lauf für den Commit bleibt rot", async () => {
  const { ergebnis, zeilen } = await laufen({}, handEreignis());
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.deploy, false);
  assert.equal(
    enthalten(zeilen, "Rot: kein grüner Push-Lauf von staging für genau diesen Commit"),
    true,
  );
});

test("Hand-Start mit grünem Staging-Lauf für den Commit liefert aus", async () => {
  const stagingLaeufe = [stagingLauf("success")];
  const { ergebnis, zeilen } = await laufen({ stagingLaeufe }, handEreignis());
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.deploy, true);
  assert.deepEqual(
    { deploy: ergebnis.deploy, hoertest: ergebnis.hoertest },
    { deploy: true, hoertest: false },
  );
  assert.equal(enthalten(zeilen, "Rot:"), false);
  assert.notDeepEqual(ergebnis, NICHTS);
});

test("abgebrochener Staging-Lauf, der nicht von einem Push auf master kam, bleibt rot, auch wenn der Commit überholt ist", async () => {
  const ereignis = stagingEreignis("cancelled");
  ereignis.nutzlast.workflow_run.head_branch = "dev";
  const { ergebnis, zeilen } = await laufen({ gegenMaster: "behind" }, ereignis);
  assert.equal(ergebnis.ok, false);
  assert.equal(
    enthalten(zeilen, "Rot: der Staging-Lauf kam nicht von einem Push auf master"),
    true,
  );
  assert.equal(enthalten(zeilen, "überholt"), false);
});

test("abgebrochener Check ohne Startzeit bleibt rot, auch wenn nach dem Merge ein grüner Lauf liegt", async () => {
  const ohneStart = {
    name: "Testschutz",
    conclusion: "cancelled",
    app: { id: GITHUB_ACTIONS_APP },
  };
  const checks = [
    ohneStart,
    lauf("Testschutz", "success", NACH_MERGE),
    ...gruene(VOR_MERGE).slice(1),
  ];
  const { ergebnis, zeilen } = await laufen({ checks }, stagingEreignis("success"));
  assert.equal(ergebnis.ok, false);
  assert.equal(
    enthalten(zeilen, "Rot: Pflicht-Check Testschutz ist nicht success (cancelled)"),
    true,
  );
});
