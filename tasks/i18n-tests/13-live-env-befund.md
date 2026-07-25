# 13 - Live-Env-Befund (Schritt 2)

Gemessen am 2026-07-22 gegen den laufenden Dienst, nicht gegen `render.yaml`. Quelle sind die
Boot-Banner und Boot-Warnungen im Render-Log des Service `vodafone-agent`
(`srv-d8m0fhflk1mc73bno570`, Region Frankfurt, Plan `free`, Branch `master`, `autoDeploy: no`),
Boots vom 2026-07-20 bis zum letzten Boot 2026-07-22T11:12:48Z. Der Dienst druckt seine
wirksamen Gates beim Start selbst - das ist die belastbarste verfuegbare Quelle, weil sie den
tatsaechlich geladenen Wert zeigt und nicht die Absicht einer Datei.

Anlass: `PLAN-I18N-TESTS.md` Kapitel 5 und GAP-33 fordern diese Messung, weil `render.yaml:15-17`
laut eigenem Kommentar Referenz ist und nicht Wahrheit.

---

## 1. Gemessene Werte

| Variable | `render.yaml` | **live** | Quelle |
| --- | --- | --- | --- |
| `ALLOWED_COUNTRY_CODES` | `+49,+33,+44` | **`*` (weltweit offen)** | Banner `Nummern-Gates: Land *` |
| `MAX_CALLS_PER_HOUR` | `6` | `6` | derselbe Banner |
| `VOICE_TARIFF_DEFAULT_CENTS` | - | `300` | Boot-Warnung |
| `DEFAULT_TENANT_BUDGET_CENTS` | - | `600` | Boot-Warnung |
| `COST_TRUING_MIN_COVERAGE_PERCENT` | - | `80` | Boot-Warnung |
| `PLATFORM_ALERT_SMS_TO` | - | **leer** | Boot-Warnung |
| `PAYMENT_CURRENCY` | - | **ungeklaert** | s. Abschnitt 4 |

Betriebswerte nebenbei: die Cost-Truing-Deckungsquote lag am 2026-07-21 bei 0 %, am 2026-07-22
morgens bei 2 % und beim letzten Boot bei 11 % - durchgehend unter der geforderten Schwelle von
80 %.

---

## 2. Die wichtigste Korrektur: das Land-Gate ist live offen

Das Kurzurteil in `PLAN-I18N-TESTS.md` Kapitel 2 nennt vier Stellen, an denen der US-Pfad
strukturell geschlossen sei. **Es sind drei.** Das Land-Gate gehoert nicht dazu:
`ALLOWED_COUNTRY_CODES` steht live auf `*`, jede `+1`-Nummer passiert es. Der Code-Kommentar in
`src/config.js:103-105` hatte das vorweggenommen ("das Gate wird in Phase 4 '*' (weltweit)"),
nur war nirgends belegt, dass die Umstellung bereits erfolgt ist.

Geschlossen bleiben:

1. **Registrierung** - `countryAllowed(e164, allowedCodes = ["+49"])` (`src/store/defaults.js:542`),
   Argument wird nirgends durchgereicht (`src/routes/api-onboard.js:125`, `src/store/state-ops.js:855`).
2. **Sprache** - `LANGUAGE_FOR_COUNTRY` ohne US/CA/AU (`src/i18n/locales.js:268-275`).
3. **Tarif** - `VOICE_TARIFF_DOMESTIC_PREFIXES` ohne `+1` (`src/config.js:105`).

**Das Risiko wird durch den Befund groesser, nicht kleiner.** Vorher lautete die Annahme: die USA
sind zu, also kann dort nichts schiefgehen. Tatsaechlich ist weltweites Waehlen offen, waehrend es
weiterhin kein Consent-Gate, kein Anrufzeitfenster in Zielortszeit und keine DNC-Pruefung gibt
(`grep -rniE "consent|tcpa|do-not-call|timeZone|getHours" src/` -> null Treffer). Was den
US-Verkehr heute faktisch stoppt, ist nicht das Land-Gate, sondern das Geld (Abschnitt 3).

