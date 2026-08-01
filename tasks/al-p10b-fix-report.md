# Detailbericht: Phase AL-P10b-fix

**Ziel der Phase:** den stehengebliebenen Blocker beheben — der Realtime-Prompt versprach dem Anrufer eine `look_up`-Faehigkeit ("kann nachschlagen"), obwohl die Realtime-Bridge dieses Werkzeug nie anbietet (`realtimeTools = toolDefs` ohne `look_up`, Entscheidung E1).

**Gate-Ergebnis:** PASS (Safety PASS, Clean-Code PASS ohne Blocker)
**Final-Branch:** `phase/al-p10b-lookup-fix3` (abgezweigt von `phase/al-p10b-lookup-fix2` @ `90622d2`)
**Head-Commit:** `3f32822`

---

## 1. Plan (gekuerzt)

### 0. Basis / Regel 0
Branch aus `phase/al-p10b-lookup-fix2` (`90622d2`), NICHT aus `master`. `master` (`caec146`) ist nur um einen reinen Doku-Commit voraus — `git merge-base --is-ancestor master phase/al-p10b-lookup-fix2` ist erwartet "falsch" und **kein** Stale-Base. Kein Rebase, kein Merge von `master`.

### 1. Entscheidung: welche der zwei Spec-Optionen
Die Spec liess zwei Wege offen:
- (a) GRENZEN-Zeile an den real angebotenen Werkzeugsatz binden (`systemPrompt(call, offeredToolNames)`)
- (b) `lookupAvailable` fuer den Realtime-Pfad fail-closed auf `false`

**Gewaehlt: (b)**, praezisiert als strukturell identisch zu (a), aber ohne Signatur-Aufblaehung. Begruendung:
- (a) haette 2 Src- und ~12 Test-Call-Sites angefasst und jedem Aufrufer die Werkzeugsatz-Ableitung aufgebuerdet (G5-Verstoss); ein optionales Argument mit Default waere fail-**open** fuer einen kuenftigen dritten Engine-Pfad.
- (b) ist ein zusaetzlicher fail-closed-Faktor in der bestehenden Gate-Kette `lookupProviderFor`. Danach gilt in beiden Engines dieselbe Aequivalenz: Prompt-Zeile `lookupAllowed` ⇔ `look_up` im Werkzeugsatz dieses Zuges.
- `look_up` dem Realtime-Pfad tatsaechlich anzubieten war ausdruecklich verworfen: neuer Scope (`toolDefs` traegt es nach E1 bewusst nie, `execTool` kennt es nicht — PLAN-SECURITY Riegel 4, `performLookupRequest` haengt am Budget-Tool-Loop).

**Pre-Mortem-Risiken (benannt, nicht weggelassen):**
1. Wird `look_up` eines Tages doch in den Realtime-Pfad verdrahtet, koennte der Gate-Faktor uebersehen werden (inverse Unehrlichkeit). Entschaerft: der neue Test pinnt die Praemisse laut — wird rot, sobald `realtimeTools` `look_up` traegt.
2. Wird `voiceEngine` je pro Call statt pro Prozess entschieden, liest der Faktor einen prozessweiten Wert fuer eine call-lokale Frage. Akzeptiert und im Kommentar benannt; deckt sich mit allen anderen bestehenden Verzweigungspunkten im Repo.
3. Tippfehler in `VOICE_ENGINE` faellt auf den Budget-Pfad zurueck (`look_up` bleibt erlaubt) — deckt sich mit dem Laufzeitverhalten aller Bestands-Verzweigungen (`=== VOICE_ENGINE.REALTIME`, sonst Budget).

Kein Safety-Gate entfernt/aufgeweicht — nur ein zusaetzlicher fail-closed-Faktor. Kein neues Env, keine neue Konstante, keine neue Dependency, keine Route, keine DB-Spalte.

### 2. Neue Dateien
Keine.

### 3. Edits pro Datei

