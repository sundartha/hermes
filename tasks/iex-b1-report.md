# Phase IEX-B1 — Betreiber-Alarm fuer gescheiterte Inbound-Uebergaben

**Status:** Gate = PASS · finalBranch = `phase/iex-b1-inbound-alarm` · headCommit = `f4ec5f0167c32cb0acca1662117bf477bcbdb457`

**Vorbedingung des Rollouts, nicht optional:** Owner-Entscheidung 13 (`tasks/todo.md`) hat den Vorschlag F10a aus `tasks/iep-strategie.md` uebernommen — "(a) ja, als kleine eigene Phase vor dem Rollout"; ohne sie bleibt der Rollout gesperrt. Die vollstaendige, autoritative Phasendefinition steht in `tasks/iex-b-spec.md` unter der Ueberschrift "## Phase IEX-B1 - ..." und ist bindend: Datenfluss, Scope, Nicht-Scope, Invarianten I1-I6, Testpflicht, Abnahmekriterien und Pre-Mortem R1-R5.

## Der Kernpunkt dieser Phase

Die Outbound-Definition von Erfolg ist fuer Inbound FALSCH und ergaebe einen blinden Alarm. `outageWindow()` zaehlt heute `call.answeredAt` als Erfolgsbeleg — seit IEP-P2 (Sofortannahme, kein `answerOnBridge`) traegt aber JEDER eingehende Anruf `answeredAt`, auch der, dessen Uebergabe danach scheiterte. Fuer Inbound gilt stattdessen: `erfolge = bridgeStateOf(call) === GEBUNDEN`, `fehler = bridgeStateOf(call) === RUECKFALL`; `WARTET` am Ende ist KEIN Fehler-Beleg (normales Auflegen darf keinen Alarm erzeugen, Owner-Entscheidung F10b). Der erste Pflichttest ist genau dieser Fall: ein Fenster aus lauter gescheiterten Uebergaben MIT gesetztem `answeredAt` muss ALARM ergeben.

Die eine Erkennungsregel bleibt EINE (G5): `outageWindow` verallgemeinern, `beurteileAusfall`/`meldeErlaubt`/`alarmZeile` geteilt lassen, eigener Code fuer die neue Klasse (`openOutageAlert` sucht je `code`, keine Schema-Aenderung). Der Outbound-Pfad bleibt verhaltensgleich — die Bestandstests zu `outage-detection`/`outage-report` mussten OHNE Anpassung gruen bleiben (I1). Kein Tenant und kein Owner bekommt aus dieser Phase eine Nachricht (O3, Owner-Entscheidung 15). KEIN Rollout, keine Registrierung, kein Scope-Flip, kein Deploy — das macht danach der Lead.

---

## Plan (gekuerzt)

### 0. Kern in einem Satz
`outageWindow()` bekommt eine **Zaehlweise** als Parameter (Default = die Bestandsdefinition, damit der Outbound-Pfad byte-gleich bleibt), eine zweite Zaehlweise fuer Inbound zaehlt `GEBUNDEN` als Erfolg und `RUECKFALL` als Fehler (nicht `answeredAt`, nicht `WARTET`), beide Klassen fahren durch **dieselbe** Regel (`beurteileAusfall`/`meldeErlaubt`/`alarmZeile`) und denselben Meldeweg, mit **eigenem Marker-Code** und **eigenen Schwellen**.

Blast-Radius: 1 neue Quelldatei, 3 bestehende Quelldateien (alle in `src/telephony/`), `src/config.js`, `.env.example`, `render.yaml` (begruendete Ausnahme), 1 neue Testdatei, `test/helpers.js` (BASE_ENV-Pin).

