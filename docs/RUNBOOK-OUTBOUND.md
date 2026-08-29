# Runbook: Outbound-Drift-Waechter (OUTBOUND-E4)

Bezug: `PLAN-OUTBOUND-RESILIENZ.md` Etappe E4 (E-6/F4), Regressionsfang des
27.08.2026-Ausfalls (`tasks/befund-outbound-ausfall-2026-08-27.md`). Der Waechter prueft,
ob unsere deklarierte Absenderkonfiguration noch mit der Anbieter-Wirklichkeit
uebereinstimmt — nur-lesend, ohne dass ein Anruf stattfindet.

Jede Meldung traegt den Klassen-Token als Anker: `klasse=<ownership|config|warn|unknown|
watchdog_stale> befund=<code> ...`. Suche im Alarm-Text nach `befund=` fuer den exakten
Code.

**Entprellung (Review Runde 2, Blocker 3):** ein VOLL-Befund (`ownership`/`config`/
`watchdog_stale`) sendet Mail+SMS nur beim ERSTEN Fund und danach erst wieder nach
`OUTAGE_ALERT_DEBOUNCE_MS` (Default 6h) — ein unveraendert bestehender Befund erzeugt bei
jedem stuendlichen Lauf trotzdem eine Audit-Zeile (`drift_<code>_entprellt`), nur ohne
erneuten Versand. Die **Marker-Frische** (`lastSeenAt`, das Feld, das der ANI-Riegel unten
liest) haengt NICHT an dieser Entprellung — sie wird bei JEDEM Lauf fortgeschrieben, auch
waehrend Mail/SMS pausieren.

## Wie man den Waechter manuell faehrt

```
npm run outbound:drift
```

Braucht `TELNYX_API_KEY` (Pflicht), sonst Exit 1 mit fail-closed-Meldung. `ELEVENLABS_API_KEY`
und die Telnyx-IDs (`TELNYX_FQDN_CONNECTION_ID`, `TELNYX_OUTBOUND_VOICE_PROFILE_ID`)
sind optional — fehlen sie, meldet der Lauf die zugehoerigen Pruefungen als `unbekannt:
pruefungN` statt zu scheitern.

## `ownership_lost` (Klasse `ownership`, VOLLER Alarm)

**Was es heisst:** die Plattform-Absendernummer (ANI) gehoert dem Telnyx-Konto nicht mehr
— genau der 27.08.2026-Fall. **Alle** Outbound-Anrufe scheitern ab diesem Moment mit
SIP 403.

**Welcher GET es bestaetigt:** `GET /v2/phone_numbers?filter[phone_number]=<ANI>` (Telnyx-
Portal: Numbers). Kein Treffer mit `status=active` = Verlust bestaetigt.

**Wie man es behebt:** entweder die Nummer beim Konto zurueckkaufen/portieren, oder eine
neue Nummer als Plattform-ANI hinterlegen (`PLATFORM_ANI_E164` im Render-Dashboard) UND
den Telnyx-`ani_override` der FQDN-Connection sowie die ElevenLabs-SIP-Registrierung
(`ELEVENLABS_AGENT_PHONE_NUMBER_ID`) auf dieselbe Nummer umstellen (Weg 1 der
Wiederherstellung, verletzt bewusst Pruefung 5 — das ist erwartet, kein zweiter Fehler).

**Wie man zurueckdreht:** nichts zurueckzudrehen — der Befund verschwindet automatisch,
sobald die naechste Messung die Nummer wieder als kontoeigen sieht (`drift_recovered`-
Audit-Zeile).

**Wann eskaliert wird:** sofort, VOLLER Meldeweg (WARN→Audit→Mail→SMS). Zusaetzlich: ist
`OUTBOUND_ANI_GATE_ENABLED=true`, lehnt der ANI-Riegel ab dem naechsten Anruf mit 503 ab
(nur wenn die Messung frisch ist UND eine Live-Nachmessung sie bestaetigt — die
Nachmessung prueft die **Plattform-ANI** `PLATFORM_ANI_E164`, NICHT die Absender-DID des
anrufenden Tenants).

## `alert_sender_not_owned` (Klasse `ownership`, VOLLER Alarm)

**Was es heisst:** die Nummer, ueber die der SMS-Alarmkanal sendet, gehoert dem Konto
nicht mehr — der Alarmkanal selbst waere blind fuer JEDEN kuenftigen Ausfall (PM-4).

**Welcher GET es bestaetigt:** `GET /v2/phone_numbers?filter[phone_number]=<Absender>`
(dieselbe Abfrage wie oben, andere Nummer — die offene `alert_sms_sender`-Bindung).

