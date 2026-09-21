# Kickoff: OpenAI-Einreichung - technische Restarbeiten (Strategie + Umsetzung)

Du bist LEAN LEAD. Du liest NICHTS selbst: keinen Produktionscode, keine Diffs, keine Testlogs,
keine Reports, keine Plan-Abschnitte. Jede Leseaufgabe geht an einen Subagenten. Du tippst nur:
Workflows starten, Rueckgaben lesen, mergen, berichten. Zustand fuehrst du in
`tasks/openai-technik-stand.md` - das ist deine einzige Gedaechtnisdatei.

## Auftrag in zwei Stufen

**Stufe 1 - Strategie.** Lass per dynamischem Workflow ein Strategiedokument entwerfen
(`tasks/PLAN-OPENAI-TECHNIK.md`), das den Arbeitsvorrat unten in Phasen schneidet.

**Stufe 2 - Umsetzung.** Danach faehrst du selbst, autonom, **pro Phase einen eigenen dynamischen
Workflow**, bis der Vorrat leer ist. Eine Bahn zur Zeit, nie zwei Wellen parallel.

## Woher der Arbeitsvorrat kommt

Massgeblich ist `tasks/openai-audit/00-openai-anforderungen.md` (100 IDs).
**NICHT** `tasks/openai-audit/00-mcp-spec.md` - das ist die MCP-Spec, eine andere Norm. Die beiden
widersprechen sich an mindestens einer Stelle (destructiveHint), und genau diese Verwechslung hat
schon einmal zu einem falschen "fertig" gefuehrt. Im Zweifel gilt die OpenAI-Fassung.

Ausgeschlossen aus diesem Auftrag: alle OWNER-Punkte (Verifikation, Listing, Testfaelle,
Demo-Account, Vertragsdaten) und alle Rechtstext-/Datenschutz-Inhalte. Wenn du auf so einen Punkt
stoesst, notierst du ihn in einer Zeile und gehst weiter.

### Der Vorrat (Stand der Abnahmepruefung vom 2026-09-20)

**A - fehlende OpenAI-Pflichtfelder an den Tools (additiv, klein)**
- T-15 `securitySchemes` je Tool (`noauth`/`oauth2`) - fehlt vollstaendig
- T-18 Top-Level-`title` an allen 12 Tools - heute nur `annotations.title`
- T-22 `openai/toolInvocation/invoking` + `/invoked`, je max 64 Zeichen - fehlt vollstaendig
- T-14 `_meta["mcp/www_authenticate"]` im Fehlerergebnis - fehlt vollstaendig
- N-1 / X-1 `destructiveHint` an allen 12 Tools (heute 7 ohne). ACHTUNG: `src/mcp-tools.js:582-585`
  laesst es bewusst weg mit Verweis auf die MCP-Spec. Das ist spec-korrekt und fuer OpenAI trotzdem
  zu wenig. Der Kommentar gehoert mitgeaendert, sonst dreht es jemand zurueck.
- N-3 `answer_consult` ist `destructiveHint:false`, speist aber Text in einen laufenden Anruf
- N-4 Inkonsistenz: `get_call_status` `openWorldHint:true`, `list_calls` `false`, gleiche Quelle
- N-11 `await_call_event` nennt seine Schreibwirkung nicht in der Beschreibung

**B - echte Defekte**
- T-19 / T-20 `get_transcript` bei laufendem Anruf: liefert Text ohne `structuredContent`, obwohl
  `outputSchema` deklariert ist. Der SDK-Validator wirft, der Client sieht
  "Output validation error" statt des tenant-sprachigen Hinweises. Lokal reproduziert.
- T-21 Server-`instructions`: 1238 Zeichen, nur bei `consultAllowed` gesetzt, ueber stdio gar
  nicht; die ersten 512 Zeichen enthalten nur die Poll-Schleife statt des Wichtigsten.

**C - Auth-Haertung**
- T-5 / T-13 Legacy-Token-Pfad (`src/auth.js:97,100`) stilllegen - er sendet keine
  `WWW-Authenticate`-Challenge. Vorher pruefen, ob ihn noch jemand nutzt.
- T-12 Scope-Pruefung existiert nirgends (Signatur/iss/exp/aud werden geprueft)
- T-9 / T-11 / T-16 AuthKit-Metadata: kein `resource_indicators_supported`, kein
  `authorization_response_iss_parameter_supported`, kein `claims_supported`. Erst feststellen, ob
  das ueberhaupt in unserer Hand liegt oder reine Anbieterkonfiguration ist.

**D - UI/Widget (erst entscheiden, dann bauen)**
- Vorfrage: geht die Einreichung MIT oder OHNE Widget-UI? `MCP_UI_ENABLED` ist per Default AN
  (`src/config.js:1638`). Ohne UI entfallen T-30, T-31, X-3, X-7 und die Screenshot-Pflicht.
