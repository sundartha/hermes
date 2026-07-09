# Phase C Report — FAILED/BLOCKED-Status sichtbar machen

**Datum:** 2026-07-09
**Gate:** PASS
**finalBranch:** `fix/voucher-setup-fee-gap-c`
**headCommit:** `729131c`
**Basis:** `master`

## 1. Scope

`numberStatusFor` (`src/store/views.js`) + Frontend-Mapping (`apps/web/src/lib/api.js`, `public/tenant.html`) um einen `FAILED`-Zweig ergaenzen, statt stillem Rueckfall auf "keine Nummer". Kein neuer Retry-Mechanismus — `POST /api/onboard/retry` bleibt unveraendert (Owner-only). Kontext: PLAN-VOUCHER-SETUP-FEE-GAP.md, Vorlaeuferphase des Voucher/Setup-Fee-Gap-Fixes.

## 2. Plan (gekuerzt)

### Vorab-Befunde (code-gegroundet)

1. **`BLOCKED` fehlte im Frontend-Spiegel — bereits vor Phase C rot.** `apps/web/test/api.test.js` hat einen Drift-Guard-Test, der `apps/web/src/lib/api.js`s `NUMBER_STATUS`-Enum gegen `src/store/views.js`s `NUMBER_DISPLAY_STATUS` prueft. Seit Fix B (Provisioning-Cap, `a47ff12`/`90a1ed0`) hat `NUMBER_DISPLAY_STATUS` einen `BLOCKED`-Wert, der Frontend-Spiegel wurde nie nachgezogen — dieser Test war auf `master` bereits rot, unabhaengig von Phase C. Da derselbe Enum editiert wird, wurde `BLOCKED` im selben Edit mitbehoben (kein Extra-Scope).
2. Backend kannte `BLOCKED` bereits (Fix B); der einzige echte Backend-Gap war `FAILED`.
3. `public/tenant.html` ist in Produktion effektiv unerreichbar (`WEB_DIST_DIR` gesetzt → 302 auf `/app`, bewiesen durch `test/single-origin-serving.test.js`). Trotzdem editiert (Task nennt die Datei explizit), praktischer Impact als gering markiert.
4. `isNumberProvisioning`/`NUMBER_STATUS`/`agentInfo` werden nur von `AgentChip.astro` konsumiert (grep-verifiziert) — Plan-Scope musste daher zwingend auch diese Datei anfassen, obwohl der Task-Titel sie nicht nennt.
5. `FAILED`-Nummern zaehlen laut `occupiesCapacity` (`state-ops.js`) nicht gegen die Caps. Ein Retry legt eine **neue** Nummer an, die alte `FAILED`-Zeile bleibt liegen → Pruefreihenfolge in `numberStatusFor`: `FAILED` nach `ACTIVE/PROVISIONING/REQUESTED`, aber vor dem `BLOCKED`-Skip-Marker (reale, wenn auch gescheiterte, Nummer schlaegt den reinen Tenant-Flag — analog Invariante 3 aus Fix B).
6. Kein automatischer Retry fuer `FAILED` (nur `reconcileOrphanedProvisioning` fuer den Crash-zwischen-Enqueue-und-Drain-Fall). Hinweistexte duerfen daher keine Automatik behaupten.

### Geplante Aenderungen je Datei

