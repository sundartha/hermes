# Fragilitaets-Analyse 2026-08-06: Zustand ohne Kante

Gesucht wurde **eine** Fehlerklasse: **vorhandener Zustand ohne Kante zu der Stelle, die ihn
braucht.** Also nicht "Feld fehlt" und nicht "Logik falsch", sondern: der Wert ist bereits im
Prozess vorhanden, korrekt gefuehrt und aktuell — aber die Funktion, die ihn brauchte, um
richtig zu entscheiden, liest ihn nicht.

Fan-out: 5 Leser, je ein Skeptiker pro Bereich mit ausdruecklichem Widerlegungsauftrag.
Ergebnis: **7 bestaetigt, 1 widerlegt.**

> **Korrektur, 2026-08-06.** Die erste Fassung dieses Berichts meldete "2 bestaetigt,
> 6 gefallen". Das war ein Fehler im Orchestrierungs-Skript, nicht im Ergebnis: Befund und
> Urteil wurden ueber den **Titel** gejoint, und die Skeptiker haben ihre Titel mit
> `"BEFUND 1: "` praefixiert. Sechs Urteile fielen aus dem Join und erschienen als "kein
> Urteil". Die Zahlen hier stammen aus dem Journal des Laufs
> (`wf_b6f0223d-338/journal.jsonl`), nicht aus dem Skript-Ergebnis.
> **Lehre: ein Join ueber ein vom Modell frei formuliertes Feld ist kein Join** — er
> scheitert still und in die sichere Richtung ("nicht bestaetigt"), was ihn besonders
> schwer bemerkbar macht.

Alle Zeilenangaben gegen `5b8c8b2` geprueft.

---

## Bestaetigte Befunde

Sortiert nach Belegstaerke; beide erreichen die hoechste Stufe (`am-code-belegt`: der Pfad vom
Schreiber zum Entscheidungspunkt ist lueckenlos gelesen, kein Zwischen-Leser mischt den
fehlenden Zustand nachtraeglich ein).

### F1 — `endCallWaitInstruction` liest `call.direction` nicht: DE/FR benennen bei Inbound den falschen Gespraechspartner

**Belegstaerke:** am-code-belegt · **Bereich:** prompt

**Zustand entsteht**
`call.direction` ist ein gefuehrtes Feld in `createCall` (`src/store/state-ops.js:191`) und wird
pro Call konkret gesetzt: `src/routes/voice.js:307` (`direction: "inbound"`) bzw.
`src/routes/api-calls.js:180` (`direction: "outbound"`).

**Entscheidungsstelle**
`src/claude.js:593-595` (`endCallWaitInstruction`). Konsumiert wird das Ergebnis an genau zwei
Stellen, beide sind der Turn, in dem entschieden wird, ob der Agent auflegt oder wartet:

- `src/claude.js:1120` — Budget-Engine, `content: endCallWaitInstruction(call)` als `tool_result`
  nach unterdruecktem `end_call`
- `src/bridge.js:393` — Realtime-Bridge, `sendFunctionOutput(openaiWs, item.call_id, endCallWaitInstruction(call))`

**Warum keine Kante**
Die Funktion bekommt den **vollen** call-Datensatz, projiziert aber genau ein Feld:

```js
export function endCallWaitInstruction(call) {
  return localeFor(call.language).prompt.turnControl.endCallWait;
}
```

`call.direction` wird im Funktionskoerper nie referenziert. `grep -rn "endCallWaitInstruction" src/`
liefert genau vier Treffer (Definition, zwei Call-Sites, ein Import in `src/bridge.js:15`) — es
gibt **keinen** Zwischen-Leser, der die Richtung nachtraeglich einmischt.

Der DE-Text (`src/i18n/prompts/de.js:241`) lautet woertlich:
`"Der Angerufene hat noch nichts gesagt. Lege nicht auf - warte auf seine Antwort."`
"Der Angerufene" ist der Gerufene — bei Outbound korrekt der Gespraechspartner. FR traegt
denselben Fehler (`src/i18n/prompts/fr.js:206`, `"La personne appelée n'a encore rien dit."`).
EN ist direction-neutral formuliert (`src/i18n/prompts/en.js:208`, `"The other person hasn't said
anything yet."`) und dadurch **nicht** betroffen — die noetige Neutralitaet existiert also
bereits in einer Sprache, sie wurde nur nicht nach DE/FR nachgezogen.

