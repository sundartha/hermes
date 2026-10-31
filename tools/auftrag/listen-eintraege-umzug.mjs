import { posix } from "node:path";

import { stammtAusAltemText } from "../auslagerung-eintraege.mjs";
import { eslintCollectorFindings } from "../basis-vergleich.mjs";
import { gezaehlt, knotenSchluessel, pfadAusSchluessel } from "../eslint-rules/bestand.js";
import { anfragenOhneFrist } from "../eslint-rules/anfrage-mit-frist.js";
import { dateiAm, gibtEsIn } from "./git.mjs";

export function schluesselUmgezogen(objekt, { neuFuer }) {
  return Object.fromEntries(
    Object.entries(objekt).map(([pfad, wert]) => {
      const neu = neuFuer.get(pfad);
      return [neu === undefined || Object.hasOwn(objekt, neu) ? pfad : neu, wert];
    }),
  );
}

function feldUmgezogen(eintrag, feld, neuFuer) {
  const neu = neuFuer.get(eintrag[feld]);
  return neu === undefined ? eintrag : { ...eintrag, [feld]: neu };
}

function endungNachgezogen(eintrag, { alt, neu }) {
  const name = posix.basename(alt);
  const quelle = eintrag.unresolvedTo;
  if (typeof quelle !== "string" || !quelle.endsWith(`/${name}`)) return eintrag;
  return { ...eintrag, unresolvedTo: `${quelle.slice(0, -name.length)}${posix.basename(neu)}` };
}

export function abhaengigkeitenUmgezogen(liste, { neuFuer }) {
  return liste.map((eintrag) => {
    const umgezogen = feldUmgezogen(feldUmgezogen(eintrag, "from", neuFuer), "to", neuFuer);
    return umgezogen.to === eintrag.to ? umgezogen : endungNachgezogen(umgezogen, { alt: eintrag.to, neu: umgezogen.to });
  });
}

export const FRIST_LISTE = "tools/basis/anfrage-mit-frist.json";
const FRIST_REGEL = "anfrage-mit-frist";
const FRIST_QUELLEN = ["src/**"];
const SCHLUESSEL_TRENNER = "|";

function schluesselTeile(schluessel) {
  const pfad = pfadAusSchluessel(schluessel);
  return { pfad, fingerabdruck: schluessel.slice(pfad.length + SCHLUESSEL_TRENNER.length) };
}

function offeneEintraege(liste, uebrig) {
  return liste.flatMap((eintrag, stelle) => {
    const frei = uebrig.get(eintrag) ?? 0;
    if (frei <= 0) return [{ stelle, ...schluesselTeile(eintrag) }];
    uebrig.set(eintrag, frei - 1);
    return [];
  });
}

function unbekannteFunde(aktuell, uebrig) {
  return aktuell.filter(({ key }) => {
    const frei = uebrig.get(key) ?? 0;
    uebrig.set(key, frei - 1);
    return frei > 0;
  });
}

export function fristEintraegeNachUmzug({ liste, aktuell, pruefen }) {
  const uebrig = gezaehlt(aktuell.map(({ key }) => key));
  const offen = offeneEintraege(liste, uebrig);
  const ersatz = new Map();
  for (const fund of unbekannteFunde(aktuell, uebrig)) {
    const neu = schluesselTeile(fund.key);
    const alt = offen.find(
      (eintrag) =>
        !ersatz.has(eintrag.stelle) &&
        eintrag.fingerabdruck === neu.fingerabdruck &&
        pruefen.neueDatei(neu.pfad) &&
        pruefen.stammtAus(fund.text, { von: eintrag.pfad, nach: neu.pfad }),
    );
    if (alt !== undefined) ersatz.set(alt.stelle, fund.key);
  }
  if (ersatz.size === 0) return undefined;
  return { neu: liste.map((eintrag, stelle) => ersatz.get(stelle) ?? eintrag).toSorted(), anzahl: ersatz.size };
}

async function fristFunde(root) {
  const funde = await eslintCollectorFindings(root, FRIST_REGEL, {
    files: FRIST_QUELLEN,
    keysOf: (context, datei) =>
      anfragenOhneFrist(context.sourceCode, datei).map((knoten) => ({
        key: JSON.stringify({ key: knotenSchluessel(context.sourceCode, datei, knoten), text: context.sourceCode.getText(knoten) }),
        loc: knoten.loc,
      })),
  });
  return funde.map(({ key }) => JSON.parse(key));
}

export async function fristListeNachUmzug({ liste, basis, root }) {
  const pruefen = {
    neueDatei: (datei) => !gibtEsIn(basis, datei, root),
    stammtAus: (text, { von }) => stammtAusAltemText(text, dateiAm(basis, von, root)),
  };
  return fristEintraegeNachUmzug({ liste, aktuell: await fristFunde(root), pruefen });
}
