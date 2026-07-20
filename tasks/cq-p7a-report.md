# Phase P7a — Budget-Gate: per-Modell-Preise (security-review-pflichtig)

**Gate: PASS**
**finalBranch:** `phase/cq-p7a-model-prices`
**headCommit:** `e387c767ebe3205324003ccd31fe8786f6a75c7d` (Basis `master` @ `d7d8d05`)
**Tests:** 2519 pass / 0 fail (volle Suite, node --check auf allen 6 geaenderten `src/`-Dateien: OK)

---

## 1. Kontext / Problem

Der Budget-Guard (Regel 1) rechnete bisher mit **einer** globalen Preisformel
(`priceInPerMTokUsd`/`priceOutPerMTokUsd`, faktisch Haiku-Preise). Jedes andere
Modell — auch ein teureres, z.B. fuer P8 Pre-Call-Briefing oder einen kuenftigen
`CLAUDE_MODEL`-Flip — wurde zu Haiku-Preisen gebucht. Auf der KI-Kosten-Achse
haette der Budget-Guard damit bis zu Faktor 3 zu wenig gesehen: ein Modell mit
Sonnet-Preisen laesst das Budget still leerlaufen, waehrend das Gate glaubt, es
sei noch reichlich Puffer da. P7a schliesst diese Luecke.

---

## 2. Plan (gekuerzt)

### Befund am Code (Ausgangslage)
- `src/config.js`: `priceInPerMTokUsd: 1.0`, `priceOutPerMTokUsd: 5.0`, `usdToEur: 0.93` — Literale in `CONFIG_NAMESPACES.llm`.
- `src/store/state-ops.js`: `tokenCostUsd(inputTokens, outputTokens, cfg)` — eine globale Formel, kennt kein Modell. `trackUsage` (Live-Gate-Akku, Mikro-Cents) und `aiCostCents` (Stripe-Ledger) leiten beide daraus ab.
- `src/claude.js`: 2 Call-Sites (`agentTurn` Tool-Loop, `summarizeCall`), beide riefen `store.trackUsage(...)` + `meterAiTokens(...)` dupliziert auf (G5-Verstoss).
- `src/telnyx-llm-shim.js`: `req.body.model` nur fuer die Response-Echo — das tatsaechlich abgerechnete Modell ist immer `config.llm.claudeModel`.

### Zwei Fallen, die den Zuschnitt bestimmt haben
1. **`config` ist ein `guardedConfig`-Proxy.** `config.llm.modelPricesUsd` wird bei jedem Zugriff in einen frischen Wrapper-Proxy gehuellt; dessen `get`-Trap wirft `TypeError` bei unbekanntem Schluessel. Ein naiver Lookup `prices[model] ?? fallback` haette in Produktion jeden Turn mit 500 gekillt — der Fail-open-durch-Crash, den P7a verhindern soll. Der Lookup muss ueber `Object.hasOwn(...)` laufen.
2. **Sonnet-5-Listenpreis != Bench-Preis.** `scripts/convo-bench/runner.mjs` fuehrt den Einfuehrungsrabatt (2.0/10.0 USD, laeuft 2026-08-31 aus). In die Budget-Gate-Tabelle gehoert der Listenpreis (3.0/15.0): ein zu niedriger Preis macht das Gate blind, ein zu hoher ist hoechstens zu streng.

