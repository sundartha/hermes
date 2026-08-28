# Phase OUTBOUND-E3A — F2(a): Der Fehler erreicht den Nutzer

Basis: `master` = `d59b136` (E1+E2 gemergt). finalBranch: `phase/outbound-e3a-nutzer-rueckweg-fix2` (Commit `bc70d0c`, aufsitzend auf Impl-Commit `8ba0926`).

**Gate = PASS** (kein S1, kein S2 im Clean-Code-Audit; Safety-Review approved:true, keine Blocker).

Kernaussage der Etappe: Der Fehlergrund eines gescheiterten Anrufs (`call.failureReason`, aus E2) erreicht den Nutzer jetzt ueber die bestehenden Rueckgabewege (MCP `await_call_event`/`get_transcript`, Live-Widget, Dashboard-Notification-Feed) statt nur ueber `get_call_status`. Eine Nutzer-Mail geht ausschliesslich fuer die Klasse `not-placed` raus. Der Reihenfolge-Riegel "Grund vor Buchung" ist Struktur, kein Kommentar mehr. Zusaetzlich behoben: D-4 (Start ohne Anbieter-Status bekommt jetzt `result-unknown:start-no-status` statt `null`) und D-5 (unbekanntes Token faellt im Widget auf ein Sammel-Label zurueck statt roh zu erscheinen).

---

## 1. Die vollstaendige Leserkette — Urteil je Weg

| # | Weg | Sieht den Grund? | E3a? |
|---|---|---|---|
| L1 | MCP `await_call_event` | NEIN -> JETZT JA (Felder `status`/`failure_reason` additiv) | JA |
| L2 | MCP `await_call_event` -> `result_summary` | NEIN (Platzhalter "5 Sekunden warten") -> JETZT JA (Grund-Satz bei terminalem Anruf mit Grund) | JA |
| L3 | MCP `get_transcript` (teilt `pickTranscript`) | erbt L2 automatisch | JA (Nebeneffekt) |
| L4 | MCP `get_call_status` | JA (rohes Token), bleibt Diagnose-Kanal | nein |
| L5 | MCP `place_call`-Antwort | Feld existiert, initial null | nein |
| L6 | Live-Widget (Call-Karte) | JA fuer 7 Basis-Token, ABER unbekanntes Token wurde ROH gezeigt (D-5) | JA (Fix + 2 fehlende Labels) |
| L7 | Notification-Feed (Server-Text) | JA mit Grund, ohne Grund Bestandsfallback; niemand rendert ihn | nein (Text bleibt byte-identisch) |
| L8 | Notification-Feed (Frontend `/app`) | NEIN — reine Frontend-Luecke (0 Treffer in `apps/web`) | JA (Renderfunktion + Insel) |
| L9 | Dashboard-Anrufliste | zeigt FAILED, keinen Grund | nein |
| L10 | Summary-SMS | strukturell nie erreicht, kein SMS-Generator | nein |
| L11 | Summary-Mail | strukturell nie erreicht (Gate `!call.summary`) | JA — genau eine Mail, nur `not-placed` |
| L12 | MCP `list_calls` | NEIN | nein, bewusst offen |
| L13 | `check_inbox` | n.z. (Inbox ist eingehend) | nein |
| L14 | Betreiber-Alarm-SMS | n.z. — E3b, nicht vorgegriffen | nein |

**Keine zweite Wahrheit:** Aufloesung Token->Satz existiert an genau drei Stellen, alle drei aus EINER Phrasentabelle (`FAILURE_REASON_TEXTS.phrases`): `makeFailureSentence` -> `makeStatusBody` (Notification+Mail, L7/L11) und `makeCallFailedSummary` (MCP, L1-L3). `FAILURE_REASON_LABELS` (Widget) ist reine Praesentation. Rohes Token nur im Maschinenfeld/Store/Log, nie im Nutzertext.

---

## 2. Der Reihenfolge-Riegel (Befund C1) inkl. ausgefuehrter Sabotage

**Idee:** Die Invariante ist nicht "Zeile A vor Zeile B" (verschiebbar, per Kommentar), sondern "der Grund wird INNERHALB von `persistEnd` geschrieben" — `persistEnd` laeuft in `terminateAndBillCall` garantiert vor `bill()`. Damit gibt es an der Naht keine verschiebbare Anweisung mehr.

