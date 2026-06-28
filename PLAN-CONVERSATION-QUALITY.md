# PLAN-CONVERSATION-QUALITY.md

Strategie zur Verbesserung der Outbound-Gespraechsqualitaet (Budget-Engine, Telnyx
live). Entstanden aus der Forensik eines realen Anrufs (call_mqntoe280khb, 2026-06-21)
plus einem Multi-Agent-Design-Workflow (4 Design-Panels + adversariale Pre-Mortem-
Verifikation + Synthese). Jede Phase = ein `phase-impl-lean`-Schnitt, Merge im Lead.

> Status: **UMGESETZT (G0-G4 live auf master, Stand 2026-06-27).** Code-seitig fertig +
> verifiziert; verbleibend nur die bewusst geparkten Live-Gates (Owner). Details unten in
> Abschnitt 0. Owner-Entscheidungen siehe §5.

---

## 0. Umsetzungs-Status (verifiziert 2026-06-27; G4 gemergt 2026-06-28, master 4c94e9d3)

Die Kette wurde NICHT als eigener `phase-impl-lean`-Lauf gefahren, sondern in den spaeteren
P0-Identity-/Onboarding-Sessions mitimplementiert. Alle G0-G4-Code-Ziele sind auf master
gemerged; `npm test` = **1172 pass / 0 fail** (diese Session selbst gefahren, exit 0).

| Phase                     | Status            | Beleg (file:line)                                                                                                                                                                                                          |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 Repro-Harness          | UMGESETZT         | `test/_outbound-harness.js`                                                                                                                                                                                                |
| G1 Identitaets-Bindung    | UMGESETZT         | `claude.js:101` (disclosure aus `tenantContext().ownerName`), `:52` (Persona=`firstName`), `server.js:1094` (Fail-closed 403 `keine_identitaet`), `mcp-tools.js` (`caller_name` entfernt), `config.js:150-151` (kein OWNER_NAME-Default) |
| G2 Erst-Turn-Deadlock     | UMGESETZT         | `claude.js:115-121` (`openingText`, Kappe `OPENING_GOAL_MAX_CHARS=160`), `server.js:866` (in `/voice/outbound`), `claude.js:92` (systemPrompt: keine Doppel-Nennung)                                                       |
| G3 STT-Endpointing        | UMGESETZT         | `telnyx/render.js:81` (Override-Seam, Default `"auto"`), `directives.js:43`, `server.js:663` (`followupTurnDirectives`=`config.sttSpeechTimeoutSec`), `:866` (Erst-Gather bleibt `"auto"`)                                  |
| G4 Reprompt + Log-Cleanup | UMGESETZT (2026-06-28) | Commit `4c94e9d3`: `[turn-recv]`/`[turn-ok]`-Temp-Logs aus `/voice/turn` entfernt + `noSpeechReprompt` verschlankt (de/fr/en, Apologie-Filler raus). Owner-Override der Plan-Deferral; 1172 Tests gruen                              |

**Divergenz vom §3-G1-Design (bewusst, gleichwertig):** G1 wurde NICHT ueber die geplanten
Config-Vars `OWNER_FIRST_NAME`/`OWNER_LAST_NAME` + `assertConfig`-Boot-Refusal gebaut, sondern
ueber den Bootstrap-Tenant/Self-Service (`ownerName`/`firstName` im Store, `scripts/bootstrap-tenant.js`)
plus Run-time-Gate `server.js:1094`. Fail-closed bleibt erhalten (Boot-Refusal -> place_call-403).
Owner-Entscheidung §5.2 ("Jonas"-Default raus) ist damit erfuellt; der Config-Pfad ist obsolet.

**Live-Gates BESTANDEN (Owner, 2026-06-28):** G2 — kein 15s-Loch; der Agent spricht
Offenlegung+Anliegen sofort (Erst-Turn `reply=140`/`heard=0`; bei Outbound spricht der Agent
zuerst, daher ist `SpeechResult=0` im Erst-Turn BY DESIGN, kein Defekt). G3 — voller Satz erfasst
(`SpeechResult:25`, nicht auf das erste Wort gekuerzt), `STT_SPEECH_TIMEOUT_SEC` Default 2 reicht.
**Damit ist die G-Kette code- UND live-fertig.** §6-Folgearbeit (Onboarding-`idp_subject`-Bindung,
"Consult", `redirectD`) bleibt ausserhalb dieser Kette.

