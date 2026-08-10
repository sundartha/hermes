# Kickoff: die 91-Sekunden-Kappung finden, dann die Restarbeit (ab 2026-08-10)

Prompt fuer die naechste Session. Autor: Lead-Session 82377637 (GQ-P18 + B4b + Hangup-Diagnose).
**Regel dieser Datei: GEMESSEN traegt ein Kommando. Alles andere ist als Vermutung markiert.**

---

## 1. Arbeitsweise: LEAN LEAD — das ist bindend, nicht empfohlen

Der Owner will diese Session ausdruecklich als **schlanken Lead**: du orchestrierst, du liest
nicht selbst den halben Code.

- **Delegiere aggressiv an Subagenten.** Suchen, Lesen, Querlesen, Inventuren, Diff-Analysen,
  Log-Auswertungen gehen an `Explore`/`general-purpose`-Agenten. Du bekommst die Schlussfolgerung,
  nicht die Dateidumps.
- **Umbauphasen laufen ueber `phase-impl-lean`** (Skill). Der Lead liest dabei NIE den Code des
  Impl-Agenten; er prueft das Gate-Ergebnis und merged selbst.
- **Modellpolitik:** Plan + Safety-Review = Opus, Impl/Audit/Fix/Report = Sonnet. Pins **explizit
  pro `agent()`**, nie erben lassen.
- **EINE Bahn zur Zeit.** Zwei parallele Wellen = 35 gleichzeitige `node --test` = Load 32 auf
  15 Kernen. Nicht machen.
- **`phase-impl-lean` braucht `args` als OBJEKT** mit `phaseId`, nie Freitext. Der Auftragstext
  gehoert in eine Spec-Datei, die **committet sein muss**, bevor der Worktree entsteht.
- **Vor JEDEM Merge selbst `git diff --stat master...<branch>` ansehen.** Ein Workflow-PASS ist
  keine Merge-Freigabe; ein toter Impl-Agent liefert einen leeren Branch MIT PASS.
- Worktrees nach jedem Workflow aufraeumen; der Pfad enthaelt ein Leerzeichen
  (`while IFS= read -r`, nicht `for w in $(...)`).

---

## 2. Stand (GEMESSEN am 2026-08-10)

| Behauptung | Kommando |
|---|---|
| `master` = `9d4e788` + Folgecommits, **live deployt** | `git log --oneline -1` + `curl -s https://vodafone-agent.onrender.com/healthz` |
| Suite gruen **4138/4138**, Exit 0 | `npm test` |
| GQ-P18 (Sprechsperre) live, `TELNYX_SHIM_EXTEND_HOLD_MS=3000` | Owner hat gesetzt; jede `hold`-Zeile traegt `holdMs:3000` |
| Hangup-Ursache steht seit `bd8610c` im Log | `[voice/call-control] ... hangup_cause=... hangup_source=... sip_hangup_cause=...` |

**Erster Handgriff:** `git fetch --all && git log --oneline -1`, `npm test`, `/healthz` gegen
`git rev-parse master`. Stimmt eines nicht, halte an.

---

## 3. ⚠️ HAUPTAUFGABE — jeder Anruf wird nach ~91 Sekunden gekappt

### Der Fakt (drei Anrufe, gemessen aus `call.answered` -> `call.hangup`)

| Anruf | angenommen | Hangup | Dauer |
|---|---|---|---|
| `call_mslz71hv6ogm` (09.08., **vor** GQ-P18) | 15:47:13,972 | 15:48:44,960 | **90,99 s** |
| `call_msmwx6iro92m` (10.08., Vorfall) | 07:31:16,685 | 07:32:47,604 | **90,92 s** |
| `call_msmytq5f63q2` (10.08.) | 08:24:38,781 | 08:26:10,065 | **91,28 s** |

Streuung **0,36 s**. Das ist eine feste Grenze, kein Mensch. Der Hangup ist sauber:
`hangup_cause=normal_clearing hangup_source=callee sip_hangup_cause=200`.