### 1. Belegte Ausgangslage
- `outageWindow()` zaehlt `call.direction !== "outbound"` weg und wertet `call.answeredAt` als Erfolg (`src/telephony/outage-detection.js`).
- Jeder eingehende EL-Anruf traegt seit IEP-P2 `answeredAt` (`EL_DIAL_ANSWER_ON_BRIDGE = false`, `src/elevenlabs/inbound-rueckfall.js`).
- Brueckenzustand ist ein reines Praedikat: `bridgeStateOf(call)` in `src/elevenlabs/inbound-bridge-state.js`.
- `costProfile`, `elFallbackAt`, `elevenlabsConversationId` sind in beiden Backends persistiert (`src/store/json.js`, `src/store/pg.js`, `src/db/schema.sql`).
- Rueckfall-Marker wird an genau einer Stelle gesetzt: `vermerkeUebergabeGescheitert` (`src/elevenlabs/inbound-uebergabe-gescheitert.js`).
- `openOutageAlert(state, code)` sucht je `code` — zweite Klasse braucht keine Schema-Aenderung (I5).
- Bestehende Marker-Namensraeume (`not-placed*`, `drift:`, `hold:`, `self-test:`, `kosten:`) kollidieren nicht mit `inbound-el:`.
- Ende wird VOR der Abrechnung persistiert; der Outbound-Ausloeser sitzt am Anruf-Ende (`reportFailedCall` → `reportSystematicOutage`, `src/telephony/call-finish.js`); der EL-Inbound-Abschluss kehrte bislang VOR `reportFailedCall` zurueck (fehlender Melder).
- Erholung laeuft im Stunden-Sweep, gefiltert per Whitelist (`runOutageRecoverySweep`, `istFehlergrundEimer`).
- Bestandstests, die unveraendert bleiben MUESSEN (I1): `test/ausfall-erkennung.test.js` (ruft `outageWindow` ohne vierten Schluessel → Default noetig), `test/ausfall-meldeweg.test.js`, `test/ausfall-verdrahtung-call-finish.test.js`.

**Zwei Fallen:**
1. **Zyklus.** Outbound-Zaehlweisen-Satz bleibt in `outage-detection.js` (Default dort), Registry (beide Klassen + Schwellen) liegt in der neuen Datei und importiert nur in eine Richtung.
2. **Attrappen-Configs.** Ohne Schutz waere `windowMs === undefined` scharf (NaN-Vergleiche). Deshalb: Inbound-Schwellenleser fail-closed (`Number.isFinite` → sonst `0` = AUS), bewusst NICHT in `beurteileAusfall` gebaut (sonst I1-Verstoss).

### 2. Neue Datei: `src/telephony/outage-classes.js`
Reine Deskriptor-/Registry-Datei, IO-frei. `AUSFALL_KLASSE.OUTBOUND` (Zaehlweise + Schwellen woertlich aus dem Bestand verschoben) und `AUSFALL_KLASSE.INBOUND_EL` (`code = "inbound-el:uebergabe"`, `zaehlweise` ueber `bridgeStateOf`, `schwellen` mit `fensterOderAus` fail-closed). Vier begruendete Design-Entscheidungen: eigener Marker-Code (kein Kollision mit `not-placed*`), fail-closed statt in `beurteileAusfall`, `WARTET` zaehlt in den Nenner aber nicht als Fehler (sichtbar ueber `versuche-erfolge-fehler`), `debounceMs`/`retryMs` geteilt (Eigenschaft des Betreiber-Kanals, nicht der Fehlerklasse) — entprellt wird trotzdem je Marker-Code getrennt.

