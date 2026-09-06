# P4a - Der Auftraggeber kann die Anrufsprache benennen; ohne Angabe gilt seine eigene

Autoritative Spec fuer Phase P4a aus `PLAN-ANRUFDEFEKTE.md` (Abschnitt 4, P4) unter der
Owner-Entscheidung **F-2/F-4b vom 06.09.** (Abschnitt 6). Umbrella-Kontext: W5 in Abschnitt 2,
PM-2 in Abschnitt 5.

**Aufteilung (Lead-Entscheidung):** Die Plan-Phase P4 wird in zwei Laeufe geteilt.
**P4a = der Mechanismus** (Parameter, Umkehrung der Ableitungskette, Ablehnung unbekannter
Sprachen, Schutz der Offenlegung). **P4b = die neue Sprache `pt`** (LOCALES-Eintrag,
Offenlegungssatz, Preset, Tests). Grund: der Mechanismus ist sicherheitskritisch und klein, die
Sprache ist voluminoes und mechanisch; zusammen waere der Blast-Radius unnoetig gross. P4a ist
ohne P4b vollstaendig sinnvoll: `pt` wird dann sauber mit 400 abgelehnt statt still ignoriert -
genau die Verbesserung, die F-2 Punkt 3 verlangt.

## Warum (in einem Satz)

