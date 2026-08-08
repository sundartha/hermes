# B1 — Messprotokoll DeepSeek und Entscheidungsvorlage

Lauf: **2026-08-08, 11:03:11–11:47:47 UTC**. Protokoll (gitignored):
`data/evidence/deepseek-probe/2026-08-08T11-03-09-007Z/` — 90 Aufrufe, 192 Guthaben-Abfragen,
459 SSE-Chunks, 5 Dateien, 394 KB. Spec: `tasks/b1-spec.md`.

**Diese Zahlen gelten nur fuer diese Konfiguration** (Kalibrierungs-Reichweite): EIN Schluessel,
Guthaben-Topf rein `topped_up` (USD 1,12, `granted_balance` 0,00), Modelle
`deepseek-v4-flash` / `deepseek-v4-pro`, Preistabelle abgerufen 2026-08-08, ein
zusammenhaengendes 45-Minuten-Fenster.

---

## 1. Abnahme (Spec Abschnitt 7) — sechs von sechs

| # | Kriterium | Beleg |
|---|---|---|
| 1 | Jede Messfrage traegt ein `answer` | M1, M2, M3, M5, M6, M7, M8 beantwortet; M4 ausdruecklich "nicht beantwortet" mit Grund |
| 2 | Guthaben-Delta gegen Formel-Summe, mit Prozent | **−0,01 USD** gegen **0,012334 USD**, Abweichung **−18,9 %** |
| 3 | Ist-Ausgabe unter 1 USD, per Guthaben belegt | 1,12 → **1,11 USD** = 0,01 USD |
| 4 | `key_leak_check: clean` | clean, **5 Dateien, 393 990 Bytes geprueft** |
| 5 | Protokoll unter `data/`, nichts committet | `git status` leer, `.gitignore:12` deckt `data/` |
| 6 | Kein Produktionscode, kein config-Key, kein Test | unveraendert |

Keine Notbremse ausgeloest (`budget_abbruch: null`), **0 fehlgeschlagene Aufrufe**.

---

## 2. Die eine Zahl — und warum sie weniger sagt, als sie scheint

> Guthaben-Delta **−0,01 USD** · Formel-Summe **0,012334 USD** · Abweichung **−18,9 %**

**Die −18,9 % sind kein Beleg dafuer, dass unsere Formel um 19 % danebenliegt.** Das Guthaben
wird mit **zwei Nachkommastellen** gefuehrt; die kleinste sichtbare Einheit ist 0,01 USD. Bei
einer tatsaechlichen Abbuchung von 0,012334 USD stuende der Rest bei 1,107666 — angezeigt als
`1.11`. Beobachtet wurde genau `1.11`. Die Messung ist also **mit der Formel vertraeglich**,
kann sie aber nicht genauer bestaetigen als auf ±0,005 USD. Bei dieser Summe sind das ±40 %.

Anders gesagt: die Gegenueberstellung aus Spec Abschnitt 2 ist durchgefuehrt und sie
widerspricht der Formel nicht — mehr gibt die Aufloesung des Anbieters nicht her.

---

## 3. Die acht Messfragen

### M1 — Verbrauchsfelder: Gleichungen halten, aber die Doku ist unvollstaendig

88 Antworten mit `usage`, verteilt ueber **alle vier Zellen** (flash/pro × stream/nicht-stream:
4 / 40 / 4 / 40). **0 Verletzungen** von `prompt_tokens == hit + miss` und
`total_tokens == prompt + completion`.

**Neufund:** zwei **undokumentierte** Felder — `prompt_tokens_details` und
`prompt_tokens_details.cached_tokens`. Letzteres spiegelt `prompt_cache_hit_tokens`
(OpenAI-kompatible Zweitbenennung, in allen Stichproben wertgleich). Kein Geldfeld. Gefunden
hat es die **rekursive** Schluesselerhebung; eine Pruefung nur auf oberster Ebene haette es
uebersehen.

### M2 — Das Guthaben taugt als Quelle, aber nur grob und nur nachgelagert

- **M2a Aufloesung:** USD, **2 Nachkommastellen** = 0,01 USD. Nur USD, kein CNY.
- **M2b Verzoegerung:** Die Abbuchung erschien um **11:38:43**, also **rund 2 Minuten nach dem
  letzten Aufruf** (letzter Chat-Aufruf vor 11:36:42) — und zwar waehrend Block D, in dem
  **null** Aufrufe stattfanden. Danach 9 weitere Abfragen ueber 9 Minuten: unveraendert.
- **M2c Buendelung:** **Ein einzelner Aufruf bewegt das Guthaben nicht.** Block C fuhr 20
  Aufrufe je Modell (je ~6000 Eingabe-Token) — das Delta blieb bei allen 40 messbar 0. Erst der
  Lauf als Ganzes (90 Aufrufe, 0,0123 USD) erzeugte einen Schritt von 0,01.

