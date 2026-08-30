<!-- Auftragsblatt KV2-3. Geschnitten aus tasks/PLAN-KOSTEN-V2.md (Zeilen 982-1078). -->

# Pflichtlektuere vor der Umsetzung

Dieses Blatt ist der Auftrag, aber NICHT der ganze Kontext. Vor dem ersten Edit zu lesen:

- `tasks/PLAN-KOSTEN-V2.md` Abschnitt 2 (Zielbild), Abschnitt 3 (Kostenarten-Tabelle, inkl. 3.5 Einheiten und
  3.6 die ID-Falle), Abschnitt 4 (Architektur-Entscheidung, insbesondere 4.3
  Durchsetzungsstelle, 4.5 Settlement, 4.6 Matrix, 4.7 Schliessregel) und
  **Abschnitt 7 (Eigentuemer-Entscheidungen) vollstaendig**.
- `tasks/kostenv2/befund-code.md`, `befund-elevenlabs.md`, `befund-gate.md`,
  `befund-telnyx.md` - der gemessene Ist-Zustand. Keine Annahme ueber Bestandscode ohne
  Beleg aus diesen Befunden ODER aus dem Code selbst.
- `CLAUDE.md` (Absolute Regeln) und `.claude/refs/clean-code.md`.

# Harte Randbedingungen dieser Kette

1. **Safety-Gates, Offenlegungssatz und `callee_is_owner` werden NICHT angefasst.** Beruehrt
   die Umsetzung eines davon, ist das ein Abbruchgrund mit Meldung an den Lead - keine
   eigenmaechtige Aenderung, auch keine "harmlose" Umformulierung.
2. **Abschnitt 7, Punkte 1-9 und 13 sind entschieden** - umsetzen wie dort festgelegt.
   **Die Punkte 10, 11, 12, 14, 15 und 16 laufen auf Default und sind so gekennzeichnet.**
   Verlangt die Phase, einen davon scharf zu stellen, wird er auf dem dokumentierten
   Default gebaut und der Punkt im Report als Rueckfrage an den Owner gemeldet -
   NICHT eigenmaechtig festgelegt.
3. Neue Env-Variable: sofort in `src/config.js`, `.env.example` UND in `BASE_ENV` der
   Test-Helfer (sonst leakt die echte `.env` in Spawn-Tests).
4. Neues Verhalten braucht einen Test. Geldrechnung braucht einen Test, der die Rechnung
   pinnt, nicht nur ihre Existenz.

---

### KV2-3 - Das Kosten-Buch

**Ziel.** Eine Tabelle `call_cost_evidence` mit einer Zeile je `(call_id, traeger)`,
append-only nach vorne, plus zwei Store-Operationen. Nichts liest sie.

**Betroffene Dateien.** `src/db/schema.sql` (DDL laeuft beim Boot automatisch),
`src/store/state-ops.js` (`recordCallCostEvidence`, `callCostEvidence(callId)`),
`src/store/json.js`, `src/store/pg.js`, Tests.

Spalten: `id`, `tenant_id` (FK + RLS), `call_id`, `traeger`, `reife`
(`erwartet | vorlaeufig | belegt | beleg_strukturell_unbeschaffbar`; zum entfallenen
fuenften Wert s. den Absatz "Zum Wertebereich von `reife`" unten),
`betrag_mikro_cents BIGINT NULL`, `waehrung`, `quelle`, `beleg_ref`,
`versuche INT NOT NULL DEFAULT 0`, `gemessen_at`, `abstand_zum_gespraechsende_s`,
`detail JSONB NULL`, Unique-Index `(call_id, traeger)`.

