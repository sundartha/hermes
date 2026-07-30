# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Hermes

Autonomer Telefon-KI-Agent: Twilio + Telnyx Voice, Claude (Haiku) als Gespraechs-Gehirn, optional OpenAI Realtime (Streaming-Audio), MCP-Server. Node.js (ESM), Express, kein Build-Step, kein TypeScript. Multi-Tenant, JSON- oder Postgres-Store, OAuth/OIDC-Auth. Nimmt echte Anrufe an und loest echte Anrufe/SMS aus (Kosten!), speichert Gespraechs-Transkripte.

## Kontext

Hermes ist ein persoenlicher KI-Telefonassistent, der Inbound-Anrufe entgegennimmt (Nachrichten, Termine) und Outbound-Anrufe im Auftrag des Besitzers fuehrt (z.B. Friseurtermin vereinbaren). Steuerbar ueber ein Web-Dashboard und als MCP-Connector direkt aus Claude.

**Vision: ein Produkt, das diesen Assistenten Millionen Menschen zugaenglich machen soll.** Jede nicht-triviale Entscheidung wird an diesem Anspruch gemessen — nachhaltig, sauber, skalierbar, kein Wegwerf-Code. Die einfachste funktionsfaehige Loesung bleibt das Ziel (kein BDUF, inkrementell), aber Seams/Abstraktionen werden so gebaut, dass sie Skala tragen.

Der Dienst laeuft oeffentlich erreichbar (Render) und telefoniert mit echten Menschen. Deshalb gilt erst recht bei Millionen-Skala: Sicherheits- und Kosten-Gates haben Prioritaet vor Features. Das Fundament ist Richtung Produktion gebaut (Provider-Abstraktion Twilio+Telnyx, Postgres-Store, Multi-Tenancy, OAuth/OIDC, Stripe-Billing, Onboarding/Provisioning). Verbliebene bewusste Vereinfachungen sind in README und `PLAN-SECURITY.md` dokumentiert und werden schrittweise gehaertet, nicht als dauerhaft akzeptiert — neue Abweichungen ebenfalls dort festhalten.

> Naming: **Hermes** = Produkt/Agent (so nennt sich der Assistent), **Sundartha** = Firma dahinter (`sundartha.com`). Der Code-/Doku-Rebrand (Track A) ist erledigt — kein `vodafone` mehr in `src/`. Repo-Verzeichnis, Render-Service, Brand-URL und einige Env-/Pfadnamen tragen aber noch `vodafone-agent`; der Infra-/URL-Cutover (Track B) steht separat aus und ist nicht Teil normaler Tasks.

## Workflow

Bei nicht-trivialen Tasks (3+ Schritte oder architektonische Entscheidungen): Lies `.claude/refs/workflow.md` und befolge die Regeln dort. Das ist keine Empfehlung, das ist Pflicht. Alles, was Calls, SMS, Auth oder Budget-Gates beruehrt, gilt automatisch als nicht-trivial.

## Code-Qualitaet

Bei nicht-trivialen Code-Aenderungen ist `.claude/refs/clean-code.md` zu lesen und zu befolgen. Pflicht, nicht Empfehlung.

Trivial — und nur diese Faelle duerfen ohne Lesen des Dokuments bearbeitet werden:

- Tippfehler in Kommentaren, Strings oder Dokumentation
- Reines Formatting (Whitespace, Klammern, Semikolons)
- Imports sortieren oder ungenutzte entfernen
- Reines Umbenennen eines bestehenden Symbols, ohne strukturelle Aenderung

Alles andere ist nicht-trivial. Insbesondere: neue Funktion/Datei, Logik-Aenderung, Refactoring (auch verhaltens-erhaltend), Bug-Fix mit Verhaltens-Aenderung.

### Richtwerte (kein Hook in diesem Repo — Selbstdisziplin)

| Heuristik             | Obergrenze | Ziel (anstreben)  |
| --------------------- | ---------- | ----------------- |
| Verschachtelungstiefe | 4          | 2                 |
| Funktionslaenge       | 100 Zeilen | deutlich darunter |
| Argumente             | 3          | 0-2               |

Hart verboten: Magic Numbers (ausser 0/1/-1) ohne benannte Konstante, toter Code, auskommentierter Code, neue abgeschaltete Sicherungen (`eslint-disable`-artige Marker, uebersprungene Checks).

## Architektur

