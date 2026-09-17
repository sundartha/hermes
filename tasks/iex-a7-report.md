# Phase IEX-A7: Missbrauchs-Limit am Init-Webhook

- **Gate:** PASS
- **finalBranch:** `phase/iex-a7-init-limit`
- **headCommit:** `fd6de40d847c6cfcede57c6554619e92574f7c5b`
- **Basis:** master `37a9a33`

## Plan (gekuerzt)

Ausgangslage: der globale Per-IP-Limiter in `src/app.js#installGlobalMiddleware` nimmt `/voice` und `isTrustedLocalCaller` aus, gilt aber sonst fuer alle Routen inkl. des ElevenLabs-Init-Webhooks (`src/routes/webhooks-elevenlabs-init.js`). Problem: fremde ElevenLabs-Workspaces teilen die Egress-IPs des Anbieters, ein Zaehler ueber ALLE Anfragen einer IP kann also eigene, legitime Init-Anfragen mit sperren (Fremd-DoS).

Loesung laut Plan: eine eigene Vor-Parser-Schranke `initTokenSchranke`, die in `installGlobalMiddleware` VOR `express.urlencoded`/`express.json` und VOR der Loopback-Ausnahme haengt, nur fuer `POST` auf exakt `ELEVENLABS_INIT_PATH`:

- gueltiges Token -> `next()`, wird nie gezaehlt oder gedrosselt
- ungueltiges Token -> je `req.ip` gezaehlt (eigener Fixed-Window-Zaehler, getrennt vom globalen Limiter), 403 (Log wie bisherige Stufe 1) bzw. ab `INIT_FEHLVERSUCHE_PRO_MIN=30`/min 429 mit `Retry-After`, in beiden Faellen ohne Body-Parse und ohne Store-Zugriff
- Drossel-Log hoechstens 1 Zeile je Fenster (`RATE_WINDOW_MS`), ohne IP/Token
- der Init-Router wird `caseSensitive`+`strict`, damit die Menge "erreicht den Handler" exakt der Pfad-Pruefung der Schranke entspricht (schliesst Pfadvarianten-Umgehung wie `/init/`, Grossschreibung)

Geplante Aenderungen: `src/middleware.js` (Export `RATE_WINDOW_MS`/`RATE_SWEEP_INTERVAL_MS`, neue Funktion `respondTooManyRequests` als gemeinsame 429-Quelle fuer globalen Limiter UND neue Schranke), `src/routes/webhooks-elevenlabs-init.js` (`initTokenSchranke`, `istInitWebhookAnfrage`, `INIT_ANTWORT.GEDROSSELT`, `INIT_FEHLVERSUCHE_PRO_MIN`, exakter Router), `src/app.js` (Verdrahtung `makeInitTokenSchranke`), `PLAN-SECURITY.md` (neue Stufe 0, Restrisiken), neuer Test `test/iex-a7-init-limit.test.js` (10 Faelle, davon 2 als Spawn gegen den echten Server), Test-Refactor `test/_iel-inbound-harness.js` + `test/iel-init-webhook.test.js` (geteilte Builder, kein Verhaltenswechsel).

Bewusst NICHT im Scope: keine Env-Variable fuer das Limit, keine Aenderung an `route-policy.js`/`route-auth-inventory` (keine neue Route, nur eine Middleware), keine IPv6-Praefix-Normalisierung (Folgeaufgabe).

Pre-Mortem im Plan behandelte: Fehlalarm bei echtem Verkehr (durch Test 2/9 widerlegt), Pfadform-Bruch nach Deploy (akzeptiert, Rueckweg = 1-Zeilen-Rollback), Missbrauch eines geleakten Tokens (akzeptiert laut Spec E12(1)), lokale Probe/Test landet in 429 (unwahrscheinlich, kein Bestandstest sendet so viele Anfragen), Log-Flut bei IPv6-Rotation (dokumentiertes Restrisiko), Bruch des globalen Limiters durch den `respondTooManyRequests`-Refactor (durch `rate-limit.test.js` unveraendert gruen abgesichert).

## Impl-Zusammenfassung

Umgesetzt wie geplant, Commit `fd6de40` auf `phase/iex-a7-init-limit`. `node --check` fuer alle 6 geaenderten/neuen Dateien OK, `npm test -- --test-concurrency=4`: 5886 pass, 0 fail.

