# GATES-P14 — Altes Dashboard löschen

**Spec:** Abschnitt "P14" in `tasks/gates-fix-chain.md`
**Eigene Abnahmebedingung:** die Stripe-Rückkehradressen zeigen auf `/app` **und** `/app` wertet die Parameter aus — ohne Nachweis kein Merge. Zusätzlich: `npm test` mit fail=0 und keinem neu roten Bestandstest, Diff berührt `src/` bzw. `public/`. Zulässige Teständerungen: nur die in `PLAN-GATES.md` Abschnitt 7 genannten. Die CSP wird NICHT angefasst (Folgeauftrag).

**Gate: PASS**
**finalBranch:** `phase/gates-p14-altes-dashboard-loeschen`
**headCommit:** `6b57725`
**Basis:** `master` (`32b8440`), enthält P12 (`a734978`) und P13 (`cf93f87`)

---

## 1. Plan (gekürzt)

- **Vorbedingung:** P13 muss auf `master` gemergt sein (harte Reihenfolge laut `PLAN-GATES.md`). Bei Planerstellung noch nicht gegeben — beim Start dann erfüllt.
- **Pre-Mortem (Pflicht):** Risiko 1 — ein Kunde, der vor dem Deploy eine Stripe-Checkout-Session geöffnet hat, trägt die alte Rückkehr-Adresse `/tenant.html?...` fest in der Session; Löschen der Datei ohne fortbestehenden Redirect würde ihn auf 404 laufen lassen. Gegenmittel: der `/tenant.html → /app`-Redirect bleibt bestehen, Query-String wird erhalten. Risiko 2: Post-Login-Pfad ohne `WEB_DIST_DIR` zeigt auf die gelöschte Datei → Zweig entfernt. Risiko 3: Basic-Auth-Exemption für eine nicht mehr existierende Datei ist toter Code auf einer Sicherheitsnaht → entfernt (Richtung fail-closed). Risiko 4: der Fehlerfall `card=error` des Geldpfads war bisher stumm → bekommt einen eigenen Auswertungs-Zweig in der App-Shell, sonst ist die Abnahmebedingung nur mit Ausnahmeklausel führbar.
- **Neue Datei `src/portal-paths.js`:** EINE Quelle für `APP_PATH`, `LEGACY_PORTAL_PATH` und `CHECKOUT_RETURN` (Object.freeze), um die zuvor doppelt geführten Rückkehr-Konstanten (`self-service-routes.js` + Inline-Literal in `api-billing.js`) zu vereinen. Eigenes Modul, weil ein Import aus den Routen-Modulen zurück nach `app.js` ein Zyklus wäre.
- **Edits (Vorher/Nachher je Datei):** `public/tenant.html` löschen (`git rm`); `self-service-routes.js` (Konstanten → Import); `routes/api-billing.js` (zweites Inline-Literal auf dieselbe Quelle ziehen, Datei außerhalb der Spec-Liste, aber PM-6-getrieben); `app.js` (Konstanten → Import, Landing-Redirect-Kommentar, Altpfad-Redirect-Begründung neu, `installAuthGate`/`wireWebLogin`-Aufrufe ohne `CUSTOMER_PORTAL_PATH`); `wiring/auth-gate.js` (Exemption + `isSelfServiceLive`-Import entfernen, fail-closed, live wirkungslos da Redirect schon vor dem Gate greift); `wiring/web-login.js` (Post-Login-Zweig auf gelöschte Datei entfernen); `apps/web/.../BillingIsland.astro` (`card=error`-Zweig ergänzen); `src/middleware.js` (nur Kommentar, CSP-Array unverändert); `README.md` (Dateibaum-Zeile entfernen); `PLAN-SECURITY.md` (Eintrag zur entfallenen Exemption).
- **Ausdrücklich NICHT geändert:** CSP, der Altpfad-Redirect selbst (bleibt bestehen), `formatLocale`-Vertrag, alle Safety-Gates/Disclosure/Signatur/MCP, `render.yaml` (P15).
- **Tests:** 7 Dateien löschen (Pflichtgegenstand war ausschließlich `tenant.html`-Inhalt, u.a. `bk1-plan-price-format.test.js` mit den zwei per `PLAN-GATES.md` Abschnitt 7 autorisierten FMT-15-Gates sowie `dashboard-i18n-surface.test.js`-WEB-08), 13 Dateien umbauen, 1 neue Datei `test/p14-checkout-return-app-shell.test.js` als maschineller PM-6-Nachweis (Datei weg / alle Ziele auf `/app` / Shell wertet jeden Parameter aus / kein Server-Ziel zeigt mehr aufs alte Dashboard außer der einen `LEGACY_PORTAL_PATH`-Konstante).
- **Deterministisch prüfbares Ergebnis:** grep-Befehle für "genau 1 Treffer auf `/tenant.html`" in `src/`, Laufzeit-Smoke mit `WEB_DIST_DIR`-Fixture (`302 → /app?card=ok`), Suiten-Delta-Nachweis.

