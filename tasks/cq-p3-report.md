# Phase P3 — Die drei Peinlichkeits-Defekte schließen (Cap/Reprompt/Inbound)

**Gate: PASS**
**finalBranch:** `phase/cq-p3-defects-fix1`
**Basis:** `master` @ `ca93003`
**Plan-Quelle:** `PLAN-CONVERSATION-QUALITY-V2.md` §4 „P3" (Z. 898–1026), bindend darüber §0 E1/E2/E3
**headCommit (Impl):** `09e3486`
**Suite:** 2467/2467 grün, 0 fail (nach r1-Fix; Impl-Stand war 2466/2466)

---

## 1. Worum es ging

P3 schließt drei konkrete, im Bestand beobachtbare Peinlichkeits-Defekte im Telefongespräch:

1. **P3.1 — stiller Hard-Cap:** Der Agent wurde beim Erreichen des harten `MAX_CALL_DURATION_S`-Timers wortlos vom Timer-Backstop gekappt, mitten im Satz, ohne Verabschiedung.
2. **P3.2 — endlose No-Speech-Schleife:** Bei jedem leeren Gather (Anrufer sagt nichts) kam exakt derselbe Reprompt-Satz zurück, unbegrenzt oft, bis der stille Cap griff.
3. **P3.3 — Inbound-Direction-Kurzschluss:** Der Früh-Hangup-Schutz (`shouldSuppressEndCall`) griff nur bei Outbound-Calls; ein Inbound-Anrufer konnte theoretisch aufgelegt bekommen, bevor er überhaupt gesprochen hatte (RCA-R3-Fehlerklasse, für Inbound offen gelassen).

---

## 2. Plan (gekürzt)

### 2.1 Design-Entscheidungen (D1–D7)

| # | Entscheidung | Begründung |
|---|---|---|
| D1 | P3.1 wird **turn-basiert** in `POST /voice/turn` gebaut, **nach** `agentTurn`. | Ein Check *davor* verlöre die letzte Anrufer-Äußerung für Summary/Export. |
| D2 | Die Restzeit-Prüfung greift zusätzlich im No-Speech-Zweig (P3.2), über dieselbe Funktion. | Sonst bliebe genau ein stiller Todesfall übrig: Reprompt-Schleife läuft in den wortlosen Timer. |
| D3 | Der No-Speech-Streak lebt als **ephemeres In-Memory-Feld am Call** (`noSpeechStreak`), keine pg-Spalte, keine Migration. | Präzedenzfall `reserveCents`/`reserveReleased` in `state-ops.js`. |
| D4 | Eskalations-Staffel = **3 Stufen fest** (Stufe1 = Bestand byte-identisch, Stufe2 = neuer Text, Stufe3 = Abschied+Hangup). Kein neuer Config-Knopf. | `maxEmptyTurns` wird bewusst nicht wiederverwendet (andere Achse: LLM-`end_call`-Guard). |
| D5 | P3.3 entfernt **nur** den Direction-Kurzschluss in `shouldSuppressEndCall`. `callerHasSpoken` bleibt richtungsabhängig (TG-REC-1). | Inbound nutzt die lockere „jede caller-Zeile zählt"-Variante ⇒ Guard hebt sich früher ⇒ kostenseitig konservativer, genau der richtige Bias für den Pfad, den Fremde auslösen. |
| D6 | `CAP_FAREWELL_LEAD_MS=0` ist der dokumentierte Aus-Schalter. | Rollback ohne Revert, fail-safe Richtung Bestandsverhalten. |
| D7 | `terminateCappedCall`, `armMaxDurationTimer`, `POST /api/calls/:id/cancel` werden **nicht** angefasst. | Backstop muss unabhängig scharf bleiben (Regel 1). |

### 2.2 Pre-Mortem (vorab benannt)

