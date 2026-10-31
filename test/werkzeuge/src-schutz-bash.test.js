import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BLOCKING_EXIT_CODE, probeRepository, runHook, runIn } from "./probe-repo.js";

const SRC_PATCH = [
  "diff --git a/src/a.js b/src/a.js",
  "--- a/src/a.js",
  "+++ b/src/a.js",
  "@@ -1 +1 @@",
  "-export const a = 1;",
  "+export const a = 2;",
  "",
].join("\n");
const DOCS_PATCH = SRC_PATCH.replaceAll("src/a.js", "docs/n.md");
const FILES = {
  "src/a.js": "export const a = 1;\n",
  "src/tief/b.js": "export const b = 1;\n",
  "test/a.test.js": 'import { test } from "node:test";\n',
  "docs/n.md": "export const a = 1;\n",
  "src.patch": SRC_PATCH,
  "docs.patch": DOCS_PATCH,
};
const BAU = { HERMES_ROLLE: "bau" };
const OHNE_ROLLE = { HERMES_ROLLE: undefined };

function worktreeProbe(context) {
  const directory = realpathSync(probeRepository(context, FILES));
  const worktree = join(directory, ".claude/worktrees/arbeit");
  const other = join(directory, ".claude/worktrees/anders");
  assert.equal(runIn(directory, "git", ["worktree", "add", "-q", "-b", "arbeit", worktree]).status, 0);
  assert.equal(runIn(directory, "git", ["worktree", "add", "-q", "-b", "anders", other]).status, 0);
  return { directory, worktree, other };
}

function bash(cwd, command, environment = OHNE_ROLLE) {
  const input = { tool_name: "Bash", tool_input: { command }, cwd };
  return runHook("worktree-pflicht.mjs", { cwd, input, environment });
}

function assertGesperrt(cwd, befehle, environment) {
  for (const befehl of befehle) {
    const ergebnis = bash(cwd, befehl, environment);
    assert.equal(ergebnis.status, BLOCKING_EXIT_CODE, `${befehl}: ${ergebnis.stderr}`);
    assert.match(ergebnis.stderr, /src\//, befehl);
    assert.match(ergebnis.stderr, /aenderung/, befehl);
    assert.match(ergebnis.stderr, /lauf/, befehl);
  }
}

function assertFrei(cwd, befehle, environment) {
  for (const befehl of befehle) {
    const ergebnis = bash(cwd, befehl, environment);
    assert.equal(ergebnis.status, 0, `${befehl}: ${ergebnis.stderr}`);
  }
}

test("Bash ohne Rolle bau schreibt nicht unter src/: sed -i, Umleitung, tee, cp, mv, rm, touch, mkdir", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "sed -i 's/a/b/' src/a.js",
    "sed -i '' 's/a/b/' src/a.js",
    "sed -Ei 's/a/b/' src/a.js",
    "sed -ni 's/a/b/p' src/a.js",
    "sed --in-place s/a/b/ src/a.js",
    "sed -i.bak s/a/b/ src/tief/b.js",
    "sed -n 'w src/neu.js' docs/n.md",
    "printf x > src/neu.js",
    "echo x >> src/a.js",
    "echo x >| src/a.js",
    "echo x &> src/a.js",
    "cat docs/n.md 2> src/fehler.log",
    "cat > src/neu.js <<'EOF'\nexport const c = 1;\nEOF",
    "cat docs/n.md | tee src/a.js",
    "tee -a src/a.js < docs/n.md",
    "cp docs/n.md src/a.js",
    "cp -r docs src/docs",
    "cp -t src docs/n.md",
    "cp -rt src docs/n.md",
    "install -m 644 docs/n.md src/n.md",
    "ln -s ../docs/n.md src/link.md",
    "mv docs/n.md src/n.md",
    "mv src/a.js docs/a.js",
    "rm src/a.js",
    "rm -rf src",
    "rm -rf src/tief",
    "rm -rf .",
    "rm -f src/*.js",
    "rm s*/a.js",
    "rm {src,test}/a.js",
    "unlink src/a.js",
    "touch src/neu.js",
    "mkdir -p src/neu",
    "truncate -s 0 src/a.js",
    "chmod 600 src/a.js",
    "dd if=docs/n.md of=src/a.js",
    "sort -o src/a.js src/a.js",
    "curl -o src/a.js https://example.invalid/a.js",
    "rm ../anders/src/a.js",
    `rm ${join(worktree, "src/a.js")}`,
  ]);
});

