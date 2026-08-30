<!-- Auftragsblatt KV2-7. Geschnitten aus tasks/PLAN-KOSTEN-V2.md (Zeilen 1400-1573). -->

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

### KV2-7 - Schliessregel, Faelligkeit, Verfall, Endzustaende

**Ziel.** Ein Anruf bleibt Kandidat, bis seine Pflichtmenge vollstaendig ist oder Frist bzw.
Versuche erschoepft sind - statt beim ersten Teilbeleg zuzulatchen. Und ein Anruf, dessen
Beleg strukturell unbeschaffbar ist, bekommt einen eigenen Endzustand statt eines Dauer-Alarms.

**Betroffene Dateien.** `src/billing/cost-truing.js` (`isTruingCandidate`, `:288-294`;
Schliesslogik in `trueOneCall`; Versuche je Traeger statt je Anruf; die Erkennungsregel aus
(h) als EIN reines Praedikat ueber den Anruf-Datensatz, nicht verteilt auf zwei Stellen),
`src/store/state-ops.js` (Endzustaende am Beleg und am Anruf; gelesen werden dort
ausschliesslich vorhandene Felder - `costProfile`, `endedAt`, `elevenlabsConversationId`
(`:380`), `sipCallId` (`:389`) -, es entsteht KEIN neues Anruf-Feld fuer (h)),
`src/config.js` / `.env.example`
(`COST_SETTLE_DEADLINE_HOURS`, entschieden auf 48 - s. Owner-Entscheidung 3; die frueher
hier stehende Verweisung auf Entscheidung 6 war falsch, 6 ist die Tarif-Automatik), Tests.

Endzustaende: `vollstaendig`, `unvollstaendig_final` (mit namentlicher Liste der fehlenden
Traeger), `beleg_strukturell_unbeschaffbar`, `profil_fehlt`.

**Abnahmekriterium (ohne echten Anruf).**
(a) **Regressionsschutz, der die ganze Phase traegt:** ein Anruf mit Profil `telnyx_budget`
(genau ein Pflicht-Traeger) verhaelt sich byte-identisch zu heute - dieselbe Zahl Versuche,
derselbe Zeitpunkt fuer `costTruedAt`, derselbe Herkunftswert.
(b) Ein Anruf mit Profil `el_convai_sip`, dessen Telnyx-Beleg zuerst eintrifft, bleibt
Kandidat und wird nicht geschlossen.
(c) Nach Ablauf der Frist wird derselbe Anruf geschlossen, sein Endzustand ist
`unvollstaendig_final`, die fehlenden Traeger sind namentlich benannt, und er ist kein
Kandidat mehr - er bleibt nicht ewig offen.
(d) Versuche werden je Traeger gezaehlt: ein erschoepfter Telnyx-Zaehler beendet nicht die
Nachreifung der EL-Zeile.
(e) Ein Anruf vom Abbruchweg landet in `beleg_strukturell_unbeschaffbar` und erzeugt keinen
Deckungs-Alarm.
(f) `usage.costCents` unveraendert - diese Phase bucht noch immer nichts.
(g) **Der Phasenschnitt-Nachlauf (einmalig, s. 4.7):** Fixture mit Profil `el_convai_sip`,
`costTruedAt` gesetzt, genau eine `call_cost_evidence`-Zeile `traeger=telnyx_sip` und keine
`elevenlabs_convai`-Zeile mit `reife=belegt` oder `vorlaeufig` -> nach dem Nachlauf ist
`costTruedAt === null`, der Anruf ist im naechsten Sweep wieder Kandidat. Ein zweiter
Durchlauf des Nachlaufs auf denselben Datensatz ist ein No-Op (bereits `null`, nichts
aendert sich).
**Gegenprobe, die zum Kriterium gehoert:** ein zweites Fixture mit Profil `el_convai_sip`
und gesetztem `costTruedAt`, aber OHNE jede `call_cost_evidence`-Zeile (die Altzeile von VOR
der Kette) wird NICHT angefasst - `costTruedAt` bleibt unveraendert. Ohne diese Gegenprobe
waere das Kriterium blind fuer genau den Fall, den die gestrichene Zeitfenster-Bedingung
verdeckt abgedeckt hatte (s.u.).