Entscheidend fuer die Erreichbarkeit: seit P3.3 unterdrueckt `shouldSuppressEndCall` verfruehtes
`end_call` **ausdruecklich auch bei Inbound**. Der Kommentar sagt das woertlich
(`src/claude.js:656-662`): der fruehere Direction-Kurzschluss `if (call.direction !== 'outbound') return false`
ist *WEG*, weil er die RCA-R3-Fehlerklasse fuer Inbound offen liess. Der Pfad, der den falschen
Text ausloest, ist damit aktiv und beabsichtigt erreichbar — keine tote Konfiguration.

Der direkte Nachbar im selben `turnControl`-Objekt zeigt, dass die Unterscheidung hier trivial
moeglich ist — `openingBootstrap` (`src/i18n/prompts/de.js:236-239`) verzweigt korrekt:

```js
openingBootstrap: {
  outbound: "[Der Angerufene hat abgenommen. Beginne das Gespraech.]",
  inbound:  "[Der Anrufer ist in der Leitung. Begruesse ihn.]",
},
silentTurn:  "[Es kam keine Antwort.]",
endCallWait: "Der Angerufene hat noch nichts gesagt. Lege nicht auf - warte auf seine Antwort.",
```

Zwei Zeilen auseinander, beide seit P3.3 fuer beide Richtungen gueltig — eine verzweigt, die
andere nicht.

**Sichtbare Folge**
Bei einem eingehenden Anruf, in dem der Anrufer noch nichts Substanzielles gesagt hat und das
Modell verfrueht `end_call` ruft, bekommt es als `tool_result` einen Satz, der die Person am
Apparat falsch benennt: "der Angerufene" ist bei Inbound der Owner — und der ist gar nicht in der
Leitung. In der Leitung ist "der Anrufer". Genau diese Unterscheidung trifft
`situationInbound` in derselben Datei korrekt (`src/i18n/prompts/de.js:24-27`), ebenso die
`identityLine` der `clarificationRules` (`de.js:39-41`). Der Fehler steht im Turn, der ueber
Auflegen oder Weiterwarten entscheidet.

**Ungetestet, nachweisbar**
`grep -n "endCallWait" test/*.test.js` -> 3 Testdateien; jeder `seedCall()` nutzt den Default
`direction: "outbound"` (`test/helpers.js:513`) und ueberschreibt ihn fuer diesen Fall nie. Der
Inbound-Pfad dieser Funktion ist ungetestet.

**Kleinstmoeglicher Phasen-Zuschnitt**
`endCallWait` in DE/FR direction-neutral formulieren (Vorbild EN, `en.js:208`) — reine
i18n-String-Aenderung, kein Signatur- und kein Aufrufer-Eingriff — plus **ein** Test, der
`seedCall({ direction: "inbound" })` durch `endCallWaitInstruction` schickt und den
Direction-Bias im Text ausschliesst. Die strukturell sauberere Variante (Signatur nach
`openingBootstrap`-Vorbild auf einen Direction-Zweig umstellen) ist nicht noetig, um den Defekt
zu schliessen, und kostet zwei Call-Sites — nur nehmen, wenn dieselbe Phase ohnehin dort steht.

---

### F2 — Rueckfrage-Antwort ohne gemergte Fakten wird trotzdem als "Antwort da, sag es jetzt" gemeldet

**Belegstaerke:** am-code-belegt · **Bereich:** consult

**Zustand entsteht**
`mergeContextFacts` (`src/store/state-ops.js:721-731`) hat einen Deckel-Kurzschluss:

```js
const room = KEY_FACTS_LIMITS.maxItems - existing.length;
if (room <= 0) return 0;
```

