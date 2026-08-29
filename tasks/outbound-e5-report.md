# OUTBOUND-E5 (F3) — Detailbericht: Absender-Wahrheit + je DID eine EL-Registrierung

Status: **BLOCKED** (Safety-Verdikt: BLOCKIERT, Clean-Code: FAIL — beide inzwischen in Fix-Runden bearbeitet)
finalBranch: `phase/outbound-e5-absender-did-v2-fix3`
Basis: `master` @ `531efdf`

---

## 1. Was die Phase behebt

Der Outbound-Anrufstart ueber ElevenLabs (der heute live laufende Weg) sendete als
Absendernummer eine EINZIGE globale Env (`ELEVENLABS_AGENT_PHONE_NUMBER_ID`) fuer ALLE
Tenants. Ein Rueckruf des Angerufenen landete dadurch beim Besitzer jener globalen Nummer,
nicht beim tatsaechlichen Auftraggeber — ein Datenschutz-/Zuordnungs-Defekt.

Diese Phase macht zwei Dinge:

1. **Absender-Korrektur:** der Outbound sendet wieder die DID des anrufenden Tenants. Dafuer
   braucht jede Tenant-DID eine EIGENE ElevenLabs-SIP-Registrierung (`phone_number_id`),
   weil der EL-Anrufstart (`POST /v1/convai/sip-trunk/outbound-call`) kein Absenderfeld
   kennt — die gesendete Nummer haengt ausschliesslich an der gewaehlten Registrierung
   (`agent_phone_number_id`).
2. **Wahrheits-Buchfuehrung:** der Store schreibt zusaetzlich zur SOLL-Nummer (`from_e164`,
   Bestand) auch, was tatsaechlich passiert ist — welche Registrierung benutzt wurde und was
   der Anbieter als gesendet meldet.

---

## 2. Die Absenderkette je Engine-Zweig — vorher/nachher

Gemeinsamer Kopf (unveraendert, alle drei Zweige): `place_call` (MCP) -> `POST /api/calls` ->
Gate-Kette -> `resolve_outbound` (`telephony/outbound-gates.js`) loest `ctx.fromNumber` aus
der TENANT-GEFILTERTEN aktiven Nummer auf (`findActiveNumber`, `store/views.js`) ->
`store.createCall({from: ctx.fromNumber, ...})`. Diese Kette war und bleibt korrekt.

**Zweig A — TeXML (Budget-Engine):** `originateCall({from: ctx.fromNumber})` reist unveraendert
als Port-Parameter durch, keine ani_override auf dieser Connection.
Vorher/nachher: **unveraendert.** Angerufener sieht `ctx.fromNumber` — korrekt, schon vorher.
Buchfuehrungs-Feld bleibt bewusst `unknown` (siehe Abschnitt 4, "benannte Auslassung").

**Zweig B — C-Telnyx Call Control:** `originateAiAssistantCall({fromNumber: ctx.fromNumber})`
reist unveraendert durch. Vorher/nachher: **unveraendert im Senden**, neu ist nur eine additive
Buchfuehrungszeile (`store.recordActualSender(call.id, {e164: fromNumber, source: "tenant_did"})`
in `src/telnyx-origination.js`) — Struktur-Beleg (keine ani_override auf dieser Connection),
keine Anbieter-Messung.

**Zweig C — ElevenLabs (Live-Weg):**
- Vorher: `agent_phone_number_id: el.agentPhoneNumberId` — eine globale Env fuer alle Tenants.
  Angerufener sah die Nummer der globalen Registrierung; bei aktivem Telnyx-`ani_override`
  wurde das zusaetzlich ueberschrieben (siehe Abschnitt 6).
- Nachher: `agent_phone_number_id: agentPhoneNumberId`, aufgeloest genau EINMAL ueber die
  reine Funktion `waehleAbsenderRegistrierung` (`src/telephony/absender-registrierung.js`),
  gespeist aus derselben tenant-gefilterten `numberRecord`-Quelle wie `resolve_outbound`.
  `el.agentPhoneNumberId` ist jetzt nur noch Rueckfall-Argument und Konfig-Pflichtpruefung
  (`assertConfigured`), kein Sende-Feld mehr.

---

## 3. Die drei neuen Buchfuehrungs-Felder

Bewusst drei getrennte Felder statt Wiederverwendung, weil sie drei verschiedene Fragen
beantworten (Repo-Regel: nie zwei Sachverhalte auf ein Label):

