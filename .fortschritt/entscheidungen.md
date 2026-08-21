# Entscheidungen — Anruf-Inbox

Offene Fragen an Antonio zum Vorhaben "Anruf-Inbox" (neues Werkzeug, mit dem ein
verbundener KI-Assistent nachschauen kann, ob neue eingehende Anrufe da sind und was zu tun
ist). Der zugehoerige Bauplan liegt in `PLAN-ANRUF-INBOX.md`.

**Wie das hier zu lesen ist.** Fuer jede Frage steht eine Empfehlung und eine getroffene
Annahme. Mit dieser Annahme wird gebaut, solange nichts anderes entschieden ist — es
blockiert also nichts. Eine andere Entscheidung ist jederzeit moeglich; bei jeder Frage
steht dabei, was sie kostet.

Alle Eintraege: Datum **2026-08-21**, Status **offen**.

---

## F-1 — Wie soll das Werkzeug heissen?

**Kontext.** Der Assistent sieht eine Liste von Werkzeugen mit Namen und ruft eines davon
auf, wenn es zur Frage des Nutzers passt. Der Name ist die halbe Miete dafuer, dass er das
richtige waehlt.

**Empfehlung: `check_inbox`.** Kurz, sagt genau, was passiert, und kollidiert mit nichts —
das Wort "inbox" kommt im gesamten Projekt bisher kein einziges Mal vor. Alternativen
waeren `list_new_calls` (praeziser bei Frage 1, verschweigt aber Frage 2 "was ist zu tun")
oder `get_call_inbox` (umstaendlich).

**Getroffene Annahme.** `check_inbox`.

**Datum.** 2026-08-21 · **Status.** offen

---

## F-2 — Sollen Anrufe automatisch als "gesehen" gelten, sobald der Assistent sie abruft?

**Kontext.** Damit die Antwort "nichts Neues" ueberhaupt vorkommen kann, muss der Server
sich merken, welche Anrufe schon gezeigt wurden. Zwei Wege: entweder gilt ein Anruf
automatisch als gesehen, sobald er ausgeliefert wurde, oder der Assistent muss ihn
ausdruecklich abhaken.

**Empfehlung: automatisch.** Ein ausdrueckliches Abhaken haengt daran, dass das
KI-Modell daran denkt — und Modelle tun so etwas unzuverlaessig. Vergisst es das nur ab und
zu, laeuft die Inbox nie leer, jede Sitzung wiederholt dieselben Anrufe, und die
Kernanforderung "gibt es nichts Neues, ist die Antwort kurz und eindeutig leer" tritt nie
ein. Das Feature waere dann genau an der Stelle kaputt, um die es geht.

**Der Preis, offen benannt.** Laesst jemand den Assistenten im Hintergrund regelmaessig
nachschauen, koennen Anrufe als "gesehen" markiert werden, ohne dass ein Mensch sie je
gelesen hat. Drei Dinge entschaerfen das: (1) der Anruf verschwindet nicht — er ist
weiterhin ueber die Anrufliste, das Dashboard, die Benachrichtigung und die
Zusammenfassungs-SMS/-Mail zu sehen; die Inbox ist ein zusaetzlicher Kanal, nie der
einzige. (2) Es gibt einen Schalter am Werkzeug ("auch schon Gesehenes zeigen"), der nichts
veraendert und alles noch einmal anzeigt. (3) In der Werkzeug-Beschreibung steht
ausdruecklich, dass dieses Werkzeug verbraucht und fuer blosses Durchblaettern die normale
Anrufliste zu benutzen ist.

**Getroffene Annahme.** Automatisch als gesehen markieren, plus der Schalter "auch schon
Gesehenes zeigen" (standardmaessig aus).

**Datum.** 2026-08-21 · **Status.** offen

---

## F-3 — Soll ein Anruf, der technisch mittendrin abbricht, einen Eintrag erzeugen?

**Kontext.** Manchmal endet ein Gespraech nicht sauber, sondern mit einem technischen
Fehler. Es gibt dann zwar Gespraechsinhalt, aber keine Auswertung: das System erstellt fuer
solche Anrufe heute grundsaetzlich keine Zusammenfassung.

**Empfehlung: nein, kein Eintrag.** Es gaebe schlicht nichts zu melden ausser "Gespraech
abgebrochen, Inhalt unbekannt" — das ist Laerm, und der Fall ist bereits sichtbar: es gibt
dafuer schon heute eine Benachrichtigung im Dashboard, die unveraendert bleibt.

**Was ein "ja" kosten wuerde.** Man muesste fuer abgebrochene Gespraeche zusaetzlich eine
KI-Auswertung fahren. Das ist eine Verhaltensaenderung im Abrechnungs- und Kostenpfad und
geht deutlich ueber diesen Auftrag hinaus — es waere ein eigenes Vorhaben.

