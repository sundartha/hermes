# Kickoff: Abnahme der Anrufdefekte-Kette (gemeinsam mit dem Eigentuemer)

**Auftrag: pruefen, ob das Gebaute im echten Betrieb wirklich tut, was es tun soll.**
Nicht weiterbauen. Nicht refactoren. Testen, messen, Befunde benennen.

Der Eigentuemer macht die Anrufe selbst - **das ist eine gemeinsame Sitzung, keine autonome.**
Plane jeden Testanruf MIT ihm, sag ihm vorher woertlich, was er waehlen/sagen soll und was du
danach messen wirst, und werte direkt nach dem Anruf aus, solange er noch dabei ist.

---

## Regel 0: dieser Text ist Historie, nicht Gegenwart

Er beschreibt den Stand vom **17.09.2026**. Seither koennen andere Sitzungen gearbeitet haben;
im Arbeitsbaum lag am 17.09. bereits untrackte fremde Arbeit (`docs/architektur/`,
`tasks/iex-b-spec.md`, eine `.mp3`). **Uebernimm aus diesem Text KEINE Tatsache ueber den
Ist-Zustand.** Alles unten Genannte ist entweder mit einem Commit belegt (dann pruefbar) oder
ausdruecklich als unbelegt markiert.

Bevor du irgendetwas testest, stelle den Ist-Stand selbst fest:

```
git log --oneline -15
git status --short
curl -s https://app.sundartha.com/healthz          # welcher Commit laeuft WIRKLICH?
npm test 2>&1 | tail -4
npm run elevenlabs:drift 2>&1 | tail -3
```

Weicht etwas von dem ab, was hier steht: **das Gemessene gilt, nicht dieser Text.** Sag es dem
Eigentuemer, bevor du weitermachst.

---

## Was gebaut wurde und was es tun SOLL

Sechs Phasen aus `PLAN-ANRUFDEFEKTE.md`, gemergt am 06./07.09.2026. Die Ursachenanalyse steht
dort (W1-W9); der Kettenstand mit allen Entscheidungen in `tasks/anrufdefekte-chain-state.md`.

| Phase | Commit | Soll-Wirkung |
|---|---|---|
| P1 | `c535566` | Ein `get_consult` auf einem Anruf an die eigene hinterlegte Nummer wird mit **404** abgelehnt, bevor etwas gehalten oder geschrieben wird. Vorher prueften Anrufstart und Webhook verschiedene Dinge. |
| P2 | `fb5defb` | Der Rueckfrage-Webhook haelt die Telefonverbindung **gestaffelt** statt pauschal 47 s: Zustellung (`EL_CONSULT_DELIVERY_MS`, 5 s), Quittung (`EL_CONSULT_ACK_MS`, +5 s), Antwort (`EL_CONSULT_ANSWER_MS`, 30 s gesamt). `answer_consult` hat dafuer einen leichten Modus (`status="working"`). |
| P3 | `5ea4526` | Jeder Abbruch schreibt genau EINEN Audit-Eintrag `consult_timeout` mit `tenantId`, `callId`, `consultId`, `holdMs`, Grund und den Zeitspannen bis Zustellung/Quittung - **ohne Fragetext**. |
| P4a | `81629a6` | `place_call` nimmt optional `language`. Ohne Angabe gilt die Sprache des Auftraggebers (nicht mehr die der Zielnummer). Unbekannter Code -> **400 `unsupported_language`**, kein Anruf. **Die Sprache des Offenlegungssatzes folgt weiterhin dem ANGERUFENEN** und ist serverseitig verriegelt. |
| P6 | `153a73a` | `scripts/anruf-unterbrechungen.mjs` - read-only Messwerkzeug fuer Unterbrechungen und Dauer. |
| P7 | `8dcf698` | `turn_eagerness: "patient"` am Agenten (Rueckfall `"normal"`). |

Server-Code live seit `40ff4c6`. Am Anbieter-Agenten wurden gesetzt: `turn_eagerness=patient`
(per Push) sowie am Werkzeug `get_consult` `interruption_mode=allow`,
`disable_interruptions=false`, `tool_call_sound=null` (per Dashboard, am 07.09. per API
gegengeprueft).

