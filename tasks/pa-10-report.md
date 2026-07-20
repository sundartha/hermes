# Phase PA-10 — Report

**Titel:** `dailySmsCap` fail-open-Fallback durch lauten Guard ersetzen (fail-closed)

**Gate:** PASS
**finalBranch:** `phase/polish-a-p10-fix1`
**headCommit:** `eb28152f55297b684696522f6dcd154b6ffca77a`

---

## 1. Ausgangslage / Ziel

`src/sms-summary.js` (`planSummarySms`) hat die SMS-Tageskappe (Toll-Fraud-Schutz) bisher mit einem stillen Fallback ausgewertet:

```js
if (store.dailySmsCount(call.tenantId, since) >= (config.dailySmsCap ?? 20))
```

Fehlt `config.dailySmsCap` (z.B. bei einem Partial-Config-Aufrufer), wird die Kappe zwar durch den Fallback `20` weiterhin ausgewertet — die eigentliche Kritik ist die **Klasse** Fallback-auf-Zahl bei einer sicherheitsrelevanten Kostenbremse: jede zukuenftige Variante, die den Fallback verliert oder `undefined` durchlaesst, wuerde `count >= undefined` (immer `false`) ergeben und die Kappe **still** umgehen. Ziel von PA-10: dieses Fail-open-Muster durch einen **lauten, fail-closed** Guard ersetzen — lieber ein kontrollierter Throw (der bekanntermassen zu "kein Send" fuehrt) als eine stillschweigend ausgehebelte Kappe.

---

## 2. Plan (gekuerzt)

### 2.0 Kernbefund vorab (Scope-Korrektur ggue. `PLAN-POLISH-A.md`)

Die PA-10-Dateiliste in `PLAN-POLISH-A.md` nannte nur `src/sms-summary.js` + `test/f2-p8-cost-cap.test.js`. Das war unvollstaendig: der geforderte strikte Guard feuert an einer Stelle, die zwei weitere Bestandstests auf dem Send-Pfad erreichen, ohne `dailySmsCap` in ihrer Fixture-Config zu setzen:

- `test/f2-sms-summary-plan.test.js` (Zeile 31: `const cfg = (sendSmsSummary = true) => ({ sendSmsSummary })`)
- `test/f2-p9-dedup-persist.test.js` (Zeile 77: `const cfg = { sendSmsSummary: true }` im Kontroll-Test `before`)

Beide mussten mit-editiert werden (je eine Zeile, `dailySmsCap: 20` ergaenzt), sonst waere die Voll-Suite rot gelaufen — "Voll-Suite gruen" ist eine bindende Phasen-Invariante. Blast-Radius damit: 1 src-Datei + 3 test-Dateien.

### 2.1 Grounding

- `src/sms-summary.js:42`: einziges `?? 20` in `src/`.
- `src/config.js:433`: `dailySmsCap: numEnv("DAILY_SMS_CAP", ..., { fallback: 20, min: 0 })` — `numEnv` ist selbst fail-closed und liefert in Produktion **immer** eine endliche Zahl (unset -> Fallback 20; Muell -> Boot-Refusal via `fatalConfigErrors[]`). Konsequenz: der neue Guard feuert **nie im Live-Betrieb**, er schliesst ausschliesslich die latente Luecke fuer Partial-Config-Aufrufer (Tests/kuenftige Refactors).
- Einziger Produktions-Aufrufer: `src/telephony/call-finish.js:81`, uebergibt das echte `config` (immer numerisch). Der Aufruf steht im aeusseren `try { ... } catch (err) { console.error("[summary]", err.message); }` — ein Throw wird geloggt, crasht den Prozess nicht, und der nachfolgende Sendeblock wird nie erreicht -> **kein Send** (fail-closed, kein unkontrollierter Send).
- `server.js` ist reines Wiring, kein zweiter Aufrufer. Keine `scripts/*.mjs`-Aufrufer.
- `test/helpers.js` `BASE_ENV`: kein `DAILY_SMS_CAP`; da `config.js` nicht angefasst wird, ist keine `BASE_ENV`-Aenderung noetig.

### 2.2 Pre-Mortem (phasenspezifisch)

