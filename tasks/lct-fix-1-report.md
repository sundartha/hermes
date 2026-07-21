# Phase LCT-FIX-1 — Ist-Kosten-Zuordnung reparieren (Anker + Session)

**Datum:** 2026-07-21
**Gate:** **BLOCKED** (Clean-Code-Auditor: 1x S1 — die Blocker-Behebung liegt in den Fix-Runden, das finale Gate-Urteil des Auditors zur letzten Runde ist im Workflow als BLOCKED protokolliert)
**Final-Branch:** `phase/lct-fix-1-cost-record-join-fix3` (HEAD `7a61fdc`)
**Basis:** `master` = `69ec7cd`
**Safety-Urteil:** FREIGEGEBEN (approved), mit 6 Concerns — davon 2 vor Deploy abzuarbeiten
**Commit-Kette:** `9d55df3` (Impl) -> `5eaf2f9` (Fix r1) -> `b37f88d` (Fix r2) -> `7a61fdc` (Fix r3)

---

## 1. Auftrag

`getVoiceCostRecords` verwarf **jeden** Telnyx-Kostenbeleg: die Zuordnung lief ueber die Felder
`leg_id` / `call_leg_id`, die Telnyx in `/v2/detail_records` gar nicht liefert bzw. nur als UUID
eines *anderen* ID-Systems. Live bedeutete das: 297 Belege, 0 zugeordnet, Deckungsquote 0 %.

Neuer Mechanismus: **zweistufige Aufloesung**

- **Stufe 1 (Anker):** `call_control_id === legId` — exakte Gleichheit auf einer global eindeutigen
  Provider-ID. `providerLegIdOf(call)` liefert in beiden Pfaden eine `v3:`-Token (twilioSid im
  TeXML-/Budget-Pfad, callControlId im Assistant-Pfad); genau diese Form traegt `call_control_id`.
- **Stufe 2 (Aufspannen):** `telnyx_session_id` / `call_session_id` — zwei Feldnamen fuer dieselbe
  Provider-Session. Belege, die in einer vom Anker aufgespannten Session liegen, kommen mit.

### Scope (hart)

Beauftragt waren **genau zwei Dateien**:

- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/src/telephony/adapters/telnyx/voice.js`
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/test/telnyx-cost-records.test.js`

**Nicht anfassen:** `cost-truing.js`, `metering.js`, `call-finish.js`, `outbound-gates.js`, Store,
`schema.sql`, `ports.js`. Keine neue Env-Var, keine Migration, keine neue Dependency.

Die Fix-Runden haben den Scope auf **8 Dateien** erweitert (siehe Abschnitt 7 und die
Scope-Beobachtung des Safety-Reviews) — ausschliesslich zur Behebung von Review-Blockern und
ausschliesslich fail-closed wirkend.

### Geld-Pfad-Auflage

**Fail-closed bleibt fail-closed.** Kein Anker gefunden = **LEERE Liste** bei `ok:true`, niemals ein
lockererer Fallback. Begruendung der Asymmetrie: ein *fehlender* Beleg heisst spaeter nur
`incomplete`; ein *fremder* Beleg waere eine **Fehlbuchung auf einen fremden Tenant**.
Der Fremd-Session-Test (Tenant-Trennung) war Pflichtbestandteil.

### Test-Auflage (S1 — der eigentliche Auftrag)

Die Bestands-Fixtures **erfanden** das Feld `leg_id`. Genau deshalb war die Suite gruen, waehrend
live jeder Beleg fiel. Die Fixtures mussten auf die **gemessenen** Belegformen (Spezifikation
Abschnitt 2+5, Messung 2026-07-21, 297 Belege) umgestellt werden, und **Rot-vor-Fix** war zu belegen.

Im Worktree existiert **keine `.env`**: Tests offline, keine Live-Sonden. Die Live-Verifikation macht
der Lead nach dem Merge.

---

## 2. Plan (gekuerzt)

### 2.0 Ausgangsbefund (verifiziert, nicht vermutet)

- `voice.js`: `LEG_ID_FIELDS = Object.freeze(["leg_id", "call_leg_id"])`, gelesen von `recordLegId`,
  benutzt in `toCostRecord` (`leg_unresolved` / `leg_mismatch`).
- Blast-Radius per grep belegt: `leg_id|LEG_ID_FIELDS|leg_unresolved|leg_mismatch` kommt **nur** in
  `voice.js` und `test/telnyx-cost-records.test.js` vor. Kein Aufrufer wertet die Ablehnungsgruende
  aus (sie gehen ausschliesslich in `logCostRecordsOk`) — Umbenennen ist fernwirkungsfrei.
- `cost-truing.js` liest von jedem Record nur `recordType`, `costMicroCents`, `billedSec`;
  `providerLegIdOf(call) = call.twilioSid || call.callControlId`.