Gateway + Schichten (Node/ESM, kein Build-Step). Zwei Voice-Engines: `budget` (turn-basiert, Gather/STT — der heute live laufende Default) und `realtime` (Streaming-Audio ueber `bridge.js`).

- `src/server.js` — Gateway: Provider-Webhooks (`/voice/*`), REST-API (`/api/*`), MCP ueber Streamable HTTP (`/mcp`), Auth-Middleware, Onboarding-/Self-Service-Routen
- `src/telephony/` — Provider-Abstraktion (DIP): `ports.js` (Schnittstellen), `registry.js` (Dispatch nach Provider), `directives.js`/`media-events.js`; Adapter unter `adapters/twilio/*` und `adapters/telnyx/*` (voice, render, signature, media, messaging, numbers). Neue Telefonie-/Provider-Logik laeuft ueber die Ports, NICHT direkt im Server.
- `src/bridge.js` — Audio-Bridge Media-Streams <-> OpenAI Realtime (nur `VOICE_ENGINE=realtime`); enthaelt als `HEIKLE STELLE` markierte Abschnitte (Barge-in, Call-Ende) — dort besonders vorsichtig editieren
- `src/claude.js` — Gespraechslogik (System-Prompts, Tool-Loop, Summaries), pro-Tenant ueber `tenantContext`; enthaelt den fest verdrahteten Offenlegungssatz. Der resiliente LLM-Seam `src/llm.js` (Timeout/Retry/Circuit-Breaker, P3b-R) sitzt davor.
- `src/mcp-tools.js` — MCP-Tool-Definitionen (sprechen mit der REST-API), `src/mcp-server.js` — stdio-Transport
- `src/store.js` + `src/store/` — Persistenz-Fassade ueber zwei Backends: `json.js` (`data/store.json`, gitignored; loeschen = lokaler Reset) und `pg.js` (Postgres, RLS). `defaults.js`/`state-ops.js`/`views.js`/`portal.js`; Backend via `STORE_BACKEND`. Multi-Tenant: pro-Tenant settings/calendar/usage/budget.
- `src/auth.js` / `src/web-auth.js` — MCP-Auth (Legacy-Token oder OAuth-OIDC via `jose`) bzw. Browser-Login (OIDC Auth-Code + PKCE); `src/audit-store.js`, `src/middleware.js`
- `src/billing/` (Stripe Hold/Capture + Metering, hinter `PAYMENT_ENABLED`), `src/onboarding.js`, `src/worker/provisioning.js`, `src/queue/` (Nummern-Provisioning, Queue-Backend memory/pg-boss)
- `src/config.js` — gesamte Konfiguration aus `.env`, inkl. Safety-Gates; `src/boot-guard.js`/`src/process-guards.js` (Start-/Prozess-Sicherungen)
- `public/` — Dashboards (statisches HTML/JS, pollt `/api/state`): `index.html` (Owner) + `tenant.html` (Tenant-Self-Service)

## Absolute Regeln

1. **SAFETY-GATES**: die per-Tenant-Verifikation als Outbound-Permit (Abo+KYC) und der globale Kill-Switch `OUTBOUND_FROZEN`, Denylist/Land-Gate/Stundenlimit, **die pro-Tenant-Kostendecke**, Max-Gespraechsdauer und die Provider-Signaturpruefung (Twilio HMAC + Telnyx Ed25519, fail-closed) duerfen NIEMALS entfernt, aufgeweicht oder per Default umgangen werden. Neue Endpunkte, die Calls/SMS ausloesen koennen, brauchen dieselben Gates. (`ALLOWED_NUMBERS` ist seit dem outbound-p3-Cutover wirkungslos — der Key wird nicht mehr gelesen, s. `.env.example` und `src/config.js`. Die statische Allowlist ist NICHT das Gate, das hier geschuetzt wird.)

   **Owner-Entscheidung 2026-07-30 (E10): `MAX_BUDGET_EUR` ist KEIN geschuetztes Gate mehr.** Die
   Plattform-Achse wird zur Beobachtung (Messung + Schwellenwarnung); ihre Sperrwirkung entfaellt
   (KS-P9). Begruendung: ein statischer, geteilter Geldtopf kann "wir wachsen" und "etwas ist
   kaputt" nicht unterscheiden — er blockiert entweder das Geschaeft oder verpasst den Weglauf,
   und er muss bei jedem Wachstumsschritt von Hand nachgezogen werden. Der Weglauf-Fall bleibt
   gedeckt, aber an der richtigen Stelle: Outbound setzt Abo+KYC voraus (am Code belegt,
   `state-ops.js:1149`, `activation.js:87`, `outbound-gates.js:317`) — ein unverkaufter Tenant
   erzeugt keine Carrier-Kosten; DID-Vermehrung deckeln `MAX_NUMBERS` (plattformweit) und
   `MAX_NUMBERS_PER_TENANT`. Der bewusste Notaus bleibt `OUTBOUND_FROZEN`.

   Die pro-Tenant-Kostendecke sperrt weiterhin BEIDE Richtungen, Inbound eingeschlossen. Eine
   Lockerung fuer Inbound war 2026-07-30 vorgeschlagen (E11) und ist **zurueckgezogen**: die
   Begruendung war falsch. Ein Inbound-Gespraech ist nicht kostenlos — die KI-Token werden in
   jeder Schleifenrunde live auf genau die Achse gebucht, die `budgetExceeded` liest
   (`claude.js:659/:775` -> `llm-usage.js:66` -> `bookCents`). Ohne dieses Gate kann eingehender
   Verkehr die Tenant-Decke unbegrenzt ueberziehen. Nicht ohne ausdrueckliche Owner-Entscheidung
   anfassen.
