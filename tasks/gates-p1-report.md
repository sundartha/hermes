# Phase GATES-P1 — SCA-Sackgasse (PAY-19 x2)

- **Spec**: Abschnitt "P1" in `tasks/gates-fix-chain.md`
- **Abnahme**: beide PAY-19-Tests in `test/pay-19-sca-authentication-required.test.js` gruen via `npm run test:gates`; `npm test` = 3295/0; Diff beruehrt `src/` (ein Diff nur an `test/` waere ein Fehlschlag der Phase)
- **Gate**: PASS
- **finalBranch**: `phase/gates-p1-sca-deadend-r2`
- **headCommit**: `306881b`

## 1. Ausgangslage (verifiziert am echten Code)

Rot-Beweis lokal reproduziert: beide PAY-19-Tests scheiterten mit
`actual === expected === '{"type":"Error","own":{}}'`.

Wurzel in `src/billing/stripe.js`:

- `placeHold` schloss mit `assertOk(res, "placeHold")` ab — der Antwort-Body wurde nie gelesen, der Stripe-Fehlercode starb an der Adapter-Grenze.
- `createSubscription` nutzte `assertOkWithDetail`, das den Body als Rohtext las, aber nur `isMissingCustomerDetail` klassifizierte. Der Rohtext landete in `.message`, und `.message` ist bei `Error` nicht enumerierbar — `Object.entries(err)` war deshalb in beiden Faellen `{}`, `constructor.name` in beiden Faellen `"Error"`.
- Zwei parallele Fehlerkoerper-Sichten existierten nebeneinander: `isMissingCustomerDetail(detail)` ueber Rohtext, `isAlreadyCapturedError(errorBody)` ueber geparstes Objekt.
- Praezedenzfall fuer den Fix: `CustomerMissingError` in `src/billing/errors.js` (Muster `LlmUnavailableError`, `src/llm.js`).

Blast-Radius-Pruefung (grep):

- `placeHold` wird produktiv nur aus `placeSetupFeeHold` (`src/onboarding.js`) gerufen; Fehler wird per `throw holdErr` unveraendert weitergereicht.
- Adapter-Tests mit Nicht-2xx auf `placeHold` gab es vorher nicht — nur auf dem `/capture`-Pfad (`test/prov01-*.test.js`).
- `CustomerMissingError` wird ausschliesslich in `startCheckoutWithStaleCustomerHeal` (`src/billing/card-setup.js`) per `instanceof` gefangen, nicht um `ensureCustomer`/`placeHold`.

## 2. Plan (gekuerzt)

**Design-Entscheidung**: dreistufige, gemeinsam fundierte Fehlergrenze im Adapter. Stripe-Fehlercode wird einmal an einer Stelle klassifiziert; `placeHold` steigt von Stufe 1 (`assertOk`) auf Stufe 2 (`assertOkClassified`), `createSubscription` bleibt Stufe 3 (`assertOkWithDetail`) und erbt die Klassifikation.

Verworfene Alternativen:

- `placeHold` einfach auf `assertOkWithDetail` umhaengen: verboten, weil dann der Stripe-Rohkoerper in `.message` in den Worker-/Queue-Pfad propagiert (Regel 4).
- `assertOk` global async machen, alle 8 Aufrufstellen klassifizieren: verworfen — haette `CustomerMissingError` auf sechs weitere Calls ausgeweitet, die einzeln als harmlos haetten inspiziert werden muessen; zusaetzliches Risiko vergessener `await`s auf dem Geld-Pfad.

Keine neuen Dateien (Dateiliste der Phase: `src/billing/stripe.js`, `src/billing/errors.js`, beide bestehend).

Exakte Edits laut Plan:

- `errors.js`: additiv `PaymentAuthenticationRequiredError` (Muster `CustomerMissingError`, `this.name` enumerierbar).
- `stripe.js`: Import erweitert; Konstante `AUTHENTICATION_REQUIRED_CODE` neben bestehenden Fehlercode-Konstanten; `isMissingCustomerDetail` ersatzlos entfernt; `assertOk` behaelt Verhalten, Meldungsbildung wandert in neue `failureMessage()`; neue `readErrorBody()` (liest Body genau einmal, liefert Rohtext + geparste Form) und `billingErrorFor()` (eine Klassifikationsstelle) ersetzen die alte Doppelstruktur; `assertOkClassified` (Stufe 2, ohne Rohkoerper in der Meldung) und `assertOkWithDetail` (Stufe 3, mit Rohkoerper) darauf aufgebaut; `placeHold` ruft neu `await assertOkClassified(...)`.

