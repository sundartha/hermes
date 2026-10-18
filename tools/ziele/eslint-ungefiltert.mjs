import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { eslintBefehl, fuehreAus } from "./werkzeuge.mjs";

export const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const KONFIGURATION = "eslint.config.js";

export function ungefilterteMeldungen(root, dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "ziele-altfunktion-"));
  try {
    const leer = join(ordner, UNTERDRUECKUNGEN);
    writeFileSync(leer, "{}");
    const lauf = fuehreAus(eslintBefehl(["--config", resolve(root, KONFIGURATION), "--format", "json", "--suppressions-location", leer, ...dateien]), root);
    return JSON.parse(lauf.stdout || "[]");
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}
