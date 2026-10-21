import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";

import { isolatedEnvironment, probeDirectory } from "./probe-repo.js";
import { scheinGithub, scheinSha, starteEinstieg } from "./pruefer/hilfen.mjs";

const PRIVAT = "sundartha/hermes-sicherheit";
const ISSUES = `/repos/${PRIVAT}/issues`;
const SHA_ERSTER = scheinSha("a");
const SHA_ZWEITER = scheinSha("b");
const TITEL = "Sicherheit: Prüfer: SG-12 in `src/zahl.js`, Zeile 1";
const TITEL_BLOCKER = "Sicherheit BLOCKER: Prüfer: SG-12 in `src/zahl.js`, Zeile 1";
const BELEG = "GEHEIMER-BELEG";
const REPARATUR = "GEHEIME-REPARATUR";
const REPRODUKTION = "GEHEIME-REPRODUKTION";
const GEHEIM = [BELEG, REPARATUR, REPRODUKTION];
const NUMMER_GESCHLOSSEN = 900;

function befund(felder = {}) {
  return {
    schwere: "SOLLTE",
    id: "SG-12",
    datei: "src/zahl.js",
    zeile: 1,
    beleg: BELEG,
    reproduktion: REPRODUKTION,
    reparatur: REPARATUR,
    sicherheit: true,
    ...felder,
  };
}

function zaehlzeile({ neu = 0, kommentare = 0, offen = 0 }) {
  return `Ablage ${PRIVAT}: Issues neu ${neu}, Kommentare neu ${kommentare}, schon offen ${offen}.`;
}

function routenFuer(offen, geschlossen) {
  const nummern = Array.from({ length: offen.length + 1 }, (_, index) => index + 1);
  const liste = [
    ...offen.map(({ title, body }, index) => ({ number: index + 1, title, body, state: "open" })),
    ...geschlossen.map((title, index) => ({
      number: NUMMER_GESCHLOSSEN + index,
      title,
      body: "",
      state: "closed",
    })),
  ];
  return new Map([
    [`GET ${ISSUES}`, liste],
    [`POST ${ISSUES}`, { number: offen.length + 1 }],
    ...nummern.map((nummer) => [`POST ${ISSUES}/${nummer}/comments`, {}]),
    ...offen.map(({ kommentare = [] }, index) => [
      `GET ${ISSUES}/${index + 1}/comments`,
      kommentare.map((body) => ({ body })),
    ]),
  ]);
}

function pruefeOhneLeck({ stdout, stderr, pfade, ablage }) {
  assert.ok(pfade.every((pfad) => pfad.startsWith(`/repos/${PRIVAT}/`)), pfade.join());
  for (const geheim of GEHEIM) {
    assert.equal(stdout.includes(geheim), false, `stdout nennt ${geheim}`);
    assert.equal(stderr.includes(geheim), false, `stderr nennt ${geheim}`);
  }
  assert.deepEqual(readdirSync(ablage), ["sicherheitshinweise.json"]);
}

async function ablegenOhneLeck(context, hinweise, { offen = [], geschlossen = [] } = {}) {
  const ablage = probeDirectory(context, {
    "sicherheitshinweise.json": JSON.stringify({ format: 1, hinweise }),
  });
  const server = await scheinGithub(context, routenFuer(offen, geschlossen));
  const umgebung = { ...isolatedEnvironment(), GH_TOKEN: "gh-schein", GITHUB_API_URL: server.url };
  const lauf = await starteEinstieg(["pruefer", "ablegen", "--ablage", ablage, "--repo", PRIVAT], {
    cwd: ablage,
    umgebung,
  });
  const gesendet = server.anfragen.filter(({ methode }) => methode === "POST");
  const ergebnis = {
    ...lauf,
    ablage,
    pfade: server.anfragen.map(({ pfad }) => pfad),
    neueIssues: gesendet.filter(({ pfad }) => pfad === ISSUES).map(({ rumpf }) => rumpf),
    kommentare: gesendet
      .filter(({ pfad }) => pfad.endsWith("/comments"))
      .map(({ pfad, rumpf }) => ({ pfad, body: rumpf.body })),
  };
  pruefeOhneLeck(ergebnis);
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  return ergebnis;
}