- `initTokenSchranke` (neu, `webhooks-elevenlabs-init.js`) prueft das Token vor jedem Body-Parse. Gueltig -> `next()`, nie gezaehlt. Ungueltig -> je `req.ip` gezaehlt, 403 wie Stufe 1 bisher; ab `INIT_FEHLVERSUCHE_PRO_MIN=30`/Fenster 429 `GEDROSSELT` + `Retry-After`. Kein Store-Zugriff bei 403/429.
- `istInitWebhookAnfrage` prueft exakt `POST` + `ELEVENLABS_INIT_PATH`; der Router ist jetzt `caseSensitive`+`strict`.
- Drossel-Log hoechstens 1 Zeile/Fenster, per injizierbarer Uhr getestet, ohne Timer, ohne IP/Token.
- `src/app.js`: `makeInitTokenSchranke` baut einen eigenen Fixed-Window-Zaehler (Closure je Schranke, nicht modulglobal, P12-I). In `installGlobalMiddleware` greift die Schranke fuer den Init-POST-Pfad VOR dem globalen Limiter, VOR der Loopback-Ausnahme und VOR den Parsern; andere Methoden auf demselben Pfad zaehlt weiter der globale Limiter.
- `src/middleware.js`: `RATE_WINDOW_MS`/`RATE_SWEEP_INTERVAL_MS` exportiert; neue Funktion `respondTooManyRequests` als einzige Quelle der 429-Antwort (globaler Limiter antwortet byte-identisch wie vorher, per `rate-limit.test.js` belegt).
- Test-Refactor: `spawnSeedWartenderElCall`, `elInboundInitSpawnEnv`, `initBindungsKoerper` in `test/_iel-inbound-harness.js` verschoben, von `iel-init-webhook.test.js` genutzt; Bestandstests dort inhaltlich unveraendert, weiter gruen.
- Neuer Test `test/iex-a7-init-limit.test.js`, 10 Faelle (IEX-A7-1..10): Fenster-Grenze, Nicht-Zaehlung gueltiger Tokens, kein Body-Parse bei ungueltigem Token, kein Store-Zugriff bei 403/429, IP-Isolation, Log ohne IP/Token, injizierbare-Uhr-Fensterlogik, Pfadvarianten (in-process), und zwei Spawn-Tests gegen den echten `src/server.js` (globaler Limiter nimmt nur POST aus, gedrosselte IP kann trotzdem binden, Pfadvariante erreicht den Handler nicht).
- `PLAN-SECURITY.md`, Abschnitt IEL-B6: neue Stufe 0, neue Zeilen "Rate-Limit (IEX-A7/E12)" und "Pfadform", drei neue Restrisiken (geleaktes Init-Token, IPv6-Rotation, exakte Pfadform).
- Positiv-Kontrolle per Mutation (danach zurueckgesetzt): Schranke in `app.js` abgeklemmt -> Test 9 rot; Router nicht strikt -> Tests 8/10 rot.

### Deviations

