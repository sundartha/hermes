# Phase P3 — Boot-Guards fuer Konfig-Kohaerenz und Modellpreise

**Gate: PASS**
**finalBranch: `phase/ba-p3-boot-guards-fix1`**
**headCommit: `298be56ba6c5f13d84947f5280cf5fc9546bf32f`**

## 1. Zusammenfassung in einem Satz

P3 fuegt zwei reine, arg-injizierte, config-freie Diagnose-Funktionen (`spendCapCoherence`, `unpricedModels`) an das Ende von `assertBootGates` an, VOR `lifecycle.rearmActiveCallTimers()`: Sie brechen den Boot ausschliesslich dann fatal ab, wenn die Tenant-Budget-Achse gegen den Plattform-Cap **inert** waere (echter Schutzverlust — Budget-Gate wuerde nie mehr greifen); alle anderen Befunde (Sentinel-0, unbezahlbarer Worst-Case, unbepreiste Modelle) bleiben reine WARN-Zeilen, teils mit Audit-Eintrag.

---

## 2. Plan (gekuerzt)

### 2.0 Deploy-Blocker (wichtigste Zeile des Plans)

> Vor dem Deploy von P3 MUSS der Live-Wert von `DEFAULT_TENANT_BUDGET_CENTS` im Render-Dashboard gelesen werden. Ist er `>= 800`, verweigert der Dienst den Boot. Abhilfe: Wert unter 800 setzen ODER `MAX_BUDGET_EUR` anheben (P0).

Begruendung am Code: `config.billing.platformSpendCapCents = eurToCents(MAX_BUDGET_EUR)` — mit dem heutigen Live-Wert `8` sind das 800 Cent. `defaultTenantBudgetCents` hat Code-Fallback `1000`, und `.env.example`/`render.yaml` dokumentierten bislang ebenfalls `1000`. `1000 >= 800` erfuellt die fatale Klausel A. P0 (Anheben von `MAX_BUDGET_EUR`) wurde in dieser Phase bewusst NICHT ausgefuehrt; `MAX_BUDGET_EUR` bleibt ueberall bei `8`.

### 2.1 Verifizierter Code-Stand (Auszug)

- `src/boot-guard.js` (Bestand, 41 Zeilen): importiert nichts, Muster arg-injiziert/config-frei/seiteneffektfrei (`fakeOriginateBootBlocked`, `meterMappingGaps`).
- `assertBootGates(config, store)` in `src/boot.js`: vier Bestands-Gates (`assertConfig` -> `fakeOriginateBootBlocked` -> `hasActiveNumber` -> `meterMappingGaps`), gefolgt (in `bootServer`) von `lifecycle.rearmActiveCallTimers()` und erst danach `app.listen`.
- **Proxy-Beleg (kritisch):** `guardedConfig` in `src/config.js` definiert nur `get`/`set`-Traps; der `get`-Trap wirft `TypeError` fuer jeden Key, der nicht `prop in obj` bzw. in `SAFE_DUCK_TYPING_PROPS` ist, und wrappt jeden Objektwert bei jedem Zugriff neu (deshalb bleibt `modelPricesUsd` ungefreezed). `Object.hasOwn` laeuft ueber `[[GetOwnProperty]]`, das kein Trap definiert — geht also am `get`-Trap vorbei. Ein Roh-Index `prices[model]` haette im Boot-Guard einen `TypeError` geworfen und damit ausgerechnet den Guard zum Boot-Killer gemacht.
- Baseline vor Implementierung: `npm test` -> 2555/2555 gruen (76s); ein erster Lauf zeigte den dokumentierten Voll-Last-Flake in einem unabhaengigen Telnyx-Inbound-Test, Wiederholungslauf gruen.

### 2.2 Die zwei Guard-Funktionen (`src/boot-guard.js`, additiv)

```js
const SECONDS_PER_MINUTE = 60;

export const SPEND_CAP_FINDING = Object.freeze({
  TENANT_DEFAULT_INERT: "tenant_default_inert",      // Klausel A  - FATAL
  TENANT_DEFAULT_UNSET: "tenant_default_unset",      // Klausel A0 - WARN
  WORST_CASE_UNAFFORDABLE: "worst_case_unaffordable" // Klausel B - WARN + Audit
});

export function spendCapCoherence({
  tenantDefaultCents, platformCapCents, maxTariffCents, maxCallDurationS,
})
```

