# OUT - Auslandstelefonie, Laender-Gate und Wahlziel-Normalisierung

## Ist-Stand (belegt)

Die Outbound-Gate-Kette hat **17 Glieder** in fester Reihenfolge (Array `gates` in
`src/telephony/outbound-gates.js:420-705`, hartkodiert nachgezogen im Snapshot-Test
`test/outbound-gates-order.test.js:17-32`): `outbound_frozen, resolve_identity, tenant_reject,
normalize_target, trunk_zero_normalized, kyc, owner_name, resolve_profile, number_gate,
valid_text, valid_mandate, assistant_context, resolve_outbound, budget, minutes,
compute_reserve, reserve_budget`. Der Modul-Kommentar direkt ueber dem Array behauptet
dagegen **"16 Glieder"** (`src/telephony/outbound-gates.js:419`) - Doku-Drift, verifiziert per
`grep -c 'name: "' src/telephony/outbound-gates.js` -> 17 Treffer.

Innerhalb von `number_gate` (Funktion `numberGateError`, `src/telephony/outbound-gates.js:264-307`)
ist die Reihenfolge: Denylist (Notruf `EMERGENCY_SHORT_CODES` exakt `110/112/911/999`,
`src/telephony/outbound-gates.js:51`, + Premium/IPRN/Satellit `PREMIUM_PREFIXES:58-90`) ->
E.164-Format (`E164`-Regex `src/store/defaults.js:471`) -> Laender-Gate (`countryGateAllowed`,
`src/telephony/outbound-gates.js:178-183`) -> globales Stundenlimit (`globalHourReached:189-190`)
-> Nutzer-Stundenlimit (`userHourReached:192-198`) -> Pro-Ziel-Cap (`perTargetCapReached:203-208`)
-> Verifikations-/Allowlist-Gate (`allowlistError:218-232`).

`ALLOWED_COUNTRY_CODES` ist eine GLOBALE Env-Var, Default `+49,+33,+44`
(`src/config.js:662-669`). `matchesPrefix` (`src/telephony/outbound-gates.js:128`) akzeptiert
zusaetzlich das Sonderzeichen `"*"` (alle Laender erlaubt) - bereits per Test belegt
(`test/number-gate.test.js`, Test `"* erlaubt alle Laender"`, ab Zeile ~113). Das Gate ist eine
Schnittmenge global ∩ Tenant-Profil (`countryGateAllowed:178-183`): ein Profil kann nur
WEITER einschraenken, nie erweitern. Mit dem Default-Gate wird jede `+1`-Nummer mit 403
`grund=land` abgelehnt - belegt in `test/number-gate.test.js:83-113`
(`"+49,+33,+44: FR(+33) und UK(+44) passieren, US(+1) -> 403 grund=land"`).

`normalizeDialTarget()` (`src/store/defaults.js:519-527`) kennt genau zwei Transformationen:
`"00"`-Praefix -> `"+"` und eine einzelne fuehrende `"0"` -> `homeCountry + Rest`. Alles andere
(zehnstellige US-Nummer ohne Praefix, Klammern-/Bindestrich-Schreibweisen NACH `normNum`,
`"011"`-US-Auslandspraefix) bleibt unveraendert und faellt am E.164-Regex durch (400).
`homeCountryCode()` (`src/store/defaults.js:503-510`) kann wegen `TRUNK_ZERO_COUNTRY_CODES =
["+49","+33","+44"]` (`src/store/defaults.js:486`) NIEMALS `"+1"` liefern; sie iteriert die
Kandidatenliste und nimmt die ERSTE Nummer mit passendem Praefix - eine `+1`-Kandidatennummer
wird uebersprungen, eine DE/FR/UK-Nummer dahinter gewinnt STILL als "Heimatland". Beide
Verhaltensweisen sind bereits explizit gepinnt in `test/dial-target-normalization.test.js:30-43`.

`languageForCountry("US")` existiert NICHT in `LANGUAGE_FOR_COUNTRY`
(`src/i18n/locales.js:268-275`, nur DE/AT/CH/FR/GB/IE) und faellt via
`|| DEFAULT_LANGUAGE` (`src/i18n/locales.js:279`) auf `"de"` zurueck.

`voiceTariffDomesticPrefixes` (`src/config.js:105,487`) ist identisch mit
`["+49","+33","+44"]` und enthaelt kein `+1` - jede erlaubte US-Nummer wuerde in
`tariffCentsPerMin()` (`src/telephony/outbound-gates.js:145-149`) immer den
`voiceTariffDefaultCents`-Satz (Default 300 ct, `src/config.js:462`) statt des
Inlandstarifs (Default 20 ct, `src/config.js:458`) treffen - fuer den generischen Fall
bereits gruen getestet in `test/cost-calibration.test.js:201-202`.

Der C-Telnyx-Assistant-Origination-Pfad (`originateAiAssistantCall`,
`src/telnyx-origination.js:17-30`) reicht `to` unveraendert an `voiceControl().
originateViaCallControl` weiter - keine eigene Laender-/Format-Logik, laeuft strikt HINTER der
kompletten Gate-Kette.

`POST /api/calls` (`src/routes/api-calls.js:69-74`) fuehrt VOR der Gate-Kette bereits einen
Pre-Check (`isTrunkZeroFormatError`, `src/store/defaults.js:463-464`) durch, der NUR fuer
`TRUNK_ZERO_COUNTRY_CODES` (`["+49","+33","+44"]`) einschlaegig ist - fuer NANP-Nummern
strukturell nie.

Kein US-Premium-/Pay-Per-Call-Schutz: `PREMIUM_PREFIXES`
(`src/telephony/outbound-gates.js:58-90`) deckt Satellit/IPRN + DE/UK/FR ab, aber keinen
einzigen `+1900`/`+1976`-Eintrag; verifiziert per
`grep -c '"+1' src/telephony/outbound-gates.js` -> 0 Treffer.