(h) **Die Erkennungsregel fuer den Fall "Deploy mitten im Gespraech" (6.10) - zustandsbasiert
und ohne Deploy-Zeitstempel.** Ohne sie ist der Endzustand
`beleg_strukturell_unbeschaffbar` fuer diesen Fall eine Zusage ohne Mechanismus: (e) pinnt
ausschliesslich den ABBRUCHWEG, und dort entsteht der Zustand am BELEG, weil
`persistProviderResult` (`elevenlabs/outbound.js:1283-1331`) gelaufen ist. Im 6.10-Fall
laeuft genau dieser Aufruf NIE - `boot.js:1180` (`lifecycle.rearmActiveCallTimers`)
terminalisiert den Anruf vor `:1207` (`rearmActiveConversationPolls`), BELEGT, in dieser
Session gelesen. Es entsteht also weder eine EL-Belegzeile noch die `erwartet`-Zeile
`telnyx_sip`, die einen Marker tragen koennte. Ohne eigene Regel liefe ein solcher Anruf
nach Fristablauf in `unvollstaendig_final`, zaehlte voll in die Deckungsquote (nach KV2-6(c)
ist NUR `beleg_strukturell_unbeschaffbar` ausgenommen) und speiste den Herzschlag - also
genau den Dauer-Alarm, den 4.4 verwirft. Eine spaetere Session muesste die Regel erfinden.
**Die Regel, am Anruf-Datensatz und an nichts sonst.** Ein Anruf bekommt den Endzustand
`beleg_strukturell_unbeschaffbar` AM ANRUF (nicht an einem fehlenden Beleg), wenn ALLE
folgenden Bedingungen gleichzeitig gelten:
1. `costProfile === el_convai_sip`,
2. `endedAt` gesetzt,
3. `elevenlabsConversationId` vorhanden (das Gespraech hat beim Anbieter existiert),
4. `sipCallId === null` - der Schluessel hat genau EINEN Schreiber, `store.recordSipCallId`
   in `elevenlabs/outbound.js:1312` (BELEGT: `grep` ueber `src/` liefert ausserhalb der
   Store-Fassade genau diesen einen Aufrufer), und der sitzt INNERHALB von
   `persistProviderResult`. Ein leerer Schluessel heisst also: dieser Aufruf ist nie
   gelaufen,
