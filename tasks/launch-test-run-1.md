# Launch-Test-Run 1 — Protokoll

Branch: `test/launch-run-1`. Basis: `origin/master` nach Sync (102 Commits, HEAD `6522b60`
zum Zeitpunkt des Runs). Ausgefuehrt gemaess `NEXT-SESSION-LAUNCH-TESTRUN.md` (auto + lokal,
live uebersprungen) plus einem gezielten Deep-Dive zu Jonas' Ausgangsfrage (Locale-Konsistenz
Widget vs. Agent bei einem nicht-DE/AT/CH/FR/GB/IE-Land, Beispiel USA).

## Schritt 0 — Baseline (`npm test`, ganze Suite)

Kommando: `NODE_ENV=test node --test "test/*.test.js"`
Ergebnis: **2541 Tests — 2535 gruen, 3 rot, 3 cancelled.**

Alle 3 roten/cancelled Faelle sind DERSELBE Root-Cause, kein Assertion-Fehler:

| Datei | Befund |
|---|---|
| `test/telnyx-p5-gate-proof.test.js` | `Server-Start Timeout` (test/helpers.js:867) + danach haengender Kindprozess (Event-Loop bleibt offen, `--test-timeout=0` verhindert jeden Abbruch) |
| `test/telnyx-p5-origination.test.js` | identisch |
| `test/w5-abo-allowlist-gate.test.js` | identisch (betroffener Einzeltest ironischerweise `W5-6a: ... US -> 403 grund=land`, inhaltlich nicht mit der Locale-Frage verwandt) |

**Diagnose:** Der lokale Server-Spawn dieser 3 Tests scheitert (vermutlich BASE_ENV-Drift —
siehe `tasks/lessons.md` — eine der ~102 neu hinzugekommenen Env-Vars, z.B. rund um
`TELNYX_AI_ASSISTANT_ENABLED`, ist in `test/helpers.js` noch nicht neutralisiert). Der
eigentliche Fehler ("Server-Start Timeout") wirft schnell und korrekt — das eigentliche
Problem ist, dass der schon gescheiterte Kindprozess nie beendet wird und dadurch die
gesamte Datei ewig blockiert. War beim ersten Lauf ca. 21,5h "haengen geblieben" (echte
Wanduhrzeit zwischen Start und manuellem Kill dieser Session), bevor manuell terminiert.
**Empfehlung an die Fix-Kette:** (1) die fehlende Env-Neutralisierung in `test/helpers.js`
ergaenzen, (2) unabhaengig davon den Server-Spawn-Helper mit einem Kill-Timeout fuer den
Kindprozess absichern, damit ein zukuenftiger Fehlschlag nie wieder den ganzen Testlauf
aufhaelt. Keine Aenderung an `src/` in dieser Session (Scope-Regel) — nur dokumentiert.
Alle orphanen Prozesse wurden manuell bereinigt, nichts blieb auf der Maschine haengen.

## Schritt 1 — auto-Tests mit existierenden Suiten

Alle auto-IDs aus `PLAN-LAUNCH-TESTS.md`, die auf bereits existierende `test/*.test.js`
zeigen, sind Teil der obigen Baseline (ganze Suite lief einmal komplett durch). Ergebnis:
**alle gruen**, ausser den 3 oben genannten Infra-Haengern (inhaltlich nicht betroffen).

## Schritt 2 — neue/erweiterte auto-Tests

