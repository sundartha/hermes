# AL-P1 — Latenz-Achse und Abbruch-Achse schliessen

**Status:** Gate = PASS
**finalBranch:** `phase/al-p1-latenz-achse`
**Basis:** `master` = `db6c4de`
**headCommit:** `25a14fe47d381bd1bc29f1f601bcefd48fbadf84`

---

## 1. Plan (gekuerzt)

Autoritativ: `tasks/assistant-leap-chain.md` §9.0 + §"AL-P1"; inhaltlich `PLAN-ASSISTANT-LEAP.md` `#### Phase 1`. O1 (Pfad) ist entschieden -> Teilauftrag "Pfad feststellen" entfaellt, die Boot-Banner-Sonde wird trotzdem gebaut.

Vorab-Schritt der Spec: vor jedem Code in den Render-Logs pruefen, ob `event_type=call.conversation.created` ueberhaupt am Webhook ankommt. Falls nicht: die `EVENT_TYPE_MAP`-Erweiterung + Ingest-Zweig werden trotzdem inert gebaut, Fallback `/v2/call_events` bleibt dokumentiert.

**Neue Dateien:**
- `scripts/prod-read.mjs` — read-only Zugang zum Prod-Store (Pool-Lebenszyklus, `assertNoBypassRls`, RLS-GUC pro Tenant in EINER Quelle statt zweimal inline).
- `scripts/call-abandon-rate.mjs` — Auswertung der Abbruch-Achse (beantworteter Outbound-Call, `endedAt-answeredAt < 15s` UND `callerTurns === 0`). Kein HTTP-Endpunkt. Rueckwirkend nicht erhebbar (misst ab Deploy vorwaerts), `--since` Pflichtargument.

