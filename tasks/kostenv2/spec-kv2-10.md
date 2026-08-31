<!-- Auftragsblatt KV2-10. Der Phasenabschnitt aus tasks/PLAN-KOSTEN-V2.md. -->

# Pflichtlektuere

Nur das hier - NICHT den ganzen Plan, NICHT die uebrigen Befund-Dateien. Jede Zeile,
die du liest, traegst du danach durch jeden weiteren Schritt mit.

- `tasks/PLAN-KOSTEN-V2.md`: Abschnitt 2 (Zielbild), 3.5 (Einheiten), 3.6 (die ID-Falle), 4.3 (Durchsetzungsstelle) und **Abschnitt 7 vollstaendig**, dazu 4.4 (Reife) und 4.10 (die fehlende Verdrahtung)
- `tasks/kostenv2/befund-gate.md`.
- `CLAUDE.md` (Absolute Regeln) und `.claude/refs/clean-code.md`.

Brauchst du darueber hinaus etwas, lies gezielt nach - aber lies nicht vorsorglich.

# Harte Randbedingungen

1. **Safety-Gates, Offenlegungssatz und `callee_is_owner` werden NICHT angefasst.**
   Braucht die Umsetzung eines davon, ist das ein Abbruchgrund mit Meldung - keine
   eigenmaechtige Aenderung. Dasselbe gilt fuer ein gepinntes Lint-Budget: melden,
   nicht selbst anheben.
2. **Abschnitt 7, Punkte 1-9 und 13 sind entschieden** - so umsetzen. **Die Punkte 10,
   11, 12, 14, 15 und 16 laufen auf Default und sind so gekennzeichnet.** Verlangt die
   Phase, einen davon scharf zu stellen: auf dem dokumentierten Default bauen und im
   Report als Rueckfrage melden - NICHT selbst festlegen.
3. Neue Env-Variable: `src/config.js`, `.env.example` UND `BASE_ENV` in
   `test/helpers.js` (sonst leakt die echte `.env` in Spawn-Tests).
4. Neues Verhalten braucht einen Test. Geldrechnung braucht einen Test, der die
   Rechnung pinnt, nicht nur ihre Existenz.

---

### KV2-10 - Zweiteiliger Tarif, deckungs-unabhaengiger Boden, Boot-Waechter

**Ziel.** Der Tarif hoert auf, eine Fortschreibung zu sein. Er wird gegen gemessene
Vollkosten geprueft, in einer Form, die die Kostenkurve trifft: Grundbetrag plus
Minutensatz je Route.

**"Vollkosten je Anruf" - der Begriff, ausgeschrieben, weil an ihm die Tarifhoehe haengt.**
Vollkosten je Anruf sind die Summe der BELEGZEILEN dieses Anrufs (`elevenlabs_convai`,
`telnyx_sip` bzw. `telnyx_call_records`) PLUS der auf demselben Anruf und Tenant gebuchten
EIGEN-Achsen, naemlich Katalogzeile #4 (`ai_token` - einschliesslich Vorab-Briefing,
Eroeffnungssatz und Zusammenfassung) und Katalogzeile #5 (`research_fee`). Die Eigen-Achsen
gehoeren dazu, weil sie auf dem EL-Weg NICHT entfallen: sie laufen ausserhalb der
Turn-Schleife und buchen auch dort auf die Gate-Achse (BELEGT am Code, 3.2 Zeile #4;
Abnahmebefund R9-2). Eine Stichprobe, die nur EL- und Telnyx-Werte enthaelt, ist damit
systematisch ZU NIEDRIG - und der daraus hergeleitete Tarif samt dem neu berechneten
`VOICE_TARIFF_FULL_COST_FLOOR_CENTS` laege systematisch UNTER den echten Vollkosten. Genau
das ist der Fehler, den diese Phase nicht machen darf, denn er ist in die falsche Richtung
sicher: er sieht nach Deckung aus.

**Warum der Tarif zweiteilig ist (Owner-Entscheidung 5, entschieden am 2026-08-30).** Die
Form ist entschieden, nicht mehr abzuwaegen; hier steht ihre Begruendung. Die EL-Kosten haben
einen grossen FIXEN Anteil je Anruf (Prompt-Cache-Write): der 8-Sekunden-Anruf kostete
0,0099 USD, der 76-Sekunden-Anruf 0,1333 USD (BELEGT AUFTRAG B2). Telnyx verschaerft es von
der anderen Seite, weil es IMMER auf die volle Minute aufrundet - `call_sec=35`,
`billed_sec=60`, und der 8-Sekunden-Anruf zahlt trotzdem 4,01 US-Cent (BELEGT
`befund-telnyx.md` O2). Die Eigen-Achsen ziehen in dieselbe Richtung: Briefing und
Eroeffnungssatz fallen je ANRUF an, nicht je Minute. Alle drei Effekte machen kurze Anrufe
pro Minute teuer. Der verworfene einzelne Minutensatz bildete das nicht ab, egal wie oft man
ihn nachzieht - er muesste den 8-Sekunden-Fall decken und ueberzahlte damit jeden langen
Anruf.

