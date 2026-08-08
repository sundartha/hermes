# B1 — DeepSeek an der echten API messen: was dem Schluessel tatsaechlich abgebucht wird

Spezifikation fuer **eine** Phase. Plan: `PLAN-ANBIETER-PORT.md`, Teil 2 (Track B), Phase B1.

**B1 aendert keine Zeile Produktionscode.** Ergebnis ist ein Messprotokoll und ein
Wegwerf-Skript. Kein `config`-Key, kein `.env.example`-Eintrag, kein Test, kein Commit von
Messdaten.

---

## 1. Die bindende Owner-Korrektur (2026-08-07)

`PLAN-ANBIETER-PORT.md` Abschnitt 1.2 ist unter der Praemisse geschrieben, die **Form der
Preistabelle** sei der Befund (Cache-Spreizung 1:50 bis 1:120, deshalb Raten je Token-Sorte,
Entscheidung O-3). Der Owner hat dieser Praemisse widersprochen:

> Ihn interessiert **nicht**, wie sich der Preis zusammensetzt, sondern **was der Anbieter dem
> API-Schluessel tatsaechlich abbucht.**

Damit verschiebt sich B1s Schwerpunkt. Der damals genannte Weg — es machen wie
`src/billing/cost-truing.js` bei Telnyx (live schaetzen, nachgelagert gegen echte
Anbieter-Daten abgleichen) — ist ein **Vorschlag, kein Beschluss**. B1 ist genau die Messung,
die diese Entscheidung mit Fakten unterlegt.

**Diese Spec darf die Entscheidung nicht vorwegnehmen und tut es nicht.** Abschnitt 10 ist eine
Wenn-Dann-Tabelle ohne Empfehlung; welcher Zweig gilt, entscheidet die Messung.

Ebenfalls nicht Gegenstand von B1: O-3 (Preisstaffel-Form), B2 (Port-Vertrag), B3
(Werkzeug-Schleife normalisieren), B5 (Gespraechsqualitaet, `npm run convo-bench`).

---

## 2. Die eine Zahl, um die es geht

> **Guthaben vor dem Lauf minus Guthaben nach dem Lauf** — gegen **die Summe, die unsere
> Preisformel fuer dieselben Aufrufe gerechnet haette.**

Alles andere in dieser Spec dient dazu, diese eine Gegenueberstellung interpretierbar zu
machen: in welcher Waehrung, in welcher Aufloesung, mit welcher Verzoegerung, und ob die
Differenz auf den Cache-Anteil, auf Denk-Token oder auf ein Rundungsverhalten zurueckgeht.

---

## 3. Der Bestand, gegen den die Messergebnisse spaeter entscheiden

| Stelle | Was dort heute gilt |
|---|---|
| `src/llm.js:19,252` | Der resiliente Seam importiert das Anthropic-SDK direkt. Timeout **3500 ms je Versuch** (`src/config.js:240`), **2 Retries** (`:245`), Voll-Jitter-Backoff 250 ms — Budget-Soll laut Kommentar `(retries+1)*timeout + Backoff < 12 s` |
| `src/llm.js:131-144` `isTransient` | 408/409/429 und `>= 500` sind transient; 4xx sonst nicht. Klassifiziert u. a. ueber `err instanceof Anthropic.APIConnectionError` — **anbieter-fest** |
| `src/llm.js:108-114` `isProviderBillingError` | 402 ODER `err.type === "billing_error"` ODER Textmarke `credit balance is too low` |
| `src/llm.js:347` `completeStream` | Streaming-Pfad; Retry verboten, sobald das erste Fragment den Seam verlassen hat |
| **`src/llm-usage.js:21-27` `inputTokensOf`** | summiert `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` zu **EINER** Zahl. Kommentar: *"fail-safe: NIE weniger als ohne Caching"* |
| `src/llm-usage.js:59-61` `billedTokens` | bucht unter der **angeforderten** Modell-ID, nicht unter `resp.model` — dokumentierte Entscheidung, weil Anthropic mit einer datierten Snapshot-ID antwortet |
| `src/llm-usage.js:70-74` `bookTokenUsage` | dieselbe Zahl geht auf **zwei** Achsen: Budget-Gate (`store.trackUsage`, Absolute Regel 1) UND Stripe-Ledger (`meterAiTokens`) |
| `src/store/state-ops.js:2248-2254` `tokenCostUsd` | **eine** Input-Rate `inPerMTok`, **eine** Output-Rate — die Struktur, die eine aufgeschluesselte Meldung heute gar nicht aufnehmen koennte |
| `src/store/state-ops.js:2240-2242` `priceForModel` | unbekanntes Modell -> **teuerste hinterlegte Rate** (fail-closed) |
| `src/config.js:1426-1429` `modelPricesUsd` | genau zwei Eintraege, beide Anthropic |

