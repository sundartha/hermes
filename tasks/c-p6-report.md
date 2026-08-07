# C-P6 — Kommentar-Nachlese nach dem Twilio-Ausbau (Track C, Schritt 5c)

**Gate: PASS**
**finalBranch: `phase/c-p6-kommentar-nachlese`**
**headCommit: `bb8848244fe69c93aa73092b6c4576c419d49504`**

## Kontext

Nach dem Ausbau des Twilio-Adapters (C-P4) und dem Entfernen der Twilio-HMAC-Pruefung (C-P3) blieben in Kommentaren, JSDoc und Prosa noch zahlreiche Twilio-Referenzen zurueck — teils veraltet, teils faktisch falsch (behaupteten Twilio-Verhalten, das im Code nicht mehr existiert). C-P6 ist eine reine Kommentar-Nachlese: keine neue Funktion, kein neuer Export, keine Logik-Aenderung, kein Test-Verhalten.

Baseline-Neuerhebung (bereits vor Planbeginn durchgefuehrt): `master` = `90db553` (C-P5 gemergt). `git grep -in twilio -- src/ test/` = 372 Treffer, exakt deckungsgleich mit der Spec-Baseline (9ddf1df: 451, Differenz durch C-P5-Reduktion erklaert und aufgeschluesselt in Eimer R1/R3/R4).

## Plan (gekuerzt)

- **0. Baseline-Neuerhebung**: Ist-Zustand (90db553) gegen Spec-Baseline (9ddf1df) abgeglichen — 196 Kern-Treffer (79 src + 117 test) exakt deckungsgleich, kein Zitat fehlt/neu.
- **1. Neue Dateien**: keine — das ist die Aussage der Phase.
- **2. Globale Umsetzungsregeln**: nur Kommentarzeichen aendern; Umbruchregel bei zu langen Zeilen (an Ort und Stelle brechen, nie umfliessen); drei benannte Ausnahmen, wo ein Satz ueber mehrere Zeilen laeuft und ganz neu gesetzt wird (`ports.js:1-2`, `ports.js:55-57`, `answered-by.js:20-22`, `telnyx-inbound.js:93-95`); Deutsch ohne Umlaute; erst Baseline messen, dann editieren.
- **3. Edits `src/`**: 22 Dateien, 45 UMFORMULIEREN + 4 FAELLT (ersatzlose Streichungen) + 2 aus Abschnitt 2.5 (Traeger-Wechsel bei G5-Begruendungen). Betroffen u.a. `app.js`, `bridge.js` (2 Stellen in "HEIKLE STELLE 2" — nur Kommentartext), `ports.js` (7 Edits, JSDoc), `state-ops.js`, `telnyx-inbound.js`, `telephony/adapters/telnyx/*`. Vier Stellen sind faktisch falsche Aussagen und werden korrigiert (`bridge.js:136`, `voice-render.js:25`, sowie zwei Testkommentare) — Default ist `DEFAULT_PROVIDER` (Telnyx), nicht mehr "Twilio-Default".
- **4. Edits `test/`**: 21 Dateien, 23 UMFORMULIEREN + 1 aus 2.5. Kein Testname, keine Assertion, kein String-Literal geaendert — nur Kommentare/Beschreibungstext.
- **5. `gitleaks.toml`**: 1 Edit, nur die Kommentarzeile ueber dem `paths`-Block (entfernt veraltete Erwaehnung von `ACtest...`/`test-twilio-auth-token`, die seit C-P5 in `test/helpers.js` nicht mehr existieren). `paths`-Block selbst unangetastet.
- **6. Tests**: bewusst keine neuen/geaenderten Tests — kein neues Verhalten entsteht, das ein Test belegen koennte. Regressionsschutz ist die unveraenderte Bestandssuite mit identischer Testzahl plus mechanischer Nur-Kommentar-Diff-Filter.
- **7. Deterministisch pruefbares Ergebnis**: Diff gefiltert auf Nicht-Kommentar-Zeilen muss GENAU 12 Zeilen liefern (6 Zeilenend-Kommentar-Paare mit zeichengleichem Code-Anteil); `node --check` auf allen geaenderten Dateien; identische Testzahl vor/nach in `npm test` und `npm run test:gates`; geschlossene Dateiliste (44 Dateien); Smoke-Test (`/healthz`, `/voice/incoming` mit `SKIP_TWILIO_SIGNATURE_CHECK`).
- **8. Report-Befunde (kein Auftrag)**: `call-finish.js:141` (Laufzeit-String mit irrefuehrendem Twilio-Trial-Hinweis), 25 R4-Treffer in C-P5-Dateien (nicht Zustaendigkeit dieser Phase), drei bewusst nicht editierte Kollateral-Formulierungen ausserhalb des Suchbegriffs, zwei offene Altbefunde (`voice-status-lifecycle.test.js`, `voice-incoming-catch-path.test.js`).
- **9. Blast-Radius**: 44 Dateien, ~75 geaenderte Zeilen, null ausfuehrbare Zeichen.