Umsetzung `src/routes/api-calls.js`: `providerStatusOf(err)` als reine Abfrage, `endFailedCallWithReason(store, callId, providerStatus)` als Thunk, der `recordFailureReason` + `endCallRecord` in dieser Reihenfolge im `persistEnd`-Slot ausfuehrt.

**Test `test/fehlergrund-reihenfolge-riegel.test.js`** (3 Faelle):
1. `persistEnd` laeuft vor `bill` (Mechanismus-Pin).
2. Der Produktions-Thunk schreibt den Grund vor dem Endstatus.
3. SABOTAGE-FANG: `persistEnd: endFailedCallWithReason(store, call.id, providerStatus)` ist verdrahtet, `store.recordFailureReason(` kommt in der Datei genau einmal vor.

**Ausgefuehrte Sabotage (Impl, Abnahmepunkt C1c, Pflicht):** `store.recordFailureReason` aus `endFailedCallWithReason` entfernt UND die Aufrufstelle durch eine reine Inline-Arrow `() => store.endCallRecord(...)` ersetzt (Grund wuerde erst NACH `terminateAndBillCall` geschrieben).
- Ergebnis: `tests 3 / pass 1 / fail 2` (Fall 2 + Fall 3 rot: `AssertionError: erwartet ["reason:...","end:failed"], real []`; Wiring-Regex matcht nicht mehr).
- Danach vollstaendig zurueckgebaut, `git diff` zeigte keine Sabotage-Reste, erneuter Lauf `pass 3 / fail 0`.

**Zweite, unabhaengige Sabotage (Safety-Review, selbst gefahren):** `recordFailureReason` aus dem Thunk heraus und hinter das `await terminateAndBillCall(...)` verschoben -> **volle Suite rot** (SABOTAGE-FANG + `telnyx-p5-origination`). Riegel wirkt auch gegen diese Variante.

**Wichtigster offener Befund (Concern C-A, kein Blocker, weil C1 explizit auf `api-calls.js` zugewiesen war):** Dieselbe Reihenfolge-Fragilitaet lebt unveraendert in `src/routes/voice.js:542` — Safety-Reviewer hat dort `recordFailureReason` hinter `terminateAndBillCall` verschoben, **die gesamte Suite blieb gruen**. Diese Naht erzeugt `not-placed` fuer SIP 401/403/407 — genau die Klasse, die ab E3a zusaetzlich die Nutzer-Mail ausloest. Dritte Naht `src/elevenlabs/outbound.js:1278` (erzeugt das Token des realen 27.08.-Ausfalls `not-placed:invite-403-D51`) ist nur zufaellig gedeckt: dieselbe Sabotage macht dort genau einen Test rot, der den Buchungsanker prueft, nicht Nutzertext/Feed/Mail. **E3a vergroessert den Schadensradius dieses latenten Bugs, ohne ihn dort zu schliessen.** Empfehlung: Riegel in E3b/E4 auf `voice.js` und `elevenlabs/outbound.js` ausdehnen.

---

## 3. Die Mail-Bedingung samt Entprellung

**Gates in fester Reihenfolge** (`src/mail-not-placed.js`, `planNotPlacedMail`):
1. `mailer` verdrahtet (sonst Skip `no_mailer`)
2. `call.direction === "outbound"` (sonst kein Skip-Grund geloggt, aber kein Versand) — verhindert, dass ein eingehender Anruf mit SIP-403 (`sipBase`-Klassifikation, E2-r4) eine Fehl-Mail ausloest
3. Basis-Token `failureReasonBase(call.failureReason) === NOT_PLACED`
4. Entprellung: kein anderer `not-placed`-Anruf desselben Tenants im Fenster
5. Konto-Adresse vorhanden (sonst Skip `no_account_email`)