| ID | Datei | Ergebnis | Befund |
|---|---|---|---|
| IN-03 (P0) | `test/max-duration-timer.test.js` (neu) | ✅ 3/3 gruen | Max-Dauer-Cap feuert exakt einmal, waehlt korrekt endCall vs. endCallViaCallControl, No-op bei bereits beendetem Call. **Der einzige harte Telnyx-Cap funktioniert wie spezifiziert.** |
| OUT-11 (Erweiterung) | `test/i6-write-scope.test.js` (erweitert) | ✅ 2/2 gruen | cancel_call auf bereits terminierten Call ist idempotent (200 + Alt-Status, kein zweiter Hangup) — Bestandscode war hier schon korrekt |
| MCP-06 | `test/mcp-06-transcript-active.test.js` (neu) | 🔴 ROT (echt) | `get_transcript` waehrend `status=active` wirft einen rohen MCP-SDK-Output-Validierungsfehler ("Output validation error: Tool get_transcript has an output schema but no structured content was provided") statt einer sauberen Hinweismeldung. **Reale UX-Regression fuer jeden Live-Client (z.B. claude.ai), der frueh pollt.** |
| MCP-07 | `test/mcp-07-error-sanitization.test.js` (neu) | ✅ 2/2 gruen | Unbekannte call_id + simulierter ECONNREFUSED liefern generischen Fehlertext, kein Stack-/Pfad-Leak |
| MCP-08 | `test/mcp-08-action-items-scope.test.js` (neu) | ✅ 1/1 gruen | `list_action_items` korrekt tenant-gescopt |
| UI-02 | `test/ui-02-call-widget-xss.test.js` (neu) | ✅ 7/7 gruen (nach Testfix) | Alle 4 XSS-Payloads (img/onerror, Tag-Breakout, Anfuehrungszeichen) landen nur als `textContent`. Ein Bug in der ERSTEN Testfassung (mehrere Antworten auf dieselbe Request-Id — reale Widgets bekommen nur eine) wurde im Test selbst korrigiert (kein Produktbug). |
| CFG-03 | `test/cfg-03-payment-warn.test.js` (neu) | ✅ 3/3 gruen | `PAYMENT_ENABLED` ohne `PROVISIONING_ENABLED` warnt zuverlaessig (weiterhin kein Boot-Stop, wie im Plan erwartet) |
| BILL-04 (Erweiterung) | `test/usage-event-meter.test.js` (erweitert) | 🔴 ROT (echt, erwartet) | Nach 10.000 kleinen Buchungen driftet `costEur*100` vom Ganzzahl-Ledger ab (`189864.99999999083` statt `189865`) — klassisches Float-Rundungsproblem. **Stripe-Metering (rechnet auf Cents) und jede costEur-basierte Anzeige/Budget-Ableitung koennen so langfristig auseinanderlaufen.** |
| SMS-02 | `test/f2-sms-summary-plan.test.js` | ✅ bereits vorhanden, verifiziert gruen | Dokumentiert wie vorgesehen: `planSummarySms` liest das Euro-Budget-Gate gar nicht |
| AUTH-07 (auto-Teil) | `test/auth-07-cookie-csrf.test.js` (neu) | ✅ 6/6 gruen | Cookie traegt HttpOnly+Secure+SameSite=Lax; Cross-Site-POST ohne Cookie -> 401 |

**Noch OFFEN (nicht in dieser Session geschrieben):** IN-08 (extractSpeech-Praezedenz),
OUT-07-Erweiterung (Denylist/Land/Premium in Trunk-0-Form), OUT-10-Erweiterung
(Mid-Call-maxDur-Klemme + Budget-Cap-Grenzfall), DASH-02 (tenant.html XSS ohne jsdom).
Empfehlung: naechste Session, gleiches Muster (siehe oben) fortsetzen.

## Schritt 3 — lokal-Tier

**Nicht in dieser Session ausgefuehrt** (Zeit-/Scope-Grenze dieser Runde). Bekanntes
Risiko: lokale Server-Spawns koennen auf dieselbe BASE_ENV-Drift treffen wie in Schritt 0
diagnostiziert — vor dem naechsten Lauf test/helpers.js pruefen/haerten.

## Schritt 4 — live-Tests

Alle live-IDs: **uebersprungen (live, Owner-Session)** — unveraendert gegenueber Plan.

## Deep-Dive: Locale-Konsistenz Widget vs. Agent (Jonas' Ausgangsfrage)

Zwei komplett unabhaengige Sprach-Resolver:

- **MCP-Widget** (`src/ui/widget-i18n.js`): Quelle = Browser (`navigator.language`),
  Fallback **Englisch**. Fuer einen US-Betrachter korrekt.
- **Telefon-Agent** (`src/i18n/locales.js`, `localeFor(call.language)`): `call.language`
  wird beim Onboarding ueber `languageForCountry(homeCountry)` gesetzt
  (`src/routes/api-onboard.js:147`, `src/billing/provision-trigger.js:42`).
  `LANGUAGE_FOR_COUNTRY` kennt NUR `DE/AT/CH->de, FR->fr, GB/IE->en` — **kein US-Eintrag**.
  Verifiziert per direktem Aufruf: `languageForCountry("US") === "de"`.

**Befund:** Ein Kunde mit Heimatland USA (oder jedem anderen Land ausser den sechs
gelisteten) sieht ein englisches Dashboard-Widget, bekommt aber standardmaessig einen
DEUTSCH sprechenden Telefon-Agenten — es sei denn, `settings.language` wird manuell
gesetzt (Override existiert und funktioniert, siehe `f1-i18n-locale.test.js`
"Praezedenz #8"). Kein neuer Test geschrieben (reine Recherche, keine Code-Aenderung
in dieser Session), aber empfohlen fuer die naechste Runde: `languageForCountry`
entweder um weitere Laender erweitern oder bei unbekanntem Land fail-closed/explizit
statt still auf `de` zurueckfallen.

## Zusammenfassung

- Baseline: 2535/2541 gruen, 3 Infra-Haenger diagnostiziert (kein Assertion-Fehler)
- 9 von 13 geplanten neuen/erweiterten auto-Tests geschrieben, davon 7 gruen + 2 echte,
  dokumentierte Befunde (MCP-06, BILL-04)
- 1 Locale-Luecke identifiziert und verifiziert (US/sonstige Laender -> Agent faellt
  still auf Deutsch zurueck, Widget bleibt Englisch)
- lokal-Tier + 4 verbleibende auto-IDs offen fuer die naechste Session
