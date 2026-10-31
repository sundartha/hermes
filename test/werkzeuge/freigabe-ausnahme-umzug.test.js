import assert from "node:assert/strict";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, starteWerkzeug } from "./warteschlange/hilfen.mjs";

const WERKZEUG = join(REPO_ROOT, "tools/freigabe-pruefung.mjs");
const REGELN = pathToFileURL(join(REPO_ROOT, "tools/eslint-rules/index.js")).href;
const PR = 7;
const ANTONIO = "Antonio20045";
const APPROVE_ZEIT = "2026-10-30T12:00:00Z";
const EXIT_OK = 0;
const EXIT_ROT = 1;
const EINRUECKUNG = 2;
const OHNE_NETZ = "http://127.0.0.1:9";
const MANIFEST = "test/werkzeuge/rotproben/eslint/pruefung.json";
const GLEICH = "**ESLint-Regeln: gleich**";
const LOCKERER = /Muss geändert werden: Die Prüfung „ESLint-Regeln“ wird lockerer/;
const ANRUFZEIT = "kein-anrufzeit-gate";
const TRUNK = "trunk-beleg-felder";
const TRUNK_DATEIEN = ["src/w.js", "src/alt.js"];
const ZONEN = ['registriere("timezone");', 'registriere("time_zone");', 'registriere("timeZone");'];
const REST = "export const rest = 1;";
const NEUE_ZEILE = 'registriere("TIME_ZONE");';
const FREMDES_WORT = 'registriere("elInboundTrunkBelegtAt");';
const NEUER_AUFRUF = ["registriere(", '  "timezone"', ");"];
const FREMDER_AUFRUF = ["sendeAn(", '  "timeZone"', ");"];
const VAR_ZEILEN = ["var a = 1;", "var b = 2;"];

const approve = (kopf) => ({
  user: { login: ANTONIO },
  state: "APPROVED",
  commit_id: kopf,
  submitted_at: APPROVE_ZEIT,
});

const zeilen = (...liste) => `${liste.join("\n")}\n`;

function konfiguration(listen, { weitere = "", stufe = "error" } = {}) {
  const eintraege = Object.entries(listen).map(([name, nurIn]) => ({
    name,
    nurIn,
    meldung: "Nur dort.",
  }));
  const regel = `["${stufe}", ...${JSON.stringify(eintraege)}]`;
  return zeilen(
    `import hermes from "${REGELN}";`,
    "export default [",
    `  { files: ["src/**/*.js"], plugins: { hermes }, rules: { "hermes/wort-nur-in": ${regel} } },`,
    weitere,
    "];",
  );
}

function pruefungsManifest(regel) {
  return `${JSON.stringify(
    {
      titel: "ESLint-Regeln",
      pfade: ["eslint.config.*"],
      treffer: {
        befehl: [
          "node",
          "{wurzel}/node_modules/eslint/bin/eslint.js",
          ".",
          "--suppressions-location",
          "eslint-suppressions.empty.json",
          "--format",
          "json",
        ],
        zaehlen: "eslint-json",
        ...(regel === undefined ? {} : { regel }),
      },
    },
    null,
    EINRUECKUNG,
  )}\n`;
}

const manifest = pruefungsManifest();

const BASIS = {
  ".gitignore": "node_modules\n",
  "package.json": '{"type":"module"}\n',
  ".github/CODEOWNERS": "eslint.config.* @Antonio20045\n",
  "eslint-suppressions.empty.json": "{}\n",
  [MANIFEST]: manifest,
  "eslint.config.js": konfiguration({ [ANRUFZEIT]: ["src/x.js"], [TRUNK]: TRUNK_DATEIEN }),
  "src/x.js": zeilen(...ZONEN, REST),
  "src/w.js": zeilen(REST),
  "src/alt.js": zeilen(REST),
};

const UMZUG = {
  "eslint.config.js": konfiguration({ [ANRUFZEIT]: ["src/y.js"], [TRUNK]: TRUNK_DATEIEN }),
  "src/x.js": zeilen(REST),
  "src/y.js": zeilen(...ZONEN),
  "src/alt.js": null,
  "notiz.md": "Der Umzug.\n",
};

