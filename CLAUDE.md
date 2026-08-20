# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Hermes

Autonomer Telefon-KI-Agent: Telnyx Voice, Claude (Haiku) als Gespraechs-Gehirn, optional OpenAI Realtime (Streaming-Audio), MCP-Server. Node.js (ESM), Express, kein Build-Step, kein TypeScript. Multi-Tenant, JSON- oder Postgres-Store, OAuth/OIDC-Auth. Nimmt echte Anrufe an und loest echte Anrufe/SMS aus (Kosten!), speichert Gespraechs-Transkripte.

## Kontext

Hermes ist ein persoenlicher KI-Telefonassistent, der Inbound-Anrufe entgegennimmt (Nachrichten, Termine) und Outbound-Anrufe im Auftrag des Besitzers fuehrt (z.B. Friseurtermin vereinbaren). Steuerbar ueber ein Web-Dashboard und als MCP-Connector direkt aus Claude.

**Vision: ein Produkt, das diesen Assistenten Millionen Menschen zugaenglich machen soll.** Jede nicht-triviale Entscheidung wird an diesem Anspruch gemessen — nachhaltig, sauber, skalierbar, kein Wegwerf-Code. Die einfachste funktionsfaehige Loesung bleibt das Ziel (kein BDUF, inkrementell), aber Seams/Abstraktionen werden so gebaut, dass sie Skala tragen.

Der Dienst laeuft oeffentlich erreichbar (Render) und telefoniert mit echten Menschen. Deshalb gilt erst recht bei Millionen-Skala: Sicherheits- und Kosten-Gates haben Prioritaet vor Features. Das Fundament ist Richtung Produktion gebaut (Provider-Abstraktion (Telnyx), Postgres-Store, Multi-Tenancy, OAuth/OIDC, Stripe-Billing, Onboarding/Provisioning). Verbliebene bewusste Vereinfachungen sind in README und `PLAN-SECURITY.md` dokumentiert und werden schrittweise gehaertet, nicht als dauerhaft akzeptiert — neue Abweichungen ebenfalls dort festhalten.

> Naming: **Hermes** = Produkt/Agent (so nennt sich der Assistent), **Sundartha** = Firma dahinter (`sundartha.com`). Der Code-/Doku-Rebrand (Track A) ist erledigt — kein `vodafone` mehr in `src/`. Repo-Verzeichnis, Render-Service, Brand-URL und einige Env-/Pfadnamen tragen aber noch `vodafone-agent`; der Infra-/URL-Cutover (Track B) steht separat aus und ist nicht Teil normaler Tasks.

## Workflow

Bei nicht-trivialen Tasks (3+ Schritte oder architektonische Entscheidungen): Lies `.claude/refs/workflow.md` und befolge die Regeln dort. Das ist keine Empfehlung, das ist Pflicht. Alles, was Calls, SMS, Auth oder Budget-Gates beruehrt, gilt automatisch als nicht-trivial.

### Aufraeumen nach einer gemergten Kette (Pflicht, gehoert in den Merge-Commit)

Phasen-Ketten produzieren ~14 Dateien pro Arbeitstag. Wer sie liegen laesst, zwingt jede kuenftige Session, 100 KB Prozesshistorie zu durchsuchen — und jeden Kickoff-Prompt, eine Nicht-lesen-Liste zu tragen. Deshalb: **ist eine Phase gemergt, verschwindet ihr Prozessmuell im selben Zug.**

- **Loeschen:** `tasks/<phase>-report.md`, `-workflow-report.md`, `-spec.md`, verbrauchte Kickoff-Prompts, ueberholte Uebergaben — und das per-run-Skript aus `.claude/workflows/runs/`. Die neueste Kopie bleibt als Vorlage.
- **Behalten:** der Kettenstand, offene Befunde, Betriebswissen (Flags/Env), aktive Kickoffs, `tasks/lessons.md`.
- **Reihenfolge ist nicht optional:** untrackte Doku erst committen, dann loeschen — sonst ist es fuer genau die Dateien unumkehrbar, die nie in der Historie waren. Vor dem Commit auf Secrets/PII pruefen, Dateien einzeln adden (nie `git add -A`).
- Verwaiste Verweise auf geloeschte Docs bleiben stehen; das ist Bestandspraxis, die Historie liegt in `git`.

