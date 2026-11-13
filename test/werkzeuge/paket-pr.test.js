import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PAKET_PR_INSTALLATIONS_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WERKZEUG = join(REPO_ROOT, "tools/mutation-laeufe.mjs");
const BETREFF = "Paket Probe: Titel aus dem Commit";
const RUMPF = "Closes #1\nZweite Zeile des Rumpfs";
const NACHRICHT = `${BETREFF}\n\n${RUMPF}\n`;
const APP_ID = "424242";
const OFFENER_PR = { number: 12, html_url: "https://example.invalid/pull/12" };
const NEUER_PR = { number: 13, html_url: "https://example.invalid/pull/13" };
const MAX_JWT_LEBENSDAUER_S = 600;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" });

function dekodiere(teil) {
  return JSON.parse(Buffer.from(teil, "base64url").toString("utf8"));
}

function jwtPruefen(kopfzeile) {
  const [kopf, nutzlast, signatur] = kopfzeile.replace("Bearer ", "").split(".");
  const pruefer = createVerify("RSA-SHA256");
  pruefer.update(`${kopf}.${nutzlast}`);
  assert.equal(pruefer.verify(publicKey, Buffer.from(signatur, "base64url")), true);
  assert.deepEqual(dekodiere(kopf), { alg: "RS256", typ: "JWT" });
  const inhalt = dekodiere(nutzlast);
  assert.equal(inhalt.iss, APP_ID);
  assert.ok(inhalt.exp > inhalt.iat);
  assert.ok(inhalt.exp - inhalt.iat <= MAX_JWT_LEBENSDAUER_S);
}

function antwortFuerPulls(anfrage, optionen) {
  const { suchAntworten, erstellen } = optionen;
  if (anfrage.method === "GET") return [200, suchAntworten.length > 1 ? suchAntworten.shift() : suchAntworten[0]];
  return [erstellen, erstellen === 201 ? NEUER_PR : { message: "Validation Failed" }];
}

function antwortFuerCommit(optionen) {
  const { commitStatus, nachricht } = optionen;
  return [commitStatus, commitStatus === 200 ? { sha: "abc123", commit: { message: nachricht } } : { message: "Not Found" }];
}

function antwortFuer(anfrage, url, optionen) {
  const { installationsStatus, widerrufStatus } = optionen;
  const pfad = url.pathname;
  if (pfad === "/repos/sundartha/probe/installation") return [200, { id: 77 }];
  if (pfad === "/app/installations/77/access_tokens") {
    return installationsStatus === 201 ? [201, { token: PAKET_PR_INSTALLATIONS_TOKEN }] : [installationsStatus, { message: "Bad credentials" }];
  }
  if (pfad === "/repos/sundartha/probe/commits/paket%2Fprobe") return antwortFuerCommit(optionen);
  if (pfad === "/installation/token" && anfrage.method === "DELETE") return [widerrufStatus, {}];
  if (pfad === "/repos/sundartha/probe/pulls") return antwortFuerPulls(anfrage, optionen);
  return [404, {}];
}