Ist `call.context.key_facts` bereits voll (`KEY_FACTS_LIMITS.maxItems`), werden **0** Fakten
uebernommen. `answerConsult` (`src/store/state-ops.js:766-770`) kennt diesen Wert im selben
Aufruf, setzt den Status aber unbedingt:

```js
const mergedFacts = mergeContextFacts(call, facts);
consult.status = CONSULT_STATUS.ANSWERED;
consult.answeredAt = new Date().toISOString();
consult.answeredFacts = mergedFacts;
```

Zeile 766 kennt `0`, Zeile 767 setzt trotzdem `ANSWERED`.

**Entscheidungsstelle**
Die Kette vom Status zum Prompt-Text, jede Stufe ohne Fakten-Pruefung:

1. `src/store/state-ops.js:840-844` — `consultAnswerAwaitingDelivery`:
   `consult.status === CONSULT_STATUS.ANSWERED && !consult.deliveredAt` — kein `answeredFacts`
2. `src/store/state-ops.js:897-898` — `advanceInCallConsult` liefert bei Treffer
   `{ call, changed: false, wait: CONSULT_WAIT.ANSWERED }`
3. `src/claude.js:823-828` — `consultTurnMarker` mappt `CONSULT_WAIT.ANSWERED` verzweigungslos
   auf `turnControl.consultAnswered`
4. `src/claude.js:894-897` — der Marker wird an den letzten user-Turn angehaengt und geht so in
   den naechsten Modell-Turn

Der Text (`src/i18n/prompts/de.js:260-263`) ist zwingend formuliert:

```
"[Die Antwort auf deine Rückfrage ist DA - sie steht im HINTERGRUND. Nenne sie JETZT
 in deiner nächsten Äußerung, ohne Umweg. Frage NICHT erneut nach, kündige KEINEN
 Rückruf an und nimm dafür KEINE Nachricht auf - du hast die Auskunft bereits.]"
```

**Warum keine Kante**
`mergedFacts` verlaesst `answerConsult` nur nach **oben** zum HTTP-/MCP-Aufrufer —
`src/routes/api-calls.js:356-368` (`res.json({ accepted: true, merged_facts: mergedFacts })`) und
`src/mcp-tools.js:738-741`. Es wandert nie **seitwaerts** zu dem Praedikat, das ueber den
Prompt-Hinweis fuer den telefonierenden Agenten entscheidet. `grep -rn "answeredFacts" src/`
liefert ausserhalb des Schreibers (`state-ops.js:697` Init, `:769` Zuweisung) **keinen**
Produktions-Leser. Die Route prueft nur `outcome !== ACCEPTED`, nicht `mergedFacts > 0`; auch der
Wrapper in `src/consult/in-call.js` filtert nichts.

Der Ausgang der Zaehlung wird also dem MCP-Client gemeldet — und ausgerechnet der Agent, der
darauf gleich sprechen soll, erfaehrt ihn nicht.

**Sichtbare Folge**
Ist `key_facts` beim Eintreffen der Antwort voll (mehrere `look_up`-Treffer plus Briefing-Fakten
reichen), gilt der Consult als beantwortet, waehrend im HINTERGRUND **nichts Neues** steht. Der
Agent bekommt den zwingenden Hinweis "du hast die Auskunft bereits, nenne sie jetzt, frage nicht
erneut" — ohne Auskunft. Das ist eine Einladung zur erfundenen Antwort gegenueber der
Gegenstelle.

Die Chance ist danach **endgueltig** verloren: `markConsultAnswerDelivered`
(`src/telnyx-llm-shim.js:800`, `if (consultDeliveryDue) store.markConsultAnswerDelivered(call.id)`)
setzt den Einmal-Riegel `deliveredAt` (`src/store/state-ops.js:853`) unabhaengig von
`mergedFacts`. Jeder weitere Anstoss wird vom GQ-P7-Riegel blockiert — die Auskunft stand nie im
Prompt und kommt auch nicht mehr hin.

