import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BLOCKING_EXIT_CODE, REPO_ROOT, hookScript, probeRepository, runHook } from "./probe-repo.js";

const DATEIEN = { "test/a.test.js": 'import { test } from "node:test";\n', "src/a.js": "export const a = 1;\n" };

function vorWerkzeug(rolle) {
  const { hooks = {} } = JSON.parse(readFileSync(join(REPO_ROOT, `.claude/rollen/${rolle}.json`), "utf8"));
  return hooks.PreToolUse ?? [];
}

function bashHooks(eintraege) {
  return eintraege
    .filter(({ matcher = "" }) => matcher === "" || matcher === "*" || new RegExp(`^(?:${matcher})$`).test("Bash"))
    .flatMap(({ hooks }) => hooks.map(({ command }) => hookScript(command)));
}

const ROLLEN = ["test", "bau"];

function eingabeFuer(repo, fall) {
  return typeof fall === "string" ? { tool_name: "Bash", tool_input: { command: fall }, cwd: repo } : JSON.parse(fall.stdin);
}

function bash(repo, rolle, fall) {
  const hooks = bashHooks(vorWerkzeug(rolle));
  const eingabe = eingabeFuer(repo, fall);
  const ergebnisse = hooks.map((hook) => runHook(hook, { cwd: repo, input: eingabe, environment: { HERMES_ROLLE: rolle } }));
  return { hooks, gesperrt: ergebnisse.find(({ status }) => status === BLOCKING_EXIT_CODE) };
}

function assertGesperrt(repo, rolle, befehle) {
  for (const befehl of befehle) {
    const { gesperrt } = bash(repo, rolle, befehl);
    const name = befehl.stdin ?? befehl;
    assert.ok(gesperrt, `${rolle} darf nicht: ${name}`);
    assert.match(gesperrt.stderr, /Edit oder Write/, name);
  }
}

function assertErlaubt(repo, rolle, befehle) {
  for (const befehl of befehle) {
    const { hooks, gesperrt } = bash(repo, rolle, befehl);
    assert.ok(hooks.length > 0, `die Rolle ${rolle} hat keinen Hook für Bash`);
    assert.equal(gesperrt, undefined, `${befehl.stdin ?? befehl}: ${gesperrt?.stderr}`);
  }
}

test("der Test-Agent kann eine Datei nicht mit sed -i umschreiben", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "test", [
    "sed -i -E 's/a/b/' test/a.test.js",
    "sed -i '' 's/a/b/' test/a.test.js",
    "sed -Ei 's/a/b/' test/a.test.js",
    "sed --in-place 's/a/b/' test/a.test.js",
    "grep -l a test | xargs sed -i.bak 's/a/b/'",
    "find test -name a.test.js -exec sed -i 's/a/b/' {} +",
    "\\sed -i 's/a/b/' test/a.test.js",
    "s\\ed -i 's/a/b/' test/a.test.js",
    "\"sed\" -i 's/a/b/' test/a.test.js",
    "LC_ALL=C sed -i 's/a/b/' test/a.test.js",
    "timeout 5 sed -i 's/a/b/' test/a.test.js",
    "{ sed -i 's/a/b/' test/a.test.js; }",
    "! sed -i 's/a/b/' test/a.test.js",
    "if true; then sed -i 's/a/b/' test/a.test.js; fi",
    "sed \\\n  -i 's/a/b/' test/a.test.js",
    "cat <<< \"a\"\nsed -i 's/a/b/' test/a.test.js",
    "echo $((1<<2))\nsed -i 's/a/b/' test/a.test.js",
    "echo '<<EOF'\nsed -i 's/a/b/' test/a.test.js",
    "echo x # <<EOF\nsed -i 's/a/b/' test/a.test.js",
    "echo \"$(sed -i 's/a/b/' test/a.test.js)\"",
    "bash -c 'sed -i \"s/a/b/\" test/a.test.js'",
    "cat <<'E F'\nx\nE F\nsed -i 's/a/b/' test/a.test.js\nE_F",
    "echo 'a\nb' ; sed -i 's/a/b/' test/a.test.js",
    "echo \"$(true)<<true\"\nsed -i 's/a/b/' test/a.test.js\ntrue",
    "bash <<'EOF'\nsed -i 's/a/b/' test/a.test.js\nEOF",
    "cat <<'EOF' | sh\nsed -i 's/a/b/' test/a.test.js\nEOF",
    "echo \"$(echo \"\") $'\\'\"; sed -i s/a/b/ test/a.test.js; echo \"'\"",
    "echo \"${x:-\"}\"}\"; sed -i s/a/b/ test/a.test.js; echo \"\"",
    "echo ${x/<<EOF/}\nsed -i s/a/b/ test/a.test.js\nEOF",
    "cat <<EOF\n$(sed -i s/a/b/ test/a.test.js)\nEOF",
    "(( x = 1 << 2 ))\nsed -i s/a/b/ test/a.test.js\n2",
  ]);
});

