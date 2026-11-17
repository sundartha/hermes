import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, test } from "node:test";

const COMMIT = "e".repeat(40);
const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const server = [];
const MINUTE = 60 * 1000;

after(() => {
  for (const eintrag of server) eintrag.close();
});

function dienstStarten(behandeln) {
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => behandeln(anfrage, Buffer.concat(teile).toString(), rueckgabe));
  });
  server.push(dienst);
  return new Promise((fertig) => dienst.listen(0, "127.0.0.1", () => fertig(dienst.address().port)));
}

function deployIssue(vorMinuten) {
  return {
    number: 31,
    title: "Staging-Deploy rot",
    user: { login: "github-actions[bot]" },
    updated_at: new Date(Date.now() - vorMinuten * MINUTE).toISOString(),
  };
}

async function aufrufen({ mitAdresse = true, antwort = 200, offene = [] } = {}) {
  const empfangen = [];
  const geschrieben = [];
  const betterStack = await dienstStarten((anfrage, roh, rueckgabe) => {
    empfangen.push({ methode: anfrage.method, pfad: anfrage.url, koerper: JSON.parse(roh) });
    rueckgabe.writeHead(antwort);
    rueckgabe.end();
  });
  const github = await dienstStarten((anfrage, roh, rueckgabe) => {
    if (anfrage.method !== "GET") geschrieben.push({ methode: anfrage.method, koerper: JSON.parse(roh) });
    rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    rueckgabe.end(JSON.stringify(anfrage.method === "GET" ? offene : { number: 9 }));
  });
  const adresse = `http://127.0.0.1:${betterStack}/geheim-pfad`;
  const env = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "78",
    GITHUB_API_URL: `http://127.0.0.1:${github}`,
    ...(mitAdresse ? { BETTER_STACK_ALERT_URL: adresse } : {}),
  };
  const kind = spawn("node", ["tools/deploy-weg.mjs", "hoertest", "--anlass", "staginglauf", "--commit", COMMIT, "--teile", ""], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  return { empfangen, geschrieben, ausgabe, code, adresse };
}

test("Roter Staging-Deploy: genau ein Vorfall mit Titel, Commit, Lauf, Umgebung und erstem Schritt geht an Better Stack", async () => {
  const { empfangen, code } = await aufrufen();
  assert.equal(code, 0);
  assert.equal(empfangen.length, 1);
  assert.equal(empfangen[0].methode, "POST");
  assert.equal(empfangen[0].pfad, "/geheim-pfad");
  const { incident, text } = empfangen[0].koerper;
  assert.deepEqual(incident, { id: "deploy-staging", status: "alert" });
  assert.match(text, /Staging-Deploy rot/);
  assert.match(text, new RegExp(COMMIT));
  assert.match(text, /https:\/\/github\.com\/sundartha\/hermes\/actions\/runs\/78/);
  assert.match(text, /Staging/);
  assert.match(text, /Erster Schritt: Ursache im Lauf lesen/);
});

test("Das Issue „Staging-Deploy rot“ wird angelegt und hängt nicht am nächsten Lauf", async () => {
  const { geschrieben, ausgabe } = await aufrufen();
  assert.equal(geschrieben.length, 1);
  assert.equal(geschrieben[0].methode, "POST");
  assert.equal(geschrieben[0].koerper.title, "Staging-Deploy rot");
  assert.match(geschrieben[0].koerper.body, new RegExp(COMMIT));
  assert.match(ausgabe, /Staging-Deploy-Issue #9 angelegt/);
  assert.ok(!/state/.test(JSON.stringify(geschrieben[0].koerper)));
  assert.ok(!/closed/.test(WORKFLOW));
});

test("Entprellen: offenes Issue vor 59 Minuten geändert löst keinen zweiten Vorfall aus", async () => {
  const { empfangen, code, ausgabe } = await aufrufen({ offene: [deployIssue(59)] });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 0);
  assert.match(ausgabe, /Staging-Deploy-Issue #31: Text ersetzt/);
  assert.match(ausgabe, /Better Stack: kein neuer Vorfall/);
});

test("Entprellen: offenes Issue vor 61 Minuten geändert löst einen neuen Vorfall aus", async () => {
  const { empfangen, code } = await aufrufen({ offene: [deployIssue(61)] });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 1);
});

test("Ohne Secret überspringt der Schritt sauber und bleibt grün", async () => {
  const { empfangen, code, ausgabe } = await aufrufen({ mitAdresse: false });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 0);
  assert.match(ausgabe, /Better Stack: übersprungen \(BETTER_STACK_ALERT_URL fehlt\)/);
});

test("Nimmt Better Stack nicht an (HTTP 500), bleibt der Lauf grün und nennt nur den Status", async () => {
  const { code, ausgabe } = await aufrufen({ antwort: 500 });
  assert.equal(code, 0);
  assert.match(ausgabe, /Better Stack: nicht zugestellt \(HTTP 500\)/);
});

test("Die Adresse steht nie im sichtbaren Lauf-Log", async () => {
  const { ausgabe: roh, adresse } = await aufrufen();
  assert.ok(roh.includes("::add-mask::" + adresse));
  const sichtbar = roh.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::")).join("\n");
  assert.ok(!sichtbar.includes(adresse));
  assert.ok(!sichtbar.includes("geheim-pfad"));
  assert.match(sichtbar, /Better Stack: Vorfall gesendet/);
});

test("Workflow: der Schritt für den Staging-Deploy läuft nur bei failure() auf push und bekommt das Secret allein", () => {
  assert.match(
    WORKFLOW,
    /- name: Roten Staging-Deploy melden\n {8}if: failure\(\) && github\.event_name == 'push'\n {8}env:\n {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n {10}BETTER_STACK_ALERT_URL: \$\{\{ secrets\.BETTER_STACK_ALERT_URL \}\}\n {8}run: node tools\/deploy-weg\.mjs hoertest --anlass staginglauf --commit "\$GITHUB_SHA" --teile ""\n/,
  );
  assert.equal(WORKFLOW.match(/BETTER_STACK_ALERT_URL/g).length, 4);
});