Die Klippe in einem Satz: **`inputTokensOf` faltet drei Token-Sorten mit stark verschiedenen
Preisen auf eine Rate.** Bei Anthropic ist das eine Ueberbuchung um hoechstens Faktor 10 auf
einem kleinen Anteil; bei DeepSeek liegt zwischen Cache-Treffer und Cache-Fehltreffer laut
Preisseite Faktor 50 (`v4-flash`) bzw. 120 (`v4-pro`). Auf der Gate-Achse ist Ueberbuchung die
sichere Richtung, auf dem **Kundenbeleg** ist sie ein Abrechnungsdefekt. **Ob dieser
Unterschied bei unserem Aufrufprofil ueberhaupt anfaellt, ist genau Messfrage M3.**

---

## 4. Doku-Stand, verifiziert am 2026-08-08

Alle folgenden Zeilen wurden fuer diese Spec **frisch abgerufen**, nicht aus der Vorarbeit
uebernommen.

| Quelle (URL) | Was verifiziert wurde | Abweichung zur Vorarbeit |
|---|---|---|
| `https://api-docs.deepseek.com/api/create-chat-completion` | `usage` traegt `prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `total_tokens` — **kein Geldfeld** | bestaetigt. **NEU: zusaetzlich `completion_tokens_details` mit `reasoning_tokens`** — in der Vorarbeit nicht genannt, kostenrelevant (-> M8) |
| dieselbe Seite | `stream_options.include_usage`: *"If set, an additional chunk will be streamed before the `data: [DONE]` message. The `usage` field on this chunk shows the token usage statistics for the entire request."* | **NEU und Regel-1-relevant:** ohne dieses Flag liefert der Streaming-Pfad offenbar kein vollstaendiges `usage` (-> M7) |
| dieselbe Seite | `tools`: *"A list of tools the model may call. Currently, only functions are supported"*, max. 128; `tool_choice` mit `none/auto/required/<function>`. Die Kombination `tools` + `stream: true` ist **nicht ausdruecklich beschrieben** | die offene Zeile aus Plan 1.4 besteht weiter -> M7 |
| `https://api-docs.deepseek.com/api/get-user-balance` | `GET /user/balance`; Antwort `is_available` (bool) + `balance_infos[]` mit `currency`, `total_balance`, `granted_balance`, `topped_up_balance` — **alle Betraege als String**. Waehrungen: **CNY und USD**. **Keine Aussage zu Aktualisierungsfrequenz, Caching, Latenz oder Genauigkeit** | bestaetigt und praezisiert: `balance_infos` ist ein **Array** mit potenziell beiden Waehrungen (-> Pre-Mortem 3) |
| `https://api-docs.deepseek.com/quick_start/pricing` | Tabelle unveraendert: `v4-flash` 0,0028 / 0,14 / 0,28 USD je 1M; `v4-pro` 0,003625 / 0,435 / 0,87 USD je 1M. Abbuchung: *"directly deducted from your topped-up balance or granted balance, with a preference for using the granted balance first"*. Warnung unveraendert: *"we plan to raise the overall pricing ... with a significant increase expected"* | bestaetigt. **Kein Off-Peak-/Rabattfenster auf der Seite** |
| `https://api-docs.deepseek.com/quick_start/error_codes` | 400 invalid request body, 401 wrong API key, **402 Insufficient Balance**, 422 invalid parameters, **429 Rate Limit Reached**, 500 Server Error, **503 Server Overloaded** | neu erhoben (-> M5) |
| `https://api-docs.deepseek.com/quick_start/rate_limit` | 429 bei Ueberschreiten der Nebenlaeufigkeit (500 bei `v4-pro`, 2500 bei `v4-flash`). Wartende Anfragen werden offengehalten: *"Continuously return empty lines"* (non-stream) bzw. *"Continuously return SSE keep-alive comments (`: keep-alive`)"* (stream); *"If the request has not started inference after 10 minutes, the server will close the connection."* | neu erhoben und **der gefaehrlichste Fund fuer den Seam** (-> M5) |
| `https://api-docs.deepseek.com/guides/kv_cache` | Cache ist per Default an, kein Parameter noetig; Treffer nur bei **vollstaendigem Praefix-Match** einer *cache prefix unit*; Loeschung *"usually within a few hours to a few days"*; ausdruecklich *"best-effort basis and does not guarantee a 100% cache hit rate"* | **Die Seite nennt HEUTE keine Mindest-Tokenzahl** fuer eine Cache-Einheit (frueher war von 64-Token-Einheiten die Rede). Die Unsicherheit wird in M3 durch Ueberdimensionierung erschlagen, nicht durch Glauben (-> Pre-Mortem 1) |
| WebSearch, `api-docs.deepseek.com` | Ein frueheres Off-Peak-Fenster endete laut Changelog **2025-09-05**; ein aktuelles ist nicht auffindbar | -> M4 wird dadurch zur **optionalen** Messung mit Doku-Vorpruefung |

**Die Doku bleibt trotzdem nur Hypothese.** Dieses Repo hat sich zweimal an Anbieter-Doku
verbrannt, die dem Verhalten widersprach (zuletzt B-7: dokumentierte Deutsch-Unterstuetzung,
gemessene 97 % Wortfehlerrate). Jede Zeile oben ist in Abschnitt 5 eine falsifizierbare Frage.

---

## 5. Die acht Messfragen

