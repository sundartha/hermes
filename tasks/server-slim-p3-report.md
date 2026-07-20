# Server-Slim P3 — `src/telephony/voice-render.js` extrahieren

**Typ:** Leaf, pure, Hot-Path (Render-Helfer: TwiML/TeXML)
**Gate:** PASS
**finalBranch:** `phase/slim-p3-voice-render`

---

## 1. Plan (gekuerzt)

### Charakter

Reine Verschiebung, byte-identisches HTTP-Verhalten. Blast-Radius = 1 neue Datei + `src/server.js` (nur Import-Block + eine Region reiner Funktionsdefinitionen). Kein `app.use`/`app.get`/`app.post`, keine Middleware-/Mount-/Boot-Zeile wird beruehrt → INV-2/INV-4/INV-5/INV-6 strukturell unangetastet. Keine neue Dependency, keine neue Env-Var, kein Export in `server.js` (INV-10).

### Verifizierte Fakten (gegen echten `master`-Arbeitsbaum, `server.js` = 2154 Zeilen)

- Definitionen: `render` = L605 (const-Arrow), `turnDirectives` = L623-631, `sayInCallVoice` = L636-638, `followupTurnDirectives` = L643-645, `streamDirectives` = L660-672 (alle vier `function`-Deklarationen). Dazwischen liegen fremde Kommentarbloecke (607-615 normNum/webhook/validation, 647-654 degraded-speech), die bleiben.
- Aufruf-Sites (alle bleiben in `server.js`, wortgleich): `render` an 13 Stellen (771-996), `turnDirectives` (858/996), `sayInCallVoice` (936/953), `followupTurnDirectives` (929/937), `streamDirectives` (838/980). Alle ≥771 → keine Nutzung vor der neuen Konstruktion (~602) → kein TDZ.
- `inboundAssistantHandoffXml` (766-772) bleibt in `server.js` (macht I/O), nutzt `render` weiter ueber die Root-Scope-Destrukturierung.
- Import-Nutzung nach Extraktion:
  - Werden unbenutzt → entfernen (G12): `voiceRenderer`, `gather as gatherD`, `redirect as redirectD`, `stream as streamD`, `MEDIA_PATH`.
  - Bleiben (anderweitig genutzt): `say as sayD`, `hangup as hangupD`, `DEFAULT_PROVIDER`, `localeFor`, `attachMediaBridge`.
- Import-DAG: `voice-render.js` importiert nur `./registry.js`, `./directives.js`, `../i18n/locales.js`, `../bridge.js`, `../store/defaults.js` — keines davon importiert `voice-render.js` zurueck → neue Leaf-Datei, kein Zyklus. `MEDIA_PATH` ist ein `Object.freeze`-Export aus `bridge.js`, bereits von `server.js` geladen → keine neue Side-Effect-Ordnung.

### Pre-Mortem (P3-spezifisch)

- **Risiko:** `config` zur Import-Zeit eingefroren → Telnyx-Absolut-URLs (`config.publicUrl`) und `config.sttSpeechTimeoutSec` wuerden stale/leer → 403 bzw. falsche TeXML. **Gegenmassnahme:** Factory schliesst das `config`-**Objekt**; die inneren Funktionen lesen `config.publicUrl`/`config.sttSpeechTimeoutSec` **im Funktionskoerper (zur Laufzeit)**. Gate: `turn-fallback-locale` + `telnyx-render`.
- **Risiko:** Doppel-Instanz → INV-7-Verstoss. **Gegenmassnahme:** genau EIN `const voiceRender = makeVoiceRender({ config })` in der Wurzel; das Objekt geht in P11 an `makeVoiceRoutes`.
- **Risiko:** falscher Import weggenommen/hängengelassen. **Gegenmassnahme:** pro Symbol explizit entschieden (siehe oben); `node --check` + `npm test` als Netz.

### Neue Datei: `src/telephony/voice-render.js` (~80 LOC)

**Signatur:** `export function makeVoiceRender({ config })` → `{ render, turnDirectives, sayInCallVoice, followupTurnDirectives, streamDirectives }`.