async function starteDouble({ suchen = [[]], erstellen = 201, installationsStatus = 201, commitStatus = 200, nachricht = NACHRICHT, widerrufStatus = 204 }) {
  const anfragen = [];
  const optionen = { suchAntworten: [...suchen], erstellen, installationsStatus, commitStatus, nachricht, widerrufStatus };
  const server = createServer((anfrage, antwort) => {
    const teile = [];
    anfrage.on("data", (teil) => teile.push(teil));
    anfrage.on("end", () => {
      const text = Buffer.concat(teile).toString("utf8");
      const url = new URL(anfrage.url, "http://double");
      anfragen.push({ methode: anfrage.method, pfad: url.pathname, abfrage: url.searchParams, authorization: anfrage.headers.authorization, koerper: text === "" ? null : JSON.parse(text) });
      const [status, inhalt] = antwortFuer(anfrage, url, optionen);
      antwort.writeHead(status, { "content-type": "application/json" });
      antwort.end(JSON.stringify(inhalt));
    });
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  return { anfragen, port: server.address().port, schliessen: () => new Promise((fertig) => server.close(fertig)) };
}

function leererOrdner(t) {
  const ordner = mkdtempSync(join(tmpdir(), "paket-pr-"));
  t.after(() => rmSync(ordner, { recursive: true, force: true }));
  return ordner;
}

async function lauf(t, { eingaben = {}, schluessel = PEM, umgebung = {}, ...doubleOptionen }) {
  const double = await starteDouble(doubleOptionen);
  t.after(() => double.schliessen());
  const cwd = leererOrdner(t);
  const werte = { "--app-id": APP_ID, "--repo": "sundartha/probe", "--zweig": "paket/probe", "--api": `http://127.0.0.1:${double.port}`, ...eingaben };
  const argumente = Object.entries(werte).filter(([, wert]) => wert !== undefined).flat();
  const env = { PATH: process.env.PATH, ...umgebung };
  const ergebnis = await new Promise((fertig) => {
    const kind = execFile(process.execPath, [WERKZEUG, "paket-pr", ...argumente], { cwd, env, encoding: "utf8" }, (fehler, stdout, stderr) => {
      fertig({ status: fehler ? fehler.code : 0, ausgabe: `${stdout}${stderr}` });
    });
    kind.stdin.end(schluessel);
  });
  for (const zeile of PEM.split("\n").filter((z) => z.length > 10)) assert.ok(!ergebnis.ausgabe.includes(zeile));
  assert.ok(!ergebnis.ausgabe.includes(PAKET_PR_INSTALLATIONS_TOKEN));
  return { ...ergebnis, anfragen: double.anfragen };
}

const pullsPosts = (anfragen) => anfragen.filter((a) => a.methode === "POST" && a.pfad === "/repos/sundartha/probe/pulls");

test("Ohne offenen PR öffnet der Lauf genau einen PR mit Betreff und Rumpf des obersten Commits", async (t) => {
  const { status, ausgabe, anfragen } = await lauf(t, {});
  assert.equal(status, 0, ausgabe);
  const posts = pullsPosts(anfragen);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].koerper, { title: BETREFF, body: RUMPF, head: "paket/probe", base: "master" });
  assert.equal(posts[0].authorization, `Bearer ${PAKET_PR_INSTALLATIONS_TOKEN}`);
  assert.match(ausgabe, /PR #13 für paket\/probe geöffnet: https:\/\/example\.invalid\/pull\/13/);
});

test("Installation und Token werden mit einem gültig signierten App-JWT und knappen Rechten angefragt", async (t) => {
  const { anfragen } = await lauf(t, {});
  const installation = anfragen.find((a) => a.pfad === "/repos/sundartha/probe/installation");
  const tokenAnfrage = anfragen.find((a) => a.pfad === "/app/installations/77/access_tokens");
  assert.equal(installation.methode, "GET");
  assert.equal(tokenAnfrage.methode, "POST");
  jwtPruefen(installation.authorization);
  jwtPruefen(tokenAnfrage.authorization);
  assert.deepEqual(tokenAnfrage.koerper, { repositories: ["probe"], permissions: { contents: "read", pull_requests: "write" } });
});

test("Die Suche nach dem offenen PR fragt state=open und den Kopf besitzer:branch ab", async (t) => {
  const { anfragen } = await lauf(t, {});
  const suche = anfragen.find((a) => a.methode === "GET" && a.pfad === "/repos/sundartha/probe/pulls");
  assert.equal(suche.abfrage.get("state"), "open");
  assert.equal(suche.abfrage.get("head"), "sundartha:paket/probe");
  assert.equal(suche.authorization, `Bearer ${PAKET_PR_INSTALLATIONS_TOKEN}`);
});

test("Bei offenem PR ändert der Lauf nichts und legt keinen zweiten an", async (t) => {
  const { status, ausgabe, anfragen } = await lauf(t, { suchen: [[OFFENER_PR]] });
  assert.equal(status, 0, ausgabe);
  assert.deepEqual(anfragen.filter((a) => ["POST", "PATCH", "PUT"].includes(a.methode) && a.pfad.startsWith("/repos/") && a.pfad.includes("/pulls")), []);
  assert.match(ausgabe, /Für paket\/probe gibt es schon den offenen PR #12\./);
});

for (const wert of [undefined, ""]) {
  test(`Fehlt --app-id (${wert === undefined ? "nicht gesetzt" : "leer"}), endet der Lauf rot ohne Anfrage`, async (t) => {
    const { status, ausgabe, anfragen } = await lauf(t, { eingaben: { "--app-id": wert } });
    assert.notEqual(status, 0);
    assert.equal(anfragen.length, 0);
    assert.match(ausgabe, /SUNDARTHA_AGENT_APP_ID fehlt, kein PR möglich/);
  });
}

for (const schluessel of ["", "  \n"]) {
  test(`Ist die Standardeingabe leer (${JSON.stringify(schluessel)}), endet der Lauf rot ohne Anfrage`, async (t) => {
    const { status, ausgabe, anfragen } = await lauf(t, { schluessel });
    assert.notEqual(status, 0);
    assert.equal(anfragen.length, 0);
    assert.match(ausgabe, /SUNDARTHA_AGENT_PRIVATE_KEY fehlt, kein PR möglich/);
  });
}

test("Gesetzte Umgebungsvariablen ersetzen weder Argument noch Standardeingabe", async (t) => {
  const umgebung = { SUNDARTHA_AGENT_APP_ID: APP_ID, SUNDARTHA_AGENT_PRIVATE_KEY: PEM };
  const { status, anfragen } = await lauf(t, { umgebung, eingaben: { "--app-id": undefined }, schluessel: "" });
  assert.notEqual(status, 0);
  assert.equal(anfragen.length, 0);
});

for (const repo of [undefined, "probe", "sundartha/", "/probe"]) {
  test(`Das Repository ${JSON.stringify(repo)} ohne Form besitzer/name endet rot ohne Anfrage`, async (t) => {
    const { status, anfragen } = await lauf(t, { eingaben: { "--repo": repo } });
    assert.notEqual(status, 0);
    assert.equal(anfragen.length, 0);
  });
}

for (const zweig of ["system/probe", "master"]) {
  test(`Der Branch ${zweig} außerhalb von paket/ endet rot ohne Anfrage`, async (t) => {
    const { status, anfragen } = await lauf(t, { eingaben: { "--zweig": zweig } });
    assert.notEqual(status, 0);
    assert.equal(anfragen.length, 0);
  });
}

test("Im Wettlauf (422 beim Anlegen) übernimmt der Lauf den inzwischen offenen PR", async (t) => {
  const { status, ausgabe } = await lauf(t, { suchen: [[], [OFFENER_PR]], erstellen: 422 });
  assert.equal(status, 0, ausgabe);
  assert.match(ausgabe, /#12/);
});

test("Bleibt die Suche nach einem 422 leer, endet der Lauf rot", async (t) => {
  const { status, ausgabe } = await lauf(t, { suchen: [[]], erstellen: 422 });
  assert.notEqual(status, 0);
  assert.match(ausgabe, /422/);
});

test("Antwortet GitHub beim Installations-Token mit 401, endet der Lauf rot ohne PR-Anlage", async (t) => {
  const { status, ausgabe, anfragen } = await lauf(t, { installationsStatus: 401 });
  assert.notEqual(status, 0);
  assert.equal(pullsPosts(anfragen).length, 0);
  assert.match(ausgabe, /401/);
});

const widerrufe = (anfragen) => anfragen.filter((a) => a.methode === "DELETE");
const commitAbfragen = (anfragen) => anfragen.filter((a) => a.pfad.includes("/commits/"));

test("Titel und Text kommen über die API aus dem obersten Commit, nicht aus einem lokalen git", async (t) => {
  const { anfragen } = await lauf(t, {});
  const abfrage = commitAbfragen(anfragen);
  assert.equal(abfrage.length, 1);
  assert.equal(abfrage[0].methode, "GET");
  assert.equal(abfrage[0].pfad, "/repos/sundartha/probe/commits/paket%2Fprobe");
  assert.equal(abfrage[0].authorization, `Bearer ${PAKET_PR_INSTALLATIONS_TOKEN}`);
});

test("Eine Nachricht nur mit Betreff ergibt einen leeren Text", async (t) => {
  const { status, ausgabe, anfragen } = await lauf(t, { nachricht: "Nur ein Betreff\n" });
  assert.equal(status, 0, ausgabe);
  assert.deepEqual(pullsPosts(anfragen)[0].koerper, { title: "Nur ein Betreff", body: "", head: "paket/probe", base: "master" });
});

test("Die Commit-Abfrage wird bei einem offenen PR gar nicht gestellt", async (t) => {
  const { anfragen } = await lauf(t, { suchen: [[OFFENER_PR]] });
  assert.equal(commitAbfragen(anfragen).length, 0);
});

test("Antwortet die Commit-Abfrage mit 404, endet der Lauf rot ohne PR-Anlage", async (t) => {
  const { status, ausgabe, anfragen } = await lauf(t, { commitStatus: 404 });
  assert.notEqual(status, 0);
  assert.equal(pullsPosts(anfragen).length, 0);
  assert.match(ausgabe, /404/);
});

const widerrufFaelle = [
  ["nach dem Anlegen des PR", {}],
  ["bei einem offenen PR", { suchen: [[OFFENER_PR]] }],
  ["wenn das Anlegen scheitert", { erstellen: 500 }],
  ["wenn die Commit-Abfrage scheitert", { commitStatus: 404 }],
];

for (const [name, optionen] of widerrufFaelle) {
  test(`Das Installations-Token wird genau einmal widerrufen, ${name}`, async (t) => {
    const { anfragen } = await lauf(t, optionen);
    const liste = widerrufe(anfragen);
    assert.equal(liste.length, 1);
    assert.equal(liste[0].pfad, "/installation/token");
    assert.equal(liste[0].authorization, `Bearer ${PAKET_PR_INSTALLATIONS_TOKEN}`);
  });
}

test("Antwortet der Widerruf mit 500, endet der Lauf rot", async (t) => {
  const { status, ausgabe } = await lauf(t, { widerrufStatus: 500 });
  assert.notEqual(status, 0);
  assert.match(ausgabe, /DELETE \/installation\/token: HTTP 500/);
});

test("Wurde kein Token geholt, wird auch keines widerrufen", async (t) => {
  const ohneId = await lauf(t, { eingaben: { "--app-id": "" } });
  const abgelehnt = await lauf(t, { installationsStatus: 401 });
  assert.equal(widerrufe(ohneId.anfragen).length, 0);
  assert.equal(widerrufe(abgelehnt.anfragen).length, 0);
});