test("Bash ohne Rolle bau schreibt nicht unter src/: Interpreter mit Code, Shell -c, eval, awk", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "perl -pi -e 's/a/b/' src/a.js",
    "perl -i -pe 's/a/b/' src/a.js",
    "python3 -c \"open('src/a.js','w').write('x')\"",
    "python -c \"open('src/a.js','w').write('x')\"",
    "python3 - <<'EOF'\nopen('src/a.js','w').write('x')\nEOF",
    "node -e \"require('fs').writeFileSync('src/a.js','x')\"",
    "node --eval \"require('fs').rmSync('src/a.js')\"",
    "node -p \"require('fs').writeFileSync('src/a.js','x')\"",
    "node - <<'EOF'\nrequire('fs').rmSync('src/a.js');\nEOF",
    "ruby -e 'File.write(\"src/a.js\",\"x\")'",
    "php -r 'file_put_contents(\"src/a.js\",\"x\");'",
    "awk 'BEGIN{print \"x\" > \"src/a.js\"}'",
    "bash -c 'echo x > src/a.js'",
    "sh -c 'rm src/a.js'",
    "bash -lc 'cd src && touch x'",
    "bash <<'EOF'\nrm src/a.js\nEOF",
    "eval 'rm src/a.js'",
    "timeout 5 sed -i s/a/b/ src/a.js",
    "env FOO=1 rm src/a.js",
    "nice -n 5 rm src/a.js",
    "/bin/rm src/a.js",
    "\\rm src/a.js",
    "{ rm src/a.js; }",
    "(rm src/a.js)",
    "if true; then rm src/a.js; fi",
    "true && rm src/a.js",
    "false || rm src/a.js",
    "echo x | tee src/a.js",
  ]);
});

test("Bash ohne Rolle bau: git schreibt nicht unter src/ (apply, checkout --, restore, rm, mv, clean, stash)", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "git apply src.patch",
    "git apply --whitespace=nowarn src.patch",
    "git apply -p1 --directory=src docs.patch",
    "git apply <<'EOF'\ndiff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-x\n+y\nEOF",
    "git am src.patch",
    "git checkout -- src/a.js",
    "git checkout upstream/master -- src/a.js",
    "git checkout HEAD -- src",
    "git checkout -- .",
    "git checkout src/a.js",
    "git restore src/a.js",
    "git restore --source=HEAD~1 src",
    "git restore .",
    "git restore --worktree --staged src/a.js",
    "git rm src/a.js",
    "git rm -r src",
    "git mv src/a.js src/b.js",
    "git clean -fd src",
    "git stash push -- src/a.js",
    "git -C . checkout -- src/a.js",
    "git -C src checkout -- a.js",
    "git -C src restore .",
  ]);
});

test("Bash ohne Rolle bau: cd nach src/, Arbeitsverzeichnis in src/ und Ersetzung mit src/ sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "cd src && touch neu.js",
    "cd src && sed -i s/a/b/ a.js",
    "cd src; echo x > neu.js",
    "cd src/tief && rm b.js",
    "cd src && python3 -c 'print(1)'",
    "cd ./src && rm a.js",
    "(cd src && rm a.js)",
    "S=src; touch $S/neu.js",
    "echo x > $(echo src)/a.js",
    "touch \"$(pwd)/src/x\"",
    "for f in src/a.js; do rm $f; done",
    "rm `ls src/a.js`",
    "echo x > ${TARGET}/src/a.js",
    "grep -l a docs | xargs sed -i 's/a/b/' src/a.js",
    "ls src | xargs rm",
    "find src -name '*.js' -delete",
    "find src -name a.js -exec sed -i s/a/b/ {} +",
    "find . -name a.js -exec sed -i s/a/b/ {} +",
    "find src -fprint src/liste.txt",
  ]);
  assertGesperrt(join(worktree, "src"), [
    "touch neu.js",
    "sed -i s/a/b/ a.js",
    "echo x > neu.js",
    "rm tief/b.js",
    "cp ../docs/n.md n.md",
    "python3 -c 'print(1)'",
    "node -e 'console.log(1)'",
    "echo $(pwd)",
    "git checkout -- a.js",
    "git restore .",
  ]);
});