Kein DTMF-/IVR-Handling: `grep -rn "DTMF\|dtmf" src/` -> 0 Treffer (verifiziert).

Wichtige Ergaenzung zum Recon-Befund: die Nummern-BESCHAFFUNG kennt die USA bereits.
`COUNTRY_SEARCH_PARAMS` in `src/telephony/provisioning-geo.js:34-38` enthaelt `FR`, `GB` UND
`US` (`telnyxCountryCode: "US"`) - ein Tenant kann also technisch bereits heute eine `+1`-DID
provisioniert bekommen, waehrend das Outbound-Laender-Gate `+1` per Default weiterhin blockt.
Das verschaerft OUT-13 unten: der Zustand "hat eine US-DID, kann aber niemanden anrufen" ist
mit dem heutigen Default real erreichbar, nicht nur hypothetisch.

Der Offenlegungssatz existiert fuer EN bereits kuratiert und byte-stabil
(`src/i18n/locales.js:236-238`: `"Hello, this is an AI assistant calling on behalf of
${ownerName}. This conversation will be summarised for the person I represent."`).

## Luecken

| Luecke | Schaden | Beleg | Schwere |
| --- | --- | --- | --- |
| `ALLOWED_COUNTRY_CODES`-Default (`+49,+33,+44`) schliesst `+1` komplett aus | Jeder US-Outbound-Call ist per Default tot (403 land), auch an sich selbst | `src/config.js:662-669`, `test/number-gate.test.js:83-113` | S1 |
| `normalizeDialTarget`/`homeCountryCode` kennen kein NANP (10-stellig, Klammern/Bindestriche, `011`-Praefix, `1-800`) | US-Nutzer, die national schreiben, bekommen generischen 400-Formatfehler ohne Anleitung | `src/store/defaults.js:519-527`, `src/mcp-tools.js:368-372` (keine NANP-Erwaehnung) | S1 |
| `homeCountryCode` waehlt bei gemischten Kandidaten (US-Privatnummer + DE/FR/UK-DID) STILL das falsche Land | Fehlanruf-Risiko: Ziel wird als DE-Nummer statt US-lokal interpretiert, kein Format-Fehler | `src/store/defaults.js:503-510`, `test/dial-target-normalization.test.js:30-35` | S1 |
| `languageForCountry("US")` fehlt -> faellt auf `"de"` | Geo-Country-Ableitung `US` ergibt ohne manuelles Sprach-Override einen deutschen Agenten | `src/i18n/locales.js:268-280` | S1 |
| Kein US-Premium-/Pay-Per-Call-Schutz (`1-900`/`1-976`) in `PREMIUM_PREFIXES` | Sobald `+1` freigeschaltet wird, offene IRSF-/Kostenfalle fuer den US-Markt | `src/telephony/outbound-gates.js:58-90` | S2 |
| Kein zeitzonenbewusstes Anrufzeiten-Gate (Quiet Hours) | TCPA-relevantes regulatorisches Risiko + Belaestigungs-Risiko bei internationalem Rollout | `src/telephony/outbound-gates.js` (17er-Kette ohne Tageszeit-Bezug), `grep 'quiet.hour\|business.hour\|timezone' src/` -> 0 Treffer | S2 |
| Toll-Free-Nummern (`+1800` etc.) werden zum vollen Worst-Case-Tarif abgerechnet | Systematische Ueberbepreisung der in den USA dominanten Anrufart (Hotlines) | `src/config.js:105,487`, `test/cost-calibration.test.js:201-202` | S3 |
| Kein DTMF-/IVR-Navigationsvermoegen | Agent scheitert funktional an automatisierten US-Menues, ohne das als eigenen Fehlerzustand zu erkennen | `grep 'DTMF\|dtmf' src/` -> 0 Treffer | S3 |
| Modul-Kommentar "16 Glieder" vs. tatsaechlich 17 | Doku-Drift, Risiko fuer falsch einsortierte kuenftige Gates (z.B. US-Premium-/Quiet-Hours-Gate) | `src/telephony/outbound-gates.js:419` vs. `test/outbound-gates-order.test.js:17-32` | S3 |
| US bereits in `COUNTRY_SEARCH_PARAMS` provisionierbar, aber Outbound-Gate blockt `+1` | Ein frisch onboardeter US-Tenant bekommt eine funktionslose DID (kann nicht anrufen) | `src/telephony/provisioning-geo.js:34-38` vs. `src/config.js:662-669` | S1 |

## Tests

### OUT-01 - Default-Laender-Gate blockt jede +1-Nummer
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES` unbenannt/Default (`+49,+33,+44`), `TWILIO_ACCOUNT_SID=x` (offline-Diskriminator), `ALLOWED_NUMBERS` enthaelt eine US-Zielnummer
- **Schritte**:
  1. Server per `startServer({ env: { ALLOWED_NUMBERS: "+12025550123,+491711234567", TWILIO_ACCOUNT_SID: "x" } })` starten (Default `ALLOWED_COUNTRY_CODES` NICHT setzen)
  2. `POST /api/calls` mit `to: "+12025550123"`, `objective: "Test"`
  3. `POST /api/calls` mit `to: "+491711234567"` als Kontrolle
- **Erwartetes Ergebnis**: Schritt 2 liefert Status 403, `error` matched `/Laendervorwahl/`; Schritt 3 liefert Status 500 (alle Gates passiert, offline-Twilio-Fehler)
- **Verifikation**: `node --test test/number-gate.test.js` (Test `"Default +49,+33,+44: ... US(+1) -> 403 grund=land"` deckt das bereits ab)
- **Heute erwartbar**: gruen - Verhalten bereits exakt so implementiert und gepinnt
- **Belegt durch**: src/config.js:662-669, src/telephony/outbound-gates.js:178-183, test/number-gate.test.js:83-113

### OUT-02 - "*" oeffnet das Laender-Gate fuer +1
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES=*`, `TWILIO_ACCOUNT_SID=x`
- **Schritte**:
  1. Server mit `ALLOWED_COUNTRY_CODES: "*"` und `ALLOWED_NUMBERS: "+12025550123"` starten
  2. `POST /api/calls` mit `to: "+12025550123"`
