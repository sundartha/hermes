import assert from "node:assert/strict";
import { test } from "node:test";

import { freigabeImProbeRepo } from "./freigabe/hilfen.mjs";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const ANTONIO = "Antonio20045";
const EXIT_OK = 0;
const JSON_EINZUG = 2;
const MANIFEST = "test/werkzeuge/rotproben/karten/pruefung.json";
const DETEKTOR = "tools/karten.mjs";
const OFFEN = "tools/basis/karten-offen.json";
const LOCKERER = /Muss geändert werden: Die Prüfung „Karten“ wird lockerer/;
const URTEIL = /\*\*Karten: (\S+)\*\*/;

const json = (wert) => `${JSON.stringify(wert, null, JSON_EINZUG)}\n`;

function detektor(ohneKarteMelden) {
  return [
    'import { readFileSync } from "node:fs";',
    'const lies = (pfad) => JSON.parse(readFileSync(pfad, "utf8"));',
    'const flaechen = lies("flaechen.json");',
    'const karten = new Set(lies("karten.json"));',
    `const offen = lies("${OFFEN}");`,
    "const gestrichen = offen.filter((flaeche) => karten.has(flaeche));",
    "const ohneKarte = flaechen.filter((flaeche) => !karten.has(flaeche) && !offen.includes(flaeche));",
    `const funde = [...gestrichen, ...${ohneKarteMelden ? "ohneKarte" : "[]"}];`,
    "console.log(funde.length + ' Befunde.');",
    "process.exitCode = funde.length > 0 ? 1 : 0;",
    "",
  ].join("\n");
}

const BASIS = {
  ".github/CODEOWNERS": "/tools/ @Antonio20045\n/test/werkzeuge/ @Antonio20045\n",
  [DETEKTOR]: detektor(true),
  [OFFEN]: json(["GET /a"]),
  "flaechen.json": json(["GET /a", "GET /b"]),
  "karten.json": json(["GET /b"]),
  [MANIFEST]: json({
    titel: "Karten",
    pfade: [DETEKTOR, OFFEN],
    treffer: { befehl: ["node", `{wurzel}/${DETEKTOR}`], zaehlen: "zahlen", vor: [" Befunde."] },
    ausnahmen: { bezeichnung: "Eingefrorene Flächen", datei: OFFEN, zaehlen: "anzahl" },
    probe: { befehl: ["node", `{wurzel}/${DETEKTOR}`] },
  }),
};

const freigabe = (kopf) => [
  {
    user: { login: ANTONIO },
    state: "APPROVED",
    commit_id: kopf,
    submitted_at: "2026-11-03T12:00:00Z",
  },
];

async function pruefe(context, aenderung) {
  const verzeichnis = probeRepository(context, BASIS);
  const basis = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(verzeichnis, aenderung);
  commitAll(verzeichnis, "Änderung");
  const lauf = await freigabeImProbeRepo(context, { verzeichnis, basis, reviews: freigabe });
  const kommentar = lauf.anfragen.find(
    ({ methode, pfad }) => methode === "POST" && pfad.endsWith("/comments"),
  );
  return { ...lauf, urteil: URTEIL.exec(kommentar?.rumpf.body ?? "")?.[1] };
}

test("karten: der PR legt die Karte an und streicht den Eintrag, den die Prüfung dann selbst verlangt: nicht lockerer", async (context) => {
  const lauf = await pruefe(context, {
    "karten.json": json(["GET /a", "GET /b"]),
    [OFFEN]: json([]),
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.equal(lauf.urteil, "strenger");
});

test("karten: der PR trägt eine neue Fläche ohne Karte in die Offen-Liste ein: lockerer", async (context) => {
  const lauf = await pruefe(context, {
    "flaechen.json": json(["GET /a", "GET /b", "GET /c"]),
    [OFFEN]: json(["GET /a", "GET /c"]),
  });
  assert.match(lauf.stdout, LOCKERER, lauf.stdout + lauf.stderr);
});

test("karten: der PR streicht den Eintrag ohne Karte: nicht lockerer, der Befund bleibt in der Prüfung selbst rot", async (context) => {
  const lauf = await pruefe(context, { [OFFEN]: json([]) });
  assert.doesNotMatch(lauf.stdout, LOCKERER, lauf.stdout + lauf.stderr);
  assert.equal(lauf.urteil, "strenger");
});

test("karten: der PR streicht den Eintrag mit Karte und lässt zugleich im Prüfwerkzeug den Befund ohne Karte weg: lockerer", async (context) => {
  const lauf = await pruefe(context, {
    "flaechen.json": json(["GET /a", "GET /b", "GET /c"]),
    "karten.json": json(["GET /a", "GET /b"]),
    [OFFEN]: json([]),
    [DETEKTOR]: detektor(false),
  });
  assert.match(lauf.stdout, LOCKERER, lauf.stdout + lauf.stderr);
});
