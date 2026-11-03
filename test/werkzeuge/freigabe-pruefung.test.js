import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
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
const RIGHT_SUM = 2;
const WRONG_SUM = 3;
const JSON_INDENT = 2;
const HTTP_OK = 200;
const AUFRUFER = [".githooks", ".github/workflows"];
const AUFGERUFENES_SKRIPT = /\bscripts\/[\w./-]+\.(?:c?m?js|sh)\b/g;

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
  const entries = Object.entries(changes);
  for (const [path] of entries.filter(([, text]) => text === null)) rmSync(join(directory, path));
  writeFiles(directory, Object.fromEntries(entries.filter(([, text]) => text !== null)));
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
  const oldApproval = await check(context, { ...scenario, approval: "alt" });
  assert.equal(oldApproval.status, EXIT_FAILURE);
  const approved = await check(context, { ...scenario, approval: "aktuell" });
  assert.equal(approved.status, EXIT_OK, approved.stdout);
  assert.match(approved.stdout, /Freigegeben von Antonio20045/);
});

function vonHookUndCiAufgerufeneSkripte() {
  const texte = AUFRUFER.flatMap((ordner) =>
    readdirSync(join(REPO_ROOT, ordner)).map((datei) =>
      readFileSync(join(REPO_ROOT, ordner, datei), "utf8"),
    ),
  );
  return [...new Set(texte.flatMap((text) => text.match(AUFGERUFENES_SKRIPT) ?? []))].sort();
}

test("ein Prüfskript unter scripts/, das Hook oder CI aufrufen, wartet mit den echten CODEOWNERS auf eine Freigabe", async (context) => {
  const skripte = vonHookUndCiAufgerufeneSkripte();
  assert.ok(skripte.includes("scripts/check-staged-suppressions.js"), skripte.join(", "));
  const mitInhalt = (inhalt) => Object.fromEntries(skripte.map((pfad) => [pfad, inhalt]));
  const result = await check(context, {
    basisFiles: {
      ".github/CODEOWNERS": readFileSync(join(REPO_ROOT, ".github/CODEOWNERS"), "utf8"),
      ...mitInhalt("export const streng = true;\n"),
    },
    changes: mitInhalt("export const streng = false;\n"),
  });
  assert.equal(result.status, EXIT_FAILURE, result.stdout);
  assert.deepEqual(labelsSet(result), ["art:pruefung"]);
  const freigabe = result.stdout
    .split("\n")
    .find((zeile) => zeile.includes("Bestehende Prüfungsdateien"));
  for (const pfad of skripte)
    assert.ok(freigabe?.includes(pfad), `${pfad} fehlt in: ${result.stdout}`);
});

test("eine neu angelegte Prüfung braucht keine Freigabe", async (context) => {
  const result = await check(context, {
    changes: { "tools/neue-pruefung.mjs": "export const neu = true;\n" },
  });
  assert.equal(result.status, EXIT_OK, result.stdout);
  assert.deepEqual(labelsSet(result), ["art:pruefung"]);
});

const PROBE_FALL = "test/werkzeuge/rotproben/grenze/vier.json";

test("eine gelockerte Prüfung, deren Rot-Probe am PR-Kopf durchgeht, bleibt auch mit Freigabe rot", async (context) => {
  const result = await check(context, {
    basisFiles: LIMIT_CHECK_FILES,
    changes: { "tools/grenze.mjs": limitCheck(RAISED_LIMIT) },
    approval: "aktuell",
  });
  assert.equal(result.status, EXIT_FAILURE, result.stdout);
  assert.ok(
    result.stdout.includes(
      `Muss geändert werden: Die Rot-Probe ${PROBE_FALL} der Prüfung „Grenze“ ist nicht mehr rot (durchgelassen).`,
    ),
    result.stdout,
  );
  assert.match(result.stdout, /Wozu: Jede Prüfung mit Rot-Proben/);
});

test("eine geänderte Prüfung, die ihre Rot-Proben weiter stoppt, braucht nur die Freigabe", async (context) => {
  const scenario = {
    basisFiles: LIMIT_CHECK_FILES,
    changes: { "tools/grenze.mjs": limitCheck(STRICTER_LIMIT) },
  };
  const unapproved = await check(context, scenario);
  assert.equal(unapproved.status, EXIT_FAILURE, unapproved.stdout);
  assert.doesNotMatch(unapproved.stdout, /Muss geändert werden/);
  const approved = await check(context, { ...scenario, approval: "aktuell" });
  assert.equal(approved.status, EXIT_OK, approved.stdout);
  assert.match(approved.stdout, /Keine offene Freigabe\./);
});