Jede Frage ist so formuliert, dass **eine einzige gegenteilige Beobachtung sie widerlegt**.
Jede traegt ein deterministisches Abnahmekriterium — "beantwortet" heisst: die Zahl steht im
Protokoll, nicht "wir haben ein Gefuehl".

### M1 — Stimmen die Verbrauchsfelder mit der Doku ueberein?

**Frage.** Traegt jede Antwort genau die fuenf dokumentierten Verbrauchsfelder, und gelten
`prompt_tokens == prompt_cache_hit_tokens + prompt_cache_miss_tokens` sowie
`total_tokens == prompt_tokens + completion_tokens`?

**Messverfahren.** Jeder Aufruf aus allen Bloecken protokolliert das **rohe** `usage`-Objekt
(nicht eine Auswahl von Feldern) plus die sortierte Menge seiner Schluessel. Das Skript rechnet
beide Gleichungen je Zeile und schreibt `eq_prompt: true|false`, `eq_total: true|false`.
Schluessel, die nicht in der Doku-Menge stehen, werden **namentlich** ausgewiesen — genau dort
taucht ein Geldfeld auf, falls es je eines gibt.

**Beantwortet, wenn.** Mindestens 30 Antworten vorliegen, verteilt ueber beide Modelle und
beide Betriebsarten (Stream/Nicht-Stream), und je Gleichung die Anzahl der Verletzungen als
Zahl genannt ist (0 oder groesser, mit Beispielzeile).

---

### M2 — Taugt das Guthaben als Quelle fuer "tatsaechlich abgebucht"?

**Die Kernfrage der Phase.** Drei Teilfragen, alle drei falsifizierbar:

- **M2a Aufloesung:** In welcher kleinsten Einheit bewegt sich `total_balance`, und ist ein
  **einzelner** Aufruf darin sichtbar?
- **M2b Verzoegerung:** Wie lange dauert es, bis eine Abbuchung im Endpunkt steht?
- **M2c Buendelung:** Faellt die Abbuchung je Aufruf an oder zusammengefasst?

**Messverfahren.**

1. **Vor dem ersten Aufruf** `GET /user/balance`: alle Eintraege von `balance_infos` **roh**
   protokollieren (Waehrung; `total_balance`, `granted_balance`, `topped_up_balance` als
   **String, ungeparst**). Die Anzahl der Nachkommastellen der Strings ist die dokumentierte
   Aufloesung.
2. Um **jeden** Aufruf ein Guthaben-Paar (unmittelbar vorher, unmittelbar nachher). Das Delta
   wird als **Ganzzahl-Differenz in der kleinsten Einheit** aus den Strings gerechnet, nie ueber
   `parseFloat` — sonst misst man IEEE-Rauschen statt einer Abbuchung.
3. **Block D:** nach dem letzten Aufruf 12 Abfragen im Abstand von 60 s **ohne** weiteren
   Aufruf. Ergebnis ist eine Zeitreihe, keine Momentaufnahme.
4. **Gesamt-Gegenprobe (Abschnitt 2):** Guthaben vor dem ganzen Lauf minus Guthaben nach Block
   D, gegen die Summe der aus `usage` + Doku-Preisen gerechneten Betraege.

**Beantwortet, wenn** alle vier Punkte als Zahl vorliegen:
(i) die Aufloesung, (ii) fuer den Einzel-Aufruf entweder ein Delta ungleich 0 **oder** die
Anzahl N der Aufrufe, die noetig war, um die kleinste Einheit zu bewegen, (iii) die
Nachbuchungs-Zeitreihe, (iv) Gesamt-Delta **und** Formel-Summe, dazu ihre Abweichung in Prozent.

**Bindende Auswertungsregel:** ein Delta von 0 wird **nie** als "kostet nichts" protokolliert,
sondern als *"unterhalb der Aufloesung ODER noch nicht gebucht"*. Die Unterscheidung leistet
allein die Gesamt-Gegenprobe.

---

### M3 — Cache-Verhalten und Preisdifferenz, reproduzierbar

**Frage.** Erzeugt derselbe Prompt beim zweiten Mal `prompt_cache_hit_tokens > 0`, und wie
gross ist die daraus folgende Preisdifferenz?

**Messverfahren.** Ein deterministisch erzeugter Prompt von **mindestens 12 000 Zeichen**
(konservativ ueber 3000 Tokens bei jedem plausiblen Tokenizer, damit jede nicht dokumentierte
Mindestlaenge einer Cache-Einheit sicher ueberschritten ist), ohne Zeitstempel, ohne
Zufallsanteil, `max_tokens` klein und fest, damit die Ausgabeseite das Signal nicht ueberdeckt.

- **10 Wiederholungen** unmittelbar hintereinander, identischer Prompt.
- **1 Wiederholung nach 30 Minuten** (Lebensdauer laut Doku "hours to days").
- **Praefix-Kontrolle A:** Prompt, der sich nur im **letzten** Satz unterscheidet — erwartet:
  Treffer auf dem gemeinsamen Praefix.
- **Praefix-Kontrolle B:** Prompt, der sich im **ersten** Satz unterscheidet — erwartet: **0
  Treffer**. Gibt es hier Treffer, ist die Messung falsch verdrahtet, nicht der Anbieter
  ueberraschend.

