import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process, { env, pid } from "node:process";

export const SANDBOX_MELDUNGEN = "MUTATIONSPRUEFUNG_SANDBOXMELDUNGEN";
const ZEILENENDE = "\n";
let angelegt = false;

export function sandboxMeldungsdatei() {
  if (!angelegt) {
    angelegt = true;
    env[SANDBOX_MELDUNGEN] = join(tmpdir(), `sandbox-meldungen-${pid}.jsonl`);
    process.on("exit", () => rmSync(env[SANDBOX_MELDUNGEN], { force: true }));
  }
  return env[SANDBOX_MELDUNGEN];
}

export function sandboxMeldung(datei, namen) {
  const ziel = env[SANDBOX_MELDUNGEN];
  if (ziel === undefined || !existsSync(ziel)) return undefined;
  const faelle = readFileSync(ziel, "utf8").split(ZEILENENDE).filter(Boolean).map((zeile) => JSON.parse(zeile));
  return faelle.findLast((fall) => fall.datei === datei && namen.includes(fall.name))?.meldung;
}
