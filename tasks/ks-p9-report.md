# KS-P9 — Plattform-Achse verliert die Sperrwirkung (E10)

Commit: `b1e1b19` auf `phase/ks-p9-plattform-beobachtung` (Basis `master` = `0a87e50`).

---

## 1. Trennung an `spendCapCoherence`

**Gefallen: Klausel A (`TENANT_DEFAULT_INERT`, FATAL).** Sie prüfte
`tenantDefaultCents >= platformCapCents` und nannte das Ergebnis „die Tenant-Achse ist
WIRKUNGSLOS, der globale Plattform-Cap bindet immer zuerst". Genau diese Begründung ist
mit KS-P9 unwahr: es gibt keinen Plattform-Cap mehr, der zuerst bindet. Ein Guard, dessen
Aussage falsch ist, wurde **gelöscht** — nicht auf WARN abgesenkt.

**Geblieben: Klausel A0 (WARN)** — `DEFAULT_TENANT_BUDGET_CENTS=0` ist der dokumentierte
Sentinel; die Meldung nennt jetzt `MAX_BUDGET_EUR*100=<n>` als **Pro-Tenant-Decke**
(`effectiveCapCents` Stufe 3) statt als „geteilten Plattform-Cap".

**Geblieben: Klausel B (FATAL, GAP-32).** Sie vergleicht die Worst-Case-Reserve
(`VOICE_TARIFF_DEFAULT_CENTS * maxCallDurationS`) gegen die **Tenant**-Decke
`DEFAULT_TENANT_BUDGET_CENTS`. In dieser Rechnung kommt keine Plattform-Zahl vor — sie
hängt an keiner Stelle an der entfallenen Achse. Entfernt wurde ausschließlich der
Meldungs-Nachsatz „(und echt unter `MAX_BUDGET_EUR*100=…` halten)", weil dieser Ratschlag
auf Klausel A verwies. Alle test-gepinnten Fragmente
(`DEFAULT_TENANT_BUDGET_CENTS=…`, `VOICE_TARIFF_DEFAULT_CENTS=…`, `… Cent`,
`mindestens …`, `max_duration_s=…`) stehen wörtlich unverändert.

**G27-Nachzug:** der A0-Early-Return machte bisher `tenantDefaultCents > 0` strukturell
wahr für Klausel A *und* B. Nach dem Wegfall von A trägt diese Aussage **allein** die
Divisionssicherheit von `affordableCallDurationS` — das steht jetzt so im Doc-Block.

**Feststellung: kein Guard wurde von FATAL auf WARN gesenkt.** Auch nicht bei
`PLAN_CAP_FINDING`: `PLAN_CAP_INERT` (FATAL) und `TENANT_CAP_ROW_INERT` (WARN) sind
gelöscht, `PLAN_CAP_UNDERIVABLE` bleibt FATAL. `planCapInertFindings` heißt nach dem
Wegfall des INERT-Zweigs `planCapUnderivableFindings` (N1/G20: der Name beschreibt, was
übrig ist) und verliert den nun unbenutzten Parameter `platformCapCents`.

## 2. Klemme in `deriveTenantBudgetFromPlan` — Begründung der Entfernung

Die Klemme (`capCents >= platformCapCents → capCents = platformCapCents` + WARN) war die
**dritte Klausel derselben Prämisse** „der Plattform-Cap bindet zuerst". Ihr eigener
Kommentar sagte, dass sie bei kohärenter Konfiguration unerreichbar ist, weil die erste
Linie (`PLAN_CAP_INERT`) am Boot fatal ist — genau diese erste Linie entfernt KS-P9.

Wäre sie stehengeblieben, hätte **diese Phase** aus einem schlafenden Pfad einen scharfen
gemacht: sobald der Betreiber `MAX_BUDGET_EUR` als Warnschwelle niedrig setzt (was die
Phase erst ermöglicht), hätte der nächste Stripe-Webhook eine verkaufte Business-Decke von
900 ct still auf den Warnwert gekürzt — mit einer WARN-Zeile, ohne Boot-Guard. Das wäre ein
von KS-P9 **eingeführter** Geldpfad-Defekt gewesen.

