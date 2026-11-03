import { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function jsonSpeicherImDatenordner(praefix) {
  const datenordner = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
  const { config } = await import("../../src/config.js");
  Object.assign(config.server, { dataDir: datenordner, webDistDir: path.join(datenordner, "web") });
  const speicher = await import("../../src/store.js");
  after(() => fs.rmSync(datenordner, { recursive: true, force: true }));
  return { config, speicher };
}
