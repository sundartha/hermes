# PLAN-WORKOS-LOGOUT.md

Status: Root-Cause-Investigation abgeschlossen (diese Session, Agent-Team + WorkOS-Doku-Recherche). Fix noch nicht implementiert.

## Problem (Jonas, 2026-07-02)

Registrierung + Buchung funktionieren. Aber: Dashboard -> "Abmelden" -> erneut anmelden -> es erscheint **nicht** das normale WorkOS-Login-Formular (E-Mail + Passwort), sondern der Nutzer wird automatisch wieder eingeloggt. Das ist ein Problem, weil (a) ein Nutzer mit mehreren Accounts nicht wechseln kann, (b) es nicht dem erwarteten Verhalten "wie beim ersten Login" entspricht.

## Root Cause (verifiziert, nicht spekulativ)

Verifiziert durch zwei unabhängige Explore-Agents (Code-Lesart) + offizielle WorkOS-Dokumentation (workos.com/docs/authkit/sessions, workos.com/docs/reference/authkit/logout). Beide Quellen konvergieren auf denselben Befund.

**WorkOS AuthKit hält eine eigene SSO-Session im Browser** (auf der AuthKit-Domain), unabhängig vom App-Cookie dieses Projekts. Unser Logout räumt nur die eigene Session auf — die WorkOS-Session bleibt aktiv. Beim nächsten Login-Redirect erkennt AuthKit die noch aktive Session und authentifiziert still durch, ohne das Formular zu zeigen.

Zwei Lücken im Code, die das verursachen:

1. **`POST /auth/logout`** (`src/web-auth.js:257-265`) invalidiert nur die eigene DB-Session und löscht nur das eigene `session`-Cookie. Es gibt **keinen** Aufruf eines WorkOS-Endpunkts — WorkOS wird über den Logout nie informiert.
2. **`exchange()`** (`src/web-auth.js:346-383`) verwirft `access_token`/`refresh_token` aus der WorkOS-`authenticate`-Antwort komplett (nur `claims` aus dem `user`-Objekt wird übernommen). Damit wird nirgends die `sid`-Klaim (WorkOS-Session-ID) gespeichert, die für ein serverseitiges Logout bei WorkOS gebraucht würde — selbst wenn (1) behoben wäre, fehlt die ID dafür.

Ein möglicher dritter Hebel — ein Parameter, der WorkOS zwingt, das Login-Formular trotz aktiver Session zu zeigen (wie `prompt=login` bei Auth0/OIDC) — **existiert bei WorkOS nicht** (verifiziert per Doku-Recherche, kein `prompt`-Parameter am `user_management/authorize`-Endpunkt dokumentiert). Der einzige von WorkOS unterstützte Weg ist der offizielle Logout-Redirect.

## Fix-Ansatz (laut offizieller WorkOS-Doku)

WorkOS-Doku ("Signing Out", workos.com/docs/authkit/sessions):

1. `sid`-Klaim aus dem Access-Token holen.
2. Die eigene App-Session löschen.
3. Den Browser auf den WorkOS-Logout-Endpunkt umleiten: `GET https://api.workos.com/user_management/sessions/logout?session_id=<sid>&return_to=<url>` (Parameter laut API-Referenz: `session_id` Pflicht, `return_to` optional).
4. WorkOS beendet die eigene Session und leitet auf die konfigurierte Sign-out-Redirect-URL zurück.

Das erfordert zwei Änderungen am Bestand: `sid` beim Login abgreifen + speichern (aktuell nirgends vorhanden), und Logout so umbauen, dass der Browser tatsächlich zu WorkOS navigiert (nicht nur ein Hintergrund-Request).

## Vorgehen: Lean Template + Implementation Workflow

Jede Phase läuft über das `phase-impl-lean`-Skill (Plan -> Implementierung im Worktree -> dualer Review [Safety/Verhalten + Clean-Code] -> Self-Fix bis PASS -> kompakter Report) und befolgt zusätzlich `.claude/refs/workflow.md` (Plan-Mode-Pflicht, Subagent-Strategie, deterministisches Ergebnis + Verifikations-Loop über `tasks/todo.md`). Auth-Änderungen sind laut `CLAUDE.md` automatisch nicht-trivial — Plan Mode ist Pflicht, kein Schritt wird übersprungen.

### Modell-Zuteilung (Qualität bei wichtigen Steps, Effizienz beim Rest)

| Schritt | Modell | Begründung |
|---|---|---|
| Root-Cause-Investigation | erledigt (diese Session) | — |
| Plan-Erstellung (`phase-impl-lean` "Plan") | **Fable** | Architektur-Entscheidung mit Security-/Auth-Impact, teuer falsch zu planen |
| Implementierung im Worktree | **Sonnet 5** | mechanisches Umsetzen eines fertigen Plans |
| Dualer Review (Safety/Verhalten + Clean-Code-Auditor) | **Fable** | sicherheitskritischer Pfad — Review-Tiefe hat Vorrang vor Tokenkosten |
| Self-Fix-Loop bis PASS | **Sonnet 5** | mechanisches Nachbessern nach Review-Findings |
| Tests + Verifikation (`npm test`, Smoke-Test) | **Sonnet 5** | Ausführung, keine Architektur-Entscheidung |
| WorkOS-Dashboard-Konfiguration | — (Jonas manuell) | Claude kann kein OAuth/Dashboard — siehe Safety-Regel |

### Phase 1 — Fix implementieren (ein `phase-impl-lean`-Lauf, ein Worktree)

