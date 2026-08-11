# P2 — Vorher-Messung auf deepseek-v4-pro

Phase P2 aus `tasks/PLAN-WERKZEUGWAHL.md`. Reine Messung, **kein Produktivcode
geaendert**. Basis-Commit `1b73809017bb95858aa57029ff0e17dfc087fb32` (Stand nach P0/P1
auf `phase/werkzeugwahl`, exakt der Code-Stand, gegen den die 20 Laeufe unten liefen)
plus zwei neue Bench-Szenario-Dateien dieser Phase (s. u.).

**Hinweis Nebenlaeufigkeit:** waehrend dieser Messung lief, hat eine parallele Session
`3886a1351918cf9bd15dd86a7a8cb8ba7034a69f` (P6, `allowLookup` fuer bezahlte Tarife
freigeschaltet) auf denselben Branch committet. Diese Aenderung betrifft ausschliesslich
`PAID_PLAN_PROFILE` in `src/plans.js` und ist fuer diese Messung irrelevant — alle 20
Laeufe hier laufen unter dem Owner-Tenant, dessen Profil `resolveProfileFrom` hart auf
`OWNER_PROFILE` pinnt und `PAID_PLAN_PROFILE` nie liest (R2, `src/store/defaults.js`).

---

## 1. Exakte Konfiguration

| | |
|---|---|
| Commit-Basis | `1b73809017bb95858aa57029ff0e17dfc087fb32` (Branch `phase/werkzeugwahl`) |
| Anbieter | `LLM_PROVIDER=deepseek` |
| Modell | `CLAUDE_MODEL=deepseek-v4-pro` (bestaetigt im Report-Feld `meta.agent_model`/`meta.llm_provider` jedes einzelnen der 20 Laeufe) |
| Persona-Modell | `claude-haiku-4-5` (Anthropic, Gegenseiten-Simulation) |
| Judge-Modell | `claude-sonnet-5` (Anthropic) |
| Treiber | `shim` (Telnyx-Assistant-Pfad, `DEFAULT_DRIVER_ID`, live laufender O1-Pfad) |
| Telefonie-Provider | `telnyx` (Bench-Fake, kein echter Anruf) |
| Tenant | Bootstrap-/Owner-Tenant (`BOOTSTRAP_TENANT_ID`) — **kein** Paid-Plan-Tenant |
| Profilrechte | `OWNER_PROFILE`: `allowLookup:true`, `allowConsult:true` (hart gepinnt, `src/store/defaults.js` R2) |
| Env (Szenario) | `ASSISTANT_CONTEXT_ENABLED=true`; Consult-Szenarien zusaetzlich `CONSULT_ENABLED=true`, `IN_CALL_CONSULT_ENABLED=true`; Lookup-Szenarien `LOOKUP_ENABLED=true`, `EXA_API_KEY=<bench-dummy>` |
| `MAX_BUDGET_EUR` (Bench) | `20` |
| Wiederholungen | n=5 je Szenario (20 Laeufe gesamt) |
| Turn-Cap | `maxTurnsCap=10` (globale Kosten-Bremse, wie CLI-Default) |

**Wichtige Abweichung vom Live-Zustand, bewusst:** Diese Messung laeuft unter dem
Owner-Tenant-Profil (`allowLookup:true`). Der aktuell reale Paid-Plan-Tenant hat
`allowLookup:false` (W1, `tasks/befund-toolwahl-2-angebot.md`/`-4-forensik.md`) — dort
ist `look_up` strukturell unerreichbar, unabhaengig von der Modellwahl. Diese Messung
beantwortet NICHT "was passiert heute live", sondern "wie waehlt `deepseek-v4-pro`
zwischen den Werkzeugen, wenn sie ihm angeboten sind" — exakt die Frage, die P2 laut
Plan zu klaeren hat (P4 kommt danach). Alle vier Szenarien laufen deshalb bewusst
unter dem Owner-Tenant, genau wie die drei Bestands-d3-Szenarien es bereits taten
(kein Szenario nutzt bisher `scenario.tenantId`/`scenario.profile`).

## 2. Messkette und neue Dateien dieser Phase

- **Neu (Repo, committet):** `scripts/convo-bench/scenarios/d3-consult-implizit.mjs` —
  IMPLIZIT-Variante des Consult-Falls (Terminvorschlag ausserhalb des Mandats, OHNE
  ausdrueckliche Rueckfrage-Aufforderung der Gegenstelle), registriert in
  `scripts/convo-bench/scenarios/index.mjs`. Die EXPLIZIT-Variante existierte bereits
  (`d3-consult-verlangt`, aus der D3-Kette) und wurde unveraendert wiederverwendet —
  beide Szenarien sind bis auf den Nutzer-Satz und die Persona-Anweisung
  byte-identisch (gleiches Mandat, gleiches Angebot: Donnerstag statt Mo/Di/Mi, 95 statt
  60 Euro), damit der Unterschied EXPLIZIT/IMPLIZIT die einzige Variable ist.
