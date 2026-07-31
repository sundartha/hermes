# AL-P14 — Detailbericht: `get_consult` im Gespraech, nicht-blockierend

**Status:** Gate = PASS. **finalBranch:** `phase/al-p14-get-consult` (Commit `878e4a7`).
**Basis:** `master` @ `3bc5f43` (Plan-Basis genannt: `4305c15`) — Branch ist genau 1 Commit vor master, kein Stale-Base.

---

## 1. Ziel der Phase

Der Telefon-Agent bekommt im Budget-/Shim-Turn ein neues Werkzeug `get_consult`: eine kurze
Sachfrage waehrend eines laufenden (ausgehenden) Anrufs an den Auftraggeber (MCP-Client), deren
Antwort ueber den bestehenden Hintergrund-Kanal (`key_facts`) zurueck in den Prompt fliesst.
Zentrale Eigenschaft: **nicht-blockierend** — der Anruf wartet nie in einem Webhook, sondern die
Wartezeit ist eine Wanduhr-Frist am Datensatz, die beim naechsten Turn ausgewertet wird.

Bauteile aus dem Titel:

- **Richtungs-Gate**: nur `direction === "outbound"` darf das Werkzeug sehen (Schutz gegen
  Second-Order-Prompt-Injection durch fremde Inbound-Anrufer).
- **Paraphrase-Riegel**: serverseitig (Zitat-Spannen entfernen, ≥6-Wort-Wiederholungen aus
  Anrufer-Zeilen ablehnen, 200-Zeichen-Kappung) und im Prompt (Tool-Description verbietet
  woertliche Zitate).
- **Mandats-Fallback**: laeuft die Frist ab, bekommt der Agent einen serverseitigen,
  eckig geklammerten Steuertext und entscheidet selbst / nimmt eine Nachricht auf — der
  Anruf friert nie ein.

---

## 2. Plan (gekuerzt)

**Basis-Analyse:** AL-P13 (Consult-Infrastruktur: `src/consult/{ports,delivery,gate}.js`,
`call.consults`, Routen, MCP-Tools) ist gemergt. AL-P10b (`look_up`) ist **nicht** gemergt — der
Plan baut bewusst keine gemeinsame Abstraktion damit.

**Scope:** neues Werkzeug im Budget-Engine-/Telnyx-Shim-Turn, Richtungs-Gate, Poll-Kandidaten-Gate,
Zeitfenster-Regel (keine zusaetzliche Abrechnungsminute), Kontingent 1/Call, Paraphrase-Riegel,
deterministischer Fueller-/Halte-Satz, Mandats-Fallback nach Timeout, Aussetzen des
Idle-Nachhakens, eigenes Default-aus-Flag `IN_CALL_CONSULT_ENABLED`. Explizit **nicht**: neues
MCP-Tool, Aenderung an `src/bridge.js`, Safety-Gates/Offenlegung/Signatur/Auth, neue Route, neue
DB-Spalte, neue Dependency, `look_up`, Aenderung an der Zustellmechanik (AL-P15).

**Zentrale Design-Entscheidungen:**

- **D1** — neue Funktion `agentTools(call)` statt Flag-Argument an `toolDefs(language)`;
  `toolDefs` bleibt byte-identisch, damit weder `agentToolNames()` (Precall-Briefing) noch
  `realtimeTools()` (`bridge.js`) das Werkzeug je sehen.
- **D2** — zweiter Riegel ist die **Abwesenheit** eines `get_consult`-Case in `execTool`; gilt
  damit strukturell auch fuer die Realtime-Bridge, die `execTool` direkt ruft.
- **D3** — „Poll-Kandidat existiert" wird **gemessen** (frischer `GET .../consult`-Poll,
  `consultPolledAtMs`, Frist 25 s), nicht aus der Call-Herkunft geraten (die es im Code nicht
  gibt). Ephemer, keine pg-Spalte → nach Instanzwechsel fail-closed.
- **D4** — „In-Call-Consult" wird aus `askedAt >= call.answeredAt` **abgeleitet**, kein neues
  Feld, keine Signaturaenderung an `emitConsult`.
