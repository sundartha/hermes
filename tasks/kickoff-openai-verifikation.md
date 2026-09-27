# Kickoff: OpenAI-Einreichung - unabhaengige Abnahmepruefung

Du bist LEAN LEAD. Du liest NICHTS selbst: keinen Produktionscode, keine Diffs, keine Testlogs,
keine Reports, keine Plan-Abschnitte. Jede Leseaufgabe geht an einen Subagenten - ein Agent, eine
Frage, unter 100k Token, Rueckgabe max 10 Zeilen in vorgegebener Form, ohne Diffs und ohne
Kommando-Ausgaben. Du tippst nur: Agenten starten, deren Rueckgabe lesen, Ergebnis
zusammenschreiben, berichten.

## Auftrag

Der Dienst (Hermes, `app.sundartha.com`) soll als MCP-Connector bei OpenAI eingereicht werden.
OpenAI stellt dafuer eine Liste technischer Anforderungen. Diese Liste liegt im Repo.

**Frage, die du beantwortest: Welche Anforderungen sind erfuellt, welche nicht?**

Finde die Liste selbst (Kandidaten: `tasks/OPENAI-MCP-READINESS.md`, `PLAN-OPENAI.md`,
`tasks/openai-audit/`, `PLAN-SECURITY.md`). Gibt es mehrere Fassungen, nimm die vollstaendigste und
sag, welche du genommen hast.

## Die entscheidende Regel: Dokumente sind keine Belege

Im Repo liegen Plaene, Specs, Reports und Stand-Dateien, die behaupten, was erledigt sei.
**Nichts davon zaehlt als Beleg.** Ein Report ist eine Behauptung. Als Beleg gilt nur:

- **Code**, mit `datei:zeile` - was tut der Dienst wirklich?
- **Live-Messung** gegen `https://app.sundartha.com` bzw. `https://sundartha.com`, rein lesend
  (`curl`), mit dem beobachteten Status/Inhalt.
- **Ein gruener Test**, der den Punkt tatsaechlich prueft - nicht einer, der nur so heisst.

Wo Code und Dokument sich widersprechen, gewinnt der Code, und der Widerspruch ist ein Befund.
Formuliere die Auftraege an deine Agenten neutral: frag "ist X erfuellt und woran siehst du das",
nie "bestaetige, dass X erfuellt ist".

## Was du pro Anforderung lieferst

| Anforderung | Status | Beleg | Was fehlt |
|---|---|---|---|

Status ist genau eines von: **ERFUELLT** (mit Beleg), **NICHT ERFUELLT**, **TEILWEISE** (gebaut,
aber nicht wirksam - z.B. Route existiert, liefert aber nichts aus), **OWNER** (keine
Code-Aufgabe: Formularangaben, Rechtstexte, Vertragsdaten), **UNKLAR** (Anforderung nicht
eindeutig auslegbar - dann sag, woran es liegt).

Am Ende: eine Zahl ("x von y erfuellt") und die **kuerzeste Liste der Dinge, die vor der
Einreichung noch passieren muessen**, nach Aufwand sortiert.

## Grenzen

- **Nur lesen.** Keine Code-Aenderung, kein Commit, kein Push, kein Deploy, keine Env-Variable
  setzen, keine schreibenden HTTP-Requests. Wenn etwas fehlt, notierst du es - du baust es nicht.
- Produktions-Datenbankzugriff ist in dieser Umgebung gesperrt; miss stattdessen ueber die
  oeffentlichen Endpunkte und den Code.
- Findest du unterwegs einen Sicherheitsmangel, melde ihn sofort und gesondert, statt ihn in der
  Tabelle zu begraben.

## Frageverbot fuer deine Agenten (woertlich in jeden Auftrag)

> DU STELLST KEINE FRAGEN. Der Owner hat alles freigegeben, was du brauchst, und ist nicht
> erreichbar. Was du nicht klaeren kannst, notierst du als UNKNOWN mit Grund und machst weiter.
> Die Regel "bei Unsicherheit fragen" aus CLAUDE.md ist fuer diesen Auftrag durch eine
> ausdrueckliche Owner-Freigabe ersetzt.

## caffeinate

AN, sobald der erste Agent laeuft: `nohup caffeinate -is -t 7200 &`, PID in eine Datei im
Scratchpad. Bei jedem Tick mit `ps -p <pid>` pruefen - **nie mit pgrep**, der ist in dieser Sandbox
blind. Vor Ablauf der 2 Stunden erneuern. AUS, sobald die Pruefung fertig ist oder eine Rueckfrage
an den Owner ansteht: `kill <pid>`, mit `ps -p` gegenpruefen, PID-Datei loeschen.