---

## 3. Der Geld-Befund ist live bestaetigt - mit schaerferen Zahlen

Der Dienst warnt bei **jedem einzelnen Boot**:

> `[boot] Konfig-Warnung: Worst-Case-Reserve 1500 Cent (VOICE_TARIFF_DEFAULT_CENTS=300 * max.
> Gespraechsdauer) uebersteigt die Tenant-Decke DEFAULT_TENANT_BUDGET_CENTS=600 - der teuerste
> Zielverkehr ist unter dieser Decke ab max_duration_s=120 nicht mehr bezahlbar.`

Der Katalog hatte 900 ct gegen 300 ct gerechnet (Starter-Plan-Decke). Live sind es **1500 ct
gegen 600 ct**: jeder Nicht-Inlands-Anruf mit mehr als 120 Sekunden Wunschdauer wird von der
Reserve abgelehnt, bevor er beginnt. Ein US-Anruf scheitert also nicht am Land-Gate, sondern
lautlos an der Budget-Reserve - mit einer Fehlermeldung, die auf Deutsch von Budget spricht
(PAY-12) und nicht erklaert, dass die Zieldauer das Problem ist.

Ebenfalls live bestaetigt statt hypothetisch:

- **GAP-07** (Fruehwarnung ohne Empfaenger): `PLATFORM_ALERT_SMS_TO` ist leer. Plattform-Warnung
  und Tarif-Drift-Alarm laufen ausschliesslich ins Audit-Log. Es gibt keinen Menschen am anderen
  Ende.
- **GAP-32** (unbezahlbarer Worst-Case bricht den Start, statt nur zu warnen): die Warnung steht
  seit mindestens dem 2026-07-20 in jedem Boot-Log und hat nie etwas ausgeloest.
- **GAP-38** (`plan:free` am Gateway-Service): bestaetigt, der Dienst laeuft auf `plan: free`.

---

## 4. `PAYMENT_CURRENCY` - beantwortet: `eur`

**Vom Owner am 2026-07-22 abgelesen: `PAYMENT_CURRENCY=eur`.** Damit ist MCP-19/DID-13
erledigt und der Cluster D17 (PAY-01) von "unbekannt" auf **belegt** gehoben: die gesamte
Geld-Oberflaeche laeuft in Euro, waehrend die Produktvorgabe USD-Preise nennt
(Starter 4,99 / Business 9,99 USD). Das ist kein Anzeigefehler, sondern die Waehrung, in der
Stripe belastet (`src/billing/stripe.js:217`) und in der die Self-Service-Antworten rechnen
(`src/self-service-routes.js:223,299`). Produktentscheidung 7.1 bleibt damit die Vorbedingung
fuer jeden Geld-Test - aber sie entscheidet jetzt ueber einen *bekannten* Ist-Zustand.

Historie, warum es nicht automatisiert ermittelbar war:

- Der Render-MCP hat **kein Lese-Tool fuer Umgebungsvariablen** (nur
  `update_environment_variables`, ein Schreib-Tool - fuer eine Leseabsicht ausgeschlossen).
- Der Wert taucht in keinem Log auf; er wird nur in Antworten von
  `src/self-service-routes.js:223,299` und im Stripe-Aufruf (`src/billing/stripe.js:217`)
  verwendet, beides hinter Authentifizierung.
- Der Weg ueber das Render-Dashboard im Browser endete mit **Access denied**: die Browser-Session
  ist nicht der Kontoinhaber (Workspace `jonas@kroh-willich.de`, passend zum bekannten
  Deploy-Repo-Split). Fremde Zugangsdaten wurden nicht verwendet.