2. **OFFENLEGUNG**: Der Offenlegungssatz bei Outbound-Calls (`disclosureSentence`) bleibt fest verdrahtet als allererster Satz — kein KI-Ermessen, kein Setting, das ihn abschaltet.
3. **AUTH FAIL-CLOSED**: Neue Endpunkte sind standardmaessig hinter Basic-Auth; Ausnahmen (wie `/voice`, `/mcp`, `/healthz`) brauchen eine eigene Absicherung und eine Begruendung im Code-Kommentar. Credential-Vergleiche timing-sicher (`safeEqual`).
4. **SECRETS**: Nur ueber `.env` (lokal) bzw. Render-Dashboard. Niemals committen, niemals loggen, niemals in API-Responses oder MCP-Tool-Ausgaben leaken.
5. **AUDIO**: Audio laeuft NIEMALS durch MCP — nur Transkripte/Status.
6. **SCOPE**: NUR implementieren, was gefragt wurde.
7. **DEBUG**: IMMER erst Runtime-Output lesen (Server-Log, Twilio-Debugger). Nie raten.

## Pre-Mortem vor Entscheidungen

Vor jeder nicht-trivialen Entscheidung, jedem Plan und jeder Architektur-Wahl: **versetz dich ein Jahr in die Zukunft und nimm an, die Entscheidung war falsch — das Feature ist gescheitert, der Umbau hat Schaden angerichtet.** Frage rueckwaerts: _Was ist passiert? Was hat dazu gefuehrt?_ Die so gefundenen Risiken benennst du **vor** der Umsetzung — entweder entschaerfen oder bewusst als akzeptiertes Risiko festhalten. In diesem Repo heisst das konkret: Was passiert, wenn der Agent jemanden ungewollt anruft, Kosten explodieren oder Transkripte leaken?

## Wurzel statt Symptom

Bei Bugs, unerwarteten Fehlern oder wiederkehrenden Issues: Ursache statt Symptom beheben. Erst einen Feedback-Loop bauen (Server lokal starten, mit `curl`/Smoke-Test reproduzieren), falsifizierbare Hypothese, dann Fix. Telefonie-Bugs lassen sich fast immer ohne echten Anruf reproduzieren: `/voice/*` laesst sich lokal mit `SKIP_TWILIO_SIGNATURE_CHECK=true` und `curl` durchspielen.

## Kommunikation

**Niemals raten. Bei Unsicherheit fragen.** Eine Annahme zu treffen ist immer schlechter, als nachzufragen — auch wenn die Frage trivial wirkt.

- Direkt und konkret, ohne Hoeflichkeits-Floskeln
- Status-Updates waehrend laengerer Tool-Call-Ketten kurz halten

## Nach Compaction / Session-Start

1. Lies die relevanten Quelldateien NEU — verlass dich NICHT auf Compaction-Zusammenfassungen
2. KEINE Annahmen ueber Dateiinhalte — lies die Dateien

## Vor Edits