1. **`src/middleware.js`: 429 bleibt Literal statt Konstante `HTTP_TOO_MANY_REQUESTS`.** Plan-Grep `status\(429\)` liefert 1 Treffer statt 0. Grund: der Pre-Commit-Hook `scripts/check-staged-suppressions.js` lehnt jeden Commit ab, der Befunde in `middleware.js` aendert, weil die Datei Eintraege in `eslint-suppressions.json` hat (Rest-Befund `max-params` an `errorHandler`, verursacht durch Express' Vier-Parameter-Pflicht). Ein Eintrag in `eslint-legacy-exceptions.json` braucht Owner-Freigabe, `--no-verify` ist verboten. Die 429-Antwort hat trotzdem genau eine Quelle (`respondTooManyRequests`); ein Kommentar im Code begruendet das. Wird `errorHandler` spaeter umgebaut, kann die Datei geraeumt und die Konstante nachgezogen werden.
2. **Zusaetzliche benannte Testkonstanten** ueber den Plan hinaus (`DROSSELUNGEN_IM_FENSTER=10`, `RETRY_AFTER_ATTRAPPE_S=7`, `VERSAETZE_IM_FENSTER_MS`, `UHR_START_MS`, `LEERES_JSON`, `SPAWN_INIT_TOKEN`), G25-konform. `app.set("env","test")` in der Test-App verhindert Stacktraces im Testlog bei kaputtem JSON.
3. Der Kommentar ueber `makeFixedWindowCounter` ist inhaltlich wie geplant, nur neu umbrochen.

### Smoke

Kein manueller `curl`-Smoke: `node src/server.js` mit Minimal-Env brach beim Boot ab (fehlende Env-Variablen, u.a. `COST_TRUING_REQUIRED_RECORD_TYPES`); den Server mit der vollen `BASE_ENV` der Test-Harness zu starten wurde nicht versucht. Stattdessen pruefen die Spawn-Tests IEX-A7-9/-10 den echten `src/server.js` per HTTP direkt: gueltiges Token ueber dem globalen Limit, 30x403 dann 429, Bindung 200 von der gedrosselten IP, GET wird weiter global gezaehlt, Log ohne IP/Token, Pfadvariante erreicht den Handler nicht. Beide gruen.

## Safety-Urteil

**FREIGABE (approved: true).** Alle Kern-Checks bestanden: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. Keine Blocker.

Unabhaengiger Test in frischem Worktree (Branch `review-iex-a7` von `fd6de40`): gezielter Lauf ueber die betroffenen Dateien mit `--test-concurrency=4` -> 201/201 pass, 0 fail, inkl. beider Spawn-Tests. Danach Spec-Abnahme (`iex-a7-init-limit` + `iel-init-webhook`) erneut: 35/35 pass. Drei Mutationsproben mit Positiv-Kontrolle, danach zurueckgestellt (`git status` leer): Schranke unverdrahtet -> Test 9 rot; Zaehler zaehlt auch gueltige Tokens -> Tests 2/9 rot; Router ohne `caseSensitive`/`strict` -> Tests 8/10 rot. Diff-Pruefung bestaetigt: nur die 5 geplanten Dateien plus Tests geaendert, `claude.js`, `src/elevenlabs/*`, `routes/voice.js`, `route-policy.js`, `package.json`/`package-lock.json` unberuehrt.

**Concerns (nicht blockierend, dokumentiert):**
- Pfadform im Betrieb: Router ist jetzt exakt; weicht die von ElevenLabs tatsaechlich aufgerufene URL ab (z.B. Schraegstrich am Ende), scheitert jede Uebergabe. Fail-safe, in `PLAN-SECURITY.md` mit Erkennungsweg (Owner-Test #2, Log-Zeile `[el-init] gebunden`) eingetragen; vor Rollout live pruefen.
- 403-Log je Anfrage ermoeglicht bei IPv6-Rotation Wachstum von Zaehler-Map und Log; als Folgeaufgabe (/64-Normalisierung) dokumentiert, keine neue Risikoklasse ggue. dem globalen Limiter.
- Geleaktes Init-Token wird am Init-Pfad nicht mehr gedrosselt (Spec E12(1) verlangt das ausdruecklich); Barriere bleibt das Bindungs-Token, Gegenmittel ist Token-Rotation.
- Drossel-Melder hat keinen Timer, "anzahl" kann bei langen Pausen Fenster mischen — reines Diagnose-Artefakt ohne Sicherheitswirkung.
- Router-Exaktheit/POST-only-Ausnahme standen als offener Review-Concern, nicht im urspruenglichen Scope-Absatz — kein Scope-Verstoss, da explizit dieser Phase zugewiesen.

## Clean-Code-Audit (S1-S4)

- **S1:** keine Befunde
- **S2:** keine Befunde
- **S3:** keine Befunde
- **S4:** eine Nennung ohne Verstoss — `respondTooManyRequests` (`src/middleware.js`) ist eine minimale, sauber begruendete G5-Extraktion (2 Zeilen, ein Antwort-Pfad statt zwei), zur Vollstaendigkeit genannt.

**Verdict: PASS, kein Blocker.** Die Schranke sitzt nachweislich vor den Body-Parsern (kein Parse bei ungueltigem Token), greift bei 403/429 nie auf den Store zu, der globale Limiter nimmt exakt `POST` auf dem Init-Pfad aus (GET bleibt gezaehlt). Die 10 neuen Tests sind Build-Operate-Check-sauber, decken Grenzfaelle ab (Fenstergrenze, IP-Isolation, Pfadvarianten, Log-Bereinigung) und laufen in-process wie am echten Spawn-Server. Aktive Entduplizierung: `RATE_WINDOW_MS`/`RATE_SWEEP_INTERVAL_MS`/`respondTooManyRequests` wiederverwendet statt kopiert, Test-Setup-Code in den Harness gezogen statt dupliziert. `PLAN-SECURITY.md` konsistent fortgeschrieben. `trust proxy`-Reihenfolge bereits vor diesem Diff korrekt, `req.ip` in der neuen Schranke also zuverlaessig. F1 (max. 3 Argumente) durchgehend per Options-Objekt eingehalten, keine Magic Numbers ohne benannte Konstante, keine deaktivierten Sicherungen, kein toter Code.

**Optionale, nicht blockierende Folgeaufgaben:**
- Zaehler-Schluessel auf /64-IPv6-Praefix normalisieren, fuer globalen Limiter und Init-Schranke an einer Stelle.
- Rotationsmechanismus fuer das Init-Token (`iel-geheimnisse.mjs`) als aktives Gegenmittel zum akzeptierten Leak-Risiko routinemaessig einplanen.

## Fix-Runden

Keine — Safety, Clean-Code und ein separater Security-Review liefen alle direkt auf PASS/FREIGABE ohne Fund, der eine Fix-Runde ausgeloest hat. Der Security-Review (separat vom Safety-Urteil oben) bestaetigte zusaetzlich: keine neue Route, `route-auth-inventory` gruen, timing-sicherer Tokenvergleich (`safeEqual`) unveraendert genutzt, keine neue Dependency, keine neue Env-Variable, Restrisiken (Token-Leck, IPv6-Rotation, exakte URL-Form) in `PLAN-SECURITY.md` als akzeptiert eingetragen.