Bewusst nicht angefasst: `captureHold` (eigener `res.json()`-Pfad), die sechs uebrigen `assertOk`-Aufrufer — Bestandsverhalten, keine Regression dieser Phase.

Tests: keine neue/geaenderte Testdatei (Spec verbietet Testaenderung ausdruecklich; die beiden PAY-19-Tests lagen bereits vor, jeweils mit eingebautem Praezisionsgegenfall generischer Ablehnung).

Pre-Mortem (Auszug): Gate koennte gruen werden ohne Produktaenderung — ausgeschlossen, weil Diff nur `src/` betrifft und an echtem Stripe-Fehlercode verankert ist; Secret-Leak ueber neuen Pfad — ausgeschlossen, `placeHold` bleibt Stufe 2 ohne Rohkoerper; vergessenes `await` wuerde den Wurf verschlucken — einzige neue async-Stelle ist ausgeschrieben und durch Gate-Test abgesichert.

## 3. Implementierungs-Zusammenfassung

Diff ausschliesslich in `src/billing/errors.js` und `src/billing/stripe.js` (+85/-27), keine Testdatei angefasst.

- `errors.js`: `PaymentAuthenticationRequiredError` hinzugefuegt (PAY-19-Kommentar: Stripe liefert bei `authentication_required` off-session kein `next_action`, Ausweg ist neue on-session-Bestaetigung, nicht Retry derselben Belastung).
- `stripe.js`: `AUTHENTICATION_REQUIRED_CODE = "authentication_required"` als benannte Konstante; `isMissingCustomerDetail` entfernt; `failureMessage(op, status, detail)` als eine Quelle des Diagnosetexts; `readErrorBody(res)` liest Body genau einmal (Rohtext + JSON-Parse, fail-safe auf `""`/`{}`); `billingErrorFor(errorBody, message)` bildet Stripe-Fehlercode auf Port-Fehlertyp ab (`authentication_required` -> `PaymentAuthenticationRequiredError`, `resource_missing`+`param=customer` -> `CustomerMissingError`, sonst generischer `Error`); `assertOkClassified` (Stufe 2) und `assertOkWithDetail` (Stufe 3, jetzt auf `readErrorBody`/`billingErrorFor` aufgebaut) ersetzen die alte `assertOkWithDetail`-Implementierung; `placeHold` ruft `await assertOkClassified(res, "placeHold")`.

Ergebnis: beide PAY-19-Tests gruen; `npm run test:gates` von 36 auf 34 rote Gates (exakt die zwei PAY-19-Tests gekippt, kein zuvor gruenes Gate gefallen); `npm test` 3295/0 (isoliert nachgefahren fuer alle Flake-Kandidaten unter Voll-Last).

### Deviations (aus Impl-Report)

1. Worktree lag auf veraltetem Commit (4a59a9b) statt `master` (39ff895) — korrigiert mit `git checkout -b phase/gates-p1-sca-deadend-r2 master`.
2. Symlink-Anleitung im Vorgehen war fuer diesen Pfad selbstreferenziell/tot — durch absoluten Symlink ersetzt, nicht committed.
3. Getrennte pglite-Laeufe existieren in diesem Repo nicht als eigener Befehl — pg-Achse laeuft innerhalb derselben `npm test`-Suite mit.
4. `npm test` flakt unter Voll-Last (parallele Wellen-Agenten): 4 Laeufe mit unterschiedlichen roten Tests, ausnahmslos spawn-/childprocess-basierte Integrationstests (u.a. der bekannte `p5-gate-proof`-Flake); alle betroffenen Dateien isoliert nachgefahren, alle gruen, keine beruehrt `src/billing`.
5. ESLint im Checkout nicht lauffaehig (devDependencies fehlen, `npx` zieht fremde Version) — Umgebungsgrenze, kein Code-Befund.
6. `prettier --check` meldet `stripe.js` unsauber — identisch bereits auf `master` (gegengeprueft); eigene neue Zeilen sind prettier-sauber, fremde Bloecke wurden nicht mit-formatiert (Scope-Regel).

## 4. Safety-Urteil

