# Durchgang: die drei Gespraechsdefekte aus Anruf 6

Auftrag des Eigentuemers vom 18.08.2026. Reihenfolge bindend: Befund 1, dann 3, dann 2.
EIN Push, danach EIN Verifikationsanruf. Was ueber Testdefinitionen beweisbar ist, wird
nicht am Telefon bewiesen.

## 0 — AUFRAEUMEN (vor dem Push)

- [x] `PER_TARGET_CALL_CAP` zurueck auf 3
      SOLL: der lokale Server laeuft ohne die Anhebung; ein vierter Anruf an dieselbe
      Nummer innerhalb von 24 h wird mit 429 abgelehnt.
      PRUEFUNG: Boot-Zeile + erneuter Waehlversuch -> 429 `ziel_limit`.
- [ ] Werkzeug-URL zurueck auf `https://app.sundartha.com/webhooks/elevenlabs/consult`
      ABWEICHUNG VON DER ANWEISUNG, offen benannt: der Verifikationsanruf entsteht LOKAL,
      also braucht `get_consult` bis dahin die Tunnel-Adresse. Auf `app.sundartha.com`
      steht heute ein Dienst vom 14.08., der die Route mit 404 beantwortet - der Agent
      liefe im Verifikationsanruf in einen Werkzeugfehler und Messpunkt 4 waere verrauscht.
      Deshalb: zurueckgedreht UNMITTELBAR NACH dem Anruf, nicht davor. Wenn der Eigentuemer
      das anders will, sagt er es vor dem Anruf.
      PRUEFUNG: Ruecklese des Werkzeugs zeigt die app.sundartha.com-Adresse.

## 1 — BEFUND 1: die Stille nach der Eroeffnung

### Messung (abgeschlossen, Ergebnis siehe .fortschritt.md)

- [x] Erste Aeusserung woertlich, Frage ja/nein -> Offenlegung allein, KEINE Frage
- [x] Stille-Ausloeser gefunden und benannt -> `turn.turn_timeout = 7`
- [x] Abbruch der Nachfrage: KEINE Laengenbegrenzung, sondern Barge-in
      (`interrupted: true`) -> KEIN zweiter Befund

### Bau

- [ ] `openingQuestion` je Sprache in `src/i18n/locales.js` (de/fr/en)
      SOLL: EIN Satz, eine echte Frage, keine Interpolation.
- [ ] Vorlage: `agent.first_message` (en) und `language_presets.de/fr` tragen
      Offenlegung + `bridgePhrase("{{objective}}")` + `openingQuestion`
      SOLL: der Offenlegungssatz bleibt WOERTLICH der Anfang (Absolute Regel 2).
      PRUEFUNG: `npm test` - T5 (c)/(e) vergleichen byte-genau gegen den aus LOCALES
      zusammengesetzten Satz UND pruefen zusaetzlich `startsWith(disclosure)`.
- [ ] Vorlage: `turn.turn_timeout` 7 -> 5
      SOLL: der Wert steht in der Vorlage und ist besessen (Eintrag existiert bereits).

## 2 — BEFUND 3: Klammer-Tags raus

- [ ] `tts.suggested_audio_tags` -> `[]`
- [ ] `turn.soft_timeout_config`: `message`, `additional_soft_timeout_messages` und
      `llm_generated_message_prompt_override` ohne Klammerausdruecke
      GRUND: sonst kommen die Tags durch die Soft-Timeout-Tuer zurueck.
- [ ] Prompt: das Verbot bleibt und wird scharf gestellt
- [ ] RIEGEL: eine Pruefung ueber das Transkript JEDES Anrufs, die anschlaegt
      SOLL: Agenten-Zeile mit `[...]` -> laute Log-Zeile mit Anzahl und Fundstellen,
      NICHT stillschweigend entfernt (Qualitaet 3).
      PRUEFUNG + ROTPROBE: Test schleust `[Curious]` ein und weist den Treffer nach;
      Gegenprobe ohne Tag -> kein Treffer.

## 3 — BEFUND 2: der Agent greift nicht von selbst zum Werkzeug

- [ ] Prompt: kurze, trennscharfe Werkzeug-Zuordnung
      SOLL: (a) unbeantwortbare Frage -> ZUERST `get_consult`, "weiss ich nicht" ohne
      vorherigen Aufruf ist ein Fehler; (b) der Auftraggeber wird NIE als alternativer
      Kontaktweg angeboten; (c) was ausdruecklich KEIN Anlass ist.
- [ ] Testdefinition B1: Gegenseite fragt etwas Unwissbares
      SOLL gruen: Werkzeug wurde gerufen, BEVOR ein "weiss ich nicht" fiel.
- [ ] Testdefinition B2: Gegenseite fragt etwas, das im Auftrag steht
      SOLL gruen: Werkzeug wurde NICHT gerufen (`verify_absence`).
- [ ] beide am Konto registriert und gruen, VOR dem Verifikationsanruf

## 4 — PUSH (Eigentuemer-Hand) + PROTOKOLL

- [ ] Sperrriegel-Rotprobe gruen -> Trockenlauf -> `--felder=` -> Ruecklese -> Drift
- [ ] vier Werte je Push in `.fortschritt.md`

## 5 — VERIFIKATIONSANRUF (ein einziger)

Gemessen wird: (1) Sekunden zwischen Ende der Eroeffnung und erster Reaktion,
(2) endet die Eroeffnung mit einer Frage, (3) Klammerausdruecke im Transkript
(Erwartung 0), (4) Werkzeug von selbst gerufen ohne Stoss, (5) Offenlegungssatz
woertlich unter "Art. 50 Nachweis" mit Anruf-ID.

## NEBENBEFUND (zeitbegrenzt, ein Durchgang)

- [ ] Cache-Write 13.062 gegen 6.531 - warum Faktor zwei, abstellbar?
      Nicht geklaert -> Zahl hinschreiben, Spaeter-Liste, weiter.

## REVIEW

(wird am Ende gefuellt)
