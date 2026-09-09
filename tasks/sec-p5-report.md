# Phase SEC-P5 — Web-Härtung

**Gate:** PASS
**finalBranch:** `sec/p5`
**headCommit:** `1ad1ffee5338a24f7be3dc13b44f5cb64898e13c`
**Datum:** 2026-09-09

---

## 1. Plan (gekürzt)

Drei Produktionsänderungen, minimaler Blast-Radius:

1. **CSP verschärfen** (`src/middleware.js`): `script-src` verliert `'unsafe-inline'` (`'unsafe-eval'` stand dort nie). `style-src` behält `'unsafe-inline'` (nicht Teil des Auftrags). Vorab-Befund: der reale Astro-Build (`apps/web/dist`) enthält null Inline-`<script>`, null Inline-Handler, null `javascript:`-URLs — durch `astro.config.mjs`-Pins (`build.inlineStylesheets: "never"`, `assetsInlineLimit: 0`) und kein `is:inline` im Quellcode.
2. **HSTS einführen**: neue exportierte Konstante `HSTS_HEADER_VALUE = "max-age=15552000; includeSubDomains"` (180 Tage, bewusst kein `preload` — nicht widerrufbar) als EINE Quelle (G5) für Gateway und `render.yaml`-Eintrag (Static-Service `hermes-web`, dashboard-managed).
3. **Session-Cookie umbenennen** (`src/web-auth.js`): `"session"` → `SESSION_COOKIE_NAME = "__Host-session"`. Befund vorab: `cookieAttrs()` erfüllte alle drei vom Browser erzwungenen `__Host-`-Bedingungen (Secure, Path=/, kein Domain=) bereits bedingungslos — reine Umbenennung, kein Verhaltensbruch außer Session-Invalidierung beim Deploy. 4 Produktions-Callsites, 1 Setzer, 30 betroffene Testdateien (28 mechanisch, 3 Sonderfälle).

Neue Tests: `test/sec-p5-web-haertung.test.js` (Dauerwächter: HSTS-Parität Gateway↔render.yaml, CSP des Static-Service, keine CSP-unverträgliche `apps/web`-Quelle, astro.config-Pins, Positiv-Kontrolle inkl. Gegenprobe) und `apps/web/test/csp.test.js` (Ergebnisbeleg am echten `astro build`, läuft nur auf Kommando — nicht in `npm test`/CI). `test/headers.test.js` wird umgeschrieben (Direktiven-genauer Vergleich statt Substring). `PLAN-SECURITY.md` bekommt einen neuen Abschnitt.

Nicht Teil der Phase: Deploy des Gateways, HSTS-Eintrag im Render-Dashboard des Static-Service, Außenmessung, Entscheidung zur CI-Aufnahme der `apps/web`-Testbank.

---

## 2. Implementierungs-Zusammenfassung

- **Produktionsdateien geändert (3):** `src/middleware.js`, `src/web-auth.js`, `render.yaml`.
- **Neue Tests (2):** `test/sec-p5-web-haertung.test.js`, `apps/web/test/csp.test.js`.
- **Geänderte Tests:** `test/headers.test.js` (direktiven-genauer Vergleich statt Substring, HSTS mitgeprüft), `test/web-auth-middleware.test.js` (neuer Fall: altes Cookie `session=` → 401), `test/web-auth.test.js`, `test/single-origin-auth.test.js`, `test/self-service-mirror-hydration.test.js`, `test/web-login-wiring.test.js` sowie 26 weitere Dateien rein mechanisch (Import + Cookie-Namensersetzung).
- **Doku:** neuer Abschnitt in `PLAN-SECURITY.md`.
- Diff-Umfang: 39 Dateien, +489/-81.

### Deviations (Plan-Abweichungen)

1. **Bugfix während Umsetzung:** Beide neuen Prüfungen entfernen HTML-Kommentare vor der Inline-Skript-Suche — ohne diesen Schritt meldete `apps/web/test/csp.test.js` einen Falsch-Positiv (`apps/web/src/pages/app/index.astro` enthält den wörtlichen Kommentar-Text `<!-- Scroll-Spy (siehe <script> unten) ... -->`). Beide Positiv-Kontrollen decken den Fall jetzt ab.
2. `dist-csp-test/` zusätzlich in `apps/web/.gitignore` aufgenommen (sonst untrackter Muell bei jedem Testlauf).
3. Der Smoke-Teil "Cookie-Form am laufenden Server" war im Worktree nicht fahrbar (`POST /auth/dev-login` → 404 im minimalen Spawn ohne SESSION_SECRET/pg) — stattdessen testseitig an der echten Route belegt (Secure, Path=/, kein Domain=, HttpOnly, SameSite=Lax). Header wurden real am laufenden Server gemessen.
4. Für den einmaligen Lauf von `apps/web/test/csp.test.js` wurde temporär auf das `node_modules` des Haupt-Checkouts verlinkt (kein eigenes `node_modules` im Worktree) und der Symlink vor dem Commit entfernt.
5. Volle Regressionsbank (`npm test`) wurde im Impl-Schritt auftragsgemäß NICHT gefahren — der Lead fährt sie am Ende. `npm run lint` lief grün, keine neuen Befunde in berührten Dateien.

