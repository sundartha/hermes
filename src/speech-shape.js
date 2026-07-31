// I8 (call-quality Impl-1), seit AL-P7 in einer eigenen Datei: deterministisches
// Text-Shaping der Modell-Antwort fuer die Sprachausgabe - eine defensive Schicht, falls
// das Modell trotz "Kein Markdown, keine Listen" doch Markdown/Aufzaehlungen/
// Gedankenstriche liefert (TTS liest Sonderzeichen sonst woertlich vor, S1-tts).
//
// ZWEI Ausgaenge aus EINEM Kern (G5): der volle Shaper laeuft einmal ueber den GANZEN
// Turn-Text (Transkript-Zeile), der chunk-sichere ueber ein Satz-Fragment des
// Token-Streams. Rein - kein Store, kein config, kein IO (N7).
//
// VORSICHT bewusst eingehalten: nur GEDANKENSTRICHE MIT umgebendem Leerzeichen werden zu
// Komma normalisiert - Wort-Bindestriche ohne Leerzeichen ("E-Mail",
// "Kuendigungs-Service") bleiben unangetastet.

// Der gemeinsame Kern beider Ausgaenge. ALLE vier Schritte sind chunk-sicher, solange die
// Chunk-Grenze an einem Satzende liegt und nicht unmittelbar vor einem Aufzaehlungs-
// Marker geschnitten wird - genau das garantiert src/speech-chunker.js.
function shapedCore(text) {
  return (
    text
      // Aufzaehlungs-Marker (-, *, +) am Zeilenanfang entfernen, BEVOR die generische
      // Markdown-Bereinigung greift (sonst zerfaellt "- " zu einer bedeutungslosen Luecke).
      .replace(/^[ \t]*[-*+]\s+/gm, "")
      // Verbliebene Markdown-Reste (Betonung/Code/Ueberschrift-Marker).
      .replace(/[*_#`]/g, "")
      // " - "-Gedankenstriche (Leerzeichen auf BEIDEN Seiten) -> Komma; trifft NICHT
      // Wort-Bindestriche ohne umgebendes Leerzeichen.
      .replace(/\s+-\s+/g, ", ")
      // Whitespace/Zeilenumbrueche normalisieren (EIN Leerzeichen), dann trimmen.
      .replace(/\s+/g, " ")
      .trim()
  );
}

// AL-P7: EIN Satz-Fragment des Token-Streams. KEINE terminale Punkt-Ergaenzung (der
// naechste Chunk setzt die Aeusserung fort) und KEIN Abraeumen eines schliessenden
// Kommas (mitten in der Aeusserung ist es die richtige Sprechpause). Der volle Shaper
// laeuft am Turn-Ende ohnehin noch einmal ueber den GANZEN Text - er setzt den
// Schlusspunkt der Transkript-Zeile.
export function shapeChunkForSpeech(text) {
  if (!text) return text;
  return shapedCore(text);
}

// Der GANZE Turn-Text - byte-identisch zum Bestand (I8).
export function shapeForSpeech(text) {
  if (!text) return text;
  // Haengendes Komma/Semikolon/Doppelpunkt am Ende (z.B. Rest eines abgebrochenen
  // Gedankenstrich-Satzes) abraeumen, BEVOR das Satzende ergaenzt wird (sonst ",.").
  const out = shapedCore(text).replace(/[,;:]+$/, "");
  // Satzende sicherstellen - TTS liest einen abrupt endenden Satz sonst unnatuerlich.
  return out && !/[.!?]$/.test(out) ? out + "." : out;
}