**Edits (Kern):**
- `src/db/schema.sql` — zwei additive, nullable/defaulted Spalten: `telnyx_conversation_id TEXT`, `caller_turns INTEGER NOT NULL DEFAULT 0`; idempotente `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- `src/store/state-ops.js` — Scaffold-Felder in `createCall` + zwei neue Mutatoren: `recordTelnyxConversationId` (set-once), `countCallerTurn` (purge-fester Zaehler, NaN-Schutz).
- `src/store/pg.js` — `rowToCall` hydriert beide Felder, `flushCalls` traegt beide in Spaltenliste/VALUES/`ON CONFLICT DO UPDATE SET` (kritisch: ohne DO UPDATE faellt der Zaehler bei jedem Flush auf 0 zurueck), Wrapper fuer beide Mutatoren.
- `src/store/json.js` — Migration `migrateCallDiagnosticFields` (Bestandszeilen -> null/0, nie undefined), Wrapper analog pg.
- `src/store.js` — Re-Exports beider Mutatoren.
- `src/telephony/adapters/telnyx/call-control-events.js` — neuer Event `CONVERSATION_CREATED`, `EVENT_TYPE_MAP`-Eintrag, neue reine Funktion `conversationIdFrom(body)` (Feldname `conversation_id`, fail-safe null, live unbestaetigt markiert im Docstring).
- `src/telnyx-call-control-ingest.js` — neuer Handler `onConversationCreated`: bei Treffer Store-Write + Log ohne UUID-Wert; bei Miss ein keys-only Log (`payload_keys=...`, gedeckelt) statt stillem Fehlschlag. Rein diagnostischer Zweig, kein Call-Effekt, kein Gate.
- `src/claude.js` — `agentTurn` zaehlt `callerTurns` nur bei nicht-leerem `callerText` (purge-fest, Realtime-Pfad `bridge.js` bewusst ausgenommen — nicht der live laufende Pfad); Rueckgabe zusaetzlich um `roundtrips`/`toolNames` (=firedTools) erweitert.
- `src/telnyx-llm-shim.js` — vier PII-freie Felder (`roundtrips`, `toolNames`, `chars`, `speechEmpty`) auf der `turn_ok`-Logzeile, fail-safe gegen fehlende Felder.
- `src/boot.js` — `assistantPathLabel` (reine Funktion) + neue Bootbanner-Zeile "Assistant-Pfad: ...".
- `src/store/views.js` — `publicCall` strippt beide neuen Felder (kein API-Vertrag dafuer, `/api/state` bleibt byte-identisch).
- `scripts/telnyx-call-latency.mjs` — `--call <hermes-call-id>` (loest UUID via `prod-read.mjs` auf), `ACCOUNTED_LATENCY_FIELDS`/`unaccountedMsOf`/`unaccountedVerdict` (Toleranz 300ms), `parseLatencyArgs`.
- `tasks/al-testcall-checklist.md` — vier offene Owner-Live-Abnahmen ergaenzt (Latenz-Tabelle 1 Anruf, Baseline >=5 Anrufe, Eroeffnungsfenster >=3 Aufnahmen, Feldnamen-Verifikation).

**Ausdruecklich nicht Teil der Phase:** keine neue Env-Variable/Dependency/Route/MCP-Tool, kein Gate beruehrt, Offenlegungssatz unangetastet, kein Deploy/Push/Flag-Flip.

**Pre-Mortem-Kernrisiken (im Plan entschaerft):** Zaehler faellt bei Flush auf 0 zurueck ohne `DO UPDATE SET` (Test AL-P1-1 pinnt genau diesen Pfad); geratener Feldname liefert still `null` (Miss-Log + Checklisten-Zeile); Pool haengt offen (Prod-Read schliesst im `finally`, Test AL-P1-19 beweist es auch im Wurf-Fall); FORCE-RLS liefert 0 Zeilen ohne GUC pro Tenant; Transkript-Leak in Log/API (Test-Gegenprobe + `publicCall`-Strip); nicht-idempotente Migration (`ADD COLUMN IF NOT EXISTS`).

---

## 2. Implementierungs-Zusammenfassung

- **headCommit:** `25a14fe47d381bd1bc29f1f601bcefd48fbadf84`
- **node --check:** alle 13 geaenderten src-/scripts-Dateien sauber
- **npm test:** gruen, 3350/3350, 0 fail
- **committed:** ja (auf `phase/al-p1-latenz-achse`)

**Dateien erstellt (7):** `scripts/prod-read.mjs`, `scripts/call-abandon-rate.mjs`, `test/al-p1-store-fields.test.js`, `test/al-p1-turn-observability.test.js`, `test/al-p1-agent-turn-callerturns.test.js`, `test/al-p1-conversation-event.test.js`, `test/al-p1-forensics-scripts.test.js`

**Dateien editiert (14):** `src/db/schema.sql`, `src/store/state-ops.js`, `src/store/pg.js`, `src/store/json.js`, `src/store.js`, `src/store/views.js`, `src/telephony/adapters/telnyx/call-control-events.js`, `src/telnyx-call-control-ingest.js`, `src/claude.js`, `src/telnyx-llm-shim.js`, `src/boot.js`, `scripts/telnyx-call-latency.mjs`, `tasks/al-testcall-checklist.md`, `test/telnyx-llm-shim.test.js`

### Deviations vom Plan

1. **AL-P1-6 in eigene Datei ausgelagert** (`test/al-p1-agent-turn-callerturns.test.js` statt in `test/al-p1-turn-observability.test.js`): technisch erzwungen durch eine `config.js`-Importreihenfolge-Kollision.
2. **5 statt geplanter 4 Testdateien, 24 statt geplanter 19 Tests** — Aufspaltung (Punkt 1) plus zusaetzliche Randfall-Tests (3b, 11b, 12b, 15b, 19b).
3. **`test/telnyx-llm-shim.test.js` angepasst** (nicht neu, aber veraendert): `turnShapeLines`-Filter um `SHAPE_LINE_MARKER` ergaenzt, weil `turn_ok` jetzt plangemaess auch `speechEmpty` traegt — Filter wurde dadurch praezisiert/verschaerft, nicht geschwaecht.

### Clean-Code-Selbstauskunft (Impl-Agent)

Keine Magic Numbers ausser 0/1/-1 ohne Konstante; keine neuen Dependencies; ESM/kein Build-Step/Kommentare deutsch ohne Umlaute eingehalten; jede neue Funktion hat einen Test; Duplizierung vermieden (`prod-read.mjs` als eine Quelle); Nebeneffekte im Namen sichtbar; Funktionen bleiben ein-aufgabig.

### Smoke-Test

Kein separater manueller Server-Smoke-Test noetig: Bestandssuite faehrt `src/server.js` inkl. `logBootBanner` (neue Assistant-Pfad-Zeile) in vielen Spawn-Tests real hoch, alle gruen. `scripts/call-abandon-rate.mjs` und `scripts/telnyx-call-latency.mjs` direkt per CLI gegen die fail-closed-Pfade verifiziert.

---

## 3. Safety-Urteil (final)

**approved:** true · **verdict:** PASS

Alle Einzelkriterien erfuellt: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`.

