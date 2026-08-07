# PLAN-ANBIETER-PORT — LLM-Anbieter austauschbar machen (B) + Twilio entfernen (C)

Auftrag: `tasks/kickoff-anbieter-austauschbarkeit-2026-08-07.md`, Tracks B und C.
Track A (STT-Modellwahl) laeuft getrennt, s. `tasks/todo.md` und `tasks/stt-a1-spec.md`.

**Regel: nur Gemessenes.** Jede Aussage traegt einen Beleg (Datei:Zeile, Anbieter-Doku,
API-Antwort) oder ist ausdruecklich als **unbelegt** markiert.

B und C stehen in EINEM Dokument, weil sie sich beruehren: C loescht die zweite
Implementierung der Naht, die B ausbaut.

## Stand (2026-08-07)

Der Owner hat **Track C zuerst** entschieden. **Track B ist nicht begonnen** und bleibt es,
bis der DeepSeek-API-Schluessel vorliegt (Phase B1 ist eine Messung an der echten API, keine
Lektuere) und O-3/O-5 entschieden sind.

| Phase | Stand |
|---|---|
| **C-P1** Rueckfall-Default explizit auf Telnyx | **gemergt** (`f0c5b8d`) |
| **C-P1b** fuenf Parameter-Defaults in `registry.js` nachgezogen | **gemergt** — Korrektur eines von C-P1 verursachten Defekts, s. u. |
| **C-P2** Testsuite-Fixtures auf Telnyx + Inventur | **gemergt** (`86c1fac`) |
| **C-P3** Header-Dispatch + Signaturpruefung | offen |
| **C-P4** Adapter, Config, Boot-Pflicht, Doku | offen |
| **C-P5** Abnahme mit echtem Anruf | **braucht den Owner** |
| **C2** Indirektion zurueckbauen | offene Entscheidung O-4, Empfehlung: nein |

**Nichts davon ist deployt.** Live laeuft der STT-A1-Stand (`5865b96`); Track C liegt auf
lokalem `master`. Ein Provider-Ausbau ohne echten Anruf ist nicht abgenommen.

**Lehre aus C-P1/C-P1b, die fuer C-P3 und C-P4 gilt:** die Spec von C-P1 nannte vier Leser
des Rueckfalls. Es waren zehn — plus fuenf **weitere**, unabhaengige Anbieter-Defaults, die
als Parameter-Default in `registry.js` standen und nicht `DEFAULT_PROVIDER` lasen. C-P1 hat
dadurch kurzzeitig eine Divergenz erzeugt (`/voice/turn` -> Twilio, `/voice/status` ->
Telnyx). **Vor jedem weiteren Schritt breiter grepen als nach dem offensichtlichen Symbol:**
nicht nur `DEFAULT_PROVIDER`, sondern auch `PROVIDER.TWILIO`, `"twilio"`, `twilio` als
Parameter-Default, Fixture und Kommentar-Behauptung.

---

## Die Owner-Vorgabe

> *"Einfach ein Adapter — und wenn man dann einen neuen Anbieter hat, baut man einen Adapter
> fuer diesen Anbieter. Der Code dahinter ist egal, welcher Anbieter das ist. Ich moechte
> ausprobieren koennen, ob es mit DeepSeek besser klappt, oder mit einem chinesischen
> Sprachmodell."*

> *"Es darf nicht sein, dass ich den LLM wechsle und ploetzlich werden die Kosten nicht mehr
> richtig getrackt."*

Beide Saetze sind bindend. Der zweite macht B zu einer Safety-Aufgabe: die Preisachse, die
hier haengt, ist die **pro-Tenant-Kostendecke** — Absolute Regel 1.

---

# Teil 1 — Was gemessen ist

## 1.1 Ausgangslage Track B (nachgeprueft, nicht uebernommen)

