# 00 - Kanonische Testliste (Aufloesung der Duplikat-Cluster)

Dieses Dokument loest Schritt 1 aus `PLAN-I18N-TESTS.md` Abschnitt 4.3: es entscheidet
verbindlich, welche Fassung eines mehrfach formulierten Sachverhalts in die Suite wandert.
Es ist der Arbeitsvorrat fuer die Implementierung. Die Bereichsdateien bleiben unveraendert -
sie sind die Beleglage, diese Datei ist die Entscheidung.

**Ausgangslage.** 302 Tests im Master-Katalog plus 20 Tests aus `12-sprachachsen-ui.md`, die
bei der Synthese nicht in die Master-Tabelle gelaufen sind (Abschnitt 4.2 fuehrt keine
`UI-*`-Zeile). Zusammen 322 Eintraege.

**Ergebnis.** 108 Eintraege entfallen als Duplikat, **214 kanonische Tests** bleiben.
Davon sind 13 durch offene Produktentscheidungen blockiert und erst danach formulierbar.

---

## 1. Entscheidungsregeln (bindend)

**R1 - Bei Polaritaets-Konflikt gewinnt die SOLL-Fassung.**
Wo derselbe Sachverhalt einmal als Ist-Pin (heute gruen) und einmal als Sollzustand (heute rot)
formuliert ist, wandert ausschliesslich die Sollzustand-Fassung in die Suite. Begruendung: dieser
Katalog ist ein Launch-Gate, keine Charakterisierungs-Suite. Ein Ist-Pin, der einen Defekt als
Sollzustand festschreibt, ist genau die Falle, die in diesem Repo bereits zweimal zugeschnappt
ist - `test/f1-geo-port.test.js:61` pinnt `languageForCountry("US") === DEFAULT_LANGUAGE` unter
der Ueberschrift "unbekanntes Land", und `test/personal-assistant-characterization.test.js:215-221`
pinnt den deutschen EN-Systemprompt byte-genau. Beide lassen jeden Fix wie eine Regression aussehen.

**R2 - Der SOLL-Test ist selbst der Rot-vor-Fix-Beweis.**
Ein zusaetzlicher Ist-Pin ist ueberfluessig: der rote SOLL-Test beweist den Defekt, und derselbe
Test wird nach dem Fix gruen. Das ist die im Repo etablierte Praxis ("3 S1 rot-vor-Fix bewiesen",
PLAN-POLISH-A).

**R3 - Ausnahme: Mechanismus-Tests bleiben gruen.**
Wo das heutige Verhalten ein *Mechanismus* ist, der bleiben soll, und der Defekt nur im
*Wert* sitzt, bleibt der Test als Regressionsschutz mit Polaritaet gruen. Beispiele: der
fail-safe Fallback von `localeFor()` (der Mechanismus ist richtig, nur der Default-Wert steht zur
Debatte), die Case-Insensitivitaet von `languageForCountry`, das fail-closed Werfen bei
unbekanntem `voiceProfile`, das Land-Gate als Whitelist-Mechanismus.

**R4 - Zwei Codepfade sind zwei Tests, auch bei identischem Symptom.**
Die Synthese hat an zwei Stellen unterschiedliche Eintrittspunkte zu einem Cluster verschmolzen.
Das wird hier aufgetrennt: HTTP-Onboarding und der Webhook-/Aktivierungspfad sind verschiedene
Pfade mit verschiedenen Fixes, ebenso das fehlende Zeitzonen-Feld und das fehlende Zeitfenster-Gate.

**R5 - Loeschen, nicht umschreiben.**
Die beiden bestehenden Repo-Tests aus R1 werden mit dem jeweiligen Fix **geloescht**, nicht
angepasst. Ein umgeschriebener Charakterisierungstest behaelt seinen irrefuehrenden Namen und
seine irrefuehrende Ueberschrift.

---

## 2. Aufloesung der Cluster

Spalte `Polaritaet`: `SOLL (rot)` = der Test formuliert den Zielzustand und faellt heute.
`Mechanismus (gruen)` = R3-Ausnahme, Regressionsschutz. Spalte `Status`: `frei` = sofort
implementierbar, `blockiert 7.x` = braucht zuerst die Produktentscheidung aus Kapitel 7.

