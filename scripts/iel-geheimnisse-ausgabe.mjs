// IEL-B10: der Ausgabe-Waechter des Geheimnis-Werkzeugs (Spec E16 d, E22, Runde 5 K3).
//
// EINE Ausgabefunktion fuer stdout UND stderr. Jede Zeile wird VOR dem Schreiben gegen die
// Verbotsmenge geprueft - alle Geheimnis-Werte, die der Lauf erzeugt oder gelesen hat. Ein Treffer
// verwirft die Zeile, schreibt stattdessen eine konstante Meldung und macht den Lauf ROT. Das ist
// Defense in Depth zur Regel "Anbieter-Fehlerkoerper nie ausgeben": selbst ein Programmierfehler,
// der einen Wert in eine Zeile formatiert, erreicht kein Terminal und keinen Agenten-Kontext.
//
// GEKUERZTE AUSGABE (infoGekuerzt): geprueft wird der UNGEKUERZTE Text, gekuerzt erst danach. Ein
// an der Kuerzungsgrenze angeschnittener Wert enthielte den vollen Wert nicht mehr und passierte
// einen Waechter, der erst nach dem Kuerzen prueft, als Praefix.

export const EXIT = Object.freeze({ GRUEN: 0, ROT: 1 });
export const LOG_PREFIX = "[iel-geheimnisse]";
const VERWORFEN_MELDUNG = "ZEILE VERWORFEN - enthielt einen Geheimnis-Wert (Ausgabe-Waechter)";
const ZEILENENDE = "\n";
const JA = "ja";
const NEIN = "nein";
const OHNE_WERT = "-";

export function makeAusgabeWaechter({ stdout, stderr }) {
  const verboten = new Set();
  let verworfen = false;

  function enthaeltVerbotenes(text) {
    return [...verboten].some((wert) => text.includes(wert));
  }

  function schreibe({ kanal, zeile, pruefText }) {
    if (enthaeltVerbotenes(pruefText)) {
      verworfen = true;
      stderr.write(`${LOG_PREFIX} ${VERWORFEN_MELDUNG}${ZEILENENDE}`);
      return;
    }
    kanal.write(`${LOG_PREFIX} ${zeile}${ZEILENENDE}`);
  }

  return {
    // Leere oder fehlende Werte werden nicht aufgenommen - "" traefe jede Zeile.
    verbiete(wert) {
      if (typeof wert === "string" && wert !== "") verboten.add(wert);
    },
    info(zeile) {
      schreibe({ kanal: stdout, zeile, pruefText: zeile });
    },
    fehler(zeile) {
      schreibe({ kanal: stderr, zeile, pruefText: zeile });
    },
    infoGekuerzt({ kopf, text, maxZeichen }) {
      schreibe({ kanal: stdout, zeile: `${kopf}${text.slice(0, maxZeichen)}`, pruefText: `${kopf}${text}` });
    },
    verworfen: () => verworfen,
  };
}

export function jaNein(wert) {
  return wert ? JA : NEIN;
}

// GRUEN nach stdout, ROT nach stderr - EINE Stelle fuer diese Weiche.
export function meldeNachUrteil(waechter, { gruen, zeile }) {
  if (gruen) waechter.info(zeile);
  else waechter.fehler(zeile);
}

// Befunde tragen per Konstruktion nur Schluesselnamen, Kennungen und Status - der Waechter prueft
// sie trotzdem wie jede andere Zeile.
export function meldeBefunde(waechter, befunde) {
  for (const befund of befunde) waechter.fehler(`BEFUND ${befund}`);
}

export function urteilText(gruen) {
  return gruen ? "GRUEN" : "ROT";
}

export function exitVon(gruen) {
  return gruen ? EXIT.GRUEN : EXIT.ROT;
}

// Die Ziel-Tabelle (E16 d/e): Ziel | gesetzt | Laenge | Status - nie ein Wert.
export function meldeZielTabelle(waechter, ziele) {
  for (const ziel of ziele) {
    meldeNachUrteil(waechter, {
      gruen: ziel.gesetzt,
      zeile:
        `ZIEL ${ziel.ziel} | gesetzt: ${jaNein(ziel.gesetzt)} | Laenge ${ziel.laenge ?? OHNE_WERT} | ` +
        `Status ${ziel.status ?? OHNE_WERT}`,
    });
  }
}
