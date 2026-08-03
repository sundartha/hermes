# KV-P2 - Decken-Rechnung (Pre-Mortem TOD 1), Vorbedingung des Merges

Stand 2026-08-03, gerechnet gegen den **Code auf `master`** (Basis `d188802`), nicht gegen
die Zahlen im Plan-Dokument. Jede Eingangsgroesse unten ist am Quelltext belegt (Datei +
Symbol), damit die Rechnung nachrechenbar bleibt, wenn eine Zahl spaeter wandert.

## 1. Eingangsgroessen (am Code belegt)

| Groesse | Wert | Fundstelle (Symbol, nicht Zeilennummer) |
|---|---|---|
| Starter, verkaufte Minuten | 30 | `src/plans.js`, `PLAN_CATALOG[starter].includedMinutes` |
| Starter, Abo-Preis | 499 EUR-Cent | `src/plans.js`, `amountCents` / `currency: "eur"` |
| Business, verkaufte Minuten | 120 | `src/plans.js`, `PLAN_CATALOG[business].includedMinutes` |
| Business, Abo-Preis | 999 EUR-Cent | `src/plans.js`, `amountCents` |
| Kopffreiheit Starter / Business | 5/3 bzw. 5/4 | `src/billing/plan-caps.js`, `PLAN_CAP_HEADROOM` |
| Decken-Formel | `includedMinutes * voiceTariffDefaultCents * num/den` | `src/billing/plan-caps.js`, `planCapCents` |
| Worst-Case-Satz (Ausland) | 30 EUR-Cent/min | `src/config.js` `voiceTariffDefaultCents` (fallback 30), `.env.example`=30, `render.yaml`=30 |
| Inlandssatz (+49/+33/+44 an BEIDEN Enden) | 20 EUR-Cent/min | `src/config.js` `voiceTariffDomesticCents` (fallback 20), `.env.example`=20, `render.yaml`=20 |
| Decke ohne Plan-Zeile | 1500 EUR-Cent | `src/config.js` `defaultTenantBudgetCents` (fallback 1500), `.env.example`/`render.yaml`=1500 |
| **Inbound-Satz (NEU, KV-P2)** | **6 EUR-Cent/min** | `src/config.js` `voiceTariffInboundCents` (neu, fallback 6) |
| Absolute Gespraechs-Obergrenze | 1800 s = 30 min | `src/store/defaults.js` `MAX_CALL_DURATION_CAP_S` |
| Provider->Bucket-Kurs (USD-ct -> EUR-ct) | 0,92 | `src/config.js` `providerToBucketRateMicro` = 920000 |

**Gemessener Ist-Satz (KV-M1, 2026-08-03):** 1,87 **US**-Cent je angefangener Minute
(3,731 US-Cent fuer 2 angefangene Minuten, Anker `call_msczw0irl06s`). Umgerechnet auf die
Bucket-Waehrung: 1,87 x 0,92 = **1,72 EUR-Cent/min**. Der gewaehlte Satz von 6 EUR-Cent
traegt damit einen Sicherheitsaufschlag von **3,5x ueber dem Ist** und liegt **5x unter**
dem Outbound-Worst-Case (30).

**Konfigurationsgrenze der Messung (gilt fuer jede Zahl unten):** US-DID, `VOICE_ENGINE=budget`,
Sprache `de`, ElevenLabs-TTS aktiv, Assistant-Pfad NICHT beteiligt (0 `ai-voice-assistant`-Belege),
EIN Anruf, 79,6 s. Nicht gemessen: +49-DID (existiert im Bestand nicht), Assistant-Pfad,
lange Gespraeche, andere Sprachen. 71 % der Kosten sind `speech-to-text` und skalieren mit
der SPRECHZEIT, nicht mit der Verbindungsdauer.

## 2. Die Rechnung je Katalog-Tarif

Decke = `planCapCents(slug, cfg)`. Alle Betraege in GANZZAHL EUR-Cent.

### Starter

- Decke: `30 * 30 * 5/3` = **1500 ct** (15,00 EUR)
- Inbound-Satz: 6 ct/min
- **Rein inbound bis zur Sperre:** `1500 / 6` = **250 Inbound-Minuten**
- Nach vollem Outbound-Kontingent, **inlaendisch** (`30 * 20` = 600 ct verbraucht):
  `900 / 6` = **150 Inbound-Minuten**
- Nach vollem Outbound-Kontingent, **Ausland** (`30 * 30` = 900 ct verbraucht):
  `600 / 6` = **100 Inbound-Minuten**

### Business

- Decke: `120 * 30 * 5/4` = **4500 ct** (45,00 EUR)
- **Rein inbound bis zur Sperre:** `4500 / 6` = **750 Inbound-Minuten**
- Nach vollem Outbound-Kontingent, **inlaendisch** (`120 * 20` = 2400 ct):
  `2100 / 6` = **350 Inbound-Minuten**