**Bindende Auswertungsregel eingehalten:** die 40 Null-Deltas stehen als *"unterhalb der
Aufloesung ODER noch nicht gebucht"* im Protokoll, nirgends als "kostet nichts".

### M3 — Cache-Treffer sind real, und die Spreizung schlaegt voll durch

Trefferverlauf **identisch fuer beide Modelle** (13 Aufrufe je Modell):

```
[0, 3200×9, 3200 (nach 30 min), 3200 (Kontrolle A), 0 (Kontrolle B)]
```

- Erster Aufruf kalt (0), danach durchgaengig **3200 Treffer-Token**.
- **Der Cache ueberlebt 30 Minuten** — der Nachtest traf voll.
- **Kontrolle A** (nur letzter Satz geaendert) trifft auf dem gemeinsamen Praefix.
- **Kontrolle B** (erster Satz geaendert) trifft **0** — die Messung ist korrekt verdrahtet,
  die Treffer sind keine Selbsttaeuschung.

**Preisdifferenz "alles Fehltreffer" gegen "gemessener Split":**

| Modell | alles Fehltreffer | gemessener Split | Faktor |
|---|---|---|---|
| `deepseek-v4-flash` | 0,00600 USD | 0,00117 USD | **5,1×** |
| `deepseek-v4-pro` | 0,01821 USD | 0,00303 USD | **6,0×** |

**Das ist der Faktor, um den `inputTokensOf` heute ueberbuchen wuerde.**

### M4 — Entfaellt begruendet

Spec-Abnahme (a) erfuellt: Doku-Vorpruefung mit Abrufdatum im Protokoll
(`https://api-docs.deepseek.com/quick_start/pricing`, 2026-08-08, kein Rabattfenster), **und**
M2a ergibt keine ausreichende Aufloesung — bei 0,01 USD Granularitaet und ~0,0001 USD je
Aufruf koennte eine 24-Stunden-Reihe eine Preisaenderung gar nicht sehen.

### M5 — Latenz passt heute, aber der Abstand zum Timeout ist duenn

| Modell × Betriebsart | n | Median | p95 | Max | > 3500 ms |
|---|---|---|---|---|---|
| flash × nicht-stream | 40 | 1548 ms | 1946 ms | 2343 ms | **0 %** |
| flash × stream | 4 | 1771 ms | — (n<20) | 1952 ms | **0 %** |
| pro × nicht-stream | 40 | 2011 ms | 2956 ms | **3183 ms** | **0 %** |
| pro × stream | 4 | 2474 ms | — (n<20) | 2727 ms | **0 %** |

Fehlerformen: falscher Schluessel → **401**, ungueltiger Parameter → **400** (nicht 422; die
Spec liess das offen). Rohe, schluesselfreie Fehlerkoerper liegen in `errors.jsonl`.

**Der Anteil ueber 3500 ms ist 0 — aber `pro` erreicht 3183 ms.** Das sind **9 % Luft** zum
heutigen Seam-Timeout von 3500 ms je Versuch. Unter Last, mit laengeren Prompts oder mit dem
dokumentierten Rate-Limit-Offenhalten kippt das.

### M6 — Die geantwortete Modell-ID ist die angeforderte

**88 vergleichbare Aufrufe, 0 Abweichungen** (2 nicht vergleichbar = die absichtlichen
Fehlerproben). `GET /models` liefert genau die zwei konfigurierten IDs.

### M7 — Streaming liefert `usage` AUCH ohne das Flag; Werkzeuge funktionieren im Stream

Alle **16** Kombinationen (2 Modelle × {Stream, kein Stream} × {Werkzeug, keins} ×
{`include_usage`, ohne}) antworteten HTTP 200 **mit** `usage`.

- **`stream: true, include_usage: false` liefert trotzdem ein vollstaendiges `usage`.** Das
  widerspricht der Leseart der Doku, die das Flag dafuer verlangt.
- **`tools` + `stream: true` funktioniert** — Feldpfad
  `choices[0].message.tool_calls[0].function.name`, im Stream ueber `delta` akkumuliert.
  Damit ist die offene Zeile aus Plan 1.4 geschlossen.
- In **3 von 16** Aufrufen mit angebotenem Werkzeug rief das Modell **keines** — kein Defekt
  der Messung, sondern ein Qualitaetssignal (vgl. AL-D3, `get_consult` feuert zu selten).

### M8 — `reasoning_tokens` sind ENTHALTEN, nicht additiv

`prompt_tokens 293 + completion_tokens 64 = total_tokens 357` geht auf; mit zusaetzlich
addierten `reasoning_tokens` (64) ergaebe sich 421 ≠ 357. **Rechnerisch entschieden, nicht
angenommen.** Die Output-Achse ist also nicht untererfasst.