5. KEINE `call_cost_evidence`-Zeile zu diesem Anruf, in keinem Zustand.
**Warum 4 und 5 beide noetig sind und keine der beiden allein reicht:** der
Bestandskommentar an `outbound.js:1305-1311` benennt einen zweiten Weg zu einem leeren
Schluessel - der Anbieter meldet ein Ergebnis ohne `phone_call.call_id`. Dann IST
`persistProviderResult` gelaufen, und KV2-4 hat die `elevenlabs_convai`-Zeile geschrieben;
Bedingung 5 schliesst diesen Fall aus. Umgekehrt hat ein Anruf, dessen Belegsammlung nur
noch nicht angelaufen ist, sehr wohl einen `sipCallId`; Bedingung 4 schliesst ihn aus.
**Zeitpunkt der Einordnung, ausdruecklich:** die Regel wird bei FAELLIGKEIT ausgewertet,
also nach Ablauf von `COST_SETTLE_DEADLINE_HOURS`, nie waehrend der laufenden Frist. Sonst
traefe sie das Fenster von wenigen Millisekunden zwischen dem Ende eines Gespraechs und dem
Lauf von `persistProviderResult` und erklaerte einen voellig gesunden Anruf fuer
unbeschaffbar. Das ist dieselbe Regel wie in der Matrix 4.6 ("ein Traeger fehlt, Frist laeuft
noch -> warten").
**Folge, dieselbe wie bei (e):** eigene, benannte Zaehlzeile, KEIN Deckungs-Alarm, nicht in
der Deckungsquote (KV2-6(c)), Schaetzung bleibt stehen (Restrisiko, 6.10).
Test: ein Fixture mit allen fuenf Bedingungen und abgelaufener Frist bekommt
`beleg_strukturell_unbeschaffbar` und erzeugt keinen Deckungs-Alarm.
**Gegenprobe im selben Test, zwei Richtungen:** (i) ein nie angenommener Anruf ohne
`estimatedCostCents` faellt NICHT in diese Menge - er ist kein unbeschaffbarer Beleg,
sondern ein Anruf ohne Kosten, und die Matrix 4.6 behandelt ihn als gueltigen Beleg mit 0;
(ii) derselbe Fixture wie oben, aber mit gesetztem `sipCallId`, faellt ebenfalls nicht in
die Menge, sondern bleibt regulaerer Kandidat.
**Reichweite, ehrlich benannt:** am 2026-08-30 gibt es in der Produktion NULL Anrufe, die
diese Regel traefe - alle 12 EL-Anrufe tragen `sip_call_id` (gemessen, s. 4.3). Die Regel
sichert einen Fall, der noch nicht eingetreten ist; das ist ihr Zweck (6.10) und keine
Vermutung ueber Bestandsdaten.

**Der Phasenschnitt-Nachlauf im Detail.** Ein benannter, EINMALIGER Migrations-Lauf (Teil
des KV2-7-Deploys, kein Dauerbetrieb) identifiziert jeden Anruf, auf den ALLE VIER
Bedingungen zutreffen:

1. Profil `el_convai_sip`,
2. `costTruedAt` gesetzt,
3. **mindestens eine `call_cost_evidence`-Zeile `traeger=telnyx_sip`**,
4. KEINE `call_cost_evidence`-Zeile `traeger=elevenlabs_convai` mit `reife=belegt` oder
   `vorlaeufig`.

Fuer jeden Treffer setzt der Lauf `costTruedAt` zurueck auf `null`.

**Die Bedingung ist rein zustandsbasiert - ein Zeitfenster gibt es ausdruecklich NICHT.**
Eine fruehere Fassung dieses Plans verlangte zusaetzlich, dass `costTruedAt` "zwischen dem
KV2-5- und dem KV2-7-Deploy-Zeitpunkt" gesetzt wurde. Diese Bedingung ist gestrichen, und
zwar aus einem Grund, der am Code steht: **keiner der beiden Zeitpunkte ist irgendwo
persistiert.** Der Anruf-Datensatz fuehrt `actualCostMicroCents`, `costTruedAt`,
`costTruedSource` und `costTruingAttempts` - keinen Deploy-Zeitstempel (BELEGT,
`src/store/state-ops.js:320-334`); auch das Abnahmekriterium (g) hat den Zeitbezug nie
geprueft. Eine spaetere Session muesste ihn raten, und ein geratener Zeitbezug an einem
einmaligen Migrationslauf ist die schlechteste Sorte Vermutung.

**Bedingung 3 ist der Riegel, den das Zeitfenster verdeckt getragen hat.** Ohne sie faellt
auch ein EL-Anruf von VOR der Kette in die Menge: er hat Profil (ueber den Legacy-Fallback),
`costTruedAt` gesetzt und keine EL-Belegzeile. Genau von dem unterscheidet ihn der
Telnyx-SIP-Beleg: `call_cost_evidence` existiert erst ab KV2-3, und eine
`telnyx_sip`-Zeile kann erst entstehen, seit KV2-5 `call.sipCallId` lernt (4.7). Eine solche
Zeile IST damit der Zustandsbeweis dafuer, dass der Anruf im Phasenschnitt-Fenster gelatcht
wurde - dieselbe Aussage, die das Zeitfenster treffen wollte, nur belegt statt datiert. Ein
Altanruf von vor der Kette bleibt geschlossen, SOLANGE er keine `telnyx_sip`-Zeile hat; das
ist gewollt und deckt sich mit Owner-Entscheidung 7.
**Eine Folge muss hier ausdruecklich stehen, weil sie sonst spaeter als Widerspruch gelesen
wird:** faellt Owner-Entscheidung 14 auf (a) - profillose Altzeilen mit gesetztem
`sipCallId` bekommen `el_convai_sip` -, dann bekommen die 12 EL-Altanrufe in KV2-5 eine
`telnyx_sip`-Zeile und `costTruedAt` und erfuellen ab KV2-7 alle vier Bedingungen des
Nachlaufs. Sie werden also wieder geoeffnet. **Das widerspricht Owner-Entscheidung 7
nicht**, denn "geoeffnet" ist nicht "gebucht": `applyCostCorrectionCents` hat fuer sie nie
gelaufen (KV2-5 ruft `bookCorrectionFor` fuer die EL-Route nicht), und im Settlement ab
KV2-8 ist ihr Ist (4,01 US-ct SIP) kleiner als die Schaetzung (30 ct) bei fehlender
EL-Belegzeile, also `dataComplete = false` - die Matrix in 4.6 sagt dafuer **nichts**, keine
Erstattung. Null Cent, in jeder Phase der Kette. Was sie stattdessen tun: bis zum
Fristablauf stehen sie sichtbar in der EL-Deckungsquote und landen dann in
`unvollstaendig_final` - genau der Preis, den Owner-Entscheidung 14 (a) benennt. Faellt 14
auf (b), tragen sie gar kein Profil, erfuellen Bedingung 1 des Nachlaufs nicht und bleiben
geschlossen.
Als Marker taugt der Ist-Betrag am Anruf ausdruecklich NICHT: im Phasenschnitt-Fenster
liefert der Telnyx-Beleg eine Messung, `recordCallCostTruingResult` schreibt
`actualCostMicroCents` (`state-ops.js:809-810`), und eine Bedingung "kein Ist-Betrag" wuerde
genau die Zielmenge ausschliessen. Dass fuer diese Anrufe trotzdem nichts gebucht wurde,
steht eine Ebene tiefer: KV2-5 ruft `bookCorrectionFor` fuer die EL-Route ausdruecklich
nicht auf.

**Das weicht den
set-once-Riegel nicht auf:** der Riegel schuetzt gegen doppelte BUCHUNG, und "bis
einschliesslich KV2-7 bewegt die Kette keinen Cent" (Abschnitt 5, Abnahmekriterium jeder
Phase bis hierher) - fuer keinen der betroffenen Anrufe hat `applyCostCorrectionCents` je
gelaufen, es gibt also nichts, was der Nachlauf doppelt buchen koennte. Der Lauf selbst ist
idempotent (zweiter Durchlauf trifft auf bereits `null` gesetzte Zeilen, No-Op) und laeuft
genau einmal beim Deploy, nicht als Teil des laufenden Sweeps.