1. *„Die Ansage hat den Cap verlängert."* → entschärft: kein Timer-Eingriff, Satz liegt innerhalb der Frist; `max-duration-live-cap.test.js` bleibt unverändert grün als Beweis.
2. *„Inbound-Störanrufe haben Carrier-Minuten verbrannt."* → benannt und bounded: `maxEmptyTurns=3`, Exposition ≤ `maxCallDurationS`; Wert darf für Inbound nicht hochgedreht werden → in `PLAN-SECURITY.md` + `tasks/lessons.md` festgehalten.
3. *„Der Streak-Zähler ist beim Deploy-Instanzwechsel gekippt."* → `rowToCall` hydriert das Feld nicht ⇒ `undefined` ⇒ `|| 0` ⇒ Streak beginnt fail-safe neu (mehr Höflichkeit, nie ein früherer Hangup).
4. *„`MAX_CALL_DURATION_S < CAP_FAREWELL_LEAD_MS` hat jeden Call nach einem Turn beendet."* → in `.env.example` als Betriebsauflage dokumentiert + `max: 60000`-Clamp.

### 2.3 Kernbausteine laut Plan

- **Neue Datei** `src/no-speech-escalation.js` (~28 Zeilen, rein, config-frei): `noSpeechEscalation(streak, locale)` — Stufe1/2/3 mit benannter Konstante `SECOND_ATTEMPT_STREAK` statt Magic Number.
- **`src/config.js`**: neuer Key `capFarewellLeadMs` (`CAP_FAREWELL_LEAD_MS`, Default 20000ms, min 0/max 60000) im `safety`-Namespace.
- **`.env.example`, `test/helpers.js` (BASE_ENV)**: Var dokumentiert bzw. neutral gepinnt (Lehre `test-base-env-drift`).
- **`src/i18n/locales.js`**: drei neue gesprochene Felder je Sprache (DE/FR/EN) — `noSpeechRepromptAgain`, `noSpeechFarewell`, `capFarewellSpeech`. DE mit echten Umlauten, ohne Kollision mit `TRANSLITERATION_STEMS`.
- **`src/store/state-ops.js` + `json.js` + `pg.js` + `store.js`**: `noSpeechStreak: 0`-Init in `createCall`, zwei neue Ops (`countNoSpeechTurn`, `clearNoSpeechStreak`), Wrapper-Parität ohne `save()` (ephemeres Muster).
- **`src/claude.js`**: `shouldSuppressEndCall` verliert den `if (call.direction !== "outbound") return false`-Kurzschluss; `callerHasSpoken` bleibt richtungsabhängig.
- **`src/routes/voice.js`**: zwei neue Direktimporte, drei neue Helfer (`capFarewellOutcome`, `noSpeechOutcome`, `sendTurnOutcome` als EINE Quelle für alle drei Renderpfade — G5), Turn-Handler-Rumpf umgebaut (netto eine Duplizierung weniger).
- **`PLAN-SECURITY.md`**: neuer Abschnitt „P3-INBOUND" mit benannter, bounded akzeptierter Kostenachse.
- **`tasks/lessons.md`**: Eintrag zur Umkehr der bewussten Design-Entscheidung (Inbound sieht `reconcileOutboundVoiceBudget` nicht, einziger Deckel bleibt `MAX_CALL_DURATION_S`).

### 2.4 Tests laut Plan

- `test/no-speech-escalation.test.js` (neu, rein/offline): Streak 1/2/3/7 (Übersättigung).
- `test/cq-p3-cap-farewell.test.js` (neu, Spawn): P3-C1 Kern (Cap greift, Say+Hangup, kein Gather), P3-C2 Gegenprobe (genug Restzeit → Gather, kein Hangup), P3-C3 = Backstop-Tests bleiben unverändert grün als Beweis.
- `test/g4-no-speech-reprompt.test.js` erweitert: P3-G4b (drei aufeinanderfolgende leere Turns → drei verschiedene Antworten, dritte = Hangup), P3-G4c (Reset-Semantik nach verstandener Äußerung).
- `test/claude-turn-guard.test.js`: alter Direction-Kurzschluss-Test ersetzt durch drei P3.3-Fälle (inbound ohne Zeile unter Schwelle → true, inbound bei erreichter Schwelle → false, inbound mit nicht-substanzieller Zeile → false).
- `test/f1-i18n-locale.test.js`, `test/de-umlaut-orthography.test.js`: um die drei neuen Locale-Felder erweitert.
- Bestandssuite (`g326-turn-shortcut-empty-guard`, `graceful-shutdown`, `reattach-active-call`, `telnyx-p6-*`, `bridge-*`, `api-read-parity`) bewusst ohne Änderung geprüft.

