import assert from "node:assert/strict";
import { test } from "node:test";

import { updateArtBestimmen } from "../../tools/mutation-laeufe.mjs";

const lesbar = { name: "a", alt: "1.0.0", neu: "1.1.0" };
const unveraendert = { name: "a", alt: "1.0.0", neu: "1.0.0" };

test("Art des Update-PRs: null vor lesbarem Paket ist Major", () => {
  assert.equal(updateArtBestimmen({ pakete: [null, lesbar] }), "major");
});

test("Art des Update-PRs: null nach lesbarem Paket ist Major", () => {
  assert.equal(updateArtBestimmen({ pakete: [lesbar, null] }), "major");
});

test("Art des Update-PRs: Zeichenkette neben lesbarem Paket ist Major", () => {
  assert.equal(updateArtBestimmen({ pakete: ["a", lesbar] }), "major");
});

test("Art des Update-PRs: null neben Paket ohne Änderung ist Major", () => {
  assert.equal(updateArtBestimmen({ pakete: [null, unveraendert] }), "major");
});

test("Art des Update-PRs: lesbares Paket ohne Fremdeintrag bleibt Minor", () => {
  assert.equal(updateArtBestimmen({ pakete: [lesbar] }), "minor");
});

test("Art des Update-PRs: null allein bleibt unbekannt", () => {
  assert.equal(updateArtBestimmen({ pakete: [null] }), "unbekannt");
});

test("Art des Update-PRs: Sicherheitsangabe schlägt unlesbaren Eintrag", () => {
  assert.equal(updateArtBestimmen({ sicherheit: true, pakete: [null, lesbar] }), "sicherheit");
});

const nodeLesbar = { alt: "20.1.0", neu: "20.2.0" };

test("Art des Update-PRs: null neben lesbarem Node-Eintrag ist Node-Hauptversion", () => {
  assert.equal(updateArtBestimmen({ node: [null, nodeLesbar] }), "node-hauptversion");
});

test("Art des Update-PRs: Node-Eintrag ohne Fremdeintrag bleibt Minor", () => {
  assert.equal(updateArtBestimmen({ node: [nodeLesbar] }), "minor");
});

test("Art des Update-PRs: null allein in node bleibt unbekannt", () => {
  assert.equal(updateArtBestimmen({ node: [null] }), "unbekannt");
});

test("Art des Update-PRs: Sicherheitsangabe schlägt unlesbaren Node-Eintrag", () => {
  assert.equal(updateArtBestimmen({ sicherheit: true, node: [null, nodeLesbar] }), "sicherheit");
});
