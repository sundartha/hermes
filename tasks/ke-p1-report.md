# Phase KE-P1 — Tote Sicherung ersetzen (250 -> `meta.total_pages`)

- **Gate**: PASS
- **finalBranch**: `phase/ke-p1-meta-truncation`
- **Basis**: `master`
- **headCommit**: `aa9b76a2a5deb8f8f10da8f8d40b31d8dddb3c05`

---

## 1. Was geaendert wurde

Blast-Radius = genau 2 bestehende Dateien, keine neuen Dateien, keine neue Dependency, keine neue Env-Variable:

- `src/telephony/adapters/telnyx/voice.js`
- `test/telnyx-cost-records.test.js`

### Kern der Aenderung

Die alte Sicherung verglich die Antwortlaenge einer Belegseite gegen die **selbst angeforderte** `page[size]`-Konstante (`COST_RECORDS_PAGE_SIZE = 250`). Da Telnyx `page[size]` real hart bei 50 deckelt (angefordert 250/100/50 liefert `meta.page_size` immer 50 — Messung 2026-07-21), konnte die Antwort diese 250 nie erreichen. Der Vergleich `page.raw.length === COST_RECORDS_PAGE_SIZE` konnte damit strukturell nie greifen — eine tote Sicherung. Der Bestand lieferte deshalb `ok:true` mit einer stillen Untermenge (z.B. 51 von 212 Belegen).

Umsetzung im Detail:

- **`COST_RECORDS_PAGE_SIZE`**: `250` -> `50` (das gemessene Provider-Maximum), mit Mess-Kommentar. Bewusst modul-lokale Konstante, nicht in `src/config.js`/`.env.example` — gemessene Provider-Eigenschaft, kein Operator-Knopf.
- **`parseTelnyxResource`** (warf `meta` bislang weg) wurde in **`parseTelnyxBody`** aufgespalten: eine Unwrap-Stelle (G5), die `{ data, meta }` liefert. Eine schmale Bestands-Projektion `parseTelnyxResource` (liefert weiterhin nur `json.data || json` ueber denselben Ausdruck, nur eine Ebene tiefer) bleibt fuer die zwei unveraenderten Bestandsaufrufer `originateCall` und `originateViaCallControl` bestehen — diese beiden Aufrufer wurden **nicht editiert**, bleiben wortgleich.
- **Neues Praedikat `isSinglePageResult(records, meta)`**: entscheidet ab jetzt ueber `meta.total_pages` **aus der Antwort** (nicht mehr gegen die eigene Anforderung), ob eine Seite vollstaendig ist. Fehlt `meta.total_pages` oder ist es kein brauchbarer Zahlwert (Provider-Drift), gilt bei einer vollen Seite fail-closed (`page_truncated`); eine kurze Seite ohne meta bleibt vollstaendig (der Provider haette sie sonst gefuellt).
- **`fetchCostRecordPage`**: nutzt jetzt `parseTelnyxBody`, prueft `isSinglePageResult(data, meta)` und liefert bei Nicht-Vollstaendigkeit `{ ok:false, reason:"page_truncated" }` direkt an dieser Stelle (dort liegt das `meta` der Antwort).
- **`fetchAllCostRecords`**: die redundante zweite Truncation-Pruefung (`page.raw.length === COST_RECORDS_PAGE_SIZE`) entfaellt ersatzlos — die Vollstaendigkeit wird nur noch an einer Stelle beurteilt (G5, EINE Wahrheit).
- **Nicht angefasst**: `recordSessionRefs`, `matchesAnchor`, `anchoredSessionIds`, `assignmentOutcome`, `withinRecordWindow`, `toCostRecord`, `formatAssignmentRoutes`, `logCostRecordsOk`, `getVoiceCostRecords`-Body, `SESSION_ID_FIELDS`, `ANCHOR_ID_FIELD`, `COST_RECORD_TYPES`, `ASSIGNABLE_COST_RECORD_TYPES`, `src/config.js`, `src/telephony/ports.js`, `src/billing/cost-truing.js`, `src/telephony/adapters/telnyx/errors.js`.

### Testdatei

- `stubFetchByRecordType` traegt jetzt `meta` (neue Hilfsfunktion `listPageBody`, EINE Stelle fuer die Antwortform).
- 4 neue Tests im Abschnitt `(e3)`: 3 davon rot-vor-Fix, 1 Grenzfall-Test (`total_pages=1` bleibt vollstaendig — gruen vor **und** nach dem Fix, pinnt die Grenze).
- Die alte 250-Zeilen-Fixture (testete nur `250 === 250`, also die eigene Konstante) wurde **ersetzt**, nicht ergaenzt.
- Netto Testzahl in der Datei: 54 -> 57 (+4 neu, −1 geloescht).