- Lies die Datei oder relevanten Bereiche zuerst (kein Edit ohne vorheriges Read)
- Bei Funktions-Aenderungen: grep nach allen Callern (Tools werden von Budget-Engine UND Realtime-Bridge genutzt!)
- Nach Edits: `node --check src/<datei>.js`, dann `npm test`; bei Bedarf zusaetzlich Smoke-Test (Server starten, `curl /healthz`, betroffene Routen)
- Bei sicherheitsrelevanten Aenderungen: `PLAN-SECURITY.md` aktualisieren

## Konventionen

- ESM (`import`/`export`), kein Build-Step — das bleibt so
- Kommentare auf Deutsch, OHNE Umlaute (ue/oe/ae) — wie im Bestand
- Wenige Dependencies, bewusst gehalten — neue nur mit Begruendung
- Env-Variablen immer in `src/config.js` zentralisieren UND in `.env.example` dokumentieren; fuer Render zusaetzlich `render.yaml` pruefen

## Befehle

```
Start:        npm start              (Gateway + Dashboard + MCP-HTTP)
MCP (stdio):  npm run mcp
Setup-Check:  npm run check
Tests:        npm test               (Regressionsschutz, MUSS gruen sein - rot heisst: etwas ist kaputt)
Launch-Gates: npm run test:gates     (i18n-Launch-Testkatalog, DARF rot sein - rot heisst: offener Produktbefund vor dem Start)
Syntax:       node --check src/server.js
Lokal testen: PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start  + curl
```

Test-Suite: `node:test` ohne zusaetzliche Dependencies, Tests in `test/*.test.js`. Integrationstests starten den Server als Kindprozess mit `PORT=0` und `DATA_DIR`-Override (Temp-Verzeichnis) — `data/store.json` wird nie angefasst. Neues Verhalten braucht einen Test; der manuelle Smoke-Test bleibt fuer alles, was Tests nicht abdecken (echte Telefonie, Dashboard-Optik).

`npm test` und `npm run test:gates` partitionieren dieselbe Suite ueber `test/i18n-catalog-run.mjs`
(node:test `--test-skip-pattern`/`--test-name-pattern` gegen `package.json` `config.i18nCatalogPattern`).
Jeder i18n-Launch-Testkatalog-Test traegt seine Katalog-ID (z.B. `GAP-18`, `PROMPT-01`) am
Namensanfang — das ist die einzige Zuordnungsregel, keine gepflegte Liste. `npm test` schliesst
diese Tests aus, weil kein roter Test in diesem Katalog ein Regressionsfang ist; `test:gates`
faehrt NUR sie (inkl. gruener Mechanismus-Tests als Regressionsschutz).

Die Invariante der Trennung ist nicht eine feste Gesamtzahl, sondern: **beide Laeufe zusammen
ergeben denselben Testbestand wie ein ungefilterter `node --test "test/*.test.js"`** — der Split
verliert und dupliziert nichts. Bei der Einfuehrung nachgerechnet: 2930 + 114 = 3044 (dazu die 10
Selbsttests in `test/i18n-catalog-run.test.js`, die die Wrapper-Logik abdecken und
regressionsseitig mitzaehlen).

## Referenzen

- `.claude/refs/workflow.md` — Pflicht bei nicht-trivialen Tasks (Plan Mode, Subagents, Verifikation, `tasks/todo.md` + `tasks/lessons.md`)
- `.claude/refs/clean-code.md` — Code-Qualitaetsregeln (Pruefkatalog) bei nicht-trivialen Edits
- `PLAN-SECURITY.md` — Sicherheits-Plan in Phasen (Phase 1 umgesetzt); bei Security-Arbeit zuerst lesen
- `README.md` — Setup, Engines, bewusste Vereinfachungen/Abweichungen
- `STATUS.md` — offene Punkte / Status (abgeschlossene Phasen stehen in der Git-History)
- `ONBOARDING.md` — Einstieg fuer Mitarbeiter
- `.env.example` — alle Env-Variablen mit Erklaerung
- `render.yaml` — Render-Deployment (Blueprint)

## Marketing-Website (`apps/web`): Lab -> Live

Design-/Content-Aenderungen an der Website laufen ueber den `staging`-Branch
und den Render-Service `hermes-web-staging` (Labor: Auto-Deploy, noindex,
gespiegelte Live-CSP). Live geht es NUR ueber Merge auf `master` + manuellen
Deploy von `hermes-web`. Vor Website-Arbeit `docs/RUNBOOK-LAB-LIVE.md` lesen.
