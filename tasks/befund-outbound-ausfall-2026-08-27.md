# Befund: Outbound-Totalausfall 2026-08-27 (gemessen, nicht vermutet)

Alle Angaben unten sind am laufenden System gemessen (Render-Log, Prod-DB, ElevenLabs-API,
Telnyx-API) am 27.08.2026. Zielrufnummern sind maskiert (PII); Firmen-DIDs stehen voll, sie
sind Betriebswissen und bereits an anderer Stelle im Repo dokumentiert.

## 1. Symptom

Vier Outbound-Versuche ueber den MCP-Weg (`place_call`) am 27.08.2026, 16:36-16:42 UTC.
Alle vier: Status `failed`, Dauer ~6 s, kein Klingeln, keine Fehlermeldung fuer den Nutzer.

| call_id | Ziel | Start (UTC) | Ende (UTC) |
|---|---|---|---|
| call_mtbqwfnxr2si | +4917367xxxxx | 16:36:49.102 | 16:36:55.426 |
| call_mtbr0lohhd4s | +4917367xxxxx | 16:40:03.521 | 16:40:09.860 |
| call_mtbr1vr3uxds | +4917367xxxxx | 16:41:03.231 | 16:41:09.328 |
| call_mtbr3pdcihp8 | +4917372xxxxx | 16:42:28.272 | 16:42:34.472 |

Server-Log (Render, `srv-d8m0fhflk1mc73bno570`), je Anruf identisch:

```
[audit] place_call ip=::1 to=+49... call=call_... provider=telnyx requestedBy=user_01KX6008...
[el-outbound] Buchungsanker ohne Anbieter-Dauer (call=call_...): call_duration_secs_zero_not_answered
```

Prod-DB (`call`-Tabelle, RLS mit `SET app.current_tenant='t_user_01KX600834GCJFV9GTZQKWZMTH'`):

```
status                  = failed
answered_at             = NULL
failure_reason          = NULL          <-- LEER, obwohl der Anbieter einen Fehler nennt
answered_unclear_reason = call_duration_secs_zero_not_answered
from_e164               = +17067101188  <-- NICHT die real gesendete Nummer (s. 3.)
```

## 2. Wurzel (belegt)

ElevenLabs `GET /v1/convai/conversations/<id>` liefert fuer ALLE VIER Anrufe woertlich
denselben Fehler:

```json
"error": {
  "code": 403,
  "reason": "unexpected status from INVITE response: sip status: 403: Unverified origination number D51 (SIP 403)",
  "error_type": "call_initialization_error"
}
```

Telnyx lehnt das SIP-INVITE ab, weil die Absendernummer dem Konto nicht mehr gehoert.

Kette:

1. Der gesamte Outbound-Pfad haengt an EINER ElevenLabs-SIP-Nummer:
   `phnum_1101m00pjrg7e1js7aaxwp8hdw38`, Label "Spike2 Telnyx", `phone_number = +15739090177`,
   `provider = sip_trunk`, zugewiesen an `agent_5301kwkh9vv3ezesf100pggfj9rs`.
   (`GET /v1/convai/phone-numbers` — es ist die EINZIGE registrierte Nummer.)
2. Die Telnyx-Connection `3026479542865757220` ("ElevenLabs Spike2", FQDN-Connection,
   angelegt 2026-08-14) traegt zusaetzlich
   `outbound.ani_override = "+15739090177"`, `ani_override_type = "always"`.
3. Diese Nummer gehoert dem Telnyx-Konto NICHT MEHR. Konto-Bestand heute
   (`GET /v2/phone_numbers`): `+15804504874`, `+17067101188`, `+18643028341` — alle `active`,
   alle US, alle an Connection `2982643896460248193` ("Hermes").
   `GET /v2/verified_numbers`: **leer** (keine verifizierte Fremd-CLI hinterlegt).
4. Freigabe-Zeitpunkt, Prod-Audit-Log (`audit_log`, Tenant `t_user_01KXH2B75WJ75W3JYYXDPPSK3R`):