---

## 2. DER ROTE LAUF VOR DEM FIX

**Befehl** (nach den Test-Edits an `test/telnyx-cost-records.test.js`, VOR den src-Edits an `voice.js`):

```
node --test test/telnyx-cost-records.test.js
```

**Woertliche Ausgabe:**

```
tests 57 / pass 54 / fail 3

failing tests:
1) "getVoiceCostRecords: volle Seite mit meta.total_pages>1 gilt NICHT als vollstaendig"
   AssertionError: eine Seite von fuenf ist keine vollstaendige Messung  -> true !== false (actual: true, expected: false)
2) "getVoiceCostRecords: volle Seite OHNE meta -> fail-closed (page_truncated)"
   AssertionError: Expected values to be strictly equal: true !== false
3) "getVoiceCostRecords: fordert die gemessene Maximal-Seitengroesse page[size]=50 an"
   AssertionError: Expected values to be strictly equal: '250' !== '50'
```

Diese drei Fehlschlaege bestaetigen exakt die tote Sicherung: der Bestandscode forderte `page[size]=250` an und verglich die Antwort mit der eigenen Anforderung statt mit `meta.total_pages` aus der Antwort — 50 (die real gelieferte Seitengroesse) ist nie 250, also galt eine 1-von-5-Seite als vollstaendig (`ok:true`, `reason:undefined`).

Dieser Rot-Zustand deckt sich mit der bereits im Plan dokumentierten empirischen Sonde gegen den unveraenderten Bestandscode (Scratchpad, kein Repo-File angefasst):

```
[telnyx/voice] getVoiceCostRecords ok records=51 via_anchor=1 via_telnyx_session_id=50 via_call_session_id=0 rejected={}
ERGEBNIS ok= true reason= undefined records= 51
QUERY(1)= ?filter%5Brecord_type%5D=sip-trunking&page%5Bsize%5D=250
```

---

## 3. Der gruene Lauf danach

Nach dem src-Edit (`COST_RECORDS_PAGE_SIZE` 250->50, `parseTelnyxBody`+`isSinglePageResult`, `fetchCostRecordPage`/`fetchAllCostRecords` angepasst) liefert dieselbe Testdatei:

```
tests 57 / pass 57 / fail 0
```

Gesamtsuite:

```
npm test  ->  tests 2871 / pass 2871 / fail 0
```

zweiter Lauf ebenfalls `2871/2871/0` (Flake-Protokoll: stabil).

Einordnung zur genannten Referenz **2861/0**: laut Plan war die eigentliche, am Code frisch gemessene Baseline auf `master` (27a95c2) bereits **2868/2868/0** (KE-P0 hatte die Suite vor KE-P1 bereits von 2861 auf 2868 wachsen lassen; die Zahl 2861 stammt aus der Spec und war zum Planzeitpunkt bereits ueberholt). KE-P1 waechst von dieser tatsaechlichen Baseline **2868** auf **2871** (+3: 4 neue Tests, 1 geloeschte Fixture). Die Suite ist damit gegenueber beiden genannten Referenzen (2861 und 2868) ausschliesslich gewachsen, kein Test wurde entfernt ohne Ersatz.

---

## 4. Abnahmekriterium der Phase — mit Beleg

Laut Plan (Abschnitt 5) bestand das Abnahmekriterium aus vier Pruefungen. Belegt durch `acceptanceEvidence` aus der Implementierung:

1. **Rot -> Gruen an der Kern-Zusage**: `node --test test/telnyx-cost-records.test.js` -> `tests 57 / pass 57 / fail 0` (vorher 54/54/0 Baseline, plan-erwartet 57/57/0).
2. **Die tote Sicherung existiert nicht mehr, die Antwort entscheidet**: `grep -n "COST_RECORDS_PAGE_SIZE\|total_pages" src/telephony/adapters/telnyx/voice.js` -> `const COST_RECORDS_PAGE_SIZE = 50;` / `q.set("page[size]", String(COST_RECORDS_PAGE_SIZE));` / `return records.length < COST_RECORDS_PAGE_SIZE;` (nur meta-loser Fallback) / `const totalPages = parseNonNegativeInteger(meta?.total_pages);` — kein Laengenvergleich gegen die eigene Konstante als alleiniger Truncation-Test mehr.
3. **Kein geratener Query-Parameter dazugekommen (Spec A4)**: `grep -n 'q.set(' src/telephony/adapters/telnyx/voice.js` -> genau zwei Treffer: `filter[record_type]` und `page[size]`, kein weiteres `filter[...]`.
4. **Syntax + Gesamtsuite**: `node --check src/telephony/adapters/telnyx/voice.js` -> keine Ausgabe; `node --check test/telnyx-cost-records.test.js` -> keine Ausgabe; `npm test` -> `tests 2871 / pass 2871 / fail 0` (Baseline 2868/2868/0, nur gewachsen); zweiter Lauf ebenfalls `2871/2871/0` (Flake-Protokoll: stabil).