### 3. Edits an Bestandsdateien
- **`outage-detection.js`**: `ZAEHLWEISE_OUTBOUND` als benannter, exportierter Default-Deskriptor (woertlich der Bestandsrumpf); `outageWindow(calls, { nowMs, windowMs, bucket, zaehlweise = ZAEHLWEISE_OUTBOUND })`.
- **`outage-report.js`**: `outageThresholds` entfaellt (Inhalt lebt als `AUSFALL_KLASSE.OUTBOUND.schwellen`); `sendAlert` nimmt `schwellen.windowMs` der urteilenden Klasse statt hart des Outbound-Blatts; `claimVerdict` reicht `zaehlweise` durch; neue reine Funktion `ausfallTrefferAmAnrufEnde(call)` entscheidet die Klasse (Outbound: unveraendert `not-placed`; Inbound: nur `RUECKFALL`); `reportSystematicOutage` laeuft ueber diesen einen Diskriminator statt zwei separate Zweige; Erholungs-Sweep bewertet jeden offenen Marker mit SEINER Klasse/Schwellen ueber `ausfallKlasseVonMarker(code)`.
- **`call-finish.js`**: im `uebergabeGescheitert`-Zweig zusaetzlich `await reportSystematicOutage({...})` — derselbe Melder, kein zweiter Meldeweg, O3 unangetastet (nur Betreiber-Kanal).
- **`config.js`**: vier neue `billing`-Blaetter (`inboundOutageAlertWindowMs` Default 6h/`min:0`=AUS, `inboundOutageAlertMinFailures` Default 2, `inboundOutageAlertMinAttempts` Default 20, `inboundOutageAlertFailSharePercent` Default 10) inkl. `CONFIG_NAMESPACES`-Eintrag. Begruendung: 6h statt 1h (Inbound-Volumen niedriger als Outbound, sonst bleibt ein Totalausfall stundenlang unbemerkt); `minFailures=2` (ein Fehler ist hier ein eigener Vermerk, kein Fremdverschulden); `failSharePercent=10` statt 20 (Totalverlust fuer den Anrufer, kein Retry); K1/K2 partitionieren die Volumen-Achse nahtlos an der Grenze `versuche=20`.
- **`.env.example`** / **`render.yaml`**: dieselben vier Schluessel mit Kommentar (Zweck, warum eigene Werte, `0=AUS`).
- **`test/helpers.js`**: BASE_ENV-Pin, Fenster explizit `"0"` (neutral aus in Spawn-Tests, nicht der Produktions-Default), drei Schwellen auf Default.

### 4. Tests — `test/iex-b1-inbound-ausfall-alarm.test.js` (10 Faelle, Praefix `IEX-B1-<n>`)
1. **PFLICHT (R1):** Fenster aus lauter gescheiterten Uebergaben MIT `answeredAt` → ALARM; Gegenprobe mit Outbound-Definition (`answeredAt` als Erfolg) → `kein-befund`.
2. **PFLICHT (R2):** Auflegen in der Wartephase (`WARTET`) → kein Alarm, keine falsche Entwarnung.
3. Gesunde Inbound-Reihe schliesst offene Klasse ueber den echten Sweep als erholt, 0 Mail/SMS.
4. (R4) Outbound- und Inbound-Klasse fuehren getrennte Marker, entprellen sich nicht gegenseitig.
5. (I4) `INBOUND_OUTAGE_ALERT_WINDOW_MS=0` schaltet komplett ab; fehlendes Blatt verhaelt sich wie 0 (fail-closed).
6. Verdrahtung: echter `finishCall`-Pfad loest bei RUECKFALL genau einen Marker + Audit aus; bei GEBUNDEN/completed keiner.
7. (O3/I3) Kein Tenant-/Owner-Kanal wird beruehrt; nur Plattform-Mail/SMS.
8. (I2) Alarm-Body PII-frei, nennt SEIN (Inbound-)Fenster.
9. (I1) Bestandspfad ohne `zaehlweise`-Argument bleibt unveraendert (`{0,0,0,0}` auf Inbound-Daten mit Outbound-Default).
10. Vier Schwellen kohaerent in `config.js`, `.env.example`, `render.yaml`, `BASE_ENV`.

Bestandssuite (`ausfall-erkennung`, `ausfall-meldeweg`, `ausfall-verdrahtung-call-finish`): keine Aenderung (I1).