**Was diese Phase NICHT tut.** Kein Settlement, keine Buchung, keine Aenderung an
`applyCostCorrectionCents`. Auch (h) bucht nichts: die Regel ordnet einen Anruf ein und
haelt ihn aus Deckungsquote und Herzschlag heraus, sie bewegt keinen Cent und aendert die
Schaetzung nicht (die bleibt stehen, Restrisiko 6.10). Sie verhindert den 6.10-Fall auch
NICHT - dafuer muesste die Boot-Reihenfolge angefasst werden, und das ist nicht Teil dieser
Kette; sie macht ihn unterscheidbar.

**Abhaengigkeit.** KV2-6. Owner-Vorbedingung: Entscheidung 3 (Frist bis zum
Zwangs-Settlement) und Entscheidung 4 (Anruf ohne Vollbeleg nach Fristablauf, Abschnitt 7) -
beide am 2026-08-30 GETROFFEN: 48 Stunden, und der Tenant traegt die Schaetzung.
Kriterium (h) haengt zusaetzlich an Entscheidung 3, aber an keiner neuen: seine Auswertung
findet bei Faelligkeit statt, also nach `COST_SETTLE_DEADLINE_HOURS`. Eine eigene
Owner-Frage oeffnet (h) nicht - die Bedingungsmenge ist am Code entschieden (einziger
Schreiber von `sipCallId`, Boot-Reihenfolge in `boot.js`), nicht eine Abwaegung.
Beide Werte sind damit Vorgabe, nicht Default; der Phasenbericht fuehrt sie als
Entscheidung. Eine Kulanz-Gutschrift ohne Beweis ist ausdruecklich verworfen.

---

