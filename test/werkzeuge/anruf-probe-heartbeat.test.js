import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, test } from "node:test";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const PROBE = "BETTER_STACK_HEARTBEAT_PROBE";
const NACHTLAUF = "BETTER_STACK_HEARTBEAT_NACHTLAUF";
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

async function aufrufen({ name = "probe", gesetzt = [PROBE], antwort = 200, wert } = {}) {
  const { port, empfangen } = await dienstStarten(antwort);
  const adresse = wert ?? `http://127.0.0.1:${port}/geheim-pfad`;
  const env = { PATH: process.env.PATH };
  for (const schluessel of gesetzt) env[schluessel] = adresse;
  const kind = spawn("node", ["tools/deploy-weg.mjs", "heartbeat", "--name", name], { env });
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

test("Probe-Heartbeat mit Adresse: genau ein GET, Meldung gemeldet, Adresse maskiert und unsichtbar", async () => {
  const { empfangen, code, ausgabe, sichtbar, adresse } = await aufrufen();
  assert.equal(code, 0);
  assert.deepEqual(empfangen, [{ methode: "GET", pfad: "/geheim-pfad" }]);
  assert.match(sichtbar, /^Heartbeat probe: gemeldet$/m);
  assert.ok(ausgabe.includes("::add-mask::" + adresse));
  assert.ok(!sichtbar.includes("geheim-pfad"));
});

test("Probe-Heartbeat ohne oder mit nur der Nachtlauf-Adresse: kein Aufruf, übersprungen, Exit 0", async () => {
  for (const gesetzt of [[], [NACHTLAUF]]) {
    const { empfangen, code, sichtbar } = await aufrufen({ gesetzt });
    assert.equal(code, 0);
    assert.equal(empfangen.length, 0);
    assert.match(sichtbar, /^Heartbeat probe: übersprungen \(BETTER_STACK_HEARTBEAT_PROBE fehlt\)$/m);
  }
});

test("Nachtlauf-Heartbeat nimmt nie die Probe-Adresse", async () => {
  const { empfangen, sichtbar } = await aufrufen({ name: "nachtlauf", gesetzt: [PROBE] });
  assert.equal(empfangen.length, 0);
  assert.match(sichtbar, /^Heartbeat nachtlauf: übersprungen/m);
});

test("Probe-Heartbeat mit ungültiger Adresse: übersprungen, der Wert erscheint nirgends", async () => {
  const { empfangen, code, ausgabe } = await aufrufen({ wert: "http://boese.example/geheim-pfad" });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 0);
  assert.match(ausgabe, /Heartbeat probe: übersprungen/);
  assert.ok(!ausgabe.includes("geheim-pfad"));
});

test("Probe-Heartbeat: Grenze der 2xx, Exit bleibt 0, bei Fehlern nur der Status", async () => {
  const tabelle = [
    [200, "gemeldet"],
    [299, "gemeldet"],
    [300, "nicht zugestellt (HTTP 300)"],
    [500, "nicht zugestellt (HTTP 500)"],
  ];
  for (const [antwort, erwartet] of tabelle) {
    const { code, sichtbar, empfangen } = await aufrufen({ antwort });
    assert.equal(code, 0);
    assert.equal(empfangen.length, 1);
    assert.ok(sichtbar.split("\n").includes("Heartbeat probe: " + erwartet), antwort + ": " + sichtbar);
    assert.ok(!sichtbar.includes("geheim-pfad"));
  }
});

test("Workflow: ein Schritt nach der Anrufprobe, nur bei Erfolg des Zeitplans, Secret nur dort", () => {
  assert.match(
    WORKFLOW,
    /- name: Lebenszeichen Anrufprobe\n {8}if: success\(\) && github\.event_name == 'schedule' && steps\.probe\.outputs\.gewaehlt == 'true'\n {8}env:\n {10}BETTER_STACK_HEARTBEAT_PROBE: \$\{\{ secrets\.BETTER_STACK_HEARTBEAT_PROBE \}\}\n {8}run: node tools\/deploy-weg\.mjs heartbeat --name probe\n/,
  );
  assert.equal(WORKFLOW.match(/BETTER_STACK_HEARTBEAT_PROBE/g).length, 2);
  const schritt = WORKFLOW.indexOf("- name: Lebenszeichen Anrufprobe");
  assert.ok(schritt > WORKFLOW.indexOf("node scripts/anruf-probe/probe.mjs\n"));
  assert.ok(schritt < WORKFLOW.indexOf("- name: Offene Probe-Anrufe beenden"));
});
