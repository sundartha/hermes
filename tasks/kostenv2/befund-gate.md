# Befund: Geld-Sperrkette und Multi-Tenant-Wirksamkeit (O6, O7)

Stand 2026-08-30. Nur Lesen (Code + `SELECT`-Gegenprobe auf Prod-DB), kein Schreibzugriff,
keine Anbieter-Calls. Diese Datei ist Beobachtung EINES Beobachters, nicht die Wahrheit -
wo mein Befund dem AUFTRAG.md widerspricht oder es praezisiert, ist das ausdruecklich
markiert.

## 1. Die Kette vom Guthaben bis zur Ablehnung (BELEGT)

Kette, jedes Glied mit Datei:Zeile, in Aufrufreihenfolge von der Datenbasis zur
Entscheidung:

| Glied | Ort | Was es tut |
|---|---|---|
| Datenbasis | `tenant_budget`-Zeile (pro Tenant) | `hard_cap_cents`/`budget_cents`, gelesen ueber `tenantBudgetRow` |
| `effectiveCapCents` | `src/store/state-ops.js:3847` | Praezedenz: (1) `tenant_budget.hard_cap_cents`, sonst (2) `cfg.defaultTenantBudgetCents` wenn `>0`, sonst (3) `globalCapCents(cfg)` |
| `gateUsageCents` | `src/store/state-ops.js:3902-3905` | Schaltet zwischen zwei IST-Achsen: `cfg.budgetMonthEnabled` -> `spendMonthUsageCents`, sonst (LIVE-Default) -> `budgetPeriodUsageCents` |
| `budgetPeriodUsageCents` | `src/store/state-ops.js:3877` | `max(0, bucket.costCents - bucket.budgetPeriodBaselineCents)` - die Perioden-Achse |
| `tenantUsageAxes`/`tenantSpendOrDeny` | `src/store/state-ops.js:3966` / `:3973` | Buendelt Gate-Groesse + Lebenszeit-Gegenprobe (D7-Riegel, `usageAxesBookable`) |
| `liveBudgetExceeded` | `src/store/state-ops.js:3992` | `spend.spent + liveCents >= effectiveCapCents(...)` - die MID-CALL-Pruefung |
| `budgetExceeded` | `src/store/state-ops.js:4011` | `liveBudgetExceeded(s, tenantId, 0, cfg, nowIso)` - dieselbe Frage ohne laufenden Zusatzverbrauch (Dial-Gate, Inbound-Reject) |
| `blockingBudgetAxis` | `src/budget-gate.js:14-23` | Ruft `store.liveBudgetExceeded` und liefert die EINE Geld-Achse (`BUDGET_AXIS.TENANT`) oder `null` |
| `reserveExceedsBudget` | `src/store/state-ops.js:4029` | `spend.spent + reservationFor(...) + reserveCents > effectiveCapCents(...)` - Vorab-Pruefung |
| `reserve_budget`-Gate | `src/telephony/outbound-gates.js:892` (Schritt), Entscheidung in `reserveOutcome` (`:548`) via `store.tryReserveOutboundBudget`/`reserveExceedsBudget` | LETZTES Gate vor dem Waehlen, atomar unter `store.withStoreLock` |

Aufrufer von `blockingBudgetAxis` (alle lesen dieselbe EINE Funktion, keine Kopie der
Entscheidung):
- `src/claude.js:822` - Turn-Schleife der Budget-Engine (Inbound UND Outbound-Telnyx-Weg)
- `src/telnyx-llm-shim.js:789` - Mid-Call-Pruefung auf dem ElevenLabs-Outbound-Leg
- `src/routes/webhooks-elevenlabs.js:207` und `:319` - Werkzeug-Webhook des EL-Agenten
  (get_consult/look_up), prueft VOR der Wirkung
