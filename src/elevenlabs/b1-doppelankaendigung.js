// ---- B1-Heuristik: doppelte Ankuendigung desselben Inhalts (ST3, O3) --------------------
// Vorfall 2026-09-02 (tasks/PLAN-AGENTEN-STIMME.md, O3/R5/R8): der Agent kuendigte ein
// kurzes Gedicht an ("Gut, dann erzaehle ich dir ein kurzes Gedicht.") und kuendigte es
// unmittelbar danach ein ZWEITES Mal an ("[froehlich] Klar, hier ein kurzes Gedicht:"),
// bevor er es lieferte. Dieses Modul ist die reine Heuristik, die so etwas ZAEHLT - der
// Reporter daneben (reportDoubleAnnouncements, elevenlabs/outbound.js) meldet, der Store
// zaehlt (recordElDetectorCounts). NUR Diagnose: nichts hier aendert ein Transkript.
//
// ENGE LESART (bewusst): erkannt wird nur ein PAAR UNMITTELBAR aufeinanderfolgender
// Saetze INNERHALB EINER Agenten-Zeile, von denen BEIDE mit einem Leit-Cue beginnen und
// deren Inhalts-Lexeme sich ueberschneiden. Cross-Turn-Ankuendigungen (Ankuendigung in
// Zeile n, Auslieferung in Zeile n+2) sind bewusst draussen: sie sind vom gueltigen
// Tool-Announce-Muster ("Einen Moment, ich frage kurz nach" gefolgt vom Werkzeug-Ereignis)
// nicht trennbar und wuerden die Zahl mit Rauschen fuellen.
//
// FALSE-POSITIVE-TOLERANZ (Owner-Entscheidung 5, dokumentiert statt behoben): natuerliche
// Wiederholungen mit Cue und mindestens zwei gemeinsamen Inhalts-Lexemen bleiben moeglich
// ("Klar, das Gedicht kommt gleich. Gut, das Gedicht beginnt jetzt."). Die Gegenprobe
// (AS8, saubere Echtfall-Fixtures) und das Zaehlfeld machen die Rueckfall-Rate sichtbar -
// feuert [el-b1] dauernd, wird die Detaillierung duenner gezogen, NIE abgestellt.
//
// SPRACHEN: de/en/fr ueber geschlossene, kombinierte Cue- und Funktionswort-Listen. Die
// Lexem-Overlap-Pruefung selbst ist sprachagnostisch - ein spaeterer Viert-Sprach-Fall
// waechst um eine Liste, nicht um eine Logik.
//
// R8-VERTRAG (PII-Freiheit der Ergebnisse): Treffer tragen NUR Leit-Cues und Zeilenindizes,
// NIE Satz- oder Wortlaute. Die Cues stammen aus den geschlossenen Listen unten, die
// Zeilenindizes beziehen sich auf die Liste gesprochener Zeilen, die persistProviderResult
// sieht (elevenlabs/outbound.js).
//
// SCHWELLEN SIND MODUL-KONSTANTEN, absichtlich KEINE config.js-Werte (G35 bewusst nicht
// angewandt): ein Bedienknopf fuer eine Diagnose-Schwelle laedt dazu ein, sie so lange
// hochzudrehen, bis nichts mehr meldet. Tuning heisst hier: Code + Test aendern.

// Ein Klammerausdruck im GESPROCHENEN Text. Laengenbegrenzt, damit die Pruefung eine
// Marke findet ("[Curious]") und nicht einen halben Satz, der zufaellig zwei Klammern
// enthaelt; kein Zeilenumbruch aus demselben Grund. WOHNT HIER (nicht in outbound.js),
// weil die Lexemisierung der B1-Heuristik denselben Begriff von "Marke" braucht wie der
// [el-tags]-Detektor - EINE Quelle, Import-Richtung nur outbound -> hier (kein Zykel).
export const AUDIO_TAG = /\[[^\]\n]{1,40}\]/g;

// Satzgrenzen: Satzzeichen plus Whitespace, sowie jeder Zeilenumbruch. Der Umbruch zaehlt
// als Grenze, weil der Vorfall den Inhalt mit "\n\n" einleitete ("...Gedicht:\n\n<Gedicht>")
// - ohne ihn klebten die Gedichtzeilen am Ankuendigungs-Satz, und die Vers-Fragmente
// wuerden den Lexem-Overlap verwaessern.
const SATZ_GRENZE = /\n+|(?<=[.!?])\s+/;