**Unabhaengiger Testlauf (frischer Worktree, Branch `review-al-p1` von `phase/al-p1-latenz-achse`, Commit 25a14fe, master db6c4de ist Ancestor):**
- `npm test`: EXIT=0, roh 3370/3370/0, korrigiert 3350/3350/0, 93s (json UND pglite in derselben Suite).
- `npm run test:gates`: EXIT=1, korrigiert 129 Tests, 126 pass, 3 fail — GAP-05 (allow_promotion_codes ohne Coupon-Allowlist) und 2x GAP-15 (Rechtstext-Platzhalter/fehlende EN-Fassung): vorbestehende, AL-P1-fremde Launch-Gate-Befunde, identisch mit der dokumentierten 3-rot-Basislinie. Kein AL-P1-Test im Gates-Lauf.
- `node --check` auf allen 13 geaenderten Dateien: sauber. Keine verwaisten Testserver danach.

**Verifizierte Einzelpunkte:**
- Neuer `CONVERSATION_CREATED`-Zweig liegt im bestehenden `POST /voice/call-control`-Handler, unter der Ed25519-Signatur-Middleware (`routes/voice.js:502`) und hinter `resolveActiveCall`; Test AL-P1-13 pinnt: kein `speak`, kein `ai_assistant_start`, kein Settlement.
- Offenlegung (`disclosureSentence` in `claude.js:204`, Aufruf in `bridge.js:204`) liegt ausserhalb des Diffs.
- PII/Secrets: `turn_ok` traegt nur Ganzzahl|null, Tool-Namen, Laenge, Boolean; AL-P1-7 pinnt, dass der gesprochene Satz nicht in der Zeile landet; AL-P1-12/12b pinnen, dass der Conversation-UUID-Wert nie geloggt wird (nur keys-only Miss-Log, gedeckelt auf 20 Keys x 64 Zeichen).
- API-Vertrag: `publicCall` destrukturiert beide neuen Felder heraus, einziger Call-Ausgang -> `/api/state` byte-identisch (Test AL-P1-5).
- pg-Flush handverifiziert: 36 Spalten/`$1`-`$36`/36 Parameter stimmen, beide neuen Spalten im `ON CONFLICT DO UPDATE SET`; `rowToCall` hydriert beide (i8-Lehre). AL-P1-1/AL-P1-2 beweisen den Roundtrip auf pglite.
- Store-Fassade: beide Methoden in `json.js` UND `pg.js`, in `store.js` re-exportiert; `claude.js` nutzt Modul-Singleton, kein TypeError-Pfad.
- Kein Test geloescht, kein `.skip`/`.only`/`.todo`. Einzige Bestandstest-Aenderung (`test/telnyx-llm-shim.test.js:1053`) verschaerft den Filter.
- Diff enthaelt keinen Treffer auf `numberGateError`/`OUTBOUND_FROZEN`/Denylist/Budget/`safeEqual`/Signaturpruefung/Auth/KYC/Allowlist/Disclosure; `bridge.js`, `config.js`, `auth.js`, `web-auth.js`, `middleware.js`, `app.js`, `server.js`, `routes/*`, `.env.example`, `render.yaml`, `package.json`/`package-lock.json` unveraendert.

