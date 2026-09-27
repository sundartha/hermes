# T2-14-Bericht — Widget: Bestaetigungs-Ansicht im Call-Widget (N-10)

Branch `phase/openai-t2-14-call-widget-confirm-ui`, Commit `31065d6`, Worktree
`.../scratchpad/wt-t2-14`. Spec: `tasks/openai-t2/T2-14-spec.md`.

## 1. Was diese Phase NICHT erfuellt

- **Kein Blocker-Fix eingearbeitet:** der Clean-Code-Blocker (G5-Duplizierung: der Uebergang in
  `confirmState = "uncertain"` steht byte-identisch an zwei Stellen, `call.html:686-691`
  `handlePlaceCallResponse()` und `:720-727` `onConfirmResponseTimeout()`) ist im aktuellen
  Commit `31065d6` noch vorhanden — selbst verifiziert per Read der Arbeitskopie, siehe Abschnitt 2.
  Der Kommentar in `widget-versions.json` behauptet an einer Stelle ("G5-Dedup ueber
  Object.assign statt einer zweiten Filterkopie") einen Fix, der im HTML selbst nicht umgesetzt
  ist — Kommentar und Code widersprechen sich, das ist selbst ein Befund.
- **Sicherheits-Befund (wichtig) nicht behoben:** kein Server-Text unterscheidet "Code verbraucht
  (Anruf lief vermutlich schon)" von "Code fehlt/nie bestaetigt". `confirmationRequired`
  (`src/i18n/mcp-texts.js:134`) ist unveraendert generisch fuer beide Faelle. Reload-/Remount-Risiko
  (alte Karte + gueltiger, aber verbrauchter Code -> irrefuehrende Meldung) bleibt bestehen.
- **Schritt 5 (Doku):** `docs/OPENAI-TOOL-INVENTORY.md` und `PLAN-SECURITY.md` wurden laut
  Uebergabe nur teilweise/nicht vollstaendig nachgezogen (Budget) — im Diff sind beide Dateien
  zwar veraendert (88/28 Zeilen), Vollstaendigkeit gegen den neuen Ablauf ist von mir nicht
  geprueft, das faellt in den Scope der Doku-Pruefung eines Verifizierers.
- **Kein echter End-to-End-Rundlauf ausserhalb der Test-Suite gemessen:** Draht-Tests (e-http,
  e-oauth, e-stdio, e-full-fields) existieren und sind Teil der 5 Testdateien, sie ersetzen aber
  keine Owner-Live-Probe in Claude/ChatGPT (siehe Owner-Punkte).
- **Kein neuer Sandbox-Scan ueber alle Widget-Resources** (nur `X-6 (Draht)`-Test fuer das
  Call-Widget selbst, kein Scan der anderen drei Widgets) — laut Uebergabe bewusst nicht gebaut
  (Budget), von mir nicht nachgeholt.
- **Baseline-Testlauf fehlt:** kein `npm test` im unberuehrten Zustand (c726212) VOR der
  Implementierung gefahren. Es gibt nur den Lauf NACH allen drei Commits (6479 pass / 0 fail
  laut Uebergabe). Eine Regression gegenueber dem gemergten Bestand ist damit plausibel, aber
  nicht mit einer Vorher/Nachher-Messung belegt. Ich habe den Testlauf in dieser Berichtsphase
  nicht erneut gefahren (Kontext-/Zeitbudget) — ein Verifizierer sollte das selbst tun.
- **Plan-Abweichung, bewusst:** der Plan (`PLAN-OPENAI-TECHNIK-2.md:926-958`) sieht vor, dass das
  Widget `place_call` NIE selbst aufruft und der Code stattdessen dem Modell/Chat angezeigt wird
  ("Code im Chat eingeben"-Rueckfall). Gebaut wurde das Gegenteil: die Karte sendet `place_call`
  selbst per Host-Bruecke, der Code erreicht das Modell nie. Das folgt der expliziten
  Lead-Vorgabe im Kickoff, widerspricht aber dem schriftlichen Plan-Text — falls der Plan die
  massgebliche Quelle sein soll, ist dieser Punkt zu klaeren, nicht stillschweigend übergangen.

## 2. Was erfuellt ist (ID-fuer-ID)

### N-10 — serverseitige Bestaetigung sichtbar/wirksam gemacht

Server-Teil war bereits aus T2-13 gemergt (nicht Gegenstand dieser Phase). Diese Phase liefert den
sichtbaren Nutzer-Schritt:

- **Karte zeigt Vorschau-Felder:** `renderConfirmation()` in `call.html:591-610` setzt
  `data-confirm-to`, `data-confirm-objective` sowie sieben optionale Felder
  (`data-cf-briefing/language/max_duration_s/constraints/mandate/context/diagnostic`) aus
  `structuredContent` — alle neun Felder, die der Code laut T2-13 bindet, sind sichtbar (nicht nur
  die "kostenrelevanten" laut Plan-Wortlaut, sondern alle gebundenen — bewusste Abweichung s.
  Uebergabe). Beweis: Test `(d) Anzeige = Gesendetes` (`test/openai-t2-14-call-widget-confirm.test.js:275`).
- **Code liest die Karte nur aus `_meta`, nie aus content/structuredContent:** Test `X-2 (Draht)`
  (`:814`) und `(f) Code steht in GENAU EINER gesendeten Nachricht` (`:325`).
- **Klick sendet genau ein `tools/call` `place_call`, Argumente = Anzeige + Code:** Test `(b)`
  (`:241`), Idempotenz durch Doppelklick/Wiederholung: Test `(c)` (`:258`), `(k) Replay nach
  placed` (`:434`). Umgesetzt durch die Zustandsmaschine `confirmState` (`call.html:446`,
  Werte none/awaiting/submitting/placed/rejected/expired/uncertain) und den Knopf-Sperr-Check
  `updateConfirmButtonState()` (`:583-585`).
- **Kein `ui/message` beim Rendern/Reload, nur beim Klick:** Test `(a)` (`:228`).
- **Abgelaufener/fehlender Code -> kein Senden, Hinweis:** Test `(j)` (`:415`).
- **Host-Fehler/-Timeout -> "unklar", kein zweiter Anruf, keine Selbstbestaetigung des Modells:**
  Tests `(g)` (`:345`), `(h)` (`:364`), `(i)`/`(i2)` (`:385`, `:403`), `(o)` (`:496`).
- **XSS/Escape:** `setDisplayText()` (`call.html:470-474`) nutzt `textContent`, kein `innerHTML`.
  Test `(l)` (`:450`).
- **i18n de/fr/en:** neue `WIDGET_DICT`-Keys in allen drei Bloecken belegt (`widget-i18n.js`,
  Diff zeigt 34 neue `+`-Zeilen in DE- und FR-Block je ~12 Keys plus EN als Basis). Test `(m)`
  (`:467`).
- **Widget-Hash-Pins nachgezogen:** `widget-versions.json` — alle vier Widgets (agent-status,
  my-number, calls, call) bekommen neue Versionsnummern, weil `WIDGET_DICT` in jedes Widget
  serialisiert wird; `call` selbst zusaetzlich wegen Markup-/Skript-Aenderung. Kommentar in der
  Datei dokumentiert das nachvollziehbar.
- **Draht-Rundlauf real getestet (nicht nur Fake-DOM):** vier zusaetzliche Tests
  `(e-http)`, `(e-oauth)`, `(e-full-fields)`, `(e-stdio)` (`:594`, `:634`, `:725`, `:775`) fahren
  echten `prepare_call` -> Karte -> echten `place_call` gegen einen gespawnten Server.

**N-10 gilt laut Plan erst als erfuellt, wenn T2-13 UND T2-14 gemeinsam live sind — das ist ein
Deploy-Zustand, keine Code-Eigenschaft dieser Phase allein.**

## 3. Pfade — Abdeckung

| Pfad | Abgedeckt? |
|---|---|
| HTTP Legacy (Token-Auth) | Ja — `(e-http)`, `X-2`, `X-6` |
| HTTP OAuth | Bedingt — `(e-oauth)` ist `skip`-markiert, wenn `externalIp()` in der CI-Umgebung `null` liefert. Ob er in dieser Umgebung tatsaechlich gelaufen ist oder geskippt wurde, ist von mir NICHT geprueft (kein Blick in die Testlog-Zusammenfassung dieser Phase) — UNKNOWN, Grund: nicht im Kontextbudget. |
| stdio | Ja — `(e-stdio)` spawnt einen echten Kindprozess |
| Fake-DOM (node:vm, isoliert vom Draht) | Ja — Tests (a)-(p), Mehrheit der 22 Tests |
| ChatGPT / Claude echte Hosts | NICHT gebaut/gemessen — Owner-Punkt |

## 4. Was ein unabhaengiger Pruefer nachmessen sollte (neutral)

- Ist die G5-Duplizierung tatsaechlich noch vorhanden? `sed -n '678,730p' src/ui/widgets/call.html`
  im Worktree lesen und pruefen, ob der `uncertain`-Uebergang (vier Zeilen) an zwei Stellen
  wortgleich steht oder in eine gemeinsame Funktion gezogen wurde.
- Unterscheidet `confirmationRequired` (`src/i18n/mcp-texts.js:134`) zwischen einem verbrauchten
  und einem nie ausgestellten/fehlenden Code? Serverseitig pruefen, ob `confirmCallHop`/die
  zugehoerige Route zwei unterschiedliche Zustaende zurueckgibt oder ob beide auf denselben
  generischen Text fallen.
- Laeuft `npm test` im aktuellen Worktree-Stand tatsaechlich gruen (`# pass`/`# fail`-Zeilen lesen,
  nicht den Exit-Code — siehe `npm-test-exit-code-luegt`-Lehre im Projekt), und stimmt die
  genannte Zahl (6479 pass / 0 fail) mit einem frischen Lauf ueberein?
- Ist die Baseline-Luecke (kein Vorher-Test auf c726212) tatsaechlich folgenlos — d.h. laeuft
  `npm test` auf `c726212` selbst (vor dieser Phase) ebenfalls komplett gruen, damit die
  Nachher-Zahl als Nicht-Regression zaehlt?
- Zeigt die Karte laut Test `(d)` wirklich ALLE neun gebundenen Felder an, wenn sie im
  `structuredContent` vorhanden sind, oder nur eine Teilmenge? Testdatei `:275-324` lesen.
- Ist `data-cf-*` (statt des laengeren `data-confirm-*`) fuer die sieben optionalen Felder eine
  bewusste, dokumentierte Abkuerzung (Groessenbudget) oder ein Rest eines abgebrochenen Refactors?
  Grep nach `data-cf-` und `data-confirm-` im HTML und Test.
- Sendet das Widget in keinem Pfad Klartext des Codes in `ui/message`, Konsole oder DOM-Text
  ausserhalb von `params._meta`? Test `(f)`/`(n)` lesen und pruefen, ob sie tatsaechlich den
  gesamten Nachrichtenverkehr abfangen (nicht nur den Erfolgsfall).
- Ist `X-2` (kein Tool-Ergebnis ausser `prepare_call` traegt Nutzdaten-`_meta`) am Draht ueber ALLE
  Werkzeuge geprueft, nicht nur `place_call`/`prepare_call`? Testdatei `:814-850` lesen.

## 5. Owner-Punkte (konsolidiert) und Restrisiko

Restrisiko in einem Satz: der ungeloeste Sicherheits-Befund (verbrauchter vs. fehlender Code nach
Reload) kann bei einem Server-Neustart im 5-10-Minuten-Fenster des Codes zu einem zweiten echten,
bezahlten Anruf fuehren, ausgeloest durch genau einen Klick auf eine wiederhergestellte alte
Karte — kein Gate wird dabei umgangen, aber die Nutzer-Erwartung ("noch nicht bestaetigt") ist
falsch; dazu kommt der ungeloeste Clean-Code-Blocker (Doppelpflege-Risiko im unklar-Zustand) und
die fehlende Baseline-Messung, die eine Regression nicht ausschliesst.

Owner-Punkte (nur Live-Proben/Deploy/Dashboard-Werte, konsolidiert):
1. Deploy-Vorbedingung: T2-13 und T2-14 nur gemeinsam deployen; Render-Dashboard `MCP_UI_ENABLED`
   nicht `false`, `CALL_CONFIRMATION_SECRET` gesetzt (>= 32 Zeichen, Wert nie in Repo/Chat) —
   erwartet: `prepare_call` liefert eine Karte mit Bestaetigungsknopf, kein
   `confirmation_unavailable`.
2. Live-Probe Claude (claude.ai, Connector neu verbinden): Anruf an die sichere Testnummer
   erbitten; Karte zeigt Ziel/Anliegen/Briefing/Sprache/Dauer in Chat-Sprache; vor UND nach dem
   Klick das Modell nach dem Bestaetigungscode fragen (erwartet: kennt ihn nie); Klick -> genau
   ein Anruf, Karte wird Live-Karte, im Chat erscheint die Meldung mit `call_id` ohne Code. Einmal
   mit Werkzeug-Berechtigung "Immer erlauben", einmal mit "Fragen" fahren.
3. Live-Probe ChatGPT Developer Mode: dieselben Schritte, zusaetzlich pruefen ob ChatGPT das
   Ergebnis-`_meta` von `prepare_call` tatsaechlich ans Iframe durchreicht (Knopf bedienbar) und ob
   der App-initiierte `place_call`-Aufruf eine eigene Host-Bestaetigung zeigt.
4. Reload-Probe in beiden Hosts: Chat nach dem Anruf neu laden -> keine neue Waehl-Aktion; Klick
   auf eine alte Karte -> Hinweis "neu vorbereiten", kein zweiter Anruf (haengt am ungeloesten
   Sicherheits-Befund oben — diese Probe deckt am ehesten auf, ob das Risiko real eintritt).
5. Vor dem Live-Deploy: die im Code als Kommentar zitierte `ui/message`-Wire-Form
   (`params: {role, content}`) gegen die Primaerquelle (`ext-apps specification/2026-01-26/apps.mdx`,
   Abschnitt "ui/message") gegenpruefen — diese Kette hatte keinen Netzzugriff dafuer.

(Owner-Regel angewandt: reine Code-Nachbesserungen wie der G5-Fix oder die Text-Differenzierung
sind KEINE Owner-Punkte — die gehoeren als Merge-Blocker in den Review-Kreislauf, nicht auf diese
Liste.)

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- **Urteil des Laufs:** FAIL (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- **Gemessener Commit:** 31065d6; Tests (volle Suite, pass/fail): 6508/0
- **Review-Urteile zuletzt:** safety=PASS, cleancode=FAIL
- **Tabelle ID | erfuellt | Beleg | Luecke:**

  | ID | erfuellt | Beleg | Luecke |
  |---|---|---|---|
  | N-10 | ja | Lokal über HTTP /mcp gemessen: place_call ohne/mit erfundenem Code isError, 0 Anrufe; nach prepare_call (Code nur in _meta) 1 Anruf, derselbe Code erneut abgelehnt. call.html: Karte ruft place_call. e-http/e-oauth/e-stdio grün | Nur baubarer Teil belegt. Offen live beim Owner: Klickprobe in ChatGPT Developer Mode und im claude.ai-Connector (Vorschau sichtbar, 1 Klick = 1 Anruf, Modell sieht den Code aus _meta nicht). Nebenbefund: der Code hat nur 6 Zeichen. |

- **Isoliert rot:** keine
- **Offene Blocker:**
  - Review cleancode: FAIL
  - cleancode/blocker `src/ui/widgets/call.html:686-691`: G5-Duplizierung (S2): der 4-zeilige Uebergang in den Zustand "uncertain" (`confirmState="uncertain"; showConfirmHint(t("Unclear whether the call was placed — do not confirm again; check list_calls.")); updateConfirmButtonState(); sendUncertainMessage();`) steht byte-identisch an ZWEI Stellen: innerhalb von `handlePlaceCallResponse()` im `if(m.error)`-Zweig (Zeilen 686-691) UND als eigener Funktionskoerper von `onConfirmResponseTimeout()` (Zeilen 720-727). Verifiziert per grep gegen die tatsaechliche Arbeitskopie (`wt-t2-14/src/ui/widgets/call.html`) - kein Tippfehler, exakter String-Treffer beider Bloecke.
  - safety/wichtig `src/ui/widgets/call.html:621` (`handleAwaitingConfirmationPush`/`renderConfirmation` :591) + `src/mcp-tools.js:1544` (`confirmationRequired` fuer verbrauchten Code): Die Karte merkt sich nicht, dass sie schon bestaetigt hat. Laedt der Host sie neu (Seite neu geladen, Chat auf einem anderen Geraet geoeffnet), kommt der alte `prepare_call`-Push samt `_meta` noch einmal an. Die neue Instanz startet wieder bei `confirmState` 'none' und macht den Knopf wieder bedienbar, solange `expires_at` nicht erreicht ist. Klickt der Nutzer, lehnt der Server den verbrauchten Code ab. Die Karte zeigt dann `confirmationRequired`: 'Dieser Anruf ist noch nicht bestaetigt ... Der Nutzer muss ihn in der Hermes-Karte bestaetigen'. Das widerspricht der Tatsache, dass der Anruf schon lief. Ist der Code abgelaufen, sagt dieselbe alte Karte 'Bestaetigungscode nicht verfuegbar - bitte um ein neues prepare_call', obwohl der Anruf stattgefunden hat.