### 2.5 Blast-Radius laut Plan

Neu: `src/no-speech-escalation.js`. Editiert: `voice.js`, `claude.js`, `config.js`, `locales.js`, Store-Schicht (4 Dateien), `.env.example`, `test/helpers.js`, `PLAN-SECURITY.md`, `tasks/lessons.md`, 6 Testdateien. **Nicht angefasst:** `call-lifecycle.js`, `call-termination.js`, `api-calls.js` (Cancel), `bridge.js` (Datei selbst — Guard-Nutzung ja, Edit nein), `telnyx-conversation-watchdog.js`, `billing/*`, DB-Schema/Migrationen, `render.yaml`, `apps/web`.

### 2.6 Offene Owner-/Deploy-Auflagen (aus dem Plan, s. §6 unten für die konsolidierte Fassung)

Der Plan sah unter „Offene Owner-/Deploy-Auflagen (NICHT Teil des Abnahmekriteriums)" sechs Punkte vor: Probeanruf zur Hör-Verifikation, optionales Render-Env-Setzen, Betriebs-Invariante `CAP_FAREWELL_LEAD_MS < MAX_CALL_DURATION_S`, `MAX_EMPTY_TURNS` bei 3 belassen, Metrik-Wiedervorlage erst ab >5% Cap-Anteil, kein Push vorgesehen.

---

## 3. Implementierungs-Zusammenfassung

Umgesetzt exakt gemäß Plan auf Branch `phase/cq-p3-defects` (Basis `master@ca93003`), committed als `09e3486`.

- **P3.1:** neue Config `capFarewellLeadMs` (Default 20000ms, min0/max60000, im `safety`-Namespace) + drei Helfer in `src/routes/voice.js` (`capFarewellOutcome`, `noSpeechOutcome`, `sendTurnOutcome`). `/voice/turn` rendert einen deterministischen Abschluss-Satz + Hangup, sobald die Restzeit unter den Vorlauf fällt — geprüft **nach** `agentTurn`, Cap selbst unverändert; `terminateCappedCall`/`armMaxDurationTimer`/`api-calls.js`-Cancel per `git diff --stat` als leer bewiesen.
- **P3.2:** neue Datei `src/no-speech-escalation.js` (rein, 3-Stufen-Staffel Reprompt/RepromptAgain/Farewell+Hangup). Streak lebt ephemer am Call (`noSpeechStreak`, Muster `reserveCents`: kein pg-Feld, keine `rowToCall`-Hydrierung) über zwei neue Ops (`countNoSpeechTurn`/`clearNoSpeechStreak`) mit Wrapper-Parität in `json.js`/`pg.js`/`store.js`.
- **P3.3:** `shouldSuppressEndCall` (`claude.js`) verliert den Inbound-Direction-Kurzschluss — Guard gilt jetzt richtungslos; `callerHasSpoken` bleibt richtungsabhängig (TG-REC-1). Kostenachse in `PLAN-SECURITY.md#P3-INBOUND` + `tasks/lessons.md` dokumentiert.
- Drei neue Locale-Felder je DE/FR/EN, DE mit echten Umlauten (`de-umlaut-orthography` S9–S11 pinnt das).

### 3.1 Tests