**Beantwortet, wenn** die Hit/Miss-Reihe aller Wiederholungen und beider Kontrollen
protokolliert ist **und** die aus der Doku-Preistabelle gerechnete Differenz zwischen "alles
Fehltreffer" und "gemessener Hit/Miss-Split" beziffert ist. Diese Differenz **ist** der Faktor,
um den `inputTokensOf` heute ueberbuchen wuerde.

**"0 Treffer" ist ein gueltiges Ergebnis** und ausdruecklich so zu vermerken — die Doku nennt
den Cache selbst *best-effort*.

---

### M4 — Off-Peak-Preisfenster (optional, mit Doku-Vorpruefung)

**Frage.** Aendert sich der je Token abgebuchte Betrag mit der Tageszeit?

**Doku-Stand (Abschnitt 4):** die Preisseite nennt **heute kein** Rabattfenster; ein frueheres
endete laut Changelog 2025-09-05.

**Messverfahren.** **Nur ausfuehren, wenn M2a eine Einzel- oder Kleingruppen-Aufloesung ergeben
hat** — ohne sie kann die Messung eine Preisaenderung gar nicht sehen. Dann: derselbe feste
Prompt aus Block A einmal je Stunde ueber 24 h, jeweils mit Guthaben-Paar; berechnet wird der
effektive USD-je-1M-Token-Satz je Stunde.

**Beantwortet, wenn** **entweder** (a) die Doku-Pruefung mit Abrufdatum im Protokoll steht und
M2a keine ausreichende Aufloesung ergab, sodass die Messung **begruendet entfaellt**, **oder**
(b) 24 Stundenwerte vorliegen und der groesste Unterschied zwischen zwei Stunden beziffert ist.

---

### M5 — Latenz, Timeout und Fehlerform am Seam

**Frage.** Passt DeepSeeks Antwortzeit in die heutigen Seam-Werte (3500 ms je Versuch, 2
Retries, Summe unter 12 s), und tragen die Fehler die Merkmale, an denen `isTransient` und
`isProviderBillingError` heute entscheiden?

**Messverfahren.**

- Je Aufruf **TTFB** und **Gesamtdauer**; ausgewiesen als Verteilung (min / Median / p95 / max)
  je Modell und Betriebsart, dazu der **Anteil der Antworten ueber 3500 ms**.
- Ein Aufruf mit **absichtlich falschem Schluessel** (letztes Zeichen ersetzt, **nie
  ausgegeben**): Statuscode und **Form** des Fehlerkoerpers protokollieren.
- Ein Aufruf mit **absichtlich ungueltigem Parameter**: 400 oder 422 — welcher?

**Beantwortet, wenn** die Verteilung als Zahlen vorliegt, der Anteil ueber 3500 ms beziffert
ist und fuer 401 sowie fuer 400/422 je ein roher, schluesselfreier Fehlerkoerper im Protokoll
steht.

**Nur festhalten, nicht entscheiden (Eingabe fuer B2):**

- 402 faengt `isProviderBillingError` heute bereits ueber `providerStatusOf`; 503 faellt unter
  `status >= 500` und ist damit transient; 429 steht in `RETRYABLE_STATUS`. Die
  Statuscode-Klassifikation waere also weitgehend uebertragbar — **die
  `instanceof Anthropic.APIConnectionError`-Zweige sind es nicht.**
- Der Keep-alive-Mechanismus (Leerzeilen bzw. `: keep-alive`, Abbruch erst nach 10 Minuten) ist
  die Stelle, an der ein 3500-ms-Timeout eine **lebende** Anfrage abschneidet: Token entstehen,
  Ergebnis kommt nie. Genau dieser Fall ist der Grund, warum `attemptReachedProvider`
  (`src/llm.js:123`) und `bookEstimatedTokenUsage` (`src/llm-usage.js:82`) existieren.

**Streaming ja/nein ist fuer B1 ohne Belang** — gemessen wird nur, was B2 wissen muss.

---

### M6 — Ist die geantwortete Modell-ID die angeforderte?

**Frage.** Entspricht `model` in der Antwort exakt der angeforderten ID?

**Warum das zaehlt:** `billedTokens` bucht unter der **angeforderten** ID
(`src/llm-usage.js:59-61`). Weicht ein Anbieter still auf ein teureres Modell aus, wuerde unter
der billigeren ID gebucht — Plan-Abschnitt 1.3.

**Messverfahren.** Je Aufruf das Paar (angefordert, geantwortet) protokollieren; zusaetzlich
`GET /models` einmal roh ablegen.

**Beantwortet, wenn** fuer alle Aufrufe beider Modelle die Paare vorliegen und die Anzahl der
Abweichungen genannt ist.

---

### M7 — Streaming, Werkzeuge und `usage` im Stream

**Frage a.** Liefert ein Stream **ohne** `stream_options.include_usage` ein `usage`-Objekt?
**Frage b.** Funktionieren `tools` zusammen mit `stream: true`, und in welcher Feldform kommt
der Werkzeugaufruf an?
**Frage c.** Stimmt das `usage` des Streams mit dem des identischen Nicht-Stream-Aufrufs
ueberein?

