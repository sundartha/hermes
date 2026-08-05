# Phase GQ-P1 — Kumulative Turns, ein Turn je Äußerung

**Gate:** PASS
**finalBranch:** `phase/gq-p1-kumulative-turns`
**headCommit:** `7af8129c3b84db4d53c9ca79227204a507200488`

---

## Plan (gekürzt)

**Problem (Befund B-1):** Die Spracherkennung liefert kumulative Zwischenstände einer Äußerung. Kommt für denselben Call ein Request, dessen Text den noch laufenden Turn nur fortschreibt (`prevRelation === "extends"`), beantwortet der Agent dieselbe Äußerung zweimal — Doppelrede/Abschneiden.

**Design-Entscheidungen:**
- **E1 — Kooperativer Abbruch, kein präemptiver SDK-Abbruch.** Zwei Wirkungen: (1) sofort der Sprech-Draht des verdrängten Turns wird stumm (Shim reicht `agentTurn` einen Wächter statt `wire.writeChunk` durch); (2) an der nächsten Schleifengrenze prüft `agentTurn` `abortSignal.aborted`, fährt keine weitere Modellrunde, schreibt keine `agent`-Zeile. Kein Durchreichen bis ins SDK: würde `llm.js`+Test-Seam anfassen, im Nicht-Stream-Fall Kosten unbebucht lassen (verstößt gegen "keine Kosten doppelt oder gar nicht buchen") und einen Degradations-Fehlerpfad triggern.
- **E2 — Antwort des verdrängten Requests: leere, gültige Completion** (`respond("")`, derselbe Pfad wie AL-P7 im Streaming-Fall). Kein Hängen, kein 4xx/5xx.
- **E3 — Fail-safe-Richtung:** ist bereits Text gestreamt (`wire.chunkCount() > 0`), wird NICHT verdrängt (Grund `already_spoken`). Gesprochenes ist nicht zurückholbar.
- **E4 — Nur `EXTENDS` löst aus.** `same` (Consult-Nachfass) und `other` (echte Äußerungen) bleiben unangetastet.
- **E5 — Reihenfolge: Riegel NACH allen Gates** (Loop-Guard, Rate-Gate, Budget-Gate), unmittelbar vor `agentTurn`. Verhindert, dass ein verdrängender Turn selbst an einem Gate hängenbleibt und eine echte Antwort gegen eine Degradation getauscht wird.
- **E6 — Verdrängter Turn legt nie auf** (`endCall: false` erzwungen); `stopReason` bleibt echt, damit `isBudgetAxis` weiter greift.
- **E7 — bewusst außerhalb Scope:** doppelte `caller`-Zeile im Transkript bleibt (Datenmodell-Eingriff, andere Phase); kein Prompt-/Tool-Umbau.

**Pre-Mortem (im Plan explizit):** Beleg-Logs zeigen, dass R1 (Vorgänger) beim Eintreffen von R2 bereits `agentTurn`-fertig ist (Zeile geschrieben), bevor R2 startet — der Riegel griffe hier nicht (`no_inflight`), obwohl R1s TTS noch hörbar läuft. Das Fenster "Turn läuft" ist kürzer als "Antwort ist hörbar". Empfehlung an den Lead: trotzdem mergen, die neue `supersede`-Logzeile als Messinstrument nutzen, Owner-Entscheid über Fenster-Ausdehnung (Call-Control `speak.started/ended`) auf Basis der Messung treffen — keine Ausdehnung in dieser Phase.

**Neue Datei:** `src/telnyx-turn-supersede.js` — `makeInFlightTurnRegistry()` mit `beginTurn`/`supersedeTurn`, Grund-Token `no_inflight`/`already_superseded`/`already_spoken`, reine synchrone Map (kein Timer/Sweep nötig, `endTurn()` im `finally`).