**Abgrenzung zu KS-P5a:** die wörtliche Phasen-Zuordnung sah die Klemme bei KS-P5a. Nach
KS-P9 hat KS-P5a an dieser Stelle nur noch **festzustellen**, dass die Klemme weg ist; das
eigentliche Thema von KS-P5a (die zu enge Starter-Plan-Decke von 300 ct) ist unberührt.

## 3. Begründete Ausnahme: `spendOrDeny` bleibt mit einem Aufrufer stehen

Nach dem Wegfall von `globalSpendOrDeny` hat der gemeinsame Rumpf `spendOrDeny` nur noch
`tenantSpendOrDeny` als Aufrufer. Ein Inline wäre ein S4-Gewinn, würde aber den
fail-closed D7-Riegel der **Tenant**-Geldkante editieren. Vorrang hat, dass die
pro-Tenant-Achse in dieser Phase byte-identisch bleibt — geändert wurde nur der
Doc-Kommentar. Das ist bewusst als Nachbarbefund für eine spätere Phase notiert, nicht
gefixt.

## 4. Belege

### 4.1 Mutationsproben (rot VOR / grün NACH)

Durchgeführt gegen den Vorzustand per `git checkout master -- src/` (kein `git stash` —
`refs/stash` ist worktree-geteilt), danach `git checkout HEAD -- src/`.

Neue Datei `test/ks-p9-platform-axis-observation.test.js`, gegen **alten** `src/`:

| Test | vorher | nachher |
|---|---|---|
| (1) Summe über der Plattform-Zahl → beide Tenants frei, Reserve gebucht | **rot** | grün |
| (1b) eigene Tenant-Decke sperrt (Gegenprobe) | grün | grün |
| (2) Warnung sieht dieselbe Summe inkl. In-Flight, genau einmal je Spend-Monat | **rot** | grün |
| (3) Modul-Exporte: `globalBudgetExceeded`/`globalReserveExceedsBudget` weg | **rot** | grün |
| (4) budget-Glied ohne `globalBudgetExceeded`-Methode am Store (`TypeError`) | **rot** | grün |
| (5) budget-Glied scharf auf der Tenant-Achse (402, `grund=budget_tenant`) | grün | grün |

Invertierte Bestandstests, gegen **alten** `src/` (`48 tests / 8 fail`, alle 8 sind die
invertierten):

- `outbound-tenant.test.js` — „KS-P9: die Plattform-Summe sperrt nicht mehr — A telefoniert
  trotz gerissener Summe" (HTTP-Ebene, stärkster Beweis)
- `tenant-budget-cap.test.js` — INV(2)
- `reservation-ledger.test.js` — „pro-Tenant frei → reserviert, auch wenn die Plattform-Summe
  die Zahl reisst"
- `store-pg-tenant-budget.test.js` — „P4 Test 3 (KS-P9)"
- `plan-cap-unclamped.test.js` — (j2a), (j2b), (j4)
- `deny-diagnosability.test.js` — „reserve_budget-Gate, unbuchbarer Reserve-Betrag:
  ziffernfreier Sperrtext, `grund=reserve_erschoepft`"

Nach dem Zurückschreiben von `src/`: dieselben 54 Tests **54/54 grün**.

### 4.2 Testlauf

```
npm test  ->  tests 3553 / pass 3553 / fail 0
              korrigiert (i18n-catalog-run): tests 3533 / pass 3533 / fail 0
```

Beide Store-Backends sind abgedeckt: die pglite-in-process-Tests
(`store-pg-tenant-budget`, `store-backend-parity`) laufen in derselben Suite,
`skipped 0`.

`node --check` grün auf allen 12 geänderten `src/`-Dateien und allen geänderten
Testdateien.

### 4.3 grep-Kriterium

```
grep -rn "globalBudgetExceeded\|globalReserveExceedsBudget\|globalSpendOrDeny\|platformHalt\
\|PLATFORM_DENIAL_REASON\|budget_platform\|budget_global\|plan_cap_inert\|tenant_default_inert\
\|tenantCapRowInertFindings" src/ test/
```

**`src/` — 0 Treffer.** In `test/` bleiben 11 Treffer, ausnahmslos Prosa, kein
ausführbarer Bezug:

- 4× `test/ks-p9-platform-axis-observation.test.js` — das **Regressionsschloss selbst** muss
  die Namen nennen, um ihre Abwesenheit zu prüfen (Plan §2.1(3)). Literal null Treffer ist
  hier per Konstruktion unmöglich.
