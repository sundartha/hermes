# Uebergabe an die naechste Session — 2026-08-01

Frische Session im Repo. **Diese Datei zuerst, vollstaendig.** Danach erst Code oder Plaene.

---

## 0. Die harte Wahrheit zuerst

**Die AL-Kette ist gebaut, gemergt und live — und der Owner sagt, das Telefonat ist eine
Katastrophe.** Woertlich, am 2026-08-01, nach zwei echten Testanrufen gegen den Live-Dienst:

> „Ich hab hier in diesem Gespraech jetzt ganz oft ein, zwei Sekunden Leere gehabt … die
> Gespraechsqualitaet ist halt einfach eine komplette Katastrophe. Ich hab schon Agenten
> aufgestellt mit 11 Labs innerhalb von einem Tag, die zehnmal besser waren, und wir arbeiten
> hier schon seit Wochen dran."

**Das ist die Messlatte dieser Uebergabe.** Nicht „16 von 17 Phasen gemergt", nicht „3736 Tests
gruen". Beides stimmt und beides hat den Owner nicht schneller ans Ziel gebracht.

**Der Befund in einem Satz: von vier live geschalteten Faehigkeiten tun drei nachweislich
nichts.** Nicht „schlecht" — **nichts**. Das ist unten mit Log-Zeilen belegt.

---

## 1. Was gemessen ist (Belege, keine Vermutungen)

Zwei echte Anrufe am 2026-08-01 gegen Live-Commit `44a7d09`, alle Flags an, per-Tenant-Rechte
gesetzt und in der DB verifiziert. `call_msabz9975sph` (9 Turns), `call_msahzky8m8p9` (12 Turns).

### D-1 — Token-Streaming ist tot. Ursache belegt.

`"streamArmedRounds":0` und `"streamChunks":0` in **allen 21 Turns**, waehrend das Boot-Banner
`Token-Streaming: AKTIV` meldet.

**Ursache (offline reproduziert, `test/al-d1-cause-diagnostics.test.js` AL-D1-2/-3/-4):**
`streamSinkFor` (`src/claude.js`) armiert eine Runde nur, wenn der Werkzeugsatz **ausschliesslich**
aus Seiteneffekt-Werkzeugen besteht (`end_call`, `take_message`). `agentTools(call)` legt aber
`get_consult` und `look_up` in denselben Satz. **`look_up` wird in JEDEM Turn angeboten** (es
haengt an keiner Frische-Bedingung) — also ist der Sink in jeder Runde `null`.

**Folge, und das ist die Pointe: das Anschalten der neuen Faehigkeiten hat die Latenz-Phase
stillgelegt, fuer die der Owner am Telefon gemessen hat.** Solange `LOOKUP_ENABLED` an ist, ist
Streaming dauerhaft wirkungslos, nicht gelegentlich.

### D-2 — Das Denk-Signal feuert nie.

`"thinkingSignal":false` in **allen 21 Turns**. Turn-Latenzen lagen bei **0,9–3,0 s**; die
Schwelle sollte laut Plan der `agentTurn`-Median (~1,3 s) sein. Es haette mehrfach feuern muessen.
**Ursache UNBEKANNT — noch niemand hat sie gesucht.** Genau diese Pausen hoert der Owner.

### D-3 — `get_consult` und `look_up` werden angeboten, aber nie gewaehlt.

`offeredToolNames` enthaelt `get_consult` in **10 von 12** Turns (fehlt nur bei
`consultPollFresh:false`) und `look_up` in **12 von 12**. `toolNames` (tatsaechlich gefeuert)
enthaelt **nie** eines von beiden — nur dreimal `take_message`.

Und zwar auch dann nicht, als die Gegenstelle woertlich sagte **„frag Antonio"** und
**„ich moechte, dass Du eine Internetrecherche machst"**. Der Agent antwortete „Ich frage
Antonio" — und nahm eine Nachricht auf. Das ist exakt der Satz, den Entscheidung **O4** verbieten
sollte.

**Das ist eine Modell-Entscheidung, kein Klempner-Problem.** Die Repo-Lehre dazu existiert schon:
Haiku braucht am Tool-Entscheidungspunkt **enge Verbote**, keine wohlmeinenden Beschreibungen
(`call-quality-chain`).

### D-4 — Poll-Frische erzeugt tote Fenster (kleiner, aber real).

`consultPollFresh:false` in Turn 1 und 4 — und prompt fehlte `get_consult` im Angebot.
`CONSULT_POLL_FRESH_MS` = 25 s gegen einen Long-Poll von 22 s: **3 Sekunden Marge.** Zusaetzlich
ist `consultPolledAtMs` **ephemer** — ein Re-Attach oder Instanzwechsel startet bei „nie gepollt",
also nie frisch. Erklaert 2 von 12 Turns, nicht die anderen 10.

### D-5 — STT-Kauderwelsch (vorbestehend, R2).

