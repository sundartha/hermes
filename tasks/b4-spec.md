# B4 — Preisquelle und Gate (Spezifikation)

**Stand:** 2026-08-08 · **Quelle des Auftrags:** `PLAN-ANBIETER-PORT.md` Teil 2, Abschnitt
"B4 — Preisquelle und Gate" (ab Zeile 264) · **Bindender Vorvertrag:** `src/llm/ports.js`
(B2, gemergt 50ba426)

Nur Spezifikation. Kein Produktionscode, kein Commit, kein Branch.

Belegregel dieser Spec: jede Bestandsaussage traegt einen Symbolnamen; alle genannten
Zeilennummern sind in dieser Session selbst nachgeschlagen (`grep`/`sed` gegen den
Arbeitsbaum auf `master`). Wo etwas nicht belegt werden konnte, steht das Wort
**unbelegt** samt Zustaendigem.

---

## 1. Bindende Entscheidungen

Diese Punkte sind nicht mehr Gegenstand der Umsetzung. Wer sie aendern will, braucht eine
Owner-Entscheidung.

| # | Entscheidung | Herkunft |
|---|---|---|
| E-1 | Raten **je Token-Sorte**, nicht eine pauschale Eingabe-Rate | Owner-Entscheidung 2026-08-08, `tasks/todo.md` Abschnitt "OWNER-ENTSCHEIDUNG 2026-08-08 (bindend fuer B2/B4)", Punkt 1 |
| E-2 | **Vier Raten Pflicht je Eintrag, kein Feld optional.** Additiv-nullable ist verworfen | `tasks/todo.md`, "Form der Preistabelle, die B4 bauen muss"; bezahlter Praezedenzfall: alle Bestandsnummern ohne `monthlyCostCents` (`tasks/did-miete-ohne-preis.md`) |
| E-3 | **Boot-Abbruch** bei konfiguriertem Modell ohne Preiseintrag | `PLAN-ANBIETER-PORT.md`, "Die drei Abnahmekriterien", Nr. 1 |
| E-4 | Abnahmekriterium 2 woertlich, **inklusive ausgefuehrter Gegenprobe** | `PLAN-ANBIETER-PORT.md`, Abnahmekriterium 2 |
| E-5 | Der Port meldet **Token, nie Geld**; Umrechnung bleibt `usdToEur` in `config.js` | `src/llm/ports.js` Kopfkommentar, Zeilen 9-13 |
| E-6 | Gebucht wird unter der **angeforderten** Modell-ID; welche ID gilt, begruendet der Adapter | `src/llm/ports.js` `LlmTokenUsage.billingModelId`; heute umgesetzt in `src/llm/adapters/anthropic.js` `toTokenUsage`, Kommentar Zeilen 147-150 |
| E-7 | Fail-closed bleibt fail-closed: die pro-Tenant-Kostendecke sperrt weiterhin **beide** Richtungen, Inbound eingeschlossen | `CLAUDE.md` Absolute Regel 1, E11 **zurueckgezogen** |
| E-8 | `MAX_BUDGET_EUR` ist **kein** geschuetztes Gate mehr — B4 fasst die Plattform-Achse nicht an | `CLAUDE.md` Absolute Regel 1, Owner-Entscheidung E10 (2026-07-30) |

### Die Preisquelle (weisser Fleck W3 — GESCHLOSSEN)

`source`: `https://platform.claude.com/docs/en/about-claude/pricing.md`
`asOf`: **2026-08-08** (Tag des Abrufs). Explizit gedruckte Werte, **nicht** aus
Multiplikatoren abgeleitet. USD je 1 Mio. Token:

| Modell | Input | 5m Cache Write | 1h Cache Write | Cache Read | Output |
|---|---|---|---|---|---|
| `claude-haiku-4-5` | 1.00 | 1.25 | 2.00 | 0.10 | 5.00 |
| `claude-sonnet-5` **bis 2026-08-31** | 2.00 | 2.50 | 4.00 | 0.20 | 10.00 |
| `claude-sonnet-5` **ab 2026-09-01** | 3.00 | 3.75 | 6.00 | 0.30 | 15.00 |

**Welche Schreib-Rate gilt: die 5-Minuten-Rate.** Am Code geprueft:
`src/claude.js:543` definiert `const CACHE_CONTROL_EPHEMERAL = Object.freeze({ type: "ephemeral" });`
— **ohne** `ttl`-Feld. Genau dieses Objekt ist die einzige Cache-Markierung im Repo; es
wird an zwei Stellen gesetzt: am letzten Werkzeug (`claude.js:554`) und am System-Block
(`claude.js:1012`). Ohne `ttl` gilt der Anbieter-Default, und das ist die
5-Minuten-Variante. Also: `cacheWritePerMTok` = 1.25 (Haiku) bzw. 2.50 / 3.75 (Sonnet).

**Die 1h-Rate wird NICHT mitgefuehrt.** Begruendung: eine Rate ohne Aufrufer ist
Vorratshaltung — dieselbe Regel, mit der `src/llm/ports.js` (Kopfkommentar Zeilen 22-24)
Embeddings, JSON-Modus und Denk-Budget aus dem Vertrag geworfen hat. Eine fuenfte Zahl,
die niemand liest, wird auch von niemandem gepflegt und ist beim naechsten Preiswechsel
still falsch.

**Die Gegenmassnahme gegen den Weg zurueck** (jemand setzt spaeter `ttl: "1h"` und die
Buchung bleibt still auf der 5m-Rate = Unterbuchung auf der Gate-Achse): ein Gate-Test,
der den QUELLTEXT von `src/claude.js` liest und rot wird, sobald neben
`cache_control`/`CACHE_CONTROL_EPHEMERAL` ein `ttl` auftaucht, ohne dass die Preistabelle
eine 1h-Rate traegt. Das Muster existiert im Bestand woertlich:
`test/fx-single-source.test.js` liest den Quelltext von `config.js` und verlangt dort
`"usdToEur: numEnv("` (dokumentiert in `config.js`, Kommentar Zeilen 194-199). Struktur
statt Disziplin.

---

## 2. Bestand am Code

### 2.1 Die Preistabelle heute

`src/config.js:1426-1429`:

```js
modelPricesUsd: {
  "claude-haiku-4-5": { inPerMTok: 1.0, outPerMTok: 5.0 },
  "claude-sonnet-5": { inPerMTok: 3.0, outPerMTok: 15.0 },
},
```

Zwei Raten je Eintrag. Kein `asOf`, kein `source`, keine Cache-Raten.

Der Kommentar darueber (`config.js:1419-1425`) haelt eine Falle fest, die B4 nicht
brechen darf: **`modelPricesUsd` darf NICHT `Object.freeze`t werden.** `guardedConfig`
wrapt jeden Objektwert bei jedem Zugriff frisch in einen neuen Proxy; fuer eine per
`Object.freeze` non-configurable gemachte Eigenschaft verlangt die Sprache SameValue-
Rueckgabe, und die Engine wirft dann `TypeError` bei JEDEM Zugriff — auch auf bekannte
Modelle. Das waere der Fail-open-durch-Crash, den `priceForModel` gerade verhindern soll.

Ein zweiter Kommentar (`config.js:1415-1417`) haelt fest: eine **datierte Snapshot-ID**
(`"claude-haiku-4-5-20251001"`) ist ein anderer Schluessel als der Alias und liefe in den
Fail-closed-Zweig.

### 2.2 Die Preisrechnung heute

`src/store/state-ops.js`:

- `mostExpensivePrice(prices)` (**:2219**) — waehlt den Eintrag mit dem groessten
  `outPerMTok`, bei Gleichstand den mit dem groessten `inPerMTok`. Leere Tabelle wirft
  benannt (`"modelPricesUsd ist leer - keine Preisquelle fuer den Budget-Guard (Regel 1)"`,
  **:2222**).