| Cluster | Sachverhalt | kanonisch | Polaritaet | entfallen | Status |
| --- | --- | --- | --- | --- | --- |
| D1 | `languageForCountry("US")` | **DID-01** | SOLL (rot) | LANG-01, VOICE-04, OUT-08, WEB-22 | frei |
| D2a | HTTP-Onboard `country=US` | **DID-02** | SOLL (rot) | LANG-10, PROMPT-04, VOICE-06, WEB-23, LAW-01, FMT-07, FMT-08, LANG-22 | frei |
| D2b | Webhook-/Aktivierungspfad (BK3) | **DID-03** | SOLL (rot) | - (R4: eigener Pfad) | frei |
| D3 | Land-Gate ohne `+1` | **OUT-02** + **OUT-25** | SOLL (Live-Zustand) + Happy-Path | OUT-01 (nur Code-Default), LANG-08, PAY-13, LAW-04, OUT-13, PAY-14 | frei, Praemisse korrigiert |
| D4 | `localeFor()` Fail-Safe | **LANG-21** | Mechanismus (gruen) | PROMPT-15, PROMPT-24, VOICE-21, FMT-25 | frei |
| D5 | Case-Insensitivitaet | **LANG-09** | Mechanismus (gruen) | VOICE-20, DID-04, LAW-19, FMT-26 | frei |
| D6 | `language="EN"` still verworfen | **LANG-19** | SOLL (rot) | PROMPT-16, WEB-24, LANG-18 | blockiert E1 |
| D7 | Keine EN/FR-Greeting-Vorlage | **WEB-04** | SOLL (rot) | LANG-11, PROMPT-19 | frei |
| D8 | Greeting ignoriert `settings.language` | **PROMPT-03** | SOLL (rot) | LANG-12, PROMPT-20, WEB-05, WEB-06 | frei |
| D9 | Locale-Feld ohne Konsument | **GAP-31** | SOLL (rot) | LANG-13 | frei |
| D10 | Kein Backfill `country`/`language` | **GAP-34** | SOLL (rot) | LANG-14, LANG-24, DID-16, OUT-21, WEB-26 | blockiert E2 |
| D11 | `place_call.language` wirkungslos | **LANG-15** | SOLL (rot) | VOICE-11, OUT-07 | blockiert E3 |
| D12 | SMS-/Notification-Rahmen deutsch | **WEB-14** | SOLL (rot) | PROMPT-12, PROMPT-13, WEB-15, FMT-12, FMT-13, FMT-32 | frei |
| D13 | `fmt()` hart `de-DE` | **FMT-03** | SOLL (rot) | PROMPT-10, MCP-07, FMT-04, FMT-05, UI-11 | frei |
| D14 | `tenant.html` ohne Sprachumschalter | **WEB-01** | SOLL (rot) | VOICE-10, FMT-14, PROMPT-05 | frei |
| D15 | `tenant.html` Geld/Datum `de-DE` | **FMT-15** | SOLL (rot) | PAY-11, WEB-17 | blockiert 7.1 |
| D16 | EN ist `en-GB`, kein `en-US` | **VOICE-01** | offen | LAW-17, FMT-09, VOICE-26 | blockiert 7.5 |
| D17 | Preis-Waehrung EUR statt USD | **PAY-01** | offen | DID-12, FMT-16, PAY-03, WEB-16, FMT-17, UI-10 | blockiert 7.1 |
| D18a | Kein Zeitzonen-Feld im Datenmodell | **FMT-28** | SOLL (rot) | - (R4: Vorbedingung) | blockiert 7.6 |
| D18b | Kein Anrufzeit-Gate in Zielortszeit | **LAW-07** | SOLL (rot) | OUT-11, FMT-18, LAW-08, FMT-19 | blockiert 7.6 |
| D19 | `privateNumber` faktisch `+49` | **FMT-11** | SOLL (rot) | FMT-10 | frei |
| D20 | EINE globale ElevenLabs-Stimme | **VOICE-12** | SOLL (rot) | VOICE-13, VOICE-14 | frei |
| D21 | Kein EN-/US-Szenario in Bestandstests | **MCP-12** | SOLL (rot) | LAW-25, DID-15 | frei |
| D22 | Absender-Land vs. Kauf-Land | **GAP-19** | SOLL (rot) | LAW-20, LANG-05, DID-20, DID-10 | frei |
| D23 | Kein Consent-/Opt-out-/DNC-Konzept | **LAW-06** + **GAP-12** + **GAP-13** | SOLL (rot) | LAW-05, LAW-09, LAW-10 | blockiert 7.4 |
| D24 | Kein AMD-/IVR-Handling | **GAP-21** | SOLL (rot) | OUT-20 | frei |
| D25 | Nicht-Inlands-Reserve sprengt Decke | **PAY-04** + **GAP-32** | SOLL (rot) | PAY-05, PAY-07 | frei |
| D26 | NANP-Premium/Notruf-Sperren | **GAP-18** | SOLL (rot) | OUT-09, OUT-19, GAP-20 | frei |
| D27 | Login-Pfad setzt kein Geo | **LANG-02** | SOLL (rot) | WEB-21, LANG-04, LANG-03, VOICE-07, WEB-20 | frei |
| D28 | `mcp-tools.js` unlokalisiert | **PROMPT-09** | SOLL (rot) | MCP-01, MCP-02, MCP-03, MCP-15, PROMPT-11, MCP-10, UI-17 | frei |
| D29 | Kein `automatic_tax` im Checkout | **GAP-02** | SOLL (rot) | PAY-18 | blockiert 7.2 |
| D30 | Plattform-Topf ohne Alarmkanal | **GAP-01** + **GAP-07** | SOLL (rot) | PAY-21 | blockiert 7.8 |
| D31 | `"Gegenseite:"`-Praefix hart deutsch | **MCP-06** | SOLL (rot) | UI-08 | frei |
| D32 | `permissionsSummary()` deutsch | **MCP-09** | SOLL (rot) | UI-16 | frei |
| D33 | `navigator.language` im Iframe | **UI-20** | manuell | MCP-18 | frei |
| D34 | Widget kennt Tenant-Sprache/Land nicht | **UI-14** + **UI-18** | SOLL (rot) | MCP-13 | blockiert E4 |
| D35 | Dynamische Widget-Werte unuebersetzt | **UI-12** | SOLL (rot) | MCP-11 | frei |

