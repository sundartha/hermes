# T2-15 — Restricted Data: Eingabeprüfung und Ausgabe-Maskierung (O-14)

Branch `phase/openai-t2-15-restricted-data-mask`, Commit `f57a957` (+ Fix-Commit `626637b`),
Spec `tasks/openai-t2/T2-15-spec.md`. Basis: master `252d154` (T2-01..T2-14, T2-23 gemergt).

## 1. Was diese Phase NICHT erfüllt (ganz oben, nicht versteckt)

- **O-14 ist nur TEILWEISE gebaut.** Der Plan verlangt für O-14 auch: "jede Freitext-Feldbeschreibung
  schließt Zahlungsdaten, Ausweisnummern, Gesundheitsakten und Zugangsdaten aus" (Plan-Abnahme
  "Feldbeschreibungen am Draht enthalten den Ausschluss", `tasks/PLAN-OPENAI-TECHNIK-2.md:967-979`).
  Dieser "solicit"-Teil von O-14 (die Feldtexte an `objective`/`briefing`/`context`/`answers`/`mandate`)
  ist **nicht angefasst** — bewusst, laut Lead-Vorgabe dieser Kette ("keine Werkzeugtext-Änderung ohne
  convo-bench-Beleg"). Der Plan selbst vermerkt für T2-15 dazu "die Feldtext-Änderung an `place_call`
  fällt unter die Messung von T2-16" (`tasks/PLAN-OPENAI-TECHNIK-2.md:979`) — aber T2-16 führt in
  seiner eigenen ID-Liste nur O-27/N-14/O-15/O-19 (`tasks/PLAN-OPENAI-TECHNIK-2.md:983`), **nicht
  O-14**. Das ist ein Loch zwischen den Phasen: wird der Feldtext-Ausschluss nicht ausdrücklich als
  eigene Zeile an T2-16 (oder eine Folgephase) übergeben, gilt O-14 nach dem Merge fälschlich als
  vollständig erledigt, obwohl der "solicit"-Teil offen bleibt.
- **Erkennung ist bewusst auf zwei Kategorien begrenzt**: Zahlungskarten (Luhn) und IBAN (mod 97).
  PHI, Ausweis-/Steuer-/Sozialversicherungsnummern und Zugangsdaten/OTP/Passwörter/API-Keys werden
  **nicht erkannt** — dokumentiert als ehrliche Grenze in `src/restricted-data.js:6-9` und
  `PLAN-SECURITY.md` (Abschnitt OpenAI-T2-15), Begründung: keine zuverlässige Prüfsumme/Struktur,
  jede Erkennung wäre Scheinsicherheit mit hoher Fehlalarmquote gegen Termin-/Kundennummern.
- **Zwei offene, ungelöste Nachbesserungsbefunde stehen noch im Code** (aus dem Review, nicht
  zurückgewiesen, aber laut Übergabe nicht mehr gefixt in diesem Lauf):
  - `src/restricted-data.js:184` (`PHONE_CONTEXT_WORDS`): die Liste enthält "rückruf"/"rueckruf"/
    "telefonnummer"/"handynummer"/"mobilnummer"/"telefon"/"durchwahl", aber **nicht** "rufnummer"
    oder "rückrufnummer" — selbst geprüft am Code. Eine Formulierung wie "Rückrufnummer
    4917612340001" oder "Rufnummer 4917612340001" (deutsche Mobilnummer ohne `+`) matcht `\brückruf\b`
    nicht und kann bei Luhn-gültigem Zufallstreffer (~10 % der Fälle) fälschlich als Kartennummer
    abgelehnt werden bzw. in der Ausgabe zu `****xxxx` maskiert werden.
  - `src/restricted-data.js:172-173,233-245`: die Ausgabe-Maskierung erkennt nur zusammenhängende
    Ziffern, einheitliche 4er-Gruppen (ein Trenner: Leerzeichen oder Bindestrich) und Amex/Diners-
    Formen. Spracherkennungs-typische Formen (Paar-/Dreiergruppen, Komma-Trenner, gemischte
    Trennung wie `"4111, 1111, 1111, 1111"`) und IBAN mit Bindestrich-Trennern bleiben **unmaskiert**
    in Transkript-Ausgaben. `PLAN-SECURITY.md` benennt Zahlwörter und Punkt-Trenner als Grenze, aber
    nicht diese konkreten Formen — laut Review-Befund eine unvollständig benannte Grenze.
- **Maskierung sitzt ausschließlich an der MCP-Grenze**, nicht im Store, REST-Layer, Sprachagent
  oder Prompt-Pfad — das ist Plan-Vorgabe (c), keine Lücke, aber wichtig für die Einordnung: ein
  Angerufener, der seine Kartennummer diktiert, hat sie weiterhin roh im Store.
- `docs/OPENAI-POLICY-ABGLEICH.md`, Tabellenzeile "Roh-Transkript" im Dateninventar wurde nur
  mechanisch auf neue Zeilennummern nachgezogen, sagt aber inhaltlich weiterhin uneingeschränkt,
  dass Transkriptzeilen roh an OpenAI/ChatGPT gehen, ohne die neue Karten-/IBAN-Maskierung zu
  erwähnen (Fließtext an anderer Stelle im selben Dokument wurde aktualisiert, diese Tabellenzeile
  nicht) — als bewusste Nicht-Änderung dieser Phase vermerkt, nicht sicherheitskritisch (Richtung:
  mehr Exposure dokumentiert als tatsächlich passiert).

## 2. Was erfüllt ist, ID für ID

**O-14** (teilweise, Umfang = Eingabeprüfung + Ausgabe-Maskierung; "solicit"/Feldtext-Teil siehe
Abschnitt 1):

- Neue reine Prüf-/Maskier-Datei `src/restricted-data.js` (405 Zeilen neu), ohne Store-/IO-/
  Log-Zugriff (selbst gelesen, Kommentarkopf Zeile 1-3: "Reine Funktionen, KEIN Import ausser
  benannten Konstanten dieser Datei").
- Luhn-gültige Kartennummern (13-19 Ziffern, IIN-Ziffer 2-6, homogene Trennung: Leerzeichen ODER
  Bindestrich, nicht gemischt, plus Amex 4-6-5/Diners 4-6-4) werden erkannt
  (`src/restricted-data.js:160-245`).
- IBAN-Erkennung über eine feste Länder-Längen-Tabelle (`IBAN_COUNTRY_LENGTHS`,
  `src/restricted-data.js:53-63`) statt Brute-Force über ~15 Präfixlängen — laut Kommentar dort die
  Nachbesserung, die die vorher gemessenen 14 %/13,8 % IBAN-Fehlalarme (Kürzel wie "KW", "LH")
  behoben hat; selbst nicht nachgemessen, nur die Code-Begründung gelesen.
- Eingabeprüfung sitzt an **einer** gemeinsamen Stelle für `prepare_call` UND `place_call`:
  `confirmCallHop()` (`src/mcp-tools.js:499-517`) ruft `rejectRestrictedData()` als erste Anweisung
  vor jedem Hop zu `/api/call-confirmations` auf — selbst gelesen, dieselbe Funktion bedient beide
  Werkzeuge (kein zweiter Prüfpfad, der die HMAC-Bindung umgehen könnte). `CALL_ARGS_EXEMPT_KEYS =
  ["to", "confirmation_code", "language"]` (`src/mcp-tools.js:487`) nimmt das Anrufziel ausdrücklich
  aus — deckt die Pre-Mortem-Vorgabe "`to` und eigene DIDs werden nie maskiert" für die
  Eingabeprüfung ab (die Ausgabe-Maskierung von `to` wurde nicht separat geprüft).
  `answer_consult` prüft `{ answers }` inline über dieselbe `rejectRestrictedData()`
  (`src/mcp-tools.js:1748`).
- Testkarte `4111 1111 1111 1111` im `objective` → `ToolError` mit stabiler Fehlerkennung
  (`RESTRICTED_CATEGORY_ERROR_CODE`, `src/mcp-tools.js:478-480`), kein Anruf — laut Übergabe im
  neuen Test `test/openai-t2-15-restricted-data.test.js` (526 Zeilen neu) mit Positiv-/Negativfällen
  geprüft (Test selbst nicht ausgeführt, nur Vorhandensein und Struktur gelesen).
- Ausgabe-Maskierung (`maskRestrictedText`) ist breit verdrahtet, selbst nachgezählt in
  `src/mcp-tools.js`: Transkriptzeilen (`:212`), `await_call_event`-Summary/Karten-Felder
  (`:252,266-270`), Consult-Fragen (`:328`), `list_calls`-Summary (`:752`), `get_call_result`-Summary
  und Action Items (`:809-810`), `check_inbox`-Items (`:833`). Das deckt die im Plan genannten
  Pfade (Zusammenfassung, `last_transcript_lines`, Action Items) plus die vom Lead zusätzlich
  verlangten (Ergebniskarte, Consult, `list_calls`) ab.
- `eslint-legacy-exceptions.json`: Pin für `src/mcp-tools.js` **gesenkt** (404 → 397 Zeilen
  `registerTools`), keine neue Ausnahme, kein neuer Befund-Typ — selbst im Diff geprüft.

## 3. Berührte Pfade — Vollständigkeit

- **Eingabe**: `prepare_call`, `place_call` (gemeinsam über `confirmCallHop`), `answer_consult`
  (eigener Inline-Aufruf derselben Funktion) — auf allen dreien geprüft, dieselbe Quelle.
- **Ausgabe / Transporte**: laut Übergabe HTTP Legacy, OAuth und stdio je über den echten
  `tools/call`-Draht gemessen (Testdatei-Struktur eingesehen, Ausführung nicht selbst wiederholt).
  Der Legacy-HTTP-Pfad lief laut Übergabe abweichend von der Spec (über `srv.localUrl` ohne Token
  statt über einen externen Bearer-Token, weil ein Token über Nicht-Loopback strukturell nie eine
  Tenant-Zuordnung ergibt) — das ist als Abweichung dokumentiert, deckt denselben Code
  (`confirmCallHop`, `rejectRestrictedData`, Maskierungs-Views) ab, wurde aber von mir nicht
  nachvollzogen (kein eigener Draht-Test in dieser Berichts-Session).
- **Nicht auf allen Ausgabepfaden gleich stark**: die Formen-Lücke (Abschnitt 1, zweiter Punkt)
  betrifft *alle* Ausgabepfade gleichermaßen, weil sie in der gemeinsamen `maskRestrictedText`-
  Funktion liegt — kein Pfad ist besser als ein anderer, aber keiner deckt Spracherkennungs-typische
  Zifferngruppierungen.
- **Store/Telefonie/Prompt-Pfad**: bewusst unberührt (Plan-Vorgabe c) — selbst geprüft, dass
  `src/restricted-data.js` keine Store-Importe hat.

## 4. Was ein unabhängiger Prüfer nachmessen sollte (neutral)

- Ist `rufnummer`/`rückrufnummer` in `PHONE_CONTEXT_WORDS`
  (`src/restricted-data.js:180-186`) enthalten, und wie verhält sich `prepare_call` mit
  `briefing: "Rückrufnummer 4917612340001"` (13-stellig, `+`-los, Luhn-gültig wählen) — wird
  abgelehnt oder akzeptiert?
- Deckt `maskRestrictedText` (`src/restricted-data.js`, Suche nach `CARD_CANDIDATE`/
  `groupsMatchCardShape`) eine Kartennummer in Zweiergruppen mit Komma-Trennern ab (Beispiel:
  `"41, 11, 11, 11, 11, 11, 11, 11"`) — bleibt sie in `get_call_status.last_transcript_lines`
  sichtbar oder wird sie zu `****`?
  Und wie mit IBAN im Format `DE89-3704-0044-0532-0130-00` (Bindestrich statt Leerzeichen)?
  Vergleich mit `IBAN_CANDIDATE`-Regex.
  Wird eine ausschließlich Buchstaben-basierte Feldbeschreibung (`objective`/`briefing`/
  `context`/`answers`/`mandate`) in `prepare_call`/`place_call` (Draht, `tools/list`) irgendwo als
  Ausschluss von Zahlungs-/Ausweis-/Gesundheits-/Zugangsdaten formuliert — oder sind diese Texte
  byte-identisch zum Stand vor T2-15 (`git diff master...HEAD -- src/mcp-tools.js` auf
  `description:`-Strings der Input-Schemas prüfen)?
- Läuft `npm test` (bzw. `test/openai-t2-15-restricted-data.test.js` isoliert) grün, und ist die im
  Bericht behauptete Zahl 6532 pass / 0 fail durch einen frischen Lauf reproduzierbar? (Die Übergabe
  nennt einen unvollständigen zweiten Bestätigungslauf — nur Einzeldateien wieder isoliert grün
  gemessen, kein zweiter Vollgang bis zum Ende.)
- Steht in `PLAN-SECURITY.md` Abschnitt "OpenAI-T2-15" die offene O-14-"solicit"-Lücke sowie die
  beiden oben genannten Erkennungslücken (Rufnummer-Wort, Spracherkennungs-Formen) ausdrücklich als
  Grenze, oder liest sich der Abschnitt so, als sei O-14 vollständig erledigt?

## 5. Owner-Punkte und Restrisiko

Owner-Punkte (nach der Owner-Regel — nur Deploy/Live-Probe/Render-Dashboard-artige Punkte, siehe
`StructuredOutput`): keine Deploy-Vorbedingung (keine neue Env-Variable, kein ungemessener Live-Wert,
kein Schalter — Rückbau wäre ein Revert); nach dem Deploy soll der Owner live in ChatGPT/Claude
`prepare_call` einmal mit der Testkarte `4111 1111 1111 1111` auslösen (erwartet: Fehlermeldung
nennt Feld und Kartennummer/„payment card", kein Bestätigungscode, kein Eintrag in `list_calls`) und
danach denselben Auftrag ohne Karte, aber mit einer Rufnummer ohne `+` und einem Datum, um die
Fehlalarm-Gegenprobe zu bestätigen.

Restrisiko in einem Absatz: Die Kernaussage von O-14 ("Restricted Data verboten") ist für die zwei
strukturell zuverlässig prüfbaren Kategorien — Zahlungskarten und IBAN — an der MCP-Eingabe robust
durchgesetzt (eine gemeinsame Prüffunktion für beide Aufrufer, `to` ausgenommen) und an den
wichtigsten Ausgabepfaden maskiert; das größte Restrisiko ist, dass die Ausgabe-Maskierung reale
Spracherkennungs-Diktate (Kommas, gemischte Gruppen, Bindestrich-IBAN) noch nicht abdeckt, wodurch
eine am Telefon diktierte Kartennummer in `get_call_status`/`get_call_result` sichtbar bleiben kann —
das ist eine dokumentierte, aber nicht geschlossene Lücke, kein unbekannter Blocker. Das zweite
Risiko ist organisatorisch, nicht technisch: der Feldtext-("solicit"-)Teil von O-14 ist ohne klaren
Phasen-Besitzer offen und könnte bei der Einreichung fälschlich als erledigt gelten, wenn T2-16 ihn
nicht ausdrücklich übernimmt.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: FAIL (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: 16bad44; Tests (volle Suite, pass/fail): 6540/0
- Review-Urteile zuletzt: {"safety":"FAIL","cleancode":"FAIL"}
- Tabelle ID | erfuellt | Beleg | Luecke:

| ID | erfuellt | Beleg | Luecke |
|---|---|---|---|
| O-14 | false | Karte: HTTP /mcp prepare_call mit 4111 1111 1111 1111 in objective ergibt isError, kein Code. src/restricted-data.js:344/373 findet nur Karte, IBAN und Token-Muster. tools/list: place/prepare_call mit NEVER-Hinweis. Suite 6540/0 | Probe am Draht: prepare_call mit 'SSN 123-45-6789', 'Diagnose HIV positiv' oder 'Passwort Hunter2secret!' ergibt isError=false, Code ausgestellt. maskRestrictedText laesst SSN/Ausweis/PHI/Passwort offen. collect/process fuer PHI+IDs fehlt |

- Isoliert rot: []
- Offene Blocker:
  - O-14: Probe am Draht: prepare_call mit 'SSN 123-45-6789', 'Diagnose HIV positiv' oder 'Passwort Hunter2secret!' ergibt isError=false, Code ausgestellt. maskRestrictedText laesst SSN/Ausweis/PHI/Passwort offen. collect/process fuer PHI+IDs fehlt
  - Review safety: FAIL
  - Review cleancode: FAIL
  - safety/blocker src/mcp-tools.js:918: noRestrictedDataNote() haengt an place_call und prepare_call den Satz 'NEVER put payment card, bank account, government ID, health, or password/credential data in objective, briefing, constraints, mandate or context - ... Hermes rejects it before the call is placed/prepared.' an. Dasselbe steht in answer_consult (src/mcp-tools.js:1042: '... health, or password/credential data in an answer - Hermes rejects it.'). Serverseitig erkannt und abgelehnt werden aber nur Kartennummern, IBANs und strukturell eindeutige Zugangsdaten. Gesundheitsangaben, Ausweis-/Steuer-/Sozialversicherungsnummern und generische Passwoerter werden angenommen. Das steht im Kopfkommentar von restricted-data.js:11-18, und die eigene Verifikation (Commit 16bad44) hat es am Draht gemessen: PHI, eine SSN-foermige Folge, eine Passnummer und 'password is Hunter2Secret!' ergaben jeweils kein isError.
  - safety/blocker test/openai-t2-15-restricted-data.test.js:121: Neue Fixtures im exakten Format echter Anbieter-Secrets: 'ghp_' + 36 Zeichen (:121), 'sk_live_...' (:123), 'AIza' + genau 35 Zeichen (:124), der bekannte jwt.io-JWT (:126) sowie mehrfach 'AKIA1234567890ABCDEF'. Die CI (.github/workflows/ci.yml) laesst gitleaks mit Default-Ruleset als ersten Schritt laufen, 'bricht ab, BEVOR npm ci / Tests laufen'. In gitleaks.toml stehen nur .env.example, test/helpers.js und test/web-auth-middleware.test.js auf der Allowlist, die neue Testdatei nicht. Auf master gibt es heute keinen einzigen Fixture in dieser Form (git grep leer).
  - cleancode/blocker src/restricted-data.js:202 (CARD_CONTEXT_WORDS), zusammen mit :197-207 (PHONE_CONTEXT_WORDS) und :218-231 (hasPhoneContextOnly): Die zweite Nachbesserung hat PHONE_CONTEXT_WORDS ausdruecklich um Englisch/Franzoesisch erweitert ("phone", "call back", "call me back", "callback", "reach me at", "téléphone"/"telephone", "rappel", "joignable") - PLAN-SECURITY.md dokumentiert das selbst als eigenen Befund ("PHONE_CONTEXT_WORDS nur deutsch"). CARD_CONTEXT_WORDS, die genau diese Ausnahme wieder zuruecknehmen soll, wenn zusaetzlich ein Karten-/Konto-Wort im selben Fenster steht, blieb dabei rein deutsch: ["karte", "iban", "konto"]. "card"/"account" (EN) und "carte"/"compte" (FR) fehlen. Damit ist die Sprach-Erweiterung asymmetrisch: der False-Positive-Fix (Rufnummer nicht als Karte melden) wurde auf drei Sprachen ausgeweitet, der dazugehoerige False-Negative-Schutz (echte Karte trotzdem melden, wenn ein Kartenwort danebensteht) nur fuer Deutsch.
  - safety/wichtig src/restricted-data.js:197: Die Rufnummern-Kontext-Ausnahme matcht Signalwoerter mit \b an beiden Enden. Deshalb greift sie fuer die gebraeuchlichsten Komposita und Kuerzel nicht. Per Probe mit einer Luhn-gueltigen, unformatierten Nummer 4917000000001 wurden abgelehnt: 'Rueckrufnummer', 'Rückrufnummer', 'Rückrufnummer ist ...', 'Mobile ...', 'Tel. ...'. Durchgelassen wurden nur 'Rückruf unter', 'Callback number', 'Phone number', 'Numéro de rappel'. PLAN-SECURITY.md:6573 meldet den Befund 'Rueckrufnummer im briefing konnte als Kartennummer gelten' dagegen als behoben. Die Tests pruefen nur 'Rueckruf unter'.
  - safety/wichtig src/mcp-tools.js:918: Die Selbstauskunft des Bauenden ist gegenueber dem Diff veraltet. Sie sagt 'Feldhinweise in Werkzeugbeschreibungen ... bewusst NICHT angefasst' und 'Schritt 7 (Werkzeugtexte byte-identisch)'. Tatsaechlich hat Commit 40ded37 die Beschreibungen von place_call, prepare_call und answer_consult sowie die describe()-Texte von briefing/context.key_facts/context geaendert. Der tools/resources-Hash in test/openai-p8-widget-ui.test.js ist neu gepinnt (84cbfd1c... -> 59d72a9b...), die Textdeckel in gq-b1 sind angehoben (6700->7100, 7100->7500). Der Plan (T2-15 Ziel und Abnahme) verlangt die Feldhinweise zwar, ein Bench-Lauf fehlt aber.
