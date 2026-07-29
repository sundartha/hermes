# AL-P2 — SSE-Spike (Detailbericht)

**Titel:** AL-P2 SSE-Spike: konsumiert Telnyx inkrementell (NUR Code + Messwerkzeug, KEINE Infrastruktur anfassen)
**Gate:** PASS
**finalBranch:** `phase/al-p2-sse-spike`
**headCommit:** `197595f` (Worktree-Angabe im Impl-Report enthielt ein Tippzeichen zu viel — 40-Zeichen-SHA beginnt mit `197595f`)
**Basis:** `master` = `7b70383`

---

## 1. Plan (gekuerzt)

### Scope-Abgrenzung

| liefert | liefert NICHT |
|---|---|
| Verzoegerungs-Schalter im Shim (`src/telnyx-llm-shim.js`), streng auf EINE Wegwerf-Zielnummer eingegrenzt | keinen Telnyx-Assistant, keine Connection/TeXML-App, kein Umhaengen von DIDs |
| 2 neue Env-Vars an den 4 Pflichtorten + `productionFootguns`-Sperre + Boot-Banner-Sonde | keinen Deploy, keinen `upstream`-Push, kein Flag-Flip |
| Urteils-Funktion + CLI-Flag im Bestandsskript `scripts/telnyx-call-latency.mjs` | keine neue Route, kein neues MCP-Tool, keine neue Dependency |
| 20 automatisierte Tests, Owner-Protokoll in `tasks/al-testcall-checklist.md`, `PLAN-SECURITY.md`-Eintrag | keine Messung (die braucht 2 echte Anrufe = Owner) |

**Gate-Bilanz:** kein Safety-Gate beruehrt, Offenlegungssatz unangetastet, keine Auth-Kante veraendert. Der Schalter kann keinen Call ausloesen, keine SMS senden, kein Geld bewegen — nur EINE laufende Antwort an eine namentlich konfigurierte Nummer spaeter beenden.

### Pre-Mortem (Kernpunkte)

- **Dead-Air-Risiko:** Schalter greift nur bei `call.to === TELNYX_SSE_SPIKE_CALLEE` — ohne gesetzte Nummer wirkungslos.
- **Schalter bleibt unbemerkt im Prod-Pfad:** drei Sonden — `productionFootguns`-Boot-Refusal (Delay>0 ohne Callee), Boot-Banner-Zeile, `console.warn` je verzoegerter Antwort.
- **Kosten-Notaus wird mitverzoegert:** Rate-Gate, Budget-Kill, Loop-Guard, Degradations-Catch uebergeben ausdruecklich `pause: null`.
- **Spike misst nichts, weil erster SSE-Chunk textlos ist:** Abweichung 1 — role-Chunk + erster Satz sofort, Rest verzoegert.
- **Falsches Urteil ohne Totband:** `sseSpikeVerdict` mit vier Zustaenden (`incremental`/`buffered`/`inconclusive`/`no_data`).
- **PII in Logs/Banner:** alle drei Sonden nennen nur Var-Namen/`delayMs`, nie die Rufnummer.

### Zwei bewusste Plan-Abweichungen (vorab benannt)

1. „Erster SSE-Chunk sofort, Rest nach 8s" → umgesetzt als **role-Chunk + erster Satz sofort**, Rest nach der Verzoegerung — weil der heutige erste Chunk textlos ist (`{delta:{role:"assistant"}}`).
2. „Schalter wird am Phasenende ERSATZLOS ENTFERNT" → in dieser Phase **nicht moeglich** (Messung braucht Deploy+Owner, Infrastruktur untersagt). Ersatzregel: `productionFootguns`-Pflichteintrag + Rueckbau-Auftrag in der Checkliste.

### Betroffene Dateien (Plan)

`src/config.js`, `src/boot.js`, `src/telnyx-llm-shim.js`, `src/utils/timer.js`, `scripts/telnyx-call-latency.mjs`, `.env.example`, `render.yaml`, `test/helpers.js`, `test/telnyx-shim-harness.js`, `test/config-namespaces-helper.js`, `test/telnyx-call-latency.test.js`, `PLAN-SECURITY.md`, `tasks/al-testcall-checklist.md`, neu: `test/al-p2-sse-spike.test.js` (17 Tests).

---

## 2. Implementierungs-Zusammenfassung

Der befristete Verzoegerungs-Schalter sitzt im Shim und ist streng auf EINE Wegwerf-Zielnummer eingegrenzt: `sseSpikeDelayMsFor(call, cfg)` liefert nur bei Delay>0 UND Callee gesetzt UND `call.to === callee` einen Wert ungleich 0 — jede andere Konstellation ist byte-identisches Bestandsverhalten. Die vier Notaus-Pfade (Rate-Gate, Budget-Kill, Loop-Guard, Degradations-Catch) uebergeben explizit keine Pause.

