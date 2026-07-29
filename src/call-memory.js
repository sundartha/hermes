// AL-P12 (Beziehungsgedaechtnis): die EINE Quelle fuer "wie sieht eine Erinnerung im
// Prompt aus". Eingabe ist Modell-Ausgabe ueber FREMDE Rede - sie wird hier auf eine
// feste Form, ein festes Budget und EINE Zeile geklemmt, bevor sie in einen Prompt geht.
// Rein: kein Store, kein IO, kein config-Import (Muster call-result.js).

// K aus der Phasen-Spezifikation: die letzten drei Anrufe derselben Gegenstelle.
export const MEMORY_MAX_CALLS = 3;

// Zeichenbudget JE Eintrag. Das Gesamtbudget (600, Plan-Vorgabe) ist damit strukturell
// das Produkt - kein laufender Zaehler, der einen fetten Eintrag das Budget der anderen
// fressen liesse.
export const MEMORY_MAX_ENTRY_CHARS = 200;
export const MEMORY_MAX_CHARS = MEMORY_MAX_CALLS * MEMORY_MAX_ENTRY_CHARS;

// Das Ergebnis ist die Ueberschrift, die Fakten sind der Nutzwert (Abnahme: Call 2 nennt
// einen FAKT aus Call 1). Deshalb bekommt das Ergebnis hoechstens die Haelfte des
// Eintrags-Budgets - ein pathologisch langes Ergebnis kann die Fakten nicht verdraengen.
const MEMORY_MAX_OUTCOME_CHARS = MEMORY_MAX_ENTRY_CHARS / 2;

// Trenner zwischen Ergebnis und Fakten - derselbe wie in assistantContextSection
// (key_facts.join("; ")), damit beide Bloecke gleich klingen (G11).
const MEMORY_PART_SEPARATOR = "; ";

// Modell-Ausgabe auf EINE Zeile falten (Injektions-Riegel E5): kein Zeilenumbruch kann
// einen vorgetaeuschten Prompt-Sektionskopf einschleusen. Nicht-String -> "".
function singleLine(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

// Eine Erinnerung -> EINE prompt-sichere Zeile. null, wenn nichts uebrig bleibt (weder
// Ergebnis noch Fakten haben nach dem Falten noch Inhalt).
export function memoryLine(entry) {
  const outcome = singleLine(entry?.outcome).slice(0, MEMORY_MAX_OUTCOME_CHARS);
  const facts = Array.isArray(entry?.facts) ? entry.facts.map(singleLine).filter(Boolean) : [];
  const parts = [];
  if (outcome) parts.push(outcome);
  if (facts.length) parts.push(facts.join(MEMORY_PART_SEPARATOR));
  if (!parts.length) return null;
  return parts.join(MEMORY_PART_SEPARATOR).slice(0, MEMORY_MAX_ENTRY_CHARS);
}

// Die Zeilen der uebergebenen Erinnerungen (Reihenfolge = Eingabereihenfolge, neueste
// zuerst), hoechstens MEMORY_MAX_CALLS Stueck, Gesamtlaenge <= MEMORY_MAX_CHARS.
export function budgetedMemoryLines(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(memoryLine)
    .filter(Boolean)
    .slice(0, MEMORY_MAX_CALLS);
}