- **PM-9:** `?? 20` ersatzlos entfernen -> `count >= undefined` (immer false) -> Kappe still umgangen -> SMS-Kostenexplosion. Mitigation: kein straight-remove, sondern lauter Guard **vor** der Cap-Entscheidung + zwei Regressionstests.
- **Kollateral-Risiko:** Guard bricht zwei Bestandstests -> Suite rot -> Phase faelschlich als fertig markiert. Mitigation: Abschnitt 2.0 (Fixture-Configs numerisch machen, verhaltens-erhaltend).
- **Ueberstrenge-Falle:** `Number.isFinite` statt der in der Spec vorgegebenen `typeof`-Pruefung waere eine Abweichung von der Spec gewesen — wurde in Runde 1 als **notwendige Verschaerfung** erkannt (siehe Abschnitt 6).

### 2.3 Geplante Edits

- `src/sms-summary.js`: Guard vor der Cap-Berechnung einziehen (`typeof config.dailySmsCap !== "number" -> throw`), `?? 20` durch nackten `config.dailySmsCap` ersetzen; deutscher Kommentar ohne Umlaute, der die fail-closed-Begruendung dokumentiert.
- `test/f2-p8-cost-cap.test.js`: alten Fallback-Test ersetzen durch zwei Regressionstests (Throw bei fehlendem Cap; Throw bei `smsCount=25` ohne Cap als Beweis, dass die alte Luecke geschlossen ist).
- `test/f2-sms-summary-plan.test.js`: `cfg()`-Fixture um `dailySmsCap: 20` ergaenzen (kollateral, Verhalten unveraendert — `dailySmsCount` im Fake-Store bleibt `0`).
- `test/f2-p9-dedup-persist.test.js`: `cfg`-Objekt im Guard-Test um `dailySmsCap: 20` ergaenzen (kollateral, Verhalten unveraendert).

### 2.4 Deterministische Verifikation (geplant)

1. `node --check src/sms-summary.js` -> exit 0
2. `git grep -n "?? 20" -- src/sms-summary.js` -> keine Treffer
3. `node --test test/f2-p8-cost-cap.test.js test/f2-sms-summary-plan.test.js test/f2-p9-dedup-persist.test.js` -> `# fail 0`
4. Rot-vor-Fix-Beweis (Guard temporaer entfernen, zeigen dass die zwei neuen Tests dann rot fallen; danach wiederherstellen)
5. `npm test` -> volle Suite gruen (Baseline 2362)

---

## 3. Implementierungs-Zusammenfassung

- **headCommit:** `eb28152f55297b684696522f6dcd154b6ffca77a`
- **node --check:** PASS (alle vier Dateien)
- **Tests:** PASS, 2397/0 (initialer Impl-Stand vor Review-Fix; nach Fix-Runde 1: 2399/0 — siehe Abschnitt 6)
- **committed:** ja (lokal, kein Push)

**Geaenderte Dateien:**
- `src/sms-summary.js`
- `test/f2-p8-cost-cap.test.js`
- `test/f2-sms-summary-plan.test.js`
- `test/f2-p9-dedup-persist.test.js`

Keine neuen Dateien.

**Test-Aenderungen:**
- `test/f2-p8-cost-cap.test.js`: alter Fallback-Test ("fehlt config.dailySmsCap -> Fallback 20 greift") ersetzt durch zwei Regressionstests ("config ohne dailySmsCap -> wirft laut" + "smsCount=25 + config ohne Cap -> Guard schliesst die alte fail-open-Luecke").
- `test/f2-sms-summary-plan.test.js`: `cfg()`-Fixture um `dailySmsCap: 20` ergaenzt (kollateral, Verhalten unveraendert).
- `test/f2-p9-dedup-persist.test.js`: `cfg`-Objekt im Guard-Test um `dailySmsCap: 20` ergaenzt (kollateral, Verhalten unveraendert).

**Smoke-Test:** PASS. Server via `test/helpers.js` `startServer()` gebootet (echter Kindprozess, volle `BASE_ENV`, Owner-Nummer geseedet), `GET /healthz` -> 200 `{"ok":true}`. `planSummarySms` wird auf diesem Pfad nicht direkt aufgerufen (nur via `call-finish.js` im echten Call-Ende), aber der Boot mit dem geaenderten `sms-summary.js` im Require-Graph funktioniert einwandfrei.

**Deviations vom Plan:** keine im Impl-Schritt selbst (Diff byte-identisch zum Plan, Abschnitte 4.1-4.4). Die einzige inhaltliche Abweichung entstand erst in der Review-Fix-Runde (Guard-Bedingung verschaerft, siehe Abschnitt 6) — nicht als Impl-Abweichung, sondern als vom Safety-/Clean-Code-Review verlangte Korrektur.