**Kleinstmoeglicher Phasen-Zuschnitt**
`answeredFacts` an genau einer Stelle mitpruefen: `consultAnswerAwaitingDelivery`
(`state-ops.js:840-844`) verlangt zusaetzlich `consult.answeredFacts > 0`. Eine Bedingung, ein
Praedikat, kein neuer Zustand. Offen und Owner-pflichtig ist nur, was der Nullfall stattdessen
tun soll — still bleiben (dann ist `advanceInCallConsult` fertig) oder einen eigenen ehrlichen
Marker bekommen ("Antwort kam an, brachte aber nichts Neues"). Der Deckel selbst wird in dieser
Phase **nicht** angefasst: `KEY_FACTS_LIMITS.maxItems` ist ein bewusst geteiltes Limit (Kommentar
`state-ops.js:715-720`), sein Verhalten zu aendern ist eine andere Entscheidung.

---

### F3 — `turnText.gapMs` wird berechnet, gebunden und geloggt, aber von keiner Entscheidung gelesen

**Belegstaerke:** am-code-belegt · **Bereich:** turn

Berechnet in `src/telnyx-turn-probe.js:63` (`gapMs = prev ? nowMs - prev.atMs : null`), gebunden
in `src/telnyx-llm-shim.js:650`. Die **einzige** Entscheidungsstelle, die `turnText` liest, ist
der Supersede-Riegel (`src/telnyx-llm-shim.js:746-750`) — und der prueft ausschliesslich
`turnText.prevRelation === TURN_TEXT_RELATION.EXTENDS`.

Der Skeptiker hat unabhaengig geprueft: `grep "\.gapMs" src/` liefert **null** Treffer. Der
scheinbare Treffer in `src/metrics.js` (`logTurnGap`/`stt_gap`) ist ein **namensgleiches,
unabhaengiges** Feld mit eigener Map und eigenem Zweck. Der Kommentar bei `:643-644` kuendigt
`gapMs + prevRelation` ausdruecklich als Paar an; die GQ-P1/GQ-P5-Kommentare zwei Zeilen darunter
befoerdern dann nur `prevRelation` und `lastRole` zur Entscheidungsgrundlage.

**Sichtbare Folge:** `TURN_TEXT_RELATION.SAME` wird nirgends in `src/` als Bedingung geprueft —
nur `EXTENDS`. Das ist derselbe Turn-Pfad, an dem der Befund "doppelte STT-Turns" haengt.

### F4 — `failureReason` ist persistiert, die passive Ausfall-Nachricht liest ihn nie

**Belegstaerke:** am-code-belegt · **Bereich:** lebenszyklus

Geschrieben in `recordFailureReason` (`src/store/state-ops.js:608-618`, set-once), aufgerufen
synchron aus `src/routes/voice.js:538` — also **vor** `terminateAndBillCall`. Der Wert liegt
nachweislich vor, wenn `finishCall` den Call sieht.

`src/telephony/call-finish.js:59-66` baut die einzige passive Benachrichtigung ausschliesslich
aus `call.status` (`t.statusBody(target, call.status)`). Unabhaengiger Grep: die einzigen Leser
von `failureReason` sind `src/mcp-tools.js:152` (`get_call_status`) und das Call-Widget — beides
**aktive** Kanaele, die jemand abfragen muss.

**Sichtbare Folge:** no-answer, besetzt, Fehler, Dauer-Cap und Budget-Abbruch landen alle als
`status: "completed"` in derselben, nicht unterscheidbaren Nachricht. **Das ist die
Code-Erklaerung fuer "fuenf stille Fehlanrufe ueber drei Wochen sind niemandem aufgefallen"**
(Kickoff, Teil 3): der Grund war die ganze Zeit gespeichert, er stand nur in keiner Nachricht.

### F5 — Abgerechnete Voice-Minuten stammen aus eigenen Zeitstempeln; `CallDuration` hat NULL Leser

**Belegstaerke:** am-code-belegt (Code) · **Wirkung unbelegt** · **Bereich:** lebenszyklus

`parseLifecycleEvent` parst `body.CallDuration` nach `diagnostics.callDurationS`
(`src/telephony/adapters/telnyx/webhook-events.js:44-46`). Unabhaengiger Grep nach
`callDurationS` im gesamten `src/`-Baum: **genau ein Treffer — die Schreibstelle selbst.**

