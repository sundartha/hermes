# T2-12 Abschlussbericht: Widget: Karten ziehen Umbenennung nach, Kalender entfaellt

Branch `phase/openai-t2-12-widget-rename-cal-drop`, Commit `a01bf05`. Umfang: N-12, N-13, O-25.

## 1. Was diese Phase NICHT erfuellt

- **S7-Beweiskraft-Test ist nur zur Haelfte tragfaehig**: `test/openai-t2-12-widget-namen.test.js`
  existiert (259 Zeilen, T12-d + Gegenprobe) — entgegen der TATSACHEN-Angabe "S7 ... NICHT
  angelegt" (dazu unten mehr, Abschnitt 6). Die Gegenprobe selbst hat aber einen Beleg-Fehler
  (bestaetigter Safety-Befund, unten Abschnitt 2 N-12): `assert.throws` bei Zeile 252 prueft nicht,
  WELCHE Assertion innerhalb von `assertSentNamesMatchToolsList` geworfen hat. Am mutierten Skript
  (sendet `get_transcript` statt `get_call_result`) wirft schon die Positiv-Kontrolle in Zeile
  213–215 ("`get_call_result` genau einmal", Zaehler 0) — die eigentliche Mitgliedschaftspruefung
  gegen `tools/list` (Zeile 216–218), die den Kern des Pre-Mortem-1-Schutzes bildet, wird von der
  Gegenprobe NIE als rot vorgefuehrt. Der Schutz selbst laeuft im Positivtest korrekt (siehe
  Abschnitt 2), aber sein Rueckfall-Beweis ist unvollstaendig.
- **`design-system/_shared/hud-card.css:1-3`** (nicht Teil des Diffs) behauptet weiterhin
  "4 Read-only-MCP-Kit-Karten (agent-status.html/calendar.html/calls.html/my-number.html)" — nach
  der Loeschung von `design-system/mcp/calendar.html` in dieser Phase stimmt das nicht mehr (nur
  noch 3 Karten). `design-system/README.md` wurde korrigiert, diese eine Datei nicht.
- **Test:gates (i18n-Launch-Testkatalog) wurde nicht vollstaendig gefahren**, nur einzelne
  beruehrte Dateien isoliert. Ob diese Phase dort etwas neu rot macht, ist ungeprueft.
- Kleinere Reste ausserhalb des vom Lead abgesteckten Scopes bewusst nicht angefasst
  (`test/mcp-ui.test.js` Kommentare "v1.html", siehe Owner-Punkte unten).

## 2. Was erfuellt ist, ID fuer ID

### N-12 — `get_transcript` liefert nie ein Transkript / `get_my_number` liefert Agenten-Nummer

Server-Umbenennung war bereits T2-11. T2-12 zieht den REST (Widget-Bezeichner, Kommentare) nach:

- `src/ui/widgets/call.html:231` — Konstante `TOOL_GET_CALL_RESULT = "get_call_result"`, an allen
  Aufrufstellen genutzt (`:678` `sendToolCall(TOOL_GET_CALL_RESULT, ...)`, `:645` Dispatch).
  Grep im Diff nach `get_transcript`/`get_my_number` in `src/`: 0 Treffer.
- `test/openai-t2-11-werkzeugtexte.test.js` T11-f prueft **statisch**, dass kein Widget einen
  Namen ausserhalb `tools/list` sendet (lief gruen, s. Abschnitt 3). T11-d (Beschreibungstext von
  `answer_consult`) und T11-n (Werbesprache) laufen jetzt zusaetzlich auf einer vierten Konfiguration
  **"HTTP OAuth, ohne Mandant"** — bestaetigt im Testlauf (`gezielt.txt` Zeilen 154/161/168/175/182,
  Test `T11-d` mit Subtest "HTTP OAuth, ohne Mandant" gruen). **Das widerspricht der TATSACHEN-Angabe
  im Auftrag, S6 sei nicht gebaut** — siehe Abschnitt 6.
- `test/openai-t2-12-widget-namen.test.js` T12-d holt das Call-Widget **vom laufenden Server**
  (nicht aus der Datei), fuehrt es in einer `node:vm`-Sandbox von `in_progress` bis `completed`,
  und prueft JEDEN gesendeten `tools/call`-Namen gegen die echte `tools/list`-Menge desselben
  Servers — lief gruen (`gezielt.txt`: "T12-d: Call-Widget vom Draht ... ✔"). Das ist der staerkste
  Beleg fuer N-12/T-11f: eine End-to-End-Probe gegen den Draht, nicht gegen den Quelltext.
  Die zugehoerige Gegenprobe hat den unter Abschnitt 1 genannten Beleg-Fehler.

