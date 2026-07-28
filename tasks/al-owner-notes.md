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

- **Such-Anbieter / API:**
- **Gefuehlte Wartezeit pro Nachschlag:**
- **Wie wurde die Wartezeit ueberbrueckt?** (Fuellsaetze — welche genau? Musik? gar nichts?)
- **Wie oft pro Anruf wurde gesucht?**
- **Wurden Ergebnisse vorgelesen oder zusammengefasst?**
- **Was hat NICHT funktioniert / was wuerdest du anders machen?**

<!-- hier eintragen -->

---

## 3. Exa

- `EXA_API_KEY` in `.env` gesetzt: [ ] ja / [ ] nein
- (Der Key wird zum BAUEN nicht gebraucht. Erst fuer die Abnahme von AL-P10b:
  Testanruf + p50/p95-Messung ueber 20 Suchen.)
- **Niemals committen.** Nur `.env` lokal und Render-Dashboard.

---

## 4. Telnyx-Wegwerf-Umgebung fuer AL-P2

**Zuerst pruefen:** gibt es eine ungenutzte DID/Connection aus frueheren Arbeiten? Eine neue
Nummer kostet zusaetzliche Monatsmiete.

**Von Hand anlegen — NICHT ueber `scripts/telnyx-assistant-provision.mjs`.** Das Skript schreibt
die GANZE Live-Config aus der lokalen `.env`: ohne gesetzte `TELNYX_ASSISTANT_ID` entstuende ein
neuer Assistant, ohne `TELNYX_ELEVENLABS_MODEL` wuerde die Live-Stimme still umgestellt.

- **Wegwerf-`TELNYX_ASSISTANT_ID`:**
- **Wegwerf-`TELNYX_CONNECTION_ID`:**
- **Wegwerf-Rufnummer:**
- **Zweite Rufnummer zum Anrufen (Testgeraet):**

<!-- hier eintragen -->

---

## 5. Sonstiges, das die naechste Session wissen sollte

<!-- freies Feld -->