Zwei neue Dateien (`no-speech-escalation.test.js`, `cq-p3-cap-farewell.test.js` — P3-C1 gegen `master` isoliert als rot-vor-Fix verifiziert, gegen den Branch grün), `g4-no-speech-reprompt.test.js` um P3-G4b/P3-G4c erweitert, `claude-turn-guard`/`f1-i18n-locale`/`de-umlaut-orthography` angepasst.

### 3.2 Deviations vom Plan

Zwei nicht explizit im Plan genannte, aber zwingend notwendige Fixture-/Zähler-Korrekturen (reine Folgeanpassungen, keine Scope-Erweiterung):

1. **`test/config-namespaces.test.js`**: Counts 10→11 (safety-Namespace) / 100→101 (total) / 94→95 (primitive Blätter) — direkte, zwingende Folge des neuen Config-Keys `capFarewellLeadMs`.
2. **`test/bridge-event-unit.test.js`**: Fake-`ctx.call` bekommt ein `transcript`-Feld — direkte Folge des entfernten Inbound-Kurzschlusses in `shouldSuppressEndCall`; ohne diese Korrektur wären zwei Bestandstests für den Realtime-Pfad gebrochen, die den Guard selbst nicht testen wollten.

### 3.3 Ergebnis-Kennzahlen (Impl-Stand)

- `headCommit`: `09e3486`
- `node --check` auf allen 8 betroffenen Quelldateien: sauber
- Volle Suite (json + pglite in-process): **2466/2466 grün, 0 fail**
- Smoke: Server bootet mit `CAP_FAREWELL_LEAD_MS` gesetzt, `/healthz` → 200, `POST /voice/turn` für unbekannten Call liefert korrekt `<Hangup/>` (fail-closed Pfad unverändert erreichbar)
- Pflicht-Greps bestätigt: `capFarewellLeadMs` 3 Fundstellen (`config.js`, `.env.example`, `test/helpers.js`), 0 verbleibende `direction !== "outbound"`-Treffer in `claude.js`, `terminateCappedCall` unverändert 8×, leerer `git diff --stat` auf `call-lifecycle.js`/`api-calls.js`

### 3.4 Clean-Code-Selbstprüfung (Implementierer)

Gegen `.claude/refs/clean-code.md` geprüft: **G5** (keine Duplizierung) — `sendTurnOutcome` ist die eine Quelle für alle drei Renderpfade statt der vorher 2× wiederholten `endCall ? [say,hangup] : followup`-Verzweigung; `capFarewellOutcome` ist die eine Quelle für den Cap-Vorlauf-Check (D2). **G25** (Magic Numbers) — `SECOND_ATTEMPT_STREAK` als benannte Konstante statt nackter `2`; Config-Clamps dokumentiert. **G9/C5** (toter/auskommentierter Code) — keiner eingeführt. **F1** (Argumente) — `sendTurnOutcome(res, call, {speech,endCall})` = 3 Argumente mit Objektgruppierung. **N7** (Nebeneffekte im Namen) — `countNoSpeechTurn`, `sendTurnOutcome` explizit kommentiert. **P15** (Lazy-Init) — kein Vorkommen. **C2** (keine Datei:Zeile-Kommentare) — Kommentare verweisen auf Testnamen/Konzepte.

---

## 4. Safety-Urteil (final)

**Verdikt: APPROVED, keine Blocker.**