test("der Bau-Agent kann nicht per Umleitung in eine Datei unter src schreiben", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "bau", [
    "echo 'export const b = 2;' > src/a.js",
    "printf x>>src/a.js",
    "cat <<'EOF' > src/a.js\nexport const b = 2;\nEOF",
    "npm test &> src/a.js",
    `echo x > ${join(repo, "src/a.js")}`,
    'echo "$(echo x > src/a.js)"',
    "sh -c 'echo x > src/a.js'",
  ]);
});

test("der Test-Agent kann eine Datei nicht mit perl -i oder tee schreiben", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "test", [
    "perl -pi -e 's/a/b/' test/a.test.js",
    "perl -i.bak -pe 's/a/b/' test/a.test.js",
    "echo x | tee test/a.test.js",
    "echo x | tee -a test/b.test.js",
    "echo x | \\tee test/a.test.js",
  ]);
});

test("der Bau-Agent kann eine Datei unter src nicht mit cp, git checkout, --fix oder einem Skript schreiben", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "bau", [
    "cp /tmp/a.js src/a.js",
    "timeout 5 mv /tmp/a.js src/a.js",
    "dd if=/tmp/a.js of=src/a.js",
    "git checkout -- src/a.js",
    "git -C . stash",
    "npx eslint --fix src/a.js",
    "node -e \"require('fs').writeFileSync('src/a.js', 'x')\"",
    "node --input-type=module <<'EOF'\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('src/a.js', 'x');\nEOF",
    "python3 -c \"open('src/a.js', 'w').write('x')\"",
    "echo $[x<<y]\nsed -i 's/a/b/' src/a.js\ny",
  ]);
});

test("der Test-Agent kann eine Datei nicht mit rm löschen und keinen Ordner anlegen", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "test", ["rm test/a.test.js", "rm -f test/a.test.js", "rmdir test", "mkdir -p test/neu", "unlink test/a.test.js"]);
});

test("der Bau-Agent kann hinter einem Here-String nicht in eine Datei unter src umleiten", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "bau", ["cat <<<EOF\necho x > src/a.js", "cat <<< 'EOF'\necho x > src/a.js\nEOF"]);
});

test("der Bau-Agent kann über node, python, awk oder source keine Datei schreiben", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "bau", [
    "node -e \"const fs = require('fs'); fs.writeSync(fs.openSync('src/a.js', 'w'), 'x')\"",
    "node -e \"require('fs').mkdirSync('src/neu')\"",
    "python3 -c \"import os; os.remove('src/a.js')\"",
    "awk 'BEGIN { print \"x\" > \"src/a.js\" }'",
    "awk '{print > \"src/a.js\"}' src/a.js",
    "source /dev/stdin <<'EOF'\nsed -i 's/a/b/' src/a.js\nEOF",
    ". /dev/stdin <<EOF\nsed -i 's/a/b/' src/a.js\nEOF",
    "node /tmp/umbau.mjs",
    "node - <<'EOF'\nconsole.log(1);\nEOF",
  ]);
});