---

## 1. Verifizierte Diagnose (Code + Render-Logs, Live-Commit 30c0348 ~ 6b64437)

Belegt gegen den real laufenden Code. Kein stale-deploy: lokal = origin = upstream.
Engine live = BUDGET (turn-basiert, Gather/STT), Provider live = Telnyx (TeXML).

| #   | Befund                                         | Wurzel                                                                                                                                                                                                                                                                                                                         | Beleg                                                                                                                             |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **~15s Totzeit nach der Offenlegung**          | `/voice/outbound` ist (bewusst) LLM-frei und rendert Offenlegung + **leeres** `<Gather>`; das Anliegen entsteht erst im naechsten `/voice/turn`, der erst nach No-Speech-Timeout feuert. Beide Seiten warten.                                                                                                                  | `server.js:483-508`, `:328-332`; `telnyx/render.js:73-77`. **Log: erster Turn jedes Calls = `SpeechResult:0` (3/3 Calls heute).** |
| 2   | **"Jonas" + Rollenverwirrung + Impersonation** | `systemPrompt`/`disclosureSentence` mischen `call.callerName` (Freitext aus `place_call`) und `ctx.ownerName`. ownerName faellt auf `config.ownerName` zurueck, Default **"Jonas"** — und `render.yaml:97` setzt `OWNER_NAME: Jonas` **hart live**. `caller_name` ist pro Call frei waehlbar → jeder Offenlegungsname setzbar. | `claude.js:48,71,76,80-83`; `config.js:98`; `render.yaml:96-97`; `mcp-tools.js:90` → `server.js:723`.                             |
| 3   | **STT-Truncation ("geht" statt ganzem Satz)**  | `speechTimeout="auto"` delegiert Endpointing an Deepgram-VAD, das auf der **ersten internen Sprechpause** finalisiert. Keine Fragment-Reassemblierung. `de-DE`/nova-3 sind korrekt (nicht anfassen).                                                                                                                           | `telnyx/render.js:37-43`; `server.js:212-215`. Log: `SpeechResult:12` im frueheren Call.                                          |
| 4   | **"kann nicht selbst auflegen"**               | **Kein Defekt.** `end_call → <Hangup/>` ist robust (Tool-Loop + Fail-safe-Floor). Symptom = Perzeption der Totzeit aus #1.                                                                                                                                                                                                     | `claude.js:90-98,221,250,253`; `server.js:466`; `telnyx/render.js:98-99`.                                                         |

**Kernerkenntnis:** #1 und #4 sind dieselbe Wurzel (leerer Erst-Gather). #2 ist Safety
(Identitaets-Bindung, Geschwister-Regel zu Regel 2) und muss **isoliert + zuerst**. #3
ist orthogonal, kompoundiert aber latenzseitig mit #1 → #1 vor #3.

---

## 2. Neue Owner-Regel: Identitaets-Bindung

Festgehalten als Geschwister-Regel zur fest verdrahteten Offenlegung (Regel 2):

> Der offengelegte Auftraggeber ist **fest an die registrierte, authentifizierte
> Identitaet** gebunden. EINE Quelle (`tenant.ownerName`), identisch in Offenlegung UND
> LLM-Persona, **nicht per Call-Parameter ueberschreibbar**. Fehlt der Name →
> **fail-closed** (kein Outbound), kein Default/Fake.

---

## 3. Phasenplan G0 → G4 (strikt seriell) — UMGESETZT (Beleg: Abschnitt 0)

Geteilte Hotspot-Dateien `server.js` und `claude.js` werden von mehreren Phasen
angefasst → **keine parallelen Worktrees**, Reihenfolge fix: **G0 → G1 → G2 → G3 → G4**.

### G0 — Repro-Harness & Instrumentierung (Fundament, kein Verhaltens-Diff)