- **Erwartetes Ergebnis**: Status 500 (Land-Gate passiert, scheitert erst am Twilio-Client)
- **Verifikation**: `node --test test/number-gate.test.js` (Test `"* erlaubt alle Laender"`)
- **Heute erwartbar**: gruen - bereits als Test vorhanden
- **Belegt durch**: src/telephony/outbound-gates.js:128, test/number-gate.test.js (Abschnitt "* erlaubt alle Laender")

### OUT-03 - Tenant-Profil kann Laender-Gate nur einschraenken, nie erweitern
- **Prioritaet**: P1
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES="+49,+33,+44,+1"` (global erlaubt +1), Tenant-Profil `allowedCountryCodes: ["+49"]` (enger)
- **Schritte**:
  1. Store mit einem Tenant seeden, dessen `profile.allowedCountryCodes = ["+49"]` gesetzt ist (ueber `seedState`, analog zu bestehenden Profil-Tests)
  2. Server mit `ALLOWED_COUNTRY_CODES: "+49,+33,+44,+1"` starten
  3. `POST /api/calls` mit `to: "+12025550123"` unter diesem Tenant
- **Erwartetes Ergebnis**: Status 403, `error` matched `/Laendervorwahl/` - das Profil senkt die globale Erlaubnis, kann sie aber nicht umgekehrt erweitern
- **Verifikation**: `node --test test/number-gate.test.js` (neuer Testfall in Abschnitt "Laender-Gate", Muster wie bestehende Profil-Tests in diesem File)
- **Heute erwartbar**: unbekannt - Logik (`countryGateAllowed:178-183`, Schnittmenge) legt gruen nahe, aber kein bestehender Test deckt genau diese Profil-Einschraenkungs-Richtung mit +1 ab
- **Belegt durch**: src/telephony/outbound-gates.js:178-183

### OUT-04 - homeCountryCode liefert fuer reine +1-Kandidaten immer null
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine (reiner Funktionsaufruf)
- **Schritte**: `homeCountryCode(["+15005550006"])` und `homeCountryCode(["+12025550123", "+17025550123"])` aufrufen
- **Erwartetes Ergebnis**: beide Aufrufe liefern `null`
- **Verifikation**: `node --test test/dial-target-normalization.test.js` (Testfall "kein Trunk-0-Kandidat / Raender -> null")
- **Heute erwartbar**: gruen - bereits exakt gepinnt (`+15005550006` als Fall)
- **Belegt durch**: src/store/defaults.js:486,503-510, test/dial-target-normalization.test.js:37-43

### OUT-05 - homeCountryCode waehlt bei US-Privatnummer + DE-DID still die DE-Vorwahl
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: Kandidatenliste `[US-Privatnummer, DE-DID]` in genau dieser Reihenfolge (Praezedenz: privateNumber vor DID, wie im Aufrufer `outboundFrom`/Gate-Kontext)
- **Schritte**: `homeCountryCode(["+15005550006", "+491701234567"])` aufrufen
- **Erwartetes Ergebnis**: Rueckgabewert `"+49"` (NICHT `null`, NICHT `"+1"`) - die US-Nummer wird uebersprungen, die DE-Nummer dahinter gewinnt als "Heimatland"
- **Verifikation**: `node --test test/dial-target-normalization.test.js` (Testfall "US-DID (kein Trunk-0-Land) wird uebersprungen -> DE-Kandidat dahinter greift")
- **Heute erwartbar**: gruen - bereits exakt gepinnt, ABER: dies ist der dokumentierte Beweis fuer den S1-Befund "stille Fehlnormalisierung", der Test bestaetigt das GEFAeHRLICHE Verhalten als Ist-Stand, nicht als Fix
- **Belegt durch**: src/store/defaults.js:503-510, test/dial-target-normalization.test.js:30-35

### OUT-05b - End-to-End-Beweis: US-Tenant mit fremder DE-DID waehlt fuehrende 0 falsch
- **Prioritaet**: P0
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: Tenant mit `privateNumber` einer US-Nummer (`+15005550006`), aktiver DID `+491701234567` (DE), `ALLOWED_COUNTRY_CODES` enthaelt `+1` und `+49`
- **Schritte**:
  1. Server mit passendem Seed + Env starten
  2. `POST /api/calls` mit `to: "0212555 0199"` (vom Nutzer als lokale US-Nummer mit fuehrender 0 gemeint, faktisch keine gueltige US-Schreibweise, aber illustriert die Verwechslungsgefahr) ODER praeziser: `to: "0"+<9-stellige DE-Ziffernfolge>`, die als DE-Nummer gueltig normalisiert wird, obwohl der Tenant US-Kontext hat
- **Erwartetes Ergebnis**: `normalizeDialTarget` liefert eine `+49...`-Nummer (nicht abgelehnt, nicht als US interpretiert) - der Call laeuft potenziell an eine falsche, echte DE-Nummer durch (500 statt 400, weil alle Gates das `+49`-Ergebnis akzeptieren)
- **Verifikation**: neuer Test in `test/dial-target-normalization.test.js`, Muster wie bestehender Abschnitt "DE-DID als Heimatland-Fallback ohne privateNumber -> 500", aber mit US-Privatnummer + DE-DID-Konstellation und einer Ziel-Assertion auf das TATSAeCHLICH gewaehlte `to` (z.B. via Spy auf `originateCall`/Log)
- **Heute erwartbar**: unbekannt - die Normalisierungslogik selbst ist gepinnt (OUT-05), aber ein direkter End-to-End-Test mit Ziel-Pruefung existiert nicht; ohne Zugriff auf das tatsaechlich gewaehlte `to` im HTTP-Pfad ist die Assertion nicht ohne Erweiterung des Test-Helpers moeglich
- **Belegt durch**: src/store/defaults.js:503-527, src/routes/api-calls.js:69-84

### OUT-06 - NANP-Schreibweisen werden nicht normalisiert und scheitern generisch
- **Prioritaet**: P0
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: keine (reiner Funktionsaufruf, `normalizeDialTarget`/`normNum` kombiniert)
- **Schritte**: fuer jede der folgenden Roheingaben `normNum()` dann `normalizeDialTarget(x, "+1")` (bzw. ohne Heimatland) aufrufen: `"(212) 555-0123"`, `"212-555-0123"`, `"2125550123"` (10-stellig ohne Praefix), `"011491701234567"` (US-Auslandspraefix statt "00")
- **Erwartetes Ergebnis**: `normNum("(212) 555-0123")` === `"2125550123"` (Klammern/Leerzeichen/Bindestrich entfernt), aber `normalizeDialTarget("2125550123", "+1")` === `"2125550123"` UNVERAENDERT (keine `+1`-Ergaenzung); `normalizeDialTarget("011491701234567", null)` === `"011491701234567"` UNVERAENDERT (kein `"00"`-Praefix erkannt); alle vier Faelle bestehen NICHT die `E164`-Regex (`/^\+[1-9]\d{6,14}$/`)
- **Verifikation**: `node --test test/dial-target-normalization.test.js` nach Erweiterung um diese vier Faelle im bestehenden "Raender"-Testblock; bis dahin manuell: `node -e 'import("./src/store/defaults.js").then(m=>console.log(m.normalizeDialTarget("2125550123","+1")))'`
- **Heute erwartbar**: gruen - das oben spezifizierte Ergebnis ("bleibt unveraendert, scheitert am E164-Regex") IST das dokumentierte Ist-Verhalten; fachlich ist das trotzdem der S1-Befund (kein NANP-Support)
- **Belegt durch**: src/store/defaults.js:519-527, src/store/defaults.js:471 (E164-Regex)

### OUT-07 - MCP-Tool-Prompt enthaelt keine NANP-Anleitung
- **Prioritaet**: P1
- **Modus**: offline (grep/String-Assertion)
- **Vorbedingung**: keine
- **Schritte**: `grep -i "nanp\|011\|1-800\|zehnstellig" src/mcp-tools.js` ausfuehren
- **Erwartetes Ergebnis**: 0 Treffer in der `place_call`-Tool-Beschreibung
- **Verifikation**: `grep -in "nanp\|1-800" src/mcp-tools.js` -> erwartete Trefferzahl 0
- **Heute erwartbar**: gruen - grep bestaetigt 0 Treffer (verifiziert); der Prompt nennt nur die deutsche Konvention ("fuehrende 0 = Heimatland") ohne NANP-Hinweis, das IST der S1-Befund
- **Belegt durch**: src/mcp-tools.js:368-372

### OUT-08 - languageForCountry("US") faellt auf Deutsch zurueck
- **Prioritaet**: P0
- **Modus**: offline (npm test, neu oder Erweiterung eines i18n-Tests)
- **Vorbedingung**: keine
- **Schritte**: `languageForCountry("US")`, `languageForCountry("us")` (Kleinschreibung), `languageForCountry("")`, `languageForCountry(null)`, `languageForCountry("CA")` (Kanada, ebenfalls NANP, ebenfalls fehlend) aufrufen
- **Erwartetes Ergebnis**: alle fuenf Aufrufe liefern `"de"` (`DEFAULT_LANGUAGE`)
- **Verifikation**: `node --test test/f1-i18n-locale.test.js` nach Erweiterung, oder neuer eigenstaendiger Testblock; Sofort-Check: `node -e 'import("./src/i18n/locales.js").then(m=>console.log(m.languageForCountry("US")))'` -> erwartet `de`
- **Heute erwartbar**: gruen im Sinn "faellt wie dokumentiert auf de zurueck" (Ist-Verhalten), aber das IST der S1-Befund: fachlich falsch fuer das Produktziel "englischer Agent fuer US-Nutzer"
- **Belegt durch**: src/i18n/locales.js:268-280

### OUT-09 - Kein US-Premium-Schutz (1-900/1-976) in der Denylist
- **Prioritaet**: P1
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES=*`, `ALLOWED_NUMBERS` enthaelt die US-Premium-Testnummern, `TWILIO_ACCOUNT_SID=x`
- **Schritte**:
  1. Server mit `ALLOWED_COUNTRY_CODES: "*"`, `ALLOWED_NUMBERS: "+19005550123,+19765550123"` starten
  2. `POST /api/calls` mit `to: "+19005550123"` (1-900 Pay-Per-Call)
  3. `POST /api/calls` mit `to: "+19765550123"` (1-976 Premium)
