# AL-D1 — Zwei Live-Befunde: Ursache messen

**Spec:** `tasks/assistant-leap-chain.md`, Abschnitt „AL-D1 — Zwei Live-Befunde aus dem ersten
Ende-zu-Ende-Anruf". **Basis:** `master` @ `6fe738f`. **Diese Phase fixt nichts.**

Geliefert wurden drei Dinge: (1) ein Beweis am Code, (2) ein Messinstrument fuer genau die eine
Tatsache, die heute in keinem Log steht, (3) dieser Bericht mit den Owner-Fragen.

---

## 1. Befund B — Ursache am Code BELEGT, kein Defekt

`streamSinkFor` (`src/claude.js`) ist dreifach fail-closed. Bedingung 2 lautet: der Werkzeugsatz
der Runde muss AUSSCHLIESSLICH aus Seiteneffekt-Werkzeugen bestehen
(`SIDE_EFFECT_ONLY_TOOL_NAMES` = `end_call`, `take_message`). `agentTools(call)` legt darueber
hinaus `get_consult` (bei `consultAvailableFor`) und `look_up` (bei `lookupAvailableFor`) in
denselben Satz.

**Folgerung:** sobald `look_up` ODER `get_consult` in einem Anruf armiert ist, ist `sink === null`
in JEDER Runde jedes Turns -> `completeStream()` wird nie gerufen -> `wire.chunkCount()` bleibt 0
-> `"streamChunks":0`. Genau das Live-Bild aus `call_msabz9975sph`.

Das ist **kein Defekt, sondern die gepinnte Zusage von AL-P7**: `AL-P7-20` faehrt dieses Szenario
und ist gruen. Der Grund steht am Kommentar von `streamSinkFor`: der Text einer nicht armierten
Runde kann noch verworfen (naechste Runde ueberschreibt `speech`) oder ersetzt werden
(`get_consult` setzt den Ueberbrueckungssatz) — „gesprochen ist gesprochen".

**Reproduziert, offline, beide Wege:** `AL-D1-2` (Weg `look_up`) und `AL-D1-3` (Weg
`get_consult`) — jeweils `streamArmedRounds === 0`, `chunks === []`, `stream !== true` auf dem
Draht. `AL-D1-4` ist die Positivkontrolle: rein seiteneffekt-basierter Satz ->
`offeredToolNames === ["end_call","take_message"]`, `streamArmedRounds === 1`, mehrere Chunks.
Ohne diese Kontrolle waeren AL-D1-2/-3 auch bei komplett totem Streaming gruen.

**Zweite, unabhaengig hinreichende Ursache (Bedingung 3), NICHT ausgeschlossen:**
`deadlineMs = turnLoopDeadlineMs(synthTimeoutMs) = 15000 - (synthTimeoutMs + 1500)`. Mit den
Defaults (`ELEVENLABS_SYNTH_TIMEOUT_MS=2000`, `LLM_REQUEST_TIMEOUT_MS=3500`) haelt sie
(`0 + 3500 <= 11500`). Ein live gesetztes `LLM_REQUEST_TIMEOUT_MS > 11500` oder ein grosses
`ELEVENLABS_SYNTH_TIMEOUT_MS` schaltet das Streamen ebenfalls schon in Runde 0 ab. Das ist
Konfiguration, nicht Code — und genau der Fall, den das Instrument von Bedingung 2 trennt
(Entscheidungstabelle unten, Zeile H-B2).

**Zusatzbefund, ohne Codeaenderung ablesbar:** `"streamChunks":0` schliesst das Denk-Signal ein —
`thinkingSignal.speakBridge` schreibt ueber denselben `onSpeechChunk`. Es feuert nur bei
`loopContinues`. In Turns 1-6 (kein Werkzeug) und 7-9 (`take_message` + Text = Seiteneffekt-Runde)
ist `loopContinues` false. Die bestehende `turn_ok`-Spalte `thinkingSignal` muss in allen 9 Turns
`false` gewesen sein — das ist am VORHANDENEN Live-Log verifizierbar (Owner-Messung 2).

---

## 2. Befund A — der naheliegendste Verdacht der Spec ist WIDERLEGT

`consultAvailableFor(call, nowMs)` ist eine Schnittmenge aus sieben Faktoren:

| # | Faktor | Status nach dieser Phase |
|---|---|---|
| 1 | `config.tenancy.inCallConsultEnabled === true` | **offen** — eigener Schalter, von Consult #0 nicht beruehrt (Boot-Banner sagt es) |
| 2 | `consultAllowedFor(profile)` | **bewiesen true** — Poll- UND Antwort-Route gaten darauf, Consult #0 lief durch beide (`accepted:true, merged_facts:3`) |
| 3 | `direction === "outbound"` | true |
| 4 | `status === "active"` | true (9 Turns) |
| 5 | `callAnswered(call)` | true |
| 6 | `consultClientIsPolling(call, nowMs)` | **offen — der einzige zeitabhaengige Faktor** |
| 7 | `inCallConsults(call).length < MAX_IN_CALL_CONSULTS_PER_CALL` | **FALSIFIZIERT als Ursache** |