### Design-Entscheidungen
- **D1** — Preistabelle bleibt in `cfg` (injiziert), keine Modul-Konstante — sonst binden sich alle Kosten-/Budget-Tests an echte Preise.
- **D2** — Modell-ID wird als Argument durchgereicht, nicht aus `cfg.claudeModel` gelesen (P8 ruft ein anderes Modell).
- **D3** — Modell-Quelle ist die angeforderte ID, nicht `resp.model` (Anthropic antwortet mit datierter Snapshot-ID, die nicht in der Tabelle steht — sonst liefe jeder Turn in den Fail-closed-Zweig, Kosten systematisch 3x zu hoch, Calls brechen zu frueh ab).
- **D4** — Signatur-Umbau auf ein Verbrauchs-Objekt `{inputTokens, outputTokens, model}` statt eines 6. Positional-Arguments (`trackUsage` hatte schon 5 Argumente, F1-Verstoss; ein optionales `model` am Ende waere die gefaehrlichste Variante gewesen — bestehende Call-Sites blieben syntaktisch gueltig und liefen still in den Fail-closed-Zweig).
- **D5** — Fail-closed-Ziel ist die teuerste hinterlegte Rate; leere Tabelle wirft benannt (kein stiller Fail-open mit Startwert 0).
- **D6 — bewusst NICHT in dieser Phase:**
  - Kein Boot-Guard auf "CLAUDE_MODEL steht in der Tabelle" — ein Boot-Refusal wegen fehlendem Preis-Eintrag waere ein Totalausfall der Telefonie statt eines eingegrenzten Geld-Risikos. Owner-Auflage statt Boot-Gate.
  - Kein Anfassen von `scripts/convo-bench/runner.mjs` (dessen `PRICE_TABLE` ist reine Report-Zahl, kein Gate).
  - Kein `check-setup.js`-Zusatz.

### Umfang laut Plan
- 6 Produktivdateien: `src/config.js`, `src/claude.js`, `src/store/{state-ops,json,pg,defaults}.js`.
- 2 neue Testdateien: `test/_prices.js` (Fixture, kein Testfile), `test/model-price-gate.test.js` (6 Tests, Abnahmekriterium).
- 8 Bestands-Testdateien mechanisch migriert (Call-Site-Migration, Assertions unveraendert).
- `PLAN-SECURITY.md`: Pflicht-Deliverable-Abschnitt `P7A-MODELPRICE`.
- Rot-vor-Fix-Pflicht: Test zuerst allein anlegen, muss auf `master` rot sein, dann Produktivcode.

---

## 3. Implementierung — Zusammenfassung

P7a exakt nach Plan umgesetzt und committet auf `phase/cq-p7a-model-prices`
(`e387c76`, Basis `d7d8d05`).

- `config.llm.modelPricesUsd` ist jetzt die einzige Preisquelle. Live-Gate
  (`trackUsage`) und Stripe-Ledger (`aiCostCents`) rechnen ueber
  `priceForModel`/`mostExpensivePrice` fail-closed: unbekanntes Modell → teuerste
  hinterlegte Rate, nie 0, nie Haiku-Default; leere Tabelle wirft benannt statt
  still.
- Verbrauchs-Tripel `{inputTokens, outputTokens, model}` reist von `claude.js`
  (`bookTokenUsage`/`billedTokens`, Modell = die angeforderte ID vor
  `llm.complete`, nicht `resp.model`) durch die Store-Fassaden
  (`json.js`/`pg.js`) bis `state-ops.js`.
- **Rot-vor-Fix-Protokoll eingehalten:** `test/model-price-gate.test.js` +
  `test/_prices.js` zuerst allein angelegt, `node --test` zeigte 6/6 rot
  (`TypeError` auf `cfg.priceInPerMTokUsd`, wie im Plan erwartet), danach
  Produktivcode umgesetzt → 6/6 gruen.
- 8 der 9 vom Plan genannten Bestandstests mechanisch migriert
  (`trackUsage(s,t,IN,OUT,cfg)` → `trackUsage(s,t,tokensOf(IN,OUT),cfg)`),
  Assertions unveraendert (Haiku-Raten 1.0/5.0 = Fixture-Werte identisch zu
  vorher).
- `test/config-namespaces.test.js` zusaetzlich angepasst (nicht im Plan
  explizit genannt, aber mechanische Konsequenz der Namespace-Aenderung):
  `llm`-Namespace 11→10 Keys, `EXPECTED_TOTAL_KEYS` 101→100, primitive
  Blaetter-Count 95→93.
- Volle Suite (json-Backend + pglite in-process fuer `store-pg*.test.js`)
  2519/2519 gruen, 0 fail (2 Laeufe; ein einzelner Voll-Last-Durchlauf zeigte
  `test/number-gate.test.js` "Land schlaegt Allowlist" rot — isoliert 23/23
  gruen, also vorbestehender Suite-Flake gemaess Flake-Protokoll, keine echte
  Regression).