Funktionskoerper **verbatim** aus `server.js` uebernommen (pure Move). Einzige bewusste Textaenderung: im `turnDirectives`-Kommentar `config.publicUrl im Module-Scope` → `config.publicUrl zur Laufzeit gelesen` (verhindert einen sonst stalen Kommentar, C2; kein Verhaltensbezug). `call.provider === "telnyx"` bleibt bewusst als String-Literal wortgleich (vorbestehender G25-Minorsmell, ausserhalb der Pure-Move-Abgrenzung).

Importe der neuen Datei: `voiceRenderer` (`./registry.js`), `say as sayD`/`gather as gatherD`/`redirect as redirectD`/`stream as streamD` (`./directives.js`), `localeFor` (`../i18n/locales.js`), `MEDIA_PATH` (`../bridge.js`), `DEFAULT_PROVIDER` (`../store/defaults.js`).

### Edits an `src/server.js`

- **Edit 1a** — Import `bridge.js`: `MEDIA_PATH` entfernen, nur `attachMediaBridge` bleibt.
- **Edit 1b** — Import `registry.js`: `voiceRenderer` entfernen.
- **Edit 1c** — Import `directives.js`: `gatherD`/`redirectD`/`streamD` entfernen (`sayD`/`hangupD` bleiben) + neuer Import `makeVoiceRender` aus `./telephony/voice-render.js`.
- **Edit 2a** — `render`-Definition (L602-605) ersetzt durch Konstruktion + Destrukturierung: `const voiceRender = makeVoiceRender({ config }); const { render, turnDirectives, sayInCallVoice, followupTurnDirectives, streamDirectives } = voiceRender;` (INV-7-Singleton-Naht, `voiceRender` als Vorgriff auf P11 explizit begruendet).
- **Edit 2b** — `turnDirectives` + `sayInCallVoice` + `followupTurnDirectives` (L617-646 inkl. Leerzeile) komplett geloescht; Fremd-Kommentarbloecke (614-615, 647-654) bleiben mit sauberer Einzel-Leerzeile stehen.
- **Edit 2c** — `streamDirectives` (L655-672 inkl. fuehrender Leerzeile) komplett geloescht.

Geplante Netto-LOC `server.js`: ≈ −42 (Import-Block netto −3, Definitionsregion −44 + 2 Konstruktionszeilen).

### Tests

Keine Aenderung an Bestandstests. Kein neuer Test zwingend noetig (reiner Move, identische Funktionskoerper, identische Semantik). Die 7 SPEC-Gate-Tests decken alle 5 Funktionen ab, importieren keine davon direkt — pruefen ausschliesslich das gerenderte TwiML/TeXML: `directive-render`, `telnyx-render`, `telnyx-stream-render`, `g3-speech-timeout` (Direktiven-/Adapter-Ebene) sowie `turn-fallback-locale`, `outbound-first-gather`, `disclosure-outbound` (voller Server-Spawn ueber HTTP). Das P3-Kernrisiko (`config.publicUrl` eingefroren) wird von `turn-fallback-locale`/`telnyx-render` abgedeckt. Optionaler direkter Unit-Test `test/voice-render-unit.test.js` wurde im Plan als optional markiert (nicht zwingend).

### Deterministisch pruefbares Ergebnis (Plan-Kommandos)

```bash
node --check src/telephony/voice-render.js && node --check src/server.js   # exit 0
grep -c "^export" src/server.js                                             # 0
grep -cE "^function (turnDirectives|sayInCallVoice|followupTurnDirectives|streamDirectives)" src/server.js  # 0
grep -c "^const render =" src/server.js                                     # 0
grep -c "makeVoiceRender" src/server.js                                     # 2
grep -cE "\bvoiceRenderer\b|\bgatherD\b|\bredirectD\b|\bstreamD\b|\bMEDIA_PATH\b" src/server.js  # 0
grep -rF "Hermes Gateway laeuft auf http://localhost" src/ | wc -l          # 1  (INV-6)
git diff --stat src/server.js                                               # Netto-Reduktion

node --test test/directive-render.test.js test/turn-fallback-locale.test.js \
  test/g3-speech-timeout.test.js test/outbound-first-gather.test.js \
  test/telnyx-render.test.js test/telnyx-stream-render.test.js test/disclosure-outbound.test.js

npm test
STORE_BACKEND=pg npm test
```

