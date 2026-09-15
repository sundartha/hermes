# Phase IEL-B2: Minutensatz je Kostenprofil

- **Gate:** PASS
- **finalBranch:** `phase/iel-b2-minutensatz`
- **headCommit:** `7097d7ae064d2dd6c42b39d0701614f9e08defe2`
- **Basis:** `phase/iel-b1-schalter` (`dea103e`)
- **Tests:** `npm test -- --test-concurrency=4` -> 5584 pass / 0 fail

## Plan (gekuerzt)

Fakten aus dem Code: `callTariffCentsPerMin(call)` in `src/billing/metering.js` unterscheidet
bisher nur `direction === "inbound"` (kalibrierter Inbound-Satz, Default `VOICE_TARIFF_INBOUND_CENTS`)
gegen alles andere (`tariffCentsPerMin(to, from)`, Leg-Satz Inland/Default aus `outbound-gates.js`,
fail-closed bei unbekannter Gegenstelle). Vier Leser dieser Funktion: `liveVoiceSpendCents`,
`recordVoiceMinuteMeter`, `reconcileVoiceBudget`, `brakeSecondsFor` (Notbremse in `/voice/incoming`).
Kein Code schreibt heute das Kostenprofil `TELNYX_INBOUND_EL_CONVAI` (kommt erst mit Phase B8) — der
Merge von B2 aendert daher an keinem echten Anruf etwas.

Ziel (E3): ein Inbound-Bein, das der ElevenLabs-Agent fuehrt (Kostenprofil
`TELNYX_INBOUND_EL_CONVAI`), soll denselben Leg-Satz zahlen wie Outbound-EL fuer dasselbe
Nummernpaar (Inland/Default, `isDomesticLeg` symmetrisch, fail-closed bei unbekannter Gegenstelle).
Jedes andere Inbound-Profil (kein Profil, `null`, `TELNYX_INBOUND_BUDGET`) bleibt beim kalibrierten
Inbound-Satz.

Geplante Aenderungen:
1. `src/billing/metering.js`: Import `KOSTENPROFIL` aus `./kostenarten.js` (importfrei, kein Zyklus),
   Kopfkommentar-Quellenliste ergaenzt. `callTariffCentsPerMin` fragt neu ein gekapseltes Praedikat
   `billsCalibratedInboundRate(call)` (`direction === "inbound" && costProfile !== TELNYX_INBOUND_EL_CONVAI`)
   statt der reinen Richtungspruefung. Weiterhin genau ein `tariffCentsPerMin`-Aufruf (G5), Praedikat
   nicht exportiert (G8).