Alle vier Kriterien sind erfuellt.

---

## 5. Safety-Urteil

**Verdict: FREIGABE** (`approved: true`).

Kennzahlen aus der unabhaengigen Safety-Pruefung:
- `testsPassIndependently: true`, `testPassCount: 2871`
- `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`
- `scopeRespected: true`, `behaviorAsIntended: true`, `moneyPathFailClosed: true`, `fixturesHonest: true`
- `redBeforeGreenProven: true`, `noGuessedQueryParam: true`

**Unabhaengiger Testlauf** (frischer Worktree `.claude/worktrees/wf_d87375e0-bfd-3`, Branch `review-ke-p1` aus `phase/ke-p1-meta-truncation`):

- Setup-Befund: der vorgegebene Befehl `ln -s "./node_modules" node_modules` erzeugt einen Selbst-Symlink (`node_modules -> ./node_modules`, "Too many levels of symbolic links"); `npm test` brach dadurch mit `EXIT=194` und ohne jede Ausgabe ab. Nach Reparatur (Symlink korrekt auf das Haupt-Repo-`node_modules` gesetzt) lief die Suite.
- Ergebnis: `npm test` = 2871 pass / 0 fail (Dauer ~82 s), kein roter Test, kein Flake-Fall.
- Baseline im selben Worktree mit beiden Dateien auf `master` zurueckgesetzt: 2868 pass / 0 fail -> Delta +3, Referenz 2861 nur gewachsen.
- Isoliert: `node --test test/telnyx-cost-records.test.js` = 57/57.
- Rot-vor-Gruen unabhaengig nachgestellt (kein `git stash`, nur `git checkout master -- src/telephony/adapters/telnyx/voice.js`, Tests unveraendert): 54/57 — es fallen genau die drei bereits genannten neuen Tests, deckt sich exakt mit der Commit-Message.
- **Mutationsproben** am Produktionscode (jeweils zurueckgesetzt):
  1. `ANCHOR_ID_FIELD` `"call_control_id"` -> `"telnyx_leg_id"` = 10 Fehlschlaege, darunter der neue Test "total_pages=1 bleibt vollstaendig" (Koeder `telnyx_leg_id=FOREIGN_LEG_ID` greift also wirklich).
  2. `meta.page_size` statt `total_pages` = 1 Fehlschlag.
  3. `meta.total_results` statt `total_pages` = 1 Fehlschlag.
  4. Fehlendes `meta` durchwinken (`return true`) = 1 Fehlschlag.
  5. `COST_RECORDS_PAGE_SIZE` zurueck auf 250 = 2 Fehlschlaege.

  Kein Test blieb bei falschem Feld oder falscher Richtung gruen.

**Blockers**: keine.