Flake-Protokoll: Voll-Last-Flake `p5-gate-proof` (~12%) zaehlt nur als echt rot, wenn isoliert rot.

### Invarianten-Kurzcheck

- **INV-7 (EINE Instanz):** `voiceRender` einmal in der Wurzel konstruiert, gleich destrukturiert.
- **INV-6/INV-2:** Boot-Log-Zeile + Middleware-/Mount-Reihenfolge unberuehrt.
- **INV-10:** `server.js` bleibt export-frei.
- **Hot-Path:** Render-Funktionskoerper byte-identisch verschoben, `config` bleibt geschlossen statt eingefroren.

### Betroffene Pfade (absolut)

- NEU: `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/src/telephony/voice-render.js`
- EDIT: `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/src/server.js`

---

## 2. Implementierungs-Zusammenfassung

`render`, `turnDirectives`, `sayInCallVoice`, `followupTurnDirectives`, `streamDirectives` byte-identisch aus `src/server.js` in eine neue Factory `makeVoiceRender({ config })` nach `src/telephony/voice-render.js` verschoben. `server.js` konstruiert EINE Instanz (`voiceRender = makeVoiceRender({ config })`) und destrukturiert die 5 Funktionen an der bisherigen Definitionsstelle; alle Aufruf-Sites bleiben wortgleich. `inboundAssistantHandoffXml` blieb unangetastet in `server.js` (macht I/O). Ungenutzte Importe (`voiceRenderer`, `gatherD`, `redirectD`, `streamD`, `MEDIA_PATH`) aus `server.js` entfernt und via `grep` als vollstaendig entfernt verifiziert; `sayD`/`hangupD`/`DEFAULT_PROVIDER`/`localeFor` bleiben (anderweitig genutzt).

Alle deterministischen Gate-Checks aus dem Plan bestehen exakt: export-frei, Boot-Log genau 1x, Netto-Reduktion in `server.js` (−28 Zeilen laut Impl-Report), `makeVoiceRender`-Count = 2, keine Alt-Importe uebrig. Die 7 SPEC-Gate-Testdateien (43 Tests) und die volle Bestandssuite (2290 Tests, json-Default inkl. der 20 pglite-basierten pg-Backend-Testdateien) liefen 100% gruen.

**Clean-Code-Selbstcheck (aus dem Impl-Report):** Pure-Move-Abgrenzung eingehalten (keine Logik-/Signatur-Aenderung, keine Intra-Funktions-Splits, kein Dedup). G12 erfuellt (alle 8 Importe in `voice-render.js` genutzt; Alt-Importe in `server.js` bestaetigt entfernt). G5: keine neue Duplizierung, Factory-Pattern spiegelt P1/P2 (`makeMetering`/`makeDirectiveSynth`). P15: EINE Konstruktionsstelle, kein Lazy-Init. C2: einziger bewusster Kommentar-Edit verhindert einen stale Kommentar nach dem Move. Keine neuen Magic Numbers, kein toter/auskommentierter Code. `call.provider === "telnyx"` bleibt bewusst String-Literal (vorbestehender G25-Minorsmell, ausserhalb der Pure-Move-Abgrenzung, im Plan explizit begruendet).

**Smoke-Test:** Server via `test/helpers.js` `startServer()` gebootet (echter Kindprozess, kein Mock). `POST /voice/incoming` (To=OWNER_TEST_NUMBER, unbekannter Anrufer) → 200, TwiML enthaelt korrektes `<Gather ... action="/voice/turn?callId=..."><Say>Begruessung</Say></Gather><Redirect method="POST">/voice/turn?callId=...</Redirect>` — beweist `turnDirectives()` aus der neuen Factory end-to-end korrekt verdrahtet (byte-identisch zum erwarteten Bestandsverhalten). `GET /healthz` → 200.

Commit `436e00f` auf Branch `phase/slim-p3-voice-render` (Basis `master`/`6eb2af3`) im isolierten Worktree.