**Messartefakt, ehrlich vermerkt:** in allen Aufrufen ohne Werkzeug war
`reasoning_tokens == completion_tokens == 64`, also das gesamte `max_tokens`-Budget. Der
sichtbare Antworttext war damit vermutlich leer oder abgeschnitten. Fuer die Verbrauchsfelder
ist das ohne Belang, fuer jede Aussage ueber Antwortqualitaet aber nicht — die gehoert nach B5.

---

## 4. Entscheidungsvorlage (Spec Abschnitt 10) — welche Zweige die Messung ausloest

| # | Zweig | Ausgeloest? | Beleg |
|---|---|---|---|
| 1 | Ist-Quelle je **einzelnem** Aufruf | **nein** | 20 Aufrufe je Modell bewegen 0,01 USD nicht |
| 2 | Delta erst nach N Aufrufen / mit Verzug → **Abgleich nur als Perioden-Gegenprobe, Live-Schaetzung traegt die volle Last, O-3 ist Folge statt Wahl** | **JA** | 90 Aufrufe fuer einen 0,01-Schritt; Buchung ~2 min nach dem letzten Aufruf |
| 3 | Gar keine Ist-Quelle | **nein** | Delta existiert und ist reproduzierbar |
| 4 | Cache-Spreizung schlaegt durch → **`inputTokensOf` nicht mehr vertretbar, Raten je Token-Sorte noetig** | **JA** | 22/26 Treffer, Faktor 5,1× / 6,0× |
| 5 | Reproduzierbar 0 Treffer | **nein** | — |
| 6 | `reasoning_tokens` additiv | **nein** | enthalten, rechnerisch belegt |
| 7 | Modell-ID weicht ab | **nein** | 0 von 88 |
| 8 | Ohne `include_usage` kein `usage` im Stream | **nein** (gemessen) | alle 16 Kombinationen liefern `usage` |
| 9 | Relevanter Anteil ueber 3500 ms | **nein, aber knapp** | 0 % ueber 3500 ms, Max 3183 ms = 9 % Luft |
| 10 | Off-Peak-Fenster existiert | **nein** | Doku 2026-08-08, kein Fenster |

**Zwei Zweige feuern: 2 und 4. Sie zeigen in dieselbe Richtung.** Weil das Guthaben nur eine
grobe Perioden-Gegenprobe hergibt, traegt die Live-Schaetzung die Last allein — und weil die
Cache-Spreizung real ist, ist eine Schaetzung mit **einer** Eingabe-Rate um Faktor 5–6 falsch.
Damit ist **O-3 (Raten je Token-Sorte) keine Gestaltungsfrage mehr, sondern die Konsequenz
zweier Messergebnisse.**

---

## 5. Uebergabe an B2 (Spec Abschnitt 8)

- **Verbrauchsfelder:** die fuenf dokumentierten plus **`prompt_tokens_details.cached_tokens`**
  (undokumentiert, spiegelt `prompt_cache_hit_tokens`). Beide Summengleichungen halten.
- **`stream_options.include_usage`:** gemessen **nicht** noetig — **trotzdem erzwingen.** Die
  Doku verlangt es; ein undokumentiertes Verhalten ist keine Zusage, und Regel 1 haengt daran.
  Kosten des Erzwingens: null.
- **Buchungs-ID:** `resp.model` == angeforderte ID. Die heutige Buchung unter der angeforderten
  ID (`llm-usage.js:59-61`) bleibt fuer DeepSeek korrekt.
- **Timeout/Retry je Adapter:** 3500 ms sind fuer `pro` zu knapp (Max 3183 ms gemessen, ohne
  Last). Die `instanceof Anthropic.APIConnectionError`-Zweige sind ohnehin nicht uebertragbar.
  Statuscodes: 401/400 belegt, 402/429/503 dokumentiert.
- **Cache:** Treffer treten bei einem festen Praefix **regelmaessig** auf und ueberleben
  ≥ 30 min. Aufschluesselung ist Pflicht, nicht Kuer.
- **Ist-Kosten-Quelle:** vorhanden, Aufloesung 0,01 USD, Verzug ~2 min. Taugt zur
  Perioden-Gegenprobe, nicht zur Korrektur je Anruf.

---

## 6. Was diese Messung NICHT zeigt

- **Kein Urteil ueber Gespraechsqualitaet** — `max_tokens` war 64, die Antworten waren
  abgeschnitten. Das ist B5 (`npm run convo-bench`, n ≥ 5).
- **Keine Aussage unter Last.** Alle Latenzen stammen aus sequenziellen Einzelaufrufen ohne
  Nebenlaeufigkeit; das dokumentierte Rate-Limit-Offenhalten (bis 10 min) wurde nie ausgeloest.
- **Keine Aussage ueber CNY-Toepfe, Freiguthaben oder mehrere Schluessel** — dieser Topf war
  rein `topped_up` und rein USD.
- **Kein Beleg, dass die Preistabelle stimmt.** Die Aufloesung des Guthabens ist zu grob, um
  0,0123 USD zu bestaetigen; die Anbieterseite kuendigt zudem eine Erhoehung an.