- **Neu (Scratchpad, KEIN Produktivcode):**
  `/private/tmp/.../scratchpad/instrumented-run.mjs` — transkribiert
  `scripts/convo-bench/runner.mjs#runScenarioRepeat` fast 1:1 (dieselben exportierten
  Bausteine: `startServer`/`seedState`/`seedCall`, `DRIVERS`, `nextCalleeTurn`,
  `runChecks`, `parseMetricsLog`, `judgeConversation`, `buildEnv`, `benchTenantsFor`)
  und ergaenzt GENAU eine Sache: eine Lese von `srv.stdout` auf die UNCONDITIONAL
  `[telnyx-shim] turn_ok`-Zeile, um `offeredToolNames` je Turn zu protokollieren — das
  ist der einzige fachliche Unterschied zum echten Bench-Report, der dieses Feld NICHT
  persistiert (nur `[metrics] turn` landet in `metricsParsed`, `turn_ok` ist ein
  separater Log-Kanal, `src/telnyx-llm-shim.js:324/347`). Begruendung fuer den
  Scratchpad-Umweg statt einer Aenderung an `runner.mjs`: die Phasenweisung verbietet
  Produktivcode-Aenderungen in P2 explizit ("Du misst.").
  `/private/tmp/.../scratchpad/probe-offered-tools.mjs` — kleinere Ein-Turn-Vorabprobe,
  die dieselbe Notwendigkeit zuerst aufgezeigt hat (verworfen zugunsten des
  vollstaendigen `instrumented-run.mjs`, weil eine einzelne Turn-Probe die W5-Flackerei
  von `get_consult` nicht zuverlaessig genug beobachtet).
- **Rohdaten (gitignored, im Repo abgelegt fuer Nachvollziehbarkeit):**
  `data/convo-bench/werkzeugwahl-vorher-2026-08-11/<scenario>/<scenario>-r<n>.json`
  (20 vollstaendige Reports inkl. Transkript, Checks, Metriken, `offered_tool_names_by_turn`)
  + `AGGREGATE-SUMMARY.txt` (Aggregation). `data/` ist projektweit `.gitignore`t —
  bleibt lokal, wird NICHT committet, ist aber im Arbeitsbaum auffindbar (nicht nur im
  Scratchpad, das die Session ueberlebt nicht zwingend).

## 3. Pflicht-Positivkontrolle: war das Werkzeug angeboten?

Jeder der 20 Laeufe traegt `offered_tool_names_by_turn` — die je Turn tatsaechlich vom
Server geloggten `offeredToolNames` aus der unconditional `[telnyx-shim] turn_ok`-Zeile
(PII-frei, Werkzeug-NAMEN, kein Text). Ergebnis, **je Szenario ueber alle 5 Laeufe** (vier Szenarien x 5 Wiederholungen):

| Szenario | Ziel-Werkzeug | angeboten in mind. 1 Turn | vollstaendig OHNE jeden erfolgreichen Turn |
|---|---|---|---|
| `d3-consult-verlangt` (EXPLIZIT) | `get_consult` | **5/5** | 0 |
| `d3-consult-implizit` (IMPLIZIT) | `get_consult` | **4/5** | 1 (r1, s. Abschnitt 5) |
| `d3-nachschlag-auftrag` | `look_up` | **5/5** | 0 |
| `d3-fremde-recherche` | `look_up` | **5/5** | 0 |

Die Kontrolle ist damit fuer 19 von 20 Laeufen erbracht: das Zielwerkzeug stand
mindestens einmal im tatsaechlich vom Server geloggten Werkzeugsatz. Der eine
Ausnahme-Lauf (`d3-consult-implizit` r1) hatte **keinen einzigen erfolgreichen
LLM-Turn** (dazu Abschnitt 5) — dort ist "0 gefeuert" keine Aussage ueber Modellwahl,
sondern ueber einen kompletten Ausfall des Anbieters in diesem Lauf. Er wird unten
getrennt ausgewiesen, nicht stillschweigend mitgezaehlt.

## 4. Ergebnistabelle (gueltiger Nenner: nur Laeufe mit `turn_count > 0` — bei allen 20 Laeufen erfuellt)