### 5-9 (Pruefkommandos, Abweichungsbegruendungen render.yaml/test/helpers.js, expliziter Nicht-Scope, offene Review-Concerns, Pre-Mortem R1-R8)
Siehe Volltext-Plan im Workflow-Transkript; inhaltlich identisch mit Umsetzung/Review unten. Nicht-Scope u.a.: kein Alarm fuer Abweisung ohne EL-Registrierung, keine Schema-/`boot.js`-Aenderung, kein zweiter Timer, keine neue Dependency, Offenlegung/Safety-Gates/Auth unberuehrt.

---

## Impl-Zusammenfassung

- **headCommit:** `f4ec5f0167c32cb0acca1662117bf477bcbdb457`
- **node --check:** PASS (alle geaenderten Dateien)
- **npm test:** PASS — 6065 pass / 0 fail
- **Smoke:** PASS — Server lokal auf Port 3997 (`SKIP_TWILIO_SIGNATURE_CHECK=true`, eigener DATA_DIR im Scratchpad, `INBOUND_OUTAGE_ALERT_WINDOW_MS=21600000`): `GET /healthz` = 200, `POST /voice/incoming` = 200 (dokumentierter lokaler Bypass, Audit-Zeile `inbound_unrouted`). Boot lief sauber durch die Config-Parse-Stufe — die vier neuen `numEnv`-Blaetter werden akzeptiert. Keine Produktionshandlung.

**Neue Dateien:**
- `src/telephony/outage-classes.js`
- `test/iex-b1-inbound-ausfall-alarm.test.js`

**Geaenderte Dateien:**
- `src/telephony/outage-detection.js`, `src/telephony/outage-report.js`, `src/telephony/call-finish.js`, `src/config.js`, `.env.example`, `render.yaml`, `test/helpers.js`, `test/config-namespaces.test.js`

### Deviations
1. **`test/config-namespaces.test.js`** war im Plan nicht vorgesehen — gepinnter Zaehl-Test, der bei jedem neuen Namespace-Blatt fortgeschrieben wird (billing 55→59, `EXPECTED_TOTAL_KEYS` 192→196, `EXPECTED_PRIMITIVE_LEAVES` 179→183, mit Changelog-Eintrag). Kein von I1 geschuetzter Bestandstest.
2. **render.yaml ausserhalb des Abnahmekriterium-3-Wortlauts**: begruendete Ausnahme laut CLAUDE.md-Konvention ("fuer Render zusaetzlich `render.yaml` pruefen"); reine Doku-Datei ohne Laufzeitwirkung, Live-Services sind Dashboard-verwaltet.
3. Zwei Lint-Nachbesserungen ohne Verhaltensaenderung: `offeneAusfallMarker(outageAlerts)`-Hilfsfunktion statt Inline-Filter/Map/Filter-Kette (Demeter-Regel, `no-restricted-syntax`, G36); ausgeschriebene Testbezeichner statt Kurzformen (id-length), `spies.summaryPlanCalls` als Array statt Zaehler (`no-param-reassign`).
4. **Mutations-Gegenprobe fuer Test 6 nicht abgeschlossen**: Auto-Mode-Classifier hat den probeweisen Testlauf mit deaktivierter Aufrufzeile geblockt ("Logging/Audit Tampering"); Mutation sofort zurueckgenommen (Bank danach gruen). Sensitivitaet bleibt strukturell begruendet (echtes `makeCallFinish`, echte `state-ops`, Gegenprobe im Test selbst; analoger Outbound-Fall durch `E3B-01` belegt).
5. **Testbank-Flake (Bestandsverhalten):** zwei von vier Vollbank-Laeufen hatten je einen roten Spawn-Test (`web-login-wiring`, `ie4-wiederholung-uebergebenes-leg`), beide isoliert gruen, unterschiedliche Tests je Lauf, Laeufe 3+4 vollstaendig gruen (6065/6065). Entspricht der bekannten Lehre `sec-testbank-parallel-race`.