// Mindest-Ueberdeckung der Inhalts-Lexeme beider Saetze (R5): ein Cue-Paar ohne inhaltliche
// Uebereinstimmung ist hoechstwahrscheinlich ein natuerlicher Sprecherwechsel im Satz.
const MIN_GEMEINSAME_LEXEME = 2;
// Kuerzere Woerter sind Funktionswoerter, Abkuerzungen oder Rufzeichen - sie tragen keine
// inhaltliche Uebereinstimmung bei, die zwei Saetze als "vom selben Inhalt" auswiese.
const MIN_LEXEM_LAENGE = 3;

// Leit-Cues: geschlossene Liste der Woerter, mit denen ein Agent eine Aeusserung EINLEITET,
// bevor er Inhalt liefert (deutsch "Gut, ...", englisch "Sure, ...", franzoesisch
// "Parfait, ..."). Normalisierte Kleinschreibung (s. normalisiert unten) - "Klar" und
// "klar" sind derselbe Cue. Geschlossen, weil jede Erweiterung die False-Positive-Rate
// aendert und deshalb durch einen Test gehen muss, nicht durch Konfiguration.
const B1_LEIT_CUES = Object.freeze({
  de: ["gut", "klar", "okay", "ok", "gerne", "gern", "natuerlich", "sicher"],
  en: ["sure", "okay", "ok", "certainly", "absolutely", "perfect", "great", "glad"],
  fr: ["bien", "certainement", "volontiers", "parfait", "absolument"],
});
const ALLE_LEIT_CUES = new Set(Object.values(B1_LEIT_CUES).flat());

// Funktionswoerter der drei Sprachen (Artikel, Pronomen, Auxiliare, Konjunktionen und
// Fuelle-"so"/"hier"/"dann") in normalisierter Form - sie zaehen nicht als gemeinsame
// INHALTS-Lexeme, sonst faende JEDE Zwei-Satz-Folge eine Uebereinstimmung.
const FUNKTIONSWOERTER = new Set([
  // de
  "aber", "als", "auch", "auf", "aus", "bei", "bin", "bis", "da", "dann", "das", "dass",
  "dem", "den", "der", "des", "die", "dich", "dir", "doch", "du", "ein", "eine", "einem",
  "einen", "einer", "es", "euch", "euer", "fur", "fuer", "hat", "habe", "haben", "hier",
  "ich", "ihm", "ihn", "ihnen", "ihr", "ihre", "im", "in", "ist", "ja", "kann", "kein",
  "keine", "man", "mein", "meine", "mit", "nach", "nicht", "noch", "nun", "nur", "ob",
  "oder", "sich", "sie", "sind", "so", "somit", "uber", "ueber", "uns", "unser", "und",
  "vom", "von", "vor", "war", "wird", "wir", "wirst", "wohl", "zu", "zum", "zur",
  // en
  "the", "and", "but", "for", "with", "this", "that", "these", "those", "you", "your",
  "will", "shall", "have", "has", "had", "been", "being", "are", "was", "were", "not",
  "here", "there", "then", "when", "what", "which", "who", "whom", "whose", "why", "how",
  "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "than",
  "too", "very", "can", "just", "should", "now", "its", "his", "her", "him", "she", "they",
  "them", "their", "ours", "our", "out", "off", "over", "under", "again", "once", "into",
  "from", "about",
  // fr
  "les", "une", "des", "est", "sont", "suis", "vous", "ils", "elles", "nous", "leur",
  "leurs", "mais", "donc", "car", "comme", "tout", "tous", "toute", "toutes", "pas",
  "plus", "tres", "ici", "alors", "chez", "avec", "sans", "sous", "sur", "dans", "pour",
  "par", "que", "qui", "quoi", "son", "ses", "mon", "ma", "tes", "mes", "cet", "cette",
  "ces", "ait", "ont", "avais", "etre", "avoir",
]);

// Die Rolle, unter der der Anbieter seine eigenen Zeilen fuehrt (elf Konversationen
// gemessen, immer "agent"). Lokal statt Import aus outbound.js: zur Import-Richtung
// outbound -> hier duerfe kein zweiter zurueckstehen (Zykel).
const AGENT_ROLLE = "agent";