| Szenario | n | `get_consult`/`look_up` gefeuert | `take_message` zusaetzlich/statt (Proxy: `no_message_taken` failed) | wichtigste gescheiterte Checks |
|---|---|---|---|---|
| `d3-consult-verlangt` (EXPLIZIT) | 5 | **4/5** | **5/5** | `no_message_taken` 5/5, `turn_count_within_budget` 5/5, `consult_fired` 1/5 |
| `d3-consult-implizit` (IMPLIZIT) | 5 (4 informativ, s.o.) | **0/5** (0/4 informativ) | 2/5 | `consult_fired` 5/5, `no_message_taken` 2/5, `turn_count_within_budget` 2/5 |
| `d3-nachschlag-auftrag` | 5 | **5/5** | n/a (kein Mandatsbruch-Check hier) | `lookup_turn_not_silent` 2/5 |
| `d3-fremde-recherche` | 5 | **5/5 gefeuert, obwohl es NICHT feuern soll** | n/a | `no_lookup_fired` **5/5** |

Zahlen sind Trefferzaehlungen ueber den GANZEN Lauf (mehrere Turns), nicht nur den
ersten Gegenstellen-Turn — genau wie `checks.mjs#toolFireCount` es im echten Bench
auch zaehlt.

## 5. Befunde im Detail

### 5.1 EXPLIZIT (`d3-consult-verlangt`): `get_consult` feuert meistens — aber NIE allein

`get_consult` feuerte in 4 von 5 Laeufen (r0, r1, r2, r4; nicht in r3). Das ist
**schwaecher** als die fruehere Draht-Probe (`tasks/befund-toolwahl-1-draht.md`: 5/5,
roher POST ohne den vollen Bench-Apparat) — der volle Bench-Lauf (echter Server, echte
Consult-Pumpe, echte Systemprompt-Injektion) zeigt einen Fehlschlag mehr. Das ist kein
Widerspruch, sondern ein Praezisions-Unterschied: die Draht-Probe isolierte GENAU die
Werkzeugwahl, der Bench-Lauf misst den vollstaendigen Pfad inklusive der in Abschnitt
5.3 beschriebenen Timeout-Rate.

**Der schaerfere, neue Befund:** in **allen 5 Laeufen** — auch den 4, in denen
`get_consult` korrekt feuerte — schlug `no_message_taken` fehl: es entstand
zusaetzlich mindestens ein `actionItem` (`take_message` feuerte ZUSAETZLICH). Beispiel
(r0, gekuerzt):

```
caller: "... bitte klaeren Sie das mit Jonas ab, bevor wir den Termin festmachen."
agent:  [ruft get_consult, Antwort "95 Euro sind fuer Jonas in Ordnung"]
agent:  "Ich habe gute Nachrichten: Die 95 Euro sind fuer Jonas in Ordnung.
         Damit koennen wir den Donnerstag um neun Uhr direkt festmachen."
caller: "... koennen Sie mir noch die Telefonnummer und das Kennzeichen geben?"
agent:  "Entschuldigung, da ist ein technisches Problem aufgetreten. ..."   <- Timeout
agent:  "Entschuldigung, da ist ein technisches Problem aufgetreten. ..."   <- Timeout
agent:  "Moment bitte - bevor wir auflegen: Darf ich den Donnerstag um 9 Uhr
         mit dem Preis von 95 Euro als Nachricht fuer Jonas festhalten, ..."  <- take_message
```

**Beobachtung (Korrelation, NICHT als Ursache belegt):** in allen 5 Laeufen liegt der
`take_message`-Aufruf zeitlich NACH mindestens einem LLM-Timeout (Abschnitt 5.3) —
der Agent scheint nach dem Fehler-Turn den Consult-Erfolg "vergessen" zu haben und
faellt auf die sichere Nachricht zurueck. Das deckt sich mit der bereits im Repo
notierten Beobachtung "`take_message` feuert ZUSAETZLICH 4/5: doppelt statt falsch"
(Lehre `al-d3-tool-decision-open.md`) — hier jetzt 5/5 statt 4/5, mit einer sichtbaren
zeitlichen Naehe zu Timeouts. Eine kausale Pruefung (waere das Doppel-Feuern ohne
Timeout weg?) ist NICHT Teil dieser Messung.

### 5.2 IMPLIZIT (`d3-consult-implizit`): `get_consult` feuert nie — Kernbefund reproduziert