- `priceForModel(model, prices)` (**:2240**) — `Object.hasOwn(prices, model) ? prices[model] : mostExpensivePrice(prices)`.
  `Object.hasOwn` statt Roh-Index ist Pflicht (Proxy-`get`-Trap wirft, Kommentar **:2236-2239**).
- `tokenCostUsd(tokens, cfg)` (**:2248-2254**) — **zwei** Summanden:
  `(tokens.inputTokens / TOKENS_PER_M_TOK) * price.inPerMTok + (tokens.outputTokens / TOKENS_PER_M_TOK) * price.outPerMTok`.
  `tokens` = `{inputTokens, outputTokens, model}` (Kommentar **:2247**).
- `tokenCostMicroCents(tokens, cfg)` (**:2264**) — die EINE ungerundete Geldquelle (G5).
- `aiCostCents(tokens, cfg)` (**:2965-2967**) — dieselbe Formel, auf Ganzzahl-Cents gerundet.
- `trackUsage(s, tenantId, tokens, cfg, nowIso)` (**:2524**) — Gate-Achse. Erhoeht
  `usage.inputTokens`/`usage.outputTokens` (**:2532-2533**) und bucht den Cent-Uebertrag
  ueber `bookCents` (**:2493**) auf `costCents` **und** `spendMonthCostCents`.
- `turnIncrementsBookable(tokens, microInc)` (**:2307-2313**) — D7-Riegel, prueft heute
  `tokens.inputTokens`, `tokens.outputTokens`, `microInc`.
- `recordUsageEvent(...)` (**:2978**) — Stripe-Ledger, Felder `quantity`, `costCents`,
  `costMicroCents` (additiv nullable, nur `ai_token` fuellt sie).

### 2.3 Die Faltung, die B4 aufloest

`src/llm-usage.js`:

- `inputTokensOf(usage)` (**:21-23**) — `inputUncachedTokens + inputCacheWriteTokens + inputCacheReadTokens`.
  Kommentar: *"fail-safe: NIE weniger als ohne Caching"*.
- `billedTokens(usage)` (**:52-58**) — `{ inputTokens: inputTokensOf(usage), outputTokens: usage.outputTokens, model: usage.billingModelId }`.
- `bookTokenUsage({tenantId, callId, usage})` (**:67-71**) — beide Achsen.
- `bookEstimatedTokenUsage({tenantId, usage})` (**:79-81**) — NUR die Gate-Achse.
- `meterAiTokens({...})` (**:32-45**) — `quantity: tokens.inputTokens + tokens.outputTokens`.
- `estimatedAbortUsage({promptChars, maxTokens, billingModelId})` (**:94-103**) — legt
  **alle** geschaetzten Eingabe-Token auf `inputUncachedTokens`, `estimated: true`.
- `ESTIMATE_CHARS_PER_TOKEN = 3` (**:85**), bewusst pessimistisch.

Aufrufer der Buchung (`grep`, vollstaendig): `src/claude.js:796` (Turn-Schleife, ueber
`bookReal`), `src/claude.js:1302` (Summary), `src/claude.js:816` (`estimatedAbortUsage`),
`src/precall-briefing.js:265` und `:316`.

### 2.4 Der Boot-Waechter heute

`src/boot.js:121-132`:

```js
// P3: Modelle ohne Preistabellen-Eintrag (unpricedModels, src/boot-guard.js) buchen
// fail-closed zur TEUERSTEN Rate (priceForModel, state-ops.js) - Folge ist reine
// Ueber-Bepreisung (bis 3x), nie Ueber-Ausgabe. NUR WARN, kein exit(1): ein Boot-
// Refusal tauschte hier ein Kostenproblem gegen einen Totalausfall der Telefonie.
function warnUnpricedModels(config) {
  const unpriced = unpricedModels([config.llm.claudeModel, config.llm.briefingModel], config.llm.modelPricesUsd);
  ...
}
```

Aufgerufen in `src/boot.js:376`. Geprueft werden genau zwei Werte: `config.llm.claudeModel`
(`config.js:216`, Default `"claude-haiku-4-5"`) und `config.llm.briefingModel`
(`config.js:268`, Default `"claude-sonnet-5"`).
`unpricedModels(modelIds, modelPricesUsd)` steht in `src/boot-guard.js:196-198` und filtert
per `Object.hasOwn`.

**Der Gegen-Praezedenzfall existiert bereits im selben Modul:** `assertProviderRateInBand`
(`boot.js:137-142`) macht genau den umgekehrten Weg — Kommentar **:134-136**: *"LCT P4:
Umrechnungskurs gegen das Toleranzband - seit dieser Phase FATAL (in P2 war derselbe Befund
eine WARN)."* Eine Geld-Achse wurde also im Bestand schon einmal von WARN auf `exit(1)`
gehoben. B4 tut dasselbe an der Nachbar-Achse.

### 2.5 Wer die Token-Zaehler des Buckets liest

`grep -rn "\.inputTokens\|inputTokens\b" src/` (ohne die vier Sorten-Namen) liefert
**vollstaendig**: `llm-usage.js:38` (Ledger-`quantity`), `llm-usage.js:54` (`billedTokens`),
`routes/api-read.js:40` (Dashboard-Anzeige), `store/pg.js:1228` + `:1462` (Hydrierung /
Flush), `store/defaults.js:566` (`emptyUsage`), `store/state-ops.js:2195/2200/2206`
(`globalUsageTotals`, Anzeige), `:2251` (Preisformel), `:2309` (D7-Riegel), `:2532`
(Schreibkante), `store/json.js:144` (Alt-Store-Migration).

**Die Gate-Kette liest sie NICHT.** `budgetExceeded` (**:2893**) ->
`liveBudgetExceeded` -> `tenantSpendOrDeny` (**:2855**) -> `tenantUsageAxes` vergleicht
Cent-Achsen; kein Token-Zaehler kommt darin vor. Das ist die tragende Tatsache fuer W5.

### 2.6 Der Store

- `emptyUsage()` (`src/store/defaults.js:564-...`) — `inputTokens`, `outputTokens`,
  `costCents`, `costMicroCentsRem`, Spend-Monat-Felder.
- `src/db/schema.sql:351-357` — Tabelle `usage` mit `input_tokens BIGINT`,
  `output_tokens BIGINT`, `cost_eur NUMERIC`, `calls BIGINT`.
- `src/db/schema.sql:553-562` — Tabelle `usage_event` mit `quantity NUMERIC`,
  `cost_cents BIGINT`; `cost_micro_cents BIGINT` additiv nachgezogen (**:578**).

### 2.7 Der Adapter (B3a)

`src/llm/adapters/anthropic.js`:

- `toTokenUsage(usage, billingModelId)` (**:137-153**) — `inputUncachedTokens: usage.input_tokens`,
  `inputCacheWriteTokens: usage.cache_creation_input_tokens ?? 0`,
  `inputCacheReadTokens: usage.cache_read_input_tokens ?? 0`,
  `outputTokens: usage.output_tokens`, `estimated: false`, `billingModelId` = angeforderte
  ID (Begruendung im Adapter-Kommentar **:147-150**, mit B1-Beleg "0/88 Abweichungen").
- `unreportedUsage(billingModelId)` (**:124-133**) — alle vier Sorten 0, `estimated: true`.

Die vier Sorten kommen also **heute schon vollstaendig** am Buchungspunkt an. B4 aendert
nichts am Adapter; B4 aendert, was mit den vier Zahlen gerechnet wird.

---

## 3. Der Befund: Sonnet wird derzeit 50 % zu hoch gebucht

`config.js:1428` fuehrt `claude-sonnet-5` mit `inPerMTok: 3.0, outPerMTok: 15.0`. Das ist
die Staffel **ab 2026-09-01**. Bis 2026-08-31 gilt 2.00 / 10.00.

