#!/usr/bin/env bash
# Prüfsatz-Messung: baut je Fall den Fehler (patch.diff) in einen frischen Worktree auf BASIS ein
# und fährt NUR die schnellen Prüfungen des Standardwegs: Lint, Typen, Tests (erst betroffene, dann volle Suite).
# Kein Push, kein Commit, kein Mutationslauf, kein KI-Urteil.
#
# Nutzung:  pruefe.sh [--kontrolle-neu] [fall…]      (Fall = Ordnername oder Präfix, z. B. 05)
# Ausgabe:  ergebnis.md, ergebnis.json, logs/<fall>/*.log, kontrolle.json (neben diesem Skript)
set -u
export HIER="$(cd "$(dirname "$0")" && pwd)"
REPO="/Users/antonio/Mein Unternehmen/MCP/vodafone-agent"
BASIS="$(tr -d '[:space:]' < "$HIER/BASIS")"
WT=/tmp/pruefsatz-wt
CACHE="$WT/_cache"
LOGS="$HIER/logs"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export NODE_ENV=test PUBLIC_GATEWAY_URL=https://gateway.example CI=true

case "$(node -v)" in v22.*) ;; *) echo "Node 22 ist Pflicht, gefunden: $(node -v)" >&2; exit 2 ;; esac

NEU_KONTROLLE=0
FAELLE=()
for a in "$@"; do
  if [ "$a" = "--kontrolle-neu" ]; then NEU_KONTROLLE=1; else FAELLE+=("$a"); fi
