import assert from "node:assert/strict";

import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const EXIT_ABORT = 2;
const OHNE_BASIS = [[], ["--basis", ""], ["--basis", "gibt-es-nicht"]];

export function repoMitBasis(context, dateien) {
  const directory = probeRepository(context, dateien);
  const basis = runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  return { directory, basis };
}

export function nachCommitAufrufen({ directory, basis }, [werkzeug, ...argumente], dateien) {
  writeFiles(directory, dateien);
  commitAll(directory, "Nachher");
  const run = runIn(directory, process.execPath, [werkzeug, "--basis", basis, ...argumente]);
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

export function nachCommitPruefen(repo, werkzeug, dateien) {
  return nachCommitAufrufen(repo, [werkzeug], dateien);
}

export function brichtOhneBasisAb(directory, werkzeug) {
  for (const args of OHNE_BASIS) {
    const run = runIn(directory, process.execPath, [werkzeug, ...args]);
    assert.equal(run.status, EXIT_ABORT, `${args.join(" ")}: ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /Abbruch: .*--basis/);
  }
}
