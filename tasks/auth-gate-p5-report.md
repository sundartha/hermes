# Bericht Phase AUTH-P5 — `internalOnly` + Audit-Ersatz

## Kopfdaten

- **Gate:** PASS
- **finalBranch:** `phase/auth-p5-internal-only`
- **Commit-Hash:** `e7915b5` — feat(auth-p5): internalOnly vor den MCP-Routen + Audit fuer abgelehnte Anfragen (Basis `master@6e2a8d7`)

## EHRLICHKEITSREGEL — was sich am heutigen Deploy fuer einen Aufrufer OHNE Credentials aendert

**Nichts.** Das Basic-Auth-Gate (`src/wiring/auth-gate.js`) mountet in `buildApp` weiterhin **vor** allen Routen und antwortet einer Anfrage ohne (oder mit falschen) Credentials weiterhin zuerst mit **401** + `WWW-Authenticate: Basic`. `internalOnly` liegt dahinter in der Kette und wird von diesem Aufrufer nie erreicht.

Der 403 von `internalOnly` wird **erst mit AUTH-P7** (Entfernen/Aufweichen des Basic-Auth-Gates) von aussen sichtbar. Heute ist er **ausschliesslich im Test bewiesen** (`test/auth-p5-internal-only.test.js`, Subtests AUTH-P5-1/-3, sowie `test/probe-auth-table.test.js` AUTH-P5-7) — nicht in Produktion beobachtbar, weil das Gate ihn nie erreichen laesst. Das ist am Code belegt: `scripts/probe-auth.sh` (misst ohne Sitzung/Credentials) bleibt unveraendert (`git diff` leer) und die Probe-Tabelle zeigt fuer die sieben Routen weiterhin `art=sitzung, status=401, antwortet=gate`.

## Die Annahme, die jetzt ein Gate traegt

Bisher war "der In-Process-MCP-Pfad laeuft ueber Loopback und wird deshalb vom Basic-Auth-Gate durchgelassen" ein **Nebeneffekt** ohne eigene Absicherung. Ab diesem Commit prueft `internalOnly` diese Annahme **aktiv** ueber `isTrustedLocalCaller` (die in AUTH-P3 reviewte Grenze: echter Loopback-Socket UND kein `X-Forwarded-For`). D.h. die Annahme "`isTrustedLocalCaller` liefert hinter Render fuer den In-Process-Pfad `true`" ist jetzt kein stiller Nebeneffekt mehr, sondern ein durchgesetztes Gate — und **falls diese Annahme in Produktion falsch ist** (z. B. Render haengt fuer den internen Aufruf doch einen `X-Forwarded-For`-Header an), schlaegt das Gate fail-closed zu und blockiert den eigenen MCP-Verkehr.

**Abbruchsignal live:** MCP-Tools in claude.ai liefern Fehler statt Daten → **sofortiger Rollback** (Revert, ein Commit). Sekundärer, vorab bekannter Beleg dafuer: eine Zeile `grund=not_local` im Render-Log fuer eine der sieben Routen (z. B. `path=/api/state grund=not_local`), obwohl niemand von aussen anfragt.

## Die sieben Routen mit Beleg

| Route | Datei:Position | Mechanik |
|---|---|---|
| `POST /api/calls` | `src/routes/api-calls.js:112` | `internalOnly` zwischen Pfad und async-Handler |
| `POST /api/calls/:id/cancel` | `src/routes/api-calls.js:369` | dito |
| `GET /api/calls/:id/consult` | `src/routes/api-calls.js:307` | dito |
| `POST /api/calls/:id/consult/answer` | `src/routes/api-calls.js:332` | dito |
| `GET /api/state` | `src/routes/api-read.js:61` | `internalOnly` zwischen Pfad und Handler |
| `GET /api/calls/:id` | `src/routes/api-read.js:97` | dito |
| `GET /api/tenant-data/export` | `src/routes/api-read.js:120` | dito |

Beleg: `node --check` je Datei, Testlauf AUTH-P5-1 (7 Subtests, alle gruen), zusaetzlich unabhaengig gegengeprueft im Safety-Review per Routengraph-Dump (`buildApp`, `storeBackend=pg`, 46 Routen) — genau sieben tragen `internalOnly`, jede an Position 0 der Handler-Kette, jede als benannter Stack-Eintrag (kein `<anonymous>`). Mutationsprobe M2 (internalOnly von `GET /api/state` entfernt) zeigte `route-auth-inventory` → `UNPROTECTED` + AUTH-P5-1-Subtest rot, danach zurueckgedreht.

