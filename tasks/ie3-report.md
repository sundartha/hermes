# Phase IE3 — Kostenprofil und gemessene Pflichtmenge fuer den neuen Inbound-Weg

- **Gate:** PASS
- **finalBranch:** `phase/ie3-kostenprofil`
- **headCommit:** `326f8a499e170bba068f4b6939124e98e25200d9`
- **Datum:** 2026-09-12

## Plan (gekuerzt)

Ziel: das sechste Kostenprofil `KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI = "telnyx_inbound_el_convai"` fuer den neuen Inbound-Weg (unser Telnyx-Bein + ElevenLabs-ConvAI-Agent, K1) in die Kostenarten-Registry aufnehmen, mit fail-closed gemessener Pflichtmenge und einem FATALEN Boot-Riegel, der sicherstellt, dass der Weg nie scharf sein kann, ohne dass seine Anbieterkosten einem Einsammler zugeordnet sind.

Zentrale Entscheidungen (E1-E7):
- **E1:** Profilname `telnyx_inbound_el_convai` (nicht `el_convai_sip`, dessen Pflichtmenge `[sip-trunking]` ist — unser Bein liefert `call-control`, B12).
- **E2:** genau zwei Traeger — `elevenlabs_convai` (KV2_4) + `telnyx_call_records` (KV2_5G). **Kein** `telnyx_sip`: die Messung IE1/F-D (M15) ist ungelaufen, "kein Traeger ohne Messung".
- **E3:** `pflichttypen: PFLICHTTYPEN_UNGEMESSEN` — der Env-Wert waere geraten (B6-Falle); Folge bewusst getragen: keine Erstattung auf diesem Weg, bis F-D gemessen ist; Nachbuchen bleibt unberuehrt.
- **E4:** neuer Schalter `ELEVENLABS_INBOUND_ENABLED` → `config.voice.elevenLabsInbound.enabled`, Default `false`, entsteht bereits in IE3 (nicht erst IE5).
- **E5:** `src/routes/voice.js` bleibt in IE3 UNANGETASTET — die `recordCostProfile`-Zeile gehoert an den neuen Zweig, den erst IE5 baut. Damit ist "Schalter an ohne Schreiber" strukturell wirkungslos (Pre-Mortem Q1).
- **E6:** die zwei vorgefundenen ungeprueften Zweitlisten (`sweep-kostenbeleg.js#TELNYX_CALL_RECORDS_PROFILE`, `cost-calibration.js#INBOUND_KOSTENPROFILE`) werden mitgezogen, sonst wuerde die Registry einen Einsammler behaupten, den es nicht gibt (A5), bzw. der Tarif-Waechter das neue Profil gegen den Outbound-Satz vergleichen (A6).
- **E7:** kein zweiter WARN-Befund "Schalter an, Pflichtmenge ungemessen" — der Schalter hat bis IE5 keinen Verhaltens-Verbraucher, es gibt also keine Lage, vor der zu warnen waere.

Pre-Mortem deckte 6 Risiken ab (Q1-Q6), alle mit konkretem Gegenmittel im Plan (v.a. E5 gegen den teuersten Fehler: frueher Flag-Flip vor IE5 wuerde sonst Inbound-EL-Kosten dauerhaft still verschwinden lassen).

Geplante Edits: `src/billing/kostenarten.js` (neue Registry-Zeile), `src/boot-guard.js` (neuer FATAL-Befund `EL_INBOUND_CARRIER_UNCOLLECTED`), `src/boot.js` (Verdrahtung ueber `pflichtTraegerFuerProfil`), `src/billing/sweep-kostenbeleg.js` + `src/billing/cost-calibration.js` (Zweitlisten nachziehen), `src/config.js` + `.env.example` + `render.yaml` + `test/helpers.js` (neuer Schalter, vier Orte). Neue Testdatei `test/ie3-inbound-el-kostenprofil.test.js` (T1-T8), kein neues Produktionsmodul.

Uebergaben an IE5 (H1-H5): die `recordCostProfile`-Zeile am neuen Zweig; der Einsammler-Umbau in `el-reifung.js` fuer das neue Profil; sobald F-D gemessen ist, Pruefung ob `telnyx_sip` als dritter Traeger dazugehoert; der Schalter wird von IE5 NICHT erneut deklariert.

## Impl-Zusammenfassung

Vollstaendig gemaess Plan umgesetzt, committet auf `phase/ie3-kostenprofil` (`326f8a4`).