`voiceMinutesOf` (`src/billing/metering.js`) rechnet `Math.ceil((endedAt - answeredAt) / 60000)`
aus `call.answeredAt`/`call.endedAt`, gesetzt per `new Date()` **bei der Webhook-Verarbeitung**
(Serveruhr), nicht aus einem Provider-Zeitstempel. Das Ergebnis bucht `reconcileVoiceBudget`
ueber `store.addVoiceUsageCostCents` **in die pro-Tenant-Kostendecke** — ein Absolutes-Regeln-Gate.

**Wichtig, damit hier nichts ueberdreht wird:** belegt ist, dass der Provider-Wert keinen Leser
hat. **Unbelegt ist, dass die abgerechnete Zahl deshalb falsch ist.** Das ist eine Messung, kein
Fix (siehe Rangfolge unten).

### F6 — `DASHBOARD_PASSWORD` hat keinen Auth-Konsumenten mehr, blockiert aber weiter den Boot

**Belegstaerke:** am-code-belegt · **Bereich:** konfiguration

Definiert in `src/config.js:966`. Grep ueber `src/`: ausser der Definition, der
Namespace-Auflistung (`:1499`) und der Boot-Refusal-Pruefung (`:1610-1614`) **kein Leser**.
`resolveWebSession` (`src/web-auth.js:691`) liest ausschliesslich das signierte Session-Cookie.
Der Boot-Text sagt die Praemisse selbst: *"seit AUTH-P7 liest keine Route mehr diese Variable"*.
Git-Beleg des Cutovers: `b111927`/`f935623`.

Kein Sicherheitsloch — ein Wert, der nur noch den Start verhindern kann. Billigster Befund der
Liste.

### F7 — `WORLD_DEFAULT_LANGUAGE_ENABLED` hat keine Spur im Boot-Log

**Belegstaerke:** am-code-belegt · **Bereich:** konfiguration

`src/config.js:1175-1179`, verdrahtet `:1565`, wirkt auf den `DEFAULT_LANGUAGE`-Flip
(`src/store/defaults.js:428/433-435`) und damit auf die Sprache, in der die **Offenlegung**
gesprochen wird. Suche nach "language"/"Sprache" in `src/boot.js`: **null Treffer** — weder in
`capabilityProbeLines` (fuehrt fuenf Zeilen: Briefing/Research/Lookup/Consult/Evidence) noch in
`costConfigBannerLines` noch im `configFingerprint` (sieben fest verdrahtete Achsen).

Der einzige funktionale Leser (`resolveCallLanguage`, `state-ops.js:1147-1150`) laeuft erst beim
naechsten Anruf. **Derselbe Blindfleck wie bei `DIAGNOSTIC_RETENTION_DAYS`** (Strategie-Dokument
M-3) — und er trifft eine Absolute Regel (Offenlegung).

---

## Gemeinsame Wurzel

Ueber alle sieben Befunde zerfaellt die Fehlerklasse in **zwei** Formen, und die Unterscheidung
entscheidet ueber den Zuschnitt:

| Form | Befunde | Was fehlt |
|---|---|---|
| **Die Projektion ist enger als der uebergebene Zustand** | F1, F2, F4 | die Funktion bekommt das Objekt und liest ein Feld zu wenig — der Wert liegt eine Feldzugriffslaenge entfernt |
| **Der Wert hat im Betrieb ueberhaupt keinen Leser** | F3, F5, F6, F7 | kein Konsument, keine Sonde, keine Log-Zeile, die unabhaengig vom Ergebnis druckt |

Die erste Form ist ein Fix (eine Bedingung, ein Feldzugriff). Die zweite ist entweder eine
Loeschung (F6) oder eine Sonde (F7) oder eine Messung (F5) — **nie** ein Fix, denn ohne Leser
gibt es auch keine Entscheidung, die man richtig machen koennte.