- **Ziel:** deterministische Offline-Bank, gegen die G1–G4 ihre TeXML-/Identitaets-Asserts
  fahren. Vorhandene Bausteine (`startServer`/`seedState`/`seedCall`, `ANTHROPIC_BASE_URL`-
  Mock aus `outbound-premature-close.test.js`) zu einem Outbound-TeXML-Helper buendeln
  (provider twilio UND telnyx; ruft `/voice/outbound` bzw. `/voice/turn`, gibt TeXML +
  stdout zurueck).
- **Diagnose-Logs `[turn-recv]`/`[turn-ok]` (`server.js:440-442,462-465`) NICHT entfernen** —
  sie sind der bewusste Diskriminator fuer die Live-Gates bis nach G3 (Cleanup = G4).
- **Pre-Mortem:** Wegwerf-Doppelung → reiner Test-Code, kein `src/`-Diff; wenn er nichts
  Neues kapselt, wird er nicht gebaut (YAGNI).
- **Check (offline):** `npm test` byte-identisch gruen. Baseline-Test reproduziert den
  heutigen leeren `<Gather/>`-Deadlock (wird in G2 ins Positiv gedreht).
- **Dateien:** `test/helpers.js`, neu `test/_outbound-harness.js`.

### G1 — Identitaets-Bindung (Safety, isoliert, ZUERST)

- **Ziel:** EINE autoritative Identitaetsquelle, fail-closed, Default "Jonas" raus.
- **Design (Approach A mit Pflicht-Anpassungen — Verdikt haelt nur so):**
  - `claude.js:71` + `:81`: `call.callerName || …` → **ausschliesslich**
    `store.tenantContext(call.tenantId).ownerName`.
  - **Vor-/Nachname als zwei Variablen (Owner-Entscheidung):** Ableiten des Vornamens aus
    einem vollen Namen ist eine fragile Heuristik (Titel, mehrteilige Vornamen, Familienname-
    zuerst) → VERWORFEN. Die Registrierung erfasst zwei Eingaben **`firstName` + `lastName`**.
    - **Offenlegung** (`disclosureSentence`) = voller Name `${firstName} ${lastName}` (lastName
      darf mehrteilig sein, z.B. firstName="Antonio", lastName="Fotiadis dos Santos Francisco").
    - **LLM-Persona** (`systemPrompt`-Zeilen 48/76: "Assistent von {X}", "{X}s Kalender") = `firstName`.
    - Eine Quelle bleibt erhalten: `tenant.ownerName` (voll) wird beim Registrieren \*\*komponiert
      - gespeichert\*\*, damit die bestehenden Konsumenten (Inbound-Greeting `server.js:429`,
        Dashboard/`api-read`/`self-service`, `summarizeCall`) unveraendert laufen; zusaetzlich wird
        `firstName` gespeichert (Persona).
  - **Datenmodell additiv (wie I8):** nullable Spalten `first_name`/`last_name` in `schema.sql`
    - pg-Hydrierung/Flush (`pg.js`), `registerTenant`-Signatur `{ firstName, lastName }` (komponiert
      ownerName, setzt firstName), `POST /api/onboard` nimmt `firstName`/`lastName`. Kein Rename des
      bestehenden `owner_name`. Per-Tenant-Daten (aktuell nur der Owner registriert) — niemals hardcoden.
  - **Owner-Name-Quelle = Variante (a):** Owner-Tenant wird beim Seeding
    (`makeDefaultState`/`seedDefaults`) mit `firstName`/`lastName` aus der Config belegt und
    `tenant.ownerName` komponiert. **Schuetzt Inbound** (`server.js:429` greeting,
    `summarizeCall`), das **keinen** Gate hat.
  - Config-Default `"Jonas"` **raus**: statt `OWNER_NAME` zwei Vars `OWNER_FIRST_NAME` +
    `OWNER_LAST_NAME` (Default je `""`); `assertConfig` fuehrt beide als **Pflicht (Boot-Refusal
    bei leer)**, fail-closed wie `TWILIO_NUMBER`. Damit verschwindet "Jonas" an der Quelle.
  - **Expliziter Outbound-Gate** `if (!ownerName) → 403` als zusaetzliches Glied der
    bestehenden fail-closed Outbound-Kette in `POST /api/calls` **vor** `createCall`
    (neben KYC/Number/Budget), mit `audit('place_call_denied', grund=keine_identitaet)`.
    **NIE in `/voice/outbound`** (Premature-close-Schutz).
  - `caller_name` **komplett** aus dem Producer-Pfad: `place_call`-Schema (`mcp-tools.js:90`),
    `invalidText`/`TEXT_LIMITS` (`server.js:692`, `_validation.js`), `createCall`-Aufruf
    (`server.js:723`) **UND** `createCall`-Signatur (`state-ops.js:75/94`). DB-Spalte
    `caller_name` bleibt **additiv nullable** (kein destruktives Migrat). MCP-Tool-Doku nachziehen.
  - `render.yaml:96-97` (`OWNER_NAME: Jonas`) → durch `OWNER_FIRST_NAME` + `OWNER_LAST_NAME`
    ersetzen (`sync:false` + echte Werte); `.env.example:105` anpassen.
