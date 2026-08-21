# PLAN-ANRUF-INBOX

Entwurf fuer das MCP-Werkzeug "Anruf-Inbox" und seine Verdrahtung im Server.
Stand: 2026-08-21, Basis `master` @ `51b0d59`. Reines Entwurfsdokument, kein Code geaendert.

**Revision 2 (2026-08-21).** Ueberarbeitet nach Pre-Mortem und Clean-Code-Pruefung.
Drei Blocker aus dem Pre-Mortem und drei S2-Befunde aus der Code-Pruefung sind
eingearbeitet; die Aenderungen gegenueber Revision 1 stehen in Abschnitt 11
("Was sich gegenueber Revision 1 geaendert hat"). Offene Owner-Fragen liegen in
`.fortschritt/entscheidungen.md`.

---

## 1. Kontext und Auftrag

Ein verbundener KI-Assistent soll ueber MCP zwei Fragen beantworten koennen:

1. **Sind neue eingehende Anrufe eingegangen — seit dem letzten Nachschauen?**
2. **Besteht Handlungsbedarf — und wenn ja, welcher?**

Die Antwort je Anruf: **wer** hat angerufen, **was wollte** er, **was wurde zugesagt**,
**was ist jetzt zu tun**. Also das ERGEBNIS des Gespraechs, nicht das rohe Transkript.
Gibt es nichts Neues, ist die Antwort kurz und eindeutig leer.

Dazu die Verdrahtung im Server: endet ein eingehender Anruf, entsteht daraus automatisch
so ein Eintrag.

Drei Auflagen aus dem Auftrag:

- **A-1** "Neu" vs. "gesehen" muss definiert sein — auch wenn derselbe Kunde aus mehreren
  Sitzungen fragt.
- **A-2** Ein Anruf, der beim Empfaenger **nie ankam**, darf **KEINEN** Eintrag erzeugen.
- **A-3** Kundendaten und Gespraechsinhalte sind sensibel: nie in Logs, nie in
  Beispieldaten.

Und die Rahmenregeln aus `CLAUDE.md`: Safety-Gates unangetastet, Auth fail-closed, kein
Audio ueber MCP, keine Secrets/PII in Logs oder falschen Antworten, beide Store-Backends
(json + pg), kein echter Anruf/SMS/Provider-Write/Deploy, alles offline belegbar.

---

## 2. Ist-Befund (verifiziert am Code)

### 2.1 Der eine Konvergenzpunkt: `finishCall`

Alle drei live relevanten Inbound-Wege enden im **selben** `finishCall`:

| Weg | Ausloeser | Beleg |
|---|---|---|
| Budget/TeXML (**Default, heute live**) | `/voice/status` Terminalstatus | `src/routes/voice.js:539-556` -> `billThunk(finishCall, ...)` |
| Call-Control/Telnyx-Assistant (Flag aus, `config.js:879-883`) | `HANGUP` -> `onHangup` | `src/telnyx-call-control-ingest.js:300-317` -> `billThunk(finishCall, ...)` |
| Realtime-Bridge (`VOICE_ENGINE=realtime`) | `finalize(status)` | `src/bridge.js:145-157` -> `onCallEnded` == `finishCall` (`src/boot.js:1086`) |

Der ElevenLabs-Weg (`src/elevenlabs/outbound.js`) traegt **nur Outbound** — kein
Inbound-Datensatz entsteht dort, `src/routes/webhooks-elevenlabs.js` legt keinen Call an.

Damit gilt: **ein Erzeuger in `finishCall` deckt jeden Inbound-Pfad ab** (Entwurfspflicht 6).
Ein zweiter Hook waere eine zweite Wahrheit.

### 2.2 Was am Ende eines Gespraechs entsteht

`src/telephony/call-finish.js:93-275`:

1. Abrechnung (`billedAt`, set-once), Reserve-Freigabe, `store.save()`.
2. **Frueh-Return** bei `call.status !== "completed" || !call.transcript.length`
   (`:112`) — schreibt nur eine Notification `failedTitle`/`cancelledTitle`.
3. Sonst — **innerhalb eines `try`-Blocks** — `summarizeCall(call)`
   (`src/claude.js:1454-1529`): setzt `call.summary`, `call.objectiveAchieved`,
   `call.result` (Ergebnis-Karte) und legt je `actionItem` einen Store-Eintrag an
   (`claude.js:1528`).
4. **`store.purgeTranscript(call.id)`** (`call-finish.js:150`) — das Roh-Transkript ist
   danach WEG (ausser bei Diagnose-Calls).
5. `if (!result) return;` (`:151`) — greift genau dann, wenn
   `settings.allowSummaries === false` (`claude.js:1458`).
6. Notification `t.summaryTitle` mit `${who}: ${result.summary}` (`:154`), optional SMS/Mail.

**Die fuer diesen Plan entscheidende Eigenschaft:** der gesamte Block 3-6 steht in einem
`try`, dessen `catch` **jede Exception schluckt** und nur `console.error("[summary]", ...)`
loggt (`call-finish.js:273-274`). Faellt `summarizeCall` aus — ein real vorgekommener
Live-Fall (LLM-Konto leer, HTTP 402; dazu der eigene Summary-Breaker) —, laeuft der
Erfolgspfad **nicht zu Ende**, ohne dass irgendetwas rot wird. Jede Verdrahtung, die im
Erfolgspfad des `try` haengt, faellt in diesem Fall lautlos aus. Dasselbe gilt fuer den
fruehen Return in Zeile 151.

Die Ergebnis-Karte (`src/call-result.js:49-72`) traegt genau die geforderten Felder:
`outcome`, `commitments`, `counterpartyCommitments`, `openPoints`, `nextStep`, `facts`,
optional `evidence`. Grenzen: 3 Eintraege je Liste, 200 Zeichen je Feld (`call-result.js:9-12`).

### 2.3 "Nie angekommen" heute — Befund fuer den Budget-/TeXML-Weg

> **Reichweite dieses Unterabschnitts.** Die Zeilenbelege stammen aus `src/routes/voice.js`,
> also vom **Budget-/TeXML-Weg** — dem heute live laufenden Default. Fuer den
> Call-Control-/Shim-Pfad gilt Abweichendes, siehe unten.

- **Unbekannte/nicht aktive Zielnummer** -> Audit `inbound_unrouted` + Hangup, **kein
  Call-Datensatz** (`src/routes/voice.js:281-290`).
- **Tenant-Kostendecke erschoepft** -> Ansage + Hangup, **kein Call-Datensatz**
  (`src/routes/voice.js:300-306`).
- Sonst entsteht der Datensatz sofort und wird sofort als angenommen gestempelt:
  `createCall` (`voice.js:319`) direkt gefolgt von `store.markAnswered` (`voice.js:320`).
  **`answeredAt` ist fuer Inbound also KEIN Beleg, dass jemand gesprochen hat.**
- Der Begruessungstext wird VOR dem Gather als `agent`-Zeile ins Transkript geschrieben
  (`voice.js:357`). **`transcript.length` ist damit bereits 1, bevor der Anrufer ein Wort
  gesagt hat.** Der Bestandsfilter aus 2.2 Punkt 2 ist fuer Inbound also zu schwach.
- Belastbar ist nur eine **`caller`-Zeile**. Rollen sind ausschliesslich `agent` und
  `caller` (`state-ops.js:416-421`; Schreiber: `claude.js:985`, `bridge.js:372`,
  `voice.js:357/488`). `callerHasSpoken` (`claude.js:741-745`) zaehlt fuer Inbound JEDE
  nicht-leere `caller`-Zeile — auch ein Rausch-Fragment wie ".".

**Abweichung Call-Control-/Shim-Pfad (heute Flag aus, `config.js:879-883`).** Dort spricht
ein Speak-Node die Begruessung, **ohne** sie ins Transkript zu schreiben (Kommentar
`claude.js:698-700`); die `caller`-Zeilen kommen ueber `agentTurn` (`claude.js:985`). Der
Grenzfall "Anrufer legt nach 1 s auf" hat auf diesem Weg ein **leeres** Transkript und
faellt bereits am Bestandsfilter (`call-finish.js:112`) heraus, nicht erst am neuen
Praedikat. Ergebnis (kein Eintrag) ist identisch, der Weg dorthin nicht. **Auflage:** wird
`TELNYX_INBOUND_HANDOFF_ENABLED` aktiviert, ist die Praedikat-Tabelle aus E-2 fuer diesen
Pfad erneut zu belegen (steht als Zeile in Etappe INBOX-P1).

### 2.4 Die Substanz-Schwelle des Bestands ist fuer eine andere Frage kalibriert

`isSubstantialCallerText` (`claude.js:725-727`) prueft
`text.trim().length >= config.voice.callerSubstanceMinLen`.

`callerSubstanceMinLen` hat **Default 2** (`config.js:1585-1588`, Env
`CALLER_SUBSTANCE_MIN_LEN`, min 1). Der Kommentar darueber sagt woertlich, wofuer die Zahl
kalibriert ist: *"Default 2 (eine echte Antwort wie 'Ja'/'Ok' ist >= 2 Zeichen)"*
(`config.js:1582-1583`). Die Schwelle beantwortet die Frage **"darf der Agent auflegen /
laeuft ein Deadlock"** — nicht die Frage **"gab es ein Gespraech mit Inhalt"**.

Konsequenz fuer diesen Plan: "aeh", "mh", "ja", "ok" sind alle `>= 2` Zeichen und damit
"substanziell" im Sinne dieser Primitive. Eine Inbox, die **nur** darauf aufbaut, fuellt
sich mit Geistereintraegen (Pre-Mortem R-2). Zweite Konsequenz: die Zahl ist ein
**Env-Knopf**, den ein Betreiber wegen des Loop-Guards hochdrehen kann — dann verloere die
Inbox still Eintraege. Beides ist der Grund fuer die eigene, benannte Inbox-Regel in E-2.

### 2.5 Was es HEUTE nicht gibt

- **Keinerlei "gesehen"-Zustand.** Volltextsuche ueber `src/` nach
  `seenAt|lastSeen|unread|acknowledg|cursor` liefert nichts Einschlaegiges. Notifications
  sind ein reines Push-Log `{id,title,body,at,callId}` (`state-ops.js:4125-4134`), hart
  gedeckelt auf `MAX_NOTIFICATIONS = 50` (`store/defaults.js:26`) — als verlustfreier
  Feed ungeeignet.
- **Keine Inbound-Sicht.** `list_calls` liefert die letzten 30 Calls beider Richtungen
  ohne Zeitfilter (`mcp-tools.js:965-983`, Slice `api-read.js:21`);
  `list_action_items` filtert nur `!done`, ohne Call- oder Zeitbezug und ohne
  `structuredContent` (`mcp-tools.js:989-1002`).
- **Kein Erreichbarkeits-Praedikat** ausser dem zu schwachen Filter in `call-finish.js:112`.

### 2.6 Naht-Fakten, die den Entwurf binden

- `/mcp` ist **stateless**: Server + Transport werden **pro Request** gebaut
  (`src/routes/mcp.js:51,113-117`, `sessionIdGenerator: undefined`). Es gibt keinen
  MCP-Session-Identifier. **Jeder Cursor muss serverseitiger, tenant-gescopter Zustand sein.**
- MCP-Tools sprechen ueber `api()` mit der eigenen REST-API und reichen
  `X-Internal-Identity`/`X-Internal-Tenant` (`mcp-tools.js:52-72`); beide Header werden nur
  von `isTrustedLocalCaller` akzeptiert (echtes Loopback, kein `X-Forwarded-For`,
  `routes/_tenant.js:44,60-72`).
- Der pg-Store liest zur Laufzeit **nicht** aus der DB: `init()` hydriert einmal alle Calls
  in einen In-Memory-Spiegel (`store/pg.js:1091`), danach laufen alle Reads gegen den
  Spiegel. **"Seit X" ist in beiden Backends dasselbe `Array.filter`** — Bestandsmuster
  `countOutboundCallsSince` (`state-ops.js:1349`), `voiceMinutesUsedSince` (`:3685`).
- **`save()` ist in beiden Backends teuer und global.** pg: `save()` flusht den
  **kompletten Spiegel aller Tenants** (Voll-Upsert plus Delete-Missing) in einer
  serialisierten `flushChain` (`store/pg.js:118-135`). json: `save()` ist ein
  **synchroner** Voll-Rewrite der ganzen Datei mit `fsync` und atomarem Rename
  (`store/json.js:344-353`) — er blockiert den Event-Loop, auf dem gleichzeitig
  Voice-Webhooks antworten. **Bestandsmuster ist deshalb `if (changed) save()`**
  (`markSummarySmsSent`, `store/json.js:495-505`).
- `deleteMissingCallsKeepActive` (`store/pg.js:2236`) loescht DB-Zeilen, die nicht im
  Spiegel stehen. **Ein Marker, der nur in der DB und nicht im Spiegel lebt, ist beim
  naechsten Flush weg.**
- Retention: beendete Calls fallen nach `RETENTION_DAYS` (Default 30, `config.js:1672`;
  `state-ops.js:4141-4162`).