Ein Argument-Objekt (F1), Rueckgabe = Array von Befunden (`[]` = kohaerent, Muster `meterMappingGaps`). Klausel-Reihenfolge, max. Verschachtelungstiefe 1, drei Early-Returns:

| Reihenfolge | Bedingung | Verdikt | `code` |
|---|---|---|---|
| 1 | `tenantDefaultCents === 0` | `fatal: false` | `TENANT_DEFAULT_UNSET` |
| 2 | `tenantDefaultCents >= platformCapCents` | **`fatal: true`** | `TENANT_DEFAULT_INERT` |
| 3 | `maxTariffCents * ceil(maxCallDurationS/60) > tenantDefaultCents` | `fatal: false` | `WORST_CASE_UNAFFORDABLE` |
| — | sonst | `[]` | — |

`>=`, nicht `>` — bei Gleichstand bindet die Tenant-Achse ebenfalls nie. Nachricht enthaelt bei A beide Zahlen und beide Env-Namen plus zwei Abhilfen; bei A0 den Sentinel und die Folge (Fallback auf geteilten Plattform-Cap); bei B die Worst-Case-Reserve in Cent, den Tarif-Namen, die Tenant-Decke und `max_duration_s=<affordableCallDurationS>`.

```js
export function unpricedModels(modelIds, modelPricesUsd) {
  return modelIds.filter((id) => !Object.hasOwn(modelPricesUsd, id));
}
```

Immer WARN, nie fatal — `priceForModel` bucht fail-closed zur teuersten Rate (Ueber-Bepreisung bis 3x), nie Ueber-Ausgabe; ein `exit(1)` taeuschte hier ein Kostenproblem gegen Totalausfall.

### 2.3 Verdrahtung

Zwei neue Modul-Funktionen `assertSpendCapCoherence(config)` (kann `process.exit(1)` bei Klausel-A-Fund, sonst `console.warn` + optionales `audit(...)`) und `warnUnpricedModels(config)` (nur `console.warn`) werden als letzte zwei Zeilen von `assertBootGates` aufgerufen — **nach** `assertConfig()` (Zahlen bereits validiert) und **vor** `lifecycle.rearmActiveCallTimers()` (INV-5 unangetastet). Audit nur fuer Klausel B (`AUDITED_BOOT_FINDINGS = new Set([SPEND_CAP_FINDING.WORST_CASE_UNAFFORDABLE])`) — A0 und unbepreiste Modelle aendern keine Ablehnungs-Entscheidung, daher nur WARN ohne Audit. Geloggt werden ausschliesslich Env-Namen, Cent-/Sekunden-Zahlen und Modell-Alias-IDs — keine Secrets, Nummern, Tenant-IDs.

### 2.4 Kohaerenz der ausgelieferten Beispiel-Konfiguration

`.env.example` und `render.yaml` setzen `DEFAULT_TENANT_BUDGET_CENTS` von `1000` auf `600` (echt kleiner als `MAX_BUDGET_EUR*100=800`; 600 = Minutenwert des Starter-Abos, 30 min * 20 ct). `MAX_BUDGET_EUR` bleibt ueberall unveraendert bei `8`. Nebenwirkung, bewusst akzeptiert: mit 600 gegen Tarif 300 ct und `MAX_CALL_DURATION_CAP_S=300` feuert Klausel B (300*5=1500 > 600) als WARN + Audit, `max_duration_s=120` — korrekt (Auslandsziele unter dieser Decke nicht voll bezahlbar), niemals fatal.

### 2.5 Tests (Plan-Vorgabe)