```
197 | 2026-08-24 11:55:51+00 | actor=system:erase-release | did_released
    | number=num_mryvwncasbmb provider=3011078889721038032
198 | 2026-08-24 11:55:52+00 | (kein actor)               | workos_user_deleted
```

   In unserer eigenen `number`-Tabelle steht sie seitdem als `released`
   (Tenant `t_user_01KXH2B75WJ75W3JYYXDPPSK3R`, ein Wegwerf-Test-Konto).

**Der Loeschweg eines Test-Kontos hat die Absendernummer des gesamten Produkt-Outbounds
freigegeben.** Die Nummer diente gleichzeitig zwei Zwecken (Tenant-DID UND Plattform-ANI);
nichts im System kannte diese zweite Rolle.

Zeitliche Bestaetigung: letzter erfolgreicher Outbound-Anruf 2026-08-20 17:17 UTC
(`conv_4201m0g2vr7bezb96yb5jwjgydnn`, `status=done`, 17 s, `error=null`) — mit derselben
`agent_number = +15739090177`, die damals noch dem Konto gehoerte. Zwischen dem 20.08. und
dem 27.08. gab es keinen Outbound-Anruf; der Ausfall lief also drei Tage unbemerkt.

## 3. Folgebefunde (gemessen)

**F1 — Anbieter-Fehler wird nicht ausgelesen.** `metadata.error` (Code + Klartext-Grund) liegt
bei ElevenLabs vor, wird von uns nicht gelesen. Gespeichert wird stattdessen
`answered_unclear_reason = call_duration_secs_zero_not_answered` (Herkunft:
`src/elevenlabs/outbound.js:90`), `failure_reason` bleibt NULL. Ein Konfigurationsfehler ist
dadurch von "niemand hat abgenommen" nicht unterscheidbar — genau die Vermischung, die die
Repo-Lehre "nie zwei Sachverhalte auf ein Label" verbietet.

**F2 — kein Alarm.** Vier Totalausfaelle hintereinander, drei Tage kaputte Konfiguration,
keine Benachrichtigung an irgendwen. Der Ausfall fiel nur auf, weil der Owner zufaellig selbst
einen Anruf ausloeste.

**F3 — Absender-Buchfuehrung stimmt nicht.** Gespeichert `from_e164 = +17067101188` (die DID
des anrufenden Tenants), tatsaechlich gesendet `+15739090177` (EL-Nummer/ANI-Override). Der
Anrufkoerper (`src/elevenlabs/outbound.js:931`, `startCallBody`) uebergibt nur
`agent_phone_number_id`; die reale Absendernummer bestimmen EL-Registrierung und
Telnyx-ANI-Override. Folge: der Angerufene sieht eine Nummer, die niemandem gehoert, und ein
Rueckruf laeuft ins Leere. Bei Millionen Nutzern ist die Frage grundsaetzlicher: EINE globale
Absendernummer fuer ALLE Tenants ist kein tragfaehiges Modell.

**F4 — keine Drift-Erkennung.** Nichts prueft, ob die konfigurierte Absendernummer dem
Telnyx-Konto noch gehoert bzw. ob EL-Nummer und Telnyx-ANI zusammenpassen. Weder beim Boot
noch periodisch noch vor dem Waehlen.

**F5 — Randbefunde.** Beim ersten Versuch:
`[opening-line] uebersprungen: DeepSeek-Adapter: HTTP 402 - Insufficient Balance` (Fallback
griff, Anruf lief weiter). Telnyx-Guthaben `GET /v2/balance`: **3,09 USD** — knapp.

## 4. Was noch NICHT geklaert ist

- Ob Telnyx die ANI vor oder nach dem `ani_override` prueft (fuer den Fix relevant: es muessen
  moeglicherweise BEIDE Stellen — EL-Nummernregistrierung und Telnyx-ANI-Override — auf eine
  eigene Nummer zeigen).
- Ob `PATCH /v1/convai/phone-numbers/<id>` die Rufnummer einer registrierten SIP-Nummer aendern
  kann oder ob eine neue Registrierung noetig ist (dann Env `ELEVENLABS_AGENT_PHONE_NUMBER_ID`
  in Render nachziehen).
- Ob eine US-Absendernummer nach DE dauerhaft zustellbar ist (Bestandslehre:
  US-DID -> DE war schon einmal intermittierend, Fix damals: +49-DID).