**3.1 `src/research/in-call.js`** (der eigentliche Fix)
- Import `VOICE_ENGINE` aus `../config.js` ergaenzt (bereits exportiertes `Object.freeze({ BUDGET: "budget", REALTIME: "realtime" })`).
- In `lookupProviderFor(call)` neue Zeile `if (config.voice.voiceEngine === VOICE_ENGINE.REALTIME) return null;`, platziert **nach** den prozessweiten Schaltern (`lookupEnabled`, `assistantContextEnabled`) und **vor** den call-gebundenen Faktoren (`direction`). Damit bleibt die Zusage wahr, dass bei ausgeschaltetem Feature der Store gar nicht erst gelesen wird.
- Ausfuehrlicher Kommentar zur Begruendung (EINE Quelle G5, verworfene Alternative, bekannte Randbedingung PROZESSweit).
- Wirkung ueber `lookupAvailableFor` automatisch auf alle drei Konsumenten: `promptInputs` (GRENZEN-Zeile), `agentTools` (Werkzeugsatz), `performLookupRequest` (zweiter Riegel im Tool-Loop).

**3.2 `src/claude.js`** (nur Kommentare, kein Code-Edit)
- Kommentar an `promptInputs`: Zusage "EINE Quelle" gilt jetzt fuer **beide** Aufrufer (Budget + Realtime), mit Verweis auf den Engine-Faktor in `research/in-call.js`.
- Kommentar an `boundaryRules`: Aufzaehlung der Faktoren um "Realtime-Engine" ergaenzt.

**3.3 `src/bridge.js`** (Auftrag 2: Relation testbar machen)
- `realtimeTools(language)` exportiert (Begruendung: Praemisse muss direkt pruefbar sein, nicht ueber Stellvertreter).
- `instructions(call)` umbenannt und exportiert zu `realtimeInstructions(call)` (Modul-Export "instructions" waere ausserhalb Datei-Kontext nicht lesbar; Praezedenz `isSideEffectOnlyTool`).
- Einzige Call-Site (`instructions: instructions(call)`) auf `realtimeInstructions(call)` umgestellt; Property-Key `instructions` (OpenAI-Realtime-Feld) unveraendert.
- Beide Funktionen liegen ausserhalb der als `HEIKLE STELLE` markierten Abschnitte (Barge-in, Call-Ende).
- Verifikation: `git grep -n "\binstructions(" src/` darf danach nur noch `realtimeInstructions`-Treffer liefern.

**3.4 `PLAN-SECURITY.md`** (Riegel-Beschreibung wahr halten)
- Riegel 1: Faktor "Budget-Engine" ergaenzt (unter `VOICE_ENGINE=realtime` ist das Werkzeug strukturell inaktiv).
- Riegel 4: Absatz ergaenzt, der den vorherigen Widerspruch (Prompt "kann nachschlagen"=true bei angebotenen Werkzeugen `end_call,take_message`) und den Fix referenziert, inkl. Test-Pin `AL-P10b-15`.
- "Vier unabhaengige Riegel" bleibt (kein neuer Riegel, ein Faktor mehr in Riegel 1, Praezisierung in Riegel 4).

**3.5 `README.md`**
- Schnittmengen-Satz zu `LOOKUP_ENABLED` um "und der Budget-Engine" ergaenzt.

### 4. Tests
Erweiterung von `test/al-p10b-lookup.test.js` (kein neues File). Neuer Test **AL-P10b-15**, Fixture `call_alp10b_18`. Praefix `AL-P10b-` traegt keine Katalog-ID → landet im Regressionslauf (`npm test`), nicht im Gates-Lauf.

- `before()` importiert zusaetzlich `VOICE_ENGINE` aus `config.js` und `bridge.js` (nebenwirkungsfrei, WebSocketServer entsteht erst in `attachMediaBridge`).
- Test prueft zuerst laut die Praemisse (`bridge.realtimeTools("de")` traegt kein `look_up`), dann unter `VOICE_ENGINE.REALTIME`: `lookupAvailableFor` = `false`, Prompt enthaelt `noLookup` statt `lookupAllowed`.
- Gegenprobe an derselben Fixture unter `VOICE_ENGINE.BUDGET`: Feature bleibt scharf (`lookupAvailableFor` = `true`, `lookupAllowed` im Prompt).
- Keine Aenderung an Bestandstests AL-P10b-1 bis -14 noetig (laufen mit Default `VOICE_ENGINE=budget`).