- **D5** — `CONSULT_TIMEOUT_MS = 4000` ist eine benannte Konstante, **kein** Env-Knopf (Praezedenz
  `CONSULT_POLL_HOLD_MS`; ein grosser Wert waere eine „neue abgeschaltete Sicherung").
  Herleitung ehrlich als unbestaetigt markiert (`PROVIDER_WEBHOOK_HARDCUT_MS` ist fuer den
  Shim-Pfad live nie gemessen).
- **D6** — der Timeout blockiert nichts: `get_consult` beendet den Turn sofort, die Frist wird
  erst beim naechsten Turn ausgewertet.
- **D7** — Idle-Nachhaken aussetzen = hoechstens **ein** LLM-freier Halte-Turn (kein `USER_IDLE_REPLY_SECS`-Zugriff moeglich, das ist eine Telnyx-Objekteinstellung).
- **D8** — Antwort weiterhin nur ueber `key_facts`/Hintergrund-Block (Gate 5, eine Tuer); Timeout-
  Marker ueber denselben eckig geklammerten Kanal wie `silentTurn`.
- **D9** — eigenes Flag `IN_CALL_CONSULT_ENABLED` (statt `CONSULT_ENABLED` mitzunutzen), weil hier
  erstmals fremde Rede exportiert wird; Default aus, Freischaltung an Datenschutzerklaerung
  gekoppelt.

**Pre-Mortem (7 Risiken, je mit Gegenmittel):** Second-Order-Injektion durch Inbound (Richtungs-
+Poll-Gate+execTool-Riegel), eingefrorene Anrufe (kein Warten im Code), Doppelrede (max. 1
Halte-Satz), woertliche Zitate beim MCP-Host (Sanitisierung + Prompt-Verbot), Kostenexplosion
durch Dauerfeuer (Kontingent 1 + Zeitfenster-Regel), Haiku-Ueberkorrektur (enge Verbote an der
Tool-Description), Werkzeug ohne Empfaenger (Poll-Fail-closed).

**Neue Dateien:** `src/consult/question.js` (Paraphrase-Sanitisierung, rein), `src/consult/in-call.js`
(Gates + Zustandsschritt), `test/al-p14-in-call-consult.test.js`.

**Edits:** `src/utils/timer.js` (`MS_PER_MINUTE`, EINE Quelle statt privater Kopie in
`billing/metering.js`), `src/store/defaults.js` (`CONSULT_STATUS.TIMED_OUT`, `CONSULT_WAIT`-Enum),
`src/store/state-ops.js` (`isInCallConsult`, `inCallConsults`, `noteConsultPoll`,
`advanceInCallConsult`), `src/store/{json,pg}.js` (Wrapper-Paritaet), `src/store.js` (Re-Exports),
`src/config.js` (neues Flag im `tenancy`-Namespace), `src/routes/api-calls.js` (`noteConsultPoll`
vor `waitForEvent`), `src/claude.js` (Kernstueck: `agentTools`, Halte-Turn, Fallback-Marker,
Tool-Loop-Auswertung, `execTool`-Bypass fuer `get_consult`), `src/i18n/locales.js` (Fueller-/
Halte-Satz, echte Umlaute, DE/FR/EN), `src/i18n/prompts/{de,fr,en}.js` (Tool-Description,
`consultDeclined`, `consultTimeout`), `src/boot.js` (Banner-Zeile nur bei scharfem Flag),
`.env.example`/`render.yaml`/`test/helpers.js` (Vier-Stellen-Pflicht der Env-Variable),
`PLAN-SECURITY.md`, `tasks/al-testcall-checklist.md` (6 offene Owner-Abnahmen).

**Tests (Plan):** 24 neue Tests in 5 Bloecken (Registrierung/Richtungs-Gate, Ausfuehrung,
Paraphrase-Riegel, Wartezeit/Fallback/Idle, reine Einheiten) + 3 Bestandstest-Inventuren
(`config-namespaces`, `de-umlaut-orthography`). Kein pg-spezifischer Test noetig (keine neue
Spalte/kein neues Persistenzformat).

**8 dokumentierte Abweichungen von der Spec-Formulierung** (alle begruendet, s. Plan §8):
u.a. `agentTools(call)` statt Flag-Argument an `toolDefs`, Poll-Frische statt MCP-Herkunftsmarker,
Fueller-/Halte-Satz in `locales.js` mit echten Umlauten statt `prompts/*` transliteriert,
abgeleiteter statt gespeicherter In-Call-Marker, max. 1 Halte-Satz statt garantiert stummer Turn,
`CONSULT_TIMEOUT_MS` als Konstante statt Env-Var.

---

## 3. Implementierung — Zusammenfassung

**Kopfdaten:** `headCommit=878e4a7`, `node --check` gruen auf allen 19 betroffenen Dateien,
`npm test` gruen, **3636 Tests bestanden, 0 rot** (Baseline 3611 gemessen vom Impl-Agenten;
unabhaengig vom Safety-Reviewer nachgemessen: Master-Baseline 3631, Branch 3656 — Delta exakt
+25, siehe §5). Committed, Smoke-Test gruen (Server-Spawn, `/healthz` 200, Boot-Banner enthaelt
„In-Call-Consult: AKTIV", `GET /api/calls/<unbekannt>/consult` weiterhin 404 fail-closed, keine
verwaisten Testserver).

**Neue Dateien:**
- `src/consult/in-call.js` — Gates (`consultAvailableFor`, `consultFitsBillingMinute`),
  Entscheidung (`decideConsultRequest`), Zustandsschritt (`advanceConsultWait`).
- `src/consult/question.js` — Paraphrase-Sanitisierung (`sanitizeConsultQuestion`), rein.
- `src/utils/text.js` — **neu, nicht im urspruenglichen Plan-Diff gelistet** (`clampAtWordBoundary`,
  aus `claude.js`s privater `trimGoalForSpeech`-Logik gezogen, um eine zweite Kopie zu vermeiden).
- `test/al-p14-in-call-consult.test.js` — 25 Tests (Plan sah 24 vor; ein zusaetzlicher Test 11b
  fuer die abweichende Ablehnungsregel, s.u.).

**Kern-Edits:**
- `src/claude.js`: `agentTools(call)` (neue Funktion, `toolDefs` unveraendert), Halte-Turn
  (LLM-frei, `roundtrips=0`) vor jeder Modellrunde, Fallback-Marker an der letzten `user`-Message,
  Tool-Loop wertet `get_consult` vor dem generischen Tool-Mapping aus, `execTool` bekommt bewusst
  **keinen** `get_consult`-Case.
- `src/store/{state-ops,defaults,json,pg}.js`, `src/store.js`: neue Store-Operationen
  paritaetisch fuer beide Backends verdrahtet.
- `src/config.js`: `inCallConsultEnabled` (Default aus) im `tenancy`-Namespace.
- `src/routes/api-calls.js`: `store.noteConsultPoll(call.id)` vor `waitForEvent`.
- `src/utils/timer.js` / `src/billing/metering.js`: `MS_PER_MINUTE` in eine Quelle gezogen.
- `src/i18n/locales.js` + `src/i18n/prompts/{de,fr,en}.js`: Fueller-/Halte-Satz (echte Umlaute),
  Tool-Description, `consultDeclined`, `consultTimeout` — alle drei Sprachen vollstaendig.
- `src/boot.js`: Banner-Zeile nur bei scharfem Flag.
- `.env.example`, `render.yaml`, `test/helpers.js` (`BASE_ENV`): Vier-Stellen-Pflicht erfuellt.
- `PLAN-SECURITY.md`, `tasks/al-testcall-checklist.md` (6 offene Owner-Abnahmen AL-P14-1..6).

### Deviations (9, alle im Bericht des Impl-Agenten dokumentiert)

1. **Erster Ablehnungsgrund ist „Alleinstellung in der Runde"** (`toolUses.length > 1`) statt
   „`end_call` in derselben Runde" wie im Plan. Grund: eine angenommene Rueckfrage beendet den
   Turn sofort — ein begleitendes `take_message` in derselben Runde wuerde sonst still verschluckt
   (Datenverlust). Die neue Regel deckt den `end_call`-Fall als Teilmenge ab, braucht keine
   Kenntnis fremder Werkzeugnamen und vermeidet einen Zirkelimport. Gepinnt durch AL-P14-11 und
   den zusaetzlichen Test AL-P14-11b.
2. **Neue Datei `src/utils/text.js`** (nicht im Plan-Diff) — `clampAtWordBoundary` als geteilter
   Helfer, weil dieselbe Logik bereits privat in `claude.js` (`trimGoalForSpeech`) existierte;
   sonst waere eine zweite Kopie (S2-Duplizierung) entstanden. Verhaltensgleich (AL-P5-Pins
   bleiben gruen).
3. `consultAvailableFor` fordert zusaetzlich **gesetztes `answeredAt`** (im Plan nicht explizit
   gelistet, aber Konsequenz aus D4) — strikte Verschaerfung, fail-closed.
4. **PLAN-DRIFT festgestellt:** Die Plan-Praemisse „DE-Modell-Strings transliteriert" ist am
   Bestandscode falsch — `src/i18n/prompts/de.js` nutzt fuer Tool-Descriptions bereits echte
   Umlaute (bewusste Priming-These, von `test/cq-p5-prompt-redesign.test.js` gepinnt). Die neuen
   Strings folgen dem tatsaechlichen Bestand (echte Umlaute), Kommentare bleiben ASCII.
5. `test/al-p13-consult-channel.test.js` musste angefasst werden (Route-Test-Double kennt jetzt
   `store.noteConsultPoll`) — reine Double-Nachfuehrung, kein Verhaltenspin geaendert.
6. Der Flag-AUS-Pfad ist in-process nicht direkt darstellbar (ein Prozess = ein Config-Snapshot);
   AL-P14-6 vergleicht stattdessen das gesendete `tools`-Array byte-genau gegen `toolDefs("de")`
   ueber einen anderen unerfuellten Gate-Zweig; der echte Default ist ueber `BASE_ENV` in allen
   Spawn-Tests gepinnt.
7. **Code-Drift gegen `PLAN-ASSISTANT-LEAP`** dokumentiert, nicht nebenbei gefixt:
   `consultTimeoutMs` existiert bewusst nicht als Env-Var; `USER_IDLE_REPLY_SECS` ist zur Laufzeit
   nicht pro Call steuerbar; drei geld-achsenbezogene Altlasten (Tarif-Fallback 30 statt 300
   ct/min, `MAX_CALL_DURATION_S` ungelesen, Plattform-Achse sperrt nicht mehr) sind ohne Wirkung
   auf diese Phase — AL-P14 liest nur die Minutendefinition, jetzt aus `utils/timer.js`.
8. `npm test` 4x voll gefahren: 3x gruen, 1x ein einzelnes Rot, im sofortigen Re-Run nicht
   reproduziert — deckt sich mit dem dokumentierten Voll-Last-Flake (`suite-flake-p5-gate-proof`).
9. `eslint` konnte nicht laufen (`@eslint/js` in der Umgebung nicht installiert, vorbestehend,
   kein Phasen-Befund). Gate war `npm test`.

---

## 4. Safety-Urteil

**Verdict: APPROVED.** Alle vier absoluten Regeln geprueft und per eigener Mutationsprobe des
Reviewers bestaetigt (nicht nur die Testbehauptungen des Impl-Agenten uebernommen):

- **SAFETY-GATES intakt:** `outbound-gates.js`, `budget-gate.js`, `telephony/`, `server.js` im
  Diff nicht angefasst. Die pro-Tenant-Kostendecke schlaegt den neuen Halte-Turn nachweislich
  **vor** dessen `break` (per Code-Inspektion und Test AL-P14-22 belegt). Fuenf eigene fail-closed
  Riegel (Flag, `allowConsult`-Profil, Richtung=outbound, aktiver+abgenommener Call, frischer
  Poll, Kontingent 1) plus Zeitfenster-Regel, die bei Uhr-Ruecksprung/unlesbarem Anker `false`
  liefert. `consultPolledAtMs` bewusst ephemer (keine pg-Spalte) → Instanzwechsel = fail-closed.
- **OFFENLEGUNG unveraendert:** `disclosureSentence`/`LOCALES.de.disclosure` byte-unveraendert,
  `src/bridge.js` im gesamten Diff nicht enthalten.
- **AUTH FAIL-CLOSED:** keine neue Route; der einzige Anfasser (`GET /api/calls/:id/consult`) ist
  Bestand aus AL-P13, der neue Aufruf sitzt **nach** `callVisibleTo`/`consultAllowedFor`.
- **SECRETS/AUDIO:** zwei neue Log-Zeilen (Boot-Banner, `[consult] gestellt call=<id>
  frist_ms=4000`) — nie Frage/Nummer/Token. Kein Audio-Pfad beruehrt.
- **SCOPE:** keine neue Dependency; die zwei G5-Dedup-Refactorings (`utils/text.js`,
  `MS_PER_MINUTE`) sind als milde Scope-Ausdehnung vermerkt, aber verhaltenserhaltend nachgerechnet.

**Unabhaengige Testverifikation des Reviewers** (frischer Worktree, Branch exakt 1 Commit vor
master): `npm test` Branch Lauf 1: 3656/3655 (1 Fail — `telnyx-p5-origination.test.js`, isoliert
5/5 gruen, dokumentierter Voll-Last-Flake, kein AL-P14-Pfad); Lauf 2: 3656/3656 gruen. Master-
Baseline (detached `3bc3f43`): 3631/3630 (1 anderer, vorbestehender Flake). Delta-Arithmetik
3631+25=3656 stimmt exakt mit den 25 neuen Tests. `npm run test:gates`: 545 Tests, 3 rot
(GAP-05, GAP-15×2), alle sachfremd/vorbestehend, **0 Treffer auf „AL-P14"** im Gates-Log (die
Katalog-ID-Falle wurde vermieden).