Drei unabhaengige Sonden gegen unbemerktes Weiterlaufen:
- `productionFootguns`-Boot-Refusal (Verzoegerung ohne Zielnummer ist im Hosting fatal)
- Boot-Banner-Zeile bei jedem Start
- `sse_spike_delay`-Logzeile bei jeder verzoegerten Antwort

Alle drei PII-frei (nur Var-Namen/`delayMs`, nie die Rufnummer).

Neue Env-Vars `TELNYX_SSE_SPIKE_DELAY_MS` / `TELNYX_SSE_SPIKE_CALLEE` an allen vier Pflichtorten (`config.js`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV); Callee ueber neuen `e164Env`-Validator fail-closed geprueft.

Messwerkzeug `scripts/telnyx-call-latency.mjs` bekam `sseSpikeVerdict` (`incremental`/`buffered`/`inconclusive`/`no_data`) + `--spike-delay-ms`.

20 neue Tests (17 in `test/al-p2-sse-spike.test.js`, 3 im Bestandsfile `test/telnyx-call-latency.test.js`), `PLAN-SECURITY.md`-Abschnitt `AL-P2-SSESPIKE`, Fahr- und Rueckbau-Protokoll in `tasks/al-testcall-checklist.md`.

Keine Infrastruktur angefasst, kein Deploy, kein Flag-Flip, keine neue Dependency, kein Safety-Gate/Auth/Offenlegungssatz beruehrt.

**Ergebnisse:** `node --check` gruen auf allen geaenderten Dateien, `npm test` 3545/0 (Endstand nach Wiederholung des Voll-Last-Flakes), Smoke-Test (Schalter aus/armiert) bestanden, committed.

### Deviations (vom Impl-Agenten gemeldet)

