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

**Runde 2 (fortgesetzt, gleiche Session-Fortfuehrung):**

| ID | Datei | Ergebnis | Befund |
|---|---|---|---|
| IN-08 | `test/in-08-first-turn-empty-speech.test.js` (neu) | ✅ 2/2 gruen | Praezedenz-Haelfte (SpeechResult vs. Transcript) bereits von `test/webhook-events.test.js` abgedeckt (kein neuer Test noetig). Neuer Fall: allererster Turn (nur Agent-Begruessung im Transkript, `callerHasSpoken=false`) + leeres SpeechResult -> es kommt DOCH zu einem LLM-Call (dokumentiertes Ist-Verhalten laut `src/claude.js`-Designkommentaren zum R4-Empty-Turn-Counter, keine Abweichung/Bug — Kontrasttest mit bereits vorhandener Caller-Zeile zeigt korrekt den No-Speech-Reprompt-Shortcut ohne LLM-Call) |
| OUT-07 (Erweiterung) | `test/number-gate.test.js` (erweitert, 24->26 Tests) | ✅ 26/26 gruen | Neuer Fall: Premium-Nummer in nationaler Schreibweise (`090012345678`) wird normalisiert UND landet am Denylist-Gate (403 grund=denylist), NICHT am Format-Gate (400/500) — Trunk-0-Aufloesung + Denylist-Reihenfolge korrekt verdrahtet |
| OUT-10 (Erweiterung) | `test/outbound-tenant.test.js` (erweitert) | ✅ 7/7 gruen | Teil 1 (max_duration_s-Klemmung auf 300s) bereits vollstaendig von `test/outbound-gates.test.js` abgedeckt. Teil 2 (Budget-Cap-Grenzfall) war bisher nur auf der reinen state-ops-Funktionsebene getestet (`tenant-budget-cap.test.js`) — neuer HTTP-Level-Test beweist: `costEur` EXAKT am Cap (8 EUR) blockt 402 ueber den vollen `/api/calls`-Pfad, knapp darunter (7,9 EUR) laesst den Call durch (kein Off-by-one in Route/Attribution) |
| DASH-02 | `test/dash-02-tenant-xss.test.js` (neu) | ✅ 12/12 gruen | tenant.html nutzt (anders als das call.html-Widget) tatsaechlich `innerHTML` mit Template-Strings — daher KEIN jsdom (Repo-Regel "keine neuen Dependencies"), sondern `node:vm`-Sandbox + direkte String-Pruefung auf dem resultierenden Markup (statt geparster DOM-Knoten). Alle 4 XSS-Payloads (img/onerror, Tag-Breakout, Anfuehrungszeichen einzeln/doppelt) landen in `renderCalls`/`callBody`/`renderNotifications`/`planCard` ausschliesslich escaped — inkl. Attribut-Breakout-Check fuer `data-plan="${esc(plan.slug)}"`. **Kein XSS-Fund.** |

Alle 4 in Runde 1 offen gelassenen auto-Tests sind damit erledigt. Neue Checkboxen in
`PLAN-LAUNCH-TESTS.md`: IN-03, OUT-11, MCP-07, MCP-08, UI-02, CFG-03, SMS-02 (Runde 1) +
OUT-07, OUT-10, DASH-02 (Runde 2). MCP-06 und BILL-04-Erweiterung bleiben bewusst offen
(echte Befunde). AUTH-07 nur der auto-Teil (Cookie/CSRF); der live-Teil bleibt offen.

## Schritt 3 — lokal-Tier (Runde 2)