---

## Was BELEGT ist und was NICHT

**Belegt (gemessen am 17.09., `tasks/p7-vorher-messung.md`):** P7 wirkt. Ueber 10 gefuehrte
Gespraeche sank der Anteil unterbrochener Agenten-Turns von 24,8 % auf 4,0 %, die mittlere
Gespraechsdauer von 72,1 s auf 62,1 s. Die Sorge aus dem Pre-Mortem (PM-4: laengere und damit
teurere Anrufe) ist damit entkraeftet.

**NICHT belegt - und das ist der Hauptgrund dieser Sitzung:**

1. **P1, P2 und P3 sind im Feld NIE ausgeloest worden.** In 22 Anrufen seit der Umstellung:
   null Consults, null `consult_timeout`-Eintraege (Prod-DB, 17.09.). Der gesamte dreistufige
   Halt ist ungetestet - er ist nur durch `test/el-consult-staffelung.test.js` abgedeckt.
2. **Der Laerm-Fall selbst ist nicht nachgemessen.** Die Nachher-Anrufe waren Alltagsanrufe;
   ob ueberhaupt einer aus lauter Umgebung kam, weiss nur der Eigentuemer. Der Anwendungsfall,
   der P7 ausgeloest hat ("der Assistent soll auch im Restaurant stehen"), ist offen.
3. **P4a ist im Feld nur teilweise sichtbar.** Zwei Inbound-Anrufe liefen am 17.09. auf
   Franzoesisch; ein Outbound-Anruf mit ausdruecklichem `language`-Parameter ist nicht belegt.

---

## Die Tests, in dieser Reihenfolge

Jeder Test nennt: was der Eigentuemer tut, was passieren SOLL, und womit du es PRUEFST.
**Wenn ein Test nicht das erwartete Ergebnis bringt, ist das ein Befund - kein Anlass, den
Test umzudeuten.** Erst messen, dann erklaeren.

### T1 - Der Rueckfrage-Kanal bricht frueh ab (P2, P3) - WICHTIGSTER TEST

Dies ist der eigentliche Defekt vom 06.09.: der Anrufer hoerte rund 40 s Stille.

**Aufbau.** Ein Outbound-Anruf an eine Nummer, die NICHT die hinterlegte eigene Nummer des
Tenants ist (sonst greift P1 und es entsteht gar keine Rueckfrage - das ist T2). Der Auftrag
muss so gebaut sein, dass dem Agenten unterwegs eine Information fehlt, die nur der
Auftraggeber kennt. Bewaehrt: ein Terminwunsch ohne Zeitangabe, sodass die Gegenstelle
zurueckfragt. Plane den Wortlaut gemeinsam mit dem Eigentuemer.

**Der entscheidende Teil: der Eigentuemer antwortet NICHT auf die Rueckfrage.** Er laesst sie
unbeantwortet und misst die Stille am Telefon mit (Stoppuhr oder Gefuehl - beides reicht fuer
die Groessenordnung).

**SOLL:** der Agent spricht nach rund **10 Sekunden** weiter (Zustellung 5 s + Quittung 5 s),
nicht nach 47. Hoert der Eigentuemer deutlich laengere Stille, ist der Test rot.

**PRUEFEN:**
```
# Audit-Eintrag (Prod-DB; RLS beachten, s. Fallen unten)
SET app.current_tenant='<tenant>';
SELECT at, action, detail FROM audit_log WHERE action='consult_timeout' ORDER BY at DESC LIMIT 3;
```
Erwartet: genau EIN neuer Eintrag, mit einem Grund (`not_delivered` / `not_acked` / `timeout`),
`holdMs` in der Groessenordnung von 10 000, **und ohne den Fragetext**. Pruefe ausdruecklich,
dass kein Gespraechsinhalt darin steht - das war eine harte Auflage der Phase.

**Variante T1b (wenn Zeit ist):** derselbe Anruf, aber der Eigentuemer ANTWORTET zuegig. SOLL:
die Antwort kommt beim Agenten an, das Gespraech laeuft normal weiter, **kein**
`consult_timeout`-Eintrag.