Heute entscheidet allein die Zielnummer ueber die Gespraechssprache (`callLocaleFor`:
`calleeLanguage(to) || resolveCallLanguage(...)`, ein JS-Kurzschluss-ODER). Ein portugiesischer
Auftrag an eine deutsche Nummer ist damit nicht ausdrueckbar, und der Widerspruch wird still
ignoriert - gemessen am Anruf `call_mtq08ett4l3o` (`constraints` woertlich "Nur Portugiesisch
sprechen", `agent.language = "de"`).

## Die Owner-Regel, woertlich (F-2, bindend)

> "Default sollte immer die Sprache des Users sein, und Claude bzw. die KI, wenn sie den
> MCP-Server benutzen, muessen nicht gezwungen sein, das auch so zu machen - wie bei dem Use
> Case, wenn es eine andere Sprache ist. Aber ansonsten hat immer Default die Sprache vom User."

## SCOPE

| Datei | Aenderung |
|---|---|
| `src/mcp-tools.js` | optionales `language`-Feld im `place_call`-Schema. Der LANG-15-Kommentar wird ERSETZT, nicht geloescht - die neue Begruendung steht an derselben Stelle. Die Werkzeugbeschreibung sagt: ohne Angabe gilt die Sprache des Auftraggebers; eine nicht unterstuetzte Sprache wird abgelehnt. |
| `src/routes/api-calls.js` | Validierung gegen `SUPPORTED_LANGUAGES`, **bevor** irgendetwas gewaehlt, geschrieben oder abgerechnet wird. Unbekannt -> `400` mit Code `unsupported_language` und der Liste der unterstuetzten Codes. |
| `src/elevenlabs/call-locale.js` | Die Kette der GESPRAECHSSPRACHE wird: `gewuenscht || resolveCallLanguage(state, ...)`. `calleeLanguage(to)` faellt aus dieser Kette heraus - das ist die von F-2 Punkt 2 verlangte Umkehrung. |
| `src/elevenlabs/call-locale.js` | Die Kette der SPRACHE DES OFFENLEGUNGSSATZES bleibt **exakt die heutige**: `calleeLanguage(to) || resolveCallLanguage(state, ...)`. Sie wird als eigene, benannte Funktion sichtbar gemacht, damit die beiden Fragen nie wieder dieselbe Zeile teilen. |
| Aufrufer der Eroeffnungszeile / `first_message` | Der Offenlegungssatz wird in der Offenlegungs-Sprache gerendert, das uebrige Gespraech in der Gespraechssprache. |
| `test/` | neu `test/place-call-sprachwahl.test.js` |

## ENTSCHEIDUNGEN (bindend)

- **E-1: der Client bestimmt die GESPRAECHSSPRACHE, nie die Offenlegungssprache.** Gibt der
  Client `language` an, gilt sie fuer das Gespraech. Der Offenlegungssatz folgt dem
  ANGERUFENEN (F-2 Punkt 4, PM-2). Kein Client-Feld, kein Prompt-Text und kein Setting kann das
  aendern. **Das ist ein hartes Gate, keine Abwaegung.**
- **E-2: die Offenlegungs-Sprache behaelt die HEUTIGE Ableitungskette, byte-identisch.**
  `calleeLanguage(to) || resolveCallLanguage(state, ...)`. Damit ist bewiesen, dass diese Phase
  die Offenlegung in KEINEM Fall schwaecht: fuer jeden Anruf, den es heute gibt, kommt exakt
  derselbe Satz in exakt derselben Sprache heraus. Neu ist nur, dass die GESPRAECHSSPRACHE
  davon abweichen kann.
- **E-3: eine nicht unterstuetzte Sprache wird ABGELEHNT, nicht auf `en` zurueckgefallen.**
  HTTP 400, Code `unsupported_language`, die unterstuetzten Codes stehen in der Antwort, damit
  das aufrufende Modell es beim naechsten Versuch richtig machen kann. **Kein Anruf, kein
  Datensatz, keine Kosten.** Der stille Rueckfall `localeFor('pt').language === 'en'` bleibt als
  Bibliotheksverhalten bestehen, wird aber auf diesem Weg nicht mehr erreicht.
- **E-4: `pt` ist in P4a NOCH NICHT unterstuetzt** und wird folglich mit 400 abgelehnt. Der
  Ablehnungstest benutzt zusaetzlich einen dauerhaft unbekannten Code (z. B. `zz`), damit er
  nach P4b unveraendert gruen bleibt.
- **E-5: die Umkehrung der Kette ist eine bewusste Verhaltensaenderung.** Bei einer
  AUSLAENDISCHEN Zielnummer ohne Client-Angabe spricht das Gespraech ab hier die Sprache des
  Auftraggebers statt der des Ziellandes. Bestandstests, die das alte Verhalten festschreiben,
  werden bewusst und einzeln angepasst; jede solche Anpassung wird im Impl-Bericht mit dem Satz
  "F-2 Punkt 2" begruendet. Eine Anpassung, die eine OFFENLEGUNGS-Zusicherung lockert, ist
  stattdessen ein Blocker.
- **E-6: keine Sprache aus Freitext erraten.** `goal`, `briefing` und `constraints` werden
  NICHT nach einer Sprache durchsucht. Der Kanal ist das Feld, nicht die Interpretation.

## INVARIANTEN (Verletzung = Blocker)

- **I-1:** Der Offenlegungssatz bleibt fest verdrahtet, unabschaltbar und der allererste Satz.
  Kein Client-Feld beeinflusst SEINE Sprache. Der bestehende Art.-50-Riegel (Praefix-Pruefung
  der Eroeffnung) bleibt wirksam und wird auf die Offenlegungs-Sprache angewendet.
- **I-2:** Die OC-Ausnahme (Owner-Selbstanruf) bleibt exakt wie sie ist - weder weiter noch
  enger. F-3 ist zurueckgestellt.
- **I-3:** `place_call` ohne `language` und mit INLAENDISCHER Zielnummer verhaelt sich
  byte-identisch zum Bestand.
- **I-4:** Keine neue Route, keine neue Auth-Ausnahme. Die Validierung sitzt im bestehenden
  Anruf-Pfad, vor allen Safety-Gates-Nachfolgeschritten und ohne eines davon zu umgehen.
- **I-5:** Der Inbound-Weg und `resolveCallLanguage` selbst bleiben unveraendert.
- **I-6:** Kein Sprachcode wird ohne Normalisierung durchgereicht. Es gilt die Bestandsregel
  `de-DE`-Form dort, wo der Anbieter sie braucht (`outbound-dialog-fixed-live`: **`de-DE`, nie
  `de`**) - die Phase fuehrt keine neue Schreibweise ein und faellt nicht hinter die bestehende
  Normalisierung zurueck.

## Abnahme (deterministisch)

1. `place_call` mit `language: "fr"` auf eine DE-Zielnummer erzeugt einen Anruf mit
   `call.language = 'fr'` und sendet `conversation_config_override.agent.language = "fr"`.
2. Im selben Fall ist der Offenlegungssatz DEUTSCH (die Sprache des Angerufenen), nicht
   franzoesisch. **Das ist der wichtigste Testfall dieser Phase.**
3. `place_call` mit `language: "zz"` (und mit `"pt"`, solange P4b nicht gebaut ist) wird mit
   400 `unsupported_language` abgelehnt; kein Anruf, kein Datensatz, keine Kosten.
4. `place_call` ohne `language` auf eine DE-Zielnummer bei einem Tenant mit Sprache `de`
   verhaelt sich byte-identisch zum Bestand.
5. `place_call` ohne `language` auf eine FR-Zielnummer bei einem Tenant mit Sprache `de` fuehrt
   das Gespraech auf Deutsch (F-2 Punkt 2) - und spricht die Offenlegung auf Franzoesisch (E-2).
6. Der OC-Pfad (`calleeIsOwner = true`) ist unveraendert.

## Verifikation

```
node --check src/mcp-tools.js && node --check src/elevenlabs/call-locale.js && node --check src/routes/api-calls.js
node --test test/place-call-sprachwahl.test.js
node --test test/elevenlabs-anrufstart.test.js test/el-voicemail-sprache.test.js test/el-opening-line.test.js test/callee-is-owner-elevenlabs.test.js
npm test && npm run test:gates
```

`npm run test:gates` DARF rot sein (i18n-Launch-Katalog, offene Produktbefunde) - aber kein
Test darf durch diese Phase NEU rot werden. Der Impl-Bericht nennt den Vorher/Nachher-Stand
beider Baenke.

## ABGRENZUNG (ausdruecklich NICHT in dieser Phase)

- **Kein `pt`** - das ist P4b.
- **Keine Aufloesung der Abweichung `en` ohne Preset / `es` ohne Code** (F-4b-Empfehlung) -
  eigener Punkt, nicht hier.
- Keine Aenderung an der OC-Ausnahme, am Offenlegungssatz selbst oder an `calleeIsOwner` (F-3).
- Keine Aenderung an der Agenten-Vorlage, kein Push.
- Kein neues npm-Paket, kein neuer Env-Schalter.