- Bestehende Set-once-ISO-Marker am Call: `markAnswered`/`markSummarySmsSent`/`markBilled`
  ueber `setOnceTimestamp` (`state-ops.js:542-553`, `:619`, `:633`).
- `publicCall` (`store/views.js:28-47`) ist eine **Blacklist**: additive Felder wandern
  automatisch nach aussen, wenn man sie nicht ausdruecklich strippt.
- `resultCardView` ist heute **modul-privat** in `src/mcp-tools.js:182` (kein `export`) —
  von der REST-/Store-Seite nicht erreichbar. `src/call-result.js` dagegen ist ein
  **Blatt-Modul ohne eigene Imports** und wird von `state-ops.js:75` bereits importiert.
- `src/routes/api-read.js` ist im Datei-Kopf ausdruecklich als **Read-/Export-Gruppe**
  beschrieben ("behavior-preserving (reine Verschiebung)", "dieser drei Routen").
- `internalOnly` (`src/wiring/internal-only.js`) ist seit AUTH-P7 die einzige Sicherung
  der neun MCP-/Legacy-Routen; der Kopfkommentar haelt fest: **"apps/web ruft keine davon"**.
  `/api/state` liegt also nicht wegen des Dashboards hinter `internalOnly`.

---

## 3. Entwurfsentscheidungen

### E-1 — Keine neue Entitaet: abgeleitete Sicht + zwei Marker am Call

**Entscheidung.** Der "Eintrag" ist **keine** neue Tabelle und **kein** kopierter Inhalt.
Er ist eine Projektion aus dem, was ohnehin am Call haengt: `call.summary`, `call.result`
(Ergebnis-Karte) und die `actionItems` dieses Calls. Neu sind ausschliesslich **zwei
nullable ISO-Marker am Call-Record**:

| Feld | Bedeutung | Wer setzt | Semantik |
|---|---|---|---|
| `inboxEntryAt` | "dieser Anruf QUALIFIZIERT als Inbox-Eintrag" | `finishCall`, einmal | set-once |
| `inboxSeenAt` | "dieser Eintrag wurde einem Assistenten ausgeliefert" | Poll-Operation, einmal | set-once |

**Begruendung.** Eine dritte Wahrheit ueber dasselbe Gespraech (neben Notification und
actionItems) waere der sichere Weg in Drift. Die Ergebnis-Inhalte existieren bereits und
sind bereits gewhitelistet (`resultCardView`, `mcp-tools.js:182`) — das neue Werkzeug
**teilt** diese Funktion, es kopiert sie nicht (E-5).

**Warum trotzdem ein persistierter Qualifikations-Marker und keine reine Ableitung zur
Lesezeit?** Weil `purgeTranscript` (`call-finish.js:150`) die Beweislage zerstoert. Zur
Lesezeit ist nicht mehr entscheidbar, ob der Anrufer gesprochen hat — das Transkript ist
weg. Die Frage muss beantwortet werden, **solange das Transkript noch da ist**, also im
Anrufmoment. `inboxEntryAt` ist die persistierte Antwort.

**Nebeneffekt, der die Migration erspart:** Bestandscalls haben `inboxEntryAt = null` und
tauchen damit **nie** in der Inbox auf. Kein Backfill, keine Flut beim ersten Abruf, keine
Ausnahme fuer Alt-Datensaetze. Das ist die fail-closed-Richtung und deckt sich mit der
Lage "noch nicht gelauncht, alle aktiven Accounts sind wir".

**Bekannte Grenze (kein Bug).** Nicht abgeholte Eintraege verschwinden mit ihrem Call nach
`RETENTION_DAYS` (Default 30). Wer sechs Wochen nicht nachschaut, findet eine leere Inbox.
Das ist die gewollte Folge davon, dass der Eintrag nur eine **Projektion** des Calls ist,
und die Retention ist eine Datenschutz-Zusage, die fuer eine Bequemlichkeitsfunktion nicht
verlaengert wird. Steht in Abschnitt 6 als bewusst akzeptiert.

### E-2 — "Nie angekommen": das Praedikat, fail-closed, mit eigener Inbox-Regel

**Entscheidung.** Ein Eintrag entsteht **nur**, wenn ALLE Bedingungen gleichzeitig gelten,
serverseitig geprueft, **einmal je Anruf**, **vor** `summarizeCall` und damit vor dem
Transkript-Purge:

| # | Bedingung | Quelle |
|---|---|---|
| 1 | `call.direction === "inbound"` | Call-Record |
| 2 | `call.status === "completed"` | `voice.js:551` / `endStatusFor` |
| 3 | **Inbox-Substanzregel** (siehe unten) | `src/inbox-entry.js` ueber `isSubstantialCallerText` |
| 4 | `settings.allowSummaries === true` | `store.tenantContext(call.tenantId).settings` |

Alles andere ergibt **keinen** Eintrag: kein Datensatz, `failed`/`cancelled`, nur
Agent-Zeilen, nur Rausch-/Fuellwort-Fragmente, Summaries abgeschaltet, Praedikat-Fehler.

#### Bedingung 3: die eigene Inbox-Substanzregel

Geteilt wird die **Primitive** `isSubstantialCallerText`, **nicht** die Regel darueber.
Grund: die Primitive haengt an `callerSubstanceMinLen` (Default **2**), einer Zahl, die
ausdruecklich fuer den Auflege-/Deadlock-Schutz kalibriert ist (Abschnitt 2.4). Sie allein
laesst "aeh"/"mh"/"ok" als Gespraech durchgehen.

Die Inbox-Regel darueber hat **eigene, benannte Modul-Konstanten** in `src/inbox-entry.js`
— **kein Env-Knopf**, Praezedenz `MAX_OPEN_POLLS_PER_CALL` (`consult/delivery.js:24`,
ausdruecklich "KEIN Env-Knopf"):

```
INBOX_MIN_CALLER_TURNS = 2     // mindestens zwei substanzielle Anrufer-Zeilen
INBOX_MIN_CALLER_CHARS = 12    // ODER in Summe mindestens 12 Anrufer-Zeichen
```

Bedingung 3 haelt, wenn **mindestens eine** der beiden Schwellen erreicht ist. Gezaehlt
werden ausschliesslich `caller`-Zeilen, die `isSubstantialCallerText` erfuellen; die
Zeichensumme ist die Summe ihrer `trim().length`.