**N-12 gilt als serverseitig UND widgetseitig erfuellt**, mit dem einen offenen Makel: die
Gegenprobe fuer die Draht-Pruefung ist nicht beweiskraeftig genug (bestaetigter Review-Befund).

### N-13 — `get_agent_status` Feldbeschreibung (T2-11, unveraendert) / `get_calendar` faellt mit seiner Karte

- `get_calendar` ist aus `src/mcp-tools.js` vollstaendig entfernt: Registrierung, Annotations,
  Statuszeile, `pickCalendarEntry`/`CALENDAR_ENTRY`/`CALENDAR_OUTPUT`, `allowCalendar`-Parameter
  (Diffstat: `src/mcp-tools.js` −79/+~30 Zeilen, netto Schrumpfung; `eslint-legacy-exceptions.json`
  dokumentiert das als "PIN GESENKT 2026-09-24 (T2-12, S1): get_calendar-Werkzeug entfernt ...
  registerTools schrumpft von 483 auf 459 Zeilen").
- `src/ui/widgets/calendar.html` und `design-system/mcp/calendar.html` sind geloescht
  (Diffstat: beide Dateien komplett entfernt, 46 bzw. 60 Zeilen).
- `src/ui/widget-versions.json`: der `"calendar"`-Eintrag ist verschwunden (nicht ueberschrieben,
  geloescht — dokumentiert im `_comment` als bewusste Abweichung von der "nie ueberschreiben"-Regel).
  Die drei verbleibenden Read-only-Widgets plus `call` haben alle eine neue Version
  (`agent-status`→3, `my-number`→4, `calls`→3, `call`→3), weil `WIDGET_DICT` (Kalender-Keys weg) in
  jedes Widget einserialisiert wird — Begruendung im `_comment` von `widget-versions.json`
  nachvollziehbar und mit Hash-Aenderung belegt.
- Grep nach `get_calendar` in `src/`: 0 Treffer. Die verbleibenden Treffer in `test/` sind
  ausschliesslich Negativ-Assertions, dass das Tool NICHT mehr existiert (`test/p1b-no-booking.test.js:84-87`
  `execTool(..., "get_calendar", {}) === "Unbekanntes Tool."`, `test/cq-p6-mandate.test.js:145,171`
  Verbotsliste) — konsistent mit Plan-Abnahme (e).
- `src/store/defaults.js` (Demo-Kalenderdaten) ist im Diff mit nur 2 Zeilen geaendert — die
  Demo-Daten selbst (laut Plan/UNKNOWN nur ueber REST/Self-Service ausgeliefert, nicht ueber MCP)
  bleiben bestehen; das ist plankonform (O-25 betrifft nur die "Werkzeug-Oberflaeche").
- `test/openai-t2-01-widget-resource-meta.test.js:31` und `test/openai-p8-widget-ui.test.js:42`:
  `WIDGET_COUNT = 4` (vorher 5) — beide Dateien liefen im gezielten Lauf gruen.

**N-13/O-25 gelten als erfuellt**, mit dem Makel aus Abschnitt 1 (`hud-card.css`-Kommentar
inhaltlich falsch, nicht Teil dieses Diffs).

### O-25 — Demo-Kalender auf der Werkzeug-Oberflaeche

Siehe N-13 oben — Tool und Karte sind gemeinsam gefallen, Verwaisungspruefung in beide Richtungen
(kein Tool ohne Karte, keine Karte ohne Tool) ist durch T12-d (Draht) und die WIDGET_COUNT-Tests
belegt.

## 3. Pfade und ob der Punkt auf ALLEN erfuellt ist

Gepruefte Konfigurationen laut Testcode: HTTP Legacy (mit/ohne Consult), stdio (mit/ohne Consult),
HTTP OAuth (mit/ohne Consult), HTTP OAuth ohne Mandant. Gezielter Lauf (siehe Abschnitt 4) zeigt
alle diese Subtests gruen fuer T11-d/T11-e/T11-e2/T11-f/T11-n und die neuen T12-d-Tests. Der
OAuth-ohne-Mandant-Pfad war laut Auftragstext als fehlend gemeldet — er ist im aktuellen
Commit (`a01bf05`) tatsaechlich vorhanden und gruen (siehe Abschnitt 6, Korrektur).

Fuer O-25/N-13 (Kalender-Wegfall) ist der Beleg pfadunabhaengig, weil er an der Registrierung
selbst ansetzt (kein `get_calendar` in `registerTools`) — ein fehlendes Tool erscheint gleich auf
allen Pfaden.

## 4. Eigene Testverifikation (nicht die kontaminierte Grundlinie aus den TATSACHEN)

Gezielter Lauf (`node --test --test-concurrency=4`) ueber die T2-12-relevanten Dateien:
`test/openai-t2-12-widget-namen.test.js`, `test/openai-t2-11-werkzeugtexte.test.js`,
`test/mcp-ui.test.js`, `test/openai-t2-01-widget-resource-meta.test.js`,
`test/openai-t2-02-widget-uris.test.js`, `test/openai-p8-widget-ui.test.js`,
`test/mcp-tools.test.js`, `test/check-staged-suppressions.test.js`:

```
tests 190, suites 9, pass 190, fail 0
```

(Log: `/private/tmp/claude-501/.../scratchpad/logs-t2-12/gezielt.txt`.) Kein voller `npm test`-Lauf
im Rahmen dieses Berichts (Kontextbudget) — die TATSACHEN nennen zuletzt 6435/0, das war nicht
Teil meiner eigenen Verifikation.

## 5. Was ein unabhaengiger Pruefer nachmessen sollte (neutral)

- Ist die T12-d-Gegenprobe (`test/openai-t2-12-widget-namen.test.js:237-259`) tatsaechlich ein
  Beleg dafuer, dass die Mitgliedschaftspruefung gegen `tools/list` (Zeile 216-218) rot wird — oder
  wirft `assert.throws` schon an der Positiv-Kontrolle (Zeile 213-215)? Woran siehst du das (z.B.
  `assert.throws` mit einem dritten Validator-Argument ergaenzen und pruefen, welche Message kommt)?
- Stimmt der Kommentar in `design-system/_shared/hud-card.css:1-3` noch mit der Zahl/Liste der
  Konsumenten ueberein, nachdem `design-system/mcp/calendar.html` in diesem Diff geloescht wurde?
- Laeuft `test/openai-t2-11-werkzeugtexte.test.js` (T11-d, T11-n) tatsaechlich auf vier
  Konfigurationen inkl. "HTTP OAuth, ohne Mandant", und prueft T11-n tatsaechlich `description`
  zusaetzlich zu `name`/`title` (`visibleTexts()`, Zeile ~108-111)?
- Enthaelt `tools/list` (HTTP und stdio, am laufenden Server) noch `get_calendar`? Liefert
  `resources/list` noch eine Kalender-URI?
- Stimmt `docs/OPENAI-TOOL-INVENTORY.md`/`docs/OPENAI-POLICY-ABGLEICH.md` noch mit den aktuellen
  Zeilennummern in `src/mcp-tools.js` ueberein (die Abweichungsliste nennt 29 verschobene Anker)?
- Wurde `npm run test:gates` seit dieser Phase komplett gefahren, und ist es weiterhin gruen bzw.
  nicht NEU rot geworden?

## 6. Korrektur zur uebergebenen TATSACHEN-Angabe (wichtig fuer den Lead)

Die im Auftrag mitgelieferte Liste "Nicht gebaut" nennt S6 (vierte OAuth-ohne-Mandant-Konfiguration
fuer T11-d/T11-n, description-Erweiterung von T11-n) und S7 (Datei
`test/openai-t2-12-widget-namen.test.js` samt T12-d-Gegenprobe) als **nicht gebaut**. Am
tatsaechlichen Commit `a01bf05` (Diffstat, Testlauf) sind BEIDE vorhanden und gruen — offenbar hat
der Commit `b164e3b` "Review-Nachbesserung — Draht-Gegenprobe, S6-Pfad, Kommentare" genau diese
Luecken nachtraeglich geschlossen, und die TATSACHEN im Auftrag spiegeln einen aelteren
Zwischenstand. Einzig verbliebener echter Mangel an S7 ist der Beleg-Fehler der Gegenprobe
(Abschnitt 1/2). Dieser Bericht stuetzt sich auf den tatsaechlichen Commit-Stand, nicht auf die
uebergebene "Nicht gebaut"-Liste.

## 7. Owner-Punkte und Restrisiko

- **OW-A** (bestehend, durch diese Phase nicht veraendert): nach Deploy (master muss T2-01..T2-12
  gemeinsam enthalten) eigenen Claude-Connector trennen/neu verbinden. Erwartet: Werkzeugliste ohne
  `get_transcript`/`get_my_number`/`get_calendar`, mit `get_call_result`/`get_agent_number`; 9 bzw.
  11 Werkzeuge statt vormals 10/12.
- **OW-D** (bestehend): in ChatGPT (Developer Mode) Testanruf an eigene Nummer, Karte bis
  "completed" beobachten — Ergebnis sichtbar, keine Kalender-Karte mehr waehlbar.
- **Deploy-Vorbedingung**: keine neue Env-Variable/Boot-Guard/Migration.
- **Restrisiko** in einem Absatz: Der funktionale Kern (Umbenennung im Widget nachgezogen, Kalender
  vollstaendig entfernt inkl. Tool+Karte+Versionierung) ist durch eine echte Draht-Probe
  (T12-d) belegt und lief im gezielten Testlauf gruen — das trägt das eigentliche N-12/N-13/O-25-Risiko
  (ein Widget ruft ein nicht mehr existierendes Tool). Das verbleibende Risiko ist NICHT
  funktional, sondern ein Beleg-/Dokumentationsrisiko: die Gegenprobe fuer T12-d ist selbst nicht
  wasserdicht (koennte spaeter durch eine harmlose Aenderung an der Positiv-Kontrolle unbemerkt
  ihre Schutzwirkung verlieren, ohne dass ein Test das anzeigt) und ein Design-System-Kommentar
  ausserhalb des Diffs ist jetzt falsch. Beides ist mit vertretbarem Aufwand in einer
  Nachbesserung zu schliessen und blockiert den Merge nach fachlichem Massstab nicht, sollte aber
  nicht als "fertig" verbucht werden.

---
🤖 Bericht erstellt von Claude Sonnet 5 im Rahmen der T2-12-Kette (nicht committet, ungetrackt).

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: a01bf05; Tests (volle Suite, pass/fail): 6435/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  | ID | erfuellt | Beleg | Luecke |
  |---|---|---|---|
  | N-12 | ja | tools/list auf HTTP lokal, OAuth ueber Interface-IP und stdio: 11 bzw. 9 eindeutige Namen, alle mit Verb vorn (place_call, get_agent_number ...). get_calendar/get_transcript/get_my_number fehlen, tools/call get_calendar: not found. T11-n gruen. | Keine fuer diese Phase. Legacy-Token ueber die Interface-IP antwortet mit 403 (keine Tenant-Zuordnung). Das ist bestehendes E4-Verhalten und wurde dort nicht als tools/list gemessen. |
  | N-13 | ja | get_calendar (Demo-Daten) samt Beschreibung entfallen. resources/read: Widgets rufen nur gelistete Tools (call: place/get_call_*/cancel). Draht-Scan: kein Altname, kein best/official/recommended als Werbung. T12-d, T11-f gruen. | place_call nennt 'not as Claude/Gemini' als Persona-Hinweis. Das ist aelterer Bestand und keine Herabsetzung, liegt aber nicht in diesem Diff. |
  | O-25 | ja | Demo-Tool get_calendar (Demo-Kalender, state-ops.js:1905) auf allen Pfaden weg. resources/list: 4 Widgets mit Versionssprung (call v3, my-number v4, calls v3, agent-status v3), read je ~215-250 KB. Suite 6435 pass, 0 fail. | Nur live beim Owner messbar: stabiles Rendern der Widgets in Claude und ChatGPT nach dem gemeinsamen Deploy, sichtbarer Versionssprung, kein Fehlerbild. Das wurde nicht gemessen. |
- Isoliert rot: []
- Offene Blocker:
  - safety/wichtig test/openai-t2-12-widget-namen.test.js:252: Die Gegenprobe 'wird der alte Name wieder eingesetzt, wird die Pruefung tatsaechlich rot' wird am falschen Assert rot. Das mutierte Skript sendet [get_call_status, get_transcript]. assertSentNamesMatchToolsList wirft deshalb schon an der Positiv-Kontrolle in Zeile 211-215 ('get_call_result genau einmal', gezaehlt wird 0). Die Mitgliedschaftspruefung gegen tools/list in Zeile 216-218 wird nie als rot vorgefuehrt. assert.throws in Zeile 252 prueft nicht, WELCHE Assertion geworfen hat. Die Meldung behauptet trotzdem, die Hauptpruefung sei gegen tools/list rot geworden.
  - cleancode/wichtig design-system/_shared/hud-card.css:1-3: Kommentar behauptet weiterhin 'Geteilter Olympus-HUD-Kartenrahmen fuer die 4 Read-only-MCP-Kit-Karten (agent-status.html/calendar.html/calls.html/my-number.html)' und listet calendar.html als Konsument, obwohl diese Phase genau diese Datei (design-system/mcp/calendar.html) loescht und design-system/README.md im selben Diff korrekt auf 3 Karten korrigiert wurde. Die Datei selbst ist nicht Teil des Diffs, wird aber durch die Loeschung in diesem Diff luegend.
