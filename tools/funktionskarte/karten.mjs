import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const KARTEN_ORDNER = "docs/funktionen";
const KARTEN_ENDUNG = ".md";
const ABSCHNITTE = [
  "## Unterfunktionen",
  "## Wie ein Nutzer hinkommt",
  "## Steuerung mit hermes-ctl",
  "## Stolperfallen",
];
const REZEPT_BLOCK = /^```json rezept\n([\s\S]*?)^```$/gm;
const PRUEFARTEN = ["gleich", "enthaelt", "typ"];
const TYPEN = ["string", "number", "boolean", "object", "array"];
const HUELLENFELDER = new Set([
  "ok",
  "befehl",
  "ms",
  "aufrufe",
  "fehler",
  "tun",
  "werkzeug",
  "webhook",
  "ereignis",
  "anfrage_ms",
  "gekuerzt",
  "hinweis",
  "sitzung",
]);

const istObjekt = (wert) => wert !== null && typeof wert === "object" && !Array.isArray(wert);

function rezeptLesen(text) {
  const bloecke = [...text.matchAll(REZEPT_BLOCK)];
  if (bloecke.length !== 1) {
    return { fehler: [`braucht genau einen Block \`\`\`json rezept, hat ${bloecke.length}`] };
  }
  let rezept;
  try {
    rezept = JSON.parse(bloecke[0][1]);
  } catch (fehler) {
    return { fehler: [`Rezept ist kein gültiges JSON: ${fehler.message}`] };
  }
  return istObjekt(rezept)
    ? { rezept, fehler: [] }
    : { fehler: ["Rezept muss ein JSON-Objekt sein"] };
}

function erwartungFehler(erwartung, nummer) {
  const arten = PRUEFARTEN.filter((art) => Object.hasOwn(erwartung, art));
  if (typeof erwartung.pfad !== "string" || arten.length !== 1) {
    return [
      `Schritt ${nummer}: jede Erwartung braucht „pfad“ und genau eines von ${PRUEFARTEN.join(", ")}`,
    ];
  }
  const fehler = [];
  if (HUELLENFELDER.has(erwartung.pfad.split(".")[0])) {
    fehler.push(
      `Schritt ${nummer}: „${erwartung.pfad}“ ist ein Feld von hermes-ctl, nicht die Antwort von Hermes`,
    );
  }
  if (Object.hasOwn(erwartung, "typ") && !TYPEN.includes(erwartung.typ)) {
    fehler.push(`Schritt ${nummer}: „typ“ muss eines von ${TYPEN.join(", ")} sein`);
  }
  const { enthaelt } = erwartung;
  if (Object.hasOwn(erwartung, "enthaelt") && (typeof enthaelt !== "string" || enthaelt === "")) {
    fehler.push(`Schritt ${nummer}: „enthaelt“ braucht einen nicht leeren Text`);
  }
  return fehler;
}

function hintergrundEintragen(schritt, nummer, { hatBefehl, hintergruende }) {
  const fehler = [];
  if (schritt.abwarten !== undefined) {
    const abgewartet = hintergruende.get(schritt.abwarten);
    if (abgewartet === undefined) {
      fehler.push(
        `Schritt ${nummer}: „abwarten“ nennt ${schritt.abwarten}, das kein früherer Schritt im Hintergrund startet`,
      );
    } else if (abgewartet) {
      fehler.push(
        `Schritt ${nummer}: ${schritt.abwarten} wird schon in einem früheren Schritt abgewartet`,
      );
    }
    hintergruende.set(schritt.abwarten, true);
  }
  if (schritt.hintergrund === undefined) return fehler;
  if (!hatBefehl) fehler.push(`Schritt ${nummer}: ein Hintergrund-Schritt braucht „befehl“`);
  if (hintergruende.has(schritt.hintergrund)) {
    fehler.push(
      `Schritt ${nummer}: der Hintergrund-Name ${schritt.hintergrund} ist schon vergeben`,
    );
  }
  hintergruende.set(schritt.hintergrund, false);
  if (schritt.erwarte !== undefined) {
    fehler.push(`Schritt ${nummer}: ein Hintergrund-Schritt prüft erst in seinem „abwarten“`);
  }
  return fehler;
}

function schrittFehler(schritt, nummer, hintergruende) {
  if (!istObjekt(schritt)) return [`Schritt ${nummer}: muss ein JSON-Objekt sein`];
  const fehler = [];
  const hatBefehl = Array.isArray(schritt.befehl) && schritt.befehl.length > 0;
  if (hatBefehl === (schritt.abwarten !== undefined)) {
    fehler.push(`Schritt ${nummer}: braucht entweder „befehl“ oder „abwarten“`);
  }
  fehler.push(...hintergrundEintragen(schritt, nummer, { hatBefehl, hintergruende }));
  if (schritt.hintergrund !== undefined) return fehler;
  if (!Array.isArray(schritt.erwarte) || schritt.erwarte.length === 0) {
    fehler.push(`Schritt ${nummer}: braucht mindestens eine Erwartung an die Antwort („erwarte“)`);
    return fehler;
  }
  const erwartungsfehler = schritt.erwarte.flatMap((erwartung) =>
    istObjekt(erwartung)
      ? erwartungFehler(erwartung, nummer)
      : [`Schritt ${nummer}: jede Erwartung muss ein JSON-Objekt sein`],
  );
  return [...fehler, ...erwartungsfehler];
}

function formFehler(text, rezept) {
  const fehlend = ABSCHNITTE.filter((abschnitt) => !text.split("\n").includes(abschnitt));
  const fehler = fehlend.map((abschnitt) => `Abschnitt „${abschnitt}“ fehlt`);
  if (!Array.isArray(rezept.flaechen) || rezept.flaechen.length === 0) {
    fehler.push("Rezept braucht eine nicht leere Liste „flaechen“");
  }
  if (!Array.isArray(rezept.schritte) || rezept.schritte.length === 0) {
    return [...fehler, "Rezept braucht eine nicht leere Liste „schritte“"];
  }
  const hintergruende = new Map();
  const schrittfehler = rezept.schritte.flatMap((schritt, index) =>
    schrittFehler(schritt, index + 1, hintergruende),
  );
  const nieAbgewartet = [...hintergruende].filter(([, abgewartet]) => !abgewartet);
  return [
    ...fehler,
    ...schrittfehler,
    ...nieAbgewartet.map(([name]) => `Hintergrund ${name} wird von keinem Schritt abgewartet`),
  ];
}

export function kartenLesen(wurzel) {
  const ordner = join(wurzel, KARTEN_ORDNER);
  if (!existsSync(ordner)) return [];
  const dateien = readdirSync(ordner)
    .filter((datei) => datei.endsWith(KARTEN_ENDUNG))
    .sort();
  return dateien.map((datei) => {
    const pfad = `${KARTEN_ORDNER}/${datei}`;
    const text = readFileSync(join(wurzel, pfad), "utf8");
    const { rezept, fehler } = rezeptLesen(text);
    if (rezept === undefined) return { pfad, fehler };
    return { pfad, rezept, fehler: formFehler(text, rezept) };
  });
}
