# P4b - Portugiesisch wird eine unterstuetzte Sprache

Autoritative Spec fuer Phase P4b (zweiter Teil von P4 aus `PLAN-ANRUFDEFEKTE.md`) unter der
Owner-Entscheidung **F-2 Punkt 3 vom 06.09.**: *"Eine nicht unterstuetzte Sprache wird
ABGELEHNT, nicht still auf `en` zurueckgefallen. `pt` ist damit zu bauen (LOCALES-Eintrag inkl.
Offenlegungssatz, Preset am Agenten, Stimme, Tests), sonst laeuft der ausloesende Use Case
weiter ins Leere."*

**Vorbedingung: P4a ist gemergt.** Ohne den Mechanismus aus P4a waere `pt` nicht erreichbar.

## Warum (in einem Satz)

Das Produkt kennt heute genau drei Sprachen (`de`, `fr`, `en` in `LOCALES`; `de`, `fr`, `es` als
Presets am Agenten). Der ausloesende Auftrag ("Nur Portugiesisch sprechen") ist damit auch mit
dem neuen Parameter aus P4a nicht erfuellbar - er wird nur noch sauber abgelehnt.

## SCOPE

| Datei | Aenderung |
|---|---|
| `src/i18n/locales.js` | vollstaendiger `pt`-Eintrag mit ALLEN Schluesseln, die `de`/`fr`/`en` fuehren - inklusive `disclosure`. Kein Schluessel fehlt, keiner wird auf Englisch gelassen. |
| `src/i18n/locales.js` | `SUPPORTED_LANGUAGES` um `pt` erweitert |
| `src/i18n/prompts/` | der Prompt-Baustein-Weg fuer `pt`, analog zum Bestand |
| `elevenlabs/agent_configs/outbound-agent.template.json` | `pt`-Preset in den `language_presets` **und** im Offenlegungs-Preset-Feld. **Feldname-Falle: das Feld heisst `language_presets_offenlegung`** (Lehre `elevenlabs-push-kann-presets-nicht-schreiben`) - der Impl-Agent liest den Bestand und benutzt die dort tatsaechlich vorhandenen Feldnamen, statt sie zu raten. |
| `test/` | neu `test/pt-locale.test.js`; die vorhandenen i18n-Vollstaendigkeitstests muessen `pt` mit abdecken, ohne dass eine Ausnahmeliste eingefuehrt wird |

## ENTSCHEIDUNGEN (bindend)

- **E-1: gesprochene portugiesische Strings tragen ihre echte Diakritik** (`ç`, `ã`, `õ`, `á`,
  `é`, `ê`, `í`, `ó`, `ú`). Die Umlaut-Regel des Repos ist gedreht (Lehre
  `umlaut-transliteration-root-cause`): **ASCII gilt fuer Code und Kommentare, NICHT fuer
  gesprochene Strings.** Ein Offenlegungssatz ohne Diakritik ist ein Aussprachefehler.
- **E-2: Variante `pt-PT` (europaeisches Portugiesisch)** als Grundlage der Formulierungen, weil
  der ausloesende Anwendungsfall europaeisch ist. Der Sprachcode selbst bleibt `pt`. Der
  Anbieter-Code wird in der im Bestand ueblichen Schreibweise gesetzt (`de-DE`-Muster,
  Lehre `outbound-dialog-fixed-live`), nicht in einer neu erfundenen.
- **E-3: keine Stimme wird geraten.** Trifft der Bestand fuer die anderen Sprachen KEINE
  eigene Stimmwahl, trifft `pt` auch keine. Trifft er eine, wird die Stimmwahl fuer `pt` NICHT
  erfunden, sondern als offener Owner-Punkt im Impl-Bericht benannt (eine Stimm-ID ist nur per
  Synthese pruefbar, Lehre `el-stimme-pruefen-nur-per-synthese`, und diese Kette darf den
  Anbieter nicht beschreiben).
- **E-4: der portugiesische Offenlegungssatz ist owner-pflichtig.** Er wird gebaut, in einem
  Test woertlich festgenagelt und im Uebergabetext ausdruecklich zur Freigabe vorgelegt. Er
  traegt dieselbe Aussage wie die drei bestehenden Saetze: KI-Kennzeichnung, im Auftrag von,
  Zusammenfassung fuer den Auftraggeber.
- **E-5: keine weitere Sprache in dieser Phase.** Die bestehende Abweichung (`en` ohne Preset,
  `es` mit Preset ohne Code) wird NICHT nebenbei aufgeloest - sie wird im Bericht benannt.

## INVARIANTEN (Verletzung = Blocker)

- **I-1:** Alle Zusicherungen von P4a bleiben: die Offenlegungs-Sprache folgt dem Angerufenen,
  `pt` als Gespraechssprache aendert daran nichts.
- **I-2:** Kein bestehender Locale-Eintrag wird veraendert. `pt` ist rein additiv.
- **I-3:** Der Weltdefault bleibt `en` (`i18n-launch-test-catalog`). `pt` wird fuer niemanden
  automatisch aktiv - nur auf ausdrueckliche Anforderung ueber `place_call`.
- **I-4:** Keine Ausnahmeliste in den i18n-Vollstaendigkeitstests. Fehlt ein `pt`-Schluessel,
  ist der Test rot - das ist der Zweck.

## Abnahme (deterministisch)

1. `place_call` mit `language: "pt"` erzeugt einen Anruf mit `call.language = 'pt'` und sendet
   die dem Bestand entsprechende Anbieter-Sprachkennung.
2. Bei DE-Zielnummer und `language: "pt"` ist der Offenlegungssatz DEUTSCH (I-1).
3. Bei PT-Zielnummer ohne `language` bei einem Tenant mit Sprache `de`: Gespraech auf Deutsch
   (F-2 Punkt 2), Offenlegung auf Portugiesisch (P4a E-2).
4. `place_call` mit `language: "zz"` wird weiterhin mit 400 `unsupported_language` abgelehnt.
5. Die i18n-Vollstaendigkeitstests decken `pt` ohne Ausnahmeliste ab und sind gruen.
6. Der portugiesische Offenlegungssatz ist in einem Test woertlich festgenagelt.

## Verifikation

```
node --check src/i18n/locales.js
node --test test/pt-locale.test.js test/place-call-sprachwahl.test.js
npm test && npm run test:gates
```

## ABGRENZUNG (ausdruecklich NICHT in dieser Phase)

- **Kein Push zum Anbieter** - gesperrt; das `pt`-Preset wird erst durch den Owner-Push live.
- Keine Aufloesung der Abweichung `en`/`es`.
- Keine Aenderung am Mechanismus aus P4a.
- Keine Stimm-ID ohne Beleg.
