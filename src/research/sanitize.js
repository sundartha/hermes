// Egress-Riegel der Vorab-Recherche (O3, fail-closed). Anthropics serverseitige Suche
// laeuft INNERHALB des Modell-Aufrufs - wir sehen die Query nicht, bevor sie rausgeht
// und koennen sie nicht filtern. Der einzige belastbare Riegel ist deshalb die Kontrolle
// darueber, WAS das Modell ueberhaupt zu sehen bekommt.
//
// Die Whitelist ist eine gefrorene DATENKONSTANTE und per Test gepinnt (nicht per
// Kommentar), damit eine spaetere Phase sie nicht versehentlich aufweicht.
//
// NICHT auf der Liste und deshalb bei aktiver Recherche NICHT im Modell-Eingang:
// `to` - die Rufnummer des Angerufenen. Sie ist personenbezogen und hat in einem
// Suchindex nichts verloren.
//
// `context` und `open_questions` nennt der Plan ebenfalls; in DIESER Phase sind sie
// keine Eingaben (das Briefing laeuft nur, wenn kein context vorliegt; open_questions
// ist ein AUSGABE-Feld). Sie kommen mit der Phase dazu, die sie liefert - auf Vorrat
// gelistet waeren sie tote Konstanten.
export const RESEARCH_EGRESS_FIELDS = Object.freeze(["objective", "ownerNotes", "constraints"]);

// Reine Projektion auf die Whitelist (Muster pickKnownFields, routes/_validation.js):
// alles Nicht-Gelistete faellt weg. Rein (N7), keine Mutation der Eingabe.
export function researchEgressInput(input) {
  const out = {};
  for (const field of RESEARCH_EGRESS_FIELDS) {
    if (input?.[field] != null) out[field] = input[field];
  }
  return out;
}
