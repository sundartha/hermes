# T2-10 - Abgleich Usage Policies, Faktenblatt Datenschutz - Abschlussbericht

Branch `phase/openai-t2-10-policy-abgleich-doku`, Commit `bed443f`. Diff gegen `master`
ausschliesslich Doku + Doku-Test (`git diff master...HEAD --stat`):

```
docs/OPENAI-POLICY-ABGLEICH.md           | 896 +++++++++++++++++++++++++++++++
test/openai-policy-abgleich-doku.test.js | 263 +++++++++
2 files changed, 1159 insertions(+)
```

Kein Code-Diff in `src/`, `elevenlabs/` oder `test/fixtures` - der Blocker aus der Lead-Vorgabe
("Code-Diff = Blocker in dieser Phase") ist nicht ausgeloest.

## 1. Was diese Phase NICHT erfuellt

Die letzte Review-Runde hat drei Befunde offen gelassen, ich habe sie am aktuellen Dokumentstand
(oben gelesen, `docs/OPENAI-POLICY-ABGLEICH.md`) nachgeprueft - **alle drei stehen weiterhin so
im Dokument, keiner ist nachgezogen**:

- **Zeile ~504 (Empfaenger-Tabelle):** "Brevo, eigenes SMTP-Postfach | E-Mail
  (Kuendigungsbestaetigung)". Der Mailer verschickt laut Code aber auch die
  Anruf-Zusammenfassung (`src/telephony/call-finish.js:156-168`, `buildMailBody`) und die
  Nicht-platziert-Mail mit Zielnummer und Status (`src/telephony/call-finish.js:170-185`) ueber
  denselben Kanal. Das Dokument nennt nur den kleinsten der drei Faelle.
- **Zeile ~481 (Datenkategorien-Tabelle, Zeile "Zusammenfassung, Ergebnis"):** Empfaenger-Spalte
  sagt "Benachrichtigungswege" - ein Platzhalter statt der konkreten Wege (E-Mail ueber
  Brevo/SMTP, SMS ueber den Telefonie-Anbieter, `src/telephony/call-finish.js:369-377`).
- **Zeile ~481, fehlende Zeile:** die Spalte `tenant.newsletter_recipients`
  (`src/db/schema.sql:159`, Double-Opt-in-Zusatzempfaenger, die laut `src/mail-summary.js`
  ebenfalls Anruf-Zusammenfassungen erhalten) fehlt als eigene Datenkategorie und als
  Empfaenger-Zeile komplett; `grep -n "newsletter_recipients" docs/OPENAI-POLICY-ABGLEICH.md`
  liefert nichts.
- Ein vierter, als "wichtig" (nicht Blocker) eingestufter Befund ist ebenfalls unveraendert: das
  **Gespraechsaudio** (Stimme des Angerufenen/Nutzers) fehlt als eigene Datenkategorie; die
  Telnyx-Zeile der Empfaenger-Tabelle nennt nur "Telefonie, SMS", nicht die Spracherkennung
  (`transcriptionEngine` im TeXML-Gather, `src/telephony/adapters/telnyx/render.js:97-125`).
  `grep -n "Audio" docs/OPENAI-POLICY-ABGLEICH.md` liefert nichts.

Damit ist das zuletzt gemessene Urteil `safety: FAIL` am jetzigen Dateistand weiterhin zutreffend
- ich habe nichts an diesen Stellen nachgebessert (die Aufgabe war der Bericht, kein weiterer
Fix-Lauf). Der Lead entscheidet, ob ein weiterer Lauf noetig ist, bevor gemergt wird.

Ausserdem bewusst nicht gebaut, wie in den Abweichungen vermerkt: **keine englische Fassung** -
das Dokument erklaert sich selbst als nur deutsch (nicht Teil des Abnahmekriteriums fuer T2-10,
das Dokument geht laut Plan intern an den Owner, nicht an OpenAI).

## 2. Was erfuellt ist, ID fuer ID

**O-18** - "Kein belegter Abgleich Usage Policies gegen Hermes im Repo."