`detail` traegt AUSSCHLIESSLICH Preis- und Mengenfelder - `llm_price`, `platform_price`,
`analysis.price`, `billed_sec`/`call_duration_secs`, `rate`, `tier` -, KEIN Transkript,
KEINE Rufnummer, KEIN Anbieter-Rohbody. `beleg_ref` traegt AUSSCHLIESSLICH die
Anbieter-Belegkennung (`conv_...`/`otb_...`), sonst nichts. Dieselbe Regel gilt an jeder
vergleichbaren Stelle im Bestand (`audit-store.js:1-2`: "detail NIEMALS mit
Secrets/Transkript-Inhalt fuellen"; `schema.sql:796`: "PII-frei, nie ein Ziel") - diese neue
Tabelle ist keine Ausnahme davon.

**Zum Wertebereich von `reife` - warum er vier Werte fuehrt und nicht fuenf.** Eine fruehere
Fassung dieses Plans fuehrte hier zusaetzlich `beleg_ausgeblieben`. Dieser Wert hat in
diesem Dokument KEINEN Schreiber: keine Phase setzt ihn, keine Zeile der Matrix 4.6 nennt
ihn, und er entspricht keinem Endzustand aus KV2-7. Im Code existiert er ebenfalls nicht
(BELEGT: `grep` ueber `src/` und `test/` liefert 0 Treffer fuer `beleg_ausgeblieben` -
ebenso fuer `call_cost_evidence` und `beleg_strukturell_unbeschaffbar`, die Tabelle ist
noch nicht gebaut; Positivkontrolle `costTruedAt` trifft in drei Dateien, die Suche sucht
also wirklich). Ein Enum-Wert ohne Schreiber ist toter Code im Schema, und ein spaeterer
Leser muesste seine Bedeutung erfinden. **Default dieses Plans: er entfaellt ersatzlos.**
Der Gegenweg - ihn behalten und ihm einen benannten Schreiber geben, etwa fuer "Frist
abgelaufen, Anbieter hat nie geliefert" - ist Owner-Entscheidung 16 (Abschnitt 7); die
Fachlage ist entscheidbar, die Kosten-/Nutzen-Abwaegung nicht rein technisch. Faellt 16 auf
(b), waechst die Spaltenliste um genau diesen Wert und (b) unten gilt fuer ihn wortgleich;
sonst aendert sich an dieser Phase nichts.
`beleg_strukturell_unbeschaffbar` bleibt in JEDEM Fall: er hat einen Schreiber
(KV2-4(c), der Abbruchweg) und einen Eintrag in der Matrix 4.6.
**Was an dieser Stelle NICHT geklaert ist, mit Grund:** ob KV2-4(c) ("markiert sie
zusaetzlich als strukturell nicht nachreifbar") diesen `reife`-Wert setzt oder ein eigenes
Feld, ist im Plan nicht ausgeschrieben - KV2-9(d) beschreibt fuer den 404-Fall ausdruecklich
"Zeile bleibt `vorlaeufig`, Endzustand `beleg_strukturell_unbeschaffbar`", also den
gleichnamigen Zustand AM ANRUF (KV2-7). Der Name lebt damit auf zwei Ebenen, und die
duerfen nicht zusammengelegt werden. Die Frage klaert KV2-4, die den Abbruchweg baut; bis
dahin pinnt (b) ausschliesslich die Beleg-Ebene.

`betrag_mikro_cents` ist NULLABLE und im Zustand `erwartet` immer `NULL`, nie `0` - dieselbe
Regel wie `usage_event.cost_micro_cents` (`schema.sql:855-862`, "eine 0 waere eine erfundene
Messung", BELEGT).

**Abnahmekriterium (ohne echten Anruf).**
(a) Idempotenz: zweiter Aufruf mit derselben `(callId, traeger)` legt keine zweite Zeile an.
(b) **Zustandsordnung der Reife - Monotonie UND Terminierung, beides gepinnt.** Die
Fortschritts-Ordnung ist `erwartet -> vorlaeufig -> belegt`; jeder Schritt entlang dieser
Ordnung ist erlaubt (das Ueberspringen von `vorlaeufig` eingeschlossen), jeder Rueckschritt
darin wirft. `beleg_strukturell_unbeschaffbar` steht NICHT in dieser Ordnung, sondern
daneben: er ist ein TERMINALER Zustand, aus jedem der drei Vorzustaende erreichbar, und aus
ihm fuehrt kein Uebergang mehr heraus. Ein Uebergang IN einen terminalen Zustand ist
deshalb ausdruecklich kein Rueckschritt und wirft nicht; jeder Uebergang HERAUS wirft, auch
der nach `belegt`. Das erneute Setzen desselben terminalen Zustands ist ein No-Op und wirft
nicht - dieselbe Idempotenz-Richtung wie (a), damit ein wiederholter Sweep-Lauf nicht
scheitert. Faellt Owner-Entscheidung 16 auf (b), gilt fuer `beleg_ausgeblieben` wortgleich
dasselbe.
Testfaelle, beide Richtungen: (i) `erwartet -> beleg_strukturell_unbeschaffbar`,
`vorlaeufig -> beleg_strukturell_unbeschaffbar` und `belegt ->
beleg_strukturell_unbeschaffbar` schreiben und werfen nicht; (ii) aus
`beleg_strukturell_unbeschaffbar` heraus werfen `-> erwartet`, `-> vorlaeufig` und
`-> belegt`; (iii) `beleg_strukturell_unbeschaffbar -> beleg_strukturell_unbeschaffbar`
aendert nichts und wirft nicht; (iv) die Bestands-Rueckschritte `belegt -> vorlaeufig`,
`belegt -> erwartet`, `vorlaeufig -> erwartet` werfen.
(c) RLS: ein Fremd-Tenant sieht 0 Zeilen (Muster der bestehenden RLS-Tests).
(d) Shape-Parity: `json.js` und `pg.js` liefern dasselbe Objekt.
(e) Eine Summenfunktion ueber die Zeilen zaehlt ausschliesslich `vorlaeufig` und `belegt`;
ein `erwartet`-Posten traegt NICHTS bei - eigener Testfall, damit ein spaeterer
Platzhalter-Betrag 0 nicht unbemerkt mitrechnet (`angriff-cleancode.md` Befund 6).
(f) Allowlist-Test: eine Fixture mit dem VOLLSTAENDIGEN EL-Antwortobjekt (Transkript,
Rufnummer, Analysefelder eingeschlossen) erzeugt eine Zeile, deren `detail`-Schluesselmenge
exakt der oben genannten Allowlist entspricht - kein zusaetzlicher Schluessel, kein
Transkript- oder Rufnummernfeld rutscht durch.

**Was diese Phase NICHT tut.** Kein Schreiber ausserhalb der Tests, kein Leser, keine
Buchung.

**Abhaengigkeit.** KV2-2 (der `traeger`-Wert wird gegen den Katalog validiert).
Owner-Vorbedingung: Entscheidung 1 (Kosten-Buch oder Erloes-Buch, Abschnitt 7) ist am
2026-08-30 GETROFFEN - eigenes Kosten-Buch `call_cost_evidence`, `usage_event` bleibt das
Erloes-Buch; das ist Vorgabe, kein Default. Entscheidung 16 (`beleg_ausgeblieben` streichen
oder ihm einen Schreiber geben) ist NICHT ausdruecklich entschieden und laeuft auf ihrem
Default: der Wert entfaellt, der Wertebereich hat vier Auspraegungen - im Phasenbericht
ausdruecklich als Default vermerkt, nicht als getroffene Entscheidung.
Entscheidung 16 beruehrt ausschliesslich das DDL und den Wertebereich dieser Phase; keine
spaetere Phase liest den Wert, also blockiert sie die Kette nicht.

---

