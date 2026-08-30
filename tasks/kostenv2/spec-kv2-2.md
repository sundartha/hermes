<!-- Auftragsblatt KV2-2. Geschnitten aus tasks/PLAN-KOSTEN-V2.md (Zeilen 751-981). -->

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

### KV2-2 - Kostenart-Katalog und Kostenprofil an der Engine-Weiche

**Ziel.** Die vollstaendige Kostenarten-Tabelle aus Abschnitt 3 wird eine eingefrorene,
beim Modul-Import validierte Datei, und jeder Anruf traegt ab jetzt ein set-once
`costProfile`, gesetzt an der Engine-Weiche. Nichts liest es produktiv, nichts wird
abgelehnt.

**Betroffene Dateien.** `src/billing/kostenarten.js` (neu, Muster
`src/billing/cost-ledger-map.js`: Pflichtfelder ohne Default, `assertRow`
(`cost-ledger-map.js:32-41`), Validierungsschleife beim Import (`:143`); dort liegt neben
dem Kostenart-Katalog auch die Profil-Registry, und JEDES Profil-Traeger-Paar traegt das
Pflichtfeld `einsammler` - s. Kriterium (i)),
`src/routes/api-calls.js` (Profil in jedem der drei Weichen-Zweige ab `:362`),
`src/routes/voice.js` (BEIDE Inbound-Zweige ab `:324` - NICHT die Erzeugungszeile `:320`,
s. 4.3), `src/store/state-ops.js` + `src/store/json.js` +
`src/store/pg.js` + `src/db/schema.sql` (Feld `cost_profile`, set-once),
`src/boot-guard.js` (der Riegel gegen den Realtime-Flip, Kriterium (h) - eine Zeile in
`latentCostPathFindings`, `:708` ff., keine neue Datei und keine eigene Phase), Tests.

Profile:

| Profil | Pflicht-Traeger | gesetzt in |
|---|---|---|
| `el_convai_sip` | `elevenlabs_convai`, `telnyx_sip` | EL-Zweig, `api-calls.js:362` ff. |
| `telnyx_assistant` | `telnyx_call_records` | Telnyx-Assistant-Zweig |
| `telnyx_budget` | `telnyx_call_records` (*) | TeXML-Zweig, `api-calls.js:394` ff. |
| `telnyx_inbound_budget` | `telnyx_call_records` | Inbound-Budget-Zweig, der `else`-Weg hinter `voice.js:324` |
| `telnyx_inbound_realtime` | `telnyx_call_records` + `openai_realtime` (**) | Inbound-Realtime-Zweig, `voice.js:324` ff. |

(*) `telnyx_budget` deckt heute BEIDE Outbound-Engines ab, weil `api-calls.js` dort nicht
auf die Engine verzweigt (die Weiche liegt im Webhook, `voice.js:476`). Das ist die
bekannte, benannte Restluecke dieser Phase - Owner-Entscheidung 10 (Abschnitt 7), die auf
ihrem Default laeuft. Solange der Default gilt, gilt die Traegerliste
`telnyx_call_records`, und der Plan behauptet NICHT, dass sie unter `VOICE_ENGINE=realtime`
vollstaendig waere. Ausloesen kann sie unter Owner-Entscheidung 13 (`fatal`, entschieden am
2026-08-30) allerdings niemand: mit `VOICE_ENGINE=realtime` startet der Prozess nicht.

(**) `openai_realtime` ist in diesem Profil ein katalogisierter Traeger OHNE Belegpflicht -
das ist seit dem 2026-08-30 keine Default-Annahme mehr, sondern die getroffene
Owner-Entscheidung 9 (OpenAI Realtime wird bis auf Weiteres nicht verwendet, s. 3.2 unter
der Tabelle und Abschnitt 7). Das Profil existiert und wird gesetzt, `openai_realtime` steht
in seiner Liste als `nicht_belegpflichtig`, es wird kein Beleg erwartet und kein Alarm
erzeugt. Der Phasenbericht vermerkt das als ENTSCHIEDEN, nicht als Default. Der Preis dieser
Entscheidung - ein einschaltbarer Schalter ohne Kostenpfad - wird nicht hingenommen, sondern
durch den Boot-Riegel (h) abgesichert.

