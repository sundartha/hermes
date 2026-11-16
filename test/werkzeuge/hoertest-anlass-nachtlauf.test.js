import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { after, test } from "node:test";

const COMMIT = "c".repeat(40);
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

const HOERTEST_ISSUE = {
  number: 7,
  title: "Hörtest nötig vor dem Live-Deploy",
  user: { login: "github-actions[bot]" },
};

async function aufrufen(argumente, offene = []) {
  const schreibend = [];
  const github = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, { "content-type": "application/json" });
      if (anfrage.method === "GET") return rueckgabe.end(JSON.stringify(offene));
      const koerper = JSON.parse(Buffer.concat(teile).toString());
      schreibend.push({ methode: anfrage.method, pfad: anfrage.url, koerper });
      rueckgabe.end(JSON.stringify({ number: 9 }));
    });
  });
  await new Promise((fertig) => github.listen(0, "127.0.0.1", fertig));
  server.push(github);
  const kind = spawn("node", ["tools/deploy-weg.mjs", ...argumente], {
    env: {
      PATH: process.env.PATH,
      GITHUB_TOKEN: "t",
      GITHUB_REPOSITORY: "sundartha/hermes",
      GITHUB_RUN_ID: "1",
      GITHUB_API_URL: `http://127.0.0.1:${github.address().port}`,
    },
  });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  return { schreibend, ausgabe, code };
}

test("Nachtlauf rot: hoertest --anlass nachtlauf legt neben einem Hörtest-Issue ein eigenes Issue an", async () => {
  const { schreibend, ausgabe, code } = await aufrufen(
    ["hoertest", "--anlass", "nachtlauf", "--commit", COMMIT, "--teile", ""],
    [HOERTEST_ISSUE],
  );
  assert.equal(code, 0);
  assert.equal(schreibend.length, 1);
  assert.equal(schreibend[0].methode, "POST");
  assert.equal(schreibend[0].koerper.title, "Staging-Nachtlauf rot");
  const { body } = schreibend[0].koerper;
  assert.ok(body.includes(COMMIT));
  assert.ok(body.includes("actions/runs/1"));
  assert.ok(!/Hand-Start|Run workflow/.test(body));
  assert.match(ausgabe, /Nachtlauf-Issue #9 angelegt/);
});

test("Nachtlauf rot: hoertest --anlass nachtlauf ersetzt ein offenes Nachtlauf-Issue per PATCH", async () => {
  const offen = { ...HOERTEST_ISSUE, number: 12, title: "Staging-Nachtlauf rot" };
  const { schreibend, ausgabe } = await aufrufen(
    ["hoertest", "--anlass", "nachtlauf", "--commit", COMMIT, "--teile", ""],
    [HOERTEST_ISSUE, offen],
  );
  assert.equal(schreibend.length, 1);
  assert.equal(schreibend[0].methode, "PATCH");
  assert.match(schreibend[0].pfad, /\/issues\/12$/);
  assert.match(ausgabe, /Nachtlauf-Issue #12: Text ersetzt/);
});

test("Hörtest ohne Anlass schreibt unverändert das Hörtest-Issue", async () => {
  const { schreibend, ausgabe } = await aufrufen(["hoertest", "--commit", COMMIT, "--teile", "prompt.begruessung"]);
  assert.equal(schreibend[0].koerper.title, "Hörtest nötig vor dem Live-Deploy");
  assert.match(schreibend[0].koerper.body, /Hand-Start/);
  assert.match(ausgabe, /Hörtest-Issue #9 angelegt/);
});

test("Der Befehl nachtlauf-melden ist abgelehnt wie jeder unbekannte Befehl", async () => {
  const { schreibend, ausgabe, code } = await aufrufen(["nachtlauf-melden", "--commit", COMMIT]);
  assert.equal(code, 1);
  assert.equal(schreibend.length, 0);
  assert.match(ausgabe, /^Aufruf: /m);
  assert.doesNotMatch(ausgabe, /nachtlauf-melden/);
});

test("Ein unbekannter Anlass wird abgelehnt", async () => {
  const { schreibend, code } = await aufrufen(["hoertest", "--anlass", "sonst", "--commit", COMMIT, "--teile", ""]);
  assert.equal(code, 1);
  assert.equal(schreibend.length, 0);
});

test("Hörtest ohne Pflichtargument --teile wird abgelehnt", async () => {
  const { schreibend, ausgabe } = await aufrufen(["hoertest", "--anlass", "nachtlauf", "--commit", COMMIT]);
  assert.equal(schreibend.length, 0);
  assert.match(ausgabe, /^Aufruf: /m);
});

test("Hörtest mit einem Argumentnamen ohne Wert wird als Aufruf abgelehnt", async () => {
  const { schreibend, ausgabe } = await aufrufen(["hoertest", "--commit", COMMIT, "--teile"]);
  assert.equal(schreibend.length, 0);
  assert.match(ausgabe, /^Aufruf: /m);
});
