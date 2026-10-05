import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ERSTES_ARGUMENT = 2;

function zeige(ereignis) {
  process.stdout.write(`${JSON.stringify(ereignis)}\n`);
}

function leseAufruf(id, pfad) {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name: "Read", input: { file_path: pfad } }],
    },
    parent_tool_use_id: null,
  };
}

function leseAntwort(id) {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: "gelesen" }],
    },
    parent_tool_use_id: null,
  };
}

export function spiele({ aufzeichnung, protokoll, liestDiffs }) {
  const ordner = process.cwd();
  const eingabe = readFileSync(0, "utf8");
  const dateien = readdirSync(ordner, { recursive: true }).map(String).sort();
  writeFileSync(
    protokoll,
    JSON.stringify({
      umgebung: process.env,
      argumente: process.argv.slice(ERSTES_ARGUMENT),
      ordner,
      dateien,
      eingabe,
    }),
  );
  const { zeilen, exitCode = 0 } = JSON.parse(readFileSync(aufzeichnung, "utf8"));
  const patches = liestDiffs ? dateien.filter((name) => name.startsWith("diff/")) : [];
  patches.forEach((name, index) => {
    zeige(leseAufruf(`lesen-${index}`, join(ordner, name)));
    zeige(leseAntwort(`lesen-${index}`));
  });
  zeilen.forEach(zeige);
  process.exitCode = exitCode;
}

export function beobachte({ datei, liste }) {
  const inhalt = existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null;
  appendFileSync(liste, `${JSON.stringify(inhalt)}\n`);
}