test("der Bau-Agent kann erlaubte Programme nicht mit schreibenden Optionen oder fremder Umgebung aufrufen", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "bau", [
    "npm test -- test/a.test.js -- --import=data:text/javascript,0",
    "npm --script-shell=/tmp/x.sh test",
    "npm install",
    "npm run build",
    "npm_config_script_shell=/tmp/x.sh npm test",
    "PATH=/tmp/x:$PATH; npm test",
    "TMPDIR=src; echo x > $TMPDIR/a.js",
    "echo x > /tmp/$f",
    "cd /tmp && npm test",
    "cd && npm test",
    "git -c core.pager=true log",
    "git --git-dir=/tmp/x status",
    "git diff --output=src/a.js",
    "git grep -O a",
    "git archive HEAD",
    "git stash pop",
    "git -C /tmp status",
    "sort -o src/a.js src/a.js",
    "sort -uo src/a.js src/a.js",
    "uniq src/a.js src/b.js",
    "find src -delete",
    "find src -name a.js -fprint src/b.js",
    "sed -n 'w src/b.js' src/a.js",
    "sed -n 1p src/a.js -i",
    "sed 's/a/b/w src/b.js' src/a.js",
    "npx eslint -c /tmp/x.mjs src/a.js",
    "npx eslint --format /tmp/x.mjs src/a.js",
    "npx eslint --output-file src/b.js src/a.js",
    "npx prettier --write src/a.js",
    "npx jscpd src --reporters json --output src",
    "npx stryker run /tmp/x.json",
    "node tools/fremd.mjs",
    "x=--fix; npx eslint $x src/a.js",
    "for f in --fix; do npx eslint $f src/a.js; done",
    "npx eslint $(cat /tmp/optionen) src/a.js",
    "xargs sed -i 's/a/b/' < /tmp/liste",
    "env PATH=/tmp/x npm test",
    "exec 3<>src/neu.js",
    "case a in a) sed -i 's/a/b/' src/a.js;; esac",
    "alias ls='sed -i s/a/b/ src/a.js'",
    "sed -$'i' 's/a/b/' src/a.js",
    "npx eslint -$'-fix' src/a.js",
    "git diff --ou$'tput=src/b.js'",
    "find src -name a.js -exe$'c' sed -i s/a/b/ {} +",
    "find src -name a.js -dele$'te'",
    "sort -$x src/a.js",
    "uniq src/*.js",
    "F=\"src/a.js src/b.js\"; uniq $F",
  ]);
});

test("der Test-Agent darf weiter npm test und git diff über Bash ausführen", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertErlaubt(repo, "test", [
    "npm --silent test -- test/a.test.js",
    "npm test -- test/a.test.js 2>&1 | tail -20",
    "npm test -- test/a.test.js > /tmp/abnahme.log 2>&1",
    "git diff",
    "git diff --stat > /dev/null 2>&1",
    'grep -n "a > b" src/a.js',
    "grep -rn tee src",
    "git log --oneline --grep sed -i -3",
    "sed -n '1,5p' test/a.test.js",
    "git log --oneline -3 -- src/a.js",
    "git status --short",
  ]);
  assertGesperrt(repo, "test", ['echo "$(date \'+%s\')" > /dev/null']);
});

test("der Test-Agent darf git log --grep revert und git stash list ausführen", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertErlaubt(repo, "test", ["git log --oneline --grep revert", "git log --grep revert -5 -- src", "git stash list", "git stash list >/dev/null"]);
});