async function ergaenzt(context, erster, zweiter) {
  const anfang = await ablegenOhneLeck(context, [erster]);
  const danach = await ablegenOhneLeck(context, [zweiter], { offen: anfang.neueIssues });
  return { anfang, danach };
}

function enthaelt(text, teile) {
  for (const teil of teile) assert.ok(text.includes(teil), `${teil} fehlt`);
}

function pruefeEinKommentar({ neueIssues, kommentare, stdout }, teile) {
  assert.deepEqual(neueIssues, []);
  assert.deepEqual(
    { pfade: kommentare.map(({ pfad }) => pfad), zeile: stdout.trim() },
    { pfade: [`${ISSUES}/1/comments`], zeile: zaehlzeile({ kommentare: 1 }) },
  );
  enthaelt(kommentare[0].body, teile);
}

test("ein neuer Commit mit gleichem Beleg im offenen Issue wird als Kommentar abgelegt, nicht verschluckt", async (context) => {
  const { anfang, danach } = await ergaenzt(
    context,
    { sha: SHA_ERSTER, befund: befund() },
    { sha: SHA_ZWEITER, befund: befund() },
  );
  assert.deepEqual(anfang.neueIssues.map(({ title }) => title), [TITEL]);
  pruefeEinKommentar(danach, [SHA_ZWEITER, "Schwere: SOLLTE", BELEG, REPARATUR]);
});

test("derselbe Commit mit einem anderen Beleg wird als Kommentar abgelegt", async (context) => {
  const { danach } = await ergaenzt(
    context,
    { sha: SHA_ERSTER, befund: befund({ beleg: "ERSTER-GEHEIMER-BELEG" }) },
    { sha: SHA_ERSTER, befund: befund({ beleg: "ZWEITER-GEHEIMER-BELEG" }) },
  );
  pruefeEinKommentar(danach, [SHA_ERSTER, "ZWEITER-GEHEIMER-BELEG", REPARATUR]);
});

test("ein Sicherheits-BLOCKER verhält sich gleich: neuer Commit, Kommentar mit der Schwere", async (context) => {
  const { anfang, danach } = await ergaenzt(
    context,
    { sha: SHA_ERSTER, befund: befund({ schwere: "BLOCKER" }) },
    { sha: SHA_ZWEITER, befund: befund({ schwere: "BLOCKER" }) },
  );
  assert.deepEqual(anfang.neueIssues.map(({ title }) => title), [TITEL_BLOCKER]);
  pruefeEinKommentar(danach, [SHA_ZWEITER, "Schwere: BLOCKER", BELEG, REPARATUR]);
});

test("derselbe Commit und derselbe Beleg bleiben schon offen, auch wenn sich nur Reparatur und Reproduktion unterscheiden", async (context) => {
  const { danach } = await ergaenzt(
    context,
    { sha: SHA_ERSTER, befund: befund() },
    {
      sha: SHA_ERSTER,
      befund: befund({ reparatur: "ANDERE-GEHEIME-REPARATUR", reproduktion: "ANDERE-GEHEIME-REPRODUKTION" }),
    },
  );
  assert.deepEqual(danach.neueIssues, []);
  assert.deepEqual(danach.kommentare, []);
  assert.ok(danach.stdout.includes(zaehlzeile({ offen: 1 })), danach.stdout);
});

test("ein Hinweis, der schon in einem früheren Kommentar steht, wird bei einer Wiederholung nicht noch einmal abgelegt", async (context) => {
  const { anfang, danach } = await ergaenzt(
    context,
    { sha: SHA_ERSTER, befund: befund() },
    { sha: SHA_ZWEITER, befund: befund() },
  );
  const [kommentar] = danach.kommentare;
  const wiederholt = await ablegenOhneLeck(context, [{ sha: SHA_ZWEITER, befund: befund() }], {
    offen: [{ ...anfang.neueIssues[0], kommentare: [kommentar.body] }],
  });
  assert.deepEqual(wiederholt.neueIssues, []);
  assert.deepEqual(wiederholt.kommentare, []);
  assert.ok(wiederholt.stdout.includes(zaehlzeile({ offen: 1 })), wiederholt.stdout);
});