## Die vier Audit-Stellen mit Grund-Token

Alle vier laufen ueber die eine Funktion `auditAuthFailed(req, grund)` in `src/util.js`, die ausschliesslich `req.path` verwendet (nie `req.originalUrl`):

| Token | Konstante | Schreibstelle | Ausloeser |
|---|---|---|---|
| `no_session` | `AUTH_FAILED_GRUND.NO_SESSION` | `src/web-auth.js`, `webAuthGateMiddleware`, 401-Zweig | `resolveWebSession` → `null` |
| `not_active` | `AUTH_FAILED_GRUND.NOT_ACTIVE` | `src/web-auth.js`, `webAuthGateMiddleware`, 403-Zweig | `!statusAllowed(ctx.acct.status)` (suspended/closed) |
| `not_admin` | `AUTH_FAILED_GRUND.NOT_ADMIN` | `src/web-auth.js`, `adminOnlyMiddleware`, 403-Zweig | weder Admin-Rolle noch `ADMIN_EMAILS`-Treffer |
| `not_local` | `AUTH_FAILED_GRUND.NOT_LOCAL` | `src/wiring/internal-only.js` | `!isTrustedLocalCaller(req)` |

`grep -rn "originalUrl" src/util.js src/wiring/internal-only.js src/web-auth.js` bleibt leer (verifiziert). Abweichung von der Spec (D1: `grund=` statt `reason=`, D2: `not_active` statt `expired`) ist im Plan begruendet und im Safety-Review als C3 explizit benannt — bewusste, dokumentierte Abweichung, kein Defekt.

## Der W9-Leak-Test

AUTH-P5-3: `GET /api/state?session_id=XYZ&code=ABC` mit `X-Forwarded-For` → 403, Audit-Zeile `path=/api/state grund=not_local`, `stdout` enthaelt weder `XYZ` noch `ABC` noch `session_id`. Ergaenzend AUTH-P5-4 (webAuth ohne Cookie) und AUTH-P5-6 (adminOnly) pruefen dieselbe Eigenschaft auf den beiden anderen Audit-Pfaden. Mutationsprobe M3 (`req.path` → `req.originalUrl` in `auditAuthFailed`) liess genau diese drei Tests rot werden, danach zurueckgedreht. Im Safety-Review unabhaengig nachgemessen: kein einziges `?` im gesamten Server-Log nach demselben Angriff, auch prozentkodierte Varianten leaken nicht (da `req.path` nicht dekodiert und nie den Query traegt).

## Die Mutationsprobe

Fuenf Mutationen einzeln vorgefuehrt und zurueckgenommen:

- **M1** `internalOnly`-Rumpf → `return next();` → rot: AUTH-P5-1 (alle 7 Subtests), AUTH-P5-3, AUTH-P3-16, zwei umgestellte `security.test.js`-Faelle. `route-auth-inventory` blieb korrekt gruen (Middleware existiert weiterhin und ist benannt — das ist richtig so).
- **M2** `internalOnly` von `GET /api/state` entfernt → rot: `route-auth-inventory` meldet `UNPROTECTED`, AUTH-P5-1-Subtest fuer diese Route.
- **M3** `auditAuthFailed` liest `req.originalUrl` statt `req.path` → rot: genau AUTH-P5-3/-4/-6 (die drei W9-Tests).
- **M4** `isTrustedLocalCaller` → `isLocalSocket` in `internal-only.js` → rot: alle 7 AUTH-P5-1-Subtests + AUTH-P5-3 (die AM1-Regression, Loopback+XFF ginge wieder durch).
- **M5** die sieben Zeilen in `GATE_ONLY_ROUTES` stehen gelassen → rot: AUTH-P5-7.

Nach jeder Mutation `node --check` + Ruecknahme. Finaler `npm test`: 3790/3790 gruen (i18n-korrigiert 3770/3770).

## Angepasste Bestandstests mit Begruendung