## Impl-Zusammenfassung

- **44 Dateien geaendert**: 22 in `src/`, 21 in `test/`, `gitleaks.toml`. 99 Insertions / 93 Deletions.
- **45 UMFORMULIEREN + 4 FAELLT** in `src/` (22 Dateien); **23 UMFORMULIEREN + 1 aus 2.5** in `test/` (20 Dateien); 1 Edit `gitleaks.toml`.
- Die vier mehrzeiligen Satz-Ausnahmen (`ports.js:1-2`, `ports.js:55-57`, `answered-by.js:20-22`, `telnyx-inbound.js:93-95`) wurden wie geplant als ganzer Satz neu gesetzt (Regel-3-Ausnahme).
- **`node --check`**: gruen auf allen 43 geaenderten `.js`-Dateien.
- **`npm test`**: 4007/4007 pass, 0 fail — identisch vor und nach den Edits (Baseline auf `master` 90db553 gegengeprueft).
- **Committed**: `bb8848244fe69c93aa73092b6c4576c419d49504` auf `phase/c-p6-kommentar-nachlese`.
- **Smoke**: `/healthz` → 200; `/voice/incoming` ohne Signatur-Header mit `SKIP_TWILIO_SIGNATURE_CHECK=true` → 200; `test/security.test.js` separat 19/19 gruen (Telnyx-Ed25519 → 200 + TeXML, ungueltige/Twilio-Header → 403).

### Deviation

`npm run test:gates` terminierte im Sandbox-Worktree NICHT bis zum Endergebnis: deterministischer Hang/Crash bei `test/auth-p9a-cache-headers.test.js` unter `--test-name-pattern` — die Datei matcht keinen der Katalog-Namensmuster, `before()` wird uebersprungen (setzt `srv` nicht), `after()` laeuft trotzdem und ruft `srv.stop()` auf `undefined` auf. Reproduziert identisch bei `--test-concurrency=0/4/1`, in einer isolierten Zwei-Datei-Repro, UND auf dem unveraenderten `master` (90db553) mit identischem Kommando — **vorbestehender Defekt, keine C-P6-Regression**, ausserhalb des Scopes dieser reinen Kommentar-Phase. Isoliert ohne Namensfilter laeuft die Datei selbst gruen (5/5, 246ms bzw. 262ms in der unabhaengigen Safety-Messung).

Ersatzbeleg statt der Zahlenvergleich-Abnahme: alle `test()`/`describe()`/`it()`-Deklarationszeilen aus `test/` auf `master` und `HEAD` extrahiert und verglichen — 3867 vs. 3867, Diff leer. Da der Katalog-Split ausschliesslich ueber Testnamen laeuft (`test/i18n-catalog-run.mjs`, `package.json` `config.i18nCatalogPattern`), kann kein Test die Partition gewechselt haben. `CLAUDE.md` erlaubt `test:gates` ausdruecklich rot ("DARF rot sein"); verbindliche Nachweis-Basis ist `npm test` (MUSS gruen sein, ist es: 4007/4007 identisch vor/nach).

## Safety-Urteil

**APPROVED.** Kernbeweis: der gefilterte Diff (`master..HEAD`, Nicht-Kommentar-Zeilen) enthaelt **exakt die sechs vorab von der Spec benannten Zeilenend-Kommentar-Paare**, deren Code-Anteil zeichengleich ist — null Laufzeit-Bytes geaendert. Damit sind alle Absolute-Regel-Bereiche per Konstruktion unberuehrt:

- **SAFETY-GATES**: `src/claude.js` und `route-policy.js`/`registry.js` gar nicht im Diff; `routes/api-calls.js`, `call-lifecycle.js` nur Kommentare, Max-Dauer-Cap-Code unveraendert; Signaturkette (`registry.js` `providerFromHeaders`/`inboundSignatureVerifier`) unangetastet — End-to-End im eigenen Lauf gruen (Telnyx-Ed25519 gueltig → 200+TeXML, ungueltig/kein Header → 403).
- **OFFENLEGUNG**: `claude.js` nicht im Diff; `bridge.js` nur Kommentarzeilen 1/130/136; `disclosureSentence` unveraendert.
- **AUTH FAIL-CLOSED**: `route-policy.js`/`auth.js`/`web-auth.js` nicht im Diff; `middleware.js` nur eine Kommentarzeile; `route-auth-inventory.test.js` und `auth-p*`-Tests gruen.
- **SECRETS**: nichts geloggt/geleakt; `gitleaks.toml` nur die `#`-Zeile geaendert, `paths`-Block unveraendert.
- **Scope**: 44 Dateien, alle aus Spec 2.1/2.2/2.3/2.5, keine C-P5-Datei, kein `package.json`, kein `CLAUDE.md`, kein `.claude/workflows`.
- Vier faktisch falsche Kommentare korrigiert und am Code belegt (`registry.js` Default = `DEFAULT_PROVIDER` = Telnyx).

Unabhaengige Messung (Safety-Agent, frischer Worktree): `npm test` 4007/4007 pass, 0 fail — identisch zur eigenen Baseline auf `master` 90db553.

**Concerns (kein Blocker, alle als Folge-Phasen-Kandidaten vermerkt):**

1. `npm run test:gates` haengt deterministisch bei `test/auth-p9a-cache-headers.test.js` — reproduziert auch auf `master`, vorbestehend, kein C-P6-Befund.
2. `src/routes/voice.js:110` — "bedient beide Provider" bricht ueber die Zeile um, Grep findet es nicht; von der Spec bewusst nicht in der 2.5-Liste.
3. `src/telephony/ports.js:58` — `@property params ... fuer den HMAC`, seit C-P3 gibt es keinen HMAC-Verifizierer mehr; enthaelt kein "twilio", ausserhalb der Trefferliste.
4. `src/telephony/call-finish.js:141` — Laufzeit-String mit irrefuehrendem Twilio-Trial-Hinweis, korrekt unveraendert (Laufzeit-String, keine Kommentar-Phase), gehoert als Folge-Phasen-Vorschlag in den Report.
5. Abnahme 6 (`gitleaks detect`) nur teilweise pruefbar — `gitleaks` lokal nicht installiert; Ersatzbeleg ueber `git diff` (genau 1 Zeile) erbracht.
6. Kosmetik ohne Wirkung: `failure-reason.js:3-4` beim Umformulieren nicht neu umbrochen, Zeile 4 haengt optisch kurz in der Luft.

## Clean-Code-Audit (s1-s4)

**PASS, blocker: false.** `s1`-`s4` durchweg leer.

Verifiziert per Grep gegen alle `+`-Zeilen des Diffs: ausschliesslich Kommentar-/JSDoc-Zeilen oder Trailing-Inline-Kommentare hinter unveraendertem Code — keine Zeile aktiver Logik, keine Testassertion, kein Selector/Constant/Env-Wert angefasst. Stichproben gegen den tatsaechlichen Branch-Inhalt bestaetigen, dass die neuen Kommentartexte zum Code passen (SPEAK_OUTCOME-Rationale in `answered-by.js`, `gitleaks.toml`-Korrektur deckt sich mit C-P5-Stand in `test/helpers.js`, `place-call-error.test.js`-Kommentar deckt sich mit der Assertion `!body.hint`). Keine C2-Korrektur ist eine Neuregression — alle entfernen tote Twilio-Referenzen oder praezisieren sie. Kein G4 (keine abgeschalteten Sicherungen), kein G9/F4 (kein toter Code beruehrt), kein G25 (keine neuen Magic Numbers), keine neue Duplizierung. Zwei Stellen behalten Twilio bewusst als historische/illustrative Referenz (`ports.js` streamRef-Rationale, `failure-reason.js` CallStatus-Vokabular-Herkunft, `telnyx-inbound.js` AC...-Beispiel) — korrekt, da echte Design-Begruendungen, keine Behauptungen ueber aktuell existierenden Code.

`topTodos`: leer.

## Fix-Runden

Keine — Impl traf beim ersten Durchlauf PASS in beiden Reviews (Safety + Clean-Code), keine Fix-Runde noetig.
</content>