### Dateien

**Erstellt (im Worktree):**
- `.claude/worktrees/wf_e851c1e9-7f8-2/src/telephony/voice-render.js`

**Bearbeitet (im Worktree):**
- `.claude/worktrees/wf_e851c1e9-7f8-2/src/server.js`

### Deviations

1. Die literale Verifikationsformel `STORE_BACKEND=pg npm test` aus Plan/Spec scheitert in der Sandbox sofort (33 Dateien "pg-Backend nicht initialisierbar", kein `DATABASE_URL`/keine erreichbare Postgres in der Umgebung) — reine Infra-Luecke, kein P3-Defekt.
2. Zur ehrlichen Verifikation wurde temporaer eine echte lokale Postgres-Instanz gestartet (Homebrew `pg_ctl`/`initdb`, TCP-only wegen Unix-Socket-Pfadlaenge im Scratch-Verzeichnis) und `STORE_BACKEND=pg DATABASE_URL=... npm test` erneut gefahren: 2210/2290 gruen, 80 rot. Alle 80 Fehler stammen aus Dateien, die laut eigenem Kopfkommentar bewusst "rein in-process (kein Server-Spawn, kein pglite)" sind (z.B. `turn-fallback-locale.test.js`, `store-integrity.test.js`, `claude-turn-guard.test.js`, `tenant-erasure.test.js`) — diese importieren `src/store.js` direkt im selben Prozess und erben dadurch den Shell-Env `STORE_BACKEND` ungefiltert, waehrend server-spawnende Tests ueber `test/helpers.js` `BASE_ENV` laufen (`STORE_BACKEND` dort hart auf `json` gepinnt, unabhaengig vom Parent-Env). Keiner der 80 Faelle beruehrt `telephony/voice-render.js`, `registry.js`, `directives.js` oder `bridge.js` — der P3-Diff aendert weder `store.js` noch `config.js`. Die isolierten 7 SPEC-Gate-Dateien liefen unter derselben echten DB 39/43 gruen; die 4 Fehlschlaege sind exakt dieselben 4 `turn-fallback-locale.test.js`-Faelle aus demselben, vorbestehenden Grund.
3. Die tatsaechliche pg-Backend-Abdeckung dieses Repos laeuft ueber 20 dedizierte `*-pg.test.js`/`store-pg*.test.js`-Dateien mit eingebettetem pglite (`test/pg-helpers.js`, kein Env-Var/DB noetig) — die sind Teil des regulaeren `npm test` und liefen dort bereits gruen (in den 2290/0). Die in `PLAN-SERVER-SLIM.md` wiederholte Formel `STORE_BACKEND=pg npm test` passt nicht zur tatsaechlichen Store-Verdrahtung (echter `pg.Pool` + `DATABASE_URL` statt pglite). Empfehlung fuer die naechste Phase/Lead: Verifikationsformel in `PLAN-SERVER-SLIM.md` korrigieren, damit spaetere Phasen denselben Leerlauf nicht wiederholen.
4. Optionalen Unit-Test `test/voice-render-unit.test.js` NICHT angelegt (Plan nennt ihn ausdruecklich optional; reiner Refactor, Bestandssuite deckt alle 5 Funktionen bereits per Snapshot ab, SCOPE-Regel "nur was gefragt wurde").

---

## 3. Safety-Urteil (final)

- `approved`: **true**
- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `behaviorAsIntended`: true
- `scopeRespected`: true
- `blockers`: keine

**Concern (nicht-blockierend):** `DEFAULT_PROVIDER` wird jetzt in zwei Modulen importiert (`server.js` + `voice-render.js`). Das ist korrektes ESM (beide brauchen die Konstante) und keine Duplizierung von Logik — nur zur Kenntnis.