| Fakt | Beleg |
|---|---|
| `src/llm.js` ist der bestehende Seam (Timeout, Retry, Circuit-Breaker), **380 Zeilen**, importiert das Anthropic-SDK direkt | `src/llm.js:19` (`import Anthropic from "@anthropic-ai/sdk"`), `:252` (`new Anthropic({...})`) |
| Vier Konsumenten | `src/claude.js`, `src/precall-briefing.js`, `src/telnyx-llm-shim.js`, `src/routes/voice.js` |
| `claude.js` ist **1311 Zeilen** und beruehrt die Anthropic-Nachrichtenform an 13 Stellen (`tool_use`, `tool_result`, `stop_reason`, Token-Felder) | grep in `src/claude.js`, u. a. `:1032`, `:1130-1136` |
| Telnyx spricht mit uns in **OpenAI-Form** (BYO-LLM ueber `external_llm` -> unser `/v1`) | `src/telnyx-llm-shim.js` (**994 Zeilen**), Assistant-Objekt `external_llm.base_url` |

## 1.2 Die Klippe: die Preisquelle hat die falsche FORM, nicht nur fehlende Zeilen

```js
// src/config.js:1414-1417
modelPricesUsd: {
  "claude-haiku-4-5": { inPerMTok: 1.0, outPerMTok: 5.0 },
  "claude-sonnet-5":  { inPerMTok: 3.0, outPerMTok: 15.0 },
},
```

Ein Modell, das dort **nicht** steht, wird fail-closed mit der **teuersten** hinterlegten Rate
gebucht (`priceForModel`, `src/store/state-ops.js:2239-2241`). Genau diese Achse liest die
pro-Tenant-Kostendecke.

**Der eigentliche Befund liegt eine Ebene tiefer.** `inputTokensOf`
(`src/llm-usage.js:21-27`) summiert `input_tokens + cache_creation_input_tokens +
cache_read_input_tokens` zu **einer** Zahl und bucht sie zu **einer** Input-Rate. Der
Kommentar nennt die Absicht: *"fail-safe: NIE weniger als ohne Caching"*.

Bei Anthropic ist das vertretbar (Cache-Lesen kostet rund ein Zehntel des Listenpreises, wir
ueberbuchen also hoechstens um Faktor 10 auf einem kleinen Anteil). **Bei DeepSeek nicht:**

| DeepSeek-Modell | Input Cache-Hit | Input Cache-Miss | Output | Spreizung |
|---|---|---|---|---|
| `deepseek-v4-flash` | $0,0028 / 1M | $0,14 / 1M | $0,28 / 1M | **50x** |
| `deepseek-v4-pro` | $0,003625 / 1M | $0,435 / 1M | $0,87 / 1M | **120x** |