- **`src/store/views.js`**: `NUMBER_DISPLAY_STATUS.FAILED = "failed"` (zwischen `REQUESTED` und `BLOCKED`); `numberStatusFor` prueft `FAILED` nach `REQUESTED`, vor dem `BLOCKED`-Skip-Marker.
- **`apps/web/src/lib/api.js`**: `NUMBER_STATUS`-Spiegel um `FAILED`+`BLOCKED` vervollstaendigt; neue reine Funktion `numberPlaceholderText(data)` als einzige Quelle fuer Chip-Platzhaltertexte (`Setting up your number…`, `Number setup failed`, `Number setup delayed — capacity limit reached`, `No number assigned yet`).
- **`apps/web/src/components/app/AgentChip.astro`**: nutzt `numberPlaceholderText` statt der alten inline `NO_NUMBER_TEXT`/`SETTING_UP_TEXT`-Konstanten (einziger Consumer, s. Befund 4).
- **`public/tenant.html`**: neue Helferfunktion `agentNumberText(agent)` mit eigenen String-Literalen (kein Modul-Import in statischem HTML moeglich); nur `failed`/`blocked` behandelt, `requested`/`provisioning` bleiben bewusst im generischen Fallback (separater, hier nicht behobener Gap).
- **Tests**: `test/number-status-view.test.js` (+3 Faelle), `apps/web/test/api.test.js` (+1 Fall), neu `test/fixc-number-status-visibility.test.js` (pinnt `tenant.html`-Verdrahtung per Rohtext-Assertion, da kein JS-Ausfuehrungs-Harness existiert).

### Nicht im Scope

Kein neuer Retry-Button/-Endpoint; `public/index.html` unangetastet (kein `numberStatus`-Bezug); `requested`/`provisioning`-Sichtbarkeit in `tenant.html` unveraendert; zwei unrelated Pre-Existing-Fails in `apps/web`-Suite (`/favicon.ico`, "so-funktionierts"-Chrome-Marker) nicht Teil dieser Phase.

### Offener Punkt

Wortlaut der Hinweistexte ist ein Vorschlag (Tabelle Englisch/Deutsch im Plan), bewusst ohne Kontakt-Mail und ohne Automatik-Behauptung — als Produktentscheidung markiert, nicht als Code-Ableitung.

## 3. Implementierung — Zusammenfassung

Exakt gemaess Plan umgesetzt auf Branch `fix/voucher-setup-fee-gap-c` (Basis `master`), Commit `729131c`.

- `src/store/views.js`: `NUMBER_DISPLAY_STATUS.FAILED` ergaenzt; `numberStatusFor` prueft `FAILED` nach `REQUESTED`/vor `BLOCKED`.
- `apps/web/src/lib/api.js`: `NUMBER_STATUS`-Spiegel um `FAILED`+`BLOCKED` vervollstaendigt (behebt zugleich den bereits vor Phase C roten Drift-Test); neue reine Funktion `numberPlaceholderText`.
- `AgentChip.astro`: nutzt `numberPlaceholderText` statt alter inline-Konstanten (die entfernt wurden).
- `public/tenant.html`: analoge `agentNumberText`-Helferfunktion, eigene Text-Literale (gleiches Muster wie bestehende `msg.err`-Texte).
- Kein neuer Retry-Mechanismus; `POST /api/onboard/retry` unveraendert.

**Geaenderte Dateien (6):** `src/store/views.js`, `apps/web/src/lib/api.js`, `apps/web/src/components/app/AgentChip.astro`, `public/tenant.html`, `test/number-status-view.test.js`, `apps/web/test/api.test.js`
**Neue Datei (1):** `test/fixc-number-status-visibility.test.js`

### Tests

- Root `npm test` (JSON + PG via pglite, ein Lauf): **1922 pass / 0 fail** (1918 Baseline + 3 neue Faelle `number-status-view.test.js` + 1 neuer `fixc-number-status-visibility.test.js`).
- `apps/web`-Suite: **84 Tests, 82 pass, 2 fail** — beide Fails vorab als unrelated/pre-existing dokumentiert (`/favicon.ico` toter Link, "so-funktionierts"-Chrome-Marker); NUMBER_STATUS-Drift-Test jetzt gruen (war vor dem Fix rot).
- Summe (`testPassCount`/`testFailCount` aus IMPL): **2004 pass, 2 fail** (beide Fails vorab dokumentiert, unrelated).
- `node --check` auf allen 5 geaenderten/neuen `.js`-Dateien: exit 0.

### Deviations

