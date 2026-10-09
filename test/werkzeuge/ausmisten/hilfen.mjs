import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import {
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  probeRepository,
  runIn,
  writeFiles,
} from "../probe-repo.js";
import { zipMitEinerDatei } from "../pruefer/zip.mjs";

export const REPOSITORY = "sundartha/hermes";
export const BRANCH = "ausmisten/posteingang";
export const DOPPELT = "test/post/doppelt.test.js";
export const GATE_TEST = "test/gate.test.js";
export const EINGANG_QUELLE = "src/post/eingang.js";
export const FREMDE_QUELLE = "src/fremd/rechnen.js";
export const UHR_QUELLE = "src/uhr/zeit.js";
export const RECHNEN_TEST = "test/post/rechnen.test.js";
export const RECHNEN_HILFE = "test/hilfe/rechnen.js";
export const REPO_ID = 4242;
const EINRUECKUNG = 2;
const HTTP_OK = 200;
const HTTP_NICHT_GEFUNDEN = 404;
const HTTP_VERBOTEN = 403;
const ERSTE_ARTEFAKT_ID = 7001;
export const EINGANG_ID = 31;

const BEREICHE = [
  { bereich: "posteingang", quellen: ["^src/post/"], eingaenge: [], fachlogik: [] },
  { bereich: "werkzeuge", quellen: [], eingaenge: [], fachlogik: [] },
  { bereich: "gemeinsam", quellen: ["^src/"], eingaenge: [], fachlogik: [] },
];

function testDatei(importPfad, name) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import * as modul from ${JSON.stringify(importPfad)};`,
    "",
    `test(${JSON.stringify(name)}, () => {`,
    "  assert.ok(Object.keys(modul).length > 0);",
    "});",
    "",
  ].join("\n");
}

export const GRUNDDATEIEN = {
  "package.json": `${JSON.stringify({ type: "module" })}\n`,
  "package-lock.json": "{}\n",
  "stryker.config.json": "{}\n",
  "tools/bereiche.json": `${JSON.stringify(BEREICHE, null, EINRUECKUNG)}\n`,
  "tools/gate-tests.json": `${JSON.stringify({ Denylist: { module: ["src/sperre.js"], tests: [GATE_TEST] } })}\n`,
  [EINGANG_QUELLE]: "export function eingang(text) {\n  return text.trim();\n}\n",
  [FREMDE_QUELLE]: "export function doppelt(zahl) {\n  return zahl * 2;\n}\n",
  [UHR_QUELLE]: "export function jetzt() {\n  return 0;\n}\n",
  "src/sperre.js": "export function gesperrt(ziel) {\n  return ziel.startsWith('+900');\n}\n",
  "test/post/eingang.test.js": testDatei("../../src/post/eingang.js", "nimmt den Eingang"),
  [DOPPELT]: testDatei("../../src/post/eingang.js", "nimmt den Eingang noch einmal"),
  [RECHNEN_HILFE]: 'export { doppelt } from "../../src/fremd/rechnen.js";\n',
  [RECHNEN_TEST]: testDatei("../hilfe/rechnen.js", "verdoppelt"),
  [GATE_TEST]: testDatei("../src/sperre.js", "sperrt teure Ziele"),
  "test/uhr.test.js": testDatei("../src/uhr/zeit.js", "kennt die Zeit"),
};

export function ausmistenRepo(context, dateien = {}) {
  const ordner = probeRepository(context, { ...GRUNDDATEIEN, ...dateien });
  const sha = () => runIn(ordner, "git", ["rev-parse", "HEAD"]).stdout.trim();
  return {
    ordner,
    master: sha(),
    committe(neu, weg = []) {
      writeFiles(ordner, neu);
      for (const pfad of weg) rmSync(join(ordner, pfad), { force: true });
      commitAll(ordner, "Probe");
      return sha();
    },
    git: (args) => runIn(ordner, "git", args),
  };
}

export async function starte(werkzeug, { args, cwd, umgebung, vorab = [] }) {
  const kind = spawn(process.execPath, [...vorab, join(REPO_ROOT, werkzeug), ...args], {
    cwd,
    env: { ...isolatedEnvironment(), ...umgebung },
  });
  const teile = [];
  for (const strom of [kind.stdout, kind.stderr]) strom.on("data", (teil) => teile.push(teil));
  const [status] = await once(kind, "close");
  return { status, ausgabe: Buffer.concat(teile).toString() };
}

export function eingangsLauf(kopf, felder = {}) {
  return {
    path: ".github/workflows/ausmisten-eingang.yml",
    event: "push",
    workflow_id: EINGANG_ID,
    conclusion: "success",
    head_sha: kopf,
    head_branch: BRANCH,
    head_repository: { id: REPO_ID, full_name: REPOSITORY },
    repository: { id: REPO_ID, full_name: REPOSITORY },
    ...felder,
  };
}

export const VERBOTEN = Symbol("verboten");

function beantworte(ausgang, antwort) {
  if (antwort === VERBOTEN) {
    ausgang.writeHead(HTTP_VERBOTEN).end("{}");
    return;
  }
  if (antwort === undefined) {
    ausgang.writeHead(HTTP_NICHT_GEFUNDEN).end("{}");
    return;
  }
  const roh = Buffer.isBuffer(antwort);
  ausgang.writeHead(HTTP_OK, { "content-type": roh ? "application/zip" : "application/json" });
  ausgang.end(roh ? antwort : JSON.stringify(antwort));
}

async function gelesenerRumpf(eingang) {
  const teile = [];
  for await (const teil of eingang) teile.push(teil);
  const text = Buffer.concat(teile).toString("utf8");
  return text === "" ? null : JSON.parse(text);
}

export async function scheinApi(context, antworten) {
  const anfragen = [];
  const server = createServer(async (eingang, ausgang) => {
    const { pathname } = new URL(eingang.url, "http://schein");
    anfragen.push({
      methode: eingang.method,
      pfad: pathname,
      rumpf: await gelesenerRumpf(eingang),
    });
    beantworte(ausgang, antworten.get(`${eingang.method} ${pathname}`));
  });
  await new Promise((bereit) => server.listen({ port: 0, host: "127.0.0.1" }, bereit));
  context.after(() => new Promise((fertig) => server.close(fertig)));
  const { address, port } = server.address();
  return { url: `http://${address}:${port}`, anfragen };
}

export function artefaktRouten(laufId, eintraege) {
  const routen = new Map();
  const artifacts = eintraege.map(({ name }, index) => ({ id: ERSTE_ARTEFAKT_ID + index, name }));
  routen.set(`GET /repos/${REPOSITORY}/actions/runs/${laufId}/artifacts`, {
    total_count: artifacts.length,
    artifacts,
  });
  eintraege.forEach(({ name, text, datei }, index) => {
    const zip = zipMitEinerDatei(datei ?? `${name}.json`, text);
    routen.set(`GET /repos/${REPOSITORY}/actions/artifacts/${ERSTE_ARTEFAKT_ID + index}/zip`, zip);
  });
  return routen;
}
