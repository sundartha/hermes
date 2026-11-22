# Runbook: Outbound

## `outage_not_placed` (Bestand, E3b)

Der VERKEHRSBASIERTE Ausfall-Melder (E3b): erkennt einen systematischen Ausfall an
gescheiterten Anrufen selbst. S. `PLAN-OUTBOUND-RESILIENZ.md` E3b. Die Meldung geht als Vorfall
(`alert`, Schluessel = Fehlerklasse) an den Better-Stack-Eingang (`BETTERSTACK_ALERT_URL`, s.
`.env.example`); nur eine mit 2xx angenommene Meldung gilt als zugestellt, sonst wiederholt sie
sich nach `OUTAGE_ALERT_RETRY_MS`. Ein produktiver Start ohne diesen Eingang wird verweigert
(`src/konfiguration/alarm-eingang-pruefung.ts`); vor dem Deploy im Render-Dashboard setzen.

## `platform_number_hold` (Bestand, C8/E3b)

Eine Kuendigung haengt wegen einer Plattform-Bindung (`platform_number_in_use`) laenger
als 24h. Eigener, dauerhaft entprellter Meldeweg (`kuendigungen=N nummern=M` in der
Alarmzeile). S. `PLAN-OUTBOUND-RESILIENZ.md` Abschnitt 9. Gemeldet wird wie beim Ausfall als
Vorfall an den Better-Stack-Eingang, mit Wiederholung nach `OUTAGE_ALERT_RETRY_MS`, solange der
Eingang die Meldung nicht angenommen hat.

## Absender

Absender = eigene Nummer des Mandanten, sonst Abbruch.

## Reparaturlauf (Bestands-DIDs, Backfill)

`npm run elevenlabs:nummern` (Quelle: `scripts/el-nummern-registrierung.mjs`) prueft (Default), ob jede aktive Tenant-DID eine eigene
ElevenLabs-Registrierung traegt, deren `phone_number` mit ihr uebereinstimmt, und listet
Waisen (Registrierungen ohne passende aktive DID). NUR-LESEND im Default-Modus.

```
npm run elevenlabs:nummern                                   # --pruefen (Default), nur-lesend
npm run elevenlabs:nummern -- --anlegen --ja-wirklich         # legt fehlende Registrierungen an
npm run elevenlabs:nummern -- --anlegen --ja-wirklich --nur=<numberId>  # Pilot: EINE Nummer
```

Fail-closed: fehlender `ELEVENLABS_API_KEY` (bzw. bei `--anlegen` fehlende `ELEVENLABS_AGENT_ID`,
Quelle `fehlendeZugangsdaten` in `src/elevenlabs/nummern-registrierung.ts`) ⇒ Exit 1 mit benannter Meldung, nie ein
stilles OK. Betriebliche Voraussetzung: `STORE_BACKEND=pg` + `DATABASE_URL` + IP in der
Prod-DB-Allowlist (Lehre `prod-db-ip-allowlist`: „SSL connection closed unexpectedly" heisst
Firewall, nicht TLS).