- Nach vollem Outbound-Kontingent, **Ausland** (`120 * 30` = 3600 ct):
  `900 / 6` = **150 Inbound-Minuten**

### Tenant ohne eigene `tenant_budget`-Zeile

Decke = `defaultTenantBudgetCents` = 1500 ct -> **250 Inbound-Minuten**, identisch zu Starter.

## 3. Die Gegenprobe (die eigentliche Frage von TOD 1)

> Kann ein Kunde seine **GEKAUFTEN** Minuten vollstaendig inbound telefonieren, ohne in die
> Geld-Decke zu laufen?

| Plan | gekaufte Minuten | Kosten inbound (Minuten x 6 ct) | Decke | Auslastung der Decke | Urteil |
|---|---|---|---|---|---|
| Starter | 30 | 180 ct | 1500 ct | **12 %** | **JA** |
| Business | 120 | 720 ct | 4500 ct | **16 %** | **JA** |

**URTEIL: JA - fuer beide Katalog-Tarife, mit Faktor 8,3 (Starter) bzw. 6,25 (Business)
Reserve.** Die Decke muss fuer KV-P2 **nicht** angehoben werden; die in TOD 1 formulierte
Merge-Blockade greift nicht.

Gegenprobe der Gegenprobe (was ein NEIN erzeugt haette): ein Inbound-Satz oberhalb von
`1500/30` = **50 ct/min** (Starter) bzw. `4500/120` = **37,5 ct/min** (Business) haette die
gekauften Minuten unbezahlbar gemacht. Der ausdruecklich verworfene Rueckfall auf den
Outbound-Worst-Case (30 ct/min) haette 30 Inbound-Minuten mit 900 von 1500 ct belastet -
60 % der Decke fuer das, was der Kunde bezahlt hat, und nach 50 Inbound-Minuten die Sperre,
bei realen Kosten von 50 x 1,72 = 86 EUR-Cent. Deshalb 6 und nicht 30.

## 4. Was die Rechnung NICHT deckt (ehrlich benannt)

1. **Die Geld-Achse traegt mehr als Carrier-Minuten.** Auf dieselbe Zahl buchen KI-Tokens
   (`bookTokenUsage` -> `trackUsage`) und die Recherche-Gebuehren
   (`addResearchFeeCostCents`). Die 250 Inbound-Minuten sind eine Obergrenze bei sonst
   leerer Decke, kein garantierter Rahmen. Groessenordnung aus KV-M1: 5 KI-Turns eines
   80-s-Gespraechs runden im Ledger auf 0 Cent; die Gate-Achse akkumuliert sie in
   Mikro-Cent. Sie verschieben das Bild nicht um eine Groessenordnung.
2. **Die DID-Monatsmiete ist NICHT enthalten.** Sie erreicht die Gate-Achse heute nicht
   (Landkarten-Zeile `number_month`, `gate: false`) und kommt erst mit KV-P4. Bei einer
   Miete in der Groessenordnung des Listenpreises (`numberMonthlyCostCents`, 92 ct) frisst
   sie rund 6 % der Starter-Decke. Diese Rechnung ist dann zu wiederholen.
3. **Der Ist-Abgleich fuer Inbound fehlt noch (KV-P3).** Zwischen Buchung und Korrektur
   stehen `COST_TRUING_DELAY_MINUTES` (30) plus ein Sweep-Takt (1 h). Bis dahin steht die
   Schaetzung von 6 ct/min - rund 3,5x ueber dem gemessenen Ist. KV-P2 ohne KV-P3 ist die
   harte Variante; die Reichweite oben ist damit die PESSIMISTISCHE.
4. **N7 (Bestandsverhalten, Owner-bestaetigt, NICHT zu reparieren):** das verkaufte
   Minuten-Kontingent verbraucht Inbound bereits heute richtungsblind
   (`voiceMinutesUsedSince` filtert auf kind + tenantId + Zeit, NICHT auf Richtung), sperrt
   damit aber nur Outbound (`planMinutesExceeded` -> `minutes`-Gate in
   `outbound-gates.js`). Bei einem Kunden, der beide Richtungen nutzt, beisst deshalb das
   Minuten-Kontingent **vor** der Geld-Decke: 30 Minuten Gesamtverkehr kosten hoechstens
   `30 * 30` = 900 ct, also weniger als die Decke von 1500 ct. Die Geld-Decke bindet allein
   bei dem Kunden, der **ueberwiegend angerufen wird** - genau dem Missbrauchsfall, den
   KV-P2 abdeckt.
5. **Ein einzelnes Gespraech ist gedeckelt.** `MAX_CALL_DURATION_CAP_S` = 1800 s: ein
   einzelnes Inbound-Leg kann hoechstens `30 * 6` = 180 ct erzeugen, auch wenn jede andere
   Bremse ausfaellt.