**Getroffene Annahme.** Kein Eintrag bei technischem Abbruch.

**Nicht zu verwechseln mit:** dem Fall, dass ein Gespraech normal stattgefunden hat, aber
die KI-Auswertung danach ausfaellt (z. B. Anbieter-Stoerung). Dort **entsteht** ein Eintrag
— mit dem Hinweis, dass die Zusammenfassung gerade nicht verfuegbar ist. Sonst wuerde das
Werkzeug bei einer Stoerung "keine neuen Anrufe" melden, obwohl zehn Leute angerufen haben.
Das ist keine offene Frage, sondern im Plan so festgelegt.

**Datum.** 2026-08-21 · **Status.** offen

---

## F-4 — Soll es einen Ausschalter fuer das Werkzeug geben?

**Kontext.** Fuer alles, was Geld kostet oder Anrufe ausloest, gibt es im System einen
Schalter, mit dem es abgeschaltet werden kann. Die Frage ist, ob dieses Werkzeug auch einen
braucht.

**Empfehlung: nein.** Das Werkzeug loest keinen Anruf aus, verschickt keine SMS, ruft
keinen externen Dienst und kostet nichts. Es zeigt nur Daten, die dem Kunden ohnehin
gehoeren und die er ueber vier andere Wege schon sehen kann. Ein Schalter waere vier
Stellen zusaetzlicher Pflege fuer eine Sicherung, die nichts sichert.

**Was ein "ja" kosten wuerde.** Vier Pflegestellen (Konfiguration, Beispieldatei,
Deployment-Datei, Testgrundlage) und ein Standardwert "aus", damit im Zweifel nichts
laeuft.

**Getroffene Annahme.** Kein Ausschalter.

**Datum.** 2026-08-21 · **Status.** offen

---

## F-5 — Wie viele Anrufe pro Abruf, und in welcher Reihenfolge?

**Kontext.** Wenn laengere Zeit niemand nachgeschaut hat, koennen viele Anrufe auf einmal
anstehen. Eine Antwort mit fuenfzig Anrufen ist fuer den Assistenten unhandlich.

**Empfehlung: hoechstens 20 pro Abruf, aeltester zuerst, und die Antwort nennt ehrlich, wie
viele noch warten.** Eine Inbox wird abgearbeitet, nicht durchgeblaettert — deshalb der
aelteste zuerst. Der naechste Abruf liefert den Rest, nichts geht verloren. Die
Rest-Angabe ist wichtig, damit der Assistent nicht "2 neue Anrufe" meldet, waehrend 25
warten.

**Getroffene Annahme.** 20 pro Abruf, sortiert nach Beginn des Anrufs (aeltester zuerst),
mit Angabe der verbleibenden Anzahl.

**Datum.** 2026-08-21 · **Status.** offen

---

## F-6 — Wie sollen die beiden Standardtexte lauten?

**Kontext.** Zwei Saetze bekommt der Kunde in seiner Sprache zu sehen: der Text, wenn es
nichts Neues gibt, und der Hinweis, wenn zu einem Anruf ausnahmsweise keine Zusammenfassung
erstellt werden konnte.

**Empfehlung.**

| Anlass | Deutsch | Englisch | Franzoesisch |
|---|---|---|---|
| Nichts Neues | Keine neuen Anrufe. | No new calls. | Aucun nouvel appel. |
| Zusammenfassung fehlt | Zusammenfassung nicht verfuegbar (technischer Fehler). | Summary unavailable (technical error). | Resume indisponible (erreur technique). |

Begruendung: derselbe knappe Ton wie die bereits vorhandenen Leertexte im System.

**Wichtig zum ersten Satz.** "Keine neuen Anrufe." heisst **nicht** "es hat niemand
angerufen". Wird ein Anruf abgewiesen, bevor der Assistent ihn annimmt — bei unbekannter
Zielnummer oder erschoepftem Guthaben —, entsteht gar kein Datensatz und damit auch kein
Eintrag. Der Text ist bewusst so neutral formuliert, dass er nichts Falsches behauptet.
Siehe F-8.

**Getroffene Annahme.** Diese sechs Zeichenketten.

**Datum.** 2026-08-21 · **Status.** offen

---

## F-7 — Sollen die internen Kennungen der Aufgaben mitgeliefert werden?

**Kontext.** Wenn im Gespraech eine Aufgabe entsteht ("Rueckruf am Donnerstag"), legt das
System dafuer einen Eintrag mit einer internen Kennung an. Die Frage ist, ob diese Kennung
mit in die Antwort soll.