**Warum das ein Regel-1-Punkt ist:** fehlt `usage` im Stream, sieht die Budget-Achse auf dem
**Live-Sprechpfad** (`src/telnyx-llm-shim.js`) **null** — das Gate waere blind, nicht bloss
ungenau.

**Messverfahren.** **Ein** echtes Werkzeug, von Hand in OpenAI-Form uebersetzt:
`take_message` (`src/claude.js:475-486`). Dieselbe Abbildung, die `realtimeTools`
(`src/bridge.js:77-85`) bereits macht — `input_schema` wird zu `parameters`. **Das Skript
importiert die Werkzeugdefinition nicht**, es traegt eine Kopie: B1 darf nicht an
Produktionsmodulen haengen, und eine Sprachvariante wuerde die Messung an `localeFor` koppeln.

Vier Kombinationen: {Stream, Nicht-Stream} x {mit Werkzeug, ohne}, dazu je einmal mit und ohne
`stream_options.include_usage`. Die rohen SSE-Chunks des Streams gehen in eine eigene Datei.

**Beantwortet, wenn** fuer jede Kombination das rohe `usage` **oder ausdruecklich sein Fehlen**
im Protokoll steht und der Feldpfad bis zu Werkzeugname und Argumenten namentlich notiert ist.

---

### M8 — Denk-Token: enthalten oder additiv?

**Frage.** Ist `completion_tokens_details.reasoning_tokens` in `completion_tokens`
**enthalten** oder kommt es **zusaetzlich** — und faellt es bei unserem Aufrufprofil ueberhaupt
an?

**Warum das zaehlt:** ist es additiv und wir lesen nur `completion_tokens`, ist die
Output-Achse systematisch untererfasst — auf dem Gate **und** auf dem Kundenbeleg, und zwar in
die **unsichere** Richtung.

**Messverfahren.** Je Aufruf `completion_tokens`, `completion_tokens_details.reasoning_tokens`
und die Zeichenzahl des sichtbaren Antworttexts protokollieren. Die Zugehoerigkeit entscheidet
die `total_tokens`-Gleichung aus M1.

**Beantwortet, wenn** mindestens ein Aufruf mit `reasoning_tokens > 0` vorliegt und die
Zugehoerigkeit rechnerisch entschieden ist — **oder** ausdruecklich vermerkt ist: *"bei diesem
Aufrufprofil nie beobachtet"*.

---

## 6. Versuchsaufbau — `scripts/deepseek-b1-messung.mjs`

**Wegwerf-Skript.** Es wird nach B1 geloescht oder bewusst als Messwerkzeug behalten; es ist
kein Produktionspfad und wird von nichts importiert.

### 6.1 Schluessel und Env-Konvention

Der Schluessel kommt aus **`DEEPSEEK_API_KEY`** in der Repo-`.env`. Das Skript laedt sie mit
demselben Mechanismus wie `src/config.js:15` (`dotenv.config({ path: <repo>/.env })`) und liest
`process.env.DEEPSEEK_API_KEY` **direkt**.

**Warum bewusst nicht ueber `src/config.js`** — obwohl die Konvention dieses Repos
Env-Zentralisierung verlangt:

1. Ein `config`-Key ist eine **dauerhafte Flaeche mit vier Pflichten**: `src/config.js`,
   `.env.example`, ggf. `render.yaml`, **und** `BASE_ENV` in `test/helpers.js` (die dokumentierte
   Drift-Falle — fehlt der Eintrag dort, leckt die echte `.env` in alle Spawn-Tests).
2. B1 kann mit dem Ergebnis *"wir nehmen DeepSeek nicht"* enden. Eine Flaeche anzulegen, bevor
   die Messung sie rechtfertigt, ist Vorratshaltung.
3. `guardedConfig` wuerde einen unbekannten Key ohnehin abweisen — der Zugriff muesste also
   zuerst eingetragen werden, was Punkt 1 ausloest.

**Die Zentralisierung ist B2-Arbeit und dort Pflicht.** B1 fasst die Konfigurationsflaeche
nicht an.

Vorflug-Pruefung: fehlt der Schluessel, bricht das Skript **vor dem ersten Netzzugriff** ab und
meldet ausschliesslich Vorhandensein und Laenge — nie den Wert.

### 6.2 Bloecke

| Block | Zweck | Aufrufe | Prompt |
|---|---|---|---|
| **A** Grundlinie | M1, M6, M8 | 6 (3 je Modell) | kurz, fest, ~200 Tokens |
| **B** Cache | M3 | 2 x 12 (je Modell: 10 identisch + 1 nach 30 min + Kontrolle) | >= 12 000 Zeichen, deterministisch |
| **C** Aufloesung | M2a, M2c | bis zu 20 je Modell, mit Abbruch, sobald die kleinste Guthaben-Einheit belegbar bewegt wurde | ~6000 Tokens |
| **D** Nachbuchung | M2b | 0 Aufrufe, 12 Guthaben-Abfragen ueber 10 min | — |
| **E** Stream + Werkzeug | M7 | 8 | wie A, plus `take_message` |
| **F** Off-Peak (optional) | M4 | 24, eine je Stunde | identisch mit A |

