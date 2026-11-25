#!/bin/zsh
# Erstes Häppchen zu Karte 3be42fac (Auftrag 0968dba1): "Ketten auf dem Mac sollen einen Neustart
# oder Ausfall des Node-Hosts überleben". Eigenständiges Experiment-Skript, ändert paket.sh NICHT:
# es nutzt nur die dort schon vorhandene Weiche PAKET_SCOPE (paket.sh Zeile 31), die ein zweites
# Einwickeln der Kette verhindert. Auf dem Server ohne Wirkung (launchctl fehlt dort), auf dem Mac
# startet es die Kette als eigenen launchd-Job statt als Kind des Node-Host-Prozesses: stirbt der
# Node-Host (Neustart, Absturz), bleibt der launchd-Job eigenständig am Leben.
#
# NICHT der Standardweg: paket.sh ruft dieses Skript nicht auf. Erst nach einem echten Neustart-Test
# auf dem Mac (siehe unten) entscheidet sich, ob der Start-Weg in paket.sh als Standard verdrahtet wird.
#
# Aufruf:
#   mac-ketten-ueberleben.sh start <issue> [konto]   - startet die Kette über launchd statt nohup
#   mac-ketten-ueberleben.sh entfernen <issue>       - nimmt den launchd-Job wieder heraus (nach Halt/Ende)
#   mac-ketten-ueberleben.sh status <issue>          - zeigt, ob der Job bei launchd eingetragen ist
#
# Test (nur auf dem Mac, nicht von hier ausführbar):
#   1. mac-ketten-ueberleben.sh start <issue>
#   2. Node-Host neu starten (oder den ganzen Mac neu starten)
#   3. mac-ketten-ueberleben.sh status <issue>  -> Job soll weiter bei launchd eingetragen sein
#      und $KETTEN/paket-<issue>/.lauf/pid soll eine lebende PID zeigen (kill -0 <pid>)
#   4. Zeitstempel vor/nach Neustart stehen zur Messung in $KETTEN/paket-<issue>/ueberleben-test.log
set -u
SKRIPT="${0:A:h}"
KETTEN=${KETTEN:-/Users/antonio/Bereiche/sundartha/engineering/ketten}

label() { echo "de.antonio.kette-$1"; }

case "${1:-}" in
  start)
    ISSUE=${2:?Issue-Nummer fehlt}; KONTO=${3:-}
    command -v launchctl >/dev/null || { echo "launchctl fehlt (kein macOS) - Abbruch" >&2; exit 1; }
    L=$(label $ISSUE)
    mkdir -p "$KETTEN/paket-$ISSUE"
    launchctl remove "$L" 2>/dev/null; sleep 1   # alten Job derselben Nummer zuerst entfernen (sonst meldet submit "service already loaded")
    echo "$(date -u +%FT%TZ) start label=$L" >> "$KETTEN/paket-$ISSUE/ueberleben-test.log"
    launchctl submit -l "$L" \
      -o "$KETTEN/paket-$ISSUE/launchd.out" \
      -e "$KETTEN/paket-$ISSUE/launchd.err" \
      -- /usr/bin/env PAKET_SCOPE=1 "$SKRIPT/paket.sh" "$ISSUE" "$KONTO"
    echo "$L eingereiht; Stand mit: launchctl list | grep $L"
    ;;
  entfernen)
    ISSUE=${2:?Issue-Nummer fehlt}; L=$(label $ISSUE)
    launchctl remove "$L" 2>/dev/null
    echo "$(date -u +%FT%TZ) entfernt label=$L" >> "$KETTEN/paket-$ISSUE/ueberleben-test.log" 2>/dev/null
    echo "$L entfernt (falls er eingetragen war)"
    ;;
  status)
    ISSUE=${2:?Issue-Nummer fehlt}; L=$(label $ISSUE)
    launchctl list 2>/dev/null | grep -F "$L" || echo "$L ist bei launchd nicht eingetragen"
    ;;
  *)
    echo "Aufruf: $0 start|entfernen|status <issue> [konto]" >&2; exit 2 ;;
esac
