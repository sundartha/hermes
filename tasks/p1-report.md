# Phasenbericht P1 — Sicht und Deploy-Wahrheit

**Scope:** GAP-36 (Deploy-Wahrheit: Commit + Config-Fingerabdruck), GAP-35 (Ablehnungs-Metrik nach Land/Sprache). Nur diese beiden IDs.

**Basis:** `master` @ `412da5d`
**finalBranch:** `phase/i18n-p1-sicht-deploy-wahrheit`
**headCommit:** `d283475` (Kurzform; Impl-Report nennt `d2834756d0aea5071f57842c32aa55ce69977fbd`)
**Gate:** **PASS** (Safety FREIGABE, Clean-Code PASS, keine S1/S2)

---

## 1. Plan (gekuerzt)

Acht Entwurfsentscheidungen (D1–D8) vorab:

- **D1**: `configHash` = sha256 ueber genau fuenf Achsen (`allowedCountryCodes`, `maxCallsPerHour`, `budgetMonthEnabled`, `multiTenant`, `paymentCurrency`), fixe Reihenfolge, `|`-Separator — `/healthz` ist unauthentifiziert, deshalb nie Rohwerte.
- **D2**: `RENDER_GIT_COMMIT` wandert nach `src/config.js` (`config.server.deployedCommit`) statt direkt aus `process.env` — Konvention aus CLAUDE.md; danach nur noch ein einziger `process.env.`-Zugriff ausserhalb config.js (`GATEWAY_URL` in boot.js).
- **D3**: Denial-Ereignis traegt `country`/`language` des TENANTS, nicht des Ziels — es gibt keine E.164→ISO-Abbildung; eine aus der Zielvorwahl abgeleitete Landangabe waere ein Rufnummern-Fragment im Log.
- **D4**: `language` = `tenant.defaultLanguage`, nicht `store.resolveCallLanguage` — letzteres legt via `settingsFor`/`||=` lazy einen Settings-Bucket an; bei unaufgeloester `tenantId` (outbound_frozen feuert vor resolve_identity) waere das Muell im Store. `tenantGeo` liefert beide Achsen aus einer reinen Query.
- **D5**: Ereignis feuert exakt dort, wo heute `audit()` feuert (eine Senke in `routes/api-calls.js`), nie in den Gates — Gate-Kette bleibt rein.
- **D6**: Neuer Helper `denialAudit(grund, ctx, detailSuffix)` in `outbound-gates.js` — sonst stuende `grund` je Gate zweimal im Code (String + Feld, G5/S2); `detail`-Strings bleiben byte-identisch (durch Bestandssuite gepinnt).
- **D7**: `test/prod-env.js` inhaltlich nicht angefasst (kein Verschieben von `BUDGET_MONTH_ENABLED`/`METRICS_ENABLED` nach `LIVE_MEASURED`) — das ist O1-Buchhaltung fuer andere Phasen (P6/P7); nur der stale gewordene Kommentar wird korrigiert.
- **D8**: Abweichung von Gegenmassnahme 1 ("Ziffernfolgen ≥7 verboten") fuer `configHash`/`commit` — 64-stellige Hex-Hashes und 40-stellige Git-SHAs enthalten statistisch fast immer sieben Ziffern in Folge; Ersatzpruefung staerker: Keys-Whitelist per `deepEqual`, Format-Pin, Spawn mit markierten Rohwerten die nicht im Hex-Alphabet liegen (`+49`, `+33`, `sk_`, `leakcanary`, `eur`).

**Neue Datei:** `src/config-fingerprint.js` (~25 Zeilen) — `configFingerprint(config)`, reine Funktion, config als Argument (DIP, unit-testbar ohne Env), `node:crypto` (Builtin, keine neue Dependency).