- **Pre-Mortem / Pflicht-Schutz:**
  - (a) Default `""` ohne Gate → stille Regel-2-Verletzung. → expliziter Gate + **Negativ-Test**,
    der beweist, dass nie `"…von ."` rendert.
  - (b) `test/helpers.js:38` setzt BASE_ENV `OWNER_NAME="Jonas"` → maskiert den Boot-Refusal-Test
    (scheingruen). → Reject-Test **entfernt `OWNER_NAME` explizit aus dem Spawn-Env**.
  - (c) Live-Owner kippt nach Deploy auf 403, wenn `OWNER_NAME` in Render-Env fehlt. → Deploy-
    Voraussetzung in Owner-Checkliste; Cutover wirkt erst nach **upstream-Push (jonas986)**.
- **Check (offline, vollstaendig — kein Live-Gate noetig):** `disclosureSentence` mit
  gesetztem `callerName='Klaus'` liefert den Tenant-Namen, NICHT 'Klaus'; `systemPrompt`
  Outbound nennt `owner`; leerer `ownerName` → Boot-Refusal / `/api/calls`-403, kein Call;
  `/voice/outbound`-TeXML offenlegt mit registriertem `ownerName`. **Bestehende Pins bewusst
  umkehren** (Owner-Entscheidung, kein stilles Nachziehen): `claude-identity.test.js:52-53`,
  `disclosure-regression.test.js:23-26`, `api.test.js` (caller_name-Laenge).
- **Dateien:** `claude.js`, `mcp-tools.js`, `server.js` (inkl. `/api/onboard`),
  `config.js`, `routes/_validation.js`, `store/state-ops.js`, `store/json.js`, `store/pg.js`,
  `db/schema.sql`, `render.yaml`, `.env.example` + Tests. (Vor-/Nachname-Datenmodell weitet G1
  etwas; bleibt logisch die Identitaets-Phase. Falls der Gate Blast-Radius flaggt, darf die
  Lean-Phase G1 in G1a=Datenmodell/firstName+lastName und G1b=Bindung/caller_name splitten.)

### G2 — Erst-Turn-Deadlock aufloesen (Wurzel-Tempo #1+#4) — nach G1

- **Ziel:** Nach der Offenlegung spricht der Agent sofort sein Anliegen im **selben** Turn.
  `/voice/outbound` bleibt strikt **LLM-frei**.
- **Design (Approach A):** rein lokaler Helper `openingText(call)` in `claude.js` **neben**
  `disclosureSentence` (kein systemPrompt-/Anthropic-Pfad): `${disclosure} ${bruecke}
${kappe(call.goal)}.`. In `/voice/outbound` ersetzt `turnDirectives(call, anliegen)` das
  `turnDirectives(call, "")` → promptText rendert als `<Say>` **innerhalb** des `<Gather>`
  (byte-identisch zum bewaehrten Inbound-Greeting, `render.js:75-76`).
  - **Opening-Kappe** als benannte Konstante `OPENING_GOAL_MAX_CHARS` (Magic-Number-Verbot)
    - Satz-Glaettung; `goal`-Validierungslimit (500) bleibt unberuehrt.
  - **systemPrompt-Outbound (`claude.js:75`) mitaendern**, sodass der erste LLM-Turn das
    Anliegen **nicht erneut** nennt (sonst Doppel-Nennung deterministisch + LLM).
