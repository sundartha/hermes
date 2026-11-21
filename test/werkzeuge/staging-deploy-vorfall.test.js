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
    /- name: Roten Staging-Deploy melden\n {8}if: failure\(\) && github\.event_name == 'push'\n {8}env:\n {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n {10}BETTER_STACK_ALERT_URL: \$\{\{ secrets\.BETTER_STACK_ALERT_URL \}\}\n {10}SLACK_ALERT_URL: \$\{\{ secrets\.SLACK_ALERT_URL \}\}\n {8}run: node tools\/deploy-weg\.mjs hoertest --anlass staginglauf --commit "\$GITHUB_SHA" --teile ""\n/,
  );
  assert.equal(WORKFLOW.match(/BETTER_STACK_ALERT_URL/g).length, 6);
});

async function mitSlack({ slack = true, betterStack = false, slackAntwort = 200, offene = [], anlass = "staginglauf" } = {}) {
  const empfangen = [];
  const dienst = (name, antwort) =>
    dienstStarten((anfrage, roh, rueckgabe) => {
      empfangen.push({ name, methode: anfrage.method, pfad: anfrage.url, koerper: JSON.parse(roh) });
      rueckgabe.writeHead(antwort);
      rueckgabe.end();
    });
  const slackPort = await dienst("slack", slackAntwort);
  const betterPort = await dienst("better", 200);
  const github = await dienstStarten((anfrage, roh, rueckgabe) => {
    rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    rueckgabe.end(JSON.stringify(anfrage.method === "GET" ? offene : { number: 9 }));
  });
  const slackAdresse = `http://127.0.0.1:${slackPort}/slack-geheim`;
  const env = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "78",
    GITHUB_API_URL: `http://127.0.0.1:${github}`,
    ...(slack ? { SLACK_ALERT_URL: slackAdresse } : {}),
    ...(betterStack ? { BETTER_STACK_ALERT_URL: `http://127.0.0.1:${betterPort}/bs` } : {}),
  };
  const kind = spawn("node", ["tools/deploy-weg.mjs", "hoertest", "--anlass", anlass, "--commit", COMMIT, "--teile", ""], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  const sichtbar = ausgabe.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::")).join("\n");
  return { empfangen, ausgabe, sichtbar, code, slackAdresse };
}

for (const anlass of ["nachtlauf", "staginglauf", "probe"]) {
  test(`Slack allein (${anlass}): genau ein POST mit Körper {text}, Ausgabe „Slack: Vorfall gesendet“`, async () => {
    const { empfangen, sichtbar, code } = await mitSlack({ anlass });
    assert.equal(code, 0);
    assert.equal(empfangen.length, 1);
    assert.equal(empfangen[0].name, "slack");
    assert.equal(empfangen[0].methode, "POST");
    assert.equal(empfangen[0].pfad, "/slack-geheim");
    assert.deepEqual(Object.keys(empfangen[0].koerper), ["text"]);
    assert.match(empfangen[0].koerper.text, new RegExp(COMMIT));
    assert.match(empfangen[0].koerper.text, /actions\/runs\/78/);
    assert.match(empfangen[0].koerper.text, /Umgebung: Staging/);
    assert.match(sichtbar, /Slack: Vorfall gesendet/);
    assert.doesNotMatch(sichtbar, /Better Stack: Vorfall gesendet/);
  });
}

test("Beide Wege: je ein POST, Slack zuerst, Better Stack bekommt den bisherigen Körper", async () => {
  const { empfangen, code } = await mitSlack({ betterStack: true });
  assert.equal(code, 0);
  assert.deepEqual(empfangen.map((eintrag) => eintrag.name), ["slack", "better"]);
  assert.deepEqual(Object.keys(empfangen[1].koerper), ["incident", "text"]);
  assert.deepEqual(empfangen[1].koerper.incident, { id: "deploy-staging", status: "alert" });
  assert.equal(empfangen[1].koerper.text, empfangen[0].koerper.text);
});

test("Ohne beide Secrets: Slack und Better Stack übersprungen, Exit 0, kein POST", async () => {
  const { empfangen, sichtbar, code } = await mitSlack({ slack: false });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 0);
  assert.match(sichtbar, /Slack: übersprungen \(SLACK_ALERT_URL fehlt\)/);
  assert.match(sichtbar, /Better Stack: übersprungen \(BETTER_STACK_ALERT_URL fehlt\)/);
});