**Edits (Plan-Abschnitt 2):**
1. `src/config.js` — `deployedCommit` als neues Blatt (Sentinel `DEPLOYED_COMMIT_UNKNOWN = "unbekannt"`), Namespace `server` erweitert.
2. `src/app.js` — `/healthz` liefert `{ok, commit, configHash}` statt nur `{ok:true}`.
3. `src/boot.js` — Boot-Banner druckt Commit (entfristet aus TEMP-DIAGNOSE) + configHash + neue Zeile `Budget-Achse:` (`budgetAxisLabel`-Helper).
4. `src/metrics.js` — neue Funktion `logCallDenied({grund, country, language})`, Whitelist-Payload, schweigt bei `enabled=false`.
5. `src/telephony/outbound-gates.js` — Konstante `PLACE_CALL_DENIED_EVENT` + Helper `denialAudit(grund, ctx, detailSuffix)`, ersetzt 11 Aufrufstellen (Detailtext byte-identisch, Grund jetzt strukturell einmalig).
6. `src/routes/api-calls.js` — neue `denialDimensions(grund, tenantId)`-Funktion, ruft `metrics.logCallDenied` an derselben Stelle wie das bestehende `audit()`.
7. Store-Fassade: `tenantGeo`-Leser fehlte (nur `setTenantGeo` vorhanden) — Wrapper ergaenzt in `store/json.js`, `store/pg.js`, `store.js`.
8. `render.yaml` — `METRICS_ENABLED` von `false` auf `true` (mit Betriebsauflagen-Kommentar: Dashboard-managed, Blueprint-Wert schaltet live nichts scharf).
9. `.env.example` — zwei Doku-Ergaenzungen (keine Wertaenderung).
10. `test/helpers.js` — `RENDER_GIT_COMMIT: ""` in BASE_ENV (Lehre `test-base-env-drift`).
11. `test/config-namespaces.test.js` — Counts nachgezogen (server 7→8, EXPECTED_TOTAL_KEYS 124→125).
12. `test/prod-env.js` — nur Kommentar zu `BUDGET_MONTH_ENABLED` aktualisiert.

**Tests (Plan-Abschnitt 3):** Beide Katalogtestdateien (`test/gap-36-healthz-fingerprint.test.js`, `test/gap-35-metrics-country.test.js`) erweitert und praefixfrei umbenannt (ID nicht mehr am Namensanfang → wandern laut `config.i18nCatalogPattern` in die Regressionssuite). 6 Tests je Datei (1–2 bestehend umbenannt + 4–5 neu). Bestandssuite (`outbound-gates-order.test.js`, `deny-diagnosability.test.js`, `store-backend-parity.test.js`, `auth-gate-exemption-order.test.js`) bleibt unveraendert gruen als Beweis der Verhaltenserhaltung.

**Erwartetes Ergebnis laut Plan:** `npm test` gruen (Baseline+12), `npm run test:gates` von `114/29/85` auf `111/29/82` (3 Katalog-Blaetter wandern aus dem Gate-Lauf in die Regressionssuite), lokaler Smoke mit exakt `{"ok":true,"commit":"unbekannt","configHash":"<64 hex>"}`.

**Blast-Radius (Plan-Abschnitt 5):** 9 Produktionsdateien beruehrt. Kein Safety-Gate, kein Disclosure-, Auth- oder Audio-Pfad beruehrt. Getragenes Risiko: unbekannte neue Log-Last durch `METRICS_ENABLED=true`. Bewusst nicht in dieser Phase: GAP-21, `LIVE_MEASURED`-Buchhaltung (P6/P7), `MULTI_TENANT`/`SELF_SERVICE_ENABLED`-Divergenz (GAP-33/P7).

---

## 2. Implementierungs-Zusammenfassung

Plan-konform umgesetzt: neues `src/config-fingerprint.js` (sha256 ueber 5 Achsen), `/healthz` liefert `{ok, commit, configHash}`, Boot-Banner druckt Commit+configHash+Budget-Achse (TEMP-DIAGNOSE entfristet), `src/metrics.js` bekommt `logCallDenied` (PII-frei: grund/country/language), `src/telephony/outbound-gates.js` buendelt alle 11 Denial-Audits ueber `denialAudit`, `routes/api-calls.js` loggt das Ereignis an der bestehenden Audit-Senke ueber die neue `store.tenantGeo`-Fassade, `render.yaml`/`.env.example` dokumentieren `METRICS_ENABLED=true` fuer Mehr-Laender-Betrieb, `test/helpers.js` pinnt `RENDER_GIT_COMMIT` neutral.

**Ergebnis:** `npm test` 2952/2952 gruen; `npm run test:gates` exakt `korrigiert: tests 111 / pass 29 / fail 82` — wie vom Plan vorhergesagt (53→51 offene Rot-IDs).

**Dateien erstellt:** `src/config-fingerprint.js`