- **Registry** (`src/billing/kostenarten.js`): neues Profil mit genau zwei Traegern (`elevenlabs_convai`/KV2_4, `telnyx_call_records`/KV2_5G), `telnyx_sip` bewusst nicht enthalten, `pflichttypen = PFLICHTTYPEN_UNGEMESSEN`. `legacyKostenprofil` und `kostenprofilFuerAnruf` BYTE-IDENTISCH belassen; der Reihenfolge-Riegel B12 per Test gepinnt (nicht nur kommentiert).
- **Boot-Riegel**: neuer FATALER Befund `LATENT_COST_PATH_FINDING.EL_INBOUND_CARRIER_UNCOLLECTED` in `latentCostPathFindings` (`src/boot-guard.js`), zwei neue Felder (`elInboundEnabled`, `elInboundCarrierHasCollector`) am bestehenden EINEN Objekt-Argument. Verdrahtung in `src/boot.js#assertLatentCostPaths` ueber `pflichtTraegerFuerProfil(TELNYX_INBOUND_EL_CONVAI).length > 0` — eine Quelle, die Profil-Registry, kein zweites Flag.
- **Schalter**: `ELEVENLABS_INBOUND_ENABLED` an vier Orten (`src/config.js` als Gruppe `voice.elevenLabsInbound.enabled` + `CONFIG_NAMESPACES`, `.env.example`, `render.yaml`, `test/helpers.js#BASE_ENV`), Default `false`. Heute genau EIN Verbraucher: der Boot-Riegel. `src/routes/voice.js` unangetastet.
- **Mitgezogen**: `sweepTraegerFuerProfil` (A5) und `INBOUND_KOSTENPROFILE` (A6) kennen das neue Profil.
- **Tests**: neue Datei mit 10 Faellen (IE3-1..IE3-8, Cluster fuer IE3-4) + IE3-7 in der Bestandsdatei `env-docs-spend-cap-coherence.test.js`.
- **Verifikation**: `node --check` auf allen geaenderten Dateien gruen; Regressionsbank 6010/6010 gruen (1 bekannter Parallelitaets-Flake beim ersten Lauf, isoliert gruen); `npm run lint` 0 Fehler; Smoke in beiden Schalterrichtungen mit byte-identischem TeXML.

### Deviations

1. **Bestandstest angepasst (zwingend, nicht im Plan):** `test/config-namespaces.test.js` — Zaehl-Pin `voice` 18→19, Summe 193→194, wegen des neuen gruppierten Config-Schluessels. Ohne diese Anpassung ist `npm test` rot; reiner Loeschschutz-Test, kein Verhaltenstest.
2. **Testzahl:** 11 statt 10 geplante Faelle (IE3-4 wurde als Cluster IE3-4/-4b/-4c/-4d gebaut) — inhaltlich deckungsgleich mit T1-T8.
3. **`npm test`-Flag-Handling:** `--test-concurrency=4` wird von `npm test` nicht direkt durchgereicht (Trenner-Problem in `testbaenke-run.mjs`); gemessen wurde stattdessen direkt mit `node test/testbaenke-run.mjs regression -- --test-concurrency=4`.
4. **Lokaler Symlink-Fix:** ein vorgegebener `ln -s ./node_modules node_modules` zeigte auf sich selbst (ELOOP) und liess den pre-commit-Lint-Hook scheitern; durch einen absoluten Symlink auf das Haupt-Checkout ersetzt (gitignored, nicht committet).
5. **`npm run test:gates` rot mit 3 Faellen** (GAP-05, GAP-15, E2E-03 Sprachumstellung) — alle in von dieser Phase nicht beruehrten Dateien (Stripe-Checkout, Rechtsseiten, Sprachumschaltung); als offene Produktbefunde eingeordnet, kein Master-Referenzlauf gefahren (Zuordnung ueber Dateipfade, nicht ueber Vorher-Messung).
6. **IE1/F-D bleibt ungemessen** — Folge im Code benannt: `PFLICHTTYPEN_UNGEMESSEN` → `istVollBelegt` bleibt fuer dieses Profil falsch → keine Erstattung auf diesem Weg, bis die Messung vorliegt.
7. **H1-H5 bewusst NICHT gebaut** (Auflagen an IE5/IE1): keine `recordCostProfile`-Zeile, kein Einsammler-Umbau in `el-reifung.js`, kein zweiter WARN-Befund.

## Safety-Urteil

**PASS (mit Auflagen fuer IE5).** Diff 12 Dateien schmal, keine absolute Regel beruehrt: kein Safety-Gate angefasst (Kostendecke, Denylist/Land-Gate/Stundenlimit, Max-Dauer, Verifikations-Permit, `OUTBOUND_FROZEN`, Ed25519-Signaturpruefung liegen ausserhalb des Diffs), `src/claude.js`/`src/bridge.js` unberuehrt (Offenlegungssatz unveraendert), keine Route/`route-policy.js`/Auth-Datei/MCP-Pfad/Audio betroffen, keine neue npm-Dependency, keine Secrets im Diff.