**Wie man es behebt:** eine aktive, kontoeigene Bootstrap-Nummer sicherstellen
(`resolveBootstrapAlertSender` leitet den Absender daraus ab).

**Wie man zurueckdreht:** nichts — verschwindet automatisch mit der naechsten Messung.

**Wann eskaliert wird:** sofort, VOLLER Meldeweg. Der Mail-Kanal (`PLATFORM_ALERT_MAIL_TO`)
bleibt unabhaengig davon funktionsfaehig — genau deshalb ist Mail der primaere Kanal.

## `config_*` (Klasse `config`, VOLLER Alarm, NIE ein Gate)

`config_el_number_missing`, `config_el_agent_mismatch`, `config_el_outbound_disabled`,
`config_connection_inactive`, `config_ani_mismatch`, `config_fqdn_unbound`,
`config_ovp_disabled`, `config_ovp_destination_missing`.

**Was es heisst:** eine Konfigurationsabweichung, die bewusst gewollt sein KANN (z.B.
waehrend Weg 1 der Wiederherstellung — `config_ani_mismatch` ist dabei ERWARTET und
gehoert in `outbound-drift-ausnahmen.json` mit Grund+Datum, solange der Umbau laeuft).

**Welcher GET es bestaetigt:** je nach Code — s. die jeweilige Methode in
`src/telephony/adapters/telnyx/config-read.js` bzw. `src/elevenlabs/convai.js#
fetchPhoneNumber` (Pruefung 1).