2. `src/routes/voice.js`: nur der veraltete Kommentar in `brakeSecondsFor` ("inbound: Satz des
   EIGENEN DID-Landes", seit KV-P2 falsch) durch eine korrekte Beschreibung der Satzregel ersetzt.
   Keine Logikaenderung, `inboundLeg` setzt weiterhin kein Profil (das ist B8-Scope).
3. Lead-Entscheidung 2.3 (nicht in der urspruenglichen Dateiliste, eigener Schritt): Variante A
   (empfohlen) — in `src/billing/cost-calibration.js` nur der Kommentar an `INBOUND_KOSTENPROFILE`
   nachgezogen, weil er durch B2 falsch geworden waere; Code/Set unveraendert, offener Befund
   (Tarifpaar-Waechter vergleicht EL-Inbound weiterhin gegen den Inbound- statt den Leg-Satz,
   reine Diagnose, kein Gate) im Kommentar benannt.
4. Neuer Test `test/iel-b2-tarif.test.js`, offline, Tarif-Env vor dem ersten `config.js`-Import
   gesetzt (Env-Werte bewusst ungleich den echten Defaults, damit ein Leck auffaellt), 11 Faelle
   IEL-B2-0..10: Positivkontrolle der Saetze, inbound ohne/mit `null`/Budget-Profil (unveraendert),
   inbound EL-Profil Inland/Ausland/unbekannt (Leg-Satz, fail-closed), Outbound unveraendert auch mit
   EL-Profil am falschen Leg, Symmetrie EL-Inbound vs. Outbound-EL, `liveVoiceSpendCents` (laufendes
   Bein, gemischte Beine), `reconcileVoiceBudget` (beendetes EL- bzw. Budget-Bein).

Pre-Mortem: Unterbuchung bei fehlendem/falsch verdrahtetem Zweig, unerwuenschte Verteuerung von
Budget-Inbound durch zu breites Praedikat, fail-closed teurerer Satz bei unbekannter Gegenstelle
(akzeptiert, entspricht E3), Tarifpaar-Waechter-Fehlanzeige (offener Befund, kein Geld), Merge-Risiko
fuer laufende Anrufe (ausgeschlossen, da kein Schreiber des neuen Profils existiert).

Deterministische Pruefungen im Plan: `node --check` auf allen drei Produktionsdateien, die neue
Testdatei 11/11, die direkt betroffenen Bestandstests, volle `npm test`-Bank, Grep-Kontrollen
(veralteter Kommentar weg, neue Zeilen vorhanden, kein Profil-Schreiber ausser dem Budget-Fall in
`voice.js`), `git diff --stat` gegen die Basis begrenzt auf die vier erwarteten Dateien.

## Impl-Zusammenfassung

Umgesetzt wie geplant auf `phase/iel-b2-minutensatz` (Commit `7097d7a`, Basis `dea103e`).

- `src/billing/metering.js`: `callTariffCentsPerMin` ruft jetzt `billsCalibratedInboundRate(call)`
  (nicht exportiert, direkt unter dem Aufrufer, G10); weiterhin genau ein `tariffCentsPerMin`-Aufruf.
  KOSTENPROFIL-Import plus Kopfkommentar-Ergaenzung. Heutiges Verhalten fuer alle Altfaelle
  unveraendert; einzige neue Ausgabe: inbound mit EL-Profil -> Leg-Satz.
- `src/routes/voice.js`: ausschliesslich der Kommentar in `brakeSecondsFor` ersetzt (Diff enthaelt
  nur Kommentarzeilen, per Grep verifiziert).
- `src/billing/cost-calibration.js`: Lead-Entscheidung 2.3 Variante A umgesetzt — nur Kommentar an
  `INBOUND_KOSTENPROFILE`, Code/Set unveraendert, offener Befund benannt.
- Neu: `test/iel-b2-tarif.test.js`, 11 Faelle IEL-B2-0..10, offline, 11/11 gruen; zusammen mit den 8
  direkt betroffenen Bestandsdateien 72/72; volle Bank `npm test -- --test-concurrency=4`:
  5584 pass / 0 fail.
- Mutationsproben selbst gefahren (EL-Zweig entfernt, Richtungspruefung entfernt) und
  wiederhergestellt — beide bestaetigen, dass die erwarteten Tests rot werden.
- Grep-Checks aus Plan Abschnitt 5 alle wie erwartet; kein `recordCostProfile(...TELNYX_INBOUND_EL_CONVAI)`
  in `src` — der Merge aendert an keinem echten Anruf etwas, da niemand vor B8 das EL-Profil schreibt.
- `git diff --stat` gegen die Basis zeigt genau die vier erwarteten Dateien.

### Deviations

1. 2.3: Variante A (nur Kommentar in `cost-calibration.js`) umgesetzt, wie im Plan als empfohlen
   vorgesehen — damit liegt die Datei im Diff.
2. `fakeMeteringStore` im Test ohne `recordUsageEvent`/`usageEvents`, weil `reconcileVoiceBudget`
   beides nie aufruft (sonst ungenutzter Code, G12); im Testkommentar begruendet.
3. `ENDED_AT` wird aus `ANSWERED_AT + BILLED_MINUTES * MS_PER_MINUTE` berechnet statt als Literal
   gepflegt (gleicher Wert); zusaetzlich ein kleiner Helfer `inboundLeg`/`outboundLeg`, damit sich
   `elInboundLeg`/`budgetInboundLeg` nicht duplizieren (G5).
4. Die Mutationsproben-Kommentare wurden an das tatsaechlich gemessene Ergebnis angepasst (der Plan
   hatte die betroffenen Testfaelle pro Mutation leicht anders vorhergesagt): (a) EL-Zweig entfernen
   macht zusaetzlich IEL-B2-3 rot; (b) Richtungspruefung entfernen macht IEL-B2-5 UND -6 rot;
   (c) vertauschte Argumente werden durch IEL-B2-6 belegt (gemischtes Nummernpaar), nicht durch -7.
5. Pre-Commit-Lint-Hook (`eslint no-magic-numbers`) lehnte den ersten Commit wegen `.size, 3` in
   IEL-B2-0 ab; Zeile umformuliert zu `new Set(configuredRates).size === configuredRates.length`
   (gleiche Aussage). Volle Bank lief vor dieser reinen Test-Zeilenaenderung; danach erneut die neue
   Datei (11/11) und eslint auf die vier Dateien (0 Fehler).

Smoke-Test: Server lokal (`SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env, temp `DATA_DIR`,
Dummy-Nummer via `scripts/bootstrap-tenant.js`), `GET /healthz` -> 200, `POST /voice/incoming` -> 200,
Log zeigt `inbound_path budget`. Neuer EL-Zweig ueber die Route nicht erreichbar (kein Profil-Schreiber
vor B8), ueber Unit-Tests abgedeckt. Server sauber beendet, 0 Restprozesse.

## Safety-Urteil

**approved: true** — Alle Kernflags gruen (testsPassIndependently, safetyGatesIntact,
disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended),
keine Blocker.

Unabhaengiger Test im frischen Worktree: `node --check` auf allen drei Produktionsdateien ok;
`test/iel-b2-tarif.test.js` 11/11; zusammen mit den direkt betroffenen Bestandstests (kv-p2,
ks-p2-live-carrier-spend, metering-unit, kv-p1-cost-ledger-map, kv2-10-tarifpaar,
cost-calibration, cost-origin-axis, budget-nan-fail-closed, voice-budget-reconcile-finishcall,
iel-incoming-golden, iel-b1-schalter) 144/144. Mutationsprobe (EL-Zweig entfernt) macht 6 Faelle
rot wie erwartet, danach zurueckgesetzt.

Verdict: FREIGABE. Diff umfasst nur die vier erwarteten Dateien: additiver Zweig in `metering.js`,
zwei reine Kommentar-Aenderungen, ein neuer Test. Keine neue/geaenderte Route, keine
Auth-Aenderung, kein Client-Einfluss auf das Kostenprofil (`costProfile` wird ausschliesslich
serverseitig per `setCostProfileOnce` gesetzt, nie aus einem Client-Feld gelesen). Die
pro-Tenant-Kostendecke wird nicht gelockert, sondern fuer EL-Inbound eher verschaerft (hoehere
Saetze 20/30 statt 6 ct). Offenlegung, Signaturpruefung, Denylist, `OUTBOUND_FROZEN`, Max-Dauer
unberuehrt. Kein Code setzt das neue Profil vor B8 — Verhalten bei laufendem System byte-identisch.

Concerns (keine Blocker):
- Scope-Erweiterung `cost-calibration.js` nicht in der urspruenglichen Spec-Dateiliste, aber durch
  Lead-Entscheidung 2.3 A gedeckt (nur Kommentar).
- Offener Befund Tarifpaar-Waechter (`INBOUND_KOSTENPROFILE` vergleicht EL-Inbound weiterhin gegen
  den Inbound- statt den Leg-Satz) ist nirgends dauerhaft (todo.md/PLAN-SECURITY.md) festgehalten —
  nur Diagnose, kein Gate.
- `cost-ledger-map.js` `voice_minute_inbound.preisquelle`-Text nennt nur `voiceTariffInboundCents`,
  ist jetzt unvollstaendig (nur String, kein Gate-Effekt, Pfad vor B8 nicht live).
- Testluecke: `recordVoiceMinuteMeter` (Stripe-Usage, nur unter `PAYMENT_ENABLED`) liest ebenfalls
  `callTariffCentsPerMin`; kein dedizierter Test dafuer (Spec verlangt nur Live-Term + reconcile,
  beides abgedeckt).
- Fuer B8 festgehalten: `brakeSecondsFor` bremst erst korrekt, wenn das EL-Profil VOR `createCall`
  im Leg-Objekt steht — sonst rechnet die Notbremse mit dem kalibrierten statt dem Leg-Satz.

Zweite Security-Review (unabhaengig, gleicher Diff): ebenfalls **PASS**, keine Blocker. Bestaetigt:
keine neue Angriffsflaeche, `costProfile` nie clientgesteuert, fail-closed bei unbekannter
Gegenstelle liefert immer den teureren Satz, alle vier Leser derselben Quelle liefern fuer
Bestandsfaelle unveraenderte Werte. Zusaetzlicher Hinweis: die neuen Saetze machen EL-Inbound nur
dann zuverlaessig teurer als Budget-Inbound, wenn `VOICE_TARIFF_DOMESTIC_CENTS >=
VOICE_TARIFF_INBOUND_CENTS` konfiguriert ist (Standard 20/30 gegen 6) — Konfigurationsrisiko, kein
Code-Defekt dieser Phase.

## Clean-Code-Audit (s1-s4)

- **s1:** keine Funde
- **s2:** keine Funde
- **s3:** ein Fund — `src/billing/cost-calibration.js:393-403`: der Kommentar haelt den offenen
  Befund (Tarifpaar-Waechter vergleicht weiterhin gegen den falschen Satz) fest, ohne eine
  Tracking-/Ticket-Referenz zu nennen. Optional, kein Blocker (explizit als bewusste
  Diagnose-Entscheidung dokumentiert).
- **s4:** keine Funde
- **blocker:** false
- **verdict:** PASS. Diff klein (3 Produktionsdateien, ueberwiegend Kommentare + eine saubere
  5-Zeilen-Funktion `billsCalibratedInboundRate`), praezise auf den Minutensatz-Unterschied fuer
  EL-Convai-Inbound begrenzt. `callTariffCentsPerMin`/`billsCalibratedInboundRate`: 0-1 Argumente,
  keine Verschachtelung, keine Magic Numbers, Bedingung sauber in benanntes Praedikat gekapselt
  (G28) statt inline im `if`. Testdatei (186 Zeilen, 11 Faelle) offline, klare
  Build-Operate-Check-Struktur, deckt alle relevanten Grenzfaelle inkl. dokumentierter
  Mutationsproben ab (P11/T5 erfuellt). `voice.js`- und `cost-calibration.js`-Aenderungen reine
  Kommentar-Praezisierungen ohne Logikaenderung.
- Top-Todo (optional): Tarifpaar-Waechter-Drift in `cost-calibration.js` mit einer
  Tracking-Referenz versehen.

## Fix-Runden

Keine — beide Reviews (Safety und Clean-Code) kamen bereits im ersten Durchlauf auf PASS/FREIGABE
ohne Blocker. Die im Abschnitt "Deviations" genannten Anpassungen (Lint-Fix, Testkommentar-Praezisierung,
Helfer-Extraktion) erfolgten waehrend der Implementierung selbst, nicht als nachtraegliche Fix-Runde
nach einem Review-Fund.