- `testsPassIndependently`: true (unabhängiger Lauf im frischen Worktree, Branch `review-p3-r1` = `phase/cq-p3-defects-fix1`: **2467/0**, 74.0s, Exit 0; beide Backends abgedeckt — json via BASE_ENV, pg über dedizierte Tests wie `store-pg-json-parity`, `store-backend-parity`, `store-pg-multitenant` etc.)
- Zweiter isolierter Lauf der P3-relevanten Dateien: 59/59 grün.
- Zwei eigene, nicht vom Implementierer stammende Spawn-Proben (danach entfernt, Tree sauber): **REV-1** beweist `CAP_FAREWELL_LEAD_MS=0` als echten Aus-Schalter (Folge-Gather statt Hangup = Bestandsverhalten). **REV-2** beweist am **Twilio**-Provider (nicht nur Telnyx) und an einem **Inbound**-Call, dass Say+Hangup im selben Response landen, der Cap also nicht um die Ansagedauer verlängert wird.
- `safetyGatesIntact`: true — `outbound-gates.js`, `call-lifecycle.js` (`terminateCappedCall`, `armMaxDurationTimer`), `billing/`, `api-calls.js` haben Null-Diff. P3.1 wirkt ausschließlich in die sichere Richtung (Call endet früher, nie später).
- `disclosureIntact`: true — `bridge.js` Null-Diff, `disclosureSentence` in `claude.js:130` unberührt.
- `authFailClosedIntact`: true — kein neuer Endpunkt, keine Route-Montage; `server.js`/`app.js`/`auth.js`/`web-auth.js`/`middleware.js` Null-Diff.
- `noSecretsLeaked`: true — keine neue Logzeile, kein Secret in Responses.
- `scopeRespected`: true — exakt P3.1/P3.2/P3.3; `PLAN-SECURITY.md`/`tasks/lessons.md`-Updates sind vom Plan gefordert; `package.json`/`package-lock.json` Null-Diff, keine neue Dependency, kein `eslint-disable`-Marker im Diff.
- `behaviorAsIntended`: true — die vier Abnahmekriterien durch echte HTTP-Spawn-Tests belegt.

### 4.1 Concerns (nicht-blockierend, 6 Stück)

1. **Doc-Drift auf genau der geänderten Invariante**: Kommentare an `callerHasSpoken` (`claude.js:295-297`) und in `bridge.js:369-372` behaupten weiterhin die alte, jetzt falsche Aussage ("Inbound bleibt byte-identisch…" bzw. "ein Outbound-Call darf NICHT…"). Kosmetik, aber irreführend für die nächste Session.
2. **Keine Kreuzvalidierung** `CAP_FAREWELL_LEAD_MS` (max 60000) gegen `MAX_CALL_DURATION_S` (min 1). `MAX_CALL_DURATION_S=30` + `CAP_FAREWELL_LEAD_MS=60000` würde jeden Call nach dem ersten Turn beenden. Richtung ist sicher (nie länger, immer früher), nur in Kommentaren/`.env.example` gewarnt, kein Boot-Guard.
3. **`noSpeechStreak` json↔pg-Shape-Drift**: wird in `state-ops.js createCall` gesetzt, aber nicht in `pg.js rowToCall` hydriert; `publicCall` ist eine Blacklist-Projektion → json-Backend liefert das Feld in `/api/state`/MCP mit, pg-Backend nicht. Kein Secret, aber Drift-Fortsetzung des bestehenden `reserveCents`-Musters.
4. P3.1 ruft `agentTurn` (bezahlter LLM-Roundtrip) **vor** der Cap-Entscheidung und verwirft dessen Antwort dann — bewusst so (sonst fiele die letzte Anrufer-Zeile aus Transkript/Summary/Export), kostet aber je gekapptem Call einen ungenutzten Modellaufruf.
5. P3.3 ändert auch den **Realtime-Pfad** (`bridge.js:373 shouldSuppressEndCall`) für Inbound; bounded verifiziert (`bridge.js:355` schreibt Agent-Zeilen ins Transkript, `unansweredAgentTurns` läuft hoch). `VOICE_ENGINE=realtime` ist nicht live — vor einem Engine-Flip gehört trotzdem ein Probe-Anruf.
6. `npm run lint` war im Worktree nicht ausführbar (eslint-Binary fehlt im symlinkten `node_modules`) — Lint-Gate nicht verifiziert; `node --check` für alle 9 geänderten Quelldateien grün.

---

## 5. Clean-Code-Audit (finale Runde, s1–s4)

**Verdikt: PASS (kein Blocker).**