- Der Port-Vertrag in `ports.js` (`VoiceCostRecord.legId` = "Leg-Referenz, gegen die der Record
  aufgeloest wurde") bleibt wortwoertlich korrekt -> **`ports.js` wird NICHT angefasst**.
- Baseline: `node --test test/telnyx-cost-records.test.js` -> **39 pass / 0 fail**.

### 2.1 Edits in `voice.js` (E1–E7)

| ID | Inhalt |
| --- | --- |
| **E1** | `LEG_ID_FIELDS` ersetzt durch `ANCHOR_ID_FIELD = "call_control_id"` + `SESSION_ID_FIELDS = ["telnyx_session_id", "call_session_id"]`. Kommentar haelt fest: `telnyx_leg_id`/`call_leg_id` sind UUIDs eines zweiten, mit der `v3:`-Token unvereinbaren ID-Systems und als Zuordnungsquelle wertlos. |
| **E2** | Ueberholten Kommentar an `RECORD_TIMESTAMP_FIELDS` nachgezogen (verwies auf das geloeschte `recordLegId`); `started_at` bewusst NICHT aufgenommen — Zeitfenster bleibt in dieser Phase unveraendert. |
| **E3** | `recordLegId` ersetzt durch vier Primitive: `recordSessionIds` (eine Quelle des Session-Feldvertrags), `matchesAnchor` (exakte Gleichheit), `anchoredSessionIds` (Stufe 1, Set), `assignmentRejectionReason` (Stufe 2, liefert `null` / `session_unresolved` / `session_mismatch`). |
| **E4** | `toCostRecord`: Leg-Block gegen Zuordnungs-Block getauscht, `sessionIds` durchgereicht. Rest unveraendert — insbesondere bleibt `legId` im Ergebnis-Record der **uebergebene Anker** (Korrelationsschluessel des Aufrufers), und die Reihenfolge **Waehrung -> Zuordnung** bleibt erhalten. |
| **E5** | Neue Funktion `fetchAllCostRecords`: sammelt die **volle** Antwort ein, bevor der Anker gesucht wird (er kann erst im letzten record_type auftauchen). Verhalten bei Fehler/voller Seite byte-identisch zum Bestand — **kein Teil-Erfolg**. |
| **E6** | `logCostRecordsOk`: zusaetzlicher `sessions=`-Zaehler, Umstellung auf **ein** Optionsobjekt. `sessions=0` unterscheidet "Anker nicht gefunden" von "Anker da, aber nichts passte". PII-frei: nur Zaehler. |
| **E7** | `getVoiceCostRecords`-Rumpf: Guards -> `fetchAllCostRecords` -> `anchoredSessionIds` -> zuordnen/zaehlen -> loggen. Doc-Kommentar auf die zweistufige Zuordnung umgeschrieben. |

**Bewusste Design-Entscheidung ueber den Spec-Wortlaut hinaus:** `assignmentRejectionReason`
akzeptiert einen Beleg auch bei **direktem** Ankertreffer, nicht nur ueber die Session. Das ist
**keine** Lockerung — `call_control_id === legId` ist Identitaetsgleichheit auf unserer eigenen,
global eindeutigen ID (dieselbe Bedingung, die Stufe 1 als Beweis nutzt). Ohne diesen Zweig wuerde
ein Beleg mit Anker aber ohne Session verworfen: Datenverlust ohne Sicherheitsgewinn.

### 2.2 Edits im Test (T1–T6)

- **T1** Kopf-Kommentar: die alten Fixtures erfanden `leg_id`; ab jetzt gemessene Feldnamen und
  Wertformen mit Quellenangabe.
- **T2** `LEG_ID`/`rawRecord` geloescht; neue ID-Konstanten (`v3:`-Anker, UUID-Session, UUID-Leg,
  `conversation_id` + Fremd-Pendants) und **eine** Feldtabelle `ID_FIELDS_BY_RECORD_TYPE` je
  record_type, parametrisiert nach IDs, dazu die Fabrik `realRecord`.
- **T3** Messtabelle `REAL_RECORDS` mit realen Werten (`0.0401`, `0.001`, `0.0000`, `1.687E-4`,
  `0.002`, `0.05`, `0.001315`) + `stubRealRecords`.
- **T4** Zuordnungstest und HTTP-Strukturtest getrennt (P14).
- **T5** Neue Pflichtfaelle: kein Anker -> leere Liste; Fremd-Session -> nie mitgezaehlt;
  `inference` bleibt unzuordenbar; `out_of_window` haelt die zweite Linie.
- **T6** Bestandsfaelle (Fremdwaehrung, `params_missing`, `config_missing`, `page_truncated`) auf
  reale Formen umgestellt; der Test "Record mit fremder Leg-ID wird verworfen" entfaellt (Achse
  existiert nicht mehr). Abschnitt **(g) Aufrufer-Riegel** bleibt unveraendert gruen.

### 2.3 Rot-vor-Fix — Beweisprotokoll (verbindlich)

1. **Nur** die Testdatei aendern, `voice.js` unveraendert lassen.
2. `node --test test/telnyx-cost-records.test.js` -> erwartet **genau 5 fail**.
3. Ausgabe (Testnamen + `fail 5`) woertlich in den Report.
4. Danach E1–E7 anwenden -> alles gruen.

Weicht die Ist-Ausgabe ab: **anhalten und melden**, nicht die Erwartung nachziehen.

### 2.4 Pre-Mortem (ein Jahr spaeter, die Aenderung war falsch)

| Szenario | Ursache | Gegenmassnahme |
| --- | --- | --- |
| Fremde Kosten auf fremdem Tenant gebucht | Session-Menge aus einem nicht-eigenen Beleg aufgespannt | Stufe 1 verlangt **exakte** Gleichheit auf `call_control_id`; leere Menge akzeptiert nichts; Tenant-Trennungs-Test pinnt es |
| Deckungsquote steigt nie, keiner merkt warum | Anker-Feld erneut falsch, Log unterscheidet nicht | `sessions=` im PII-freien Log trennt "kein Anker" von "nichts passte" |
| Naechster Feldnamen-Drift bleibt wieder ungefangen | Fixtures erfinden Felder | Feldnamen aus **einer** Tabelle mit Quellenangabe; Rot-vor-Fix ist Pflichtbeleg |
| Ueberbuchung durch doppelt gezaehlte Belege | zwei Session-Felder desselben Belegs | Belege werden **einmal** durchlaufen; `recordSessionIds` beeinflusst nur die Aufnahme-Entscheidung |
| Zeitfenster still verloren | Umbau von `toCostRecord` | `out_of_window`-Test, gruen vor UND nach dem Fix |

Akzeptiertes Restrisiko: `inference` bleibt unzuordenbar; `withinRecordWindow` greift bei
`sip-trunking` nicht (`started_at` steht nicht in `RECORD_TIMESTAMP_FIELDS`).

---

## 3. Implementierung — Zusammenfassung

E1–E7 wurden wortgetreu umgesetzt. `ANCHOR_ID_FIELD`/`SESSION_ID_FIELDS` ersetzen `LEG_ID_FIELDS`;
`recordLegId` weicht den vier Primitiven; `toCostRecord` bekommt `sessionIds` durchgereicht;
`fetchAllCostRecords` sammelt die volle Antwort ein und bricht bei Fehler/voller Seite ohne
Teil-Erfolg ab; `logCostRecordsOk` traegt `sessions=` und nimmt ein Optionsobjekt.

**Geld-Pfad:** fail-closed ist fail-closed geblieben — leere Anker-Menge akzeptiert NICHTS
(`ok:true`, `records:[]`), kein lockererer Fallback. Der Tenant-Trennungs-Test ist da: ein fremder
`call-control`-Beleg ueber 9,99 USD in derselben Antwort kommt nicht mit (records 2, Summe 4110000,
kein Record mit 999000000). Waehrung-vor-Zuordnung, Zeitfenster, Kosten-Parser und Port-Vertrag
(`legId` = uebergebener Anker) unveraendert.

**Scope (Impl-Commit `9d55df3`):** genau die zwei beauftragten Dateien, per
`git diff --name-only` bestaetigt. Kein `cost-truing.js`, `metering.js`, `call-finish.js`,
`outbound-gates.js`, Store, `schema.sql`, `ports.js`. Keine Env-Var, keine Migration, keine
Dependency. Grep-Gate: 0 Treffer fuer `LEG_ID_FIELDS|recordLegId|leg_unresolved|leg_mismatch` in
`src/`.

### 3.1 Rot-vor-Fix — Ist-Ausgabe

Nach reiner Umstellung der Fixtures auf die realen Belegformen und **vor** jeder Aenderung an
`voice.js`:

```
tests 43 / pass 38 / fail 5
```

Exakt die fuenf vom Plan vorhergesagten Fehlschlaege, kein weiterer:

1. `getVoiceCostRecords: reale Belegformen - der Anker spannt die Session auf...` (records.length 0 statt expected 6)
2. `getVoiceCostRecords: Ende-zu-Ende sip-trunking cost 0.0401 -> costMicroCents 4010000`
3. `getVoiceCostRecords: fremde Waehrung wird verworfen, gleiche Waehrung kleingeschrieben akzeptiert` (usd-Zweig, 0 statt expected 1)
4. `getVoiceCostRecords: Belege einer FREMDEN Session kommen NIE mit (Tenant-Trennung)` (0 statt expected 2)
5. `getVoiceCostRecords: \`inference\` bleibt unzuordenbar (nur conversation_id)` (0 statt expected 1)

Die beiden Fail-closed-Pins (`kein Anker -> []` und `out_of_window`) waren wie gefordert **vor und
nach** dem Fix gruen. Nach E1–E7: **44/44** in der Zieldatei.

### 3.2 Verifikation (Impl-Runde)

- `node --check` auf beide Dateien: ok
- Zieldatei: 44/44
- Vollsuite: **2851 pass / 0 fail / 0 skipped**
- Smoke gruen, offline, ohne `.env`, ohne Live-Sonde:
  - Server-Boot ueber `test/helpers.js startServer` mit `SKIP_TWILIO_SIGNATURE_CHECK=true` ->
    `GET /healthz` = 200 `{"ok":true}` (der geaenderte Adapter laedt im echten Prozess).
  - Seam in-process gegen gestubbtes `fetch`, reale Belegformen:
    - **mit Anker:** `[telnyx/voice] getVoiceCostRecords ok sessions=1 records=3 rejected={"session_unresolved":1}` — beide Pflicht-Typen dabei, `sip-trunking` ueber den Anker, `call-control` **ausschliesslich** ueber die Session (traegt kein `call_control_id`), `text-to-speech` ueber `call_session_id`, `inference` korrekt verworfen. `costMicroCents` 4010000 / 100000 / 16870, `legId` jeweils der uebergebene Anker.
    - **ohne Anker (fremde legId):** `ok sessions=0 records=0 rejected={"session_mismatch":3,"session_unresolved":1}`, Rueckgabe `{"ok":true,"records":[]}` — fail-closed bestaetigt, kein Wurf.
  - Log im Klartext gegengelesen: nur Zaehler, keine `call_control_id`, keine Session-ID, keine
    Rufnummer, kein API-Key.

### 3.3 Deviations (Impl)

1. **Testname der Hauptzuordnung praezisiert.** Der Plan nennt ihn "Anker nur auf sip-trunking",
   aber die vom Plan uebernommene ID-Tabelle gibt **auch** `ai-voice-assistant` ein
   `call_control_id`. Der Plan-Name waere sachlich falsch gewesen. Fixtures unveraendert
   uebernommen, nur der Name angepasst — plus eine Konstante `SESSION_ONLY_RECORD_TYPES`, die die
   vier **ankerlosen** Typen (`call-control`, `recording`, `speech-to-text`, `text-to-speech`)
   explizit als "nur ueber die Session auffindbar" assertet. Kern-Zusicherung damit schaerfer
   gepinnt als im Plan.
2. **Ein Test ueber den Plan hinaus:** "Beleg MIT Anker aber OHNE Session-Referenz wird akzeptiert".
   Der Plan flaggt die direkte Anker-Akzeptanz selbst als bewusste Design-Entscheidung, sie war mit
   den Plan-Fixtures aber von **keinem** Test gepinnt. Mutationsprobe: nach Entfernen von
   `if (matchesAnchor(...)) return null;` faellt exakt dieser eine Test um, alle 43 anderen bleiben
   gruen — der Zweig war nachweislich ungedeckt (S1: untestetes neues Verhalten im Geld-Pfad).
   Folge: 44 statt 43 Tests in der Datei, Gesamtsuite 2851 statt 2850.
3. **`node_modules`-Symlink-Falle:** `ln -s "./node_modules" node_modules` erzeugt einen
   Selbstbezug (ELOOP), `npm test` lief dadurch **stumm ohne jede Ausgabe**. Auf das echte
   Repo-`node_modules` umgebogen, nicht committet.
4. **Vorbestehender Suite-Flake** in `test/telnyx-event-ingest-route.test.js` (Assertion
   `reserveReleased === true` nach `waitForStoreState` auf `billedAt` — Settlement-Schreib-Race im
   Test, **nicht** der bekannte `p5-gate-proof`-Flake). Gegenprobe auf **cleanem master**
   durchgefuehrt (beide Dateien per `git checkout --` zurueckgesetzt, Sicherung im Scratchpad —
   **kein `git stash`**, Worktree-Gefahr): dort in Lauf 3 von 3 ebenfalls rot. Als vorbestehend
   belegt. `getVoiceCostRecords` wird vom Hangup-/Settlement-Pfad ohnehin nie aufgerufen.
5. **prettier/eslint lokal nicht installiert**, kein Format-Gate: `prettier --check` schlaegt auch
   bei **unberuehrten** Dateien fehl. Zwei der drei Abweichungen in `voice.js` sind Bestand; die
   dritte ist der vom Plan woertlich vorgegebene `logCostRecordsOk`-Aufruf (103 Zeichen bei
   printWidth 100), im Rahmen der in dieser Datei etablierten Zeilenlaengen (Bestand bis 137).
   Bewusst nicht umformatiert.

### 3.4 Clean-Code-Selbstpruefung (Impl)

- **G5/S2:** `recordSessionIds` ist die einzige Quelle des Session-Feldvertrags, `matchesAnchor` die
  einzige Quelle der Anker-Gleichheit; beide von Stufe 1 und 2 geteilt. Im Test kommt jede reale
  Belegform aus **einer** Tabelle, parametrisiert nach IDs. Haendisch nachgefuellte Leer-Seiten
  entfielen.
- **G25:** keine neuen nackten Werte; `ANCHOR_ID_FIELD`/`SESSION_ID_FIELDS` sind benannte
  Feldvertraege. Kein G35-Fall (keine Env-Var).
- **C5/G9/G12:** `LEG_ID_FIELDS` und `recordLegId` vollstaendig entfernt (grep-belegt), kein
  auskommentierter Code.
- **F1:** alle neuen Funktionen 0–2 Argumente; `logCostRecordsOk` auf ein Optionsobjekt umgestellt.
- **G30/G34:** `getVoiceCostRecords` liest als Guards -> holen -> Anker -> zuordnen/zaehlen ->
  loggen. Verschachtelungstiefe max. 3 (Grenze 4), laengste neue Funktion 11 Zeilen.
- **C2:** alle vier Kommentarstellen nachgezogen, die auf die geloeschte Leg-Logik verwiesen.
- **N7/P5:** einzige Funktion mit Nebeneffekt ist `logCostRecordsOk` und heisst so; die
  Zuordnungs-Primitive sind rein.
- **P11/T1/T5/P14:** jeder neue Zweig hat eine Assertion; der Zuordnungs-/Struktur-Test wurde
  getrennt.
- **Absolute Regeln:** keine Safety-Gates beruehrt, kein Endpunkt hinzugefuegt, kein
  Disclosure-/Auth-Pfad angefasst, Log PII-frei.

---

## 4. Safety-Urteil (final)

**FREIGEGEBEN (approved)** — mit sechs Concerns, davon zwei vor dem Deploy abzuarbeiten.

| Kriterium | Ergebnis |
| --- | --- |
| Tests unabhaengig gruen | ja |
| Safety-Gates intakt | ja |
| Offenlegung intakt | ja |
| Auth fail-closed intakt | ja |
| Keine Secrets geleakt | ja |
| Verhalten wie beabsichtigt | ja |
| Scope respektiert | ja |

### 4.1 Unabhaengige Verifikation

Frischer Worktree, `git checkout -b review-lct-fix-1-r3 phase/lct-fix-1-cost-record-join-fix3`
(HEAD `7a61fdc`). `npm test` **zweimal** selbst gefahren, beide Male gruen und identisch:
**2861 / 2861 / fail 0 / skipped 0** (88,8 s bzw. 82,5 s). Beide Store-Backends im selben Lauf:
`BASE_ENV` (`test/helpers.js:171`) faehrt `STORE_BACKEND=json`, 146 Testdateien fahren den pg-Pfad
ueber pglite. Kein Flake in zwei Vollaeufen. `node --check` auf `src/boot.js`, `src/boot-guard.js`,
`src/telephony/adapters/telnyx/voice.js` = OK. (eslint liess sich im Worktree nicht fahren:
`@eslint/js` ueber den node_modules-Symlink nicht aufloesbar — CI deckt das ab.)

### 4.2 Eigener Rot-vor-Fix-Beweis (Agenten-Report nicht geglaubt)

`master` via `git archive` in ein separates Scratchpad-Tree extrahiert und dieselbe realistische
Belegform gegen **beide** Implementierungen gefahren:

- **master:** `records=0 rejected={"leg_unresolved":5,"leg_mismatch":2}` — der behauptete
  Live-Defekt ist reproduziert.
- **Fix-Branch:** `records=6 via_anchor=2 via_telnyx_session_id=2 via_call_session_id=2
  rejected={"session_unresolved":1}` — Format deckt sich exakt mit der Deploy-Auflage in
  `tasks/lct-DEPLOY-CHECKLIST.md`.

### 4.3 Eigene adversariale Grenzfall-Proben

| Probe | Ergebnis |
| --- | --- |
| **E1** Leerstring-Session am Fremdbeleg | Fremdbeleg verworfen, nur Ankerbeleg gebucht |
| **E2** Anker in Fremdwaehrung | spannt die Session trotzdem auf (Identitaetsgleichheit, korrekt), nur der eigene USD-Beleg kommt mit |
| **E3** `call_control_id = null` | 0 Records |
| **E4** nicht-String-Session (`{}`) | **kollidiert** — siehe Concern 3 |
| **E5** kein Anker, aber Belege mit Session | 0 Records, `ok:true`, kein Wurf |

### 4.4 Statische Pruefung gegen die absoluten Regeln

Diff `master..HEAD` = **8 Dateien**: `.env.example`, `render.yaml`, `src/boot-guard.js`,
`src/boot.js`, `src/telephony/adapters/telnyx/voice.js`, `tasks/lct-DEPLOY-CHECKLIST.md`,
2 Testdateien.

`git diff --stat` auf `src/claude.js`, `src/bridge.js`, `src/auth.js`, `src/web-auth.js`,
`src/middleware.js`, `src/server.js`, `src/routes/`, `adapters/twilio/` ist **leer** ->
Offenlegungssatz, Signaturpruefung, Basic-Auth, MCP-Auth und alle `numberGateError`-Gates
nachweislich unberuehrt. Kein neuer Endpunkt. `package.json`/`package-lock.json` byte-identisch ->
keine neue Dependency. Kein `eslint-disable`, kein `.skip`/`.only`, kein toter/auskommentierter
Code im Diff. `render.yaml`/`.env.example`: ausschliesslich Kommentarzeilen geaendert, `value: ""`
unveraendert. Secret-Grep ueber den Diff leer; die neue Log-Zeile fuehrt ausschliesslich Zaehler
(`via_*`-Schluessel aus der festen Konstante `ASSIGNMENT_ROUTES`, Ablehnungsgruende feste Strings).

Kein Import-Zyklus durch den neuen `boot.js -> telnyx/voice.js`-Import (`voice.js` wird ohnehin
ueber `registry.js` in jedem Boot geladen, importiert nur config/errors/render/elevenlabs-voice/
cost-parse, kein Top-Level-Seiteneffekt). `costTruingBookingFindings` hat genau einen
Produktions-Aufrufer (`boot.js:147`), der den neuen Pflicht-Parameter reicht; kein `[]`-Default.

**Geldrichtung verifiziert:** bei fehlender Zuordnung liefert `classifyRecords`
(`cost-truing.js:128`) `null` -> `measured=null` -> `bookCorrectionFor` wird gar nicht gerufen ->
**kein Geld bewegt**. `applyCostCorrectionCents` (`state-ops.js:1912`) verwirft Rueckerstattungen
ohne `dataComplete`, bucht Nachforderungen unkonditional — Asymmetrie unveraendert.

### 4.5 Concerns (6)

1. **RESTRISIKO (dokumentiert, deploy-gegated, KEIN technischer Interlock).** Die zweistufige
   Zuordnung akzeptiert Belege, deren `telnyx_session_id` **oder** `call_session_id` in der vom
   Anker aufgespannten Menge liegt. Dass beide Feldnamen denselben, **call-lokalen** Wert
   bezeichnen, ist **unbelegt** — der Rohauszug der Messung 2026-07-21 liegt nicht im Repo. Faellt
   die Annahme, kippt die Zuordnung von fail-closed nach **fail-OPEN**: fremde Belege blaehen
   `actualCostMicroCents` auf, und weil Nachforderungen unkonditional gebucht werden, **zahlt der
   Kunde**. Entschaerft durch die je Zuordnungsweg getrennten Zaehler
   (`via_anchor` / `via_telnyx_session_id` / `via_call_session_id`), das testgepinnte Log-Format und
   die blockierende Auflage samt Portal-Gegenprobe in `tasks/lct-DEPLOY-CHECKLIST.md`. **Nicht**
   entschaerft: zwischen Deploy und menschlicher Log-Pruefung liegt nur
   `COST_TRUING_DELAY_MINUTES` (180); es gibt keinen Schalter, der die Buchung bis zur bestandenen
   Gegenprobe technisch anhaelt (`COST_TRUING_BOOKING_ENABLED` wurde in P8 per Owner-Entscheidung
   entfernt, ein Wiedereinbau waere Scope-Bruch). **Der Lead muss die Auflage vor dem ersten
   buchenden Sweep tatsaechlich abarbeiten.**
2. **STALE DOKU IM CODE.** `src/config.js:398-400` fuehrt `inference` weiter als Kandidat fuer
   `COST_TRUING_REQUIRED_RECORD_TYPES` auf, waehrend der Boot genau diesen Wert seit dieser Phase
   mit `exit(1)` ablehnt. `.env.example` und `render.yaml` wurden korrigiert, `config.js` nicht. Ein
   Operator, der dem Kommentar folgt, faehrt in einen Boot-Refusal (fail-closed, kein Geldrisiko —
   aber Telefonie-Totalausfall bis zur Korrektur). **Vor Deploy nachziehen.**
3. **HAERTUNGSLUECKE (theoretisch, Probe E4).** `recordSessionRefs`/`matchesAnchor` pruefen nur auf
   Truthiness und stringifizieren dann. Liefert der Provider ein nicht-String-Feld (`{}` / `[]`),
   kollabieren Anker- und Fremdwert auf denselben String (`'[object Object]'` bzw. `''`) und ein
   **fremder** Beleg wird angenommen — in Probe E4 kamen so 2 Records inkl. eines
   9,99-USD-Fremdbelegs durch. Real liefert `/v2/detail_records` Strings, also kein Live-Pfad; ein
   `typeof === 'string' && trim()`-Guard wuerde die Klasse vollstaendig schliessen.
4. **SCOPE-BEOBACHTUNG (kein Verstoss).** Der neue fatale Boot-Befund
   `cost_truing_required_types_unassignable` geht ueber den Branch-Titel hinaus. Er stammt
   nachweislich aus einem Review-S1-Blocker (Commit `5eaf2f9`), folgt direkt aus dem Befund
   "`inference` ist strukturell unzuordenbar" und wirkt ausschliesslich fail-closed. Zulaessige
   Blocker-Behebung, kein ungefragtes Extra. Erschwerend fuer die Nachpruefbarkeit: die
   urspruenglich zitierte Spec `tasks/lct-fix-1-spec.md` existierte zum Review-Zeitpunkt **nicht im
   Repo** (vom Impl-Agenten in `5eaf2f9` selbst eingeraeumt) — es gab keinen schriftlichen
   Scope-Vertrag zum Abgleich.
5. **KLEINIGKEIT.** Die Boot-Fehlermeldung echot den beanstandeten Env-Wert zurueck
   (`fordert ${unassignable.join(',')}`). `COST_TRUING_REQUIRED_RECORD_TYPES` ist keine
   Secret-Variable, insofern regelkonform; ein versehentlich dort hineinkopierter Wert landete aber
   im Boot-Log.
6. **LAYERING.** `boot.js` importiert jetzt eine Konstante aus
   `src/telephony/adapters/telnyx/voice.js`. Kein Zyklus, kein Seiteneffekt, Praezedenz vorhanden —
   aber der Boot kennt damit einen konkreten Provider-Adapter. Falls ein zweiter Adapter je
   Kostenbelege liefert, gehoert die Menge hinter den Port, nicht hinter einen Adapter-Import.

### 4.6 Safety-Verdikt im Wortlaut (gekuerzt)

> Die vier unantastbaren Regeln sind nachweislich intakt. Der Fix behebt einen echten Totalausfall,
> den ich selbst reproduziert habe: master verwirft auf realistischen Telnyx-Belegformen **jeden**
> Beleg (`records=0`), der Branch ordnet 6 von 7 korrekt zu. Die Richtung bleibt fail-closed — ohne
> Anker akzeptiert Stufe 2 nichts (Probe E5), und eine ausgebliebene Zuordnung bewegt kein Geld
> (`measured=null` -> keine Buchung). Der neue Boot-Riegel gegen unerfuellbare Pflicht-Mengen ist
> eine Verschaerfung, keine Aufweichung.
>
> Zwei Punkte halten mich davon ab, das Ergebnis als sorgenfrei zu bezeichnen. Erstens traegt die
> Session-Gleichsetzung ein reales fail-OPEN-Geldrisiko zulasten des Kunden; sie ist ehrlich als
> unbelegte Annahme benannt, mit testgepinntem Falsifikationsinstrument und blockierender
> Deploy-Auflage — aber technisch haelt nichts die Buchung an, wenn die Auflage uebersprungen wird.
> Zweitens widerspricht der Kommentar an `src/config.js:398` dem neuen Boot-Verhalten.
>
> Beides ist merge-vertraeglich (fail-closed bzw. Doku), keines rechtfertigt es, den Branch gegen
> den kaputten Bestand stehen zu lassen.

---

## 5. Clean-Code-Audit (final)

**Verdikt: BLOCKER** — 1x S1, 0x S2. **Der Blocker liegt NICHT im Code**, sondern in der
mitgelieferten Deploy-Auflage.

### 5.1 S1 (Blocker)

**S1-1 · `tasks/lct-DEPLOY-CHECKLIST.md`** (neuer Abschnitt "Session-Zuordnung am ersten Live-Call
verifiziert")

Die **einzige** kompensierende Kontrolle fuer das im Diff selbst dokumentierte fail-OPEN-Risiko ist
so **nicht ausfuehrbar**: die `via_`-Log-Zeile entsteht ausschliesslich in `getVoiceCostRecords`,
und deren einziger Aufrufer ist `runCostTruingSweep` (`src/billing/cost-truing.js:290`) — derselbe
Sweep bucht **unkonditional** (`bookCorrectionFor`, `cost-truing.js:320`; das Flag
`COST_TRUING_BOOKING_ENABLED` wurde in P8 entfernt). Einen "Sweep ohne Buchung" gibt es weder ueber
das Intervall (`src/boot.js:319`) noch ueber den manuellen Endpunkt
(`src/routes/api-billing.js:82`).

Die Auflage "Pruefung nach dem Deploy, VOR dem ersten Sweep mit Buchung" ist damit unerfuellbar: wer
die `via_`-Zahlen lesen kann, hat bereits fuer **alle** faelligen Kandidaten gebucht (auch fremder
Tenants). Das Stopp-Kriterium ("jedes `via_<session>` > 0 ist ein Stopp") greift erst **nach** der
Geldbewegung, und eine Rueckabwicklung nennt die Auflage nicht — die Kontrolle sieht aus wie ein
Gate, ist aber keines.

*Fix:* Auflage umschreiben auf "erste Messung an einem selbst erzeugten Test-Call, nachdem geprueft
wurde, dass kein fremder Kandidat faellig ist" **plus** explizite Rueckabwicklungs-/
Abbruchprozedur; alternativ (groesserer Eingriff) einen records-only-Lauf des Sweeps schaffen.

### 5.2 S2

Keine.

### 5.3 S3

| ID | Ort | Befund |
| --- | --- | --- |
| **S3-1** | `voice.js:250-256` (`assignmentOutcome`) | G26: der Anker wird nur als Treffer, nie als **Gegenbeweis** gewertet. Ein Beleg mit **fremder** `call_control_id`, aber passender Session, wird ueber Stufe 2 akzeptiert, obwohl er sich selbst als zu einem anderen Leg gehoerig ausweist. Bewusst nicht S1: im heutigen Produkt entsteht kein zweites Leg (kein transfer/bridge/conference in `src/telephony`). *Fix:* im Nicht-Treffer-Zweig zuerst `if (raw[ANCHOR_ID_FIELD]) return { reason: "anchor_mismatch" };` — eine Zeile + ein Test. |
| **S3-2** | `src/boot-guard.js:352-354` | C2/C4: Der Kommentar "Der Parameter ist PFLICHT (kein `[]`-Default: ein vergessenes Argument soll laut scheitern)" gilt nicht — bei leerer `requiredRecordTypes` wird der filter-Callback nie aufgerufen; ein Aufruf ohne `assignableRecordTypes` liefert stillschweigend nur den EMPTY-Befund (per Node-Lauf verifiziert). *Fix:* harter Guard oder Kommentar entschaerfen. |
| **S3-3** | `voice.js` + `boot.js` + `boot-guard.js` + `.env.example` + `render.yaml` + Checkliste | C2-Driftrisiko: dieselbe Begruendungs-Prosa steht sinngleich an **sechs** Stellen. Das Diff macht es anderswo bereits richtig ("Begruendung s. `ASSIGNABLE_COST_RECORD_TYPES`"). *Fix:* eine Quelle, ueberall sonst Regel + Verweis. |
| **S3-4** | `tasks/lct-DEPLOY-CHECKLIST.md` (Gegenprobe) | Die Auflage verlangt die Auswahl **eines** Calls, "der parallel zu einem zweiten lief", die Log-Zeile traegt aber bewusst keinen Call-Bezug. Einzige Bruecke ist `[cost-truing] korrektur call=...` (`cost-truing.js:267`), die bei nicht buchbarem `estimatedCostCents` ausbleibt. Bei mehreren Kandidaten je Sweep ist die Zuordnung lueckenhaft. *Fix:* "genau ein faelliger Kandidat je Messlauf" festnageln, oder je Kandidat eine PII-freie Klammerzeile mit `call=<id>`. |
| **S3-5** | `README.md` / `PLAN-SECURITY.md` (im Diff nicht angefasst) | CLAUDE.md verlangt, neue bewusste Vereinfachungen/akzeptierte Risiken dort festzuhalten; die unbelegte Session-Annahme mit fail-OPEN-Potenzial lebt nur in Code-Kommentaren und einer `tasks/`-Datei. *Fix:* Absatz nachziehen. |

### 5.4 S4

- **S4-1 · `voice.js:45-107`** — rund 60 Kommentarzeilen auf 6 Konstanten: Herleitung, Messprotokoll,
  Risikoanalyse und Deploy-Verweis stehen zwischen den Deklarationen, die Konstanten verschwinden im
  Fliesstext (G16). Inhalt korrekt und wertvoll, deshalb nur S4. *Optional:* Messung in den
  Dateikopf oder nach `tasks/`.
- **S4-2 · `test/telnyx-cost-records.test.js`** (die zwei Log-Format-Tests) — der Vergleich pinnt die
  komplette Zeile als String inklusive JSON-Schluesselreihenfolge von `rejected={...}`; diese
  Reihenfolge haengt an der Iterationsreihenfolge der Roh-Belege, nicht an einer Zusage. Der
  Format-Pin der `via_`-Spalten ist gewollt, der `rejected`-Teil bricht auch bei rein kosmetischer
  Umstellung. *Optional:* `rejected` als geparstes Objekt vergleichen.

### 5.5 Ausdrueckliches Lob des Auditors

1. **Wurzel statt Symptom** — die alten Fixtures **erfanden** `leg_id`, deshalb war die Suite gruen
   waehrend live jeder Beleg fiel; die neuen Fixtures tragen die gemessenen Feldnamen, und die
   Reichweite der Tests wird im Dateikopf ehrlich begrenzt ("beweisen die Annahme NICHT").
2. **Verifikation existiert und laeuft** — `test/telnyx-cost-records.test.js` (50/0) und
   `test/cost-truing-booking-guard.test.js` (12/0, inkl. echter Boot-Refusal-Spawns) im Worktree
   selbst ausgefuehrt, offline, F.I.R.S.T. gewahrt; `console.log`-Capture mit `try/finally`
   zurueckgesetzt.
3. **Keine zweite Quelle (G5/G27)** — `ASSIGNABLE_COST_RECORD_TYPES` ist aus `COST_RECORD_TYPES`
   minus `UNASSIGNABLE` **abgeleitet**, der Boot-Guard bekommt sie injiziert und bleibt eine reine
   Entscheidung (DIP, Verdrahtung in `boot.js`); zwei Tests koppeln die Test-Feldtabelle in **beide**
   Richtungen an das Produktions-Enum. Der Export von `COST_RECORD_TYPES` nur fuer diesen Drift-Test
   ist eine begruendete, gute Kopplung — kein Flag.
4. **Allowlist statt Deny-Liste**, inkl. U6b (Case-Drift `Inference`, Tippfehler `sip_trunking`,
   nicht existierendes `call`) — genau die Klasse, die eine Deny-Liste durchliesse; die Assertion
   prueft `fordert <wert> ` und faengt den Teilstring-Selbstbetrug ab.
5. **Fail-closed-Richtung praezise gepinnt** — kein Anker -> leere Liste bei `ok:true`, fremde
   Session ueber **beide** Feldnamen -> verworfen, Anker ohne Session -> akzeptiert.
6. **Ehrlichkeit statt Schoenrederei** — das client-seitige Zeitfenster wird nicht mehr als zweite
   Linie verkauft, sondern per `started_at`-Test als **wirkungslos** festgenagelt.
7. **PII-Disziplin gehalten** (Regel 4/5) — nur Zaehler und Feldnamen im Log.
8. **Toter Code restlos entfernt**, Signaturaenderung von `costTruingBookingFindings` bei allen
   Aufrufern nachgezogen (grep bestaetigt), Funktionslaenge/Argumente/Nesting deutlich unter den
   Richtwerten, `.env.example` und `render.yaml` konsistent nachgezogen, **keine neue Env-Var**
   (kein BASE_ENV-Drift).
9. **Kein Safety-Gate aufgeweicht** — der neue Boot-Riegel ist strenger, nicht lascher.

### 5.6 Top-Todos des Auditors

1. **S1-1:** Deploy-Auflage in `tasks/lct-DEPLOY-CHECKLIST.md` reparieren — die `via_`-Messung ist
   erst **nach** der ersten unkonditionalen Buchung lesbar; Ablauf auf einen eigenen Test-Call +
   geprueft leere Fremd-Kandidatenliste umstellen und eine Rueckabwicklungsprozedur benennen.
2. **S3-1:** In `assignmentOutcome` den Anker auch als **Gegenbeweis** werten (`anchor_mismatch`,
   sobald `raw.call_control_id` gesetzt und `!= legId`) — eine Zeile plus Test.
3. **S3-2/S3-5:** Kommentar-Zusage "Parameter ist PFLICHT" in `boot-guard.js` entweder hart machen
   oder entschaerfen; das akzeptierte Session-Risiko zusaetzlich in `README.md`/`PLAN-SECURITY.md`
   eintragen (CLAUDE.md-Pflicht).

---

## 6. Fix-Runden

### Runde 1 — `5eaf2f9` (Branch `phase/lct-fix-1-cost-record-join-fix1`)

Alle drei Blocker bearbeitet, **Suite 2856/0** (beide Store-Backends im selben `npm test`-Lauf;
+5 neue Tests gegenueber 2851).

**S1-1 — teilweise geloest, ehrlich benannt:** die vom Reviewer bevorzugte Loesung (PII-freien
Messauszug als `tasks/lct-fix-1-spec.md` mitcommitten) konnte nicht geliefert werden. Aus diesem
Befund ("`inference` ist strukturell unzuordenbar") entstand der neue fatale Boot-Befund
`cost_truing_required_types_unassignable` — daher die Scope-Erweiterung auf `src/boot.js`,
`src/boot-guard.js`, `.env.example`, `render.yaml` und `test/cost-truing-booking-guard.test.js`.

### Runde 2 — `b37f88d` (Branch `phase/lct-fix-1-cost-record-join-fix2`, aus fix1)

1 Commit, **Suite 2860/2860 gruen** (`npm test` deckt json- **und** pg/pglite-Dateien im selben Lauf
ab), `node --check` auf allen drei geaenderten Quellen ok, `node_modules` nicht committet.

**S1-1:** `voice.js` exportiert jetzt `COST_RECORD_TYPES` und `ASSIGNABLE_COST_RECORD_TYPES`; der
Boot-Guard bekommt die Menge injiziert (DIP, Verdrahtung in `boot.js`), zwei Tests koppeln die
Test-Feldtabelle in beide Richtungen an das Produktions-Enum.

### Runde 3 — `7a61fdc` (Branch `phase/lct-fix-1-cost-record-join-fix3`) — **FINAL**

Beide Review-Blocker behoben.

**S1-1:** Review-**Option B** gewaehlt (Behauptung **streichen** statt `started_at` aufnehmen) — und
zwar begruendet, nicht bequem: `started_at` wurde ausschliesslich an `sip-trunking` gemessen, also
genau an dem Typ, der die Zuordnung ohnehin ueber den Anker findet. Das client-seitige Zeitfenster
wird seitdem nicht mehr als zweite Linie verkauft, sondern per Test als wirkungslos festgenagelt.

Stand nach Runde 3: unabhaengig verifizierte Vollsuite **2861/2861, 0 fail, 0 skipped** (zwei
Laeufe), Zieldatei 50/0, Boot-Guard-Datei 12/0.

---

## 7. Diff-Bilanz `master..phase/lct-fix-1-cost-record-join-fix3`

```
 .env.example                           |  11 +-
 render.yaml                            |   8 +-
 src/boot-guard.js                      |  41 +++-
 src/boot.js                            |  16 +-
 src/telephony/adapters/telnyx/voice.js | 217 +++++++++++++++----
 tasks/lct-DEPLOY-CHECKLIST.md          |  64 +++++-
 test/cost-truing-booking-guard.test.js |  78 +++++++
 test/telnyx-cost-records.test.js       | 380 +++++++++++++++++++++++++++++----
 8 files changed, 707 insertions(+), 108 deletions(-)
```

Der Impl-Commit `9d55df3` hielt den Zwei-Datei-Scope exakt ein; die Erweiterung auf 8 Dateien
stammt vollstaendig aus den Blocker-Behebungen der Fix-Runden (`.env.example`/`render.yaml`: nur
Kommentarzeilen; `boot.js`/`boot-guard.js`: neuer fail-closed Boot-Riegel; Checkliste: Deploy-Auflage;
zweite Testdatei: Boot-Refusal-Tests).

---

## 8. Offene Punkte fuer den Lead

**Vor dem Deploy (blockierend):**

1. **S1-1 / Concern 1** — Deploy-Auflage in `tasks/lct-DEPLOY-CHECKLIST.md` reparieren: die
   `via_`-Messung ist erst **nach** der ersten unkonditionalen Buchung lesbar. Es gibt keinen
   technischen Interlock; die Auflage muss auf einen selbst erzeugten Test-Call bei geprueft leerer
   Fremd-Kandidatenliste umgestellt werden, plus benannte Rueckabwicklungsprozedur.
2. **Concern 2** — `src/config.js:398-400` fuehrt `inference` weiter als Kandidat fuer
   `COST_TRUING_REQUIRED_RECORD_TYPES`; der Boot lehnt genau diesen Wert jetzt mit `exit(1)` ab.

**Nach dem Merge (Live-Verifikation, macht der Lead):**

- `records > 0`, `source=telnyx_detail_records`, `sessions=1` im Log
- `via_anchor` / `via_telnyx_session_id` / `via_call_session_id` gegenpruefen — **jedes
  `via_<session>` > 0 ist laut Auflage ein Stopp-Kriterium** und verlangt die Portal-Gegenprobe der
  Session-Annahme.

**Empfohlen, nicht blockierend:**

- **S3-1** `anchor_mismatch` als Gegenbeweis (eine Zeile + Test) — verengt die dokumentierte
  fail-OPEN-Flaeche.
- **Concern 3** `typeof === 'string' && trim()`-Guard in `recordSessionRefs`/`matchesAnchor`.
- **S3-2** Kommentar-Zusage in `boot-guard.js` haerten oder entschaerfen.
- **S3-5** Akzeptiertes Session-Risiko in `README.md` / `PLAN-SECURITY.md` eintragen
  (CLAUDE.md-Pflicht).
- **Concern 6** Falls je ein zweiter Adapter Kostenbelege liefert: `ASSIGNABLE_COST_RECORD_TYPES`
  hinter den Port statt hinter den Adapter-Import.