- **Erwartetes Ergebnis**: beide Aufrufe liefern Status 500 (Denylist NICHT getroffen, alle Gates passiert bis Twilio) - demonstriert die Luecke im Gegensatz zu den analogen DE/UK/FR-Faellen, die 403 liefern
- **Verifikation**: neuer Test in `test/number-gate.test.js`, Muster wie bestehender IRSF-Block "IRSF-Blockliste: neue Premium-Ranges -> 403"
- **Heute erwartbar**: gruen - PREMIUM_PREFIXES hat nachweislich keinen `+1900`/`+1976`-Eintrag, das oben spezifizierte 500-Ergebnis matcht den heutigen Code; das IST der S2-Befund (keine Blockierung)
- **Belegt durch**: src/telephony/outbound-gates.js:58-90, test/number-gate.test.js:250-308 (Vorbild-Struktur)

### OUT-10 - Notruf-Kurzwahl "911" wird unabhaengig vom Laender-Gate geblockt
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES=*` (damit NUR die Denylist greifen kann)
- **Schritte**: `POST /api/calls` mit `to: "911"`
- **Erwartetes Ergebnis**: Status 403, `error` matched `/gesperrt/` (grund=denylist) - VOR jeder Format-/Land-Pruefung
- **Verifikation**: `node --test test/number-gate.test.js` (Test "Notruf-Kurzwahlen -> 403 denylist")
- **Heute erwartbar**: gruen - bereits exakt gepinnt fuer "911" (unter den vier Codes)
- **Belegt durch**: src/telephony/outbound-gates.js:51,264-270, test/number-gate.test.js:26-32

### OUT-11 - Kein zeitzonenbewusstes Anrufzeiten-Gate existiert
- **Prioritaet**: P1
- **Modus**: offline (grep, strukturelle Pruefung)
- **Vorbedingung**: keine
- **Schritte**: `grep -in "quiet.hour\|business.hour\|calling.hour\|timezone" src/telephony/outbound-gates.js src/config.js` ausfuehren
- **Erwartetes Ergebnis**: 0 Treffer (kein Gate mit Tageszeit-/Zeitzonen-Bezug in der Kette)
- **Verifikation**: `grep -inE "quiet.hour|business.hour|calling.hour|timezone" src/telephony/outbound-gates.js` -> Trefferzahl 0
- **Heute erwartbar**: gruen - grep bestaetigt 0 Treffer (verifiziert); das Gate fehlt strukturell, das IST der S2-Befund
- **Belegt durch**: src/telephony/outbound-gates.js:420-705 (17er-Kette ohne Tageszeit-Glied), src/config.js:670-676 (Kommentar nennt nur Toll-Fraud-Bremse, keine Tageszeit-Semantik)

### OUT-12 - Toll-Free-Nummern werden zum Worst-Case-Tarif abgerechnet
- **Prioritaet**: P2
- **Modus**: offline (npm test, neu bzw. Erweiterung)
- **Vorbedingung**: keine (reiner Funktionsaufruf `tariffCentsPerMin`)
- **Schritte**: `tariffCentsPerMin("+18005550123")` (1-800 Toll-Free) aufrufen
- **Erwartetes Ergebnis**: Rueckgabewert `config.billing.voiceTariffDefaultCents` (Default 300), NICHT `voiceTariffDomesticCents` (20) - identisches Verhalten wie eine normale US-Nummer
- **Verifikation**: `node --test test/cost-calibration.test.js` nach Erweiterung um einen `+1800...`-Testfall (Muster: Zeile 201-202 im selben File)
- **Heute erwartbar**: gruen im Sinn "verhaelt sich wie jede andere +1-Nummer" (VOICE_TARIFF_DOMESTIC_PREFIXES enthaelt kein +1 ueberhaupt) - das IST der Kosten-Gap
- **Belegt durch**: src/config.js:105,487, src/telephony/outbound-gates.js:145-149, test/cost-calibration.test.js:201-202

### OUT-13 - US-DID ist provisionierbar, aber Outbound-Gate blockt +1 per Default
- **Prioritaet**: P0
- **Modus**: offline (npm test, neu, kombiniert provisioning-geo + outbound-gates)
- **Vorbedingung**: `COUNTRY_SEARCH_PARAMS.US` liefert `telnyxCountryCode: "US"` (Provisionierung moeglich), `ALLOWED_COUNTRY_CODES` unveraendert Default
- **Schritte**:
  1. `searchParamsForCountry("US")` aufrufen und pruefen, dass ein US-spezifischer Eintrag zurueckkommt (nicht der DE/Default-Fallback)
  2. Einen Tenant mit einer aktiven `+1`-DID seeden (so, als waere die Provisionierung aus Schritt 1 bereits erfolgt)
  3. `POST /api/calls` mit `to: "+12025550123"` unter diesem Tenant, Default-Env (`ALLOWED_COUNTRY_CODES` NICHT gesetzt)
- **Erwartetes Ergebnis**: Schritt 1 liefert `{ telnyxCountryCode: "US", ... }` (kein Fallback-Objekt); Schritt 3 liefert Status 403 `grund=land` - der Tenant hat eine funktionslose DID
- **Verifikation**: neuer Test, kombiniert `test/f1-provisioning-geo.test.js`-Muster mit `test/number-gate.test.js`-Muster
- **Heute erwartbar**: gruen - beide Teilverhalten sind je fuer sich verifiziert (US in COUNTRY_SEARCH_PARAMS, Default-Gate blockt +1); das oben spezifizierte Ergebnis matcht den heutigen Code, ist aber in Kombination der S1-Befund (provisionierbar, aber nicht anrufbar)
- **Belegt durch**: src/telephony/provisioning-geo.js:34-38, src/config.js:662-669

### OUT-14 - Modul-Kommentar "16 Glieder" widerspricht der tatsaechlichen 17er-Kette
- **Prioritaet**: P2
- **Modus**: offline (grep, manuell)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -n "16 Glieder\|17 Glieder" src/telephony/outbound-gates.js`
  2. `grep -c 'name: "' src/telephony/outbound-gates.js`
