// AL-P11 (Ergebnis-Karte): die EINE Quelle fuer "was ist eine gueltige Ergebnis-Karte".
// Modell-Ausgabe ist FREMDER Text - jede Laenge, jeder Typ, jede Feldzahl ist moeglich.
// Diese Datei klemmt sie auf eine feste Form, BEVOR irgendetwas persistiert wird.
// Rein: kein Store, kein IO, kein config-Import (Muster diagnostic-retention.js).

// Obergrenzen der Karte. Benannte Konstanten statt Literale im Rumpf (G25); sie sind
// bewusst NICHT konfigurierbar (G35 gilt nur fuer Betriebsgroessen): eine groessere
// Karte ist keine Betriebsentscheidung, sondern mehr PII at rest.
export const RESULT_LIST_MAX_ITEMS = 3;
export const RESULT_TEXT_MAX_CHARS = 200;
export const RESULT_EVIDENCE_MAX_ITEMS = 2; // O5: hoechstens 2 woertliche Zitate
export const RESULT_EVIDENCE_MAX_CHARS = 160;

// Ist die Zitat-Erhebung ueberhaupt scharf? EVIDENCE_RETENTION_DAYS=0 = Feature aus:
// weder wird die Prompt-Klausel angehaengt noch ein Zitat uebernommen. Fail-closed,
// exakt die Rolle von diagnosticRetentionEnabled.
export function evidenceRetentionEnabled(privacy) {
  return privacy.evidenceRetentionDays > 0;
}

// Ein Freitext-Feld: Nicht-String -> null, getrimmt, auf maxChars gekappt,
// leer -> null (EINE Form fuer "fehlt").
function clampedText(value, maxChars) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxChars);
}

// Eine Liste: Nicht-Array -> [], Nicht-Strings raus, je Eintrag clampedText,
// leere raus, auf maxItems gekappt.
function clampedList(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  const cleaned = [];
  for (const entry of value) {
    const text = clampedText(entry, maxChars);
    if (text) cleaned.push(text);
    if (cleaned.length >= maxItems) break;
  }
  return cleaned;
}

// Die Karte aus der geparsten Modell-Antwort. NULL, wenn kein einziges Feld etwas
// traegt - dann bleibt call.result null und die Persistenz ist byte-identisch zum
// Bestand (das ist der Rueckfall, wenn das Modell die neuen Keys ignoriert).
// evidenceAllowed=false -> der Key existiert im Ergebnis GAR NICHT (kein leeres
// Array, kein null): es soll nichts geben, das man versehentlich befuellt.
export function normalizeCallResult(parsed, { evidenceAllowed }) {
  const card = {
    outcome: clampedText(parsed?.outcome, RESULT_TEXT_MAX_CHARS),
    commitments: clampedList(parsed?.commitments, RESULT_LIST_MAX_ITEMS, RESULT_TEXT_MAX_CHARS),
    counterpartyCommitments: clampedList(
      parsed?.counterparty_commitments,
      RESULT_LIST_MAX_ITEMS,
      RESULT_TEXT_MAX_CHARS,
    ),
    openPoints: clampedList(parsed?.open_points, RESULT_LIST_MAX_ITEMS, RESULT_TEXT_MAX_CHARS),
    nextStep: clampedText(parsed?.next_step, RESULT_TEXT_MAX_CHARS),
    facts: clampedList(parsed?.facts, RESULT_LIST_MAX_ITEMS, RESULT_TEXT_MAX_CHARS),
  };
  if (evidenceAllowed) {
    card.evidence = clampedList(parsed?.evidence, RESULT_EVIDENCE_MAX_ITEMS, RESULT_EVIDENCE_MAX_CHARS);
  }

  const hasContent =
    card.outcome !== null ||
    card.commitments.length > 0 ||
    card.counterpartyCommitments.length > 0 ||
    card.openPoints.length > 0 ||
    card.nextStep !== null ||
    card.facts.length > 0 ||
    (card.evidence && card.evidence.length > 0);
  return hasContent ? card : null;
}

// Entfernt NUR die Zitate aus einer Karte (Sweep). Reine Mutation, liefert true,
// wenn etwas geaendert wurde -> der Aufrufer zaehlt/save()t nur dann.
export function stripResultEvidence(call) {
  if (!call.result || !("evidence" in call.result)) return false;
  delete call.result.evidence;
  return true;
}

// AL-P11 (umgezogen aus src/mcp-tools.js in INBOX-P2, S2-1): die handlungsrelevanten
// Felder der Ergebnis-Karte als Aussensicht. Das Modul, das die Karte DEFINIERT, besitzt
// auch ihre Aussensicht - vorher lag sie modul-privat in mcp-tools.js und war von der
// REST-/Store-Seite nicht erreichbar, was zwangslaeufig eine ZWEITE Feldliste ergeben
// haette (G5/S2). Blatt-Modul ohne eigene Imports -> kein Zyklus (state-ops.js importiert
// hier bereits, mcp-tools.js ab jetzt ebenfalls).
// BEWUSST OHNE `facts` (reine Eingabe des serverseitigen Gedaechtnisses, AL-P12 - kein
// MCP-Konsument) und OHNE `evidence` (woertliche Aeusserungen eines Dritten, der nie
// eingewilligt hat - ein zweiter Transportweg dafuer waere die Umkehrung der Minimierung
// aus P2b). EINE Quelle fuer Sicht + Schema (G5).
export function resultCardView(result) {
  const card = result ?? {};
  return {
    outcome: card.outcome ?? null,
    commitments: card.commitments ?? [],
    counterparty_commitments: card.counterpartyCommitments ?? [],
    open_points: card.openPoints ?? [],
    next_step: card.nextStep ?? null,
  };
}