- `test/spend-cap-coherence.test.js` (neu, rein, ohne Spawn): T-P3-01..09, Wahrheitstabelle inkl. Grenzfall `>=` (T-P3-02), Sentinel 0 (T-P3-04), Worst-Case-Rechenprobe mit `max_duration_s=120` (T-P3-05), sowie der Proxy-Kontrast-Test T-P3-09 gegen den echten `guardedConfig`.
- `test/boot-failclosed.test.js` (Spawn, angehaengt): T-P3-10 (Boot-Refusal-Beweis, rot vor Fix), T-P3-11 (Merge-Gate mit BASE_ENV-gepinnten Werten, genau eine A0-WARN-Zeile), T-P3-12 (ausgelieferte Beispiel-Konfig bootet, Klausel-B-WARN + Audit-Zeile).
- T-P3-13 (im Plan optional/streichbar): Datei-Read von `.env.example`/`render.yaml` durch `spendCapCoherence`, verhindert stille Rueckkehr des behobenen Defekts.

### 2.6 Blast-Radius (Plan)

Geplante 6 Dateien: `src/boot-guard.js` (additiv), `src/boot.js`, `.env.example`, `render.yaml`, `test/spend-cap-coherence.test.js` (neu), `test/boot-failclosed.test.js`. Nicht angefasst laut Plan: `src/config.js`, `src/store/state-ops.js`, `src/telephony/outbound-gates.js`, `test/helpers.js`.

---

## 3. Impl-Zusammenfassung

Umsetzung folgt dem Plan praezise:

- **Zwei reine Funktionen** in `src/boot-guard.js`: `spendCapCoherence({tenantDefaultCents, platformCapCents, maxTariffCents, maxCallDurationS})` und `unpricedModels(modelIds, modelPricesUsd)`. `Object.hasOwn` zwingend (nicht Roh-Index) — Boot-Killer-Vermeidung gegen den echten Proxy, per Kontrast-Assertion in T-P3-09 bewiesen.
- **Verdrahtung** ans Ende von `assertBootGates()` in `src/boot.js`, nach `assertConfig()`, vor `lifecycle.rearmActiveCallTimers()` — per Code-Lesen bestaetigt (`assertBootGates` bei Zeile 187, `rearmActiveCallTimers` bei Zeile 198).
- **Klausel A implementiert exakt** die geforderte `>=`-Grenze (Grenzfalltest T-P3-02 pinnt das), bleibt fatal, obwohl das die (ohne Dashboard-Korrektur) aktuelle Live-Konfiguration triggern wuerde — siehe Deploy-Blocker.
- **Klausel A0 bleibt bewusst WARN**, nie fatal, wie explizit gefordert.
- Suite: **2569/2569 gruen** auf zwei vollen Laeufen (2555 Baseline + 14 neu). Ein einzelner Lauf zeigte den dokumentierten ~12%-Voll-Last-Flake in einem unabhaengigen Test (Owner-Originate-Timing) — isoliert sofort gruen, Wiederholungslauf komplett gruen (Gate-Protokoll: rot nur echt, wenn isoliert rot).

### Deviations gegenueber dem Plan

1. **Deploy-Blocker (woertlich uebernommen):** vor dem Deploy MUSS der Live-Wert von `DEFAULT_TENANT_BUDGET_CENTS` im Render-Dashboard gelesen werden. Ist er `>= 800`, verweigert der Dienst den Boot. Abhilfe: Wert unter 800 setzen ODER `MAX_BUDGET_EUR` anheben (P0). Aus dem Repo nicht ermittelbar (Dashboard-managed, `render.yaml` ist nur Doku). Phase ist **merge-fertig, nicht deploy-fertig** ohne diesen Handgriff — Eintrag gehoert in `PLAN-SECURITY.md`.
2. P0 wurde bewusst nicht ausgefuehrt (vorgegeben); Klausel A trotzdem exakt spezifiziert implementiert.
3. T-P3-13 (im Plan als optional/streichbar markiert) wurde **umgesetzt statt gestrichen** — eigene Testdatei `test/env-docs-spend-cap-coherence.test.js`, kein Anhang an Bestandsdateien, kein Scope jenseits des Plans.
4. Kommentar ueber `assertBootGates` in `src/boot.js` leicht praezisiert (reine Doku-Anpassung, kein Verhaltenswechsel).
5. **Nicht im Plan gelistet, aber notwendig (von Safety-Review als bewusste Abweichung vermerkt):** `src/config.js` — Code-Fallback `defaultTenantBudgetCents` von `1000` auf `600` angepasst. Ohne diese Aenderung reisst der ausgelieferte CODE-Default (wenn die Env-Var gar nicht gesetzt ist) den eigenen neuen Guard. Mit eigenem Test (T-P3-13/env-docs) gepinnt.