1. **BEFUND (roter Bestandstest, im Plan als moeglich benannt):** `test/config-shape.test.js` „Proxy-Guard: JSON.stringify auf eine Config-Gruppe wirft nicht" wurde rot, weil er das exakte Key-Inventar von `telnyxAssistant` als Fixture mitfuehrt. Fix: zwei neue Keys mit Safe-Defaults ergaenzt, Pruefgegenstand (toJSON-Duck-Typing) unangetastet. Der Nachbartest „telnyxAssistant: alle 10 Keys …" wurde bewusst NICHT angepasst — sein Titel nennt jetzt eine veraltete Zahl (haelt den Rueckbau-Diff klein).
2. **Plan-Abweichung 1** (vorab benannt, wie im Plan beschrieben umgesetzt): role-Chunk + erster Satz sofort statt woertlich „erster Chunk sofort".
3. **Plan-Abweichung 2** (vorab benannt): Schalter wird NICHT ersatzlos entfernt (Messung braucht Deploy+Owner); Ersatzregel via `productionFootguns` + Banner + Log + Rueckbau-Auftrag in der Checkliste umgesetzt.
4. **Voll-Last-Spawn-Flake:** Erster `npm test`-Lauf hatte einen zusaetzlichen roten Test („finishCall bucht Voice-Minuten genau einmal…"), isoliert und im Wiederholungslauf gruen — bekannter Flake, nicht durch diese Phase verursacht. Endstand 3545/0.
5. **Symlink-Problem im Worktree:** `ln -s ./node_modules node_modules` erzeugte einen selbstreferenziellen Symlink (Exit 194); umgangen durch Zeigen auf das reale `node_modules` im Haupt-Repo. Nicht committet (gitignored).

---

## 3. Safety-Urteil (final)

**Verdict: PASS** — freigegeben, mit einer Owner-Abnahme (Spec-Abweichung) und einer empfohlenen Kleinaenderung (Richtungsblindheit).

- `approved: true`, `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`
- Unabhaengiger Review-Lauf: eigener Worktree/Branch, `merge-base == master` (kein stale base), 1 Commit, 15 Dateien, +664/-23, keine Dependency-Aenderung.
- `npm test`: 2 zunaechst rote Tests (Voll-Last-Spawn-Flake, isoliert 5/5 gruen, Wiederholungslauf 3565/3565 gruen). `test:gates`: 528/531, die dokumentierte Basislinie (GAP-05, 2x GAP-15) — kein AL-P2-Bezug.
- Fuenf eigene Sonden gefahren: Draht-Diff master-vs-Branch ueber 7 Pfade byte-identisch bei Default-Config; `splitAtFirstSentence` mit 500 Zufallsstrings verlustfrei; ReDoS-Sonde auf die neue Regex (1 ms bei 250 KB pathologischem Input); Leerzeichen-im-`call.to`-Test (strikte Gleichheit haelt); Inbound-Direction-Test.

### Blocker
Keine.

### Concerns (nicht blockierend, aber festgehalten)

1. **Spec-Abweichung (Owner-Entscheidung noetig):** Der Boot-Refusal greift nur bei der UNSCOPED Form (Delay>0 ohne Callee); mit gesetzter Wegwerf-Nummer bootet der Dienst im Hosting normal mit armiertem Schalter — abweichend vom Plan-Doc-Wortlaut „ersatzlos entfernen". Dokumentiert in `PLAN-SECURITY.md`, Rueckbau als harte Verbindlichkeit in der Checkliste.
2. **Richtungsblindheit:** `sseSpikeDelayMsFor` prueft nur `call.to === callee`, nicht `call.direction`. Bei INBOUND ist `call.to` die eigene DID — waehrend der Schalter armiert ist, verzoegert er auch eingehende Anrufe auf diese Nummer, nicht nur den geplanten Outbound-Testanruf. Empfehlung: `direction === 'outbound'` als vierte Bedingung, oder explizit in die Checkliste schreiben.
3. **Dead-Air-Wechselwirkung ungetestet:** Spike-Pause laeuft ohne Suspendierung des Dead-Air-Timers; bei gesenktem `TELNYX_DEAD_AIR_TIMEOUT_S` waehrend hoher Delay-Sprossen (20/30s) koennte der Watchdog mitten in der Pause terminieren (fail-safe Richtung, aber ungetestet und nicht in der Checkliste erwaehnt).
4. **Farewell-Verschiebung:** bei `endCall=true` + armiertem Spike verschiebt sich das Abschiedsfenster um bis zu 30s (nur Spike-Nummer betroffen, im Report nicht extra benannt).
5. **Laengeres Schreibfenster:** bis zu 30s zwischen erstem Chunk und `[DONE]` — Abbruch durch Telnyx in diesem Fenster wird ueber `ERR_STREAM_DESTROYED`/`uncaughtException` behandelt, kein Prozessabbruch, kein Blocker.
6. **Prettier-Drift:** 3 Zeilen ueber printWidth 100 durch eingefuegtes `await`; war auf master fuer dieselbe Datei aber schon rot, CI faehrt kein `format:check` — kein neuer Gate-Bruch.
7. **Test-Hygiene (klein):** `AL-P2-14` laesst einen Fatal-Eintrag dauerhaft im modulweiten `fatalConfigErrors`-Array stehen — in diesem Repo unschaedlich (ein Prozess je Testdatei), aber eine geladene Falle bei Dateiwachstum.
8. **Umgebung (kein Phasenbefund):** `npx eslint` lief im Worktree nicht (fehlende `@eslint/js`); nur `node --check` als Beleg moeglich.
9. **Deploy-Wahrheit:** `configFingerprint` kennt den Spike nicht — ein armierter Schalter aendert `/healthz`-configHash nicht (bewusst korrekt, aber Sichtbarkeit haengt allein an Banner+Log).

---

## 4. Clean-Code-Audit

**Verdict: PASS.** Keine Blocker.

- **S1 (Sicherheits-/Korrektheitsbefunde):** keine.
- **S2 (substanzielle Struktur-/Wartbarkeitsbefunde):** keine.
- **S3 (kleinere Befunde):** keine von Substanz.
- **S4 (Stil/Nits):** keine von Substanz.

### PassNotes (Kernpunkte)

- Eingrenzung dreifach UND-verknuepft, per Test einzeln belegt (AL-P2-1..4).
- Notaus-Pfade bekommen explizit keine Pause, gegen die Spike-Zielnummer selbst gepinnt (AL-P2-12/13).
- `productionFootguns` verweigert den Boot bei unscoped Konfiguration (AL-P2-15/17, inkl. echtem Spawn-Test).
- PII-Disziplin durchgehend mit eigenem Test belegt (AL-P2-11/14/16).
- Kein neues abgeschaltetes Sicherungsmuster; `e164Env` fail-closed nach dem Muster `numEnv`/`boolEnv`.
- G5 (Duplizierung) explizit gegengeprueft: keine parallelen Definitionsstellen.
- `writeCompletion`/`writeStreamingCompletion` korrekt async gemacht, alle vier Aufrufstellen mit `await` nachgezogen — echte Korrektheitsverbesserung.
- Doku konsistent nachgezogen (`.env.example`, `render.yaml`, `PLAN-SECURITY.md` im Pre-Mortem-Muster, Checkliste mit Rueckbau-Schritt).
- 52/52 gezielt betroffene Tests gruen, `node --check` fehlerfrei auf allen 5 geaenderten src-Dateien.

### Offene ToDos (nicht blockierend)

1. Nach der echten Testcall-Session den vollstaendigen Rueckbau (Schalter, Env-Vars, Footgun, Banner-Zeile, Log-Kanal, AL-P2-Tests) tatsaechlich durchziehen.
2. Volles `npm test` bis zum Ende bestaetigen (zum Berichtszeitpunkt lief es noch, gezielt betroffene Suiten waren bereits gruen).

---

## 5. Fix-Runden

Keine — der Impl-Durchlauf erreichte PASS in Safety und Clean-Code ohne nachtraegliche Fix-Runde. Der einzige waehrend der Implementierung aufgetretene rote Bestandstest (`test/config-shape.test.js`, Proxy-Guard-Fixture) wurde direkt im selben Durchlauf behoben (siehe Deviation 1), nicht als separate Fix-Runde nach einem Review-Fail.