- **Erwartetes Ergebnis**: Schritt 1 findet den String "16 Glieder" (Zeile ~419); Schritt 2 liefert `17`
- **Verifikation**: manueller Abgleich der beiden Zahlen, kein automatisierter Test vorhanden (der Snapshot-Test prueft nur die Reihenfolge, nicht die Kommentar-Zahl)
- **Heute erwartbar**: gruen - beide Zahlen sind verifiziert (Kommentar sagt "16 Glieder", `grep -c` liefert 17); die Diskrepanz selbst IST der Befund (Doku-Drift, kein Funktionsfehler)
- **Belegt durch**: src/telephony/outbound-gates.js:419, test/outbound-gates-order.test.js:17-32

### OUT-15 - Notruf-Denylist gewinnt auch bei explizit erlaubtem Land
- **Prioritaet**: P1
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES` enthaelt `+1` (US explizit erlaubt)
- **Schritte**: Server mit `ALLOWED_COUNTRY_CODES: "+1"` starten, `POST /api/calls` mit `to: "911"`
- **Erwartetes Ergebnis**: Status 403, `error` matched `/gesperrt/` - die Denylist-Praezedenz gilt unabhaengig davon, ob das Land explizit erlaubt ist
- **Verifikation**: neuer Testfall in `test/number-gate.test.js`, Erweiterung des bestehenden Denylist-Blocks um eine Variante mit `ALLOWED_COUNTRY_CODES="+1"` statt `"*"`
- **Heute erwartbar**: gruen - Denylist-Check laeuft laut Code (`numberGateError:264-270`) strikt vor dem E.164-/Land-Check, unabhaengig vom konkreten Land-Wert
- **Belegt durch**: src/telephony/outbound-gates.js:264-280

### OUT-16 - Pre-Check `isTrunkZeroFormatError` ist fuer NANP-Nummern nie einschlaegig
- **Prioritaet**: P2
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES` enthaelt `+1`, `TWILIO_ACCOUNT_SID=x`
- **Schritte**:
  1. `POST /api/calls` mit `to: "01701234567"` (DE, Trunk-0 nach `+49`-Aequivalent, klassischer Fall) unter DE-Heimatland-Tenant -> Kontrolle
  2. `POST /api/calls` mit `to: "01234567890"` unter einem Tenant OHNE DE/FR/UK-Heimatland (reiner US-Kandidat), gleiche Ziffernfolge nach `normNum`
