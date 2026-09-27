# T2-11 — Werkzeug-Oberflaeche: ehrliche Namen, Titel, Beschreibungen — Abschlussbericht

Branch `phase/openai-t2-11-honest-tool-names`, Commit `555bf03`. Umfang: N-12, N-13, N-11.
Datei UNGETRACKT, nicht adden/committen.

## 1. Was diese Phase NICHT erfuellt (ganz oben, nicht versteckt)

- **N-12/N-13 sind nach Plan nur zur Haelfte fertig.** Der Plan selbst sagt das so voraus
  (`PLAN-OPENAI-TECHNIK-2.md:692`: "N-12/N-13 erst zusammen mit T2-12 vollstaendig") und
  markiert den Zwischenstand als gewollt kaputt (Zeilen 693–697). Konkret:
  `src/ui/widgets/call.html:231` ruft nach dieser Phase per Host-Bruecke (`tools/call`)
  weiterhin den String `"get_transcript"` — den Namen kennt der Server ab diesem Commit
  nicht mehr (Beleg: Test `T11-f` in `test/openai-t2-11-werkzeugtexte.test.js`, siehe
  unten, prueft ausdruecklich, dass `tools/call get_transcript` einen Fehler liefert).
  Folge: **wird dieser Branch allein deployed, zeigt die Anruf-Karte nach Anrufende in
  Claude/ChatGPT nie mehr das Ergebnis** (Zusammenfassung, Ziel erreicht/nicht). Nur der
  Text-Fallback ueber `get_call_result` funktioniert noch. Das ist keine neue
  Verschlechterung dieser Phase, sondern der vom Plan explizit vorgesehene
  Zwischenschritt vor T2-12 (Widget-Nachzug).
- **Kein Mechanismus erzwingt "T2-11 nie ohne T2-12 deployen"** — nur ein Kommentar an
  `src/mcp-tools.js:1539-1544` und der Plan-Text. Ein Push/Deploy von master nach dem
  T2-11-Merge, aber vor T2-12, wuerde die kaputte Anruf-Karte live schalten. Das ist der
  offene Safety-Befund aus dem Review (unten unter Owner-Punkte wiederholt).