**Deviation (in Impl selbst gefunden und korrigiert):** Der Plan-Pseudocode hatte die zwei billigen Kandidaten-Gates (Richtung, Basis-Token) NACH dem Mailer-Gate; die Umsetzung prueft sie DAVOR — sonst haette jeder gescheiterte Anruf jeder Klasse bei fehlendem Mailer ein `no_mailer`-Audit ausgeloest (reines Rauschen). Bestandsregressionstests (`gq-p15-failure-reason-notification.test.js`) waeren dadurch tatsaechlich rot geworden — isoliert reproduziert, dann korrigiert.

**Entprellung:** `NOT_PLACED_MAIL_DEBOUNCE_MS = 60 * 60 * 1000` (1 h, benannte Konstante), gemessen aus persistierten `call`-Zeilen (`store.load().calls`), tenant-gefiltert, kein In-Memory-Zaehler, kein neuer Env-Wert. Fuenf Fehlversuche in 6 Minuten -> genau eine Mail; 2 h Abstand -> zwei Mails (Positiv-Kontrolle der Wiederfreigabe); Tenant A unterdrueckt Tenant B nicht.

**Empfaenger/Inhalt:** ausschliesslich `account.email` des anrufenden Tenants; Betreff `t.failedTitle` (Bestandstext); Text = `t.statusBody(...)` (dieselbe Funktion wie die Notification) + neue Zeichenkette `notPlacedMailHint` (de/fr/en). Kein Gespraechsinhalt, kein Anbieter-Rohtext, keine Summary/Transkript. Zielrufnummer nur dort, wo der Bestand sie ohnehin zeigt.

**Versandweg:** bestehende `sendMailToTargets`-Schleife, kein zweiter Benachrichtigungsweg, fail-soft, Audit nur Marker+Grund (`not_placed_mail_skipped call=... reason=...`), nie E-Mail/Rufnummer im Audit.

**Akzeptiertes Restrisiko (D-e, benannt):** kein persistierter Per-Anruf-Marker (`failureMailSentAt`); ein zweiter `finishCall`-Durchlauf nach Prozess-Neustart kann die Mail wiederholen — dieselbe Idempotenz-Klasse wie die bestehende Notification. Vollstaendiger Fix (additive Spalte, Muster `summaryMailSentAt`) ist eigener Vorgang, kein E3a-Nebeneffekt.

**Vom Clean-Code-Audit vertieft (S3-1, S3-2, kein Blocker, aber fuer naechste Runde vorgemerkt):**
- S3-1: Kein persistierter Idempotenz-Marker (anders als `summaryMailSentAt`/`markSummaryMailSent`) — nach Neustart zweite identische Mail moeglich.
- S3-2: Die Entprellung haengt am VORFALL (existiert ein fruehere `not-placed`-Anruf), nicht an der tatsaechlich VERSENDETEN Mail. Wurde die erste Mail uebersprungen oder schlug SMTP fehl, unterdrueckt die Entprellung trotzdem jede Folge-Mail der naechsten Stunde — im Extremfall NULL Mails zum Vorfall.
- S3-6: `store.load().calls` ist ein Vollscan aller Tenants bei jedem `not-placed`-Abschluss, nicht tenant-gefiltert auf Store-Ebene.

---

## 4. Behandlung von D-4 und D-5

**D-4 — Start ohne Anbieter-Status** (`src/telephony/failure-reason.js`, `startRejectionReason`):
Vorher: kein `providerStatus` -> `null` (kein Grund). Jetzt: `code === null` -> `reasonOf(RESULT_UNKNOWN, detailOf(SOURCE_START, "no-status"))`, erzeugt `"result-unknown:start-no-status"`. Fail-closed in beide Richtungen: kein erfundener Grund, aber kein leeres Feld — landet in der Unbekannt-Klasse, NICHT in der Schuldklasse `not-placed` (loest also keine Nutzer-Mail aus).
Beleg (Safety, End-to-End am echten Server, `TELNYX_API_BASE=http://127.0.0.1:1` -> ECONNREFUSED): HTTP 500, `call.status='failed'`, `call.failureReason='result-unknown:start-no-status'`, Feed "Grund: der Ausgang des Anrufs ist unbekannt", `await_call_event` traegt Status+Grund+Satz, KEINE Mail.

