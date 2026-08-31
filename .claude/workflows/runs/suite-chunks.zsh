#!/bin/zsh
# Wiederaufnehmbarer Suite-Lauf in Datei-Chunks (Umgehung des EPIPE-/Sleep-Abbruchs
# bei einem einzelnen langen npm-test-Prozess). Repliziert die npm-test-Semantik:
# regression = alles AUSSER i18n-Katalog (^(Charakterisierung )?(DID|...)-[0-9])
# und Abnahme (^ABNAHME-). Fortschritt je Chunk in /tmp/suite-chunks/, fertige
# Chunks werden bei Wiederaufnahme uebersprungen. Aufruf: zsh suite-chunks.zsh
set -u
cd ~/Larry/deliverables/vodafone-agent
mkdir -p /tmp/suite-chunks
SKIP='^(Charakterisierung )?(DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD)-[0-9]|^ABNAHME-[A-Z0-9]'
FILES=(test/*.test.js)
CHUNK=25
TOTAL=${#FILES[@]}
i=1
n=0
while (( i <= TOTAL )); do
  n=$((n+1))
  LOG="/tmp/suite-chunks/chunk-$(printf '%02d' $n).log"
  if grep -q '^CHUNK_EXIT=' "$LOG" 2>/dev/null; then
    i=$((i+CHUNK)); continue
  fi
  SLICE=("${(@)FILES[$i,$((i+CHUNK-1))]}")
  NODE_ENV=test node --test --test-skip-pattern="$SKIP" "${SLICE[@]}" > "$LOG" 2>&1
  echo "CHUNK_EXIT=$?" >> "$LOG"
  i=$((i+CHUNK))
done
echo "ALLE_CHUNKS_FERTIG total_files=$TOTAL chunks=$n" > /tmp/suite-chunks/DONE
