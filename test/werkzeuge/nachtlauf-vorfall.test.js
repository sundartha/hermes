import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, test } from "node:test";

const COMMIT = "d".repeat(40);
const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

async function aufrufen({ mitAdresse = true, antwort = 200 } = {}) {
  const empfangen = [];
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      empfangen.push({ methode: anfrage.method, pfad: anfrage.url, koerper: JSON.parse(Buffer.concat(teile).toString()) });
      rueckgabe.writeHead(antwort);
      rueckgabe.end();
    });
  });
  await new Promise((fertig) => dienst.listen(0, "127.0.0.1", fertig));
  server.push(dienst);
  const adresse = `http://127.0.0.1:${dienst.address().port}/geheim-pfad`;
  const env = {
    PATH: process.env.PATH,
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "77",
    ...(mitAdresse ? { BETTER_STACK_ALERT_URL: adresse } : {}),
  };
  const kind = spawn("node", ["tools/deploy-weg.mjs", "vorfall", "--anlass", "nachtlauf", "--commit", COMMIT], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  return { empfangen, ausgabe, code, adresse };
}

test("Roter Nachtlauf: ein Vorfall mit Titel, Seit-wann, Umgebung und erstem Schritt geht an die Better-Stack-Adresse", async () => {
  const { empfangen, code } = await aufrufen();
  assert.equal(code, 0);
  assert.equal(empfangen.length, 1);
  assert.equal(empfangen[0].methode, "POST");
  assert.equal(empfangen[0].pfad, "/geheim-pfad");
  const { incident, text } = empfangen[0].koerper;
  assert.equal(incident.status, "alert");
  assert.match(incident.id, /^nachtlauf-staging-\d{4}-\d{2}-\d{2}T\d{2}$/);
  assert.match(text, /^Staging-Nachtlauf rot seit \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/);
  assert.match(text, /Umgebung: staging/);
  assert.match(text, /Commit d{40}/);
  assert.match(text, /Erster Schritt: .*https:\/\/github\.com\/sundartha\/hermes\/actions\/runs\/77/);
});

test("Ohne Secret überspringt der Schritt sauber, sagt das im Lauf und bleibt grün", async () => {
  const { empfangen, code, ausgabe } = await aufrufen({ mitAdresse: false });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 0);
  assert.match(ausgabe, /Vorfall übersprungen: BETTER_STACK_ALERT_URL ist nicht gesetzt/);
});

test("Der Lauf nennt die Adresse nie und meldet das Senden", async () => {
  const { ausgabe: roh, adresse } = await aufrufen();
  assert.ok(roh.includes("::add-mask::" + adresse));
  const sichtbar = roh.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::")).join("\n");
  assert.ok(!sichtbar.includes(adresse));
  assert.ok(!sichtbar.includes("geheim-pfad"));
  assert.match(sichtbar, /Vorfall an Better Stack gesendet/);
});

test("Nimmt Better Stack den Vorfall nicht an, wird der Schritt rot", async () => {
  const { code, ausgabe } = await aufrufen({ antwort: 500 });
  assert.equal(code, 1);
  assert.match(ausgabe, /Rot: Better Stack hat den Vorfall nicht angenommen: HTTP 500/);
});

test("Entprellen: derselbe Alarm in derselben Stunde trägt dieselbe Vorfall-Kennung, die nächste Stunde eine neue", async () => {
  const { nachtlaufVorfallMelden } = await import("../../tools/deploy-weg/hoertest.mjs");
  const { ausgabeAnlegen } = await import("../../tools/deploy-weg/ausgabe.mjs");
  const empfangen = [];
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      const { incident } = JSON.parse(Buffer.concat(teile).toString());
      empfangen.push(incident.id);
      rueckgabe.writeHead(200);
      rueckgabe.end();
    });
  });
  await new Promise((fertig) => dienst.listen(0, "127.0.0.1", fertig));
  server.push(dienst);
  const einstellungen = {
    vorfallUrl: `http://127.0.0.1:${dienst.address().port}/x`,
    serverUrl: "https://github.com",
    repository: "sundartha/hermes",
    runId: "1",
  };
  const ausgabe = ausgabeAnlegen(() => undefined);
  const um = (iso) => nachtlaufVorfallMelden({ einstellungen, commit: COMMIT, jetzt: () => Date.parse(iso), ausgabe });
  await um("2026-11-17T02:05:00Z");
  await um("2026-11-17T02:59:59Z");
  await um("2026-11-17T03:00:00Z");
  assert.deepEqual(empfangen, [
    "nachtlauf-staging-2026-11-17T02",
    "nachtlauf-staging-2026-11-17T02",
    "nachtlauf-staging-2026-11-17T03",
  ]);
});

test("Workflow: der Schritt hinter dem Issue läuft nur im roten Nachtlauf und bekommt das Secret als Umgebung", () => {
  assert.match(
    WORKFLOW,
    /- name: Roten Nachtlauf an Better Stack melden\n {8}if: failure\(\) && github\.event_name == 'schedule'\n {8}env:\n {10}BETTER_STACK_ALERT_URL: \$\{\{ secrets\.BETTER_STACK_ALERT_URL \}\}\n {8}run: node tools\/deploy-weg\.mjs vorfall --anlass nachtlauf --commit "\$GITHUB_SHA"/,
  );
});