| Feld | Frage | Wann geschrieben |
|---|---|---|
| `call.from_e164` (Bestand) | Welche Nummer WOLLTEN wir senden? | `createCall` |
| `call.from_registration_source` (neu) | Eigene DID oder globaler Rueckfall benutzt? | EL-Anrufstart, set-once |
| `call.from_actual_e164` + `call.from_source` (neu) | Was meldet der Anbieter als gesendet? | nur bei Beleg, set-once |
| `number.provider_agent_phone_number_id` (neu) | Welche EL-Registrierung gehoert zu dieser DID? | Provisioning/Backfill |

Formpruefung: `recordActualSender` schreibt nur bei bestandenem E.164-Praedikat — die
Bestands-Fixture mit maskiertem Anbieter-Token (`"***0177#1ca0c7"`) wird verworfen statt als
Rueckrufnummer gespeichert (Test T1, per Sabotage bestaetigt: ohne die Pruefung landet der
maskierte String im Feld).

Additiv-nullable, **kein Backfill fuer die Call-Felder** — begruendet: fuer jede Bestandszeile
ist NULL der wahre Wert, `from_e164` dorthin zu kopieren waere die Behauptung, die diese
Phase abstellt.

---

## 4. Der Rueckfall — und wie er sichtbar ist

Greift `waehleAbsenderRegistrierung` nicht (keine aktive Nummer / Nummer weicht von `from`
ab / keine eigene Registrierung), faellt der Anrufstart auf die globale Env zurueck — **laut,
nie still**, auf drei unabhaengigen Wegen:

1. **Log:** `[el-outbound] Absender-Rueckfall (call=...): grund=<Grund-Code>` — die Rufnummer
   selbst steht nicht im Log.
2. **Metrik:** `metrics.logSenderFallback({grund})` — PII-frei, Whitelist wie `logCallDenied`,
   nur der Grund-Code, nie Rufnummer/tenantId/callId.
3. **Datensatz:** `call.fromRegistrationSource === "rueckfall_global"`.

Benannte Rueckfall-Gruende (`ABSENDER_QUELLE`/`RUECKFALL_GRUND`, PII-frei): `keine_aktive_nummer`,
`nummer_weicht_von_from_ab`, `keine_eigene_registrierung`.

Der Rueckfall selbst bleibt Bestandsschutz: `ELEVENLABS_AGENT_PHONE_NUMBER_ID` bleibt
Konfig-Pflicht, damit ein Anruf ohne eigene Registrierung ueberhaupt noch stattfindet.

---

## 5. Tenant-Isolation

Zwei unabhaengige Riegel, beide per Sabotage-Gegenprobe bestaetigt:

1. **Tenant-Filter:** `numberRecord` kommt aus `findActiveNumber(state, call.tenantId)` —
   tenant-gescoped, dieselbe Quelle wie `resolve_outbound`.
2. **Strikte E.164-Identitaet:** `numberRecord.e164 === fromE164` (strikte String-Gleichheit,
   kein Praefix, kein Fuzzy) — pinnt zusaetzlich, dass die Registrierung zu genau der Nummer
   gehoert, die als `from_e164` am Anruf gebucht wurde.

Eine fremde Registrierung ist damit auf zwei unabhaengigen Wegen unerreichbar. Getestet:
Fall A6 (rein, Datensatz von Tenant B / `from` von Tenant A -> Rueckfall) und Fall B2 (ueber
die echte HTTP-Route: Tenant B ohne eigene Registrierung ruft an, waehrend Tenant A eine hat
-> Rueckfall, ausdruecklich `notEqual` zu Tenant As Kennung).

---

## 6. Die Drift-Ausnahme-Entscheidung

Bestehender Eintrag `config_ani_mismatch` in `outbound-drift-ausnahmen.json` behauptete
urspruenglich, der Befund entfalle "sobald je Tenant-DID eine eigene EL-Registrierung angelegt
wird". Das ist **am Code widerlegt** und wurde korrigiert: Pruefung 5 des Drift-Waechters
(`outbound-config-drift.js#pruefeAniUebereinstimmung`) vergleicht `N_el` ausschliesslich gegen
`soll.elPhoneNumberId` — das ist `config.voice.elevenLabsOutbound.agentPhoneNumberId`, die
GLOBALE Rueckfall-Env. Pro-DID-Registrierungen betreten diese Pruefung nicht und koennen den
Befund weder schaerfen noch aufloesen.

