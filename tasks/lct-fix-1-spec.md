# LCT-FIX-1 — Ist-Kosten-Zuordnung reparieren

Folgearbeit zu PLAN-LIVE-COST-TRACING. Der Abgleich ist deployt, misst aber
**nichts**: `getVoiceCostRecords` verwirft JEDEN Kostenbeleg.

## 1. Deterministisches Abnahmekriterium

| | Ergebnis |
| --- | --- |
| **Rot (heute, live gemessen)** | `records=0`, `rejected={"leg_unresolved":205,"leg_mismatch":92}` |
| **Gruen (Ziel)** | Fuer einen Anruf werden ALLE Belege seiner Provider-Session gefunden; die Pflicht-Typen `sip-trunking` + `call-control` sind darunter, `source` wird `telnyx_detail_records` |

Der Live-Beweis laeuft beim Lead (braucht `.env` + Prod-DB, im Worktree nicht
verfuegbar). **Deine Verifikation ist `npm test`, offline.**

## 2. Der Defekt (belegt, nicht vermutet)

`src/telephony/adapters/telnyx/voice.js:48`:

```js
const LEG_ID_FIELDS = Object.freeze(["leg_id", "call_leg_id"]);
```

Diese Feldnamen liefert Telnyx **nicht**. Empirisch am echten Konto gemessen
(2026-07-21, 297 Belege), welche ID-Felder je `record_type` real vorkommen:

| record_type | reale ID-Felder | heutiges Ergebnis |
| --- | --- | --- |
| `sip-trunking` | `call_control_id`, `telnyx_session_id` | `leg_unresolved` |
| `call-control` | `telnyx_leg_id`, `telnyx_session_id` | `leg_unresolved` |
| `recording` | `telnyx_session_id` | `leg_unresolved` |
| `inference` | `conversation_id` (KEINE Session/Leg) | `leg_unresolved` |
| `ai-voice-assistant` | `call_control_id`, `telnyx_leg_id`, `telnyx_session_id`, `conversation_id` | `leg_unresolved` |
| `speech-to-text` | `call_session_id`, `call_leg_id` | `leg_mismatch` |
| `text-to-speech` | `call_session_id`, `call_leg_id` | `leg_mismatch` |

Die letzten beiden tragen zwar `call_leg_id`, aber als **UUID**
(`285df0e6-84f2-...`), waehrend `providerLegIdOf(call)` eine **`v3:`-Token**
liefert (`v3:LoD0swXYmiE...`, 57 Zeichen). Zwei verschiedene ID-Systeme.

Folge in `cost-truing.js`: leere Liste -> `classifyRecords` liefert `null` ->
`measured=null` -> `truedSource='unavailable'` -> nach
`COST_TRUING_MAX_ATTEMPTS` dauerhaft `failed`. **Deckungsquote bleibt 0 %.**

## 3. Die Loesung (empirisch verifiziert, zweistufig)

Der Anker liegt bereits vor: `providerLegIdOf(call)` = `call.twilioSid ||
call.callControlId`. **Beide Pfade speichern eine `v3:`-Token** — der
TeXML/Budget-Pfad in `twilioSid`, der Assistant-Pfad in `callControlId` — und
beide entsprechen dem `call_control_id`-Feld der Belege.

- **Stufe 1 (Anker):** Belege mit `call_control_id === legId` suchen; daraus die
  `telnyx_session_id`-Werte einsammeln.
- **Stufe 2 (Aufspannen):** alle Belege akzeptieren, deren `telnyx_session_id`
  ODER `call_session_id` in dieser Menge liegt.

Live gegengeprueft an drei echten Anrufen (beide Pfade):

| Anruf | Pfad | Belege | Summe |
| --- | --- | --- | --- |
| `call_mrujjae2w33g` | Assistant, outbound | 7 | 0,094267 USD |
| `call_mrui93yoctrl` | Assistant, outbound | 7 | 0,094255 USD |
| `call_mrntu643cvc2` | TeXML/Budget, inbound | 10 | 0,036900 USD |

**KEIN Schema-Change, KEINE Migration, KEINE neue Env-Variable.** Der bereits
live gesetzte Wert `COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control`
wird dadurch erstmals erfuellbar — beide Typen sind ueber die Session auffindbar.

## 4. Harte Randbedingungen

1. **Fail-closed bleibt fail-closed.** Findet Stufe 1 keine Session, ist das
   Ergebnis die LEERE Liste (`ok:true, records:[]`) — niemals ein lockererer
   Fallback. Ein FREMDER Beleg waere eine Fehlbuchung auf einen fremden Tenant;
   ein fehlender Beleg ist nur `incomplete`. Diese Asymmetrie ist der Kern.
2. **Port-Vertrag unveraendert.** Rueckgabe bleibt `{ok, records}` bzw.
   `{ok:false, reason}`. `getVoiceCostRecords` WIRFT NIE. Jeder Record behaelt
   `legId` = der uebergebene Anker (Korrelationsschluessel des Aufrufers), nicht
   die leg-eigene ID.
