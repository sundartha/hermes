import { istObjekt, liste } from "./erkundung.mjs";
import { abschnitt, json } from "./nachricht.mjs";
import { befundZeilen } from "./planbericht.mjs";

export const FUNDSTELLE_KOPF = "(Fundstelle: ";

const AN_DER_ERKUNDUNG = /^(?:weg|ausweg):([^:\s]+)/u;
const BEHALTEN = "Das ist deine Schnittliste aus dem vorigen Lauf dieser Planung. Behalte sie und ändere nur, was die offenen Befunde oder die Antworten auf Nachfragen verlangen, damit schon geschlossene Befunde geschlossen bleiben; schneide nicht neu. Antworte dazu mit `teilliste` statt der ganzen Schnittliste: nur was sich ändert, leer `{}`, wenn nichts zu ändern ist. Das Skript und ein neuer Prüfer prüfen sie wie jede neue Schnittliste; was unten steht, gilt nicht als erledigt, nur weil es dort steht.";

function amBericht(zeile) {
  return zeile.includes(FUNDSTELLE_KOPF);
}

function frageZu(zeile) {
  return `Diese Frage stellt das Skript, nicht der Planer. An deinem Bericht ist dieser Befund offen: „${zeile}“. Lies die genannte Stelle im Code neu und prüf den Befund. Stimmt er, berichtige genau diese Angabe und übernimm alle anderen Angaben unverändert. Stimmt er nicht, lass die Angabe stehen und nenn den Beleg unter hinweise.`;
}

export function berichtigungsFragen(wegOffen, ausgeschoepft) {
  const offen = wegOffen.filter(({ nummern, zeile }) => amBericht(zeile) && nummern.some((nummer) => !ausgeschoepft.has(nummer)));
  return offen.map(({ nummern, zeile }) => ({ nummern, frage: frageZu(zeile) }));
}

export function offeneErkundungsbefunde(offen, soll) {
  return offen.flatMap((zeile) => {
    const nummer = AN_DER_ERKUNDUNG.exec(zeile)?.[1];
    return amBericht(zeile) && soll.has(nummer) ? [{ nummern: [nummer], zeile }] : [];
  });
}

function befundeDes(bericht) {
  const befunde = istObjekt(bericht?.befunde) ? bericht.befunde : {};
  const zeilen = befundZeilen({ offen: liste(befunde.offen), korrigiert: liste(befunde.korrigiert), zurueckgewiesen: liste(befunde.zurueckgewiesen) });
  return zeilen.length === 0 ? "keine" : zeilen.map((zeile) => `- ${zeile}`).join("\n");
}

export function schnittDesVorigenLaufs(schnitt, bericht) {
  if (!istObjekt(schnitt)) return [];
  return [abschnitt("Dein Schnitt aus dem vorigen Lauf", `${BEHALTEN}\n\n${json(schnitt)}`), abschnitt("Befunde des vorigen Laufs", befundeDes(bericht))];
}