**Concerns (nicht blockierend):**
1. Spec-Vorstufe (Render-Log-Pruefung vor Code) uebersprungen — Zweig wurde spekulativ gebaut, Feldname `conversation_id` bleibt bis zum ersten echten Anruf unbewiesen (dafuer selbst-diagnostizierendes keys-only Miss-Log).
2. `scripts/prod-read.mjs` fuehrt einen wiederverwendbaren tenant-uebergreifenden Lesehelfer ein; heute importiert nichts aus `src/` diese Datei, aber wuerde er je in den Dienst gezogen, waere RLS-Isolation konstruktionsbedingt umgangen — Import-Guard fuer spaetere Phase angemerkt.
3. `conversationIdFrom` speichert einen laengenunbeschraenkten Provider-String, waehrend das Modulumfeld sonst `EVENT_TOKEN_MAX_LEN=64` als Defense-in-Depth nutzt (Wert ist signaturgeschuetzt, nie geloggt — Risiko gering, Musterinkonsistenz bleibt).
4. Abnahmen 2-4 der Phase (Latenz-Tabelle 1 Anruf, Baseline >=5 Anrufe, Eroeffnungsfenster >=3 Aufnahmen) sind reine Live-Messungen, stehen in der Checkliste korrekt auf "offen" — Code ermoeglicht sie, erfuellt sie nicht.
5. Migration fuehrt zwei `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` auf der Prod-`call`-Tabelle aus — idempotent, Fast-Default ohne Table-Rewrite in modernem Postgres, aber real ein Schreibvorgang auf der Live-DB beim naechsten Deploy.

---

## 4. Clean-Code-Audit (final)

**blocker:** false · **verdict:** PASS

Zwei rein additive, gut isolierte Diagnose-Achsen (Conversation-UUID fuer Latenz, purge-fester Anrufer-Turn-Zaehler fuer Abbruch) plus Skript-Kette zur Auswertung. Persistenz-Parity json.js/pg.js/schema.sql sauber durchgezogen (Set-once, `ON CONFLICT DO UPDATE SET`, `rowToCall`-Hydrierung, `/api/state` byte-identisch). Alle neuen Store-Funktionen folgen bestehenden Mustern (`recordFailureReason`, `countNoSpeechTurn`) inkl. NaN-Schutz und fail-safe Defaults. `turn_ok`-Zusatz PII-frei per Test bewiesen; ein Regressionsrisiko in `test/telnyx-llm-shim.test.js` (turnShapeLines-Filter) erkannt und im selben Diff korrigiert. Keine Magic Numbers ohne Konstante, keine Sicherheits-/Auth-/Budget-Gates beruehrt, kein toter Code, keine Duplizierung.

**s1 (Blocker):** keine
**s2 (Muss vor Merge):** keine

**s3 (sollte, kein Blocker):**
- `src/store/state-ops.js` `countCallerTurn` — Kommentar begruendet die `{call,changed}`-Rueckgabe abweichend von `countNoSpeechTurn` sehr ausfuehrlich; Lesbarkeit leidet minimal, inhaltlich korrekt. Kein Fix noetig.
- `scripts/telnyx-call-latency.mjs` `printTable` — verschachtelter Ternary (2 Ebenen) fuer den `status`-String; als benannte Helper-Funktion optional lesbarer.

**s4 (Beobachtung):**
- `src/claude.js` `agentTurn`-Rueckgabe `{roundtrips, toolNames}` wird produktiv nur vom Telnyx-Shim-Pfad konsumiert, nicht von `src/routes/voice.js` — bewusst so belassen (Shim ist der einzig live laufende Pfad, O1).

**topTodos:**
1. Vor dem ersten echten Anruf: `conversation_id`-Feldnamen ueber den Miss-Log (`payload_keys=...`) verifizieren.
2. Optional: verschachtelten Ternary in `printTable()` in benannte Funktion auslagern (S3, keine Pflicht).
3. `npm test`/`node --check` konnte in der Clean-Code-Review-Umgebung mangels `node_modules` nicht laufen — vor Merge sichergestellt durch den separaten Safety-Review-Lauf (siehe Abschnitt 3, gruen).

---

## 5. Fix-Runden

Keine. Erster Durchlauf erreichte PASS in Safety- und Clean-Code-Review ohne Nachbesserungsschleife.
