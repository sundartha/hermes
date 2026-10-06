# Runbook: Aenderungen an der MCP-Oberflaeche

Internes Betriebsdokument. Es regelt, wie Werkzeuge, Schemata, Annotations,
securitySchemes und Widget-URIs des Hermes-MCP-Servers geaendert werden - vor und
nach der Veroeffentlichung als OpenAI-Plugin. Der Vertrag friert nichts ein: jede
Aenderung ist erlaubt, wenn sie als geregelter Vorgang laeuft.

Bestandteile:

- `docs/mcp-vertrag.json` - der Vertrag: die am echten Draht gemessenen Merkmale je
  Konfigurationsprofil plus eine Aenderungskette.
- `test/mcp-kompatibilitaetsvertrag.test.js` - misst `tools/list`, `resources/list` und
  `resources/read` ueber HTTP `/mcp` und stdio und vergleicht mit dem Vertrag.
- `test/mcp-vertrag-pruefung.js` - die reine Pruef-Logik (Klassifikation, Kette,
  geschuetzte Widget-URIs, Sperre nach der Veroeffentlichung).
- `test/mcp-draht-pfade.js` - der Draht-Harness (startet Server bzw. stdio-Prozess).

## 1. Zweck und Geltung

Der Vertrag sichert die Merkmale, auf die sich ein Host nach dem Einlesen der
Werkzeugliste verlaesst:

| Merkmal | Wo im Vertrag |
|---|---|
| Werkzeugnamen je Profil | `profile.<id>.werkzeuge` |
| Eingabe-Gerippe: jedes Schema-Schluesselwort ausser reinem Text (`description`, `title`, `$schema`, `examples`), also Typen, Pflichtfelder, `additionalProperties`, `enum`, `anyOf`, `allOf`, `oneOf`, Constraints und jedes weitere Schluesselwort | `werkzeuge.<name>.eingabe` |
| Ausgabe-Gerippe (`outputSchema`), `null` = kein outputSchema | `werkzeuge.<name>.ausgabe` |
| Annotation-Hints `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` | `werkzeuge.<name>.hinweise` |
| `execution` | `werkzeuge.<name>.ausfuehrung` |
| `securitySchemes` je Werkzeug | `profile.<id>.sicherheitsschemata` |
| Widget-URI je Werkzeug (`_meta.ui.resourceUri`) | `profile.<id>.widgets` |
| Resource-URIs samt mimeType aus `resources/list` | `profile.<id>.ressourcen` |