**Dateien editiert (17):** `.env.example`, `render.yaml`, `src/app.js`, `src/boot.js`, `src/config.js`, `src/metrics.js`, `src/routes/api-calls.js`, `src/store.js`, `src/store/json.js`, `src/store/pg.js`, `src/telephony/outbound-gates.js`, `test/config-namespaces.test.js`, `test/gap-35-metrics-country.test.js`, `test/gap-36-healthz-fingerprint.test.js`, `test/helpers.js`, `test/prod-env.js`, `test/security.test.js`

### Deviations vom Plan

1. **`test/security.test.js`** musste angepasst werden (healthz-Shape-Pin `{ok:true}` → `body.ok===true`), da GAP-36 die `/healthz`-Antwort bewusst um `commit`/`configHash` erweitert — im Plan als Konsequenz von D8/Abschnitt 2.2 angelegt, aber nicht explizit als zu aendernde Testdatei benannt.
2. **`test/config-namespaces.test.js`** hatte einen zweiten hartkodierten Zaehler (`checked===116` statt nur `EXPECTED_TOTAL_KEYS`), den der Plan nicht erwaehnte — auf 117 nachgezogen (`deployedCommit` ist das 117. primitive Blatt).
3. Ein einmaliger Fehlschlag von `test/audit.test.js` unter `npm run test:gates`/vollem Lauf war der bekannte, vorbestehende Suite-Flake (Lehre `suite-flake-p5-gate-proof`, Spawn-Race unter Volllast) — isoliert und im Re-Lauf gruen, keine Regression aus dieser Phase.

