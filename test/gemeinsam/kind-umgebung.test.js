import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServer } from "../helpers.js";
import { konfigurationsNamen, namenAusQuelltext } from "../../tools/flaechen.mjs";
import { kindUmgebung } from "./kind-umgebung.mjs";

const WERKZEUG_VARIABLE = "KIND_UMGEBUNG_TEST_WERKZEUG";
const SPUR_VARIABLE = "KIND_UMGEBUNG_TEST_SPUR";
const MINDEST_KONFIG_NAMEN = 200;
const VORLADEN = [
  'import { writeFileSync } from "node:fs";',
  `const lesen = (name) => process.env[name] ?? null;`,
  `writeFileSync(process.env.${SPUR_VARIABLE}, JSON.stringify({`,
  `  werkzeug: lesen("${WERKZEUG_VARIABLE}"), smtp: lesen("SMTP_HOST"), kontext: lesen("NODE_TEST_CONTEXT"), token: lesen("GITHUB_TOKEN"),`,
  "}));",
  "",
].join("\n");

async function serverMitTestprozessUmgebung(werte, vorladen) {
  const ordner = mkdtempSync(join(tmpdir(), "kind-umgebung-"));
  const spur = join(ordner, "spur.json");
  const vorladeDatei = join(ordner, "vorladen.mjs");
  writeFileSync(vorladeDatei, vorladen);
  const vorher = { ...process.env };
  Object.assign(process.env, werte, { [SPUR_VARIABLE]: spur });
  process.env.NODE_OPTIONS = [vorher.NODE_OPTIONS, `--import ${pathToFileURL(vorladeDatei).href}`].filter(Boolean).join(" ");
  try {
    const server = await startServer();
    await server.stop();
    return JSON.parse(readFileSync(spur, "utf8"));
  } finally {
    for (const name of Object.keys({ ...werte, [SPUR_VARIABLE]: 1, NODE_OPTIONS: 1 })) {
      if (vorher[name] === undefined) delete process.env[name];
      else process.env[name] = vorher[name];
    }
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("eine Werkzeugvariable und das NODE_OPTIONS-Vorladen des Testprozesses kommen im gestarteten Server an", async () => {
  const angekommen = await serverMitTestprozessUmgebung({ [WERKZEUG_VARIABLE]: "mutant-7" }, VORLADEN);
  assert.equal(angekommen.werkzeug, "mutant-7");
});

test("Konfigurationsname, Testrunner-Kontext und Geheimnis des Testprozesses kommen im Server nicht an", async () => {
  const angekommen = await serverMitTestprozessUmgebung(
    { SMTP_HOST: "smtp.aus-der-shell.test", NODE_TEST_CONTEXT: "child-v8", GITHUB_TOKEN: "ghs_nur_im_testprozess" },
    VORLADEN,
  );
  assert.deepEqual(angekommen, { werkzeug: null, smtp: null, kontext: null, token: null });
});

test("zusatz gewinnt gegen die Basis, undefined entfernt, NODE_OPTIONS wird verkettet", () => {
  const vorher = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--no-warnings";
  try {
    const umgebung = kindUmgebung({ SMTP_HOST: "aus-dem-test", PATH: undefined, NODE_OPTIONS: "--import x.mjs" });
    assert.equal(umgebung.SMTP_HOST, "aus-dem-test");
    assert.equal("PATH" in umgebung, false);
    assert.equal(umgebung.NODE_OPTIONS, "--no-warnings --import x.mjs");
  } finally {
    if (vorher === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = vorher;
  }
});

test("die Konfigurationsnamen umfassen auch bedingt gelesene Namen", () => {
  const namen = konfigurationsNamen(fileURLToPath(new URL("../../", import.meta.url)));
  assert.ok(namen.size > MINDEST_KONFIG_NAMEN, `nur ${namen.size} Namen erkannt`);
  for (const name of ["SMTP_HOST", "GATEWAY_URL"]) assert.ok(namen.has(name), name);
});

test("ein Zugriff auf die Umgebung, der keinen Namen nennt, bricht ab, statt Namen zu verschweigen", () => {
  assert.deepEqual([...namenAusQuelltext("const a = process.env.A_NAME; if (x) process.env.B_NAME;")], ["A_NAME", "B_NAME"]);
  assert.throws(() => namenAusQuelltext("const a = process.env[name];"), /nicht mehr ermittelbar/);
  assert.throws(() => namenAusQuelltext("const umgebung = process.env;"), /nicht mehr ermittelbar/);
});
