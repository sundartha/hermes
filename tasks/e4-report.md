# Phase E4 — Mandantentrennung (Flag-Kurzschluss raus, Scoping unbedingt)

**Gate: PASS**
**finalBranch:** `phase/openai-e4-mandantentrennung`
**Basis:** `master` @ b901f4a, Commit: `398f6e6c2acdb7a7b7fdf60bc0a6df6f6d2fe06d` (ein Commit)

## Ziel

Die Mandantengrenze (Tenant-Scoping) hing bisher am Env-Flag `MULTI_TENANT`: war es aus, liefen alle Lesepfade (`/api/state`, `/api/calls/:id`, `callVisibleTo`) auf den Bootstrap-Tenant durch, ohne echte Trennung, und der `requestTenant`-Resolver hatte einen Kurzschluss `if (!config.tenancy.multiTenant) return operatorChannelTenant(req)`. E4 entfernt diesen Kurzschluss und macht das Scoping in allen Umgebungen unbedingt — eine Semantik statt zweier. `MULTI_TENANT` steuert danach nur noch `isSelfServiceLive`, keine Sicherheitsgrenze mehr.

## Plan (gekürzt)

Gegengeprüfte Zwangspunkte vor dem Bau (nachgezählt, nicht aus der Spec übernommen): `ROUTE_FINGERPRINT`=66, `EXPECTED_TOTAL_KEYS`=199, `EXPECTED_PRIMITIVE_LEAVES`=185, `grep multiTenant src/` = 11 Treffer (5 in `src/routes/`) → Soll: 6 Treffer, 0 in `src/routes/`.

Fünf Code-Stellen in vier Dateien:

1. **`src/routes/_tenant.js`** — `config`-Import entfernt, Factory-Signatur `makeTenantResolver({ store })` (kein `config` mehr), Rangfolge-Kommentar um Punkt (1) "Flag aus" gekürzt, und die eine Logikzeile entfernt: `if (!config.tenancy.multiTenant) return operatorChannelTenant(req);` fällt aus `requestTenant` ersatzlos raus. `operatorChannelTenant`, `internalTenant`, `isTrustedLocalCaller` und die restliche Reihenfolge bleiben unangetastet.
2. **`src/routes/api-read.js`** — `/api/state`: `const scoped = config.tenancy.multiTenant ? store.exportTenantData(tenantId) : s;` → unbedingt `store.exportTenantData(tenantId)`. `/api/calls/:id`-Guard: `if (config.tenancy.multiTenant && !tenantOwnsCall(...))` → `if (!tenantOwnsCall(...))`.
3. **`src/routes/api-calls.js`** — `callVisibleTo`: `!config.tenancy.multiTenant || tenantOwnsCall(...)` → nur noch `tenantOwnsCall(...)`. Deckt alle vier Request-Pfad-Leser von `store.getCall` (consult GET/POST, cancel, plus api-read.js).
4. **`src/routes/mcp.js`** (neuer Torschluss) — nach `requestTenant(req)` im `/mcp`-Handler, hinter `mcpAuth`: `if (scopedTenant === TENANT_REJECT) → 403 "Keine Tenant-Zuordnung fuer diese Identitaet."` plus `audit("auth_failed", ...)`. Bewusst als `if` im Handler statt Middleware, damit der "kein Token"-Fall weiter 401 mit `WWW-Authenticate` liefert (Bearer-Challenge bleibt intakt).

Neue Testdatei `test/e4-mandantentrennung-default.test.js` (Präfix `E4-`, fällt weder unter i18n-Katalog- noch Abnahme-Pattern → bleibt im Regressionslauf `npm test`): Trennungsfälle E4-10..E4-19 (Cross-Tenant-Leseschutz, Legacy-Call ohne tenantId, MCP-Torschluss E4-17/18/18b), und **Absolute Regel 2** (Offenlegungs-Ausnahme, beide Fehlerrichtungen) E4-20..E4-24 sowie Riegel+Positiv-Kontrolle E4-30/31.

Doku-Updates geplant: `PLAN-SECURITY.md` (neuer Abschnitt), `.env.example`/`render.yaml` (Kommentar zu `MULTI_TENANT` korrigiert, Wert bleibt `false`), `docs/RUNBOOK-LIVE-WERTE.md` (F-i-Einträge).

Sieben Prüf-Messungen (M1–M6, konfigurierbar) als Merge-Blocker gegen das Live-System definiert (WWW-Authenticate-Header, configHash, echter Werkzeugaufruf, Owner-Testanruf `calleeIsOwner`).

## Implementierungs-Zusammenfassung

