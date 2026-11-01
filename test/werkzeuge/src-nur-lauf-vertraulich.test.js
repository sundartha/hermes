import assert from "node:assert/strict";
import { test } from "node:test";

import { ANFANGSDATEIEN, EXIT_BEFUND, EXIT_OK, WERKZEUG, aendereA, nachricht, sha } from "./src-nur-lauf-hilfen.js";
import { probeRepository } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, REPO, starteWerkzeug } from "./warteschlange/hilfen.mjs";

const NUMMER = 7;
const LABEL = "ueber-lauf-vertraulich";
const BOT = "sundartha-agent[bot]";
const FREIGEBER = "Antonio20045";
const PULL = `GET ${API_PFAD}/pulls/${NUMMER}`;
const EREIGNISSE = `GET ${API_PFAD}/issues/${NUMMER}/events`;
const REVIEWS = `GET ${API_PFAD}/pulls/${NUMMER}/reviews`;
const ALTER_KOPF = "a".repeat(40);
const VERTRAULICH = "Ändere a.js\n\nUrsache: Auftrag a1 der Phase F-V1-wartung.\n\nAuftrag: F-V1-wartung/a1\nArt: fehlerbehebung\n";

function gesetzt(login = BOT, typ = "Bot") {
  return { event: "labeled", label: { name: LABEL }, actor: { login, type: typ } };
}

function entfernt(login = BOT) {
  return { event: "unlabeled", label: { name: LABEL }, actor: { login, type: "Bot" } };
}

function review(kopf, login = FREIGEBER, state = "APPROVED") {
  return { user: { login }, state, commit_id: kopf };
}

async function pruefeMitGithub(context, commitText, angaben) {
  const verzeichnis = probeRepository(context, ANFANGSDATEIEN);
  const basis = sha(verzeichnis);
  aendereA(verzeichnis, commitText);
  const kopf = sha(verzeichnis);
  const { labels = [{ name: LABEL }], ereignisse = [gesetzt()], reviews = [review(kopf)], optionen = ["--pr", String(NUMMER)] } = angaben(kopf);
  const routen = new Map([[PULL, { head: { sha: kopf }, labels }], [REVIEWS, reviews]]);
  if (ereignisse !== null) routen.set(EREIGNISSE, ereignisse);
  const github = await scheinGithub(context, routen);
  const umgebung = { GITHUB_API_URL: github.url, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO };
  const argumente = [WERKZEUG, "--basis", basis, "--kopf", "HEAD", ...optionen];
  const lauf = await starteWerkzeug(argumente, { cwd: verzeichnis, umgebung });
  return { ...lauf, anfragen: github.anfragen };
}

test("ein vertraulicher src-Commit ist grün, wenn der Bot das Label gesetzt hat und Antonio20045 am Kopf approvt hat", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({}));
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("ein vertraulicher src-Commit ist rot, wenn ein Mensch das Label von Hand gesetzt hat", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ ereignisse: [gesetzt(FREIGEBER, "User")] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /vertrauliche Phase F-V1-wartung, Nachweis nicht prüfbar: das Label ueber-lauf-vertraulich hat Antonio20045 gesetzt/);
});

test("ein vertraulicher src-Commit ist rot, wenn github-actions das Label gesetzt hat", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ ereignisse: [gesetzt("github-actions[bot]")] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /hat github-actions\[bot\] gesetzt/);
});

test("ein vertraulicher src-Commit ist rot, wenn ein Mensch mit dem Namen des Bots das Label gesetzt hat", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ ereignisse: [gesetzt(BOT, "User")] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /hat sundartha-agent\[bot\] gesetzt/);
});

test("ein vertraulicher src-Commit ist rot, wenn das Label vom Bot gesetzt, entfernt und von Hand neu gesetzt wurde", async (context) => {
  const ereignisse = [gesetzt(), entfernt(), gesetzt(FREIGEBER, "User")];
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ ereignisse }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /hat Antonio20045 gesetzt/);
});

test("ein vertraulicher src-Commit ist rot, wenn das Label nach dem Setzen durch den Bot wieder entfernt wurde", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ ereignisse: [gesetzt(), entfernt()] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /die Timeline zeigt nicht, dass das Label ueber-lauf-vertraulich zuletzt gesetzt wurde/);
});

test("ein vertraulicher src-Commit ist rot, wenn das Label am PR fehlt", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ labels: [] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /das Label ueber-lauf-vertraulich fehlt am PR/);
});

test("ein vertraulicher src-Commit ist rot, wenn kein Approve von Antonio20045 vorliegt", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ reviews: [] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /kein Approve von Antonio20045 am aktuellen Kopf/);
});

test("ein vertraulicher src-Commit ist rot, wenn das Approve an einem alten Kopf liegt", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ reviews: [review(ALTER_KOPF)] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /kein Approve von Antonio20045 am aktuellen Kopf/);
});