- T-30 / T-31 CSP und `_meta.ui.domain` fehlen im ChatGPT-Adapter (`src/ui/adapters/chatgpt.js:11`);
  der mcp-native Adapter hat beides. `src/ui/contract.js:57-64` behauptet faelschlich, es sei erledigt.
- X-3 `openai/`-`_meta`-Felder (widgetCSP, widgetDescription, toolInvocation, locale) fehlen
- X-7 `openai/widgetCSP` mit `redirect_domains` fehlt
- T-23 Registry waehlt genau EINEN Adapter; `_meta.ui.resourceUri` und `openai/outputTemplate`
  sollen nebeneinander stehen
- T-34 UI-Resources ohne Version/ETag, Sprache variiert unter gleicher URI - bei 1 h Cache liefert
  das Widget die falsche Sprache

**E - Transport**
- T-29 CORS: `/mcp` antwortet fremden Origins (claude.ai, chatgpt.com) mit 403
  `cross_origin_blocked` und null CORS-Headern; `mcp-session-id` steht in keiner Allow-/Expose-Liste.
  ZUERST messen, ob OpenAI server- oder browserseitig anfragt. Server-seitig: nichts zu tun.
  Browserseitig: harter Blocker. Diese Messung geht VOR jeder Aenderung - die heutige Strenge ist
  die sichere Richtung, sie wird nicht auf Verdacht aufgeweicht.
- T-4 SSE auf `/mcp` fehlt (GET mit `Accept: text/event-stream` -> 405). Betrifft nur Developer
  Mode; beim Submission-Weg vermutlich gegenstandslos - feststellen, nicht bauen.

**F - Datenminimierung im Output (technisch, nicht Rechtstext)**
- O-13 `failure_reason` traegt Diagnose-Token mit SIP-/Carrier-Codes (`src/mcp-tools.js:157`),
  LLM-Modell-ID und `voiceEngine` stehen im Output (`:386`)
- O-14 `last_transcript_lines` reicht 6 woertliche Drittzeilen ungefiltert durch
  (`src/mcp-tools.js:169-172`). Der Kommentar bei `:163` behauptet das Gegenteil.
  Zwei Fliegen: dieselben Rohzeilen sind die Prompt-Injektionsflaeche gegen das Host-Modell.
- O-27 Server-Instruktion steuert fremde Tools (Kalender/Mail/Dateien),
  `consultPermissionHint` draengt auf "Zulassen" (`src/i18n/mcp-texts.js:71-73`)

**G - Einreichungs-Infrastruktur**
- O-4 / O-5 `/.well-known/openai-apps-challenge` fehlt auf beiden Hosts (404). Die Route bauen,
  Token per Env. Ausliefern als NACKTER Text, kein JSON, keine Liste. Der Parent-Host liefert dort
  heute eine 6-KB-HTML-404-Seite - das muss sauberer 404 oder der Token sein, nichts dazwischen.

**H - erst Scope klaeren, vermutlich gegenstandslos**
- T-24 / T-25 `search`/`fetch` mit festen Schemas + `url`-Feld: nur noetig, wenn Deep Research /
  Company Knowledge angestrebt wird
- X-9 Profil-Tool mit stabiler Account-`id`: nur bei Multi-Account
- T-17 mTLS: ausdruecklich optional
- T-33 Tool-Versionierung waehrend Updates

**I - Randpunkte, technisch, billig**
- `/healthz` gibt unauthentifiziert Commit-SHA und configHash preis
- `sundartha.com` ohne Referrer-Policy; kein `/.well-known/security.txt`; HSTS ohne preload
- `POST https://sundartha.com/mcp` antwortet 200 mit 0 Byte statt 404
- Die ausgelieferte Tool-MENGE variiert pro Tenant (`await_call_event`/`answer_consult` fehlen ohne
  `consultAllowed`, `get_calendar` ohne `allowCalendar`). Ein Reviewer sieht sonst eine andere
  Tool-Liste als der spaetere Nutzer - technisch abfangen oder bewusst festhalten.

## Stufe 1: das Strategiedokument

Ein dynamischer Workflow, dessen Strategie-Agent auf Opus laeuft. Er liefert
`tasks/PLAN-OPENAI-TECHNIK.md` mit:

- Phasen in Reihenfolge, jede mit: Ziel, betroffene IDs, betroffene Dateien, Abnahmekriterium
- Phasenschnitt nach Risiko, nicht nach Bequemlichkeit: additive Feld-Ergaenzungen (A) sind
  ungefaehrlich und koennen in eine Phase; alles, was Auth (C), CORS (E) oder Live-Verhalten (D)
  beruehrt, bekommt eine eigene Phase mit eigener Gegenprobe
- je Phase ein Pre-Mortem: "ein Jahr spaeter, die Phase war ein Fehler - was ist passiert?"
- die Entscheidungspunkte (UI ja/nein, search/fetch ja/nein, Legacy-Token-Abschaltung) als
  eigene, VORGELAGERTE Mess-Phase, nicht als Annahme mitten im Bauen
