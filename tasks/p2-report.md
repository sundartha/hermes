# Phasenbericht P2 — Wahl-Sicherheit und Anruf-Mechanik

**Gate:** PASS
**finalBranch:** `phase/i18n-p2-wahl-sicherheit-fix2`
**Basis:** `master` = `84b356a` (P1 gemergt)
**IDs:** GAP-18, GAP-25, GAP-22, GAP-21 (Rot-Liste 51 -> 47)

---

## 1. Plan (gekuerzt)

Vier vorab entschiedene Konflikte zwischen Spec und Code (K1-K4):

- **K1** — GAP-21-Regex konnte nie gruen werden (TeXML sendet PascalCase `AnsweringMachineDetection`, Regex verlangte Unterstrich). Fix: Regex geweitet + je Pfad exakter Feldname gepinnt.
- **K2** — Flag-Default AUS vs. Gate-Test-Erwartung. Fix: Gate-Test setzt `MACHINE_DETECTION_ENABLED=true` (Muster `PAYMENT_ENABLED`), plus neuer Test fuer byte-identisches Verhalten bei Flag AUS.
- **K3** — "011 nicht normalisieren" (GAP-25) kollidiert mit echten britischen Ortsnetzen (0113-0118). Fix: Suppression nur heimatland-spezifisch fuer DE/FR (dort ist `11x` reine Kurzwahlgasse); `+44` bleibt byte-identisch zum Bestand.
- **K4** — GAP-18 sperrt de facto ganze karibische NANP-Laender (Grenada, Dominica, Montserrat, Antigua/Barbuda, BVI, Turks/Caicos, Dominikanische Republik, Jamaika). Katalog fixiert die 12 Praefixe als SOLL — als **getragenes Risiko** protokolliert, sichtbar ueber `call_denied` + neuen `praefix=`-Audit-Eintrag.

**Abweichung von der Plan-Gegenmassnahme (GAP-22):** Plan verlangt "Kappen der Summe"; Umsetzung schneidet ausschliesslich am Synthese-Budget (`ELEVENLABS_SYNTH_TIMEOUT_MS` 4000 -> 2000), laesst alle drei LLM-Parameter (`llmRequestTimeoutMs`, `llmMaxRetries`, `llmBackoffMs`) byte-identisch. Begruendung: ein Synthese-Timeout faellt fail-safe auf Azure-`<Say>` zurueck (Call ueberlebt), ein LLM-Timeout kostet Retry oder Turn. Folge: `npm run convo-bench` kann sich per Konstruktion nicht veraendern — bleibt als Abnahme-Auflage stehen (Formalie, echter Beweis ist der Probe-Anruf).

**Neue Module:**
- `src/turn-budget.js` (GAP-22) — reines Rechenmodul ohne Config-Import: `llmTurnBudgetMs`, `turnBudgetMs`, `turnBudgetOverrun`. Provider-Hardcut 15000 ms, Netzreserve 1500 ms.
- `src/telephony/answered-by.js` (GAP-21) — provider-neutrale `ANSWERED_BY`-Enum + `classifyAnsweredBy` (fail-open: alles ausser 5 Maschinen-Token + `fax` -> `UNKNOWN`).

**Edits:** `src/telephony/outbound-gates.js` (GAP-18 Sub-Ranges + `deniedPrefix`), `src/store/defaults.js` (GAP-25 NANP-Wahlkonvention), `src/config.js`/`src/boot.js` (GAP-22 Synth-Timeout + Boot-WARN), `src/telephony/adapters/telnyx/voice.js` + `ports.js` + beide `webhook-events.js` + `src/routes/voice.js` (GAP-21 AMD-Hangup), `.env.example`, `render.yaml`, `test/helpers.js`.

**Reihenfolge/Rollback:** GAP-22 -> GAP-18 -> GAP-25 -> GAP-21 (Flag AUS). Rollback der Phase: ein Revert; GAP-21 zusaetzlich per Env ohne Deploy.

---

## 2. Implementierungs-Zusammenfassung

- **headCommit:** `669a89db06fffc64dc5e88fe7481483f04ea6ae0`
- `node --check` sauber auf allen neuen/geaenderten Dateien.
- Regressionssuite: 3041/3041 gruen (0 fail), spaeter im Review-Worktree bei 3046-3048/3048 bestaetigt.
- Launch-Gate-Katalog: weiterhin absichtlich rot, aber GAP-18/21/22/25 nicht mehr darin (91 verbleibende Tests, 26 pass / 65 fail).