### Geaenderte/neue Dateien

- `src/boot-guard.js` (additiv: zwei neue exportierte Funktionen + Konstanten)
- `src/boot.js` (3 Import-Deltas, 2 neue Modul-Funktionen, 2 neue Aufrufzeilen am Ende von `assertBootGates`)
- `.env.example` (`DEFAULT_TENANT_BUDGET_CENTS` 1000 -> 600, Kommentar geschaerft)
- `render.yaml` (dieselbe Wert-/Kommentaraenderung)
- `src/config.js` (Fallback-Wert `defaultTenantBudgetCents` 1000 -> 600, Abweichung 5)
- `test/spend-cap-coherence.test.js` (neu, T-P3-01..09)
- `test/boot-failclosed.test.js` (T-P3-10..12 angehaengt)
- `test/env-docs-spend-cap-coherence.test.js` (neu, T-P3-13)

**Nicht angefasst:** `src/store/state-ops.js`, `src/telephony/outbound-gates.js`, `test/helpers.js`, jedes Ablehnungspraedikat, jedes Laufzeit-Gate.

---

## 4. Rot-vor-Fix-Beleg

Zweifach erbracht — von der Impl selbst UND unabhaengig vom Safety-Reviewer reproduziert:

**Impl (vor Implementierung, gemessen):**
1. `node --test test/spend-cap-coherence.test.js`: SyntaxError — `"The requested module '../src/boot-guard.js' does not provide an export named 'SPEND_CAP_FINDING'"` -> 1 fail, 0 pass.
2. `node --test test/boot-failclosed.test.js` (3 neu angehaengte Faelle): T-P3-10 schlug fehl mit "Server ist NICHT beendet (Boot-Refusal erwartet)" — der Server bootete mit der inkohaerenten Konstellation (`DEFAULT_TENANT_BUDGET_CENTS=1000` gegen `MAX_BUDGET_EUR=8`) unveraendert durch und loggte "Hermes Gateway laeuft auf ..." statt zu verweigern (Exit 0 statt 1). T-P3-11 schlug fehl mit `0 !== 1` (keine A0-Konfig-Warnzeile im Output). T-P3-12 schlug fehl mit AssertionError "input did not match /max_duration_s=120/" (keine Klausel-B-Warnung, kein Audit-Eintrag).

**Safety-Review (unabhaengig reproduziert):** `git checkout --detach master`, Testdateien aus dem Branch daruebergelegt — `test/spend-cap-coherence.test.js` = 1 fail (Import wirft), `test/env-docs-spend-cap-coherence.test.js` = 1 fail (misst alten Fallback 1000), `test/boot-failclosed.test.js` = 6 pass / 3 fail, exakt T-P3-10/11/12. Auf dem Branch anschliessend alle gruen.

---

## 5. Safety-Urteil