**approved = true**, alle Kernpruefungen (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`) = true, keine Blocker.

Unabhaengige Verifikation: frischer Worktree, Basis gegen `master` geprueft (kein stale base, 1 Commit ueber master). Regression: 3316 roh / korrigiert 3295/3295/0 fail. Gates: 131/97 pass/34 fail, beide PAY-19-Tests gruen (isoliert 2/2). Gegenprobe gegen `master` (Dateien temporaer zurueckgesetzt): master = 36 fail, Branch = 34 fail, Mengendifferenz = genau die zwei PAY-19-Tests, keine neu roten Gates. Differenz-Probe (20 Fehlerszenarien, master vs. Branch): 19x byte-identisch, 1 Abweichung (s. Concerns). Statisch: `node --check` sauber, kein neuer Log-Output, keine eslint-disable-Marker, keine neue Dependency.

**Verdict**: FREIGABE. Fix sitzt an der Adapter-Grenze, nicht als Umformulierung im Aufrufer. Alle vier absoluten Regeln halten (Safety-Gates unberuehrt, Disclosure unangetastet, kein neuer Endpunkt/Auth-Aenderung, Secret-Key bleibt ausschliesslich im Header).

### Concerns (nicht blockierend)

1. Latente Ausweitung: `placeHold` wirft durch die Vereinheitlichung jetzt auch `CustomerMissingError` bei totem Customer (auf `master` war das generischer `Error`) — empirisch 1 von 20 Szenarien abweichend, Message byte-identisch. Heute folgenlos (einziger `instanceof`-Faenger umschliesst nur Checkout, nie `placeHold`), aber Risiko fuer spaeter, falls der Self-Heal-Pfad um Provisioning erweitert wird. Kommentar in `stripe.js` ("NUR code+param=customer heilt card-setup.js") ist dadurch leicht irrefuehrend geworden.
2. Neuer Fehlertyp hat noch keinen Konsumenten: `onboarding.js` faengt weiterhin nur generisch, wirft weiter; Kunde bekommt noch keine Gelegenheit zur on-session-Bestaetigung. Spec-konform (Dateiliste P1 nennt nur die zwei Dateien), gehoert aber in die Folge-Liste der Kette — sonst gilt PAY-19 faelschlich als vollstaendig erledigt.
3. Vorbestand: `assertOkWithDetail` haengt weiterhin Stripe-Rohkoerper an die Meldung fuer die Bestandspfade (Checkout/Subscription) — landet nur in `console.error`, keine Secrets, keine Regression dieser Phase.
4. `prettier --check` repo-weit nicht gruen (auch auf master, keine Regression).
5. eslint im Worktree nicht ausfuehrbar (Umgebungsgrenze).

## 5. Clean-Code-Audit

- **s1**: keine Befunde.
- **s2**: keine Befunde.
- **s3**: Kommentar-Dichte an `readErrorBody`/`billingErrorFor` hoch, aber konsistent mit etabliertem Dateistil — keine Aenderung noetig.
- **s4**: dreistufige Fehlergrenze fuegt eine dritte kleine Funktion hinzu — sachlich begruendet und im Commit motiviert, nur Struktur-Hinweis.

**blocker = false**. **Verdict**: PASS ohne Blocker. Diff ist ein sauberer, eng geschnittener Wurzelfix: `isMissingCustomerDetail` (Parse-Duplikat) durch `readErrorBody`+`billingErrorFor` ersetzt — Nettoabbau von Duplizierung. Neuer Fehlertyp folgt exakt dem Bestandsmuster `CustomerMissingError`. Named Constant statt Magic-String. `failureMessage()` zentralisiert Diagnosetext, Byte-Identitaet zum Bestand nachgerechnet. Secret-Key bleibt ausschliesslich im Header. Keine abgeschalteten Sicherungen, kein toter Code, keine Verschachtelung > 2. Testfrage explizit geprueft: die beiden SOLL-Tests lagen bereits vor (Commit 874d8af), lokal gegen den Branch gruen verifiziert (vorher rot laut Commit-Historie).

### Top-TODOs (Folgephasen)

1. Keine Blocker fuer diesen engen Scope.
2. Folge-Phase: `onboarding.js`/Worker-Pfad muss `PaymentAuthenticationRequiredError` tatsaechlich auswerten (Kunde benachrichtigen / on-session-Bestaetigung anbieten) — dieser Diff liefert nur die Unterscheidbarkeit an der Adapter-Grenze, keinen Konsumenten.
3. Bei Gelegenheit pruefen, ob `captureHold` auf dieselbe `readErrorBody`/`billingErrorFor`-Basis gehoben werden soll (kein Blocker, unveraendert, ausserhalb des PAY-19-Scopes).

## 6. Fix-Runden

Keine — Plan, Implementierung, Safety-Review und Clean-Code-Audit haben die Phase im ersten Durchlauf mit PASS/FREIGABE abgeschlossen. Keine Fix-Runde noetig.