### 2.1 Kein geteiltes Kontingent (H-A4 widerlegt)

`isInCallConsult(call, consult)` (`src/store/state-ops.js`) diskriminiert ueber
`askedAt >= answeredAt`. Consult #0 entsteht im `place_call`-Pfad beim WAEHLEN, `answeredAt` erst
spaeter ueber `markAnswered` — also `askedAt < answeredAt` -> **kein** In-Call-Consult ->
Kontingent bleibt bei 0/1.

Bisher pinnte nur `AL-P14-23` den Diskriminator selbst. Neu ist der **Kompositionstest**
`AL-D1-1`: ein Call mit beantwortetem Consult #0 und frischem Poll bekommt `get_consult`
trotzdem in den Werkzeugsatz. Damit ist der Verdacht nicht nur widerlegt, sondern gegen Rueckfall
gesichert.

**Konsequenz fuer den Owner:** die Frage „brauchen Consult #0 und der In-Call-Consult getrennte
Kontingente" stellt sich **nicht** — sie sind bereits getrennt. `MAX_IN_CALL_CONSULTS_PER_CALL`
wurde nicht angefasst.

### 2.2 Verbleibender heisser Kandidat: Faktor 6 (Poll-Frische)

`CONSULT_POLL_FRESH_MS = CONSULT_POLL_ABORT_MS = 22000 + 3000 = 25000`. `consultPolledAtMs` wird
NUR in `GET /api/calls/:id/consult` gesetzt (`store.noteConsultPoll`), also durch
`await_call_event`. Der Long-Poll haelt 22 s; die Frischegrenze liegt 3 s darueber. Der
Quellkommentar behauptet, „ein Client in der Schleife erneuert den Wert lange vor Ablauf" — bei
einem MCP-Host ist das **nicht selbstverstaendlich**: zwischen zwei `await_call_event`-Aufrufen
liegt ein voller Modell-Zug des Hosts. Ueberschreitet der 3 s, entstehen tote Fenster, in denen
`get_consult` aus `agentTools` faellt.

Zwei weitere, ohne Codeaenderung pruefbare Wege, wie Faktor 6 kippt:

* **Re-Attach:** `consultPolledAtMs` ist ephemer (kein `save`, keine Spalte). Ein aus der DB
  nachgeladener Call startet mit `undefined` -> `|| 0` -> nie frisch. Der Shim loggt das als
  `[telnyx-shim] reattached`.
* **Instanzwechsel** waehrend des Anrufs (dieselbe Wurzel).

**Diese Phase kann Faktor 6 fuer den Live-Anruf nicht rueckwirkend entscheiden** — der Wert stand
nie in einem Log. Genau dafuer ist das Instrument da.

### 2.3 Warum das Instrument noetig war