- 5× Kommentare, die den **Wegfall dokumentieren** (`p15-gate-denial-language`,
  `env-docs-spend-cap-coherence`, `boot-failclosed` ×2, plus der Testname
  „…kein plan_cap_inert mehr").
- 2× `test/prod-env.js` — eine **historische Messung** vom 2026-07-25 (der damalige
  Boot-Abbruch bei `MAX_BUDGET_EUR=8`). Nicht rückwirkend umgeschrieben, sondern als
  `HISTORISCH — Guard mit KS-P9/E10 entfallen` markiert.

Der Beobachtungspfad ist intakt: `claimPlatformSpendWarning|platformSpendObservedCents|
gatePlatformUsageCents` trifft nur `src/store/state-ops.js`, die Fassade
(`store.js`/`json.js`/`pg.js`), `src/store/defaults.js` (Doc) und
`src/telephony/outbound-gates.js` (`emitPlatformSpendWarning`).

### 4.4 Smoke (lokal, `SKIP_TWILIO_SIGNATURE_CHECK=true`)

Bewusst mit der Konstellation gefahren, die **vorher zweifach fatal** war:
`MAX_BUDGET_EUR=8` (800 ct, unter der Business-Plan-Decke 900 ct → `plan_cap_inert`) **und**
`DEFAULT_TENANT_BUDGET_CENTS=1500 >= 800` (→ `tenant_default_inert`).

```
[boot] Konfig-Warnung: PLATFORM_ALERT_SMS_TO ist leer - Plattform-Warnung ... nur ins Audit-Log ...
  Hermes Gateway laeuft auf http://localhost:3987
  Budget-Achse:   Tenant Perioden-Fenster (...) | Plattform Lebenszeit-Topf (...) (nur Beobachtung/Warnschwelle, KS-P9)
  Kosten-Decken:  Tenant-Default 1500 ct | Plattform-Warnschwelle 800 ct | Worst-Case-Tarif 300 ct/min
```

- `GET /healthz` → **200**
- `POST /voice/incoming` → TeXML mit `<Gather>` + Begrüßung (Inbound wird angenommen)
- `POST /api/calls` → 403 am ownerName-Gate (Gate 3) — die Kette baut und läuft ohne
  `TypeError` auf einer fehlenden Plattform-Methode

## 5. Pre-Mortem-Nachtrag (Betriebs-Vorbehalt)

Die Warnschwelle ist ab jetzt die **einzige** Wirkung der Plattform-Achse. Ohne gesetztes
`PLATFORM_ALERT_SMS_TO` läuft sie **nur ins Audit-Log** — im Smoke oben wörtlich belegt.
`alertChannelFindings` bleibt scharf (FATAL bei `PAYMENT_ENABLED=true` +
`PLATFORM_SPEND_WARN_PERCENT>0` + leerem Empfänger) und ist damit der Riegel, der diesen
Zustand in Produktion verhindert.

**Bewusst getragenes Restrisiko:** zwischen KS-P9 und KS-P5a gilt für Starter-Kunden
weiterhin die zu enge Plan-Decke (300 ct). KS-P9 verschärft das nicht und hebt es nicht auf.

## 6. Nachbarbefunde (nur notiert, NICHT gefixt)

1. **`spendOrDeny` mit einem Aufrufer** — s. §3. Inline-Kandidat für eine Phase, die die
   Tenant-Geldkante ohnehin anfasst.
2. **`globalCapCents` heißt irreführend.** Die Funktion liefert seit KS-P9 in beiden
   Verwendungen (`effectiveCapCents` Stufe 3, Warnschwelle) keine „globale" Sperrgröße mehr.
   Ein Rename (z. B. `platformReferenceCents`) wäre N1-korrekt, war aber nicht im Scope.
3. **`COST_TRUING_REQUIRED_RECORD_TYPES=""` bleibt der Boot-Blocker des Blueprints** —
   im Smoke erneut reproduziert, vorbestehend und unabhängig von KS-P9.
4. **4 tote `globalBudgetExceeded`-Stubs** lagen außerhalb der im Plan aufgezählten Dateien
   (`gap-35-metrics-country`, `telnyx-k0-turn-seq`, `p4-billing-hold-gate`,
   `outbound-gates-order`) — hier entfernt (G12), da sonst tote Kontraktfläche zurückbliebe.
