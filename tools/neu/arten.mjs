import { readFileSync } from "node:fs";
import { join } from "node:path";

import { erlaubt, karteAus, zuordnung } from "../abhaengigkeiten/bausteine.mjs";
import { regexHits } from "../feste-pfade/muster.mjs";
import { EXIT_AUFRUF, NeuFehler } from "./fehler.mjs";
import { ergaenzeListe } from "./karten.mjs";
import { pruefeFunktionsname } from "./namen.mjs";
import { fuelle } from "./vorlagen.mjs";

const KARTE = "tools/bausteine.json";
const BEREICHE = "tools/bereiche.json";
const OHNE_DIENST = "werkzeuge";
const ANMELDUNG = "anmeldung";
const GEMEINSAM = "gemeinsam";
const ROUTEN_ORDNER = "src/routes/";
const QUELL_ORDNER = "src/";

function lesen(wurzel, pfad) {
  return readFileSync(join(wurzel, pfad), "utf8");
}

function bereicheIn(wurzel) {
  return JSON.parse(lesen(wurzel, BEREICHE));
}

function bereichNamen(wurzel) {
  return bereicheIn(wurzel).map(({ bereich }) => bereich);
}

function bereichFuerTest(wurzel, bereich) {
  const namen = bereichNamen(wurzel);
  if (bereich === OHNE_DIENST || !namen.includes(bereich)) {
    const moeglich = namen.filter((name) => name !== OHNE_DIENST).join(", ");
    throw new NeuFehler(
      EXIT_AUFRUF,
      `Bereich ${JSON.stringify(bereich)} ist für einen Test nicht möglich (möglich: ${moeglich}).`,
    );
  }
  return bereich;
}

function bausteinIn(karte, name) {
  const eintrag = karte.nachName.get(name);
  if (eintrag === undefined) {
    const bekannt = [...karte.nachName.keys()].join(", ");
    throw new NeuFehler(
      EXIT_AUFRUF,
      `Baustein ${JSON.stringify(name)} gibt es in ${KARTE} nicht (bekannt: ${bekannt}).`,
    );
  }
  return eintrag;
}

function bereichZuPfad(wurzel, pfad) {
  return bereicheIn(wurzel).find(({ quellen }) =>
    quellen.some((muster) => regexHits([pfad], muster)),
  );
}

function pruefeZuordnung(roh, pfad, baustein) {
  const { baustein: gefunden } = zuordnung(karteAus(roh), pfad);
  if (gefunden?.baustein !== baustein) {
    throw new NeuFehler(
      EXIT_AUFRUF,
      `${pfad} gehört nach ${KARTE} nicht eindeutig zu ${baustein}; nichts wurde geändert.`,
    );
  }
}

export function planTest(wurzel, bereich, name) {
  const ziel = bereichFuerTest(wurzel, bereich);
  return {
    dateien: [{ pfad: `test/${ziel}/${name}.test.js`, inhalt: fuelle("test", name) }],
    karten: [],
    hinweise: [],
  };
}

function pruefeAnmeldung(karte, aus) {
  const anmeldung = bausteinIn(karte, ANMELDUNG);
  if (aus === anmeldung || erlaubt(aus, anmeldung)) return;
  const alle = [...karte.nachName.values()];
  const duerfen = alle.filter((nach) => nach === anmeldung || erlaubt(nach, anmeldung));
  const moeglich = duerfen.map(({ baustein: name }) => name);
  throw new NeuFehler(
    EXIT_AUFRUF,
    `Baustein ${aus.baustein} darf ${ANMELDUNG} nach ${KARTE} nicht nutzen, die Route braucht aber internalOnly aus src/wiring/internal-only.js; das wäre eine neue Altlast-Kante. Wähle einen Baustein, der es darf (${moeglich.join(", ")}).`,
  );
}

export async function planRoute(wurzel, baustein, name) {
  const text = lesen(wurzel, KARTE);
  const roh = JSON.parse(text);
  const aus = bausteinIn(karteAus(roh), baustein);
  pruefeAnmeldung(karteAus(roh), aus);
  const pfad = `${ROUTEN_ORDNER}${name}.js`;
  const neuerText = await ergaenzeListe({
    pfad: join(wurzel, KARTE),
    text,
    stelle: { schluessel: "baustein", kennung: baustein, liste: "quellen" },
    eintrag: pfad,
  });
  pruefeZuordnung(JSON.parse(neuerText), pfad, baustein);
  const bereich = bereichZuPfad(wurzel, pfad)?.bereich ?? GEMEINSAM;
  const testBereich = bereichFuerTest(wurzel, bereich);
  return {
    dateien: [
      { pfad, inhalt: fuelle("route", name) },
      { pfad: `test/${testBereich}/${name}.test.js`, inhalt: fuelle("route-test", name) },
    ],
    karten: [{ pfad: KARTE, inhalt: neuerText }],
    hinweise: [
      `Noch zu tun: ${pfad} in src/app.js einhängen und POST /api/${name} in src/route-policy.js eintragen; vorher läuft die Route nicht.`,
    ],
  };
}

function ordnerVon(aus) {
  const ordner = aus.ordner.find((eintrag) => eintrag.startsWith(QUELL_ORDNER));
  if (ordner === undefined) {
    throw new NeuFehler(
      EXIT_AUFRUF,
      `Baustein ${aus.baustein} hat in ${KARTE} keinen Ordner unter ${QUELL_ORDNER}; eine Fachdatei braucht den Ordner des Bausteins.`,
    );
  }
  return ordner;
}

export async function planFachdatei(wurzel, baustein, name) {
  pruefeFunktionsname(name);
  const roh = JSON.parse(lesen(wurzel, KARTE));
  const aus = bausteinIn(karteAus(roh), baustein);
  const ordner = ordnerVon(aus);
  const pfad = `${ordner}${name}.js`;
  pruefeZuordnung(roh, pfad, baustein);
  const bereich = bereichZuPfad(wurzel, pfad);
  if (bereich === undefined || bereich.bereich === OHNE_DIENST) {
    throw new NeuFehler(
      EXIT_AUFRUF,
      `Kein Bereich in ${BEREICHE} trifft ${pfad}; ohne Bereich darf kein Test die Datei importieren.`,
    );
  }
  const eintrag = `^${ordner}${name}\\.[jt]s$`;
  const neuerText = await ergaenzeListe({
    pfad: join(wurzel, BEREICHE),
    text: lesen(wurzel, BEREICHE),
    stelle: { schluessel: "bereich", kennung: bereich.bereich, liste: "fachlogik" },
    eintrag,
  });
  return {
    dateien: [
      { pfad, inhalt: fuelle("fachdatei", name) },
      {
        pfad: `test/${bereich.bereich}/${name}.test.js`,
        inhalt: fuelle("fachdatei-test", name, { QUELLE: pfad }),
      },
    ],
    karten: [{ pfad: BEREICHE, inhalt: neuerText }],
    hinweise: [],
  };
}