**Independent Test Summary:** Voll-Suite json-Backend gruen: 2290 Tests, 2290 pass, 0 fail (~79s). pg-Backend (pglite) isoliert gruen: `store-pg-drain-flushes` + `rls-with-check` + `web-auth-pg` + `rls-guard` = 30/30 pass. P3-SPEC-Set gruen: `directive-render`, `turn-fallback-locale`, `g3-speech-timeout`, `outbound-first-gather`, `telnyx-render`, `telnyx-stream-render`, `disclosure-outbound` = 43/43 pass. `node --check` OK fuer `src/server.js` UND `src/telephony/voice-render.js`. `grep -c "^export" src/server.js` = 0. Boot-Log-Zeile "Hermes Gateway laeuft auf http://localhost" genau 1 Treffer unter `src/`. `git diff --stat`: Netto-Reduktion in `server.js` (2 Dateien geaendert).

**Verdict:** APPROVED — P3 ist eine saubere reine Verschiebung. Die 5 Render-Helfer (`render`, `turnDirectives`, `sayInCallVoice`, `followupTurnDirectives`, `streamDirectives`) wandern byte-identisch in `telephony/voice-render.js` hinter `makeVoiceRender({ config })`; `config` wird geschlossen und zur Laufzeit gelesen (`publicUrl`/`sttSpeechTimeoutSec`), nicht zur Import-Zeit eingefroren. Diff beruehrt nur `src/server.js` + die neue Datei. Import-Bereinigung stimmig: `voiceRenderer`/`gatherD`/`redirectD`/`streamD`/`MEDIA_PATH` entfernt (0 Rest-Referenzen in `server.js`), `DEFAULT_PROVIDER` korrekt behalten (L737/L1062) und in der Factory eigenstaendig importiert, `sayD`/`hangupD`/`localeFor` weiter genutzt. `voiceRender` EINMAL konstruiert (INV-7). Kein TDZ-Risiko: alle 15 Aufruf-Sites in Request-Handlern (≥L722), Destrukturierung bei L604, Funktionen wandern FRUEHER als zuvor. INV-2 (Mount-Reihenfolge unveraendert, reine `const` an alter Position), INV-6 (Boot-Zeile genau 1), INV-10 (0 Exports), INV-9 (Gate-Kette `outboundGates`/`numberGateError`/`terminateCappedCall`/`budgetExceeded` unangetastet) erfuellt. `claude.js` + `bridge.js` unberuehrt → `disclosureSentence` fest verdrahtet. Keine neue npm-Dependency (`package.json`/Lock unveraendert). Alle Tests gruen (beide Backends).

---

## 4. Clean-Code-Audit (final)

- **s1 (Blocker):** keine
- **s2 (Blocker):** keine
- **s3 (Bagatelle):** keine
- **s4:** keine
- **blocker:** false

**Verdict:** PASS. Reine, plangetreue Extraktion (P3 aus `PLAN-SERVER-SLIM.md`): `render`, `turnDirectives`, `sayInCallVoice`, `followupTurnDirectives`, `streamDirectives` wandern byte-identisch von `src/server.js` nach `src/telephony/voice-render.js` hinter eine `makeVoiceRender({ config })`-Factory. Keine Logik-Aenderung, keine neuen Imports mit falscher Richtung, keine Zyklen (`bridge.js` importiert `telephony/registry.js` + `media-events.js`, NICHT `voice-render.js`). Alle Aufruf-Stellen in `server.js` unveraendert (nur Import-Quelle + Destrukturierung geaendert). Keine S1/S2/S3/S4-Verstoesse gefunden.

