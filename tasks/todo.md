# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**
- Rebrand-Task im Detail: **`tasks/rebrand-sundartha.md`**

---

# Task: Kauf-Land entkoppeln (alle Nummern US, Sprache bleibt Geo-basiert)

## Ziel
Geo-Nummernkauf NICHT loeschen, sondern per Config neutralisieren: jeder neue User
bekommt eine US-Nummer (+1), aber die Sprache wird weiter aus dem erkannten Herkunfts-
land gesetzt (DE->de, FR->fr, ...). Steuerung ueber Env-Flag `FORCE_NUMBER_COUNTRY`
(leer = heutiges Verhalten byte-identisch; "US" = jede Nummer US).

## Kernidee (Entkopplung)
- `tenant.country` = ERKANNTES Herkunftsland (Quelle fuer Sprache/Analytics) — unveraendert.
- `number.country` = KAUF-Land (= forceNumberCountry, sonst Herkunftsland).
- Laufzeit-Sprache haengt an `number.language` (resolveCallLanguage) — bleibt korrekt.

## Schritte
1. [x] `src/config.js`: `forceNumberCountry` (FORCE_NUMBER_COUNTRY, Default "" = aus).
2. [x] `src/server.js` Onboarding: `numberCountry = config.forceNumberCountry || country`,
       an requestNumber; language + tenant.country unveraendert (Herkunftsland). Doc-Komm.
3. [x] `src/billing/provision-trigger.js`: neues Arg `forceNumberCountry`;
       `numberCountry = forceNumberCountry || homeCountry`; language = languageForCountry(homeCountry).
4. [x] `src/server.js` triggerTenantProvisioning: `forceNumberCountry: config.forceNumberCountry`.
5. [x] `test/helpers.js` BASE_ENV: `FORCE_NUMBER_COUNTRY: ""` (kein .env-Leak, Lehre test-base-env-drift).
6. [x] `.env.example`: FORCE_NUMBER_COUNTRY= (dokumentiert, Default leer).
7. [x] `render.yaml`: FORCE_NUMBER_COUNTRY: "US" (Owner-Wahl: US fuer alle, jetzt).
8. [x] Tests: f1-geo-onboard (FORCE=US -> number.country US, language de, tenant DE);
       bk3-auto-provision (forceNumberCountry US -> number.country US, home-language).

## Erwartetes Ergebnis (deterministisch)
- FORCE_NUMBER_COUNTRY leer: `npm test` byte-identisch gruen (kein Verhaltenswechsel).
- FORCE_NUMBER_COUNTRY=US, User DE: number.country="US", number.language="de",
  tenant.country="DE", tenant.defaultLanguage="de".

## Verifikation
- `node --check` auf alle geaenderten src-Dateien.
- `npm test` (alle gruen, inkl. neuer Faelle).

## Review (/code-review, 3 parallele Finder + Eigenverifikation)
- Verifikation: node --check alle geaenderten Dateien OK; `npm test` 1233/1233 gruen
  (inkl. 2 neuer Faelle); byte-identisch bei leerem Flag (Logik + Bestandstests gruen).
- Cross-File: number.country="US" fliesst sauber in searchParamsForCountry (US in Tabelle)
  + holdAmountForCountry("US", default)=Default; Outbound-Allowlist prueft ZIEL, nicht
  Absender -> kein Land-Gate-Umgehen; Signatur/Budget/Caps unberuehrt (Regel 1 ok).
- pg-Backend: number.country UND number.language getrennte Spalten (pg.js INSERT/SELECT/
  hydrate) -> entkoppelter US/de-Roundtrip ueberlebt, kein neuer Code-Pfad.
- 3 Findings, alle bewusst NICHT gefixt (mit Begruendung):
  1. G5-Dup `forceNumberCountry || X` an 2 Stellen: bare `||`-Operator, kein Domaenen-
     Code; Helper waere reine Indirektion (Clean-Code Regel 3 Vorrang Lesbarkeit, S4-Risk).
     provision-trigger ist zudem bewusst config-frei -> kann config nicht teilen. DECLINE.
  2. Fehlender pg-Roundtrip-Test fuer US/de: deckt denselben generischen Spalten-Pfad ab
     wie der bestehende FR/fr-pg-Test -> niedrigwertig, kein Bug. OPTIONAL.
  3. Keine ISO-Validierung von FORCE_NUMBER_COUNTRY: Tippfehler ("USA") -> fail-safe
     DE-Fallback (kein Leak/Kostenrisiko), konsistent mit unvalidiertem PROVISIONING_
     COUNTRY; Owner-env, kein User-Input. OPTIONAL-Hardening, out-of-scope. DECLINE.
- OFFEN (owner/infra-gated, kein Code): Live-Beweis = echte US-Nummer kaufen
  (PROVISIONING_ENABLED=true + Telnyx-App mit US-DID-Recht) + deutschsprachiger Testanruf
  auf der +1-Nummer. Plus: FORCE_NUMBER_COUNTRY=US muss in der Render-Env/Blueprint aktiv
  werden (render.yaml gesetzt; ggf. Dashboard-Sync noetig, Deploy-Repo upstream beachten).