- **s1 (Blocker):** — leer nach Fix-Runde r1 (siehe §6).
- **s2 (Blocker):** — leer.
- **s3 (empfohlen vor Merge, kein Blocker):** vier stale „(nur Outbound)"-Kommentarstellen, die der P3.3-Symmetrisierung widersprechen:
  1. `src/claude.js:274-280` (`isSubstantialCallerText`-Docblock) — behauptet „wirksam aber nur bei Outbound", widerspricht dem 20 Zeilen tiefer korrekt aktualisierten `shouldSuppressEndCall`-Kommentar.
  2. `src/claude.js:304-306` (`unansweredAgentTurns`-Docblock) — „relevant nur für den Outbound-Guard" ist seit P3.3 falsch.
  3. `src/claude.js:294-295` (`callerHasSpoken`-Docblock) — „Inbound bleibt byte-identisch … dort gibt es keinen Empty-Turn-Zähler" ist seit P3.3 falsch (deckt sich mit Safety-Concern 1).
  4. `src/config.js:633` (`maxEmptyTurns`-Kommentar) — „… bevor der Agent (nur Outbound) ein end_call freigibt" widerspricht der P3.3-Symmetrisierung und dem im selben Diff neu geschriebenen `PLAN-SECURITY.md`-Abschnitt.
- **s4:** — leer.

Positiv hervorgehoben (`passNotes`): Store-Fassade folgt exakt dem `reserveCents`-Ephemer-Muster; `config.js` nutzt den gehärteten `numEnv`-Validator korrekt (kein Wiederauftreten des früheren `parseInt`-Bugs); alle drei Locales vollständig nachgezogen, DE-Umlaut-Pinning erweitert; `capFarewellLeadMs=0` als Aus-Schalter strukturell verifiziert (`remainingMaxDurationMs` floort nie unter 0); Tests decken Grenzfälle sauber ab (Streak 1/2/3/7-Sättigung, Cap-Vorlauf×No-Speech-Kombination, konsekutiv-vs-kumulativ-Reset). Keine Magic Numbers ohne Konstante, kein toter/auskommentierter Code, keine abgeschalteten Sicherungen.

**topTodos aus dem Audit:** die vier stale Kommentare vor Merge aktualisieren (kein funktionaler Blocker, Phase kann danach gemergt werden).

---

## 6. Fix-Runden

### Runde 1 (r1)

- **Gemeldeter Blocker:** P3-COV1 — Testabdeckungslücke für die Verhaltens-Komposition `capFarewellOutcome(call) ?? noSpeechOutcome(call)` (Kombination aus Cap-Vorlauf UND No-Speech-Zweig, D2 aus dem Plan).
- **Fix:** reiner Test-Add, **kein** Produktionscode geändert — `src/routes/voice.js` war bereits korrekt implementiert (manuell vom Reviewer bestätigt), es fehlte lediglich ein automatisierter Regressionstest für diese Komposition.
- **Ergebnis:** Suite steigt von 2466 auf **2467** Tests, alle grün. Branch nach diesem Fix final als `phase/cq-p3-defects-fix1` benannt.

Keine weiteren Fix-Runden dokumentiert — die vier s3-Kommentar-Befunde aus dem finalen Clean-Code-Audit sind explizit als „vor Merge empfohlen, kein Blocker" eingestuft und nicht Teil des Fix-Zyklus dieser Phase (Kosmetik-Nachtrag für eine Folge-Runde).

---

## 7. Offene Owner-/Deploy-Auflagen

*(NICHT-AGENTEN-ARBEIT / Restrisiken / Bestandsdaten-Auflagen — kein Teil des Abnahmekriteriums dieser Phase, aber vor bzw. nach Deploy zu beachten)*

