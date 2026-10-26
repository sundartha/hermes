import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { zweckBlock } from "./auftrag/zweck.mjs";
import { rueckfuehrung, unveraendert } from "./bestand-rueckfuehrung.mjs";
import { ausklingBefunde, grenzeAbleiten, zeilenAus } from "./testlaufzeit/ausklingen.mjs";
import {
  TABELLENKOPF,
  kostenJeDatei,
  sekunden,
  tabellenZeile,
} from "./testlaufzeit/aufteilung.mjs";
import { echtWartenImArbeitsbaum, echteWartezeitenListe } from "./testlaufzeit/echt-warten-statisch.mjs";
import { TESTDATEI, hilfsdateiBefunde } from "./testlaufzeit/hilfsdatei.mjs";
import { ausklingenStrenger, zeitgliederStrenger } from "./testlaufzeit/nur-strenger.mjs";
import { zeitgliederBefunde } from "./testlaufzeit/zeitglieder.mjs";

const BASIS_AUSKLINGEN = "tools/basis/testlaufzeit.json";
const BASIS_ZEITGLIEDER = "tools/basis/zeitglieder-bestand.json";
const LAUFZEITEN = ".pruefung/dateien.jsonl";
const LANGSAMSTE = 20;
const JSON_EINRUECKUNG = 2;
const EXIT_OK = 0;
const EXIT_BEFUND = 1;
const ZWECK = "tests/testlaufzeit";
const AUFRUF = [
  "Aufruf: node tools/testlaufzeit-pruefen.mjs [--laufzeiten <jsonl>] [--kosten <jsonl>] [--basis <commit>] [--teil <k>]",
  "        node tools/testlaufzeit-pruefen.mjs --ableiten <jsonl> [<jsonl> ...]",
].join("\n");

function json(datei) {
  return JSON.parse(readFileSync(datei, "utf8"));
}

function neueTestdateien(basis) {
  if (!basis) return [];
  return execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=A", basis, "HEAD", "--", "test/"],
    {
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter((datei) => TESTDATEI.test(datei));
}

function streichbar(zeilen, basis) {
  const grenze = basis.ausklingen_grenze_ms;
  if (grenze === null) return [];
  return zeilen
    .filter(
      ({ datei, ausklingen_ms: wert }) =>
        basis.ausklingen_bestand.includes(datei) && wert !== null && wert <= grenze,
    )
    .map(({ datei, ausklingen_ms: wert }) => `- ${datei} (${wert} ms)`);
}

function berichtZeilen(zeilen, kosten, { neue, teil, basis }) {
  const gesamt = zeilen.reduce((summe, { dauer_ms: dauer }) => summe + (dauer ?? 0), 0);
  const langsam = [...zeilen].sort(
    (links, rechts) => (rechts.dauer_ms ?? 0) - (links.dauer_ms ?? 0),
  );
  const tabelle = (auswahl) =>
    auswahl.map((zeile) => tabellenZeile(zeile, kosten.get(zeile.datei)));
  const kopf = TABELLENKOPF;
  const mitWarten = zeilen.filter(({ datei }) => kosten.get(datei)?.echtWarten);
  const neuGemessen = zeilen.filter(({ datei }) => neue.includes(datei));
  return [
    teil ? `## Testlaufzeit Teil ${teil}` : "## Testlaufzeit",
    `${zeilen.length} Dateien, Summe der Dateidauern ${sekunden(gesamt)} s`,
    `### Die ${LANGSAMSTE} langsamsten Dateien`,
    ...kopf,
    ...tabelle(langsam.slice(0, LANGSAMSTE)),
    "### Dateien mit echtWarten",
    ...(mitWarten.length > 0 ? [...kopf, ...tabelle(mitWarten)] : ["keine"]),
    "### Neue Testdateien dieses PR",
    ...(neuGemessen.length > 0 ? [...kopf, ...tabelle(neuGemessen)] : ["keine in diesem Teil"]),
    "### Eingefrorene Dateien, die in diesem Lauf unter der Grenze lagen (Eintrag kann gestrichen werden)",
    ...(streichbar(zeilen, basis).length > 0 ? streichbar(zeilen, basis) : ["keine"]),
  ];
}

async function pruefen(werte) {
  const zeilen =
    werte.laufzeiten && existsSync(werte.laufzeiten) ? zeilenAus(werte.laufzeiten) : [];
  const kosten = kostenJeDatei(werte.kosten);
  const ausklingen = json(BASIS_AUSKLINGEN);
  const zeitglieder = json(BASIS_ZEITGLIEDER);
  const kontext = { neue: neueTestdateien(werte.basis), teil: werte.teil, basis: ausklingen };
  const vergleich = {
    basis: werte.basis,
    zurueck: werte.basis ? await rueckfuehrung(werte.basis) : unveraendert,
  };
  for (const zeile of berichtZeilen(zeilen, kosten, kontext)) console.log(zeile);
  const befunde = [
    ...ausklingenStrenger(vergleich, BASIS_AUSKLINGEN, ausklingen),
    ...zeitgliederStrenger(vergleich, BASIS_ZEITGLIEDER, zeitglieder),
    ...echtWartenImArbeitsbaum(".", echteWartezeitenListe(".", { ohneListe: undefined })),
    ...(await zeitgliederBefunde(process.cwd(), zeitglieder)),
    ...hilfsdateiBefunde(zeilen),
    ...ausklingBefunde(zeilen, ausklingen),
  ];
  console.log(befunde.length === 0 ? "Testlaufzeit: keine Befunde" : "### Befunde");
  for (const befund of befunde) console.log(`- ${befund}`);
  if (befunde.length === 0) return EXIT_OK;
  for (const zeile of zweckBlock(ZWECK)) console.log(`\n${zeile}`);
  return EXIT_BEFUND;
}

function ableiten(dateien) {
  if (dateien.length === 0) {
    console.error(AUFRUF);
    return EXIT_BEFUND;
  }
  console.log(JSON.stringify(grenzeAbleiten(dateien.map(zeilenAus)), null, JSON_EINRUECKUNG));
  return EXIT_OK;
}

const { values: werte, positionals: dateien } = parseArgs({
  allowPositionals: true,
  options: {
    laufzeiten: { type: "string", default: LAUFZEITEN },
    kosten: { type: "string" },
    basis: { type: "string" },
    teil: { type: "string" },
    ableiten: { type: "boolean", default: false },
  },
});

process.exitCode = werte.ableiten ? ableiten(dateien) : await pruefen(werte);