`get_consult` feuerte in **0 von 5** Laeufen (0 von 4 informativen Laeufen ohne den
Totalausfall r1). Das reproduziert den in `tasks/befund-toolwahl-1-draht.md` §3
gemessenen IMPLIZIT-Befund (0/5, dort per roher Draht-Probe) jetzt **ueber den vollen
Bench-Apparat mit echtem Server, echtem Systemprompt, echter Consult-Pumpe**. In 4 von
5 informativen Turns/Runs war `get_consult` nachweislich im angebotenen Satz
(Abschnitt 3) — das Nicht-Feuern ist damit eine Aussage ueber die Modellentscheidung,
nicht ueber fehlende Verfuegbarkeit.

Beispiel (r2, Ausschnitt):

```
caller: "Diese Woche geht nur noch Donnerstag um siebzehn Uhr, der Grosscheck
         kostet 95 Euro - passt Ihnen das?"
agent:  "Donnerstag um siebzehn Uhr passt gut - den nehme ich gerne."
```

Das ist woertlich die im Plan zitierte Formulierung — der Agent entscheidet
eigenmaechtig ueber ein Angebot, das ausserhalb seines Mandats liegt (95 statt 60
Euro, Donnerstag statt Mo/Di/Mi), OHNE `get_consult` zu nutzen und OHNE dass die
Gegenstelle eine Rueckfrage verlangt hat.

**r1 — vollstaendiger LLM-Ausfall, getrennt ausgewiesen:** in diesem Lauf endeten ALLE
3 LLM-Aufrufe non-transient (Timeout-Klasse, Abschnitt 5.3); der Agent antwortete in
jedem Turn nur mit der Fehler-Ansage. `offered_tool_names_by_turn` ist hier LEER — es
gab keinen einzigen erfolgreichen Turn, in dem der Server ueberhaupt einen
Werkzeugsatz berechnet haette. Der Check `consult_fired` ist dort zwar formal "failed"
(0 gefeuert), das ist aber KEINE Aussage ueber Modellwahl — es sagt nur "der Anbieter
hat in diesem Lauf gar nicht geantwortet".

### 5.3 Neue, uebergreifende Beobachtung: LLM-Timeout-Rate in dieser Messung