test("ein geänderter Fall unter den Rot-Proben läuft am PR-Kopf und macht den PR rot, wenn er durchgeht", async (context) => {
  const result = await check(context, {
    basisFiles: LIMIT_CHECK_FILES,
    changes: { [PROBE_FALL]: numberCase("Zahl zwei", STRICTER_LIMIT) },
    approval: "aktuell",
  });
  assert.equal(result.status, EXIT_FAILURE, result.stdout);
  assert.match(result.stdout, /Die Rot-Probe test\/werkzeuge\/rotproben\/grenze\/vier\.json der Prüfung „Grenze“ ist nicht mehr rot/);
});

test("ein PR, der weder die Prüfung noch ihre Rot-Proben ändert, fährt die Rot-Proben nicht", async (context) => {
  const result = await check(context, {
    basisFiles: { ...LIMIT_CHECK_FILES, "tools/grenze.mjs": limitCheck(RAISED_LIMIT), "src/app.js": "export const wert = 1;\n" },
    changes: { "src/app.js": "export const wert = 2;\n" },
  });
  assert.equal(result.status, EXIT_OK, result.stdout);
  assert.doesNotMatch(result.stdout, /Rot-Probe/);
});

test("eine Rot-Probe, deren Werkzeug fehlt, gilt als nicht mehr rot", async (context) => {
  const manifest = json({ titel: "Ohne Werkzeug", pfade: ["tools/ohne.mjs"], probe: { befehl: ["hermes-werkzeug-gibt-es-nicht"] } });
  const result = await check(context, {
    basisFiles: {
      "tools/ohne.mjs": "export const a = 1;\n",
      "test/werkzeuge/rotproben/ohne/pruefung.json": manifest,
      "test/werkzeuge/rotproben/ohne/fall.json": json({ titel: "Fall", dateien: { "x.txt": "x" } }),
    },
    changes: { "tools/ohne.mjs": "export const a = 2;\n" },
    approval: "aktuell",
  });
  assert.equal(result.status, EXIT_FAILURE, result.stdout);
  assert.match(result.stdout, /Die Rot-Probe test\/werkzeuge\/rotproben\/ohne\/fall\.json der Prüfung „Ohne Werkzeug“ ist nicht mehr rot \(nicht ausgeführt\)\./);
});

test("ein neues npm-Paket wartet auf Freigabe, das Log nennt Alter, Downloads, Lizenz und Meldungen", async (context) => {
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
    unapproved.stdout,
    /Neues Paket neu 2\.0\.0: veröffentlicht vor 400 Tagen, 12\.345 Downloads in der letzten Woche, Lizenz MIT, bekannte Sicherheitsmeldungen: high: Prototype Pollution/,
  );
  const approved = await check(context, { ...scenario, approval: "aktuell" });
  assert.equal(approved.status, EXIT_OK, approved.stdout);
});