**D-5 — unbekanntes Token im Widget** (`src/ui/widgets/call.html`, `failureReasonLabel`):
Vorher: `return mapped ? t(mapped) : token;` — zeigte jedes unbekannte Token roh (real betroffen: `max-duration-cap`, `budget-exhausted`, in `FAILURE_REASON_TEXTS` vorhanden aber nicht in `FAILURE_REASON_LABELS`). Jetzt: `return t(mapped || "Failed");` — Sammel-Label-Rueckfall, plus die zwei fehlenden Labels ergaenzt, plus `widget-i18n.js` um "Duration limit"/"Budget used up" in de/fr erweitert.
Beleg: Phantasie-Token `"voellig-neu-2027:ROHTEXT-+4915199887766-Herr-Mueller-hat-Krebs"` eingeschleust -> Nutzertext (MCP) genau "Der Anruf ist nicht zustande gekommen." (Sammelsatz, keine Nummer, kein Name); Widget-Token `"sonderfall-token"` -> "Failed". Maschinenfeld `failure_reason` traegt das Token weiterhin roh (Diagnose-Kanal).

**Vom Clean-Code-Audit vertieft (S3-4, S3-5, kein Blocker):**
- S3-4: `failureSummary` entsteht nur bei `mapStatus(c) === "failed"` — ein terminal ABGEBROCHENER Anruf (`cancelled`, hat ebenfalls nie eine Summary) bekommt weiterhin den Poll-Platzhalter. Dieselbe Defektklasse wie F2a, ein Status zu kurz.
- S3-5: `AWAIT_SUMMARY_PLACEHOLDER` ist im Test woertlich ein zweites Mal getippt statt aus `mcp-tools.js` importiert — Byte-Identitaets-Anspruch der Etappe haengt an einer nicht geteilten Konstante.
- Safety-Concern C-F: Ein per `max-duration-cap`/`budget-exhausted` beendeter Anruf endet mit Status `completed` — weder neuer Fehler-Satz noch grundtragender Notification-Zweig greift dort; MCP-Rueckweg liefert fuer diese zwei Klassen weiterhin den Warte-Platzhalter.

---

## 5. Abnahmepunkte einzeln — Urteil + Kommando

| # | Kommando | Erwartet | Ist (Impl) | Urteil |
|---|---|---|---|---|
| S0 | `npm run test:gates` (vor erstem Edit, master) | Baseline festhalten | `129/126/3` (GAP-05, GAP-15, E2E-03) | Baseline erfasst |
| C1 | `node --test test/mcp-fehlergrund-rueckweg.test.js` | pass 6 | pass 7 (1 Zusatzfall) | PASS |
| C1b | `node --test test/fehlergrund-reihenfolge-riegel.test.js` | pass 3 | pass 3 | PASS |
| C1c | Sabotage-Gegenprobe (Grund hinter `await` verschoben) | fail 2 | fail 2, danach zurueckgebaut, `git diff` sauber, erneut pass 3 | PASS |
| C2 | `node --test test/dashboard-notification-feed.test.js` | pass 1 | pass 4 (3 Zusatzfaelle) | PASS |
| C3 | `node --test test/nutzer-mail-nur-not-placed.test.js` | pass 3 | pass 10 (8 geplant + 2 Zusatz) | PASS |
| C4 | Bestandstest-Buendel (5 Dateien) | fail 0 | pass 91 (inkl. zusaetzlich mitgeprueftem `mcp-ui-w1-call-widget.test.js`) | PASS |
| C5 | `LLM_PROVIDER=anthropic npm test` | fail 0, pass >= 5164+neue | Impl: 5170/0; Safety (unabhaengig): 5174/0 | PASS |
| C6 | `npm run test:gates` (nachher) | fail <= 3, dieselben Faelle | `129/126/3`, identisch (GAP-05, GAP-15, E2E-03) | PASS |
| C7 | `npm run lint` (voller Worktree) | 0 errors | 0 errors, 64 warnings (Baseline identisch) | PASS |
| C8 | `check-staged-suppressions.js` auf 3 Dateien | Exit 0, kein Pin angehoben | Exit 0; `id-length` in `call-finish.js` GESUNKEN 12->10 | PASS |
| C9 | `node --check` auf jede geaenderte Datei | keine Ausgabe | keine Ausgabe (13 src + 10 test) | PASS |
| C10 | PII-Probe (manuell, fiktive Nummern) | kein Leak | kein Leak (Details Abschnitt 6) | PASS |
| C11 | `git diff --stat` gegen `d59b136` | nur Plan-Scope | 27/28 Dateien, kein Safety-/Auth-/Signatur-Code beruehrt, +1 dokumentierte Zusatzdatei (`mcp-ui-w1-call-widget.test.js`, D-5-Folgefix) | PASS |