**Edits:** `src/config.js` (Schalter `shimSupersedeExtendedTurn`, Default **AN**), `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV, `src/claude.js` (neues Token `TURN_STOP_SUPERSEDED`, `agentTurn` nimmt optionales `abortSignal`, Abbruchprüfung an Schleifengrenze vor Transkript-Schreiben, gemeinsame `turnTelemetry()`-Closure gegen Duplizierung), `src/telnyx-llm-shim.js` (Riegel-Aufruf nach allen Gates, stummer Sprech-Draht-Wrapper, Registrierung/Abmeldung, leere Completion bei Verdrängung, neuer Log-Kanal `kind=supersede`), `test/config-namespaces-helper.js`.

**Tests (Plan):** zwei neue Dateien, `GQ-P1-1..19`: Registry-Ebene (Verdrängung, `no_inflight`, `already_spoken`, `already_superseded`, Doppel-Verdrängung-Schutz, Call-Isolation), Shim-Handler-Ebene über harte Überlappung mit einem lokalen freigebbaren `agentTurn`-Double (Verdrängung wirkt/wirkt nicht je nach `prevRelation`, leere gültige Completion, PII-Freiheit der Logzeile, Flag-Aus-Bestandsverhalten, kein `farewell_scheduled` bei verdrängtem `endCall:true`), `agentTurn`-Kontrakt-Ebene (kein Modellaufruf bei vorab abgebrochenem Signal, genau ein `usage_event` bei Abbruch während laufender Runde, `endCall:false` erzwungen, `stopReason==="superseded"` ist keine Budget-Achse).

**Deterministisches Ergebnis (Plan):** `node --check` auf 4 Dateien, neue Tests isoliert grün, `npm test` grün, Vier-Orte-Grep des Schalters, Negativ-Diff gegen Safety-Gate-Dateien leer. Rückweg: `TELNYX_SHIM_SUPERSEDE_EXTENDED_TURN=false` im Render-Dashboard, kein Deploy nötig.

---

## Implementierung — Zusammenfassung

Exakt nach Plan umgesetzt:
- `src/telnyx-turn-supersede.js` (neu): `makeInFlightTurnRegistry` mit `beginTurn`/`supersedeTurn`, Grund-Token `no_inflight`/`already_superseded`/`already_spoken`.
- `src/claude.js`: `agentTurn` nimmt optionales `abortSignal` entgegen; Schleifengrenzen-Check + neuer Rückgabezweig `superseded:true` ohne `agent`-Transkriptzeile; `TURN_STOP_SUPERSEDED`-Konstante.
- `src/telnyx-llm-shim.js`: Verdrängung bei `prevRelation===EXTENDS`, Reihenfolge NACH allen Gates; stummer Sprech-Draht via `speakChunk`-Wrapper; leere gültige Completion bei Verdrängung; neuer Log-Kanal `kind=supersede`.
- Schalter `TELNYX_SHIM_SUPERSEDE_EXTENDED_TURN`, Default **AN**, an allen 4 Stellen (`config.js`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV).
- Zwei neue Testdateien, 19+1 Tests (GQ-P1-1..15 inkl. Gegenbeispiel 14b, GQ-P1-16..19), alle grün.

**Ergebnis:** `npm test` 3910/3910 grün (i18n-katalogbereinigt 3890/3890), 0 fail — json- und pglite-Backend im selben Lauf. Kein Safety-Gate-/Auth-/Route-Policy-Diff (Grep-Gegenprobe leer). `disclosureSentence`-Vorkommen unverändert (5, wie master).

**Smoke-Test:** nicht vollständig möglich — Boot-Guard verlangt vollständige Telnyx-Assistant-Env-Kette bzw. eine geseedete aktive Nummer für `/healthz`-Start. Ersatz: Config-Ladeprüfung per `node -e` (`shimSupersedeExtendedTurn===true` bestätigt) plus die zahlreichen im `npm test` enthaltenen Spawn-/Integrationstests.

### Deviations
1. **Zwei Bestandstests angepasst** (vom Plan selbst als byte-identisch begründet, nicht neu erfunden): `al-p7-shim-stream-wire.test.js` — pinnte `undefined` für den nicht durchgereichten Sprech-Abnehmer, ist jetzt `null` (für `streamSinkFor` äquivalent, siehe Plan-Anmerkung "Byte-Gleichheit"). `config-shape.test.js` — pinnte volle `telnyxAssistant`-Config-Shape inkl. Key-Anzahl im Testnamen (11→12), neuer Schalter musste ergänzt werden.
2. **Vier-Orte-Beleg-Grep** traf in `src/config.js` zwei Zeilen (Env-Var-Name + `process.env`-Zugriff derselben `boolEnv`-Deklaration) statt der im Plan genannten "genau 4 Treffer" — inhaltlich vollständig, alle vier Dateien belegt, nur `config.js` hat programmbedingt zwei Vorkommen in derselben Deklaration.

---

## Safety-Urteil (final)

**Verdict: PASS.** Approved, alle Kern-Flags grün: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`.

**Eigene unabhängige Läufe:** frischer Worktree, `node_modules`-Symlink auf Haupt-Repo. (1) `npm test`: 3910/3910, 0 fail, exit 0, 99,9 s. (2) pg-Backend-Subset (pglite, 49 Dateien + betroffene GQ-P1-/Shim-Tests): 508/508, 0 fail, exit 0, 62,3 s. Alle 20 GQ-P1-Tests in beiden Läufen grün. `node --check` sauber. Worktree-`git status` sauber. Kein Flake beobachtet.