1. **Smoke — HTTP-Roundtrip nicht durchgefuehrt:** Voller authentifizierter `/api/self-service/state`-Roundtrip fuer `failed`/`blocked` nicht ueber HTTP durchexerziert, weil `SELF_SERVICE_ENABLED` laut `src/config.js` `SESSION_SECRET` + `STORE_BACKEND=pg` voraussetzt (Aufwand ueber "best-effort" hinaus). Ersatz: `numberStatusFor()` und `numberPlaceholderText()` direkt aus den echten Produktionsdateien gegen einen frisch geseedeten Store aufgerufen → korrekt `'failed'` bzw. die erwarteten Hinweistexte.
2. **Umgebungs-Setup fuer Verifikation:** Die vorgeschriebene selbstreferenzielle `node_modules`-Symlink (`ln -s "./node_modules" node_modules`) verursacht in diesem Worktree `spawn ELOOP` bei jedem npm/npx-Kindprozess (`npm test` selbst UND `apps/web/test/pages.test.js`+`links.test.js`, die intern `npx astro build` spawnen). Fuer die Verifikation wurde der Root-Symlink lokal auf ein gueltiges Ziel korrigiert sowie zusaetzlich `apps/web/node_modules` verlinkt, `node_modules/.vite` einmal geleert (wie im Plan-Baseline-Befehl vorgesehen). Beides ausserhalb des Commits — am Ende ist `node_modules` root wieder funktionierend aber nicht mehr selbstreferenziell, `apps/web/node_modules` entfernt; `git status` vor dem Commit war clean bis auf die 7 beabsichtigten Dateien.

### Smoke

