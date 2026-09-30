import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

import {
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  probeRepository,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/freigabe-pruefung.mjs");
const REPOSITORY = "sundartha/vodafone-agent";
const PULL_REQUEST = "7";
const ANTONIO = "Antonio20045";
const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const MS_PER_DAY = 86_400_000;
const OLD_DAYS = 400;
const YOUNG_DAYS = 2;
const WEEKLY_DOWNLOADS = 12_345;
const OWNERS = ["/tools/ @Antonio20045 @jonas986", "/test/werkzeuge/ @Antonio20045 @jonas986", ""];
const RAISED_LIMIT = 20;
const LOWER_LIMIT = 3;
const STRICTER_LIMIT = 2;
const STOPPED_NUMBER = 4;
const ALLOWED_NUMBER = 12;
const RIGHT_SUM = 2;
const WRONG_SUM = 3;
const JSON_INDENT = 2;
const HTTP_OK = 200;

function json(value) {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

function limitCheck(limit) {
  return [
    'import { readFileSync } from "node:fs";',
    `const GRENZE = ${limit};`,
    'const zahl = Number(readFileSync("zahl.txt", "utf8"));',
    'if (zahl > GRENZE) console.error("zu gross: " + zahl);',
    "if (zahl > GRENZE) process.exitCode = 1;",
    "",
  ].join("\n");
}

function numberCase(titel, zahl) {
  return json({ titel, dateien: { "zahl.txt": [[...String(zahl)]] }, erwartet: "zu gross" });
}

const LIMIT_CHECK_FILES = {
  "tools/grenze.mjs": limitCheck(LOWER_LIMIT),
  "zahl.txt": "5\n",
  "test/werkzeuge/rotproben/grenze/pruefung.json": json({
    titel: "Grenze",
    pfade: ["tools/grenze.mjs"],
    treffer: { befehl: ["node", "{wurzel}/tools/grenze.mjs"], zaehlen: "stderr-zeilen" },
    probe: { befehl: ["node", "{wurzel}/tools/grenze.mjs"] },
  }),
  "test/werkzeuge/rotproben/grenze/vier.json": numberCase("Zahl vier", STOPPED_NUMBER),
};

function packageManifest(dependencies, scripts = { test: "node --test" }) {
  return json({ name: "probe", scripts, dependencies });
}

function lockfile(versions) {
  const entries = Object.entries(versions).map(([name, version]) => [
    `node_modules/${name}`,
    { version },
  ]);
  return json({ lockfileVersion: 3, packages: Object.fromEntries(entries) });
}

function readBody(request) {
  return new Promise((done) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => done(text === "" ? undefined : JSON.parse(text)));
  });
}

function packument(entry) {
  const published = new Date(Date.now() - entry.days * MS_PER_DAY).toISOString();
  return {
    time: { [entry.version]: published },
    versions: { [entry.version]: { license: entry.license } },
  };
}

function registryAnswer(state, { method, path, body }) {
  const name = decodeURIComponent(path.split("/").at(-1));
  if (method === "POST" && path.endsWith("/advisories/bulk")) {
    return Object.fromEntries(
      Object.keys(body).map((key) => [key, state.packages[key].advisories]),
    );
  }
  if (path.startsWith("/downloads/")) return { downloads: state.packages[name].downloads };
  return packument(state.packages[name]);
}

function gitHubAnswer(state, { method, path }) {
  if (method !== "GET") return {};
  if (path.endsWith("/reviews")) return state.reviews;
  if (path.endsWith("/comments")) return [];
  return state.pull;
}

