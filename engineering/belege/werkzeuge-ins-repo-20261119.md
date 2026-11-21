# Bauwerkzeuge ins Hermes-Repo (Auftrag A-62B77A, Karte 7b5364ff), Stand 19.11.2026 23:15

## Ergebnis: angehalten, Befund und Vorschlag, noch kein PR
Die Dateizahl-Grenze (Wachstumsbremse) verhindert das Einchecken unter `tools/` ohne Vorarbeit. Ich habe sie nicht umgangen und nichts im Repo oder in `paket.sh` geändert.

## Inventar: was `paket.sh` wirklich braucht
Direkt in `paket.sh`: `app-umgebung.sh`, `app-token.sh` (auch `wache/github-wache.mjs`), `.bin/paket-push`, `.bin/paket-pr`, `.bin/paket-kommentar` (Zeilen 46-48).
Indirekt über `paket-push`: `.bin/paket-push-pruefen`, `.bin/paket-schwer-frei`, `.bin/paket-grenze` (von `paket-push-pruefen` aufgerufen). Gesamt: **8 Dateien**.
Von `paket.sh`, Wache, Hermes-Repo (CLAUDE.md, .claude, tools, .github) nicht referenziert: `paket-issue`, `paket-pruefer`, `.bin/claude`, `.bin/semgrep`, `app-sitzung.sh`, `fortsetzen.sh`, `vorbereiten.sh`, `sitzung-starten.sh` und die rund 230 Prompt-Dateien (Altbestand). Nicht ins Repo: `.bin/gitleaks` (21 MB Programm), `.bak`-Dateien, Schlüssel (liegt im Mac-Schlüsselbund, nie in den Skripten).
Lokales git des Mac: Wurzel ist `Agentic Calling MCP` (nicht pakete-prompts), 10 Dateien unter pakete-prompts getrackt (Commits da34e00, 10d5b3d), kein Remote.

## Randbedingung im Repo
`CLAUDE.md` Zeile 88 und `ci.yml` (`OBERGRENZE_BAUSYSTEM_DATEIEN: 65`): Dateien unter `tools/`, `.github/workflows/`, `.claude/hooks/` = **65 von 65** (52 + 7 + 6, gemessen 19.11. auf dem Mac-Checkout). Kein Spielraum, die Grenze darf nur sinken. 8 neue Dateien dort = rot. Ablage unter `scripts/` (96 Dateien, nicht gezählt) würde die Zählung nur umgehen, das mache ich nicht.
Beide Rechner haben denselben Checkout-Pfad `/Users/antonio/Mein Unternehmen/MCP/wt-steuerung` (Server: `/home/ubuntu/Mein Unternehmen/MCP/wt-steuerung`, `/Users/antonio` ist dort Verknüpfung nach `/home/ubuntu`). Der Pfad ist also schon gemeinsam; nur die Werkzeuge liegen noch in zwei verschiedenen Ordnern.

## Hash-Vergleich Mac / Server (sha256)
| Datei | Mac | Server | gleich |
|---|---|---|---|
| paket-kommentar | ac916a94… | ac916a94… | ja |
| paket-schwer-frei | 9b2cb8fa… | 9b2cb8fa… | ja |
| paket-push | e3baa250… | ec29c1cf… | nein |
| paket-pr | 50811598… | 07510497… | nein |
| paket-push-pruefen | da55967b… | f5b875c9… | nein |
| paket-grenze | 4188bab1… | 59755fdd… | nein |
| app-token.sh | 709aa850… | ea5e34d6… | nein |
| app-umgebung.sh | 56a6bd71… | b1343196… | nein |
Server-Kopie ist veraltet und Linux-angepasst (`*.mac-vor-linux` neben den Dateien). Zwei Stände existieren heute, genau was Antonio nicht will. Ein Linux/Mac-gemeinsamer Stand braucht Schalter (z. B. `stat -f` vs `stat -c`, `security`-Schlüsselbund vs. Schlüsseldatei, `/opt/homebrew` vs. PATH).

## Vorschlag (Entscheidung nötig, weil Grenze oder Obergrenze berührt)
Ich empfehle: **8 Dateien unter `tools/bau/`, Obergrenze bleibt 65, dafür 8 bestehende Dateien streichen.** Kandidaten wären Dateien aus `tools/`, die nach dem Umbau ersetzt sind; welche, entscheide ich nach Prüfsatz-Regel (jeder Fall bleibt rot). Alternativ kleiner: `paket-push-pruefen`, `paket-schwer-frei` und `paket-grenze` zu **einer** Datei zusammenlegen (3 → 1) und `app-token.sh` in `app-umgebung.sh` falten (2 → 1): dann 5 Dateien, also 5 alte weg. Danach: `paket.sh` zeigt auf `$REPO/tools/bau/`, alter Ordner per `/bin/mv` ins Archiv, Server und Mac nutzen denselben Checkout.
Offen: Ob die Werkzeuge sicherheitsrelevant (Hook-/Rechte-Schicht) genug sind, um nur per App-PR geändert zu werden; sie liegen dann unter Freigabe-Prüfung wie `tools/`.
Eine zusätzliche Möglichkeit ohne Dateien-Mehrung: Werkzeuge im bestehenden `tools/pruefen.mjs` als Unterbefehle (`pruefen.mjs push|pr|kommentar`), wäre aber ein größerer Umbau.

## PR
Keiner eröffnet. Hash-Vergleich und Plan stehen oben. Nächster Schritt nach Entscheidung: Brief an Bau-Agent (8 Dateien einchecken + ebenso viele alte streichen), `paket.sh`-Pfade mit Sicherung umstellen (`# LAGE-1115` erhalten).