---

## 2. Implementierungs-Zusammenfassung

Commit `6b57725` auf `phase/gates-p14-altes-dashboard-loeschen`. Umsetzung folgt dem Plan eng:

- `public/tenant.html` per `git rm` gelöscht.
- Neues Modul `src/portal-paths.js`: `APP_PATH`, `LEGACY_PORTAL_PATH`, `CHECKOUT_RETURN` (Object.freeze, 5 Rückkehr-Ziele: `CARD_OK/CARD_CANCELED/CARD_ERROR/SUB_OK/SUB_FAILED`), als einzige Quelle für `src/app.js`, `src/self-service-routes.js`, `src/routes/api-billing.js`.
- `src/self-service-routes.js` und `src/routes/api-billing.js`: alle fünf Stripe-Rückkehr-Ziele zeigen jetzt auf `/app?...`; das zweite, driftfähige Inline-Literal in `api-billing.js` (`cancelUrl`) ist mitgezogen.
- `src/app.js`: Konstanten durch Import ersetzt, Altpfad-Redirect (`/tenant.html → /app`) bleibt bestehen (bewusst — in-flight Stripe-Sessions), Kommentare korrigiert.
- `src/wiring/auth-gate.js`: Basic-Auth-Exemption für `/tenant.html` entfernt (fail-closed), `isSelfServiceLive`-Import mitentfernt (nach Grep bestätigt ungenutzt).
- `src/wiring/web-login.js`: Post-Login-Zweig auf die gelöschte Datei entfernt; `isSelfServiceLive` bleibt (dort weiterhin für den Self-Service-Mount gebraucht).
- `src/middleware.js`: nur Kommentar korrigiert, CSP-Array byte-identisch.
- `apps/web/src/components/app/BillingIsland.astro`: neuer `card=error`-Zweig ("Something went wrong - no card was saved. Please try again.").
- `README.md`, `PLAN-SECURITY.md` aktualisiert.
- Tests: 7 Dateien gelöscht (reiner `tenant.html`-Pruefgegenstand), 13 umgebaut, 1 umbenannt (`p15b-tenant-html-format-locale.test.js` → `p15b-format-locale.test.js`), 1 neu (`test/p14-checkout-return-app-shell.test.js`, 4 Tests).

**Suiten-Delta (master 32b8440 vs. Branch, identisches Setup):**
- `npm test` (json): 3341/0 → 3326/0 (fail bleibt 0; −15, vollständig durch die 7 gelöschten Dateien + entfallene Katalogtests erklärt, siehe Impl-JSON für die genaue Zeilenaufschlüsselung).
- `npm run test:gates`: 132/125 pass / 7 fail → 129/125 pass / 4 fail. PASS-Zahl identisch (125) — kein vorher grüner Katalogtest ist neu rot. Weggefallen: genau die drei per `PLAN-GATES.md` Abschnitt 7 autorisierten (FMT-15 ×2, WEB-08). Weiterhin rot: GAP-05, GAP-15 ×2 (Owner-Handarbeit), GAP-37 (P15-Auftrag).