test("Bash ohne Rolle bau liest weiter frei unter src/: cat, grep, sed -n, git diff, npm test", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "cat src/a.js",
    "grep -rn export src",
    "grep -io export src/a.js",
    "grep -rwn export src",
    "rg -o export src",
    "git -C docs checkout -- n.md",
    "grep -rn export src | head -n 3",
    "sed -n '1,5p' src/a.js",
    "sed -n 's/a/w b/p' src/a.js",
    "head -n 3 src/a.js",
    "tail src/a.js",
    "wc -l src/a.js",
    "ls -la src",
    "find src -name '*.js'",
    "find src -name a.js -print",
    "awk '{print $1}' src/a.js",
    "diff src/a.js docs/n.md",
    "git diff -- src/a.js",
    "git diff upstream/master -- src | head",
    "git log --oneline -3 -- src",
    "git show HEAD:src/a.js",
    "git status --short",
    "git add src/a.js",
    "git restore --staged src/a.js",
    "git checkout -b feature",
    "git checkout upstream/master",
    "git commit -m 'Code unter src/ bleibt'",
    "git apply --check src.patch",
    "git apply --stat src.patch",
    "npm test",
    "npm test -- test/a.test.js",
    "npm run lint",
    "node --check src/a.js",
    "node -c src/a.js",
    "node tools/dateilaenge.mjs src/a.js",
    "python3 scripts/pruefen.py src/a.js",
    "npx eslint src/a.js",
    "npx prettier --check src/a.js",
    "cd src && ls",
    "cat src/a.js > /tmp/kopie.js",
    "cp src/a.js /tmp/kopie.js",
    "cp src/a.js docs/a.js",
    "dd if=src/a.js of=/tmp/kopie.js",
    "tar -czf /tmp/aus.tgz docs",
  ]);
});

test("Bash ohne Rolle bau schreibt weiter frei unter test/, docs/ und /tmp", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "printf x > test/neu.test.js",
    "echo x >> docs/n.md",
    "echo x > /tmp/probe-hsb.txt",
    "cat docs/n.md | tee /tmp/probe-hsb.txt",
    "cat > docs/neu.md <<'EOF'\nsrc/ steht hier nur im Text\nEOF",
    "cp docs/n.md test/n.md",
    "mv docs/n.md docs/m.md",
    "rm test/a.test.js",
    "rm -rf node_modules",
    "touch docs/neu.md",
    "mkdir -p test/neu",
    "sed -i s/a/b/ docs/n.md",
    "perl -pi -e s/a/b/ docs/n.md",
    "python3 -c \"open('docs/n.md','w').write('x')\"",
    "python3 -c 'print(1)'",
    "node -e 'console.log(1)'",
    "bash -c 'echo x > docs/n.md'",
    "git apply docs.patch",
    "git checkout -- docs/n.md",
    "git restore docs/n.md",
    "git rm docs/n.md",
    "find test -name a.test.js -exec sed -i s/a/b/ {} +",
    "grep -l a docs | xargs sed -i s/a/b/",
    "cd test && ls",
    "cd docs && sed -i s/a/b/ n.md",
    "echo $HOME",
    "git diff $(git merge-base HEAD upstream/master) -- docs",
    "rm *.log",
    "sed -i s/a/b/ *.md",
  ]);
});

