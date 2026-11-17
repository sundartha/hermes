import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, test } from "node:test";

const COMMIT = "d".repeat(40);
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

function nachtlaufIssue(vorMinuten) {
  return {
    number: 12,
    title: "Staging-Nachtlauf rot",
    user: { login: "github-actions[bot]" },
    updated_at: new Date(Date.now() - vorMinuten * MINUTE).toISOString(),
  };
}

async function aufrufen({ mitAdresse = true, antwort = 200, offene = [] } = {}) {
  const empfangen = [];
  const betterStack = await dienstStarten((anfrage, roh, rueckgabe) => {
    empfangen.push({ methode: anfrage.method, pfad: anfrage.url, koerper: JSON.parse(roh) });
    rueckgabe.writeHead(antwort);
    rueckgabe.end();
  });
  const github = await dienstStarten((anfrage, _roh, rueckgabe) => {
    rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    rueckgabe.end(JSON.stringify(anfrage.method === "GET" ? offene : { number: 9 }));
  });
  const adresse = `http://127.0.0.1:${betterStack}/geheim-pfad`;
  const env = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "77",
    GITHUB_API_URL: `http://127.0.0.1:${github}`,
    ...(mitAdresse ? { BETTER_STACK_ALERT_URL: adresse } : {}),
  };
  const kind = spawn("node", ["tools/deploy-weg.mjs", "hoertest", "--anlass", "nachtlauf", "--commit", COMMIT, "--teile", ""], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  return { empfangen, ausgabe, code, adresse };
}

test("Roter Nachtlauf: genau ein Vorfall mit Titel, Commit, Lauf, Umgebung und erstem Schritt geht an die Better-Stack-Adresse", async () => {
  const { empfangen, code } = await aufrufen();
  assert.equal(code, 0);
  assert.equal(empfangen.length, 1);
  assert.equal(empfangen[0].methode, "POST");
  assert.equal(empfangen[0].pfad, "/geheim-pfad");
  const { incident, text } = empfangen[0].koerper;
  assert.deepEqual(incident, { id: "nachtlauf-staging", status: "alert" });
  assert.match(text, /Staging-Nachtlauf rot/);
  assert.match(text, new RegExp(COMMIT));
  assert.match(text, /https:\/\/github\.com\/sundartha\/hermes\/actions\/runs\/77/);
  assert.match(text, /Staging/);
  assert.match(text, /Erster Schritt: Ursache im Lauf lesen/);
});

test("Entprellen: ein offenes Nachtlauf-Issue, vor 59 Minuten geändert, löst keinen zweiten Vorfall aus", async () => {
  const { empfangen, code, ausgabe } = await aufrufen({ offene: [nachtlaufIssue(59)] });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 0);
  assert.match(ausgabe, /Nachtlauf-Issue #12: Text ersetzt/);
  assert.match(ausgabe, /Better Stack: kein neuer Vorfall/);
});

test("Entprellen: ein offenes Nachtlauf-Issue, vor 61 Minuten geändert, löst einen neuen Vorfall aus", async () => {
  const { empfangen, code } = await aufrufen({ offene: [nachtlaufIssue(61)] });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 1);
});

test("Ohne Secret überspringt der Schritt sauber, sagt das im Lauf und bleibt grün", async () => {
  const { empfangen, code, ausgabe } = await aufrufen({ mitAdresse: false });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 0);
  assert.match(ausgabe, /Better Stack: übersprungen \(BETTER_STACK_ALERT_URL fehlt\)/);
});

test("Der Lauf nennt die Adresse nie und meldet das Senden", async () => {
  const { ausgabe: roh, adresse } = await aufrufen();
  assert.ok(roh.includes("::add-mask::" + adresse));
  const sichtbar = roh.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::")).join("\n");
  assert.ok(!sichtbar.includes(adresse));
  assert.ok(!sichtbar.includes("geheim-pfad"));
  assert.match(sichtbar, /Better Stack: Vorfall gesendet/);
});

test("Nimmt Better Stack den Vorfall nicht an, bleibt der Lauf grün und nennt nur den Status", async () => {
  const { code, ausgabe, adresse } = await aufrufen({ antwort: 500 });
  assert.equal(code, 0);
  assert.match(ausgabe, /Better Stack: nicht zugestellt \(HTTP 500\)/);
  const sichtbar = ausgabe.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::"));
  assert.ok(!sichtbar.join("\n").includes(adresse));
});

test("Workflow: das Secret geht nur in den Schritt „Roten Nachtlauf melden“, es gibt keinen weiteren Schritt dafür", () => {
  assert.match(
    WORKFLOW,
    /- name: Roten Nachtlauf melden\n {8}if: failure\(\) && github\.event_name == 'schedule'\n {8}env:\n {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n {10}BETTER_STACK_ALERT_URL: \$\{\{ secrets\.BETTER_STACK_ALERT_URL \}\}\n/,
  );
  assert.equal(WORKFLOW.match(/BETTER_STACK_ALERT_URL/g).length, 4);
});