**Symptom fuer den Anrufer:** der Agent wird mitten im Satz abgeschnitten; danach ist die
Leitung netzseitig weg, das Handy zeigt die Sitzung aber weiter an. Der Owner sprach in eine
tote Leitung und musste selbst auflegen. Fuer den MCP-Client sieht der Anruf beendet aus
(`await_call_event` -> `done`) — **`done` ist deshalb kein Beweis, dass die Leitung weg ist.**

### **OWNER-AUSSAGE, BINDEND: das ist ein Fehler auf UNSERER Seite.**

Das Telnyx-Konto ist **komplett verifiziert**; die Trial-Vermutung ist erledigt. Die
US-DID-Vermutung ist ebenfalls erledigt. **Es hat vorher immer funktioniert.** Wer diese zwei
Hypothesen noch einmal aufmacht, verbrennt Zeit — sie sind vom Owner ausgeschlossen.

### Schon ausgeschlossen (nicht neu erheben)

| Kandidat | Warum raus |
|---|---|
| Telnyx `time_limit_secs` | steht auf **1800** (Live-GET am Assistant-Objekt) |
| Telnyx `user_idle_timeout_secs` | **null** |
| Telnyx-Hangup-Werkzeug | Assistant hat **`tools: []`** |
| unser `end_call` / Abschieds-Hangup | **kein** `farewell_scheduled` bei allen drei Anrufen — und die Zeile funktioniert nachweislich (viermal am 09.08. frueh). Positiv-Kontrolle bestanden. |
| GQ-P18 (Sprechsperre) | der 09.08.-Anruf lief **ohne** sie und wurde genauso gekappt |

### Der beste naechste Schritt (Subagent-Auftrag Nr. 1)

**Zuerst falsifizieren, ab wann es kappt.** Der Owner sagt, es lief frueher. Also:
Dauer **aller** historischen Anrufe aus dem Render-Log rechnen
(`call.answered` -> `call.hangup` je `callId`, `mcp__render__list_logs`, 30 Tage Retention).
Gibt es einen **Stichtag**, ab dem keine Anrufe mehr ueber ~91 s laufen? Dann daneben legen:
Deploys, Env-Aenderungen, Telnyx-Assistant-Versionen (`GET /v2/ai/assistants/<id>/versions`).
**Eine Stufenfunktion in dieser Zeitreihe beantwortet die Frage schneller als jedes Codelesen.**

### Offene Faeden im eigenen Code (ungeprueft)

1. **KS-P3-Notbremse** (`brakeSecondsFor` -> `emergencyBrakeSeconds`, `src/call-duration.js`,
   `src/telephony/outbound-gates.js:797`). Sie deckelt jeden Call aus dem Restguthaben und
   schreibt `call.maxDurationS`. **Teil-geprueft:** `affordableMinutes` rechnet in GANZEN
   Minuten (`floor(remainingCents / tariffCentsPerMin)`), das ergaebe 60/120 s — **nicht 91**.
   Damit ist sie geschwaecht, aber **nicht erledigt**: `emergencyBrakeSeconds` selbst wurde
   nicht zu Ende gelesen (Puffer `BRAKE_BUFFER_MINUTES`, Cap `MAX_CALL_DURATION_CAP_S`), und
   der reale `remainingCents`-Wert des Tenants wurde nicht gemessen. **Erst rechnen, dann
   urteilen.**
2. **Alle weiteren Timer am Call:** `armMaxDurationTimer` + Reserve-Release-Backstop
   (`src/telephony/call-lifecycle.js`), Dead-Air-Achse des Conversation-Watchdogs,
   Cap-Timer in `bridge.js` (nur `VOICE_ENGINE=realtime`, hier vermutlich n. z.).
3. **Loggt unser Terminierungspfad ueberhaupt etwas?** In allen drei Anrufen steht **keine**
   Terminierungszeile. Zwei Lesarten: wir terminieren nicht — oder wir terminieren **stumm**.
   Das ist mit Codelesen in Minuten entscheidbar. Ist der Pfad stumm, **erst eine Logzeile
   einbauen** (Muster: der Hangup-Ursachen-Fix `bd8610c`), dann messen.