test("Nimmt Slack nicht an (HTTP 300), bleibt Exit 0, nur der Status steht im Log, nie die Adresse", async () => {
  const { empfangen, ausgabe, sichtbar, code, slackAdresse } = await mitSlack({ slackAntwort: 300, betterStack: true });
  assert.equal(code, 0);
  assert.match(sichtbar, /Slack: nicht zugestellt \(HTTP 300\)/);
  assert.equal(empfangen.length, 2);
  assert.ok(ausgabe.includes("::add-mask::" + slackAdresse));
  assert.ok(!sichtbar.includes(slackAdresse));
  assert.ok(!sichtbar.includes("slack-geheim"));
});

test("Slack: HTTP 299 gilt als zugestellt", async () => {
  const { sichtbar } = await mitSlack({ slackAntwort: 299 });
  assert.match(sichtbar, /Slack: Vorfall gesendet/);
});

test("Entprellen gilt für beide Wege: Issue vor 59 Minuten geändert, kein POST, beide melden es", async () => {
  const gesperrt = await mitSlack({ betterStack: true, offene: [deployIssue(59)] });
  assert.equal(gesperrt.empfangen.length, 0);
  assert.match(gesperrt.sichtbar, /Slack: kein neuer Vorfall/);
  assert.match(gesperrt.sichtbar, /Better Stack: kein neuer Vorfall/);
  const frei = await mitSlack({ betterStack: true, offene: [deployIssue(61)] });
  assert.equal(frei.empfangen.length, 2);
});

test("Workflow: beide Melde-Schritte reichen SLACK_ALERT_URL aus den Secrets durch", () => {
  const schritte = WORKFLOW.split("- name: ").filter((teil) => /^Roten (Staging-Deploy|Nachtlauf) melden/.test(teil));
  assert.equal(schritte.length, 2);
  for (const schritt of schritte) assert.match(schritt, /\n {10}SLACK_ALERT_URL: \$\{\{ secrets\.SLACK_ALERT_URL \}\}\n/);
  assert.equal(WORKFLOW.match(/SLACK_ALERT_URL/g).length, 10);
});