`claude-sonnet-5` ist `briefingModel` (`config.js:268`) — das Pre-Call-Briefing, das
`fetchPrecallBriefing` vor jedem Outbound-Anruf synchron fuehrt und ueber
`bookTokenUsage` (`precall-briefing.js:316`) auf **beide** Achsen bucht: Gate **und**
Stripe-Kundenbeleg. Ueberbuchung ist auf dem Gate sicher, auf dem Kundenbeleg ein
Abrechnungsdefekt — dieselbe Begruendung, mit der B2 die Faltung `inputTokensOf` verworfen
hat.

### Groessenordnung (Annahmen offengelegt)

Annahmen, alle benannt, keine gemessen:
- **A1:** ein Briefing je Outbound-Anruf (belegt: `precall-briefing.js` laeuft in
  `POST /api/calls` vor dem Waehlen, `config.js:269-270`).
- **A2:** Eingabe ~2000 Token je Briefing (Owner-Text + Werkzeug-Definition).
  **Unbelegt** — geschaetzt, nicht gemessen.
- **A3:** Ausgabe ~300 Token; harte Obergrenze ist `BRIEFING_MAX_TOKENS = 700`
  (`precall-briefing.js:43`, belegt).
- **A4:** Kurs `usdToEur = 0.92` (`config.js:211`, belegt; selbst eine ANNAHME laut
  Kommentar `config.js:202-203`).

| | Rate 3.00/15.00 (heute im Code) | Rate 2.00/10.00 (korrekt bis 08-31) |
|---|---|---|
| Eingabe 2000 Tok | 0.006000 USD | 0.004000 USD |
| Ausgabe 300 Tok | 0.004500 USD | 0.003000 USD |
| **Summe** | **0.010500 USD** | **0.007000 USD** |
| Differenz | | **0.003500 USD** = 0.00322 EUR = **0,32 Cent je Outbound-Anruf** |

Obergrenze desselben Effekts bei voll ausgeschoepftem `BRIEFING_MAX_TOKENS` (700 Ausgabe,
gleiche Eingabe): 0.0165 vs. 0.0110 USD, Differenz 0.0055 USD = **0,51 Cent je Anruf**.

Zum Vergleich: der Tarif ist 30 ct/min (Kette KS, live seit 2026-07-31). Ein
Drei-Minuten-Anruf kostet den Kunden 90 Cent. Die Ueberbuchung ist **rund 0,35 % eines
Anrufs**.

### Entscheidung: Teil von B4, KEIN vorgezogener Sonderschritt

Begruendung, in dieser Reihenfolge:

1. **Der realisierte Schaden ist heute exakt 0 EUR.** Seit 2026-08-04 gab es keinen
   Anruf (`tasks/todo.md`, B3-Blocker-Abschnitt), und das Anthropic-Guthaben ist leer
   (gemessen 2026-08-08, HTTP 400). Null Briefings mal 0,32 Cent = null.
2. **Der Fehler heilt sich am 2026-09-01 selbst.** Ab diesem Datum ist `3.00/15.00` die
   richtige Zahl. Ein vorgezogener Sonderschritt wuerde eine Zahl korrigieren, die in
   23 Tagen ohnehin stimmt — und dabei dieselbe Datei anfassen, die B4 danach erneut
   anfasst. Zwei Aenderungen an einer Geld-Kante, wo eine genuegt.
3. **Ein Einzel-Fix waere die falsche Loesung.** Wer heute `2.00/10.00` eintraegt, hat am
   01.09. eine falsche Zahl im Code und keinen Mechanismus, der das merkt. Der Befund ist
   nicht "eine falsche Zahl", sondern "die Tabelle kann einen terminierten Preiswechsel
   nicht ausdruecken". Genau das loest B4.

**Ausnahme, die die Entscheidung umkehrt:** geht **vor** dem Merge von B4 wieder echter
Verkehr live (Guthaben aufgeladen UND ein Outbound-Anruf gefuehrt), ist der Befund ab
diesem Moment ein aktiver Abrechnungsdefekt und muss als Ein-Zeilen-Fix vorgezogen
werden. Der Owner entscheidet das, sobald er das Guthaben auflaedt.

### Wie die Tabelle einen terminierten Preiswechsel traegt

**Kein Handbetrieb.** Der Grund ist zwingend und nicht Geschmackssache: es gibt **keine
einzelne Zahl, die heute richtig ist**. `2.00` ist ab dem 01.09. falsch, `3.00` ist bis
zum 31.08. falsch. Eine flache Tabelle kann die heute bekannte Wahrheit nicht ausdruecken.
Das ist kein Vorratsbau fuer einen hypothetischen Fall — es ist die Mindeststruktur fuer
eine bereits veroeffentlichte Tatsache. Zweiter Beleg fuer denselben Bedarf: die
DeepSeek-Preisseite kuendigt woertlich *"a significant increase"* an
(`PLAN-ANBIETER-PORT.md` 1.2).

Der Gegenentwurf ist am Bestand widerlegt: `usdToEur` traegt genau den Kommentar
*"Stand 2026-07, ANNAHME - quartalsweise von Hand zu pflegen"* (`config.js:202-203`) —
das ist die Handarbeits-Variante, und sie steht seit einem Monat unangetastet da.

**Aber die Zeitabhaengigkeit darf die Buchungskante nicht erreichen.** Ein `nowIso` in
`tokenCostUsd`/`tokenCostMicroCents`/`aiCostCents` haette zwei Folgen: eine
Signaturaenderung an der EINEN Geldformel (G5) mit fuenf Aufrufern, und — schwerer — zwei
Uhren an derselben Buchung (`trackUsage` bekommt `nowIso` vom Aufrufer, `recordUsageEvent`
stempelt `new Date()`, `state-ops.js:2991`). An der Monatsgrenze koennten Gate-Achse
und Ledger verschiedene Staffeln waehlen. Genau diese Klasse — zwei Kostenbuecher ohne
Kante — hat dieses Repo bereits bezahlt (`tasks/kosten-vollstaendigkeit-inbound-luecke.md`).

**Loesung: die Aufloesung passiert genau EINMAL, beim Boot.** Details in 4.2.

---

## 4. Entwurf

### 4.1 Die Preistabellen-Form

Neue Modul-Konstante in `src/config.js`, oberhalb von `rawConfig` (Muster
`EXCHANGE_RATE_DEFAULTS`, `config.js:210-212`):

```js
// Quelle und Abrufdatum der Staffel. EINE Konstante, damit `source` nicht je Eintrag
// abweichen kann (G5).
const ANTHROPIC_PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing.md";

// Preisstaffeln je Modell-ID, aufsteigend nach validFrom. Vier Raten je Staffel, KEIN
// Feld optional (E-2). Zwei Datumsfelder mit VERSCHIEDENER Bedeutung:
//   asOf      = wann WIR die Zahl gelesen haben (unsere Belegkette)
//   validFrom = ab wann der ANBIETER sie berechnet (seine Ankuendigung)
// Die Anker-Staffel traegt validFrom == asOf: wir behaupten kein Startdatum, das wir
// nicht beobachtet haben.
const MODEL_PRICE_SCHEDULES = {
  "claude-haiku-4-5": [
    {
      validFrom: "2026-08-08",
      inPerMTok: 1.0,
      cacheWritePerMTok: 1.25,
      cacheReadPerMTok: 0.1,
      outPerMTok: 5.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
  ],
  "claude-sonnet-5": [
    {
      validFrom: "2026-08-08",
      inPerMTok: 2.0,
      cacheWritePerMTok: 2.5,
      cacheReadPerMTok: 0.2,
      outPerMTok: 10.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
    {
      validFrom: "2026-09-01",
      inPerMTok: 3.0,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.3,
      outPerMTok: 15.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
  ],
};
```

`modelPricesUsd` bleibt fuer **alle Leser** eine flache Abbildung Modell-ID -> vier Raten:

```js
modelPricesUsd: resolveModelPrices(MODEL_PRICE_SCHEDULES, todayIso()),
```