**Deviations (aus dem Impl-Report):**
1. Bewusste Verschärfung gegenüber Plan: `test/auth-gate-exemption-order.test.js` Test (c) nicht ersatzlos gelöscht, sondern umgedreht — prüft jetzt aktiv, dass `/tenant.html` auch mit beiden Flags an NICHT mehr exempt ist (401). Grund: sonst wäre der einzige maschinelle Beweis der entfernten Sicherheits-Ausnahme mitgelöscht worden.
2. Vorbedingung war zum Startzeitpunkt bereits erfüllt (P13 war schon Vorfahr von master), abweichend von der ursprünglichen Planannahme "P13 nicht gemergt".
3. Worktree stand initial auf veraltetem Commit — laut Regel 0 explizit von `master` neu angelegt; kaputter Symlink-Befehl für `node_modules` korrigiert.
4. Smoke-Test brauchte mehr Env als vorgesehen (Boot-Guard-Anforderungen) — gelöst mit `BASE_ENV` aus `test/helpers.js` + Bootstrap in Temp-`DATA_DIR`, kein Produktivcode geändert.
5. NICHT gefixt (Scope, als Befund gemeldet): Provenienz-Kommentare in `apps/web` (`BillingIsland.astro`, `lib/api.js`, `lib/subscribe.js`, weitere Islands, `styles/app.css`, `pages/app/index.astro`), die als Herkunftsangabe auf `public/tenant.html` verweisen ("1:1-Verhalten zu ...", "Portierung von ..."); kein lebendes Ziel, ein Sweep war nicht Auftrag.

---

## 3. Safety-Urteil

**Verdict: APPROVED (mit Deploy-Auflage).**

- Regel 1 (Safety-Gates): unberührt — kein Diff in `src/telephony/**`, kein Gate-Pfad, kein neuer Endpunkt für Calls/SMS/Geld; `outbound-gates-order` grün.
- Regel 2 (Offenlegung): unberührt — `src/claude.js`/`src/bridge.js` nicht im Diff; `disclosure-regression` 35/35 grün.
- Regel 3 (Auth fail-closed): die entfernte Exemption bewegt sich strikt Richtung fail-closed, selbst gegengeprüft (ohne `WEB_DIST_DIR`: `/tenant.html` → 401 statt zuvor ausgeliefert); `safeEqual` und übrige Exemption-Kette unverändert, INV-3 im angepassten Test weiter eingefroren.
- Regel 4 (Secrets): keine secret-artigen Zusätze im Diff.
- Regel 5 (Audio/MCP): unberührt.

Unabhängig gemessen: Regression json 3326/0 (Delta −15 vollständig per Testnamen-Diff aufgeschlüsselt, keiner davon ohne existierenden Pruefgegenstand). Regression pg 2948/48 fail — Fehlermenge byte-identisch zur Master-Baseline (Ursache: Sandbox ohne Postgres, keine P14-Datei betroffen). Gates: 129 Tests / 4 rot vs. Master 132/8 rot, exakt die drei per Abschnitt 7 autorisierten entfallen, ein Flake (LAW-22) unabhängig davon grün.

Eigener Runtime-Smoke bestätigt PM-6 end-to-end: `/tenant.html?card=error` → 302 `/app?card=error` → 301 `/app/?card=error` → 200, Query bleibt über beide Hops erhalten; ohne `WEB_DIST_DIR` liefert `/app`/`/tenant.html` konsequent 401.

**Concerns (kein Blocker, aber Merge-Auflage):**
1. **Money-Path Deploy-Vorbedingung:** ohne `WEB_DIST_DIR` liefert `/app?card=ok` jetzt 401 statt vormals ausgeliefertem `/tenant.html`. Spec-vorgeschrieben, ohne Alternative (Zieldatei gelöscht). **Vor dem Live-Deploy zwingend verifizieren, dass `WEB_DIST_DIR` am Live-Service gesetzt ist und `/app` antwortet** — sonst landet ein Kunde, der gerade seine Karte hinterlegt hat, auf 401.
2. Post-Login ohne `WEB_DIST_DIR` fällt auf `/` → `/auth/login`-Redirect; bei aktiver SSO-Session ist eine Login-Schleife plausibel (nicht ausgeführt, nur hergeleitet). Gleiche Vorbedingung wie oben.
3. Testabdeckung Geld-Anzeige: `test/bk1-plan-price-format.test.js` komplett gelöscht (spec-gedeckt); die überlebende `apps/web/src/lib/plans.js#formatPlanPrice` ist nur in `apps/web/test/plans.test.js` gepinnt, das weder in `npm test` (Glob nur `test/*.test.js`) noch in CI läuft. Entschärfend: die Funktion ist locale-frei, die Geld-Achse-Invariante strukturell nicht verletzbar. Empfehlung als Folgeauftrag.
4. Scope-Beobachtung (kein Verstoß): Diff berührt 4 src-Dateien außerhalb der Spec-Liste (`wiring/auth-gate.js`, `wiring/web-login.js`, `routes/api-billing.js`, neues `portal-paths.js`) sowie `BillingIsland.astro` — alle direkt von der Abnahmebedingung getrieben, nichts frei erfunden. Keine neue npm-Dependency, `render.yaml`/`.env.example`/Scripts unberührt.
5. CSP wie beauftragt nicht angefasst (nur Kommentar geändert, per grep auf Nicht-Kommentar-Zeilen belegt); Folgeauftrag in `PLAN-SECURITY.md` dokumentiert.
6. Kosmetik in `wiring/auth-gate.js`: hängende Leer-Kommentarzeile, Blockkommentar beschreibt noch die alte per-Request-Logik.
7. `formatLocale` im Self-Service-State-Vertrag hat nach P14 keinen Konsumenten mehr (kein Defekt, Kandidat für späteren Vertragsschnitt).