test("ein Hinweis mit Trennlinie im Beleg oder ganz ohne Beleg wird bei einer Wiederholung nicht noch einmal abgelegt", async (context) => {
  for (const beleg of ["ERSTER-TEIL\n\n---\n\nZWEITER-GEHEIMER-TEIL", ""]) {
    const hinweis = { sha: SHA_ERSTER, befund: befund({ beleg }) };
    const { danach } = await ergaenzt(context, hinweis, hinweis);
    assert.deepEqual(danach.neueIssues, [], JSON.stringify(beleg));
    assert.deepEqual(danach.kommentare, [], JSON.stringify(beleg));
    assert.ok(danach.stdout.includes(zaehlzeile({ offen: 1 })), danach.stdout);
  }
});

test("ein geschlossenes Issue mit gleichem Titel bekommt keinen Kommentar, der Hinweis wird ein neues Issue", async (context) => {
  const lauf = await ablegenOhneLeck(context, [{ sha: SHA_ZWEITER, befund: befund() }], {
    geschlossen: [TITEL],
  });
  assert.deepEqual(lauf.neueIssues.map(({ title }) => title), [TITEL]);
  assert.deepEqual(lauf.kommentare, []);
  assert.ok(lauf.stdout.includes(zaehlzeile({ neu: 1 })), lauf.stdout);
});

test("zwei Commits desselben Laufs mit gleichem Titel: der zweite wird ein Kommentar im eben angelegten Issue", async (context) => {
  const lauf = await ablegenOhneLeck(context, [
    { sha: SHA_ERSTER, befund: befund() },
    { sha: SHA_ZWEITER, befund: befund() },
  ]);
  assert.deepEqual(lauf.neueIssues.map(({ title }) => title), [TITEL]);
  assert.deepEqual(lauf.kommentare.map(({ pfad }) => pfad), [`${ISSUES}/1/comments`]);
  enthaelt(lauf.kommentare[0].body, [SHA_ZWEITER]);
  assert.ok(lauf.stdout.includes(zaehlzeile({ neu: 1, kommentare: 1 })), lauf.stdout);
});

test("der Kommentar geht nur an das private Repo; Beleg, Reparatur und Reproduktion stehen weder in der Konsole noch in der Ablage", async (context) => {
  const { danach } = await ergaenzt(
    context,
    { sha: SHA_ERSTER, befund: befund() },
    { sha: SHA_ZWEITER, befund: befund() },
  );
  const [kommentar] = danach.kommentare;
  enthaelt(kommentar.body, GEHEIM);
  for (const geheim of GEHEIM) {
    assert.equal(danach.stdout.includes(geheim), false, geheim);
    assert.equal(danach.stderr.includes(geheim), false, geheim);
  }
  assert.ok(danach.pfade.length > 0 && danach.pfade.every((pfad) => pfad.startsWith(`/repos/${PRIVAT}/`)));
  assert.equal(danach.pfade.some((pfad) => pfad.startsWith("/repos/sundartha/hermes/")), false);
});

test("derselbe Text als Beleg eines neuen Hinweises gilt nicht als abgelegt, wenn er im Issue nur als Reparatur oder Reproduktion steht", async (context) => {
  for (const feld of ["reparatur", "reproduktion"]) {
    const { danach } = await ergaenzt(
      context,
      { sha: SHA_ERSTER, befund: befund({ beleg: "ERSTER-GEHEIMER-BELEG", [feld]: "ZITIERTER-TEXT" }) },
      { sha: SHA_ERSTER, befund: befund({ beleg: "ZITIERTER-TEXT" }) },
    );
    pruefeEinKommentar(danach, [SHA_ERSTER, "ZITIERTER-TEXT"]);
  }
});

test("ein Commit gilt nicht als abgelegt, wenn seine Kennung im Issue nur im Beleg eines anderen Hinweises steht", async (context) => {
  const beleg = `Zitat aus dem Verlauf ${SHA_ZWEITER}`;
  const { danach } = await ergaenzt(
    context,
    { sha: SHA_ERSTER, befund: befund({ beleg }) },
    { sha: SHA_ZWEITER, befund: befund({ beleg }) },
  );
  pruefeEinKommentar(danach, [SHA_ZWEITER, "Zitat aus dem Verlauf"]);
});