Das haelt den Blast-Radius klein: `priceForModel`, `tokenCostUsd`, `unpricedModels`,
`mostExpensivePrice` sehen weiterhin ein flaches Objekt mit den bekannten Schluesseln —
nur mit zwei zusaetzlichen Raten. **Kein `Object.freeze`** auf dem Ergebnis (2.1).

### 4.2 `resolveModelPrices` — die Aufloesung beim Boot

Reine Funktion, testbar ohne Uhr (die Uhr ist Parameter):

```js
function resolveModelPrices(schedules, todayIso) { ... }
```

Regeln:
1. Je Modell-ID wird die **letzte** Staffel mit `validFrom <= todayIso` gewaehlt
   (String-Vergleich auf `YYYY-MM-DD` ist ordnungserhaltend — kein `Date`, keine
   Zeitzone; Repo-Lehre `rca-lessons-timezone-and-fixtures`).
2. Gibt es fuer eine ID **keine** gueltige Staffel, wirft die Funktion benannt. Das ist
   ein Boot-Abbruch-Ausloeser (4.4).
3. Ein Eintrag mit fehlender, nicht-numerischer, negativer oder `NaN`-Rate wirft benannt.
   Das ist der Fall, den E-2 verbietet — er darf nicht still ins alte Verhalten fallen.
4. Das Ergebnis traegt die vier Raten **plus** `validFrom`, `asOf`, `source` (Diagnose;
   kein Rechner liest sie).

**Beobachtbarkeit:** das bestehende `[boot]`-Banner (`src/boot.js:609` druckt heute schon
`PRECALL_BRIEFING_MODEL=...`) bekommt je konfiguriertem Modell die gewaehlte
`validFrom` und — falls vorhanden — die `validFrom` der naechsten Staffel. Damit ist am
laufenden Prozess ablesbar, welche Staffel er faehrt. Ohne diese Zeile ist der
Restrisiko-Fall aus 4.3 unsichtbar.

### 4.3 Restrisiko der Boot-Aufloesung, benannt und begrenzt

Ein Prozess, der ueber den 2026-08-31 hinaus **ohne Neustart** laeuft, bucht ab dem
01.09. weiter mit 2.00/10.00 — also **zu wenig**. Zu wenig ist auf der Gate-Achse die
unsichere Richtung (Regel 1).

Warum es trotzdem die richtige Wahl ist: die Alternative (Uhr an der Buchungskante) kauft
diesen Grenzfall mit einem dauerhaft groesseren Risiko — zwei Uhren, zwei Achsen, jede
Buchung betroffen — statt eines einmaligen, terminierten.

Gegenmassnahmen **in dieser Phase**:
- Boot-Banner mit gewaehlter und naechster `validFrom` (4.2).
- Ein Test, der `resolveModelPrices` mit `todayIso = "2026-09-01"` aufruft und 3.00/15.00
  erwartet — die Umschaltung ist damit bewiesen, nicht gehofft.
- Eintrag in `STATUS.md`: **am 2026-09-01 einmal neu deployen**. Eine Kalenderzeile fuer
  genau ein bekanntes Datum ist verhaeltnismaessig; ein Daemon dafuer waere es nicht.

### 4.4 Der Boot-Abbruch

`warnUnpricedModels` (`boot.js:125`) wird zu `assertPricedModels` — `console.error` +
`process.exit(1)`, exakt nach dem Muster von `assertProviderRateInBand`
(`boot.js:137-142`), das denselben Schritt an der Kurs-Achse bereits gegangen ist.

**Das tragende Argument des alten Kommentars, am Code geprueft.** Es lautet: *"ein
Boot-Refusal tauschte hier ein Kostenproblem gegen einen Totalausfall der Telefonie"*, und
es stuetzt sich auf *"reine Ueber-Bepreisung (bis 3x), nie Ueber-Ausgabe"*. Beide Haelften
haengen an **einer** Voraussetzung: dass `mostExpensivePrice` eine sinnvolle Obergrenze
liefert. Das gilt heute, weil die Tabelle genau eine Preiswelt enthaelt (zwei
Anthropic-Modelle, `config.js:1427-1428`) und der teuerste Eintrag (Sonnet, out 15.0) jeden
anderen dominiert. **Mit einem zweiten Anbieter faellt genau diese Voraussetzung** — und
damit das Argument, nicht durch Meinung, sondern durch Wegfall seiner Praemisse.

Zweitens ist der Ausgang des WARN-Zweigs im Betrieb nicht der behauptete: ein
`console.warn` auf einem Render-Dienst, den niemand liest, ist die stille Fehlkonfiguration
auf einer Geld-Achse — die Klasse, gegen die LCT P4 den Kurs-Guard fatal gemacht hat.

**Ein Dienst, der nicht startet, nimmt keine Anrufe an.** Deshalb ist die Liste der
Ausloeser abschliessend:

**Der Boot bricht ab bei:**

| # | Fehlkonfiguration | Waechter |
|---|---|---|
| A-1 | `config.llm.claudeModel` hat keinen Eintrag in `modelPricesUsd` | `unpricedModels` (`boot-guard.js:196`), unveraendert |
| A-2 | `config.llm.briefingModel` hat keinen Eintrag | dieselbe Funktion, dieselbe Liste |
| A-3 | A-1/A-2 durch eine **datierte Snapshot-ID** als `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL` (`config.js:1415-1417`) | dieselbe Funktion — der haeufigste reale Weg in A-1 |
| A-4 | Ein Staffel-Eintrag ist **unvollstaendig** (eine der vier Raten fehlt / ist nicht-numerisch / negativ / `NaN`) | `resolveModelPrices`, Regel 3 |
| A-5 | Ein Modell hat fuer **heute** keine gueltige Staffel (alle `validFrom` liegen in der Zukunft) | `resolveModelPrices`, Regel 2 |
| A-6 | `modelPricesUsd` ist **leer** | `mostExpensivePrice` (`state-ops.js:2222`) wirft heute schon — jetzt schon beim Boot statt beim ersten Turn |

**Der Boot bricht NICHT ab bei:**

| # | Fall | Warum nicht |
|---|---|---|
| N-1 | Ueberzaehlige Eintraege in der Tabelle (Modell steht drin, ist nirgends konfiguriert) | harmlos; ein Abbruch dafuer wuerde den Dienst wegen eines ungenutzten Datensatzes toeten |
| N-2 | `realtimeModel` (`gpt-realtime`, `config.js:1374`) ohne Preiseintrag | der Realtime-Pfad bucht **keine** Token ueber `bookTokenUsage` (`grep`: die einzigen Aufrufer sind `claude.js:796/816/1302` und `precall-briefing.js:265/316` — `bridge.js` ist nicht darunter). Ein Preis fuer eine Achse zu verlangen, die es nicht gibt, waere ein Abbruch ohne Schutzwirkung. **Dass der Realtime-Pfad seine OpenAI-Token gar nicht bucht, ist ein Bestandsbefund — siehe weisse Flecken WF-4** |
| N-3 | `asOf` liegt weit in der Vergangenheit (Preisliste veraltet) | WARN, kein Abbruch. Sonst legt ein Kalendertag die Telefonie lahm — genau der Fehlausgang, vor dem der alte Kommentar warnt, und hier zu Recht |
| N-4 | Eine spaetere Staffel existiert und ist noch nicht faellig | Normalfall (Sonnet ab 09-01) |
| N-5 | Fehlender/ungueltiger `DEEPSEEK_API_KEY`, nicht registrierter Fremdadapter | B5, nicht B4 |
| N-6 | `usdToEur` ausserhalb des Bandes | schon abgedeckt durch `assertProviderRateInBand` (`boot.js:137`) — keine zweite Meldung |

### 4.5 W4 — eine Tabelle oder eine je Anbieter?

**Antwort: EINE flache Tabelle, aber der Fail-closed-Zweig wird zur punktweisen
Obergrenze.**

Am Code entschieden:

1. **Tabelle je Anbieter scheidet aus.** Der Buchungspfad kennt keinen Anbieter. Der
   Vertrag traegt genau ein Feld zur Preisauswahl: `LlmTokenUsage.billingModelId`
   (`ports.js`), und `billedTokens` (`llm-usage.js:56`) reicht genau dieses als `model`
   durch. Eine Anbieter-Dimension bedeutet ein neues Vertragsfeld — der Vertrag ist
   gemergt und bindend (E-5/E-6). Der Nutzen waere null: die Modell-IDs tragen den
   Anbieter bereits im Namen (`claude-*`, `deepseek-*`), der Namensraum kollidiert nicht.
2. **Den Fallback ersatzlos streichen scheidet aus.** `priceForModel` liefe dann bei
   unbekannter ID in `undefined` und `tokenCostUsd` in `NaN` — der D7-Riegel
   (`turnIncrementsBookable`, `:2307`) wuerde den Turn verwerfen, also **gar nicht**
   buchen. Das ist fail-**open** auf der Gate-Achse. Ein `throw` statt dessen killt den
   laufenden Anruf mit 500 — genau der Fail-open-durch-Crash, den der
   `Object.hasOwn`-Kommentar (`:2236-2239`) benennt.
3. **Das Dritte, und die Empfehlung:** `mostExpensivePrice` wird zu `worstCasePrice` —
   sie liefert nicht mehr *einen* Eintrag, sondern eine **synthetische Staffel aus dem
   punktweisen Maximum jeder der vier Raten** ueber alle Eintraege. Damit gilt die
   Zusicherung wieder ohne Vorbehalt: *keine hinterlegte Staffel ist in irgendeiner Rate
   teurer als der Fallback*. Der heutige "teuerster Eintrag"-Ansatz kann das mit vier
   Raten und zwei Preiswelten nicht mehr garantieren; sein Tie-Break-Kommentar
   (*"Output dominiert die Rechnung in jeder bekannten Claude-Staffel"*, `:2215-2216`)
   nennt seine eigene Voraussetzung.

   **Heute verhaltens-identisch:** mit den zwei Anthropic-Eintraegen dominiert Sonnet in
   allen vier Raten, das punktweise Maximum ist genau die Sonnet-Staffel. Der Umbau ist
   also gratis jetzt und tragfaehig spaeter.

   Der Wurf bei leerer Tabelle (`:2222`) bleibt woertlich erhalten.

**Akzeptiertes Restrisiko:** bucht ein Adapter unter einer `billingModelId`, die nicht
konfiguriert ist (der Vertrag erlaubt das ausdruecklich, `ports.js` `billingModelId`), und
gehoert diese ID zu einem billigen Anbieter, waehrend die Tabelle einen teuren enthaelt,
wird massiv ueberbucht — auf dem Kundenbeleg falsch. Die erste Verteidigung dagegen ist
der Boot-Abbruch (A-1/A-2), die zweite die Vertragspflicht des Adapters, seine ID zu
begruenden. **Kein Fallback kann diesen Fall richtig rechnen** — er kann nur sicher oder
unsicher falsch liegen, und sicher ist die Wahl.

### 4.6 Die neue Preisrechnung

```js
function tokenCostUsd(tokens, cfg) {
  const price = priceForModel(tokens.model, cfg.modelPricesUsd);
  return (
    (tokens.inputUncachedTokens / TOKENS_PER_M_TOK) * price.inPerMTok +
    (tokens.inputCacheWriteTokens / TOKENS_PER_M_TOK) * price.cacheWritePerMTok +
    (tokens.inputCacheReadTokens / TOKENS_PER_M_TOK) * price.cacheReadPerMTok +
    (tokens.outputTokens / TOKENS_PER_M_TOK) * price.outPerMTok
  );
}
```

Folgeaenderungen, vollstaendig:

| Stelle | Aenderung |
|---|---|
| `llm-usage.js` `inputTokensOf` (**:21**) | **entfaellt als Preis-Eingang.** Die Summe wird nur noch dort gebildet, wo eine Summe wirklich gebraucht wird (Bucket-Zaehler, Ledger-`quantity`) |
| `llm-usage.js` `billedTokens` (**:52**) | reicht die **vier** Sorten + `model` durch |
| `state-ops.js` `trackUsage` (**:2532**) | `usage.inputTokens += ` (Summe der drei Eingabe-Sorten) — Zahlenwert unveraendert |
| `state-ops.js` `turnIncrementsBookable` (**:2307**) | prueft **alle vier** Sorten statt zweier Felder |
| `llm-usage.js` `meterAiTokens` `quantity` (**:38**) | Summe der drei Eingabe-Sorten + Ausgabe — **Zahlenwert unveraendert**, weil `inputTokensOf` genau diese Summe war |
| `aiCostCents`, `tokenCostMicroCents` | unveraendert (leiten aus `tokenCostUsd` ab) |
| `estimatedAbortUsage` (**:94**) | unveraendert, siehe Befund F-1 |

**Befund F-1 (neu, am Code gefunden — gehoert in B4):** der Vertragskommentar in
`src/llm/ports.js` (`LlmTokenUsage.estimated`) nennt `inputUncachedTokens` die *"teuerste
Eingabeklasse"*. **Das ist mit den echten Raten falsch:** die 5m-Cache-Schreib-Rate liegt
bei allen drei Zeilen der Preistabelle **ueber** der Eingabe-Rate (1.25 > 1.00,
2.50 > 2.00, 3.75 > 3.00). Die Schaetzung landet also nicht auf der teuersten Sorte,
sondern rund 20 % darunter.

Empfehlung: **das Verhalten bleibt, die Behauptung wird korrigiert.** Eine synthetische
Buchung auf `inputCacheWriteTokens` wuerde eine Token-Sorte behaupten, die nie geflossen
ist — der Vertrag verbietet das (Vollstaendigkeits-Invariante). Und die Schaetzung ist an
anderer Stelle bereits kraeftig pessimistisch (`ESTIMATE_CHARS_PER_TOKEN = 3` gegen real
3,5-4, `llm-usage.js:83-85`), was den 20-%-Abstand mehr als aufwiegt. B4 aendert nur den
Klammerzusatz im Vertragskommentar auf *"die ungecachte Eingabeklasse"* — kein
Verhaltenswechsel, aber die Spec luegt danach nicht mehr.

### 4.7 W5 — wie weit muss die Aufschluesselung in den Store?

**Antwort: bis zur PREISRECHNUNG, nicht in den Store. Keine Migration, kein Backfill,
keine Schema-Aenderung.**

| Traeger | Heute | Nach B4 | Begruendung |
|---|---|---|---|
| `usage.inputTokens` / `.outputTokens` (Bucket, `defaults.js:564`; `schema.sql:353-354`) | 2 Zaehler, Summen | **unveraendert**, 2 Zaehler | Einzige Leser sind Anzeigen: `routes/api-read.js:40` und `globalUsageTotals` (`state-ops.js:2195-2212`). Die Gate-Kette liest sie nicht (2.5) |
| `usage_event.quantity` (`schema.sql:558`) | Summe | **unveraendert**, gleicher Zahlenwert | `quantity` ist die Stripe-MENGE, nicht die Preisbasis; der Preis steht daneben in `cost_cents`/`cost_micro_cents` |
| Preisrechnung `tokenCostUsd` | 2 Raten x 2 Summen | **4 Raten x 4 Sorten** | Hier und nur hier entsteht der Geldbetrag |

Warum **keine** vier Zaehler im Bucket:
1. Sie waeren eine Schema-Aenderung an `usage` (`schema.sql:351-357`) fuer zwei
   Anzeigefelder, die niemand aufgeschluesselt anzeigt.
2. Additiv-nullable ist genau der verworfene Weg (E-2). Vier neue Spalten ohne Backfill
   heissen: Bestandszeilen tragen `NULL`, und die Anzeige muss raten. Dieses Repo hat den
   Fall bezahlt (`did-miete-ohne-preis`).
