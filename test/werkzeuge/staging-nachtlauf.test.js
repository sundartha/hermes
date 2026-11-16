import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { nachtlaufIssueSchreiben } from "../../tools/deploy-weg/hoertest.mjs";
import { staging } from "../../tools/deploy-weg/staging.mjs";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const COMMIT = "e".repeat(40);
const STATUS_TOKEN = "s".repeat(40);
const TESTSCHLUESSEL = crypto.generateKeyPairSync("ed25519");
const PEM = TESTSCHLUESSEL.privateKey.export({ type: "pkcs8", format: "pem" });
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

function mitTestschluesselSigniert(anfrage, koerper) {
  return crypto.verify(
    null,
    Buffer.from(`${anfrage.headers["telnyx-timestamp"] ?? ""}|${koerper}`),
    TESTSCHLUESSEL.publicKey,
    Buffer.from(anfrage.headers["telnyx-signature-ed25519"] ?? "", "base64"),
  );
}

async function starten(antwort) {
  const anfragen = [];
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      const koerper = Buffer.concat(teile).toString();
      const pfad = new URL(anfrage.url, "http://127.0.0.1").pathname;
      anfragen.push({ pfad, mitTestschluessel: mitTestschluesselSigniert(anfrage, koerper) });
      const [status, daten] = antwort(pfad);
      rueckgabe.writeHead(status, { "content-type": "application/json", "x-hermes-anrufe": "echt" });
      rueckgabe.end(JSON.stringify(daten));
    });
  });
  await new Promise((fertig) => dienst.listen(0, "127.0.0.1", fertig));
  server.push(dienst);
  return { adresse: `http://127.0.0.1:${dienst.address().port}`, anfragen };
}

function stagingMit({ webhook = () => 403, mcp = 401 } = {}) {
  const commit = COMMIT;
  return (pfad) => {
    if (pfad === "/healthz") return [200, { ok: true, commit }];
    if (pfad === "/intern/status") return [200, { datenbank: true, flush: true, commit, telnyxSignaturSchluessel: "ok" }];
    if (pfad === "/mcp") return [mcp, {}];
    if (pfad.startsWith("/voice/")) return [webhook(pfad), {}];
    return [404, {}];
  };
}

async function laufen(abweichung) {
  const { adresse, anfragen } = await starten(stagingMit(abweichung));
  const einstellungen = { stagingUrl: adresse, statusToken: STATUS_TOKEN, telnyxSchluessel: PEM, absichtlichRot: false };
  const uhr = { jetzt: () => 1_700_000_123_000, warten: async () => undefined };
  const zeilen = [];
  const ergebnis = await staging({
    einstellungen,
    commit: COMMIT,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    uhr,
    probeAuth: async () => 0,
  });
  return { ergebnis, anfragen, zeilen };
}

test("Staging mit echtem Telnyx-Schlüssel: die Prüfung bleibt grün und sendet nichts mit dem Testschlüssel", async () => {
  const { ergebnis, anfragen, zeilen } = await laufen();
  assert.equal(ergebnis, true);
  const voice = anfragen.filter((a) => a.pfad.startsWith("/voice/"));
  assert.deepEqual(voice.map((a) => a.pfad), ["/voice/outbound", "/voice/status"]);
  assert.ok(voice.every((a) => !a.mitTestschluessel));
  assert.ok(!zeilen.some((z) => z.includes("Richtig signierter")));
  assert.ok(zeilen.includes("Mit fremdem Schlüssel signierter Test-Webhook voice/outbound: HTTP 403, erwartet 403"));
  assert.ok(zeilen.includes("Mit fremdem Schlüssel signierter Test-Webhook voice/status: HTTP 403, erwartet 403"));
});

const ROT = [
  ["fremd signiertes outbound wird mit 200 angenommen", { webhook: (p) => (p === "/voice/outbound" ? 200 : 403) }],
  ["fremd signiertes status wird mit 200 angenommen", { webhook: (p) => (p === "/voice/status" ? 200 : 403) }],
  ["outbound antwortet 500", { webhook: (p) => (p === "/voice/outbound" ? 500 : 403) }],
  ["status antwortet 404", { webhook: (p) => (p === "/voice/status" ? 404 : 403) }],
  ["tools/list ohne Anmeldung liefert 200", { mcp: 200 }],
  ["tools/list ohne Anmeldung liefert 403", { mcp: 403 }],
];