---

## 4. Safety-Urteil (final)

**approved:** true

| Kriterium | Ergebnis |
|---|---|
| testsPassIndependently | true |
| safetyGatesIntact | true |
| disclosureIntact | true |
| authFailClosedIntact | true |
| noSecretsLeaked | true |
| scopeRespected | true |
| behaviorAsIntended | true |

**Unabhaengiger Testlauf:** volle Suite zweimal via `npm test` — beide Laeufe 2399/2399 gruen, 0 fail, 0 skipped. Die drei betroffenen Testdateien isoliert: 24/24 gruen. Die 5 PA-10-Assertions bestaetigt gruen gelaufen: config-ohne-dailySmsCap -> throw, smsCount=25-ohne-Cap -> throw (beweist die alte Luecke geschlossen), dailySmsCap=NaN -> throw, dailySmsCap=Infinity -> throw, plus beide pglite-Roundtrip-Cap-Tests. Beide Store-Backends abgedeckt (json Spawn-Integrationstests + pg/pglite-Direktests inkl. PA-10-Cap-Roundtrip).

**Blockers:** keine.

**Concerns (nicht blockierend):**
- Setup-technisch (kein Code-Defekt): der vorgegebene `ln -s "./node_modules" node_modules` erzeugt einen selbstreferenzierenden Symlink (pglite unaufloesbar, exit 194); wurde auf das reale `node_modules` des Haupt-Worktrees umgebogen, um die Suite laufen zu lassen.
- Minor: die zwei kollateralen Testaenderungen (`f2-p9-dedup-persist`, `f2-sms-summary-plan`) fuegen `dailySmsCap: 20` hinzu — notwendig (da `planSummarySms` ohne numerische Cap jetzt wirft) und verhaltensneutral (Fake-Stores liefern `dailySmsCount` 0 -> Send-Pfad unveraendert), also korrektes Kollateral, kein Scope-Creep.

**Verdict-Text (Kern):** PA-10 ist eng auf die geforderte fail-open -> fail-closed-Haertung der SMS-Toll-Fraud-Tageskappe begrenzt. `src/sms-summary.js` ersetzt den toten `?? 20`-Fallback durch einen lauten Guard mit `Number.isFinite(config.dailySmsCap)` — staerker als die urspruengliche Spec (`typeof`), die eine NaN/Infinity-fail-open-Luecke offen gelassen haette (in Review-Blocker Runde 1 gefunden und gehaertet). Der Wert `20` stammt weiterhin ausschliesslich aus `config.js`/`numEnv` (Fallback 20, unveraendert); der einzige Produktions-Aufrufer (`telephony/call-finish.js`) uebergibt immer das echte Modul-Config, dessen `dailySmsCap` stets endlich ist -> der Throw feuert in Produktion nie (byte-identisches Verhalten fuer alle gueltigen Configs), er ist nur bei einer fehlerhaften/partiellen Config erreichbar — genau die als OQ-5 akzeptierte fail-closed-Aenderung. Der Throw propagiert in den aeusseren Summary-`catch` (Log-and-Return, kein Send) — keine Fail-open-Reintroduktion; der innere `[sms]`-Catch umschliesst nur den eigentlichen Sendevorgang. Der geforderte Test-Umbau ist vorhanden (alter fail-open-Test entfernt; `assert.throws` fuer fehlenden Cap und `smsCount=25`-ohne-Cap-Regression). Kein Safety-Gate entfernt/geschwaecht, `disclosureSentence` (`claude.js`/`bridge.js`) unberuehrt, Auth unberuehrt, kein Secret im Throw/Log, Audio unberuehrt, keine neue npm-Dependency, keine Config-/Env-/Render-Drift. Volle Suite zweimal gruen (2399/2399).

---

## 5. Clean-Code-Audit (final)

**s1:** keine
**s2:** keine
**s3:** keine
**s4:** keine
**blocker:** false

**Verdict:** PASS — keine S1/S2/S3/S4-Verstoesse gefunden. Der Diff (2 Commits: `eb28152` dailySmsCap fail-open->fail-closed, `2a6582c` Review-Blocker Runde 1) ist ein sauberer, minimaler Sicherheits-Fix mit vollstaendiger Testabdeckung.