---

## 6. Ausgefuehrte Gegenproben — woertlich

**Positiv-Kontrolle (Fall 2/3/6, `mcp-fehlergrund-rueckweg.test.js`):**
> Fall 2 (laufender Anruf, event="none"): status=null, failure_reason=null, result_summary=null - der Warte-Zustand ist unveraendert, kein Platzhaltertext wird faelschlich unterdrueckt.
> Fall 3 (terminaler Anruf OHNE Grund, failureReason=null): result_summary ist assert.equal-geprueft byte-identisch zum Bestandsplatzhalter "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)".
> Fall 6 (Rueckwaertskompatibilitaet): pickTranscript(id, call) OHNE dritten Parameter liefert ebenfalls den Bestandsplatzhalter, byte-identisch.

**PII-Probe (Fall 7 + manuelle Ende-zu-Ende-Probe):**
> Call mit summary="GEHEIM-Gespraechsinhalt", Transkriptzeile "GEHEIM-Transkriptzeile" und failureReason="not-placed:start-403": Mailtext (subject+text) enthaelt WEDER "GEHEIM" NOCH "INVITE" NOCH "Invalid destination"; Audit-Detail enthaelt weder die Konto-Adresse noch die Zielrufnummer.
>
> Manuelle Sonde: RAW_PROVIDER_TEXT = "sip status: 403: Forbidden - Invalid destination number +19295550187 (John Testson)", call.to = "+12025550143".
> Klassifiziertes Token: "not-placed:invite-403" - Rohtext im Token enthalten? false - Anbieter-Nummer im Token enthalten? false.
> Versendeter Mailtext: '{"to":"kunde@example.test","subject":"Anruf nicht zustande gekommen","text":"+12025550143 (Status: failed, Grund: der Anruf konnte auf unserer Seite nicht aufgebaut werden)\n\nDer Fehler lag auf unserer Seite, nicht bei dir. Wir kuemmern uns darum; du kannst es spaeter erneut versuchen."}'
> Mail enthaelt das gewaehlte Ziel '2025550143' (ERLAUBT)? true - Mail enthaelt 'Invalid destination' (VERBOTEN)? false - Mail enthaelt die Anbieter-Nummer '9295550187' (VERBOTEN)? false - Mail enthaelt 'John Testson' (VERBOTEN)? false - Mail enthaelt 'GEHEIM' (VERBOTEN)? false - Mail enthaelt das rohe Token als Text (VERBOTEN)? false.

**Reihenfolge-Sabotage (C1c):**
> (1) Anweisungen im Produktions-Thunk endFailedCallWithReason getauscht -> test/fehlergrund-reihenfolge-riegel.test.js ROT (deepStrictEqual-Diff gesehen).
> (2) Der echte C1-Fall: recordFailureReason aus persistEnd heraus und hinter das await terminateAndBillCall verschoben -> volle Suite ROT, 2 Faelle (SABOTAGE-FANG + telnyx-p5-origination). Riegel wirkt. Danach exakt zurueckgebaut, Baum sauber, Schluss-Lauf wieder 5174/0. ZUSAETZLICH gemessen (Concern C-A): dieselbe Verletzung in src/routes/voice.js:542 laesst die GESAMTE Suite gruen; in src/elevenlabs/outbound.js:1278 wird nur 1 anker-bezogener Test rot.

**Clean-Code-Audit Gegenprobe (Mail-Gate):**
> Das not-placed-Gate in planNotPlacedMail aufgeweicht -> test/nutzer-mail-nur-not-placed.test.js Faelle 2/3/4 rot (7 pass / 3 fail); zurueckgesetzt, Baum sauber.