Korrigierte Entscheidung: der Eintrag bleibt bestehen (`seit` unveraendert, derselbe
Sachverhalt) und faellt erst mit dem Owner-Cutover — `ani_override` geleert UND die globale
Rueckfall-Registrierung auf eine kontoeigene Nummer gezogen. Verweis im Eintrag auf
`docs/RUNBOOK-OUTBOUND.md`, Abschnitt "ANI-Cutover".

Grund, warum der Eintrag jetzt (mit dieser Phase) nicht einfach entfernt wird:
`ELEVENLABS_NUMBER_REGISTRATION_ENABLED` steht Default aus — nach dem Merge existiert null
Pro-DID-Registrierung, die Abweichung ist unveraendert. Ein sofortiges Entfernen des Eintrags
haette den stuendlichen Drift-Waechter ab dem ersten Lauf dauerhaft rot geschaltet.

---

## 7. Der exakte Owner-Cutover bei Telnyx (NICHT ausgefuehrt, Owner-Aktion)

**Endpunkt:** `PATCH https://api.telnyx.com/v2/fqdn_connections/3026479542865757220`
(die SIP-Trunk-FQDN-Connection "ElevenLabs Spike2").

**Feld:** `outbound.ani_override` — von der heutigen Owner-Workaround-Nummer auf `""` (LEER)
setzen. **Nicht** `ani_override_type` aendern: das Enum kennt keinen Aus-Wert
(`["always","normal","emergency"]`, Default `always`); Telnyx-Doku woertlich "Only applies
when ani_override is not blank" — am Live-Konto per GET bestaetigt (2026-08-29). Der einzige
belegte Ausschalter ist der leere Wert.

Ist-Stand (GET, 2026-08-29): `ani_override_type:"always"` ueberschreibt jede von ElevenLabs
gesendete Nummer — belegt durch das Experiment `call_mtd0acq2hq4q` (EL-Registrierung trug
`+15739090177`, Override zog auf die Owner-Nummer, Anruf lief 29s durch). Solange dieser
Override auf `always` steht, ist der neue Code fuer den Angerufenen folgenlos.

**Reihenfolge / harte Vorbedingungen (V1-V4), alle vier gleichzeitig noetig:**

| # | Vorbedingung | Warum zwingend |
|---|---|---|
| V1 | `ELEVENLABS_NUMBER_REGISTRATION_ENABLED=true` + SIP-Zugangsdaten deployed | ohne Schalter entstehen keine Pro-DID-Registrierungen |
| V2 | Owner-Pilot: eine Nummer registrieren, Testanruf, Rechnung pruefen | schliesst drei UNBELEGTE Anbieter-Fragen (INVITE-From, `inbound_trunk_config` optional, Registrierungskosten/Limit) |
| V3 | Jede aktive DID hat eine Registrierung (`npm run elevenlabs:nummern -- --pruefen` -> Exit 0) | sonst faellt jede unregistrierte DID auf den globalen Rueckfall |
| V4 | Die globale Rueckfall-Registrierung traegt eine KONTOEIGENE Nummer, nicht mehr die freigegebene `+15739090177` | **ohne V4 endet jeder Rueckfall-Anruf nach dem Cutover in SIP 403 D51** — heute maskiert der Override das noch |

**Rueckbau — eine Zeile, sofort wirksam, kein Deploy:**
```
PATCH .../fqdn_connections/3026479542865757220
{"outbound":{"ani_override":"<Owner-Nummer>","ani_override_type":"always"}}
```
Zweite, unabhaengige Rueckbau-Achse (Code-Seite, sofort nach Neustart wirksam):
`ELEVENLABS_NUMBER_REGISTRATION_ENABLED=false`.

Danach (erst nach dem Cutover): Eintrag `config_ani_mismatch` aus
`outbound-drift-ausnahmen.json` entfernen.

---

## 8. Abnahmepunkte — einzeln, Urteil + Kommando

Alle 17 Punkte laut Report-Doku selbst nachgefahren (nicht nur uebernommen), zusaetzlich vom
Safety-Reviewer unabhaengig nachgefahren.