| Test | alt | neu | Begruendung |
|---|---|---|---|
| `AUTH-P3-16` (`test/auth-p3-bootstrap-fallback.test.js`) | `GET /api/state` mit XFF → bewusst 200 ohne Owner-Daten | 403 + `assertGateAbsent` + `body.error`, kein `agent`-Feld | Die in P3 bewusst offen gelassene Luecke ist mit `internalOnly` strukturell geschlossen; ID/Titel-Praezedenz wie bei AUTH-P3-12 in P4 beibehalten. |
| `test/security.test.js` „extern mit korrekten Credentials" (`/api/state`) | 200 | Gate akzeptiert Credentials (kein 401, kein `www-authenticate`) UND Route liefert 403 | Subjekt des Tests ist das Gate, nicht die Route dahinter; Zusage wird praeziser, nicht schwaecher. |
| `test/security.test.js` „Loopback + X-Forwarded-For + korrekte Credentials" | 200 | identische Umstellung | dieselbe Begruendung, Proxy-simulierter Loopback-Fall. |
| `test/route-auth-inventory.test.js` „drei Auth-Middlewares..." | drei benannte Middlewares | vier (nur Titel) | reiner Zahlwort-Fix; die Assertion selbst iteriert `AUTH_MIDDLEWARE_NAMES` und deckt `internalOnly` automatisch ab. |
| `test/profiles.test.js` „extern: kein Tenant → 403" | 403 via `tenant_reject` | 403 via `internalOnly` (nur Kommentar ergaenzt) | keine Assertion geaendert; Kommentar darf dem Code nicht widersprechen. |
| `test/call-termination-order.test.js` (Quelltext-Marker) | Substring-Anker traf auf alte Handler-Zeile | Anker auf `internalOnly, async (req, res) =>` nachgezogen | **Nicht im Plan gelistet** — notwendige Kollateralkorrektur eines string-basierten Markers, keine neue Zusage, keine Assertion-Aenderung (als Abweichung im Impl-Report benannt). |

## Warum die Probe-Tabelle NICHT geaendert wurde

Am Code nachgeprueft, nicht nur behauptet: In `buildApp` mountet das Basic-Auth-Gate **vor** den Call-/Read-Routen. `scripts/probe-auth.sh` misst ausdruecklich den Fall "ohne Sitzung und ohne Credentials" — das Gate antwortet in diesem Fall mit 401, **bevor** `internalOnly` in der Kette ueberhaupt erreicht wird. Die sieben Zeilen der Probe-Tabelle bleiben daher faktisch `sitzung|…|401|gate`, unabhaengig davon, ob dahinter zusaetzlich `internalOnly` haengt. `git diff` auf `scripts/probe-auth.sh` ist leer. Der Test `test/probe-auth-table.test.js` (AUTH-P5-7) pinnt das als Regel, nicht als Absichtserklaerung: die sieben Routen sind aus `GATE_ONLY_ROUTES` entfernt, die Probe-Zeile bleibt trotzdem mit `art=sitzung, status=401, antwortet=gate` bestehen — eine Aenderung der Tabelle auf 403 waere heute ein **falscher** Befund gewesen (7 Abweichungen ohne echten Defekt) und wird erst mit AUTH-P7 (Gate faellt) korrekt.

## Safety-Urteil

**FREIGABE (approved: true).** Kernpunkte aus dem unabhaengigen Review:

- Alle sieben Routen tragen `internalOnly` genau einmal, fail-closed, keine zweite Vertrauensquelle.
- W9 haelt: `auditAuthFailed` ist die einzige Stelle, die die Log-Zeile baut, nutzt ausschliesslich `req.path`; unabhaengig mit `?session_id=XYZ&code=ABC` gegengemessen — kein `?` im gesamten Log.
- Die 403-Tests messen nachweislich nicht das Basic-Auth-Gate: `DASHBOARD_PASSWORD=""` in `BASE_ENV` macht das Gate in Tests **abwesend**, nicht umgangen (verifiziert per `assertGateAbsent`: kein 401, kein `www-authenticate`).
- In-Process-/MCP-Pfad lebt (AUTH-P5-2, inkl. echtem `tools/call`).
- Probe-Tabelle byte-identisch, Safety-Gates/Offenlegungssatz/Signaturpruefung nicht beruehrt (nicht im Diff).
- Sieben Concerns (C1–C7) protokolliert, keiner blockierend: C1 (echte, aber bewusst geparkte Regression in `scripts/check-setup.js` — meldet nach diesem Commit falsch-positiv "PUBLIC_URL antwortet nicht", Fix in eigener Mini-Phase vorgesehen), C2 (Doku `RUNBOOK-RESTORE.md` nicht nachgezogen), C3 (dokumentierte Spec-Abweichung `grund=`/`not_active`), C4 (vorbestehende Log-Injektions-Schwachstelle in `audit()`, durch diese Phase von 1 auf 4 Schreiber vergroessert, aber nicht neu eingefuehrt), C5 (geerbte Restluecke: leerer `X-Forwarded-For` gilt als vertrauenswuerdig — Eigenschaft von `isTrustedLocalCaller` aus AUTH-P3, nicht verbreitert), C6 (mehr Log-Rauschen durch `no_session` bei jedem 401, gewollt), C7 (Restrisiko `GATEWAY_URL`-Override, heute in Produktion nicht gesetzt).