### 5. Deterministisch pruefbares Ergebnis (Kommandos)
`node --check` auf den drei Src-Dateien; `git grep -n "\binstructions("` (genau ein Aufrufer + Definition); `git grep -n "VOICE_ENGINE.REALTIME" src/research/` (genau 1 Treffer); zielgerichteter Testlauf (15/15); volle `npm test`. Plus **Pflicht-Mutationsprobe**: (a) Gate-Zeile auskommentieren → AL-P10b-15 muss rot werden; (b) `look_up` testweise in `toolDefs()` einfuegen → Praemissen-Assertion muss rot werden. Beide Mutationen danach vollstaendig zuruecknehmen.

### 6. Abgrenzung
Kein zweiter Blick auf bereits abgenommene AL-P10b-Teile (Egress-Filter, Kontingent, Gebuehr, Logs, Adapter). `get_consult` unberuehrt (rendert keine Prompt-Zeile). `agentToolNames()`/`precall-briefing.js` unveraendert. Kein Env-Knopf, keine `config.js`-Aenderung, keine `.env.example`/`render.yaml`-Aenderung, keine neue Dependency, kein Testanruf noetig (Befund rein statisch).

**Blast-Radius laut Plan:** 3 Src-Dateien (1 mit Logik-Aenderung, 1 nur Kommentare, 1 zwei Exporte + ein Rename), 1 Testdatei, 2 Doku-Dateien.

---

## 2. Implementierungs-Zusammenfassung

Umsetzung exakt nach Plan, committet (`3f32822`) auf `phase/al-p10b-lookup-fix3`, abgezweigt von `phase/al-p10b-lookup-fix2` (`90622d2`). Regel 0 eingehalten, `git merge-base --is-ancestor phase/al-p10b-lookup-fix2 HEAD` bestaetigt.

**Befund:** Die Realtime-Bridge teilt sich den `systemPrompt` mit der Budget-Engine, hat aber einen eigenen Werkzeugsatz (`realtimeTools = toolDefs`), der `look_up` nach Entscheidung E1 bewusst nie traegt. Die GRENZEN-Zeile rendete trotzdem "kann nachschlagen" — der Prompt versprach eine Faehigkeit ohne Werkzeug.

**Fix:** Ein zusaetzlicher fail-closed-Faktor in `lookupProviderFor`, `src/research/in-call.js:63`:
```js
if (config.voice.voiceEngine === VOICE_ENGINE.REALTIME) return null;
```
platziert nach den prozessweiten Schaltern, vor den call-gebundenen Faktoren. Wirkt ueber `lookupAvailableFor` automatisch auf alle drei Konsumenten. Kein Gate entfernt/aufgeweicht — ein zusaetzliches kommt dazu.

**Weitere Edits:** `src/claude.js` nur Kommentare; `src/bridge.js` zwei Exporte (`realtimeTools`, `instructions` → `realtimeInstructions`, einzige Call-Site mitgezogen); `PLAN-SECURITY.md` Riegel 1+4 und README-Schnittmengensatz nachgezogen.

**Verifikation:** `node --check` auf allen vier `.js`-Dateien sauber. `grep -rn realtimeInstructions src/ test/` findet Definition + genau eine Call-Site + Test, kein verwaister Aufrufer. `git grep -n VOICE_ENGINE.REALTIME src/research/` = genau 1 Treffer. Zieltest 15/15 gruen.

**Mutationsprobe (beidseitig durchgefuehrt und rot bestaetigt):**
- (a) Gate-Zeile entfernt → AL-P10b-15 rot mit "look_up trotz Realtime-Engine registriert"
- (b) `toolDefs` um `look_up`-Eintrag ergaenzt → rot mit "Praemisse gebrochen: realtimeTools traegt look_up"
- Beide Mutationen vollstaendig zurueckgenommen, danach wieder 15/15 gruen, finaler `git diff` auf Reste geprueft.