**Alle vergleichenden Bloecke (A, B, C, E) laufen in EINEM zusammenhaengenden Zeitfenster.**
Nur Block F variiert die Tageszeit — sonst waere jede Preisaussage mit der Uhrzeit konfundiert.

**Kein Retry im Messskript.** Ein Wiederholungsversuch veraendert genau die Groesse, die
gemessen wird (Tokenverbrauch und Guthaben-Delta). Ein Fehlversuch wird protokolliert und
gezaehlt, nicht geheilt. Nebenlaeufigkeit: **1** — sequenziell, sonst ist kein Guthaben-Paar
einem Aufruf zuzuordnen.

### 6.3 Ausgabe: JSON-Zeilen, keine Zusammenfassung

Alles unter `data/evidence/deepseek-probe/<ISO-Zeitstempel>/` — `data/` ist gitignored
(`.gitignore:12`), das Protokoll kann also nicht versehentlich mitcommittet werden.

| Datei | Inhalt |
|---|---|
| `calls.jsonl` | eine Zeile je Aufruf |
| `balance.jsonl` | eine Zeile je Guthaben-Abfrage, roh |
| `stream-chunks.jsonl` | rohe SSE-Chunks der Block-E-Streams |
| `errors.jsonl` | Statuscode + redigierter Fehlerkoerper |
| `summary.json` | je Messfrage M1-M8 ein `answer`-Feld |

Felder je `calls.jsonl`-Zeile (Allowlist, **niemals** das Anfrageobjekt samt Kopfzeilen):
`ts_utc, block, seq, model_requested, model_returned, stream, include_usage, tools, http_status,
ttfb_ms, total_ms, usage_raw, usage_keys, eq_prompt, eq_total, balance_before, balance_after,
delta_minor_units, currency, est_usd_from_doc_prices, cum_est_usd`.

`usage_raw` ist das **unveraenderte** Objekt der Antwort. Wer hier auswaehlt, kann ein Feld, das
es gar nicht geben duerfte, nicht mehr finden — und genau danach wird gesucht.

`summary.json` traegt je Messfrage **entweder** eine Zahl **oder** ein ausdrueckliches
`"nicht beantwortet, Grund: ..."`. Ein leeres Feld gilt als nicht beantwortet.

### 6.4 Kostenrahmen und Notbremse

Ziel: **unter 1 USD**, erwartet deutlich darunter.

| Block | Groessenordnung Eingabe-Token | Geschaetzt (Doku-Preise, konservativ auf `v4-pro`-Fehltreffer gerechnet) |
|---|---|---|
| A | ~1 200 | < 0,001 USD |
| B | ~2 x 40 000 | ~0,04 USD |
| C | ~2 x 120 000 | ~0,11 USD |
| E | ~2 000 | < 0,002 USD |
| F (optional) | ~5 000 | ~0,003 USD |
| **Summe** | | **unter 0,20 USD** |

**Harte Notbremse:** Parameter `--max-usd` mit Vorgabewert `1.00`. Das Skript fuehrt einen
laufenden Summenwert `cum_est_usd` aus `usage` und Doku-Preisen mit und **bricht ab**, sobald
er die Grenze erreicht — vor dem naechsten Aufruf, nicht danach. Zusaetzlich `--dry-run`, das
alle Bloecke plant und die geschaetzten Kosten ausgibt, ohne einen einzigen Aufruf abzusetzen.

### 6.5 Secret-Schutz (Absolute Regel 4)

Bindend, nicht optional:

- **Allowlist-Protokollierung.** Es wird nie ein Anfrageobjekt serialisiert, das Kopfzeilen
  enthaelt; protokolliert werden ausschliesslich die Felder aus 6.3.
- **Redaktionsfilter** ueber **jede** Ausgabe (Datei und Konsole): kommt die Zeichenkette des
  Schluessels vor, wird sie durch `***` ersetzt. Der Filter sitzt an der Schreibstelle, nicht
  an den Aufrufstellen.
- Der **absichtlich falsche Schluessel** aus M5 wird aus dem echten abgeleitet und unterliegt
  demselben Filter.
- **Selbstpruefung am Ende:** das Skript liest seine eigenen Ausgabedateien und meldet
  `key_leak_check: clean | DIRTY`. `DIRTY` ist ein Abbruch mit Exit-Code ungleich 0.
- Ausgabe unter `data/` (gitignored) — zweite Verteidigungslinie, nicht die erste.

---

## 7. Abnahme der Phase (deterministisch)

B1 ist fertig, wenn **alle** folgenden Punkte erfuellt sind:

1. `summary.json` traegt fuer **jede** der acht Messfragen ein `answer`-Feld mit einer Zahl oder
   einem ausdruecklichen Grund fuer "nicht beantwortet".
2. Die Gegenueberstellung aus Abschnitt 2 — **Guthaben-Delta gegen Formel-Summe** — steht als
   Zahlenpaar samt prozentualer Abweichung im Protokoll.
3. Die tatsaechliche Ausgabe des Laufs liegt **unter 1 USD**, belegt durch die
   Guthaben-Differenz (nicht durch die Schaetzung).