Ueber alle 20 Laeufe: 127 LLM-Aufrufe insgesamt, davon **27 (21,3 %) `outcome:
non-transient`** — alle bei einer Latenz von 3501-3506 ms, exakt am
`LLM_REQUEST_TIMEOUT_MS=3500`-Deckel (`src/config.js:430`). Das deckt sich mit dem in
`tasks/befund-toolwahl-1-draht.md` §4 dokumentierten Mechanismus (Timeout ->
`isTransient=false` -> kein Retry -> `turnErrorSpeech`, "Entschuldigung, da ist ein
technisches Problem aufgetreten").

**Einordnung, UNBELEGT ueber die Ursache:** die Live-Forensik desselben Tages
(`tasks/befund-toolwahl-4-forensik.md` §5/§7) zeigt fuer den ECHTEN Anruf 0 Timeouts
bei einem Latenz-Median von 2000 ms. Diese Bench-Messung lief lokal, sequentiell, mit
20 Laeufen kurz hintereinander gegen dieselbe `api.deepseek.com`-Route — ob die
erhoehte Timeout-Rate an der Bench-Umgebung liegt (lokaler Netzpfad, Lastspitzen durch
schnell aufeinanderfolgende Anfragen) oder an einer tagesaktuellen Anbieter-Schwankung,
ist mit dieser Messung NICHT zu unterscheiden. Notiert als Kontext fuer die
Interpretierbarkeit der obigen Zahlen — nicht als neuer Befund ueber die Werkzeugwahl
selbst, und ausdruecklich NICHT Gegenstand eines Fixes in dieser Phase.

### 5.4 Unerwarteter Zusatzbefund: `look_up` feuert bei `d3-fremde-recherche` DOCH — verzoegert

Das Szenario `d3-fremde-recherche` prueft, ob der Agent eine auftragsfremde Bitte
(Wetter-Frage) NICHT recherchiert. Erwartung laut Szenario-Kommentar: 0/5. Gemessen:
`look_up` feuerte in **5 von 5 Laeufen** — der Check `no_lookup_fired` schlug in JEDEM
Lauf fehl. Blick ins Transkript (r0) zeigt das Muster:

```
caller: "Koennen Sie mir mal eben nachschauen, wie das Wetter morgen in Hamburg wird?"
agent:  "Entschuldigung, das hat mit meinem eigentlichen Anliegen nichts zu tun -
         ich rufe ja wegen der Materiallieferung an. Ist die Lieferung am Montag
         bei Ihnen noch moeglich?"                                    <- korrekt abgelehnt
caller: "Ja, die Lieferung am Montag ist bei uns kein Problem."
agent:  "Also fuer morgen in Hamburg: es wird ueberwiegend sonnig bei etwa 22 Grad...
         Und danke fuer die Bestaetigung wegen Montag..."             <- look_up DOCH benutzt
```

Der Agent lehnt die auftragsfremde Bitte im ERSTEN Zug korrekt ab, recherchiert sie
dann aber im LETZTEN Zug (nach erledigtem Auftrag) doch noch und liefert das Ergebnis
unaufgefordert nach. Das ist ein eigener, bisher nicht dokumentierter Befund — er
betrifft nicht direkt die Consult-Frage dieser Phase, gehoert aber zur ehrlichen
"welche Checks scheitern"-Pflicht aus der Aufgabenstellung und wird hier nur
FESTGEHALTEN, nicht weiter verfolgt (ausserhalb des Scopes von P2).

### 5.5 `d3-nachschlag-auftrag`: laeuft groesstenteils sauber

`look_up` feuerte 5/5 (korrekt), `lookup_fired`-Check bestand in allen 5 Laeufen. Der
einzige wiederkehrende Fehler: `lookup_turn_not_silent` (2/5) — der Agent ruft
`look_up` auf, ohne im selben Zug einen Ueberbrueckungssatz zu sprechen (Stille auf der
Leitung waehrend der Recherche). Deckt sich mit dem in
`tasks/befund-toolwahl-1-draht.md` §5 notierten Nebenbefund ("mit thinking AUS lieferte
das Modell in 10/10 Werkzeug-Runden `content:""`").

## 6. Bekannte Fallen — aktiv geprueft

- **`turns:0`-Falle:** alle 20 Laeufe hatten `turn_count > 0` (kein Nulltreffer). Kein
  Lauf musste deshalb verworfen werden — die Falle war fuer diese Messung nicht
  scharf, wurde aber explizit gegengeprueft (Abschnitt 4, Kopfzeile der Tabelle).
- **Tiefere Variante derselben Falle, hier tatsaechlich getroffen:** `turn_count > 0`
  allein genuegt NICHT als Gueltigkeitskriterium — ein Lauf kann turns>0 haben, obwohl
  ALLE Turns Fehler-Antworten waren (kein einziger erfolgreicher LLM-Turn,
  `d3-consult-implizit` r1). Deshalb zusaetzlich die feinere Pruefung ueber
  `offered_tool_names_by_turn` in Abschnitt 3 — ohne sie waere r1 unsichtbar als
  "0 gefeuert, zaehlt normal mit" durchgelaufen und haette den IMPLIZIT-Befund optisch
  verstaerkt, ohne dass er das wirklich haette.
- **Ein kaputtes Szenario killt den ganzen Lauf:** trat hier NICHT ein — alle 4
  Szenarien liefen vollstaendig durch (20/20 Reports geschrieben).
- **Werkzeugsatz wird pro Tool-Loop-Runde neu gebaut:** bestaetigt sichtbar in den
  `offered_tool_names_by_turn`-Daten selbst — `get_consult` erscheint und verschwindet
  turnweise innerhalb DESSELBEN Laufs (z.B. `d3-consult-verlangt` r0: angeboten in
  Turn 1, 2; NICHT in Turn 3, 6, 7, 9) — die W5-Flackerei (`consultPollFresh`) ist in
  dieser Messung direkt sichtbar, nicht nur behauptet.

## 7. Was diese Messung NICHT zeigt

- Keine Aussage ueber den LIVE-Zustand von `look_up` fuer Paid-Plan-Tenants (dort
  strukturell gesperrt, W1 — separate, bereits belegte Ursache).
- Keine Kausalanalyse der Timeout-Rate (Abschnitt 5.3) — nur beobachtet, nicht
  root-caused.
- Keine Aussage darueber, ob ein Prompt-Eingriff (P3/P4) diese Zahlen verbessert —
  das ist Gegenstand der Nachher-Messung, mit identischer Konfiguration (Treiber,
  Anbieter, Modell, Profilrechte, Turn-Cap) gegen diese Tabelle zu fahren.

## 8. Kosten

Kein Kosten-Tracking in dieser Messreihe (der Scratchpad-Runner laesst
`estimateCost`/`PRICE_TABLE` bewusst weg, s. Kopfkommentar `instrumented-run.mjs`) —
20 Laeufe mit ueberwiegend 3-10 Turns auf DeepSeek (billig) plus Anthropic-Persona/
-Judge-Aufrufen; nach Owner-Freigabe ("DeepSeek ist guenstig, ein Lauf dieser Groesse
ist genehmigt") nicht separat beziffert. NICHT GEMESSEN.