`turn_ok` trug `toolNames` — das sind die vom Modell GEFEUERTEN Werkzeuge (`firedTools`), nicht
die ANGEBOTENEN. Ohne diese Unterscheidung ist Frage 1 der Spec („liegt `get_consult` ueberhaupt
in `agentTools(call)`?") strukturell unbeantwortbar und Frage 3 („Werkzeugsatz oder
Modell-Entscheidung?") ebenfalls.

---

## 3. Was gebaut wurde (rein additiv, PII-frei)

| Datei | Aenderung |
|---|---|
| `src/consult/in-call.js` | `clientIsPolling` -> exportiert als `consultClientIsPolling` (reine Extraktion, kein Verhalten; G5: EINE Frischepruefung fuer Gate UND Diagnose) |
| `src/claude.js` | `offeredTools` (Set, Union ueber die Runden) + `streamArmedRounds`; beide additiv im Rueckgabewert als `offeredToolNames`/`streamArmedRounds` |
| `src/telnyx-llm-shim.js` | `turn_ok` traegt `offeredToolNames`, `streamArmedRounds` (beide fail-safe wie `toolNames`/`roundtrips`) und `consultPollFresh` (Momentaufnahme VOR dem Turn) |

Keine neue Env-Variable, keine neue Konstante, keine neue Zahl, keine Migration, keine
Dependency. `.env.example`, `render.yaml`, `test/helpers.js` `BASE_ENV` unberuehrt.
Die Logzeile traegt ausschliesslich Code-Konstanten, Booleans und Zahlen — die Werkzeugnamen
stammen aus `toolDefs`/`getConsultToolDef`/`lookUpToolDef`, dieselbe PII-Klasse wie das
bestehende `toolNames` (negativ gepinnt in `AL-D1-5` und `AL-D1-7`).

**Keine Aenderung an Gates, Offenlegung, Auth, Geldpfad.** `MAX_IN_CALL_CONSULTS_PER_CALL`,
`CONSULT_POLL_FRESH_MS` und die Armierungsregel in `streamSinkFor` stehen unveraendert.

---

## 4. Tests + Mutationsproben

`test/al-d1-cause-diagnostics.test.js` (AL-D1-1 … AL-D1-6, Anthropic-Mock mit echtem SSE) und
`test/al-d1-shim-diagnostics.test.js` (AL-D1-7 … AL-D1-9, Shim-Harness). **9 pass, 0 fail.**
Kein Bestandstest wurde geaendert.

**Mutationsprobe 1** — in `streamSinkFor` die Zeile
`if (!tools.every((t) => isSideEffectOnlyTool(t.name))) return null;` entfernt:
`AL-D1-2`, `AL-D1-3` **und** der Bestandstest `AL-P7-20` werden rot (3 fail); nach Ruecknahme
wieder gruen. Damit ist belegt, dass die Tests genau an Bedingung 2 haengen.

**Mutationsprobe 2** — `streamArmedRounds += 1` unbedingt statt `if (sink)`:
`AL-D1-2`/`AL-D1-3` rot, `AL-D1-4` gruen. Damit ist belegt, dass die Zahl wirklich die
Armierung misst und nicht die Rundenzahl.

---

## 5. Owner-Messung (Rest der Phase, kein Code)

1. **Boot-Log des Live-Commits** lesen: `In-Call-Consult: …` · `Token-Streaming: …` ·
   `Denk-Signal: …` · `In-Call-Nachschlag: …` · `Consult-Kanal: …`.
   -> beantwortet Faktor 1 (H-A2) und, ob `look_up` ueberhaupt armierbar war (H-B1).
2. **Die 9 `turn_ok`-Zeilen von `call_msabz9975sph`**: war `thinkingSignal` in allen Turns
   `false`? Gab es fuer diesen Call eine `[telnyx-shim] reattached`-Zeile? (Re-Attach nullt
   `consultPolledAtMs` -> Faktor 6 dauerhaft false.)
3. **Per-Tenant-Recht**, falls der Anruf nicht unter `BOOTSTRAP_TENANT_ID` lief (`resolveProfile`
   pinnt fuer Bootstrap `OWNER_PROFILE` mit `allowConsult:true, allowLookup:true` hart):
   `psql "$(cat ~/.config/hermes/db-url)" -c "SELECT tenant_id, data->>'allowConsult', data->>'allowLookup' FROM profile;"`
   (Firewall-Lehre: nach Zwangstrennung neue IP im Render-Dashboard eintragen.)
4. **Nach dem Deploy des Instruments: EIN weiterer Testanruf**, dann die drei neuen Felder lesen:

| `offeredToolNames` | `streamArmedRounds` | `consultPollFresh` | Schluss |
|---|---|---|---|
| enthaelt `get_consult` | 0 | — | H-A3: **Modell-Entscheidung** -> Folgephase am Tool-Entscheidungspunkt (enge Verbote) |
| ohne `get_consult` | 0 | `false` | H-A1: **Poll-Frische** -> Owner-Frage zu `CONSULT_POLL_FRESH_MS`/Hold-Kadenz |
| ohne `get_consult` | 0 | `true` | statischer Faktor -> das Boot-Banner aus (1) sagt welcher |
| nur `end_call`+`take_message` | 0 | — | H-B2: **Bedingung 3** (Frist/Konfiguration), nicht der Werkzeugsatz |
| irgendetwas | > 0 bei `streamChunks:0` | — | Chunker-Defekt -> **neuer**, eigenstaendiger Befund |

---

## 6. Owner-Fragen (bewusst NICHT in dieser Phase entschieden)

* **Befund B, Design:** soll die Armierungsregel gelockert werden (Streamen auch bei
  informationslieferndem Werkzeug im Satz) — mit dem Risiko hoerbarer Doppelrede, wenn die
  Folgerunde den Text ueberschreibt oder `get_consult` ihn ersetzt? Oder soll stattdessen das
  Denk-Signal (AL-P7b) ausgeweitet werden, das genau fuer diesen Fall gebaut ist? Solange
  `look_up` UND `get_consult` live armiert sind, ist Token-Streaming faktisch wirkungslos.
* **Befund A, falls H-A1 sich bestaetigt:** ist die 3-s-Marge zwischen Poll-Hold (22 s) und
  Frischegrenze (25 s) fuer einen MCP-Host zu knapp? Eine Anhebung ohne Messung waere genau die
  „neue abgeschaltete Sicherung", die CLAUDE.md verbietet — und sie hat einen Preis: ein zu
  grosser Wert bietet `get_consult` an, wenn laengst kein Client mehr wartet (jede Rueckfrage
  kostet dann eine Runde plus 4 s Wartezeit fuer eine Frage, die niemand hoert).
* **Befund A, unabhaengig davon:** `consultPolledAtMs` ist ephemer. Ein Instanzwechsel oder
  Re-Attach mitten im Anruf toetet Faktor 6 dauerhaft. Ob dieser Zustand persistiert werden soll,
  ist eine eigene Design-Frage (Kosten: eine Spalte, ein Schreibpfad, ein Loeschpfad).