**Clean-Code-Selbstcheck (Impl):** `.claude/refs/clean-code.md` gelesen und angewendet — G5/S2 (keine zweite Erkennungs-/Melde-/Fristlogik), G25/G35 (keine Magic Numbers, alle Schwellen konfigurierbar), C5/G9/G12 (kein toter/auskommentierter Code), G30/G34/F1 (Funktionsgroesse, ≤3 Argumente bzw. Objekt-Argument), P15 (keine Lazy-Init), C2 (Modulkopf-Kommentare aktualisiert), P11 (neues Verhalten hat Tests). Safety-Gates, Offenlegung, Auth, Secrets: nicht beruehrt.

---

## Safety-Urteil (final)

**approved = true** — alle Einzelfelder true (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`), **blockers = []**.

**Unabhaengiger Testlauf:** vier eigene `node --test --test-concurrency=4`-Laeufe ueber die vom Diff betroffenen Dateien, zusammen 210 pass / 0 fail / 0 skipped, plus `node --check` gruen auf allen fuenf geaenderten Quelldateien. Keine Produktionshandlung (kein Anruf, kein Push, kein Flag-Flip, keine EL-/Telnyx-/Render-Aenderung).

**Verdict:** FREIGEGEBEN. Die Phase trifft den Kernpunkt: Zaehlweise wird Parameter der EINEN Regel, `ZAEHLWEISE_OUTBOUND` ist woertlich der Bestandsrumpf und Default, Inbound-Erfolg ist `GEBUNDEN` statt `answeredAt`, `WARTET` zaehlt nur in den Nenner. Pflichttest 1 belegt den blinden Alarm mit Gegenprobe. Offenlegung unberuehrt (kein Diff in `claude.js`, `src/elevenlabs/*`, `routes/voice.js`). Kein Safety-Gate entfernt/aufgeweicht; O3 gewahrt (0 Tenant-Notifications, genau 1 Mail + 1 SMS an Plattform-Kanal, am echten `finishCall`-Pfad getestet). Auth fail-closed unberuehrt (keine neue Route). Keine Secrets/PII. I1 belegt (Diff der drei Bestandsdateien leer und gruen). I4/I5 am Test belegt. Scope sauber: 10 Dateien, keine neue Dependency, kein toter/auskommentierter Code.

**Concerns (keiner Blocker):**
1. `render.yaml` ausserhalb der Spec-Dateiliste — gedeckt durch CLAUDE.md-Konvention, keine Produktionswirkung; sollte im Report als Ausnahme benannt sein (hier erledigt).
2. Faktische Reichweite: bei drei DIDs wird der `minAttempts=20`-Nenner praktisch selten erreicht, der Melder alarmiert real primaer den Totalausfall (kein einziges `GEBUNDEN` plus ≥2 `RUECKFALL`); ein Teilausfall (z.B. 2 von 10 bei einem Tenant) bleibt stumm. Deckt sich mit dem Spec-Ziel "systematischer Ausfall", muss nach dem Rollout an echten Zahlen nachgezogen werden (Env-Aenderung ohne Deploy).
3. `finishCall` awaitet auf dem Inbound-Zweig jetzt einen moeglichen SMTP-Versand (nur im ALERT-Fall, entprellt, fail-soft, idempotent ueber `call._finished`) — gleiches Muster wie der Bestands-Outbound-Zweig, kein Blocker.
4. Bei `INBOUND_OUTAGE_ALERT_WINDOW_MS=0` wird `reportSystematicOutage` im RUECKFALL-Fall trotzdem betreten (ein `withStoreLock` + Scan + `save()`), bevor `OUTAGE_VERDICT.OFF` greift — kein sichtbares Verhalten, aber "aus" heisst hier "kein Urteil", nicht "kein Anfassen".

---

## Clean-Code-Audit (final)

**s1 = [] · s2 = [] · s3 = [] · blocker = false**

**s4 (Hinweis, kein Verstoss):**
- G8 · `outage-classes.js` · `AUSFALL_KLASSE` ist ein wachsendes Registry-Objekt (aktuell 2 Eintraege); bei weiteren Kanaelen rechtzeitig pruefen, ob `schwellen()`/`zaehlweise` als Paar noch uebersichtlich bleiben — aktuell kein Verstoss, nur ein Trend zu beobachten.

**Verdict: PASS.** Diff sauber gegen den Katalog: keine Duplizierung (G5) — Erkennungsregel bleibt fuer beide Klassen EIN Pfad, nur Zaehlweise (drei reine Praedikate) und Schwellen sind pro Klasse ausgetauscht; kein zweiter Meldeweg. Import-Zyklus bewusst vermieden und dokumentiert (`outage-detection.js` importiert NICHT von `outage-classes.js`). G23 (Dispatch-Tabelle statt switch), G27 (Struktur statt Disziplin), G35 (Konfiguration zentral) eingehalten. Magic Numbers benannt. Funktionslaenge/Verschachtelung unter den Richtwerten, Objekt-Parameter statt >3 Positionsargumente (F1). Tests decken genau die benannten Pre-Mortem-Risiken (R1/R2/R4/I1/I4/O3/PII/Config-Kohaerenz) ab. BASE_ENV korrekt ergaenzt (Lehre `test-base-env-drift`), `config-namespaces.test.js`-Zaehler konsistent nachgezogen. Sicherheitsrelevante Schranken nicht beruehrt. Keine toten Funktionen, kein auskommentierter Code, keine abgeschalteten Sicherungen.

**topTodos:** Kein Blocker. Optional: bei weiteren kuenftigen Ausfall-Klassen (>2) pruefen, ob `AUSFALL_KLASSE` als flaches Objekt noch die richtige Struktur ist (vorsorglich, G8). Sonst nichts weiter — Diff kann wie vorliegend gemergt werden.

---

## Security-Review (final)

**approved = true · blockers = []**

Gepruefter Stand: `phase/iex-b1-inbound-alarm` (`f4ec5f0`) gegen `master`, 10 Dateien, +859/-56, verifiziert in einem detached Worktree-Checkout (`node --check` OK, `npm test -- --test-concurrency=4` gruen 6065/6065, `test/route-auth-inventory.test.js` inkl. Routen-Fingerprint unveraendert gruen).

**Angriffsflaeche:** keine neuen/geaenderten oeffentlichen Routen (`git diff --stat` auf `src/routes`/`src/route-policy.js`/`src/server.js` leer); keine neue Dependency; kein neuer Env-Schluessel ausserhalb der dokumentierten Orte; kein DDL (I5 gehalten). Keine Produktionshandlung im Diff.

**Safety-Gates (Regel 1):** unberuehrt — `outbound-gates.js`, `budget-gate.js`, Denylist/Land-Gate/Stundenlimit, Max-Dauer, `OUTBOUND_FROZEN`, Signaturpruefung nicht im Diff. Buchung in `finishCall` laeuft weiterhin VOR dem neuen Zweig; pro-Tenant-Kostendecke sieht Inbound-Traegerminuten unveraendert. Einziger kostenpflichtiger Nebeneffekt: Betreiber-SMS an `platformAlertSmsTo` (fester Empfaenger, Plattform-Absender, fail-closed).

**Offenlegung (Regel 2):** unberuehrt — `claude.js`, TeXML-Erzeugung, `first_message`/Init-Route, Fehlersatz-Pfad nicht im Diff. Fuer nicht gepinnte Tenants aendert sich nichts (`bridgeStateOf = KEIN_EL_INBOUND` → Melder laeuft nicht an).

**O3/Datenabfluss:** Marker-Code ist Konstante, kein anrufer-kontrollierter String erreicht Body/Audit/DB-Code-Spalte. Body unveraendert `alarmZeile()` — keine E.164, kein `tenantId` (nur Anzahl betroffener Tenants), keine Call-ID, kein Transkript (Test 8 positiv+negativ). Empfaenger ausschliesslich Plattform-Mail/SMS (Test 7 belegt ueber echten `finishCall`-Pfad). `logGescheiterteUebergabe` PII-frei, unveraendert. MCP nicht beruehrt.

**Tenant-Verwechslung:** ausgeschlossen — `betroffeneTenants` wird zu einer Zahl verdichtet, Tenant-IDs verlassen die Funktion nie; Marker ist plattformweit wie der Outbound-Marker.

**Gate-Umgehung/Doppelzaehlung:** `ausfallTrefferAmAnrufEnde` ist total und disjunkt; ein abgewiesener Anruf (BUDGET-Kostenprofil) faellt aus der Klasse — eine nicht registrierte DID kann den Alarm nicht fuettern. Doppelzaehlung ueber beide Ausloeser ausgeschlossen (`uebergabeGescheitert`-Zweig kehrt vorher zurueck).

**I1:** belegt, nicht behauptet — `ZAEHLWEISE_OUTBOUND` ist die woertlich herausgezogene Bestandsregel und Default; Bestandstests unveraendert im Diff und gruen (170/170 im gezielten Lauf). `sendAlert` liest `windowMs` jetzt aus den Schwellen der urteilenden Klasse — fuer Outbound derselbe Wert, Body byte-identisch.

**Concerns (keiner Blocker):**
1. Neuer, von aussen anstossbarer Versandpfad: erstmals kann ein unauthentifizierter eingehender Anrufer indirekt den Betreiber-Meldeweg ausloesen (`call-finish.js` → `reportSystematicOutage` → `sendeUeberBeideKanaele`). Gedeckelt durch eigenen Marker + `meldeErlaubt` (debounceMs 6h) und K1 (`erfolge===0`). Bei dauerhaftem Mail-Fehlschlag greift `retryMs` (15 min) statt `debounceMs` — bis zu ~96 Alarm-SMS/Tag unter anhaltendem Ausfall moeglich; Bestandsverhalten des Meldewegs (gilt auch fuer Outbound), aber neue Ausloeser-Flaeche. Empfehlung: nach Rollout messen, ggf. eigene `retryMs` fuer die Inbound-Klasse.
2. "Auflegen in der Wartephase zaehlt nicht als Fehler" haelt nur, solange der Datensatz `WARTET` bleibt. Ein Rennen zwischen `/voice/status`-Terminalisierung und Anrufer-Auflegen kann denselben Anruf als `RUECKFALL` vermerken. Kein Sicherheitsloch (Body PII-frei, nur Betreiber-Alarm), aber genau das Rauschen aus Pre-Mortem R2. Rennen ist Bestand (IEX-A), nicht von dieser Phase eingefuehrt.
3. Boot-Guard-Luecke (Beobachtbarkeit, nicht Sicherheit): `alertChannelFindings` (`boot-guard.js`) knuepft die fatale Kanalpruefung an `elevenLabsOutboundEnabled && outageAlertWindowMs>0`; `INBOUND_OUTAGE_ALERT_WINDOW_MS` ist dort nicht eingehaengt. Eine Instanz mit EL-Inbound an, EL-Outbound aus und ohne Alarm-Kanal bootet gruen und haette einen scharfen, aber stillen Inbound-Melder.
4. `fensterOderAus` schaltet die Inbound-Klasse bei nicht-endlichem `windowMs` komplett aus — fuer ein Alarm-Feature ist "fail-closed" hier gleichbedeutend mit "fail-silent". In Produktion liefert `config.js` immer eine validierte Zahl; kein Test/Guard belegt das in Prod direkt.
5. Scope-Randnotiz: `render.yaml` ausserhalb der Spec-Dateiliste, gedeckt durch CLAUDE.md-Konvention (hier dokumentiert).

---

## Fix-Runden

Keine — der Workflow lief in einer Runde zu PASS. Es gab keine Blocker (S1/S2 leer bei Clean-Code, keine Safety-/Security-Blocker), daher keine Fix-Iterationen noetig. Die einzige Nachbesserung waehrend der Implementierung (nicht als separate Runde gezaehlt) war das gescheiterte, sofort zurueckgenommene Mutations-Experiment fuer Test 6 (s. Deviations Punkt 4).
