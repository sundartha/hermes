import assert from "node:assert/strict";
import { test } from "node:test";

import { commitAll, probeRepository, runIn, writeFiles } from "../werkzeuge/probe-repo.js";
import { jsonAttrappe, lockfile, werkzeugLaufen } from "./werkzeug-probe.js";

const PAKET = "frisch-veroeffentlicht";
const VERSION = "1.0.0";
const MS_PRO_TAG = 86_400_000;
const ALTER_FRISCH_TAGE = 1;
const ALTER_ABGELAGERT_TAGE = 400;
const EXIT_OK = 0;
const EXIT_BEFUND = 1;

async function neueVersionPruefen(context, alterTage) {
  const verzeichnis = probeRepository(context, {
    "package-lock.json": lockfile({}),
    "ausnahmen.json": "[]",
  });
  const basis = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const veroeffentlicht = new Date(Date.now() - alterTage * MS_PRO_TAG).toISOString();
  const registry = await jsonAttrappe(context, () => ({ time: { [VERSION]: veroeffentlicht } }));
  const resolved = `${registry}/${PAKET}/-/${PAKET}-${VERSION}.tgz`;
  writeFiles(verzeichnis, {
    "package-lock.json": lockfile({ [`node_modules/${PAKET}`]: { version: VERSION, resolved } }),
  });
  commitAll(verzeichnis, "Neue Version");
  const argumente = ["--basis", basis, "--registry", registry, "--ausnahmen", "ausnahmen.json"];
  return werkzeugLaufen("lockfile-alter.mjs", argumente, { cwd: verzeichnis });
}

test("SG-19 Lockfile mit einer frisch veröffentlichten Version wird abgelehnt", async (context) => {
  const abgelagert = await neueVersionPruefen(context, ALTER_ABGELAGERT_TAGE);
  assert.equal(abgelagert.status, EXIT_OK, abgelagert.ausgabe);
  const frisch = await neueVersionPruefen(context, ALTER_FRISCH_TAGE);
  assert.equal(frisch.status, EXIT_BEFUND, frisch.ausgabe);
  assert.match(frisch.ausgabe, new RegExp(`${PAKET}@${VERSION}: `));
});