- `src/telephony/call-lifecycle.js:184` und `src/server.js:226` - Re-Attach-Pruefung
- `src/routes/voice.js:302` ruft NICHT `blockingBudgetAxis`, sondern direkt
  `store.budgetExceeded(tenantId, config.billing)` - der Inbound-Vorab-Check vor dem ersten
  Turn

**Wo eine zusaetzliche, nachtraeglich gebuchte Kostenart wirksam wuerde:** Jede Schreibstelle,
die ueber `bookCents` (`state-ops.js:3609`) auf `usage.costCents` schreibt - das ist die
EINZIGE Schreibstelle beider Geld-Achsen fuer nicht-negative Betraege (Kommentar
`state-ops.js:3572-3595`, G5-Prinzip). `addVoiceUsageCostCents` (`state-ops.js` nahe
`3660`), `addResearchFeeCostCents`, `trackUsage` (KI-Token) und die POSITIVE Korrektur
`bookCostCorrectionCents` (`:3780`, Zweig `deltaCents > 0`) laufen alle hier durch. Eine
neu gebuchte Kostenart wird WIRKSAM, sobald sie ueber eine dieser Stellen `usage.costCents`
erhoeht - ab dann sieht JEDE nachfolgende Auswertung von `effectiveCapCents`/`gateUsageCents`
denselben, erhoehten Wert (STRUKTURELL erzwungen: eine Zahl, kein Duplikat).

**Wo sie NICHT wirksam wuerde - das ist der entscheidende Befund fuer O6/das Strategiedokument:**
1. **Fuer bereits ABGESCHLOSSENE Calls wirkt eine spaetere Buchung nie rueckwirkend auf die
   Gate-Entscheidung, die diesen Call schon durchgelassen hat.** Sie erhoeht nur die
   laufende Summe fuer den NAECHSTEN Aufruf von `budgetExceeded`/`reserveExceedsBudget`
   (naechster Call-Versuch oder naechste Mid-Call-Pruefung eines ANDEREN, noch laufenden
   Calls desselben Tenants). Das ist beabsichtigtes Verhalten (keine Zeitreise), aber es
   bedeutet: eine Kostenart, die erst NACH Call-Ende bekannt wird (wie die ElevenLabs-
   Ist-Kosten heute), kann den Call selbst nie mehr blockieren - nur den naechsten.
2. **Fuer den ElevenLabs-Outbound-Weg laeuft dieser gesamte Korrektur-Ast HEUTE NIE.** Nach
   B1 (AUFTRAG.md, belegt) ueberspringt `isRetrievable` (`cost-truing.js:581`) jeden
   EL-Anruf vollstaendig (`providerLegIdOf` kennt nur `twilioSid`/`callControlId`, nicht
   `sipCallId`). `applyCostCorrectionCents`/`bookCostCorrectionCents` werden fuer EL-Calls
   folglich NIE aufgerufen - die Kette oben ist fuer diese Kostenart vollstaendig, aber sie
   wird nie angestossen. Eine zusaetzliche Kostenart "ElevenLabs-Ist-Kosten" haette also
   selbst nach einem Fix des Join-Schluessels (B1) noch eine ZWEITE Bedingung: einen
   Aufrufer, der sie tatsaechlich abruft und uebergibt.
3. **Fuer eine bereits VERSCHWUNDENE/ausgelaufene Perioden-Baseline (s. Abschnitt 2) zaehlt
   eine positive Korrektur in die FALSCHE Periode.**

## 2. Perioden-Achse und Ist-Korrektur nach Periodenwechsel (BELEGT + eine Luecke gefunden)

Kette:
- `budgetPeriodUsageCents(bucket)` (`state-ops.js:3877`): `budgetPeriodKey` nicht gesetzt ->
  Lebenszeit (`bucket.costCents`); gesetzt -> `max(0, costCents - budgetPeriodBaselineCents)`.
- `stampBudgetPeriod(s, tenantId, periodStartIso)` (`state-ops.js:3891`): setzt beim
  Periodenwechsel `budgetPeriodBaselineCents = bucket.costCents` (Schnappschuss),
  monoton ueber `laterMonotonicKey` (kein Rueckdatieren, kein Doppel-Stempel).