### T2 - Das Torleck ist zu (P1)

**Aufbau.** Ein Anruf an die eigene hinterlegte Nummer des Tenants, mit einem Auftrag, der den
Agenten zu einer Rueckfrage verleiten koennte.

**SOLL:** es entsteht **gar keine** Rueckfrage. Serverseitig wird ein `get_consult` mit 404 und
dem Grund `kanal_nicht_freigegeben` abgelehnt, in unter einer Sekunde, ohne die Leitung zu
halten.

**PRUEFEN:** Render-Logs auf `[el-consult] abgelehnt grund=kanal_nicht_freigegeben`; in der DB
muss `consults` bei diesem Anruf leer bleiben. Ruft das Modell das Werkzeug gar nicht erst auf,
ist der Test **nicht aussagekraeftig** (dann hat der Prompt es verhindert, nicht das Tor) -
sag das dem Eigentuemer ehrlich, statt es als Erfolg zu buchen.

### T3 - Der Anrufer kann die Wartezeit unterbrechen (P2, Dashboard-Teil)

Waehrend der Rueckfrage aus T1: der Eigentuemer redet dazwischen.

**SOLL:** der Agent reagiert darauf (Turn wird uebernommen), und der Einwurf steht im
Transkript. Vor der Aenderung war der Anrufer in dieser Zeit stumm geschaltet und seine
Einwuerfe tauchten nirgends auf.

**PRUEFEN:** Transkript des Anrufs ueber die ElevenLabs-Conversation-API; der Einwurf muss als
User-Turn erscheinen. Ausserdem: **kein Tastatur-Tippgeraeusch** mehr waehrend der Wartezeit,
stattdessen ein gesprochener Hinweis vor dem Werkzeugaufruf.

### T4 - Sprachwahl und Offenlegung (P4a) - SICHERHEITSRELEVANT

**T4a:** `place_call` mit `language: "fr"` an eine **deutsche** Nummer.
**SOLL:** das Gespraech laeuft franzoesisch, **der Offenlegungssatz ist DEUTSCH** - die Sprache
des Angerufenen, nicht die des Auftraggebers. Das ist Artikel 50 EU AI Act und keine
Geschmacksfrage.
**PRUEFEN:** erster Satz im Transkript. Er muss mit dem deutschen Pflichtsatz aus
`LOCALES.de.disclosure` beginnen.

**T4b:** `place_call` mit `language: "pt"`.
**SOLL:** **400 `unsupported_language`**, kein Anruf, kein Datensatz, keine Kosten. Portugiesisch
ist gebaut, aber bewusst nicht aktiviert (s. unten).
**PRUEFEN:** Antwort des Werkzeugs; danach in der DB nachsehen, dass KEIN Anruf entstanden ist.

**T4c:** `place_call` ohne `language` an eine deutsche Nummer bei deutschem Tenant.
**SOLL:** unveraendert wie frueher.

### T5 - Der Laerm-Fall, gezielt (P7)

Der Eigentuemer fuehrt bewusst mindestens **fuenf** Anrufe aus lauter Umgebung (Restaurant,
Musik, Strassenlaerm) - der Fall, der die Phase ausgeloest hat.

**PRUEFEN:**
```
node scripts/anruf-unterbrechungen.mjs <conversation_ids>
```
Vergleich gegen `tasks/p7-vorher-messung.md`. **Dieselbe Ausschlussregel anwenden: nur Anrufe
mit mindestens 3 Agenten-Turns**, sonst vergleichst du zwei verschiedene Dinge. Die mittlere
Gespraechsdauer mitlesen: sinkt der Unterbrechungsanteil, steigt aber die Dauer deutlich ueber
72 s, ist das ein Tausch gegen Geld (30 ct/min) - und die Entscheidung darueber gehoert dem
Eigentuemer, nicht dir.

### T6 - Offener Befund: drei Inbound-Anrufe ohne Zusammenfassung

