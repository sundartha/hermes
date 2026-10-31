import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { listeMitErsatz, stammtAusAltemText } from "../auslagerung-eintraege.mjs";
import { eslintCollectorFindings } from "../basis-vergleich.mjs";
import { gezaehlt, knotenSchluessel, kontingent, pfadAusSchluessel } from "../eslint-rules/bestand.js";
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

export function fristEintraegeNachUmzug({ liste, aktuell, pruefen }) {
  const abgedeckt = kontingent(gezaehlt(aktuell.map(({ key }) => key)));
  const bekannt = kontingent(gezaehlt(liste));
  const offen = liste.flatMap((eintrag, stelle) => (abgedeckt(eintrag) ? [] : [{ stelle, ...schluesselTeile(eintrag) }]));
  const ersatz = new Map();
  for (const fund of aktuell.filter(({ key }) => !bekannt(key))) {
    const neu = schluesselTeile(fund.key);
    const alt = offen.find(
      (eintrag) =>
        !ersatz.has(eintrag.stelle) &&
        eintrag.fingerabdruck === neu.fingerabdruck &&
        pruefen.neueDatei(neu.pfad) &&
        pruefen.stammtAus(fund.text, { von: eintrag.pfad, nach: neu.pfad }) &&
        !pruefen.nochDort(fund.text, { von: eintrag.pfad }),
    );
    if (alt !== undefined) ersatz.set(alt.stelle, fund.key);
  }
  return listeMitErsatz(liste, ersatz);
}

const EINHEIT_ENDEN = ["Statement", "Declaration"];
const FUNKTIONEN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function istEinheit(knoten) {
  return knoten.parent === null || knoten.parent.type === "Program" || EINHEIT_ENDEN.some((ende) => knoten.type.endsWith(ende));
}

function aeussersteFunktion(knoten) {
  let aeusserste = knoten;
  for (let hoch = knoten.parent; hoch !== null; hoch = hoch.parent) if (FUNKTIONEN.has(hoch.type)) aeusserste = hoch;
  return aeusserste;
}

export function umschliessendeEinheit(knoten) {
  let einheit = aeussersteFunktion(knoten);
  while (!istEinheit(einheit)) einheit = einheit.parent;
  return einheit;
}

async function fristFunde(root) {
  const funde = await eslintCollectorFindings(root, FRIST_REGEL, {
    files: FRIST_QUELLEN,
    keysOf: (context, datei) =>
      anfragenOhneFrist(context.sourceCode, datei).map((knoten) => ({
        key: JSON.stringify({ key: knotenSchluessel(context.sourceCode, datei, knoten), text: context.sourceCode.getText(umschliessendeEinheit(knoten)) }),
        loc: knoten.loc,
      })),
  });
  return funde.map(({ key }) => JSON.parse(key));
}

function dateiJetzt(root, pfad) {
  const datei = join(root, pfad);
  return existsSync(datei) ? readFileSync(datei, "utf8") : null;
}

export async function fristListeNachUmzug({ liste, basis, root }) {
  const pruefen = {
    neueDatei: (datei) => !gibtEsIn(basis, datei, root),
    stammtAus: (text, { von }) => stammtAusAltemText(text, dateiAm(basis, von, root)),
    nochDort: (text, { von }) => stammtAusAltemText(text, dateiJetzt(root, von)),
  };
  return fristEintraegeNachUmzug({ liste, aktuell: await fristFunde(root), pruefen });
}