function stand(context, { basisDateien, aenderung }) {
  const ordner = probeRepository(context, basisDateien);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(ordner, "node_modules"));
  const basis = runIn(ordner, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const eintraege = Object.entries(aenderung);
  for (const [pfad] of eintraege.filter(([, text]) => text === null)) rmSync(join(ordner, pfad));
  writeFiles(ordner, Object.fromEntries(eintraege.filter(([, text]) => text !== null)));
  commitAll(ordner, "Umzug");
  return { ordner, basis, kopf: runIn(ordner, "git", ["rev-parse", "HEAD"]).stdout.trim() };
}

async function pruefe(context, aenderung, basisDateien = BASIS) {
  const repo = stand(context, { basisDateien, aenderung });
  const pull = { number: PR, head: { sha: repo.kopf }, labels: [], body: "" };
  const github = await scheinGithub(
    context,
    new Map([
      [`GET ${API_PFAD}/pulls/${PR}`, pull],
      [`GET ${API_PFAD}/pulls/${PR}/reviews`, [approve(repo.kopf)]],
      [`GET ${API_PFAD}/issues/${PR}/comments`, []],
      [`POST ${API_PFAD}/issues/${PR}/comments`, {}],
      [`POST ${API_PFAD}/issues/${PR}/labels`, {}],
    ]),
  );
  const lauf = await starteWerkzeug(
    [
      WERKZEUG,
      ...["--basis", repo.basis, "--pr", String(PR)],
      ...["--registry", OHNE_NETZ, "--downloads", OHNE_NETZ],
    ],
    {
      cwd: repo.ordner,
      umgebung: {
        GITHUB_API_URL: github.url,
        GITHUB_TOKEN: "probe",
        GITHUB_REPOSITORY: "sundartha/hermes",
      },
    },
  );
  const kommentar = github.anfragen.find(
    ({ methode, pfad }) => methode === "POST" && pfad.endsWith("/comments"),
  );
  return { ...lauf, kommentar: kommentar?.rumpf.body ?? "" };
}

async function wirdLockerer(context, aenderung, basisDateien) {
  const lauf = await pruefe(context, aenderung, basisDateien);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, LOCKERER);
}

async function bleibtGleich(context, aenderung, basisDateien) {
  const lauf = await pruefe(context, aenderung, basisDateien);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.ok(lauf.kommentar.includes(GLEICH), lauf.kommentar);
}

test("ein reiner Umzug des Codes in eine neue Datei, die den Listeneintrag der alten übernimmt, ist gleich", async (context) => {
  await bleibtGleich(context, UMZUG);
});

test("die alte Datei bleibt auf der Liste, die neue kommt dazu: die Prüfung wird lockerer", async (context) => {
  const liste = konfiguration({ [ANRUFZEIT]: ["src/x.js", "src/y.js"], [TRUNK]: TRUNK_DATEIEN });
  await wirdLockerer(context, { ...UMZUG, "eslint.config.js": liste });
});

test("die neue Datei bekommt zum umgezogenen Code eine neue Zeile mit dem geschützten Wort: lockerer", async (context) => {
  await wirdLockerer(context, { ...UMZUG, "src/y.js": zeilen(...ZONEN, NEUE_ZEILE) });
});

test("die neue Datei wiederholt eine umgezogene Zeile ein zweites Mal: lockerer", async (context) => {
  await wirdLockerer(context, { ...UMZUG, "src/y.js": zeilen(...ZONEN, ZONEN[0]) });
});

test("der Eintrag wandert in einen anderen Listeneintrag als den, den die alte Datei hatte: lockerer", async (context) => {
  const basisDateien = {
    ...BASIS,
    "eslint.config.js": konfiguration({ [ANRUFZEIT]: ["src/w.js"], [TRUNK]: ["src/x.js"] }),
  };
  const liste = konfiguration({ [ANRUFZEIT]: ["src/y.js"], [TRUNK]: [] });
  await wirdLockerer(context, { ...UMZUG, "eslint.config.js": liste }, basisDateien);
});

