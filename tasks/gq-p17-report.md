# GQ-P17 — Haltefrist gegen die Doppelantwort auf fragmentierte Spracherkennung

**Gate: PASS** · **finalBranch: `phase/gq-p17-haltefrist`** · headCommit `d6a230e45a894e93170f33b65799fe3b26212bdb` (Kurzform d6a230e)

## 1. Problem

`deepgram/nova-3` liefert eine gesprochene Aeusserung ueber mehrere POSTs (fragmentiert), ohne
eigenen Turn-End-Regler. Bisher fuhr jedes Fragment einen vollen Shim-Turn — am 2026-08-09 live
beobachtet: zwei unabhaengige `look_up`-Recherchen und zwei gesprochene Wetterberichte mit
widerspruechlichen Zahlen (Luecke 2508 ms zwischen den Fragmenten, `prevRelation: extends`).

Der bestehende Verdraengungs-Riegel (`telnyx-turn-supersede.js`, GQ-P1) kann das nicht mehr
fangen: er verweigert bei `already_spoken` — und der Vorgaenger-Turn hat zum Zeitpunkt des
zweiten Fragments laengst gestreamt (Denk-Signal/erster Satz) und seine Recherche abgesetzt.

## 2. Plan (gekuerzt)

Neue per-Call-Haltefrist **vor** `agentTurn` (Schritt 7.5, zwischen Anstoss-Riegel und
`beginTurn`). Ein Fragment-Turn wird kurz gehalten; kommt in dieser Zeit ein Request, der den
Text nur fortschreibt (`prevRelation === EXTENDS`), wird der gehaltene Turn ueberholt: er ruft
**nie** `agentTurn`, antwortet mit einer leeren, gueltigen Completion (dieselbe Form wie
GQ-P1/GQ-P5) — kein Token-Burn, keine zweite Recherche, keine Transkriptzeile.

Zwei disjunkte Zustaende, zwei Riegel: GQ-P1 deckt "Vorgaenger laeuft schon", die neue Frist
deckt "Vorgaenger hat noch nicht angefangen" — bewusst keine Zusammenlegung (G5).

