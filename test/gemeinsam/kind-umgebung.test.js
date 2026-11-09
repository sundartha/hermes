import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startServer } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

const MUTANT = "__STRYKER_ACTIVE_MUTANT__";
const vorladen = (spur) =>
  [
    'import { writeFileSync } from "node:fs";',
    "const lesen = (name) => process.env[name] ?? null;",
    `writeFileSync(${JSON.stringify(spur)}, JSON.stringify({`,
    `  mutant: lesen("${MUTANT}"), smtp: lesen("SMTP_HOST"), kontext: lesen("NODE_TEST_CONTEXT"), token: lesen("GITHUB_TOKEN"), geheimnis: lesen("SESSION_SECRET"),`,
    "}));",
    "",
  ].join("\n");
const STRYKER_KOPF = `globalThis.__stryker__ = { activeMutant: process.env.${MUTANT} };\n`;

async function serverMitTestprozessUmgebung(werte) {
  const ordner = mkdtempSync(join(tmpdir(), "kind-umgebung-"));
  const spur = join(ordner, "spur.json");
  const vorladeDatei = join(ordner, "vorladen.mjs");
  writeFileSync(vorladeDatei, vorladen(spur));
  const optionen = `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(vorladeDatei).href}`.trim();
  try {
    return await mitUmgebung({ ...werte, NODE_OPTIONS: optionen }, async () => {
      const server = await startServer();
      await server.stop();
      return JSON.parse(readFileSync(spur, "utf8"));
    });
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

async function mitUmgebung(werte, arbeit) {
  const vorher = { ...process.env };
  Object.assign(process.env, werte);
  try {
    return await arbeit();
  } finally {
    for (const name of Object.keys(werte)) {
      if (vorher[name] === undefined) delete process.env[name];
      else process.env[name] = vorher[name];
    }
  }
}

test("Mutant und das NODE_OPTIONS-Vorladen des Testprozesses kommen im gestarteten Server an", async () => {
  const angekommen = await serverMitTestprozessUmgebung({ [MUTANT]: "7" });
  assert.equal(angekommen.mutant, "7");
});

test("ein Kind mit Stryker-Kopf, das den Mutanten selbst liest, bekommt ihn trotzdem", async () => {
  const ordner = mkdtempSync(join(tmpdir(), "kind-umgebung-kopf-"));
  const datei = join(ordner, "mutierte-konfiguration.mjs");
  writeFileSync(datei, `${STRYKER_KOPF}console.log(globalThis.__stryker__.activeMutant);\n`);
  try {
    const ausgabe = await mitUmgebung({ [MUTANT]: "7" }, () =>
      execFileSync(process.execPath, [datei], { env: kindUmgebung(), encoding: "utf8" }),
    );
    assert.equal(ausgabe.trim(), "7");
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

test("Konfigurationsname, Geheimnisse und Testrunner-Kontext des Testprozesses kommen im Server nicht an", async () => {
  const angekommen = await serverMitTestprozessUmgebung({
    SMTP_HOST: "smtp.aus-der-shell.test",
    NODE_TEST_CONTEXT: "child-v8",
    GITHUB_TOKEN: "ghs_nur_im_testprozess",
    SESSION_SECRET: "nur-im-testprozess",
  });
  assert.deepEqual(angekommen, { mutant: null, smtp: null, kontext: null, token: null, geheimnis: null });
});

test("Werkzeug- und Laufzeitnamen gehen durch, alles andere nicht", async () => {
  const werkzeug = ["NODE_V8_COVERAGE", "STRYKER_ZUSTAND", "TESTKOSTEN_DATEI", "NETZ_BEOBACHTER_LOG", "LC_ALL", "PATH", "HOME"];
  const fremd = ["SMTP_HOST", "GATEWAY_URL", "ANTHROPIC_API_KEY", "SESSION_SECRET", "PATHEXT_FREMD", "NODE_ENV"];
  const werte = Object.fromEntries([...werkzeug, ...fremd].map((name) => [name, "wert"]));
  const umgebung = await mitUmgebung(werte, () => kindUmgebung());
  for (const name of werkzeug) assert.equal(umgebung[name], "wert", name);
  for (const name of fremd) assert.equal(name in umgebung, false, name);
});

test("zusatz gewinnt gegen die Basis, undefined entfernt, NODE_OPTIONS wird verkettet", async () => {
  const umgebung = await mitUmgebung({ NODE_OPTIONS: "--no-warnings" }, () =>
    kindUmgebung({ SMTP_HOST: "aus-dem-test", PATH: undefined, NODE_OPTIONS: "--import x.mjs" }),
  );
  assert.equal(umgebung.SMTP_HOST, "aus-dem-test");
  assert.equal("PATH" in umgebung, false);
  assert.equal(umgebung.NODE_OPTIONS, "--no-warnings --import x.mjs");
});