**Wie man es behebt:** die genannte Env-ID (`TELNYX_FQDN_CONNECTION_ID`,
`TELNYX_OUTBOUND_VOICE_PROFILE_ID`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_PHONE_NUMBER_ID`)
bzw. die Anbieter-Konfiguration selbst (Connection aktivieren, OVP-Ziellaender ergaenzen)
korrigieren.

**Wann eskaliert wird:** sofort, VOLLER Meldeweg — aber NIE ein Gate (config-Befunde
lehnen keinen Anruf ab).

## `balance_low` (Klasse `warn`, NUR Notiz)

**Was es heisst:** das Telnyx-Guthaben reicht bei aktuellem 24h-Verbrauch fuer weniger als
`OUTBOUND_DRIFT_BALANCE_MIN_HOURS` (Default 72h) — eine REICHWEITE, kein fester Betrag.

**Welcher GET es bestaetigt:** `GET /v2/balance` (Telnyx-Portal: Billing).

**Wie man es behebt:** Guthaben aufladen.

**Wann eskaliert wird:** NUR als Notiz (WARN + Audit, kein Mail/SMS) — kein akuter
Totalausfall, aber ein absehbarer.

## `unbekannt:pruefungN` (Klasse `unknown`, NUR Notiz, NIE stumm)

**Was es heisst:** die Pruefung konnte kein Urteil faellen — fehlende Konfiguration,
Anbieterfehler, Timeout, oder (Pruefung 8/9 im CLI-Kontext) strukturell fehlender
Store-Zugriff. **Das ist NICHT "alles gruen"** — der 27.08.2026-Ausfall blieb drei Tage
unsichtbar, weil eine unbeantwortbare Frage wie eine beantwortete aussah.

**Welcher GET es bestaetigt:** die zugehoerige Pruefung selbst — `detail` im Befund nennt
den Grund (`http_404`, `http_429`, `timeout`, `netz`, `soll_fehlt`).

**Wie man es behebt:** je nach Grund — fehlenden Schluessel/ID setzen, Anbieter-Ausfall
abwarten, Rate-Limit pruefen (Telnyx `4;w=1`).

**Wann eskaliert wird:** als Notiz (WARN + Audit). Der CLI-Weg (`npm run outbound:drift`)
ist STRENGER: dort blockiert JEDER nicht ausgenommene unknown-Befund den Exit-Code (1) —
es gibt keinen zweiten Kanal, der das sonst auffinge.

## `watchdog_stale` (Klasse `watchdog_stale`, VOLLER Alarm)

**Was es heisst:** die letzte ERFOLGREICHE Messung ist aelter als
`OUTBOUND_DRIFT_STALE_MS` (Default 6h) — ein abgelaufener Schluessel, ein dauerhaftes 5xx,
oder ein deaktivierter GitHub-Actions-Workflow haben den gesamten Fruehwarner still
abgeschaltet.

**Welcher GET es bestaetigt:** keiner direkt — es ist die ABWESENHEIT jeder erfolgreichen
Messung ueber die Frist.

**Wie man es behebt:** den Waechter selbst reparieren (Schluessel erneuern, Anbieter-Status
pruefen, Actions-Workflow wieder aktivieren).

**Wann eskaliert wird:** sofort, VOLLER Meldeweg.

## `outage_not_placed` (Bestand, E3b — zum Vergleich)

Der VERKEHRSBASIERTE Ausfall-Melder (E3b): erkennt einen systematischen Ausfall an
gescheiterten Anrufen selbst. Ergaenzt den Drift-Waechter — bei ~1 Anruf/Woche zu langsam
allein, aber ein zweiter, unabhaengiger Signalweg. S. `PLAN-OUTBOUND-RESILIENZ.md` E3b.

## `platform_number_hold` (Bestand, C8/E3b — zum Vergleich)

Eine Kuendigung haengt wegen einer Plattform-Bindung (`platform_number_in_use`) laenger
als 24h. Eigener, dauerhaft entprellter Meldeweg (`kuendigungen=N nummern=M` in der
Alarmzeile). S. `PLAN-OUTBOUND-RESILIENZ.md` Abschnitt 9.

## Betrieb: der externe Takt

`.github/workflows/outbound-drift.yml` faehrt stuendlich (`cron: "17 * * * *"`) und bei
manuellem `workflow_dispatch`. **Fehlt eines der vier Secrets (`TELNYX_API_KEY`,
`ELEVENLABS_API_KEY`, `PLATFORM_ANI_E164`, `ELEVENLABS_AGENT_ID`), wird der Workflow ROT**
(bewusst, anders als
`elevenlabs:drift` in `ci.yml` — ein uebersprungener Waechter darf nie wie ein bestandener
aussehen). Secrets hinterlegen: GitHub-Repo → Settings → Secrets and variables → Actions.

## ANI-Cutover und Nummern-Registrierung (OUTBOUND-E5)

Bezug: `PLAN-OUTBOUND-RESILIENZ.md` Etappe E5 (F3), `tasks/befund-outbound-ausfall-2026-08-27.md`
Abschnitt 3 (F3) + Abschnitt 5. Solange `ani_override_type: "always"` auf der SIP-Trunk-
FQDN-Connection steht, ueberschreibt Telnyx JEDE von ElevenLabs gesendete Absendernummer —
der Code dieser Etappe ist bis zum Cutover korrekt und folgenlos, wirkt aber OHNE weitere
Code-Aenderung, sobald der Cutover unten gefahren ist.

**Harte Vorbedingungen — JEDE einzelne, sonst faellt der Outbound aus:**

| # | Vorbedingung | Beleg |
|---|---|---|
| V1 | `ELEVENLABS_NUMBER_REGISTRATION_ENABLED=true` + `TELNYX_SIP_TRUNK_USERNAME`/`TELNYX_SIP_TRUNK_PASSWORD` im Render-Dashboard, Deploy erfolgt | `/healthz`-Feld `commit` (`config.server.deployedCommit`) stimmt mit dem erwarteten Deploy-Commit ueberein, UND die Boot-Log-Zeile `[boot] Konfig-Warnung: ELEVENLABS_NUMBER_REGISTRATION_ENABLED=true ohne TELNYX_SIP_TRUNK_USERNAME/...` (`warnElRegistrationSipCredsMissing`, `src/boot.js:396-404`) bleibt beim naechsten Start AUS. **NICHT** `configHash`: `configFingerprint` (`src/config-fingerprint.js:25-36`) hasht genau sieben Achsen (`allowedCountryCodes`, `maxCallsPerHour`, `budgetMonthEnabled`, `multiTenant`, `paymentCurrency`, `platformSpendCapCents`, `defaultTenantBudgetCents`) - weder `ELEVENLABS_NUMBER_REGISTRATION_ENABLED` noch die SIP-Zugangsdaten gehen ein, der Hash ist vor und nach V1 byte-identisch (Lehre "configHash belegt Modell-Flips NICHT"). |
| V2 | **Pilot:** eine Nummer registriert (`npm run elevenlabs:nummern -- --anlegen --ja-wirklich --nur=<numberId>`), `GET /v1/convai/phone-numbers/{id}` gelesen, Testanruf gefuehrt, Rechnung geprueft | schliesst die UNBELEGT-Punkte (Registrierungskosten, `inbound_trunk_config` optional?) aus |
| V3 | **Jede aktive DID hat eine Registrierung, keine Waisen ausser der globalen Rueckfall-Registrierung** | `npm run elevenlabs:nummern` (Default `--pruefen`) ⇒ Exit `0`, „0 aktive DIDs ohne Registrierung, 0 abweichend, 0 Waise(n) beim Anbieter". Die globale Rueckfall-Registrierung (`ELEVENLABS_AGENT_PHONE_NUMBER_ID`, s. V4) zaehlt NICHT als Waise — sie ist Betriebszustand. Bei `--nur=<numberId>` (Pilot) wird die Waisen-Pruefung trotzdem gegen ALLE aktiven DIDs gefahren, nicht nur die gewaehlte. |
| V4 | **Die globale Rueckfall-Registrierung (`ELEVENLABS_AGENT_PHONE_NUMBER_ID`) traegt eine KONTOEIGENE Nummer** | heute traegt sie die am 24.08. freigegebene `+15739090177`. **Ohne V4 endet jeder Rueckfall-Anruf nach dem Cutover in SIP 403 D51** — heute maskiert der ANI-Override das. Owner: neue Registrierung fuer die Plattform-DID anlegen und `ELEVENLABS_AGENT_PHONE_NUMBER_ID` nachziehen. |

**Ist-Stand sichern (GET, kostenlos):**

```bash
curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/fqdn_connections/3026479542865757220 \
| jq '.data.outbound | {ani_override, ani_override_type, outbound_voice_profile_id}'
```

Der volle Antwortkoerper traegt `password` im Klartext — nur die drei Felder ansehen, nie
den Rohkoerper irgendwohin kopieren oder loggen.

**Scharfschalten — den WERT leeren, NICHT den Typ aendern** (`ani_override_type` kennt kein
Aus: Enum `["always","normal","emergency"]`, Default `always`, Doku woertlich „Only applies
when ani_override is not blank" — der einzige belegte Ausschalter ist der leere Wert):

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $TELNYX_API_KEY" -H "content-type: application/json" \
  https://api.telnyx.com/v2/fqdn_connections/3026479542865757220 \
  -d '{"outbound":{"ani_override":""}}'
```

Beleg (GET): `.data.outbound.ani_override == ""`.

**Wirkungs-Beleg (kostet einen Anruf):** Testanruf fuehren, dann

```bash
curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/detail_records?filter[record_type]=call&page[size]=5" | jq '.data[] | {from,to,started_at}'
```

⇒ `from` muss die DID des anrufenden Tenants sein. Zusaetzlich in der DB:
`from_registration_source='tenant_did'`, `from_actual_e164 = from_e164`.

**Rueckbau — EINE Zeile, sofort wirksam, kein Deploy:**

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $TELNYX_API_KEY" -H "content-type: application/json" \
  https://api.telnyx.com/v2/fqdn_connections/3026479542865757220 \
  -d '{"outbound":{"ani_override":"+18643028341","ani_override_type":"always"}}'
```

Zweite, unabhaengige Rueckbau-Achse (Code-Seite): `ELEVENLABS_NUMBER_REGISTRATION_ENABLED=false`
+ Neustart ⇒ keine neuen Registrierungen; die Auswahl faellt fuer jede DID ohne Kennung auf
den Bestand (globale Rueckfall-Registrierung) zurueck.

**Danach:** `outbound-drift-ausnahmen.json` → Eintrag `config_ani_mismatch` entfernen
(Grund im Eintrag selbst dokumentiert).

### Reparaturlauf (Bestands-DIDs, Backfill)

`npm run elevenlabs:nummern` prueft (Default), ob jede aktive Tenant-DID eine eigene
ElevenLabs-Registrierung traegt, deren `phone_number` mit ihr uebereinstimmt, und listet
Waisen (Registrierungen ohne passende aktive DID). NUR-LESEND im Default-Modus.

```
npm run elevenlabs:nummern                                   # --pruefen (Default), nur-lesend
npm run elevenlabs:nummern -- --anlegen --ja-wirklich         # legt fehlende Registrierungen an
npm run elevenlabs:nummern -- --anlegen --ja-wirklich --nur=<numberId>  # Pilot: EINE Nummer
```

Fail-closed: fehlender `ELEVENLABS_API_KEY` (bzw. bei `--anlegen` fehlende SIP-Zugangsdaten
oder `ELEVENLABS_NUMBER_REGISTRATION_ENABLED=false`) ⇒ Exit 1 mit benannter Meldung, nie ein
stilles OK. Betriebliche Voraussetzung: `STORE_BACKEND=pg` + `DATABASE_URL` + IP in der
Prod-DB-Allowlist (Lehre `prod-db-ip-allowlist`: „SSL connection closed unexpectedly" heisst
Firewall, nicht TLS).