---

## 7. Impl-Zusammenfassung + Deviations

**Neu (5 Dateien):** `src/mail-not-placed.js`, `test/mcp-fehlergrund-rueckweg.test.js`, `test/fehlergrund-reihenfolge-riegel.test.js`, `test/nutzer-mail-nur-not-placed.test.js`, `test/dashboard-notification-feed.test.js`

**Geaendert (Produktion):** `src/telephony/failure-reason.js` (D-4), `src/i18n/failure-reason-texts.js`, `src/i18n/mcp-texts.js`, `src/i18n/locales.js`, `src/mcp-tools.js`, `src/routes/api-calls.js` (C1-Riegel), `src/telephony/call-finish.js`, `src/mcp-server-info.js`, `src/ui/widgets/call.html` (D-5), `src/ui/widget-i18n.js` (D-5), `apps/web/src/lib/api.js`, `apps/web/src/lib/render.js`, `apps/web/src/components/app/CallsIsland.astro`

**Geaendert (Test):** `test/fehlergrund-vokabular.test.js`, `test/anrufstart-ablehnung-grund.test.js`, `test/mcp-tools-language.test.js`, `test/mcp-ui-widget-i18n.test.js`, `test/mcp-ui-w1-call-widget.test.js` (nicht im Plan, D-5-Folgefix)

**Deviations (Spec vs. Ist-Code, gemeldet, Ist-Code respektiert):**
- D-a: `AWAIT_EVENT_OUTPUT` bekommt Status/Grund NICHT ueber `pickCallStatus` (das liefert `last_transcript_lines`, DSGVO-Kanal), sondern ueber den kleineren gemeinsamen Erzeuger `callOutcomeView(c)` — regelkonformer als die Plan-Vorgabe.
- D-b: `awaitEventView` bekommt ein Objekt-Argument statt vier Positionsparameter (sonst `max-params: 3` verletzt).
- D-c: Neues Modul heisst `src/mail-not-placed.js` (Bestandsnachbarschaft zu `mail-summary.js`), nicht `src/mail/...`.
- D-e: kein persistierter Per-Anruf-Marker gebaut (s. Abschnitt 3, akzeptiertes Risiko).
- D-f: Der `not-placed`-Wiederhol-Hinweis in `MCP_CONSULT_INSTRUCTIONS` wird nur bei aktivem Consult-Kanal ausgeliefert (Safety-Concern C-C: mit `CONSULT_ENABLED=false` fehlt die "Do NOT retry"-Anweisung ganz).
- D-h/D-i: Abnahmezahlen und Testzahlen wurden in der Umsetzung durchgehend UEBERTROFFEN, nie unterschritten.
- Zwei in der Impl selbst gefundene und korrigierte Abweichungen: Mail-Gate-Reihenfolge (s. Abschnitt 3) und `mcp-ui-w1-call-widget.test.js` musste an das jetzt korrekte D-5-Verhalten angepasst werden.

---

## 8. Safety-Urteil

**approved: true**, alle 20 Pruefpunkte unabhaengig selbst gefahren (frischer Worktree, kein Impl-Beleg uebernommen). Keine Blocker.

**Concerns (9, keiner blockierend):**
- **C-A (wichtigster Befund):** Reihenfolge-Riegel deckt nur `api-calls.js`; dieselbe Fragilitaet in `src/routes/voice.js:542` und `src/elevenlabs/outbound.js:1278` bleibt offen, E3a vergroessert dort den Schadensradius (s. Abschnitt 2).
- C-B: kein durabler Je-Anruf-Marker fuer die Mail (s. S3-1).
- C-C: `not-placed`-Wiederhol-Riegel im Prompt nur bei aktivem Consult-Kanal ausgeliefert.
- C-D: `notPlacedMailDebounced` scannt `store.load().calls` — im pg-Backend nur der hydrierte Spiegel, nicht die volle Historie; Reichweite der Entprellung ist die des Spiegels.
- C-E: Widget haelt weiterhin eigene `FAILURE_REASON_LABELS`-Tabelle (Client-Datei, kann `src/i18n` nicht importieren) — Vollstaendigkeit haengt am handgepflegten `FAILURE_REASON_BASE_TOKENS`.
- C-F: `max-duration-cap`/`budget-exhausted` enden mit `status:"completed"` — MCP-Rueckweg liefert dort weiterhin den Warte-Platzhalter trotz gesetztem `failure_reason`.
- C-G: `get_call_status`-JSON hat geaenderte Schluesselreihenfolge (kosmetisch, kein Vertragsbruch).
- C-H: neue deutsche Mail-Texte in ASCII-Transliteration (folgt Konvention der Zieldatei, aber orthografisch falsches Deutsch im Kundenpostfach).
- C-I: `PROMPT-07` im Gates-Lauf ist ein Bestandsflake, nicht von E3a verursacht; stabile rote Menge auf beiden Seiten identisch.