async function startServices(state) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const path = request.url.split("?")[0];
    const call = { method: request.method, path, body: await readBody(request) };
    requests.push(call);
    const isRegistry = path.startsWith("/registry/") || path.startsWith("/downloads/");
    const answer = isRegistry ? registryAnswer(state, call) : gitHubAnswer(state, call);
    response.writeHead(HTTP_OK, { "content-type": "application/json" });
    response.end(JSON.stringify(answer));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}` };
}

function runTool(directory, basis, url) {
  const args = [TOOL, "--basis", basis, "--pr", PULL_REQUEST];
  const sources = ["--registry", `${url}/registry`, "--downloads", `${url}/downloads`];
  const environment = {
    ...isolatedEnvironment(),
    GITHUB_API_URL: url,
    GITHUB_TOKEN: "probe",
    GITHUB_REPOSITORY: REPOSITORY,
  };
  return new Promise((done) => {
    const child = spawn(process.execPath, [...args, ...sources], {
      cwd: directory,
      env: environment,
    });
    const output = { stdout: "", stderr: "" };
    child.stdout.on("data", (chunk) => (output.stdout += chunk));
    child.stderr.on("data", (chunk) => (output.stderr += chunk));
    child.on("close", (status) => done({ ...output, status }));
  });
}

function reviewsFor(approval, head) {
  if (approval === undefined) return [];
  const commit = approval === "alt" ? "0".repeat(head.length) : head;
  return [{ user: { login: ANTONIO }, state: "APPROVED", commit_id: commit }];
}

async function check(context, { basisFiles = {}, changes, approval, labels = [], packages = {} }) {
  const directory = probeRepository(context, {
    ".github/CODEOWNERS": OWNERS.join("\n"),
    ...basisFiles,
  });
  const basis = runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(directory, changes);
  commitAll(directory, "Änderung");
  const head = runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const pull = { number: Number(PULL_REQUEST), head: { sha: head }, labels };
  const services = await startServices({ pull, reviews: reviewsFor(approval, head), packages });
  try {
    const result = await runTool(directory, basis, services.url);
    return { ...result, requests: services.requests };
  } finally {
    services.server.close();
  }
}

function writes(result, method) {
  return result.requests.filter((request) => request.method === method);
}

function comment(result) {
  return writes(result, "POST").find(({ path }) => path.endsWith("/comments"))?.body.body ?? "";
}

function labelsSet(result) {
  return writes(result, "POST")
    .filter(({ path }) => path.endsWith("/labels"))
    .flatMap(({ body }) => body.labels);
}

test("ein PR, der nur src/ ändert, bekommt art:code und ist ohne Freigabe grün", async (context) => {
  const result = await check(context, {
    basisFiles: { "src/app.js": "export const wert = 1;\n" },
    changes: { "src/app.js": "export const wert = 2;\n" },
    labels: [{ name: "art:pruefung" }, { name: "paket" }],
  });
  assert.equal(result.status, EXIT_OK, result.stdout + result.stderr);
  assert.deepEqual(labelsSet(result), ["art:code"]);
  const removed = writes(result, "DELETE").map(({ path }) => decodeURIComponent(path));
  assert.deepEqual(removed, [`/repos/${REPOSITORY}/issues/${PULL_REQUEST}/labels/art:pruefung`]);
  assert.equal(comment(result), "");
});

test("eine geänderte bestehende Prüfung wartet auf eine Freigabe auf dem aktuellen Stand", async (context) => {
  const scenario = {
    basisFiles: { "tools/pruefung.mjs": "export const streng = true;\n" },
    changes: { "tools/pruefung.mjs": "export const streng = false;\n" },
  };
  const unapproved = await check(context, scenario);
  assert.equal(unapproved.status, EXIT_FAILURE);
  assert.deepEqual(labelsSet(unapproved), ["art:pruefung"]);
  assert.match(
    unapproved.stdout,
    /Braucht Freigabe: Bestehende Prüfungsdateien .*tools\/pruefung\.mjs/,
  );
  assert.match(
    comment(unapproved),
    /Geänderte Prüfungsdateien ohne Messung\n\n- `tools\/pruefung\.mjs`/,
  );
  const oldApproval = await check(context, { ...scenario, approval: "alt" });
  assert.equal(oldApproval.status, EXIT_FAILURE);
  const approved = await check(context, { ...scenario, approval: "aktuell" });
  assert.equal(approved.status, EXIT_OK, approved.stdout);
  assert.match(approved.stdout, /Freigegeben von Antonio20045/);
});

test("eine neu angelegte Prüfung braucht keine Freigabe", async (context) => {
  const result = await check(context, {
    changes: { "tools/neue-pruefung.mjs": "export const neu = true;\n" },
  });
  assert.equal(result.status, EXIT_OK, result.stdout);
  assert.deepEqual(labelsSet(result), ["art:pruefung"]);
});

test("eine gelockerte Prüfung ohne Fehlalarm-Beispiel bleibt auch mit Freigabe rot", async (context) => {
  const result = await check(context, {
    basisFiles: LIMIT_CHECK_FILES,
    changes: { "tools/grenze.mjs": limitCheck(RAISED_LIMIT) },
    approval: "aktuell",
  });
  assert.equal(result.status, EXIT_FAILURE);
  assert.match(result.stdout, /Muss geändert werden: Die Prüfung „Grenze“ wird lockerer/);
  const text = comment(result);
  assert.match(text, /\*\*Grenze: lockerer\*\*/);
  assert.match(text, /Treffer im ganzen Repo: auf master 1, mit diesem PR 0\./);
  assert.match(text, /„Zahl vier“: auf master gestoppt, mit diesem PR durchgelassen/);
});

test("mit einem Fehlalarm-Beispiel, das master meldet und der PR nicht mehr, reicht die Freigabe", async (context) => {
  const scenario = {
    basisFiles: LIMIT_CHECK_FILES,
    changes: {
      "tools/grenze.mjs": limitCheck(RAISED_LIMIT),
      "test/werkzeuge/fehlalarme/grenze/zwoelf.json": numberCase(
        "Zwölf ist erlaubt",
        ALLOWED_NUMBER,
      ),
    },
  };
  const unapproved = await check(context, scenario);
  assert.equal(unapproved.status, EXIT_FAILURE);
  assert.doesNotMatch(unapproved.stdout, /Muss geändert werden/);
  const approved = await check(context, { ...scenario, approval: "aktuell" });
  assert.equal(approved.status, EXIT_OK, approved.stdout);
});

test("eine strenger gewordene Prüfung braucht eine Freigabe, aber kein Fehlalarm-Beispiel", async (context) => {
  const result = await check(context, {
    basisFiles: { ...LIMIT_CHECK_FILES, "zahl.txt": `${LOWER_LIMIT}\n` },
    changes: { "tools/grenze.mjs": limitCheck(STRICTER_LIMIT) },
    approval: "aktuell",
  });
  assert.equal(result.status, EXIT_OK, result.stdout);
  assert.match(comment(result), /\*\*Grenze: strenger\*\*/);
  assert.match(comment(result), /Treffer im ganzen Repo: auf master 0, mit diesem PR 1\./);
});

test("ein neues npm-Paket wartet auf Freigabe, die Zusammenfassung nennt Alter, Downloads, Lizenz und Meldungen", async (context) => {
  const advisory = {
    severity: "high",
    title: "Prototype Pollution",
    url: "https://example.invalid/meldung",
  };
  const scenario = {
    basisFiles: { "package.json": packageManifest({}), "package-lock.json": lockfile({}) },
    changes: {
      "package.json": packageManifest({ neu: "^2.0.0" }),
      "package-lock.json": lockfile({ neu: "2.0.0" }),
    },
    packages: {
      neu: {
        version: "2.0.0",
        days: OLD_DAYS,
        license: "MIT",
        downloads: WEEKLY_DOWNLOADS,
        advisories: [advisory],
      },
    },
  };
  const unapproved = await check(context, scenario);
  assert.equal(unapproved.status, EXIT_FAILURE);
  assert.deepEqual(labelsSet(unapproved), ["art:pruefung"]);
  assert.match(unapproved.stdout, /Braucht Freigabe: Neue npm-Pakete: neu\./);
  assert.match(
    comment(unapproved),
    /\*\*neu 2\.0\.0\*\*: veröffentlicht vor 400 Tagen, 12\.345 Downloads in der letzten Woche, Lizenz MIT, bekannte Sicherheitsmeldungen: high: Prototype Pollution/,
  );
  const approved = await check(context, { ...scenario, approval: "aktuell" });
  assert.equal(approved.status, EXIT_OK, approved.stdout);
});

test("ein Versionssprung braucht nur dann eine Freigabe, wenn die neue Version jünger als sieben Tage ist", async (context) => {
  const bump = (days) => ({
    basisFiles: {
      "package.json": packageManifest({ alt: "^1.0.0" }),
      "package-lock.json": lockfile({ alt: "1.0.0" }),
    },
    changes: {
      "package.json": packageManifest({ alt: "^1.1.0" }),
      "package-lock.json": lockfile({ alt: "1.1.0" }),
    },
    packages: { alt: { version: "1.1.0", days, license: "MIT" } },
  });
  const old = await check(context, bump(OLD_DAYS));
  assert.equal(old.status, EXIT_OK, old.stdout);
  assert.deepEqual(labelsSet(old), ["art:code"]);
  const young = await check(context, bump(YOUNG_DAYS));
  assert.equal(young.status, EXIT_FAILURE);
  assert.match(young.stdout, /alt 1\.1\.0 ist erst 2 Tage veröffentlicht, verlangt sind 7/);
});

test("ein geänderter Skript-Eintrag in package.json braucht eine Freigabe", async (context) => {
  const result = await check(context, {
    basisFiles: { "package.json": packageManifest({}) },
    changes: { "package.json": packageManifest({}, { test: "node --test --test-concurrency=1" }) },
  });
  assert.equal(result.status, EXIT_FAILURE);
  assert.deepEqual(labelsSet(result), ["art:pruefung"]);
  assert.match(result.stdout, /Geänderte Skript-Einträge in package\.json: test\./);
});

test("geänderte bestehende Tests, Prompts und Werkzeugtexte bekommen ihre eigene Art", async (context) => {
  const testFile = (expected) =>
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      `test("rechnet", () => assert.equal(1 + 1, ${expected}));`,
      "",
    ].join("\n");
  const existingTest = await check(context, {
    basisFiles: { "test/beispiel.test.js": testFile(RIGHT_SUM) },
    changes: { "test/beispiel.test.js": testFile(WRONG_SUM) },
  });
  assert.equal(existingTest.status, EXIT_OK, existingTest.stdout);
  assert.deepEqual(labelsSet(existingTest), ["art:tests-geaendert"]);
  const prompt = await check(context, {
    basisFiles: { "src/i18n/prompts/de.js": "export const text = 1;\n" },
    changes: { "src/i18n/prompts/de.js": "export const text = 2;\n" },
  });
  assert.equal(prompt.status, EXIT_OK, prompt.stdout);
  assert.deepEqual(labelsSet(prompt), ["art:gespraech"]);
  const pin = (text) => json({ "ohne Consult": { place_call: { description: text } } });
  const texts = await check(context, {
    basisFiles: { "test/werkzeuge/werkzeugtexte.json": pin("Ruft an.") },
    changes: { "test/werkzeuge/werkzeugtexte.json": pin("Ruft sofort an.") },
  });
  assert.equal(texts.status, EXIT_FAILURE);
  assert.deepEqual(labelsSet(texts), ["art:werkzeugtexte"]);
  assert.match(
    comment(texts),
    /ohne Consult › place_call › description\n {2}- vorher: „Ruft an\.“\n {2}- nachher: „Ruft sofort an\.“/,
  );
  const firstPin = await check(context, {
    changes: { "test/werkzeuge/werkzeugtexte.json": pin("Ruft an.") },
  });
  assert.equal(firstPin.status, EXIT_OK, firstPin.stdout);
  assert.match(comment(firstPin), /erstmals festgehalten \(1 Texte\); am Draht ändert sich nichts/);
});
