import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, test } from "node:test";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const NAME = "BETTER_STACK_HEARTBEAT_NACHTLAUF";
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

function dienstStarten(antwort) {
  const empfangen = [];
  const dienst = createServer((anfrage, rueckgabe) => {
    empfangen.push({ methode: anfrage.method, pfad: anfrage.url });
    rueckgabe.writeHead(antwort);
    rueckgabe.end();
  });
  server.push(dienst);
  return new Promise((fertig) =>
    dienst.listen(0, "127.0.0.1", () => fertig({ port: dienst.address().port, empfangen })),
  );
}

async function aufrufen({ wert = "adresse", antwort = 200, argumente = ["heartbeat", "--name", "nachtlauf"] } = {}) {
  const { port, empfangen } = await dienstStarten(antwort);
  const adresse = `http://127.0.0.1:${port}/geheim-pfad`;
  const env = { PATH: process.env.PATH };
  if (wert === "adresse") env[NAME] = adresse;
  else if (wert !== null) env[NAME] = wert;
  const kind = spawn("node", ["tools/deploy-weg.mjs", ...argumente], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  const sichtbar = ausgabe
    .split("\n")
    .filter((zeile) => !zeile.startsWith("::add-mask::"))
    .join("\n");
  return { empfangen, ausgabe, sichtbar, code, adresse };
}

test("Heartbeat mit Adresse: genau ein GET an die Adresse, Exit 0, Meldung gemeldet, Adresse unsichtbar", async () => {
  const { empfangen, code, ausgabe, sichtbar, adresse } = await aufrufen();
  assert.equal(code, 0);
  assert.deepEqual(empfangen, [{ methode: "GET", pfad: "/geheim-pfad" }]);
  assert.match(sichtbar, /^Heartbeat nachtlauf: gemeldet$/m);
  assert.ok(ausgabe.includes("::add-mask::" + adresse));
  assert.ok(!sichtbar.includes("geheim-pfad"));
});

test("Heartbeat ohne Adresse oder mit leerer Adresse: kein Aufruf, übersprungen, Exit 0", async () => {
  for (const wert of [null, ""]) {
    const { empfangen, code, sichtbar } = await aufrufen({ wert });
    assert.equal(code, 0);
    assert.equal(empfangen.length, 0);
    assert.match(sichtbar, /^Heartbeat nachtlauf: übersprungen \(BETTER_STACK_HEARTBEAT_NACHTLAUF fehlt\)$/m);
  }
});

test("Heartbeat mit ungültiger Adresse: übersprungen, Exit 0, der Wert erscheint nirgends", async () => {
  const { empfangen, code, ausgabe } = await aufrufen({ wert: "http://boese.example/geheim-pfad" });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 0);
  assert.match(ausgabe, /Heartbeat nachtlauf: übersprungen/);
  assert.ok(!ausgabe.includes("geheim-pfad"));
});

test("Heartbeat: Grenze der 2xx, Exit bleibt immer 0, bei Fehlern nur der Status", async () => {
  const tabelle = [
    [200, "gemeldet"],
    [299, "gemeldet"],
    [300, "nicht zugestellt (HTTP 300)"],
    [404, "nicht zugestellt (HTTP 404)"],
    [500, "nicht zugestellt (HTTP 500)"],
  ];
  for (const [antwort, erwartet] of tabelle) {
    const { code, sichtbar, empfangen } = await aufrufen({ antwort });
    assert.equal(code, 0);
    assert.equal(empfangen.length, 1);
    assert.ok(sichtbar.split("\n").includes("Heartbeat nachtlauf: " + erwartet), antwort + ": " + sichtbar);
    assert.ok(!sichtbar.includes("geheim-pfad"));
  }
});

test("Heartbeat: Better Stack nicht erreichbar, Exit 0 und nicht zugestellt (HTTP 0)", async () => {
  const { port } = await dienstStarten(200);
  const frei = createServer();
  await new Promise((fertig) => frei.listen(0, "127.0.0.1", fertig));
  const toter = frei.address().port;
  await new Promise((fertig) => frei.close(fertig));
  assert.notEqual(port, toter);
  const { code, sichtbar } = await aufrufen({ wert: `http://127.0.0.1:${toter}/geheim-pfad` });
  assert.equal(code, 0);
  assert.match(sichtbar, /^Heartbeat nachtlauf: nicht zugestellt \(HTTP 0\)$/m);
});

test("Heartbeat: unbekannter oder fehlender oder doppelter Name bricht mit Exit 1 ab und sendet nichts", async () => {
  const faelle = [
    ["heartbeat", "--name", "testanruf"],
    ["heartbeat"],
    ["heartbeat", "--name", "nachtlauf", "--name", "nachtlauf"],
  ];
  for (const argumente of faelle) {
    const { empfangen, code, ausgabe } = await aufrufen({ argumente });
    assert.equal(code, 1);
    assert.equal(empfangen.length, 0);
    assert.match(ausgabe, /Aufruf: node tools\/deploy-weg\.mjs/);
  }
});

test("Workflow: genau ein Schritt Heartbeat Nachtlauf hinter der Prüfung, nur bei Erfolg des Zeitplans, Secret nur dort", () => {
  assert.match(
    WORKFLOW,
    /- name: Heartbeat Nachtlauf\n {8}if: always\(\) && github\.event_name == 'schedule' && steps\.pruefung\.outcome == 'success' && steps\.monatspruefung\.outcome != 'failure'\n {8}env:\n {10}BETTER_STACK_HEARTBEAT_NACHTLAUF: \$\{\{ secrets\.BETTER_STACK_HEARTBEAT_NACHTLAUF \}\}\n {8}run: node tools\/deploy-weg\.mjs heartbeat --name nachtlauf\n/,
  );
  assert.equal(WORKFLOW.match(/BETTER_STACK_HEARTBEAT_NACHTLAUF/g).length, 2);
  assert.equal(WORKFLOW.match(/- name: Heartbeat/g).length, 1);
  const schritt = WORKFLOW.indexOf("- name: Heartbeat Nachtlauf");
  assert.ok(schritt > WORKFLOW.indexOf("deploy-weg.mjs staging --commit"));
  assert.ok(schritt < WORKFLOW.indexOf("\n  lastlauf:\n"));
});