- **Pre-Mortem:** (a) versehentlicher LLM-Pull in den stummen Erst-Turn → Helper rein synchron,
  Offline-Assert "kein `[outbound]`-LLM-Log". (b) Anliegen-Say vor der Offenlegung → Assert
  "disclosure ZUERST, genau ein zusaetzlicher Say vor dem Gather". (c) Doppel-Anliegen →
  systemPrompt-Aenderung im selben Diff + Test.
- **Check:** offline (TeXML: Offenlegung-Praefix + Anliegen-Say + `<Gather …/voice/turn>` +
  `<Redirect>`, KEIN `<Hangup/>`, kein `[outbound]`-Log; G0-Baseline ins Positiv gedreht).
  **Live-Gate (Owner, Allowlist):** erster `[turn-recv]` mit `SpeechResult>0` nach hoerbarem
  Anliegen, kein 15s-Loch.
- **`redirectD`-Entfernung NICHT** (kein Offline-Beleg → separates Live-Gate).
- **Dateien:** `server.js`, `claude.js`, `config.js`, `.env.example` + Outbound-Tests.

### G3 — STT-Endpointing-Truncation — nach G2

- **Ziel:** interne Sprechpausen tolerieren, ohne den Erst-Turn zu verschlechtern.
- **Design (Approach A mit Pflicht-Korrektur — Verdikt haelt nur so):** `speechTimeout`
  config-getrieben (`config.telnyxSpeechTimeoutSec`, `.env STT_SPEECH_TIMEOUT_SEC`, Default
  konservativ **2**) — **aber NICHT pauschal in `GATHER_ATTRS`**. `GATHER_ATTRS` ist
  **geteilt**; der Wert traefe sonst das Outbound-Erst-Gather aus G2, und `auto` zu entfernen
  ist ein **dokumentierter Regressionspfad** (`render.js:31-34`: ohne End-of-Speech-Erkennung
  kann der Erst-Turn "verzoegert/aus bleiben"). Deshalb **Override-Seam:** `gatherD`/
  `renderGather` um optionales `speechTimeoutSec` erweitern; **Folge-Gathers im `/voice/turn`
  bekommen den festen N, das Outbound-Erst-Gather bleibt bewusst auf `auto`**. Twilio
  (`GATHER_OPTS`) bleibt byte-identisch.
- **Pre-Mortem:** (a) `auto` global ersetzen reaktiviert den G2-Deadlock → Seam + Drift-Test
  "Erst-Gather bleibt `auto`". (b) `test-base-env-drift`: neue config-Var ohne BASE_ENV-Nachzug
  → `test/helpers.js` neutralen Default nachziehen. (c) Latenz-Kompoundierung mit #1 → N
  konservativ, im selben Live-Gate Gesamt-Erst-Turn-Zeit mitmessen.
- **Check:** offline (Snapshot `telnyx-render.test.js`: Folge-Gather `speechTimeout="2"`,
  positiver Integer NICHT `auto`; Outbound-Erst-Gather + Twilio bleiben `auto` = Drift-Asserts).
  **Live-Gate (Owner):** Pausen-Satz liefert vollen `SpeechResult` (kein "geht"-Fragment) UND
  Erst-Turn feuert weiterhin UND Latenz akzeptabel; N in config tunebar ohne Code-Diff.
- **Dateien:** `telephony/directives.js`, `telnyx/render.js`, `server.js`, `config.js`,
  `.env.example`, `test/helpers.js`, `test/telnyx-render.test.js`.

### G4 — Reprompt-Verschlankung + Log-Cleanup (Tempo-Politur, risikoarm) — zuletzt

- **Ziel:** TTS-Sekunden im No-Speech-Wiederholpfad sparen; G0-Diagnose-Logs entfernen.
- **Design:** No-Speech-Reprompt (`server.js:454`) auf knappe Rueckfrage kuerzen.
  `redirectD`-Entfernung **NICHT** (kein Offline-Beleg). Danach `[turn-recv]`/`[turn-ok]`-Logs
  entfernen — **erst nachdem G2/G3-Live-Gates gruen sind** (sonst Diskriminator weg).