Aeusserungen des Owners kamen mehrfach identisch falsch transkribiert an („Ja, gestern --
besprochen, ganz toll", „Es kommt Sino ist in Ordnung"), woraufhin der Agent am Thema vorbei
antwortete oder nachfragte. Bekannt aus `assistant-dead-call-rca` (R2), **nicht** von dieser
Kette verursacht, **nicht** behoben. Ein erheblicher Teil des schlechten Eindrucks kommt hierher.

### D-6 — Der abgehackte Einsatz der Eroeffnung.

Owner-Beobachtung 2026-07-31: „am Anfang hat der Einsatz abgehackt". Die Eroeffnung laeuft ueber
vorab synthetisiertes ElevenLabs-Audio (`opening_voice=elevenlabs`), also einen anderen Weg als
das restliche Gespraech. **Braucht eine Aufnahme, keine Vermutung.** Ungeprueft.

---

## 2. Was NICHT das Problem ist (nicht neu aufrollen)

Damit die naechste Session keine Zeit an bereits erledigten Fragen verbrennt:

- **AL-P2 ist gemessen:** Telnyx konsumiert unseren SSE-Strom **inkrementell**
  (`audio_first_token` 129 ms bei 8 s Rueckhalt, 99 ms bei 30 s). Turn-Timeout **> 30 s**.
  Streaming zu bauen war richtig. Es wirkt nur nicht, siehe D-1.