**Concerns** (aus der Safety-Pruefung, wortgetreu):
1. **DEPLOY-SEQUENZ** (kein Code-Defekt, gehoert in die Deploy-Checkliste): KE-P1 macht `page_truncated` in Produktion erstmals erreichbar (live 212 sip-trunking-Belege -> `meta.total_pages=5`). Bis KE-P3 die Seitenschleife liefert, endet damit jeder Sweep in `ok:false`. In `src/billing/cost-truing.js` (`trueOneCall`) verbraucht jeder `ok:false` einen Versuch (`nextCostTruingAttempt`) und setzt bei `attempt >= costTruingMaxAttempts` `costTruedAt` — der Call ist dauerhaft geschlossen (`source=unavailable`) und wird auch nach KE-P3 nie mehr korrigiert. Das aktuell im Render-Dashboard gesetzte `COST_TRUING_MAX_ATTEMPTS=20` beschleunigt das nicht, verlaengert es nur. Konsequenz: KE-P1 nicht allein deployen; Kette bis mindestens KE-P3 zusammen ausliefern. Die konservative Richtung selbst ist von der Spec ausdruecklich gewollt (Richtungshinweis KE-P1), die Permanenz des Versuchsverbrauchs ist dort aber nicht benannt.
2. **Fixture-Detail** (A2.2, formal erfuellt): die neuen KE-P1-Fixtures pruefen Anzahlen (1+50), keine Kostensumme, und tragen deshalb keinen Null-Zwilling. Die Null-Zwilling-Pflicht gilt laut Spec nur fuer summenpruefende Fixtures; die Zaehlung 51 pinnt immerhin, dass alle 50 Belege erhalten bleiben (kein Erst-Treffer-Verhalten). Fuer KE-P2 (Aequivalenztest mit exakter Summe je Call) ist der Null-Zwilling dann verpflichtend.
3. **Kommentar-Genauigkeit**: an `SINGLE_PAGE_TOTAL` steht "Gemessen: meta = {total_results:212, total_pages:5, page_size:50} ... - bei leerer Menge 0". Der Zusatz "bei leerer Menge 0" ist aus `ceil(0/50)` hergeleitet, nicht gemessen (Spec A1 nennt nur die 212er-Messung). Harmlos — der Code behandelt `total_pages=0` als vollstaendig, was fuer eine leere Antwort korrekt ist —, aber es ist eine Ableitung im Gewand einer Messung.
4. **Bewusste Vertrauensstelle**: `isSinglePageResult` haelt `meta.total_pages` fuer autoritativ. Ein in sich widerspruechliches `meta` (`total_pages=1` bei `total_results=212`) wuerde als vollstaendig akzeptiert. Genau so verlangt es die Spec ("gegen meta.total_pages AUS DER ANTWORT"), und ein Quer-Check gegen `total_results`/`page_size` waere eine zweite Wahrheit — nur als bekannte Grenze festhalten.

**Auflage fuer den Lead**: die Deploy-Checkliste um den Punkt ergaenzen, dass KE-P1 nicht ohne KE-P3 live gehen darf (Versuchszaehler-Verbrauch schliesst Calls sonst dauerhaft), und die Worktree-Setup-Zeile `ln -s "./node_modules" node_modules` korrigieren — sie erzeugt einen Selbst-Symlink, unter dem `npm test` wortlos mit `EXIT=194` abbricht.

---

## 6. Clean-Code-Audit

**Verdict: PASS** — `blocker: false`.

- **S1**: keine Befunde.
- **S2**: keine Befunde.
- **S3**: keine Befunde.
- **S4**: keine Befunde.

Diff eng gescoped (2 Dateien), fixt genau die tote Sicherung aus KE-P1 (`COST_RECORDS_PAGE_SIZE` 250->50 als benannte, gemessene Konstante; Vollstaendigkeit jetzt ueber `meta.total_pages` aus der Antwort statt Vergleich gegen die selbst gesendete `page[size]`). Alle 57 Tests in `telnyx-cost-records.test.js` gruen (`node --test`, per git-archive der Branch-Version + verlinktem `node_modules` lokal ausgefuehrt); die 4 neuen KE-P1-Tests wurden zusaetzlich empirisch als echt rot gegen die alte master-Logik verifiziert (3 von 4 schlagen mit der alten 250er-Logik tatsaechlich fehl, exakt wie in den Test-Kommentaren behauptet — kein D3-Fehler). Alle 5 abhaengigen Testdateien (telnyx-voice, telnyx-call-control, telephony-registry, cost-truing-booking-guard, telnyx-observability-secret-guard = 65 Tests) bleiben gruen, insbesondere der "gewrappte {data:{sid}}"-Test fuer `parseTelnyxResource`/`parseTelnyxBody`. Keine Umlaut-Verstoesse, keine brittle Datei:Zeile-Verweise, kein auskommentierter Code, kein `.skip`/`.only`, keine neuen Magic Numbers ohne benannte+dokumentierte Konstante (`SINGLE_PAGE_TOTAL`, `COST_RECORDS_PAGE_SIZE`, `MEASURED_PAGE_SIZE`). Die neuen Tests nutzen bewusst ein Literal (`MEASURED_PAGE_SIZE=50`), nicht die Produktionskonstante, um genau den D3-Fehler (Test bestaetigt nur die eigene Konstante) zu vermeiden.

