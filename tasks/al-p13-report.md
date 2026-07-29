# AL-P13 — Consult-Kanal am Call, MCP-Schleife

**Gate: PASS** · **finalBranch: `phase/al-p13-consult-kanal-fix1`**

## 1. Plan (gekürzt)

Ziel: Rückfrage-Kanal während der Klingelzeit eines Outbound-Calls plus die dazugehörige MCP-Schleife (`await_call_event` / `answer_consult`), damit das Client-Modell offene Fragen aus dem Briefing (`context.open_questions`) noch vor dem ersten Agent-Turn beantworten kann — die "billigste Sprosse der Fakten-Leiter" (0 ms Gesprächslatenz).

**Pre-Mortem (7 Risiken, je mit Gegenmittel):**
- R1 Prompt-Injektion über eine Consult-Antwort → **eine Tür**: jede Antwort läuft durch `validateAssistantContext` und landet ausschließlich in `call.context.key_facts`.
- R2 Shutdown-Drain hängt an offenen Long-Polls → `releaseOpenPolls()` läuft vor `httpServer.close()`.
- R3 Beantwortete Consults gehen nach Instanzwechsel verloren → `context` und `consults` wandern ins `ON CONFLICT DO UPDATE SET` von `flushCalls`.
- R4 Verhaltensabhängige Abnahmen werden fälschlich als "erledigt" gebucht → alle 5 gehen wörtlich, als offen markiert, in `tasks/al-testcall-checklist.md`.
- R5 Consult-Fragen aus fremder Rede (Drittperson ohne Einwilligung) → in P13 stammen Fragen ausschließlich aus `context.open_questions`; Grenze explizit für P14 vermerkt.
- R6 Ungewolltes Sammeln ohne Tenant-Freigabe → ein Prädikat `consultAllowedFor(profile)` gated Emission, beide Routen und die Tool-Registrierung.
- R7 Kosten → P13 löst weder LLM- noch Provider-Verkehr aus, keine Budget-Gate-Änderung.

**Neue Dateien:** `src/consult/ports.js` (Typ-Verträge), `src/consult/delivery.js` (Long-Poll-Zustellform, Stufe 0 — Tasks/MRTR ersetzen später nur diese Datei), `src/consult/gate.js` (Fähigkeits-Schnittmenge `CONSULT_ENABLED × ASSISTANT_CONTEXT_ENABLED × allowConsult`).