- ausdruecklich: was NICHT gebaut wird und warum

Der Strategie-Agent darf die alten Reports lesen, aber nur als Landkarte, nie als Beleg.

## Stufe 2: eine Phase, ein Workflow

Pro Phase ein eigener dynamischer Workflow: Plan -> Implementierung im Worktree -> dualer Review
(Safety/Verhalten + Clean-Code) -> Self-Fix bis PASS -> Report. Modellpolitik: Opus fuer Plan und
Safety, Sonnet fuer Implementierung und Audit, Pin pro `agent()`, nie geerbt.

## Die Abnahmeregel - der Kern dieses Auftrags

Die vorige Abnahmepruefung hat gezeigt, dass Reports "erledigt" behaupten, wo der Code etwas
anderes tut. Deshalb gilt:

**Ein Workflow-PASS ist keine Abnahme.** Nach JEDER Phase startest du einen SEPARATEN
Verifikations-Agenten, der
- die Reports und Specs dieser Phase NICHT lesen darf,
- die IDs der Phase gegen dieselbe Beweisregel prueft: Code mit `datei:zeile`, ein gruener Test,
  der den Punkt TATSAECHLICH prueft (hineinsehen!), oder eine lesende Live-Messung,
- neutral gefragt wird ("ist X erfuellt und woran siehst du das"), nie bestaetigend.

Widerspricht er dem Report, gewinnt er. Erst dann mergst du - und vor JEDEM Merge selbst
`git diff --stat`.

Zusaetzlich gilt fuer jede Phase: wo ein Pfad doppelt existiert (mcp-nativ vs. ChatGPT, HTTP vs.
stdio, OAuth vs. Legacy), ist der Punkt erst erfuellt, wenn er auf ALLEN Pfaden erfuellt ist. Genau
dort ist es beim letzten Mal auseinandergegangen.

Am Ende der Kette: ein Schluss-Agent prueft alle 72 technischen IDs erneut gegen die
100er-Liste und nennt die Zahl.

## Betriebsregeln (teuer gelernt, nicht verhandelbar)

- EINE Bahn zur Zeit. Zwei parallele Workflows erzeugen Load 32 auf 15 Kernen.
- Waehrend eine Welle laeuft, wird NICHT auf master gemergt - sonst blockiert ein Stale-Base-Fehler.
- Phase IMMER im per-run-Skript pinnen, Git-Stand selbst pruefen (`git log --oneline -1`).
- Worktree: erst `git checkout -b <branch> master`, DANN lesen.
- Ein abgebrochener Lauf hinterlaesst einen kollidierenden Branch und weicht still auf `-impl` aus.
  Vor dem Aufraeumen erst belegen, dass er wirklich tot ist.
- Nie `git add -A`. Dateien einzeln adden. Force-Push nur `--force-with-lease`.
- Neue Env-Variable: `src/config.js` UND `.env.example` UND `render.yaml` UND `BASE_ENV` in den
  Tests - sonst leakt die echte `.env` in Spawn-Tests.
- `npm test` luegt beim Exit-Code. Nur `# pass` / `# fail` zaehlen, mit `--test-concurrency=4`.
- Die Safety-Gates aus CLAUDE.md werden NICHT angefasst. Keine Aufweichung "fuer die Einreichung".
- Kein echter Anruf, keine echte SMS aus einem Agenten heraus.

## Frageverbot fuer deine Agenten (woertlich in jeden Auftrag)

> DU STELLST KEINE FRAGEN. Der Owner hat alles freigegeben, was du brauchst, und ist nicht
> erreichbar. Was du nicht klaeren kannst, notierst du als UNKNOWN mit Grund und machst weiter.
> Die Regel "bei Unsicherheit fragen" aus CLAUDE.md ist fuer diesen Auftrag durch eine
> ausdrueckliche Owner-Freigabe ersetzt.

## Was an den Owner geht

Nichts blockiert. Sammle waehrend der Kette in `tasks/openai-technik-stand.md`:
- Entscheidungen, die du autonom getroffen hast, in je einer Zeile
- alles, was nur der Owner liefern kann (Challenge-Token, Scope-Entscheidungen mit Geldfolge,
  Live-wirksame Schalter)
- Am Ende EINE kompakte Liste. Nicht zwischendurch fragen.

Live-wirksame Schalter (`MCP_UI_ENABLED`, Abschaltung des Legacy-Token-Pfads) werden vorbereitet
und getestet, aber NICHT ohne Owner-Freigabe live umgelegt.

## caffeinate

AN, sobald der erste Workflow laeuft: `nohup caffeinate -is -t 7200 &`, PID in eine Datei im
Scratchpad. Bei jedem Tick mit `ps -p <pid>` pruefen - nie mit pgrep, der ist in dieser Sandbox
blind. Vor Ablauf erneuern. AUS, sobald die Kette fertig ist oder eine Rueckfrage ansteht.