- **Erwartetes Ergebnis**: Schritt 1 (nach Normalisierung `+4901737...`) liefert 400 `E164_FORMAT_ERROR` durch den Pre-Check VOR jedem Gate (kein Audit-Log); Schritt 2 erreicht den Pre-Check NICHT als Trunk-0-Fall (weil `hasTrunkZeroAfterCountryCode` nur `+49/+33/+44` prueft), faellt stattdessen unveraendert durch bis zum regulaeren `E164`-Format-Gate innerhalb der Kette (400 `grund=format`, MIT anderer Codepfad-Zuordnung)
- **Verifikation**: neuer Test in `test/dial-target-normalization.test.js`, Vergleich der beiden 400-Antworten (Pre-Check vs. regulaeres Gate unterscheiden sich im Audit-Verhalten, nicht im HTTP-Status)
- **Heute erwartbar**: unbekannt - die Einzelbausteine sind belegt, ein direkter Vergleichstest der beiden 400-Pfade existiert nicht
- **Belegt durch**: src/routes/api-calls.js:69-74, src/store/defaults.js:463-464,486-497

### OUT-17 - normNum bereinigt US-Trennzeichen-Schreibweisen korrekt (Positiv-Fall)
- **Prioritaet**: P1
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: keine
- **Schritte**: `normNum("+1 (202) 555-0123")` aufrufen
- **Erwartetes Ergebnis**: Rueckgabewert `"+12025550123"` (Leerzeichen, Klammern, Bindestrich entfernt) - besteht danach die `E164`-Regex
- **Verifikation**: `node --test test/dial-target-normalization.test.js` nach Erweiterung, oder Sofort-Check `node -e 'import("./src/store/defaults.js").then(m=>console.log(m.normNum("+1 (202) 555-0123")))'`
- **Heute erwartbar**: gruen - `normNum` (`src/store/defaults.js:467-469`) ist eine reine Zeichen-Filterung ohne Laenderbezug, funktioniert fuer JEDES Format inkl. US-Schreibweise, solange bereits ein `+`-Praefix vorhanden ist
- **Belegt durch**: src/store/defaults.js:467-469

### OUT-18 - US-Testnummer bleibt der einzige Negativ-/Randfall in der Testsuite
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: keine (Bestandstest)
- **Schritte**: bestehenden Test lesen/ausfuehren, der `OWNER_TEST_NUMBER` (`+15005550006`) als "kein Trunk-0-Land" pinnt
- **Erwartetes Ergebnis**: Test bestaetigt weiterhin, dass die Standard-Test-Owner-Nummer +1 ist und als Negativfall (kein Heimatland ableitbar) behandelt wird
- **Verifikation**: `node --test test/dial-target-normalization.test.js` (Testfall um Zeile 159-163, "kein ableitbares Heimatland (US-DID, keine privateNumber) -> 400 statt raten")
- **Heute erwartbar**: gruen - bereits vorhanden, dokumentiert aber explizit die Luecke: der US-Fall wird in der ganzen Suite NIE als vollwertiger Positiv-Pfad behandelt, nur als Ablehnungsfall
- **Belegt durch**: test/dial-target-normalization.test.js:113-121,159-163