4. `key_leak_check: clean`.
5. Das Protokoll liegt unter `data/evidence/deepseek-probe/` und **nichts davon ist committet**
   (`git status` zeigt keine neue Datei ausser dem Skript, falls es behalten wird).
6. Kein Produktionscode, kein `config`-Key, kein Test wurde angefasst.

**Nicht Teil der Abnahme:** eine Empfehlung. B1 liefert Zahlen; die Entscheidung faellt der
Owner anhand von Abschnitt 10.

---

## 8. Was B2 aus B1 mitnehmen muss (Uebergabe-Liste)

Kurzform, damit die Messung nicht spaeter nachgeholt werden muss:

- die exakten Verbrauchsfeldnamen und ihre Summenbeziehungen (M1, M8),
- ob `stream_options.include_usage` **erzwungen** werden muss (M7),
- welche Modell-ID gebucht werden darf (M6),
- welche Timeout-/Retry-Werte je Adapter noetig sind und warum die
  `instanceof`-Klassifikation nicht uebertragbar ist (M5),
- ob und wie oft Cache-Treffer bei unserem Prompt-Profil ueberhaupt auftreten (M3),
- ob es eine Ist-Kosten-Quelle gibt und in welcher Aufloesung (M2).

---

## 9. Nicht-Ziele

- **Keine Repo-Aenderung** ausser dem Wegwerf-Skript.
- **Keine Entscheidung** ueber O-3 (Preisstaffel-Form) und keine ueber das
  `cost-truing`-Muster.
- **Keine Bewertung der Gespraechsqualitaet** — das ist B5 (`npm run convo-bench`, n >= 5).
- **Keine Aussage zur Werkzeug-Schleifen-Normalisierung** (B3). Nebenbefund fuer B3, hier nur
  notiert: `src/telnyx-llm-shim.js` liest OpenAI-Form auf der **Eingangs**-Seite und kennt
  `tool_calls` nicht (gegruept) — die Wiederverwendbarkeit fuer die Ausgangsseite bleibt
  unbelegt und ist B3s erste Frage.
- **Kein zweiter Waehrungskurs.** Ist der Guthaben-Topf CNY, wird in CNY berichtet; die
  Umrechnung ist eine B2-Entscheidung (`usdToEur` ist die eine bestehende Stellschraube, eine
  zweite waere genau die Duplizierung, die dieses Repo bestraft).

---

## 10. Entscheidungsvorlage — Wenn-Dann, ohne Vorentscheidung

Diese Tabelle **empfiehlt nichts**. Sie sagt nur, welcher Zweig durch welche Messung
ausgeloest wuerde.

| # | Messergebnis | Was daraus fuer das Kostenmodell folgt |
|---|---|---|
| 1 | **M2:** Guthaben-Delta ist je **einzelnem** Aufruf aufgeloest und zeitnah gebucht | Eine Ist-Quelle je Aufruf existiert. Ein nachgelagerter Abgleich nach dem Muster `src/billing/cost-truing.js` waere auf **Call-Ebene** technisch moeglich; die Live-Schaetzung duerfte grob bleiben, weil der Abgleich sie korrigiert |
| 2 | **M2:** Delta erst nach N Aufrufen sichtbar, oder mit Stunden-/Tagesverzug | Ein Abgleich taugt nur als **Perioden-Gegenprobe**, nicht als Korrektur je Aufruf. Dann traegt die **Live-Schaetzung** die volle Last — und ihre Genauigkeit haengt an aufgeschluesselten Raten (O-3 waere damit keine Wahl mehr, sondern Folge) |
| 3 | **M2:** kein nutzbares Delta (Rauschen, geteilter Topf, `is_available: false`) | Es gibt **keine** Ist-Quelle. Die Schaetzung ist die einzige Wahrheit: sie muss fail-safe ueberbuchen und darf laut Bestandsregel (`src/llm-usage.js:76-84`) **nur die Budget-Achse** treffen, nie den Kundenbeleg |
| 4 | **M3:** Cache-Treffer treten bei unserem Prompt-Profil real auf, Spreizung schlaegt durch | Die Summenbildung in `inputTokensOf` ist bei DeepSeek nicht mehr vertretbar — die Meldung muss aufgeschluesselt werden, und `tokenCostUsd` braucht Raten je Token-Sorte |
| 5 | **M3:** reproduzierbar 0 Treffer (best-effort greift bei unserem Profil nicht) | Die Summenbildung waere heute unschaedlich — **aber** die Aussage haengt an einer Anbieter-Heuristik und kippt bei jeder Prompt-Aenderung. Wird dieser Zweig gewaehlt, gehoert die Abhaengigkeit ausdruecklich als akzeptiertes Risiko dokumentiert, nicht stillschweigend |
| 6 | **M8:** `reasoning_tokens` sind **additiv** zu `completion_tokens` | Die Output-Achse ist untererfasst. Der Port muss beide addieren — sonst zeigt das Gate in die unsichere Richtung |
| 7 | **M6:** `model` der Antwort weicht von der angeforderten ID ab | Die Buchungs-ID muss **je Adapter** entschieden werden (Plan 1.3): fuer DeepSeek `resp.model`, mit Preiseintrag fuer jede vorkommende ID, sonst laeuft jeder Turn in den fail-closed-Zweig |
| 8 | **M7:** ohne `include_usage` liefert der Stream kein `usage` | Der Port **muss** das Flag erzwingen (nicht "sollte"). Ohne es ist die Budget-Achse auf dem Live-Sprechpfad blind — Absolute Regel 1 |
| 9 | **M5:** relevanter Anteil der Antworten ueber 3500 ms | Die Seam-Werte sind nicht global, sondern **je Adapter**. Anthropic-Zahlen auf DeepSeek anzuwenden erzeugt Abbrueche mit bezahlten, nie gelieferten Token |
| 10 | **M4:** ein Off-Peak-Fenster existiert doch | Die Schaetzung ist tageszeitabhaengig. Entweder Zeitfenster in der Preisstaffel — oder durchgaengig der teure Satz (fail-safe, dafuer systematisch zu hoher Kundenbeleg) |