D31 bis D35 sind neu: sie entstehen erst durch die Einarbeitung der `UI-*`-Tests, die im
Master-Katalog fehlen.

> **Nachtrag D3 (Live-Messung 2026-07-22,**
> [`13-live-env-befund.md`](13-live-env-befund.md)**).** Die Praemisse des Clusters war falsch:
> `ALLOWED_COUNTRY_CODES` steht live auf `*`, nicht auf `+49,+33,+44`. Der Leittest wechselt
> deshalb von OUT-01 (prueft den Code-Default, den niemand faehrt) auf **OUT-02** (prueft den
> real wirksamen Zustand) und wird von P1 auf **P0** hochgestuft. OUT-01 bleibt als
> Default-Regressionsschutz bestehen, verliert aber seinen Launch-Gate-Charakter. Die Zahl der
> kanonischen Tests aendert sich dadurch nicht.

---

## 3. Aufgeloeste Polaritaets-Konflikte im Einzelnen

Sieben Paare pruefen denselben Sachverhalt mit umgekehrter Erwartung. Nach R1 gilt:

| Sachverhalt | verworfen (Ist-Pin, gruen) | uebernommen (Soll, rot) |
| --- | --- | --- |
| `languageForCountry("US")` | LANG-01, VOICE-04, OUT-08 | **DID-01** |
| Onboard `country=US` | LANG-10, PROMPT-04, VOICE-06, LAW-01 | **DID-02** |
| Greeting vs. `settings.language` | LANG-12 | **PROMPT-03** |
| `privateNumber`-Laendergate | FMT-10 | **FMT-11** |
| `fmt()`-Datumsformat | - | **FMT-03** (UI-11 doppelt beide Polaritaeten) |
| Waehrungslabel `(EUR)` | - | **PAY-01** (UI-10 doppelt beide Polaritaeten) |
| `"Gegenseite:"`-Praefix | - | **MCP-06** (UI-08 doppelt beide Polaritaeten) |

**Zweistufige Formulierungen.** LANG-25, PROMPT-03 und sechs `UI-*`-Tests formulieren ihre
Erwartung im Fliesstext ausdruecklich doppelt ("rot als Soll, gruen als Beweis der Luecke").
Verbindlich ist die **Launch-Lesart**: rot. Der Beweis-Charakter geht dabei nicht verloren, weil
der rote Testlauf selbst der Beweis ist (R2).

**Zwei bestehende Repo-Tests kollidieren.** Sie muessen mit dem jeweiligen Fix geloescht werden
(R5), sonst ist die Suite nach dem Fix zwangslaeufig rot:

| Datei | Zeile | pinnt | kollidiert mit |
| --- | --- | --- | --- |
| `test/f1-geo-port.test.js` | 61 | `languageForCountry("US") === DEFAULT_LANGUAGE` | DID-01 |
| `test/personal-assistant-characterization.test.js` | 215-221, 333-346 | deutscher EN-Systemprompt, byte-genau | PROMPT-01, PROMPT-14 |

