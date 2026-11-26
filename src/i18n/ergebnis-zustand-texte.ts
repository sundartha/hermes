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

interface TerminTexte {
  datumsForm: string;
  gegenseite: string;
  fehlt: string;
  offen: string;
  bestaetigt: (wer: string, datum: string, uhrzeit: string) => string;
}

const TERMIN_TEXTE: Readonly<Record<Sprache, TerminTexte>> = Object.freeze({
  de: {
    datumsForm: "$3.$2.$1",
    gegenseite: "der Gegenseite",
    fehlt: "nicht genannt",
    offen: "Zum Termin wurde nichts bestätigt. Nächster Schritt: den Stand direkt bei der Gegenseite klären.",
    bestaetigt: (wer, datum, uhrzeit) => `Bestätigt von ${wer}. Datum des Termins: ${datum}. Uhrzeit: ${uhrzeit}.`,
  },
  fr: {
    datumsForm: "$3/$2/$1",
    gegenseite: "votre interlocuteur",
    fehlt: "non précisée",
    offen:
      "Rien n'a été confirmé pour le rendez-vous. Prochaine étape : vérifier la situation directement auprès de votre interlocuteur.",
    bestaetigt: (wer, datum, uhrzeit) => `Confirmé par ${wer}. Date du rendez-vous : ${datum}. Heure : ${uhrzeit}.`,
  },
  en: {
    datumsForm: "$1-$2-$3",
    gegenseite: "the other side",
    fehlt: "not stated",
    offen: "Nothing was confirmed about the appointment. Next step: check the status directly with the other side.",
    bestaetigt: (wer, datum, uhrzeit) => `Confirmed by ${wer}. Appointment date: ${datum}. Time: ${uhrzeit}.`,
  },
});

const DATUM_TEILE = /(\d+)-(\d+)-(\d+)/;
const UHRZEIT_LAENGE = 5;

export function terminSatz(
  sprache: Sprache,
  lage: { bestaetigt: boolean; at: string | null; confirmedBy: string | null } | null,
): string | null {
  if (!lage) return null;
  const texte = TERMIN_TEXTE[sprache];
  if (!lage.bestaetigt) return texte.offen;
  const [tag, uhrzeit] = lage.at?.split("T") ?? [];
  return texte.bestaetigt(
    lage.confirmedBy ?? texte.gegenseite,
    tag?.replace(DATUM_TEILE, texte.datumsForm) ?? texte.fehlt,
    uhrzeit?.slice(0, UHRZEIT_LAENGE) ?? texte.fehlt,
  );
}
