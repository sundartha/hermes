# AL-Kette — was der Owner noch abnehmen muss

Diese Liste ist **nicht** die Restarbeit der Kette, sondern das, was ohne den Owner bzw. ohne
einen echten Anruf nicht abnehmbar ist. Eine Phase gilt als **gebaut**, auch wenn ihre Abnahme
hier steht — sie gilt aber nie als **abgenommen**.

Regel aus `tasks/assistant-leap-chain.md` §2: die geldrelevanten Flags
(`PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`, `LOOKUP_ENABLED`, `THINKING_SIGNAL_ENABLED`)
bleiben AUS. **Ihr Anschalten IST die Abnahme.**

## Startbestand (aus der Uebergabe, vor der ersten Phase)

1. **`BRAVE_SEARCH_API_KEY` beschaffen und setzen** (`.env` + Render-Dashboard).
   Erst fuer die Abnahme von AL-P10b noetig — zum Bauen nicht. Niemals committen.
   *(Die Uebergabe nannte hier urspruenglich `EXA_API_KEY`; der Owner hat am 28.07. auf Brave
   korrigiert — Betriebserfahrung aus einem real betriebenen Recherche-Agenten.)*
2. **O2 — Offenlegungssatz:** falls die 3-4 Sekunden gewuenscht sind, Rechtspruefung des zweiten
   Teilsatzes beauftragen. Bis dahin gilt „unveraendert" (so gebaut).
3. **O6 — Auslands-Tarif:** Ist-Werte von `VOICE_TARIFF_DEFAULT_CENTS`,
   `DEFAULT_TENANT_BUDGET_CENTS` und der Max-Gespraechsdauer im Dashboard nachlesen. Der
   Boot-Guard `worst_case_unaffordable` feuerte am 23./25.07., seit dem 27.07. nicht mehr.
   Ausserhalb der Kette, aber **vor** einer Freigabe von AL-P9 zu klaeren.

## Offene Abnahmen je Phase

*(Wird von der Umsetzungs-Session fortgeschrieben, sobald die jeweilige Phase gemergt ist.)*

| Phase | Was abzunehmen ist | Woran man Erfolg erkennt | Stand |
|---|---|---|---|
| AL-P1 | Latenz-Tabelle fuer EINEN echten Anruf: `node scripts/telnyx-call-latency.mjs --call <call_id>` | Fusszeile `status=ok` (unaccounted-Median <= 300 ms). `status=unknown_component` = wichtigster Einzelbefund, **blockiert AL-P7** | offen |
| AL-P1 | Baseline aus **>= 5** gescripteten Anrufen: Median `roundtrips`/Turn, Turns/Anruf, Tokens/Anruf | `turn_ok`-Zeilen im Render-Log tragen `roundtrips`/`toolNames`/`chars`/`speechEmpty`; Mediane notiert | offen |
| AL-P1 | Eroeffnungsfenster aus **>= 3 echten Aufnahmen** (Annahme bis `speak.ended`) | gemessene Sekunden notiert — Basislinie fuer AL-P5, **nicht** hochgerechnet | offen |
| AL-P1 | Feldnamen-Verifikation `conversation_id` | im Render-Log erscheint `conversation_created (call=…) -> UUID gespeichert`. Erscheint stattdessen `… OHNE conversation_id … payload_keys=…`, ist der Feldname falsch -> Ein-Zeilen-Fix aus den geloggten Schluesseln | offen |