test("der Test- und der Bau-Agent dürfen die gemessenen Prüf- und Lesebefehle weiter ausführen", (context) => {
  const repo = probeRepository(context, DATEIEN);
  const befehle = [
    "grep -n -B2 -A12 \"export\" src/a.js | head -50",
    `cd "${repo}" && sed -n 1,80p src/a.js`,
    "cd test && ls && cd ..",
    "cat src/a.js | sed 's/^ *//' | cut -c1-200",
    "npm --silent test -- test/a.test.js 2>&1 | grep -v \"^\\s*at \" | head -6",
    "npm run lint 2>&1 | tail -15",
    "git status --short -- test src 2>&1; git diff --stat; git log --oneline -5",
    "git show --stat HEAD; git show HEAD:src/a.js | head",
    "diff <(git show HEAD:src/a.js) src/a.js",
    "npx eslint src/a.js test/a.test.js 2>&1 | tail -15",
    "npx eslint --suppressions-location /tmp/s.json --format unix src/a.js",
    "npx jscpd test --min-tokens 50 --reporters console 2>&1 | tail -3",
    "wc -l src/a.js test/a.test.js; ls test/ | sort | uniq -c",
    "node --check src/a.js && echo ok",
    "node tools/basis-vergleich.mjs jscpd --basis HEAD > /tmp/jscpd.log 2>&1; echo exit=$?; tail -3 /tmp/jscpd.log",
    "env -u HERMES_ROLLE npm --silent test -- test/a.test.js 2>&1 | tail -5",
    "timeout 120 npm --silent test -- test/a.test.js",
    "grep -l a src/*.js | xargs grep -n export",
    "ps -ax -o pid,command | grep node | grep -v grep | cut -c1-200",
    ": > /tmp/flush.log",
  ];
  for (const rolle of ["test", "bau"]) assertErlaubt(repo, rolle, befehle);
  const ersetzungen = ['F="src/a.js test/a.test.js"; npx prettier --check $F 2>&1', 'for f in src/a.js test/a.test.js; do echo "== $f"; npx eslint $f; done'];
  for (const rolle of ["test", "bau"]) assertGesperrt(repo, rolle, ersetzungen);
});

function assertFaelle(context, { gesperrt, erlaubt }) {
  const repo = probeRepository(context, DATEIEN);
  for (const rolle of ROLLEN) {
    assertGesperrt(repo, rolle, gesperrt);
    assertErlaubt(repo, rolle, erlaubt);
  }
}

test("uniq nimmt das Wort - als Eingabe-Operand und sperrt eine zweite Datei", (context) => {
  assertFaelle(context, {
    gesperrt: ["echo a | uniq - src/m", "uniq -c - src/m"],
    erlaubt: ["uniq -c", "sort x | uniq", "uniq test/a.txt"],
  });
});

test("Namensargumente und Arithmetik dürfen nur einfache Variablennamen und Zahlen enthalten", (context) => {
  assertFaelle(context, {
    gesperrt: ["read -r 'a[$(true)]' <<< 1", "printf -v 'a[$(true)]' x", "x='a[$(true)]'; echo $((x))", "echo $((y+1))", "echo $((3+4))", "x=abc; echo $x"],
    erlaubt: ["read -r zeile <<< 1"],
  });
});

test("Index und Teilstring einer Variablen nehmen nur Zahlen, wait ohne Namen", (context) => {
  assertFaelle(context, {
    gesperrt: ["read x <<< 1; echo ${a[x]}", "echo ${a[$i]}", "echo ${x:y}", "echo ${x:0:n}", "wait -p name", "echo ${a[0]}", "echo ${a[@]}", "echo ${x:1:2}"],
    erlaubt: ["wait"],
  });
});

test("Variablen dürfen nur eigene Namen binden, auch über for, read und printf -v, über eine Ersetzung gar keine", (context) => {
  assertFaelle(context, {
    gesperrt: [
      "for HOME in /tmp; do git status; done",
      "printf -v HOME %s /tmp; git status",
      "read HOME <<< /tmp; git status",
      "read -ra PATH <<< /tmp",
      ": ${TMPDIR=src}; echo x > $TMPDIR/a.js",
      ": ${x:=--fix}; npx eslint $x src/a.js",
      "echo ${x?}",
      "for f in src/a.js; do echo $f; done",
      "echo ${x:-std} ${x:+gesetzt}",
    ],
    erlaubt: ["printf -v zeile %s a", "read -r F <<< 1"],
  });
});

test("ein Optionswert aus einer Variablen bringt keine weitere Option an den Schreibschutz vorbei", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "bau", ['x="1 -o src/a.js"; sort -k $x src/a.js', 'x=" --fix"; npx eslint --max-warnings 0$x src/a.js']);
  assertErlaubt(repo, "bau", ["sort -k 1 src/a.js", "npx eslint --max-warnings 0 src/a.js"]);
});

