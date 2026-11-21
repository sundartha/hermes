# Server-Testbau 18.11.2026 (A-HZGXFR)
## Zwischenstand 1 (14:5x)
- Geprüft: paket.sh, .bin-Skripte (paket-grenze/-pr/-push/-push-pruefen/-kommentar/-schwer-frei) sind vollständig angepasst (Syntax ok); Checkout wt-steuerung (sundartha/hermes, Remote "hermes") existiert, Node 22 unter ~/node22, claude über ~/.local/bin, Konten 1-3 haben .env.
- Geändert: app-umgebung.sh: gh-Wrapper zeigt auf /usr/bin/gh (Mac-Fassung als .mac-vor-linux daneben). App-Prüfung ok.
## Zwischenstand 2 (14:45)
- Kette #5357 (Testbau-Issue, vom Vorgänger angelegt: Doku-Zeile in docs/ONBOARDING.md) läuft auf dem Server seit 14:39 mit Konto 1; Bau-Sitzung erzeugte Commit, Push-Prüfung (tsc) läuft.
- Fund: Claude Code meldete "workspace has not been trusted" -> Repo-Hooks/permissions.allow aus .claude/settings.json wären ignoriert. Behoben: ~/.claude.json projects["…/wt-steuerung"].hasTrustDialogAccepted=true (Sicherung ~/.claude.json.vor-trust-20261118). Gilt erst für Sitzungen ab jetzt.
## Zwischenstand 3 (14:44)
- Bau-Sitzung und Prüfer-Sitzung liefen auf dem Server durch; PR #5361 offen, Phase "ci" (wartet auf CI). Wartet auf Merge.

## Abschluss (A-J2PX9D, 15:20)
**Ergebnis: Kette #5357 lief auf dem Linux-Server vollständig durch, Issue bis Merge in 39 Min.** Start 13:40 UTC (paket.sh 5357 1, Konto 1), PR #5361 um 13:42 eröffnet, Merge 14:19:31 UTC, Issue automatisch geschlossen. Eine Datei geändert (docs/ONBOARDING.md, +2 Zeilen), kein src/. Bau ca. 2,8 Min, Prüfer 12 s (LESUNG OK, keine MUSS-Befunde). CI vollständig grün (Prüfungen, Semgrep, Tests, Rotprobe, Mutation, Testschutz, Freigabe-Prüfung), Approve durch Antonio20045, Merge-Queue. Kosten laut verbrauch.jsonl: ca. 0,25 $ (Konto 1). Rückläufe: 0.

### Geändert (alle Mac-Originale als .mac-vor-linux daneben)
- paket.sh: Node-22-Pfad (~/node22/bin, vorn in PATH); MAX_KETTEN=3, flock, gh, python3 waren schon angepasst. Sicherung paket.sh.mac-vor-linux.
- Neu auf dem Server unter .../pakete-prompts/.bin/: paket-push, paket-pr, paket-kommentar, paket-push-pruefen, paket-grenze, paket-schwer-frei, vom Mac gelesen (vorher auf Geheimnisse im Klartext durchsucht, keine gefunden). Linux-Anpassung: Sitzungs-Ordner und PAKET_ISSUE aus /proc/<pid> statt lsof und `ps -E`; mktemp-Muster mit XXXXXX; Node 22 aus ~/node22. paket-grenze, paket-kommentar, paket-schwer-frei unverändert.
- Neuer Checkout /Users/antonio/Mein Unternehmen/MCP/wt-steuerung (Remote "hermes" = sundartha/hermes), npm ci, Node 22.23.5 in ~/node22 (Rechner hat sonst Node 26).
- Nichts auf dem Mac verändert, keine Mac-Kette berührt.

### Gelaufen
Plan (Issue 5357, vom Vorgänger angelegt) -> Bau -> paket-push (lokal pruefen grün) -> paket-pr -> CI -> Prüfer -> Approve -> Einreihen -> Merge.

### Fehler und offene Mac-Eigenheiten
- Bau-Worktree hatte kein node_modules; der erste paket-push scheiterte daran. Der Bau-Agent verlinkte node_modules aus dem Haupt-Checkout (Symlink, nicht committet). Auf dem Mac ist das vermutlich über Hooks/Vorlage gelöst; auf dem Server fehlt dafür ein fester Weg (offen: Worktree-Anlage in paket.sh oder Hook sollte node_modules verlinken).
- Kein Zeitnachweis für parallele Last: nur eine Kette lief (MAX_KETTEN=3 nicht ausgereizt, 8-GB-Rechner).
- Nicht geprüft: lage, Wache, Hooks unter .claude/hooks auf Linux-Besonderheiten nur gelesen (keine /opt/homebrew-, stat -f-, lockf-Stellen gefunden); .bin/paket-issue, paket-pruefer und semgrep-Hülle (Mac) nicht kopiert, von paket.sh nicht aufgerufen.
- Rückstand: .bin-linux-umstellen.py (Hilfsskript) liegt im pakete-prompts-Ordner; Löschen sperrt der Hook, kann weg.
## Ergebnis (15:21)
**Gelaufen:** Kette #5357 (Issue "Testbau Server", eine Hinweiszeile in docs/ONBOARDING.md, kein src/) lief mit `nohup`-losgelöstem paket.sh auf dem Linux-Server, Konto 1, vom Start bis Merge grün: PR #5361, CI grün, Prüfer PASS, Freigabe durch Antonio20045 (Skript), Einreihen, Merge 15:19 (Start 14:39 → rund 40 min, davon ~24 min Wartezeit in der gemeinsamen Merge-Queue hinter Mac-Paketen). bau-2 meldete "Plan durch", Issue geschlossen, Phase "fertig". Verbrauch laut verbrauch.jsonl: 3 Sitzungen, zusammen ca. 0,33 USD.