1. **Probeanruf zur Hör-Verifikation (echte Kosten, NICHT-AGENTEN-ARBEIT):** einmal outbound mit temporär kleinem `MAX_CALL_DURATION_S` anrufen — hört man den Abschluss-Satz (`capFarewellSpeech`) vollständig, bevor aufgelegt wird? Falls er abgeschnitten wird, ist `CAP_FAREWELL_LEAD_MS` zu klein und per Env nachzujustieren, **ohne Code-Diff**.
2. **Render-Env (optional):** `CAP_FAREWELL_LEAD_MS` ist nicht in `render.yaml`, braucht keinen Eintrag — der Default 20000 trägt. Nur setzen, falls Punkt 1 eine Nachjustierung ergibt. Render-Services sind dashboard-managed (Lehre `subscription-checkout-money-path`) — Wert dort manuell pflegen, nicht über `render.yaml` erwarten.
3. **Betriebs-Invariante festhalten:** `CAP_FAREWELL_LEAD_MS` muss deutlich unter `MAX_CALL_DURATION_S` bleiben. Bei einem künftigen Absenken von `MAX_CALL_DURATION_S` ist dieser Wert mitzuprüfen — es existiert **kein Boot-Guard**, der die Kreuzvalidierung erzwingt (Safety-Concern 2). Ein Fehlkonfig (`MAX_CALL_DURATION_S=30` + `CAP_FAREWELL_LEAD_MS=60000`) würde jeden Call nach dem ersten Turn beenden — Richtung ist sicher (nie länger als der Cap), aber betrieblich unerwünscht.
4. **`MAX_EMPTY_TURNS` bleibt auf 3.** Jede Erhöhung ist jetzt eine Kostenentscheidung auf einer Achse ohne Budget-Gate (Carrier-Minuten laufen bei Inbound nicht in `reconcileOutboundVoiceBudget`, einziger Deckel ist der harte `MAX_CALL_DURATION_S`-Cap) — dokumentiert in `PLAN-SECURITY.md#P3-INBOUND`.
5. **Metrik-Wiedervorlage:** die im Ursprungsplan verworfene Vorwarn-Stufe kommt erst wieder auf den Tisch, wenn das Frühwarnsignal „Anteil Calls am 180-s-Cap" über 5% steigt — messbar erst mit `METRICS_ENABLED=true` in Prod (offene Auflage aus P2a).
6. **Realtime-Engine-Flip-Vorbehalt:** P3.3 ändert auch `bridge.js`-Guard-Verhalten für Inbound (bounded verifiziert, aber `VOICE_ENGINE=realtime` ist nicht live). Vor einem künftigen Wechsel auf die Realtime-Engine gehört ein eigener Probe-Anruf, der genau diesen Pfad hört.
7. **json↔pg-Shape-Drift bei `noSpeechStreak`:** das Feld erscheint additiv in `/api/state`/MCP-Ausgaben nur beim json-Backend (kein Secret, kein PII, gleiches Muster wie `reserveCents`) — als bekannte, akzeptierte Inkonsistenz zu behandeln, nicht stillschweigend als Bug zu werten, falls sie später auffällt.
8. **Kommentar-Kosmetik vor nächstem Merge-Fenster:** vier stale „(nur Outbound)"-Kommentare (`claude.js` ×3, `config.js` ×1, s. §5 s3) sollten in einer Folge-Runde aktualisiert werden — kein funktionaler Blocker, aber Fehlerquelle für die nächste Session, die sich auf den Kommentar statt den Code verlässt.
9. **Lint-Gate nicht verifiziert:** `npm run lint` war im Review-Worktree wegen fehlender eslint-Binary im symlinkten `node_modules` nicht ausführbar. Vor einem tatsächlichen Merge/Deploy sollte Lint einmal in einer Umgebung mit funktionierendem `node_modules` laufen.
10. **Kein Push vorgesehen.** Der Plan sieht weder `git push origin` noch `upstream` vor; Deploy ist eine separate Owner-Entscheidung. `finalBranch` (`phase/cq-p3-defects-fix1`) liegt lokal/remote im Review-Worktree-Zustand, nicht auf `master` gemergt.