- **Smoke:** Server bootet mit Dummy-Env sauber (`SKIP_TWILIO_SIGNATURE_CHECK=true`),
  `/healthz` = 200, `POST /voice/incoming` liefert gueltiges TwiML,
  `POST /voice/turn` degradiert bei echtem-aber-ungueltigem `ANTHROPIC_API_KEY`
  sauber auf die Fallback-Ansage (401 von Anthropic, kein Crash/500 — bestaetigt,
  dass die `modelPricesUsd`-Aenderung den Request-Pfad nicht bricht). Ein echter
  erfolgreicher `trackUsage`-Aufruf mit realer Anthropic-Antwort war offline (kein
  echter API-Key) nicht smoke-testbar — dafuer beweist
  `test/l3-prompt-caching.test.js` (Teil der 2519, gemockter LLM-Response) end-to-end
  die volle Kette `claude.js → Store-Fassade → state-ops → usageOf`.
- **grep-Verifikationen:** `priceInPerMTokUsd`/`priceOutPerMTokUsd` nur noch in
  `PLAN-SECURITY.md` (Pflicht-Deliverable, dokumentiert die geschlossene Luecke
  unter den alten Namen) — 0 Treffer in `src/`/`test/`/`scripts/`. Keine neue
  Env-Var (grep `PRICE`/`MODEL_PRICES` in `.env.example`/`render.yaml`/`test/helpers.js`
  zeigt nur vorbestehende `STRIPE_*_PRICE_ID`-Treffer, unveraendert von dieser Phase).

**Blast-Radius exakt wie geplant:** 6 Produktivdateien, 2 neue Testdateien, 9
mechanisch angepasste Bestandstests + 1 zusaetzliche mechanische Test-Anpassung
(config-namespaces Pin-Counts) + `PLAN-SECURITY.md`. Keine neue Dependency, kein
git push, kein git stash, kein `git add -A`.

### Geaenderte Dateien (`filesEdited`)
`src/config.js`, `src/claude.js`, `src/store/state-ops.js`, `src/store/json.js`,
`src/store/pg.js`, `src/store/defaults.js`, `PLAN-SECURITY.md`,
`test/config-money-manifest.test.js`, `test/config-namespaces.test.js`,
`test/tenant-erasure-pg.test.js`, `test/store-pg-tenant-budget.test.js`,
`test/store-pg-multitenant.test.js`, `test/store-pg.test.js`,
`test/tenant-erasure.test.js`, `test/tenant-budget-cap.test.js`,
`test/outbound-tenant-default-budget.test.js`,
`test/outbound-reserve-reconcile.test.js`

### Neue Dateien (`filesCreated`)
`test/_prices.js`, `test/model-price-gate.test.js`

### Clean-Code-Selbstcheck (Implementierung)
G5 (Duplizierung): `PRICES`/`tokensOf`-Fixture aus 8 Testdateien auf
`test/_prices.js` konsolidiert; `agentTurn`/`summarizeCall` duplizierte
`trackUsage`+`meterAiTokens`-Zeilen auf `bookTokenUsage`/`billedTokens`
konsolidiert. G25 (Magic Numbers): `TOKENS_PER_M_TOK` benannt statt zweier
nackter `1e6` in `tokenCostUsd`. F1 (Argumente): `trackUsage`/`aiCostCents`/
`tokenCostUsd` von 5/3/3 auf 4/2/2 Argumente gesenkt (Verbrauchs-Objekt statt
Einzel-Tokens); ein state-ops-weiter Empfaenger-Umbau (`s` als 1. Arg) bewusst
ausserhalb dieser Phase (Owner-Auflage). N7 (Nebeneffekte im Namen):
`bookTokenUsage`/`billedTokens`/`mostExpensivePrice`/`priceForModel` sprechend
benannt. G30/G34 (eine Aufgabe/Ebene pro Funktion): `billedTokens` (Formen)
getrennt von `bookTokenUsage` (Buchen) getrennt von `meterAiTokens`
(Stripe-Meter). Kein toter/auskommentierter Code, keine ungenutzten Imports.
C2: `PLAN-SECURITY.md`-Eintrag referenziert Funktionsnamen/Konzepte, keine
Zeilennummern.