**passNotes**: G5 sauber — `parseTelnyxBody()` ist die eine Unwrap-Stelle fuer `{data, meta}`; `parseTelnyxResource()` delegiert nur noch (Bestandsverhalten fuer `originateCall`/`originateViaCallControl` unveraendert, mit Test belegt). Die Vollstaendigkeitspruefung wurde korrekt von `fetchAllCostRecords` (falscher Ort, sah kein `meta` mehr) nach `fetchCostRecordPage` verschoben (richtiger Ort, dort liegt die Antwort) — Kommentar begruendet das explizit mit G31/G5. `isSinglePageResult()` ist eine saubere Pure Function mit klarem Fallback: `meta.total_pages` autoritativ wenn parsebar (ueber die bestehende `parseNonNegativeInteger`, robust gegen String/Number/Provider-Drift), sonst konservativer Fallback auf Seitengroesse — beide Richtungen (voll+`meta>1` -> truncated; voll ohne meta -> truncated; `meta=1` -> vollstaendig) sind je einzeln getestet. Kommentare sind sorgfaeltig, ohne echte Umlaute, ohne Autoren-/Datums-Metadaten (Messungsdaten sind Fachaussagen, kein VCS-Ersatz-Log), keine Widersprueche zum Code gefunden (Stichprobe: "Muster telnyxErrorEnvelope in ./errors.js" verifiziert — existiert dort wirklich). Fail-closed-Richtung im Geldpfad ist konsequent beibehalten und durch die neue Logik eher verschaerft (eine 5-von-212-Seite faellt jetzt korrekt durch, waehrend sie vorher als vollstaendig durchging).

**topTodos** (keine Blocker):
- Optional: ein Testfall fuer `meta` vorhanden aber ohne `total_pages`-Feld (z.B. `meta={total_results:212}`) waere die noch fehlende Variante zum bestehenden "ganz ohne meta"-Test — deckt aber denselben Code-Pfad ab (`parseNonNegativeInteger(undefined)===null`), daher niedrige Prioritaet.
- Kein expliziter Test fuer `total_pages=0` (leere Menge), obwohl im Kommentar bei `SINGLE_PAGE_TOTAL` erwaehnt — verhaelt sich aber identisch zum getesteten `total_pages=1`-Fall (beide `<= 1`), daher keine Mutationsluecke, nur Dokumentations-Vollstaendigkeit.

---

## 7. Fix-Runden

Keine. `=== FIXES ===` ist leer — die Implementierung wurde von Safety und Clean-Code-Audit ohne Nacharbeit freigegeben (beide direkt PASS/FREIGABE im Erstlauf).

---

## 8. Offene Punkte / Deviations

- **Deploy-Sperre (harte Auflage, kein Code-Defekt)**: KE-P1 darf **nicht allein** deployt werden. In Produktion hat `sip-trunking` 212 Ergebnisse -> `total_pages=5` -> ab diesem Fix liefert jeder Sweep `{ok:false, reason:"page_truncated"}` fuer jeden Kandidaten, bis KE-P3 (Seitenschleife) nachzieht. Ohne KE-P3 verbraucht `cost-truing.js` den Versuchszaehler und schliesst die 29 historischen Kandidaten nach `COST_TRUING_MAX_ATTEMPTS` Laeufen dauerhaft auf `failed` (F7: Frist ~24 Laufstunden bei 6-h-Kadenz). Muss in `tasks/ke-DEPLOY-CHECKLIST.md` (KE-P7) als Auflage aufgenommen werden.
- **Worktree-Setup-Defekt** (nicht Teil dieser Phase, aber im Review aufgefallen): `ln -s "./node_modules" node_modules` erzeugt einen Selbst-Symlink und laesst `npm test` wortlos mit `EXIT=194` abbrechen — Korrektur der Setup-Zeile ist offen.
- **Fixture-Nachtrag fuer KE-P2**: Null-Zwilling-Pflicht wurde in KE-P1 nicht gebraucht (keine summenpruefenden Fixtures), ist aber fuer KE-P2 (Aequivalenztest mit exakter Summe je Call) verpflichtend.
- **Kommentar-Praezisierung** (kosmetisch, kein Blocker): der Satz "bei leerer Menge 0" an `SINGLE_PAGE_TOTAL` ist eine Ableitung (`ceil(0/50)`), keine eigene Messung — inhaltlich korrekt, aber im Ton als Messung formuliert.
- **Bekannte, akzeptierte Grenze**: `isSinglePageResult` vertraut `meta.total_pages` als autoritativ; ein in sich widerspruechliches `meta` (z.B. `total_pages=1` bei `total_results=212`) wuerde faelschlich als vollstaendig durchgehen. Das ist Spec-konform gewollt (kein Quer-Check gegen `total_results`/`page_size`, das waere eine zweite Wahrheit) und wird nur als bekannte Grenze dokumentiert, nicht als Defekt.
- **Scope**: keine Safety-Gates, kein Offenlegungssatz, keine Auth/Signaturpruefung, keine Secrets, kein Audio-/MCP-Pfad beruehrt. Kein Deploy, kein Netz im Test, keine neue Dependency, keine neue Env-Variable.