Am 12./13.09. haben drei angenommene Inbound-Anrufe **keine** Zusammenfassung erzeugt
(Prod-DB, 17.09. gemessen). Frueher war genau das das Symptom eines leeren DeepSeek-Guthabens
(W7 im Plan). **Ursache nicht untersucht.** Pruefe, ob es weiterhin auftritt, und finde die
Wurzel, bevor jemand eine Vermutung aeussert. Ausserdem: Inbound laeuft inzwischen ueber
ElevenLabs statt ueber die Budget-Engine - wann und durch wen das umgestellt wurde, ist hier
nicht bekannt.

---

## Was du NICHT tust

- **Nicht weiterbauen.** Findest du einen Defekt: benennen, belegen, dem Eigentuemer vorlegen.
  Ein Fix ist eine eigene Entscheidung und eine eigene Sitzung.
- **`phase/p4b-portugiesisch-fix3` nicht mergen.** Der Branch ist fertig, aber blockiert an zwei
  Punkten, die nur der Eigentuemer entscheiden kann: die hinterlegte portugiesische Stimme ist
  **geraten** (nicht per Synthese belegt), und der portugiesische Offenlegungssatz ist **nicht
  freigegeben**. Der blosse Merge wuerde diesen ungeprueften Art.-50-Satz sofort scharf
  schalten - fuer jede +351-Nummer, ohne Anbieter-Push.
- **Keine Aenderung an Safety-Gates, am Offenlegungssatz oder an der OC-Ausnahme.**
- **Keine schreibenden Operationen auf der Prod-DB.** Lesen ja, schreiben nein.
- **Kein `npm run elevenlabs:push` ohne ausdrueckliche Freigabe im Moment** - und wenn, dann
  immer erst der Trockenlauf.

---

## Fallen, die in diesem Projekt schon Zeit gekostet haben

- **Die Prod-DB hat FORCE ROW LEVEL SECURITY.** Ein naives `SELECT` liefert **0 Zeilen** - das
  sieht aus wie "keine Daten", ist aber "kein Tenant-Kontext". Immer
  `SET app.current_tenant='<tenant-id>';` voranstellen. `SET row_security = off` wird
  abgelehnt. Die Tenant-IDs stehen in `tenant`; der aktive Tenant ist der mit Anrufen.
- **Das Deploy-Repo ist `upstream` (jonas986), nicht `origin`.** Ein Push nach `origin` macht
  nichts live.
- **`autoDeploy` steht auf `no`.** Ein Push deployt NICHT. Ob der Code wirklich laeuft, sagt
  ausschliesslich `curl https://app.sundartha.com/healthz` - vergleiche den dort gemeldeten
  Commit mit `git rev-parse HEAD`.
- **`npm test` ist rot, und zwar seit vor dieser Kette:** `KV2-10 (d1)` und `(d2)` in
  `test/kv2-10-tarifpaar.test.js` scheitern auch auf `bf96a94`. Ursache nicht untersucht. Zaehle
  sie nicht als neue Regression - aber wisse, dass sie echte Regressionen verdecken koennen.
- **`test/al-p10-precall-research.test.js` pinnt `LLM_PROVIDER` nicht.** Mit
  `LLM_PROVIDER=deepseek` in der lokalen `.env` scheitern 9 von 12 Faellen bei direktem
  `node --test`, waehrend `npm test` gruen bleibt. Kein Defekt der Kette.
- **Der Lint-Hook prueft das ganze Repo**, auch untrackte fremde Dateien. Am 17.09. blockierte
  `docs/architektur/erzeuge-karte.mjs` dadurch reine Doku-Commits.
- **Transkripte sind kein Beleg fuer Gesagtes.** Wo Audio existiert, ist das Audio der Beleg -
  es gab hier schon Phantom-Turns der Spracherkennung (`tasks/lessons.md`, 04.09.).

---

## Am Ende

Sag dem Eigentuemer klar, welche der Tests T1-T6 **bestanden**, welche **rot** und welche
**nicht aussagekraeftig** waren - die dritte Kategorie ist wichtig und darf nicht in einer der
anderen verschwinden. Schreibe das Ergebnis in `tasks/anrufdefekte-chain-state.md` fort.