- `headCommit`: `398f6e6c2acdb7a7b7fdf60bc0a6df6f6d2fe06d`, `node --check` sauber, Tests grün: **6147 pass / 0 fail**.
- Exakt nach Plan umgesetzt: Flag-Kurzschluss in `_tenant.js` entfernt, die drei flag-gegateten Scoping-Ausnahmen in `api-read.js`/`api-calls.js` unbedingt gemacht, neuer `/mcp`-Torschluss (`rejectIfNoTenant`, `logAndResolveIdentity`) in `routes/mcp.js`.
- Sechs geplante Bestandstestdateien invertiert (`request-tenant-unit`, `tenant-resolver-parity`, `auth-p3-bootstrap-fallback`, `read-scope-tenant`, `api-read-parity`, `request-tenant`) **plus acht weitere** als echter Fallout beim Vollauf (Mock-Stores brauchten `exportTenantData`; Token brauchte Tenant-Bindung via `OWNER_IDP_SUBJECT`; weitere invertierte Flag-aus-Erwartungen) — nie durch `MULTI_TENANT=true` "repariert", sondern auf den neuen strengeren Sollwert invertiert.
- Neue Testdatei `test/e4-mandantentrennung-default.test.js`: 18 Fälle E4-10..E4-31, inkl. beider Fehlerrichtungen der Offenlegungs-Ausnahme.
- `PLAN-SECURITY.md`/`.env.example`/`render.yaml` aktualisiert.
- Optionale Plan-Erweiterung angewendet: dritter `withMultiTenant`-Helfer in `auth-p3-bootstrap-fallback.test.js` entfernt, AUTH-P3-4/6 und -5/7 zusammengeführt (Alternative hätte toten Code + echte Testduplikate hinterlassen, G5/S2).
- Smoke-Test lokal erfolgreich: `GET /healthz` → 200, `GET /api/state` → 200 mit (leeren) Bootstrap-Listen.
- Drei Vollläufe `npm test --test-concurrency=4`: zwei grün (6147/6147), ein Lauf mit 2-3 Fehlschlägen, per Isolationstest als reine Parallelitäts-Flakes bestätigt (dritter sauberer Vollauf).

### Deviations

1. **`docs/RUNBOOK-LIVE-WERTE.md` NICHT aktualisiert** — die Datei existiert nur untracked im Haupt-Arbeitsverzeichnis, nicht in git/master, damit nicht im frischen Worktree verfügbar; Anfassen des Haupt-Arbeitsverzeichnisses war untersagt. Empfehlung: Owner trägt die zwei F-i-Zeilen (`OWNER_SELF_CALL_ENABLED=true`, `OWNER_SELF_CALL_TENANT_IDS=t_user_01KX600834GCJFV9GTZQKWZMTH`) selbst nach.
2. **Zusätzliches Lint-Aufräumen durch Pre-Commit-Hook erzwungen** — `check-staged-suppressions` verlangte, 5 bereits vorgemerkte Dateien vollständig auf 0 Lint-Befunde zu bringen (nicht nur die neuen Verstöße), Präzedenz Commit c044a54. Vergrößert den Diff, verändert keine Testaussage.
3. **Rechenfehler im Plan selbst**: Plan erwartete `grep multiTenant src/ | wc -l` = 6, gemessen sind es 5 (die Plan-eigene Aufzählung ergibt bereits nur 5). Keine Abweichung der Umsetzung.
4. Optionale Erweiterung §5.5 (siehe oben) angewendet statt übersprungen.

## Safety-Urteil

**FREIGABE MIT AUFLAGEN (approved=true).** Alle absoluten Regeln halten, die Mandantengrenze wird verschärft, nicht gelockert.

- **Scope**: kein neuer Endpunkt, keine neue Dependency, kein neuer Env-Schlüssel, keine DB-Änderung. 23 Dateien, ein Commit. `callee-is-owner.js`, `claude.js`, `telephony/**`, `config.js`, `auth.js`, `web-auth.js`, `middleware.js`, `route-policy.js`: 0 Zeilen geändert.
- **Safety-Gates**: `outbound-gates.js` unberührt (18 Glieder, unveränderte Reihenfolge). Gate-Kette zählt jetzt auf die echte Tenant-Achse statt geteiltem Bootstrap-Topf → pro Tenant Verschärfung. Aggregat-Lockerung (N × Tenant-Decke statt einem Topf) ehrlich in `PLAN-SECURITY.md` benannt, folgt bestehender Owner-Entscheidung E10.
- **Offenlegung**: `callee-is-owner.js` unangetastet, `disclosureSentence` unverändert, kein LOCALES-Wortlaut angefasst. Beide Fehlerrichtungen (E4-20/21/22/24) mit Tests belegt und selbst grün gesehen. `FAKE_ORIGINATE=true` + `ELEVENLABS_OUTBOUND_ENABLED=false` verhindern echte Anrufe in diesen Testfällen.
- **Auth fail-closed**: strikt strenger. Torschluss sitzt als `if` im Handler hinter `mcpAuth`, nicht als Middleware — "kein Token" bleibt 401 mit `WWW-Authenticate` (E4-18b), E4-17 beweist 403 + exakter Wortlaut, E4-18 Positiv-Kontrolle. `operatorChannelTenant`/`isTrustedLocalCaller`/`trustedLocalHeader` unverändert.
- **Secrets**: keine geleakt.
- **Kein eslint-disable, kein übersprungener Test, kein angehobener Altlast-Pin.**

