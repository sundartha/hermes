# Phase P7 (f1-p7) - Detailbericht

Per-Job-countryCode + Telnyx-Geo-Suche (Provisioning)

## Status

GEMERGT-bereit. GATE = PASS (dualer Review: Safety/Verhalten + Clean-Code, beide PASS, keine S1/S2-Blocker). Fix-Runden: 0. Tests gruen 827/827. node --check auf allen geaenderten Quelldateien OK.

## Kern: was umgesetzt wurde

Die Provisioning-Suchparameter (countryCode/connectionId) werden jetzt **pro Job aus dem Number-Record** abgeleitet (`number.country`) statt aus dem globalen `config.provisioningCountry`. Damit kann fuer einen FR-Tenant eine +33-Nummer gesucht werden, ohne den globalen DE-Default anzutasten. Zusaetzlich: Telnyx-Geo-Suche mit Verfuegbarkeits-Auswahl (hoeheres limit) statt `limit:1`, plus kontrollierter Fehler bei 0 Treffern (R5) statt Crash.

## Umgesetzte Dateien + Kernentscheidungen

- **NEU `src/telephony/provisioning-geo.js`**: Zentrale Land->Suchparameter-Tabelle `searchParamsForCountry(country)` -> `{ countryCode, connectionId?, type? }`. `COUNTRY_SEARCH_PARAMS` mit `Object.freeze`. FR/GB freigeschaltet. DE und jedes unbekannte/leere Land fallen auf den globalen config-Fallback (`provisioningCountry`/`telnyxConnectionId`) -> DE byte-identisch, fail-closed (kein stiller Fremd-Land-Kauf). Liegt bewusst in der Telephonie-Schicht, getrennt von der i18n-Tabelle `LANGUAGE_FOR_COUNTRY` (src/i18n/locales.js).
- **`src/server.js` (runProvisioningDrain)**: `opts` aufgeteilt in `moneyOpts` (land-unabhaengig, global: holdAmountCents/currency). Im Drain-Callback wird die Number via `findNumber` geladen, `geo = searchParamsForCountry(number?.country)` pro Job abgeleitet und als `{ ...moneyOpts, ...geo }` an `handleProvisionJob` durchgereicht. Fehlender Record -> `searchParamsForCountry(undefined)` = globaler DE-Fallback; Worker skippt zusaetzlich ueber den Zustandscheck.
- **`src/onboarding.js` (provisionNumber)**: `limit:1` -> benannte Konstante `PROVISION_SEARCH_LIMIT = 10` (Magic-Number-Verbot). Erster Kandidat deterministisch gewaehlt. 0 Treffer -> kontrollierter Fehler mit countryCode (R5), faengt im try/catch -> `failNumber` + Hold-Freigabe, kein Crash, kein bezahlter Orphan.
- **`test/helpers.js`**: `fakeProvisioner.searchNumbers` zeichnet jetzt den countryCode auf (`search:<cc>`).
- **`test/f1-provisioning-geo.test.js` (NEU, 9 Tests)** + angepasst: `test/onboarding-service.test.js`, `test/provisioning-worker.test.js`, `test/billing-hold-capture.test.js`.

## Invarianten (verifiziert am echten Code)

- **DREI Idempotenz-Schloesser BYTE-IDENTISCH unangetastet**: (1) Queue-Dedup `provision_${numberId}`, (2) Zustands-Schloss `status === REQUESTED` (src/worker/provisioning.js:21), (3) Telnyx Idempotency-Key `order_${numberId}` (src/onboarding.js:82). Hold-vor-Order + rollbackAfterOrder unveraendert. Worker (provisioning.js), ports.js und telnyx-numbers.js NICHT geaendert.
- **DE byte-identisch**: `searchParamsForCountry` liefert fuer DE/leer/unbekannt exakt `{ countryCode: config.provisioningCountry='DE', connectionId: config.telnyxConnectionId }` = das vormalige globale opts-Objekt; moneyOpts-Spread erhaelt die Payment-Felder. Bestaetigt durch angepasste Bestands-Tests (search -> search:DE).
- **fail-closed**: unbekanntes/leeres Land -> sicherer DE-Fallback, kein stiller Fremd-Land-Kauf, kein Crash.
- **PROVISIONING_ENABLED Default FALSE**: Dry-Run bleibt byte-identisch.
- **Praezedenz/Sprach-Resolution** (settings.language->number.language->tenant.defaultLanguage->"de") nicht Teil von P7, unberuehrt. Offenlegung unberuehrt (P7 = nur Provisioning).
- Keine neuen npm-Deps (package.json unveraendert), keine Secrets geleakt, Kommentare deutsch ohne Umlaute.