- `docs/OPENAI-POLICY-ABGLEICH.md` existiert (896 Zeilen), Teil A (Zeilen 72-411) zitiert je
  Klausel woertlich mit URL aus `openai.com/policies/usage-policies/` bzw. den App-Guidelines
  und ordnet einen Hermes-Mechanismus mit Code-Stelle oder eine benannte Luecke zu (14
  nummerierte Luecken, Teil C, Zeilen 591-684, Beleg: `grep -nE "^[0-9]+\. "
  docs/OPENAI-POLICY-ABGLEICH.md` liefert 601-679).
- Teil A2 (Zeilen 413-458) prueft "automation of high-stakes decisions in sensitive areas
  without human review" gegen `mandate.decide_freely`/`accept_best` bei `place_call`, mit
  Unterscheidung Budget-Weg/Sprach-Agenten-Weg und Beleg, dass `accept_best` dem
  Vorab-Briefing-Modell serverseitig entzogen ist (`src/precall-briefing.js:200/216`).
- Teil B (Zeilen 460-590) ist das verlangte Faktenblatt: Datenkategorien-Tabelle mit Quelle,
  Zweck, Aufbewahrung nach Code-Default, Empfaenger (inkl. OpenAI/ChatGPT als Quelle der
  Werkzeug-Aufrufe, Zeile "Anruf-Datensatz"); eigener Abschnitt Art.-9-Beruehrung
  (Arzttermine, Zeilen 543-550).
- Jede Werkzeugtext-Aussage ist als woertliches Zitat markiert und gegen den echten
  `tools/list`-Output geprueft, nicht behauptet: Testfall "Policy-Abgleich: jedes
  Werkzeug-Zitat steht woertlich im echten tools/list (HTTP /mcp und stdio)" - isoliert gruen
  (`node --test test/openai-policy-abgleich-doku.test.js`, Log unten). Jede
  datei:zeile-Angabe ist gegen einen Anker-Block mit echtem Datei-Grep geprueft (Testfall
  "an jeder genannten Code-Stelle steht der Anker-Text").
- Der Testfall "keine internen Kennungen, Nummern oder Secret-Muster im Dokument" haelt die
  Vorgabe (keine Phasen-/T2-/H-Nummern in Dokumenten Richtung OpenAI) durch, obwohl dieses
  konkrete Dokument selbst intern bleibt.

**Pfad-Abdeckung:** Der Auftrag nennt nur eine ID (O-18) und ein Dokument-Ziel; es gibt keine
mehreren Code-Pfade, auf denen dieselbe Aussage unterschiedlich ausfallen koennte - "erfuellt auf
allen Pfaden" reduziert sich hier auf: Budget-Weg und Sprach-Agenten-Weg sind beide im Dokument
behandelt (z. B. Teil A2 unterscheidet ausdruecklich, die Datenkategorien-Tabelle nennt beide
Anbieter-Zeilen). Die drei/vier offenen Befunde oben zeigen aber, dass die Abdeckung auf dem
Mail-Empfaenger-Pfad und dem Audio-Pfad LUECKENHAFT ist - das Dokument ist nicht auf allen
relevanten Datenfluessen vollstaendig, s. Abschnitt 1.

## 3. Testlauf (isoliert)

```
NODE_ENV=test node --test test/openai-policy-abgleich-doku.test.js
```
Log: `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/logs-t2-10/t2-10-test.log`

Ergebnis: `pass 8, fail 0, cancelled 0` (8 von 8 Testfaellen gruen, u.a. die zwei oben genannten).
Das deckt Struktur/Beleg-Disziplin des Dokuments ab (Anker stimmen, Zitate stimmen,
`tools/list` stimmt real ueberein) - es deckt NICHT die inhaltliche Vollstaendigkeit ab (die
Test-Suite kann nicht wissen, dass eine Empfaenger-Zeile fehlt, wenn niemand einen Anker dafuer
geschrieben hat). Die Grundlinie der Gesamt-Suite (6385/0 laut Facts) ist von dieser Phase nicht
beruehrt, da kein anderer Code geaendert wurde.