**Begründung (Auszug):** Diff = 12 Dateien, +823/-14, ausschließlich GQ-P1, keine neue Dependency. Riegel-Reihenfolge im Shim exakt eingehalten: Existenz-Flag → Bearer → ccid → Call-Resolve → Loop-Guard → Rate-Gate → Budget-Gate → erst dann der Riegel. Pro-Tenant-Kostendecke bleibt voll wirksam: Abbruch ist kooperativ (nur Schleifengrenze/vor Transkript-Schreiben, nicht im Modell-Aufruf), `completeRound` bucht jede gefahrene Runde genau einmal (GQ-P1-17 misst am echten `usage_event`-Ledger, `PAYMENT_ENABLED=true`, genau 1 Event). `blockingBudgetAxis`/`isBudgetAxis` unangetastet; `superseded` ist bewusst keine Geld-Achse (GQ-P1-19). Offenlegung: `disclosureSentence` nicht im Diff, `bridge.js` gar nicht berührt — die fehlende `agent`-Zeile beim verdrängten Turn schützt die Offenlegung sogar (verhindert, dass ein Nachfolge-Turn den Offenlegungssatz als "schon gesagt" behandelt, obwohl der Anrufer ihn nie hörte). Auth/Route-Policy unberührt, kein neuer Endpunkt. Neue Logzeile PII-frei (nur callId, turnSeq, Boolean, Grund-Token), per Test belegt.

**Concerns (keiner blockiert eine absolute Regel):**
1. **Testlücke am LIVE-Pfad:** alle Ebene-2-Verdrängungstests laufen mit `telnyxShimTokenStreaming=true` (SSE). Live steht `TELNYX_SHIM_TOKEN_STREAMING=false` — `wire===null`, `respond("")` schickt eine JSON-Completion mit `content:""`, eine Draht-Form, die der Bestand auf dem Happy Path nie gesendet hat. Ob Telnyx das als Stille (gewollt) oder abgebrochenen Turn liest, ist ungemessen. Rückweg ist Flag-Flip; Abnahme hängt am nächsten Testanruf.
2. **Budget-Notaus wird um genau einen Request verschoben, nicht umgangen:** verdrängter Turn liefert `stopReason='superseded'` statt Geld-Achse, kein `killCallForBudget`. Kein Bypass — jede Buchung läuft unverändert, Nachfolger trifft `blockingBudgetAxis` bzw. eigene Runde-0-Prüfung. Getestet (GQ-P1-19).
3. **Abweichung von der Lösungsskizze** `tasks/gq-welle0/b-1.md`: dort stand, der Riegel solle in den vorhandenen per-callId-Zustand von `telnyx-conversation-watchdog.js`, "nicht in eine neue Datei". Umsetzung legt zweite per-Call-Map an. Kein Leck (`endTurn` im `finally`, identitätsgeprüft), aber hängt nicht an `watchdog.clear()`/Hangup — falls eine spätere Phase einen Pfad baut, der `finally` umgeht, wäre das ein stiller Eintrag.
4. **GQ-P1-15 (PII-Test)** prüft u.a. gegen einen Zwei-Zeichen-Substring ("Ja") — geringe Aussagekraft dieser Teilprüfung, kosmetisch.
5. **Antwort-Reihenfolge auf der Leitung:** verdrängter Request antwortet erst nach seinem Verdränger (hängt im `await`). Strukturell unvermeidbar, gegen den Provider ungemessen.

---

## Clean-Code-Audit (final)

- **S1:** keine Befunde.
- **S2:** keine Befunde.
- **S3:** keine Befunde.
- **S4** (1 Befund, kein Blocker): `src/telnyx-llm-shim.js`, `makeTelnyxLlmShim`-Handler (~376 Zeilen inkl. Schritte 1-8) — GQ-P1 fügt ~40 weitere Zeilen (Supersede-Check, `inFlight`-Registrierung, `speakChunk`-Wrapper) in denselben Funktionskörper statt eigener benannter Hilfsfunktion. Folgt der bestehenden nummerierten Schritt-Konvention, bleibt lesbar; Fix nur bei nächster Gelegenheit erwägen.

**Verdict: PASS.** Keine S1-/S2-Befunde.

**Pass-Notes:** 46/46 neue/berührte Tests grün, volle Suite 3910/3910, `node --check` sauber auf allen vier geänderten Quelldateien. Riegel sauber isoliert (reine Map+AbortController-Registry, synchrones Node-Handler-Modell, per Test GQ-P1-5/6 belegt). Turn-Telemetrie-Duplizierung in `claude.js` bewusst in `turnTelemetry()`-Closure gezogen (G5). Neuer Config-Schalter mit abweichendem Default (true) konsistent in allen vier Pflichtorten gepflegt. PII-Freiheit des supersede-Log-Kanals per eigenem Test belegt. Kosten-/Sicherheitsachsen unberührt: `TURN_STOP_SUPERSEDED` nachweislich keine Budget-Achse, genau ein `usage_event` pro abgebrochener Runde (GQ-P1-17), Riegel-Reihenfolge nach allen Gates kommentiert und eingehalten.

**Top-TODOs:**
1. Bei nächster Berührung: `makeTelnyxLlmShim`-Handler in kleinere benannte Schritte zerlegen (G30/G34) — kein akuter Handlungsbedarf.
2. Kein weiterer Punkt — Phase ist mergefähig.

---

## Fix-Runden

Keine. `FIXES` leer — Plan, Implementierung, Safety-Review und Clean-Code-Audit liefen ohne Fix-Iteration zum PASS.