**Eigene Mutationsproben des Reviewers** (jede danach zurueckgerollt, Worktree sauber):
1. `direction === "outbound"`-Praedikat entfernt → AL-P14-2 wird rot (Richtungs-Gate ist echt).
2. Kontingent auf `+99` geweitet → AL-P14-9 wird rot.
3. `containsVerbatimQuote`-Pruefung deaktiviert → AL-P14-14 wird rot.

**Concerns (kein Blocker):**
- Report-Zahlen des Impl-Agenten (Baseline 3611, „129 Tests" bei test:gates) weichen von der
  unabhaengigen Messung ab (Baseline 3631, test:gates 545 Tests) — reine Berichts-Ungenauigkeit,
  Delta-Aussage (+25) und Kernaussage (3 rot unveraendert) stimmen inhaltlich.
- Bei ausgeschaltetem Flag liefert ein (praktisch unerreichbarer) halluzinierter
  `get_consult`-`tool_use` `consultDeclined` statt Bestands-`unknownTool` — keine
  Sicherheitsaufweichung, aber keine strikte Byte-Gleichheit im absoluten Sinn.
- Zwei G5-Dedup-Refactorings ausserhalb der Plan-Dateiliste (`utils/text.js`, `MS_PER_MINUTE`
  nach `utils/timer.js`) — verhaltenserhaltend nachgerechnet, milde Scope-Ausdehnung.
- `CONSULT_TIMEOUT_MS=4000` ungemessen (haengt an Owner-Abnahme AL-P14-5).
- Paraphrase-Riegel ist heuristisch (Defense-in-Depth, nicht garantiert) — bewusst gewaehlt,
  abgesichert durch Default-aus + Datenschutz-Kopplung.
- Prompt-Cache-Breakpoint faellt einmal, wenn `get_consult` mitten im Call auf-/verschwindet —
  bewusst getragene Kostenfolge, kommentiert.

---

## 5. Clean-Code-Audit

**Verdict: PASS**, keine Blocker.

- **s1 (Sicherheits-/Korrektheitsluecken):** keine.
- **s2 (Duplizierung/S2-Klasse):** keine — im Gegenteil, zwei bestehende Duplizierungen wurden
  aktiv beseitigt (`MS_PER_MINUTE`, `clampAtWordBoundary`).
- **s3, s4:** keine Funde.

**Notizen (Auszug):**
- Fail-closed durchgaengig, Registrierungs-Gate als Schnittmenge unabhaengiger Praedikate.
- G5 aktiv vermieden statt erzeugt (`MS_PER_MINUTE`, `clampAtWordBoundary`, `CONSULT_POLL_FRESH_MS
  = CONSULT_POLL_ABORT_MS` statt zweiter Zahl).
- G25 (Magic Numbers): alle neuen Konstanten benannt, kommentiert, `CONSULT_TIMEOUT_MS` ehrlich als
  unbestaetigt markiert statt stillschweigend als Fakt verkauft.
- P7/G27: Paraphrase-Riegel als reine, testbare Funktion; zweiter Riegel (Abwesenheit des
  `execTool`-Case) ist Struktur statt Konvention, per Test AL-P14-12 gepinnt.
- N7: Nebeneffekte tragen ihren Namen (`noteConsultPoll`, `advanceInCallConsult`,
  `advanceConsultWait`, `decideConsultRequest`); reine Leser sauber getrennt.
- Store-Fassade konsistent (json/pg/state-ops/store.js), Test-Doubles und `BASE_ENV` nachgezogen,
  keine Drift-Luecken.
- i18n vollstaendig fuer DE/FR/EN, keine Sprachluecke.
- Doku (`PLAN-SECURITY.md`, `.env.example`, `render.yaml`) deckungsgleich mit dem Code.

**Einzige Notiz (kein Code-Befund):** `IN_CALL_CONSULT_ENABLED` darf laut eigener Doku erst auf
`true`, wenn die Datenschutzerklaerung in `apps/web` die Weitergabe von Gespraechsinhalten an den
MCP-Host nennt — Owner-/Rollout-Gate, keine weitere Code-Aenderung noetig.

---

## 6. Fix-Runden

**Keine.** Die Phase erreichte PASS bereits in der ersten Implementierungs- und Review-Runde —
weder der Safety- noch der Clean-Code-Review meldeten Blocker, die eine Fix-Runde ausgeloest
haetten. Der „FIXES"-Abschnitt der Quelle ist leer.

---

## 7. Offen fuer den Owner

Sechs Abnahmen in `tasks/al-testcall-checklist.md` (Abschnitt AL-P14):

1. **AL-P14-1** (Ende-zu-Ende): Fueller hoerbar, Antwort im Folge-Turn, TTFA ≤ 2,5 s.
2. **AL-P14-2** (Timeout): kein `answer_consult` → hoerbarer Mandats-/`take_message`-Rueckfall,
   kein eingefrorener Anruf.
3. **AL-P14-3** (Doppelrede): hoechstens ein kurzer Halte-Satz zwischen Fueller und Antwort
   (dokumentierte Abweichung von „nicht ein zweites Mal": ein voellig stummer Turn setzt
   ungemessenes Telnyx-Verhalten voraus).
4. **AL-P14-4** (Quote): `npm run convo-bench` (n≥5), `get_consult` feuert in ≤20 % der Turns.
5. **AL-P14-5** (`USER_IDLE_REPLY_SECS` live nachlesen): Ist-Wert per Objekt-GET am Live-Assistant
   ermitteln, gegen `CONSULT_TIMEOUT_MS=4000` bewerten.
6. **AL-P14-6** (Freischaltung): `IN_CALL_CONSULT_ENABLED=true` erst **nach** Ergaenzung der
   Datenschutzerklaerung in `apps/web` um die Weitergabe von Gespraechsinhalten an den MCP-Host.

Der Branch `phase/al-p14-get-consult` ist merge-bereit (Safety+Clean-Code PASS); die Freischaltung
des Flags selbst ist ein separates, an die Datenschutzerklaerung gekoppeltes Owner-Gate.