**Empfehlung: nein, nur die Texte.** Es gibt derzeit kein Werkzeug, mit dem der Assistent
eine Aufgabe wieder abhaken koennte — die Kennung waere also ein Griff ins Leere. Wer sie
braucht, sieht sie weiterhin im bestehenden Aufgaben-Werkzeug.

**Getroffene Annahme.** Nur die Texte.

**Datum.** 2026-08-21 · **Status.** offen

---

## F-8 — Soll spaeter sichtbar werden, wie viele Anrufe abgewiesen wurden?

**Kontext.** Zwei Faelle fuehren dazu, dass ein Anruf gar nicht erst angenommen wird: die
angerufene Nummer ist nicht (mehr) aktiv, oder das Guthaben des Kunden ist erschoepft. In
beiden Faellen entsteht kein Datensatz — und damit auch kein Inbox-Eintrag. Der Auftrag
verlangt das ausdruecklich so ("ein Anruf, der nie ankam, darf keinen Eintrag erzeugen").

**Warum es trotzdem eine Frage ist.** Aus Kundensicht ist der Unterschied zwischen "es hat
niemand angerufen" und "wir haben jeden weggeschickt" genau der, der Geld kostet. Wer bei
erschoepftem Guthaben "Keine neuen Anrufe." liest, verpasst moeglicherweise drei Anfragen
desselben Interessenten.

**Empfehlung: nicht in diesem Vorhaben, aber vormerken.** Die saubere spaetere Antwort
waere ein reiner Zaehler pro Kunde ("3 Anrufe konnten nicht angenommen werden") — ohne
Nummern, ohne Namen, ohne Inhalte, also ohne neue Datenschutz-Frage. Das ist ein eigenes,
kleines Vorhaben und wuerde diesen Auftrag verwaessern.

**Getroffene Annahme.** Nicht Teil dieser Kette. Der Leertext ist so formuliert, dass er
keine Vollstaendigkeit behauptet, und die Grenze ist im Bauplan festgehalten.

**Datum.** 2026-08-21 · **Status.** offen

---

## Was hier bewusst KEINE Frage ist

Zwei Punkte koennten wie Entscheidungen aussehen, sind aber im Bauplan bereits festgelegt,
weil sie sonst ein Kernversprechen des Auftrags brechen wuerden:

- **Ein Anruf mit Gespraechsinhalt bekommt einen Eintrag, auch wenn die KI-Auswertung
  ausfaellt.** Sonst lautet die Antwort bei einer Anbieter-Stoerung "keine neuen Anrufe",
  waehrend Menschen angerufen haben. Eine Falschaussage, die wie eine Entwarnung aussieht,
  ist das gefaehrlichste Ergebnis, das dieses Werkzeug liefern kann.
- **Ein Gespraech muss mehr sein als ein Fuellwort.** Ein einzelnes "aeh" oder "ok" erzeugt
  keinen Eintrag. Es braucht entweder zwei echte Aeusserungen des Anrufers oder in Summe
  mindestens ein Dutzend Zeichen. Ohne diese Huerde fuellt sich die Inbox mit Eintraegen
  "Anrufer meldete sich, Anliegen unklar" — der sichere Weg dahin, dass der Kunde das
  Werkzeug abschaltet.

---

## F-10: Live-Nachweis mit echtem Anruf (Deploy-Entscheidung)

**Frage:** Soll der neue Stand deployt und mit einem echten eingehenden Anruf
auf der Hermes-Nummer nachgewiesen werden?

**Kontext:** Die drei Etappen sind gemergt und offline vollstaendig belegt
(Tests + End-zu-End gegen lokal gestarteten Server: echter Gespraechsverlauf
erzeugt Eintrag, check_inbox holt ihn ab, zweiter Abruf eindeutig leer, nie
angekommener Anruf erzeugt keinen). Was offline nicht geht: der Beweis am
oeffentlich erreichbaren System mit echter Telefonie.

**Empfehlung:** Deployen und einen kurzen Testanruf von deinem Handy auf die
Hermes-Nummer machen (etwas sagen, z.B. eine Rueckruf-Bitte), danach in
Claude "check_inbox" aufrufen. Kosten: ein Anruf von wenigen Cent.
Deploy und echter Anruf sind Owner-Handlungen - ich loese beides nicht
selbst aus (Render deployt aus dem Upstream-Repo; echte Telefonie kostet
Geld und beruehrt das Live-System).

**Getroffene Annahme:** Kette gilt als fertig gebaut und offline bewiesen;
der Live-Testanruf steht als letzter Schritt aus und ist in der Ergebnis-
Seite als "offen" ausgewiesen.

Datum: 2026-08-21 · Status: offen