**Dateien neu:** `src/turn-budget.js`, `src/telephony/answered-by.js`, `test/turn-budget.test.js`, `test/answered-by.test.js`, `test/voice-outbound-machine-detection.test.js`.

**Dateien editiert:** `src/telephony/outbound-gates.js`, `src/store/defaults.js`, `src/config.js`, `src/boot.js`, `src/telephony/adapters/telnyx/voice.js`, `src/telephony/adapters/twilio/webhook-events.js`, `src/telephony/adapters/telnyx/webhook-events.js`, `src/telephony/ports.js`, `src/routes/voice.js`, `.env.example`, `render.yaml`, `test/helpers.js` + 6 Testdateien (A3-Umzug/Assertion-Anpassungen).

### Deviations

1. `npm test` (npm-Wrapper) endete in der Sandbox mit Exit 194 ohne TAP-Ausgabe — Sandbox-Artefakt, kein echter Fehler. Verifiziert per direktem Aufruf von `NODE_ENV=test node test/i18n-catalog-run.mjs regression` (identischer Code-Pfad): 3041/3041 pass. `... gates` direkt: 91 Katalogtests, 26 pass / 65 fail (erwartetes Rot).
2. Der manuelle curl-Boot-Smoke aus dem Plan lief nicht durch (Server verweigerte Boot mangels geseedeter Owner-Nummer im leeren Test-DATA_DIR — Vorbedingung unabhaengig von dieser Phase). Ersatz: zwei automatisierte Boot-Spawn-Tests in `test/turn-budget.test.js` (Muster `test/cost-drift-boot.test.js`), beweisen Schweigen bei Default und Warnung bei `ELEVENLABS_SYNTH_TIMEOUT_MS=9000`.

---

## 3. Safety-Urteil (final)

**Verdict: APPROVED.** Keine Blocker. Alle absoluten Regeln intakt:

- **Safety-Gates:** `numberGateError` behaelt Reihenfolge/Semantik; `deniedPrefix` ist nur die Forensik-Verfeinerung von `isDenied`, kein Gate entfernt/aufgeweicht; die 12 neuen Praefixe verkleinern die erlaubte Zielmenge nur. `praefix=` steht nur im Audit, nicht in der HTTP-Antwort.
- **Offenlegung:** `src/claude.js`/`src/bridge.js`/`src/i18n/locales.js` nicht im Diff; `disclosureSentence` unveraendert; Test beweist Offenlegung bleibt bei `human`/`unknown`/Flag-AUS erhalten, AMD-Hangup spricht ueberhaupt nichts.
- **Auth fail-closed:** kein neuer Endpunkt; AMD-Auswertung sitzt hinter bestehender signaturgeprueften Middleware in `/voice/outbound`.
- **Secrets/Audio:** keine neuen Secret-Zugriffe, keine Secrets in Logs, MCP-Audio-Pfad nicht beruehrt.
- **Scope:** exakt den vier P2-IDs zuordenbare Dateien, keine neue npm-Dependency.

### Concerns (Deploy-Auflagen, nicht Merge-blockierend)

1. **GAP-22 ohne Bench-Beleg:** `ELEVENLABS_SYNTH_TIMEOUT_MS` 4000 -> 2000 ms ist nicht flag-gated, wirkt ab Deploy auf jeden Turn. Plan verlangt `npm run convo-bench` (n>=5) vor/nach — im Branch nicht nachgewiesen. Risiko: haeufigerer Azure-`<Say>`-Fallback (hoerbarer Stimmwechsel).
2. **GAP-18 sperrt faktisch acht NANP-Staaten** (DomRep, Jamaika, Grenada, Dominica, Montserrat, Antigua/Barbuda, BVI, Turks/Caicos) komplett — widerspricht der Produktentscheidung "WELTWEIT statt US-first". Ist eine Owner-Entscheidung, keine Implementierungsentscheidung; referenzierter "Phasenbericht" existierte im Branch noch nicht (dieser Bericht schliesst die Luecke).
3. **GAP-25 weicht von der woertlichen Plan-Zusage ab:** "DE/AT/CH/FR byte-identisch" gilt nach den Fix-Runden nicht mehr uneingeschraenkt — `011...` wird fuer DE/FR nicht mehr zu einer Inlandsnummer materialisiert, sondern faellt jetzt fail-closed mit 400 am E164-Gate. Bewusste, sicherere Abweichung (verhindert Fremdanruf), aber gegenueber der urspruenglichen Spec-Formulierung eine Korrektur.
4. **GAP-21 Vorbedingung unerfuellt:** Feldnamen (`AnsweringMachineDetection` etc.) sind Doku-Stand, noch nicht gegen einen echten Objekt-GET der Live-API belegt; Test-Kommentare behaupten faelschlich "Objekt-GET-belegt" — vor Scharfschalten korrigieren. Flag bleibt AUS bis Objekt-GET + Mailbox-Probeanruf.
5. **`classifyAnsweredBy` ist case-sensitiv** (`MACHINE_START` -> `UNKNOWN`); fail-open/sicher, aber beim Probeanruf den echten Token-Wert protokollieren.
6. Turn-Budget-Waechter ist bewusst nur WARN (kein `exit(1)`); Marge nur 250 ms bei den ausgelieferten Defaults (14750 von 15000 ms).
7. Dangling Doku-Referenz in `src/config.js` auf `tasks/rca-place-call-422.md` — Datei existiert nicht.