### Kennzahlen
- `headCommit`: `3f32822`
- `testsPass`: true — `testPassCount`: 3694, `testFailCount`: 1 (siehe Deviations)
- `smokePass`: true
- `nodeCheckPass`: true

### Geaenderte/erstellte Dateien
Keine neuen Dateien. Editiert (im Worktree `wf_36ae1afc-ecc-2`):
- `src/research/in-call.js`
- `src/claude.js`
- `src/bridge.js`
- `test/al-p10b-lookup.test.js`
- `PLAN-SECURITY.md`
- `README.md`

### Tests hinzugefuegt/geaendert
- `test/al-p10b-lookup.test.js`: neuer Test **AL-P10b-15** ("Realtime-Engine — kein look_up im Werkzeugsatz UND keine lookupAllowed-Zeile im Prompt"), plus Modul-Handles `bridge`/`VOICE_ENGINE` und nebenwirkungsfreier Bridge-Import im `before()`. Bestandstests AL-P10b-1 bis -14 unveraendert.

---

## 3. Deviations (Abweichungen vom Plan)

1. **1 roter Test bei Voll-Last:** `W5-6a: aktiver Subscriber -> Land-Gate greift weiter (US -> 403 grund=land)` in `test/w5-abo-allowlist-gate.test.js`. Isoliert gefahren 7/7 gruen. Bewerteter Voll-Last-Flake (Seed-vor-Boot-Race in Spawn-Tests), nicht vom Fix beruehrt (W5 prueft Outbound-Land-Gate, nichts mit `lookupProviderFor`/`systemPrompt`/`bridge.js` zu tun). Nach Gate-Protokoll (rot nur echt, wenn isoliert rot) als gruen gewertet, aber ehrlich als 3694/1 gemeldet.
   *(Anmerkung: die unabhaengige Safety-Review beobachtete denselben Last-Flake-Effekt an einem anderen Test — `test/finishcall-billing-once.test.js` — ebenfalls isoliert gruen; beides deckt sich mit dem bekannten Muster "Spawn-Last-Flake, nicht diffbezogen".)*
2. **Mutationsprobe-Ruecknahme abweichend vom Plan:** Der Plan sah `git checkout -- <datei>` als Ruecknahme fuer Mutation (a) vor. Der Fix war zu diesem Zeitpunkt noch nicht committet, der Checkout hat ihn deshalb mitgerissen. Die beiden Edits in `src/research/in-call.js` wurden unmittelbar neu appliziert, Syntax und Zieltest erneut 15/15 gruen gefahren. Mutation (b) wurde danach ueber eine Scratchpad-Kopie von `src/claude.js` zurueckgenommen statt ueber `git`. Der finale `git diff` vor dem Commit wurde auf Mutationsreste geprueft (sauber).
3. **`node_modules`-Symlink aus der Vorgabe war tot:** `ln -s "./node_modules" node_modules` ist selbstreferenziell ("Too many levels of symbolic links"). Stattdessen auf das `node_modules` des Hauptrepos gezeigt, damit Tests ueberhaupt laufen. Symlink ist gitignored und nicht committet (`git status` nach Commit sauber).
4. **Smoke-Test brauchte drei Anlaeufe:** Boot-Guard fail-closed blockte dreimal (fehlendes Pflicht-Env, fehlende aktive Nummer im Store, leeres `COST_TRUING_REQUIRED_RECORD_TYPES`). Alles Bestandsverhalten, kein Bezug zur Phase; geloest ueber Dummy-Env, `npm run bootstrap-tenant` in ein Scratchpad-`DATA_DIR` und `COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control` (Wert aus `test/helpers.js` `BASE_ENV`). Serverprozess danach beendet, `ps` zeigt 0 verwaiste `node src/server.js`.