test("ein vertraulicher src-Commit ist rot, wenn nur ein anderes Konto approvt hat", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, (kopf) => ({ reviews: [review(kopf, "jonas986")] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /kein Approve von Antonio20045 am aktuellen Kopf/);
});

test("ein vertraulicher src-Commit ist rot, wenn Antonio20045 nach dem Approve Änderungen verlangt hat", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, (kopf) => ({ reviews: [review(kopf), review(kopf, FREIGEBER, "CHANGES_REQUESTED")] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /kein Approve von Antonio20045 am aktuellen Kopf/);
});

test("ein vertraulicher src-Commit ist rot, wenn die Timeline nicht lesbar ist", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ ereignisse: null }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /die Timeline oder die Reviews des PR sind nicht lesbar/);
});

test("ein vertraulicher src-Commit ist ohne PR-Nummer rot", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ optionen: [] }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /die PR-Nummer fehlt/);
  assert.equal(lauf.anfragen.length, 0);
});

test("ein src-Commit ohne Zeile Auftrag bleibt auch mit Label und Approve rot", async (context) => {
  const lauf = await pruefeMitGithub(context, "Ändere a.js von Hand\n", () => ({}));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /keine einzelne Zeile „Auftrag: <Phase>\/<Auftrag>“/);
});

test("ein src-Commit mit Zeile einer öffentlichen Phase bleibt vom Label unberührt und fragt GitHub nicht", async (context) => {
  const lauf = await pruefeMitGithub(context, nachricht(), () => ({}));
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(lauf.anfragen.length, 0);
});

const WARTESCHLANGE = `refs/heads/gh-readonly-queue/master/pr-${NUMMER}-${"b".repeat(40)}`;
const AUS_DER_WARTESCHLANGE = ["--ereignis", "merge_group", "--pr", "", "--queue-ref", WARTESCHLANGE];

test("im pull_request-Lauf geht die Nummer aus --pr an die Abfrage des PR", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ optionen: ["--ereignis", "pull_request", "--pr", String(NUMMER), "--queue-ref", ""] }));
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.ok(lauf.anfragen.some(({ pfad }) => pfad === `${API_PFAD}/pulls/${NUMMER}`));
});

test("im merge_group-Lauf kommt die Nummer aus dem Ref refs/heads/gh-readonly-queue/master/pr-NUMMER-SHA", async (context) => {
  const lauf = await pruefeMitGithub(context, VERTRAULICH, () => ({ optionen: AUS_DER_WARTESCHLANGE }));
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.ok(lauf.anfragen.some(({ pfad }) => pfad === `${API_PFAD}/pulls/${NUMMER}`));
});

const REF_NICHT_LESBAR = /die PR-Nummer lässt sich nicht aus dem Ref der Merge-Gruppe lesen/;

async function rotOhneNummer(context, { commitText, optionen }, muster) {
  const lauf = await pruefeMitGithub(context, commitText, () => ({ optionen }));
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, muster);
  assert.equal(lauf.anfragen.length, 0);
}

test("im merge_group-Lauf ohne Ref ist das Werkzeug rot, auch ohne vertrauliche Phase", async (context) => {
  await rotOhneNummer(context, { commitText: nachricht(), optionen: ["--ereignis", "merge_group", "--pr", "", "--queue-ref", ""] }, REF_NICHT_LESBAR);
});

test("im merge_group-Lauf mit einem Ref ohne pr-Nummer ist das Werkzeug rot", async (context) => {
  const optionen = ["--ereignis", "merge_group", "--queue-ref", "refs/heads/gh-readonly-queue/master/feature"];
  await rotOhneNummer(context, { commitText: nachricht(), optionen }, REF_NICHT_LESBAR);
});

test("im merge_group-Lauf zählt --pr nicht, die Nummer kommt nur aus dem Ref", async (context) => {
  const optionen = ["--ereignis", "merge_group", "--pr", String(NUMMER), "--queue-ref", ""];
  await rotOhneNummer(context, { commitText: VERTRAULICH, optionen }, REF_NICHT_LESBAR);
});

test("im pull_request-Lauf ohne --pr ist das Werkzeug rot, auch ohne vertrauliche Phase", async (context) => {
  await rotOhneNummer(context, { commitText: nachricht(), optionen: ["--ereignis", "pull_request", "--pr", ""] }, /die PR-Nummer fehlt \(--pr\) im pull_request-Lauf/);
});

test("ein unbekanntes Ereignis macht das Werkzeug rot", async (context) => {
  await rotOhneNummer(context, { commitText: nachricht(), optionen: ["--ereignis", "push", "--pr", String(NUMMER)] }, /das Ereignis "push" kennt der Schritt nicht/);
});
