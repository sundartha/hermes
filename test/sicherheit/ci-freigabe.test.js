import assert from "node:assert/strict";
import { test } from "node:test";

import { commitAll, probeRepository, runIn, writeFiles } from "../werkzeuge/probe-repo.js";
import { jsonAttrappe, lockfile, werkzeugLaufen } from "./werkzeug-probe.js";

const PR_NUMMER = "17";
const CODEOWNERS = { ".github/CODEOWNERS": "/tools/ @Antonio20045 @jonas986\n" };
const NEUES_PAKET = "paket-mit-installskript";
const FEHLENDE_FREIGABE = /Es fehlt eine Freigabe/;
const EXIT_OK = 0;
const json = (wert) => `${JSON.stringify(wert)}\n`;

function githubAntwort({ method, url }, { head, reviews }) {
  if (method !== "GET") return {};
  const pfad = url.split("?")[0];
  if (pfad.endsWith("/reviews")) return reviews;
  if (pfad.endsWith("/comments")) return [];
  return { number: Number(PR_NUMMER), head: { sha: head }, labels: [] };
}

async function freigabePruefen(context, { basisDateien, aenderung, freigegebenVon = [] }) {
  const verzeichnis = probeRepository(context, { ...CODEOWNERS, ...basisDateien });
  const kopf = () => runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const basis = kopf();
  writeFiles(verzeichnis, aenderung);
  commitAll(verzeichnis, "Änderung");
  const head = kopf();
  const reviews = freigegebenVon.map((login) => ({
    user: { login },
    state: "APPROVED",
    commit_id: head,
  }));
  const url = await jsonAttrappe(context, (request) => githubAntwort(request, { head, reviews }));
  const quellen = ["--registry", url, "--downloads", url];
  return werkzeugLaufen(
    "freigabe-pruefung.mjs",
    ["--basis", basis, "--pr", PR_NUMMER, ...quellen],
    {
      cwd: verzeichnis,
      env: { GITHUB_API_URL: url, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: "sundartha/probe" },
    },
  );
}

test("SG-15 neues Paket mit Install-Skript wird in der CI gestoppt", async (context) => {
  const lauf = await freigabePruefen(context, {
    basisDateien: { "package.json": json({ name: "probe" }), "package-lock.json": lockfile({}) },
    aenderung: {
      "package.json": json({ name: "probe", dependencies: { [NEUES_PAKET]: "1.0.0" } }),
      "package-lock.json": lockfile({
        [`node_modules/${NEUES_PAKET}`]: { version: "1.0.0", hasInstallScript: true },
      }),
    },
  });
  assert.notEqual(lauf.status, EXIT_OK, lauf.ausgabe);
  assert.match(lauf.ausgabe, new RegExp(`Braucht Freigabe: Neue npm-Pakete: ${NEUES_PAKET}\\.`));
  assert.match(lauf.ausgabe, FEHLENDE_FREIGABE);
});

test("SG-21 Änderung an einer Prüfung ohne Freigabe wird gestoppt", async (context) => {
  const aenderungAnPruefung = {
    basisDateien: { "tools/grenze.mjs": "export const GRENZE = 1;\n" },
    aenderung: { "tools/grenze.mjs": "export const GRENZE = 9;\n" },
  };
  const ohneFreigabe = await freigabePruefen(context, aenderungAnPruefung);
  assert.notEqual(ohneFreigabe.status, EXIT_OK, ohneFreigabe.ausgabe);
  assert.match(ohneFreigabe.ausgabe, /Prüfungsdateien geändert oder gelöscht: tools\/grenze\.mjs/);
  assert.match(ohneFreigabe.ausgabe, FEHLENDE_FREIGABE);
  const mitFreigabe = await freigabePruefen(context, {
    ...aenderungAnPruefung,
    freigegebenVon: ["Antonio20045"],
  });
  assert.equal(mitFreigabe.status, EXIT_OK, mitFreigabe.ausgabe);
});