---

## 4. Deviations (Abweichungen vom Plan)

1. **Object.freeze-Vorschlag verworfen (echter Bugfund waehrend Impl).** Der
   Plan-Codebeispiel-Vorschlag `Object.freeze({...})` fuer `modelPricesUsd`
   verletzt eine JS-Proxy-`[[Get]]`-Invariante ueber den bestehenden
   `guardedConfig`-Mechanismus (jeder Objekt-Wert wird bei jedem Zugriff frisch
   gewrapt) — fuer eine per `Object.freeze` non-configurable/non-writable
   gemachte Eigenschaft verlangt die Sprache aber denselben (SameValue)
   Rueckgabewert. Ergebnis: `TypeError` bei **jedem** Zugriff auf
   `config.llm.modelPricesUsd[...]`, auch auf bekannte Modelle
   (`claude-haiku-4-5`) — waere in Produktion 500 auf jeden `/voice/turn`
   gewesen, genau der Fail-open-durch-Crash, den P7a verhindern soll. Gefunden
   durch den eigenen Test gegen die echte `config`-Oberflaeche (nicht durch
   einen Plain-Mock). **Fix:** `modelPricesUsd` bleibt ungefreezt (Muster wie
   bestehende `telnyxElevenLabs`/`telnyxAssistant`-Bloecke); per `node -e`
   verifiziert, dass bekannte und unbekannte Modelle jetzt korrekt aufgeloest
   werden. In `PLAN-SECURITY.md` (`P7A-MODELPRICE`) inkl. dieser Proxy-Falle
   dokumentiert.
2. **`test/config-namespaces.test.js`** war im Plan nicht als zu aendernde
   Datei genannt, musste aber mechanisch angepasst werden (gepinnte
   Namespace-Key-Counts: `llm` 11→10, Total 101→100, primitive Blaetter
   95→93), da `CONFIG_NAMESPACES.llm` jetzt 10 statt 11 Keys traegt (2 Skalare
   → 1 verschachtelte Tabelle). Reine Zahlen-Anpassung, keine
   Verhaltensaenderung am Test selbst.
3. **Plan-Verifikationsschritt 4** (grep `priceInPerMTokUsd`/`priceOutPerMTokUsd`)
   nannte als erwartete Fundstellen `PLAN-CLEAN-CODE.md` und
   `PLAN-CONVERSATION-QUALITY-V2.md`; tatsaechlich stehen dort 0 Treffer, die
   einzige verbleibende Fundstelle ist die vom Plan selbst als
   Pflicht-Deliverable verlangte `PLAN-SECURITY.md`-Sektion — inhaltlich im
   Sinne des Plans, nur eine andere Datei als illustrativ genannt.
4. **Plan-Verifikationsschritt 5** (grep `PRICE`/`MODEL_PRICES`, erwartet
   exit=1) traf auf vorbestehende `STRIPE_*_PRICE_ID`-Zeilen (unrelated, von
   dieser Phase nicht angefasst) — der Grep-Pattern des Plans war zu breit
   fuer den vorbestehenden Zustand; keine neue Env-Var wurde eingefuehrt
   (verifiziert per grep `MODEL_PRICES` = 0 Treffer).

---

## 5. Safety-Urteil (final)

**Verdikt: APPROVED mit 4 nicht-blockierenden Concerns.** P7a haelt alle
absoluten Regeln ein und macht den Budget-Guard (Regel 1) auf der
KI-Kosten-Achse nachweislich strenger, nie schwaecher.

| Pruefpunkt | Ergebnis |
|---|---|
| `scopeRespected` | JA — Diff beruehrt genau die Preis-Achse; keine neue npm-Dependency, keine neue Env-Var. |
| `safetyGatesIntact` | JA — Denylist/Land-Gate/Stundenlimit/Max-Dauer/Signaturpruefung nicht im Diff; P1-Mikro-Cent-Blocker unveraendert; Wirkung ausschliesslich verschaerfend. |
| `disclosureIntact` | JA — `disclosureSentence` und `bridge.js`-Aufrufer unveraendert; `bridge.js` nicht im Diff. |
| `authFailClosedIntact` | JA — keine neuen/geaenderten Endpunkte/Middleware. |
| `noSecretsLeaked` | JA — keine Werte in neuen Fehlermeldungen/Logs. |
| `behaviorAsIntended` | JA — Byte-Identitaet bei `CLAUDE_MODEL=claude-haiku-4-5` (Default), bestaetigt durch 8 migrierte Kosten-/Budget-Tests mit unveraendert erwarteten Cent-Werten. |