test("Test- und Bau-Agent dürfen in Bash keine Ersetzung nutzen", (context) => {
  const repo = probeRepository(context, DATEIEN);
  assertGesperrt(repo, "bau", ["read -r x <<< '$(true)'; echo ${x@P}", "echo ${x@Q}", "echo $HOME", 'echo "$(true)"', "echo `true`", "echo $((1+1))"]);
  assertErlaubt(repo, "bau", ["npm test -- test/a.test.js; echo exit $?", "grep -n '$x' src/a.js", "git status"]);
});

test("git grep erlaubt nur Kurzoptionen aus der Erlaubtliste, auch gebündelt", (context) => {
  assertFaelle(context, {
    gesperrt: ["git grep -nOcat muster", "git grep -inOcat muster", "git grep -lOcat muster", "git grep --open-files-in-pager=cat muster"],
    erlaubt: ["git grep -n muster", "git grep -inw muster -- src", "git grep -l muster"],
  });
});

test("npm test nimmt nur Testpfade im Repo, basis-vergleich nur lesend", (context) => {
  assertFaelle(context, {
    gesperrt: [
      "npm test -- /tmp/x.test.js",
      "npm test -- ../x.test.js",
      "npm test -- test/../../x.test.js",
      "node tools/basis-vergleich.mjs jscpd --basis-kuerzen",
      "node tools/basis-vergleich.mjs jscpd --basis-anlegen",
      "node tools/basis-vergleich.mjs jscpd --umbenennung-nachziehen",
    ],
    erlaubt: [
      "npm test -- test/werkzeuge/bash-schreibschutz.test.js",
      "node tools/basis-vergleich.mjs jscpd --basis abc123",
      "node tools/basis-vergleich.mjs jscpd --je-ordner",
    ],
  });
});

test("eine Ausnahme im Hook oder eine kaputte Eingabe sperrt den Befehl", (context) => {
  assertFaelle(context, {
    gesperrt: [{ stdin: "null" }, { stdin: '{"tool_input":{"command":5}}' }, { stdin: '{"cwd":5,"tool_input":{"command":"ls"}}' }],
    erlaubt: [{ stdin: '{"tool_input":{"command":"ls"}}' }],
  });
});

test("die Sperre einer Ersetzung nennt die Schreibweise ohne Ersetzung", (context) => {
  const repo = probeRepository(context, DATEIEN);
  const befehle = ["npm test -- test/a.test.js > $TMPDIR/lauf.txt 2>&1", 'grep -v "^$" src/a.js', "for f in src/a.js; do grep -n a $f; done", 'cd "$PWD"'];
  const hinweise = [/fester Pfad unter \/tmp/, /einfache Anführungszeichen/, /wörtlich/, /\$\?/];
  for (const rolle of ROLLEN) {
    for (const befehl of befehle) {
      const { gesperrt } = bash(repo, rolle, befehl);
      assert.ok(gesperrt, `${rolle} darf nicht: ${befehl}`);
      for (const hinweis of hinweise) assert.match(gesperrt.stderr, hinweis, befehl);
    }
  }
});

test("die Schreibweisen ohne Ersetzung aus der Sperrmeldung laufen durch", (context) => {
  assertFaelle(context, {
    gesperrt: [],
    erlaubt: [
      "npm test -- test/a.test.js > /tmp/bss-f1-lauf.txt 2>&1; echo exit=$?",
      "grep -v '^\\s*$' src/a.js",
      'grep -v "^\\s*\\$" src/a.js',
      "grep -n a src/a.js test/a.test.js",
    ],
  });
});

const LOESCHBAR = {
  ...DATEIEN,
  "src/b.js": "export const b = 2;\n",
  "src/a.test.js": "export const c = 3;\n",
  ".github/a.yml": "a: 1\n",
  ".claude/hooks/a.mjs": "export const d = 4;\n",
  "tools/basis/a.mjs": "export const e = 5;\n",
  "eslint.config.js": "export default [];\n",
  "knip.json": "{}\n",
};
const ABNAHME = "test/a.test.js";

function transkript(befehl) {
  const aufruf = { type: "tool_use", id: "abnahme", name: "Bash", input: { command: befehl } };
  const ergebnis = { type: "tool_result", tool_use_id: "abnahme", content: "1 bestanden" };
  return [aufruf, ergebnis].map((eintrag) => JSON.stringify({ message: { content: [eintrag] } })).join("\n");
}

