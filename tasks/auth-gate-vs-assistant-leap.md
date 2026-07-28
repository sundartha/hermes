# AL vs AUTH-GATE — Beruehrungspunkte

Bestandsaufnahme, geschrieben 2026-07-28, **VOR Beginn der Umsetzung von PLAN-ASSISTANT-LEAP.md**
(Plan A, laeuft ab jetzt). PLAN-AUTH-GATE.md (Plan B, danach) ist zu diesem Zeitpunkt nur
eingecheckt (`a727804`), keine Phase umgesetzt. Beide Plaene sind vollstaendig gelesen worden,
kein Code wurde veraendert. Zweck: haltbar dokumentieren, wo sich beide Plaene beruehren, damit
die naechste Session, die Plan B umsetzt, nicht von der Luecke ueberrascht wird.

**Vorarbeit bereits vorhanden:** `tasks/assistant-leap-chain.md` Abschnitt 7b traegt schon eine
Kollisionswarnung ("AL-P13 nicht starten, ohne vorher zu pruefen, ob PLAN-AUTH-GATE inzwischen
umgesetzt ist") und die Owner-Entscheidung "AL-Kette hat Vorrang, PLAN-AUTH-GATE wird
zurueckgestellt". Diese Datei hier vertieft das mit konkreten Zitaten aus beiden Plandokumenten.

## Ergebnis in einem Satz

Die Plaene laufen zu ueber 90 % aneinander vorbei — Plan A veraendert Gespraechslogik/Latenz/MCP-
Werkzeuge, Plan B veraendert Auth/Session/Routing. Es gibt **einen** handfesten Beruehrungspunkt
(Plan A legt zwei neue API-Routen an, die exakt in Plan B's Schutzmuster fallen) und zwei kleinere
Reibungspunkte. Keine erfundene Verflechtung: die Kernabschnitte von Plan B (1, 2, 4-9, Owner-
Entscheidungen 1-9) sind von Plan A vollstaendig unberuehrt — Beleg: `grep` auf
`auth-gate|DASHBOARD_PASSWORD|webAuthMw|internalOnly|isTrustedLocalCaller|_tenant.js` in
`PLAN-ASSISTANT-LEAP.md` liefert null Treffer.

## Beruehrungspunkte

| Thema | Plan A Stelle | Plan B Stelle | Schwere |
| --- | --- | --- | --- |
| Zwei neue Routen in `api-calls.js` ohne Plan-B-Klassifizierung | Phase 13: "`src/routes/api-calls.js`: `GET /api/calls/:id/consult`... `POST /api/calls/:id/consult/answer`... unter der bestehenden `/api/*`-Auth (Regel 3) plus `tenantOwnsCall`" | Abschnitt 3, Routentabelle: `POST /api/calls`, `POST /api/calls/:id/cancel` (dieselbe Datei!) = "nur Gate" -> (b1) `internalOnly` in P5 | **hoch** |
| MCP-Tools rufen die neuen Routen in-process auf | Phase 13: "`src/mcp-tools.js`: `await_call_event` + `answer_consult`" | P3: "Pflichtschritt vor der Umsetzung: vollstaendige Aufzaehlung der Konsumenten des Fallbacks... diese Enumeration ist Teil der Phase" | mittel (P3 enumeriert zum Umsetzungszeitpunkt selbst, faengt es strukturell auf) |
| `telnyx-llm-shim.js`-Bearer ist Plan-B's dokumentierter blinder Fleck; Plan A aendert genau diese Datei fuenfmal | Phasen 1, 2, 4, 6, 7 (Latenz-Log, SSE-Spike, Loop-Abbruch, Budget/Runde, Streaming) — alle in `src/telnyx-llm-shim.js` | P1: "`POST /v1/chat/completions` (Bearer im Shim, `telnyx-llm-shim.js:327`)" als einer von drei Faellen, die der Inventar-Test nicht sieht; Entscheidung 8, Runbook-Zeile 2 | mittel |
| `api()`-Helper in `mcp-tools.js` wird von Plan A veraendert | Phase 13: "`api()` bekommt fuer den Poll einen expliziten `AbortController`" | P3 zitiert `mcp-tools.js:44` als Beleg fuer den localhost-Aufrufer-Pfad hinter `isTrustedLocalCaller` | niedrig (Verhalten bleibt, nur die zitierte Zeile driftet) |
| `config.js`: beide Plaene legen neue Inhalte an | neue Namespaces `research`, Consult-/Lookup-/Thinking-Signal-Konstanten (mehrere Phasen) | P8 entfernt `DASHBOARD_PASSWORD`; P6 nutzt bestehendes `ADMIN_EMAILS` | niedrig (rein additiv, kein Namenskonflikt, nur Merge-Reibung in derselben Datei) |
| `/mcp` selbst | Phase 13 aendert nur `serverOptions.instructions`, nicht die Auth | Abschnitt 3: "(a) `mcpAuth`, gate-exempt" — bleibt unberuehrt | keine |

## Veraltet durch Plan A — konkrete Aussagen in Plan B

1. **Abschnitt 3, Routentabelle (Zeilen 140-162).** Vollstaendig fuer den Stand VOR Plan A. Nach
   Plan A fehlen mindestens zwei Zeilen (`GET /api/calls/:id/consult`,
   `POST /api/calls/:id/consult/answer`). Betrifft nicht die Korrektheit der bestehenden Zeilen,
   nur die Vollstaendigkeit der Aufzaehlung.
2. **P4 "tote, aber scharfe Routen loeschen".** Die Liste ist abschliessend fuer den heutigen
   Stand (`api-tenant-write.js`, `api-profiles.js`). Ob die neuen Consult-Routen den
   Tenant-Resolver korrekt durchlaufen (statt ihn wie `/api/profiles` zu umgehen), ist in Plan A
   nur ein Versprechen ("tenantOwnsCall"), kein durch P4-Methodik geprueftes Faktum — muss bei
   der Umsetzung von Plan B nachgezogen werden.
3. **P5, Aufzaehlung "vor fuenf Routen".** Die Zahl fuenf und die Liste
   (`POST /api/calls`, `POST /api/calls/:id/cancel`, `GET /api/state`, `GET /api/calls/:id`,
   `GET /api/tenant-data/export`) ist nach Plan A unvollstaendig, falls die zwei neuen Routen
   denselben `internalOnly`-Bedarf haben (nach ihrem Aufrufmuster: ja, wahrscheinlich).
4. **Entscheidung 8, Runbook-Tabelle Zeile 2** (`telnyx-llm-shim.js:324-327` als Beleg-Stelle).
   Plan A verschiebt diese Datei in fuenf Phasen; die Zeilennummer ist nach Plan A vermutlich
   falsch und muss beim Anlegen von `docs/RUNBOOK-AUTH-REVIEW.md` (P1) frisch nachgeschlagen
   werden, nicht aus Plan B kopiert.
5. **Abschnitt "Reihenfolge ist bindend".** Bleibt inhaltlich korrekt, aber der Graph-Fingerprint
   aus P1 muss gegen den Code-Stand NACH Plan A erhoben werden, nicht gegen den heutigen
   `76f386c`-Stand — sonst zeigt der Fingerprint-Diff beim ersten `npm test` nach P1 faelschlich
   "Plan-A-Routen fehlen im Snapshot" als vermeintlichen Regressionsfund.

**Nicht veraltet** (explizit gegengeprueft, damit nichts erfunden wirkt): Abschnitte 1, 2, 4-9,
die Pre-Mortem-Tabelle und die Owner-Entscheidungen 1-9 sind von Plan A unberuehrt — keine der
dort behandelten Dateien (`auth-gate.js`, `_tenant.js`, `web-auth.js`, `app.js`-Mount-Reihenfolge,
Cache-Header, Legacy-Checkout) taucht in Plan A auf.

## Neue Routen aus Plan A

- `GET /api/calls/:id/consult` (Phase 13, Long-Poll)
- `POST /api/calls/:id/consult/answer` (Phase 13)

Sonst keine. Phase 15's optionaler Zustellkanal nutzt einen bestehenden Port
(`voiceControl.speak`), keine neue HTTP-Route.

## Reihenfolge-Konflikte

- **Kein Sicherheitsverlust waehrend Plan A laeuft:** die zwei neuen Routen entstehen, waehrend
  das alte Basic-Auth-Gate noch aktiv ist — sie sind also, wie alle heutigen `api-calls.js`-
  Routen, zumindest gate-geschuetzt. Kein Zeitfenster mit weniger Schutz als heute.
- **Der Testmechanismus ist robust, die Dokumentation nicht:** Plan B's P1
  (Routen-Inventar-Test) ist generisch gebaut — "jede Route ohne Auth-Middleware und ohne
  Eintrag in der Oeffentlich-Liste = rot". Er faengt die zwei neuen Routen automatisch ab, sobald
  P1 gegen den dann aktuellen Code laeuft. Die von Hand geschriebenen Aufzaehlungen in Abschnitt 3
  und P4/P5 tun das nicht — ein Umsetzer, der der Phasenliste statt dem Testergebnis folgt, kann
  die zwei Routen bei der `internalOnly`-Verkabelung vergessen.
- **Kein neuer Netzwerk-Aufruf an der Auth-Grenze:** Plan A's neue Egress-Aufrufe (Exa-Suche,
  Anthropic `web_search`) laufen serverseitig innerhalb bestehender Prozesse, nicht ueber die von
  Plan B behandelten HTTP-Routen.
- **Keine Aenderung an `_tenant.js`:** P3 (Bootstrap-Fallback fail-closed) bleibt inhaltlich
  unveraendert gueltig. Ihr eigener Pflichtschritt ("vollstaendige Aufzaehlung der Konsumenten")
  erfasst die neuen MCP-Tools automatisch, wenn er zum Umsetzungszeitpunkt (nach Plan A) statt
  jetzt ausgefuehrt wird — kein Nacharbeitsbedarf am Plantext selbst.

## Empfehlung

**Neufassung ist NICHT noetig.** Die Kernstruktur (P1-P9, Owner-Entscheidungen 1-9, Pre-Mortem,
Regel-3-Neufassung) bleibt inhaltlich korrekt und wird durch Plan A an keiner Stelle widerlegt.

**Nachpruefung genuegt**, konkret an zwei Stellen, **sobald Plan A Phase 13 gemergt ist** (vorher
existieren die Routen nicht, eine Aenderung jetzt waere Spekulation):
1. Abschnitt 3 (Routentabelle) und die Aufzaehlungen in P4/P5 um die zwei Consult-Routen ergaenzen
   — Klassifizierung wahrscheinlich `internalOnly`, endgueltig zu entscheiden anhand des dann
   tatsaechlichen Aufrufmusters.
2. Entscheidung 8 / Runbook-Tabelle: Zeile 2 (`telnyx-llm-shim.js`) beim Anlegen von
   `docs/RUNBOOK-AUTH-REVIEW.md` in P1 frisch nachschlagen statt die Zeilennummer aus diesem
   Dokument zu kopieren.

Wichtigster Befund dabei: Plan B's eigener Sicherheitsmechanismus (P1-Inventar-Test) ist bereits
so gebaut, dass er gegen nachtraeglich hinzugekommene Routen robust ist — nur seine von Hand
gepflegte Dokumentation (Tabellen, Aufzaehlungen) ist es nicht.

## Urteil in einem Satz

Die Plaene beruehren sich nur an einer Stelle handfest — Plan A Phase 13 legt zwei neue
API-Routen an, die exakt in Plan B's "nur Gate -> `internalOnly`"-Muster fallen —, Plan B's
mechanischer Test faengt das trotzdem automatisch ab, nur seine handgeschriebenen Routentabellen
werden dadurch unvollstaendig und muessen einmalig nachgezogen werden; keine Sicherheitsluecke,
keine Neufassung noetig, und die Kollision ist bereits erkannt und mit "AL zuerst,
PLAN-AUTH-GATE zurueckgestellt" entschieden (`tasks/assistant-leap-chain.md`, Abschnitt 7b).