### OUT-19 - Toll-Free-Ranges passieren die Denylist unbehelligt
- **Prioritaet**: P2
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES=*`, `ALLOWED_NUMBERS` enthaelt die Toll-Free-Testnummer
- **Schritte**: `POST /api/calls` mit `to: "+18005550123"`
- **Erwartetes Ergebnis**: Status 500 (Denylist NICHT getroffen - Toll-Free ist weder gesperrt noch gesondert behandelt)
- **Verifikation**: neuer Testfall in `test/number-gate.test.js`, Muster wie "normale internationale Nummern passieren die Denylist"
- **Heute erwartbar**: gruen im Sinn "wird nicht faelschlich blockiert" - bestaetigt gleichzeitig, dass keine Sonderbehandlung existiert (neutral, kein Fehler, aber auch keine Vorzugstarif-Erkennung)
- **Belegt durch**: src/telephony/outbound-gates.js:58-90 (keine Toll-Free-Eintraege)

### OUT-20 - Kein DTMF-/IVR-Handling im gesamten Quellbaum
- **Prioritaet**: P2
- **Modus**: offline (grep)
- **Vorbedingung**: keine
- **Schritte**: `grep -rn "DTMF\|dtmf" src/`
- **Erwartetes Ergebnis**: 0 Treffer
- **Verifikation**: `grep -rc "DTMF\|dtmf" src/ | awk -F: '{s+=$2} END{print s}'` -> erwartet `0`
- **Heute erwartbar**: gruen - grep bestaetigt 0 Treffer (verifiziert); das Feature existiert strukturell nicht, das IST der S3-Befund
- **Belegt durch**: grep 'DTMF|dtmf' src/ -> 0 Treffer

### OUT-21 - Bestandsdaten/Migration: Tenant ohne defaultLanguage + US-DID bleibt Deutsch
- **Prioritaet**: P1
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: Tenant-Record OHNE `defaultLanguage`-Feld (Alt-Datensatz vor F1 Phase 4/8), Nummer-Record mit `+1`-DID, aber OHNE `number.language`-Feld gesetzt, `settings.language` nicht gesetzt
- **Schritte**: `resolveCallLanguage(s, { tenantId, numberRecord })` mit diesem Zustand aufrufen
- **Erwartetes Ergebnis**: Rueckgabewert `"de"` (`DEFAULT_LANGUAGE`) - kein automatischer Zusammenhang zwischen `+1`-DID-Land und Sprache, weil `number.language` ein eigenes, unabhaengig zu setzendes Feld ist (kein Rueckgriff auf `languageForCountry` an dieser Stelle)
- **Verifikation**: `node --test test/f1-p8-outbound-lang.test.js` nach Erweiterung um diesen Bestandsdaten-Fall (kein `number.language`, nur `+1`-E.164)
- **Heute erwartbar**: gruen im Sinn "faellt korrekt auf Default zurueck" - bestaetigt aber, dass eine `+1`-DID ALLEIN NIEMALS automatisch Englisch ausloest, selbst wenn `languageForCountry` fuer US irgendwann ergaenzt wuerde (die Praezedenzkette in `resolveCallLanguage` ruft diese Funktion gar nicht auf)
- **Belegt durch**: src/store/state-ops.js:642-651

### OUT-22 - Leere/undefinierte Profil-allowedCountryCodes bedeuten "keine Zusatz-Einschraenkung"
- **Prioritaet**: P2
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: drei Tenant-Profile: `allowedCountryCodes: []`, `allowedCountryCodes: undefined`, `allowedCountryCodes: null`
- **Schritte**: `countryGateAllowed("+491711234567", profile)` fuer jeden der drei Profil-Zustaende pruefen (bei global erlaubtem `+49`)
- **Erwartetes Ergebnis**: alle drei liefern `true` (keiner der drei "leeren" Zustaende engt zusaetzlich ein) - Konsistenz-Beweis, dass `!p || !p.length` alle drei Faelle gleich behandelt
- **Verifikation**: neuer Unit-Test direkt gegen die interne Logik (`countryGateAllowed` ist nicht exportiert - Test muesste ueber `numberGateError`/HTTP-Pfad mit drei seed-Varianten laufen) bzw. `node --test test/number-gate.test.js`
- **Heute erwartbar**: gruen - Ausdruck `!p || !p.length` (`src/telephony/outbound-gates.js:182`) behandelt alle drei JS-Falsy/Empty-Faelle identisch
- **Belegt durch**: src/telephony/outbound-gates.js:178-183

### OUT-23 - Grossschreibung/gemischte Schreibweise bei Laendercode-Praefixen ist irrelevant (E.164 hat kein Casing)
- **Prioritaet**: P2
- **Modus**: offline (npm test, neu)
- **Vorbedingung**: keine
- **Schritte**: pruefen, dass `matchesPrefix`/`E164`-Regex rein numerisch/Symbol-basiert arbeiten (kein Buchstaben-Anteil in einer Telefonnummer moeglich) - Kontrastfall zu `languageForCountry`, das per `.toUpperCase()` (`src/i18n/locales.js:279`) EXPLIZIT Gross-/Kleinschreibung normalisiert
- **Schritte** (konkret): `languageForCountry("us")`, `languageForCountry("Us")`, `languageForCountry("US")` aufrufen und auf Gleichheit pruefen
- **Erwartetes Ergebnis**: alle drei liefern denselben Wert (`"de"`, s. OUT-08) - Casing-Normalisierung funktioniert unabhaengig vom fehlenden US-Eintrag
- **Verifikation**: Teil des OUT-08-Testfalls, hier als eigener Casing-Fokus dokumentiert
- **Heute erwartbar**: gruen - `.toUpperCase()` ist bereits vorhanden und wirkt unabhaengig vom Tabelleninhalt
- **Belegt durch**: src/i18n/locales.js:279

### OUT-24 - EN-Offenlegungssatz ist byte-stabil und nicht abschaltbar
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `call.language = "en"`
- **Schritte**: `localeFor("en").disclosure("Jonas Beispiel")` aufrufen
- **Erwartetes Ergebnis**: exakt `"Hello, this is an AI assistant calling on behalf of Jonas Beispiel. This conversation will be summarised for the person I represent."` - unveraenderlich, keine Interpolation ausser `ownerName`
- **Verifikation**: `node --test test/f1-i18n-locale.test.js` (falls dieser Fall bereits Teil der Suite ist) bzw. `node -e 'import("./src/i18n/locales.js").then(m=>console.log(m.localeFor("en").disclosure("Jonas Beispiel")))'`
- **Heute erwartbar**: gruen - String ist statisch im Quellcode gepinnt
- **Belegt durch**: src/i18n/locales.js:236-238

### OUT-25 - Vollstaendiger Happy-Path fuer eine korrekt konfigurierte US-Freischaltung
- **Prioritaet**: P0
- **Modus**: offline (npm test, neu - der wichtigste "waere US-Launch technisch moeglich"-Beweis)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES` enthaelt `+1`, Tenant mit aktiver `+1`-DID, gueltiges KYC-Level, aktives Abo/Subscriber-Status, `objective` gesetzt, `TWILIO_ACCOUNT_SID=x`
- **Schritte**: `POST /api/calls` mit `to: "+12025550123"`, `objective: "Termin bestaetigen"` unter diesem vollstaendig freigeschalteten US-Tenant
- **Erwartetes Ergebnis**: Status 500 (ALLE 17 Gates passiert bis zum Twilio/Telnyx-Client-Fehler) - kein 403/429/400 irgendeines Gates
- **Verifikation**: neuer Integrationstest, Muster wie `test/dial-target-normalization.test.js` Abschnitt 2 (Producer-HTTP-Pfad), aber mit vollstaendig US-freigeschaltetem Env+Seed
- **Heute erwartbar**: unbekannt - kein bestehender Test konfiguriert diesen vollstaendigen Zustand; die Einzelgates sind fuer sich belegt offen (KYC/Abo/Land), aber die Kombination fuer einen echten US-Tenant ist nicht durchgespielt
- **Belegt durch**: src/telephony/outbound-gates.js:420-705 (vollstaendige Kette), test/dial-target-normalization.test.js:78-138 (Vorbild-Struktur)