**APPROVED** (`safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `redBeforeFixVerified: true`, `blockers: []`).

### Unabhaengiger Test-Nachweis

Voll-Suite selbst gefahren: Lauf 1 = 2571/2571 gruen. Lauf 2 = 2570/1 fail — bekannter ~12%-Voll-Last-Spawn/Port-Race in einer vom Branch unveraenderten Datei; isoliert 5x hintereinander 5/5 gruen. Nach Gate-Protokoll kein echtes Rot.

**Eigener Boot-Smoke, 6 Konfigurationen** (je echter `src/server.js`-Kindprozess auf freiem Port):

1. Gepinnte helpers.js-Werte (`MAX_BUDGET_EUR=8`, Default `0`): bootet durch, `/healthz=200`, genau eine A0-WARN-Zeile.
2. Ausgelieferte Beispielkonfig (8/600/Tarif 300): bootet durch, `/healthz=200`, Klausel-B-WARN nennt `max_duration_s=120`.
3. Code-Fallback (Env-Var nicht gesetzt -> 600): bootet durch, `/healthz=200`.
4. Unbepreiste datierte Modell-ID: bootet durch, `/healthz=200`, nur WARN.
5. Gleichstand `800>=800`: `exit 1`, nennt beide Zahlen (`>=` statt `>` verifiziert).
6. Alte Live-Konstellation `1000>=800`: `exit 1`, nennt beide Zahlen.

### Code-Invarianten am Diff nachgewiesen

- Genau **eine** fatale Kante: `grep` auf `src/boot-guard.js` findet keinen `process.exit`/`throw`/`exit(`; der einzige `fatal:true` sitzt in Klausel A; in `src/boot.js` ruft nur `assertSpendCapCoherence` ueber `findings.find(f => f.fatal)` `exit(1)`.
- Kein Config-Import im Guard (`grep '^import'` auf `src/boot-guard.js` = null Treffer).
- `Object.hasOwn` statt Roh-Index empirisch gepinnt (T-P3-09, `assert.throws(TypeError)`).
- Reihenfolge: `assertBootGates` (Zeile 187) vor `lifecycle.rearmActiveCallTimers` (Zeile 198) — INV-5 gehalten.
- `modelPricesUsd` bleibt ungefreezed (Proxy-SameValue-Invariante).
- Namens-Anhang exakt eingehalten; `audit`-Aufrufform (`audit(event, null, detail)`) wie vorgeschrieben.
- ENV korrekt: `MAX_BUDGET_EUR` ueberall weiter `8`, `DEFAULT_TENANT_BUDGET_CENTS` in `.env.example`/`render.yaml` auf `600`, keine neue Env-Variable, keine neue Dependency.

### Concerns (nicht blockierend, aber festzuhalten)

1. **Deploy-Vorbedingung (kritisch, kein Branch-Defekt):** Render-Services sind Dashboard-managed, Live != `render.yaml`. Steht im Dashboard `DEFAULT_TENANT_BUDGET_CENTS` noch auf `1000` gegen `MAX_BUDGET_EUR=8`, verweigert der Dienst nach diesem Deploy den Boot — auf einem Host ohne Shell nur ueber Dashboard-Env + Redeploy heilbar, waehrend die Telefonie steht. **Merge ist freigegeben, Deploy NICHT ohne diese Pruefung.**
2. `src/config.js`-Fallback-Aenderung liegt formal ausserhalb der im Plan gelisteten Dateien — notwendig und korrekt begruendet, mit eigenem Test gepinnt.
3. Die ausgelieferte Konfiguration (600/300/300) erzeugt bei **jedem** Boot dauerhaft eine Klausel-B-WARN plus Audit-Zeile — plan-konform, aber betrieblich: teuerster Auslandsverkehr bleibt ab 120s strukturell unbezahlbar, WARN-Zeile ist Dauerrauschen im Boot-Log.
4. `test/boot-guard.test.js` wurde nicht angefasst (Plan listete sie unter "Betroffene Dateien"); Abdeckung liegt stattdessen vollstaendig in der neuen `test/spend-cap-coherence.test.js` — rein organisatorisch.

---

## 6. Clean-Code-Audit

**Verdikt: PASS, kein Blocker.** Keine S1/S2-Befunde im Diff (8 Dateien). Neuer Boot-Guard sauber nach Bestandsmuster (`fakeOriginateBootBlocked`/`meterMappingGaps`) verdrahtet, gruendlich getestet (21 neue Faelle), erhoeht die Sicherheit (neues fail-closed Gate gegen inerte Tenant-Budget-Achse). Review-Runde 1 hat bereits einen echten Defekt gefangen (Fallback-Inkohaerenz 1000 vs. 800) — der Audit-Loop hat sichtbar funktioniert.

- **S1:** keine
- **S2:** keine
- **S3 (nicht-blockierend):**
  - G30 — `spendCapCoherence()` buendelt 3 sich ausschliessende Klauseln in einer Funktion statt 3 benannten Praedikat-Helpern; durch Kommentare + Wahrheitstabellen-Tests gut lesbar gehalten, daher kein Blocker (Regel 3: Lesbarkeit hat Vorrang).
  - G34 — `assertSpendCapCoherence()` mischt Entscheidung (fataler Abbruch), Logging und bedingtes Audit-Schreiben in einer Funktion; ein privates `logFinding(finding)`-Helper waere sauberer getrennt. Funktion ist kurz (~15 Zeilen) und dicht kommentiert.
- **S4 (Stil-Hinweis):**
  - G11 — die 4 Bestands-Gates bleiben inline in `assertBootGates()`, waehrend die 2 neuen P3-Gates in eigene Funktionen extrahiert sind — zwei Stile fuer dasselbe Konzept "Boot-Gate" nebeneinander. Kosmetisch, kein Verhaltensrisiko.

**Top-TODOs (optional):**
1. Bei einer 4. Klausel in Zukunft `spendCapCoherence` in benannte Praedikat-Helper aufteilen.
2. Stil vereinheitlichen: entweder alle Boot-Gates inline oder alle extrahiert.
3. Pruefen, ob der neue fail-closed Budget-Kohaerenz-Guard in `PLAN-SECURITY.md` nachgetragen werden soll (Prozess-Punkt, ausserhalb des Clean-Code-Katalogs).

---

## 7. Fix-Runden

**Runde 1 (r1):** Deploy-Blocker als kritischste Zeile explizit herausgearbeitet und in Plan, Impl-Summary und Safety-Concern woertlich verankert: *"vor dem Deploy von P3 MUSS der Live-Wert von DEFAULT_TENANT_BUDGET_CENTS im Render-Dashboard gelesen werden. Ist er >= 800, verweigert der Dienst den Boot. Abhilfe: Wert unter 800 setzen ODER MAX_BUDGET_EUR anheben (P0)."* Dieser Fix kann den Dashboard-Wert selbst nicht lesen (kein Repo-Zugriff auf das Dashboard) — er stellt sicher, dass die Vorbedingung an drei Stellen (Plan, Deviations, Safety-Concerns) unuebersehbar dokumentiert ist, bevor irgendein Deploy dieser Phase erfolgt.

Keine weiteren Fix-Runden noetig — Safety-Review kam beim ersten Durchlauf mit `approved: true` und leerer `blockers`-Liste zurueck; Clean-Code-Audit kam mit `blocker: false` und nur S3/S4-Stilhinweisen zurueck. Gate erreichte PASS nach Runde 1.

---

## 8. Offene Deploy-Vorbedingungen

1. **KRITISCH — vor jedem Deploy dieser Phase:** Render-Dashboard-Wert von `DEFAULT_TENANT_BUDGET_CENTS` lesen. Ist er `>= 800` (z.B. der bisherige Wert `1000`), verweigert der Dienst nach dem Deploy den Boot — kein `app.listen`, kein `/voice`, kein `/mcp`, kein `/healthz`, auf Render Free Tier ohne Shell nur ueber Dashboard-Env-Aenderung + Redeploy heilbar, waehrend die Telefonie steht. Abhilfe: Dashboard-Wert unter 800 setzen (z.B. auf 600, wie jetzt in `.env.example`/`render.yaml` dokumentiert) ODER `MAX_BUDGET_EUR` anheben (P0, in dieser Phase nicht ausgefuehrt).
2. Dieser Deploy-Blocker gehoert als Eintrag in `PLAN-SECURITY.md` nachgetragen (von Plan und Safety-Review gleichermassen gefordert) — noch nicht erledigt.
3. Betriebliche Nebenwirkung der ausgelieferten Beispiel-Konfiguration (600/300/300): Klausel B (Worst-Case-Reserve unbezahlbar) feuert bei jedem Boot als WARN + Audit-Zeile (`max_duration_s=120`) — kein Fehler, aber Dauerrauschen im Boot-Log und ein strukturelles Limit fuer sehr lange Auslandsgespraeche, das bewusst in Kauf genommen wird statt durch Aufweichen des Guards kompensiert zu werden.
4. `MAX_BUDGET_EUR` bleibt in dieser Phase ueberall bei `8` — P0 (Anheben) ist eine separate, nicht in P3 enthaltene Abhaengigkeit, die die Deploy-Vorbedingung Nr. 1 entweder ersetzt oder ergaenzt.