**Verdict:** FREIGABE, mit expliziter Auflage fuer die naechste Etappe: Reihenfolge-Riegel auf `voice.js` und `elevenlabs/outbound.js` ausdehnen (E3b/E4).

---

## 9. Clean-Code-Audit

**Verdict: PASS** (kein S1, kein S2). Zwei eigene Gegenproben ausgefuehrt (Reihenfolge-Sabotage, Mail-Gate-Aufweichung), beide fingen den erwarteten Fehler; danach sauber zurueckgebaut.

**S3 (6 Punkte, keiner blockierend, aber fuer naechste Runde vorgemerkt):**
- S3-1: kein Idempotenz-Marker fuer die not-placed-Mail (Doppel-Mail nach Neustart moeglich).
- S3-2: Entprellung haengt am Vorfall, nicht an der versendeten Mail — kann zu NULL Mails zum echten Vorfall fuehren.
- S3-3: `notPlacedMailHint` (DE) ist ASCII-transliteriert, obwohl der einzige andere deutsche Mail-Text derselben Datei (`newsletter.confirmMailText`) volle Umlaute traegt — Konvention nicht konsistent, Owner-Entscheid noetig.
- S3-4: Rueckweg schliesst nur Status `failed`, nicht `cancelled` (dieselbe Defektklasse wie F2a, ein Status zu kurz).
- S3-5: `AWAIT_SUMMARY_PLACEHOLDER` im Test woertlich dupliziert statt importiert.
- S3-6: `store.load().calls`-Vollscan bei jedem `not-placed`-Abschluss statt tenant-gefilterte Sicht.

**S4 (9 kleinere Punkte):** ungenutzter Parameter `windowMs` ohne Aufrufer, `notPlacedMailDebounced` exportiert aber nur intern genutzt, `providerStatusOf` existiert zweimal im Repo mit verschiedenen Vertraegen (Namenskollision mit `llm.js`), unnoetige Ein-Zeilen-Indirektion, doppelte Ziel-Herleitung in `call-finish.js`, CSS-Scoping-Inkonsistenz, doppelt definierte `MINUTES_PER_HOUR`-Konstante, Kommentar beschreibt einen nicht gebauten Testfall, ungetesteter Gleichstand-Grenzfall bei identischem `endedAt`.

**Top-TODOs fuer die naechste Runde:**
1. Persistierten Sende-Marker nachziehen (schliesst S3-1 und S3-2 in einem Zug).
2. Owner-Entscheid zur Umlaut-Konvention in Kunden-Mails einholen (S3-3).
3. `AWAIT_SUMMARY_PLACEHOLDER` exportieren und im Test importieren (S3-5), danach S3-4 (`cancelled`) entscheiden.

---

## 10. Fix-Runden

- **r1:** Der einzige zugewiesene Blocker (G2) behoben, minimal im Bestandsmuster. `npm run test:gates` auf master als Baseline gefahren (3 rote Faelle), nach der Umsetzung dieselben 3.
- **r2:** Drei zugewiesene Review-Blocker (P11/T1, G5/G22, G5/G25) minimal und sauber behoben, kein Scope-Drift. `node --check` gruen fuer alle geaenderten Dateien. `LLM_PROVIDER=anthropic npm test`: 5174 pass / 0 fail (>= geforderte Untergrenze 5167 erfuellt). `npm run lint` (voll) gruen.