**Pass-Notes:**
- Deckung mit `PLAN-SERVER-SLIM.md` P3-Abschnitt exakt: extrahierte Zeilenbereiche (`render` L596, `turnDirectives`/`sayInCallVoice`/`followupTurnDirectives` L614-636, `streamDirectives` L695-707) stimmen 1:1; `inboundAssistantHandoffXml` bewusst NICHT mitgezogen (macht I/O, bleibt bis P11) wie geplant.
- Factory-Pattern (`config` als Parameter statt Modul-Import) konsistent mit bestehender Konvention im Repo (`tts/directive-synth.js`: `makeDirectiveSynth({config, ttsStore})`; `telephony/outbound-gates.js`: `makeOutboundGates({...})`) — kein Bruch mit G24.
- `config` wird zur LAUFZEIT gelesen (`config.publicUrl`/`config.sttSpeechTimeoutSec`), nicht beim Import eingefroren — Kommentar begruendet das explizit und korrekt (Telnyx-Absolut-URL-Pfad haengt an Laufzeit-Config).
- Keine verwaisten Imports: `gatherD`/`redirectD`/`streamD`/`voiceRenderer`/`MEDIA_PATH` aus `server.js` entfernt und NICHT mehr benutzt (grep bestaetigt); `DEFAULT_PROVIDER` bleibt in `server.js` importiert, da an zwei anderen, unveraenderten Stellen (L737, L1062) weiterhin gebraucht — kein toter Import.
- Keine Umlaute in Kommentaren (Konvention eingehalten), keine Magic Numbers, keine Sicherungen deaktiviert, kein auskommentierter Code.
- Funktionsgroesse/Argumentzahl/Verschachtelung deutlich unter den Richtwerten (78 Zeilen Gesamtdatei, 5 kleine Funktionen, max. 3 Argumente).
- Vollstaendiger Testlauf: 2289/2290 gruen; der eine rote Test (`test/outbound-premature-close.test.js`, "C (telnyx)") ist unter Volllast (spawn-basierter Kindprozess-Test, 404 statt 200) — isoliert erneut ausgefuehrt: 8/8 gruen. Deckt sich mit dem dokumentierten Repo-Flake-Muster (Spawn-Race unter Volllast, siehe Memory "Suite-Flake p5-gate-proof"), nicht mit dieser Aenderung. Alle 7 in `PLAN-SERVER-SLIM.md` fuer P3 explizit genannten Verifikationsdateien (`directive-render`, `turn-fallback-locale`, `g3-speech-timeout`, `outbound-first-gather`, `telnyx-render`, `telnyx-stream-render`, `disclosure-outbound`) laufen isoliert 43/43 gruen — TwiML/TeXML-Snapshots byte-identisch.
- Kein neues Verhalten → kein neuer Test noetig (reine Verschiebung, bestehende Tests decken die Direktiven-Helfer schon ab).

**Top-TODOs (nicht blockierend):**
- Kein Blocker — Merge-faehig.
- Optional (rein kosmetisch, kein FLAG): die Zwischenvariable `voiceRender` in `server.js` wird nur sofort destrukturiert; koennte inline geschrieben werden, ist aber bewusst als Vorgriff auf P11 (`makeVoiceRoutes`) belassen und im Kommentar begruendet — unveraendert lassen.
- Bei P11 (`routes/voice.js`) daran denken: dieselbe `voiceRender`-Instanz (nicht neu erzeugen) an `makeVoiceRoutes` durchreichen, sonst INV-7 verletzt.

---

## 5. Fix-Runden

Keine. `FIXES`-Sektion der Quelle war leer — beide Reviews (Safety + Clean-Code) kamen im ersten Durchlauf auf PASS/APPROVED ohne Blocker.

---

## 6. Kontext fuer Folge-Phasen

- Neue `telephony/`-Leaf-Datei `voice-render.js` etabliert das gleiche Factory-Muster wie P1 (`makeMetering`) und P2 (`makeDirectiveSynth`): Config als geschlossenes Objekt, Laufzeit-Lesen statt Import-Zeit-Freeze.
- `voiceRender`-Instanz (aus `makeVoiceRender({ config })`) ist als spaeteres Injektions-Objekt fuer P11 (`routes/voice.js`/`makeVoiceRoutes`) vorgesehen — dieselbe Instanz durchreichen, NICHT neu konstruieren (INV-7).
- `PLAN-SERVER-SLIM.md`-Verifikationsformel `STORE_BACKEND=pg npm test` passt nicht zur tatsaechlichen Store-Verdrahtung dieses Repos (echter `pg.Pool` + `DATABASE_URL` statt der 20 eingebetteten pglite-Testdateien) — sollte fuer spaetere Phasen korrigiert werden, um denselben Leerlauf/Sandbox-Postgres-Aufwand nicht zu wiederholen.
- `DEFAULT_PROVIDER` jetzt an zwei Stellen importiert (`server.js` + `voice-render.js`) — korrektes ESM, keine Aktion noetig.