**Fristwahl:** Default 3000 ms (deckt alle drei gemessenen Fragment-Luecken 1314/2508/2926 ms
inkl. des vom Owner gehoerten Vorfalls), min 0 (= aus, Ruckweg ohne Deploy), max 3500 (darueber
naehert sich Telnyx' eigenes Anstoss-Fenster `user_idle_reply_secs=4`). Env-Var
`TELNYX_SHIM_EXTEND_HOLD_MS`, per `numEnv()` geclampt in `config.js`.

**Drei Pre-Mortem-Risiken, alle entschaerft:**
1. Frist verschluckt echte Aeusserung → nur `EXTENDS` loest aus, `SAME`/`OTHER`/`FIRST` unveraendert.
2. Frist oeffnet neues Kostenfenster (Anrufer legt waehrend Frist auf) → Liveness-Nachpruefung
   `call.status !== "active"` nach der Frist, eigener Grund-Token `call_ended_during_hold`.
3. Frist bricht GQ-H1-a (der `discarded_answer`-Riegel wuerde die aeltere, **gesprochene**
   Zeile des unterdrueckten Vorgaengers loeschen) → neue reine Abfrage `!predecessorIsHeld`.

**Bausteine:**
- Neu: `src/telnyx-turn-hold.js` — Registry mit injizierbaren Timern (`holdTurn`,
  `supersedeHeldTurn`, `hasHeldTurn`), speichert je Call **nur** den Freigeber, nie Text/Nummern.
- `src/telnyx-llm-shim.js` — Schritt 7.5 (Frist + Ueberholen + Liveness-Nachpruefung), neuer
  PII-freier Log-Kanal `kind="hold"` (`holdMs` + `outcome` extended/elapsed), Konjunktion
  `!predecessorIsHeld` in der GQ-H1-a-Pruefung.
- `src/config.js` — `shimExtendHoldMs` (numEnv, fallback 3000, min 0, max 3500).
- `src/turn-budget.js` — `holdMs` additiv in `enforcedTurnWorstCaseMs`/`deadAirOverrun`,
  Default 0 (Bestandsrechnung unveraendert).
- `src/boot.js` — Dead-Air-Waechter rechnet `holdMs` mit, nennt die Env-Var in seiner Warnzeile.
- `.env.example`, `render.yaml`, `test/helpers.js` (BASE_ENV neutral 0), Test-Helfer additiv erweitert.

**Latenz-Rechnung:** shipped Werte → `enforcedTurnWorstCaseMs` = 22750 ms ohne Frist,
25750 ms mit 3000 ms, 26250 ms mit Clamp-Max 3500 — alle unter dem Dead-Air-Watchdog 45000 ms
(Kopfraum ≥ 18,7 s).

**Bewusst nicht angefasst:** `disclosureSentence`, Denylist/Land-Gate/Stundenlimit/Max-Dauer/
Kostendecke/`OUTBOUND_FROZEN`, Signaturpruefung, `safeEqual`-Bearer, `claude.js`, `llm.js`,
`bridge.js`, Telnyx-Live-Config. Der GQ-P1-Riegel bleibt inhaltlich unveraendert (nur ein
Inline-Vergleich wurde zum benannten Ausdruck `extendsPreviousTurn`).

## 3. Impl-Zusammenfassung

Vollstaendig wie geplant umgesetzt: neue Registry-Datei + Schritt 7.5 im Shim, Config-Key,
additive Turn-Budget-Rechnung, Boot-Warnung, Doku-/Test-Umgebungs-Paritaet. 1 Commit
(`d6a230e`), 12 Dateien (5 Quelldateien inkl. neuer Datei, `.env.example`, `render.yaml`,
5 Testdateien). Keine neue npm-Dependency.

**Tests:** 19 neue Tests (`test/gq-p17-turn-hold.test.js`, Praefix `GQ-P17-`), vollstaendig
mit injizierten Fake-Timern (kein Sleep, keine Wanduhr). Volle Suite: **4135/4135 gruen**
(Basis vor der Aenderung: 4116; Delta +19, exakt die neuen Tests). `node --check` auf allen
5 geaenderten/neuen `.js`-Dateien: Exit 0.

**Rotprobe:** `return respond("")` bei `EXTENDED` auskommentiert → GQ-P17-7/8/13 fielen rot
(GQ-P17-16 blieb bewusst gruen, da er die separate GQ-H1-a-Konjunktion prueft). Nach Ruecknahme
wieder gruen. GQ-P17-12 pinnt den Bestandsdefekt dauerhaft ueber `holdMs=0`.

### Deviations (4)

1. **Zusatz-Test (19 statt 18):** Plan sah keine Verifikation fuer die Liveness-Nachpruefung
   (`call_ended_during_hold`) vor — nach `clean-code.md` ein S1-Verstoss ohne Test, daher
   GQ-P17-19 ergaenzt.
2. **Bestandstest angepasst:** `test/config-shape.test.js` pinnt die exakte Schluesselmenge von
   `telnyxAssistant` per `JSON.stringify` und wurde durch den neuen Key rot (1 Fail im ersten
   Vollauf). `shimExtendHoldMs: 3000` in die gepinnte Form aufgenommen — bewusste
   Signaturerweiterung, keine aufgeweichte Assertion. Danach 4135/4135 gruen.
3. **Rotprobe-Abweichung von der Plan-Prognose:** Plan erwartete "GQ-P17-7 (und 8/13/16)" rot;
   gemessen wurden 7/8/13 rot, 16 blieb gruen — korrekt, da 16 einen anderen Mechanismus prueft
   (`!predecessorIsHeld` statt Stumm-Return). Beide Pfade sind separat abgesichert.
4. **Smoke eingeschraenkt:** Boot verlangt ueber die Plan-Env hinaus zusaetzliche Pflichtwerte
   (ANTHROPIC_API_KEY, PUBLIC_URL, vier Telnyx-IDs, BOOTSTRAP_E164/PROVIDER,
   COST_TRUING_REQUIRED_RECORD_TYPES; Dummy-Werte gesetzt). Der Haltefrist-Pfad selbst braucht
   einen per `call_control_id` korrelierten aktiven Call und war per Smoke nicht erreichbar —
   ueber die 19 Unit-/Handler-Tests abgedeckt. Zusaetzlich: der geplante
   `ln -s ./node_modules node_modules` erzeugte im Worktree einen kaputten Selbstlink, ersetzt
   durch Link auf das node_modules des Hauptbaums, nicht committet.

**Smoke-Ergebnis:** `/healthz` → 200; `/v1/chat/completions` ohne Bearer → 403; mit Bearer aber
ohne aufloesbarem Call → 403 in <1 s (kein Hang durch die Frist, sie liegt hinter der
Call-Aufloesung). Keine Dead-Air-Boot-Warnung trotz 3000-ms-Frist (deckt sich mit 25750 <
45000 ms).

## 4. Safety-Urteil

**approved: true** — FREIGABE, kein Blocker. Unabhaengig im Worktree nachgefahren
(`review-gq-p17` = `phase/gq-p17-haltefrist`, `master` als Vorfahr bestaetigt via
`git merge-base --is-ancestor`).

- **`npm test` (Branch):** exit 0, 4135/4135 gruen, 106,0 s.
- **`npm test` (Basis master, 94522b2, gleicher Befehl):** exit 0, 4116/4116 gruen, 100,1 s.
- **Delta = +19**, exakt die neuen `GQ-P17-`-Tests. Kein Test verloren.
- `node --check` auf allen 10 geaenderten `.js`-Dateien: Exit 0.
- `eslint` in diesem Checkout nicht lauffaehig (vorbestehende Umgebungsluecke, kein Branch-Befund).
- `npm run test:gates` haengt in `test/auth-p9a-cache-headers.test.js` — identisch auf `master`
  reproduziert, **vorbestehend, keine GQ-P17-Regression**.

**Regel-fuer-Regel-Beleg:**
1. **Safety-Gates intakt:** Schritt 7.5 sitzt strikt nach Loop-Guard, Dead-Air-Feed (4.6),
   Rate-Gate (5), pro-Tenant-Kostendecke (6) und Anstoss-Riegel (6.5) — vor `beginTurn` (7).
   `git diff` auf allen Gate-Dateien (`outbound-gates.js`, `auth.js`, `web-auth.js`,
   `route-policy.js`, `middleware.js`, `telephony/`, `boot-guard.js`, `routes/`) ist leer.
   Neuer Pfad macht nur strenger (`call_ended_during_hold`), belegt durch GQ-P17-14/19.
2. **Offenlegung unberuehrt:** `git diff` auf `claude.js`/`bridge.js` leer, `disclosureSentence`
   weiterhin fest verdrahtet.
3. **Auth fail-closed unberuehrt:** kein neuer Endpunkt, keine Aenderung an Signaturpruefung
   oder Auth-Middleware.
4. **Keine Secrets geleakt:** neuer Log-Kanal traegt nur `callId`, `turnSeq`, `holdMs`,
   `outcome` — Registry speichert nie Text/Nummern, PII-Freiheit durch GQ-P17-9 gepinnt.
5./6. **Scope eingehalten:** 1 Commit, 12 Dateien, alle GQ-P17-bezogen, keine
   `package.json`-Aenderung, keine Extras, keine deaktivierten Sicherungen.

**Concerns (kein Blocker, fuer den Kettenstand):**
- Latenz standardmaessig an: die Frist gilt fuer **jeden** Turn, nicht nur fragmentierte —
  3000 ms zusaetzliche Stille vor jeder Antwort; ein 3-fach fragmentierter Turn zahlt die Frist
  mehrfach (~9 s Wanduhr bis zum letzten LLM-Aufruf). Owner-Bestaetigung des Default-AN-Werts
  offen (Ruckweg ohne Deploy: `TELNYX_SHIM_EXTEND_HOLD_MS=0`).
- Der ausgelieferte Default (3000) wird von keinem echten End-to-End-/Spawn-Test gefahren
  (BASE_ENV pinnt 0); der erste echte Test ist der naechste Live-Anruf.
- Marge zum ungemessenen Telnyx-eigenen LLM-Timeout (nur als ">30 s" bekannt) schrumpft um 3 s.
- Restfall-Rennfenster (fail-safe): laeuft die Frist des Vorgaengers Mikrosekunden vor
  Schritt 7.5 des Nachfolgers ab, faengt nur noch der GQ-P1-Riegel (der bei `already_spoken`
  aufgibt) — Ergebnis im Restfall ist die alte Doppelantwort, nie eine verschluckte Aeusserung.
- Vorbestehend: `npm run test:gates`-Haenger, nicht dieser Phase anzulasten.

## 5. Clean-Code-Audit

**verdict: PASS, blocker: false**

- **s1 (Blocker):** keine Funde.
- **s2 (Blocker):** keine Funde.
- **s3:** keine Funde.
- **s4 (kosmetisch, 1 Fund):** `test/config-shape.test.js:63` — Testname behauptet "alle 16
  Keys", das erwartete Objekt hat jetzt 17 (neuer `shimExtendHoldMs`); Zaehler im Namen wurde
  nicht mitgezogen. Empfehlung: Testname auf "17 Keys" korrigieren (rein kosmetisch, die
  Assertion selbst prueft korrekt per `deepEqual`).

**passNotes:** saubere Trennung Registry/Shim/Config; Kommentare erklaeren durchgehend das
Warum; Gate-Reihenfolge explizit dokumentiert und durch Tests belegt; keine Magic Numbers ohne
Konstante/Kommentar; keine deaktivierten Sicherungen; volle Suite gruen, keine Regression.

**Ein dokumentierter Randfall (kein Blocker):** ueberholt eine `extends`-Anfrage einen
gehaltenen Vorgaenger, faellt der Supersede-Aufruf weg, wenn diese Anfrage selbst vorher am
Rate- oder Loop-Guard haengenbleibt und fruehzeitig returnt — der gehaltene Vorgaenger laeuft
dann mit dem aelteren, kuerzeren Text aus. Keine Regression gegenueber vorher (vorher sprachen
in diesem Fall zwei widerspruechliche Antworten, jetzt nur die aeltere), nur eine nicht voll
ausgeschoepfte Verbesserung.

**topTodos:**
- Optional: Testname in `config-shape.test.js` auf 17 Keys korrigieren (kosmetisch).
- Beobachten: den Randfall (extends-Anfrage selbst gategated) im Betrieb per `hold`-Log
  (outcome `elapsed` bei gleichzeitigem `gate`-Log) im Auge behalten.

## 6. Fix-Runden

Keine — der Impl-Agent lieferte im ersten Anlauf ein Ergebnis, das sowohl die
Safety-Review als auch das Clean-Code-Audit ohne Blocker (S1/S2) bestand. Der einzige waehrend
der Umsetzung entdeckte Bestandstest-Konflikt (`config-shape.test.js`, Deviation 2) wurde noch
in derselben Impl-Runde behoben, nicht als separate Fix-Runde nach Review.

## 7. Konfiguration (Betriebswissen)

| Env-Var | Default | Min | Max | Wirkung |
|---|---|---|---|---|
| `TELNYX_SHIM_EXTEND_HOLD_MS` | 3000 | 0 (= aus) | 3500 | Haltefrist vor `agentTurn`; 0 = Bestandsverhalten byte-identisch |

**Live-Abnahme (naechster Anruf):** `grep '\[telnyx-shim\] hold'` nach `outcome` filtern
(`extended` vs. `elapsed`) — Datengrundlage fuer eine Anpassung der Frist ohne Code-Aenderung.
