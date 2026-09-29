# Runbook: Outbound

## `outage_not_placed` (Bestand, E3b)

Der VERKEHRSBASIERTE Ausfall-Melder (E3b): erkennt einen systematischen Ausfall an
gescheiterten Anrufen selbst. S. `PLAN-OUTBOUND-RESILIENZ.md` E3b.

## `platform_number_hold` (Bestand, C8/E3b)

Eine Kuendigung haengt wegen einer Plattform-Bindung (`platform_number_in_use`) laenger
als 24h. Eigener, dauerhaft entprellter Meldeweg (`kuendigungen=N nummern=M` in der
Alarmzeile). S. `PLAN-OUTBOUND-RESILIENZ.md` Abschnitt 9.

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
