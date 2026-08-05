# GQ-P16 — `endCallWait` benennt bei Inbound den falschen Gespraechspartner (de/fr)

## Warum (am Code belegt, Fragilitaets-Analyse F1)

`endCallWaitInstruction` (`src/claude.js:593-595`) bekommt den **vollen** Call und liest
genau ein Feld:

```js
export function endCallWaitInstruction(call) {
  return localeFor(call.language).prompt.turnControl.endCallWait;
}
```

`call.direction` wird nie referenziert. `grep -rn "endCallWaitInstruction" src/` liefert vier
Treffer (Definition, Import, zwei Aufrufer) — **kein** Zwischen-Leser mischt die Richtung
nachtraeglich ein. Die zwei Aufrufer sind genau der Turn, in dem entschieden wird, ob der
Agent auflegt oder wartet: `src/claude.js:1120` (Budget-Engine) und `src/bridge.js:393`
(Realtime-Bridge).

Der DE-Text (`src/i18n/prompts/de.js:241`):

> „Der Angerufene hat noch nichts gesagt. Lege nicht auf - warte auf seine Antwort."

„Der Angerufene" ist bei **Inbound** der Owner — und der ist gar nicht in der Leitung. In der
Leitung ist der **Anrufer**. FR traegt denselben Fehler (`fr.js:206`). **EN ist bereits
direction-neutral** (`en.js:208`: „The other person hasn't said anything yet.") — die noetige
Formulierung existiert also schon in einer Sprache.

Der Pfad ist erreichbar und das ausdruecklich: seit P3.3 unterdrueckt `shouldSuppressEndCall`
verfruehtes `end_call` **auch bei Inbound**; der frueher vorhandene Kurzschluss
`if (call.direction !== "outbound") return false` ist bewusst entfernt
(`src/claude.js:656-662`).

Der direkte Nachbar im selben Objekt zeigt, dass die Unterscheidung trivial moeglich ist —
`openingBootstrap` (`de.js:236-239`) verzweigt korrekt nach `outbound`/`inbound`. Zwei Zeilen
auseinander: eine verzweigt, die andere nicht.

## Aenderung

`endCallWait` in **de** und **fr** direction-neutral formulieren, Vorbild `en.js:208`. Reine
i18n-String-Aenderung: **keine Signatur-Aenderung, kein Eingriff an den zwei Aufrufern.**

Die strukturell sauberere Variante (Signatur nach `openingBootstrap`-Vorbild auf einen
Direction-Zweig umstellen) ist **nicht** Teil dieser Phase: sie schliesst denselben Defekt,
kostet aber zwei Call-Sites und eine breitere Testflaeche. Falls die Umsetzung beim Lesen zu
dem Schluss kommt, dass die neutrale Formulierung im Deutschen unnatuerlich wird, ist das ein
Befund fuer den Report — nicht der Anlass, still auf die grosse Variante zu wechseln.

Der neue Text muss weiterhin beides leisten: sagen, dass die Gegenseite noch nichts gesagt
hat, **und** anweisen, nicht aufzulegen. Gesprochene DE-Strings tragen korrekte Umlaute
(nur Kommentare/Bezeichner sind ASCII).

## Was diese Phase NICHT tut

- **`en.js` bleibt unangetastet** — es ist die Vorlage, nicht das Problem.
- `shouldSuppressEndCall`, `openingBootstrap`, `silentTurn` bleiben unveraendert.
- Keine Signatur-, keine Aufrufer-Aenderung.

## Verifikation — deterministisch

`npm test` gruen (Basis 3959). Neue Tests, offline:

1. `endCallWaitInstruction` mit `seedCall({ direction: "inbound" })` fuer **de** und **fr**:
   der Text benennt die Gegenseite nicht als „Angerufenen"/„appelée". **Heute laeuft kein
   einziger Test diesen Pfad mit `inbound`** — `seedCall()` setzt ausnahmslos
   `direction: "outbound"` (`test/helpers.js:513`, `:544`). Das ist die Blindstelle, die den
   Defekt getragen hat.
2. Derselbe Aufruf mit `direction: "outbound"` bleibt fachlich korrekt (der Text muss fuer
   **beide** Richtungen stimmen — das ist der Sinn von „neutral").
3. Die Anweisung „nicht auflegen, warten" ist in beiden Sprachen weiterhin enthalten.

**Zahl:** Tests, die `endCallWaitInstruction` mit `direction: "inbound"` durchlaufen. Heute
**0**, nach der Phase **>= 1 je Sprache**.

## Absolute Regeln

Keine. Reiner Prompt-Text; Offenlegungssatz, Gates, Auth und Kosten bleiben unberuehrt.