## 4. Was ein fremder Pruefer nachmessen sollte (neutral)

- Ist die Behauptung "Brevo/eigenes SMTP nur Kuendigungsbestaetigung" (Zeile ~504) vollstaendig -
  welche Mail-Inhalte baut `src/telephony/call-finish.js` tatsaechlich (`buildMailBody`, Zeilen
  um 156-185) und ueber welchen Mailer laufen sie?
- Ist die Spalte "Empfaenger" bei "Zusammenfassung, Ergebnis" (Zeile ~481) mit den tatsaechlichen
  Versandwegen belegt, oder steht dort ein Sammelbegriff ("Benachrichtigungswege") ohne
  Aufloesung?
- Enthaelt `tenant.newsletter_recipients` (`src/db/schema.sql:159`) Empfaenger, die
  Anruf-Zusammenfassungen erhalten (`src/mail-summary.js`, `targets[]`), und steht diese
  Personengruppe irgendwo im Dokument als Datenkategorie oder Empfaenger?
- Nennt die Empfaenger-Tabelle des Roh-Transkripts (Abschnitt "Empfaenger laut Code", Zeile zu
  Telnyx) die Spracherkennung/das Gespraechsaudio, oder nur "Telefonie, SMS"?
- Stimmen alle Werkzeugtext-Zitate im Dokument woertlich mit einem frischen `tools/list`-Abruf
  ueberein (HTTP `/mcp` und stdio), und ist jede `datei:zeile`-Angabe im Anker-Block mit echtem
  Dateiinhalt hinterlegt? (Testfaelle im Namen oben, isoliert laufen lassen.)
- Zitiert Teil A jede Policy-Klausel woertlich mit URL aus einer OpenAI-Primaerquelle, oder
  steht irgendwo eine Paraphrase als Zitat markiert?
- Ist die Zahl der in Teil C benannten Luecken (14) korrekt gezaehlt, und traegt jede ein `Ziel`?
- Enthaelt das Dokument irgendeine interne Kennung (Phasen-, T2-, H-Nummer, Branch-Name)?

## 5. Owner-Punkte und Restrisiko

Restrisiko in einem Satz: das Faktenblatt ist strukturell vollstaendig und jede einzelne
Aussage darin ist gegen Code oder eine OpenAI-Primaerquelle belegbar, aber es ist nachweislich
NICHT vollstaendig ueber alle Datenfluesse - wer die Datenschutzerklaerung heute allein auf
Teil B stuetzt, wuerde die E-Mail-Zusammenfassung an Brevo/Zusatzempfaenger und das
Gespraechsaudio an Telnyx/ElevenLabs nicht offenlegen; das ist ein DSGVO-Informationsmangel
"in spe", keiner, der schon in einem Rechtstext steht (es existiert laut Facts noch kein
Rechtstext, der sich darauf stuetzt).

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: FAIL (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: ed4dae0; Tests (volle Suite, pass/fail): 6385/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  - O-18 | nein | Diff: nur docs/OPENAI-POLICY-ABGLEICH.md + Test, 0 src-Dateien. Doku :57/:92-102 Status 'Luecke': Hermes haelt Usage Policies NICHT vollstaendig ein. grep telemarket|political|campaign in mcp-server-info/mcp-tools = 0. Doku-Test 8/8 gruen. | 'Do not engage in or facilitate' ist nicht eingehalten: keine Zweckbindung gegen Werbe-/Wahlkampfanrufe in place_call/Server-Instructions (Teil C Luecke 1, planned), weitere Luecken 2-5 offen. Die Phase dokumentiert nur, sie behebt nichts.
- Isoliert rot: []
- Offene Blocker:
  - O-18: 'Do not engage in or facilitate' ist nicht eingehalten: keine Zweckbindung gegen Werbe-/Wahlkampfanrufe in place_call/Server-Instructions (Teil C Luecke 1, planned), weitere Luecken 2-5 offen. Die Phase dokumentiert nur, sie behebt nichts.