for (const [name, abweichung] of ROT) {
  test(`Rot: ${name}`, async () => {
    const { ergebnis } = await laufen(abweichung);
    assert.equal(ergebnis, false);
  });
}

function job(name) {
  const treffer = WORKFLOW.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]+:\\n|(?![\\s\\S]))`, "m"));
  assert.ok(treffer, `Job ${name} fehlt`);
  return treffer[1];
}

test("Workflow: der Zeitplan führt die Prüfung nach Deploy aus, der Lastlauf nur per Hand mit lastlauf", () => {
  assert.match(job("staging"), /^ {4}if: github\.event_name == 'push' \|\| github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && !inputs\.lastlauf\)$/m);
  assert.match(job("lastlauf"), /^ {4}if: github\.event_name == 'workflow_dispatch' && inputs\.lastlauf$/m);
  assert.equal([...WORKFLOW.matchAll(/^ {2}[a-z]+:\n {4}name: /gm)].length, 2);
});

test("Workflow: ein roter Nachtlauf schreibt das Issue über den bestehenden Hörtest-Weg", () => {
  const text = job("staging");
  assert.match(text, /^ {4}permissions:\n {6}contents: read\n {6}issues: write$/m);
  assert.match(text, /^ {8}if: failure\(\) && github\.event_name == 'schedule'$/m);
  assert.match(text, /run: node tools\/deploy-weg\.mjs nachtlauf-melden --commit "\$GITHUB_SHA"$/m);
  assert.ok(!/signierte Test-Webhooks/.test(WORKFLOW));
});

const HOERTEST_ISSUE = {
  number: 7,
  title: "Hörtest nötig vor dem Live-Deploy",
  user: { login: "github-actions[bot]" },
  body: "Der Commit aaa ändert das Gespräch. - prompt.begruessung",
};

async function nachtlaufMelden(offene) {
  const schreibend = [];
  const github = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      const koerper = teile.length > 0 ? JSON.parse(Buffer.concat(teile).toString()) : null;
      const pfad = new URL(anfrage.url, "http://127.0.0.1").pathname;
      if (anfrage.method === "GET") {
        rueckgabe.writeHead(200, { "content-type": "application/json" });
        return rueckgabe.end(JSON.stringify(offene));
      }
      schreibend.push({ methode: anfrage.method, pfad, koerper });
      rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, { "content-type": "application/json" });
      rueckgabe.end(JSON.stringify({ number: 9 }));
    });
  });
  await new Promise((fertig) => github.listen(0, "127.0.0.1", fertig));
  server.push(github);
  const zeilen = [];
  await nachtlaufIssueSchreiben({
    einstellungen: {
      githubUrl: `http://127.0.0.1:${github.address().port}`,
      githubToken: "t",
      repository: "sundartha/hermes",
      serverUrl: "https://github.com",
      runId: "1",
    },
    commit: COMMIT,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
  });
  return { schreibend, zeilen };
}

test("Nachtlauf rot: ein offenes Hörtest-Issue bleibt unverändert, die Meldung bekommt ein eigenes Issue", async () => {
  const { schreibend, zeilen } = await nachtlaufMelden([HOERTEST_ISSUE]);
  assert.equal(schreibend.length, 1);
  assert.equal(schreibend[0].methode, "POST");
  assert.equal(schreibend[0].koerper.title, "Staging-Nachtlauf rot");
  assert.match(schreibend[0].koerper.body, /Staging ist im Nachtlauf rot/);
  assert.ok(!/Hand-Start|Run workflow/.test(schreibend[0].koerper.body));
  assert.deepEqual(zeilen, ["Nachtlauf-Issue #9 angelegt"]);
});

test("Nachtlauf rot: ein offenes Nachtlauf-Issue wird ersetzt", async () => {
  const offen = { ...HOERTEST_ISSUE, number: 12, title: "Staging-Nachtlauf rot" };
  const { schreibend, zeilen } = await nachtlaufMelden([HOERTEST_ISSUE, offen]);
  assert.equal(schreibend.length, 1);
  assert.equal(schreibend[0].methode, "PATCH");
  assert.equal(schreibend[0].pfad, "/repos/sundartha/hermes/issues/12");
  assert.deepEqual(zeilen, ["Nachtlauf-Issue #12: Text ersetzt"]);
});
