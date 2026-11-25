#!/bin/zsh
# Verhaltenstest zu paket-pr: Der echte Aufruf legt den PR bei vorhandenem system/<name> auf Kopf system/<name> an (sonst paket/<name>), und system/<name> als Argument wird angenommen. Rot gegen den Altstand.
F=${1:-"/Users/antonio/Claude/Projects/Agentic Calling MCP/pakete-prompts/.bin/paket-pr"}
T=$(mktemp -d); fehler=0   # Temp-Ordner bleibt liegen (Aufräumen macht das System)
ln -s /bin/zsh $T/claude   # paket-pr verlangt einen claude-Prozess über dem Aufruf
mkdir -p $T/bin $T/repo
cat > $T/bin/gh <<'GH'
#!/bin/zsh
echo "$*" >> $PROTO
for a in "$@"; do [ "$prev" = --input ] && cp "$a" $PROTO.senden; prev=$a; done
case "$*" in *"/pulls?"*) echo '[]';; *) echo https://github.com/sundartha/hermes/pull/1;; esac
GH
chmod +x $T/bin/gh
cd $T/repo && git init -q -b master && git commit -q --allow-empty -m a && git remote add hermes $T/repo/.git
mkdir -p .claude/worktrees && git worktree add -q .claude/worktrees/paket-x1 -b paket/x1 >/dev/null
WT=$T/repo/.claude/worktrees/paket-x1
echo '{"title":"Paket x","body":"Teil von #1"}' > $T/pr.json
lauf() { PROTO=$T/proto$1; : > $PROTO; PATH=$T/bin:$PATH PROTO=$PROTO $T/claude -c "cd $WT && PAKET_ISSUE=1 PROTO=$PROTO '$F' $2 $T/pr.json >$T/aus$1 2>&1; echo \$? > $T/rc$1; :"; echo "rc=$(cat $T/rc$1) kopf=$(grep -o 'head=sundartha:[^&]*' $PROTO | head -1 | cut -d: -f2) neu=$(python3 -c "import json;print(json.load(open('$PROTO.senden')).get('head'))" 2>/dev/null)"; }
pruefe() { [[ "$2" == "$3" ]] && echo "ok   $1" || { echo "ROT  $1: '$2' != '$3'"; head -3 $T/aus$4 2>/dev/null; fehler=1; }; }
pruefe "ohne system-Zweig: paket/x1" "$(lauf 1 paket/x1)" "rc=0 kopf=paket/x1 neu=paket/x1" 1
git -C $T/repo branch system/x1
pruefe "mit system-Zweig: PR-Kopf system/x1" "$(lauf 2 paket/x1)" "rc=0 kopf=system/x1 neu=system/x1" 2
pruefe "system/x1 als Argument wird angenommen" "$(lauf 3 system/x1)" "rc=0 kopf=system/x1 neu=system/x1" 3
exit $fehler
