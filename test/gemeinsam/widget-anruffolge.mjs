import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { findChrome } from "./widget-im-rahmen.js";
import { SZENARIEN } from "./widget-anruffolge-attrappe.mjs";
import { messeAnruffolge } from "./widget-anruffolge-messen.mjs";
import { messeLadezeit } from "./widget-anruffolge-ladezeit.mjs";
import { messeUeberlauf } from "./widget-anruffolge-ueberlauf.mjs";
import { nimmBelege } from "./widget-anruffolge-belege.mjs";

const TEMPO_STANDARD = "0.05";
const EXIT_FEHLER = 1;
const JSON_EINZUG = 2;

const ABSCHNITTE = Object.freeze({
  anruffolge: (chrome, html, { szenario, tempo }) => messeAnruffolge(chrome, html, { szenario, tempo }),
  ladezeit: (chrome, html, { szenario }) => messeLadezeit(chrome, html, { szenario }),
  ueberlauf: (chrome, html, { szenario, tempo }) => messeUeberlauf(chrome, html, { szenario, tempo }),
  belege: (chrome, html, { szenario, ordner }) => nimmBelege(chrome, html, { szenario, ordner }),
});

const HILFE = `Anruffolge der Anrufkarte (Widget call) am laufenden Bild prüfen, ohne echten Anruf.

Aufruf:
  node test/gemeinsam/widget-anruffolge.mjs PFAD [--szenario NAME] [--nur MODI] [--tempo FAKTOR] [--ordner VERZEICHNIS]
  node test/gemeinsam/widget-anruffolge.mjs --hilfe

PFAD ist ein Widget-HTML. Ausgabe ist JSON auf stdout.

Modi (--nur, kommagetrennt, Standard alle):
  anruffolge  Bildrate, Timer-Abweichung, Layout-Verschiebungen über Wählen, Klingeln, Verbunden, Ende, Ergebnis
  ladezeit    erstes Bild, Initialisierung, erster Status, erster Flügelschlag
  ueberlauf   Textüberlauf und Zeilen der Karte
  belege      Screenshots je Zustand (waehlen, verbunden, ergebnis) und Ring in Pixeldichte 3, Viewport 420 x 640

Szenarien (--szenario, Standard voll_de): ${Object.keys(SZENARIEN).join(", ")}
Tempo (--tempo, Standard ${TEMPO_STANDARD}) staucht die Gesprächszeit der Attrappe.
Ordner (--ordner) nimmt die Beleg-Dateien auf, Standard ein neues Verzeichnis im Temp-Ordner.

Grenzen:
  Das HTML wird lokal ausgeliefert, also ohne Netzübertragung; Ladezeiten sind keine Netzwerte.
  Der Host ist simuliert (Attrappe mit Werkzeug-Antworten), kein echter Chat-Client und kein echter Anruf.
  Headless-Chromium mit 60 Hz; Werte hängen von der Last der Maschine ab.
  Kein Video.
`;

function scheitere(text) {
  process.stderr.write(`${text}\n`);
  process.exit(EXIT_FEHLER);
}

function lies(argv) {
  return parseArgs({ args: argv, allowPositionals: true, options: {
    hilfe: { type: "boolean" },
    szenario: { type: "string", default: "voll_de" },
    nur: { type: "string" },
    tempo: { type: "string", default: TEMPO_STANDARD },
    ordner: { type: "string" },
  } });
}

function pruefeEingaben({ values, positionals }) {
  const [pfad] = positionals;
  if (!pfad || !existsSync(pfad)) scheitere(`PFAD fehlt oder nicht gefunden: ${pfad ?? "(keiner)"}; Aufruf mit --hilfe`);
  if (!SZENARIEN[values.szenario]) scheitere(`unbekanntes Szenario: ${values.szenario}`);
  const gewaehlt = values.nur ? values.nur.split(",") : Object.keys(ABSCHNITTE);
  const unbekannt = gewaehlt.filter((name) => !ABSCHNITTE[name]);
  if (unbekannt.length) scheitere(`unbekannter Modus: ${unbekannt.join(", ")}`);
  const chrome = findChrome();
  if (!chrome) scheitere("kein Chromium gefunden (CHROME_BIN setzen)");
  return { pfad, gewaehlt, chrome };
}

async function main() {
  const eingabe = lies(process.argv.slice(2));
  const { values } = eingabe;
  if (values.hilfe) return process.stdout.write(HILFE);
  const { pfad, gewaehlt, chrome } = pruefeEingaben(eingabe);
  const html = readFileSync(pfad, "utf8");
  const optionen = { szenario: values.szenario, tempo: Number(values.tempo), ordner: values.ordner ?? mkdtempSync(join(tmpdir(), "anruffolge-")) };
  const ausgabe = { pfad, szenario: values.szenario, tempo: optionen.tempo };
  for (const name of gewaehlt) ausgabe[name] = await ABSCHNITTE[name](chrome, html, optionen);
  process.stdout.write(`${JSON.stringify(ausgabe, null, JSON_EINZUG)}\n`);
}

main().catch((fehler) => scheitere(fehler.stack || String(fehler)));