**Smoke:** Lokaler Server (`SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Secrets) gestartet: `GET /healthz` lieferte exakt `{ok:true, commit:'unbekannt', configHash:'<64 hex>'}`; Boot-Log zeigte `[boot] deployed commit=unbekannt`, `[boot] configHash=<derselbe 64-hex-Wert>` und `Budget-Achse:   Lebenszeit-Topf (BUDGET_MONTH_ENABLED=false)` — configHash aus `/healthz` und Boot-Log identisch.

---

## 3. Safety-Urteil (final)

**Verdikt: FREIGABE** (`approved: true`). Alle absoluten Regeln gehalten: Safety-Gate-Kette nur refactored (elf Audit-Details byte-identisch verifiziert, Reihenfolge/Gate-Bestand unveraendert), Offenlegungssatz nicht beruehrt, Auth fail-closed am laufenden Server nachgewiesen, kein Secret/PII im neuen Log oder in `/healthz`, kein neuer npm-Dep, Scope exakt die zwei Spec-IDs plus der im Plan verlangte Boot-Banner-Zusatz.

**Eigene Laeufe (unabhaengiger Reviewer, frischer Worktree):** Regression 2952/2952 gruen (master-Baseline im selben Worktree 2940/2940, Delta +12 = genau die neuen Katalogtests). Gates-Lauf: 111/29/82 vs. Baseline-master 114/29/85; Failure-Set-Diff exakt die drei Zieltests, kein anderer Katalogtest wechselt Status.

**Concerns (keine Blocker), sieben insgesamt:**

1. **configHash ist ungesalzen** (sha256 ueber 5 niedrig-entropische Achsen, Suchraum ~10^6–10^7) — auf dem unauthentifizierten `/healthz` offline in Sekunden invertierbar. Pre-Mortem-1-Gegenmassnahme ("Hash statt Rohwert") ist damit Verschleierung, keine Vertraulichkeit. Spec-konform, aber Owner-Entscheidung empfohlen: HMAC-SHA256 mit stabilem Server-Secret wuerde die Enumerierbarkeit nehmen (`src/config-fingerprint.js:23-28`).
2. `/healthz` gibt ab jetzt dauerhaft und unauthentifiziert den deployten Git-SHA aus — spec-gewollt, Repo privat, geringe Auswirkung.
3. `denialDimensions()` wird EAGER ausgewertet (`store.tenantGeo()` laeuft auf jedem auditierten Deny, auch bei `METRICS_ENABLED=false`). Extern byte-identisch (reine Query), aber die "Flag aus = passiert nichts"-Eigenschaft haengt jetzt an der Nebenwirkungsfreiheit von `tenantGeo`. Billige Haertung: Aufruf hinter das enabled-Gate ziehen.
4. Neuer pg-Wrapper `store/pg.js:460` (`tenantGeo`) hat keine eigene Testabdeckung — nur json ist E2E belegt.
5. `test/security.test.js` von `assert.deepEqual(body, {ok:true})` auf `assert.equal(body.ok, true)` gelockert; die Leck-erkennende Schluesselmengen-Invariante lebt jetzt nur noch in `gap-36-healthz-fingerprint.test.js`.
6. Betriebsauflagen aus der Spec-Abnahme offen und nicht code-erzwingbar: `METRICS_ENABLED=true` im Render-Dashboard, Post-Deploy-curl gegen Live-`/healthz`.
7. `test/prod-env.js`: `METRICS_ENABLED` wandert (noch) nicht nach `LIVE_MEASURED`; `BUDGET_MONTH_ENABLED` bleibt in `LIVE_UNMEASURED` mit Verweis auf P6/P7 — bewusst deferriert.

---

## 4. Clean-Code-Audit (S1–S4)

**Verdikt: PASS.** Keine S1/S2/S3/S4-Befunde (alle vier Kategorien leer).

Notizen (Auszug):
- P4/DIP sauber: `configFingerprint(config)` nimmt config als Argument statt Singleton-Import.
- G5 (Duplizierung) aktiv beseitigt: `denialAudit()` fasst vorher 8x wiederholte Bauform zusammen, inkl. `PLACE_CALL_DENIED_EVENT`-Konstante statt Literal (G25).
- G25: `AXIS_SEPARATOR` benannte Konstante, `DEPLOYED_COMMIT_UNKNOWN` exportierter Sentinel.
- P16/Nebenlaeufigkeit: `/healthz`-Hash pro Request neu berechnet statt gecacht — bewusst gegen Lazy-Init-Antipattern begruendet.
- Absolute Regel 4 durchgaengig: `configFingerprint` haesht nur 5 nicht-geheime Achsen, `logCallDenied` whitelisted exakt `{grund, country, language}` und verwirft PII — durch eigenen Test bewiesen inkl. E2E.
- P1 (Tests): jede Verhaltensaenderung hat einen Test; `store.tenantGeo`-Re-Export parallel in json.js und pg.js nachgezogen (Backend-Paritaet).
- G11: `store.js`-Re-Export folgt demselben Muster wie `tenantStripe`/`bootstrapTenant`.
- Pin-Tests (`CONFIG_NAMESPACES`/`EXPECTED_TOTAL_KEYS`) korrekt auf 125/117 nachgezogen.
- `render.yaml`-Aenderung korrekt mit Betriebsauflage kommentiert.

**topTodos** (kosmetisch, keine Blocker):
1. `pg.js`-tenantGeo-Wrapper koennte langfristig denselben Doku-Kommentar-Stil wie `json.js` tragen (aktuell knapper) — nur Konsistenz-Hinweis.
2. Vor Deploy pruefen, dass die `render.yaml`-Aenderung (`METRICS_ENABLED=true`) auch im Dashboard-managed Live-Service nachgezogen wird.

---

## 5. Fix-Runden

Keine. Der Impl-Report und beide Reviews (Safety, Clean-Code) kamen im ersten Durchlauf zu `PASS`/`FREIGABE`. Es gab keinen `=== FIXES ===`-Block mit Inhalt — Abschnitt in der Quelle ist leer.

---

## 6. Offene Punkte fuer Folgephasen (aus Plan Abschnitt 5 + Safety-Concerns)

- HMAC statt ungesalzenem sha256 fuer `configHash` erwaegen (Owner-Entscheidung ausstehend).
- `denialDimensions()`/`tenantGeo`-Aufruf hinter das `enabled`-Gate ziehen (billige Haertung).
- pg-Backend-Testabdeckung fuer `tenantGeo` in einem echten Denial-Pfad ergaenzen.
- Betriebsauflage: `METRICS_ENABLED=true` im Render-Dashboard setzen (Blueprint-Wert allein schaltet nichts scharf) + Post-Deploy-curl gegen Live-`/healthz` (Commit muss exakt dem gepushten Upstream-SHA entsprechen).
- GAP-21 folgt in P2 (bewusst nicht in P1).
- `LIVE_MEASURED`-Uebernahme von `BUDGET_MONTH_ENABLED`/`METRICS_ENABLED` gehoert zu P6/P7 (O1-Buchhaltung).
- O13: Rechtstexte bestellen (externer Vorlauf, keine Code-Aenderung).