**passNotes (Kern):** Fail-closed-Guard korrekt verankert: `Number.isFinite(config.dailySmsCap)` ersetzt den in Runde 1 selbst gefundenen Blocker (`typeof !== 'number'` liess NaN/Infinity durch, da `typeof NaN === typeof Infinity === 'number'` -> `count >= NaN/Infinity` waere immer `false` gewesen -> die Toll-Fraud-Tageskappe waere still umgangen worden). Verifiziert: `config.js` `numEnv('DAILY_SMS_CAP', ..., {fallback:20, min:0})` garantiert in jedem Pfad (fehlend/leer -> Fallback 20, geparst -> isFinite-gecheckt, ueber Max -> geclampt) eine endliche Zahl >= 0 -> der neue Throw kann in Produktion nachweislich nie feuern, nur bei unvollstaendigen Test-/Caller-Configs (per grep bestaetigt: die einzige Produktions-Aufrufstelle `src/telephony/call-finish.js` uebergibt immer das volle `src/config.js`-Config). Exception-Message nennt Operation + Fehlergrund (P8 erfuellt). Alle drei betroffenen Bestandstestdateien konsistent auf `dailySmsCap:20` nachgezogen (kein stiller Bruch); 4 neue Regressionstests (fehlend/NaN/Infinity, davon 2 aus Runde 1) beweisen exakt die vorher stille Luecke. Volle Suite lokal gruen: 2399/0 (`node --check` ebenfalls sauber). Keine Duplikation der Fallback-Logik anderswo im Repo (grep ueber `src/`+`test/` negativ). Kommentare aktuell, praezise, ohne Widerspruch zum Code. Funktionslaenge/Verschachtelung unveraendert klein, keine neuen Magic Numbers, keine abgeschalteten Sicherungen.

**topTodos:**
- Kein Blocker, mergefaehig.
- Optional (kein Muss): der lokale Guard prueft nur `Number.isFinite`, nicht `>=0` (min-Grenze wie in `config.js`) — unschaedlich, da ein negativer Wert die Kappe nur enger macht (fail-closed bleibt erhalten), aber fuer Symmetrie mit `numEnv` koennte man es erwaehnen.

---

## 6. Fix-Runden

### Runde 1 (einziger Review-Blocker)

**Befund:** Der urspruengliche fail-closed-Guard in `src/sms-summary.js` (`planSummarySms`) prüfte `typeof config.dailySmsCap !== "number"`. Das faengt **NaN und Infinity nicht ab** — beide sind in JavaScript `typeof "number"`. Ein `dailySmsCap` von `NaN` oder `Infinity` wuerde `store.dailySmsCount(...) >= NaN` bzw. `>= Infinity` ergeben: `>= NaN` ist immer `false`, `>= Infinity` ist praktisch nie erreichbar ab endlichen Ledger-Zaehlern — beide Faelle wuerden die Tageskappe **erneut still umgehen**, genau das Muster, das PA-10 eigentlich schliessen sollte.

**Fix:** Guard-Bedingung von `typeof config.dailySmsCap !== "number"` auf `!Number.isFinite(config.dailySmsCap)` verschaerft. Das deckt zusaetzlich `NaN`, `Infinity` und `-Infinity` ab, waehrend es fuer alle in Produktion tatsaechlich vorkommenden Werte (via `numEnv`, stets eine endliche Zahl) identisch verhaelt.

**Ergaenzte Tests:** zwei zusaetzliche Regressionstests fuer `dailySmsCap = NaN` und `dailySmsCap = Infinity`, beide `assert.throws(...)`.

**Ergebnis nach Fix:** volle Suite 2399/0 gruen, zweite unabhaengige Safety-Verifikation (Abschnitt 4) und finales Clean-Code-Audit (Abschnitt 5) beide PASS ohne weitere Blocker. Keine weiteren Fix-Runden noetig.

---

## 7. Gesamtstatus

**Gate: PASS.** Phase PA-10 ist abgeschlossen: fail-open-Fallback (`?? 20`) in `src/sms-summary.js` durch einen lauten, fail-closed Guard (`Number.isFinite`-basiert nach Review-Fix Runde 1) ersetzt. Drei kollaterale Testdateien wurden minimal (je eine Zeile) nachgezogen, um die Voll-Suite gruen zu halten. Safety- und Clean-Code-Review beide ohne offene Blocker. `finalBranch`: `phase/polish-a-p10-fix1`, `headCommit`: `eb28152f55297b684696522f6dcd154b6ffca77a`. Kein Merge/Push in diesem Bericht dokumentiert — das ist Sache des Lead-Agenten.