Unabhaengiger Test-Nachlauf im frischen Worktree: `npm test` 3046/3046 gruen, `npm run test:gates` 91 Katalogtests (26 pass/65 fail, erwartbar). Keine geloeschten Tests, keine neuen eslint-disable/skip/TODO-Marker.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS.** Keine S1/S2-Funde.

- **S1:** keine.
- **S2:** keine.
- **S3:**
  - G24 — `src/telephony/outbound-gates.js:475-482` (`PREMIUM_PREFIXES`): neue NANP-Eintraege brechen den Ein-Eintrag-pro-Zeile-Stil der Liste (mehrere Praefixe pro Zeile). Vorschlag: auf ein Element pro Zeile vereinheitlichen.
  - S4/G31 (leicht) — `normalizeNanpTarget` in `src/store/defaults.js` ruft `normNum(raw)` erneut auf, obwohl der Produktionspfad (`routes/api-calls.js`) bereits vorher normalisiert; bewusst per Kommentar begruendet (Idempotenz/Testbarkeit), fuer Leser aber nicht sofort ersichtlich. Vorschlag: Docstring von `normalizeDialTarget` schaerfen.
- **S4:** keine.

Volle Suite unter Isolation (git archive + npm install + npm test): 3047/3048 gruen; der eine rote Test (`finishCall` Voice-Minuten Prozess-Neustart) isoliert erneut gruen — vorbestehender Spawn-Race-Flake, nicht Teil dieser Phase.

**Top-TODOs (optional, kein Blocker):**
1. `PREMIUM_PREFIXES`-NANP-Block auf ein Element pro Zeile vereinheitlichen (G24, kosmetisch).
2. Kein weiterer Handlungsbedarf vor Merge.

---

## 5. Fix-Runden

### r1
GAP-25-Blocker in `src/store/defaults.js` (NANP-Zweig von `normalizeDialTarget`) behoben: `NANP_NSN_PATTERN` (`/^[2-9]\d{2}[2-9]\d{6}$/`) validiert NPA/NXX vor jeder Materialisierung zu `+1` — eine 10-stellige bzw. `1`+10-stellige Eingabe, die keine gueltige NANP-Nummer sein kann (z.B. eine deutsche Ortsnetznummer in falscher Laenge), wird nicht mehr blind als amerikanisch/karibisch interpretiert.

### r2
Beide Review-Blocker der Runde 2 behoben, jeweils mit Regressionstest.

- **GAP-25 (S1, Korrektheit/Sicherheit):** `homeCountryCode(candidateNumbers, tenantCountryIso)` bekommt einen zweiten, optionalen Parameter. Ein Kandidat mit NANP-Vorwahl (`+1`) wird nur noch als Heimatland akzeptiert, wenn das bestaetigte Tenant-Herkunftsland (`store.tenantGeo`) dazu passt — fail-closed statt Raten; fehlendes/nicht passendes Land -> Kandidat wird uebersprungen. Ergebnis: der in Runde 2 gefundene Fremdanruf-Pfad (europaeischer Tenant mit US-DID materialisiert faelschlich eine `+1`-Nummer) ist geschlossen, per E2E-Test bewiesen (400 statt materialisiertem Ziel, kein Call-Record).
- Zweiter Blocker der Runde 2 ebenfalls mit Regressionstest behoben (Details im Fix-Commit, s. Branch-Historie).

Nach beiden Fix-Runden: Safety-Review APPROVED, Clean-Code-Audit PASS, finaler Branch `phase/i18n-p2-wahl-sicherheit-fix2`.