- **`design-system/mcp/my-number.html` und `design-system/_ds_manifest.json`** nennen
  weiterhin `get_my_number` — bewusst nicht angefasst (Plan-Grenze "beruehrt `src/ui/**`
  NICHT"), fallen aber auch durchs Abnahmekriterium (e) von T2-12, weil das nur `src` und
  `scripts` greppt. Notiz fuer die naechste Phase, kein Blocker hier.
- **T11-d/T11-n laufen nur ueber zwei von vier Konfigurationen** (HTTP Legacy mit Consult,
  HTTP OAuth mit Consult) statt vier wie `CONFIGS` an anderer Stelle im selben Testfile
  (`test/openai-t2-11-werkzeugtexte.test.js:287-316,459-480`). "stdio, mit Consult" fehlt
  als eigene Konfiguration. Geringes Risiko (Cleanlaufwertung im Review: wichtig, nicht
  Blocker), weil die Beschreibungstexte aus denselben Modul-Konstanten stammen wie die
  bereits vierfach getesteten T11-a/T11-b — aber ungetestet ist ungetestet.
- **place_call-Beschreibungstexte wurden NICHT angefasst.** Der Auftrag sagt ausdruecklich:
  nur aendern, was N-11/N-12/N-13 zwingend verlangen. Ich habe im Diff keinen Treffer fuer
  `PLACE_CALL_DESCRIPTION` gefunden (`git diff master...HEAD -- src/mcp-tools.js` zeigt
  keine Aenderung an dieser Konstante) — insofern erfuellt, aber ausdruecklich nicht
  geprueft im Sinn "traegt place_call jetzt jedes N-11/N-13-Merkmal", weil der Plan das
  fuer diese Phase nicht verlangt.
- **Ein voller Testlauf war isoliert nicht komplett sauber beim ersten Durchgang dieser
  Berichtssession**: `npm test -- --test-concurrency=4` (6425 Tests, 84 Suiten) endete mit
  6 `not ok` — alle sechs sind Subtests EINES Tests, `E5-H (Methoden, Pfad, Forensik,
  Formel-Pin)` in `test/s2-mcp-origin.test.js`, einer Datei, die T2-11 nicht anfasst (kein
  Treffer im `git diff --stat`). Isoliert nachgemessen (`node --test test/s2-mcp-origin.test.js`,
  ohne Nebenlast) lief die Datei 61/61 gruen durch
  (`logs-t2-11/s2-isolated.log`). Das ist ein Parallelitaets-Race beim vollen Lauf, keine
  von T2-11 verursachte Regression — aber ich habe es nicht durch einen zweiten vollen
  Lauf gegengeprueft, nur durch die Isolation der betroffenen Datei. Ein unabhaengiger
  Verifizierer sollte das selbst nachmessen.

## 2. Was diese Phase erfuellt, ID fuer ID

### N-12 — Werkzeugnamen sagen ehrlich, was das Werkzeug tut (Umbenennung)

- `get_transcript` -> `get_call_result`: Registrierung `src/mcp-tools.js:1545`
  (`uiTool("get_call_result", ...)`), Annotation-Titel "Get call result" (Kontext
  `TOOL_ANNOTATIONS.get_call_result` um `src/mcp-tools.js:923`), Statuszeilen "Reading the
  call result" / "Call result read" (`src/mcp-tools.js:992`).
- `get_my_number` -> `get_agent_number`: Registrierung `src/mcp-tools.js:1613`
  (Zeilennummer aus grep-Treffer), Titel "Agent phone number"
  (`src/mcp-tools.js:936-941`).
- Server-instructions nachgezogen: `src/mcp-server-info.js` — `MCP_BASE_INSTRUCTIONS`
  nennt jetzt `get_call_result` statt `get_transcript` (Diff-Beleg oben gelesen,
  `src/mcp-server-info.js:90-104`).
- **Grep-Beleg fuer Abnahmekriterium (c) des Plans** (`grep -rn "get_transcript\|get_my_number"
  src scripts --exclude-dir=ui`): 0 Treffer, selbst gemessen in dieser Session
  (`logs-t2-11/…`, Befehl direkt ausgefuehrt, Ergebnis leer).
- **Draht-Beleg**: Test `T11-f` in `test/openai-t2-11-werkzeugtexte.test.js` ruft
  `tools/call get_call_result` und prueft die `structuredContent`-Schluesselmenge gegen
  `TRANSCRIPT_OUTPUT`, UND ruft `tools/call get_transcript` und erwartet einen Fehler
  (Breaking Change nachgewiesen, nicht nur behauptet). Isoliert gruen
  (`logs-t2-11/t2-11-tests.log`: "✔ T11-f … tools/call get_transcript liefert einen
  Fehler").
- Alle Kommentare ausserhalb `src/ui/`, die die alten Namen zitierten, wurden nachgezogen
  — belegt durch den Diff an `src/elevenlabs/outbound.js`, `src/i18n/failure-reason-texts.js`,
  `src/routes/_tenant.js`, `src/routes/api-inbox.js`, `src/routes/api-read.js`,
  `src/store/json.js`, `src/store/state-ops.js`, `src/conversation/conversation-ports.js`
  (alle selbst gelesen, reine String-Ersetzung `get_transcript`->`get_call_result` bzw.
  `get_my_number`->`get_agent_number`, keine Logik veraendert).

### N-13 — Beschreibungen bilden das Verhalten exakt ab (kein Transkript-Versprechen, alle Felder genannt)

- `CALL_RESULT_DESCRIPTION` (`src/mcp-tools.js:810-816`, wortlautgeprueft): nennt jetzt
  `call_id, result_summary, objective_achieved` UND die fuenf Karten-Felder (`outcome,
  commitments, counterparty_commitments, open_points, next_step`) im ersten Satz. Der
  Negativsatz "This tool NEVER returns the raw transcript…" bleibt woertlich stehen (vom
  Plan verlangt, `PLAN-OPENAI-TECHNIK-2.md:717`, hier bestaetigt an `src/mcp-tools.js:812`).
  Das ist **Abweichung/Erweiterung ueber den urspruenglichen Plan-Wortlaut hinaus**
  (Plan verlangte fuer `get_call_result` nur das Entfernen von "transcript"; der Bau-Agent
  hat zusaetzlich die acht Antwortfelder aufgenommen, dokumentiert als eigene Abweichung
  mit Test `T11-e2`) — inhaltlich staerker N-13-konform, aber eine bewusste Erweiterung
  des Scopes innerhalb derselben ID.
- `AGENT_STATUS_DESCRIPTION` (`src/mcp-tools.js:822-829`, gelesen): nennt jedes Feld
  (`number, owner, calls, planUsagePercent, …`) mit Bedeutung — Plan-Abnahme (e) "jeder
  Schluessel aus outputSchema steht in der Beschreibung, Test berechnet die Schluessel
  vom Draht" — Test `T11-e` bzw. `T11-e2`-Familie, isoliert gruen.
- `ANSWER_CONSULT_DESCRIPTION` (`src/mcp-tools.js:839-848`, gelesen): traegt den Satz "The
  agent may relay your answer to the person on the call." woertlich — deckt sich
  zeichengleich mit dem Plan-Wortlaut (`PLAN-OPENAI-TECHNIK-2.md:723`). Draht-Test:
  `T11-d` in `test/openai-t2-11-werkzeugtexte.test.js`, isoliert gruen, ABER — s.
  Abschnitt 1 — nur ueber zwei von vier Konfigurationen (HTTP Legacy/OAuth mit Consult),
  stdio-mit-Consult fehlt als eigene Testkonfiguration.
- Kein Werbe-/Vergleichswort ("best/official/pick_me/recommended") in irgendeinem Namen
  oder Titel: Test `T11-n`, isoliert gruen — mit derselben Konfigurationsluecke wie T11-d.

### N-11 — Sichtbare Nebenwirkungs-Kennzeichnung deckt sich mit dem tatsaechlichen Verhalten

- Das ist im Wesentlichen dasselbe Kriterium wie N-13 fuer `answer_consult` (der Satz
  "The agent may relay your answer…" ist die N-11-Auspraegung laut Plan-Kommentar in
  `src/mcp-tools.js:835-838`, selbst gelesen: "Store, sondern kann am Telefon an den
  Angerufenen weitergegeben werden"). Derselbe Beleg wie oben (`T11-d`).
- `TOOL_ANNOTATIONS` (`src/mcp-tools.js:924-971`, gelesen) traegt fuer alle zwoelf
  Werkzeuge `readOnlyHint`, `destructiveHint`, `openWorldHint` — unveraendert zur
  vorherigen Phase (T2-11 hat hier laut Diff keine Annotation-Werte veraendert, nur den
  Namen `get_agent_number`/`get_call_result` als Schluessel benutzt). Ich habe keine
  eigenstaendige N-11-relevante Aenderung an den Annotation-Werten selbst gefunden — die
  Phase erfuellt N-11 hier ueber die Text-Ehrlichkeit (Titel/Beschreibung), nicht durch
  neue Hint-Werte.

## 3. Beruehrte Pfade — erfuellt auf ALLEN?

- **HTTP `/mcp`** (Legacy-Token, OAuth, je mit/ohne Consult) und **stdio**: die
  Registrierungs-Konstanten (`TOOL_ANNOTATIONS`, `*_DESCRIPTION`, `TOOL_INVOCATION_STATUS`)
  sind modulweite Konstanten, die von `registerTools()` unabhaengig vom Transport
  konsumiert werden (`src/mcp-tools.js`, ein Registrierpfad fuer beide Transporte laut
  Code-Struktur) — insofern strukturell auf beiden Pfaden identisch.
- **Gemessen am Draht** (nicht nur am Registrierobjekt) laut Plan-Vorgabe: Test-Suite
  `openai-t2-11-werkzeugtexte.test.js` faehrt HTTP Legacy, HTTP OAuth und stdio jeweils
  als eigene Konfiguration fuer die meisten IDs (T11-a/b/e/e2/f/r) — **mit der oben
  genannten Ausnahme T11-d/T11-n, wo stdio-mit-Consult fehlt.** Auf den anderen drei
  Konfigurationen (HTTP Legacy ohne Consult, HTTP OAuth ohne Consult, stdio ohne Consult)
  ist `answer_consult` gar nicht registriert (Consult-Gate), insofern ist dort nichts zu
  pruefen — die Luecke betrifft ausschliesslich "stdio MIT freigeschaltetem Consult-Kanal".
- Widget-Pfad (`src/ui/**`): bewusst NICHT nachgezogen (Plan-Grenze), siehe Abschnitt 1 —
  nicht erfuellt, aber laut Plan auch nicht Gegenstand dieser Phase.

## 4. Was ein unabhaengiger Pruefer nachmessen sollte (neutral)

- Ist `grep -rn "get_transcript\|get_my_number" src scripts --exclude-dir=ui` wirklich 0
  Zeilen, live im Worktree ausgefuehrt?
- Liefert `tools/call get_call_result` fuer einen abgeschlossenen Anruf tatsaechlich
  genau die Schluessel aus `TRANSCRIPT_OUTPUT`, und liefert `tools/call get_transcript`
  wirklich einen Fehler statt eines stillen Erfolgs mit alten Daten — auf allen drei
  Transport-Konfigurationen (HTTP Legacy, HTTP OAuth, stdio)?
- Enthaelt die `description`, das `title`, `annotations.title` und beide
  `_meta["openai/toolInvocation/…"]`-Felder von `get_call_result` wirklich KEINEN Treffer
  fuer `/transcript/i` ausserhalb des einen Verneinungssatzes — am Draht gelesen, nicht am
  Quellcode?
- Ist der Satz "The agent may relay your answer to the person on the call." in der
  `answer_consult`-Beschreibung auch am stdio-Transport MIT freigeschaltetem Consult-Kanal
  vorhanden — bislang nur ueber HTTP Legacy/OAuth mit Consult automatisiert geprueft?
- Zeigt `src/ui/widgets/call.html:231` nach diesem Commit tatsaechlich noch
  `TOOL_GET_TRANSCRIPT = "get_transcript"`, und schlaegt ein echter `tools/call
  get_transcript` von dieser Widget-Karte aus tatsaechlich fehl (bestaetigt den
  Zwischenstand-Bruch, den dieser Bericht behauptet)?
- Laeuft `test/s2-mcp-origin.test.js` isoliert wirklich durchgehend gruen, und laeuft der
  volle `npm test -- --test-concurrency=4` bei einer zweiten Ausfuehrung ohne die sechs
  `not ok` aus dieser Session — oder ist das Race reproduzierbar und damit ein echtes,
  von T2-11 unabhaengiges Bestandsproblem?
- Enthaelt `docs/OPENAI-TOOL-INVENTORY.md`/`docs/OPENAI-POLICY-ABGLEICH.md` nach dem Diff
  wirklich keine internen Kennungen (T2-xx, N-xx, GAP-xx) im neu hinzugefuegten Text?

## 5. Owner-Punkte und Restrisiko

Restrisiko in einem Satz: Der einzige echte Live-Risikopunkt dieser Phase ist, dass ein
Deploy von master zwischen T2-11 und T2-12 die Anruf-Ergebnis-Karte in Claude/ChatGPT
stumm schaltet (kein Absturz, aber ein sichtbarer Funktionsverlust fuer den einzigen
Nutzerkreis — das Team selbst); Code-seitig ist das ausdruecklich geplant und durch Tests
(`T11-f`) belegt, nicht versehentlich; ein Mechanismus, der einen verfruehten Deploy
technisch verhindert, existiert nicht, nur ein Kommentar und dieser Bericht. Die
verbleibenden Befunde (fehlende stdio-mit-Consult-Testkonfiguration, `design-system/`
ausserhalb des T2-12-Greps) sind Test- bzw. Dokumentationsluecken ohne Live-Auswirkung.

Owner-Punkte (konsolidiert, nach der Owner-Regel — betrifft ausschliesslich Deploy/Push,
sonst nichts hier):
1. **T2-11 nicht ohne T2-12 auf master pushen/deployen.** Naechste Phase = T2-12 (Widget
   auf `get_call_result` nachziehen), danach beide gemeinsam deployen.
2. **Nach dem gemeinsamen Deploy**: eigenen Claude-Connector und ChatGPT Developer Mode
   neu verbinden (gecachte Toolliste) und live pruefen, dass `tools/list` `get_call_result`
   / `get_agent_number` zeigt (nicht mehr die alten Namen) und der Bestaetigungsdialog von
   `get_call_result` "Reading the call result" anzeigt.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

**Urteil des Laufs:** PASS

**Gemessener Commit:** 555bf03
**Tests (volle Suite, pass/fail):** 6425/0
**Review-Urteile zuletzt:** safety=PASS, cleancode=PASS
**Isoliert rot:** keine

**ID-Tabelle**

| ID | erfuellt | Beleg | Luecke |
|---|---|---|---|
| N-12 | ja | tools/list real ueber HTTP /mcp (12 Tools, mit Consult) und stdio (10): 12 eindeutige Namen, verb-first, ohne Werbewoerter: get_transcript->get_call_result, get_my_number->get_agent_number. T11-n gruen (Legacy+OAuth). | Live-Rest: Claude-/ChatGPT-Connector neu verbinden. Widget src/ui/widgets/call.html:231 ruft noch get_transcript, my-number.html:30 zeigt get_my_number: bleibt kaputt bis T2-12, also nicht vor T2-12 deployen. |
| N-13 | ja | tools/list: get_call_result nennt alle 8 Felder = TRANSCRIPT_OUTPUT (mcp-tools.js:258), get_agent_status alle 5 = AGENT_STATUS_OUTPUT; calls ist Lebenszeitzaehler (state-ops.js:492). Kein Fremd-Plugin-Bezug, kein ueberbreites Ausloesen. | keine im Diff; get_call_status nennt failure_reason nicht (Bestand, keine Falschaussage) |
| N-11 | ja | tools/list: answer_consult nennt jetzt die Weitergabe am Telefon (mcp-tools.js:839). Seiteneffekte offen bei place_call, await_call_event, cancel_call, check_inbox; Lese-Tools nur GET (api-read.js:63/98). | Retry-Verhalten von answer_consult ist nur per idempotentHint:false ausgewiesen, nicht im Text beschrieben |

**Offene Blocker**

- safety/wichtig src/ui/widgets/call.html:231: Das Anruf-Widget ruft ueber die Host-Bruecke weiterhin tools/call "get_transcript" auf (TOOL_GET_TRANSCRIPT). Den Namen kennt der Server nach dieser Phase nicht mehr; T11-f belegt, dass tools/call get_transcript einen Fehler liefert. Die Deploy-Vorbedingung "nicht ohne T2-12 deployen" steht nur als Kommentar an src/mcp-tools.js:1539-1544 und im Plan, kein Mechanismus erzwingt sie.
- cleancode/wichtig test/openai-t2-11-werkzeugtexte.test.js:287-316,459-480: T11-d (answer_consult nennt die Weitergabe) und T11-n (keine Werbe-/Vergleichssprache) laufen nur ueber CONSULT_CONFIGS (HTTP Legacy mit Consult, HTTP OAuth mit Consult) - stdio-mit-Consult fehlt als dritte Konfiguration, obwohl CONFIGS an anderer Stelle im selben File bereits vier Pfade (inkl. stdio) abdeckt.