**Kern-Edits:** `config.js` (`consultEnabled`, Default aus), `store/defaults.js` (`CONSULT_STATUS`, `CONSULT_ANSWER`, `allowConsult` in `PROFILE_FIELDS`), `plans.js` (`allowConsult:false` im Paid-Profil), `store/state-ops.js` (`emitConsult`/`pendingConsult`/`answerConsult`/`expireOpenConsults`, Ablauf am einen Terminalisierungspunkt `setCallEndedAt`), `store/pg.js` + `store/json.js` (Persistenz-Parität, inkl. `context=EXCLUDED.context` — bisher write-once), `db/schema.sql` (Spalte `consults`), `routes/api-calls.js` (`GET /api/calls/:id/consult` Read-404, `POST /api/calls/:id/consult/answer` Write-403, Emission von Consult #0 nach der kompletten Gate-Kette), `app.js`/`server.js`/`boot.js` (Kompositionswurzel: eine `consultDelivery`-Instanz, Shutdown-Reihenfolge), `mcp-server-info.js`/`routes/mcp.js` (Server-`instructions`, `mcpRequestLabel`), `mcp-tools.js` (`await_call_event`, `answer_consult`, `api()` mit Timeout), `i18n/mcp-texts.js` (4 neue Locale-Keys).

**Ausdrücklich nicht Teil der Phase:** kein Edit an `claude.js`/`bridge.js`, kein `get_consult`, keine Zeitfenster-/Minutengrenzen-Regel (P14), keine Änderung an Safety-Gates/Budget/Offenlegung/Signaturprüfung, keine neue npm-Dependency, kein Push nach upstream, kein Deploy.

**Tests (Plan):** neue Suite `test/al-p13-consult-channel.test.js` in 12 Blöcken (A reine Ops, B Merge-Kante, C die eine Tür, D Injektion, E Long-Poll, F Obergrenzen & Drain, G Export/Erase/Retention, H json↔pg-Parität, I Flag-aus byte-identisch, J Tenant-/Auth-Gate, K MCP-Tools, L Rate-Limit-Arithmetik), plus Erweiterung von `test/p15-mcp-tool-descriptions-en.test.js`.

## 2. Implementierung — Zusammenfassung

- **Head-Commit:** `a47357f82108de5bdad05e57555a271488ec4177` (`node --check` grün, Tests grün: 3524/3524, committed).
- Gebaut wie geplant: `src/consult/{ports,delivery,gate}.js`, zwei neue Routen (Read-404/Write-403) innerhalb `/api/*` ohne neue Auth-Ausnahme, zwei neue MCP-Tools nur bei freigegebener Fähigkeit registriert, `call.consults` in beiden Backends persistiert.
- Sicherheitskern: `consultAllowedFor` als fail-closed-Schnittmenge; einzige Injektionstür `validateAssistantContext` → `call.context.key_facts`; kein Transkript/Audio über den Kanal; Audit nur mit Zählern.
- Beide Pre-Mortem-Kernrisiken (R2 Shutdown-Drain, R3 pg-Persistenz) strukturell geschlossen und testgepinnt.
- Smoke-Test gegen echten Server-Spawn: gemessene 22171 ms Long-Poll-Haltezeit (Abnahme-4-Vorgabe ≥ 20 s empirisch belegt), 409/404 korrekt, Flag-aus-Fingerprobe (404/403, `consults=null`) grün, keine verwaisten Server-Kinder nach dem Lauf.

**Neue Tests:** `test/al-p13-consult-channel.test.js` (45 Tests), `test/al-p13-consult-persist-pg.test.js` (2 Tests, pg-Roundtrip).
**Erweitert:** `test/p15-mcp-tool-descriptions-en.test.js` (Consult-Marker + Englisch-Reinheit), `test/config-namespaces.test.js`, `test/profile-a2-activation.test.js`, `test/profile-a3-backfill.test.js` (reine Zähler-Inventur), `test/helpers.js` (`BASE_ENV.CONSULT_ENABLED="false"`).

### Deviations vom Plan

1. pg-Paritätstest in eigene Datei `test/al-p13-consult-persist-pg.test.js` ausgelagert (Repo-Regel verbietet pglite + Server-Spawn in derselben Datei).
2. Drei ungeplante Bestandstest-Anpassungen (reine Inventur, keine Verhaltensänderung): `config-namespaces.test.js` (tenancy 6→7, 133→134 Keys), `profile-a2-activation.test.js`/`profile-a3-backfill.test.js` (keys 6→7 wegen `allowConsult`).
3. `api()` in `mcp-tools.js` hängt zusätzlich `err.httpStatus` an (additiv) — sonst müsste `answer_consult` 400 vs. 409 am Fehlertext unterscheiden.
4. `answer_consult` liefert in 400/409-Zweigen schema-konformes `structuredContent` statt nur Textblock (MCP-SDK-Vorgabe; bewusst nicht die latente Bestandslücke von `get_transcript` kopiert).
5. Gemeinsamer Helfer `callVisibleTo(call, tenantId)` extrahiert und auch im bestehenden Cancel-Handler genutzt (verhaltens-identisch, testabgedeckt).
6. `CONSULT_EVENT`-Enum (`consult|done|none`) ergänzt (Plan nannte nur Literale).
7. `emitOpeningConsult` liegt im Factory-Scope statt handler-lokal (Lesbarkeit, Aufrufposition unverändert).
8. Lokaler `node_modules`-Symlink zeigte auf sich selbst (ELOOP) — auf echtes Repo-`node_modules` umgehängt, gitignored, nicht committed.

## 3. Safety-Urteil

**Verdict: PASS — freigegeben zum Merge.** Alle 7 absoluten Regeln einzeln geprüft:

- **Regel 1 Safety-Gates:** `src/telephony/` unberührt, `outboundGates`-Kette unverändert; `emitOpeningConsult` sitzt nach der vollständigen Gate-Schleife und nach `store.createCall`; keiner der neuen Endpunkte löst Call/SMS/Geld aus.
- **Regel 2 Offenlegung:** `claude.js`/`bridge.js` nicht im Diff; Test pinnt `disclosureSentence`/`call.to`/`call.goal`/`call.mandate` byte-gleich vor/nach präparierter Consult-Antwort.
- **Regel 3 Auth fail-closed:** beide Routen hinter bestehendem Auth-Gate (`installAuthGate` läuft vor dem Mount), keine neue Exemption; unabhängig per echtem Server-Spawn mit Passwort bewiesen (401 ohne/mit falschem Credential, 200 mit korrektem, 22160 ms Haltezeit gemessen).
- **Regel 4 Secrets:** keine neuen Secrets; Audit trägt nur ID/Ereignis/Zähler; `event_id` wird vor jeder Verwendung inkl. Audit-Log gegen `/^c(\d+)$/` geprüft (Log-Injektion getestet und verhindert — siehe Fix-Runde).
- **Regel 5 Audio/Transkript nie über MCP:** Lesepfad liefert nur `event`/`eventId`/`questions`; `await_call_event` komponiert Done-Payoff über die bestehende `pickTranscript`/`resultCardView`-Whitelist, keine zweite Ergebnis-Sicht.
- **Regel 6 Scope:** keine neue npm-Dependency; alle 33 Dateien AL-P13-zuzuordnen.
- **Regel 7 Debug:** n/a für diese Phase (kein Bug-Fix-Task).

**Flag-AUS byte-identisch verifiziert** (nicht nur behauptet): Default `CONSULT_ENABLED=false` überall, `consultAllowedFor` fail-closed gegen jeden Nicht-`true`-Wert, Routen 404/403 im echten Spawn, Tools nicht registriert, `place_call`-Beschreibung/`mcpServerOptions` byte-identisch, `consults:null` in beiden Backends.

**Concerns (nicht blockierend, dokumentiert):**
1. `context=EXCLUDED.context` im pg-`ON CONFLICT DO UPDATE SET` macht eine bisher write-once-Spalte dauerhaft schreibbar — Wurzel geprüft und entschärft (Rehydrierung aus `rowToCall`, kein Pfad setzt `context` nachträglich auf `null`), aber künftig die riskanteste Zeile der Phase bei Änderungen an der Call-Hydrierung.
2. `MAX_OPEN_POLLS_PER_TENANT=4` keyt auf `tenantId`; bei `MULTI_TENANT=false` kollabieren alle Calls auf den Bootstrap-Tenant — ab dem 3. parallelen Anruf fällt jeder weitere Poll sofort auf `{event:"none"}` (Produktrisiko für Abnahme 1/5, kein Sicherheitsdefekt).
3. `store.expireOpenConsults` ist auf Fassade + beiden Backends exportiert, hat aber keinen Konsumenten außer intern über `setCallEndedAt` (unbenutzte öffentliche Store-Oberfläche, Clean-Code-Hinweis, kein Safety-Befund).
4. `consults` läuft durch `publicCall` (Blacklist statt Whitelist) und erscheint neu in `GET /api/calls/:id`/`/api/state`; Inhalt ist tenant-eigen, Antworttext bleibt in `context.key_facts` — kein zweiter Leak-Pfad.
5. `GET /api/calls/:id/consult` übergibt bewusst `signal:null`; ein abgebrochener Host-Request lässt den Handler bis 22 s weiterlaufen (Slot fällt im `finally`) — beabsichtigt und begründet (Betriebs-Eigenschaft, kein Blocker).

## 4. Clean-Code-Audit

**Verdict: PASS — keine S1/S2-Verstöße.**

- **S1 (Blocker):** keine.
- **S2:** keine.
- **S3 (2 Punkte, keine Fixes nötig):**
  - `src/mcp-server-info.js` (`mcpServerOptions`) bündelt zwei unabhängige Optionen (UI-Capabilities + Consult-`instructions`) in einem Rückgabeobjekt — Geschmacksfrage, im Kommentar begründet.
  - `consultAllowedFor` wird an drei Stellen aufgerufen (Read-Route, Write-Route, MCP-Route) — keine Logik-Duplizierung, nur mehrere legitime Call-Sites.
- **S4:** keine.

**Positiv hervorgehoben:** korrekte Safety-Gate-Reihenfolge (bewiesen + kommentiert), eine Injektionstür statt einer zweiten schwächeren, Regel 5 strukturell erzwungen, Ressourcen-Riegel als benannte Konstanten ohne Env-Knopf mit Erschöpfungstests, Shutdown-Reihenfolge testgepinnt, json/pg-Parität inkl. des nicht offensichtlichen `context=EXCLUDED.context`-Falls, fail-closed Flag-Kaskade, byte-identisches Bestandsverhalten bei ausgeschaltetem Kanal, O14-Konformität (englische Tool-Beschreibungen) und PII-freies Audit-Log, Format-Wache `isConsultEventId` vor jeder Weiterverarbeitung inkl. Audit-Log.

**Offene ToDos (kosmetisch/organisatorisch, kein Blocker):**
- Vor Scharfschalten (`CONSULT_ENABLED=true`): die Abnahmen 1-7 in `tasks/al-testcall-checklist.md` tatsächlich fahren (echte `place_call` aus claude.ai/ChatGPT, Poll-Zug-Quote, Consult-#0-Timing) — Code ist bereit, Abnahme ausdrücklich noch offen.
- Optional: `mcpServerOptions()` später entflechten, falls eine dritte Option dazukommt.

## 5. Fix-Runden

**r1:** S1-Blocker in `POST /api/calls/:id/consult/answer` behoben — `event_id` wurde bisher nur auf "nicht-leerer String" geprüft und danach roh in die Audit-Zeile interpoliert, was einem authentifizierten Tenant Log-Injektion (gefälschte `[audit]`-Zeilen) und beliebigen Freitext-Log-Spam bis zur Body-Größe erlaubt hätte. Fix: `event_id`-Format-Wache (`isConsultEventId`, `/^c(\d+)$/`) läuft vor jeder Weiterverarbeitung inkl. Audit-Aufruf; Regressionstest (Zeilenumbruch-Injektionsversuch → 400, keine Audit-Einträge) ergänzt. Nach diesem Fix: Safety- und Clean-Code-Review final PASS.