function bauLoescht(repo, befehl) {
  const [hook] = bashHooks(vorWerkzeug("bau"));
  const input = { tool_name: "Bash", tool_input: { command: befehl }, cwd: repo, transcript_path: join(repo, "transkript.jsonl") };
  return runHook(hook, { cwd: repo, input, environment: { HERMES_ROLLE: "bau", HERMES_ABNAHME: ABNAHME } });
}

test("der Bau-Agent darf eine Datei mit git rm und wörtlichem Pfad löschen", (context) => {
  const repo = probeRepository(context, { ...LOESCHBAR, "transkript.jsonl": transkript(`npm --silent test -- ${ABNAHME}`) });
  for (const befehl of ["git rm src/a.js", "git rm -- src/a.js src/b.js", "git rm 'src/a.js'", "cd src && git rm a.js", "git rm src/a.js 2>&1 | tail -3"]) {
    const lauf = bauLoescht(repo, befehl);
    assert.equal(lauf.status, 0, `${befehl}: ${lauf.stderr}`);
  }
});

test("der Bau-Agent kann eine Datei unter src erst nach dem Abnahmetest mit git rm löschen", (context) => {
  const repo = probeRepository(context, { ...LOESCHBAR, "transkript.jsonl": transkript(`cat ${ABNAHME}`) });
  const lauf = bauLoescht(repo, "git rm src/a.js");
  assert.equal(lauf.status, BLOCKING_EXIT_CODE, lauf.stderr);
  assert.match(lauf.stderr, /führe zuerst den Abnahmetest selbst aus/);
});

test("der Test-Agent darf nicht mit git rm löschen", (context) => {
  const repo = probeRepository(context, LOESCHBAR);
  assertGesperrt(repo, "test", ["git rm src/a.js", "git rm test/a.test.js", "git rm -- src/b.js"]);
});

test("git rm mit -r, Muster, Ersetzung, Option oder fremdem Ziel bleibt für den Bau-Agenten gesperrt", (context) => {
  const repo = probeRepository(context, LOESCHBAR);
  assertGesperrt(repo, "bau", [
    "git rm -r src",
    "git rm src",
    "git rm src/a.js -r",
    "git rm -f src/a.js",
    "git rm --cached src/a.js",
    "git rm --pathspec-from-file=/tmp/liste",
    "git rm",
    "git rm --",
    "git rm src/*.js",
    "git rm 'src/*.js'",
    "git rm 'src/a?.js'",
    "git rm 'src/[ab].js'",
    "git rm ':(glob)src/a.js'",
    "git rm ':/src/a.js'",
    "git rm $f",
    "git rm src/$f",
    "git rm src/fehlt.js",
    "git rm ../a.js",
    "git rm /tmp/a.js",
    "git -C src rm a.js",
    "git --no-pager rm src/a.js",
  ]);
});

test("git rm unter einem geschützten Pfad bleibt für den Bau-Agenten gesperrt", (context) => {
  const repo = probeRepository(context, LOESCHBAR);
  const geschuetzt = [".github/a.yml", ".claude/hooks/a.mjs", "tools/basis/a.mjs", "test/a.test.js", "src/a.test.js", "eslint.config.js", "knip.json"];
  for (const pfad of geschuetzt) {
    const { gesperrt } = bash(repo, "bau", `git rm ${pfad}`);
    assert.ok(gesperrt, `bau darf nicht: git rm ${pfad}`);
    assert.match(gesperrt.stderr, /geschützt/, pfad);
  }
});

test("die Sperre von rm nennt dem Bau-Agenten git rm mit Pfad als Weg", (context) => {
  const repo = probeRepository(context, LOESCHBAR);
  for (const befehl of ["rm src/a.js", "rm -f src/a.js", "unlink src/a.js"]) {
    const { gesperrt } = bash(repo, "bau", befehl);
    assert.ok(gesperrt, `bau darf nicht: ${befehl}`);
    assert.match(gesperrt.stderr, /git rm <Pfad>/, befehl);
  }
});