(Quelle: `api-docs.deepseek.com/quick_start/pricing`, abgerufen 2026-08-07. Die Seite kuendigt
zugleich an: *"we plan to raise the overall pricing for DeepSeek API services in the near
future, with a significant increase expected"* — die Tabelle ist ein Momentwert, kein Vertrag.)

**Warum das kein rein akademisches Problem ist:** dieselbe Zahl geht auf **zwei** Achsen —
den Budget-Bucket (Gate, Regel 1) UND den Stripe-Ledger (`aiCostCents` -> `meterAiTokens`,
`src/llm-usage.js:29-49`). Ueberbuchen ist auf der Gate-Achse die sichere Richtung; auf dem
**Kundenbeleg** ist es ein Abrechnungsdefekt. Bei Faktor 120 ist das kein Rundungsfehler.

> **Folge fuer den Port-Vertrag:** der Port meldet den Verbrauch **aufgeschluesselt**
> (ungecachter Input, Cache-Schreiben, Cache-Lesen, Output) plus die ID, unter der gebucht
> wird — nicht eine Summe. Die Preisstaffel bekommt entsprechend Raten je Sorte. Ein Port,
> der eine Input-Zahl liefert, tauscht Austauschbarkeit gegen ein blindes Sicherheits-Gate
> und einen falschen Kundenbeleg.

## 1.3 Dass wir die ANGEFORDERTE Modell-ID buchen, ist Absicht — und wird zur Frage

`billedTokens` (`src/llm-usage.js:59-61`) bucht unter der **angeforderten** ID, nicht unter
`resp.model`. Begruendung im Code (`:55-58`): Anthropic antwortet mit einer datierten
Snapshot-ID, die nicht in der Preistabelle steht — jeder Turn liefe sonst in den
Fail-closed-Zweig. Das ist eine dokumentierte Entscheidung, kein Versehen.

Fuer einen Fremdanbieter ist sie **nicht automatisch richtig**: ein Anbieter, der still auf
ein anderes (teureres) Modell ausweicht, wuerde unter der billigeren angeforderten ID
gebucht. **Welche ID gilt, gehoert deshalb in den Port-Vertrag** — je Adapter entschieden und
begruendet, nicht global geerbt.

## 1.4 DeepSeek konkret (Doku-Stand, LIVE UNBELEGT)

| Frage | Antwort | Quelle |
|---|---|---|
| OpenAI-kompatibel? | ja — *"The DeepSeek API uses an API format compatible with OpenAI/Anthropic."* Base-URL `https://api.deepseek.com` | `api-docs.deepseek.com/guides/function_calling` |
| Werkzeug-Aufrufe | OpenAI-Form: `tools` mit `{"type":"function", function:{...}}`, Antwort `message.tool_calls[]`, Ergebnis als `{role:"tool", tool_call_id, content}` | `api-docs.deepseek.com/guides/tool_calls` |
| Modelle mit Werkzeug-Unterstuetzung | `deepseek-v4-pro`; *"From DeepSeek-V3.2, the API supports tool use in the thinking mode."* | ebenda |
| Werkzeuge + Streaming zusammen | **in der Doku nicht beantwortet** | — |
| Zuverlaessigkeit / Einschraenkungen | **nichts dokumentiert** | — |
| Verbrauchsfelder der Antwort | **nicht dokumentiert** (Preisseite nennt nur "total number of input and output tokens"; die Cache-Preisstaffel setzt voraus, dass es getrennte Felder gibt — welche, ist unbelegt) | — |

**Die drei Luecken sind der Grund, warum Phase B1 eine Messung ist und keine Lektuere.**
Dieses Repo hat sich zweimal an Anbieter-Doku verbrannt, die dem Verhalten widersprach
(zuletzt B-7: die Doku behauptete Deutsch-Unterstuetzung, das Modell gab Englisch aus).

## 1.5 Ausgangslage Track C — die Praemisse ist jetzt BELEGT

Der Kickoff verlangte vor jedem Loeschen den Nachweis, dass keine Nummer und kein Tenant auf
Twilio steht. **Gemessen am 2026-08-07 gegen die Produktions-Datenbank** (`hermes_db_1jru`,
RLS ist FORCE, `app.current_tenant` je Tenant gesetzt):

| Tenant | Nummern | Anrufe |
|---|---|---|
| `owner` | 1x telnyx | 1 inbound + 1 outbound, telnyx |
| `t_user_01KX6…` | 1x telnyx | 8 inbound + 55 outbound, telnyx |
| `t_user_01KXH…` | 1x telnyx | 2 outbound, telnyx |
| **Summe** | **3 Nummern, 0 auf Twilio** | **67 Anrufe, 0 auf Twilio** |

`select count(*) from tenant` = 3; die Tenant-Tabelle traegt keine RLS, die Zaehlung ist
vollstaendig.

**Noch offen (Owner oder Render-Dashboard):** sind `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`
in der Render-Umgebung gesetzt? Das Render-MCP bietet nur einen **schreibenden** Env-Zugang;
read-only ist die Frage mit den vorhandenen Werkzeugen nicht beantwortbar. Sie blockiert C
nicht (ein gesetzter Key ohne Account ist harmlos), gehoert aber in die Abnahme von C4.

## 1.6 Twilio ist kein toter Zweig, sondern ein Rueckfall-Default

| | |
|---|---|
| Adapter selbst | 7 Dateien, **233 Zeilen** |
| Quelldateien ausserhalb des Adapters mit Twilio-Bezug | **~20** |
| **Testdateien mit Twilio-Bezug** | **124** |

- `src/config.js:921` — *"Provider der geseedeten Owner-Betriebsnummer (twilio\|telnyx). Leer
  (Default) -> **Twilio**"*
- `test/helpers.js:24/30` — `OWNER_TEST_NUMBER` / `DOMESTIC_TEST_NUMBER` tragen
  `provider: "twilio"`; `BASE_ENV` setzt `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_EDGE`, `SKIP_TWILIO_SIGNATURE_CHECK`
- `test/helpers.js:871` — *"ohne sie faellt `providerFromHeaders` auf Twilio/DEFAULT_PROVIDER"*

Ein unbedachtes Loeschen aendert damit **still**, was bei leerer Konfiguration passiert.

---

# Teil 2 — Track B: der LLM-Anbieter-Port

## Warum das LLM und nicht STT/TTS

**Weil wir das LLM selbst aufrufen.** Im Assistant-Pfad besitzt Telnyx den Medienweg; wir
waehlen nur Strings aus Telnyx' Liste (Track A). Ein eigener STT-/TTS-Adapter setzt den
**eigenen Streaming-Stack** voraus (`src/bridge.js`, heute OpenAI-fest) — eine eigene,
groessere Owner-Entscheidung und **nicht** Teil dieses Plans. Beim LLM ist die Lage umgekehrt:
der Aufruf gehoert uns, die Naht existiert schon, sie ist nur anbieter-fest.

## Die drei Abnahmekriterien (Owner-Vorgabe, keines optional)

1. **Ein Anbieterwechsel ohne hinterlegte Preise ist unmoeglich, nicht nur teuer.** Heute
   faellt ein unbekanntes Modell still auf die teuerste Rate. Bei einem fremden Anbieter ist
   "teuerste Anthropic-Rate" keine sinnvolle Schaetzung mehr. **Der Boot bricht fail-closed
   ab**, wenn das konfigurierte Modell keine Preise hat.
2. **Ein Test, der beweist, dass gebucht wird — je Adapter.** Nicht "die Funktion wurde
   aufgerufen", sondern: nach einem Turn mit Adapter X steht auf der Budget-Achse der
   erwartete Betrag. **Und die Gegenprobe: ohne die Buchung ist der Test rot.**
3. **Die Token-Semantik je Anbieter belegen, nicht annehmen.** Was zaehlt als Eingabe-Token,
   wie werden Cache-Anteile gemeldet, liefert der Anbieter ueberhaupt eine Verbrauchsangabe?
   Fehlt sie, braucht der Port eine dokumentierte Schaetzung — und die darf nur die
   Budget-Achse treffen, **nie den Kundenbeleg** (bestehende Regel, `llm-usage.js:76-84`).

## Die Phasen

### B1 — Messen statt lesen: DeepSeek an der echten API (keine Repo-Aenderung)

**Ergebnis:** ein Messprotokoll unter `data/evidence/deepseek-probe/` (gitignored), das die
drei offenen Zeilen aus 1.4 schliesst: Werkzeug-Aufrufe zusammen mit Streaming, die exakten
Verbrauchsfelder der Antwort, und ob `model` in der Antwort der angeforderten ID entspricht.

**Verifikation:** ein Wegwerf-Skript unter `scripts/` (oder gar nicht im Repo) gegen
`https://api.deepseek.com` mit einem Wegwerf-Schluessel und **einem** Werkzeug in unserer
echten Form. Ausgabe: die rohen JSON-Felder, nicht eine Zusammenfassung.

**Braucht der Owner:** einen DeepSeek-API-Schluessel. Ohne ihn ist B1 blockiert und der ganze
Track B mit ihm — jede Zeile danach haengt an diesen Feldnamen.

**Pre-Mortem:** *"Wir haben den Port gegen die Doku gebaut, und die Antwortform war anders."*
-> genau dafuer ist B1 eine Messung. Ohne B1-Protokoll faengt B2 nicht an.

### B2 — Den Vertrag schreiben, bevor er implementiert wird

**Ergebnis:** `src/llm/ports.js` nach dem Vorbild von `src/telephony/ports.js` — der Vertrag
als Dokument, nicht als Implementierung. Mindestumfang, **jede Faehigkeit mit einem heutigen
Aufrufer**:

| Faehigkeit | heutiger Aufrufer |
|---|---|
| Vervollstaendigung mit Werkzeugen | `claude.js` `agentTurn` |
| Streaming-Deltas | `telnyx-llm-shim.js` |
| Verbrauchsmeldung: Tokens **aufgeschluesselt** (s. 1.2) **und** die ID, unter der gebucht wird | `llm-usage.js` |
| Fehlerklassifikation transient vs. endgueltig | `llm.js` (heute anhand von Anthropic-Fehlertypen) |
| Abbruch/Timeout | `llm.js` |

**Nicht in den Vertrag:** alles ohne heutigen Aufrufer. Der Port bleibt so schmal wie moeglich.

**Pre-Mortem:** *"Der Vertrag wurde breit gebaut, und niemand hat je einen zweiten Adapter
geschrieben."* -> akzeptiertes Risiko, vom Owner bewusst eingegangen; die Gegenmassnahme ist
die Aufrufer-Spalte oben.

### B3 — Die Werkzeug-Schleife neutralisieren. **Das ist die eigentliche Arbeit.**

Anthropic (`content`-Bloecke mit `tool_use`/`tool_result`) und OpenAI-kompatible APIs
(`tool_calls`, `role:"tool"`) haben verschiedene Formen. **Die Frage, die B3 beantwortet: wo
liegt die Grenze — normalisiert der Port, oder bekommt `claude.js` eine neutrale Form?**

Empfehlung zur Entscheidung: **der Port normalisiert.** `claude.js` hat 1311 Zeilen und 13
Beruehrungspunkte; ein Umbau dort ist ein Umbau am Live-Sprechpfad. Der Aktivposten:
`telnyx-llm-shim.js` uebersetzt auf der EINGANGS-Seite bereits OpenAI-Form in unsere Form.
**Ob dieser Uebersetzer fuer die Ausgangsseite wiederverwendbar ist, ist unbelegt** und ist
die erste Frage von B3.

**Vorher-Werte sind PFLICHT und muessen VOR dem Umbau stehen** — sonst ist hinterher nicht
unterscheidbar, ob der Port oder das Modell schuld ist:

- `npm run convo-bench` mit **n>=5**
- die offenen Zahlen aus `tasks/gq-chain-state.md`: `get_consult` **0 von 4** bei 4/4
  angeboten; frueher `look_up` 0/19

**Pre-Mortem:** *"Der Port hat die Werkzeug-Schleife neutralisiert und dabei
`get_consult`/`look_up` subtil kaputtgemacht."* -> beide feuern heute schon zu selten
(B-4/AL-D3). Ohne Vorher-Wert ist der Schaden unsichtbar.

### B4 — Preisquelle und Gate

**Ergebnis:** Preisstaffel je Anbieter in der Form aus 1.2 (Raten je Token-Sorte), Umrechnung,
und **Boot-Abbruch bei unbekanntem Modell** (Abnahmekriterium 1). Fail-closed bleibt
fail-closed.

**Verifikation:** Test je Adapter nach Abnahmekriterium 2, **mit Gegenprobe**. Zusaetzlich ein
Test "konfiguriertes Modell ohne Preiseintrag -> Boot bricht ab" (Spawn-Test).

**Pre-Mortem:** *"Wir haben den Port gebaut, DeepSeek angeschlossen — und die Kostendecke hat
einen Monat lang falsch gerechnet."* -> genau dagegen stehen 1.2, 1.3 und dieser Test.

### B5 — Der erste Fremdadapter

**Ergebnis:** ein DeepSeek-Adapter hinter dem Vertrag aus B2, abgenommen mit einem **echten
Anruf** — `telnyx-llm-shim.js` ist der Live-Sprechpfad, Tests allein nehmen ihn nicht ab.

**Die Messgroesse steht VOR dem Adapter fest** (Kickoff-Frage 5): `npm run convo-bench` (n>=5)
plus die `get_consult`/`look_up`-Trefferquote aus B3. Ohne Zahl ist "klappt besser" Gefuehl.

**Pre-Mortem:** *"Der Umbau hat den Telnyx-Shim gebrochen und alle Anrufe fielen aus."* ->
Abnahme mit echtem Anruf, und der Adapter kommt hinter ein Flag, das per Env zurueckfaellt.

---

# Teil 3 — Track C: Twilio entfernen

## C1 — Den Adapter loeschen: entschieden

**Owner-Aussage, bindend:** es existiert **kein verbundener Twilio-Account**. Twilio ist damit
nicht "ein zweiter Anbieter, den wir gerade nicht nutzen", sondern **Code, der nicht
funktionieren wuerde, wenn man ihn anspraeche**. Das entwertet zwei Rechtfertigungen, die
hiermit gestrichen sind:

- *"Twilio als Rueckfall/Redundanz"* — **Fiktion.** Ein Carrier-Failover braucht Account,
  gekaufte Nummern, Webhooks, Signaturschluessel und eine Nummern-Migration pro Tenant.
- *"Twilio als Vorbild fuer den naechsten Adapter"* — **schaedlich.** Ein Adapter, der nie
  gegen eine echte API laeuft, ist irrefuehrende Doku.

### Reihenfolge — jeder Schritt einzeln abgenommen

| # | Schritt | Warum in dieser Reihenfolge |
|---|---|---|
| 1 | **Praemisse belegt** (1.5) | ERLEDIGT: 3 Nummern, 67 Anrufe, alle telnyx |
| 2 | **Die Default-Eigenschaft zuerst nehmen.** `config.js:921` explizit auf Telnyx, `providerFromHeaders`-Rueckfall explizit machen — eigener Schritt mit Test | sonst wandert ein Default lautlos, waehrend Code verschwindet |
| 3 | **Testsuite migrieren, BEVOR der Adapter faellt.** `OWNER_TEST_NUMBER`/`DOMESTIC_TEST_NUMBER` auf Telnyx, `BASE_ENV` bereinigen | **Gegenprobe zwingend:** die Suite muss nach der Migration dieselben Invarianten pruefen, nicht bloss gruen sein. Wo ein Test den Twilio-Zweig abdeckte, braucht der Telnyx-Zweig einen aequivalenten Test — sonst sinkt die Abdeckung unsichtbar |
| 4 | **Der Header-Dispatch und die Signaturpruefung — zusammen.** *(korrigiert 2026-08-07, s. u.)* Der Twilio-Zweig faellt in `providerFromHeaders` (`registry.js:176`) UND in `inboundSignatureVerifier` (`registry.js:188`) im selben Zug, dazu `adapters/twilio/signature.js` | nie die Pruefung ohne den Dispatch. `src/route-policy.js` + `test/route-auth-inventory.test.js` bleiben das Netz (Absolute Regel 3) |
| 5 | **Adapter, Config, `.env.example`, `render.yaml`, Doku** | Env-Keys aus `config.js` entfernen heisst auch `BASE_ENV` in `test/helpers.js` nachziehen (bekannte Drift-Falle) |
| 6 | **`npm test` gruen, Smoke-Test, echter Anruf** | ein Provider-Ausbau ohne echten Anruf ist nicht abgenommen |

### Korrektur zu Schritt 4 (gemessen 2026-08-07)

**Es gibt keine `/voice/twilio/*`-Routen.** Die fruehere Fassung dieses Plans nahm sie an;
gegruept existieren sie nicht. Die `/voice`-Routen sind **geteilt**
(`/voice/incoming`, `/voice/turn`, `/voice/outbound`, `/voice/status`,
`/voice/call-control`, `/voice/tts/:token` — alle in `src/route-policy.js` gelistet), und der
Provider wird aus den **Headern** bestimmt, nicht aus dem Pfad:

```js
// src/telephony/registry.js:174-180
export function providerFromHeaders(headers) {
  if (h["x-twilio-signature"] !== undefined) return PROVIDER.TWILIO;
  if (h["telnyx-signature-ed25519"] !== undefined && h["telnyx-timestamp"] !== undefined)
    return PROVIDER.TELNYX;
  return null;
}
```

Der Verifier (`registry.js:182-192`) verzweigt auf genau dieses Ergebnis und liefert bei
unbekanntem Provider `false` — **fail-closed**. Daraus folgt der richtige Schnitt: faellt der
Twilio-Zweig in **beiden** Funktionen gemeinsam, landet ein Request mit
`x-twilio-signature` bei `providerFromHeaders -> null -> verifier false -> 403`. Genau das
gewuenschte Verhalten, ohne dass eine Route stehen bleibt.

**Die Gefahr, die die Reihenfolge erzwingt:** wer nur `signature.js` entfernt und
`providerFromHeaders` stehen laesst, schickt Twilio-Header in einen Zweig ohne Verifizierer.
Deshalb: beides in EINEM Schritt, mit einem Test, der einen `x-twilio-signature`-Request auf
403 festnagelt.

### Pre-Mortem Track C

| Ein Jahr spaeter ist es schiefgegangen. Was ist passiert? | Gegenmassnahme |
|---|---|
| *"Ein leerer Env-Wert faellt jetzt irgendwohin, wo vorher Twilio stand."* | Schritt 2 zuerst, mit eigenem Test |
| *"Die Suite war nach der Migration gruen und hat trotzdem weniger geprueft."* | Schritt 3: Abdeckung vorher/nachher vergleichen, nicht nur Farbe |
| *"Eine `/voice/twilio`-Route blieb stehen, ohne Signaturpruefung."* | Schritt 4, `route-auth-inventory` ist der Faenger |
| *"Wir haben Adapter UND Indirektion in einem Zug angefasst — danach war unklar, welche Aenderung den Anruf gebrochen hat."* | C1 und C2 sind getrennte Schritte mit je eigener Abnahme |

## C2 — Die Indirektion zurueckbauen: **OFFEN, spaeter entscheiden**

**Nicht im selben Zug mit C1.** Gemessene Ausgangslage:

| | |
|---|---|
| `src/telephony/ports.js` | 281 Zeilen, ueberwiegend Vertrags-/Typbeschreibung |
| `src/telephony/registry.js` | 183 Zeilen |
| Importstellen ueber die Registry | 9 |
| Registry als Hausmuster auch anderswo | `src/research/registry.js`, `src/geo/registry.js` |

**Dafuer:** mit genau einer Implementierung ist eine Verzweigung nach Anbieter eine Auswahl
mit einem Fall — Indirektion ohne Mehrwert (Clean Code S4).

**Dagegen:** der Rueckbau aendert 9 Importstellen im **Live-Sprechpfad** ohne nutzbaren
Gewinn, waehrend die Beibehaltung zur Laufzeit praktisch nichts kostet. Und der
`ports.js`-Vertrag hat eigenstaendigen Wert als Beschreibung dessen, was ein Telefonie-Anbieter
koennen muss — unabhaengig davon, wie viele es sind.

**Zusaetzliches Argument seit Track A:** genau dieses Vertrags-Muster (neutraler Token, pro
Adapter uebersetzt) ist das, was Track A fuer STT nachbaut und was Track B fuer das LLM
aufbaut. Es zurueckzubauen, waehrend man es zweimal neu errichtet, waere widerspruechlich.

**Empfehlung: C2 nicht machen.** Aber erst nach C1 entscheiden, mit dem tatsaechlich
verbleibenden Code vor Augen.

---

# Teil 4 — Was der Owner entscheiden muss

| # | Entscheidung | Empfehlung |
|---|---|---|
| **O-1** | **Reihenfolge B vs. C.** C ist mechanisch und beruehrt kein Sicherheits-Gate; B beruehrt Regel 1. C zuerst macht B kleiner (ein Adapter weniger in 124 Testdateien). | **C zuerst**, dann B |
| **O-2** | **DeepSeek-API-Schluessel.** Ohne ihn ist B1 blockiert und damit ganz B. | wird gebraucht, bevor B startet |
| **O-3** | **Preisstaffel-Form.** Raten je Token-Sorte (aufgeschluesselt) statt einer Input-Rate. Das aendert eine Struktur, an der die Kostendecke UND der Stripe-Ledger haengen. | **ja** — ohne sie ist der Kundenbeleg bei DeepSeek um bis zu Faktor 120 falsch |
| **O-4** | **C2 (Indirektion zurueckbauen).** | **nein**, s. o. — aber erst nach C1 final entscheiden |
| **O-5** | **Was passiert, wenn DeepSeek schlechter ist?** Der Port bleibt, der Adapter fliegt raus oder bleibt abgeschaltet. | Struktur ist das Ziel, nicht der eine Anbieter |

---

# Nicht vorziehen

| Punkt | Stand |
|---|---|
| **P2 — Modellwechsel Haiku -> Sonnet** (Owner-Entscheidung O-4 in `gq-chain-state.md`, bindend), A/B mit Messung | **ein Env-Flip**: `CLAUDE_MODEL`; `claude-sonnet-5` steht bereits in der Preistabelle (`config.js:1416`). Das ist die Antwort auf "`look_up` feuert nicht", **nicht** die vierte Prompt-Runde |
| **P3 — Persona und Identitaet** | offen, Vorher-Zahl steht |

Beide stehen ausformuliert in `tasks/gq-chain-state.md`.