Warum ODER und nicht UND: ein einziger, aber inhaltsreicher Satz ("Ich wollte fragen, ob
Sie Donnerstag Zeit haben") ist ein Gespraech mit Inhalt, auch wenn danach aufgelegt wird.
Zwei kurze Turns ("Ja." / "Donnerstag.") ebenfalls. Ein einzelnes "ok" faellt durch beide.

**Warum Bedingung 3 strenger ist als `callerHasSpoken`.** `callerHasSpoken` zaehlt fuer
Inbound jede nicht-leere `caller`-Zeile (`claude.js:743-744`, bewusst so, weil es dort den
Auflege-Schutz steuert). Fuer die Inbox ist das die falsche Frage: ein einzelnes
Echo-Fragment "." wuerde einen Eintrag ueber ein Gespraech erzeugen, das nie stattfand.
Zwei verschiedene Fragen — "darf der Agent auflegen" und "gab es Gespraechsinhalt" —,
deshalb zwei Praedikate ueber derselben Primitive.

#### Bedingung 4 ist die Absicht des Tenants, NICHT der technische Erfolg

Revision 1 verlangte hier "`call.summary` ist gesetzt". Das war der Blocker R-1: dieselbe
Bedingung deckte **zwei verschiedene Sachverhalte** ab, die entgegengesetzt zu behandeln
sind.

| Sachverhalt | Beleg | Entscheidung |
|---|---|---|
| Der Tenant will keine Nachbereitung (`allowSummaries === false`) | `claude.js:1458` -> `summarizeCall` liefert `null` -> `call-finish.js:151` | **kein Eintrag** — ein leerer Eintrag waere Laerm gegen den ausdruecklichen Willen des Tenants |
| Die Zusammenfassung ist **technisch gescheitert** (LLM-Timeout, Konto leer/402, Breaker offen) | Exception -> `call-finish.js:273` | **Eintrag mit `summary: null` und `summary_unavailable: true`** |

**Warum der zweite Fall zwingend einen Eintrag braucht.** Ohne ihn lautet die Antwort des
Werkzeugs bei einem LLM-Ausfall "Keine neuen Anrufe." — obwohl elf Menschen angerufen
haben. Das ist die gefaehrlichste Antwort, die dieses Werkzeug geben kann: eine
Falschaussage, die wie eine Entwarnung aussieht. Der Eintrag ohne Zusammenfassung ist
unbequem, aber wahr; `caller`, `at` und die offenen Action Items stehen weiterhin darin,
und der Anruf ist ueber `list_calls`/Dashboard erreichbar.

Deshalb wird Bedingung 4 **vor** `summarizeCall` ausgewertet (die Einstellung liegt im
Tenant-Kontext, nicht am Ergebnis) und der Marker in einem Pfad gesetzt, der auch nach
einer Exception laeuft (E-7).

#### Warum NICHT zusaetzlich `call.result?.outcome != null`

Die Pre-Mortem-Empfehlung zu R-2 schlug vor, statt `call.summary` ein vorhandenes
`outcome` zu verlangen. **Das wird bewusst nicht uebernommen**, weil es R-1 wieder
oeffnete: ein LLM-Ausfall erzeugt weder `summary` noch `outcome`, und die Inbox waere in
genau dem Moment leer, in dem sie am dringendsten gebraucht wird. Die Geistereintrag-Abwehr
haengt stattdessen vollstaendig an der verschaerften Bedingung 3, die im Gegensatz zu
`outcome` **nicht vom LLM abhaengt**. Ein Anruf mit zwei substanziellen Anrufer-Zeilen ist
ein Gespraech, auch wenn das Modell daraus nichts machen konnte.

#### Die Grenzfaelle, durchgerechnet

| Fall | Status | Transkript | Eintrag? | Warum |
|---|---|---|---|---|
| Anrufer legt nach 1 s auf | `completed` | nur `agent`-Begruessung | **NEIN** | Bedingung 3 (keine `caller`-Zeile) |
| Rauschen/Echo | `completed` | `agent` + `caller: "."` | **NEIN** | Bedingung 3 (`isSubstantialCallerText` false) |
| Einzelnes Fuellwort | `completed` | `agent` + `caller: "aeh"` | **NEIN** | Bedingung 3 (1 Turn, 3 Zeichen — beide Schwellen verfehlt) |
| Zwei kurze echte Turns | `completed` | `caller: "Ja."`, `caller: "Donnerstag."` | **JA** | 2 substanzielle Turns |
| Ein langer Satz, dann auflegen | `completed` | eine `caller`-Zeile, 40 Zeichen | **JA** | Zeichensumme >= 12 |
| Technischer Abbruch mitten im Gespraech | `failed` | mit Inhalt | **NEIN** | Bedingung 2; `finishCall` kehrt vor der Summary zurueck (`:112`) |
| Unbekannte Nummer / Budget erschoepft | (kein Datensatz) | — | **NEIN** | strukturell: `createCall` wird nie erreicht |
| Echtes Gespraech, Summaries abgeschaltet | `completed` | mit Inhalt | **NEIN** | Bedingung 4 (Tenant will keine Nachbereitung) |
| Echtes Gespraech, LLM ausgefallen | `completed` | mit Inhalt | **JA**, `summary_unavailable: true` | Bedingungen 1-4 halten; nur der Inhalt fehlt |

Der `failed`-Fall ist eine bewusste Haerte: der Auftrag verlangt einseitig "nie angekommen
=> kein Eintrag", nicht "jeder angekommene Anruf => Eintrag". Der Abbruch bleibt sichtbar
— die bestehende Fehl-Notification (`call-finish.js:121-125`) und das Dashboard sind
**unveraendert**. Siehe offene Frage **F-3**.

**Was ausdruecklich NICHT angefasst wird.** Die bestehende Notification im Fehlerzweig
bleibt. Sie ist der Dashboard-Kanal, nicht der Inbox-Eintrag; sie zu entfernen waere eine
unbeauftragte Verhaltensaenderung an einem Kanal, den der Auftrag nicht nennt (Regel 6:
SCOPE).

### E-3 — "Neu vs. gesehen": tenant-seitig, implizit beim Abruf, per Anruf markiert

**Entscheidung.**

1. Der Zustand ist **serverseitig und pro Tenant** (nicht pro Sitzung). Zwingend: `/mcp`
   ist stateless (`routes/mcp.js:51`), ein clientgetragener Cursor kann das Problem
   "derselbe Kunde fragt aus zwei Sitzungen" strukturell nicht loesen.
2. Der Marker sitzt **am einzelnen Anruf** (`inboxSeenAt`), **nicht** als ein Zeitstempel
   am Tenant.
3. Das Markieren ist **implizit**: der Abruf selbst ist die Quittung. Kein zweites
   Bestaetigungs-Werkzeug. Fuer das erneute Lesen bereits gesehener Eintraege gibt es den
   Parameter `include_seen` (E-5), der **keinen** Marker aendert.

**Warum per Anruf und nicht ein Tenant-Cursor.** Ein einzelner Zeitstempel am Tenant hat
ein Ueberspringen-Risiko: zwei Anrufe werden fast gleichzeitig fertig, der spaetere wird
zuerst markiert, ein Abruf dazwischen zieht den Cursor nach vorn — der fruehere Eintrag
ist **dauerhaft unsichtbar**. Ein Marker je Anruf kann das nicht: ein Eintrag ist markiert
oder nicht. Zusaetzlich ist er robust gegen Retention (faellt ein Call weg, faellt sein
Marker mit) und folgt dem im Repo bewaehrten Muster
`markSummarySmsSent`/`stripe_meter_sent` (`state-ops.js:619`, `:3788`).

**Warum implizit und nicht explizit bestaetigt.** Ein explizites Ack-Werkzeug haengt davon
ab, dass das Client-Modell es aufruft. Tut es das nicht — und Modelle tun es unzuverlaessig
—, laeuft die Inbox nie leer, jede Sitzung wiederholt dieselben Eintraege und die
geforderte Antwort "nichts Neues" tritt nie ein. Das waere ein Produktversagen an genau
der Stelle, die der Auftrag als Kernanforderung nennt. Der Preis (Pre-Mortem R-6/R-11)
ist tragbar, weil der Eintrag durch das Markieren **nicht verschwindet**: er bleibt ueber
`list_calls`/`get_transcript`, das Dashboard, die Notification und die Summary-SMS/-Mail
erreichbar. Die Inbox ist ein **zusaetzlicher** Kanal, nie der einzige.

#### Atomizitaet ist ein Bauteil, keine Konvention

Revision 1 stuetzte die Race-Freiheit auf die Auflage "kein `await` zwischen Auswahl und
Markierung" — eine Konvention, die ein spaeterer Eingriff still bricht und die ein
Promise.all-Test nicht zuverlaessig verteidigt (zwei HTTP-Requests verschraenken sich
nicht deterministisch in genau diesem Fenster).

**Deshalb:** Auswahl und Markierung sind **EINE pure Store-Operation**
`takeInboxEntries(s, tenantId, limit, opts)` (E-7). Sie waehlt, projiziert und setzt die
Marker in einem synchronen Durchlauf und liefert `{ entries, remaining, marked }`. Ein
einfuegbares `await` ist damit **strukturell unmoeglich**, nicht per Kommentar verboten.
Der Race-Test bleibt als Zusatzbeleg, nicht als Sicherung.

**Ergebnis, pro Prozess:** genau eine Sitzung bekommt einen Eintrag, keine Sitzung bekommt
ihn doppelt, keine geht verloren.

**Drei Restrisiken, alle benannt:**

- Prozess-Absturz nach dem Markieren im Spiegel, vor dem Flush -> Eintraege erscheinen
  erneut (Duplikat, kein Verlust).
- Antwort geht auf dem Weg zum Modell verloren -> Eintrag ist markiert, bleibt aber ueber
  die vier anderen Kanaele sichtbar.
- **Deploy-Ueberlappung (neu, R-5):** laufen kurzzeitig zwei Instanzen, hat jede ihren
  eigenen Spiegel. Instanz B kann mit ihrem Voll-Upsert `inbox_seen_at` wieder auf `NULL`
  schreiben, das Instanz A gerade gesetzt hat -> dieselben Eintraege erscheinen erneut.
  Kein Verlust, aber Duplikate. **Die Aussage "genau eine Sitzung bekommt die Eintraege"
  gilt deshalb ausdruecklich nur PRO PROZESS.** Bewusst akzeptiert, Begruendung in
  Abschnitt 6.

### E-4 — Ein neuer Endpunkt, POST, eigene Factory, hinter `internalOnly` + `requireTenant`

**Entscheidung.** `POST /api/inbox/poll` in einer **eigenen** Route-Factory
`makeInboxRoutes({ store, audit, requireTenant })` in **`src/routes/api-inbox.js`**, mit
**benannter** Middleware `internalOnly` und `requireTenant(req, res)` im Handler.

- **Eigene Factory, nicht `makeReadRoutes`.** `src/routes/api-read.js` ist im Datei-Kopf
  ausdruecklich als **Read-/Export-Gruppe** dokumentiert ("behavior-preserving (reine
  Verschiebung)", "dieser drei Routen"). Eine vierte, **zustandsverbrauchende** Route
  darin bricht die Verantwortlichkeit der Factory und macht den Kopf-Kommentar falsch.
  Muster fuer die eigene Factory: `makeCallRoutes` (`src/routes/api-calls.js`),
  `makeBillingRoutes` (`src/routes/api-billing.js`) — beide mit DI, beide in `src/app.js`
  gemountet. Mount-Position: **nach** `makeReadRoutes` (`app.js:350`), damit die
  Reihenfolge der bestehenden Gruppen unveraendert bleibt.
- **POST, nicht GET**, weil der Aufruf Zustand aendert (er verbraucht die Inbox). Der
  Bestand hat keinen mutierenden GET — `GET /api/calls/:id/consult` ist rein lesend
  (`consult/delivery.js:96-110`). Diesen Praezedenzfall nicht brechen.
- **`internalOnly`**, weil der Aufrufer der In-Process-MCP-Pfad ist — dasselbe Muster wie
  `/api/state` (`api-read.js:63`) und `POST /api/calls/:id/cancel`.
- **`requireTenant`** statt `requestTenant`, weil geschrieben wird: `TENANT_REJECT` -> 403,
  nie ein Pseudo-Bucket (`routes/_tenant.js:180-187`). Fuer stdio/Loopback bleibt es der
  Bootstrap-Tenant, der Pfad also funktionsfaehig.

**Warum `/api/state` unangetastet bleibt — korrigierte Begruendung.** Revision 1 sagte
"das Dashboard pollt diese Route". Das ist falsch: `/api/state` liegt hinter
`internalOnly`, und der Kopfkommentar von `src/wiring/internal-only.js` haelt ausdruecklich
fest, dass **`apps/web` keine dieser Routen ruft**. Der richtige Grund ist ein anderer und
staerker: **`list_calls`, `list_action_items`, `get_my_number` und `get_agent_status` laufen
alle ueber `GET /api/state`.** Wuerde dort markiert, konsumierten vier unbeteiligte
Werkzeuge die Inbox leer — der Nutzer fragt "wie ist mein Agenten-Status" und verliert
dabei seine ungelesenen Anrufe.

**Der identitaetslose Loopback-Kanal VERBRAUCHT die Bootstrap-Inbox.** Ein Request ohne
`X-Internal-Identity` von echtem Loopback faellt ueber `requestTenant` auf
`BOOTSTRAP_TENANT_ID`. Das betrifft jeden lokalen Smoke-Test per `curl` und jedes lokal
gestartete `npm run mcp` (stdio). **Auflage:** Smoke-Tests dieser Route laufen
ausschliesslich gegen ein Temp-`DATA_DIR` mit `STORE_BACKEND=json` — nie gegen eine
`DATABASE_URL` aus der eigenen Shell. Steht als harte Bedingung in den Abnahmepunkten von
INBOX-P2.

**Auth-Inventar.** Die Route traegt eine benannte Auth-Middleware, wird damit als AUTH
klassifiziert (`route-policy.js:257`, `internalOnly` steht in `AUTH_MIDDLEWARE_NAMES`,
`route-policy.js:44`) und braucht **keinen** `PUBLIC_ROUTES`-Eintrag. Pflicht sind
trotzdem: Eintrag in `ROUTE_FINGERPRINT` (`test/route-auth-inventory.test.js:175ff`,
alphabetisch sortiert einsortiert) und — der Owner-Entscheidung 2026-08-02 folgend, nach
der die Probe die vollstaendige Routenliste abdeckt — eine Zeile in `scripts/probe-auth.sh`
im Muster der Nachbarzeilen:

```
sitzung|POST|/api/inbox/poll|403|internal|internalOnly - Gespraechsergebnisse
```

### E-5 — EINE Projektion, EIN Whitelist-Ort, ein MCP-Werkzeug ohne Widget

**Entscheidung.** Ein Werkzeug `check_inbox`, registriert ueber `uiTool(...)` (also
`server.registerTool`) mit `outputSchema`, **ohne** `_meta`/Widget — Stufe-0-Text plus
`structuredContent` aus **derselben** Projektion (Muster `list_calls`,
`mcp-tools.js:965-983`).

#### Wo die Whitelist lebt — genau ein Ort

Revision 1 nannte zwei Orte (`views.js` in P2, `pickInboxEntry` in `mcp-tools.js` in P3).
Das haette zwangslaeufig **zwei** Projektionen derselben Kartenfelder ergeben — genau die
Drift, gegen die der Bestandskommentar bei `pickTranscript` argumentiert ("EIN Filter, VOR
jeder Sicht"). Verschaerfend: `resultCardView` ist modul-privat in `mcp-tools.js:182`, von
der REST-Seite also gar nicht erreichbar.

**Festgelegt:**

1. **`resultCardView` zieht um** nach `src/call-result.js` und wird dort exportiert. Das
   ist der natuerliche Ort: das Modul, das die Ergebnis-Karte definiert, besitzt auch
   deren Aussensicht. `src/call-result.js` ist ein **Blatt-Modul ohne eigene Imports**;
   `state-ops.js:75` importiert bereits daraus — kein Zyklus, keine neue Kante in die
   falsche Richtung. `src/mcp-tools.js` importiert die Funktion danach, statt sie selbst
   zu definieren (`pickTranscript` und `TRANSCRIPT_OUTPUT` bleiben unveraendert).
   **Lint-Folge:** der gepinnte Befund
   `complexity :: Function 'resultCardView' has a complexity of 11` wandert in beiden
   gepinnten Listen von `src/mcp-tools.js` nach `src/call-result.js` — Umzug eines
   bestehenden Eintrags, **kein neuer** Suppression-Eintrag.
2. **Die Eintrags-Projektion `inboxEntryView(call, openActionItemTexts)` lebt in
   `src/store/state-ops.js`**, direkt neben ihrem einzigen Aufrufer `takeInboxEntries`.
   **Nicht** in `views.js`: `views.js` importiert aus `state-ops.js`
   (`store/views.js:7`) — die umgekehrte Kante waere ein Zyklus.
3. **Das MCP-Werkzeug projiziert NICHT erneut.** Es nimmt den fertigen Eintrag der
   REST-Antwort, ersetzt `started_at` (ISO) durch `at` (formatiert ueber den bestehenden
   `makeDateFormatter`) und reicht ihn sonst unveraendert durch. Eine Funktion,
   ein Feld, keine zweite Feldliste.

#### Antwortform je Eintrag (die eine Whitelist)

| Feld | Quelle | Auftragsfrage |
|---|---|---|
| `call_id` | `call.id` | Handle |
| `caller` | `call.from` (Inbound-Gegenseite), nullable | wer hat angerufen |
| `started_at` (REST) -> `at` (MCP) | `call.startedAt` | wann |
| `summary` | `call.summary ?? null` | was wollte er |
| `summary_unavailable` | `call.summary == null` | ehrlich statt still leer (E-2) |
| `outcome`, `commitments`, `counterparty_commitments`, `open_points`, `next_step` | `resultCardView(call.result)` — **gespreadet, nicht kopiert** | was wurde zugesagt |
| `action_items` | offene `actionItems` **dieses** Calls, als Texte | was ist jetzt zu tun |
| `action_required` | `action_items.length > 0` | besteht Handlungsbedarf |

Antwortrahmen: `{ entries: [...], remaining: <number> }`.

**`action_required` haengt allein an den offenen Action Items.** Revision 1 zog
zusaetzlich `next_step` und `open_points` in die Ableitung. Reale Ergebnis-Karten tragen
fast immer mindestens einen offenen Punkt — das Feld waere konstant `true` und damit
wertlos, Frage 2 des Auftrags formal beantwortet und praktisch unbeantwortet (R-7).
Action Items sind die einzige Quelle, die aus einem **bewussten Notier-Vorgang** entsteht
(`summarizeCall` legt sie einzeln an, `claude.js:1528`). `next_step` und `open_points`
werden weiterhin ausgeliefert — als eigene Felder, die der Assistent lesen kann, aber
nicht als Dringlichkeitssignal.

#### Weitere Festlegungen

- **Kein Roh-Transkript, kein `facts`, kein `evidence`.** `resultCardView` schliesst beide
  bereits aus (Kommentar `mcp-tools.js:172-181`); die Begruendung dort gilt unveraendert
  und zieht mit der Funktion um. Kein Audio (Regel 5, maschinell gepinnt durch
  `test/mcp-audio-text-only.test.js`).
- **Deckel**: hoechstens `INBOX_MAX_ENTRIES = 20` Eintraege je Abruf, benannte Konstante
  neben den `STATE_*`-Slices (Muster `api-read.js:21-24`), hier in `src/routes/api-inbox.js`.
  Markiert wird **nur, was tatsaechlich ausgeliefert wurde**; `remaining` nennt den Rest
  ehrlich, sonst meldet das Modell "2 neue Anrufe", waehrend 25 warten.
- **Reihenfolge**: **aufsteigend nach `call.startedAt`** (aelteste zuerst). Revision 1
  sortierte nach `inboxEntryAt` — das ist die ENDE-Zeit (gesetzt in `finishCall`),
  waehrend `at` die START-Zeit ausliefert. Bei zwei ueberlappenden Anrufen erschienen
  Reihenfolge und ausgelieferter Zeitstempel gegenlaeufig (R-12). `inboxEntryAt` bleibt
  reines Qualifikations-/Filterfeld, `inboxSeenAt` reines Konsum-Feld.
- **`include_seen`** (optionaler Eingabeparameter, Default `false`): zeigt bereits gesehene
  Eintraege erneut und **aendert keinen Marker** (`marked` bleibt 0, kein `save()`). Direkt
  in INBOX-P3 gebaut, nicht als Fallback geparkt — es ist der billige Rueckholgriff fuer
  R-6 und R-11.
- **Leerer Fall**: Stufe-0-Text aus `MCP_TEXTS.<lang>.emptyInbox` (Muster `emptyCalls`,
  `mcp-tools.js:978`) plus `structuredContent: { entries: [], remaining: 0 }` — das Schema
  verlangt `structuredContent` auch leer.

#### Wortlaut der Tool-Beschreibung (englisch, woertlich festgelegt)

Die Beschreibung ist einsprachig englisch (Systemgrenze O14, `mcp-tools.js:4-13`) und
traegt ein **enges Negativ-Verbot** am Tool-Entscheidungspunkt — sonst waehlt das Modell
`check_inbox`, wenn der Nutzer nur blaettern will, und verbraucht die Inbox beilaeufig
(R-11).

```
check_inbox:
"Check the call inbox: inbound calls that finished since the last check - who called,
what they wanted, what was promised, and what to do now. CONSUMING: entries returned
here are marked as seen and will NOT appear again. Do NOT use this to browse or re-read
call history - use list_calls for that."

check_inbox.include_seen:
"Re-read entries that were already marked as seen. Changes NO marker."
```

Daraus folgen die Eintraege in `EXPECTED_MARKERS` (`test/p15-mcp-tool-descriptions-en.test.js`,
Grossschreib-Marker in Reihenfolge, `NON_EMPHASIS_TOKENS` bereits abgezogen):

```
check_inbox:              ["CONSUMING", "NOT", "NOT"]
check_inbox.include_seen: ["NO"]
```

#### Tenant-sichtbare Texte (`src/i18n/mcp-texts.js`, `de`/`fr`/`en`)

| Schluessel | de | en | fr |
|---|---|---|---|
| `emptyInbox` | `Keine neuen Anrufe.` | `No new calls.` | `Aucun nouvel appel.` |
| `inboxSummaryUnavailable` | `Zusammenfassung nicht verfuegbar (technischer Fehler).` | `Summary unavailable (technical error).` | `Resume indisponible (erreur technique).` |

DE bleibt in der ASCII-Transliteration des Bestands (Kopf von `i18n/mcp-texts.js`), weil
diese Texte **nie gesprochen** werden. Die FR-Zeile ist bewusst ebenfalls ASCII gehalten,
damit dieses Dokument umlaut-/akzentfrei bleibt; im Code folgt sie dem Bestandsstil der
FR-Eintraege.

`list_calls` und `list_action_items` bleiben **unveraendert** — sie beantworten andere
Fragen (Verlauf, offene Aufgaben ueber alle Calls) und werden nicht zu einer zweiten Inbox
umgebaut.

### E-6 — Kein neues Env-Flag

**Entscheidung.** Keine neue Variable in `src/config.js`/`.env.example`/`render.yaml`/
`test/helpers.js BASE_ENV`.

**Begruendung.** Das Feature loest keine Anrufe/SMS aus, ruft keinen Provider, kostet
nichts und beruehrt kein Safety-Gate. Es ist ein Lesekanal ueber Daten, die der Tenant
ohnehin besitzt. Ein Flag waere vier Pflegestellen fuer eine Sicherung, die nichts sichert.
Alle drei Zahlen sind benannte Modul-Konstanten, keine Knoepfe — Muster
`MAX_OPEN_POLLS_PER_CALL` (`consult/delivery.js:24`, ausdruecklich "KEIN Env-Knopf").

**Praezisierung gegenueber Revision 1.** Die Aussage "das Feature haengt an keinem Knopf"
war unvollstaendig: ueber die geteilte Primitive `isSubstantialCallerText` haengt es
mittelbar an `CALLER_SUBSTANCE_MIN_LEN` (Default 2). Diese Kopplung ist durch die eigenen
Inbox-Konstanten aus E-2 **entschaerft, aber nicht aufgehoben**: dreht ein Betreiber die
Env-Schwelle sehr hoch, zaehlen weniger Zeilen als substanziell und die Inbox wird
strenger. Der Effekt geht in die sichere Richtung (weniger Eintraege statt falscher) und
ist in Abschnitt 6 als akzeptiert gefuehrt. Siehe offene Frage **F-4**.

### E-7 — Der Leer-Poll schreibt nichts, und der Marker ueberlebt den Fehlerpfad

Zwei Bau-Invarianten, die aus den Pre-Mortem-Blockern R-1 und R-3 folgen und beide
maschinell abgenommen werden.

**(a) `save()` nur bei tatsaechlicher Aenderung.** `save()` ist in beiden Backends teuer und
global (Abschnitt 2.6): pg flusht den kompletten Spiegel **aller** Tenants in eine
serialisierte Kette, json macht einen **synchronen** Voll-Rewrite mit `fsync` auf dem
Event-Loop, auf dem gleichzeitig `/voice/turn` antworten muss. Der Leer-Poll ist laut
Auftrag der **Normalfall** und darf deshalb **keinen** Schreibvorgang ausloesen.

- `takeInboxEntries` liefert `marked` (Anzahl tatsaechlich gesetzter Marker).
- Die Backend-Wrapper machen `if (marked) save();` — Bestandsmuster `markSummarySmsSent`
  (`store/json.js:495-505`, `store/pg.js:285`).
- Der Route-Handler ruft **kein** `save()` (sonst doppelter Flush).
- Abnahme: Attrappen-Store zaehlt `save()`-Aufrufe; Leer-Poll erwartet **0**.

**(b) Der Marker wird ausserhalb des fehlerschluckenden Erfolgspfads gesetzt.** Das
Praedikat wird **vor** `try` ausgewertet (Transkript noch da, Tenant-Einstellung bekannt),
die Markierung steht in einem **`finally`**, das auch nach der Exception in
`call-finish.js:273` und nach dem fruehen Return in `:151` laeuft:

```js
// INBOX-P1: im Anrufmoment entschieden - VOR summarizeCall (danach ist das Transkript
// weg, Zeile 150) und VOR jedem Fehlerpfad. Rein, kein Nebeneffekt.
const inboxWorthy = qualifiesAsInboxEntry(call, store.tenantContext(call.tenantId).settings);
try {
  // ... unveraendert ...
} catch (err) {
  console.error("[summary]", err.message);
} finally {
  // Laeuft auch nach der Exception oben und nach jedem fruehen Return im try. Ohne das
  // luegt die Leer-Antwort des Werkzeugs bei jedem LLM-Ausfall. No-op bei false.
  store.markInboxEntry(call.id, inboxWorthy);
}
```

**Warum das die Lint-Pins nicht sprengt.** Der ESLint-`complexity`-Zaehler zaehlt
Verzweigungspunkte (`if`, Schleifen, `case`, Ternaer, `&&`, `||`, `??`, `catch`);
**`finally` ist keiner**, und die eine neue `const`-Zuweisung enthaelt keinen Operator mit
Kurzschluss. Revision 1 schlug `markInboxEntry(call.id, worthy && Boolean(call.summary))`
vor — genau der `&&`-Kurzschluss waere ein zusaetzlicher Verzweigungspunkt gewesen und
haette den gepinnten Befund `complexity ... 32` auf 33 gehoben, den derselbe Absatz
vermeiden wollte. Die Summary-Frage ist deshalb aus dem `finishCall`-Body **verschwunden**:
`allowSummaries` steckt im Praedikat (E-2 Bedingung 4), der technische Summary-Fehler
steckt in `summary_unavailable` (E-5).

`max-lines-per-function` fuer `makeCallFinish` **steigt** (Pin heute 118). **Auflage:
messen, nicht schaetzen** — `npx eslint src/telephony/call-finish.js` vor dem Commit, und
die gemessene Zahl in **beiden** gepinnten Listen nachziehen
(`eslint-legacy-exceptions.json:95-107` und `test/check-staged-suppressions.test.js:551-563`).
**Kein neuer Suppression-Eintrag, kein `eslint-disable`** — nur die Korrektur bestehender
Zahlen, wie am 2026-08-19 schon einmal dokumentiert geschehen.

**Warum das Praedikat in einem eigenen Modul liegt.** `qualifiesAsInboxEntry` und die zwei
Inbox-Konstanten leben in `src/inbox-entry.js` (Blatt-Modul, importiert nur
`isSubstantialCallerText` aus `claude.js`, das in `call-finish.js` ohnehin bereits im
Importgraph steht). Grund: `call-finish.js` steht auf der Lint-Altlast-Liste — jede Zeile
dort verschiebt gepinnte Zahlen. Das Praedikat ist ausserdem rein und damit ohne
Server-Boot testbar.

---

## 4. Datenschutz und Logging

**Was den Server ueber das Werkzeug verlaesst** (und nur das): `call_id`, `caller`
(E.164 der Gegenseite), Startzeit, `summary`, `summary_unavailable`, die fuenf
Karten-Felder, offene Action-Item-Texte, `action_required`, `remaining`.

**Was NIE hinausgeht**: Roh-Transkript (existiert nach dem Purge ohnehin nicht mehr),
`facts`, `evidence`, `streamToken`, Kosten-/Abrechnungsfelder, Provider-Handles, die
beiden neuen Marker selbst. Durchgesetzt durch **zwei** Schichten:

- REST-Seite: `publicCall` strippt `inboxEntryAt`/`inboxSeenAt` (Muster
  `summarySmsSentAt`, `store/views.js:28-47`). Das haelt zugleich `/api/state` und die
  Self-Service-Antwort **byte-identisch** — sonst brechen die Read-Parity-Tests.
- MCP-Seite: die Whitelist-Projektion aus E-5, EIN Filter vor Text **und**
  `structuredContent`.

**`publicCall` ist eine Blacklist — und der Read-Parity-Test ist die EINZIGE maschinelle
Sicherung dieser Naht.** Additive Call-Felder wandern automatisch nach aussen, wenn sie
nicht ausdruecklich gestrippt werden. Fuegt eine Folgephase ein drittes Inbox-Feld hinzu
und vergisst das Strippen, faellt das **nur** auf, weil der Read-Parity-Test die
Byte-Identitaet von `/api/state` behauptet — nicht durch ein Review, nicht durch einen
Typ, nicht durch ein Schema. Wer in derselben Aenderung einen Erwartungswert nachzieht,
haette es durchgereicht. Ein Umbau auf Whitelist ist Bestandsarchitektur-Arbeit und
**nicht** Teil dieses Auftrags (Abschnitt 6).

**Die Ausloesefrequenz des Datenabflusses aendert sich strukturell.** Bisher verliess ein
Anrufer-Anliegen den Server nur, wenn ein Mensch danach fragte (`get_transcript`,
`list_calls`). `check_inbox` ist gebaut, um von einer **Routine** gezogen zu werden — Name,
Anliegen und Zusagen fremder Anrufer fliessen dann fortlaufend und ohne Menschen in der
Schleife an den verbundenen Client-Anbieter. Der Anrufer ist ein **Dritter**, der weder in
die Auswertung noch in diese Weitergabe eingewilligt hat. Auf Code-Ebene ist der Umfang
korrekt und minimal (Whitelist ohne `facts`/`evidence`, Felder gehen nicht ueber das
hinaus, was `list_calls`/`get_transcript` schon liefern) — **die Frequenz ist das Neue**.
**Auflage:** Abgleich mit der noch ausstehenden Datenschutzerklaerung; als
Launch-Blocker-Kandidat vermerkt, nicht als Code-Aufgabe dieser Kette.

**"Keine neuen Anrufe" ist KEINE Vollstaendigkeitsaussage ueber eingegangene Rufe.** Zwei
Faelle erzeugen gar keinen Datensatz und damit auch keinen Eintrag: unbekannte/nicht aktive
Zielnummer (`voice.js:281-290`, nur Audit `inbound_unrouted`) und erschoepfte
Tenant-Kostendecke (`voice.js:300-306`). Aus Nutzersicht ist der Unterschied zwischen
"niemand hat angerufen" und "wir haben jeden weggeschickt" genau der, der Geld kostet.
Der Leertext ist deshalb neutral formuliert ("Keine neuen Anrufe.") und behauptet
ausdruecklich **nicht**, dass niemand angerufen hat. Ein PII-freier Zaehler abgewiesener
Rufe je Tenant waere die richtige spaetere Antwort — siehe offene Frage **F-8**, nicht
diese Etappe.

**Logs.** Der Bestand ist sauber: `[voice/status]` loggt nur `callId`/Status/Diagnose
(`voice.js:529-536`), Audit nur Marker und Zaehler (`api-read.js:120-124`),
`/mcp` nur gehashte E-Mail, Tenant-ID und Toolname, nie Argumente (`routes/mcp.js:62-69`).
Diese Linie gilt unveraendert:

- Der Poll-Audit-Eintrag lautet ausschliesslich `audit("inbox_poll", req, "neu=<n> rest=<m>")`
  — **Zaehler, keine Inhalte, keine Nummern, keine Call-IDs**. Maschinell abgenommen ueber
  eine Audit-Attrappe mit Assertion gegen `/^neu=\d+ rest=\d+$/`.
- Kein `console.log` im neuen Pfad ausser einem Fehlerfall mit `err.message`.
- `Cache-Control: no-store` gilt fuer `/api/*` bereits global (`middleware.js:27`).

**Fixtures.** Alle Beispiel- und Testdaten erkennbar fiktiv, im Bestandsstil:
`+15005550006` (Owner-DID, Magic-Range, `test/helpers.js:30`), `+4915112345678`,
`+4915255555555`, Identitaet `Jonas Beispiel` (`test/helpers.js:43-44`). Erfundene
Gespraechsinhalte klar als Attrappe (`"Testanliegen"`, `"Rueckruf zugesagt"`), niemals ein
echtes Transkript, niemals eine echte Nummer — auch nicht in diesem Dokument.

---

## 5. Pre-Mortem

Ein Jahr spaeter, die Entscheidung war falsch. Was ist passiert? Jeder Fall mit Hergang,
Massnahme und Schwere; die Massnahmen sind in den Abschnitten 3 und 7 eingearbeitet, die
akzeptierten Risiken zusaetzlich in Abschnitt 6.

### R-1 — Verpasste Eintraege, weil die Markierung im fehlerschluckenden `try` lag (HOCH)

**Hergang.** Das LLM-Konto lief leer (402, bekannter Live-Fall) und der Summary-Breaker
oeffnete. `summarizeCall` warf, `finishCall` sprang in den `catch` (`call-finish.js:273`)
und loggte nur `[summary] ...`. Der im Erfolgspfad platzierte Markierungs-Aufruf wurde nie
erreicht. Weil `inboxEntryAt` set-once ist und ausschliesslich in `finishCall` gesetzt
wird, gab es keinen Nachlauf und keinen Reparaturpfad. Elf Inbound-Gespraeche eines Tages
bekamen keinen Eintrag; die Kundin fragte ihren Assistenten und bekam die geforderte
"kurz und eindeutig leere" Antwort — als Falschaussage. Dieselbe Luecke oeffnete der
Zweig `if (!result) return;` (`:151`).

**Massnahme (entschaerft).** Praedikat **vor** `summarizeCall`, Markierung im `finally`
(E-7b). Bedingung 4 aufgespalten: `allowSummaries=false` -> kein Eintrag; technischer
Summary-Fehler -> Eintrag mit `summary: null` und `summary_unavailable: true` (E-2).
Abnahme: eigener Test, in dem `summarizeCall` wirft — Marker muss trotzdem stehen.

### R-2 — Geistereintraege, weil die Substanz-Schwelle 2 Zeichen aus einem fremden Gate war (HOCH)

**Hergang.** `callerSubstanceMinLen` hat Default 2 (`config.js:1585`). STT lieferte auf
jedem zweiten frueh aufgelegten Anruf Fragmente wie "aeh", "mh", "ja", "ok" — alle >= 2
Zeichen, alle "substanziell". Die Bedingung hielt, `summarizeCall` fabrizierte daraus
"Anrufer meldete sich, Anliegen unklar", `action_required` wurde `true`. Nach drei Wochen
bestand die Inbox zur Haelfte aus "Handlungsbedarf: unklar"; der Kunde schaltete den
Connector ab. Die in Revision 1 benannte Gegenmassnahme war wirkungslos, weil die
geliehene Zahl fuer den Auflege-/Deadlock-Schutz kalibriert ist (`config.js:1582`).
Verschaerfend: ein Betreiber, der `CALLER_SUBSTANCE_MIN_LEN` wegen des Loop-Guards
hochdreht, verliert still Inbox-Eintraege.

**Massnahme (entschaerft).** Eigene, benannte Inbox-Regel ueber der geteilten Primitive:
`INBOX_MIN_CALLER_TURNS = 2` ODER `INBOX_MIN_CALLER_CHARS = 12` (E-2). Der Satz "Keine
zweite Laengen-Konstante" aus Revision 1 ist gestrichen — er begruendete die Fehlerursache.
Abschnitt 2.4 nennt Default und Env-Kopplung ausdruecklich; E-6 korrigiert die zu weite
Aussage "haengt an keinem Knopf".

### R-3 — Poll-Last: jeder Abruf flusht den kompletten Store, auch der Leer-Poll (HOCH)

**Hergang.** Der Handler rief unbedingt `store.save()`. Im pg-Backend flusht das den
**ganzen** Spiegel aller Tenants (Voll-Upsert plus Delete-Missing, `pg.js:118-135`) und
haengt ihn in die serialisierte `flushChain`. Ein Kunde liess eine Routine minuetlich
`check_inbox` laufen; mit wachsender Tenant-Zahl standen Anruf-Schreibpfade hinter
Leer-Polls in der Warteschlange, die nichts geaendert hatten. Im json-Backend war es
schlimmer: `save()` ist ein synchroner Voll-Rewrite mit `fsync` (`json.js:344-353`) — jeder
Poll blockierte den Event-Loop, auf dem gleichzeitig ein Voice-Webhook antworten musste.
Diagnostiziert wurde es erst, als `/voice/turn` Timeouts warf.

**Massnahme (entschaerft).** `takeInboxEntries` liefert `marked`; die Wrapper machen
`if (marked) save()`, der Handler ruft **kein** `save()` (E-7a). Abnahmepunkt: Attrappen-
Store zaehlt `save()`-Aufrufe, Leer-Poll erwartet 0.

### R-4 — Atomizitaet war eine Konvention, kein Bauteil (MITTEL)

**Hergang.** Die Race-Freiheit stuetzte sich auf "kein `await` zwischen Auswahl und
Markierung". Sechs Monate spaeter fuegte jemand ein `await` ein, um Action Items
nachzuladen. Der Race-Test (`Promise.all` zweier Polls) blieb gruen, weil zwei
HTTP-Requests sich nicht deterministisch in genau diesem Fenster verschraenken — der Test
beobachtete die Atomizitaet, er bewies sie nicht. Ab da bekamen zwei parallele Sitzungen
dieselben Eintraege doppelt; auffaellig wurde es, als zwei Rueckrufe an denselben Anrufer
rausgingen.

**Massnahme (entschaerft).** Auswahl, Projektion und Markierung sind EINE pure
Store-Operation `takeInboxEntries` (E-3). Ein einfuegbares `await` ist strukturell
unmoeglich. Der Race-Test bleibt als Zusatzbeleg.

### R-5 — Deploy-Ueberlappung: zwei Instanzen, zwei Spiegel (MITTEL)

**Hergang.** Waehrend eines Deploys liefen kurz zwei Instanzen. Instanz A lieferte sieben
Eintraege aus, markierte sie und flushte `inbox_seen_at`. Instanz B hatte dieselben Calls
noch ungesehen im eigenen Spiegel und flushte danach — Voll-Upsert mit
`ON CONFLICT DO UPDATE SET` auf genau der Spalte — und schrieb `NULL` zurueck. Der
Assistent meldete dieselben Anrufe dreimal. Kein Verlust, aber "nichts Neues" trat
wochenlang nicht ein.

**Massnahme (bewusst akzeptiert, Abschnitt 6).** Die Voll-Upsert-Architektur des
pg-Spiegels gilt systemweit; eine Spalten-Sonderregel (`WHERE inbox_seen_at IS NULL`) waere
eine zweite Flush-Semantik. E-3 schraenkt die Aussage "genau eine Sitzung" ausdruecklich
auf **pro Prozess** ein und fuehrt den Fall als drittes Restrisiko.

### R-6 — "Keine neuen Anrufe" ist keine Aussage darueber, ob jemand angerufen hat (MITTEL)

**Hergang.** Die Tenant-Kostendecke war erschoepft; `/voice/incoming` spielte die Ansage
und legte auf, ohne Call-Datensatz (`voice.js:300-306`). Parallel prallten Rufe an einer
gerade nicht aktiven Nummer ab (`voice.js:281-290`). Der Kunde fragte seinen Assistenten,
bekam "Keine neuen Anrufe." und verpasste einen Interessenten, der dreimal angerufen hatte.

**Massnahme (teils entschaerft, teils akzeptiert).** Der Auftrag verlangt fuer diese Faelle
ausdruecklich keinen Eintrag — das bleibt. Entschaerft ist die **Aussage**: Leertext
neutral, Abschnitt 4 und 10 halten fest, dass die Inbox keine Vollstaendigkeitsaussage
ueber eingegangene Rufe ist. Der PII-freie Zaehler abgewiesener Rufe ist als F-8 dem Owner
vorgelegt, nicht Teil dieser Kette.

### R-7 — `action_required` war praktisch immer `true` und damit wertlos (MITTEL)

**Hergang.** Die Ableitung `action_items.length > 0 || next_step !== null ||
open_points.length > 0` traf auf reale Ergebnis-Karten, die fast immer mindestens einen
offenen Punkt tragen. Nach vier Wochen war das Feld konstant `true`, der Assistent
eskalierte jeden Anruf gleich dringlich, der Nutzer hoerte auf, darauf zu achten. Frage 2
des Auftrags war formal beantwortet und praktisch unbeantwortet — das Feature starb an
fehlendem Nutzen, nicht an einem Defekt.

**Massnahme (entschaerft).** `action_required` haengt allein an offenen Action Items dieses
Calls (E-5). `next_step` und `open_points` werden weiterhin ausgeliefert, aber nicht in die
Ableitung gezogen. Der Test in INBOX-P3 pinnt genau das.

### R-8 — Der Smoke-Test konsumierte die Inbox des Bootstrap-Tenants (MITTEL)

**Hergang.** Der Abnahmepunkt lautete "Server lokal starten, `curl -X POST
/api/inbox/poll` -> 200". Ein identitaetsloser Loopback-Request faellt auf
`BOOTSTRAP_TENANT_ID`. Ein Kollege fuehrte den Smoke-Test mit gesetztem `STORE_BACKEND=pg`
und der Prod-DB-URL aus der eigenen Shell aus; der Poll markierte die echten Eintraege des
Owner-Tenants als gesehen. Sie waren nicht weg, aber der Assistent meldete am Morgen
"nichts Neues". Dasselbe gilt fuer jedes lokal gestartete `npm run mcp` (stdio).

**Massnahme (entschaerft, billig).** Die Smoke-Abnahmepunkte in INBOX-P2 sind ausdruecklich
an Temp-`DATA_DIR` **und** `STORE_BACKEND=json` gebunden — als Auflage, nicht als Nebensatz.
E-4 haelt fest, dass der Betreiber-Kanal die Bootstrap-Inbox VERBRAUCHT.

### R-9 — Automatisierter Export von Gespraechsinhalten Dritter (MITTEL)

**Hergang.** Bis dahin verliess ein Anrufer-Anliegen den Server nur, wenn ein Mensch danach
fragte. Das neue Werkzeug wird von einer Routine gezogen — Name, Anliegen und Zusagen
fremder Anrufer flossen fortlaufend und ohne Menschen in der Schleife an den verbundenen
Client-Anbieter. Ein Jahr spaeter stand genau dieser Kanal in einer Betroffenen-Beschwerde,
und die (ohnehin offene) Datenschutzerklaerung kannte ihn nicht.

**Massnahme (auf Code-Ebene akzeptiert, dokumentarisch entschaerft).** Die Whitelist ohne
`facts`/`evidence` ist korrekt und geht nicht ueber `list_calls`/`get_transcript` hinaus.
Abschnitt 4 benennt jetzt ausdruecklich die geaenderte **Ausloesefrequenz** und vermerkt
den Abgleich mit der Datenschutzerklaerung als Launch-Blocker-Kandidat.

### R-10 — Neue Spalte hydriert nicht, `inbox_seen_at` faellt beim Restart auf NULL (MITTEL)

**Hergang.** `rowToCall` hydrierte `inbox_entry_at`, aber `inbox_seen_at` wurde vergessen —
es wird spaeter gesetzt als das andere Feld und war im Reopen-Test nicht abgedeckt, weil
der Abnahmepunkt nur `inboxEntryAt !== null` behauptete. Nach dem naechsten Deploy hydrierte
der Spiegel den Marker als `undefined`, der Voll-Flush schrieb `NULL` zurueck, und die
gesamte Inbox aller Tenants erschien noch einmal.

**Massnahme (entschaerft).** Der Reopen-Round-Trip laeuft fuer **beide** Felder
eigenstaendig (setzen, flushen, Store auf derselben pglite-DB neu oeffnen, Wert muss
stehen). Zusaetzlich Auflage: `rowToCall` liefert `null`, **nicht** `undefined` — sonst
weicht der Shape vom json-Backend ab, wo `CALL_FIELD_DEFAULTS` per `??=` korrigiert.

### R-11 — Das Modell zog `check_inbox` statt `list_calls` und verbrauchte die Inbox beilaeufig (MITTEL)

**Hergang.** Der Nutzer fragte "zeig mir die letzten Anrufe". Das Modell waehlte am
Tool-Entscheidungspunkt `check_inbox` (klang passender, war kuerzer beschrieben), bekam die
neuen Eintraege, markierte sie und zeigte sie — in einer Sitzung, in der der Nutzer nur
blaettern wollte. Am naechsten Morgen fragte er "gab es was Neues" und bekam "nichts".

**Massnahme (entschaerft, billig).** Enges Negativ-Verbot in der englischen Beschreibung,
woertlich in E-5 festgelegt und ueber `EXPECTED_MARKERS` maschinell gepinnt. `include_seen`
(Default `false`) wird direkt in INBOX-P3 gebaut, nicht als Fallback geparkt.

### R-12 — Reihenfolge nach Abschlusszeit widersprach der ausgelieferten Anrufzeit (NIEDRIG)

**Hergang.** `inboxEntryAt` wird in `finishCall` mit "jetzt" gesetzt, also mit der
ENDE-Zeit; ausgeliefert wurde als `at` aber die START-Zeit. Zwei ueberlappende Anrufe (der
frueher begonnene dauerte laenger) erschienen in umgekehrter Reihenfolge zu ihren eigenen
Zeitstempeln. Ein Nutzer schloss daraus auf eine falsche Rueckruf-Reihenfolge.

**Massnahme (entschaerft, trivial).** Sortierung auf `call.startedAt` aufsteigend;
`inboxEntryAt` bleibt reines Qualifikations-/Filterfeld (E-5).

### R-13 — Der Transkript-Befund galt nur fuer den Budget-Weg (NIEDRIG)

**Hergang.** Die Begruendung fuer Bedingung 3 stuetzte sich auf `voice.js:357` (Begruessung
als `agent`-Zeile). Auf dem Call-Control-/Shim-Pfad ist das anders: dort spricht ein
Speak-Node die Begruessung, **ohne** sie ins Transkript zu schreiben (`claude.js:698-700`).
Als `TELNYX_INBOUND_HANDOFF_ENABLED` spaeter aktiviert wurde, war unbelegt, ob die
Praedikat-Tabelle dort dieselben Ergebnisse liefert.

**Massnahme (entschaerft, dokumentarisch).** Abschnitt 2.3 ist ausdruecklich als
Budget-/TeXML-Befund gekennzeichnet und nennt die Abweichung. INBOX-P1 traegt die Auflage,
die Praedikat-Tabelle bei Aktivierung des Inbound-Handoffs erneut zu belegen. Heute Flag
aus (`config.js:879-883`).

### R-14 — `publicCall` blieb eine Blacklist, das dritte Inbox-Feld leakte automatisch (NIEDRIG)

**Hergang.** Eine Folgephase fuegte `inboxDeliveredCount` hinzu. Niemand strippte es in
`publicCall` (`views.js:28-47`), das Feld wanderte automatisch in `/api/state`, den
Art.-15-Export und alle MCP-Call-Sichten. Gefangen hat es der Read-Parity-Test
(Byte-Identitaet), nicht ein Review — richtig, aber knapp.

**Massnahme (bewusst akzeptiert, Abschnitt 6).** Der Umbau auf Whitelist ist
Bestandsarchitektur und nicht Teil dieses Auftrags. Abschnitt 4 haelt ausdruecklich fest,
dass der Read-Parity-Test die **einzige** maschinelle Sicherung dieser Naht ist.

### R-15 — Nicht abgeholte Eintraege verschwanden nach `RETENTION_DAYS` (NIEDRIG)

**Hergang.** Ein Tenant nutzte den Connector sechs Wochen nicht. `pruneOldData` raeumte die
beendeten Calls nach 30 Tagen ab (`config.js:1672`, `state-ops.js:4141-4162`), die Marker
fielen mit. Beim naechsten Poll war die Inbox leer, obwohl Gespraeche stattgefunden hatten.
Der Nutzer hielt das fuer einen Defekt und meldete ihn als Datenverlust.

**Massnahme (bewusst akzeptiert, Abschnitt 6).** Die Retention ist eine
Datenschutz-Zusage und wird fuer eine Bequemlichkeitsfunktion nicht verlaengert. Als
bekannte Grenze in E-1 und Abschnitt 10 genannt, damit es spaeter nicht als Bug
diagnostiziert wird.

### R-16 — Eine PII-Zeile ist ins Log gerutscht (NIEDRIG)

**Hergang.** "Kurz mal debuggen" beim Poll loggte eine Zusammenfassung mit.

**Massnahme (entschaerft).** Abschnitt 4 ist Abnahmepunkt, nicht Empfehlung; der
Audit-String ist woertlich festgelegt und wird ueber eine Audit-Attrappe gegen
`/^neu=\d+ rest=\d+$/` gepinnt — statt eines `grep`, das ohne Positiv-Kontrolle nicht
zwischen "sauber" und "sucht am falschen Ort" unterscheiden kann.

---

## 6. Bewusst akzeptierte Risiken

Diese Punkte werden **nicht** entschaerft. Sie sind hier festgehalten, damit sie spaeter
nicht als Ueberraschung oder als Bug diagnostiziert werden.

| # | Risiko | Warum akzeptiert |
|---|---|---|
| B-1 | **Deploy-Ueberlappung liefert Eintraege doppelt** (R-5) | Die Voll-Upsert-Semantik des pg-Spiegels gilt systemweit. Eine Spalten-Sonderregel (`WHERE inbox_seen_at IS NULL`) fuehrte eine zweite Flush-Semantik ein — ein Bestandsumbau fuer einen Fall, der Duplikate erzeugt, nie Verlust. E-3 schraenkt die Garantie explizit auf "pro Prozess" ein. |
| B-2 | **Die Inbox ist keine Vollstaendigkeitsaussage** ueber eingegangene Rufe (R-6) | Der Auftrag verlangt fuer abgewiesene Rufe ausdruecklich **keinen** Eintrag. Der Zaehler abgewiesener Rufe ist ein eigenes Feature (F-8), nicht diese Etappe. Entschaerft ist nur die Formulierung. |
| B-3 | **Automatisierter Abfluss von Gespraechsinhalten Dritter** an den Client-Anbieter (R-9) | Auf Code-Ebene ist der Umfang minimal und geht nicht ueber bestehende Werkzeuge hinaus; es gibt keinen technischen Riegel gegen einen Hintergrundlauf, der nicht zugleich das Feature verhinderte. Abgleich mit der Datenschutzerklaerung als Launch-Blocker-Kandidat vermerkt. |
| B-4 | **`publicCall` bleibt eine Blacklist** (R-14) | Umbau auf Whitelist ist Bestandsarchitektur-Arbeit, ausserhalb des Auftrags (Regel 6: SCOPE). Abschnitt 4 benennt den Read-Parity-Test als einzige Sicherung. |
| B-5 | **Nicht abgeholte Eintraege fallen mit dem Call nach `RETENTION_DAYS`** (R-15) | Retention ist eine Datenschutz-Zusage. Der Eintrag ist nur eine Projektion des Calls; eine eigene, laengere Aufbewahrung waere genau die zweite Wahrheit, die E-1 vermeidet. |
| B-6 | **Implizites Markieren kann einem Hintergrundlauf zum Opfer fallen** (R-11 Restanteil) | Ein explizites Ack-Werkzeug macht die Kernanforderung "kurz und eindeutig leer" unerreichbar (E-3). Entschaerft durch Negativ-Verbot in der Beschreibung, `include_seen` und vier weitere Kanaele, die denselben Anruf zeigen. Dem Owner als **F-2** vorgelegt. |
| B-7 | **Mittelbare Kopplung an `CALLER_SUBSTANCE_MIN_LEN`** (R-2 Restanteil) | Die Primitive wird geteilt, damit es nicht zwei Substanz-Definitionen gibt. Eine hochgedrehte Env-Schwelle macht die Inbox strenger, nie falscher — die Wirkung geht in die sichere Richtung. In Abschnitt 2.4 und E-6 benannt. |
| B-8 | **Der `failed`-Fall erzeugt keinen Eintrag** (E-2) | Ein "ja" hiesse, `summarizeCall` auch fuer abgebrochene Calls zu fahren — Verhaltensaenderung im Abrechnungs- und Token-Pfad, weit ausserhalb des Auftrags. Dem Owner als **F-3** vorgelegt. |

---

## 7. Etappenplan

Drei Etappen, jede fuer sich mergebar, jede mit eigenem deterministischen Abnahmekriterium.
**Keine Abnahme haengt von einer offenen Frage ab** — alle Annahmen aus Abschnitt 9 sind in
den Plantext eingearbeitet, eine andere Owner-Entscheidung aendert jeweils den Plan, nicht
das Abnahmekriterium.

### Etappe INBOX-P1 — Der Eintrag entsteht (Persistenz + Praedikat + Verdrahtung)

**Ziel.** Beim Ende eines eingehenden Anrufs wird `call.inboxEntryAt` genau dann gesetzt,
wenn das Praedikat aus E-2 haelt — **auch dann, wenn die Zusammenfassung technisch
scheitert**. Nach aussen **inert**: kein Leseweg, kein API-Feld (Praezedenz: die fuenf
LCT-P2-Kostenfelder, `state-ops.js` "additiv und INERT").

**Betroffene Dateien.**

| Datei | Aenderung |
|---|---|
| `src/inbox-entry.js` (**neu**) | `INBOX_MIN_CALLER_TURNS = 2`, `INBOX_MIN_CALLER_CHARS = 12`; pure exportierte Funktion `qualifiesAsInboxEntry(call, settings)` (E-2, vier Bedingungen) |
| `src/store/state-ops.js` | zwei Felder in `createCall` (initial `null`); `markInboxEntry(s, callId, qualifies)` -> `{ call, changed }`, No-op bei `false` oder gesetztem Marker, nutzt `setOnceTimestamp` |
| `src/store/json.js` | Wrapper `markInboxEntry` (`if (changed) save()`); **beide Felder in `CALL_FIELD_DEFAULTS`** (`json.js:224`) — nicht eine zweite Migrationsliste in `migrateCallFields` (`:259`), die generisch darueber iteriert |
| `src/store/pg.js` | Wrapper; `rowToCall`-Hydrierung fuer **beide** Felder, Ergebnis `null` statt `undefined`; `callRowValues` + INSERT-Spaltenliste; **beide Spalten in `ON CONFLICT DO UPDATE SET`** (anders als `callee_is_owner`: sie werden NACH der Anlage gesetzt) |
| `src/store.js` | `markInboxEntry` im Re-Export ergaenzen (sonst `undefined` zur Laufzeit) |
| `src/db/schema.sql` | `inbox_entry_at TEXT`, `inbox_seen_at TEXT` in `CREATE TABLE call` **und** je ein `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (Bestands-DB; DDL laeuft beim Boot ueber `db/migrate.js:266`) |
| `src/store/views.js` | beide Felder in `publicCall` strippen |
| `src/telephony/call-finish.js` | genau die zwei Zeilen aus E-7b: `const inboxWorthy = ...` vor dem `try`, `finally { store.markInboxEntry(call.id, inboxWorthy); }` |
| `eslint-legacy-exceptions.json` + `test/check-staged-suppressions.test.js` | **gemessene** neue Zahl fuer `max-lines-per-function ... 'makeCallFinish'` (heute 118) in beiden Listen nachziehen |

**Auflage zum Shim-Pfad (R-13).** Wird `TELNYX_INBOUND_HANDOFF_ENABLED` aktiviert, ist die
Praedikat-Tabelle aus E-2 fuer den Call-Control-Pfad erneut zu belegen (dort steht die
Begruessung nicht im Transkript, `claude.js:698-700`). Heute Flag aus — kein Blocker fuer
diese Etappe, aber eine Zeile in der Etappen-Uebergabe.

**Neue Tests.**

- `test/inbox-entry-qualification.test.js` — die Faelle aus E-2 als **Tabellen-Test ueber
  ein Array**, dessen Laenge mit-asserted wird (ein geloeschter Fall faellt damit auf).
  Dazu die Verdrahtung ueber `makeCallFinish` mit Attrappen-Store (Muster
  `test/gq-p15-failure-reason-notification.test.js`, `test/diagnostic-retention.test.js`):
  - **Reihenfolge-Beweis:** der Attrappen-Store protokolliert die Aufrufe; das Praedikat
    wird ausgewertet, **bevor** `purgeTranscript` laeuft.
  - **Fehlerpfad-Beweis:** `summarizeCall` wirft -> `markInboxEntry` wurde trotzdem mit
    `true` gerufen (R-1).
  - **Absicht-Beweis:** `allowSummaries === false` -> `markInboxEntry` wurde mit `false`
    gerufen (kein Eintrag).
- `test/inbox-store-parity.test.js` — json und pglite: schreiben, Spiegel pruefen, Store auf
  derselben pglite-DB neu oeffnen, Wert muss ueberleben (Muster
  `test/assistant-context-persist-pg.test.js:56-60`). **Beide** Felder eigenstaendig
  (R-10), `inbox_seen_at` inklusive: setzen, flushen, neu oeffnen.

**Abnahmepunkte (Kommando -> erwartete Ausgabe).**

| # | Kommando | Erwartung |
|---|---|---|
| 1 | `node --check src/inbox-entry.js && node --check src/telephony/call-finish.js && node --check src/store/state-ops.js && node --check src/store/pg.js && node --check src/store/json.js` | keine Ausgabe, Exit 0 |
| 2 | `node --test test/inbox-entry-qualification.test.js` | `fail 0`; enthaelt namentlich die Faelle `reihenfolge-vor-purge`, `summary-exception-setzt-marker`, `allowSummaries-false-kein-marker` |
| 3 | `node --test test/inbox-store-parity.test.js` | `fail 0`; je ein Reopen-Fall behauptet `inboxEntryAt !== null` **und** `inboxSeenAt !== null` nach Neu-Oeffnen; `rowToCall` liefert fuer nicht gesetzte Marker `null`, nicht `undefined` |
| 4 | `npx eslint src/telephony/call-finish.js` | die gemeldeten Zahlen sind **identisch** mit den Eintraegen in `eslint-legacy-exceptions.json`; `complexity ... 'finishCall' ... 32` ist **unveraendert** |
| 5 | `npm test` | `fail 0` — insbesondere `test/route-auth-inventory.test.js` (unveraendert, keine neue Route), die Read-Parity-Tests (`/api/state` byte-identisch) und `test/check-staged-suppressions.test.js` |
| 6 | `grep -n "inbox" src/store/views.js` | beide Felder erscheinen in der `publicCall`-Destrukturierung (Positiv-Kontrolle: der Befehl liefert nicht-leere Ausgabe) |

**Rueckbau-Risiko.** Gering. Die Etappe schreibt nur zwei zusaetzliche nullable Felder und
liest sie nirgends. Rueckbau = Revert; zurueckbleibende Spalten sind nullable und stoeren
nichts. Einziges echtes Risiko ist der Eingriff in `finishCall` (Abrechnungs- und
Summary-Pfad) — deshalb genau zwei Zeilen im Body, beide ohne Verzweigung, plus
Abnahmepunkte 4 und 5.

---

### Etappe INBOX-P2 — Der Konsum-Endpunkt (`POST /api/inbox/poll`)

**Ziel.** Ein tenant-gescopter, fail-closed abgesicherter Endpunkt liefert die neuen
Eintraege genau einmal — und schreibt nichts, wenn es nichts Neues gibt.

**Betroffene Dateien.**

| Datei | Aenderung |
|---|---|
| `src/call-result.js` | `resultCardView` zieht aus `src/mcp-tools.js:182` hierher um und wird **exportiert** (E-5). Reine Verschiebung, byte-identischer Rumpf |
| `src/mcp-tools.js` | importiert `resultCardView` aus `../call-result.js`, statt es lokal zu definieren; `pickTranscript`/`TRANSCRIPT_OUTPUT` unveraendert |
| `eslint-legacy-exceptions.json` + `test/check-staged-suppressions.test.js` | den bestehenden Eintrag `complexity :: Function 'resultCardView' has a complexity of 11` von `src/mcp-tools.js` nach `src/call-result.js` **umhaengen** (kein neuer Eintrag) |
| `src/store/state-ops.js` | `inboxEntryView(call, openActionItemTexts)` (Whitelist aus E-5, nutzt das importierte `resultCardView`); `takeInboxEntries(s, tenantId, limit, { includeSeen })` — **eine** pure Operation: `tenantCallScope`-gescopt, Filter `inboxEntryAt != null && (includeSeen || inboxSeenAt == null)`, Sortierung `startedAt` aufsteigend, `slice(0, limit)`, Projektion, `setOnceTimestamp` auf `inboxSeenAt` je ausgeliefertem Call (nur wenn `!includeSeen`); liefert `{ entries, remaining, marked }` |
| `src/store/json.js`, `src/store/pg.js` | Wrapper `takeInboxEntries` mit `if (marked) save();` (Muster `markSummarySmsSent`, `json.js:495-505`) — **kein** unbedingtes `save()` |
| `src/store.js` | `takeInboxEntries` im Re-Export ergaenzen |
| `src/routes/api-inbox.js` (**neu**) | `INBOX_MAX_ENTRIES = 20`; Factory `makeInboxRoutes({ store, audit, requireTenant })`; `router.post("/api/inbox/poll", internalOnly, handler)`; Handler: `requireTenant` -> `store.takeInboxEntries(...)` -> `audit("inbox_poll", req, "neu=<marked> rest=<remaining>")` -> `res.json({ entries, remaining })`. **Kein `save()` im Handler** |
| `src/app.js` | Mount nach `makeReadRoutes` (`app.js:350`), DI-Buendel wie `makeCallRoutes` |
| `test/route-auth-inventory.test.js` | `"POST /api/inbox/poll"` in `ROUTE_FINGERPRINT` (alphabetisch einsortiert) |
| `scripts/probe-auth.sh` | `sitzung\|POST\|/api/inbox/poll\|403\|internal\|internalOnly - Gespraechsergebnisse` |

**Tenant-Scoping, unkonditional.** `takeInboxEntries` scopet ueber `tenantCallScope`
(`state-ops.js:467`, harter Filter `c.tenantId === tenantId`) — **ohne** das
`config.tenancy.multiTenant`-Gate, mit dem `/api/state` (`api-read.js:70`) Legacy-Calls
ohne `tenantId` rettet. Grund: beide Marker entstehen ausschliesslich an **neuen** Calls,
die immer eine `tenantId` tragen; einen Legacy-Pfad gibt es hier nicht. Ein Kommentar an
der Funktion haelt das fest, damit die Abweichung nicht als Inkonsistenz gelesen wird.

**Neue Tests.**

- `test/inbox-poll-route.test.js` — Spawn-Server (`startServer`, `PORT=0`,
  `DATA_DIR`-Override), geseedeter Zustand mit drei Calls: einer qualifiziert, einer
  outbound, einer ohne `inboxEntryAt`.
  - Erster Poll liefert **genau einen** Eintrag, zweiter Poll liefert **null**.
  - Poll mit `X-Forwarded-For` -> **403** (internalOnly fail-closed).
  - **Cross-Tenant-Isolation:** zwei geseedete Tenants A und B, beide mit qualifizierten
    Calls. Der Poll als A liefert **nie** einen Eintrag von B, und **Bs Marker bleibt
    danach `null`**. (Der `X-Internal-Tenant`-Header wird auf echtem Loopback bewusst
    vertraut, `routes/_tenant.js:70` — der Poll liefert dann korrekt die Eintraege
    **dieses** Tenants. Gepinnt wird die Isolation, nicht eine Ablehnung.)
  - **Audit-Form:** Audit-Attrappe protokolliert den uebergebenen String; Assertion gegen
    `/^neu=\d+ rest=\d+$/` (ersetzt das `grep` aus Revision 1, das ohne Positiv-Kontrolle
    nicht zwischen "sauber" und "sucht am falschen Ort" unterscheidet).
  - **`include_seen`-Fall:** Poll mit `include_seen: true` liefert die bereits gesehenen
    Eintraege erneut und aendert **keinen** Marker.
- `test/inbox-poll-flush.test.js` — Attrappen-Store zaehlt `save()`-Aufrufe:
  - Leer-Poll (nichts Neues) -> **0** `save()`-Aufrufe.
  - Poll mit einem neuen Eintrag -> **genau 1** `save()`-Aufruf.
  - Poll mit `include_seen: true` -> **0** `save()`-Aufrufe.
- `test/inbox-poll-race.test.js` — zwei Polls per `Promise.all`: genau einer liefert die
  Eintraege, der andere leer; die Summe der ausgelieferten Eintraege ist die Zahl der
  qualifizierten Calls (kein Verlust, keine Dublette). **Zusatzbeleg**, nicht die
  Sicherung — die Atomizitaet ist strukturell (E-3).

**Abnahmepunkte.**

| # | Kommando | Erwartung |
|---|---|---|
| 1 | `node --test test/inbox-poll-route.test.js test/inbox-poll-flush.test.js test/inbox-poll-race.test.js` | `fail 0` |
| 2 | `node --test test/route-auth-inventory.test.js test/probe-auth-table.test.js` | `fail 0` — beweist, dass die Route eingeordnet und in der Probe-Tabelle abgedeckt ist |
| 3 | `node --test test/mcp-transcript-tool.test.js test/store-pg-json-parity.test.js` | `fail 0` — beweist, dass der `resultCardView`-Umzug `get_transcript` nicht veraendert hat |
| 4 | `npm test` | `fail 0` (inkl. `test/check-staged-suppressions.test.js` nach dem Umhaengen des Lint-Eintrags) |
| 5 | **Smoke, nur gegen Wegwerf-Daten.** `INBOX_TMP=$(mktemp -d)` und dann `PORT=3999 STORE_BACKEND=json DATA_DIR="$INBOX_TMP" SKIP_TWILIO_SIGNATURE_CHECK=true npm start`, danach `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3999/api/inbox/poll` | `200` (echter Loopback ohne `X-Forwarded-For` = Betreiber-Kanal). **Auflage: `STORE_BACKEND=json` und Temp-`DATA_DIR` sind Pflicht, keine Empfehlung** — ohne sie verbraucht der Smoke-Test die Inbox des Bootstrap-Tenants (R-8). Niemals mit einer `DATABASE_URL` aus der eigenen Shell. |
| 6 | derselbe Aufruf wie 5, zusaetzlich `-H 'X-Forwarded-For: 1.2.3.4'` | `403` |

**Rueckbau-Risiko.** Gering fuer die Route (additiv, ohne Aufrufer). Mittel fuer den
`resultCardView`-Umzug: er beruehrt `get_transcript`, ist aber eine reine Verschiebung mit
byte-identischem Rumpf und wird durch Abnahmepunkt 3 abgedeckt. Achtung auf die drei
gepinnten Listen (Fingerprint, Probe-Tabelle, Lint-Eintrag) — ohne sie ist der Lauf rot,
was gewollt ist.

---

### Etappe INBOX-P3 — Das MCP-Werkzeug `check_inbox`

**Ziel.** Der verbundene Assistent kann die zwei Fragen des Auftrags stellen und bekommt
bei nichts Neuem eine kurze, eindeutig leere Antwort.

**Schritt 0 (Pflicht, vor jeder Code-Aenderung): Vorher-Messung.** `npm run test:gates`
laufen lassen und die Zahl der roten Faelle im Etappen-Report festschreiben. Ohne diese
Zahl belegt der Nachher-Lauf nichts (Bestandslehre: Vorher-Messung ZUERST).

**Betroffene Dateien.**

| Datei | Aenderung |
|---|---|
| `src/mcp-tools.js` | `INBOX_ENTRY` + `INBOX_OUTPUT` (zod, Modulebene wie `CALL_LIST_ENTRY`); Tool `check_inbox` via `uiTool` ohne `_meta`; Eingabefeld `include_seen` (optional, Default `false`); die REST-Antwort wird **durchgereicht**, ersetzt wird ausschliesslich `started_at` -> `at` ueber `formatDate`; Text- und `structuredContent`-Sicht aus **derselben** Struktur; Beschreibungen **woertlich wie in E-5** |
| `src/i18n/mcp-texts.js` | `emptyInbox` und `inboxSummaryUnavailable` fuer `de`/`fr`/`en` (Wortlaut aus E-5) |
| `test/p15-mcp-tool-descriptions-en.test.js` | `check_inbox: ["CONSUMING","NOT","NOT"]` und `"check_inbox.include_seen": ["NO"]` in `EXPECTED_MARKERS` (die Menge wird per `deepEqual` gepinnt) |
| `test/mcp-tools-language.test.js` | beide neuen Schluessel in die Vollstaendigkeits-Schluesselliste |
| `eslint-legacy-exceptions.json` + `test/check-staged-suppressions.test.js` | **gemessene** neue Zahl fuer `max-lines-per-function ... 'registerTools'` (heute 430) nachziehen; kurze Bezeichner (`s`, `c`, `e`) im neuen Code **vermeiden**, damit die `id-length`-Zaehler unveraendert bleiben |

**Neue Tests.**

- `test/inbox-mcp-tool.test.js` — `captureTools` gegen einen Gateway-Fake (Muster
  `test/mcp-tools-language.test.js`):
  - (a) drei Eintraege -> Text- und `structuredContent`-Sicht tragen dieselben Felder;
  - (b) **Kein-zweiter-Filter-Beweis:** die Schluesselmenge des MCP-Eintrags ist exakt die
    Schluesselmenge des REST-Eintrags, minus `started_at`, plus `at`;
  - (c) leer -> `emptyInbox`-Text der Tenant-Sprache **und**
    `structuredContent: { entries: [], remaining: 0 }`;
  - (d) die Antwort enthaelt **kein** `transcript`, **kein** `facts`, **kein** `evidence`
    (Negativbehauptung ueber den serialisierten Payload);
  - (e) `action_required` ist genau dann `true`, wenn `action_items` nicht leer ist —
    **auch dann `false`**, wenn `next_step` und `open_points` gefuellt sind (R-7);
  - (f) ein Eintrag mit `summary: null` liefert `summary_unavailable: true` und im Text die
    Zeile `inboxSummaryUnavailable` der Tenant-Sprache.
- Spawn-Ende-zu-Ende: `mcpPost(.../mcp, null, toolCall("check_inbox", {}))` gegen einen
  geseedeten Store -> erster Aufruf liefert den Eintrag, zweiter liefert den Leertext;
  ein dritter Aufruf mit `{ include_seen: true }` liefert den Eintrag erneut.

**Abnahmepunkte.**

| # | Kommando | Erwartung |
|---|---|---|
| 1 | `node --test test/inbox-mcp-tool.test.js` | `fail 0`, inkl. der Behauptungen (b), (d), (e) und (f) |
| 2 | `node --test test/p15-mcp-tool-descriptions-en.test.js test/mcp-tools-language.test.js test/mcp-audio-text-only.test.js` | `fail 0` |
| 3 | `npx eslint src/mcp-tools.js` | die gemeldeten Zahlen sind identisch mit den Eintraegen in `eslint-legacy-exceptions.json`; die `id-length`-Zaehler sind **unveraendert** |
| 4 | `npm test` | `fail 0` |
| 5 | `npm run test:gates` | die Zahl der roten Faelle ist **kleiner oder gleich** der in Schritt 0 festgeschriebenen Zahl (dieser Lauf DARF rot sein) |
| 6 | Smoke wie INBOX-P2 Abnahmepunkt 5 (Temp-`DATA_DIR`, `STORE_BACKEND=json`), dann `curl` auf `/mcp` mit `tools/list` | `check_inbox` erscheint mit englischer Beschreibung und `outputSchema`; die Beschreibung enthaelt woertlich `use list_calls for that` |

**Rueckbau-Risiko.** Mittel, weil `registerTools` beruehrt wird und drei gepinnte
Inventuren (Beschreibungs-Marker, Sprach-Schluessel, Lint-Zaehler) nachgezogen werden
muessen. Alle drei sind maschinell gepinnt — ein vergessenes Nachziehen ist rot, nicht
still. Rueckbau = Revert, keine Datenmigration.

---

## 8. Testkonzept

- **Nur `node:test`, offline, ohne Netz, ohne `.env`.** Keine neue Dependency.
- **Beide Store-Backends.** json ueber `DATA_DIR`-Temp-Verzeichnis (`tempDataDir`,
  `test/helpers.js:481`), pg ueber pglite (`test/pg-helpers.js:10-18`, Postgres in WASM).
  Wenn ein Test beide anfasst, wird der Store **dynamisch in `before()`** importiert,
  nachdem `process.env.DATA_DIR` steht (`json.FILE` bindet an `config.dataDir`) — Muster
  `test/store-pg-json-parity.test.js:23-42`.
- **Round-Trip-Pflicht fuer jede neue Spalte:** schreiben -> Spiegel pruefen -> Store auf
  derselben pglite-DB neu oeffnen -> Wert muss ueberleben. Gilt fuer **beide** Marker
  eigenstaendig (R-10). `test/store-pg-json-parity.test.js` traegt die ausdrueckliche
  Auflage, bei jeder neuen pg-Spalte erweitert zu werden.
- **Attrappen statt Spawn, wo moeglich.** `makeCallFinish` ist mit Attrappen injizierbar;
  `qualifiesAsInboxEntry` ist rein und braucht keinen Boot. Der Spawn-Server bleibt fuer
  die Route (`startServer({ seed })` mit `PORT=0` und `DATA_DIR`-Override,
  `test/helpers.js:1139-1160`); `data/store.json` wird nie angefasst. Nach dem Lauf Server
  sauber beenden (Bestandsproblem "verwaiste Testserver").
- **Zaehl-Attrappen fuer `save()`.** Der Flush-Test haengt an einem Store-Doppelgaenger,
  der `save()`-Aufrufe zaehlt — das ist die einzige Form, in der sich "der Leer-Poll
  schreibt nichts" deterministisch behaupten laesst.
- **Positiv-Kontrolle statt `grep`.** Wo Revision 1 eine `grep`-Kette als Abnahmepunkt
  hatte (Audit-String), steht jetzt eine Testbehauptung. Ein `grep` ohne Positiv-Kontrolle
  sieht bei "sucht am falschen Ort" genauso aus wie bei "sauber".
- **`BASE_ENV`**: keine Aenderung noetig, weil keine neue Env-Variable entsteht (E-6).
  Entstuende doch eine, waere der Eintrag Pflicht — sonst leckt die lokale `.env` in
  Spawn-Tests.
- **Testbank-Zuordnung**: die neuen Tests tragen **keine** Katalog-Kennung
  (`GAP-`/`PROMPT-`/`ABNAHME-`) am Namensanfang, laufen also in `npm test` als
  Regressionsschutz. Das ist beabsichtigt: es sind Regressionsfaenge, keine Launch-Gates.
- **Kein echter Anruf, keine SMS, kein Provider-Write, kein Deploy.** Der komplette
  Inbound-Lebenszyklus ist mit `SKIP_TWILIO_SIGNATURE_CHECK=true` und `curl` lokal
  durchspielbar; die Etappen brauchen davon nicht einmal Gebrauch zu machen.

---

## 9. Offene Fragen an Antonio

Die vollstaendigen Entscheidungsvorlagen — je Frage Kontext, Empfehlung mit Begruendung und
die getroffene Annahme — liegen in **`.fortschritt/entscheidungen.md`**. Hier nur die
Uebersicht; **keine** dieser Fragen blockiert eine Etappe, fuer jede ist die Annahme in den
Plantext eingearbeitet.

| # | Frage | Getroffene Annahme |
|---|---|---|
| F-1 | Wie heisst das Werkzeug? | `check_inbox` |
| F-2 | Implizit als gesehen markieren, oder ausdruecklich bestaetigen? | implizit, plus `include_seen` (Default `false`) |
| F-3 | Soll ein technischer Abbruch mitten im Gespraech einen Eintrag erzeugen? | nein |
| F-4 | Braucht das Werkzeug einen Ausschalter? | kein Env-Flag |
| F-5 | Wieviele Eintraege je Abruf, in welcher Reihenfolge? | 20, aelteste zuerst nach Anrufbeginn |
| F-6 | Wortlaut der leeren Antwort und des Hinweises "Zusammenfassung fehlt"? | die sechs Zeichenketten aus E-5 |
| F-7 | Sollen Action-Item-Kennungen mitgeliefert werden? | nein, nur Texte |
| F-8 | Soll spaeter ein PII-freier Zaehler abgewiesener Anrufe sichtbar werden? | nein, nicht in dieser Kette |

---

## 10. Was dieser Plan ausdruecklich NICHT baut

- Keine Aenderung an `list_calls`, `list_action_items`, `/api/state`, am Dashboard
  (`apps/web`), an Notifications, SMS oder Mail.
- Keine neue Tabelle, kein kopierter Gespraechsinhalt, keine zweite Auswertung.
- Kein Backfill fuer Bestandscalls (E-1: sie bleiben unsichtbar, das ist die
  fail-closed-Richtung).
- **Keine Aussage darueber, ob jemand angerufen hat.** Abgewiesene Rufe (unbekannte
  Nummer, erschoepfte Kostendecke) erzeugen keinen Datensatz und damit keinen Eintrag; die
  Inbox ist keine Vollstaendigkeitsstatistik (Abschnitt 4, B-2, F-8).
- **Keine eigene Aufbewahrung.** Nicht abgeholte Eintraege fallen mit ihrem Call nach
  `RETENTION_DAYS` (B-5) — bewusst, kein Bug.
- Kein Umbau von `publicCall` auf eine Whitelist (B-4).
- Kein Widget, kein Push, kein Rueckkanal vom Server zum Client — der MCP-Rueckkanal
  existiert nicht, nur der client-gezogene Aufruf zaehlt.
- Keine Beruehrung eines Safety-Gates, keines Offenlegungssatzes, keiner Auth-Ausnahme.

---

## 11. Was sich gegenueber Revision 1 geaendert hat

| Befund | Aenderung | Wo |
|---|---|---|
| **Blocker R-1** Markierung im fehlerschluckenden `try` | Praedikat vor `summarizeCall`, Markierung im `finally`; Bedingung 4 aufgespalten in Tenant-Absicht (`allowSummaries`) und technischen Fehler (`summary_unavailable`) | E-2, E-7b, INBOX-P1 |
| **Blocker R-2** geliehene 2-Zeichen-Schwelle | eigene Inbox-Regel mit `INBOX_MIN_CALLER_TURNS`/`INBOX_MIN_CALLER_CHARS`; Satz "Keine zweite Laengen-Konstante" gestrichen; Default und Env-Kopplung benannt | 2.4, E-2, E-6 |
| **Blocker R-3** unbedingtes `save()` im Poll | `if (marked) save()` im Wrapper, kein `save()` im Handler; eigener Flush-Zaehl-Test | 2.6, E-7a, INBOX-P2 |
| **S2** zwei Orte fuer die Whitelist | `resultCardView` zieht nach `src/call-result.js` und wird exportiert; die Eintrags-Projektion lebt allein in `state-ops.js`; das MCP-Werkzeug reicht durch und formatiert nur `at` | E-5, INBOX-P2, INBOX-P3 |
| **S2** `worthy && Boolean(call.summary)` hebt den `complexity`-Pin | der `&&`-Kurzschluss entfaellt vollstaendig; `finally` ist kein Verzweigungspunkt; beide Pins werden **gemessen**, nicht geschaetzt | E-7b, INBOX-P1 Abnahme 4 |
| **S2** mutierende POST-Route in der Read-Factory | eigene Factory `makeInboxRoutes` in `src/routes/api-inbox.js` | E-4, INBOX-P2 |
| R-4 Atomizitaet per Konvention | EINE pure Operation `takeInboxEntries` | E-3, INBOX-P2 |
| R-5 Deploy-Ueberlappung | Garantie auf "pro Prozess" eingeschraenkt, drittes Restrisiko benannt | E-3, B-1 |
| R-7 `action_required` immer `true` | Ableitung allein aus offenen Action Items | E-5, INBOX-P3 (e) |
| R-8 Smoke verbraucht Bootstrap-Inbox | Temp-`DATA_DIR` + `STORE_BACKEND=json` als harte Auflage; Betreiber-Kanal in E-4 benannt | E-4, INBOX-P2 Abnahme 5 |
| R-9 Ausloesefrequenz | Abschnitt 4 benennt den Frequenzwechsel; Datenschutzerklaerung als Launch-Blocker-Kandidat | 4, B-3 |
| R-10 `inbox_seen_at` hydriert nicht | Reopen-Round-Trip fuer **beide** Felder; `null` statt `undefined` | INBOX-P1, Abnahme 3 |
| R-11 Werkzeugwahl verbraucht beilaeufig | Negativ-Verbot woertlich in der Beschreibung, `EXPECTED_MARKERS` festgelegt; `include_seen` direkt gebaut | E-5, INBOX-P3 |
| R-12 Sortierung vs. `at` | Sortierung auf `startedAt` aufsteigend | E-5 |
| R-13 Befund galt nur fuer den Budget-Weg | 2.3 als Budget-/TeXML-Befund gekennzeichnet, Shim-Abweichung genannt, Auflage in P1 | 2.3, INBOX-P1 |
| R-14 Blacklist `publicCall` | Read-Parity-Test als einzige Sicherung benannt | 4, B-4 |
| R-15 Retention | als bekannte Grenze in E-1 und Abschnitt 10 | E-1, B-5 |
| **Falsche Begruendung** "das Dashboard pollt `/api/state`" | korrigiert: `apps/web` ruft keine `internalOnly`-Route; der echte Grund sind die vier MCP-Werkzeuge auf `/api/state` | E-4 |
| S3 "pass 5 oder mehr" | Tabellen-Test mit asserted Array-Laenge, Abnahme nur `fail 0` | INBOX-P1 Abnahme 2 |
| S3 `test:gates` ohne Vorher-Zahl | Schritt 0 der Etappe misst und schreibt die Zahl fest | INBOX-P3 |
| S3 `grep` ohne Positiv-Kontrolle | Audit-Attrappe mit Regex-Assertion | 4, INBOX-P2 |
| S3 `migrateCallFields` ungenau | praezisiert auf `CALL_FIELD_DEFAULTS` (`json.js:224`) | INBOX-P1 |
| S3 Tenant-Scoping ohne Begruendung | Satz zur unkonditionalen Scoping-Entscheidung ergaenzt | INBOX-P2 |
| S3 falsches Soll beim Tenant-Header | als Cross-Tenant-Isolation umformuliert | INBOX-P2 |
| S3 Beschreibungs-Wortlaut offen | englische Texte und `EXPECTED_MARKERS` woertlich festgelegt | E-5 |
| S3 Zitat-Drift `resultCardView` | einheitlich `mcp-tools.js:182` | 2.6, E-1, E-5 |