- **Check:** offline (gekuerzter Reprompt rendert `<Say>`+`<Gather>`, kein `<Hangup>`;
  Hangup-Regression bleibt gruen).
- **Dateien:** `server.js`.

---

## 4. Verworfene Ansaetze (zur Nachvollziehbarkeit)

- **Opening-Caching in pg/json-Spalte (G2-B):** YAGNI + Stale-Drift, kein Latenzgewinn.
- **Zweiter Redirect-Turn fuers Opening (G2-C):** erzeugt eine NEUE Totzeit + neue Route.
- **caller_name nur ignorieren (G1-B):** toter, irrefuehrender Vertrag (CLAUDE.md verbietet).
- **caller_name == ownerName erzwingen (G1-C):** fragiler Namens-Gleichheits-Seam (i18n-Bug-Quell).
- **Fragment-Stitching (G3-B):** unzuverlaessige "ist das ein Fragment?"-Heuristik im Hot-Path.
- **speechTimeout pro-Turn-Override als Generik (G3-C als Standalone):** BDUF — nur als Seam
  mit dem konkreten auto-vs-fixed-Konsumenten gerechtfertigt (so in G3 verbaut).

---

## 5. Owner-Entscheidungen (ENTSCHIEDEN, 2026-06-21)

1. **Owner-Name = zwei Variablen `firstName` + `lastName`** (Registrierung erfasst beide; NICHT
   aus einem vollen Namen ableiten). Offenlegung = `${firstName} ${lastName}` (voll, "Antonio
   Fotiadis dos Santos Francisco"), Persona/LLM = `firstName` ("Antonio"). `tenant.ownerName`
   (voll) wird komponiert + gespeichert (Bestandskonsumenten unveraendert), `firstName` zusaetzlich.
   Additiv (nullable Spalten, wie I8). **Per-Tenant-Daten, nicht hardcoden** (aktuell nur Owner).
2. **Owner-Name-Quelle: Variante (a)** — Owner-Tenant beim Seeding mit `firstName`/`lastName`
   aus Config belegen; Config-Default "Jonas" raus → `OWNER_FIRST_NAME` + `OWNER_LAST_NAME` als
   `assertConfig`-Pflicht (Boot-Refusal). Schuetzt den ungated Inbound-Greeting.
3. **caller_name: ganze Producer-Kette entfernen** (kleiner API-Bruch), DB-Spalte nullable
   belassen, MCP-Tool-Doku nachziehen.
4. **Ausfuehrungsmodus: autonome Lean-Kette G0→G4** (`phase-impl-lean`, Self-Fix bis PASS, Merge
   im Lead, Live-Gates geparkt) — gestartet in einer **frischen Session** (Lead duenn halten).

Nicht-blockierend (Default, im Live-Gate justierbar): Bruecken-Phrasierung des Anliegen-Satzes
("Ich rufe an, weil <goal>" vs. nur "<goal>"); Default-N fuer `speechTimeout` (Start 2s).

---

## 6. Restrisiken / Folge-Arbeit (NICHT in dieser Kette)

- **Onboarding-Identitaet:** `tenant.ownerName` ist erst dann wirklich impersonationssicher,
  wenn an eine authentifizierte `idp_subject`-Identitaet gebunden. `registerTenant` nimmt heute
  Freitext aus `POST /api/onboard`. G1 schliesst die `place_call`-Luecke, verschiebt aber den
  Rest nach Onboarding → **eigene Folge-Phase**, nicht als geloest annehmen.
- **"Consult" (Rueckfrage an den Auftraggeber mitten im Call, OpenClaw-Style):** bewusst aus
  diesem Plan **ausgenommen** (Owner-Wunsch), spaeter separat entwerfen (async, gebundener
  Timeout, Fallback `take_message`, darf den Call nie unbounded blockieren).
- **`redirectD`-Fallback:** nur live entscheidbar — als separates Live-Gate geparkt.
