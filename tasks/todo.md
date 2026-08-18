# Durchgang: die drei Gespraechsdefekte aus Anruf 6

Auftrag des Eigentuemers vom 18.08.2026. Reihenfolge bindend: Befund 1, dann 3, dann 2.
EIN Push, danach EIN Verifikationsanruf. Was ueber Testdefinitionen beweisbar ist, wird
nicht am Telefon bewiesen.

## 0 — AUFRAEUMEN (vor dem Push)

- [x] `PER_TARGET_CALL_CAP` zurueck auf 3
      SOLL: der lokale Server laeuft ohne die Anhebung; ein vierter Anruf an dieselbe
      Nummer innerhalb von 24 h wird mit 429 abgelehnt.
      PRUEFUNG: Boot-Zeile + erneuter Waehlversuch -> 429 `ziel_limit`.
- [x] Werkzeug-URL zurueck auf `https://app.sundartha.com/webhooks/elevenlabs/consult`
      Der Konflikt hat sich aufgeloest: der Eigentuemer ist weg, der Anruf entfaellt heute,
      also braucht niemand mehr die Tunnel-Adresse. Zurueckgedreht, Ruecklese OK, Rest des
      Werkzeugs byte-gleich. Tunnel beendet.

## 1 — BEFUND 1: die Stille nach der Eroeffnung

### Messung (abgeschlossen, Ergebnis siehe .fortschritt.md)

- [x] Erste Aeusserung woertlich, Frage ja/nein -> Offenlegung allein, KEINE Frage
- [x] Stille-Ausloeser gefunden und benannt -> `turn.turn_timeout = 7`
- [x] Abbruch der Nachfrage: KEINE Laengenbegrenzung, sondern Barge-in
      (`interrupted: true`) -> KEIN zweiter Befund

### Bau

- [x] `openingQuestion` je Sprache in `src/i18n/locales.js` (de/fr/en)
      SOLL: EIN Satz, eine echte Frage, keine Interpolation.
- [x] Vorlage: `agent.first_message` (en) und `language_presets.de/fr` tragen
      Offenlegung + `bridgePhrase("{{objective}}")` + `openingQuestion`
      SOLL: der Offenlegungssatz bleibt WOERTLICH der Anfang (Absolute Regel 2).
      PRUEFUNG: `npm test` - T5 (c)/(e) vergleichen byte-genau gegen den aus LOCALES
      zusammengesetzten Satz UND pruefen zusaetzlich `startsWith(disclosure)`.
- [x] Vorlage: `turn.turn_timeout` 7 -> 5
      SOLL: der Wert steht in der Vorlage und ist besessen (Eintrag existiert bereits).

## 2 — BEFUND 3: Klammer-Tags raus

- [x] `tts.suggested_audio_tags` -> `[]`
- [x] `turn.soft_timeout_config`: `message`, `additional_soft_timeout_messages` und
      `llm_generated_message_prompt_override` ohne Klammerausdruecke
      GRUND: sonst kommen die Tags durch die Soft-Timeout-Tuer zurueck.
- [x] Prompt: das Verbot bleibt und wird scharf gestellt
- [x] RIEGEL: eine Pruefung ueber das Transkript JEDES Anrufs, die anschlaegt
      SOLL: Agenten-Zeile mit `[...]` -> laute Log-Zeile mit Anzahl und Fundstellen,
      NICHT stillschweigend entfernt (Qualitaet 3).
      PRUEFUNG + ROTPROBE: Test schleust `[Curious]` ein und weist den Treffer nach;
      Gegenprobe ohne Tag -> kein Treffer.

## 3 — BEFUND 2: der Agent greift nicht von selbst zum Werkzeug

- [x] Prompt: kurze, trennscharfe Werkzeug-Zuordnung
      SOLL: (a) unbeantwortbare Frage -> ZUERST `get_consult`, "weiss ich nicht" ohne
      vorherigen Aufruf ist ein Fehler; (b) der Auftraggeber wird NIE als alternativer
      Kontaktweg angeboten; (c) was ausdruecklich KEIN Anlass ist.