Nur `CLAUDE.md`, `MEMORY.md` und `.claude/workflows/` (oberste Ebene) landen automatisch im Session-Kontext. `tasks/**`, `PLAN-*.md`, `docs/**` kosten **null** Token pro Session — hier geht es um Navigierbarkeit, nicht um Kontext. Wer Kontext sparen will, raeumt `.claude/workflows/` auf.

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
- `src/telephony/` — Provider-Abstraktion (DIP): `ports.js` (Schnittstellen), `registry.js` (Dispatch nach Provider), `directives.js`/`media-events.js`; Adapter unter `adapters/telnyx/*` (voice, render, media, messaging, numbers, signature). Neue Telefonie-/Provider-Logik laeuft ueber die Ports, NICHT direkt im Server.
- `src/bridge.js` — Audio-Bridge Media-Streams <-> OpenAI Realtime (nur `VOICE_ENGINE=realtime`); enthaelt als `HEIKLE STELLE` markierte Abschnitte (Barge-in, Call-Ende) — dort besonders vorsichtig editieren
- `src/claude.js` — Gespraechslogik (System-Prompts, Tool-Loop, Summaries), pro-Tenant ueber `tenantContext`; enthaelt den fest verdrahteten Offenlegungssatz. Der resiliente LLM-Seam `src/llm.js` (Timeout/Retry/Circuit-Breaker, P3b-R) sitzt davor.
- `src/mcp-tools.js` — MCP-Tool-Definitionen (sprechen mit der REST-API), `src/mcp-server.js` — stdio-Transport
- `src/store.js` + `src/store/` — Persistenz-Fassade ueber zwei Backends: `json.js` (`data/store.json`, gitignored; loeschen = lokaler Reset) und `pg.js` (Postgres, RLS). `defaults.js`/`state-ops.js`/`views.js`/`portal.js`; Backend via `STORE_BACKEND`. Multi-Tenant: pro-Tenant settings/calendar/usage/budget.
- `src/auth.js` / `src/web-auth.js` — MCP-Auth (Legacy-Token oder OAuth-OIDC via `jose`) bzw. Browser-Login (OIDC Auth-Code + PKCE); `src/audit-store.js`, `src/middleware.js`
- `src/billing/` (Stripe Hold/Capture + Metering, hinter `PAYMENT_ENABLED`), `src/onboarding.js`, `src/worker/provisioning.js`, `src/queue/` (Nummern-Provisioning, Queue-Backend memory/pg-boss)
- `src/config.js` — gesamte Konfiguration aus `.env`, inkl. Safety-Gates; `src/boot-guard.js`/`src/process-guards.js` (Start-/Prozess-Sicherungen)
- `public/` — statische Marken-Assets (`favicon.ico`, `brand/hermes-icon.png`), oeffentlich ausgeliefert; das Kunden-Dashboard ist die App-Shell aus `apps/web` unter `/app`

## Absolute Regeln

