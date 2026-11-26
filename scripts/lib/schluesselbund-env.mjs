import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const PLATTFORM_MAC = "darwin";
const SCHLUESSELBUND_DIENST = "elevenlabs";
const SCHLUESSELBUND_FRIST_MS = 5000;
const EXIT_OK = 0;
const SCHLUESSEL_VARIABLE = "ELEVENLABS_API_KEY";

export const SCHLUESSELBUND_HINWEIS =
  'Einmal im Schluesselbund hinterlegen: security add-generic-password -s elevenlabs -a "$USER" -w';

export function liesAusSchluesselbund() {
  try {
    const lauf = spawnSync("security", ["find-generic-password", "-s", SCHLUESSELBUND_DIENST, "-w"], {
      encoding: "utf8",
      timeout: SCHLUESSELBUND_FRIST_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (lauf.status !== EXIT_OK) return "";
    return lauf.stdout.trim();
  } catch {
    return "";
  }
}

export function schluesselbundEinsetzen({
  env = process.env,
  plattform = process.platform,
  lesen = liesAusSchluesselbund,
} = {}) {
  if ((env[SCHLUESSEL_VARIABLE] ?? "").trim()) return;
  if (plattform !== PLATTFORM_MAC) return;
  const wert = lesen();
  if (wert) env[SCHLUESSEL_VARIABLE] = wert;
}

if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env") });
  schluesselbundEinsetzen();
}