**Verifikationsmethode fuer den Fix:** ein Testanruf, der laenger als 100 s dauert. Vorher/
Nachher an derselben Zahl (`call.answered` -> `call.hangup`).

---

## 4. Danach — offene Arbeit nach Dringlichkeit

### a) Ein Testanruf schliesst mehrere Phasen auf einmal

**GQ-P2** (Consult: zwei Fristen) und **GQ-P7** (Zustellfenster der Rueckfrage-Antwort) brauchen
einen Anruf **mit echter Rueckfrage**. Am 10.08. versucht und **gescheitert**: `get_consult` war
in `offeredToolNames`, der Agent hat es nie gewaehlt und stattdessen gesagt, er habe keinen
Kalenderzugriff. Das ist der bekannte Werkzeugwahl-Defekt (AL-D3-Klasse), **nicht** ein Defekt
der Consult-Mechanik. Wer die Phasen abnehmen will, muss den Agenten zuverlaessig in die
Rueckfrage zwingen — sonst misst der Anruf wieder nichts.
**GQ-P4** (stummes Scheitern + Nachrichten-Dedup) braucht einen Ausfall bzw. Anruf.
**GQ-P3** (Inbound auf dem Assistant-Pfad) und **GQ-P6** (Klingelfrist 30->60 s) brauchen einen
**eingehenden** Anruf.

### b) Owner-Entscheidungen, kein Code

- **GQ-P18:** Schutzfenster ueber das Turn-Ende hinaus ziehen? Faengt fast alle Fragmente,
  kostet bei schnellen Turns 1,4-2,2 s. Gemessen: 1 von 5 bzw. 1 von 2 Fragmenten gefangen.
- **WF-4:** `bridge.js` bucht null Token — `VOICE_ENGINE=realtime` faehrt mit blinder Gate-Achse.
- **`OPENING_GOAL_MAX_CHARS=75`** kappt lange Anliegen hoerbar mitten im Satz.
- **`DEFAULT_LANGUAGE`-Flip** (kippt 10 gruene Tests, Offenlegung wird englisch).
- **Animation-Lab-Auswahl** (visuell).

### c) Autonom machbar, ohne Anruf

1. **Prompt-Caching sanieren.** Gemessen am 09.08.: nur **2 von 7** LLM-Aufrufen treffen den
   Cache; der gebuchte Betrag liegt dadurch nur **8,44 %** unter dem ungecachten (Input-Achse
   9,88 %). Wurzel am Code belegt: `systemPrompt` (`claude.js:232`) traegt veraenderlichen
   Per-Call-Zustand (`recordedMessagesSection`, `mandateSection`), und `agentTools`
   (`claude.js:507`) nimmt `get_consult`/`look_up` mitten im Call auf und heraus — das
   "stabile Praefix" ist nicht stabil. Beides ist im Code als bewusste Inkaufnahme
   kommentiert; der Preis steht jetzt da. Saubere eigene Phase.
   **Die Kostendecke wird durch Caching NICHT geschwaecht** (die Vier-Raten-Buchung bepreist
   genau das, was der Anbieter berechnet) — B4b/W6 ist damit **beantwortet**.
2. **Werkzeugwahl:** `look_up` lief am 10.08. zweimal erfolgreich (`ok=true fakten=3`), danach
   behauptete der Agent, er koenne nicht recherchieren. Reiner Prompt-/Verhaltensbefund.
3. **GAP-15** (2 rote Gates): englische Rechtstexte fehlen, Platzhalter im Rechtstext-Content.
   **Rechtstexte nicht auf eigene Faust schreiben** — Owner fragen, ob Entwuerfe gewuenscht
   sind oder nur die Verdrahtung.
4. **Aufraeumen:** 65 Branches, ~70 verwaiste Worktrees.

### d) Bekannt, ohne Traeger