3. **`src/billing/cost-truing.js` wird NICHT angefasst.** Ebenso wenig
   `metering.js`, `call-finish.js`, `outbound-gates.js`, der Store, das Schema.
   Der bestehende Aufrufer-Riegel-Test (Abschnitt (g) in
   `test/telnyx-cost-records.test.js`) muss unveraendert gruen bleiben.
4. **Waehrungs-, Kosten- und Zeitfenster-Pruefung bleiben erhalten.**
   Fremdwaehrung verwirft weiter; `parseDecimalToMicroCents` bleibt unberuehrt
   (Ganzzahl-Mikro-Cent, Faktor 10^8, wissenschaftliche Notation gueltig).
   `withinRecordWindow` bewusst NICHT aendern (Scope-Disziplin) — die
   Session-Zuordnung ist jetzt der primaere Riegel, das Zeitfenster nur die
   zweite Linie.
5. **Beobachtbarkeit ehrlich halten.** Die Ablehnungsgruende muessen den neuen
   Sachverhalt benennen (z. B. `session_unresolved` / `session_mismatch` statt
   `leg_unresolved` / `leg_mismatch`). Der PII-freie Erfolgs-Log
   (`logCostRecordsOk`) bleibt PII-frei: NIE eine `call_control_id`, NIE eine
   Session-ID, NIE eine Rufnummer, NIE der API-Key.
6. **`inference` traegt keine Session-Referenz** und bleibt daher unzuordenbar.
   Das ist akzeptiert (im Messfenster 0,000000 USD) und gehoert als bewusste
   Grenze in einen Code-Kommentar — nicht stillschweigend uebergehen.

## 5. Tests (S1 — das ist der eigentliche Auftrag)

Die bestehenden Tests waren gruen, WEIL ihre Fixtures `leg_id` enthielten. Ein
Test gegen selbst erfundene Daten prueft die eigene Annahme, nicht die
Wirklichkeit. **Das ist der Fehler, der diesen Defekt verursacht hat — wiederhole
ihn nicht.**

`test/telnyx-cost-records.test.js` ist auf die REALEN Belegformen umzustellen.
Fixtures muessen exakt die Felder aus der Tabelle in Abschnitt 2 tragen (Namen
und Wertformen), inklusive:

- `sip-trunking` mit `call_control_id` + `telnyx_session_id` + `started_at`,
  Kosten `"0.0401"`, `billed_sec: 60`
- `call-control` mit `telnyx_leg_id` + `telnyx_session_id` (OHNE
  `call_control_id`!), Kosten `"0.001"`
- `ai-voice-assistant` mit `call_control_id` + `telnyx_session_id`, Kosten
  `"0.05"`, `rate_measured_in: "ai_voice_assistant_minutes"`
- `text-to-speech` mit `call_session_id` + `call_leg_id` (OHNE
  `telnyx_session_id`), Kosten in wissenschaftlicher Notation `"1.687E-4"`
- `recording` mit NUR `telnyx_session_id`
- `inference` OHNE jede Session-/Leg-Referenz

Pflicht-Faelle:

- **Rot-vor-Fix:** ein Test, der mit den REALEN Formen gegen die ALTE Logik
  fehlschlaegt (0 Records) und nach dem Fix die volle Menge liefert. Belege im
  Report, dass er vor dem Fix rot war.
- Der Anker steht nur auf EINEM Typ (`sip-trunking`) — die uebrigen Belege
  werden trotzdem ueber die Session gefunden.
- Anker findet nichts -> `records: []`, `ok:true` (fail-closed, KEIN Wurf).
- **Fremd-Session wird verworfen:** Belege mit anderer `telnyx_session_id`
  duerfen NIE mitkommen. Das ist der Tenant-Trennungs-Test.
- `call-control` ohne `call_control_id` wird trotzdem gefunden (nur ueber
  Session) — genau der Fall, der die Pflicht-Menge erfuellbar macht.
- Grenzfaelle bleiben: `params_missing`, `config_missing`, `page_truncated`,
  Fremdwaehrung, HTTP 500, rejectendes fetch.

Tests laufen offline (`global.fetch` gestubbt), ohne `.env`, ohne Netz, ohne
Server-Spawn — wie die Bestandsdatei.

## 6. Verifikation

- `node --check src/telephony/adapters/telnyx/voice.js`
- `npm test` — vollstaendig gruen (Bestand 2846 Tests; ein Voll-Last-Flake in
  `p5-gate-proof` ist vorbekannt: rot zaehlt nur, wenn isoliert reproduzierbar)
- Kein `grep`-Treffer fuer `leg_id`/`call_leg_id` mehr als ALLEINIGE
  Zuordnungsquelle in `voice.js`