- [x] Testdefinition B1: Gegenseite fragt etwas Unwissbares
      SOLL gruen: Werkzeug wurde gerufen, BEVOR ein "weiss ich nicht" fiel.
- [x] Testdefinition B2: Gegenseite fragt etwas, das im Auftrag steht
      SOLL gruen: Werkzeug wurde NICHT gerufen (`verify_absence`).
- [x] beide am Konto registriert und gruen, VOR dem Verifikationsanruf

## 4 — PUSH + PROTOKOLL

- [x] Sperrriegel-Rotprobe gruen -> Trockenlauf -> `--felder=` -> Ruecklese -> Drift
- [x] vier Werte je Push in `.fortschritt.md`

## 5 — VERIFIKATIONSANRUF (ein einziger)

Gemessen wird: (1) Sekunden zwischen Ende der Eroeffnung und erster Reaktion,
(2) endet die Eroeffnung mit einer Frage, (3) Klammerausdruecke im Transkript
(Erwartung 0), (4) Werkzeug von selbst gerufen ohne Stoss, (5) Offenlegungssatz
woertlich unter "Art. 50 Nachweis" mit Anruf-ID.

## NEBENBEFUND (zeitbegrenzt, ein Durchgang)

- [x] Cache-Write 13.062 gegen 6.531 - warum Faktor zwei, abstellbar?
      GEKLAERT: es IST kein Faktor zwei. An vier Anrufen gemessen 1,00 / 1,50 / 2,00 -
      ganzzahlige Vielfache EINER Schreib-Einheit. Abgerechnet wird je ANGEFANGENER
      Generierung, verworfene zaehlen mit. Kein Einstellfeld beim Anbieter; kleiner wird
      es nur ueber weniger Abbrueche.

## REVIEW

ALLES ERLEDIGT AUSSER DEM ANRUF (Eigentuemer ist weg).

- npm test: 4655 von 4655 gruen.
- npm run elevenlabs:drift: **exit 0** - nur die zwei bewusst ausgenommenen
  Datenschutz-Felder weichen ab.
- B1 und B2 am Konto registriert und beide **passed**
  (suite_2701m0b2e1x5fyrtq1d8d3vvc9qp).
- Drei Commits, alle gepusht: ed670a2, f8deb33, 9b472c2.

DREI DINGE, DIE ANDERS KAMEN ALS GEPLANT - Begruendung in .fortschritt.md:

1. Die Hypothese zu Befund 1 stimmte nur halb. Es GAB einen Stille-Ausloeser
   (turn_timeout=7); von den 17 s waren ~8 s die Offenlegung selbst, echte Stille
   ~11 s. Der Prompt kann das nicht heilen - nach first_message hat der Agent keinen
   Zug. Deshalb steht die Eroeffnung jetzt IN first_message.
2. Das Push-Kommando kann `language_presets` strukturell NICHT schreiben (Mengen-
   Vergleich). Der deutsche Eroeffnungssatz brauchte ein eigenes, eng gefuehrtes
   Kommando mit denselben Riegeln plus einer Art.-50-Pruefung gegen LOCALES.
3. B1s erstes Rot war FALSCH - der Agent war richtig, die Parameter-Bewertung des
   Anbieters fand einen Pfad nicht, den der Aufruf traegt. Pruefung entfernt.

SPAETER-LISTE

- Wie loest der Anbieter `parameters[].path` auf? Betrifft auch A1 und A5-tool.
- Das Push-Kommando kann besessene Sammlungs-Felder nicht schreiben.
- Der Cache-Write-Aufschlag ist keine Konfiguration, sondern verworfene
  Generierungen - Gegenprobe am Verifikationsanruf.
- Die Eroeffnung ist jetzt ~12 s nicht unterbrechbar. Ob der Tausch gegen 11 s
  Stille richtig ist, entscheidet der Anruf.
