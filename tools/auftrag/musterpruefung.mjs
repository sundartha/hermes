import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MUSTER_DATEI = "tools/auftrag/musterdateien.json";
const BASIS_ORDNER = "tools/basis";
const WURZEL_LISTEN = ["eslint-suppressions.json", "eslint-legacy-exceptions.json", ".dependency-cruiser-known-violations.json"];
const PFADZEICHEN = /[\w./-]/;
const RELATIVE_ANFAENGE = ["../", "./"];
const FORMEN = {
  router: {
    muster: /^export function make[A-Z]\w*Routes\(\{/m,
    beschreibung: "ein Express-Router, den make<Name>Routes({ … }) mit hineingegebenen Abhängigkeiten baut",
  },
};
const NICHT_GEFUNDEN = -1;
const SCHRITT = 1;

export function musterEintraege(root) {
  const { bau, test } = JSON.parse(readFileSync(join(root, MUSTER_DATEI), "utf8"));
  return [...bau, ...test];
}

export function altlisten(root) {
  const basis = existsSync(join(root, BASIS_ORDNER)) ? readdirSync(join(root, BASIS_ORDNER)).toSorted().map((name) => `${BASIS_ORDNER}/${name}`) : [];
  return [...WURZEL_LISTEN, ...basis].filter((liste) => existsSync(join(root, liste)));
}

function ohneRelativenAnfang(davor) {
  const anfang = RELATIVE_ANFAENGE.find((teil) => davor.endsWith(teil));
  return anfang === undefined ? davor : ohneRelativenAnfang(davor.slice(0, -anfang.length));
}

function beginntSauber(text, stelle) {
  const davor = ohneRelativenAnfang(text.slice(0, stelle));
  return davor === "" || !PFADZEICHEN.test(davor.at(-SCHRITT));
}

function endetSauber(text, ende) {
  return ende >= text.length || !PFADZEICHEN.test(text[ende]);
}

export function erwaehnungen(text, pfad) {
  let anzahl = 0;
  for (let stelle = text.indexOf(pfad); stelle !== NICHT_GEFUNDEN; stelle = text.indexOf(pfad, stelle + SCHRITT)) {
    if (beginntSauber(text, stelle) && endetSauber(text, stelle + pfad.length)) anzahl += SCHRITT;
  }
  return anzahl;
}

export function altlastBefunde(root) {
  const listen = altlisten(root).map((liste) => [liste, readFileSync(join(root, liste), "utf8")]);
  return musterEintraege(root).flatMap(({ art, datei }) =>
    listen
      .map(([liste, text]) => [liste, erwaehnungen(text, datei)])
      .filter(([, anzahl]) => anzahl > 0)
      .map(([liste, anzahl]) => `Das Vorbild ${datei} (${art}) steht in ${liste} (Fundstellen: ${anzahl}). Ein Vorbild darf in keiner Liste geduldeter Befunde stehen: Tausche es in ${MUSTER_DATEI} gegen eine Datei ohne Einträge, oder räume die Einträge der Datei zuerst auf.`),
  );
}

function formVon(form) {
  return Object.hasOwn(FORMEN, form) ? FORMEN[form] : undefined;
}

function formFehlt({ datei, form }, root) {
  const bekannt = formVon(form);
  return bekannt === undefined || !bekannt.muster.test(readFileSync(join(root, datei), "utf8"));
}

function formMeldung({ art, datei, form }) {
  const beschreibung = formVon(form)?.beschreibung ?? `unbekannt (bekannt: ${Object.keys(FORMEN).join(", ")})`;
  return `Das Vorbild ${datei} (${art}) zeigt nicht die geforderte Form „${form}“: ${beschreibung}. Wähle in ${MUSTER_DATEI} eine Datei, die ihr folgt, oder ändere die Form dort nur mit Antonios Freigabe.`;
}

export function formBefunde(root) {
  return musterEintraege(root)
    .filter(({ form }) => form !== undefined)
    .filter((eintrag) => formFehlt(eintrag, root))
    .map(formMeldung);
}