Selbst durchgefuehrte unabhaengige Verifikation: Regressionsbank 6010/6010 gruen inkl. aller 11 IE3-Faelle; Registry-Drift master-gegen-Branch gemessen ("KEINE Abweichung am Bestand" ausser dem neuen Profil); Boot-Riegel am echten Prozess in BEIDEN Richtungen belegt (Flag aus → OK; Flag an mit Katalogzeile → OK; Negativkontrolle mit Traegern auf `nicht_belegpflichtig` → Prozess bricht mit exit 1 und der erwarteten FATAL-Meldung ab); Geld-Fail-closed am Code nachvollzogen (`classifyRecords`: leere Pflichtmenge kann nie vakuos "vollstaendig" werden).

**Concerns (kein Blocker fuer IE3, Auflagen an IE5):**
- Der Boot-Riegel beweist nur eine KATALOG-Behauptung, keinen laufenden Einsammler — ohne IE5s `recordCostProfile`-Zeile fallen neue Inbound-Anrufe ueber `legacyKostenprofil` auf `telnyx_inbound_budget` zurueck, dessen einziger Pflicht-Traeger `telnyx_call_records` ist; die EL-Anbieterkosten waeren dann unsichtbar ("Flag an, Kosten unsichtbar" — genau der Fall, den die Phase strukturell ausschliessen wollte, aber nur solange kein Schreiber existiert).
- Die KV2-4-Einsammler-Behauptung ist heute nur halb gedeckt: `el-reifung.js` und `nachlauf-phasenschnitt.js` filtern hart auf `EL_CONVAI_SIP`, der KV2-4-Schreiber legt zusaetzlich unbedingt eine `telnyx_sip`-Zeile an (kein Pflicht-Traeger bei diesem Profil) — muss IE5 nachziehen. Richtung ist konservativ (keine Erstattung, kein Geldabfluss).
- Zwei geaenderte Dateien (`sweep-kostenbeleg.js`, `cost-calibration.js`) lagen ausserhalb der urspruenglich genannten Dateiliste — je ein Set-Eintrag ohne Wirkung auf Bestand, aber Ausweitung der deklarierten Liste.
- Boot-Log traegt bei Flag AUS zusaetzlich eine harmlose `tarifpaar_zu_wenig_proben`-Zeile fuer die neue Route (nur UNTERSCHAETZUNG waere alarmfaehig) — "Flag aus = byte-identisch" gilt fuer die Buchhaltung, nicht fuer jede Log-Zeile.
- Die Gegenprobe "Schalter an ohne Einsammler → exit(1)" fehlt in der automatisierten Suite (nur an der reinen Funktion getestet) und wurde nur manuell in der Safety-Review nachgeholt.

## Clean-Code-Audit (S1-S4)

- **S1:** keine Funde.
- **S2:** ein Grenzfall — der neue `if(enabled && !hasCollector)`-Block in `boot-guard.js` wiederholt die Form des direkt darueberstehenden `REALTIME_CARRIER_UNCOLLECTED`-Blocks. Als Fortsetzung eines bereits etablierten Musters (3./4. Instanz) eingeordnet, kein neues Duplikat — kein Blocker. Optionaler Fix bei einem 5. Fall: kleine Factory `fatalCollectorFinding(...)`.
- **S3:** positiv vermerkt — `elInboundPflichtTraeger` als benanntes Zwischenergebnis (G19) vorbildlich; neue Bezeichner folgen exakt dem Namensschema der Nachbarfelder (G11-konform).
- **S4:** keine Struktur-/Anzahl-Verstoesse; alle neuen Elemente (Registry-Zeile, Traeger-Eintrag, Boot-Befund, Config-Namespace-Eintrag) minimal und 1:1 nach Vorbild.

**Verdict: PASS.** Fail-closed durchgaengig (kein Env-Trostpreis, kein Traeger ohne Messung), G5-Disziplin aktiv gelebt (Kohaerenztest zitiert explizit die drei bestehenden Leser statt einer vierten Kopie), `test-base-env-drift`-Lehre befolgt, alle Blueprint-Dreiklaenge synchron und getestet, Reuse statt Neuerfindung. 24/24 neue Tests gruen, keine Regressionen in 55 einschlaegigen Billing-Tests. Kein `eslint-disable`, keine Umlaute in Kommentaren, keine Magic Numbers ohne Konstante.

**topTodos (nicht blockierend):** Helper-Extraktion erst bei einem 5. gleichartigen Boot-Befund; vor IE5 sicherstellen, dass F-D tatsaechlich gemessen wird, bevor `TELNYX_SIP` dem Profil hinzugefuegt wird.

## Fix-Runden

Keine — der Plan wurde ohne Fix-Runde direkt PASS bewertet (Safety PASS mit Auflagen fuer IE5, Clean-Code PASS ohne Blocker). Der einzige gefundene S2-Punkt wurde als bewusst kein Blocker eingestuft (Musterfortsetzung statt Neuduplizierung).
