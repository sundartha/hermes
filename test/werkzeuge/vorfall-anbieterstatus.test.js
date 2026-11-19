import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { after, test } from "node:test";

const COMMIT = "e".repeat(40);
const MINUTE = 60 * 1000;
const server = [];

after(() => {
  for (const eintrag of server) {
    eintrag.closeAllConnections();
    eintrag.close();
  }
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

function statusDienst(verhalten) {
  return dienstStarten((_anfrage, _roh, rueckgabe) => {
    if (verhalten === "haengt") return;
    if (verhalten === "503") {
      rueckgabe.writeHead(503, { "content-type": "application/json" });
      return rueckgabe.end(JSON.stringify({ status: { indicator: "major" } }));
    }
    rueckgabe.writeHead(200, { "content-type": "application/json" });
    rueckgabe.end(verhalten === "kaputt" ? "<html>" : JSON.stringify({ status: { indicator: verhalten } }));
  });
}

async function aufrufen({ telnyx = "none", elevenlabs = "none", anlass = "nachtlauf", offene = [] } = {}) {
  const empfangen = [];
  const schreibend = [];
  const slack = await dienstStarten((_anfrage, roh, rueckgabe) => {
    empfangen.push(JSON.parse(roh));
    rueckgabe.writeHead(200);
    rueckgabe.end();
  });
  const github = await dienstStarten((anfrage, roh, rueckgabe) => {
    rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    if (anfrage.method !== "GET") schreibend.push({ methode: anfrage.method, pfad: anfrage.url, roh });
    rueckgabe.end(JSON.stringify(anfrage.method === "GET" ? offene : { number: 9 }));
  });
  const telnyxPort = await statusDienst(telnyx);
  const elevenPort = await statusDienst(elevenlabs);
  const env = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "77",
    GITHUB_API_URL: `http://127.0.0.1:${github}`,
    SLACK_ALERT_URL: `http://127.0.0.1:${slack}/s`,
    STATUS_TELNYX_URL: `http://127.0.0.1:${telnyxPort}/api/v2/status.json`,
    STATUS_ELEVENLABS_URL: `http://127.0.0.1:${elevenPort}/api/v2/status.json`,
  };
  const argumente = ["tools/deploy-weg.mjs", "hoertest", "--anlass", anlass, "--commit", COMMIT, "--teile", ""];
  const kind = spawn("node", argumente, { env });
  const start = Date.now();
  const code = await new Promise((fertig) => kind.on("close", fertig));
  return { empfangen, schreibend, code, dauer: Date.now() - start };
}

const OHNE = "Anbieter meldet gerade Störung";

for (const anlass of ["nachtlauf", "staginglauf", "probe"]) {
  for (const stufe of ["minor", "major", "critical"]) {
    test(`Anlass ${anlass}: Telnyx meldet ${stufe}, der Slack-Text trägt die Telnyx-Zeile und keine andere`, async () => {
      const { empfangen, code } = await aufrufen({ anlass, telnyx: stufe });
      assert.equal(code, 0);
      assert.equal(empfangen.length, 1);
      const text = empfangen[0].text;
      assert.ok(text.split("\n").includes(`${OHNE}: Telnyx`));
      assert.ok(!text.includes("ElevenLabs"));
    });
  }
}

test("ElevenLabs meldet major: die Zeile nennt ElevenLabs", async () => {
  const { empfangen } = await aufrufen({ elevenlabs: "major" });
  const text = empfangen[0].text;
  assert.ok(text.split("\n").includes(`${OHNE}: ElevenLabs`));
  assert.ok(!text.includes("Telnyx"));
});

test("Beide Anbieter melden eine Störung: beide Zeilen stehen im Text", async () => {
  const { empfangen } = await aufrufen({ telnyx: "major", elevenlabs: "minor" });
  assert.ok(empfangen[0].text.includes(`${OHNE}: Telnyx`));
  assert.ok(empfangen[0].text.includes(`${OHNE}: ElevenLabs`));
});

test("Status none, andere Stufe oder kaputte Antwort: keine Anbieterzeile, Text wie bisher", async () => {
  for (const verhalten of ["none", "maintenance", "kaputt", "503"]) {
    const { empfangen } = await aufrufen({ telnyx: verhalten, elevenlabs: verhalten });
    assert.equal(empfangen.length, 1);
    assert.ok(!empfangen[0].text.includes("Anbieter"));
    assert.match(empfangen[0].text, /Erster Schritt: Ursache im Lauf lesen/);
    assert.match(empfangen[0].text, /Staging-Nachtlauf rot/);
  }
});

test("Statusseite antwortet nicht: Meldung kommt trotzdem, ohne Anbieterzeile, nach rund 5 s", async () => {
  const { empfangen, code, dauer } = await aufrufen({ telnyx: "haengt", elevenlabs: "major" });
  assert.equal(code, 0);
  assert.equal(empfangen.length, 1);
  assert.ok(!empfangen[0].text.includes("Telnyx"));
  assert.ok(empfangen[0].text.includes("ElevenLabs"));
  assert.ok(dauer >= 4500, `Frist zu kurz: ${dauer}`);
  assert.ok(dauer < 8000, `Meldung zu spät: ${dauer}`);
});

test("Entprellt: auch bei Störung geht keine Meldung raus, das Issue bleibt ein Ersetzen", async () => {
  const offene = [
    {
      number: 12,
      title: "Staging-Nachtlauf rot",
      user: { login: "github-actions[bot]" },
      updated_at: new Date(Date.now() - 59 * MINUTE).toISOString(),
    },
  ];
  const { empfangen, schreibend } = await aufrufen({ telnyx: "major", offene });
  assert.equal(empfangen.length, 0);
  assert.equal(schreibend.length, 1);
  assert.equal(schreibend[0].methode, "PATCH");
  assert.ok(!schreibend[0].roh.includes("Anbieter"));
});

test("Der Hinweis steht nicht im GitHub-Issue", async () => {
  const { schreibend } = await aufrufen({ telnyx: "major" });
  assert.equal(schreibend.length, 1);
  assert.ok(!schreibend[0].roh.includes("Anbieter"));
});