| # | Kommando | Ergebnis / Urteil |
|---|---|---|
| 0 | `npm run test:gates` auf `master`@531efdf | ERFUELLT — 3 rote Faelle (GAP-05, GAP-15, E2E-03), Baseline |
| 1 | `node --test test/absender-registrierung.test.js` | ERFUELLT — pass 7 fail 0 |
| 2 | `node --test test/absender-el-registrierung.test.js` | ERFUELLT — pass 6 fail 0 |
| 3 | `node --test test/absender-registrierung-anlegen.test.js` | ERFUELLT — pass 6 fail 0 |
| 4 | `node --test test/absender-wahrheit.test.js` | ERFUELLT — pass 8 fail 0 |
| 5 | `node --test test/absender-registrierung-freigabe.test.js` | ERFUELLT — pass 5 fail 0 (F1-F4 + Positiv-Kontrolle) |
| 6 | `node --test test/absender-wahrheit-pg.test.js` | ERFUELLT — pass 3 fail 0, PGlite-Rundlauf, kein skip |
| 7 | `node --test test/scripts-config-namespace.test.js` | ERFUELLT — pass 7 fail 0 |
| 8 | `node --test test/outbound-gates-order.test.js` | ERFUELLT — pass 31 fail 0, Gate-Kette unveraendert |
| 9 | `node --test test/outbound-drift-kern.test.js test/check-outbound-drift-script.test.js` | ERFUELLT — pass 28 fail 0 |
| 10 | `npm test` | ERFUELLT mit Anmerkung — 5396/5397 bzw. spaeter 5416/5420 gruen; verbleibende Rot-Faelle isoliert als Suite-Flakes/Bestandsbefunde bestaetigt (nicht E5) |
| 11 | `npm run test:gates` auf dem Branch | ERFUELLT — dieselben 3 roten Faelle, nicht mehr |
| 12 | `npm run lint` | ERFUELLT — 0 Fehler, 65 Bestands-Warnungen |
| 13 | eslint auf `src/store/pg.js` | ERFUELLT mit Konzern — `hydrateTenantInto` 117->102 (gesenkt), `makePgStore` 562->563 (angehoben, dokumentiert) |
| 14 | eslint auf `api-calls.js`/`state-ops.js` | ERFUELLT — byte-identisch zum Ist-Stand (243/136/22 bzw. `createCall` 14) |
| 15 | `npm run elevenlabs:nummern` ohne Schluessel | ERFUELLT — Exit 1, fail-closed |
| 16 | `grep -c "OUTBOUND-E5" PLAN-SECURITY.md` | ERFUELLT, aber Inhalt war zeitweise FALSCH (siehe Blocker, Abschnitt 9) |
| 17 | `grep -c "ANI-Cutover" docs/RUNBOOK-OUTBOUND.md` | ERFUELLT — Abschnitt vorhanden |

---

## 9. Gegenproben — woertlich

**Sabotage 1 (Absenderwahl):** `agent_phone_number_id: agentPhoneNumberId` in
`src/elevenlabs/outbound.js` zurueck auf `el.agentPhoneNumberId` gedreht.
Ergebnis: `"B1 ... AssertionError: actual: 'phnum_global_test', expected: 'phnum_tenant_a'"`.
Zurueckgebaut, wieder gruen, `git status --porcelain` leer.

**Sabotage 2 (Tenant-Isolation):** Zeile `if (numberRecord.e164 !== fromE164) return
rueckfall(...)` in `src/telephony/absender-registrierung.js` entfernt.
Ergebnis: `"A4 ... actual:'tenant_did', expected:'rueckfall_global'"` UND
`"A6 Tenant-Isolation ... actual 'phnum_tenant_b' unerlaubt gleich expected"`.
Zurueckgebaut, wieder gruen.

**Sabotage 3 (Formpruefung Buchfuehrung):** `E164.test(e164)`-Pruefung in
`recordActualSender` (`state-ops.js`) entfernt.
Ergebnis: `"T1 ... actual:'***0177#1ca0c7' expected:null"` — der maskierte Anbieter-String
waere sonst als Rueckrufnummer gespeichert worden.
Zurueckgebaut, wieder gruen.

**Sabotage 4 (Idempotenz-Schloss):** `if (!sipRegistrar || number.providerAgentPhoneNumberId)
return;` in `registriereNummerFailSoft` (`src/onboarding.js`) auf `if (!sipRegistrar)
return;` verkuerzt.
Ergebnis: `"C2 ... 2 !== 0"` — 2 Anbieter-Aufrufe statt der geforderten 0.
Zurueckgebaut, wieder gruen.

Nach jeder Sabotage: `git status --porcelain` leer bestaetigt.

---