- `chargeAnchorsOfUsage`/`chargeAnchorsOfCall` (`state-ops.js:747`/`:753`): persistieren
  `spendMonthKey`+`budgetPeriodKey` GENAU EINMAL am Call, beim ERSTEN Buchen der Schaetzung
  (`recordCallEstimatedCostCents`, `:772`, set-once).
- **Negative Korrektur (Gutschrift), `applyCreditCents` (`state-ops.js:3756`):** prueft
  `creditHitsBudgetPeriod` (`:3739`) - stimmt der am Call verankerte `periodKey` NICHT mit
  dem HEUTIGEN `bucket.budgetPeriodKey` ueberein, wird die Baseline um denselben (negativen)
  Betrag mitgesenkt (`budgetPeriodBaselineCents = max(0, ... + wirksam)`), sodass das
  aktuelle Perioden-FENSTER dadurch UNVERAENDERT bleibt - nur die Lebenszeit-Achse sinkt.
  Eine Gutschrift aus der Vorperiode kann die laufende Periode also NICHT kuenstlich
  aufweiten. Das ist genau die Anker-Mechanik, die AUFTRAG.md meint, und sie HAELT fuer
  diesen Zweig (P2/P4 in `test/ks-p5-current-period-credits.test.js` decken exakt diesen
  Fall ab).
- **Positive Korrektur (nachtraeglich entdeckte ZUSATZKOSTEN, `deltaCents > 0` in
  `bookCostCorrectionCents`, `state-ops.js:3780`):** geht UNVERAENDERT ueber `bookCents`
  (`:3609`). `bookCents` liest/prueft `chargeAnchors` ueberhaupt nicht - der Parameter wird
  fuer den positiven Zweig gar nicht verwendet (nur `applyCreditCents` konsumiert ihn). Es
  gibt in `bookCents` KEINEN Vergleich mit `bucket.budgetPeriodKey` und keinen Aufruf von
  `creditHitsBudgetPeriod` fuer diesen Zweig.

**Befund (Antwort auf "haelt die Anker-Mechanik?"): NEIN, nicht symmetrisch.** Die
Anker-Pruefung existiert nachweislich NUR auf dem Gutschrift-Pfad. Trifft eine positive
Korrektur (z.B. eine nachtraeglich entdeckte, hoehere Ist-Kostenart aus einem VERGANGENEN
Perioden-Fenster) NACH einem Periodenwechsel ein, erhoeht sie `usage.costCents`
bedingungslos - und weil `budgetPeriodBaselineCents` dabei NICHT angepasst wird, erhoeht
sie damit automatisch auch `budgetPeriodUsageCents` der NEUEN, laufenden Periode
(`costCents` steigt, Baseline bleibt gleich => die Differenz steigt um denselben Betrag).
Ein Call aus dem VORMONAT belastet damit die Kostendecke des LAUFENDEN Monats. Dieselbe
Beobachtung gilt fuer `spendMonthCostCents`: `bookCents` liest nur, ob der `nowIso`-Monat
(Korrektur-Zeitpunkt) mit dem GESPEICHERTEN `spendMonthKey` uebereinstimmt - nicht mit dem
Anker der Belastung. Nach einem Monatswechsel ist `nowIso`-Monat = neuer, gespeicherter
Monat, also landet der volle Korrekturbetrag im NEUEN Monat.

