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
const ACTIONS = 15368;
const PFLICHT = ["Testschutz", "Freigabe-Prüfung"];
const UHR = { jetzt: () => 0, warten: async () => {} };
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

function routen(laeufe) {
  const checks = PFLICHT.map((name) => ({
    name,
    conclusion: "success",
    started_at: "2026-11-01T09:00:00Z",
    app: { id: ACTIONS },
  }));
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
          parameters: { required_status_checks: PFLICHT.map((context) => ({ context })) },
        },
      ],
    ],
    [`/repos/${REPO}/commits/${KOPF}/check-runs`, { check_runs: checks }],
    [`/repos/${REPO}/compare/master...${COMMIT}`, { status: "identical" }],
    [`/repos/${REPO}/compare/${PRODUKTION}...${COMMIT}`, { status: "ahead" }],
    [`/repos/${REPO}/actions/workflows/staging.yml/runs`, { workflow_runs: laeufe }],
  ]);
}

async function starten(laeufe, ohneAntwort) {
  const tabelle = routen(laeufe);
  if (ohneAntwort) tabelle.set(`/repos/${REPO}/actions/workflows/staging.yml/runs`, null);
  const antwort = createServer((anfrage, rueckgabe) => {
    const daten = tabelle.get(new URL(anfrage.url, "http://127.0.0.1").pathname);
    rueckgabe.writeHead(daten === undefined || daten === null ? 500 : 200, {
      "content-type": "application/json",
    });
    rueckgabe.end(JSON.stringify(daten ?? {}));
  });
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  server.push(antwort);
  return `http://127.0.0.1:${antwort.address().port}`;
}

function lauf(conclusion, optionen = {}) {
  return {
    conclusion,
    status: "completed",
    event: optionen.event ?? "push",
    created_at: optionen.zeit ?? "2026-11-01T08:00:00Z",
    head_branch: "master",
    head_sha: COMMIT,
    head_repository: { full_name: REPO },
    repository: { full_name: REPO },
  };
}

function lauf_ereignis() {
  return { name: "workflow_run", nutzlast: { workflow_run: lauf("success") } };
}

function hand_ereignis() {
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

async function laufen(laeufe, ereignis, ohneAntwort = false) {
  const adresse = await starten(laeufe, ohneAntwort);
  const zeilen = [];
  const ergebnis = await entscheiden({
    einstellungen: {
      githubUrl: adresse,
      githubToken: "t",
      repository: REPO,
      akteure: [],
      inActions: false,
      ref: null,
      ausgabeDatei: null,
      repoDir: ".",
      produktionUrl: adresse,
    },
    ereignis,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    vergleichen: async () => ({ geaendert: false, teile: [] }),
    uhr: UHR,
  });
  return { ergebnis, zeilen };
}

function enthalten(zeilen, teil) {
  return zeilen.some((zeile) => zeile.includes(teil));
}

const ROT_TEXT = "Rot: der jüngste Staging-Lauf auf master ist nicht grün (failure)";

test("roter Nachtlauf nach grünem Push-Lauf sperrt den Lauf-Start", async () => {
  const laeufe = [
    lauf("failure", { event: "schedule", zeit: "2026-11-02T03:00:00Z" }),
    lauf("success"),
  ];
  const { ergebnis, zeilen } = await laufen(laeufe, lauf_ereignis());
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.deploy, false);
  assert.equal(ergebnis.hoertest, false);
  assert.equal(enthalten(zeilen, ROT_TEXT), true);
});

test("roter Nachtlauf sperrt den Hand-Start, auch wenn ein älterer Push-Lauf grün war", async () => {
  const laeufe = [
    lauf("success"),
    lauf("failure", { event: "schedule", zeit: "2026-11-02T03:00:00Z" }),
  ];
  const { ergebnis, zeilen } = await laufen(laeufe, hand_ereignis());
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.deploy, false);
  assert.equal(ergebnis.hoertest, false);
  assert.equal(enthalten(zeilen, ROT_TEXT), true);
});

test("jüngster Lauf grün über älterem rotem lässt den Hand-Start durch", async () => {
  const laeufe = [
    lauf("failure", { zeit: "2026-11-01T07:00:00Z" }),
    lauf("success", { event: "schedule", zeit: "2026-11-02T03:00:00Z" }),
    lauf("success"),
  ];
  const { ergebnis, zeilen } = await laufen(laeufe, hand_ereignis());
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.deploy, true);
  assert.equal(enthalten(zeilen, "Rot:"), false);
});

test("abgebrochener und fremder Lauf zählen nicht als jüngster Lauf", async () => {
  const laeufe = [
    lauf("cancelled", { zeit: "2026-11-03T03:00:00Z" }),
    lauf("failure", { event: "workflow_dispatch", zeit: "2026-11-04T03:00:00Z" }),
    lauf("success"),
  ];
  const { ergebnis, zeilen } = await laufen(laeufe, hand_ereignis());
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.deploy, true);
  assert.equal(enthalten(zeilen, "Rot:"), false);
});

test("roter jüngster Lauf mit Status timed_out nennt den Status in der Ausgabe", async () => {
  const rot = { ...lauf("timed_out", { zeit: "2026-11-02T03:00:00Z" }) };
  const { ergebnis, zeilen } = await laufen([rot, lauf("success")], lauf_ereignis());
  assert.equal(ergebnis.deploy, false);
  assert.equal(
    enthalten(zeilen, "Rot: der jüngste Staging-Lauf auf master ist nicht grün (timed_out)"),
    true,
  );
});

test("keine Antwort der Lauf-Abfrage ist rot und nie grün", async () => {
  const { ergebnis, zeilen } = await laufen([lauf("success")], lauf_ereignis(), true);
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.deploy, false);
  assert.equal(
    enthalten(zeilen, "Rot: die GitHub-API antwortet im Schritt staging_letzter mit HTTP 500"),
    true,
  );
});