**Damit bleibt es bei der Katalog-Einstufung: MCP-19 und DID-13 sind manuelle Owner-Tests.**
Sie muessen vor Welle 1 laufen, weil ein abweichender Live-Wert jedes Geld-Ergebnis aus W1/W2
entwertet. Der Owner liest den Wert im Render-Dashboard unter
`vodafone-agent -> Environment` ab.

---

## 5. Folgen fuer den Testkatalog

| Test / Cluster | Befund | Konsequenz |
| --- | --- | --- |
| **OUT-01** (Leittest D3) | prueft den **Code-Default** `+49,+33,+44`; live gilt `*` | Umformulieren: der Test darf nicht mehr suggerieren, dass `+1` in Produktion blockiert ist. Er bleibt als Default-Regressionsschutz gueltig, verliert aber seinen Launch-Gate-Charakter. |
| D3-Duplikate LANG-08, PAY-13, LAW-04, OUT-13, PAY-14 | bauen auf derselben falschen Praemisse auf | bleiben entfallen (Duplikate), die Praemisse wird an OUT-01 einmal korrigiert |
| **OUT-02** ("`*` oeffnet das Gate fuer `+1`") | beschreibt den **tatsaechlichen Produktionszustand** | von P1 auf **P0** hochstufen - das ist der real wirksame Pfad |
| **LAW-05, LAW-06, GAP-12, GAP-13** (Consent/DNC) | Risiko groesser als angenommen, weil weltweit offen | Prioritaet bestaetigt P0, Dringlichkeit steigt |
| **PAY-04, GAP-32** | live bestaetigt, Zahlen schaerfer (1500/600 statt 900/300) | erwartete Werte im Test auf die Live-Zahlen umstellen |
| **GAP-07** | live bestaetigt (`PLATFORM_ALERT_SMS_TO` leer) | von "rot erwartet" auf "rot belegt" |
| **GAP-33** | hat sich binnen Minuten selbst gerechtfertigt | bleibt der erste auszufuehrende Test |

Kein Test entfaellt durch diesen Befund. Zwei werden umformuliert, einer wird hochgestuft,
drei wechseln von "erwartet rot" auf "belegt rot".

---

## 6. Nachtrag: jeder Tenant hat eine US-Nummer - der Tarif weiss davon nichts

Owner-Information vom 2026-07-22: **jeder Nutzer bekommt derzeit eine amerikanische Rufnummer,
und das ist so gewollt.** Damit ist real jeder Anruf ein Auslandsanruf - ein deutscher Nutzer,
der eine deutsche Nummer anruft, telefoniert von einer US-DID aus nach Deutschland.

**Der Code bildet das nicht ab.** `tariffCentsPerMin(to)`
(`src/telephony/outbound-gates.js:145-149`) verzweigt **ausschliesslich am Ziel**:

```js
return defaultConfig.billing.voiceTariffDomesticPrefixes.some((p) => to.startsWith(p))
  ? defaultConfig.billing.voiceTariffDomesticCents      // live 20 ct/min
  : defaultConfig.billing.voiceTariffDefaultCents;      // live 300 ct/min
```

Die Absender-DID geht an keiner Stelle in die Rechnung ein. Die stillschweigende Annahme hinter
"Inlands-Praefix = guenstig" ist, dass der Leg im selben Land beginnt. Genau diese Annahme
haelt nicht mehr. Drei Folgen, alle live wirksam:

| Fall | `call.to` | gebuchter Tarif | Realitaet |
| --- | --- | --- | --- |
| DE-Nutzer ruft `+49` von US-DID | `+49...` | **20 ct/min (Inland)** | US->DE international - **zu wenig reserviert und zu wenig gebucht** |
| Inbound auf die US-DID | `+1...` (die eigene DID) | **300 ct/min** | eingehender Anruf, den der Tenant nicht ausgeloest hat - **15-fach ueberbucht** |
| US-Nutzer ruft `+1` | `+1...` | 300 ct/min | Reserve 1500 ct gegen 600 ct Decke -> **abgelehnt** |