---

## 11. Pre-Mortem

Ein Jahr spaeter: die Messung war falsch, und der darauf gebaute Port hat Geld falsch
gerechnet. Was ist passiert?

| Szenario | Gegenmassnahme **in dieser Phase** |
|---|---|
| **1. Die Messung lief am Cache vorbei.** Der Prompt war kuerzer als die (heute undokumentierte) Mindestlaenge einer Cache-Einheit, wir sahen 0 Treffer und schlossen daraus, die Spreizung sei irrelevant — bis der Live-Systemprompt sie ausloeste | M3 nutzt **>= 12 000 Zeichen**, ueberdimensioniert gegen jede plausible Mindestlaenge. Zusaetzlich **Praefix-Kontrolle B**: Treffer bei geaendertem **erstem** Satz entlarven eine falsch verdrahtete Messung sofort |
| **2. Der Guthaben-Endpunkt ist gecacht oder verzoegert.** Delta = 0 wurde als "kostet nichts" gelesen | **Block D** (12 Abfragen ueber 10 min ohne Aufruf) plus die **bindende Auswertungsregel** aus M2: 0 heisst *"unterhalb der Aufloesung ODER noch nicht gebucht"*, nie *"keine Kosten"*. Die Gesamt-Gegenprobe entscheidet |
| **3. CNY und USD verwechselt.** `balance_infos` ist ein Array; ein Zugriff ueber Index 0 lieferte CNY, wir rechneten in USD weiter — Faktor ~7 | Zugriff **ausschliesslich ueber `currency`**, nie ueber den Index. Jede abgeleitete Zahl traegt ihre Waehrung im Feldnamen. **Kein Umrechnungskurs im Skript** — ist der Topf CNY, wird in CNY berichtet |
| **4. Off-Peak hat die Vergleichsmessungen verfaelscht.** Block B lief vor, Block C nach einem Fensterwechsel; die Differenz wurde dem Cache zugeschrieben | Alle vergleichenden Bloecke laufen in **einem** zusammenhaengenden Fenster, Start und Ende in **UTC** im Protokoll. **Nur Block F** variiert die Tageszeit, ausdruecklich getrennt |
| **5. Der Schluessel landete im Log oder im Commit.** | Absolute Regel 4: **Allowlist**-Protokollierung, **Redaktionsfilter an der Schreibstelle**, Ausgabe unter gitignored `data/`, Vorflug meldet nur Vorhandensein und Laenge, **Selbstpruefung** `key_leak_check` mit Exit-Code ungleich 0 bei Fund. Auch der absichtlich falsche Schluessel aus M5 faellt unter den Filter |
| **6. Aus einem Lauf wurde eine Regel.** Ein Schluessel, ein Guthabenmodell (Frei- vs. Aufgeladenes Guthaben), ein Zeitraum — und daraus eine dauerhafte Preisannahme | **Kalibrierungs-Reichweite:** `summary.json` nennt ausdruecklich Schluessel-Kontext (ohne Schluessel), Guthaben-Zusammensetzung, UTC-Zeitraum und Modell-IDs. Jede Zahl gilt nur fuer diese Konfiguration |
| **7. Die Messung kostete deutlich mehr als geplant.** Ein Retry-Sturm oder eine Schleife | **Kein Retry im Messskript**, Nebenlaeufigkeit 1, **`--max-usd`-Abbruch vor dem naechsten Aufruf**, `--dry-run` zur Vorabschaetzung |
| **8. Das Protokoll wurde zur Doku und veraltete still.** Die Preisseite kuendigt selbst eine deutliche Erhoehung an | Die abgerufene **Preistabelle wird mit abgelegt**, samt Abrufdatum und URL. Jede Zahl im Protokoll traegt ihren Lauf-Zeitstempel |
| **9. Wir haben gegen die Doku gebaut, und die Antwortform war anders.** (Pre-Mortem des Plans zu B1) | Genau dafuer ist B1 eine Messung. **Ohne B1-Protokoll faengt B2 nicht an** — und M1 protokolliert das **rohe** `usage`, nicht eine Auswahl, damit ein unerwartetes Feld ueberhaupt auffallen kann |