Ausgefuehrt gegen einen ECHTEN lokalen Server (`node src/server.js`), NICHT gegen `data/store.json`
(NIE angefasst) — stattdessen `DATA_DIR=/tmp/hermes-lokal-run1` (bzw. `-prov01` fuer PROV-01)
als Scratch-Verzeichnis, `TELNYX_API_KEY`/`TWILIO_*` bewusst ungueltig, `PAYMENT_ENABLED=false`,
`PROVISIONING_ENABLED=false` (ausser bei PROV-01, das genau diese Flags braucht). Vor jedem
Server-Start wurde der Port sauber per PID-Kill (`lsof -ti:3999`) freigeraeumt, nach jedem Test
wurde ueberprueft, dass kein Prozess auf dem Server-Port haengen bleibt — keine Waisen-Prozesse
auf der Maschine zurueckgelassen. Ein frisch gestarteter Server verweigert OHNE aktive Nummer im
Store den Boot (`process.exit(1)`, by design, kein Bug) — daher vor jedem Lauf einmalig
`node scripts/bootstrap-tenant.js <e164> twilio` gegen dasselbe `DATA_DIR` (reine Store-Operation,
kein Netz).

| ID | Kommando/Ablauf | Ergebnis | Beleg |
|---|---|---|---|
| OUT-04 (P0) | `POST /api/calls` mit `to="+4915112345678"` (E.164) und mit `to="017612345678"` (national) | ✅ GRUEN | E.164-Form: `to` landet zeichengenau im Store (`"to": "+4915112345678"`), Originate scheitert erst offline (500, Twilio-Dummy-Creds) — Ziffern-Fidelity bewiesen. Nationale Form ohne aufloesbares Heimatland (Owner-DID ist `+1`, keine `privateNumber` gesetzt) -> sauber 400 "to muss E.164 sein", KEINE Regeneration/Raten |
| OUT-12 (P2) | identisch zu OUT-04b (selber Fall: US-DID + keine privateNumber) | ✅ GRUEN | Siehe oben — nationale 0 wird bei nicht aufloesbarem Heimatland korrekt abgelehnt (400), nicht geraten |
| OUT-09 (P1) | 3 Server-Neustarts: `MAX_BUDGET_EUR=0`, `MAX_CALLS_PER_HOUR=1`, `PER_TARGET_CALL_CAP=1` | ✅ GRUEN (3/3) | `MAX_BUDGET_EUR=0` -> 402 "Budget-Limit von 0 EUR erreicht"; `MAX_CALLS_PER_HOUR=1` -> 429 "Stundenlimit..." (Store hatte durch vorherige Tests bereits >=1 Call in der Stunde, daher blockte schon der 1. Request dieser Runde — Gate wirkte trotzdem korrekt fail-closed); `PER_TARGET_CALL_CAP=1` -> 1. Call an ein Ziel erreicht Originate (500 offline), 2. Call an DASSELBE Ziel -> 429 "Wiederhol-Limit..." |
| IN-07 (P2) | `POST /voice/turn` + `/voice/status` mit 5 Fuzzing-Bodies (fremdes JSON, leer, form-urlencoded mit Fantasie-Feldern, kaputtes/unparsebares JSON) | ✅ GRUEN | Alle Faelle sauber behandelt: unbekannte/leere Felder -> TeXML `<Hangup/>` (200), `/voice/status` -> "OK" (200), kaputtes JSON -> `{"error":"entity.parse.failed"}` (400, Express-Bodyparser-Fehlerpfad, kein Crash). Server lief nach allen 5 Faellen nachweislich weiter (Folge-Request 302 auf `/`) |
| SMS-01 (P0) | Voller Inbound-Flow `/voice/incoming` -> `/voice/turn` (Speech) -> `/voice/status` (CallStatus=completed, 2x hintereinander = Twilio-Retry simuliert) | 🟡 BLOCKIERT (Teilbeleg) | Der Dummy-Env hat keinen gueltigen `ANTHROPIC_API_KEY` (401 "API key is invalid") — die Summary-Generierung (Vorstufe der SMS-Planung in `finishCall`) schlaegt DAHER fehl, BEVOR `sendSms` ueberhaupt aufgerufen wird; der eigentliche SMS-Fehlerpfad ist so lokal nicht erreichbar, ohne einen echten LLM-Call zu riskieren (bewusst nicht gemacht). **Trotzdem werthaltiges Teilergebnis:** der doppelte `/voice/status`-Callback (Retry-Simulation) loeste NUR beim ERSTEN Mal einen Summary-Versuch aus (`[summary] 401` erscheint genau einmal im Log), der zweite (identische) Callback loeste KEINEN zweiten Versuch aus und der Server crashte nicht — die geforderte Idempotenz-/Sturm-Schutz-Eigenschaft ist an der unmittelbar vorgelagerten Stufe nachgewiesen, auch wenn der SMS-Schritt selbst nicht erreicht wurde |
| OBS-01 (P1) | `curl /metrics /api/metrics /debug/metrics`, je mit und ohne Basic-Auth | ✅ GRUEN | Alle 6 Kombinationen 404 (keine Route existiert, wie im Plan erwartet) |
| CFG-02 (P1) | Boot mit `RENDER_EXTERNAL_URL=https://x` + `SKIP_TWILIO_SIGNATURE_CHECK=true`; Kontrastprobe ohne `RENDER_EXTERNAL_URL` (mehrfach oben schon erfolgreich gebootet) | ✅ GRUEN | Mit `RENDER_EXTERNAL_URL` -> sauberer Boot-Refusal (Exit-Code 1, listet alle 3 verletzten Footguns inkl. MCP_AUTH=off + SKIP_TWILIO_SIGNATURE_CHECK + STORE_BACKEND!=pg, kein Listen auf dem Port). Ohne `RENDER_EXTERNAL_URL` -> normaler Boot (kein False-Positive, mehrfach in dieser Session demonstriert) |
| PROV-01 (P0) | `PROVISIONING_ENABLED=true STORE_BACKEND=json`, `POST /api/onboard` fuer neuen Tenant, SOFORT `kill -9` vor Drain, Neustart, `POST /api/onboard/retry` | 🔴 ROT (erwartet, aber ANDERE Ursache als im Plan vermutet) | Der Provisioning-Job UEBERLEBTE den Crash korrekt im JSON-Store (`status:"queued", attempts:0`) und wurde beim Neustart ordentlich erkannt (`[provision-reconcile] hold ... grund=no_active_subscriber`) — bis hierhin sogar ROBUSTER als der Plan-Text unterstellt. Der `retry`-Call scheitert aber NICHT wie im Plan erwartet mit 409/already_provisioned, sondern mit **403 "Kein aktiver, verifizierter Subscriber - kein Nummernkauf"** (mein Dummy-Env hatte `PAYMENT_ENABLED=false`, es existiert also gar kein verifizierter Subscriber-Pfad). Bleibt ROT im Sinne von "Recovery gelingt nicht automatisch", aber die genaue im Plan beschriebene Fehlerursache (occupiesCapacity zaehlt 'requested' als belegt) wurde NICHT reproduziert — dafuer braeuchte es vermutlich `PAYMENT_ENABLED=true` + einen echten/simulierten verifizierten Subscriber. Empfehlung an die Fix-Kette: Repro mit `PAYMENT_ENABLED=true` wiederholen, um die im Plan beschriebene 409-Situation tatsaechlich zu treffen |
| DEP-01 (P1) | `npm audit --omit=dev` + `test -f package-lock.json` | 🔴 ROT (neuer Befund seit 2026-07-02) | 2 Schwachstellen: 1x HIGH (`axios` 1.0.0-1.17.0, mehrere CVEs inkl. Prototype-Pollution/DoS, Fix via `npm audit fix` verfuegbar) + 1x LOW (`body-parser`, DoS bei ungueltigem `limit`-Wert, transitiv ueber `@modelcontextprotocol/sdk`). Plan erwartete 0 (Stand 2026-07-02) — seither neue Advisories oder Versions-Drift. Lockfile vorhanden (`lockfile-ok`). Kein Fix in dieser Session (Scope-Regel: keine Dependency-Aenderungen) |
| DEP-02 (P2) | Clean-Install in frischem `git worktree` (NICHT im Arbeitsbaum) | Siehe eigener Abschnitt unten | — |

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