`smokePass=true` (mit expliziter Deviation, s.o.). Server bootet lokal sauber (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true` + Dummy-Env + bootstrap-tenant, `/healthz` → 200). Ersatz-Smoke: `numberStatusFor()`/`numberPlaceholderText()` direkt gegen einen real geseedeten Store aufgerufen — beide liefern korrekt `'failed'` bzw. die erwarteten Texte.

## 4. Safety-Urteil (final)

**approved: true**

| Kriterium | Ergebnis |
|---|---|
| testsPassIndependently | true |
| safetyGatesIntact | true |
| disclosureIntact | true |
| authFailClosedIntact | true |
| noSecretsLeaked | true |
| scopeRespected | true |
| behaviorAsIntended | true |

**Independent-Test-Summary:** Root `npm test` (JSON+PG via pglite, ein Lauf): 1922 Tests; 2. Durchlauf 1922/1922 gruen; 1. Durchlauf 1 Fail in `test/voice-status-lifecycle.test.js` (Diagnose-Log-Race, Datei nicht im Diff) — 3x isoliert gruen reproduziert, als praeexistenter Flake klassifiziert, unabhaengig vom Branch verifiziert. `apps/web` (`node --test --test-concurrency=1`): 84 Tests, 82 pass / 2 fail — beide Fails 1:1 auf `master` mit identischem Setup reproduziert (praeexistent, Build-Artefakt-/Env-bedingt). Neue Tests isoliert 12/12 bzw. 19/19 gruen.

**Concerns (kein Blocker):**
1. Plan-Wortlaut nennt "sichtbarer Fehler + Retry-Hinweis"; umgesetzt wurde nur der Fehler-Text, bewusst ohne neuen Retry-Affordance (Self-Service-Tenant haette ohnehin keinen Zugriff auf den Owner-only Retry-Endpoint). Produkt-Notiz, kein Safety-Blocker.
2. Die 2 vorbestehenden `apps/web`-Testfehler (`favicon.ico`/`sandal_solid.png`) sind nicht Teil dieser Phase, sollten aber unabhaengig nachverfolgt werden.

**Verdict:** APPROVED. Diff ist exakt Phase C: 7 Dateien, ausschliesslich fuer FAILED/BLOCKED-Sichtbarkeit. Keine Aenderung an `src/claude.js`, `src/bridge.js` (Disclosure), `src/onboarding.js`/`state-ops.js`/Billing (Safety-Gates), `src/auth.js`/`web-auth.js`/`middleware.js`/`server.js` (Auth), `package.json`/`.env.example` (keine neuen Deps/Env). `NUMBER_STATUS.FAILED` existierte bereits intern (`failNumber`-Aufrufe unveraendert) — diese Phase macht nur einen bisher stumm auf `'none'` fallenden Zustand sichtbar, additiv. Prioritaets-Invariante konsistent mit Fix-B-Muster, dediziert getestet. Frontend nutzt durchgehend `textContent` (kein XSS-Risiko), keine neuen Fetches/Endpunkte. Beide Backends im selben `npm test`-Lauf gruen; einzige Fails verifiziert praeexistent.

## 5. Clean-Code-Audit (final)

**blocker: false** — **verdict: PASS**, keine S1/S2-Verstoesse.

- **S1 (kritisch):** keine
- **S2 (hoch):** keine
- **S3 (mittel):** 1 Fund — `apps/web/src/lib/api.js:180-183`: leichte Namenskonvention-Inkonsistenz bei den vier Platzhalter-Konstanten (`NUMBER_TEXT_SETTING_UP` vs. `NUMBER_TEXT_SETUP_FAILED`/`NUMBER_TEXT_SETUP_BLOCKED` — mal "SETTING_UP", mal "SETUP_*"-Praefix). Vorschlag: einheitlich `NUMBER_TEXT_SETUP_PENDING`/`_FAILED`/`_BLOCKED`. Kosmetisch, kein Handlungsdruck.
- **S4 (niedrig):** keine

**Top-Todos:** kein Blocker; optional Produkt-Hinweis (Plan nennt Retry-Hinweis, umgesetzt ist nur der Fehlertext — konsistent mit fehlendem Self-Service-Retry-Pfad); optional Namenskonvention vereinheitlichen (s. S3).

**Pass-Notes (Auszug):** Scope = die 7 geaenderten Dateien des Diffs `master..fix/voucher-setup-fee-gap-c`. Korrektheit verifiziert (nicht nur gelesen): `npm test` auf dem Branch-Worktree komplett gruen (1922/1922, inkl. der 5 neuen Backend-Tests); `apps/web/test/api.test.js` separat 19/19 gruen (inkl. Drift-Guard). Cap-Prioritaets-Tests konsistent mit bestehender `liveNumbers()`/`occupiesCapacity()`-Logik (Fix B) verifiziert. Qualitativ sauber: keine toten Funktionen (`isNumberProvisioning` bleibt genutzt, alte `AgentChip.astro`-Konstanten korrekt entfernt statt liegengelassen), keine deaktivierten Sicherungen, keine Magic Numbers, Kommentare aktuell/praezise, Funktionen klein/pure/ein Argument. Geprueft und fuer gerechtfertigt befunden: `public/tenant.html` hat eine eigene `agentNumberText()`-Funktion mit derselben Fallunterscheidung wie `api.js`s `numberPlaceholderText()` — auf den ersten Blick G5-Duplizierung, aber beide Dateien gehoeren zu unterschiedlichen, getrennt deployten Apps ohne gemeinsames Modul-/Bundler-System; eine echte Extraktion wuerde neue Build-Infrastruktur voraussetzen und den Scope sprengen. Im Code dokumentiert, folgt bestehender Datei-Konvention (rohe Status-Strings).

## 6. Fix-Runden

**Keine.** Der Diff erreichte auf Anhieb PASS in beiden finalen Reviews (Safety + Clean-Code) — kein S1/S2-Blocker gefunden, keine Fix-Runde noetig. `=== FIXES ===`-Abschnitt der Quelle ist leer.

## 7. Referenzen

- Plan-Quelle: siehe `=== PLAN ===` in der Task-Uebergabe (vollstaendige Original-Version mit Code-Diffs und Test-Snippets)
- Kontext-Strategiedokument: `PLAN-VOUCHER-SETUP-FEE-GAP.md` (Owner-Voucher-Gap, Phase C ist eine Vorlaeuferphase daraus)
- Branch: `fix/voucher-setup-fee-gap-c`, headCommit `729131c`