---

## 4. Blockierte Tests und die Entscheidungen dahinter

> **AUFGELOEST (Owner-Entscheidungen 2026-07-25).** Alle Blocker dieser Tabelle sind
> entschieden oder ausdruecklich zurueckgestellt - **kein kanonischer Test ist mehr
> blockiert**. Massgeblich ist `PLAN-I18N-TESTS.md` Abschnitt 7.0; die Tabelle unten bleibt
> als Beleglage stehen und traegt die Aufloesung in der letzten Spalte.
>
> **Zaehlkorrektur:** die Einleitung sprach von 13 blockierten Tests, die Tabelle listet
> **16 IDs**. 16 ist richtig. Davon **11 entblockt, 5 zurueckgestellt**:
>
> | Aufloesung | Tests |
> | --- | --- |
> | **entblockt** | PAY-01, FMT-15, VOICE-01, FMT-28, GAP-01, GAP-07, LANG-19, GAP-34, LANG-15, UI-14, UI-18 |
> | **zurueckgestellt** (faellt aus dem Arbeitsvorrat, Risiko getragen) | GAP-02, LAW-06, GAP-12, GAP-13, LAW-07 |
>
> **Neu hinzu** durch die Entscheidung 7.11 (weltweiter Start): **WORLD-01, WORLD-02,
> WORLD-03** (alle P0, offline) - Englisch als Weltdefault statt Deutsch. Begruendung und
> Beleg in `PLAN-I18N-TESTS.md` Abschnitt 7.12.
>
> **Neuer Bestand: 219 - 5 + 3 = 217 kanonische Tests, alle sofort implementierbar.**

16 kanonische Tests waren erst nach einer Produktentscheidung formulierbar. Sechs Entscheidungen
standen bereits in `PLAN-I18N-TESTS.md` Kapitel 7, vier waren neu und klein genug, um sie hier
mit Empfehlung zu stellen:

| Nr. | Entscheidung | blockiert | Empfehlung | Aufloesung 2026-07-25 |
| --- | --- | --- | --- | --- |
| 7.1 | Waehrung des US-Markts (EUR-Bestand vs. USD-Vorgabe) | PAY-01, FMT-15 | - | **EUR ueberall.** Praemisse war falsch: die Website zeigt bereits `€` (`apps/web/src/lib/plans.js:44`), Anzeige und Belastung stimmen ueberein. Beide Tests entblockt. |
| 7.2 | Steuerpflicht/Registrierung US | GAP-02 | - | **Zurueckgestellt** (Steuerberater-Frage). GAP-02 entfaellt. |
| 7.4 | Einwilligungsmodell US-Outbound | LAW-06, GAP-12, GAP-13 | - | **Zurueckgestellt.** Alle drei entfallen; Risiko getragen (7.13 Punkt 1) und durch den weltweiten Start groesser als zuvor. |
| 7.5 | `en-US` als eigenes Bundle oder akzeptiertes Risiko | VOICE-01 | - | **Eigenes Bundle.** VOICE-01 entblockt. |
| 7.6 | Zeitzone im Datenmodell | FMT-28, LAW-07 | - | **Geteilt:** Anrufzeit-*Gate* abgelehnt -> LAW-07 entfaellt. Uhrzeit-*Anzeige* korrigiert (Zeitzone am Tenant) -> FMT-28 entblockt. |
| 7.8 | Lebenszeit-Topf vs. Perioden-Topf | GAP-01, GAP-07 | - | **Perioden-Topf**, nach Besetzung von `PLATFORM_ALERT_SMS_TO`. Beide entblockt. Offene Vorbedingung: Neustart-Beleg fuer `spendMonthKey`. |
| E1 | `language="EN"` (Grossschreibung): still verwerfen, normalisieren oder 400? | LANG-19 | **normalisieren** - `SUPPORTED_LANGUAGES` ist kleingeschrieben, der Nutzer macht nichts falsch; stilles Verwerfen ist die schlechteste der drei Optionen | **Empfehlung uebernommen.** Entblockt. |
| E2 | Woher bekommen Bestandstenants ohne `country` ihr Land? | GAP-34 | **aus der DID-Vorwahl ableiten**, nicht raten; kein ableitbares Land -> Feld bleibt leer und der Tenant behaelt sein heutiges Verhalten | **Empfehlung uebernommen.** Entblockt. |
| E3 | `place_call.language`: wirksam machen oder entfernen? | LANG-15 | **entfernen** - die Sprache haengt an Tenant/Nummer; ein wirkungsloser Parameter fuehrt das Modell in die Irre | **Empfehlung uebernommen.** Entblockt. |
| E4 | Folgt die Widget-Sprache der Chat-Sprache oder der Agentensprache? | UI-14, UI-18 | **Agentensprache**, serverseitig ins Widget-HTML gerendert - sie ist die einzige Achse, die der Nutzer selbst einstellt und die zum Anruf passt; ein Host-Signal fuer die Chat-Sprache existiert nicht (UI-14) | **Empfehlung uebernommen.** Beide entblockt. |