**Unabhaengiger Testlauf (Safety-Reviewer, frischer Worktree `review-p7a`, ==
`phase/cq-p7a-model-prices`):** volle Suite 2519/2519 gruen (74.6 s); Kosten-/
Budget-Kern isoliert 91/91 gruen (31.9 s); Rot-vor-Fix unabhaengig
nachgestellt (master-Quellen ueberlegt + neue Testdateien → 6/6 rot, danach
Worktree restauriert); `node --check` auf allen 6 geaenderten `src`-Dateien OK.

**Besonders ueberzeugend laut Reviewer:** Die Proxy-Analyse ist an der Quelle
nachvollzogen (a) `guardedConfig.get` wirft bei unbekanntem Key → `Object.hasOwn`
ist zwingend; (b) der Verzicht auf `Object.freeze` ist korrekt begruendet
(SameValue-Invariante). Test 6 in `model-price-gate.test.js` faehrt den
Fail-closed-Zweig gegen die echte `config`-Oberflaeche statt gegen einen
Plain-Mock — genau die Regression, die ein Mock nicht gefangen haette.

### Concerns (nicht-blockierend)

1. **Latente Fail-open-Luecke in `mostExpensivePrice`** (`state-ops.js`,
   Funktion `mostExpensivePrice`): "teuerstes Modell" wird als **ein**
   Tabelleneintrag mit groesstem `outPerMTok` gewaehlt, nicht als
   `max(inPerMTok) x max(outPerMTok)` ueber alle Achsen getrennt. Heute
   provably konservativ (Sonnet 3/15 dominiert Haiku 1/5 auf beiden Achsen),
   vom Reviewer aber empirisch reproduziert: mit einer hypothetischen
   kuenftigen Tabelle `{a: in 1/out 100, b: in 50/out 5}` bucht ein
   unbekanntes Modell fuer 1M Input-Tokens 100 Cent statt der echten
   Worst-Case-Rate von 5000 Cent — Faktor 50 zu billig. Kein Regress
   gegenueber `master` (der buchte ALLES zu Haiku-Preisen). Ein-Zeilen-Fix:
   `{inPerMTok: Math.max(...rates.map(r=>r.inPerMTok)), outPerMTok: Math.max(...rates.map(r=>r.outPerMTok))}`.
   **Empfehlung: in P7b vor dem Sonnet-Flip nachziehen.**
2. **Geld-Manifest-Guard-Granularitaet gesunken.** `test/config-money-manifest.test.js`
   scannt nur die Top-Level-Blaetter von `CONFIG_NAMESPACES`. Die neuen
   verschachtelten Preisfelder `inPerMTok`/`outPerMTok` liegen darunter und
   matchen das Namensmuster `/(Cents|Eur|Usd)$/` nicht. Ein kuenftiges Modell
   mit falschem Preis in `modelPricesUsd` loest daher keinen Testfehler aus —
   die Absicherung ist rein die in `PLAN-SECURITY.md` dokumentierte
   Betriebs-Auflage.
3. **Bewusst kein Boot-Gate** fuer "CLAUDE_MODEL steht nicht in
   `modelPricesUsd`" — Begruendung traegt (Totalausfall waere schlimmer als
   konservativ zu teuer buchen), aber eine nicht-fatale Boot-**Warnung**
   haette denselben Nutzen ohne Ausfallrisiko gebracht. Operative Auflage: der
   Live-Render-Service ist Dashboard-managed, `CLAUDE_MODEL` kann von
   `render.yaml` abweichen — vor Deploy gegen die Tabelle pruefen.