Inbound erreicht die Gate-Achse mit **keiner** Carrier-Kostenart · DID-Miete ungebucht
(geparkt) · `configHash` deckt die Preistabelle nicht ab (nur 7 Safety-/Billing-Achsen) ·
P16 US-Stimme · CSP-Verschaerfung · `Norse.otf` fehlt · **`reson8/turns`** als ungemessener
STT-Kandidat gegen die Fragmentierungs-Wurzel (turn-basiert **mit** Deutsch; vor jedem Wechsel
WER messen, sonst wiederholt sich B-7).

---

## 5. Betriebswissen, das sonst Zeit kostet

- **Der Pro-Call-Block kann `settings` nicht tragen.** `AIAssistantStartRequest.transcription`
  hat laut OpenAPI **genau zwei** Felder: `model`, `language`. Damit sind `smart_format` UND
  die Turn-End-Regler von AssemblyAI/Soniox vom Pro-Call-Pfad unerreichbar. Am 09.08. und
  10.08. unabhaengig belegt — **nicht noch einmal erheben.**
- **`mcp__render__update_environment_variables` ist geblockt** (Classifier), `trigger_deploy`
  war es. Die Blockliste ist **nicht stabil** — versuchen statt aus einer Notiz schliessen.
  Env-Aenderungen macht der Owner im Dashboard.
- **Render deployt `upstream` (jonas986), `autoDeploy: no`.** `git push origin` macht nichts
  live. Deploy-Stand IMMER an `/healthz` gegen `git rev-parse master` pruefen.
- **`configHash` beweist nichts ueber die meisten Env-Werte** — er deckt 7 Achsen ab
  (`src/config-fingerprint.js`). Ein unveraenderter Hash heisst NICHT "Variable nicht gesetzt".
- **Testanrufe:** `objective` unter 75 Zeichen (`OPENING_GOAL_MAX_CHARS`), sonst endet der
  Erst-Turn hoerbar mitten im Satz. Alles Weitere ins `briefing`.
- **Telnyx-Forensik read-only:** `GET /v2/ai/conversations?page[size]=10` (Metadaten tragen
  `call_leg_id`/`call_control_id`), `/v2/ai/conversations/<id>/messages` (Textfeld heisst
  `text`), `GET /v2/ai/assistants/<id>`, `/v2/balance`. Lokal mit
  `node --env-file=.env <skript>`.

### Die drei Fehler dieser Session, damit sie sich nicht wiederholen

1. **Kontrollgruppe zuerst.** Zwei Behauptungen ("erste Verdraengung ueberhaupt", "9 Sekunden
   Stille") fielen sofort, als der Anruf vom Vortag danebengelegt wurde. **Vor jeder Aussage
   ueber "neu" den Vorher-Stand messen.**
2. **Korrelation ist kein Anker.** "Hangup 0,14 s nach dem letzten Wort" sah wie ein Muster
   aus und war ein Artefakt einer Sprechdauer-Schaetzung. Der wahre Anker war die
   **Gespraechsdauer**. Wer eine geschaetzte Groesse als Anker nimmt, findet Muster, die es
   nicht gibt.
3. **Nicht ins Blaue hypothetisieren, wenn der Owner das System kennt.** Trial-Konto und
   US-DID waren beide falsch und haben Zeit gekostet. Bei Betriebsfragen **zuerst fragen**.

---

## 6. Zuerst lesen

1. `CLAUDE.md` — Absolute Regeln
2. `.claude/refs/workflow.md` + `.claude/refs/clean-code.md` — Pflicht
3. **`tasks/gq-chain-state.md`**, Abschnitte "GQ-P18" und "VORFALL 2026-08-10"
4. `tasks/todo.md`, Abschnitte "GQ-P18" und "B4b / W6"
5. `tasks/lessons.md`, die letzten drei Abschnitte
6. `tasks/kickoff-latenz-und-gespraech-2026-08-10.md` — der Vorgaenger; Abschnitt 3 und
   Punkt 6.2 sind **erledigt**, Abschnitt 7 (Betriebswissen) gilt weiter
