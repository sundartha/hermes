<!-- Auftragsblatt KV2-6. Der Phasenabschnitt aus tasks/PLAN-KOSTEN-V2.md. -->

# Pflichtlektuere

Nur das hier - NICHT den ganzen Plan, NICHT die uebrigen Befund-Dateien. Jede Zeile,
die du liest, traegst du danach durch jeden weiteren Schritt mit.

- `tasks/PLAN-KOSTEN-V2.md`: Abschnitt 2 (Zielbild), 3.5 (Einheiten), 3.6 (die ID-Falle), 4.3 (Durchsetzungsstelle) und **Abschnitt 7 vollstaendig**, dazu 4.4 (Reife) und 4.9 (Alarmweg)
- `tasks/kostenv2/befund-gate.md` - der gemessene Ist-Zustand der Gate-Achse.
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

### KV2-6 - Deckung je Traeger und der Herzschlag

**Ziel.** Die Erfassung wird beobachtbar, BEVOR sie Geld bewegt. Deckungsquote je Traeger
statt global, plus die faelligkeits-unabhaengige Herzschlag-Klasse, die den Zustand vom
19.08. binnen Stunden meldet.

**Betroffene Dateien.** `src/billing/cost-truing.js` (Quoten je Traeger, Sweep-Zeile nennt
je Traeger `kandidaten/belegt/offen/unbeschaffbar`, drei Befund-Codes aus 4.9),
`src/routes/api-billing.js` (Anzeige neben `GET /api/billing/platform-costs`, hinter
`webAuthMw + adminMw` wie die Bestandsroute), `src/config.js` / `.env.example`
(`KOSTEN_HEARTBEAT_FENSTER_H`, Default 6), Tests.

**Abnahmekriterium (ohne echten Anruf).**
(a) Fixture-Bestand mit 10 Anrufen des Profils `el_convai_sip`, davon 3 ohne EL-Beleg:
EL-Quote 70 %, Telnyx-Quote 100 %, genau ein Befund, genau eine Mail.
(b) Herzschlag: ein Bestand "in den letzten 6 Stunden 5 beendete Anrufe mit Profil
`el_convai_sip`, 0 Belege `elevenlabs_convai`" erzeugt genau einen Alarm auf beiden Kanaelen -
und zwar OHNE dass irgendein Anruf faellig ist. Zweiter Sweep im Entprellfenster: kein
zweiter Alarm, aber ein Notiz-Eintrag.
(c) Anrufe im Zustand `beleg_strukturell_unbeschaffbar` zaehlen NICHT in die Deckungsquote -
Fixture mit 10 Anrufen, davon 4 unbeschaffbar, ergibt eine Quote ueber 6, nicht ueber 10.
(d) Ein Anruf ohne `endedAt` erscheint in einer eigenen, benannten Zaehlzeile "nie beendet"
und faellt nicht lautlos aus Zaehler UND Nenner (heute ist er fuer die Kennzahl unsichtbar,
`isEndedCall` false, `cost-truing.js:137`, `angriff-premortem.md` 2.4).
(e) `usage.costCents` unveraendert.
(f) **Der Herzschlag schweigt fuer die Bestandsprofile - das ist ein Kriterium, keine
Nebenfolge.** Fixture: in den letzten `KOSTEN_HEARTBEAT_FENSTER_H` Stunden 5 beendete Anrufe
mit Profil `telnyx_budget`, fuer jeden die Belegzeile `traeger=telnyx_call_records` aus
KV2-5(g) -> `kosten:erfassung-tot:telnyx_call_records` feuert NICHT, auf keinem Kanal, und es
entsteht auch keine Notiz-Zeile. Gegenprobe im selben Test: dieselben 5 Anrufe OHNE jede
`telnyx_call_records`-Zeile erzeugen genau einen Alarm - der Herzschlag ist also scharf und
nur still, weil eingesammelt wird. Ohne dieses Kriterium waere der Alarm fuer den Traeger von
vier der fuenf Profile dauerhaft an, und 4.4 verwirft genau das ("ein Alarm, der immer an
ist, ist keiner").
Zaehlweise, die dazugehoert: fuer den Herzschlag zaehlt eine Zeile mit `reife=vorlaeufig`
als ANGELEGT (die Frage lautet "sammelt ueberhaupt noch jemand"), fuer die Deckungsquote
zaehlt sie NICHT als belegt (die Frage lautet "ist es vollstaendig"). Zwei Fragen, zwei
Bedingungen - sie duerfen nicht auf dieselbe gelegt werden.
**Eine Zeile im Zustand `erwartet` zaehlt fuer den Herzschlag NIE als angelegt - sie ist der
Platzhalter, nicht der Beleg (dieselbe Regel wie in der Summenbildung 4.5/KV2-3(e)).** Ohne
diesen Satz waere `kosten:erfassung-tot:telnyx_sip` strukturell stumm: KV2-4 legt fuer JEDEN
EL-Anruf synchron am Gespraechsende eine `telnyx_sip`-Zeile im Zustand `erwartet` an, und
wer die als angelegt liest, bekommt einen Herzschlag, der per Konstruktion nie schlaegt.
Gepinnt wird das in (g).
Faellt Owner-Entscheidung 11 auf (b), kehrt sich dieses Kriterium um: dann fuehrt der
Herzschlag `telnyx_call_records` gar nicht, weil es fuer diesen Traeger keinen Einsammler
gibt, und der Test pinnt die AUSNAHME statt der Belegzeile.
(g) **Der Herzschlag des Traegers `telnyx_sip` haengt am Beleg, nicht am Platzhalter.**
Fixture: in den letzten `KOSTEN_HEARTBEAT_FENSTER_H` Stunden 5 beendete Anrufe mit Profil
`el_convai_sip`, je einer `elevenlabs_convai`-Zeile (`reife=vorlaeufig`) und je einer
`telnyx_sip`-Zeile im Zustand `erwartet` - also genau der Zustand, den KV2-4 synchron am
Gespraechsende anlegt -> `kosten:erfassung-tot:telnyx_sip` feuert GENAU EINMAL.
**Gegenprobe im selben Test:** dieselben 5 Anrufe mit `telnyx_sip` auf `belegt` -> kein
Alarm, auf keinem Kanal, und keine Notiz-Zeile. Ohne dieses Kriterium bliebe der Herzschlag
fuer genau den Traeger ungeprueft, ueber den der Telnyx-Anteil des EL-Wegs eingesammelt
wird, und zwar unbemerkt: (b) pinnt nur `elevenlabs_convai`, (f) nur
`telnyx_call_records` - fuer `telnyx_sip` pinnte bis hierher nichts, dass der Alarm
ueberhaupt scharf ist.

**Was diese Phase NICHT tut.** Keine Buchung. Kein Settlement. Keine Schliessregel-Aenderung.

**Abhaengigkeit.** KV2-5; Kriterium (g) setzt zusaetzlich die `erwartet`-Zeile
`telnyx_sip` aus KV2-4 voraus, die in der Kette ohnehin davor liegt. Diese Phase steht
bewusst VOR dem Geld-Umschalter: bleibt die
Kette hier stehen, sammelt und meldet das System korrekt, ohne falsch zu buchen. Bliebe sie
nach dem Umschalter stehen, buchten wir korrekt und merkten einen Ausfall nicht.

---