3. Der Gate-Schutz haengt an keiner dieser Spalten.

**Restrisiko, benannt:** ohne vier Zaehler ist nachtraeglich nicht aus dem Store
rekonstruierbar, welche Sorte einen Betrag getrieben hat. **Die Diagnose-Ebene existiert
bereits woanders:** die LLM-Metrik traegt die Cache-Zaehler je Aufruf — belegt durch den
gruenen Bestandstest `test/llm.test.js:242` (*"T-I13-2: Metrik traegt bei Erfolg callId +
Cache-Zaehler aus resp.usage (additiv)"*, prueft `cache_creation_input_tokens` = 20 und
`cache_read_input_tokens` = 100). B4 baut hier nichts nach.

### 4.8 W6 und der Zuschnitt

Der Plan verlangt fuer den Betrag-Rueckgang eine Vorher-/Nachher-Messung **an echtem
Verkehr** (`tasks/todo.md`, "B4s gefaehrlichster Schritt"). Den gibt es nicht:

- kein Anruf seit 2026-08-04,
- Anthropic-Guthaben leer (gemessen 2026-08-08, HTTP 400).

**Was blockiert ist:** ausschliesslich die Messung selbst — die Aussage "der live gebuchte
Betrag sinkt um X % bei realem Cache-Treffer-Anteil Y". Sie ist ohne Verkehr nicht
erhebbar, und **eine Fixture-Rechnung ist keine Messung an echtem Verkehr.** Die Fixture
zeigt, dass die Arithmetik stimmt; sie sagt nichts ueber den realen Cache-Anteil, und
genau der ist die unbekannte Groesse in W6.

**Was NICHT blockiert ist:** alles andere. Die Tabellenform, die vier Raten, die
`validFrom`-Aufloesung, der Boot-Abbruch, `worstCasePrice`, die Umstellung von
`tokenCostUsd`, der Buchungstest je Adapter samt Gegenprobe und die Fixture-Rechnung
laufen vollstaendig gegen Attrappen und brauchen weder Guthaben noch Anruf.

**Vorgeschlagener Zuschnitt (Vorbild B3a/B3b):**

| Phase | Inhalt | Status |
|---|---|---|
| **B4a** | Preisquelle + Gate: 4.1 bis 4.7 vollstaendig, inkl. aller Tests aus Abschnitt 5 | **jetzt, vollstaendig abnehmbar** |
| **B4b** | Der gemessene Betrag-Rueckgang: erste Anrufe nach Wiederaufladung, alte und neue Formel nebeneinander, Owner sieht die Zahl | **blockiert** — wartet auf Guthaben + Verkehr |

B4b braucht **keinen** neuen Code: die vier Sorten stehen je Aufruf bereits in der
LLM-Metrik (4.7), die alte Formel ist Arithmetik auf denselben Zahlen. B4b ist ein
Ablesen und Rechnen, keine Entwicklung. Das ist die Bedingung dafuer, dass B4a
vollstaendig abnehmbar ist: B4a schuldet B4b keine Instrumentierung.

**Warum B4a trotz offener W6-Frage gemergt werden darf:** der Betrag-Rueckgang gefaehrdet
das Gate nur bei laufendem Verkehr. Es gibt keinen. Die Reihenfolge "erst richtig rechnen,
dann Verkehr" ist strikt sicherer als "erst Verkehr mit falscher Rechnung". Sobald wieder
Verkehr laeuft, ist B4b faellig, **bevor** das Ergebnis als abgehakt gilt.

### 4.9 W7 — der Traeger der taeglichen Perioden-Gegenprobe

**Antwort: nicht in B4. Zustaendig ist B5, hilfsweise eine eigene Betriebsphase.**

Die Praemisse "Render hat kein Cron" ist richtig, aber **nicht** der blockierende Grund —
ein In-Prozess-Traeger ist im Repo etabliertes Hausmuster:
`setInterval(...).unref()` in `src/boot.js:810` (Retention-Sweep), `src/boot.js:843` und
`src/wiring/web-login.js:56` (Release-Reconcile). Ein taeglicher Lauf haette also einen
Platz.

Die echten Gruende, ihn hier nicht zu bauen:

1. **Der Endpunkt gehoert zum Fremdanbieter.** `GET /user/balance` ist DeepSeek
   (Owner-Entscheidung 2026-08-08, Punkt 2). Ob Anthropic ein Aequivalent hat, ist
   **unbelegt** — im Repo findet sich keine Guthaben-Abfrage. Ohne Endpunkt kein Traeger.
2. **Die Gegenprobe braucht Verbrauch.** Sie vergleicht unseren gerechneten Betrag mit
   dem Guthabenverlauf. Bei 0 Anrufen vergleicht sie 0 mit 0 und prueft nichts.
3. **Der Port hat sie ausdruecklich ausgeschlossen:** `src/llm/ports.js` Kopfkommentar
   Zeilen 14-15 — *"die Perioden-Gegenprobe ist ein geplanter Betriebslauf, kein Aufruf im
   Gespraechspfad, und hat heute keinen Aufrufer."* Sie in B4 einzubauen hiesse, den
   frisch gemergten Vertrag in der naechsten Phase zu widerlegen.

**Zwischenloesung bis dahin:** ein Skript unter `scripts/` (Hausmuster: `scripts/stt-wer.mjs`,
`scripts/telnyx-call-latency.mjs`), das der Owner von Hand aufruft. **Zustaendig fuer die
Traeger-Entscheidung: Owner; zustaendig fuer den Endpunkt: B5.**

---

## 5. Abnahme (deterministisch)

Jeder Punkt ein Kommando mit erwarteter Ausgabe. Reihenfolge ist die Pruefreihenfolge.

### A-1 Syntax

```
node --check src/config.js && node --check src/store/state-ops.js \
  && node --check src/llm-usage.js && node --check src/boot.js
```
**Erwartet:** Exit 0, keine Ausgabe.

### A-2 Regressionssuite

```
npm test
```
**Erwartet:** `pass 4026`, `fail 0`, Exit 0 (roh 4046). **Sinkende Zahl = Blocker.**

> Diese Zahlen sind die **Lead-Vorgabe** aus dem Auftrag; sie wurden in dieser
> Spezifikations-Session **nicht selbst nachgemessen** (die Suite laeuft mehrere Minuten,
> und die Parallelitaets-Grenze erlaubt nur eine Bahn). Der Umsetzer misst den
> Ausgangsstand **vor** der ersten Aenderung selbst und vergleicht gegen den Endstand.

### A-3 Abnahmekriterium 2 der Owner-Vorgabe (woertlich), je Adapter

> *"Ein Test, der beweist, dass gebucht wird — je Adapter. Nicht 'die Funktion wurde
> aufgerufen', sondern: nach einem Turn mit Adapter X steht auf der Budget-Achse der
> erwartete Betrag. Und die Gegenprobe: ohne die Buchung ist der Test rot."*

Aufbau (neue Datei `test/llm-booking.test.js`, node:test, keine neue Dependency):

1. Store mit `DATA_DIR`-Override auf ein Temp-Verzeichnis, ein Tenant.
2. Ein **Adapter-Attrappe** nach `src/llm/ports.js`, deren `complete` ein `LlmTurn` mit
   einem festgelegten `LlmTokenUsage` liefert (die vier Sorten explizit gesetzt,
   `estimated: false`, `billingModelId: "claude-haiku-4-5"`).
3. Einen Turn fahren, `bookTokenUsage` durchlaufen lassen.
4. **Nicht** pruefen, dass eine Funktion gerufen wurde, sondern:
   `usageFor(store, tenantId).costMicroCentsRem` bzw. `.costCents` gegen den
   **vorab von Hand gerechneten** Betrag.

```
node --test test/llm-booking.test.js
```
**Erwartet:** alle Tests gruen, Exit 0.

**Die Gegenprobe ist PFLICHT und wird AUSGEFUEHRT** (nicht behauptet):