### Concerns (nicht blockierend)

1. Nicht reproduzierbarer Flake in Lauf 1 (`dial-target-normalization.test.js`, Datei vom Diff unberührt, isoliert grün, riecht nach Port-/Parallelitäts-Artefakt).
2. `audit("auth_failed", req, "path=/mcp grund=kein_tenant")` hartcodiert statt über `auditAuthFailed`/`AUTH_FAILED_GRUND` — Präzedenzfall in `src/auth.js` existiert bereits so, kein Blocker, aber Nachzieh-Punkt.
3. Verhaltensänderung für `MCP_AUTH=token`/`""`/`off`: entfernter, korrekt authentifizierter Client bekommt jetzt 403 statt 200 mit leeren Listen. Sicherheitsseitig strenger, funktional ein Bruch dieses Modus — **Live läuft oauth**, aber M1/M2/M4/M6 müssen vor/nach dem Merge/Deploy neu gemessen werden.
4. Blast Radius größer als Spec-Aufzählung (19 statt 4 Testdateien angefasst) — fachlich zwingend bis auf reine Lint-Kosmetik in 4 Dateien (Richtung erlaubt, Ratsche senkt nur).
5. `docs/RUNBOOK-LIVE-WERTE.md`-Update im Diff nicht nachweisbar (siehe Deviation 1), nicht verifizierbar.
6. Kein Testlauf gegen echten Postgres möglich (kein Lauf-Modus dafür); pg-Pfad über pglite in derselben Bank abgedeckt und grün.

### Auflagen vor dem Merge (liegen beim Lead, nicht vom Reviewer leistbar)

1. M1 neu messen: `curl -si -X POST https://app.sundartha.com/mcp` → `WWW-Authenticate`-Header muss `oauth` zeigen. Fällt das auf token/Legacy: Merge-Blocker.
2. M2 (`configHash`) neu messen, Prämisse `MULTI_TENANT=true` live.
3. Zählerzeilen (`EXPECTED_TOTAL_KEYS`, `EXPECTED_PRIMITIVE_LEAVES`, `ROUTE_FINGERPRINT`) direkt vor dem Merge neu messen, falls parallel eine andere Kette lief.
4. Nach dem Deploy M4 (echter Werkzeugaufruf) und M6 (Owner-Testanruf, `call.calleeIsOwner`) — ohne beide ist der scharfe Fall der Absoluten Regel 2 am lebenden System unbelegt. Rollback = Revert des einen Commits.

## Clean-Code-Audit (s1–s4)

- **s1 (Blocker-Kategorie)**: keine Funde.
- **s2 (Blocker-Kategorie)**: keine Funde.
- **s3 (Namen)**: N-frei, keine Namensverstöße gefunden.
- **s4 (Minor)**: `const HTTP_FORBIDDEN = 403;` separat in `_tenant.js` UND `mcp.js` definiert (zwei lokale Modul-Konstanten statt einer geteilten). Kein S2 (keine Logik-Duplikation, nur eine triviale benannte Zahl), aber bei einer dritten Stelle wäre eine gemeinsame `http-status`-Konstante fällig.

**Verdict: PASS.** Diff eng und konsistent: alle vier betroffenen Lesepfade sprechen dieselbe Sprache (Flag steuert nur noch `isSelfServiceLive`, nicht mehr das Scoping), keine Stelle vergessen (G11 Konsistenz). Neuer `/mcp`-Torschluss als eigene Funktion ausgelagert (G30). `config`-Parameter bleiben dort in Gebrauch, wo sie für anderes gebraucht werden (kein toter Parameter). `eslint-suppressions.json` nur gekürzt, keine neue Suppression (G4). Neue Tests decken beide Fehlerrichtungen der Offenlegungs-Ausnahme sowie die neuen 403/404-Fälle ab. `PLAN-SECURITY.md` mit Pre-Mortem-Charakter fortgeschrieben (Risiken benannt, nicht verschwiegen).

**Top-TODOs (kein Blocker):**
- Optional: die zwei `HTTP_FORBIDDEN=403`-Konstanten bei nächster Gelegenheit zusammenführen, falls eine dritte Stelle hinzukommt.
- `PLAN-SECURITY.md` benennt als akzeptiertes Risiko: `GET /api/state` liefert einer unbekannten Identität weiterhin 200 mit leeren Listen statt 403 — im Auge behalten.

## Fix-Runden

Keine — die Implementierung erreichte PASS ohne Nachbesserungsrunde (Safety-Verdict "Freigabe mit Auflagen" betrifft ausschließlich Merge-/Deploy-seitige Live-Messungen, kein Code-Fix; Clean-Code-Verdict direkt PASS ohne Blocker).