## Clean-Code-Audit (S1–S4)

- **S1:** keine Funde.
- **S2:** keine Funde (Duplizierung vermieden: eine Konstante `AUTH_FAILED_GRUND`, eine Funktion `auditAuthFailed` fuer alle vier Schreibstellen, Test-Helfer `assertGateAbsent` in `test/helpers.js` konsolidiert statt dupliziert).
- **S3:** keine Funde.
- **S4:** eine kosmetische Randnotiz — `internal-only.js` koennte den Audit-Nebeneffekt im Funktionskopf-Kommentar noch expliziter benennen; nicht als echter Verstoss gewertet (Body ist 4 Zeilen, selbsterklaerend).

**Verdict:** PASS. `internalOnly` als benannte Funktionsdeklaration (bewusst gegen anonyme Arrow, wegen `handler.name` im Routen-Inventar-Test), Antwortform 403 `{error:"Forbidden"}` byte-identisch zu den anderen Middlewares, sieben neue Tests folgen Build-Operate-Check, ein Konzept pro Test. Isolierter Testlauf (git-archive-Checkout, node_modules symlinked): 96/96 gruen.

## Fix-Runden

Keine — der Impl-Report weist keine Fix-Runde aus; Plan → Implementierung → Safety-Review → Clean-Code-Audit liefen alle direkt auf PASS/FREIGABE ohne Nacharbeit. Die einzigen Abweichungen vom Plan (`test/call-termination-order.test.js`-Marker-Nachzug, `test/profiles.test.js` als Kommentar-Aenderung trotz fehlender Nennung in der finalen 13-Datei-Liste des Plans) sind im Impl-Report unter `deviations` benannt und mechanischer/kommentarischer Natur — keine neue Zusage, keine geaenderte Assertion.

## Was diese Phase NICHT belegt

- **Nicht belegt: dass sich am Produktions-Verhalten fuer externe Aufrufer heute etwas aendert.** Das Basic-Auth-Gate antwortet unveraendert zuerst mit 401; der 403 von `internalOnly` ist bis AUTH-P7 (Gate faellt/wird aufgeweicht) von aussen unerreichbar und ausschliesslich im Test nachgewiesen.
- **Nicht belegt: dass `isTrustedLocalCaller` in der echten Render-Produktionsumgebung fuer den In-Process-MCP-Aufruf tatsaechlich `true` liefert.** Das ist eine Annahme, die jetzt ein Gate traegt — nicht durch einen Live-Beweis in Produktion verifiziert, sondern durch Test + Code-Lesen (`boot.js:693`, `render.yaml`-Pruefung, dass `GATEWAY_URL` dort nicht gesetzt ist). Das Abbruchsignal (MCP-Tools liefern Fehler → Rollback) existiert exakt deshalb, weil dieser Beweis heute fehlt.
- **Nicht behoben: F1** — `npm run check` wird nach diesem Commit fuer den Tunnel-Vergleich falsch-positiv fehlschlagen (`scripts/check-setup.js` vergleicht `/api/state` durch den Tunnel, der jetzt XFF traegt, gegen den Loopback-Wert). Bewusst in eine eigene Mini-Phase verschoben, nicht in diesem Commit gefixt.
- **Nicht behoben: F2** — der `catch`-Zweig von `webAuthGateMiddleware` bleibt stumm (kein Audit, kein `console.error`) bei einem DB-Ausfall; sieht aus wie ein fehlendes Cookie.
- **Nicht behoben/aktualisiert: F4** — `docs/RUNBOOK-RESTORE.md` nennt `GET /api/state` weiterhin als manuellen Probe-Read; das liefert ab P7 von aussen 403.
- **Nicht abgesichert: F5** — ein manuell im Render-Dashboard gesetztes `GATEWAY_URL` auf einen entfernten Gateway wuerde alle sieben Routen fuer den stdio-MCP-Server unerreichbar machen; nicht dokumentiert, kein Gegenstueck gebaut.
- **Nicht Teil dieser Phase:** Aenderung an `src/wiring/auth-gate.js`, `src/app.js`, `scripts/probe-auth.sh`, `.env.example`, `render.yaml` — keine neue Dependency, kein Flag, keine Env-Variable.