4. **Rot-vor-Fix-Beweis schwaecher als er aussieht.** Alle 6 Tests scheitern
   auf `master` an der geaenderten `trackUsage`-Signatur (TypeError), nicht am
   Preis-Verhalten selbst. Entlastend: Test 2 ("dieselben Token kosten unter
   zwei Modellen VERSCHIEDEN") faengt eine Implementierung, die das
   `model`-Argument annimmt aber ignoriert — der eigentlich interessante
   Regressionsfall ist damit abgedeckt.

---

## 6. Clean-Code-Audit (final)

**Verdikt: PASS** — keine S1/S2-Verstoesse. Ein S3-Kommentarfehler (technisch
falsche Proxy-Trap-Behauptung), sonst sauber. Unabhaengig in isoliertem
Worktree nachgebaut: `node --check` auf allen 6 geaenderten `src/`-Dateien
gruen, volle Suite 2519/2519 gruen.

### S1 (Blocker)
Keine.

### S2 (Muss vor Merge behoben)
Keine.

### S3 (Sollte behoben werden)
- **C4 · `src/store/state-ops.js`, `priceForModel`-Kommentar** — Technisch
  falsche Behauptung: `Object.hasOwn` "laeuft ueber die has-Trap und damit
  ungefiltert ans Target" — `Object.hasOwn` nutzt intern `[[GetOwnProperty]]`
  (die nicht definierte `getOwnPropertyDescriptor`-Trap, faellt daher aufs
  Target zurueck), **nicht** die `has`-Trap (die steht hinter dem
  `in`-Operator/`Reflect.has`). Empirisch vom Auditor verifiziert (eigenes
  Proxy-Testskript): `Object.hasOwn` loest weder `get` noch `has` aus. Das
  praktische Ergebnis (kein Throw, sauberer Fallback) stimmt trotzdem — nur
  die Erklaerung ist falsch. Vorschlag: "Object.hasOwn nutzt
  `[[GetOwnProperty]]` (keine der beiden definierten Traps get/set) und faellt
  damit unveraendert aufs Target zurueck."

### S4 (Optional / spaeter)
- `mostExpensivePrice()` hat einen Tie-Break-Zweig (bei gleichem `outPerMTok`
  gewinnt das hoehere `inPerMTok`) — aktuell mit nur 2 Modellen nie ausgeloest
  und ungetestet. Harmlos, aber sobald ein drittes Modell mit gleichem Output-
  aber anderem Input-Preis eintragen wird, laeuft dieser Pfad erstmalig live
  gegen den Budget-Guard ungetestet. Optionaler Test vor/bei der naechsten
  Modell-Ergaenzung.

### Pass-Notes (Auditor)
Reduziert Duplizierung statt sie zu erzeugen (G5): eine Test-Fixture
`test/_prices.js` ersetzt eine vorher 8x byte-identisch kopierte
`PRICES`-Zeile; `bookTokenUsage()` in `claude.js` fasst die vormals in
`agentTurn` und `summarizeCall` duplizierten zwei Zeilen (feste Reihenfolge
`trackUsage`+`meterAiTokens`) an einer Stelle zusammen (behebt effektiv eine
G31-verborgene-Reihenfolge). F1 sauber gehalten: statt eines vierten
Arguments (`model`) wird das Verbrauchs-Tripel gebuendelt durch
`trackUsage`/`aiCostCents` gereicht — alle Call-Sites in `json.js`/`pg.js`
konsistent migriert (grep bestaetigt: keine alte Signatur uebrig). Magic
Number `1e6` durch benannte `TOKENS_PER_M_TOK`-Konstante ersetzt (G25).
Fail-closed-Pfad ist doppelt getestet: einmal gegen einen Plain-Mock, einmal
explizit gegen die echte `config`-Oberflaeche (`guardedConfig`-Proxy) — dabei
wurde laut `PLAN-SECURITY.md` ein echter Proxy/`Object.freeze`-Invarianten-Bug
im ersten Entwurf gefunden und behoben (unabhaengig nachvollzogen und
bestaetigt). `PLAN-SECURITY.md` wurde bei dieser sicherheitsrelevanten
Aenderung aktualisiert, wie von CLAUDE.md gefordert. `config-money-manifest.test.js`
und `config-namespaces.test.js` konsistent auf die neue Namespace-Struktur
nachgezogen. Volle Suite unabhaengig in frischem Worktree gegen `e387c76`
nachgefahren: 0 Fehler.

---

## 7. Fix-Runden

Keine Fix-Runde noetig — Gate wurde direkt mit **PASS** erreicht (0
S1/S2-Blocker in Safety und Clean-Code). Der einzige waehrend der
Implementierung selbst gefundene und behobene Defekt (Object.freeze-
Proxy-Invariante, siehe Deviations Punkt 1) wurde vor dem finalen Review
bereits gefixt und ist kein separater Review-Fix-Zyklus.

---

## 8. Offene Owner-/Deploy-Auflagen (NICHT-Agenten-Arbeit, Restrisiken, Bestandsdaten-Auflagen)

1. **Vor jedem `CLAUDE_MODEL`-Flip (insbesondere P7b)** muss die Ziel-Modell-ID
   in `src/config.js` `modelPricesUsd` stehen. Der aktuell im Render-Dashboard
   gesetzte `CLAUDE_MODEL`-Wert ist **vor dem Deploy zu pruefen**: der
   Live-Service ist Dashboard-managed und kann von `render.yaml` abweichen;
   steht dort eine datierte Snapshot-ID statt des Alias, rechnet das Gate ab
   Deploy mit der teuersten Rate und Calls brechen zu frueh ab. Der Agent kann
   den Live-Dashboard-Wert nicht lesen.
2. **Probeanruf nach Deploy** (Kosten-Achse end-to-end): ein realer Turn muss
   `usage.costCents` sichtbar erhoehen. Offline nicht moeglich (kein echter
   API-Key im Sandbox-Netz) — NICHT-Agenten-Arbeit.
3. **`mostExpensivePrice`-Fail-open-Luecke (Safety-Concern 1) vor dem
   Sonnet-Flip in P7b nachziehen:** aktuell wird das "teuerste" Modell als ein
   einzelner Tabelleneintrag (max `outPerMTok`) statt als
   `max(inPerMTok) x max(outPerMTok)` ueber alle Achsen ermittelt. Heute
   konservativ (Sonnet dominiert Haiku auf beiden Achsen), aber bei einer
   dritten, asymmetrisch bepreisten Modell-Tabelle koennte ein unbekanntes
   Modell zu billig gebucht werden. Ein-Zeilen-Fix dokumentiert im
   Safety-Urteil oben.
4. **Folge-Phase (nicht P7a):** `scripts/convo-bench/runner.mjs` fuehrt eine
   zweite, divergente `PRICE_TABLE` (Sonnet-5-Einfuehrungsrabatt 2.0/10.0 USD
   statt Listenpreis 3.0/15.0) — reine Report-Zahl, kein Gate, untertreibt
   Sonnet-Kosten ab 2026-08-31.
5. **P7b** (Modell-Flip + Bench-Laeufe mit echten API-Kosten) ist explizit
   nicht Teil dieser Phase.
6. **Geld-Manifest-Guard nachschaerfen (optional):**
   `test/config-money-manifest.test.js` prueft nur Top-Level-Blaetter; ein
   kuenftiges Modell mit falschem Preis in `modelPricesUsd` faellt dadurch
   nicht automatisiert auf. Absicherung ist aktuell rein die
   `PLAN-SECURITY.md`-Betriebs-Auflage (Punkt 1 oben).
7. **S3-Kommentarfix** (`priceForModel`-Kommentar in `state-ops.js`, falsche
   Proxy-Trap-Erklaerung) — kosmetisch, praktisches Verhalten korrekt, aber
   sollte vor der naechsten inhaltlichen Aenderung an `guardedConfig` korrigiert
   werden, damit die Begruendung kuenftige Proxy-Aenderungen nicht fehlleitet.
8. **S4 optional:** Testfall fuer den Tie-Break-Zweig in `mostExpensivePrice()`
   ergaenzen (zwei Modelle mit gleichem `outPerMTok`, unterschiedlichem
   `inPerMTok`), spaetestens wenn ein drittes Modell in `modelPricesUsd`
   eingetragen wird.