Der Inbound-Fall trifft den Ledger, nicht das Budget: `reconcileOutboundVoiceBudget` steigt fuer
Inbound frueh aus (`src/billing/metering.js:55`), aber `recordVoiceMinuteMeter` wird in
`src/telephony/call-finish.js:48` **ohne Richtungsfilter** aufgerufen und schreibt ein
`usage_event` mit `minutes * 300 ct` (`metering.js:45`).

**Die Drift-Kalibrierung hat denselben blinden Fleck.** `cost-calibration.js:144-147` bewertet
ausdruecklich nur die Inlands-Praefixe und schliesst alles andere aus ("Ziele OHNE Praefix-Treffer
werden bewusst NICHT bewertet"). Der Drift-Waechter misst also genau die Praefixe, deren
Inlands-Annahme gerade ungueltig geworden ist, und ignoriert den Rest. Live laeuft er ohnehin
leer: `praefix=+49 stichproben=4 | +33 stichproben=0 | +44 stichproben=0 -> insufficient_samples`
(Sweep 2026-07-22T15:12Z).

Korrigierend wirkt allein der Cost-Truing-Sweep, der die gebuchten Werte gegen die echten
Telnyx-Belege nachzieht - bei einer Deckungsquote von 11 % (Abschnitt 1) fuer den ueberwiegenden
Teil der Anrufe also gar nicht. Die **Reserve** wird nie korrigiert; sie ist eine Vorab-Schaetzung.

### Neue Tests (im Katalog bisher nicht enthalten)

Der bestehende Katalog kennt PAY-07 ("Ziel-Tarif unabhaengig vom Tenant-Heimatland") und PAY-09
("Inbound mit 15x-Tarif"), formuliert beides aber als Heimatland-Frage. Dass die **Herkunft des
Legs** ueberhaupt keine Kosteneingabe ist, testet nichts. Diese fuenf Tests schliessen die Luecke
und sind in die kanonische Liste aufzunehmen:

- **ORIG-01** (P0, offline) - `tariffCentsPerMin` hat keinen Parameter fuer die Absendernummer.
  *Erwartet*: die Funktion nimmt Ziel **und** Herkunft entgegen. *Verifikation*:
  `node --test test/...` gegen die Signatur; heute **rot** (`outbound-gates.js:145`).
- **ORIG-02** (P0, offline) - DE-Tenant mit US-DID ruft `+49`: gebucht werden 20 ct/min.
  *Erwartet*: der internationale Satz. *Heute*: **rot**, `metering.js:68` rechnet
  `tariffCentsPerMin(call.to)`.
- **ORIG-03** (P0, offline) - Inbound auf die eigene US-DID erzeugt ein `usage_event` mit
  300 ct/min. *Erwartet*: Inbound wird nicht mit dem Auslands-Worst-Case bewertet.
  *Heute*: **rot**, `call-finish.js:48` filtert die Richtung nicht.
- **ORIG-04** (P1, offline) - der Drift-Report bewertet ausschliesslich
  `voiceTariffDomesticPrefixes`. *Erwartet*: die real teuerste Achse wird mitgemessen.
  *Heute*: **rot**, `cost-calibration.js:144-147`.
- **ORIG-05** (P0, offline) - US-Tenant ruft eine `+1`-Nummer: Reserve 1500 ct gegen 600 ct
  Decke -> 402 vor dem ersten Wort. *Heute*: **rot** (identische Ursache wie PAY-04/GAP-32,
  aber der einzige Fall, in dem DID-Land und Ziel-Land uebereinstimmen).

**Einordnung.** Das ist kein i18n-Befund im engeren Sinn, sondern eine Kosten-Invariante, die
durch die Produktentscheidung "US-Nummer fuer alle" gekippt ist. Sie gehoert trotzdem hierher:
sie entsteht erst durch die Internationalisierung und trifft jeden bestehenden deutschen Tenant
sofort mit.