## 10. Registrierungs-Lebenszyklus (inkl. Backfill)

| Phase | Wo | Gate | Idempotenz | Fehlerverhalten |
|---|---|---|---|---|
| Anlegen | `onboarding.js#provisionNumber` -> `registriereNummerFailSoft` -> `ensureRegistration` | Dreifach-Gate (`PROVISIONING_ENABLED` UND `ELEVENLABS_OUTBOUND_ENABLED` UND `ELEVENLABS_NUMBER_REGISTRATION_ENABLED`, alle Default aus) | Schloss 1 (Feld schon gesetzt -> 0 Aufrufe); Schloss 2 (GET-Liste enthaelt die e164 -> Kennung uebernehmen, 0 POSTs) | Wurf wird gefangen: DID bleibt `active`, Feld bleibt NULL, eine benannte Warn-Zeile |
| Speichern | `attachNumberRegistration` (set-once) | — | set-once | `store.save()` durch Drain-Aufrufer |
| Backends | pg: `rowToNumber`+`flushNumbers`; json: implizit | — | — | Round-Trip gegen echtes Postgres (PGlite) getestet |
| Auswaehlen | `waehleAbsenderRegistrierung` — rein, kein Netz | — | deterministisch | drei benannte Rueckfall-Gruende |
| Zurueckgeben | `release-reconcile.js#performNumberRelease`, nach Telnyx-DELETE | E1-Riegel entscheidet vorher unveraendert | `deletePhoneNumber` fail-soft, 404=erledigt | blockiert Freigabe nicht; Waise im Pruefmodus sichtbar |
| Nachholen | `scripts/el-nummern-registrierung.mjs` | derselbe Schalter, nie beim Boot | dieselbe `ensureRegistration`-Quelle | fail-closed: fehlender Schluessel -> Exit 1 |

**Backfill-Entscheidung:** Call-Felder (`from_actual_e164`, `from_source`,
`from_registration_source`) — kein Backfill, NULL ist fuer Bestandszeilen der wahre Wert.
`number.provider_agent_phone_number_id` — kein automatischer Backfill beim Boot (unbelegte
Registrierungskosten/-limits), stattdessen expliziter, manueller Reparaturlauf:
`npm run elevenlabs:nummern` (`--pruefen` Default, nur lesend; `--anlegen --ja-wirklich
[--nur=<numberId>]` fuer den Owner-Pilot mit einer Nummer).

---

## 11. Impl-Zusammenfassung + Deviations

Neue Dateien: `src/telephony/absender-registrierung.js` (rein, waehlt die Registrierung),
`src/elevenlabs/nummern-registrierung.js` (Netz/Lebenszyklus), `scripts/el-nummern-registrierung.mjs`
(Reparaturlauf), plus 6+ neue Testdateien (`test/absender-*.test.js`).

Wichtigste Deviation (offener Befund, dem Lead vorgelegt, nicht selbst behoben): die
Freigabe-Verdrahtung des EL-Registrars (`sipRegistrarWennAktiv`) erreichte in Runde 1
zunaechst nicht die echten Produktions-Aufrufer (`web-login.js`) — jede DID-Freigabe hinterliess
planmaessig eine Waise. In Runde 3 (E5-01) wurde das nachgezogen: `web-login.js`,
`billing/webhook.js`, `billing/contract-end-cleanup.js` reichen den Registrar jetzt durch,
belegt durch `test/e5-01-sipregistrar-produktionspfad.test.js`.

Weitere Deviations: `test/absender-wahrheit-pg.test.js` nutzt PGlite (staerker als geplant,
kein skip-Pfad); zwei eslint-Legacy-Pins wurden ANGEHOBEN (`makePgStore` 562->563,
`id-length 'r'` 23->24) — als Concern gemeldet, nicht verschwiegen; ein Rest-Fehlschlag im
vollen Testlauf isoliert als Flake bestaetigt.

---

## 12. Safety-Urteil

**Verdikt: BLOCKIERT**, ein einziger praeziser Blocker — die Substanz ist in Ordnung.

Bestaetigt (unabhaengig nachgefahren): eigene DID geht byte-genau raus; Rueckfall dreifach
laut; Tenant-Isolation zweifach geriegelt und per Sabotage rot gefahren; Idempotenz und
Fehlertoleranz; ehrliche Buchfuehrung (maskiertes Token -> NULL statt geraten); Dreifach-Gate
mit Default aus; nur-lesender Reparaturlauf; Owner-Cutover exakt beschrieben, nicht
ausgefuehrt; Telnyx-Zweige waehlen unveraendert; keine Safety-Gates, keine Offenlegung, kein
`callee_is_owner`, kein `bridge.js`, kein echter Anbieter-Schreibzugriff beruehrt.