test("nur der Eintrag wechselt auf eine Datei, die schon vorher eigene Treffer hatte: lockerer", async (context) => {
  const basisDateien = { ...BASIS, "src/x.js": zeilen(REST), "src/y.js": zeilen(...ZONEN) };
  const liste = konfiguration({ [ANRUFZEIT]: ["src/y.js"], [TRUNK]: TRUNK_DATEIEN });
  await wirdLockerer(context, { "eslint.config.js": liste }, basisDateien);
});

test("die alte Datei behält den Code, die neue bekommt eine Kopie: bleibt gleich und wird nicht strenger", async (context) => {
  await bleibtGleich(context, { ...UMZUG, "src/x.js": zeilen(...ZONEN, REST) });
});

test("eine Ausnahmeliste einer anderen Regel zieht nicht mit: lockerer", async (context) => {
  const ignoriere = (datei) =>
    `{ files: ["src/**/*.js"], ignores: ["${datei}"], rules: { "no-var": "error" } },`;
  const basisDateien = {
    ...BASIS,
    "eslint.config.js": konfiguration(
      { [ANRUFZEIT]: ["src/w.js"] },
      { weitere: ignoriere("src/x.js") },
    ),
    "src/x.js": zeilen(...VAR_ZEILEN, REST),
  };
  const aenderung = {
    "eslint.config.js": konfiguration(
      { [ANRUFZEIT]: ["src/w.js"] },
      { weitere: ignoriere("src/y.js") },
    ),
    "src/x.js": zeilen(REST),
    "src/y.js": zeilen(...VAR_ZEILEN),
  };
  await wirdLockerer(context, aenderung, basisDateien);
});

test("ein Treffer eines anderen Listeneintrags in der neuen Datei bleibt dort und ändert nichts: gleich", async (context) => {
  await bleibtGleich(context, { ...UMZUG, "src/y.js": zeilen(...ZONEN, FREMDES_WORT) });
});

test("steht die Regel nur auf warn, ändert der Umzug nichts: gleich und nicht strenger", async (context) => {
  const warnend = (listen) => konfiguration(listen, { stufe: "warn" });
  const basisDateien = {
    ...BASIS,
    "eslint.config.js": warnend({ [ANRUFZEIT]: ["src/x.js"], [TRUNK]: TRUNK_DATEIEN }),
  };
  const liste = warnend({ [ANRUFZEIT]: ["src/y.js"], [TRUNK]: TRUNK_DATEIEN });
  await bleibtGleich(context, { ...UMZUG, "eslint.config.js": liste }, basisDateien);
});

test("die Liste bekommt neben der neuen Datei einen weiteren Eintrag und wächst: lockerer", async (context) => {
  const liste = konfiguration({ [ANRUFZEIT]: ["src/y.js", "src/w.js"], [TRUNK]: TRUNK_DATEIEN });
  await wirdLockerer(context, { ...UMZUG, "eslint.config.js": liste });
});

test("die neue Datei bekommt einen umbrochenen Aufruf, dessen Wort ein Stück einer umgezogenen Zeile ist: lockerer", async (context) => {
  await wirdLockerer(context, { ...UMZUG, "src/y.js": zeilen(...ZONEN, ...NEUER_AUFRUF) });
});

test("die neue Datei tauscht eine umgezogene Zeile gegen eine neue mit dem geschützten Wort: lockerer", async (context) => {
  const [erste, zweite] = ZONEN;
  await wirdLockerer(context, { ...UMZUG, "src/y.js": zeilen(erste, zweite, NEUE_ZEILE) });
});

test("die neue Datei bekommt statt einer umgezogenen Zeile einen anderen Aufruf mit demselben Wort: lockerer", async (context) => {
  const [erste, zweite] = ZONEN;
  await wirdLockerer(context, {
    ...UMZUG,
    "src/y.js": zeilen(erste, zweite, ...FREMDER_AUFRUF),
  });
});

test("zwei neue Dateien bekommen beide dieselben umgezogenen Zeilen und teilen sich zwei Einträge: lockerer", async (context) => {
  const basisDateien = {
    ...BASIS,
    "eslint.config.js": konfiguration({
      [ANRUFZEIT]: ["src/x.js", "src/w.js"],
      [TRUNK]: TRUNK_DATEIEN,
    }),
  };
  const liste = konfiguration({ [ANRUFZEIT]: ["src/y.js", "src/y2.js"], [TRUNK]: TRUNK_DATEIEN });
  const aenderung = { ...UMZUG, "eslint.config.js": liste, "src/y2.js": zeilen(...ZONEN) };
  await wirdLockerer(context, aenderung, basisDateien);
});

