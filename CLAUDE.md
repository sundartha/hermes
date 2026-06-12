# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Vodafone Agent

Autonomer Telefon-KI-Agent: Twilio Voice + Claude (Haiku) + MCP-Server. Node.js (ESM), Express, kein Build-Step, kein TypeScript. Nimmt echte Anrufe an und loest echte Anrufe/SMS aus (Kosten!), speichert Gespraechs-Transkripte.

## Kontext

Du arbeitest an einem Demo-Prototyp fuer Vodafone: ein persoenlicher KI-Telefonassistent, der Inbound-Anrufe entgegennimmt (Nachrichten, Termine) und Outbound-Anrufe im Auftrag des Besitzers fuehrt (z.B. Friseurtermin vereinbaren). Steuerbar ueber ein Web-Dashboard und als MCP-Connector direkt aus Claude.

Der Dienst laeuft oeffentlich erreichbar (Render) und telefoniert mit echten Menschen. Deshalb gilt: Sicherheits- und Kosten-Gates haben Prioritaet vor Features. Bewusste Prototyp-Vereinfachungen (JSON-Store statt DB, statisches Token statt OAuth) sind in README und `PLAN-SECURITY.md` dokumentiert — neue Abweichungen ebenfalls dort festhalten.

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

| Heuristik | Obergrenze | Ziel (anstreben) |
|---|---|---|
| Verschachtelungstiefe | 4 | 2 |
| Funktionslaenge | 100 Zeilen | deutlich darunter |
| Argumente | 3 | 0-2 |

Hart verboten: Magic Numbers (ausser 0/1/-1) ohne benannte Konstante, toter Code, auskommentierter Code, neue abgeschaltete Sicherungen (`eslint-disable`-artige Marker, uebersprungene Checks).

## Architektur

- `src/server.js` — Gateway: Twilio-Webhooks (`/voice/*`), REST-API (`/api/*`), MCP ueber Streamable HTTP (`/mcp`), Auth-Middleware
- `src/bridge.js` — Audio-Bridge Twilio Media Streams <-> OpenAI Realtime (nur `VOICE_ENGINE=realtime`); enthaelt als `HEIKLE STELLE` markierte Abschnitte (Barge-in, Call-Ende) — dort besonders vorsichtig editieren
- `src/claude.js` — Gespraechslogik (System-Prompts, Tool-Loop, Summaries); enthaelt den fest verdrahteten Offenlegungssatz
- `src/mcp-tools.js` — MCP-Tool-Definitionen (sprechen mit der REST-API), `src/mcp-server.js` — stdio-Transport
- `src/store.js` — JSON-Persistenz (`data/store.json`, gitignored; loeschen = Demo-Reset)
- `src/config.js` — gesamte Konfiguration aus `.env`, inkl. Safety-Gates
- `public/` — Dashboard (statisches HTML/JS, pollt `/api/state`)

## Absolute Regeln

1. **SAFETY-GATES**: Allowlist (`ALLOWED_NUMBERS`), Budget-Guard (`MAX_BUDGET_EUR`), Max-Gespraechsdauer und Twilio-Signaturpruefung duerfen NIEMALS entfernt, aufgeweicht oder per Default umgangen werden. Neue Endpunkte, die Calls/SMS ausloesen koennen, brauchen dieselben Gates.
2. **OFFENLEGUNG**: Der Offenlegungssatz bei Outbound-Calls (`disclosureSentence`) bleibt fest verdrahtet als allererster Satz — kein KI-Ermessen, kein Setting, das ihn abschaltet.
3. **AUTH FAIL-CLOSED**: Neue Endpunkte sind standardmaessig hinter Basic-Auth; Ausnahmen (wie `/voice`, `/mcp`, `/healthz`) brauchen eine eigene Absicherung und eine Begruendung im Code-Kommentar. Credential-Vergleiche timing-sicher (`safeEqual`).
4. **SECRETS**: Nur ueber `.env` (lokal) bzw. Render-Dashboard. Niemals committen, niemals loggen, niemals in API-Responses oder MCP-Tool-Ausgaben leaken.
5. **AUDIO**: Audio laeuft NIEMALS durch MCP — nur Transkripte/Status.
6. **SCOPE**: NUR implementieren, was gefragt wurde.
7. **DEBUG**: IMMER erst Runtime-Output lesen (Server-Log, Twilio-Debugger). Nie raten.

## Pre-Mortem vor Entscheidungen

Vor jeder nicht-trivialen Entscheidung, jedem Plan und jeder Architektur-Wahl: **versetz dich ein Jahr in die Zukunft und nimm an, die Entscheidung war falsch — das Feature ist gescheitert, der Umbau hat Schaden angerichtet.** Frage rueckwaerts: *Was ist passiert? Was hat dazu gefuehrt?* Die so gefundenen Risiken benennst du **vor** der Umsetzung — entweder entschaerfen oder bewusst als akzeptiertes Risiko festhalten. In diesem Repo heisst das konkret: Was passiert, wenn der Agent jemanden ungewollt anruft, Kosten explodieren oder Transkripte leaken?

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
- Nach Edits: `node --check src/<datei>.js`, dann Smoke-Test (Server starten, `curl /healthz`, betroffene Routen)
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
Syntax:       node --check src/server.js
Lokal testen: PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start  + curl
```

Kein Test-Framework vorhanden — Verifikation laeuft ueber Syntax-Check + manuellen Smoke-Test gegen den lokal gestarteten Server.

## Referenzen

- `.claude/refs/workflow.md` — Pflicht bei nicht-trivialen Tasks (Plan Mode, Subagents, Verifikation, `tasks/todo.md` + `tasks/lessons.md`)
- `.claude/refs/clean-code.md` — Code-Qualitaetsregeln (Pruefkatalog) bei nicht-trivialen Edits
- `PLAN-SECURITY.md` — Sicherheits-Plan in Phasen (Phase 1 umgesetzt); bei Security-Arbeit zuerst lesen
- `README.md` — Setup, Engines, bewusste Prototyp-Abweichungen
- `ONBOARDING.md` — Einstieg fuer Mitarbeiter
- `.env.example` — alle Env-Variablen mit Erklaerung
- `render.yaml` — Render-Deployment (Blueprint)