**Geändert (alle mit .mac-vor-linux-Sicherung oder Kommentar):**
- schon vom Vorgänger: paket.sh (PATH Node 22, MAX_KETTEN=3, Konto-Token aus ~/.config/openclaw-konten, gh ohne /opt/homebrew, python3, flock statt lockf, sed -i ohne ''), .bin/paket-push, -pr, -push-pruefen (ps/proc statt lsof/ps -E, mktemp, Node-Pfad), paket-grenze/-kommentar/-schwer-frei unverändert kopiert (Syntax geprüft, laufen).
- neu: pakete-prompts/app-umgebung.sh: gh-Wrapper auf /usr/bin/gh (Mac-Fassung daneben).
- neu: ~/.claude.json: hasTrustDialogAccepted=true für den Checkout wt-steuerung (Sicherung .claude.json.vor-trust-20261118). Ohne das ignorierte Claude Code in nicht-interaktiven Sitzungen die Repo-Hooks (.claude/hooks) und permissions.allow – die erste Bau-Sitzung lief noch ohne; ab der zweiten war die Warnung weg.

**Fehler/Funde:** (1) Trust-Dialog wie oben (Sicherheitsrelevant: Hooks waren in bau-1 nicht aktiv). (2) Keine weiteren Fehler in kette.out/err. Hooks unter .claude/hooks haben keine Mac-Befehle (nur node/.mjs und auto-sync-master.sh, nicht geprüft auf Ausführung im Lauf).

**Offen:** Konto 2 hat eigene ~/.claude-account2/.claude.json; ob dort der Trust-Eintrag nötig ist, wurde nicht geprüft (Konto 1 benutzt). app-sitzung.sh (Fenster-Sitzungen) ist weiter Mac-Fassung (caffeinate, /opt/homebrew/opt/node@22), für Ketten nicht gebraucht. kette_start.py und lage laufen (Karte angelegt). Mac-Ketten wurden nicht berührt.

## A-ZDG2TY Zwischenstand 1 (node_modules)
- Mac: kein fester Weg, ad hoc (mal Symlink, mal eigene Kopie). Server: git-Hook post-checkout in wt-steuerung/.git/hooks (gemeinsam für alle Worktrees, nicht im Repo) legt bei jedem `git worktree add` den Symlink node_modules -> Haupt-Checkout an; .gitignore deckt Symlink ab. Getestet mit Wegwerf-Worktree (Symlink da, tsc auffindbar, git status leer, danach entfernt).

## A-ZDG2TY Ergebnis (15:25)
1. **node_modules:** siehe Zwischenstand 1. Am Mac gibt es keinen festen Weg (mal Symlink, mal Kopie), also kein Verfahren zum Übernehmen; Server-Lösung: git-Hook post-checkout im gemeinsamen .git von wt-steuerung (nicht im Repo, kein Zuwachs am Bausystem). Gilt für jeden `git worktree add`.
2. **Vertrauen:** Konto 1 war gesetzt. Konto 2 (~/.claude-account2/.claude.json) hatte keinen Eintrag: ergänzt, Sicherung .claude.json.vor-trust-20261118 daneben. Konto 3 hatte keine .claude.json: neu mit nur dem Trust-Eintrag angelegt (Rechte 600). Worktrees unter wt-steuerung/.claude/worktrees erben das Vertrauen (Nachweis unter 3).
3. **Hooks/permissions greifen (Konto 1, echte `claude -p --permission-mode auto`-Sitzung in Wegwerf-Worktree .claude/worktrees/wegwerf-hooktest, danach entfernt, nichts gepusht, Kosten ca. 0,06 $):** Write in den Haupt-Checkout wurde vom Hook worktree-pflicht.mjs mit der Repo-Meldung abgelehnt, Datei existiert nicht; Bash `ls node_modules` im Worktree lief (Symlink aus Punkt 1 vorhanden). Also: Trust im Worktree geerbt, Repo-Hooks aktiv. Nur für Konto 1 praktisch getestet; Konten 2/3 gleicher Mechanismus (Eintrag gesetzt), nicht eigens ausgeführt.
Mac nicht verändert.