const BESTAND = 'registriere("timezone");';

function ziehtInBestehendeDatei({ vorher, nachher }) {
  const liste = konfiguration({ [ANRUFZEIT]: ["src/y.js"], [TRUNK]: TRUNK_DATEIEN });
  return {
    basisDateien: { ...BASIS, "src/y.js": zeilen(...vorher) },
    aenderung: {
      "eslint.config.js": liste,
      "src/x.js": zeilen(REST),
      "src/y.js": zeilen(...nachher),
    },
  };
}

async function wirdLockererInBestehenderDatei(context, faelle) {
  const { aenderung, basisDateien } = ziehtInBestehendeDatei(faelle);
  await wirdLockerer(context, aenderung, basisDateien);
}

test("die Zieldatei hatte denselben Treffer schon vorher, der Code der alten Datei fällt weg: lockerer", async (context) => {
  await wirdLockererInBestehenderDatei(context, {
    vorher: [BESTAND, REST],
    nachher: [BESTAND, REST, "export const harmlos = 2;"],
  });
});

test("der Code zieht in eine bestehende Datei ohne eigene Treffer: gleich", async (context) => {
  const { aenderung, basisDateien } = ziehtInBestehendeDatei({
    vorher: [REST],
    nachher: [REST, ...ZONEN],
  });
  await bleibtGleich(context, aenderung, basisDateien);
});

test("die Zieldatei hatte einen Treffer mit anderer Schreibweise, die neue Zeile stammt aus der alten Datei: lockerer", async (context) => {
  await wirdLockererInBestehenderDatei(context, {
    vorher: ["registriere('timezone');", REST],
    nachher: [REST, ...ZONEN],
  });
});

test("die Zieldatei hatte die Zeile schon vorher, nur nicht als Treffer: lockerer", async (context) => {
  await wirdLockererInBestehenderDatei(context, {
    vorher: [`// ${BESTAND}`, REST],
    nachher: [REST, ...ZONEN],
  });
});

test("die neue Datei verlängert eine umgezogene Zeile um weiteren Code: lockerer", async (context) => {
  const [erste, zweite, dritte] = ZONEN;
  await wirdLockerer(context, {
    ...UMZUG,
    "src/y.js": zeilen(erste, zweite, `${dritte} sendeAn();`),
  });
});

const WORT_REGEL = "hermes/wort-nur-in";
const KOMMENTAR_REGEL = "hermes/keine-kommentare";
const KOMMENTARE = ["// eins", "// zwei", "// drei"];
const KOMMENTARE_AN = `{ files: ["src/**/*.js"], rules: { "${KOMMENTAR_REGEL}": "error" } },`;
const KOMMENTARE_AUS = `{ files: ["src/k.js"], rules: { "${KOMMENTAR_REGEL}": "off" } },`;

test("die Prüfung zählt nur Kommentare, der Umzug versteckt keine gelockerte Kommentar-Regel: lockerer", async (context) => {
  const basisDateien = {
    ...BASIS,
    [MANIFEST]: pruefungsManifest(KOMMENTAR_REGEL),
    "eslint.config.js": konfiguration(
      { [ANRUFZEIT]: ["src/x.js"], [TRUNK]: TRUNK_DATEIEN },
      { weitere: KOMMENTARE_AN },
    ),
    "src/k.js": zeilen(...KOMMENTARE, REST),
  };
  const liste = konfiguration(
    { [ANRUFZEIT]: ["src/y.js"], [TRUNK]: TRUNK_DATEIEN },
    { weitere: `${KOMMENTARE_AN}\n${KOMMENTARE_AUS}` },
  );
  await wirdLockerer(context, { ...UMZUG, "eslint.config.js": liste }, basisDateien);
});

test("die Prüfung zählt genau die Regel des umgezogenen Eintrags: der Umzug ist gleich", async (context) => {
  const basisDateien = { ...BASIS, [MANIFEST]: pruefungsManifest(WORT_REGEL) };
  await bleibtGleich(context, UMZUG, basisDateien);
});