### OUT-26 - Live-Anruf DE-Origin nach US-Ziel (internationale Zustellung)
- **Prioritaet**: P1
- **Modus**: live (echter Anruf, kostet Geld)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES` enthaelt `+1`, echte Telnyx/Twilio-DID, echte US-Zielnummer (eigenes Testhandy/Google Voice), Owner-Freigabe fuer den Testanruf
- **Schritte**:
  1. Owner setzt `ALLOWED_COUNTRY_CODES` temporaer inkl. `+1` in der Live-Umgebung
  2. Outbound-Call an eine echte US-Nummer ausloesen (MCP `place_call` oder Dashboard)
  3. Anrufannahme, Audioqualitaet und Zustellzuverlaessigkeit (Ring-Timeout, `sip_hangup_cause`) beobachten
- **Erwartetes Ergebnis**: Anruf kommt zuverlaessig an (kein `sip_hangup_cause=487`/Ring-Timeout-Muster), Sprachqualitaet akzeptabel
- **Verifikation**: manuelle Beobachtung + Telnyx-Debugger/Call-Detail-Records nach dem Anruf pruefen
- **Heute erwartbar**: unbekannt - das dokumentierte Symptom betrifft die umgekehrte Richtung (US-Origin -> DE-Ziel, intermittent); die hier relevante Richtung (DE-Origin -> US-Ziel bzw. US-Origin -> US-Ziel) ist laut Session-Memory NICHT eigens vermessen
- **Belegt durch**: ~/.claude/projects/.../memory/telnyx-fresh-did-no-de-routing.md (Session 2026-07-01), src/telnyx-origination.js:17-30

### OUT-27 - Assistant-Origination-Pfad reicht `to` unveraendert durch (keine eigene Laenderlogik)
- **Prioritaet**: P2
- **Modus**: offline (npm test, neu bzw. Code-Lesepruefung)
- **Vorbedingung**: keine
- **Schritte**: `originateAiAssistantCall`-Quellcode lesen und pruefen, dass `to` 1:1 an `voiceControl().originateViaCallControl` weitergereicht wird, ohne Transformation
- **Erwartetes Ergebnis**: kein Aufruf von `normalizeDialTarget`/`homeCountryCode`/laenderspezifischer Logik innerhalb von `originateAiAssistantCall`
- **Verifikation**: `grep -n "normalizeDialTarget\|homeCountryCode\|allowedCountryCodes" src/telnyx-origination.js` -> erwartete Trefferzahl 0
- **Heute erwartbar**: gruen - Funktion ist eine reine DI-Weiterleitung ohne Laenderbezug, Gate-Kette laeuft bereits vorher im Aufrufer
- **Belegt durch**: src/telnyx-origination.js:17-30

### OUT-28 - Gate-Reihenfolge bleibt bei US-relevanten Einzelverletzungen deterministisch
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES=+1` (nur US erlaubt), globales Stundenlimit knapp erreicht (`MAX_CALLS_PER_HOUR=0`)
- **Schritte**: `POST /api/calls` mit `to: "+12025550123"` (gueltiges Format, erlaubtes Land, aber Stundenlimit=0)
- **Erwartetes Ergebnis**: Status 429, `grund=stundenlimit` (nicht `land`, nicht `denylist`) - beweist, dass bei einer gueltigen US-Nummer das naechste greifende Gate in der dokumentierten Reihenfolge entscheidet
- **Verifikation**: neuer Testfall in `test/number-gate.test.js`, Muster wie bestehende Stundenlimit-Tests, aber mit US-Ziel statt DE-Ziel
- **Heute erwartbar**: gruen - Reihenfolge ist strukturell fest (`numberGateError:264-307`) und unabhaengig vom konkreten Land
- **Belegt durch**: src/telephony/outbound-gates.js:264-307
