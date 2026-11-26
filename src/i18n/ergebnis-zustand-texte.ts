type Sprache = "de" | "en" | "fr";

const GRUND_SAETZE: Readonly<Record<Sprache, ReadonlyMap<string, string>>> = Object.freeze({
  de: new Map([
    ["menu-only", "Nicht erledigt: Erreicht wurde nur eine Menü-Ansage, keine Person."],
    ["mailbox", "Nicht erledigt: Erreicht wurde nur eine Mailbox, keine Person."],
    ["declined", "Nicht erledigt: Die Gegenseite hat abgelehnt."],
  ]),
  fr: new Map([
    ["menu-only", "Non effectué : seul un menu vocal a été atteint, aucune personne."],
    ["mailbox", "Non effectué : seule une messagerie vocale a été atteinte, aucune personne."],
    ["declined", "Non effectué : votre interlocuteur a refusé."],
  ]),
  en: new Map([
    ["menu-only", "Not done: only an automated menu was reached, no person."],
    ["mailbox", "Not done: only a voicemail box was reached, no person."],
    ["declined", "Not done: the other side declined."],
  ]),
});

export function ergebnisGrundSatz(sprache: Sprache, grund: string | null): string | null {
  return GRUND_SAETZE[sprache].get(String(grund)) ?? null;
}