const saetzeVon = (text) =>
  String(text ?? "")
    .split(SATZ_GRENZE)
    .map((satz) => satz.trim())
    .filter(Boolean);

// Marken vor der Satz-Zerlegung durch EIN Leerzeichen ersetzen (nicht "" - sonst klebten
// "Gedicht." und "[Marke] Klar" zu "Gedicht.Klar" zusammen und die Satzgrenze fiele weg).
const klammerfrei = (text) => String(text ?? "").replace(AUDIO_TAG, " ");

// NFD-Diakritika-Strip + Kleinschreibung + Satz-/Apostroph-Zeichen raus ("fröhlich" wird
// zu seiner ASCII-Form, "d'accord" zu "daccord") - Cue- und Lexem-Vergleich ueber reine
// Buchstaben-/Ziffernfolgen.
// In zwei benannte Schritte getrennt (G19): erst die Diakritika-freie Kleinschreibung,
// dann das Herausfiltern der Satzzeichen.
const normalisiert = (wort) => {
  const kleinOhneDiakritika = String(wort)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return kleinOhneDiakritika.replace(/[^\p{L}\p{N}]/gu, "");
};

const woerterVon = (satz) => satz.split(/\s+/).filter(Boolean);

const istReinNumerisch = (wort) => /^\d+$/.test(wort);

// Der Leit-Cue eines Satzes: sein ERSTES normalisiertes Wort, wenn es in einer der drei
// Cue-Listen steht, sonst null (kein Cue -> kein B1-Kandidat, egal was folgt).
const leitCue = (satz) => {
  const [erstes] = woerterVon(satz);
  const kandidat = normalisiert(erstes ?? "");
  return ALLE_LEIT_CUES.has(kandidat) ? kandidat : null;
};

// Inhalts-Lexeme eines Satzes: normalisierte Woerter ab MIN_LEXEM_LAENGE, ohne
// Funktionswoerter und ohne reine Zahlen - die Woerter, die den INHALT tragen.
const inhaltsLexeme = (satz) =>
  new Set(
    woerterVon(satz)
      .map(normalisiert)
      .filter(
        (lexem) =>
          lexem.length >= MIN_LEXEM_LAENGE && !FUNKTIONSWOERTER.has(lexem) && !istReinNumerisch(lexem),
      ),
  );

const anzahlGemeinsamerLexeme = (erster, zweiter) => {
  const lexemeZweiter = inhaltsLexeme(zweiter);
  let gemeinsam = 0;
  for (const lexem of inhaltsLexeme(erster)) {
    if (lexemeZweiter.has(lexem)) gemeinsam += 1;
  }
  return gemeinsam;
};

const istAgentZeile = (zeile) => Boolean(zeile && zeile.message && zeile.role === AGENT_ROLLE);

// EIN Treffer je Agenten-Zeile: das ERSTE Paar unmittelbar aufeinanderfolgender Saetze,
// in dem BEIDE Saetze mit einem Leit-Cue beginnen und die Inhalts-Lexeme sich mindestens
// MIN_GEMEINSAME_LEXEME-mal schneiden. `zeile` ist der Index in der UEBERGEBENEN Liste
// (so wie persistProviderResult sie sieht - inklusive Anrufer-Zeilen, die uebersprungen,
// aber mitgezaehlt werden). Rueckgabeform (R8): [{ zeile, cues }] - mehr nicht.
export function findeB1Treffer(zeilen) {
  const treffer = [];
  (zeilen ?? []).forEach((zeile, index) => {
    if (!istAgentZeile(zeile)) return;
    const saetze = saetzeVon(klammerfrei(zeile.message));
    for (let i = 0; i + 1 < saetze.length; i++) {
      const ersterCue = leitCue(saetze[i]);
      const zweiterCue = leitCue(saetze[i + 1]);
      if (!ersterCue || !zweiterCue) continue;
      if (anzahlGemeinsamerLexeme(saetze[i], saetze[i + 1]) < MIN_GEMEINSAME_LEXEME) continue;
      treffer.push({ zeile: index, cues: [ersterCue, zweiterCue] });
      return;
    }
  });
  return treffer;
}