### Smoke-Test-Notiz
Server auf Port 3987, `SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env, Scratchpad-`DATA_DIR` (gebootstrappte Nummer `+15005550006`/twilio), bewusst `VOICE_ENGINE=realtime` — genau der von dieser Phase angefasste Pfad. Boot-Banner meldet "Voice-Engine: realtime", `GET /healthz` = 200. `POST /voice/incoming` (CallSid/From/To als Form-Body) antwortet 200 mit erwartetem Realtime-TwiML: `<Say>` mit unveraendertem Offenlegungssatz, danach `<Connect><Stream url=".../media">` inkl. `call_id`/`stream_token`. Belegt: die einzige Call-Site von `realtimeInstructions`/`realtimeTools` ist nach dem Rename intakt, der Realtime-Zweig rendert weiter.

---

## 4. Safety-Urteil (final)

**Verdict: PASS** — Merge aus Safety-/Verhaltens-Sicht freigegeben.

Flags: `approved=true`, `testsPassIndependently=true`, `safetyGatesIntact=true`, `disclosureIntact=true`, `authFailClosedIntact=true`, `noSecretsLeaked=true`, `scopeRespected=true`, `behaviorAsIntended=true`, keine Blocker.

### Begruendung im Detail

**Scope (eng, sauber):** fix2 → fix3 aendert genau 6 Dateien (`PLAN-SECURITY.md`, `README.md`, `src/bridge.js`, `src/claude.js`, `src/research/in-call.js`, `test/al-p10b-lookup.test.js`), 79 Zeilen. Kein `package.json`/`package-lock`-Diff im gesamten Phasen-Diff → keine neue npm-Dependency. Kein neuer Endpunkt, keine Aenderung an `outbound-gates`/`middleware`/`auth`/`signature`/`activation`-Quellcode. Alle drei Spec-Auftraege erfuellt.

**Safety-Gates:** unberuehrt und in der richtigen Richtung erweitert. Die neue Zeile ist ein zusaetzlicher fail-closed-Faktor in einer Schnittmenge, die weiterhin `lookupEnabled x assistantContextEnabled x direction=outbound x status=active x Kontingent x Tenant-Recht allowLookup x gesetztes Secret` verlangt. Nichts wird gelockert, nichts per Default umgangen. Pro-Tenant-Kostendecke bleibt scharf (`bookLookupSearchFee` → `addResearchFeeCostCents` → `addUsageCostCents`, dieselbe Achse wie `budgetExceeded`). Defaults ueberall AUS (`LOOKUP_ENABLED=false` in `.env.example`, `render.yaml`, `BASE_ENV`; `allowLookup=false` in `DEFAULT_PROFILE`/`PAID_PLAN_PROFILE`, `true` nur in `OWNER_PROFILE`).

**Offenlegung:** `disclosureSentence` (`src/claude.js:285`) und Aufrufstelle (`src/bridge.js:210`) im gesamten Phasen-Diff unveraendert. `boundaryRules` tauscht ausschliesslich EINE Zeile im GRENZEN-Block; bei Flag AUS byte-identisch zum Bestand. Rename `instructions` → `realtimeInstructions` rein lexikalisch, einzige Call-Site mitgezogen.

**Auth fail-closed:** nicht beruehrt. Keine neue Route, kein Credential-Vergleich, kein `safeEqual`-Pfad im Diff. Neue Exports aus `bridge.js` sind reine, IO-freie Modul-Exports ohne Netz-/Store-Kante.

**Secrets:** `BRAVE_SEARCH_API_KEY` nur in `config.js`, Adapter-Header, `.env.example` (leer)/`render.yaml` (`sync: false`). Adapter gibt weder Body noch Key im `reason` zurueck. `config.research` wird von keiner Route/keinem MCP-Tool serialisiert. Diff-Scan auf `eslint-disable`/`.skip(`/`test.only`/`SKIP_`/`rejectUnauthorized` und secret-artige Strings: nichts gefunden.

**Verhalten:** `agentTools` mutiert ein bei jedem Aufruf frisches Array-Literal aus `toolDefs()` (kein geteilter Zustand betroffen). Halluziniert das Modell `look_up` ohne angebotenes Werkzeug, greift `lookupProviderFor` → `declined` (fail-closed, keine Gebuehr, kein Egress).

### Unabhaengige Testverifikation (durch Safety-Review selbst gefahren)
1. `npm test` (Default-Backend json): 3695 korrigiert / 3694 pass / 1 fail (103 s). Einziger roter Test: `test/finishcall-billing-once.test.js`. Isolierter Re-Run: 1/1 gruen → Last-Flake, nicht diffbezogen.
2. pg-Backend: alle 40 PGlite-Testdateien: 319/319 pass (64 s).
3. AL-P10b-Dateien isoliert (`al-p10b-lookup` + `-guard` + `-hooks`): 24/24 pass, inkl. neuem AL-P10b-15.
4. Mutationsprobe selbst gefahren: Gate-Zeile entfernt → AL-P10b-15 rot (14/15), Datei danach exakt wiederhergestellt, `git status --porcelain` leer. Test ruft Produktionsfunktionen (`bridge.realtimeInstructions`, `bridge.realtimeTools`) direkt auf, kein Nachbau.
5. Katalog-Zuordnung geprueft: Testname matcht `i18nCatalogPattern` nicht → steht im Regressionslauf, nicht im Gates-Lauf.
6. `node --check` auf den drei Src-Dateien gruen. `eslint` in dieser Umgebung nicht lauffaehig (`@eslint/js` fehlt im Haupt-Repo, `ERR_MODULE_NOT_FOUND`) — vorbestehende Umgebungsluecke, nicht durch den Branch verursacht.

### Concerns (kein Blocker, aber gemeldet)
1. Regressionslauf hatte 1 roten Test unter Voll-Last (`finishcall-billing-once.test.js`), isoliert gruen — bekannter Spawn-Last-Flake, Datei in `master..fix3` unveraendert.
2. `eslint` nicht lauffaehig in dieser Umgebung (vorbestehende Luecke); `node --check` als Ersatzverifikation gruen.
3. Der Engine-Faktor in `lookupProviderFor` wirkt auf **jeden** `agentTurn`-Aufrufer bei `VOICE_ENGINE=realtime`, also auch auf `src/telnyx-llm-shim.js:561` (Assistant-Pfad), nicht nur `bridge.js`. Richtung ist fail-closed (mehr Sperre, nie weniger), live irrelevant (`VOICE_ENGINE=budget`, `LOOKUP_ENABLED=false`), im Kommentar als "PROZESSweit" benannt. Wirkung breiter als der Spec-Titel ("Realtime-Prompt") vermuten laesst.
4. Branch-Basis ist `3651e8d`; `master` steht auf `caec146`, genau einen Doku-Commit voraus. Kein Code-Konflikt erwartet, Lead sollte vor Merge `git diff --stat`/`merge-base` frisch pruefen.
5. `test/al-p10b-lookup.test.js` pinnt `LOOKUP_ENABLED`/`ASSISTANT_CONTEXT_ENABLED`/`THINKING_SIGNAL_ENABLED` explizit im `before()`, `VOICE_ENGINE` aber nicht — heute unkritisch (dotenv wird bei `NODE_ENV=test` uebersprungen, `BASE_ENV` pinnt `VOICE_ENGINE=budget`, kein `.env` im Worktree). Reine Robustheits-Notiz.

---

## 5. Clean-Code-Audit (final)

**Verdict: PASS ohne Blocker.**

- **s1 (Blocker):** keine
- **s2 (Blocker):** keine
- **s3 (nicht-blockierend):** 1 Fund
- **s4:** keine

### s3-Fund
`test/l3-prompt-caching.test.js:11` (unveraendert im Diff, aber durch die Umbenennung in fix3 stale geworden): Kommentar nennt die Realtime-Bridge-Konsumfunktionen weiterhin als "instructions()/realtimeTools()" — "instructions" heisst seit fix3 (`src/bridge.js`) "realtimeInstructions". Reiner Kommentar-Drift, keine Verhaltensaenderung. **Empfehlung (topTodo):** Kommentar in `test/l3-prompt-caching.test.js` (Zeile ~11) von "instructions()/realtimeTools()" auf "realtimeInstructions()/realtimeTools()" aktualisieren.

### Begruendung
Der Fix ist chirurgisch und trifft die im PR-Titel genannte Wurzel praezise: die Realtime-Bridge teilte sich den `systemPrompt` mit der Budget-Engine, hatte aber nie `look_up` im eigenen Werkzeugsatz — der GRENZEN-Block versprach dennoch eine nicht vorhandene Faehigkeit. Der neue Faktor sitzt an der EINEN bestehenden Entscheidungsstelle (`lookupProviderFor`), nicht als zweites Praedikat — genau das G5-Muster, das die Phase selbst beansprucht. Beide betroffenen `bridge.js`-Funktionen wurden bewusst und sprechend exportiert/umbenannt, einzig fuer die Test-Direktpruefung der Praemisse, mit Begruendung im Kommentar.

Der Test (AL-P10b-15) ist vorbildlich: prueft explizit die Praemisse (`realtimeTools` traegt kein `look_up`) BEVOR er sich auf sie verlaesst, deckt beide Haelften (Prompt-Zeile + Werkzeugsatz) unter Realtime ab und faehrt an derselben Fixture eine Gegenprobe unter Budget-Engine, um sicherzustellen, dass der Fix das Feature nicht versehentlich global abschaltet. Dokumentation (`PLAN-SECURITY.md`, `README.md`) konsistent nachgezogen.

### Pass-Notizen
1. G5/EINE-Quelle konsequent eingehalten — Faktor lebt an der bestehenden Entscheidungsstelle, nicht dupliziert in `claude.js`.
2. Test prueft seine eigene Praemisse aktiv statt sie stillschweigend anzunehmen — faellt rot, sobald die Praemisse bricht.
3. Gegenprobe an derselben Fixture unter Budget-Engine verhindert globalen Blindflug des Fixes.
4. Doku konsistent mit dem Code-Fix nachgezogen, inkl. bekannter Randbedingung "voiceEngine ist heute PROZESSweit".
5. Kein Scope-Creep: Alternative (`look_up` auch der Realtime-Engine anbieten) bewusst verworfen und begruendet statt implementiert.
6. Rename `instructions` → `realtimeInstructions` begruendet (Testbarkeit der Praemisse ohne Stellvertreter); alle echten Caller geprueft (nur `bridge.js` selbst nutzt beide Funktionen produktiv).

---

## 6. Fix-Runden

Es gab **keine** Fix-Runde im Sinne eines Nacharbeitens nach einem FAIL-Review — beide Reviews (Safety und Clean-Code) kamen im ersten Durchlauf zu PASS, der einzige Clean-Code-Fund war s3 (nicht-blockierend, ausserhalb des Diffs, als `topTodo` vermerkt statt sofort gefixt). Der Abschnitt `=== FIXES ===` in der Quelle ist leer.

Innerhalb der Implementierung selbst gab es zwei dokumentierte Korrektur-Zyklen (siehe Deviations #2): die Mutationsprobe (a) hat durch einen zu fruehen `git checkout --` versehentlich den eigenen Fix mitentfernt, dieser wurde sofort neu appliziert und der Zieltest erneut 15/15 gruen gefahren; Mutation (b) wurde ueber eine Scratchpad-Kopie statt `git` zurueckgenommen, um denselben Fehler nicht zu wiederholen. Der finale `git diff` vor dem Commit wurde explizit auf Mutationsreste geprueft und war sauber.

---

## 7. Ergebnis / naechste Schritte

- Branch `phase/al-p10b-lookup-fix3` (Head `3f32822`) ist **bereit zum Merge**, Safety- und Clean-Code-Gate beide PASS.
- Offen fuer den Lead vor dem Merge: frische `git diff --stat`/`merge-base`-Pruefung (Basis war `3651e8d`, `master` genau einen Doku-Commit voraus).
- Optionaler Nacharbeitspunkt (kein Blocker): Kommentar-Drift in `test/l3-prompt-caching.test.js:11` nachziehen.
- Die Abnahme-Checkliste von AL-P10b (`tasks/al-testcall-checklist.md`) bleibt unveraendert offen (kein Testanruf war Teil dieser Phase).