## Bewusste Abweichungen

1. **Per-Job-Ableitung im DRAIN (server.js), nicht im Worker (provisioning.js)** - abweichend von Plan-Empfehlung (b). Grund: Worker-Ueberschreibung via number.country wuerde Bestands-Worker-Tests brechen, die explizit `connectionId="conn_1"` als opts uebergeben (fuer DE wuerde die Tabelle `config.telnyxConnectionId`="" drueberschreiben und configure:conn_1 zerstoeren). Drain-seitige Ableitung haelt den Worker als unveraenderten Pass-Through (Signatur byte-identisch); bricht kein Idempotenz-Schloss.
2. **Such-limit/Auswahl in provisionNumber (onboarding.js), nicht im Adapter** - das harte `limit:1` sass dort. Adapter mappt bereits alle Treffer; ports.js-Vertrag deckt limit/type schon ab -> KEINE Vertrags-/Adapter-Aenderung noetig (anders als Doc "ports ggf. erweitern"). Minimaler Blast-Radius am Geld-Pfad.
3. **Land->Suchparameter-Tabelle als eigene Datei** (Telephonie-Schicht), getrennt von der i18n-Sprach-Tabelle - saubere Schicht-Trennung.

## Test-Ergebnis

- Voller Lauf: **827/827 pass, 0 fail** (beide Backends json-Default + pglite in derselben Suite, ~30s). Keine pre-existing roten Tests (L-CP7-3, g1-config-boot-refusal) aufgetreten.
- Isoliert vorab gruen: f1-provisioning-geo.test.js (neu, 9) + provisioning-worker + onboarding-service + telnyx-numbers + billing-hold-capture = 25/25.
- Neue Datei deckt ab: FR-Request -> search:FR; R1 (ZWEIMAL drainen -> genau EIN order); R5 (0 Treffer -> failed, kein order, kein Crash); DE-Fallback; case-insensitiv.

## Review-Verdikte

- **Safety/Verhalten: PASS**, keine Blocker. Drei Idempotenz-Schloesser byte-identisch verifiziert; DE byte-identisch; fail-closed; R5 Haertung (kein bezahlter Orphan); keine neuen Deps/Secrets; Praezedenz/Offenlegung unberuehrt.
- **Clean-Code: PASS**, keine S1/S2. PROVISION_SEARCH_LIMIT benannte Konstante (kein Magic Number); kein toter/auskommentierter Code; keine abgeschalteten Checks; Funktionslaenge/Verschachtelung weit unter Grenzwert; Tabelle Object.freeze; Kommentare deutsch ohne Umlaute.

## Offene Punkte / Smoke-Gates

- **S3 (optional)**: f1-provisioning-geo.test.js spiegelt die Drain-Glue (record-Lookup + findNumber + searchParamsForCountry) ueber lokalen Helper `drainWithGeo`, statt das echte `runProvisioningDrain` aufzurufen. Die pruefenswerte Einheit (searchParamsForCountry) IST extrahiert/geteilt; nur die 3-zeilige Drain-Glue ist nachgebaut (bewusst, kommentiert). Optional: `deriveJobOpts(s, queuedJob, moneyOpts)` aus server.js ziehen und in beiden Pfaden nutzen.
- **S4 (latent)**: COUNTRY_SEARCH_PARAMS hat FR/GB; IE ist in i18n (locales.js, IE->en) unterstuetzt, fehlt hier und faellt auf DE-Fallback (durch "unbekannt->sicherer Default"-Vertrag gedeckt). Bei Aktivierung eines weiteren en-Lands IE-Eintrag nachziehen oder Drift bewusst dokumentieren.
- **Live-Smoke**: Adapter `searchNumbers` waehlt weiter candidate[0] ohne echtes Verfuegbarkeitsfeld (Adapter gibt nur e164); hoeheres limit mildert das Race nur statistisch. Bei Live-Smoke beobachten. KEIN echter Telnyx-Live-Call in Tests (Adapter gemockt).