Zu E4: die Ersatzquellen liegen fertig im Store (`tenant.country`, `tenant.defaultLanguage`,
`state-ops.js:1187-1201`) samt Land-nach-Sprache-Abbildung (`locales.js:268-275`); sie werden
vom Widget-Pfad heute nur nicht konsultiert.

---

## 5. Was daraus fuer die Umsetzung folgt

> **Nachtrag 2026-07-22 (Owner-Information "US-Nummer fuer alle").** Fuenf neue Tests
> **ORIG-01 bis ORIG-05** kommen hinzu, Beleg und Begruendung in
> [`13-live-env-befund.md`](13-live-env-befund.md) Abschnitt 6. Ursache: `tariffCentsPerMin`
> (`src/telephony/outbound-gates.js:145-149`) kennt nur das Ziel, nie die Absender-DID - mit
> einer US-Nummer fuer jeden Tenant ist die Annahme "Inlands-Praefix = guenstig" ungueltig.
> Vier davon sind P0. Damit **219 kanonische Tests**, davon 206 sofort implementierbar.
> Ausserdem erledigt: `PAYMENT_CURRENCY` ist `eur` (MCP-19/DID-13), Cluster D17 wechselt von
> "unbekannt" auf "belegt".

> **Nachtrag 2026-07-25 (Owner-Entscheidungen, Abschnitt 4).** Der Vorrat steht bei
> **217 kanonischen Tests, alle sofort implementierbar** (219 - 5 zurueckgestellt
> + 3 neue WORLD-Tests). Punkt 1 unten ist damit ueberholt; die Reihenfolge in Punkt 3
> (GAP-33 zuerst) und die Loeschpflicht in Punkt 4 bleiben unveraendert gueltig.
>
> **Zwei Wechselwirkungen der Entscheidung 7.12 (Englisch als Weltdefault) mit dieser Liste:**
>
> - **D1/DID-01 wird durch den Weltdefault miterledigt.** `languageForCountry("US")` liefert
>   `LANGUAGE_FOR_COUNTRY["US"] || DEFAULT_LANGUAGE` (`locales.js:278-280`). Sobald
>   `DEFAULT_LANGUAGE` auf `en` steht, ist das Ergebnis `en`, **ohne** dass `US` in die Tabelle
>   eingetragen werden muss. DID-01 bleibt als eigener Test bestehen (er pinnt das Ergebnis,
>   nicht den Weg), wird aber nicht mehr von einem US-Eintrag abhaengen.
> - **D4/LANG-21 aendert seinen erwarteten Wert.** Der Fail-Safe-*Mechanismus* von
>   `localeFor()` bleibt nach R3 gruener Regressionsschutz - aber der Wert am Ende der Kette
>   wechselt von de-Locale auf en-Locale. Genau das prueft WORLD-03; LANG-21 ist beim Umbau
>   entsprechend nachzuziehen, sonst kollidieren die beiden.

1. **214 kanonische Tests**, davon 201 sofort implementierbar und 13 nach Entscheidung.
2. Die 108 entfallenen Eintraege werden **nicht geloescht** - sie bleiben in ihren
   Bereichsdateien als Beleglage stehen. Entfallen heisst: sie werden nicht als eigener
   Testfall implementiert.
3. Reihenfolge unveraendert wie in `PLAN-I18N-TESTS.md` Kapitel 5, mit einer Vorschaltung:
   **GAP-33** (Suite faehrt die ausgelieferte Env) zuerst. Ohne ihn beweist kein Gruen etwas
   ueber Produktion, weil `test/helpers.js` `BASE_ENV` genau die Gates neutralisiert, um die es
   geht - `ALLOWED_COUNTRY_CODES: "*"` (Zeile 84) und die Tarife auf `"0"` (Zeilen 263-264).
4. Vor dem ersten Fix an D1/D2: die beiden kollidierenden Repo-Tests aus Abschnitt 3 loeschen
   (R5), sonst laeuft der Fix in eine falsche Regressionsmeldung.