```
# 1. Buchung deaktivieren: in src/llm-usage.js bookTokenUsage den Rumpf auf `return;`
#    setzen (temporaer, NICHT committen)
node --test test/llm-booking.test.js ; echo "EXIT=$?"
```
**Erwartet:** `fail` > 0, `EXIT=1`. Der Testbericht muss den erwarteten gegen den
tatsaechlichen Betrag zeigen (0 statt X Mikro-Cent).

```
# 2. Aenderung zuruecknehmen
git checkout -- src/llm-usage.js
node --test test/llm-booking.test.js ; echo "EXIT=$?"
```
**Erwartet:** `EXIT=0`.

Beide Ausgaben gehoeren woertlich in den Phasenbericht. Ein Test, der ohne die Buchung
gruen bleibt, misst nichts — dieses Repo hat die Lehre bereits bezahlt
(`bench-must-reproduce-defect`, `i18n-w2-wave-complete`: *"Buchhaltung ersetzt ein Gate
nur, wenn der Bestandstest den SOLL-Zustand pinnt"*).

**Je Adapter:** heute existiert genau ein Adapter (`src/llm/adapters/anthropic.js`). Der
Test laeuft zusaetzlich einmal mit `toTokenUsage` des echten Anthropic-Adapters, gefuettert
mit einer roh nachgebauten Anthropic-`usage`-Antwort (`input_tokens`,
`cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`) — damit ist die
Kette Adapter -> Vertrag -> Buchung durchgemessen, nicht nur der Vertrag. Der
DeepSeek-Adapter bringt seinen eigenen Fall in B5 mit; das ist kein B4-Schuldposten.

### A-4 Boot-Abbruch (Spawn-Test)

Neuer Test in `test/` (Muster: die bestehenden Spawn-Tests mit `PORT=0` +
`DATA_DIR`-Override, `test/helpers.js`).

```
CLAUDE_MODEL=modell-ohne-preis PORT=0 node src/server.js ; echo "EXIT=$?"
```
**Erwartet:** `EXIT=1`, und auf stderr eine Zeile, die mit `[boot] Start abgebrochen:`
beginnt und die Modell-ID `modell-ohne-preis` woertlich nennt. **Kein** offener Port.

Gegenprobe im selben Test: derselbe Start **ohne** die Env-Ueberschreibung startet
(Exit != 1, `/healthz` antwortet). Sonst beweist der Test nur, dass der Server nie startet.

> **BASE_ENV-Falle:** neue config-Env-Vars gehoeren in `BASE_ENV` (`test/helpers.js`),
> sonst leakt die lokale `.env` in Spawn-Tests (Repo-Lehre `test-base-env-drift`).

Zusaetzlich je ein reiner Einheitstest (ohne Spawn) fuer A-4 bis A-6 aus 4.4 gegen
`resolveModelPrices` und `unpricedModels` — schnell und praezise; der Spawn-Test belegt
nur, dass der Abbruch wirklich den Prozess beendet.

### A-5 Nicht-Ausloeser bleiben Nicht-Ausloeser

```
REALTIME_MODEL=irgendwas-ohne-preis PORT=0 node src/server.js
```
**Erwartet:** startet normal (N-2). Ein Test dafuer verhindert, dass der Abbruch beim
naechsten Umbau still auf Modelle ausgeweitet wird, die keine Token buchen.

### A-6 Die Fixture-Rechnung

Werte aus der Repo-Fixture `test/llm.test.js:242-261` (T-I13-2):
`input_tokens = 5`, `cache_creation_input_tokens = 20`, `cache_read_input_tokens = 100`,
`output_tokens = 7`. Gerechnet unter **`claude-haiku-4-5`** (Raten 1.00 / 1.25 / 0.10 / 5.00).

**Vorher** — `inputTokensOf` faltet 5 + 20 + 100 = **125** Eingabe-Token auf die volle
Eingabe-Rate:

| Posten | Rechnung | USD |
|---|---|---|
| Eingabe 125 Tok x 1.00 | 125 / 1e6 x 1.00 | 0.000125 |
| Ausgabe 7 Tok x 5.00 | 7 / 1e6 x 5.00 | 0.000035 |
| **Summe vorher** | | **0.000160 USD** |

**Nachher** — vier Sorten, vier Raten:

| Posten | Rechnung | USD |
|---|---|---|
| ungecachte Eingabe 5 Tok x 1.00 | 5 / 1e6 x 1.00 | 0.000005 |
| Cache-Schreiben 20 Tok x 1.25 | 20 / 1e6 x 1.25 | 0.000025 |
| Cache-Lesen 100 Tok x 0.10 | 100 / 1e6 x 0.10 | 0.000010 |
| Ausgabe 7 Tok x 5.00 | 7 / 1e6 x 5.00 | 0.000035 |
| **Summe nachher** | | **0.000075 USD** |

**Differenz: 0.000085 USD** — der gebuchte Betrag sinkt auf **46,9 %** des bisherigen,
also um **53,1 %** bei diesem Cache-Mix (80 % der Eingabe-Token sind Cache-Treffer).

In Mikro-Cent (die Einheit von `tokenCostMicroCents`, Kurs 0.92, 100 Cent/EUR,
1e6 Mikro-Cent/Cent):
- vorher: 0.000160 x 0.92 x 100 x 1e6 = **14 720** Mikro-Cent
- nachher: 0.000075 x 0.92 x 100 x 1e6 = **6 900** Mikro-Cent

Diese beiden Zahlen sind der Erwartungswert des Buchungstests A-3.

**Ausdruecklich:** das ist eine Arithmetik-Probe an einer Fixture, **keine** Messung an
echtem Verkehr. Der reale Rueckgang haengt am realen Cache-Treffer-Anteil und ist W6/B4b.

### A-7 Formatierung

```
npx prettier --check src/config.js src/store/state-ops.js src/llm-usage.js src/boot.js test/llm-booking.test.js
```
**Erwartet:** `All matched files use Prettier code style!`

> `npm run lint` ist repo-weit kaputt (`ERR_MODULE_NOT_FOUND: @eslint/js`, Bestandsbefund
> aus B2, gegengeprueft an `src/llm.js`). Kein Blocker dieser Phase; `node --check` +
> `prettier --check` sind der Ersatz, wie in B2/B3a.

---

## 6. Pre-Mortem

Ein Jahr spaeter war B4 falsch. Was ist passiert?

| # | Szenario | Was dazu gefuehrt hat | Gegenmassnahme **in dieser Phase** |
|---|---|---|---|
| **P-1** | *"Die Kostendecke rechnete einen Monat falsch und niemand sah es."* | Die Sonnet-Staffel wechselte am 01.09.; ein Prozess lief ueber die Grenze, oder jemand trug die Zahl von Hand nach und vertippte sich. Die Achse hat keinen Beobachter — `console.warn` liest niemand | (a) `validFrom` in den Daten statt im Kopf eines Menschen (4.1); (b) Test mit `todayIso = "2026-09-01"`, der 3.00/15.00 erwartet (4.3); (c) gewaehlte + naechste `validFrom` im `[boot]`-Banner (4.2); (d) `STATUS.md`-Zeile "am 2026-09-01 neu deployen" |
| **P-2** | *"Der Boot-Abbruch legte die Telefonie lahm."* | Der Abbruch wurde auf einen Fall ausgeweitet, der keine Token bucht (Realtime-Modell), oder auf ein Datumskriterium (`asOf` veraltet). Ein Env-Tippfehler killte den Dienst statt eine Warnung zu erzeugen | (a) abschliessende Ausloeser-Liste A-1..A-6 **und** Nicht-Ausloeser N-1..N-6 (4.4); (b) `asOf`-Veralterung ist ausdruecklich WARN (N-3); (c) Test A-5 nagelt einen Nicht-Ausloeser fest; (d) Gegenprobe in A-4: ohne die Fehlkonfiguration startet der Dienst |
| **P-3** | *"Der Betrag-Rueckgang schwaechte das Gate unbemerkt."* | Der gebuchte Betrag sank (belegt: -53 % bei der Fixture), die Decke griff spaeter, und niemand hat den realen Cache-Anteil je gemessen | (a) Der Rueckgang wird **beziffert** und steht in der Abnahme (A-6), nicht nur als Richtungsaussage; (b) der Zuschnitt trennt B4b ausdruecklich ab und erklaert ihn zur Pflicht, sobald Verkehr laeuft (4.8); (c) der Gate-Schutz haengt nicht allein an der KI-Achse: Outbound setzt Abo+KYC voraus, `OUTBOUND_FROZEN` bleibt der Notaus (`CLAUDE.md` Regel 1, E10) |
| **P-4** | *"Die Preise aenderten sich und die Tabelle blieb stehen."* | Der Anbieter erhoehte ausserhalb eines angekuendigten Termins; `asOf` blieb auf 2026-08-08 stehen; niemand lief die Gegenprobe | (a) `asOf` + `source` sind **Pflichtfelder je Staffel** (E-2/4.1) — die Veralterung ist ablesbar statt unsichtbar; (b) Boot-WARN bei altem `asOf` (N-3); (c) W7 ist als offener Punkt **mit Zustaendigem** benannt statt stillschweigend fallengelassen (4.9); (d) der Fail-closed-Zweig ist ab jetzt eine punktweise Obergrenze (4.5) — eine veraltete Tabelle unterbucht damit hoechstens innerhalb ihrer eigenen Preiswelt |
| **P-5** | *"Wir haben die Preisrechnung umgestellt und still eine Sorte doppelt oder gar nicht gezaehlt."* | Vier Summanden statt zwei; ein Copy-Paste-Fehler an einer Rate faellt in keinem gruenen Test auf, weil alle Fixture-Werte gleich aussehen | Die Fixture-Werte 5 / 20 / 100 / 7 sind **paarweise verschieden** und die vier Raten ebenfalls (1.00 / 1.25 / 0.10 / 5.00) — jede Vertauschung aendert das Ergebnis. Repo-Lehre `rca-lessons-timezone-and-fixtures`: *"gleiche Fixture-Werte testen nichts"* |
| **P-6** | *"Der Boot-Guard prueft die Modelle, aber nicht die Vollstaendigkeit der Raten — ein Eintrag mit drei Raten lief still weiter."* | `unpricedModels` prueft nur die **Existenz** des Schluessels (`Object.hasOwn`, `boot-guard.js:197`), nicht die Form des Werts | Ausloeser A-4: `resolveModelPrices` wirft bei unvollstaendiger Staffel. Das ist der eigentliche Grund fuer E-2 |

---

## 7. Weisse Flecken

| # | Offen | Zustaendig |
|---|---|---|
| **WF-1** | **W6 selbst:** wie stark sinkt der gebuchte Betrag bei **echtem** Cache-Treffer-Anteil? Nicht erhebbar (kein Anruf seit 2026-08-04, Anthropic-Guthaben leer) | **B4b**, sobald Guthaben + Verkehr existieren. Owner laedt auf |
| **WF-2** | **W7-Traeger und der Anthropic-Endpunkt.** Ob Anthropic ein Guthaben-Aequivalent zu DeepSeeks `GET /user/balance` hat, ist **unbelegt** — im Repo existiert keine Abfrage | Endpunkt: **B5**. Traeger-Entscheidung (Skript vs. In-Prozess-Intervall): **Owner** |
| **WF-3** | Die Eingabe-Groesse eines Briefings (Annahme A2: ~2000 Token) ist **unbelegt**. Sie beeinflusst nur die Groessenordnung des Sonnet-Befunds, keine Entscheidung | **B4b** misst sie nebenbei mit |
| **WF-4** | **Der Realtime-Pfad bucht seine OpenAI-Token ueberhaupt nicht.** `grep`: kein `bookTokenUsage`-Aufrufer in `src/bridge.js`; `realtimeModel` (`config.js:1374`) steht in keiner Preistabelle. Bestandsbefund, **nicht** von B4 verursacht und ausdruecklich nicht B4s Auftrag (N-2) | **Owner** entscheidet, ob das eine eigene Phase wert ist. `VOICE_ENGINE=realtime` ist heute nicht der Live-Default |
| **WF-5** | Ob die veroeffentlichte Preisliste tatsaechlich das ist, was abgerechnet wird, bleibt die **einzige verbleibende Annahme** der gesamten Kostenrechnung (Owner-Entscheidung 2026-08-08, Punkt 2). Genau das prueft die Gegenprobe, die es noch nicht gibt | **W7 / B5** |
| **WF-6** | Die exakte Testzahl 4026/4046 wurde in dieser Session **nicht selbst gemessen** (Lead-Vorgabe uebernommen) | **Umsetzer** misst den Ausgangsstand vor der ersten Aenderung |
| **WF-7** | `usdToEur = 0.92` ist laut eigenem Kommentar eine **ANNAHME** von 2026-07 (`config.js:202-203`). Ein falscher Kurs verschiebt jeden Betrag dieser Phase proportional | Ausserhalb B4 (Kurs-Achse, `assertProviderRateInBand`). **Owner** |

---

## 8. Nicht-Ziele

Was B4 ausdruecklich **nicht** tut:

| Nicht-Ziel | Warum / wer stattdessen |
|---|---|
| **Die Anfrageseite neutralisieren** (`LlmRequest.system` / `.messages` / `.tools` sind als `*` typisiert, "innere Form nicht Teil des Vertrags") | **B3b.** Das ist die groesste offene Kante des Vertrags (B2-Befund 2). B4 fasst die Antwort-/Buchungsseite an, nicht die Anfrage |
| **Einen DeepSeek-Adapter bauen**, Modellwahl `flash` vs. `pro`, W8 (traegt DeepSeek das Gespraech?), W2 (unparsebare Werkzeug-Argumente) | **B5.** B4 legt nur die Preisstruktur, in die ein DeepSeek-Eintrag passt |
| **DeepSeek-Preise eintragen** | Erst mit dem Adapter (B5). Ein Preiseintrag ohne Adapter waere ein Eintrag ohne Leser — und wuerde ueber `worstCasePrice` die Fail-closed-Obergrenze verzerren |
| **`usdToEur` anfassen** | Eigene Achse mit eigenem Guard (`assertProviderRateInBand`, `boot.js:137`) und eigenem Gate-Test (`test/fx-single-source.test.js`) |
| **Schema-Migration / Backfill / neue Store-Spalten** | 4.7: nicht noetig, und additiv-nullable ist verworfen (E-2) |
| **Die Faltung `inputTokensOf` fuer Bucket-Zaehler und Ledger-`quantity` abschaffen** | Dort ist eine Summe die richtige Groesse. Nur die **Preisrechnung** wird aufgeschluesselt |
| **`MAX_BUDGET_EUR` / die Plattform-Achse** | E-8, Owner-Entscheidung E10 vom 2026-07-30: Beobachtung, kein Gate |
| **Die pro-Tenant-Kostendecke fuer Inbound lockern** | E-7. E11 ist **zurueckgezogen**; Inbound-Token buchen live auf genau diese Achse (`claude.js` -> `llm-usage.js:66` -> `bookCents`) |
| **Die 1h-Cache-Rate mitfuehren** | Kein Aufrufer (`CACHE_CONTROL_EPHEMERAL` ohne `ttl`, `claude.js:543`). Stattdessen ein Quelltext-Gate-Test (Abschnitt 1) |
| **Den Realtime-/OpenAI-Kostenpfad schliessen** | WF-4, eigener Befund, eigene Entscheidung |
| **Eine Guthaben-Abfrage in den Port aufnehmen** | `src/llm/ports.js` schliesst sie ausdruecklich aus (Kopfkommentar Zeilen 14-15) |