- **Die Klempnerei steht:** Werkzeuge werden korrekt angeboten, das Richtungs-Gate greift, die
  per-Tenant-Rechte sind gesetzt und DB-verifiziert, der Consult-Kanal claude.ai ↔ Telefon
  funktioniert (Consult #0 lief sauber: Fragen gestellt, beantwortet, `merged_facts:3`).
- **Der geteilte Consult-Zaehler ist WIDERLEGT** (`isInCallConsult` diskriminiert ueber
  `askedAtMs >= answeredAtMs`). `consultMaxPerCall` ist nicht die Ursache und wird nicht angefasst.
- **Alle Safety-Gates, Offenlegung, Auth sind unberuehrt.** Kein Befund dieser Uebergabe ist
  gefaehrlich; alle sind Wirkungslosigkeit, nicht Schaden.

---

## 3. Die Frage, die VOR der naechsten Phase auf den Tisch gehoert

Der Owner sagt, ein an **einem Tag** gebauter ElevenLabs-Agent war **zehnmal besser** als das,
woran hier seit Wochen gearbeitet wird. Das ist kein Prompt-Problem, das ist ein Signal ueber den
**Stack**.

Heute laeuft: `VOICE_ENGINE=budget` + Telnyx-AI-Assistant + unser Custom-LLM-Shim. Diese
Konstruktion bringt strukturelle Grenzen mit, die in diesem Repo dokumentiert sind:
- **kein echtes Barge-in** ausser ueber Streaming (`barge-in-telnyx-texml-limitation`),
- **STT-Qualitaet nicht in unserer Hand** (D-5),
- Turn-Taking und Timing weitgehend fremdbestimmt (`conversation-optimization-plan`:
  „Telnyx-Schalter stehen per DEFAULT gegen uns"),
- ein eigener Streaming-Stack ist als **Langfrist-Richtung** bereits notiert
  (`voice-stack-strategy`), braucht aber einen `RealtimeBackend`-Port — `bridge.js` ist heute
  OpenAI-fest.

**Auftrag an die naechste Session:** dem Owner diese Entscheidung **sauber aufbereitet** vorlegen,
bevor weitere Phasen in den bestehenden Pfad gebaut werden. Nicht ausweichen, nicht schoenreden,
nicht heimlich weiterbauen. Konkret: was kostet es, den ElevenLabs-Agenten, den er kennt, als
Referenz nachzustellen und **gegen** unseren Pfad zu messen — an denselben Anrufen, am selben Ohr?

**Bis diese Frage beantwortet ist, sind die Phasen unten Schadensbegrenzung, keine Strategie.**

---

## 4. Reihenfolge, wenn weitergebaut wird

Jede Phase liefert eine **Messung**, keine Behauptung. Bench ist `npm run convo-bench` (n >= 5).

1. **D-2 zuerst — warum feuert das Denk-Signal nie?** Es ist die einzige Faehigkeit, die die vom
   Owner gehoerten Pausen **direkt** adressiert, und sie kostet nichts extra (der Fueller ist
   fuehrender Text im selben Antwort-Block). Reproduktion offline gegen den Shim-Harness.
2. **D-3 — Tool-Entscheidungspunkt schaerfen.** Enge Verbote statt Beschreibungen, mit
   Bench-Fixture: „Gegenstelle verlangt eine Entscheidung ausserhalb des Mandats" MUSS
   `get_consult` ausloesen, nicht `take_message`. Und: eine Bitte um Nachschlagen, die dem
   **Auftrag** dient, MUSS `look_up` ausloesen — die Bitte eines Fremden nach beliebiger Recherche
   dagegen **nicht** (das ist korrektes Verhalten, kein Bug).
3. **D-1 — Owner-Design-Entscheidung, dann bauen.** Zwei Wege, beide legitim:
   (a) Armierungsregel verfeinern — streamen, sobald feststeht, dass kein Werkzeug mehr gerufen
   wird (Risiko: hoerbare Doppelrede, „gesprochen ist gesprochen");
   (b) Streaming bewusst hinten anstellen, solange Consult/Nachschlag an sind, und stattdessen
   D-2 tragen lassen. **Nicht raten — fragen.**
4. **D-5 (STT)** und **D-6 (Eroeffnung)** — beide brauchen zuerst eine **Aufnahme**, nicht eine
   Hypothese. D-5 ist vermutlich der groesste Einzelposten am schlechten Eindruck.
5. **AL-P15** (letzte offene Phase der Kette) — Messphase, ergibt erst Sinn, wenn `get_consult`
   real feuert. Vorher sinnlos.

---

## 5. Betriebsregeln, die diese Session bezahlt hat

1. **`call.answered` ist ein Protokoll-Ereignis, kein Mensch.** Von 7 Waehlversuchen erreichten 4
   den Owner; einer wurde nach exakt 30 s **vom Netz** angenommen (Mailbox/Ansage), und daraus
   wurde faelschlich „der Owner hat abgenommen und aufgelegt" geschlossen. Nicht wiederholen.
2. **Der `objective` von `place_call` wird woertlich vorgelesen.** Er gehoert in **korrektes
   Deutsch mit Umlauten**. Die ASCII-Konvention des Repos gilt fuer Quelltext, nicht fuer
   gesprochene Nutzdaten. Ein transliterierter Auftrag hat den Owner glauben lassen, die
   Umlaut-Aussprache sei kaputt — sie war es nie.
3. **Der pg-Store haelt Zustand im Speicher** (`requireState()`/`save()`). Ein direktes `UPDATE`
   ist fuer den laufenden Dienst unsichtbar **und kann von seiner alten Kopie ueberschrieben
   werden**. Regel: DB-Schreibzugriff -> **Neustart** -> **Gegenprobe**. RLS beachten:
   `SET app.current_tenant` muss in derselben psql-Sitzung stehen.
4. **„Gesetzt" ist nicht „wirkt".** Deshalb gibt es seit AL-P16 acht Boot-Sonden. Sie nennen
   ausdruecklich, wo eine Faehigkeit die **Schnittmenge** aus Plattform-Flag UND per-Tenant-Recht
   ist. Eine gruene Sonde beweist Konfiguration, **nicht** Wirkung — D-1 stand als `AKTIV` im
   Banner und tat nichts.
5. **Roten Testlauf immer mitschneiden** (`npm test > log; grep "^not ok"`). Diese Session hat
   zwei rote Tests gemeldet und ihre Namen verloren — der Fehler stand schon einmal in
   `al-chain-state.md`.
6. **Eine Bahn zur Zeit.** Keine `master`-Commits, waehrend ein Worktree-Workflow laeuft —
   sonst meldet der Review einen Stale-Base-Blocker, den es nicht gibt.
7. **Harness-Grenzen sind Grenzen:** Prod-DB-Schreibzugriff und Mehrfach-Env-Writes werden vom
   Klassifikator blockiert. Nicht umgehen — dem Owner den fertigen Befehl geben, er fuehrt ihn
   mit `!` aus.

---

## 6. Zustand des Systems

| | |
|---|---|
| Live-Commit | `44a7d09` (`/healthz` + Boot-Banner geprueft) |
| master == upstream | ja |
| Suite | `npm test` 3736/3736 gruen; `test:gates` 558 mit 3 rot (dokumentierter Bestand) |
| Kette | 16 von 17 gemergt; offen nur AL-P15 |
| Flags | **alle an** (Owner-Weisung 01.08.), per-Tenant-Rechte gesetzt und DB-verifiziert |
| Such-Anbieter | **Exa** (`EXA_API_KEY` gesetzt); Brave restlos entfernt |

**Offene Owner-Pflicht:** die Datenschutzerklaerung (`apps/web`) nennt weder die woertlichen
Zitate Dritter (`EVIDENCE_RETENTION_DAYS=7`) noch die anrufuebergreifende Wiederverwendung
(`allow_call_memory=true`). Beides ist seit dem 01.08. live, auf ausdrueckliche Owner-Freigabe.
Rueckweg: beide Werte zurueck auf `0` bzw. `false`, wirksam nach einem Neustart.

**Weiterfuehrend:** `tasks/al-chain-state.md` (Verlauf), `tasks/al-d1-report.md` (Diagnose mit
Entscheidungstabelle), `tasks/al-testcall-checklist.md` (offene Abnahmen),
`PLAN-ASSISTANT-LEAP.md` (Plan; **aelter als der Code**, jede Zahl am Code nachpruefen).
