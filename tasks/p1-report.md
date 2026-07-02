# Phase P1 — WorkOS-Logout-Fix (sid-Claim + Session-Logout-Redirect)

**Gate: PASS**
**finalBranch:** `fix/workos-logout-p1`
**headCommit:** `7f12e47bd46415d541bee1d14c2e9ba490baac67`

## 1. Ziel

Bug D (WorkOS-Logout-Session-Persist): der lokale Sign-out invalidierte nur die eigene Session, liess WorkOS' AuthKit-SSO-Cookie aber aktiv — der naechste Login-Klick loggte still wieder ein, ohne Formular. P1 behebt das durch (a) Erfassen der WorkOS-Session-ID (`sid`-Claim) beim Login und (b) einen WorkOS-eigenen Sign-out-Redirect beim Logout, wenn diese ID vorhanden ist.

## 2. Plan (gekuerzt)

Gegroundet gegen `master`, `.claude/refs/clean-code.md` befolgt. Baseline vor Start: `npm test` (root) 1493/1493 gruen, `test/web-auth.test.js` 40/40, `test/web-auth-pg.test.js` 8/8, `apps/web` `node --test test/api.test.js` 17/18 (1 vorbestehender, nicht dieser Phase zugehoeriger Fail: `NUMBER_STATUS`-Drift in `src/store/views.js`).

### Abweichungen vom Umbrella-Plan (im Plan-Kopf begruendet, code-gegroundet)

1. Keine neue Dependency `workosApiBase` im Router — die WorkOS-Sign-out-URL wird in `makeOidc` gebaut (kennt `config.workosApiBase` bereits), neue Methode `oidc.sessionLogoutUrl(...)`.
2. `LOGIN_ROUTE` wird exportiert statt einen zweiten String `"/auth/login"` in `server.js` zu duplizieren (G5-Prinzip: eine Quelle fuer Route-Registrierung, Recovery-Redirect, `postLogoutUrl`).
3. `apiRequest` bekommt eine generische 204→null-Behandlung statt eines `parseJson:false`-Flags (Generalisierung an einer Stelle statt Sonderfall pro Aufrufer); bestehender Test bleibt wortwoertlich stehen.

### Kern-Edits (Datei-Uebersicht)

| Datei | Aenderung |
|---|---|
| `src/web-auth.js` | `LOGIN_ROUTE` exportiert; `mintSession` nimmt `workosSessionId` entgegen; `postLogoutUrl` aus deps; Callback reicht `workosSessionId` aus `exchange()` durch; `POST /auth/logout` liefert bei vorhandener WorkOS-Session-ID `200 {logoutUrl}` statt `204`; neuer Helper `sidFromAccessToken()`; `exchange()` gibt `workosSessionId` zurueck; `makeOidc.sessionLogoutUrl()` neu; `makeSessions.create`/`get` speichern/lesen `workosSessionId` |
| `src/db/schema.sql` | additive, idempotente Migration: `ALTER TABLE session ADD COLUMN IF NOT EXISTS workos_session_id TEXT;` |
| `src/server.js` | Import von `LOGIN_ROUTE`; `postLogoutUrl: config.publicUrl + LOGIN_ROUTE` an `makeWebAuthRoutes` durchgereicht |
| `public/tenant.html` | `logoutBtn`-Handler: bei `200`+`logoutUrl` Browser-Redirect zu WorkOS statt `location.reload()` |
| `apps/web/src/lib/api.js` | `apiRequest`: generische 204→`null`-Behandlung (neue Konstante `HTTP_NO_CONTENT`); `logout()` gibt `logoutUrl` (oder `null`) zurueck |
| `apps/web/src/components/app/AuthIsland.astro` | Logout-Handler navigiert bei vorhandener `logoutUrl` TOP-LEVEL zu WorkOS statt direkt `refresh()` |

Sicherheits-Design: `sidFromAccessToken()` dekodiert den JWT-Payload OHNE Signaturpruefung (server-zu-server ueber TLS, gleiche Vertrauensstufe wie das `user`-Objekt aus `exchange()`); fail-open bei fehlender/kaputter `sid` (Login bleibt unberuehrt, Logout faellt auf rein-lokal/204 zurueck). Alt-Sessions/Dev-Login ohne `workos_session_id` bleiben byte-identisch `204` ohne Body.