(***) `telnyx_call_records` ist Pflicht-Traeger von VIER dieser fuenf Profile. Sein
Belegeinsammler entsteht in KV2-5(g) - aus dem `measured`-Ergebnis, das `trueOneCall` heute
schon bildet, ohne zusaetzlichen Anbieter-Abruf. Diese Phase hier setzt nur das Profil; sie
sammelt nichts. Die Zuordnung ist aber der Grund, warum der Einsammler ueberhaupt gebaut
werden muss: ohne ihn feuerte ab KV2-6 der Herzschlag `kosten:erfassung-tot:telnyx_call_records`
dauerhaft, und ab KV2-8 waere `dataComplete` fuer JEDEN Telnyx-Engine-Anruf falsch (4.5,
Owner-Entscheidung 11).

Die Aufteilung des frueheren Profils `telnyx_inbound` in zwei ist keine Vorratshaltung:
`VOICE_ENGINE` steht live auf `budget` (BELEGT `render.yaml:651-652`), ein einziger Env-Wert
kippt jeden Inbound-Anruf auf den Realtime-Traeger. Aus demselben Grund ist
`telnyx_inbound_budget` das Legacy-Profil fuer Altzeilen (4.6): jede Inbound-Altzeile ist
unter `budget` entstanden.

**Abnahmekriterium (ohne echten Anruf).**
(a) Eine Katalogzeile ohne `waehrung` / `pflicht` / `quelle` / `preisquelle` reisst den
Modul-Import ab (Bauzeit-Fehler, kein Testlauf-Fehler).
(b) Ein unbekannter Profilwert am Store-Mutator wirft; ein FEHLENDES Profil wirft NICHT,
sondern erzeugt eine WARN-Zeile - Regressionstest: ein Anruf entsteht auch ohne Profil.
(c) Inventar-Test ueber die WEICHEN-ZWEIGE: ein node:test faehrt einen Anruf ueber jeden der
FUENF Zweige und prueft, dass `costProfile` gesetzt ist und in der Registry steht. Die fuenf:
EL (`api-calls.js:362`), Telnyx-Assistant, TeXML-Outbound (`api-calls.js:394` ff.),
Inbound-Realtime (`voice.js:324`) und Inbound-Budget (der `else`-Weg dahinter). Der
Inbound-Teil faehrt BEIDE Stellungen von `config.voice.voiceEngine` (`budget` und
`realtime`) und erwartet ZWEI VERSCHIEDENE Profile - ein einziges Inbound-Profil laesst
diesen Test fallen. Damit deckt der Test die Stelle ab, an der ein Flag-Flip sonst still
bliebe (4.3, 6.4).
**Abgrenzung, damit (c) nicht mehr verspricht, als er haelt:** den OUTBOUND-TeXML-Zweig
faehrt dieser Test heute nur in EINER Stellung von `VOICE_ENGINE`. Der Grund ist kein
Testversaeumnis, sondern der Code: `api-calls.js` verzweigt im TeXML-Fall nicht auf die
Engine (`else`-Zweig ab `:394`, einziger Engine-Unterschied ist der Timer-Guard `:409`), die
Weiche faellt erst im Webhook (`voice.js:476`) - es existiert also gar kein zweites
Outbound-Profil, gegen das der Test pruefen koennte. Das ist Owner-Entscheidung 10, die am
2026-08-30 nicht ausdruecklich entschieden wurde und auf ihrem Default laeuft
(`telnyx_budget` unveraendert). Solange der Default gilt, deckt (c) den Flag-Flip fuer
INBOUND ab und fuer OUTBOUND NICHT, und dieser Plan behauptet das Gegenteil nicht. Wird 10
spaeter auf (a) gedreht, bekommt der Test einen sechsten Zweig und faehrt auch Outbound in
beiden Stellungen; bis dahin steht die Luecke hier geschrieben, statt unter einem gruenen
Test zu verschwinden. Wie schwer sie wiegt, haengt an Owner-Entscheidung 13 - und die ist am
2026-08-30 auf `fatal` ENTSCHIEDEN: unter `VOICE_ENGINE=realtime` startet der Prozess nicht,
also ist die Luecke unerreichbar. Der ausgeschriebene Preis in Punkt 13 gilt nur noch fuer
den Fall, dass jemand 13 spaeter auf (b) dreht.
(d) Der Katalog enthaelt alle **17** Zeilen aus Abschnitt 3, inklusive der bewusst nicht
umgelegten und der strukturell nicht umlegbaren - Test auf die Zeilenmenge (17), damit eine
spaetere Loeschung auffaellt. Die 17 schliesst `openai_realtime` (#14) ein, obwohl
Owner-Entscheidung 9 am 2026-08-30 auf "nicht bauen" gefallen ist: katalogisiert wird der
Traeger genau deshalb, weil der Schalter erreichbar bleibt. Sie schliesst ebenso
`telnyx_inference` (#15) ein, den siebten Telnyx-Belegtyp, der strukturell keinem Anruf
zuzuordnen ist (3.3), und `mail_zusammenfassung` (#16), die Zusammenfassungs-Mail je
beendetem Anruf, die heute weder gebucht noch bepreist ist (3.2), und `workos_auth` (#17),
die Konto-Rechnung des Identitaets-Anbieters WorkOS - eine reale, tenant-zuordenbare
Anbieter-Ausgabe ohne Anruf-Dimension, strukturell die Klasse von #10 und #12 (3.3). Die Zahl
17 wird an genau EINER Stelle im Test gepinnt; wer eine Zeile ergaenzt, zieht sie hier mit.
**Die gepinnte Zahl ist ein Loeschschutz, kein Vollstaendigkeitsbeweis.** Sie friert die
Menge ein, die Abschnitt 3 heute kennt; eine noch nicht bemerkte Kostenart kann sie nicht
finden, sondern nur festfrieren. Genau das ist an dieser Stelle einmal passiert: die Zahl
stand auf 15, waehrend die Zusammenfassungs-Mail fehlte. Der Schutz gegen diesen Fehler ist
deshalb nicht die Zahl, sondern die Regel aus 6.4 - jede Anbieter-Ausgabe bekommt eine
Katalogzeile, bevor sie live geht.
(e) `usage.costCents` und `usage_event` sind vor und nach jedem Test byte-identisch.
(f) Messaufgabe dieser Phase, lesend, ohne Testanruf: `GET /v1/user/subscription` gegen
ElevenLabs und die Frage, ob `<Play>`-Zeichen (Kostenart #7) und ConvAI aus DEMSELBEN
Kontingent gehen. Ergebnis wandert als `preisquelle` in die Katalogzeile - entweder als
ableitbarer Satz oder als gemessene Begruendung, warum es keinen gibt. Eine Begruendung
"kein `grep`-Treffer" ist als Ergebnis unzulaessig.
**Zweite Messaufgabe derselben Bauart, seit der Aufnahme der Katalogzeile #16:** die
Preisquelle der Zusammenfassungs-Mail (`mail_zusammenfassung`) - der Tarif des aktiven
Kanals (Brevo-Transactional bzw. Postfachtarif im SMTP-Fall) und die Konto-Waehrung.
Ebenfalls lesend, ohne Versand und ohne Testanruf. Das Ergebnis wandert als
`preisquelle`/`waehrung` in Zeile #16; "kein Preis-Parameter im Repo" ist als Ergebnis
genauso unzulaessig wie "kein `grep`-Treffer" (Regel aus 3.2 Zeile #7). Faellt
Owner-Entscheidung 15 auf "nur katalogisieren", bleibt es bei dieser dokumentarischen
Messung; faellt sie auf "bauen", ist der gemessene Satz die Eingabe des Einsammlers, der
dann als eigene Phase nach KV2-10 entsteht.
**Dritte Messaufgabe derselben Bauart, seit der Aufnahme der Katalogzeile #17:** die
Preisquelle der WorkOS-Konto-Rechnung (`workos_auth`) - Waehrung und Satz je aktivem Nutzer
aus der Anbieter-Preisliste. Lesend, ohne Schreibzugriff, ohne Anruf und ohne
Management-Aufruf (der Loeschpfad `src/workos-management.js` wird NICHT angefasst). Das
Ergebnis wandert als `preisquelle`/`waehrung` in Zeile #17; "kein Preis-Parameter im Repo"
ist auch hier als Ergebnis unzulaessig (Regel aus 3.2 Zeile #7). Ergibt die Recherche keinen
belastbaren Satz, ist das Ergebnis eine benannte offene Frage in Abschnitt 9, kein leeres
Feld. Ein Traeger wird daraus in KEINEM Fall - das ist bei #17 anders als bei #16 keine
offene Entscheidung, sondern die Festlegung aus 3.3 (die Gebuehr entsteht nicht im Anruf,
Abschnitt 8 Punkt 16).
Weitere Messaufgabe derselben Phase, rein dokumentarisch und ohne Anruf: die Preisquelle und
die Waehrung der Katalogzeile #14 (`openai_realtime`) aus der OpenAI-Preisliste. Sie bleibt
Pflicht, OBWOHL Owner-Entscheidung 9 auf "nicht bauen" gefallen ist - `preisquelle` und
`waehrung` sind Pflichtfelder jeder Katalogzeile (a), und eine Zeile ohne sie reisst den
Import ab. Die zweite, frueher hier mitgefuehrte Frage - ob das `response.done`-Ereignis der
Realtime-Sitzung einen Verbrauchs-/Kostenblock fuehrt (`bridge.js:383` liest heute keinen;
`grep` auf `usage` in `bridge.js`: 0 Treffer) - ist durch dieselbe Entscheidung GEPARKT: sie
waere nur fuer einen Einsammler noetig, der nicht gebaut wird. Sie bleibt als offener Punkt
in Abschnitt 9 stehen und ist erst zu beantworten, wenn die Engine je wieder aktiviert
werden soll. Ein Testanruf ist fuer die Preisrecherche NICHT zulaessig und auch nicht
noetig - sie steht in der Anbieter-Doku. Ergibt die Recherche keinen belastbaren Satz, ist
das Ergebnis eine benannte offene Frage in Abschnitt 9, kein leeres Feld.
(g) **Die `record_type`-Menge der Katalogzeile #3 wird gegen den Export gepinnt, nicht
abgeschrieben.** Ein node:test vergleicht die im Katalog gefuehrte Typmenge des Traegers
`telnyx_call_records` mit `ASSIGNABLE_COST_RECORD_TYPES` (`voice.js:178`, importiert - keine
Kopie) auf Mengengleichheit. Kommt ein neuer Telnyx-Belegtyp dazu (oder faellt einer aus der
Deny-Liste heraus), wird dieser Test ROT, statt dass der Katalog still unvollstaendig wird -
genau der Fall, der die frueheren zwei statt sechs Typen in Zeile #3 erzeugt hat. Gegenprobe
im selben Test, damit er nicht tautologisch gruen ist: die Menge ist nicht leer, und sie
enthaelt `inference` NICHT (der gehoert zu Katalogzeile #15, nicht zu #3).
(h) **Der Riegel gegen den Realtime-Flip** (Owner-Entscheidung 9 vom 2026-08-30, Haerte
ebenfalls entschieden am 2026-08-30: Owner-Entscheidung 13 auf `fatal`). Eine Zeile in `latentCostPathFindings`
(`boot-guard.js:708` ff., dieselbe reine, arg-injizierte Entscheidungsfunktion wie der
bestehende Befund `realtime_no_midcall_budget`): ist `VOICE_ENGINE=realtime` gewaehlt,
WAEHREND der Traeger `openai_realtime` im Katalog ohne Einsammler steht, entsteht ein
Befund. Haerte, entschieden (Punkt 13, nicht mehr Default): `fatal: true` - der Prozess
startet nicht, dasselbe Muster wie
`REQUIRED_TYPES_EMPTY` (`:657-664`), wo ein Dienst, der ohne Vollstaendigkeitsbegriff Geld
erstattet, ebenfalls nicht starten darf. Der bestehende Befund `realtime_no_midcall_budget`
bleibt daneben stehen und wird NICHT umgewidmet: er benennt die fehlende Mid-Call-BREMSE,
dieser hier die fehlende BUCHUNG - zwei Sachverhalte, zwei Labels (4.8, `defaults.js:180-184`).
Test: `VOICE_ENGINE=budget` erzeugt den Befund NICHT; `VOICE_ENGINE=realtime` erzeugt genau
einen, mit eigenem Code; wird fuer `openai_realtime` je ein Einsammler eingetragen,
verschwindet er wieder - der Riegel haengt am Kostenpfad, nicht am Schaltern-Namen.

(i) **Jeder Pflicht-Traeger jedes Profils hat einen benannten Einsammler - oder ist
ausdruecklich nicht belegpflichtig.** Das ist die Regel aus 4.5, hier zum ersten Mal als
Test; (c) und KV2-6(f) leisten sie nachweislich NICHT (Begruendung am Wortlaut beider, s.
4.5). Umsetzung: jedes Profil-Traeger-Paar der Registry traegt ein Pflichtfeld `einsammler`,
dessen Wert entweder eine Phasenkennung dieser Kette (`KV2-4` fuer `elevenlabs_convai`,
`KV2-5` fuer `telnyx_sip`, `KV2-5g` fuer `telnyx_call_records`) oder der Wert
`nicht_belegpflichtig` ist - letzterer heute genau einmal vergeben: `openai_realtime` im
Profil `telnyx_inbound_realtime` (Owner-Entscheidung 9). Ein fehlendes, leeres oder freies
drittes Feld reisst wie in (a) den Modul-Import ab, also zur Bauzeit und nicht zur
Testlaufzeit. Der node:test laeuft ueber ALLE Profile und ALLE ihre Traeger und wird rot,
sobald ein Paar keinen der beiden Zustaende traegt.
**Gegenprobe im selben Test, sonst ist er tautologisch gruen:** ein kuenstlich in eine KOPIE
der Registry eingefuegtes Profil, dessen Traeger weder Phasenkennung noch
`nicht_belegpflichtig` traegt, faellt nachweislich durch (erwarteter Fehler, benannt); die
Aenderung wirkt nur auf die Kopie, die echte Registry bleibt unberuehrt.
**Abgrenzung, damit (i) nicht mehr verspricht, als er haelt:** der Test prueft, dass ein
Einsammler BENANNT ist, nicht dass er existiert und laeuft. Dass wirklich eingesammelt wird,
pinnen KV2-5(g) (die Zeile entsteht) und KV2-6(f) (der Herzschlag schweigt nur, weil sie
entsteht). Zwei Fragen, zwei Tests - sie duerfen nicht auf denselben gelegt werden.
**Preis, bewusst getragen:** der Katalog bekommt ein Pflichtfeld mehr, und wer eine Phase
umbenennt, zieht die Werte mit. Das ist gewollt: genau diese Umbenennung verloere die
Zuordnung sonst still.
Faellt Owner-Entscheidung 11 auf (b), aendert sich an (i) nichts, nur an einem Wert - dann
traegt `telnyx_call_records` in den vier Bestandsprofilen nicht `KV2-5g`, sondern die dann
zu vergebende Kennung des Bestandspfads. Der dritte Zustand bleibt in beiden Faellen rot.

**Was diese Phase NICHT tut.** Sie lehnt keinen Anruf ab (das ist die zentrale Korrektur
gegenueber Entwurf A, s. 4.3). Sie liest das Profil nirgends produktiv. Sie legt keine
Tabelle an. Sie bewegt keinen Cent. Sie baut KEINEN Beleg-Einsammler fuer
`openai_realtime` - der Traeger wird ausschliesslich katalogisiert (Abschnitt 8, Punkt 13;
Owner-Entscheidung 9, entschieden am 2026-08-30). Was sie sehr wohl tut und was nicht unter
diesen Vorbehalt faellt: den Boot-Riegel (h). Er ist keine Bauphase fuer den Traeger,
sondern die Sicherung dagegen, dass der Schalter ohne Kostenpfad angeht. Sie baut ebenso KEINEN
Beleg-Einsammler und keinen Buchungsweg fuer `mail_zusammenfassung` (#16): die
Zusammenfassungs-Mail wird in dieser Phase ausschliesslich katalogisiert und bepreist (f),
nicht erfasst (Abschnitt 8, Punkt 15; Owner-Entscheidung 15 - nicht ausdruecklich
entschieden, sie laeuft auf dem Default "nur katalogisieren"). Sie baut ebenso KEINEN
Einsammler und keinen Buchungsweg fuer `workos_auth` (#17): die WorkOS-Konto-Rechnung wird
katalogisiert und bepreist (f), nicht erfasst - und hier ohne offene Entscheidung, weil die
Gebuehr nicht im Anruf entsteht (3.3, Abschnitt 8 Punkt 16). `workos_auth` ist Pflicht-Traeger
KEINES Profils; an der Profil-Registry und an Kriterium (i) aendert die Zeile nichts. Sie aendert nichts
an der Outbound-Weiche und schliesst damit Owner-Entscheidung 10 nicht.

**Abhaengigkeit.** KV2-1 (damit die WARN-Zeile "Profil fehlt" einen Weg nach draussen hat).
Owner-Vorbedingung: keine. Entscheidung 9 (Realtime-Traeger bauen oder katalogisieren) ist
am 2026-08-30 GETROFFEN: katalogisieren, plus Riegel (h) - kein Default mehr, sondern eine
Vorgabe. Ebenfalls GETROFFEN ist Entscheidung 13 (Haerte des Riegels (h)): `fatal` - auch
das ist Vorgabe, kein Default mehr. Auf ihrem DEFAULT laufen an dieser Phase Entscheidung 10
(Profil-Setzstelle im Outbound-TeXML-Zweig, Default: `telnyx_budget` unveraendert lassen) und
Entscheidung 12 (Traegername `telnyx_call_records` gegen Aufspaltung in Traeger je Belegtyp,
Default: umbenannt lassen, wie in diesem Dokument durchgezogen); beide sind am 2026-08-30
NICHT ausdruecklich entschieden worden, und der Phasenbericht fuehrt sie als Default.
**Die frueher hier stehende Kopplung zwischen 13 und 10 ist erledigt:** sie galt nur fuer die
verworfene Variante 13(b) (laut statt fatal), die die Outbound-Restluecke dieser Phase erst
erreichbar gemacht haette. Unter der getroffenen Entscheidung 13(a) besteht sie nicht - die
Restluecke ist unerreichbar, weil der Prozess unter `VOICE_ENGINE=realtime` nicht startet.
Wer 13 je auf (b) dreht, muss 10 im selben Zug auf (a) mitziehen; der Preis ist in Punkt 13
ausgeschrieben. Auf ihrem Default laeuft an dieser Phase ausserdem Entscheidung 15
(`mail_zusammenfassung` nur katalogisieren oder einen Traeger bauen, Default: nur
katalogisieren, wie #6 - die Katalogzeile und die Preismessung (f) entstehen in beiden
Faellen). Bleibt eine Antwort aus, laeuft die Phase mit dem jeweiligen
Default, und der Phasenbericht vermerkt ihn ausdruecklich als Default, nicht als getroffene
Entscheidung.

---