test("ein Versionssprung braucht keine Freigabe, das Mindestalter misst der Pflicht-Check Lieferkette", async (context) => {
  const result = await check(context, {
    basisFiles: {
      "package.json": packageManifest({ alt: "^1.0.0" }),
      "package-lock.json": lockfile({ alt: "1.0.0" }),
    },
    changes: {
      "package.json": packageManifest({ alt: "^1.1.0" }),
      "package-lock.json": lockfile({ alt: "1.1.0" }),
    },
    packages: { alt: { version: "1.1.0", days: YOUNG_DAYS, license: "MIT" } },
  });
  assert.equal(result.status, EXIT_OK, result.stdout);
  assert.deepEqual(labelsSet(result), ["art:code"]);
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

test("geänderte Prompts und Werkzeugtexte bekommen ihre eigene Art, geänderte bestehende Tests sind art:code", async (context) => {
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
  assert.deepEqual(labelsSet(existingTest), ["art:code"]);
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
  assert.match(texts.stdout, /Braucht Freigabe: Werkzeugtexte aus tools\/list geändert: test\/werkzeuge\/werkzeugtexte\.json\./);
  const firstPin = await check(context, {
    changes: { "test/werkzeuge/werkzeugtexte.json": pin("Ruft an.") },
  });
  assert.equal(firstPin.status, EXIT_OK, firstPin.stdout);
});

const AGENTEN_KONFIG = "src/conversation/elevenlabs-agent-config";
const konfig = (wert) => `export const wert = ${wert};\n`;

async function freigabeArt(context, basisFiles, changes) {
  const result = await check(context, { basisFiles, changes });
  assert.equal(result.status, EXIT_OK, result.stdout + result.stderr);
  return labelsSet(result);
}

test("die nach .ts umbenannte Agenten-Konfiguration bleibt art:gespraech", async (context) => {
  const art = await freigabeArt(
    context,
    { [`${AGENTEN_KONFIG}.js`]: konfig(1) },
    { [`${AGENTEN_KONFIG}.js`]: null, [`${AGENTEN_KONFIG}.ts`]: konfig(2) },
  );
  assert.deepEqual(art, ["art:gespraech"]);
});

test("eine Änderung an der schon umbenannten Agenten-Konfiguration ist art:gespraech", async (context) => {
  const art = await freigabeArt(
    context,
    { [`${AGENTEN_KONFIG}.ts`]: konfig(1) },
    { [`${AGENTEN_KONFIG}.ts`]: konfig(2) },
  );
  assert.deepEqual(art, ["art:gespraech"]);
});

test("eine fremde .ts-Datei mit ähnlichem Namen wie die Agenten-Konfiguration ist art:code", async (context) => {
  const art = await freigabeArt(context, { "src/app.js": konfig(1) }, { [`${AGENTEN_KONFIG}2.ts`]: konfig(2) });
  assert.deepEqual(art, ["art:code"]);
});

test("neben der vorhandenen Agenten-Konfiguration als .js ist ihr .ts-Zwilling art:code", async (context) => {
  const art = await freigabeArt(
    context,
    { [`${AGENTEN_KONFIG}.js`]: konfig(1), [`${AGENTEN_KONFIG}.ts`]: konfig(1) },
    { [`${AGENTEN_KONFIG}.ts`]: konfig(2) },
  );
  assert.deepEqual(art, ["art:code"]);
});

const KNIP = "tools/basis/knip.json";
const findings = (...befunde) => json({ befunde });
const ONE_FINDING = findings("a");

test("eine nur gekürzte Basisliste unter tools/basis/ braucht eine Freigabe", async (context) => {
  const scenario = { basisFiles: { [KNIP]: findings("a", "b") }, changes: { [KNIP]: ONE_FINDING } };
  const unapproved = await check(context, scenario);
  assert.equal(unapproved.status, EXIT_FAILURE, unapproved.stdout);
  assert.deepEqual(labelsSet(unapproved), ["art:pruefung"]);
  const approved = await check(context, { ...scenario, approval: "aktuell" });
  assert.equal(approved.status, EXIT_OK, approved.stdout);
});

const MIN_BASISVERGLEICH_WERKZEUGE = 9;
const BASISVERGLEICH_AUFRUF = /basis-vergleich\.mjs <([^>]+)>/;

function basislinienDesBasisvergleichs() {
  const aufruf = runIn(REPO_ROOT, process.execPath, [join(REPO_ROOT, "tools/basis-vergleich.mjs")]);
  const werkzeuge = BASISVERGLEICH_AUFRUF.exec(aufruf.stderr)?.[1].split("|") ?? [];
  assert.ok(werkzeuge.length >= MIN_BASISVERGLEICH_WERKZEUGE, aufruf.stderr);
  return werkzeuge.map((werkzeug) => `tools/basis/${werkzeug}.json`);
}

test("ein neuer Eintrag in einer Basislinie von basis-vergleich wartet mit den echten CODEOWNERS auf eine Freigabe", async (context) => {
  const owners = readFileSync(join(REPO_ROOT, ".github/CODEOWNERS"), "utf8");
  for (const basislinie of basislinienDesBasisvergleichs()) {
    const scenario = {
      basisFiles: { ".github/CODEOWNERS": owners, [basislinie]: ONE_FINDING },
      changes: { [basislinie]: findings("a", "neu") },
    };
    const unapproved = await check(context, scenario);
    assert.equal(unapproved.status, EXIT_FAILURE, `${basislinie}: ${unapproved.stdout}`);
    assert.ok(
      unapproved.stdout.includes(
        `Braucht Freigabe: Bestehende Prüfungsdateien geändert oder gelöscht: ${basislinie}.`,
      ),
      unapproved.stdout,
    );
    const approved = await check(context, { ...scenario, approval: "aktuell" });
    assert.equal(approved.status, EXIT_OK, `${basislinie}: ${approved.stdout}`);
  }
});