1. **`exchange()` erweitern** (`src/web-auth.js:346-383`): `access_token` aus der Antwort nicht mehr verwerfen. JWT-Payload-Segment (mittlerer Teil, Base64url) dekodieren und `sid`-Klaim extrahieren — kein JWKS-Signatur-Verify nötig (die Antwort kommt bereits über einen vertrauenswürdigen Server-zu-Server-TLS-Kanal, gleiche Vertrauensstufe wie das `user`-Objekt), kein neuer Dependency. Rückgabe erweitern auf `{ claims, workosSessionId }`.
2. **Schema-Migration** (`src/db/schema.sql`, direkt nach der `session`-Tabelle): additive, idempotente Spalte `ALTER TABLE session ADD COLUMN IF NOT EXISTS workos_session_id TEXT;`. Nullable — Bestandssessions bekommen `NULL` und heilen sich beim nächsten Login selbst (kein Datenverlust, kein Breaking Change).
3. **`mintSession()` erweitern** (`src/web-auth.js:141-158`): `workosSessionId` durchreichen an `sessions.create()`.
4. **`makeSessions()` erweitern** (`src/web-auth.js:636-681`): `create()` (638-648) speichert `workos_session_id` mit, `get()` (652-661) liest sie mit aus.
5. **`POST /auth/logout` umbauen** (`src/web-auth.js:257-265`): Session-Zeile VOR dem Invalidieren per `sessions.get(sessionId)` lesen, `workos_session_id` daraus holen. Lokales Invalidieren + Cookie-Löschen bleibt unverändert. Statt bloß `204` liefert die Route jetzt JSON mit optionalem `logoutUrl`: `${config.workosApiBase}/user_management/sessions/logout?session_id=<sid>&return_to=<postLogoutUrl>`. Fehlt `workos_session_id` (Alt-Session ODER Dev-Login-Pfad, der nie über WorkOS lief) -> kein `logoutUrl` im Response, Verhalten bleibt wie heute (rein lokal).
6. **Frontend anpassen**: `public/tenant.html:349-352` UND `apps/web/src/lib/api.js:94-95` (+ Aufrufer). Logout darf nicht mehr nur ein Hintergrund-`fetch()` + `location.reload()` sein — der Browser muss TOP-LEVEL zu `logoutUrl` navigieren (`window.location.href = logoutUrl`), damit WorkOS das AuthKit-Cookie im echten Browser-Kontext löschen kann. Reihenfolge zwingend: erst `await fetch("/auth/logout")` abwarten, DANN navigieren (nicht parallel) — sonst Race zwischen lokalem Invalidieren und Redirect. Fällt `logoutUrl` weg -> Fallback wie bisher (`location.reload()`).
7. **Bestehenden Vertragstest anpassen**: `apps/web/test/api.test.js:76-92` erwartet aktuell 204-ohne-Body — bricht bewusst, weil sich die Response-Form ändert. TDD-Reihenfolge (superpowers:test-driven-development): Test zuerst rot machen, dann Implementierung.
8. **Neuer Test**: Login (über injizierten `oidc`-Dep mit gefälschtem Access-Token, der eine `sid`-Klaim trägt) + Logout durchspielen, prüfen dass die Response ein `logoutUrl` mit korrektem `session_id` und `return_to` enthält.

### Phase 2 — Verifikation

- `node --check src/web-auth.js`
- `npm test` — voll grün, inklusive angepasster und neuer Tests
- Smoke-Test lokal: `SKIP_TWILIO_SIGNATURE_CHECK=true PORT=3999 npm start`, `curl` gegen `/auth/logout` mit einer lokal geminteten Session, `logoutUrl`-Form im Response prüfen
- Was lokal NICHT beweisbar ist: der echte WorkOS-Redirect (kein echter Browser, keine echte AuthKit-Session verfügbar) — Ende-zu-Ende-Bestätigung bleibt manueller Test durch Jonas nach Deploy (Phase 3)

### Phase 3 — Nicht-Code (Jonas manuell — Claude kann kein OAuth/Dashboard)

1. Im WorkOS-Dashboard, Environment `caring-lyric-24-staging` (siehe Projekt-Memory `bug-a-workos-um-login`): eine **Sign-out-Redirect-URL** konfigurieren (z. B. `https://vodafone-agent.onrender.com/auth/login`). Pflicht — sonst schlägt `return_to` fehl oder WorkOS nutzt einen unerwarteten Default.
2. Deploy des Gateway-Service auf Render.
3. Manueller Ende-zu-Ende-Test: Login -> "Abmelden" -> erneut Login klicken -> **Credentials-Formular muss erscheinen**, keine automatische Wiederanmeldung mehr.

## Risiken (Pre-Mortem)

- **Übergangsphase Alt-Sessions**: Sessions, die vor dem Deploy gemintet wurden, haben `workos_session_id = NULL` — für sie bleibt der Bug bis zum nächsten Login bestehen. Kein Absturz, selbstheilend, akzeptables Übergangsrisiko.
- **`return_to` nicht registriert**: Ist die Sign-out-Redirect-URL im WorkOS-Dashboard nicht gesetzt, kann der Redirect fehlschlagen oder auf einen unerwarteten Default zurückfallen. Phase 3.1 ist Hard-Blocker, nicht optional — ohne sie bleibt der Fix im Code wirkungslos.
- **Navigations-Race im Frontend**: Wenn `location.href` feuert bevor `fetch("/auth/logout")` durchgelaufen ist, könnte der Browser navigieren, während die lokale Session noch aktiv ist. Strikt sequenziell umsetzen.
- **`apps/web`-Testvertrag**: bricht bewusst (204 -> JSON) — muss im selben PR mitgezogen werden, sonst rot in CI.

## Nächster Schritt

`phase-impl-lean` für Phase 1 starten (Fable-Plan zuerst, dann Worktree + Sonnet-5-Implementierung + Fable-Review + Self-Fix), danach Phase 2. Phase 3 wartet auf Jonas (WorkOS-Dashboard-Zugriff).