Einordnung: das ist die SICHERE Fehlrichtung (der Tenant wird eher zu frueh gesperrt als zu
spaet), verstoesst also nicht gegen ein Sicherheits-Gate. Es ist aber eine ECHTE Ungenauigkeit
gegen den Eigentuemer-Wortlaut ("was er in DIESEN zwei Minuten verursacht hat" - nicht: was
zufaellig in den naechsten zwei Minuten nach der Entdeckung an ihm haengenbleibt) und
bislang UNGETESTET: `test/ks-p5-current-period-credits.test.js` deckt ausschliesslich den
Gutschrift-Zweig ab (P1-P8, alle Testnamen enthalten "Gutschrift"); ich habe repo-weit
keinen Test gefunden, der eine POSITIVE Korrektur ueber einen Periodenwechsel hinweg prueft
(`grep -rln "budgetPeriodBaseline\|creditHitsBudgetPeriod\|stampBudgetPeriod" test/`
liefert 10 Dateien, keine davon deckt den positiven Zweig ab). Heute ist das folgenlos, weil
B1 verhindert, dass fuer EL-Calls ueberhaupt jemals eine Korrektur gebucht wird - es wird
aber zur akuten Falle, sobald ein kuenftiger Fix den Join repariert UND rueckwirkend fuer
bereits abgerechnete Altmonate nachbucht.

## 3. Inbound: ElevenLabs oder Bestandsweg? (BELEGT, klare Antwort)

**Inbound laeuft ausschliesslich ueber den Bestandsweg (Budget- oder Realtime-Engine), NIE
ueber ElevenLabs.** Belege:

- `src/telnyx-inbound.js` und `src/routes/voice.js` enthalten `grep`-weit KEINEN Treffer
  fuer `elevenlabs|ElevenLabs|convai|EL_` - keine Referenz auf den EL-Pfad in irgendeiner
  Form.
- `src/routes/voice.js:324` schaltet nach `config.voice.voiceEngine` zwischen
  `VOICE_ENGINE.REALTIME` und dem Budget-Pfad (`agentTurn` aus `src/claude.js`) - beides
  Bestandswege, kein dritter EL-Zweig.
- Der Inbound-Vorab-Check ist `store.budgetExceeded(tenantId, config.billing)`
  (`routes/voice.js:302`), derselbe Aufruf wie beim Outbound-Telnyx-Weg.
- Der EL-Code liegt ausschliesslich unter Outbound-Namen: `src/elevenlabs/outbound.js`,
  Flag `elevenLabsOutbound` (`config.js:2108`, Namespace `voice`), Webhook-Router
  `src/routes/webhooks-elevenlabs.js` - dessen Kopfkommentar (Zeile 1-24) beschreibt
  ausdruecklich einen Werkzeug-Webhook WAEHREND eines vom EL-Agenten selbst gefuehrten
  (also outbound platzierten) Anrufs, keinen Inbound-Entry-Point.
- **DB-Gegenprobe** (Tenant `t_user_01KX600834GCJFV9GTZQKWZMTH`, `call`-Tabelle): von 7
  Inbound-Calls tragen 0 einen `sip_call_id` (die EL-Leg-Kennung), 2 tragen
  `call_control_id` (Telnyx). Von 61 Outbound-Calls desselben Tenants tragen 12
  `sip_call_id` (EL) und 49 `call_control_id` (Telnyx). Zweiter Tenant
  (`t_user_01KZRNWDJA5MW3C206CK5992W6`): 5 Outbound-Calls, alle mit `call_control_id`, KEINER
  mit `sip_call_id`. Kein Inbound-Call in der Produktions-DB traegt je eine EL-Kennung.