done
if [ ${#FAELLE[@]} -eq 0 ]; then
  for d in "$HIER"/faelle/*/; do FAELLE+=("$(basename "$d")"); done
else
  aufgeloest=()
  for f in "${FAELLE[@]}"; do
    m="$(cd "$HIER/faelle" && ls -d "$f"* 2>/dev/null | head -1)"
    [ -n "$m" ] || { echo "Fall nicht gefunden: $f" >&2; exit 2; }
    aufgeloest+=("$m")
  done
  FAELLE=("${aufgeloest[@]}")
fi

mkdir -p "$WT" "$LOGS"
GESAMT_START=$SECONDS

# --- gemeinsamer Cache: ein Worktree auf BASIS mit npm ci (ohne Skripte, damit .git/config unberührt bleibt) ---
if [ ! -d "$CACHE/node_modules" ]; then
  git -C "$REPO" worktree add --detach "$CACHE" "$BASIS" >/dev/null 2>&1 || true
  (cd "$CACHE" && npm ci --ignore-scripts --no-audit --no-fund >"$LOGS/npm-ci.log" 2>&1) || { echo "npm ci fehlgeschlagen, s. $LOGS/npm-ci.log" >&2; exit 2; }
fi

neuer_worktree() { # $1 = Name
  local w="$WT/$1"
  git -C "$REPO" worktree remove --force "$w" >/dev/null 2>&1; rm -rf "$w"
  git -C "$REPO" worktree add --detach "$w" "$BASIS" >/dev/null 2>&1 || return 1
  ln -s "$CACHE/node_modules" "$w/node_modules"
}

# Fährt die Prüfungen in $1 (Worktree), schreibt Logs nach $2, gibt Zeilen "name status sekunden" nach $2/status.txt.
# $3 = "kontrolle" (volle Suite immer) oder "fall" (volle Suite nur, wenn betroffene grün).
fahre_pruefungen() {
  local w="$1" l="$2" modus="$3" t0 rc
  mkdir -p "$l"; : > "$l/status.txt"
  schritt() { # name, logdatei, befehl…
    local name="$1" log="$2"; shift 2
    t0=$SECONDS
    (cd "$w" && "$@") >"$l/$log" 2>&1; rc=$?
    echo "$name $rc $((SECONDS - t0))" >> "$l/status.txt"
    return $rc
  }
  schritt lint lint.log npm run lint --silent
  schritt typen typen.log npm run typecheck --silent
  schritt betroffen betroffen.log npm run test:betroffen --silent -- --basis=HEAD --ohne-volle-suite
  local br=$?
  if [ "$modus" = kontrolle ] || [ $br -eq 0 ]; then
    schritt voll voll.log npm test --silent -- --ohne-werkzeugtests   # Werkzeugtests (starten echte Mutationsläufe) sind nicht Teil der schnellen Prüfungen
  else
    echo "voll 99 0" >> "$l/status.txt"   # 99 = nicht gelaufen (betroffene Tests schon rot)
  fi
}

# --- Kontrolllauf auf unverändertem BASIS ---
KONTROLLE="$HIER/kontrolle.json"
if [ ! -f "$KONTROLLE" ] || [ $NEU_KONTROLLE -eq 1 ]; then
  echo ">> Kontrolllauf auf BASIS ($BASIS)"
  neuer_worktree _kontrolle || { echo "Worktree _kontrolle fehlgeschlagen" >&2; exit 2; }
  fahre_pruefungen "$WT/_kontrolle" "$LOGS/_kontrolle" kontrolle
  node -e '
    const fs=require("fs");const [,dir,out]=process.argv;
    const st=Object.fromEntries(fs.readFileSync(dir+"/status.txt","utf8").trim().split("\n").map(z=>{const [n,rc,s]=z.split(" ");return [n,{rc:+rc,sekunden:+s}]}));
    const rot=(log)=>{try{const t=fs.readFileSync(dir+"/"+log,"utf8");return [...new Set([...t.matchAll(/^\s*✗ .*\((test\/[\w./-]+\.test\.(?:js|ts)):\d+:\d+\)/gm)].map(m=>m[1]))]}catch{return[]}};
    const k={basis:fs.readFileSync(process.env.HIER+"/BASIS","utf8").trim(),node:process.version,pruefungen:st,rote_testdateien_voll:rot("voll.log"),rote_testdateien_betroffen:rot("betroffen.log"),erzeugt:new Date().toISOString()};
    fs.writeFileSync(out,JSON.stringify(k,null,2));' "$LOGS/_kontrolle" "$KONTROLLE"
  git -C "$REPO" worktree remove --force "$WT/_kontrolle" >/dev/null 2>&1
fi
echo ">> Kontrolle: $(tr -d '\n ' < "$KONTROLLE" | head -c 400)"

# --- Fälle ---
ERG="$HIER/ergebnis.json"
echo '[]' > "$WT/ergebnisse.tmp"
for fall in "${FAELLE[@]}"; do
  echo ">> Fall $fall"
  t0=$SECONDS
  l="$LOGS/$fall"; rm -rf "$l"; mkdir -p "$l"
  if ! neuer_worktree "$fall"; then echo "Worktree-Fehler $fall" >&2; continue; fi
  if ! (cd "$WT/$fall" && git apply "$HIER/faelle/$fall/patch.diff") >"$l/patch.log" 2>&1; then
    echo "patch.diff passt nicht auf BASIS ($fall), s. $l/patch.log" >&2
    echo "lint 98 0" > "$l/status.txt"
  else
    git -C "$WT/$fall" diff --name-only > "$l/geaendert.txt"
    fahre_pruefungen "$WT/$fall" "$l" fall
  fi
  dauer=$((SECONDS - t0))
  HIER="$HIER" node -e '
    const fs=require("fs");const [,fall,dauer,tmp]=process.argv;const hier=process.env.HIER;
    const l=hier+"/logs/"+fall;const k=JSON.parse(fs.readFileSync(hier+"/kontrolle.json","utf8"));
    const st=Object.fromEntries(fs.readFileSync(l+"/status.txt","utf8").trim().split("\n").map(z=>{const [n,rc,s]=z.split(" ");return [n,{rc:+rc,sekunden:+s}]}));
    const rotDateien=(log)=>{try{const t=fs.readFileSync(l+"/"+log,"utf8");return [...new Set([...t.matchAll(/^\s*✗ .*\((test\/[\w./-]+\.test\.(?:js|ts)):\d+:\d+\)/gm)].map(m=>m[1]))]}catch{return[]}};
    const lintFiles=()=>{try{const t=fs.readFileSync(l+"/lint.log","utf8");return [...new Set([...t.matchAll(/^(\/[^\n]+?)$/gm)].map(m=>m[1].split("/worktrees/").pop().replace(/^.*pruefsatz-wt\/[^/]+\//,"")))].slice(0,3)}catch{return[]}};
    const rauschen=(name,kn)=>k.pruefungen[kn||name]?.rc!==0&&k.pruefungen[kn||name]!==undefined;
    const rot=[];const ignoriert=[];
    if(st.lint&&st.lint.rc!==0){ (rauschen("lint")?ignoriert:rot).push("Lint "+lintFiles().join(", ")); }
    if(st.typen&&st.typen.rc!==0){ (rauschen("typen")?ignoriert:rot).push("Typen"); }
    const bekanntRot=new Set([...k.rote_testdateien_voll,...k.rote_testdateien_betroffen]);
    const bet=st.betroffen&&st.betroffen.rc!==0?rotDateien("betroffen.log"):[];
    const vol=st.voll&&st.voll.rc!==0&&st.voll.rc!==99?rotDateien("voll.log"):[];
    const neuBet=bet.filter(f=>!bekanntRot.has(f)),neuVol=vol.filter(f=>!bekanntRot.has(f));
    for(const f of neuBet)rot.push("Test "+f+" (betroffen)");
    for(const f of neuVol)if(!neuBet.includes(f))rot.push("Test "+f+" (voll)");
    // Lauf rot, aber keine Datei ermittelbar und Kontrolle war grün -> trotzdem rot melden
    if(st.betroffen&&st.betroffen.rc!==0&&!bet.length&&k.pruefungen.betroffen?.rc===0)rot.push("Test (betroffene, Datei nicht ermittelbar)");
    if(st.voll&&st.voll.rc!==0&&st.voll.rc!==99&&!vol.length&&k.pruefungen.voll?.rc===0&&!neuBet.length)rot.push("Test (voll, Datei nicht ermittelbar)");
    if(st.lint&&st.lint.rc===98)rot.push("Patch passt nicht auf BASIS");
    const eintrag={fall,ergebnis:rot.length?"rot":"gruen",rote_pruefungen:rot,vom_rauschen_ausgenommen:ignoriert,dauer_s:+dauer,schritte:st,geaenderte_dateien:fs.existsSync(l+"/geaendert.txt")?fs.readFileSync(l+"/geaendert.txt","utf8").trim().split("\n"):[]};
    const arr=JSON.parse(fs.readFileSync(tmp,"utf8"));arr.push(eintrag);fs.writeFileSync(tmp,JSON.stringify(arr));
  ' "$fall" "$dauer" "$WT/ergebnisse.tmp"
  git -C "$REPO" worktree remove --force "$WT/$fall" >/dev/null 2>&1
done

GESAMT=$((SECONDS - GESAMT_START))
HIER="$HIER" node -e '
  const fs=require("fs");const [,tmp,gesamt]=process.argv;const hier=process.env.HIER;
  const arr=JSON.parse(fs.readFileSync(tmp,"utf8"));const k=JSON.parse(fs.readFileSync(hier+"/kontrolle.json","utf8"));
  fs.writeFileSync(hier+"/ergebnis.json",JSON.stringify({basis:k.basis,node:process.version,gesamtdauer_s:+gesamt,kontrolle:k,faelle:arr},null,2));
  const z=["| Fall | Ergebnis | Rote Prüfung | Dauer (s) |","|---|---|---|---|"];
  for(const e of arr)z.push(`| ${e.fall} | ${e.ergebnis} | ${e.rote_pruefungen.join("; ")||"–"} | ${e.dauer_s} |`);
  z.push("",`Gesamtdauer: ${gesamt} s. Kontrolle auf BASIS: `+Object.entries(k.pruefungen).map(([n,v])=>`${n}=${v.rc===0?"grün":"rot("+v.rc+")"}`).join(", "));
  fs.writeFileSync(hier+"/ergebnis.md",z.join("\n")+"\n");console.log(z.join("\n"));
' "$WT/ergebnisse.tmp" "$GESAMT"

# Worktrees am Ende entfernen (Cache bleibt für Folgeläufe; mit PRUEFSATZ_CACHE_WEG=1 ebenfalls weg)
[ "${PRUEFSATZ_CACHE_WEG:-0}" = 1 ] && { git -C "$REPO" worktree remove --force "$CACHE" >/dev/null 2>&1; }
git -C "$REPO" worktree prune