---

## 4. Clean-Code-Audit (S1–S4)

**Verdict: PASS (kein Blocker).**

- **S1:** keine.
- **S2:** keine.
- **S3 (4 Funde, alle Doku-Drift/Kosmetik):**
  1. `ONBOARDING.md:46` — Code-Landkarte listet weiterhin `public/tenant.html` als existierende Datei, obwohl P14 sie löscht (README.md wurde korrekt aktualisiert, diese Stelle übersehen).
  2. `CLAUDE.md:59` (Architektur-Abschnitt) — beschreibt `public/` weiterhin als "index.html (Owner) + tenant.html (Tenant-Self-Service)"; beide Dateien existieren nach diesem und einem früheren Owner-Removal-Merge nicht mehr.
  3. `.env.example:589` — Kommentar zur Redirect-Env-Variable verweist weiterhin auf `/tenant.html` als Ziel statt `/app`.
  4. Kleinigkeit: Restsatz-Kommentar in `src/app.js` bei `buildApp` ("INV-1") bezieht sich jetzt auf zwei statt drei Konstanten — kein Fehler, nur pruefenswert bei nächster Berührung.
- **S4:** keine.

**Positive Feststellungen:** saubere DIP/G5-Extraktion (`portal-paths.js`) statt Copy-Paste; Kommentare erklären das Warum (Stripe-Session-Race, Bookmarks); Exemption-Entfernung strikt fail-closed und aktiv getestet (401 statt nur Abwesenheit einer Assertion); keine toten Imports/Variablen; `node --check` auf allen geänderten `src/`-Dateien grün; Testzahlen und entfallene IDs (WEB-08, FMT-15 ×2) decken sich exakt mit `PLAN-GATES.md`.

**Top-Todos:**
1. `ONBOARDING.md` + `CLAUDE.md` (Architektur-Abschnitt) + `.env.example`-Kommentar auf den gelöschten `tenant.html`-Stand nachziehen.
2. CSP-Verschärfung als eigener Folgeauftrag (in `PLAN-SECURITY.md` schon vermerkt).
3. WEB-08 ist mit der Löschung ersatzlos entfallen, ohne dass geprüft wurde, ob `apps/web` denselben Defekt (deutscher Enum-Wortstamm im Label) trägt — laut `PLAN-GATES.md` so vorgesehen, aber als offene Wissenslücke im Katalog vormerken.

---

## 5. Fix-Runden

Keine — die Phase erreichte PASS im ersten Durchlauf (dualer Review: Safety APPROVED, Clean-Code PASS, keine Blocker in S1/S2). Es gab keine Fix-Iteration.

---

## 6. Merge-Auflage (zusammengefasst)

Vor dem Live-Deploy am Gateway zwingend belegen, dass `WEB_DIST_DIR` gesetzt ist und `/app` antwortet (200/301). Ohne diesen Beleg landet ein Kunde, der gerade seine Karte hinterlegt hat, auf 401 — das ist genau der Schaden, den die eigene Abnahmebedingung PM-6 verhindern sollte.