---

## 3. Safety-Urteil

**Verdict: PASS.**

- Alle absoluten Regeln eingehalten; Diff berührt in `src/` nur `middleware.js` und `web-auth.js` — `claude.js`, `bridge.js`, `outbound-gates.js`, `state-ops.js`, `activation.js`, `route-policy.js`, `config.js` namentlich gegengeprüft und unberührt. Keine neue Dependency, Secret-Sweep über den Diff leer.
- **Adversarial nachgeprüft:**
  - `__Host-`-Umbenennung ist tatsächlich eine reine Umbenennung — `cookieAttrs()` setzte auf `master` bereits `HttpOnly; Secure; SameSite=Lax; Path=/` ohne `Domain=`.
  - Kein Doppel-Lesen des alten Cookie-Namens: `readSignedCookie` ist der einzige Cookie-Leser in `src/`; eigener Testfall pinnt `session=` → 401.
  - Die strikte CSP bricht keinen ausgelieferten Pfad: `/app` kommt aus `webDistDir` (vollständig von `csp.test.js` gescannt, grün); `publicDir` trägt kein HTML; MCP-Widget-HTML mit Inline-`<script>` wird nicht über eine HTTP-Route dieses Origins ausgeliefert — CSP trifft sie nicht.
  - `test/headers.test.js` prüft jetzt per Gleichheit `script-src 'self'` statt pauschalem `doesNotMatch`, das an `style-src` falsch-rot geworden wäre.
- Test-Ergebnisse: Root-Testbank (33 Dateien) 300/300 grün, dazu isolierte Läufe (inkl. Postgres-Pfad `i9-self-service`) grün; `apps/web/test/csp.test.js` 3/3 grün.
- **Concerns (keine Blocker):**
  1. `apps/web/test/subscribe.test.js` ist mit 3 Fällen rot — Bestandsdefekt, identisch auf `master` nachgemessen, nicht von SEC-P5 verursacht.
  2. Der Ergebnisbeleg am gebauten Output läuft nicht in CI — Dauerwächter ist allein die Quellprüfung; ein künftiges Astro-/Vite-Upgrade mit erneutem Inlining würde nicht automatisch auffallen.
  3. HSTS-Eintrag in `render.yaml` ist heute wirkungslos (dashboard-managed); zusätzlich fehlt `hermes-web-staging` im Blueprint, obwohl er laut CLAUDE.md die Live-CSP spiegelt.
  4. Alte `session=`-Cookies bleiben im Browser bis Ablauf, ohne Auth-Wirkung, selbstheilend binnen 1h TTL.
  5. Login-Flow-Cookies (`pkce_verifier`/`oauth_state`/`oidc_nonce`) bleiben bewusst unpräfigiert — korrekt gezogene Scope-Grenze für eine spätere Phase.
  6. Die neue Quellprüfung scannt nur `apps/web/src`, nicht `config.server.publicDir` — heute kein Defekt, aber unbewachte Flanke.

---

## 4. Clean-Code-Audit

**Verdict: PASS** (kein Blocker)

- **s1 (Blocker-Kategorie):** keine Befunde.
- **s2 (Duplizierung, mild):** `INLINE_HANDLER_ATTRIBUTES`-Liste sowie Kommentar-/Regex-Logik für Kommentar-Entfernung und `javascript:`-Erkennung stehen wortgleich in `test/sec-p5-web-haertung.test.js` und `apps/web/test/csp.test.js`. Mildernd: beide Dateien prüfen unterschiedliche Artefakte (Quelltext vs. gebauter Output) in unterschiedlichen npm-Kontexten — kein zwingender Blocker, aber echte Duplizierung nach G5. Fix-Vorschlag: gemeinsames Modul.
- **s3 (Namen/Magic Numbers):** keine Verstöße — `HSTS_HEADER_VALUE`, `SESSION_COOKIE_NAME`, `HSTS_MAX_AGE_SECONDS` sprechend, Magic Numbers benannt (G25 erfüllt).
- **s4 (Struktur):** keine Auffälligkeiten — nur zwei neue exportierte Konstanten als EINE Quelle (G5) für bereits vorhandene Strukturen.

**Top-TODOs (optional, kein Blocker):**
1. `INLINE_HANDLER_ATTRIBUTES` + Kommentar-Strip-Regex in gemeinsames Modul ziehen (S2).
2. Owner-Schritt nachhalten: HSTS-Header im Render-Dashboard des Static-Service manuell eintragen.
3. Nach Merge/Deploy: Außenmessung der drei Oberflächen (Gateway-HSTS, Static-Service-HSTS, `__Host-`-Cookie).

---

## 5. Fix-Runden

Keine — Plan, Implementierung, Safety-Review und Clean-Code-Audit liefen in einem Durchgang ohne nötige Nachbesserungsrunde. Die einzige Abweichung vom Plan war der in Abschnitt 2 dokumentierte Bugfix während der Umsetzung (Kommentar-Falsch-Positiv), kein separater Fix-Zyklus nach Review.