1. **SAFETY-GATES**: die per-Tenant-Verifikation als Outbound-Permit (Abo+KYC) und der globale Kill-Switch `OUTBOUND_FROZEN`, Denylist/Land-Gate/Stundenlimit, **die pro-Tenant-Kostendecke**, Max-Gespraechsdauer und die Provider-Signaturpruefung (Telnyx Ed25519, fail-closed) duerfen NIEMALS entfernt, aufgeweicht oder per Default umgangen werden. Neue Endpunkte, die Calls/SMS ausloesen koennen, brauchen dieselben Gates. (`ALLOWED_NUMBERS` ist seit dem outbound-p3-Cutover wirkungslos — der Key wird nicht mehr gelesen, s. `.env.example` und `src/config.js`. Die statische Allowlist ist NICHT das Gate, das hier geschuetzt wird.)

   **Owner-Entscheidung 2026-08-07 (C-P3): die Twilio-HMAC-Pruefung ist entfernt, das Gate
   selbst bleibt unangetastet.** Es existiert kein verbundener Twilio-Account; der
   Twilio-Zweig war Code, der nicht funktionieren wuerde, wenn man ihn anspraeche.
   Entfernt wurden gemeinsam: der Twilio-Zweig in `providerFromHeaders`, der Twilio-Zweig
   in `inboundSignatureVerifier` und `adapters/twilio/signature.js`.

   **Die Schutzwirkung sinkt dadurch nicht, sie steigt** — am laufenden Server gemessen
   (frisches Ed25519-Schluesselpaar, echte Signatur):

   | Request an `/voice/incoming` | vorher | nachher |
   |---|---|---|
   | kein Provider-Header | 403 | 403 |
   | `x-twilio-signature` | **200**, wenn der HMAC stimmte | **403, immer** |
   | Telnyx, Muell-Signatur | 403 | 403 |
   | Telnyx, gueltige Signatur | 200 | 200 |

   Es kommen strikt WENIGER Requests durch; kein unverifizierter Request wird angenommen.
   `providerFromHeaders` liefert fuer alles Unbekannte `null`, der Verifizierer `false`,
   die Middleware 403 — die fail-closed-Kette ist unveraendert.

   Zusaetzlich ist die Abdeckung dieses Gates **gestiegen**: den End-to-End-Beleg
   "gueltige Signatur -> 200" gab es bisher NUR Twilio-basiert. Er existiert jetzt erstmals
   fuer Telnyx ueber die echte HTTP-Route (`test/security.test.js`). Das ist die Haelfte,
   die kein Negativ-Test liefern kann: ein Gate, das alles ablehnt, besteht jeden
   Negativ-Test.

   **Preis, bewusst akzeptiert:** kommt je wieder ein Twilio-Account dazu, muss der
   Verifizierer neu gebaut werden (Historie: dieser Commit).

   `SKIP_TWILIO_SIGNATURE_CHECK` bleibt trotz des Namens: der Schalter ist der **globale**
   `/voice`-Bypass (`routes/voice.js`), kein Twilio-Schalter, und `boot-guard.js` haengt
   daran. Ein Rename ist eine eigene Entscheidung.

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

   **Owner-Entscheidung 2026-08-20 (OC): der Offenlegungssatz entfaellt bei einem Anruf an
   die eigene hinterlegte Nummer des anrufenden Tenants — und NUR dort; die
   KI-Kennzeichnung entfaellt dabei NICHT.** Eine Offenlegung
   gegenueber sich selbst leistet nichts: Artikel 50 EU AI Act schuetzt den Menschen, der
   nicht weiss, dass er mit einer KI spricht. Der Auftraggeber, dessen eigener Assistent
   ihn auf seiner eigenen hinterlegten Nummer anruft, ist dieser Mensch nicht. Der zweite
   Halbsatz ("Das Gespraech wird fuer meinen Auftraggeber zusammengefasst") ist ihm
   gegenueber sogar irrefuehrend — der Auftraggeber ist der Zuhoerer.

   Die Ausnahme ist ENG und fail-closed. Sie greift ausschliesslich, wenn ALLE folgenden
   Bedingungen gleichzeitig erfuellt sind, serverseitig geprueft, VOR dem Waehlen, einmal
   je Anruf und danach unveraenderlich am Anruf-Datensatz (`call.calleeIsOwner`):

   | Bedingung | Quelle |
   |---|---|
   | Der Tenant hat eine eigene Nummer hinterlegt | `store.tenantPrivateNumber(tenantId)` |
   | Das Ziel ist normalisiert | `ctx.to` nach dem `normalize_target`-Gate |
   | Ziel und eigene Nummer sind als E.164-String **exakt** gleich | `src/callee-is-owner.js` |
   | Der ANRUFENDE Tenant ist ausdruecklich gepinnt | `OWNER_SELF_CALL_TENANT_IDS` (Default leer = niemand) |
   | Der Schalter ist an | `OWNER_SELF_CALL_ENABLED` (Default `false`) |

   Alles andere ergibt Offenlegung: kein Treffer, fehlende Nummer, fehlender Tenant,
   nicht gepinnter Tenant, Praedikat-Fehler, Schalter aus, alter Anruf-Datensatz ohne das
   Feld. Der Vergleich ist strikte String-Gleichheit — kein Praefix-Match, kein Fuzzy,
   keine Normalisierung im Praedikat selbst (die ist vorgelagert und geteilt).

   **Was die Ausnahme NICHT tut: sie schaltet die KI-Kennzeichnung nicht ab.** Was
   entfaellt, ist der lange Dritt-Satz ("im Auftrag von ... wird zusammengefasst"). Die
   Owner-Eroeffnung nennt die Maschine weiterhin beim Namen ("hier ist dein
   KI-Assistent"). Grund: das Praedikat beweist, dass die gewaehlte NUMMER die hinterlegte
   Nummer des Tenants ist — nicht, dass die PERSON am Apparat der Auftraggeber ist. Ein
   Festnetz- oder Gemeinschaftsanschluss ist als eigene Nummer zulaessig
   (`normalizePrivateNumber` prueft E.164-Form, Denylist und Laendercode, sonst nichts,
   `src/store/state-ops.js:2127-2136`). Nimmt dort jemand anderes ab, muss der erste Satz
   trotzdem sagen, dass eine KI spricht.

   **Pflicht-Rueckfall im Anrufmoment:** stellt sich im Gespraech heraus, dass am Apparat
   nicht der Auftraggeber ist, spricht der Agent SOFORT den vollstaendigen
   Offenlegungssatz (Wortlaut aus `LOCALES.<lang>.disclosure`) und fuehrt das Gespraech im
   Dritt-Modus weiter. Diese Anweisung steht in JEDEM Owner-Prompt-Baustein (EL-Weg wie
   Budget-/Telnyx-Weg) und ist nicht optional.

   **Was NICHT erlaubt ist und nie erlaubt wird:** kein Client-Flag und kein
   MCP-Parameter entscheidet darueber (der Aufrufer nennt nur `to`, den Rest entscheidet
   der Server); kein KI-Ermessen ueber das Praedikat (das Praedikat ist rein, das Modell
   sieht nur das Ergebnis); kein Setting, das die Offenlegung fuer Dritte abschaltet;
   keine zweite Stelle, die dieselbe Frage noch einmal beantwortet.

   **Preis, bewusst akzeptiert:** die hinterlegte eigene Nummer ist heute Format- und
   land-validiert, aber NICHT eigentums-verifiziert (`normalizePrivateNumber`,
   `src/store/state-ops.js:2127-2136`), und sie ist ueber
   `POST /api/self-service/private-number` von JEDEM eingeloggten Tenant setzbar
   (`src/self-service-routes.js:401`, nur `webAuthMw`). Wer eine fremde Nummer hinterlegt,
   erreichte damit einen KI-Anruf ohne den vollen Offenlegungssatz an einen Dritten.
   Deshalb ist die Ausnahme zusaetzlich an eine ausdrueckliche Tenant-Allowlist gebunden:
   ein nicht gepinnter Account kann sie nicht ausloesen, egal was er eintraegt. Die
   Besitz-Verifikation ist als Launch-Blocker in `PLAN-SECURITY.md` eingetragen. Wird der
   Eintrag dort geschlossen, ohne dass die Verifikation gebaut ist, ist DIESE Ausnahme
   zurueckzunehmen — nicht der Eintrag.
3. **AUTH FAIL-CLOSED**: Neue Endpunkte sind **standardmaessig** hinter einer authentifizierten Identitaet — Browser-Session (`webAuthMw`, fuer Betreiber-Routen zusaetzlich `adminMw`) oder, fuer den In-Process-MCP-Pfad, `internalOnly` (`isTrustedLocalCaller`). Jede Ausnahme (wie `/voice`, `/mcp`, `/healthz`, `/api/plans`) braucht eine eigene Absicherung, eine Begruendung im Code-Kommentar **und** einen Eintrag in der Oeffentlich-Liste (`src/route-policy.js`); ohne beides schlaegt `test/route-auth-inventory.test.js` fehl. Credential-Vergleiche timing-sicher (`safeEqual`).
4. **SECRETS**: Nur ueber `.env` (lokal) bzw. Render-Dashboard. Niemals committen, niemals loggen, niemals in API-Responses oder MCP-Tool-Ausgaben leaken.
5. **AUDIO**: Audio laeuft NIEMALS durch MCP — nur Transkripte/Status.
6. **SCOPE**: NUR implementieren, was gefragt wurde.
7. **DEBUG**: IMMER erst Runtime-Output lesen (Server-Log, Telnyx-Portal-Debugger). Nie raten.

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

`npm test` und `npm run test:gates` partitionieren dieselbe Suite ueber `test/testbaenke-run.mjs`
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

Dritte Bahn, derselbe Mechanismus: `npm run test:abnahme` faehrt NUR die Abnahmekriterien
(Kennung `ABNAHME-<ID>` am Namensanfang, Muster `package.json` `config.abnahmePattern`) und endet
mit "x von y Abnahmekriterien erfuellt". Sie DARF rot sein — ein noch nicht gebautes Kriterium ist
keine Regression; jeder Fall nennt seinen Grund im Namen (`| ROT WEIL: ... | FIX: ...`). Wird ein
Kriterium gruen, legt es die Kennung ab, bekommt das Siegel `[abgenommen <ID>]` und einen Eintrag in
`test/abnahme-ausgewandert.json`; ab da haelt `npm test` es fest — die Zahl der Ausgewanderten darf
nie sinken (`.fortschritt.md` D13). Die Invariante oben gilt ueber alle drei Baenke.

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
