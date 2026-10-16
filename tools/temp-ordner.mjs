import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const angelegt = new Set();
const zustand = { amEndeRaeumen: false };

export function entferneTempOrdner(ordner) {
  rmSync(ordner, { recursive: true, force: true });
  angelegt.delete(ordner);
}

export function raeumeTempOrdnerWeg() {
  for (const ordner of angelegt) entferneTempOrdner(ordner);
}

export function neuerTempOrdner(praefix) {
  const ordner = mkdtempSync(join(tmpdir(), praefix));
  if (!zustand.amEndeRaeumen) process.on("exit", raeumeTempOrdnerWeg);
  zustand.amEndeRaeumen = true;
  angelegt.add(ordner);
  return ordner;
}
