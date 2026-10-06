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

export function meldeNachUrteil(waechter, { gruen, zeile }) {
  if (gruen) waechter.info(zeile);
  else waechter.fehler(zeile);
}

export function meldeBefunde(waechter, befunde) {
  for (const befund of befunde) waechter.fehler(`BEFUND ${befund}`);
}

export function urteilText(gruen) {
  return gruen ? "GRUEN" : "ROT";
}

export function exitVon(gruen) {
  return gruen ? EXIT.GRUEN : EXIT.ROT;
}

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
