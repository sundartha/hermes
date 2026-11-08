import assert from "node:assert/strict";
import { test } from "node:test";

import { updateArtBestimmen } from "../../tools/mutation-laeufe.mjs";

const npm = (name, alt, neu) => ({ name, alt, neu });
const action = (name, alt, neu) => ({ name, alt, neu, oekosystem: "actions" });

const FAELLE = [
  [
    "Sammel-PR mit TypeScript 7 und @types/node 26 enthält Major",
    {
      titel: "chore(deps-dev): bump the klein group with 3 updates",
      pakete: [npm("typescript", "6.0.3", "7.0.0"), npm("@types/node", "25.0.1", "26.0.0"), npm("eslint", "9.1.0", "9.1.2")],
    },
    "major",
  ],
  ["Patch-Gruppe", { pakete: [npm("a", "1.2.3", "1.2.4"), npm("b", "4.0.0", "4.0.9")] }, "patch"],
  ["Minor schlägt Patch", { pakete: [npm("a", "1.2.3", "1.2.4"), npm("b", "4.1.0", "4.2.0")] }, "minor"],
  ["Actions ohne Hauptversionssprung", { pakete: [action("actions/checkout", "v4.1.0", "v4.2.0")] }, "actions"],
  ["Actions mit Hauptversionssprung ist Major", { pakete: [action("actions/checkout", "v4", "v5")] }, "major"],
  ["Sicherheitsangabe schlägt Major", { sicherheit: true, pakete: [npm("a", "1.0.0", "2.0.0")] }, "sicherheit"],
  ["Sicherheitsangabe schlägt Actions", { sicherheit: true, pakete: [action("x/y", "v1", "v2")] }, "sicherheit"],
  ["Node-Hauptversion", { node: [{ alt: "24.1.0", neu: "26.0.0" }], pakete: [npm("a", "1.0.0", "1.0.1")] }, "node-hauptversion"],
  ["Node-Minor ist keine Hauptversion", { node: [{ alt: "24.1.0", neu: "24.2.0" }] }, "minor"],
  ["Node-Hauptversion schlägt Major", { node: [{ alt: "24", neu: "26" }], pakete: [npm("a", "1.0.0", "2.0.0")] }, "node-hauptversion"],
  ["@types/node allein bleibt Major", { pakete: [npm("@types/node", "25.0.0", "26.0.0")] }, "major"],
  ["Vorabversion ist Major", { pakete: [npm("a", "1.0.0", "1.0.1-beta.1")] }, "major"],
  ["Release-Candidate in der alten Version ist Major", { pakete: [npm("a", "1.0.0-rc.1", "1.0.1")] }, "major"],
  ["Unlesbare Version ist Major", { pakete: [npm("a", "1.0.0", "latest")] }, "major"],
  ["Leere Eingabe ist unbekannt", {}, "unbekannt"],
  ["Leere Paketliste ist unbekannt", { pakete: [] }, "unbekannt"],
  ["Nichts Lesbares ist unbekannt", { titel: "Update", pakete: [] }, "unbekannt"],
  ["Gleiche Versionen sind unbekannt", { pakete: [npm("a", "1.0.0", "1.0.0")] }, "unbekannt"],
  ["Titel ohne Lockfile-Diff liefert die Art", { titel: "Bump lodash from 4.17.20 to 4.17.21", pakete: [] }, "patch"],
  ["Titel mit Major ohne Lockfile-Diff", { titel: "Bump vite from 6.0.0 to 8.0.0", pakete: [] }, "major"],
  [
    "Dependabot-Branch für Actions ohne Diff",
    { branch: "dependabot/github_actions/actions/checkout-5", titel: "Bump actions/checkout from 4 to 5", pakete: [] },
    "major",
  ],
  [
    "Dependabot-Branch für Actions, Minor",
    { branch: "dependabot/github_actions/actions/cache-4.2.0", titel: "Bump actions/cache from 4.1.0 to 4.2.0", pakete: [] },
    "actions",
  ],
];

for (const [name, eingabe, erwartet] of FAELLE) {
  test(`Art des Update-PRs: ${name}`, () => {
    assert.equal(updateArtBestimmen(eingabe), erwartet);
  });
}

test("Art des Update-PRs: Aufruf ohne Argument liefert unbekannt", () => {
  assert.equal(updateArtBestimmen(), "unbekannt");
});

test("Art des Update-PRs: engines.node-Bereich mit neuer Obergrenze ist Node-Hauptversion", () => {
  assert.equal(updateArtBestimmen({ node: [{ alt: ">=22.18 <27", neu: ">=22.18 <28" }] }), "node-hauptversion");
});

test("Art des Update-PRs: engines.node-Bereich mit neuer Untergrenze ist Node-Hauptversion", () => {
  assert.equal(updateArtBestimmen({ node: [{ alt: ">=22.18 <27", neu: ">=24.0 <27" }] }), "node-hauptversion");
});

test("Art des Update-PRs: engines.node-Bereich mit neuer Minor ist Minor", () => {
  assert.equal(updateArtBestimmen({ node: [{ alt: ">=22.18 <27", neu: ">=22.20 <27" }] }), "minor");
});

test("Art des Update-PRs: unveränderter engines.node-Bereich ist unbekannt", () => {
  assert.equal(updateArtBestimmen({ node: [{ alt: ">=22.18 <27", neu: ">=22.18 <27" }] }), "unbekannt");
});

test("Art des Update-PRs: unlesbare Node-Änderung ist Node-Hauptversion", () => {
  assert.equal(updateArtBestimmen({ node: [{ alt: "lts", neu: "latest" }] }), "node-hauptversion");
});

test("Art des Update-PRs: null als Eingabe ist unbekannt", () => {
  assert.equal(updateArtBestimmen(null), "unbekannt");
});

test("Art des Update-PRs: Zeichenkette als Eingabe ist unbekannt", () => {
  assert.equal(updateArtBestimmen("Bump a from 1.0.0 to 2.0.0"), "unbekannt");
});

test("Art des Update-PRs: null als Paketeintrag ist unbekannt", () => {
  assert.equal(updateArtBestimmen({ pakete: [null] }), "unbekannt");
});

test("Art des Update-PRs: null als Node-Eintrag ist unbekannt", () => {
  assert.equal(updateArtBestimmen({ node: [null] }), "unbekannt");
});

test("Art des Update-PRs: null neben lesbarem Paket wird übergangen", () => {
  assert.equal(updateArtBestimmen({ pakete: [null, npm("a", "1.0.0", "1.1.0")] }), "minor");
});

test("Art des Update-PRs: Node-Vorabversion -beta ist Node-Hauptversion", () => {
  assert.equal(updateArtBestimmen({ node: [{ alt: "24.1.0", neu: "24.2.0-beta" }] }), "node-hauptversion");
});

test("Art des Update-PRs: Node-Release-Candidate ist Node-Hauptversion", () => {
  assert.equal(updateArtBestimmen({ node: [{ alt: "24.1.0-rc.1", neu: "24.2.0-rc.1" }] }), "node-hauptversion");
});