**Betroffene Dateien.** `src/billing/cost-calibration.js` (Stichprobe = gesettelte Anrufe
mit vollstaendigem Profil statt des einen `costTruedSource === DETAIL_RECORDS`-Werts, `:57`;
Rechnung je Route zusaetzlich zum Praefix; zweiter p95 auf Vollkosten JE ANRUF),
`src/boot-guard.js` (`voiceTariffFloorFindings`, `:249`), `src/config.js` / `.env.example`
(Grundbetrag je Route, Neuherleitung von `VOICE_TARIFF_FULL_COST_FLOOR_CENTS`,
Waehrungs-Klarstellung an `PLATFORM_FIXED_COST_CENTS_PER_MONTH`, s. Katalogzeile #8), Tests.

Der Boden bekommt eine zweite, DECKUNGS-UNABHAENGIGE Bedingung. Heute liefert
`voiceTariffFloorFindings` nur dann einen Befund, wenn `belowFloor` UND `thinCoverage` -
also der Tarif unter dem Boden liegt UND die Abgleich-Deckung unter der Schwelle
(`boot-guard.js:249-252`, BELEGT `angriff-kritiker.md` K6). Das Ziel der ganzen Kette ist,
die Deckung ueber die Schwelle zu heben. In dem Moment, in dem sie das erreicht, verstummt
der Boden-Waechter - auch bei einem Tarif unter Vollkosten. Eine Sicherung, die die eigene
Kette abschaltet, ist keine.

**Abnahmekriterium (ohne echten Anruf).**
(a) Stichprobe aus den 8 gemessenen EL-Anrufen als Fixture (EL-Werte aus AUFTRAG B2,
Telnyx-Werte aus `befund-telnyx.md` O2) - und die Fixture traegt zusaetzlich die auf
denselben Anrufen und Tenants gebuchten EIGEN-Achsen #4 (`ai_token`, einschliesslich
Briefing, Eroeffnungssatz und Zusammenfassung) und #5 (`research_fee`), nach dem
Vollkostenbegriff oben. Der Report schlaegt daraus ein Paar aus Grundbetrag und Minutensatz
vor, das alle acht am p95 deckt. Gegenprobe im selben Test, damit das Kriterium nicht
tautologisch gruen ist: dieselbe Fixture OHNE die Eigen-Achsen ergibt ein nachweislich
NIEDRIGERES Paar - genau die Unterschaetzung, die R9-2 benennt. Eine Stichprobe nur aus EL-
und Telnyx-Werten wird ausdruecklich NICHT als Vollkosten-Stichprobe akzeptiert.
(b) Eine Stichprobe mit unvollstaendigen Belegmengen wird NICHT als Stichprobe akzeptiert -
eine unvollstaendige Menge ist systematisch zu niedrig und liesse den Waechter gegen seine
eigene Datenluecke alarmieren.
(c) Fixture mit Deckung 100 % und Tarif unter dem Boden erzeugt einen Befund - der Test, der
heute fehlschlaegt.
(d) Ein `underestimate`-Befund nennt das konkrete Zahlenpaar und geht ueber den Kanal aus
KV2-1 raus; ein gedeckter Tarif erzeugt keinen Kanal-Laerm.
(e) Der Boot-Waechter feuert beim Start, nicht erst beim naechsten Sweep.

**Was diese Phase NICHT tut.** Sie justiert nichts automatisch. Die Owner-Entscheidung vom
2026-07-20 ("keine rollende Selbstkalibrierung; ein Tarif, der sich aus Anrufen speist, die
das Gate durchgelassen hat, ist eine Rueckkopplung", `cost-calibration.js:1-8`) bleibt
unangetastet. Der Waechter misst und alarmiert, der Eigentuemer setzt die Werte. Sie aendert
auch die Reserve-Formel nicht - nur die Zahlen, die hineingehen, sofern der Eigentuemer sie
setzt.

**Abhaengigkeit.** KV2-9 (erst dort gibt es vollstaendig belegte EL-Anrufe als Stichprobe).
Owner-Vorbedingung: keine offene mehr. Entscheidung 5 (Tarifform) und Entscheidung 6 (kein
automatisches Anheben) sind am 2026-08-30 GETROFFEN - zweiteiliger Tarif aus Grundbetrag und
Minutensatz je Route; keine automatische Justierung, der Waechter misst und alarmiert, die
Zahl setzt ein Mensch (Abschnitt 7). Das ist damit Vorgabe, nicht Default, und der
Phasenbericht fuehrt beides als Entscheidung.

---