async function alarmprobeLaufen({ slack = true, slackAntwort = 200 } = {}) {
  const empfangen = [];
  const dienst = (name, antwort) =>
    dienstStarten((anfrage, roh, rueckgabe) => {
      empfangen.push({ name, methode: anfrage.method, pfad: anfrage.url, roh });
      rueckgabe.writeHead(antwort, { "content-type": "application/json" });
      rueckgabe.end(JSON.stringify(deployIssue(1)));
    });
  const slackPort = await dienst("slack", slackAntwort);
  const betterPort = await dienst("better", 200);
  const github = await dienst("github", 200);
  const env = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "78",
    GITHUB_API_URL: `http://127.0.0.1:${github}`,
    BETTER_STACK_ALERT_URL: `http://127.0.0.1:${betterPort}/bs`,
    ...(slack ? { SLACK_ALERT_URL: `http://127.0.0.1:${slackPort}/slack-geheim` } : {}),
  };
  const kind = spawn("node", ["tools/deploy-weg.mjs", "alarmprobe"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  const sichtbar = ausgabe.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::")).join("\n");
  return { empfangen, sichtbar, code };
}

test("Alarmprobe: Slack antwortet 200, genau ein POST mit dem Probetext und Lauf-Adresse, Exit 0", async () => {
  const { empfangen, sichtbar, code } = await alarmprobeLaufen();
  assert.equal(code, 0);
  assert.equal(empfangen.length, 1);
  assert.equal(empfangen[0].name, "slack");
  assert.equal(empfangen[0].methode, "POST");
  assert.equal(empfangen[0].pfad, "/slack-geheim");
  assert.deepEqual(JSON.parse(empfangen[0].roh), {
    text: "Probe, kein echter Fehler (Alarmweg-Probe, Lauf https://github.com/sundartha/hermes/actions/runs/78)",
  });
  assert.match(sichtbar, /Slack: Vorfall gesendet/);
});

test("Alarmprobe: Slack antwortet 500, die Ausgabe nennt den Status", async () => {
  const { empfangen, sichtbar } = await alarmprobeLaufen({ slackAntwort: 500 });
  assert.equal(empfangen.length, 1);
  assert.match(sichtbar, /Slack: nicht zugestellt \(HTTP 500\)/);
  assert.doesNotMatch(sichtbar, /Vorfall gesendet/);
});

test("Alarmprobe: ohne SLACK_ALERT_URL steht übersprungen, nichts wird gesendet, Exit 1", async () => {
  const { empfangen, sichtbar, code } = await alarmprobeLaufen({ slack: false });
  assert.equal(code, 1);
  assert.equal(empfangen.length, 0);
  assert.match(sichtbar, /Slack: übersprungen \(SLACK_ALERT_URL fehlt\)/);
});

test("Alarmprobe: kein Issue, kein Better-Stack-Vorfall, keine Entprellung trotz frisch gemeldetem Vorfall", async () => {
  const { empfangen } = await alarmprobeLaufen();
  assert.deepEqual(empfangen.map((eintrag) => eintrag.name), ["slack"]);
});

test("Workflow: alarmprobe ist eine Eingabe mit Vorgabe false und der Schritt allein ruft den Befehl mit dem Slack-Secret", () => {
  assert.match(WORKFLOW, /\n {6}alarmprobe:\n {8}description: .+\n {8}type: boolean\n {8}default: false\n/);
  assert.match(
    WORKFLOW,
    /- name: Alarmweg-Probe nach Slack\n {8}if: github\.event_name == 'workflow_dispatch' && inputs\.alarmprobe\n {8}env:\n {10}SLACK_ALERT_URL: \$\{\{ secrets\.SLACK_ALERT_URL \}\}\n {8}run: node tools\/deploy-weg\.mjs alarmprobe\n/,
  );
  assert.match(WORKFLOW, /- name: Staging abwarten und prüfen[^\n]*\n {8}if: github\.event_name != 'workflow_dispatch' \|\| !inputs\.alarmprobe\n/);
  assert.match(WORKFLOW, /\n {4}if: github\.event_name == 'workflow_dispatch' && inputs\.lastlauf && !inputs\.alarmprobe\n/);
});

test("Workflow: mit alarmprobe laufen weder die Anrufprobe noch das Beenden offener Probe-Anrufe", () => {
  assert.match(
    WORKFLOW,
    /- name: Anrufprobe \(Kern in scripts\/anruf-probe\)\n {8}if: \$\{\{ \(success\(\) \|\| inputs\.absichtlich_rot\) && \(github\.event_name != 'workflow_dispatch' \|\| !inputs\.alarmprobe\) \}\}\n/,
  );
  assert.match(
    WORKFLOW,
    /- name: Offene Probe-Anrufe beenden\n {8}if: always\(\) && \(github\.event_name != 'workflow_dispatch' \|\| !inputs\.alarmprobe\)\n/,
  );
});

function jobBedingung(name, ereignis, eingaben) {
  const treffer = WORKFLOW.match(new RegExp(`\\n {2}${name}:\\n(?: {4}[^\\n]*\\n)*? {4}if: ([^\\n]+)\\n`));
  assert.ok(treffer, `Job ${name} hat eine Bedingung`);
  const github = { event_name: ereignis };
  return new Function("github", "inputs", `return Boolean(${treffer[1]});`)(github, eingaben);
}

const DISPATCH_TABELLE = [
  { alarmprobe: true, lastlauf: true, staging: true, lastlauf_job: false },
  { alarmprobe: true, lastlauf: false, staging: true, lastlauf_job: false },
  { alarmprobe: false, lastlauf: true, staging: false, lastlauf_job: true },
  { alarmprobe: false, lastlauf: false, staging: true, lastlauf_job: false },
];

for (const zeile of DISPATCH_TABELLE) {
  test(`Workflow: workflow_dispatch mit alarmprobe=${zeile.alarmprobe} und lastlauf=${zeile.lastlauf} startet staging=${zeile.staging}, lastlauf=${zeile.lastlauf_job}`, () => {
    const eingaben = { alarmprobe: zeile.alarmprobe, lastlauf: zeile.lastlauf };
    assert.equal(jobBedingung("staging", "workflow_dispatch", eingaben), zeile.staging);
    assert.equal(jobBedingung("lastlauf", "workflow_dispatch", eingaben), zeile.lastlauf_job);
  });
}

test("Workflow: push und schedule starten staging, nicht lastlauf", () => {
  for (const ereignis of ["push", "schedule"]) {
    assert.equal(jobBedingung("staging", ereignis, {}), true);
    assert.equal(jobBedingung("lastlauf", ereignis, {}), false);
  }
});
