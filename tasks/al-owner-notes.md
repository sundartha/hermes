# AL-Kette — Notizen vom Owner

Der Owner traegt hier ein, was nur er wissen/beschaffen kann. **Die naechste Session liest diese
Datei zu Beginn** und behandelt ausgefuellte Abschnitte als bindend, leere als "noch offen"
(dann laufen die betroffenen Phasen bis vor die Abnahme und werden in
`tasks/al-testcall-checklist.md` protokolliert).

---

## 1. Telnyx-Support: konsumiert der Assistant SSE inkrementell? (entscheidet AL-P2/AL-P7/AL-P7b)

**Gestellte Frage:**

> Fuer einen AI Assistant mit `external_llm` (OpenAI-kompatibler Custom-LLM-Endpunkt):
> konsumiert der Assistant den SSE-Stream **inkrementell** — startet er die TTS-Synthese beim
> ersten `content`-Chunk — oder puffert er bis `[DONE]`? Und: wie lange darf ein
> Custom-LLM-Request dauern, bevor der Turn abbricht (Turn-Timeout in Sekunden)?

**Antwort:**

<!-- hier eintragen, moeglichst woertlich, mit Datum und Ticket-Nummer -->

**Bewertung durch die naechste Session:** eine klare Antwort **entrisikt** AL-P2, ersetzt sie
aber **nicht** — Repo-Lehre: die Telnyx-Doku hat hier schon einmal etwas anderes behauptet als
das Objekt-GET zeigte. Bei "puffert" wird AL-P7 vorlaeufig zurueckgestellt und AL-P7b auf Weg B
geplant; die endgueltige Streichung erst nach dem Spike.

---

## 2. Der frueher gebaute Telefonagent mit Web-Recherche (speist AL-P7b und AL-P10b)

Der Owner hat bereits einen Telefonagenten betrieben, der im Internet recherchieren konnte, und
berichtet, dass es "extrem gut funktioniert" hat. Das ist bewaehrtes Design und schlaegt jede
Benchmark-Tabelle.

**AUSGEFUELLT vom Owner, 2026-07-28 (muendlich, hier protokolliert):**

- **Such-Anbieter / API:** **Brave** ("das mit B, Bravo oder sowas" — Brave Search API).
  Ausdruecklich **nicht** Exa. "Ging relativ schnell."
- **Gefuehlte Wartezeit pro Nachschlag:** kurz genug, dass sich der Nachschlag "im Gespraech
  relativ schnell anfuehlte". Keine Zahl — Eindruck, kein Messwert.
- **Wie wurde die Wartezeit ueberbrueckt?** Der Agent "hat waehrenddessen ein bisschen was
  erzaehlt". Man merkte, dass er die Zeit ueberbrueckte, und das war in Ordnung.
  **Der Fuellsatz war KONTEXTABHAENGIG** — "hat jetzt nicht immer so einen Standardsatz gesagt",
  es lag "auch ein bisschen am Kontext".
- **DER EINE DEFEKT, den der Plan verhindern muss:** die Ueberbrueckung wurde **abrupt
  abgeschnitten**, sobald die Suche fertig war, und der Agent sprang mitten im Satz auf das
  Ergebnis um. Genau das machte den Bruch hoerbar. **Anforderung: der Ueberbrueckungssatz wird
  immer zu Ende gesprochen, das Ergebnis wartet auf `speak.ended`.** -> Phase 7b, Abnahme 6.
- **Wurden Ergebnisse vorgelesen oder zusammengefasst?** Der Agent hat die Suche **nie
  angekuendigt** ("nie gesagt: das hat die Suchanfrage ergeben") — er lieferte einfach das
  Ergebnis. **Der Owner findet das gut, es bleibt so.** -> Phase 7b, Abnahme 7.
- **Wie oft pro Anruf wurde gesucht?** nicht erinnert.

---

## 3. Such-API-Key

**Anbieter ist Brave** (s. Abschnitt 2), nicht Exa. Env-Name entsprechend
`BRAVE_SEARCH_API_KEY`; Exa bleibt dokumentierter Ausweichkandidat hinter demselben Port.

- Key in `.env` gesetzt: [ ] ja / [ ] nein
- (Der Key wird zum BAUEN **nicht** gebraucht — der Adapter entsteht gegen Fixtures. Erst fuer
  die Abnahme von AL-P10b: Testanruf + p50/p95-Messung ueber 20 Suchen.)
- **Niemals committen.** Nur `.env` lokal und Render-Dashboard.

---

## 4. Telnyx-Wegwerf-Umgebung fuer AL-P2

**BESTAND GEMESSEN am 2026-07-28 ueber die Telnyx-API (read-only) — es muss NICHTS gekauft
werden:**

- **3 aktive Rufnummern**, alle auf Connection `Hermes` (`2982643896460248193`):
  - `+15739090177` (gekauft 2026-07-24)
  - `+17067101188` (gekauft 2026-07-20)
  - `+18643028341` (gekauft 2026-06-14)
- **4 AI-Assistants**, davon **3 ungenutzte** namens `Blank` (Modell `moonshotai/Kimi-K2.6`):
  `assistant-4c488b66-…`, `assistant-57162af8-…`, `assistant-5c03bba9-…`.
  Der Live-Assistant heisst `Hermes` (`assistant-dcf48d08-1d4e-4673-ab94-2681b22d26d4`).

**Offen und vom Owner freizugeben:** welche der drei DIDs ist die LIVE genutzte? Das steht in der
Prod-DB, nicht in der Telnyx-Antwort (alle drei haengen an derselben Connection). **Vor jedem
Eingriff feststellen**, sonst wird am Live-Anschluss experimentiert.

**Vorschlag der naechsten Session (braucht ein Ja vom Owner):** eine neue Connection/TeXML-App
anlegen (kostenlos, reversibel), eine der beiden NICHT-live DIDs darauf zeigen und einen der
`Blank`-Assistants als Wegwerf-Assistant verwenden. **Kein Kauf, keine Aenderung am
Live-Assistant.**

**Weiterhin gesperrt: NICHT ueber `scripts/telnyx-assistant-provision.mjs`.** Das Skript schreibt
die GANZE Live-Config aus der lokalen `.env`: ohne gesetzte `TELNYX_ASSISTANT_ID` entstuende ein
neuer Assistant, ohne `TELNYX_ELEVENLABS_MODEL` wuerde die Live-Stimme still umgestellt.

- **Wegwerf-`TELNYX_ASSISTANT_ID`:**
- **Wegwerf-`TELNYX_CONNECTION_ID`:**
- **Wegwerf-Rufnummer:**
- **Nummer, die den Testanruf ANNIMMT:** siehe unten — dafuer braucht es kein Telefon.

**AL-P2 braucht wahrscheinlich KEINEN Menschen.** Der Spike misst, wann Telnyx die TTS startet;
ob am anderen Ende ein Mensch oder eine Maschine sitzt, ist dafuer egal. Hermes ruft eine der
eigenen Ersatz-DIDs an, die ueber eine triviale TeXML-App abnimmt und schweigt; gemessen wird
`audio_first_token_duration_ms` aus dem Telnyx-Conversation-Record plus die Aufnahme.
**Damit wird AL-P2 autonom.** Kosten: eine Gespraechsminute. Voraussetzung: der Anruf muss die
regulaeren Gates passieren (verifizierter Tenant, `OUTBOUND_FROZEN` aus) — die werden **nicht**
umgangen. Die naechste Session baut den Spike so, sofern der Owner die Connection freigibt.

---

## 5. Sonstiges, das die naechste Session wissen sollte

<!-- freies Feld -->
