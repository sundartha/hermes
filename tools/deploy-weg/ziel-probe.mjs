import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { promisify } from "node:util";

import { skriptStarten } from "./staging.mjs";

const PROBE_PFAD = "scripts/probe-auth.sh";
const ANRUFPAUSE_PFAD = "src/routes/intern-anrufpause.js";
const programmLesen = promisify(execFile);

async function dateiAusCommit(repoDir, commit, pfad) {
  try {
    const { stdout } = await programmLesen("git", ["show", commit + ":" + pfad], {
      cwd: repoDir,
      env: { PATH: env.PATH ?? "" },
    });
    return stdout;
  } catch {
    return null;
  }
}

export async function zielKenntAnrufpause({ commit, repoDir }) {
  return (await dateiAusCommit(repoDir, commit, ANRUFPAUSE_PFAD)) !== null;
}

export async function zielProbeStarten({ url, commit, repoDir }) {
  const inhalt = await dateiAusCommit(repoDir, commit, PROBE_PFAD);
  if (inhalt === null) return null;
  const ordner = mkdtempSync(join(tmpdir(), "probe-auth-ziel-"));
  try {
    const pfad = join(ordner, "probe-auth.sh");
    writeFileSync(pfad, inhalt);
    return await skriptStarten(pfad, [url, commit]);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}