NICHT Teil des Vertrags (bewusst, weil sie kein Kompatibilitaetsmerkmal sind):
Beschreibungen, Titel, server-instructions, `_meta`-Texte (z.B. die
Aufruf-Statuszeilen), CSP und `ui.domain` der Widgets, der Inhalt von
Werkzeug-Ergebnissen. Was davon anderswo gepinnt ist: die Annotations
(`test/mcp-tool-annotations.test.js`), die Texte von `place_call`
(`test/openai-t2-16-place-call-texte.test.js`) und der Kern der server-instructions
(`test/openai-t2-17-instructions-kern.test.js`). Die Code-Verweise der Inventar-Doku
(`docs/OPENAI-TOOL-INVENTORY.md`) zeigen auf Namen (`datei#name`), nicht auf Zeilen; Titel,
Annotationen und Werkzeugmengen dort prueft kein Test mehr gegen den Draht. Die Beschreibungen von
`get_call_status` und `list_action_items` pinnt der Byte-Snapshot des vollen Drahts
(`tools/list`, `resources/list`, jedes `resources/read`, mit `MCP_UI_ENABLED`) in
`test/openai-p8-widget-ui.test.js`, je ein Fall fuer HTTP und stdio. Den Text von
`get_call_status` zitiert ausserdem `docs/OPENAI-POLICY-ABGLEICH.md` ("duration and the
last transcript lines"); `test/openai-policy-abgleich-doku.test.js` prueft, dass jedes
Werkzeug-Zitat dort woertlich im echten `tools/list` steht. Fuer jede Beschreibung gelten
zudem die Form-Waechter in `test/p15-mcp-tool-descriptions-en.test.js` (kein deutscher
Text, Grossschreib-Marker je Beschreibung nach Anzahl und Reihenfolge gepinnt). Gemessen:
eine Umformulierung des `get_call_status`-Textes ohne das zitierte Stueck macht die beiden
Byte-Snapshot-Faelle und den Policy-Abgleich rot, ein zusaetzlicher Grossschreib-Marker
auch den Emphase-Waechter. CSP-Angaben prueft OpenAI zwar mit der
Werkzeugdefinition (Abschnitt 2), sie aendern aber nicht, wie ein Host ein Werkzeug
aufruft.

Der Vertrag hier ist damit ENGER als das, was OpenAI als veroeffentlichten Vertrag
behandelt: OpenAI vergleicht die Werkzeuge "with the published definitions, including
their descriptions, schemas, and annotations." (Abschnitt 2). Ein gruener Vertragstest
belegt deshalb nicht, dass eine Aenderung "the published contract" wahrt - siehe die
Zuordnung in Abschnitt 3.

Die Profile im Vertrag sind Test-Konfigurationen, keine Produktionswerte. Welche
Kombination live gilt, bestimmen die Werte im Hosting-Dashboard; der Abgleich
geschieht im ChatGPT Developer Mode (Abschnitt 5).

## 2. Was OpenAI verlangt (woertlich, abgerufen am 2026-09-27)

Aus https://developers.openai.com/plugins/deploy/app-review:

- "Treat the metadata exposed by your MCP server as a versioned API contract for the plugin."
- "After publication, continuous review updates tool definitions without requiring a new plugin version."
- "OpenAI periodically fetches your MCP server's tools and compares them with the published definitions, including their descriptions, schemas, and annotations."
- Geloeschte Werkzeuge: "Removed from the published tool list as soon as a scan detects the deletion, without waiting for automated checks."
- Neue Werkzeuge: "Made available after they pass automated checks. Until then, they aren't available to users."
- Geaenderte Werkzeuge: "The previous definition stays live until the updated definition passes automated checks or a scan detects that you removed the tool." "Passing updates replace the previous definition automatically."
- "Each tool can pass independently."
- "Keep your server compatible with the live definition while an update is held."
- "OpenAI retains the definition, not a copy of your server implementation."
- "An incomplete check doesn't approve an update, even if it has no findings."
- "Server changes take effect before a scan can discover or approve them. Keep existing input schemas and each published UI resource URI working during that gap. If a deployment breaks the live contract, roll back the server change rather than waiting for review."
- "To change submitted plugin information or imported skills, create a new draft version of the existing plugin and resubmit it for review. Continuous tool review doesn't replace this process."
- "only one version may be published at a time and only one version may be in review at a time."
- "The MCP server origin (`scheme`, `hostname`, or `port`) can't change between versions."
- Zu Annotations vor der Einreichung: "deploy the change, select **Scan Tools** again, verify the updated value, and then submit."

Tabelle "Other changes" derselben Seite (Zeilen woertlich, Spalten: Aenderung /
verlangte Handlung / wann Nutzer sie sehen):

| Aenderung | Handlung | Wirksam |
|---|---|---|
| "Tool security schemes, tool `_meta` fields, UI resource references, or linked resource metadata, including content security policy (CSP) settings" | "Deploy the change. These fields are reviewed with the tool definition through continuous review." | "After the updated tool definition passes automated checks." |
| "MCP server `instructions`" | "Deploy the change. Shared instructions are reviewed with the affected tools." | "After the required checks complete without holding existing tool updates or finding issues in the instructions." |
| "Backward-compatible content update served from the same published UI resource URI" | "Deploy the content update. You don't need to scan, submit, or publish a new version if the URI and published contract remain compatible." | "After deployment. ChatGPT may continue serving cached resource contents for up to one hour." |
| "Server-only fix or change to live tool results, including result `_meta`, or business data" | "Deploy the server change. You don't need to scan, submit, or publish a new version if the change preserves the published contract." | "Through your live endpoint after deployment." |
| "MCP server origin (`scheme`, `hostname`, or `port`)" | "To change the origin, create a new plugin, then complete its scan, submission, review, and publication flow. To change only the endpoint path, use the normal new-version flow." | "After you publish the new plugin or approved version." |

Aus https://developers.openai.com/plugins/build/mcp-server:

- "Keep published tool names and schemas backward compatible. Add fields or tools without breaking existing contracts. If metadata changes, refresh the developer-mode connection and rerun the evaluation set before submission."
- "For optional UI, version resource identifiers when HTML, JavaScript, or CSS changes in a way that could break a cached component."

Alles, was hier nicht zitiert ist, regelt die Primaerquelle nicht - siehe Abschnitt 9.

<a id="additive-aenderung"></a>

## 3. Aenderungsklassen

Die Klassifikation (`klassifiziere` in `test/mcp-vertrag-pruefung.js`) ist
fail-closed: additiv ist NUR, was in der ersten Tabelle steht. Alles andere ist ein
Bruch - auch Aenderungen, die fachlich harmlos wirken (z.B. ein erweitertes `enum`).
Dasselbe gilt fuer das Gerippe selbst: jedes Schema-Schluesselwort ausser reinem Text
(`description`, `title`, `$schema`, `examples`) wird verglichen, auch eines, das der
Server heute nicht verwendet (z.B. `allOf`, `oneOf`, `$ref`, `propertyNames`). Kommt
eines hinzu, faellt eines weg oder aendert sich eines, ist das ein Bruch.

Additiv (ein alter Aufrufer funktioniert unveraendert weiter):

| Aenderung | Warum additiv |
|---|---|
| neues Werkzeug | alte Aufrufe beruehrt es nicht |
| neue optionale Eingabe-Eigenschaft | alte Aufrufe senden sie nicht |
| neue Ausgabe-Eigenschaft (auch als Pflichtfeld der Ausgabe), NUR wenn das alte Ausgabe-Objekt, an dem sie hinzukommt, weitere Eigenschaften zulaesst (`additionalProperties` fehlt oder ist `true`) | wer das Ergebnis gegen die alte Definition prueft, laesst weitere Eigenschaften zu |
| neues `outputSchema`, wo keins war | bisher gab es kein Ausgabe-Versprechen |
| neue Resource-URI | niemand verweist bisher darauf |

<a id="bruch"></a>

Bruch (ein alter Aufrufer oder eine gehaltene Definition kann scheitern):

| Aenderung | Warum Bruch |
|---|---|
| Werkzeug entfernt oder umbenannt | Umbenennen = Entfernen + neues Werkzeug |
| neues Pflichtfeld in der Eingabe; bestehendes Feld wird Pflicht | alte Aufrufe ohne das Feld werden abgelehnt |
| Eingabe-Eigenschaft entfernt | bei `additionalProperties: false` wird ein alter Aufrufer, der sie sendet, abgelehnt |
| Pflicht an der Eingabe aufgehoben | fail-closed: nicht in der Additiv-Liste |
| Typ-, `enum`-, `anyOf`-, Constraint- oder `additionalProperties`-Aenderung | Schema-Vertrag geaendert |
| Ausgabefeld entfernt oder nicht mehr Pflicht; Ausgabe-Typwechsel; `outputSchema` entfernt | Leser verlassen sich auf das Feld |
| neue Ausgabe-Eigenschaft an einem Objekt mit `additionalProperties: false` (oder, fail-closed, einem anderen Wert als `true`) | ein Client, der das Ergebnis gegen die gehaltene alte Definition prueft, lehnt die unbekannte Eigenschaft ab (der MCP-SDK-Client prueft `structuredContent` gegen das `outputSchema` aus `tools/list`). Heute tragen alle 10 Werkzeuge mit `outputSchema` auf oberster Ebene `additionalProperties: false` |
| Annotation-Hint oder `execution` geaendert | aendert, wie der Host das Werkzeug behandelt |
| `securitySchemes` geaendert | aendert den Auth-Vertrag |
| Widget-URI geaendert oder entfernt; Resource-URI entfernt; mimeType geaendert | siehe Abschnitt 7 |

Zuordnung zur OpenAI-Tabelle (Abschnitt 2):

- Inhalt eines Ergebnisses aendert sich bei gleichem Schema (z.B. andere Texte in
  einem Ergebnis-Feld, weniger Transkriptzeilen im Ergebnis): der Vertragstest bleibt
  gruen. Ohne Scan deploybar ist das laut OpenAI aber nur unter einer Bedingung -
  Tabellenzeile "Server-only fix or change to live tool results, including result
  `_meta`, or business data": "Deploy the server change. You don't need to scan,
  submit, or publish a new version if the change preserves the published contract."
  (https://developers.openai.com/plugins/deploy/app-review). Was "published contract"
  umfasst, definiert die Quelle nicht eigens; sie nennt die Metadaten "a versioned API
  contract", und die veroeffentlichte Definition schliesst die Beschreibung ein
  (Abschnitt 1). Vor dem Deploy deshalb pruefen, ob das neue Ergebnis noch zu
  Beschreibung und Titel des Werkzeugs passt. Beispiel:
  `get_call_status` liefert nach Anrufende keine Transkriptzeilen mehr, das Feld
  `last_transcript_lines` bleibt im Schema. Die Beschreibung (Registrierung von
  `get_call_status` in `src/mcp-tools.js`) verspricht "duration and the last
  transcript lines". Passt das neue Ergebnis nicht mehr dazu, wahrt die Aenderung den
  veroeffentlichten Vertrag nicht und ist keine reine Server-Aenderung: dann wird die
  Beschreibung mitgeaendert, und es gilt der Punkt "Beschreibung oder Titel aendern
  sich" (Messung vorher und nachher).
- Ein Ausgabefeld verschwindet ganz (z.B. ein Feld mit Transkriptzeilen wird aus dem
  `outputSchema` entfernt): Bruch, der Vertragstest wird rot mit "Ausgabefeld
  entfernt". Das ist eine Aenderung der Werkzeugdefinition (Zitat "Changed tools" in
  Abschnitt 2), keine reine Ergebnis-Aenderung.
- Beschreibung oder Titel aendern sich: kein Befund im Vertragstest, fuer OpenAI aber
  eine geaenderte Werkzeugdefinition (Zitat "Changed tools" in Abschnitt 2; OpenAI
  vergleicht "descriptions, schemas, and annotations"). Vorher und nachher mit dem
  Briefing-Bench messen (`scripts/briefing-bench/README.md`, Abschnitt
  "Deploy-Vorbedingung: echte Messung alt gegen neu"; Aufruf ueber
  `scripts/briefing-bench/lauf.mjs`). Rot werden die in Abschnitt 1 genannten Tests,
  die diesen Text pinnen oder zitieren: bei `get_call_status` die beiden
  Byte-Snapshot-Faelle in `test/openai-p8-widget-ui.test.js` und der Policy-Abgleich
  (`test/openai-policy-abgleich-doku.test.js`, Zitat in
  `docs/OPENAI-POLICY-ABGLEICH.md`), bei `list_action_items` die beiden
  Byte-Snapshot-Faelle; kommen Grossschreib-Marker hinzu oder fallen weg, zusaetzlich
  `test/p15-mcp-tool-descriptions-en.test.js`. Sie werden bewusst nachgezogen, das Zitat
  in der Policy-Doku mit.
- server-instructions aendern sich: kein Befund im Vertragstest; OpenAI prueft sie mit
  den betroffenen Werkzeugen (Tabellenzeile "MCP server `instructions`").

<a id="ablauf-bei-rot"></a>

## 4. Ablauf bei rotem Vertragstest

1. Meldung lesen. Jede Zeile nennt Klasse (`bruch` oder `additiv`), Merkmal,
   Profil/Werkzeug und den zustaendigen Abschnitt dieses Runbooks.
2. Pruefen, ob die Aenderung gewollt ist. Ungewollt: Code korrigieren, nicht den
   Vertrag.
3. Gewollt: Brueche nur, wenn eine Anforderung sie verlangt (Abschnitt 5 bzw. 6), und
   dann mit ALLEN Aufrufern, Tests, Beschreibungen und Doku nachgezogen.
4. Ist-Stand uebernehmen: der Test schreibt ihn nach `os.tmpdir()`, Dateiname
   `mcp-vertrag-ist-gesamt.json` (alle Profile) bzw. `mcp-vertrag-ist-<profil>.json`
   (ein Profil). `profile` und `werkzeuge` aus der Gesamt-Datei in
   `docs/mcp-vertrag.json` uebernehmen - nie von Hand abtippen.
5. Einen Eintrag an `aenderungen` anhaengen: `datum` (JJJJ-MM-TT), `art` (`additiv`
   oder `bruch` - gibt es mindestens einen Bruch, ist es `bruch`), `begruendung`
   (welche Anforderung, was sich aendert; mindestens 40 Zeichen), `stand_sha256` aus
   der Gesamt-Datei. Bestehende Eintraege nie aendern, nie entfernen und nie durch eine
   neue Erstfassung ersetzen - auch nicht ihren `stand_sha256`: der Test verlangt, dass
   die Kette jedes committeten Stands von `docs/mcp-vertrag.json` unveraendert am
   Anfang der aktuellen Kette steht (Meldung "nur anhaengen" bzw. "nie entfernen"),
   ohne Ausnahme. Der Test verlangt ausserdem: letzter Hash = Stand der Datei; zwei
   aufeinanderfolgende Eintraege nie mit demselben Hash; `art` passend zur
   Klassifikation des Eintrags gegen seinen Vorgaenger. Den Vorgaengerstand sucht er
   ueber den Hash in der Git-Historie von `docs/mcp-vertrag.json`; deshalb je
   Ketteneintrag ein Commit - zwei neue Eintraege in einem Commit sind ein Befund
   ("nicht auffindbar"), ebenso ein Checkout ohne Historie.
6. Test erneut: `NODE_ENV=test node --test test/mcp-kompatibilitaetsvertrag.test.js`.
7. Danach die volle Suite (`npm test`).

Ein neues Konfigurationsprofil (z.B. ein weiterer Live-Schalter, der die Werkzeugliste
aendert) gehoert zuerst in die Profil-Liste des Vertragstests, dann per Ist-Stand in
den Vertrag - Meldung "Profil nicht im Vertrag". Die Klassifikation stuft ein neues
Profil fail-closed als `bruch` ein; der Ketteneintrag traegt dann `art` `bruch`.

## 5. Vor der Veroeffentlichung

Brueche sind zulaessig, wenn eine Anforderung sie verlangt - immer mit
Ketten-Eintrag und mit allen Aufrufern, Tests und Doku. Nach einer Aenderung der
Werkzeugliste:

- Im OpenAI-Dashboard die Werkzeuge erneut einlesen (Zitat zu Annotations in
  Abschnitt 2: "deploy the change, select **Scan Tools** again, verify the updated
  value, and then submit.").
- Die Developer-Mode-Verbindung aktualisieren und die Auswertung wiederholen (Zitat
  "If metadata changes, refresh the developer-mode connection and rerun the
  evaluation set before submission.").
- Im Developer Mode Werkzeugnamen, Pflichtfelder und Widget-URIs mit dem passenden
  Profil in `docs/mcp-vertrag.json` vergleichen (bei OAuth mit UI:
  `http-oauth-consult-ui` mit Consult, `http-oauth-ui` ohne). Stimmt kein Profil,
  ist die Live-Konfiguration ein Pfad, den der Vertrag nicht abdeckt: Profil
  ergaenzen.

Bei der Einreichung den `stand_sha256` des letzten Ketteneintrags notieren: das ist
der Stand, den OpenAI prueft. Wird er veroeffentlicht, in `docs/mcp-vertrag.json`
`veroeffentlichung` auf `{ "datum": "JJJJ-MM-TT", "stand_sha256": "<dieser Hash>" }`
setzen und einzeln committen - ab dann gilt die Sperre aus Abschnitt 6.
`veroeffentlichte_widget_uris` bleibt dabei leer: eine URI kommt erst hinein, wenn eine
spaetere Aenderung sie verdraengt (Abschnitt 7).

## 6. Nach der Veroeffentlichung: gehaltene Updates

Nach der Veroeffentlichung gilt: die bisherige Definition bleibt live, bis die neue
die automatischen Pruefungen besteht ("The previous definition stays live until the
updated definition passes automated checks ..."); der Server muss so lange zu ihr
passen ("Keep your server compatible with the live definition while an update is
held."). Server-Aenderungen wirken sofort, die Pruefung kommt spaeter, und fuer diese
Luecke verlangt die Quelle: "Server changes take effect before a scan can discover or
approve them. Keep existing input schemas and each published UI resource URI working
during that gap."

Daraus folgt fuer ein veroeffentlichtes Werkzeug:

- Kein neues Pflichtfeld, keine entfernte Eingabe-Eigenschaft, kein Typwechsel: die
  gehaltene alte Definition schickte sonst Aufrufe, die der Server ablehnt.
- Keine neue Ausgabe-Eigenschaft an einem Objekt mit `additionalProperties: false`: ein
  Client, der gegen die gehaltene alte Definition prueft, lehnte das Ergebnis ab.
- Kein Entfernen und kein Umbenennen: OpenAI traegt ein entferntes Werkzeug zwar beim
  naechsten Scan aus ("Removed from the published tool list as soon as a scan detects
  the deletion ..."), bis dahin ist es aber veroeffentlicht, und sein Eingabeschema
  funktionierte nicht mehr. Ein Weg, ein Werkzeug aus der Liste zu nehmen und seine
  Aufrufe bis zum Scan weiter zu bedienen, ist heute nicht gebaut; vor dem ersten
  Entfernen eines veroeffentlichten Werkzeugs muss er entschieden und gebaut werden.
- Statt dessen additiv: neues Werkzeug bzw. neue optionale Eingabe-Eigenschaft. Ein neues
  Werkzeug ist erst nach bestandener Pruefung verfuegbar ("Made available after they
  pass automated checks.").
- Bricht ein Deploy den Live-Vertrag: zurueckrollen, nicht auf die Pruefung warten
  ("If a deployment breaks the live contract, roll back the server change rather than
  waiting for review.").
- Aenderungen am Ergebnis-Inhalt bei gleichem Schema brauchen nur dann keinen neuen
  Scan, wenn sie den veroeffentlichten Vertrag wahren ("if the change preserves the
  published contract.", Tabellenzeile "Server-only fix ..." in Abschnitt 2) - also auch
  zur veroeffentlichten Beschreibung passen (Beispiel und Vorgehen in Abschnitt 3).
  Sonst ist es eine geaenderte Werkzeugdefinition.

<a id="sperre"></a>

Technische Sperre: `veroeffentlichung` in `docs/mcp-vertrag.json` ist `null`, solange
OpenAI keinen Stand veroeffentlicht hat. Bei der Veroeffentlichung wird sie auf
`{ "datum": ..., "stand_sha256": ... }` gesetzt - den Hash des Ketteneintrags, dessen
Stand eingereicht und freigegeben wurde. Ab dann vergleicht der Vertragstest den
aktuellen Vertrag (und damit den Draht) mit diesem Stand und wird rot bei jedem Bruch -
auch wenn er sich ueber mehrere Ketteneintraege verteilt (Meldung "gesperrt nach der
Veroeffentlichung"). Ein Ketteneintrag legitimiert keinen Bruch. Durchgelassen wird
genau einer: eine verdraengte Widget- bzw. Resource-URI, wenn die alte URI in
`veroeffentlichte_widget_uris` steht (Abschnitt 7) - dann verlangt der Draht-Test, dass
sie per `resources/read` lesbar bleibt, sie funktioniert also weiter.

Gesperrt sind damit u.a. ein entferntes oder umbenanntes Werkzeug, ein neues
Pflichtfeld, eine entfernte Eingabe-Eigenschaft, ein Typwechsel, jeder Bruch am
Ausgabe-Gerippe (auch eine neue Ausgabe-Eigenschaft bei `additionalProperties: false`),
geaenderte Annotation-Hints, eine geaenderte `execution`-Angabe und geaenderte
`securitySchemes`.

Die Marke steht fuer EINEN Stand, den ganzen Stand aller Werkzeuge - eine Freigabe je
Werkzeug kennt der Vertrag nicht, obwohl OpenAI Werkzeuge einzeln freigibt ("Each tool
can pass independently."). Sie wandert nur vorwaerts (zurueckgesetzt oder entfernt wird
sie nie, der Test vergleicht mit jedem committeten Stand) und rueckt erst vor, wenn
OpenAI den ganzen neuen Stand live haelt, also jede darin geaenderte Werkzeugdefinition
die Pruefung bestanden hat. Solange nur ein Teil bestanden hat, bleibt sie stehen.

Was die Sperre damit erzwingt und was nicht:

- Erzwungen: jeder Stand bleibt zum Stand der Marke kompatibel - nichts, was dort steht,
  wird entfernt oder verschaerft.
- NICHT erzwungen: Zwischenstaende, die nie Stand der Marke waren. Kommt nach der
  Veroeffentlichung ein Werkzeug oder eine optionale Eingabe-Eigenschaft hinzu und
  faellt vor dem naechsten Vorruecken der Marke wieder weg, bleiben Kette und Sperre
  gruen, denn der Stand der Marke kannte beides nicht. OpenAI kann das neue Werkzeug
  bzw. die geaenderte Definition aber schon einzeln freigegeben haben ("Each tool can
  pass independently."); dann gehoert es zur live gehaltenen Definition, und das
  Entfernen verletzt "Keep your server compatible with the live definition while an
  update is held."

Das ist eine bewusste Grenze des Tests, keine Vereinbarkeit mit der Quelle: welche
Werkzeuge OpenAI einzeln freigegeben hat, kennt der Vertrag nicht, er haelt nur ganze
Staende fest. Als Vorgang gilt deshalb: was nach der Veroeffentlichung deployt wurde,
wird behandelt, als waere es schon live - nicht wieder entfernen und nicht verschaerfen
(Regeln oben), auch wenn der Test es zuliesse.

Ausserdem erzwingt der Test: die Marke darf nur auf einen Stand vorruecken, der vorher
schon unter der bisherigen Marke committet war und dort die Sperre bestanden hat
(Meldung "war nie unter der bisherigen Marke committet"). Ein Bruch laesst sich also
auch nicht dadurch legitimieren, dass die Marke auf ihn gesetzt wird. Die erste Marke
setzt den Ausgangsstand und braucht keinen solchen Vorlauf.

<a id="widget-uris"></a>

## 7. Widget-URIs nach der Veroeffentlichung

Was OpenAI fuer die Zeit zwischen Deploy und Pruefung verlangt: "Server changes take
effect before a scan can discover or approve them. Keep existing input schemas and each
published UI resource URI working during that gap." Eine geaenderte Widget-URI ist eine
geaenderte "UI resource reference" und wird mit der Werkzeugdefinition geprueft
(Tabellenzeile in Abschnitt 2); bis dahin verweist die live gehaltene Definition auf die
ALTE URI. Die Luecke endet fuer ein Werkzeug, sobald seine neue Definition die Pruefung
besteht oder ein Scan es als entfernt erkennt ("The previous definition stays live until
the updated definition passes automated checks or a scan detects that you removed the
tool. Passing updates replace the previous definition automatically.").

Geschuetzt werden muessen also NUR veroeffentlichte URIs und nur fuer diese Luecke. Vor der
Veroeffentlichung ist nichts veroeffentlicht: `veroeffentlichte_widget_uris` in
`docs/mcp-vertrag.json` ist leer.

Der Vertragstest erzwingt:

- Jede gelistete URI ist eine Widget- oder Resource-URI des veroeffentlichten Stands
  (`veroeffentlichung`, Abschnitt 6). Ohne Veroeffentlichung ist die Liste leer.
- Nach der Veroeffentlichung laesst die Sperre (Abschnitt 6) eine verdraengte Widget-
  oder Resource-URI des veroeffentlichten Stands nur durch, wenn sie gelistet ist.
- Jede gelistete URI ist auf jedem UI-Profil (HTTP Legacy, OAuth mit und ohne Consult
  bzw. Mandant, stdio) per `resources/read` lesbar und liefert genau die gepinnten Bytes
  ihrer Version (Pin in `src/ui/widget-versions.json`; der Pin einer gelisteten Version
  bleibt deshalb stehen).
- Unabhaengig davon ist jede referenzierte und jede gelistete URI lesbar.

Heutiger Code-Stand: der Server liefert je Widget nur die aktuelle Version aus. Die URI
traegt die Version (`ui://hermes/<widget>/v<version>.html`, `uiResourceUri` in
`src/ui/contract.js`), die aktuelle Version ist die hoechste in
`src/ui/widget-versions.json` (`widgetVersion` in `src/ui/widget-catalog.js`); eine
aeltere URI ist nach einem Versionssprung nicht mehr lesbar. Solange nichts
veroeffentlicht ist, genuegt das. Der erste Versionssprung eines Widgets, dessen URI der
veroeffentlichte Stand nennt, macht den Vertragstest rot (erst die Sperre, nach dem
Eintragen in die Liste die Lesbarkeit) - spaetestens dann muss das Weiter-Ausliefern der
alten Fassung gebaut werden.

Ablauf bei einer Widget-Aenderung nach der Veroeffentlichung:

1. HTML aendern, neue Version in `src/ui/widget-versions.json` anhaengen (Regel im Kopf
   der Datei).
2. Vertrag nach Abschnitt 4 nachziehen (die verdraengte URI ist ein `bruch`-Eintrag).
3. Die verdraengte URI an `veroeffentlichte_widget_uris` anhaengen; der Server muss sie
   mit den gepinnten Bytes ihrer Version weiter ausliefern, bis der Draht-Test gruen ist.

Wieder entfernen: sobald jede veroeffentlichte Werkzeugdefinition, die auf die alte URI
verwies, durch ihre neue Definition ersetzt ist (Zitat oben), `veroeffentlichung` auf
den dann live gehaltenen Stand vorruecken (Abschnitt 6, samt Vorlauf) und die
URI aus der Liste nehmen - der Test verlangt das, weil sie keine URI des veroeffentlichten
Stands mehr ist. Ab dann verlangt der Vertrag nicht mehr, dass sie lesbar bleibt.

Cache: "ChatGPT may continue serving cached resource contents for up to one hour." (aus
der Tabellenzeile "Backward-compatible content update ...", also fuer Inhalte unter
derselben URI).

Offen: `src/ui/widget-versions.json` verlangt fuer JEDE Aenderung des ausgelieferten
HTML eine neue Version. OpenAI verlangt das nur "when HTML, JavaScript, or CSS changes
in a way that could break a cached component"; ein rein kompatibles Inhalts-Update
unter derselben URI braucht laut OpenAI keinen neuen Scan (Tabellenzeile
"Backward-compatible content update ..."). Nach der Veroeffentlichung macht die
strengere Regel der Pin-Datei jede Widget-Aenderung zu einer verdraengten URI, die
waehrend der Luecke weiter ausgeliefert werden muss.

## 8. Was einen neuen Plugin- oder Versionsvorgang braucht

- Origin (Schema, Host, Port) aendern: neues Plugin ("To change the origin, create a
  new plugin, then complete its scan, submission, review, and publication flow."). Nur
  der Endpunkt-Pfad: normaler Versionsvorgang ("To change only the endpoint path, use
  the normal new-version flow.").
- Eingereichte Plugin-Angaben oder importierte Skills: neue Version und erneute
  Einreichung ("Continuous tool review doesn't replace this process.").
- Es gibt je MCP-Integration hoechstens eine veroeffentlichte und eine in Pruefung
  befindliche Version ("only one version may be published at a time and only one
  version may be in review at a time.").

## 9. UNKNOWN - in der Primaerquelle nicht geregelt

- Wie lange ein gehaltenes Update gehalten wird und ob es verfaellt: nicht geregelt.
- Welche "automated checks" laufen und was sie pruefen: nicht geregelt.
- Ob ein Bruch am `outputSchema` anders behandelt wird als am `inputSchema`: nicht
  geregelt (die Quelle sagt nur "schemas").
- Ob eine geaenderte `securitySchemes`-Angabe bis zur Pruefung gehalten wird: die
  Quelle sagt nur "reviewed with the tool definition through continuous review" und
  "After the updated tool definition passes automated checks." - ob der Server
  waehrend des Haltens beide Auth-Formen bedienen muss, ist nicht geregelt.
- Ob OpenAI eine entfernte Resource-URI erkennt oder nur Werkzeugdefinitionen
  vergleicht: nicht geregelt.
- Ob ein umbenanntes Werkzeug als Loeschung plus neues Werkzeug gewertet wird: nicht
  ausdruecklich geregelt; der Vertrag behandelt es so (fail-closed).
- Woran man erkennt, dass eine gehaltene Aktualisierung die Pruefung bestanden hat (und
  die Marke `veroeffentlichung` vorruecken darf): nicht geregelt.
- Ob OpenAI zwischen Deploy und Scan noch Aufrufe an ein entferntes Werkzeug schickt: nicht
  geregelt; der Vertrag sperrt das Entfernen deshalb (Abschnitt 6).
- Ob ein Host eine verdraengte Widget-URI nach dem Ende der Luecke noch anfragt (z.B. fuer
  eine frueher gerenderte Karte): nicht geregelt.

## 10. Schalter, die die Werkzeugliste veraendern

| Schalter | Wirkung auf die Oberflaeche | Code-Stelle |
|---|---|---|
| `MCP_UI_ENABLED` (Default an, Tests pinnen aus in `test/helpers.js`) | an: Widget-URIs an fuenf Werkzeugen, vier Widget-Resources; aus: kein `_meta.ui`, `resources/list` antwortet "Method not found" | `src/config.js:1610` |
| `CONSULT_ENABLED` + `ASSISTANT_CONTEXT_ENABLED` + Profil `allowConsult` | alle drei: zwei zusaetzliche Werkzeuge (`await_call_event`, `answer_consult`), nur ueber HTTP | `src/consult/gate.js:19-25`, Aufruf `src/routes/mcp.js:232` |
| stdio-Transport | registriert die Consult-Werkzeuge nie (`consultAllowed` Default `false`) | `src/mcp-tools.js:1513`, `src/mcp-server.js` |
| `MCP_AUTH` | `oauth`: `securitySchemes` (oauth2) an jedem Werkzeug; leer/`token`: keine `securitySchemes`; `off` (nur lokale Demos, nicht im Vertrag gemessen): `noauth`; `oauth` mit gueltigem Token ohne Mandant: dieselbe Werkzeugliste mit Stub-Handlern, mit `MCP_UI_ENABLED` auch dieselben Widget-URIs und Resources (gemessen ohne Consult) | `src/config.js:2037`, `src/mcp-security-schemes.js`, `src/mcp-no-tenant.js` |

Profile im Vertrag (Test-Konfigurationen, alle mit `MCP_UI_ENABLED` aus, ausser `-ui`):

| Profil | Pfad |
|---|---|
| `http-legacy`, `http-legacy-consult`, `http-legacy-ui` | HTTP `/mcp` ohne `MCP_AUTH`, localhost |
| `http-token` | HTTP `/mcp` mit `MCP_AUTH=token`, gemessen ueber localhost mit Token; der Test belegt 401 ohne Token (lokal und ueber die Interface-IP) und 403 mit Token ueber die Interface-IP (kein Mandant) |
| `http-oauth`, `http-oauth-consult`, `http-oauth-consult-ui`, `http-oauth-ui`, `http-oauth-ohne-mandant`, `http-oauth-ohne-mandant-ui` | HTTP `/mcp` mit `MCP_AUTH=oauth` |
| `stdio`, `stdio-consult-env`, `stdio-ui` | `src/mcp-server.js` ueber stdio |