**Blocker:** `PLAN-SECURITY.md` behauptete am damaligen HEAD, die Freigabe-Verdrahtung sei
"NOCH NICHT verdrahtet" und jede DID-Freigabe hinterlasse eine Waise — obwohl genau diese
Verdrahtung in Runde 3 bereits gebaut und getestet war. Sicherheitsregister behauptete ein
Risiko, das der Code bereits aufgeloest hatte.

Zwei weitere Concerns fuer Lead-Entscheidung (kein Blocker): zwei angehobene eslint-Pins;
doppelt implementiertes Dreifach-Gate (Provisioning-Orchestrator baut den Registrar inline
statt ueber die gemeinsame `sipRegistrarWennAktiv`-Naht zu gehen, obwohl deren eigener
Kommentar das Gegenteil behauptet).

---

## 13. Clean-Code-Audit

**Verdikt: FAIL** — 3x S1 (Blocker), 2x S2.

S1-Befunde:
1. Suppression-Ratsche gebrochen in `src/store/state-ops.js` (`attachNumberRegistration`
   fuegt eine 181. `id-length 's'`-Fundstelle hinzu, Legacy-Pin blieb bei 180 stehen) —
   `scripts/check-staged-suppressions.js` lehnte den Stand mit Exit 1 ab.
2. Neue, ungelistete Suppression in `src/onboarding.js` (`registriereNummerFailSoft`, siebte
   `id-length 's'`-Fundstelle in einer Datei ohne Legacy-Eintrag).
3. Das Dreifach-Gate ueber den einzigen kostenpflichtigen Anbieter-Schreibzugriff war
   ungetestet am tatsaechlichen Produktionspfad: die vier Gate-Tests pruefen
   `sipRegistrarWennAktiv`, das der Provisioning-Orchestrator nicht benutzt (er baute die
   Gate-Bedingungen inline noch einmal).

S2-Befunde: dieselbe Gate-Frage doppelt beantwortet (Orchestrator vs. `nummern-registrierung.js`,
bei widerlegtem Kommentar "kein zweiter Ort"); `fakeSipRegistrar`-Testattrappe wortgleich in
zwei Testdateien dupliziert statt geteilt.

S3/S4: kleinere Befunde zu PLAN-SECURITY.md-Drift (deckt sich mit dem Safety-Blocker),
`publicCall`-Feld-Strip-Inkonsistenz, Vermischung von Auswahl/Nebeneffekt in
`absenderFuerAnruf`, Vokabular-Kollision zweier `"tenant_did"`-Literale in getrennten Enums.

---

## 14. Fix-Runden

**Runde 1** (`phase/outbound-e5-absender-did-v2-fix1`, Commit `009f53d`): alle 7 zugewiesenen
Review-Blocker behoben. Kern-Fix: `makeElSipRegistrar#ensureRegistration` prueft zusaetzliche
Idempotenz-Bedingungen.

**Runde 2**: 5 genannte Blocker behoben, Scope eng gehalten (Doku +
`scripts/el-nummern-registrierung.mjs` + `src/elevenlabs/nummern-registrierung.js` + Tests).
Dabei einen echten, bis dahin unentdeckten Produktionsbug im CLI-Einstieg gefunden (kaputter
Store-Import).

**Runde 3** (E5-01, finaler Stand `phase/outbound-e5-absender-did-v2-fix3`): die beiden
verbleibenden Blocker behoben — insbesondere die gemeinsame Konstruktions-Naht
`sipRegistrarWennAktiv(config)` gebaut und in die echten Produktions-Aufrufer (`web-login.js`,
`billing/webhook.js`, `billing/contract-end-cleanup.js`) verdrahtet, damit die
DID-Freigabe die EL-Registrierung tatsaechlich zurueckgibt.

Der finale Zustand (Gate BLOCKED laut Auftrag) verlangt vor dem Merge noch: PLAN-SECURITY.md
auf den Stand von Runde 3 nachziehen (Blocker), Suppression-Ratsche in Ordnung bringen,
Provisioning-Orchestrator auf `sipRegistrarWennAktiv(config)` umstellen.
