import { createHash } from "node:crypto";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

import { hasWidget, widgetHtml } from "../src/ui/widget-catalog.js";
import { widgetPins } from "../src/ui/registry.js";

const EXIT_AUFRUF = 2;
const JSON_EINRUECKUNG = 2;
const ARGUMENTE_AB = 2;

export function sha256Of(html) {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

export function widgetHashes() {
  const ids = Object.keys(widgetPins()).filter((id) => hasWidget(id));
  return Object.fromEntries(ids.map((id) => [id, sha256Of(widgetHtml(id))]));
}

function main(args) {
  if (args.length > 0) {
    console.error("Aufruf: node tools/widget-pins.mjs (ohne Argumente; gibt je Widget den SHA-256 des ausgelieferten HTML als JSON aus, schreibt nichts)");
    return EXIT_AUFRUF;
  }
  console.log(JSON.stringify(widgetHashes(), null, JSON_EINRUECKUNG));
  return 0;
}

if (argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(argv.slice(ARGUMENTE_AB));
