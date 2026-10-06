export const AUDIO_TAG = /\[[^\]\n]{1,40}\]/g;

const SATZ_GRENZE = /\n+|(?<=[.!?])\s+/;

const MIN_GEMEINSAME_LEXEME = 2;
const MIN_LEXEM_LAENGE = 3;

const B1_LEIT_CUES = Object.freeze({
  de: ["gut", "klar", "okay", "ok", "gerne", "gern", "natuerlich", "sicher"],
  en: ["sure", "okay", "ok", "certainly", "absolutely", "perfect", "great", "glad"],
  fr: ["bien", "certainement", "volontiers", "parfait", "absolument"],
});
const ALLE_LEIT_CUES = new Set(Object.values(B1_LEIT_CUES).flat());

const FUNKTIONSWOERTER = new Set([
  "aber", "als", "auch", "auf", "aus", "bei", "bin", "bis", "da", "dann", "das", "dass",
  "dem", "den", "der", "des", "die", "dich", "dir", "doch", "du", "ein", "eine", "einem",
  "einen", "einer", "es", "euch", "euer", "fur", "fuer", "hat", "habe", "haben", "hier",
  "ich", "ihm", "ihn", "ihnen", "ihr", "ihre", "im", "in", "ist", "ja", "kann", "kein",
  "keine", "man", "mein", "meine", "mit", "nach", "nicht", "noch", "nun", "nur", "ob",
  "oder", "sich", "sie", "sind", "so", "somit", "uber", "ueber", "uns", "unser", "und",
  "vom", "von", "vor", "war", "wird", "wir", "wirst", "wohl", "zu", "zum", "zur",
  "the", "and", "but", "for", "with", "this", "that", "these", "those", "you", "your",
  "will", "shall", "have", "has", "had", "been", "being", "are", "was", "were", "not",
  "here", "there", "then", "when", "what", "which", "who", "whom", "whose", "why", "how",
  "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "than",
  "too", "very", "can", "just", "should", "now", "its", "his", "her", "him", "she", "they",
  "them", "their", "ours", "our", "out", "off", "over", "under", "again", "once", "into",
  "from", "about",
  "les", "une", "des", "est", "sont", "suis", "vous", "ils", "elles", "nous", "leur",
  "leurs", "mais", "donc", "car", "comme", "tout", "tous", "toute", "toutes", "pas",
  "plus", "tres", "ici", "alors", "chez", "avec", "sans", "sous", "sur", "dans", "pour",
  "par", "que", "qui", "quoi", "son", "ses", "mon", "ma", "tes", "mes", "cet", "cette",
  "ces", "ait", "ont", "avais", "etre", "avoir",
]);

const AGENT_ROLLE = "agent";

const saetzeVon = (text) =>
  String(text ?? "")
    .split(SATZ_GRENZE)
    .map((satz) => satz.trim())
    .filter(Boolean);

const klammerfrei = (text) => String(text ?? "").replace(AUDIO_TAG, " ");

const normalisiert = (wort) => {
  const kleinOhneDiakritika = String(wort)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return kleinOhneDiakritika.replace(/[^\p{L}\p{N}]/gu, "");
};

const woerterVon = (satz) => satz.split(/\s+/).filter(Boolean);

const istReinNumerisch = (wort) => /^\d+$/.test(wort);

const leitCue = (satz) => {
  const [erstes] = woerterVon(satz);
  const kandidat = normalisiert(erstes ?? "");
  return ALLE_LEIT_CUES.has(kandidat) ? kandidat : null;
};

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