F1 und F2 sind **nicht** dieselbe Wurzel, teilen aber dasselbe Muster und dieselbe
Blickrichtung — das ist fuer die Reihenfolge relevant, nicht fuer die Zusammenlegung.

**Geteiltes Muster: die Projektion ist enger als der uebergebene Zustand.**
In beiden Faellen bekommt die entscheidende Funktion mehr, als sie liest. `endCallWaitInstruction(call)`
bekommt den ganzen Call und liest `language`. `consultAnswerAwaitingDelivery(call)` bekommt den
ganzen Call und liest `status` + `deliveredAt`. Beide Male ist der fehlende Wert **im selben
Objekt**, eine Feldzugriffslaenge entfernt. Kein Datenfluss muss gebaut werden — es fehlt nur der
Zugriff.

**Geteilte Wirkungsstelle: beide vergiften den Steuertext eines einzelnen Turns.**
F1 und F2 landen ueber `turnControl` im selben Mechanismus — dem Text, den der Agent in genau dem
Turn sieht, in dem er ueber Auflegen (F1) bzw. ueber die naechste Aeusserung (F2) entscheidet. Wer
an einem der beiden arbeitet, steht ohnehin in `src/i18n/prompts/*` und `src/claude.js:820-900`.

**Geteilte Blindstelle im Test: der Default der Fixture ist der Happy Path.**
F1 ist ungetestet, weil `seedCall()` fest `direction: "outbound"` setzt (`test/helpers.js:513`,
`:544`). F2 ist ungetestet, weil kein Test `key_facts` vor der Consult-Antwort fuellt — der
bestehende Test AL-P13-10 pinnt sogar ausdruecklich das **Gegenteil** ("Consult gilt trotzdem als
beantwortet") als Sollverhalten. Das ist die Wiederholung einer bekannten Lehre: gleiche
Fixture-Werte testen nichts, und ein Bestandstest kann einen falschen Sollzustand festnageln.

**Konsequenz fuer den Zuschnitt:** zwei getrennte Phasen (verschiedene Dateien, verschiedene
Risiken, F2 braucht eine Owner-Entscheidung, F1 nicht). Aber F2 zuerst nicht wegen des Musters,
sondern wegen der Folge — siehe unten.

---

## Widerlegt

Genau **ein** Befund ist gefallen — und er ist wertvoll, weil er eine ganze Phase spart.

### W1 — `RETENTION_DAYS` ohne Boot-Sonde: Praemisse falsch

**Behauptung war:** derselbe Blindfleck wie bei `DIAGNOSTIC_RETENTION_DAYS` — der Wert habe
nur einen Leser, der am ERGEBNIS des naechsten Sweeps haengt, nicht am Wert selbst.

**Gegenbeleg des Skeptikers, mit Fundstelle:** `store.pruneOldData()` liest
`config.privacy.retentionDays` **unbedingt bei jedem Aufruf** als Default-Parameter —
`src/store/json.js:960-962` bzw. `src/store/pg.js:637-639` — und reicht ihn an
`pruneExpiredRecords` (`src/store/state-ops.js:3444/3511`) weiter. Das **ist** die
Loesch-Entscheidung, und sie berechnet den Cutoff unabhaengig davon, ob am Ende etwas
geloescht wurde. `runRetention()` ruft diese Kette bereits bei `src/boot.js:774` auf,
garantiert **vor** `logBootBanner()` (`:829`).

Konditional ist ausschliesslich die **Bestaetigung im Log**, nicht die Anwendung des Werts.
Der Zustand erreicht seine Entscheidungsstelle bei jedem Boot und jedem 6h-Sweep sofort.

**Warum das zaehlt:** der Unterschied zwischen "fehlende Log-Bestaetigung" und "Zustand
erreicht die Entscheidungsstelle nie" ist genau die Grenze dieser Fehlerklasse. `RETENTION_DAYS`
liegt auf der harmlosen Seite, `DIAGNOSTIC_RETENTION_DAYS` und
`WORLD_DEFAULT_LANGUAGE_ENABLED` nicht — bei denen entscheidet der Wert ueber Verhalten, das
**niemand** im Betrieb ablesen kann.

---

## Was ich zuerst als Phase bauen wuerde

Sieben bestaetigte Befunde, aber nicht sieben Phasen. Die Rangfolge richtet sich nach der
Folge fuer den Menschen am Telefon, nicht nach der Belegstaerke — die ist bei allen sieben
gleich hoch.

**1. F2 — Consult-ANSWERED ohne gemergte Fakten** (`src/store/state-ops.js:840-844`)
Zuerst, weil die Folge die schlimmste ist: der Agent wird angewiesen, eine Auskunft
auszusprechen, die er nicht hat, gegenueber einem echten Menschen am Telefon — und der
Einmal-Riegel macht den Schaden unumkehrbar.
**Zahl:** Anteil der In-Call-Consults mit `answeredFacts === 0`, die trotzdem den
`consultAnswered`-Marker ausloesen. Vorher messbar > 0 (per Test mit vollem `key_facts`
konstruierbar), nach der Phase **0**.

**2. F1 — `endCallWait` direction-blind in DE/FR** (`src/claude.js:593-595`, `de.js:241`, `fr.js:206`)
Danach, weil billiger und risikoaermer: zwei i18n-Strings, kein Signatur-Eingriff, EN liefert die
Vorlage. Erreichbar ist der Pfad seit P3.3 nachweislich (`src/claude.js:656-662`).
**Zahl:** Anzahl Tests, die `endCallWaitInstruction` mit `direction: "inbound"` durchlaufen.
Vorher **0** (`test/helpers.js:513` setzt ausnahmslos `outbound`), nach der Phase **>= 1** je
Sprache mit direction-abhaengigem Text.

**3. F4 — `failureReason` erreicht die passive Nachricht nicht** (`call-finish.js:59-66`)
Danach, weil er einen offenen Kickoff-Befund **erklaert** statt einen neuen aufzumachen: "fuenf
stille Fehlanrufe ueber drei Wochen sind niemandem aufgefallen." Der Grund war jedes Mal
gespeichert. Ein Feld in einen bestehenden Text, kein neuer Kanal.
**Zahl:** Anteil der Ausfall-Nachrichten, die den Grund nennen. Heute **0** (die Nachricht
kennt nur `call.status`), nach der Phase **1** fuer jeden Call mit gesetztem `failureReason`.

### Nicht als Fix, sondern als Messung

**F5 — `CallDuration` vs. erschlossene Minuten** (`webhook-events.js:44-46`)
Belegt ist nur, dass der Provider-Wert **null Leser** hat; dass die abgerechnete Zahl deshalb
falsch ist, ist **unbelegt**. Der Pfad bucht in die pro-Tenant-Kostendecke — ein Absolutes-Regeln-
Gate. Hier ohne Beleg zu bauen ist verboten, den Verdacht liegenzulassen aber auch nicht.
**Zahl:** Differenz in Sekunden zwischen `diagnostics.callDurationS` und der abgerechneten Dauer
ueber die letzten N beendeten Calls. Median **0** laesst den Befund endgueltig fallen; alles
andere ist genau der Betrag, um den die Kostendecke danebenliegt.

### Billig, aber nicht dringend

**F6** (`DASHBOARD_PASSWORD` ohne Konsument) und **F7** (`WORLD_DEFAULT_LANGUAGE_ENABLED` ohne
Boot-Sonde) sind klein und risikoarm. F7 gehoert sinnvollerweise in dieselbe Phase wie die
fehlende Sonde fuer `DIAGNOSTIC_RETENTION_DAYS` (Strategie-Dokument M-3) — es ist derselbe
Blindfleck, und F7 trifft mit der Sprache der Offenlegung eine Absolute Regel.

**F3** (`turnText.gapMs`) ist bewusst **nicht** in der Rangfolge: er ist am Code belegt, aber
seine Folge haengt am Befund "doppelte STT-Turns", der eine eigene Messung braucht. Ein Feld
lesbar zu machen, dessen Entscheidung noch niemand entworfen hat, waere Bauen auf Vorrat.