## 3. Implementierungs-Zusammenfassung

Exakt gemaess Plan umgesetzt und committed auf `fix/workos-logout-p1` (`7f12e47`). sid-Claim wird beim Login aus dem `access_token` extrahiert und in der `session`-Zeile gespeichert. `POST /auth/logout` liest sie vor der Invalidierung: mit sid → `200 {logoutUrl}` (WorkOS' eigener Sign-out-Endpunkt via `oidc.sessionLogoutUrl`, `session_id` + optional `return_to=postLogoutUrl`); ohne sid → Bestand `204` ohne Body. Frontend navigiert bei vorhandener `logoutUrl` TOP-LEVEL zu WorkOS, sonst wie bisher lokaler Reload/Refresh.

**Test-Ergebnis:**
- Root-Suite: **1501/1501 gruen** (1493 Bestand + 8 neu: T-AC2-06/07/08 sid-Extraktion, T-SL-01/02 `sessionLogoutUrl`-URL-Bau, T-SL-03 Router-Integration Login→Logout; 2 neu in `web-auth-pg.test.js` `workos_session_id`-Roundtrip gegen echtes pglite-Schema).
- `apps/web/test/api.test.js`: 17/18 gruen; 1 Fail = vorbestehender `NUMBER_STATUS`/`NUMBER_DISPLAY_STATUS`-Drift, unrelated zu P1.
- `node --check`: Exit 0, keine Ausgabe.

**Smoke-Test — echt end-to-end durchgefuehrt (nicht nur best-effort):** dediziertes Docker-Postgres (`postgres:16-alpine`, non-superuser NOBYPASSRLS-Rolle, F5-Gate-konform), Schema per echtem Server-Boot migriert (`workos_session_id`-Spalte per `psql \d session` verifiziert), Server lokal gestartet (`SKIP_TWILIO_SIGNATURE_CHECK=true`, `DEV_LOGIN_ENABLED=true`, `PORT=3999`). Zwei curl-verifizierte Faelle:
1. Dev-Login-Session ohne `sid` → `POST /auth/logout` → `204` ohne Body.
2. Session mit manuell gesetzter `workos_session_id` → `POST /auth/logout` → `200`, Body `{"logoutUrl":"https://api.workos.test/user_management/sessions/logout?session_id=workos_sess_smoketest_xyz&return_to=http%3A%2F%2F127.0.0.1%3A3999%2Fauth%2Flogin"}`, `invalidated_at` in der DB tatsaechlich gesetzt.

Container/Prozess danach sauber gestoppt.

### Deviations

- Keine Abweichungen vom Plan; die 3 im Plan-Kopf dokumentierten Abweichungen vom Umbrella-Plan wurden exakt wie beschrieben umgesetzt.
- Zusaetzlich: Kommentar oberhalb `apiRequest()` in `apps/web/src/lib/api.js` aktualisiert (war ueberholt, C2-Pflicht aus `clean-code.md`) — keine Verhaltensaenderung.
- Prettier (Repo-Standard) auf 4 JS-Dateien mit Formatierungsabweichungen angewendet — keine semantische Aenderung, danach erneut `node --check` + volle Suite gruen.
- Smoke-Test ueber den Plan hinaus als echtes Docker-Postgres-Setup durchgefuehrt statt nur optional/uebersprungen — staerkere Verifikation als gefordert.

## 4. Safety-Urteil (final)

**approved: true** — alle Kern-Flags gruen (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`). Keine Blocker.

**Unabhaengiger Test-Run:** frischer Worktree, eigener Branch `review-workos-logout-p1-824-3` von `fix/workos-logout-p1` (`7f12e47`), `node_modules` per Symlink. `npm test` (Root): **1501/1501 gruen**. `apps/web/test/api.test.js` isoliert: der neue Logout-Test gruen; 1 unrelated Pre-Existing-Fail (`NUMBER_STATUS`-Drift, bereits auf `master` vorhanden) + Umgebungs-Flakiness in astro-build-Tests (Vite-Temp-Dir-Race durch geteilten `node_modules`-Symlink ueber mehrere parallele Worktrees) — beides ausserhalb des P1-Diffs.

**Concerns (nicht-blockierend):**
1. Kosmetische Prettier-Reformats ohne funktionalen Bezug in den Diff gerutscht (dev-login email-Zeile, `claimsFromPayload` firstName-Zeile, `callStats`-Objekt-Formatierung, `agentInfo`-Testformatierung) — reines Whitespace/Line-Wrap, Hinweis fuer naechsten Cleanup-Pass.
2. Voller `apps/web`-Testlauf zeigt Fehlschlaege bei `links.test.js`/`pages.test.js` (ENOTEMPTY im Vite-`.deps`-Temp-Verzeichnis, Umgebungs-Race durch geteilten `node_modules`-Symlink) und dem `NUMBER_STATUS`-Drift-Guard — beide nachweislich nicht durch P1 verursacht (letzte Aenderung an `NUMBER_STATUS` stammt aus aelterem, unverwandten Commit).

**Verdict:** APPROVED. Diff haelt exakt den Plan ein, keine Safety-Gate-/Disclosure-/Auth-/Secret-Beruehrung, kein neuer npm-Dependency, ein einziger Commit exakt auf P1-Scope begrenzt.

## 5. Clean-Code-Audit (final)

**Verdict: PASS** — keine S1/S2-Blocker.

| Stufe | Findings |
|---|---|
| S1 (Blocker) | keine |
| S2 (Blocker) | keine |
| S3 (optional) | 2 |
| S4 | keine |

**S3-Findings:**
1. **G11 (Inkonsistenz)** — `src/web-auth.js`, `POST /auth/logout` (~Z. 271-282): `await sessions.get(sessionId)` liegt ohne try/catch im Handler; wirft er (DB-Haenger), bricht der komplette Logout unbehandelt ab, `clearCookies`+Response laufen nie — anders als der Nachbar-Handler `/auth/callback`, der DB-/IdP-I/O konsequent faengt. Fix-Vorschlag: try/catch analog `/auth/callback`, defensiver Fallback auf altes 204-Verhalten.
2. **G5-nah (Ausdrucksstaerke)** — `sidFromAccessToken` (~Z. 335-350): handgerollte base64url+JSON.parse-Dekodierung, obwohl `jose` (bereits Projekt-Dependency, siehe `src/auth.js`) mit `decodeJwt()` denselben unverifizierten Decode liefert. Fix-Vorschlag: `import { decodeJwt } from "jose"` statt manuellem Split/Decode/Parse.

**passNotes (Auszug):** vollstaendige Testabdeckung inkl. Grenzfaelle (fehlend/kaputt/non-JSON-Payload), Backward-Compat explizit getestet (Alt-Sessions bleiben 204-byte-identisch), G5 respektiert (`LOGIN_ROUTE` als eine Quelle, `config.workosApiBase`/`publicUrl` wiederverwendet), Schema-Migration additiv/idempotent, fail-open bei sid-Extraktion sauber begruendet und bewusst nicht sicherheitskritisch, beide UI-Konsumenten konsistent auf denselben `{logoutUrl}`-Contract verdrahtet, hohe Kommentardichte/-qualitaet (C1-C4). `apps/web`-Testfail `NUMBER_STATUS` ist unberuehrter Pre-Existing-Bug ausserhalb des Diff-Scopes.

**topTodos (fuer spaeter, kein Blocker):**
- try/catch um `sessions.get()` in `POST /auth/logout` ergaenzen.
- Optional: `sidFromAccessToken` auf `jose.decodeJwt()` umstellen.
- `NUMBER_STATUS`/`BLOCKED`-Testfail in `apps/web/test/api.test.js` separat ticketieren (pre-existing, nicht Teil von P1).

## 6. Fix-Runden

Keine — der erste Review-Durchlauf ergab direkt PASS (Safety: APPROVED, Clean-Code: PASS mit 2 optionalen S3-Hinweisen, kein S1/S2-Blocker). Keine Self-Fix-Iteration noetig.

## 7. Naechste Schritte (ausserhalb P1-Scope)

- Phase 2 (laut Umbrella-Plan): echter Browser-Redirect-Smoke-Test durch Jonas nach Deploy.
- Phase 3: WorkOS-Dashboard-Konfiguration (Sign-out-Redirect-URL registrieren) + E2E-Verifikation.
- Optionale Cleanup-Punkte aus Clean-Code-Audit (try/catch, `jose.decodeJwt`) und Safety-Concern (kosmetische Prettier-Reformats) fuer naechsten Pass vormerken.