test("Bash ohne Rolle bau: Download, Entpacken und Packen schreiben auch mit gebündelten Kurzoptionen nicht unter src/", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "curl -sLo src/a.js https://example.invalid/a.js",
    "curl -fsSLo src/a.js https://example.invalid/a.js",
    "curl -so src/a.js https://example.invalid/a.js",
    "curl --output src/a.js https://example.invalid/a.js",
    "curl --create-dirs -o src/neu/a.js https://example.invalid/a.js",
    "wget -qO src/a.js https://example.invalid/a.js",
    "wget -q -P src https://example.invalid/a.js",
    "wget --output-document=src/a.js https://example.invalid/a.js",
    "make -C src all",
    "make -j4 -C src",
    "mkdocs build -d src",
    "werkzeug --dest src",
    "werkzeug --destination=src",
    "werkzeug --extract-dir src",
    "wget --directory-prefix=src https://example.invalid/a.js",
    "tar -xf /tmp/a.tar -C src",
    "tar xf /tmp/a.tar -C src",
    "tar xzf /tmp/a.tgz --directory=src",
    "tar --extract --file=/tmp/a.tar --directory src",
    "tar -xf /tmp/a.tar",
    "tar xf /tmp/a.tar",
    "tar -xzf /tmp/a.tgz -C .",
    "cd src && tar -xf /tmp/a.tar",
    "tar -czf src/a.tgz docs",
    "tar czf src/a.tgz docs",
    "tar -cf src/a.tar docs",
    "tar --create --file=src/a.tar docs",
    "unzip /tmp/a.zip -d src",
    "unzip -o /tmp/a.zip -dsrc",
    "unzip /tmp/a.zip",
    "cd src && unzip /tmp/a.zip",
    "zip src/a.zip docs/n.md",
    "gzip src/a.js",
    "gunzip src/a.js.gz",
    "xz -k src/a.js",
    "bzip2 -k src/a.js",
  ]);
});

test("Bash ohne Rolle bau lädt, entpackt und packt weiter frei außerhalb von src/ und liest src/ beim Packen", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "curl -sLo /tmp/a.js https://example.invalid/a.js",
    "curl -s https://example.invalid/",
    "wget -qO /tmp/a.js https://example.invalid/a.js",
    "tar -tf /tmp/a.tar",
    "tar -xf /tmp/a.tar -C /tmp/aus",
    "tar -xzf /tmp/a.tgz -C docs",
    "tar -czf /tmp/a.tgz src",
    "tar -cf /tmp/a.tar -C src .",
    "cd docs && tar -xf /tmp/a.tar",
    "unzip -l /tmp/a.zip",
    "unzip -p /tmp/a.zip",
    "unzip /tmp/a.zip -d /tmp/aus",
    "cd docs && unzip -o /tmp/a.zip",
    "zip /tmp/a.zip src/a.js",
    "gzip -c src/a.js > /tmp/a.gz",
    "gzip --stdout src/a.js > /tmp/a.gz",
    "xz --to-stdout src/a.js > /tmp/a.xz",
    "gzip -dc /tmp/a.gz",
    "gzip -l /tmp/a.gz",
  ]);
});

test("Bash mit Rolle bau schreibt unter src/ weiter frei", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "sed -i 's/a/b/' src/a.js",
    "printf x > src/neu.js",
    "cp docs/n.md src/a.js",
    "rm src/a.js",
    "cd src && touch neu.js",
    "python3 -c \"open('src/a.js','w').write('x')\"",
    "git apply src.patch",
    "git checkout -- src/a.js",
    "echo x > $(echo src)/a.js",
  ], BAU);
});

test("Bash mit anderer Rolle als bau wird unter src/ wie ohne Rolle gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  for (const rolle of ["test", "", "Bau", "planer"]) {
    assertGesperrt(worktree, ["sed -i s/a/b/ src/a.js", "printf x > src/neu.js"], { HERMES_ROLLE: rolle });
  }
});

test("Bash im Haupt-Checkout wird unter src/ gesperrt, ausserhalb des Repos nicht", (context) => {
  const { directory } = worktreeProbe(context);
  assertGesperrt(directory, ["sed -i s/a/b/ src/a.js", `printf x > ${join(directory, "src/neu.js")}`]);
  assertFrei(directory, ["printf x > /tmp/probe-hsb.txt", "touch docs/neu.md"]);
});

test("Bash ohne Befehlstext wird nicht blockiert, Datei-Werkzeuge bleiben wie zuvor geprueft", (context) => {
  const { worktree } = worktreeProbe(context);
  const leer = runHook("worktree-pflicht.mjs", { cwd: worktree, input: { tool_name: "Bash", tool_input: {}, cwd: worktree }, environment: OHNE_ROLLE });
  assert.equal(leer.status, 0, leer.stderr);
  const datei = runHook("worktree-pflicht.mjs", { cwd: worktree, input: { tool_input: { file_path: join(worktree, "src/neu.js") }, cwd: worktree }, environment: OHNE_ROLLE });
  assert.equal(datei.status, BLOCKING_EXIT_CODE);
});