**Folge fuer B1/B2:** die dort beschriebene Luecke (Ist-Kosten-Abgleich ueberspringt EL-Calls,
EL-Kosten stehen in keinem Buch) ist eine REIN OUTBOUND-Luecke. Inbound-Gespraeche laufen
weiterhin ueber die alte KI-Token-Buchung (`trackUsage`, live pro Turn, s. CLAUDE.md-Notiz zu
E11) - dort gilt B1/B2 NICHT, weil der Kostentraeger ein anderer ist (kein ElevenLabs-Leg).
Das widerspricht der im Auftrag offen gehaltenen Moeglichkeit ("wenn ja, gilt B1/B2 dort
genauso") - die Praemisse "wenn ja" ist nach dieser Pruefung nicht erfuellt; die Frage
schliesst sich also mit NEIN, nicht offen.

## 4. Plattform-Fixkosten ohne Tenant-Dimension (BELEGT, nur IST-Zustand)

Drei benannte Groessen, alle DREI ohne Tenant-Dimension in der Config
(`config.js:2098`, Namespace `billing`, listet sie flach ohne Tenant-Bezug):

| Groesse | Env/Config | Wird auf Tenants umgelegt? |
|---|---|---|
| `PLATFORM_FIXED_COST_CENTS_PER_MONTH` (`.env.example:711`, Live-Wert 600 = 6 EUR) | `config.billing.platformFixedCostCentsPerMonth` (`config.js:1346`) | **NEIN.** Einzige Leseder ist `routes/api-billing.js:152/156` - Admin-Route `GET /api/billing/platform-costs` (hinter `webAuthMw+adminMw`), Antwort traegt `listPriceNotBilled: true` und der Code-Kommentar direkt darueber (`api-billing.js:132-145`) sagt es woertlich: "REINE ANZEIGE: kein Gate/keine Reserve/keine Buchung liest diese Route." Keine `usage`-, `usage_event`- oder Gate-Schreibstelle referenziert dieses Feld. |
| DID-Monatsmiete (`NUMBER_MONTHLY_COST_CENTS` -> `config.billing.numberMonthlyCostCents`, `config.js:1352`) | dieselbe Route: `didRentCents = numberMonthlyCostCents * activeNumbers` (`api-billing.js:151`) | **NEIN**, aus demselben Grund - Teil derselben reinen Anzeige-Summe `fixedCostCentsPerMonth`. Deckt sich mit der als BELEGT/GEPARKT dokumentierten Erkenntnis "DID-Miete nicht gebucht" (Projekt-Memory). |
| `TTS_CHARACTER_QUOTA` (`.env.example:703`, 39981 Zeichen/Zyklus) + `TTS_CHARACTER_QUOTA_WARN_PERCENT` | `config.billing.ttsCharacterQuota`, gelesen in `state-ops.js:4441/:4449/:4451/:4500` (`platformTtsUsageView`, Schwellen-Warnung) | **NEIN als Kostenumlage, aber JA als Verbrauchszaehler**: die Zeichen werden PLATTFORMWEIT gezaehlt (ein Zaehler, keine Tenant-Aufteilung; `platformTtsUsageView` liefert `characters`/`quota`/`cycleKey` ohne Tenant-Dimension), und bei Ueberschreiten wird eine WARNUNG ausgeloest (`ttsQuotaExhausted`) - keine Buchung in EUR-Cent auf irgendeinen Tenant-Bucket. |

Alle drei Groessen sind damit reine Beobachtungs-/Warn-Groessen der Plattform, nicht Teil
der Tenant-Kostendecke. Das deckt sich mit AUFTRAG.md B4 ("Plattform-Achse trifft keine
Sperrentscheidung mehr, nur Beobachtung + Schwellenwarnung", Owner-Entscheidung KS-P9/E10) -
diese drei Groessen sind ein Beispiel genau dieser Kategorie, nur zusaetzlich noch nie
tenant-verteilt gewesen.

## 5. DB-Gegenprobe: haelt die Kette rechnerisch fuer die vier Tenants? (BELEGT + eine Abweichung notiert)

Vier Tenants in `tenant` (Tabelle ohne RLS): `owner`, `t_user_01KX600834GCJFV9GTZQKWZMTH`
(aktiv), `t_user_01KXH2B75WJ75W3JYYXDPPSK3R` (suspended), `t_user_01KZRNWDJA5MW3C206CK5992W6`
(aktiv). Alle `SELECT`s liefen mit `set app.current_tenant = '<id>'` im selben `-c`-Aufruf
(FORCE ROW LEVEL SECURITY auf `usage`/`call`/`tenant_budget`).

| Tenant | `tenant_budget.hard_cap_cents` | `usage.cost_eur` (Lebenszeit) | `budget_period_baseline_cents` | Perioden-Verbrauch (`budgetPeriodUsageCents`) |
|---|---|---|---|---|
| `t_user_01KX600834GCJFV9GTZQKWZMTH` | 4500 | 15,32 EUR = 1532 ct | 1070 | **462 ct** |
| `t_user_01KZRNWDJA5MW3C206CK5992W6` | 4500 | 0,36 EUR = 36 ct | 0 | 36 ct |
| `t_user_01KXH2B75WJ75W3JYYXDPPSK3R` | 4500 | 0 | 0 | 0 |
| `owner` | keine `tenant_budget`-Zeile (Stufe 2/3 greift) | 0,03 EUR = 3 ct | (nie gestempelt, `budget_period_key` leer) | 3 ct (Lebenszeit-Zweig, da nie gestempelt) |

Fuer `t_user_01KX600834GCJFV9GTZQKWZMTH` bestaetigt die Rechnung `1532 - 1070 = 462`
GENAU den in der Projekt-Memory (`budget-axes-deadband.md`/CLAUDE.md-Notiz "Decke des
Test-Tenants") festgehaltenen Wert 462 ct - die Kette `effectiveCapCents` /
`budgetPeriodUsageCents` haelt fuer diesen Tenant rechnerisch exakt. Alle drei
Abo-Tenants tragen denselben harten Cap (4500 ct = 45 EUR), keiner liegt in der Naehe der
Decke.

**Abweichung, notiert aber NICHT vertieft (ausserhalb des Auftrags-Kerns):** fuer den
suspendierten Tenant `t_user_01KXH2B75WJ75W3JYYXDPPSK3R` zeigt `usage.calls = 2`, aber
`select count(*) from call` liefert unter demselben `app.current_tenant` **0 Zeilen**. Der
Verbrauchszaehler `calls` und die tatsaechlich persistierten Call-Datensaetze laufen fuer
diesen Tenant auseinander. Das ist eine potenzielle Buchhaltungs-Inkonsistenz (evtl.
Retention/Purge der `call`-Zeilen ohne Ruecksetzen des Zaehlers, oder ein Inkrement-Pfad,
der nicht an der Call-Persistenz haengt) - fuer die Geld-Sperrkette selbst folgenlos, weil
`calls` in keiner Gate-Formel oben vorkommt (nur `costCents`/`spendMonthCostCents`/
`budgetPeriodBaselineCents` zaehlen). Nicht weiter untersucht, weil ausserhalb des
Auftragskerns (Geld-Sperrkette) und Turn-Budget begrenzt.

Direktionsaufschluesselung bestaetigt Abschnitt 3 fuer einen zweiten Tenant unabhaengig:
`t_user_01KZRNWDJA5MW3C206CK5992W6` hat 5 Outbound-Calls, alle mit `call_control_id`, keiner
mit `sip_call_id` - kein EL-Call bei diesem Tenant ueberhaupt, Inbound-Zeilen keine.

## Widerspruch/Praezisierung gegenueber AUFTRAG.md

Kein Widerspruch zu den dort als BELEGT markierten Punkten. Praezisierung zu O6: die im
Auftrag offen gelassene Bedingung ("wenn ja, gilt B1/B2 dort genauso") ist nach Code- UND
DB-Pruefung NICHT erfuellt - Inbound nutzt ElevenLabs nicht, die Frage ist damit
geschlossen (Antwort: nein), nicht nur beantwortet im Sinne von "noch offen, aber
plausibel". Neuer Befund, der im Auftrag nicht angefragt war, aber fuer Punkt 2 direkt
einschlaegig ist: die Anker-Mechanik pruefungssymmetrisch fuer Gutschriften, aber NICHT fuer
positive Nachbuchungen - eine Luecke, die erst wirksam wird, sobald B1 (Join-Schluessel)
behoben ist und rueckwirkend nachgebucht werden soll.
