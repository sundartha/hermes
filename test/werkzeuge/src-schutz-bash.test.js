import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  "maskiert.patch": SRC_PATCH.replaceAll("src/a.js", '"\\163rc/a.js"'),
  "plain.patch": SRC_PATCH.replaceAll("src/a.js", "a.js"),
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
    "md5 src/a.js",
    "sha256sum src/a.js",
    "tac src/a.js",
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
    "rm -r docs/leer",
    "curl -s https://example.invalid/",
    "grep -n '' docs/n.md",
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

test("Bash ohne Rolle bau: ein Patch, dessen Inhalt über stdin oder eine Datei kommt, ändert src/ nicht (git apply, git am, patch)", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "git apply < src.patch",
    "git apply -p1 - < src.patch",
    "cat docs.patch | git apply",
    "cat docs.patch | git apply -p1 -",
    "git am < src.patch",
    "cat docs.patch | git am",
    "patch -p1 < src.patch",
    "cat docs.patch | patch -p1",
    "patch -p1 -i src.patch",
    "patch -p1 --input=src.patch",
    "patch -p1 -isrc.patch",
    "patch docs/n.md src.patch",
    "patch -p 1 docs/n.md < src.patch",
    "patch src/a.js docs.patch",
    "git apply maskiert.patch",
    "git apply < maskiert.patch",
    "patch -p1 < maskiert.patch",
    "git apply <<'EOF'\ndiff --git a/x b/x\n--- a/x\n+++ \"b/\\163rc/a.js\"\nEOF",
    "git apply fehlt.patch",
    "patch -p1 < fehlt.patch",
  ]);
});

test("Bash ohne Rolle bau wendet Patches für test/ und docs/ weiter an und prüft Patches nur lesend", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "git apply < docs.patch",
    "git -c core.pager=cat apply < docs.patch",
    "git am --abort",
    "patch -p1 < docs.patch",
    "patch -p1 -i docs.patch",
    "patch docs/n.md docs.patch",
    "patch -p1 -idocs.patch",
    "patch -p1 --input=docs.patch",
    "patch --dry-run -p1 < src.patch",
    "git apply --check < src.patch",
    "git apply --stat < src.patch",
    "git apply <<'EOF'\ndiff --git a/docs/n.md b/docs/n.md\n--- a/docs/n.md\n+++ b/docs/n.md\nEOF",
  ]);
});

test("Bash ohne Rolle bau: git checkout-index, stash und reset --hard schreiben src/ ohne Pfad im Befehl und sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "git checkout-index -a -f",
    "git checkout-index --all --force",
    "git checkout-index -f -- src/a.js",
    "git checkout-index -f src/a.js",
    "git checkout-index -a --prefix=src/",
    "git checkout-index --stdin",
    "git stash pop",
    "git stash apply",
    "git stash apply stash@{1}",
    "git stash pop --index",
    "git stash branch neu",
    "git stash",
    "git stash push",
    "git stash push -m wip",
    "git stash save wip",
    "git stash -u",
    "git stash push docs/n.md",
    "git stash push --",
    "git stash push -- src/a.js",
    "git stash push -- .",
    "git reset --hard",
    "git reset --hard HEAD~1",
    "git reset --hard upstream/master",
    "git reset --merge",
    "git reset --keep HEAD~1",
    "git -C . reset --hard",
    "git -C src reset --hard",
  ]);
});

test("Bash ohne Rolle bau: git reset ohne --hard, stash lesend oder mit Pfad außerhalb src/ und checkout-index mit fremdem Ziel bleiben frei", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "git reset",
    "git reset --soft HEAD~1",
    "git reset --mixed HEAD~1",
    "git reset HEAD -- src/a.js",
    "git stash list",
    "git stash show -p",
    "git stash drop",
    "git stash clear",
    "git stash create",
    "git stash push -- docs/n.md",
    "git stash push -m wip -- docs/n.md test",
    "git checkout-index --prefix=/tmp/auszug/ -a",
    "git checkout-index -f -- docs/n.md",
  ]);
});

test("Bash mit Rolle planer: patch und git apply mit aenderung.diff ändern src/a.js nicht", (context) => {
  const directory = realpathSync(probeRepository(context, { ...FILES, "aenderung.diff": SRC_PATCH }));
  const vorher = readFileSync(join(directory, "src/a.js"), "utf8");
  for (const befehl of ["patch -p1 < aenderung.diff", "git apply < aenderung.diff"]) {
    const ergebnis = bash(directory, befehl, { HERMES_ROLLE: "planer" });
    assert.equal(ergebnis.status, BLOCKING_EXIT_CODE, `${befehl}: ${ergebnis.stderr}`);
  }
  assert.equal(readFileSync(join(directory, "src/a.js"), "utf8"), vorher);
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

test("Bash ohne Rolle bau: ein Patch ohne src im Kopf ändert src/ nicht, wenn das Arbeitsverzeichnis unter src/ liegt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "cd src && patch -p1 < ../plain.patch",
    "cd s* && patch -p1 < plain.patch",
    "cd src && patch -p1 -i ../plain.patch",
    "cd src && patch a.js ../plain.patch",
    "cd src && cat ../plain.patch | patch -p1",
    "cd src && git apply ../plain.patch",
    "cd src && git apply < ../plain.patch",
    "git -C src apply ../plain.patch",
    "cd src; patch -p1 < ../plain.patch",
  ]);
  assertGesperrt(join(worktree, "src"), [
    "patch -p1 -i ../plain.patch",
    "patch -p1 < ../plain.patch",
    "git apply ../plain.patch",
    "git apply < ../plain.patch",
    "git am ../plain.patch",
  ]);
  assertFrei(worktree, [
    "cd docs && patch -p1 < ../plain.patch",
    "cd test && patch -p1 -i ../plain.patch",
    "git -C docs apply ../plain.patch",
  ]);
});

test("Bash ohne Rolle bau: Kopieren in einen Ordner oberhalb von src/ kann src/ überschreiben und ist gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "cp -r /tmp/neu/src .",
    "cp -R /tmp/neu .",
    "cp -a /tmp/neu/. .",
    "cp /tmp/neu/src .",
    "cp -rt . /tmp/neu/src",
    "cp /tmp/neu/s* .",
    "rsync -a /tmp/neu/ .",
    "rsync -avt /tmp/neu/ src/",
    "rsync --recursive /tmp/neu/ .",
    "scp -r host:/pfad/ .",
    "ditto /tmp/neu .",
    "ln -s /tmp/neu/src .",
    "install -m 644 /tmp/neu/src .",
    "cd docs && cp -r /tmp/neu/src ..",
  ]);
});

test("Bash ohne Rolle bau kopiert einzelne Dateien weiter frei in den Repo-Ordner und nach docs/", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "cp /tmp/neu.txt .",
    "cp docs/n.md .",
    "cp -p /tmp/neu.txt .",
    "rsync /tmp/neu.txt .",
    "rsync -av /tmp/neu/ docs/",
    "cp -r /tmp/neu docs/",
    "ln -s /tmp/neu.txt neu.txt",
    "scp host:/pfad/datei.txt .",
  ]);
});

test("Bash ohne Rolle bau: unbekannte Programme und Schreib-Optionen mit src/ oder einem Ordner darüber sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "npx prettier --write .",
    "npx eslint --fix .",
    "npx eslint --fix src",
    "npx semgrep --autofix .",
    "npx prettier -w .",
    "black src",
    "sd a b src/a.js",
    "make -C src",
    "node tools/dateilaenge.mjs src/a.js",
    "python3 scripts/pruefen.py src/a.js",
    "watch 'sed -i s/a/b/ src/a.js'",
    "npx -c 'sed -i s/a/b/ src/a.js'",
    "npx --call 'sed -i s/a/b/ src/a.js'",
    "xxd -r x.hex src/a.js",
    "node --check -r /tmp/w.js src/a.js",
    "node -c --import /tmp/w.mjs src/a.js",
    "node --check --env-file=/tmp/e src/a.js",
    "node --check --require /tmp/w.js src/a.js",
    "tree -o src/t.txt src",
    "ruff format src",
    "npm run lint:fix",
    "npm run test:fix",
    "npm run css:format",
    "pnpm run lint:fix",
    "npm run format",
    "yarn format",
    "unbekannt $PFAD src",
  ]);
});

test("Bash ohne Rolle bau prüft und liest weiter frei: eslint, prettier --check, node --check, tree, xxd, gh", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "npx eslint .",
    "npx eslint src",
    "npx prettier --check .",
    "npx prettier src/a.js",
    "npx semgrep --config auto src",
    "node --check src/a.js",
    "node src/a.js",
    "node tools/dateilaenge.mjs docs/n.md",
    "tree src",
    "xxd src/a.js",
    "npm run lint",
    "npm run format:check",
    "npm run ci:lokal",
    "npm run lint:strict",
    "npm test -- test/a.test.js",
    "gh issue comment 1 --body 'Code unter src/ bleibt'",
    "curl -s https://example.invalid/src/",
    "black docs",
    "black '' docs/n.md",
    "bash tools/x.sh docs/n.md",
    "make -C docs",
  ]);
});

test("Bash ohne Rolle bau: git-Unterbefehle, die den Arbeitsbaum ohne Pfad umschreiben, und Ausgabe-Optionen nach src/ sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "git read-tree -u HEAD",
    "git read-tree -m -u HEAD",
    "git sparse-checkout set docs",
    "git bisect start",
    "git filter-branch --tree-filter true",
    "git submodule update --init",
    "git unbekannt",
    "git -c alias.zz='!sed -i s/a/b/ src/a.js' zz",
    "git -c core.fsmonitor='sed -i s/a/b/ src/a.js' status",
    "git rebase --exec 'sed -i s/a/b/ src/a.js' upstream/master",
    "git rebase -x 'sed -i s/a/b/ src/a.js' upstream/master",
    "git diff --output=src/a.js",
    "git log --output src/a.js",
    "git archive -o src/x.tar HEAD",
    "git archive --output=src/x.tar HEAD",
    "git format-patch -o src HEAD~1",
    "git format-patch --output-directory=src HEAD~1",
    "git config --file src/x.cfg user.name x",
    "git clone . src",
    "git worktree add src",
  ]);
});

test("Bash ohne Rolle bau: git-Plumbing, das Objekte oder den Index schreibt, ist gesperrt, auch einzeln und als Kette", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "git hash-object -w --stdin",
    "git hash-object -w docs/n.md",
    "git hash-object --stdin-paths",
    "git update-index --add --cacheinfo 100644,e69de29bb2d1d6434b8b29ae775ad8c2e48c5391,src/a.js",
    "git update-index --refresh",
    "git commit-tree HEAD^{tree} -m neu",
    "git mktree",
    "git write-tree",
    "git fast-import",
    "git replace HEAD HEAD~1",
    "git mktag",
    "git read-tree HEAD",
    "GIT_INDEX_FILE=/tmp/probe.index git read-tree HEAD",
    "GIT_INDEX_FILE=/tmp/probe.index git write-tree",
    "git -C docs write-tree",
    "git hash-object -w --stdin < docs/n.md && git update-index --add --cacheinfo 100644,e69de29bb2d1d6434b8b29ae775ad8c2e48c5391,docs/n.md && git write-tree && git commit-tree HEAD -m neu && git merge neu",
  ]);
});

test("Bash ohne Rolle bau: Historie holen und lesen bleibt frei (rebase, merge, pull, cherry-pick, revert, switch, fetch, push)", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "git fetch upstream",
    "git rebase upstream/master",
    "git rebase --exec 'npm test' upstream/master",
    "git merge upstream/master",
    "git pull --rebase",
    "git cherry-pick HEAD~1",
    "git revert --no-edit HEAD",
    "git switch -c neu",
    "git push origin neu",
    "git branch -a",
    "git worktree list",
    "git worktree add .claude/worktrees/neu",
    "git config user.name",
    "git diff --output=/tmp/d.diff",
    "git format-patch -o /tmp/p HEAD~1",
    "git archive -o /tmp/x.tar HEAD",
    "git rev-list --count HEAD",
    "git rev-parse --show-toplevel",
    "git ls-files src",
    "git grep -i export src",
    "git grep -n export -- src",
    "git blame src/a.js",
    "git cat-file -p HEAD:src/a.js",
    "git commit -F msg.txt",
    "git commit --amend --no-edit",
    "git -c core.pager=cat log -3",
    "git log --stat -- src",
    "git show --stat HEAD",
    "git shortlog -sn",
    "git describe --tags",
    "git tag -l",
    "git remote -v",
  ]);
});

test("Bash ohne Rolle bau: eine Kette aus freigegebenen git-Befehlen holt keinen fremden Stand nach src/", (context) => {
  const repo = realpathSync(probeRepository(context, { "src/a.js": "export const a = 1;\n" }));
  const klon = realpathSync(mkdtempSync(join(tmpdir(), "probe-klon-")));
  context.after(() => rmSync(klon, { recursive: true, force: true }));
  const vorher = readFileSync(join(repo, "src/a.js"), "utf8");
  const befehle = [
    `git init -q ${klon}`,
    `git -C ${klon} fetch -q ${repo} HEAD`,
    `git -C ${klon} checkout -q FETCH_HEAD`,
    `printf 'export const a = 2;\\n' > ${klon}/src/a.js`,
    `git -C ${klon} -c user.name=p -c user.email=p@p.invalid -c commit.gpgsign=false commit -qam neu`,
    `git fetch -q ${klon} HEAD`,
    "git merge -q --ff-only FETCH_HEAD",
  ];
  for (const command of befehle) {
    if (bash(repo, command).status === BLOCKING_EXIT_CODE) continue;
    runIn(repo, "bash", ["-c", command]);
  }
  assert.equal(readFileSync(join(repo, "src/a.js"), "utf8"), vorher);
});

test("Bash ohne Rolle bau: Holen aus fremden Quellen, fremde Remotes und git-Konfiguration, die Quellen oder Hooks umlenkt, sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "git fetch /tmp/K HEAD",
    "git fetch ../K HEAD",
    "git fetch file:///tmp/K HEAD",
    "git fetch https://example.invalid/x.git",
    "git fetch fremd",
    "git fetch --depth 1 /tmp/K",
    "git fetch --multiple upstream /tmp/K",
    "git fetch --upload-pack='touch x' upstream",
    "git push --receive-pack='touch x' origin",
    "git pull --exec='touch x' upstream",
    "git clone https://example.invalid/x.git src",
    "git pull /tmp/K HEAD",
    "git pull --rebase file:///tmp/K",
    "git pull . neu",
    "git push /tmp/K HEAD:refs/heads/x",
    "git push --repo=/tmp/K",
    "git -C /tmp/K push ../repo HEAD:refs/heads/x",
    "git remote add fremd /tmp/K",
    "git remote rename fremd upstream",
    "git remote set-url upstream /tmp/K",
    "git clone /tmp/K /tmp/L",
    "git clone file:///tmp/K /tmp/L",
    "git clone --shared /tmp/K /tmp/L",
    "git clone --template=/tmp/vorlage https://example.invalid/x.git /tmp/L",
    "git init --template=/tmp/vorlage",
    "git bundle unbundle /tmp/b.bundle",
    "git unpack-objects < /tmp/pack",
    "git submodule add /tmp/K x",
    "git -c core.hooksPath=/tmp/h commit -m x",
    "git -c core.worktree=/tmp/K status",
    "git -c include.path=/tmp/c status",
    "git -c url./tmp/K.insteadOf=https://github.com/sundartha/vodafone-agent.git fetch upstream",
    "git -c remote.upstream.url=/tmp/K fetch upstream",
    "git config core.hooksPath /tmp/h",
    "git config --global core.hooksPath /tmp/h",
    "git config --local core.worktree /tmp/K",
    "git config include.path /tmp/c",
    "git config --file /tmp/c remote.upstream.url /tmp/K",
    "git config url./tmp/K.insteadOf https://github.com/sundartha/vodafone-agent.git",
    "git config remote.upstream.url /tmp/K",
    "git config remote.upstream.pushurl /tmp/K",
    "git config branch.master.remote /tmp/K",
    "git config core.fsmonitor 'sed -i s/a/b/ src/a.js'",
    "git config includeIf.gitdir:/x/.path /tmp/c",
    "git config submodule.x.url /tmp/K",
    "git config remote.pushdefault /tmp/K",
    "git config branch.master.pushremote /tmp/K",
    "git clone",
    "git --git-dir=/tmp/K/.git --work-tree=. checkout -f HEAD",
    "git --work-tree=/tmp/K add .",
    "git --exec-path=/tmp/x status",
    "git --namespace=x status",
  ]);
});

test("Bash ohne Rolle bau: git-Umgebungsvariablen, die Konfiguration, Hooks oder Arbeitsbaum umlenken, sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/tmp/h git commit -m x",
    "GIT_CONFIG_GLOBAL=/tmp/c git commit -m x",
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/tmp/h'\" git commit -m x",
    "GIT_DIR=/tmp/K/.git GIT_WORK_TREE=. git checkout -f HEAD",
    "GIT_WORK_TREE=/tmp/K git add .",
    "GIT_EXEC_PATH=/tmp/x git status",
    "GIT_TEMPLATE_DIR=/tmp/vorlage git init",
    "GIT_COMMON_DIR=/tmp/K/.git git status",
    "GIT_NAMESPACE=x git status",
    "HOME=/tmp/h git commit -m x",
    "XDG_CONFIG_HOME=/tmp/h git commit -m x",
    "export GIT_CONFIG_COUNT=1; git status",
    "export GIT_DIR=/tmp/K/.git && git status",
    "export HOME=/tmp/h; git commit -m x",
    "env GIT_CONFIG_GLOBAL=/tmp/c git status",
    "env -i GIT_DIR=/tmp/K/.git git status",
    "declare -x GIT_WORK_TREE=/tmp/K; git status",
    "sudo GIT_CONFIG_GLOBAL=/tmp/c git status",
    "bash -c 'GIT_CONFIG_GLOBAL=/tmp/c git status'",
    "xargs -n1 env GIT_DIR=/tmp/K/.git git status < /dev/null",
  ]);
});

test("Bash ohne Rolle bau: Schreiben in das git-Verzeichnis (Hooks, Konfiguration, alternates) ist gesperrt, Löschen dort nicht", (context) => {
  const { directory, worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "printf x > .git/hooks/pre-commit",
    "printf x >> .git/config",
    "printf x > .git",
    "printf x > .GIT/config",
    "printf /tmp/K/.git/objects >> .git/objects/info/alternates",
    `printf x > ${directory}/.git/hooks/pre-commit`,
    `tee ${directory}/.git/config < /tmp/c`,
    `cp /tmp/h ${directory}/.git/hooks/pre-commit`,
    `install -m 755 /tmp/h ${directory}/.git/hooks/pre-commit`,
    `mv /tmp/h ${directory}/.git/hooks/pre-commit`,
    `ln -s /tmp/h ${directory}/.git/hooks/pre-commit`,
    `sed -i s/a/b/ ${directory}/.git/config`,
    `touch ${directory}/.git/hooks/pre-commit`,
    `dd if=/tmp/h of=${directory}/.git/hooks/pre-commit`,
    `cp /tmp/h ${directory}/.git/hooks/`,
    `cp -t ${directory}/.git/hooks /tmp/h`,
  ]);
  assertFrei(worktree, [
    `rm -f ${directory}/.git/index.lock`,
    `rm ${directory}/.git/hooks/pre-commit`,
    `cat ${directory}/.git/config`,
    `cp ${directory}/.git/config /tmp/config.kopie`,
    "printf x > .gitignore",
    "touch .github/neu.yml",
    "mv .gitignore .gitignore.alt",
    "touch /tmp/probe.git/neu",
  ]);
});

test("Bash ohne Rolle bau: fetch, pull, push, Remotes, Konfiguration und Klonen von https bleiben frei", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "git fetch",
    "git fetch upstream",
    "git fetch upstream master",
    "git fetch origin",
    "git fetch --all --prune",
    "git fetch --depth 1 upstream",
    "git fetch --depth=1 origin master",
    "git fetch --jobs 4 upstream",
    "git pull --strategy ours upstream master",
    "git clone --branch main https://example.invalid/x.git /tmp/L",
    "git fetch --multiple upstream origin",
    "git fetch upstream master && git rebase upstream/master",
    "git pull",
    "git pull upstream master",
    "git pull --rebase upstream master",
    "git push",
    "git push origin neu",
    "git push --force-with-lease upstream HEAD:paket/x",
    "git remote",
    "git remote -v",
    "git remote show upstream",
    "git remote get-url upstream",
    "git remote update",
    "git remote remove alt",
    "git ls-remote upstream",
    "git config user.name",
    "git config --get core.hooksPath",
    "git config --get-regexp remote",
    "git config --list",
    "git config user.name 'Max Muster'",
    "git config user.email \"$EMAIL\"",
    "git config commit.gpgsign false",
    "git -c user.name=p -c user.email=p@p.invalid -c commit.gpgsign=false commit -m x",
    "git -c core.pager=cat log -3",
    "git clone https://example.invalid/x.git /tmp/L",
    "git clone --depth 1 https://example.invalid/x.git /tmp/L",
    "git clone git@example.invalid:x/y.git /tmp/L",
    "git init /tmp/L",
    "git init -q",
    "git worktree add .claude/worktrees/zwei",
    "env FOO=1 npm test",
    "export FOO=1; npm test",
    "HOME=/tmp/h npm test",
    "NODE_ENV=test git log -1",
  ]);
});

test("Bash ohne Rolle bau: git-Konfiguration auf der Befehlszeile und beim Setzen gilt nur für Schlüssel der Erlaubnisliste", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "git --config-env=core.hooksPath=HP commit -m x",
    "git --config-env core.hooksPath=HP commit -m x",
    "git --config-env=core.fsmonitor=FS status",
    "git --config-env=core.pager=cat log",
    "git --config-env core.pager=cat log",
    "git config user.names x",
    "git config user.name core.hooksPath /tmp/h",
    "git -c core.fsmonitor=true status",
    "git -c core.editor=true commit --amend",
    "git -c sequence.editor=true rebase -i HEAD~1",
    "git -c core.sshCommand=ssh fetch upstream",
    "git -c credential.helper=store fetch upstream",
    "git -c gpg.program=true commit -S -m x",
    "git -c diff.external=true diff",
    "git -c filter.x.smudge=cat checkout upstream/master",
    "git -c core.pager=less log",
    "git -c alias.x=status x",
    "git -c user.name=p -c core.hooksPath=/tmp/h commit -m x",
    "git config core.editor /tmp/e.sh",
    "git config sequence.editor true",
    "git config core.sshCommand ssh",
    "git config diff.external true",
    "git config alias.x status",
    "git --super-prefix=x status",
    "git --attr-source=HEAD status",
    "git --bare status",
    "git --noglob status",
    "git --paginate log",
    "git --no-replace-objects log",
    "git config --file /tmp/c.cfg user.name x",
    "git config core.autocrlf false",
  ]);
  assertFrei(worktree, [
    "git -c user.name=p -c user.email=p@p.invalid commit -m x",
    "git -c color.ui=never diff",
    "git -c core.pager=cat log -3",
    "git -c commit.gpgsign=false commit -m x",
    "git --config-env=user.name=NAME commit -m x",
    "git --no-pager log -3",
    "git -p log -3",
    "git --no-optional-locks status",
    "git --version",
    "git -C docs log -1",
    "git config user.name x",
    "git config pull.rebase true",
    "git config color.ui auto",
    "git config --global init.defaultBranch main",
  ]);
});

test("Bash ohne Rolle bau: git-Umgebungsvariablen außerhalb der Erlaubnisliste sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES=/tmp/K/.git/objects git cherry-pick abc",
    "GIT_OBJECT_DIRECTORY=/tmp/K git status",
    "GIT_INDEX_FILE=/tmp/i git add .",
    "GIT_SSH_COMMAND=true git fetch upstream",
    "GIT_SSH=true git fetch upstream",
    "GIT_ASKPASS=true git fetch upstream",
    "GIT_EXTERNAL_DIFF=true git diff",
    "GIT_PROXY_COMMAND=true git fetch upstream",
    "GIT_NO_REPLACE_OBJECTS=1 git log",
    "GIT_ATTR_SOURCE=HEAD git status",
    "export GIT_ALTERNATE_OBJECT_DIRECTORIES=/tmp/x; git status",
    "env GIT_OBJECT_DIRECTORY=/tmp/x git log",
    "bash -c 'GIT_INDEX_FILE=/tmp/i git add .'",
  ]);
  assertFrei(worktree, [
    "GIT_PAGER=cat git log -3",
    "GIT_TERMINAL_PROMPT=0 git fetch upstream",
    "GIT_EDITOR=true git commit --amend",
    "GIT_SEQUENCE_EDITOR=true git rebase -i HEAD~1",
    "GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p.invalid GIT_AUTHOR_DATE=2026-01-01T00:00:00 git commit -m x",
    "GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p.invalid GIT_COMMITTER_DATE=2026-01-01T00:00:00 git commit -m x",
    "GITHUB_TOKEN_NAME=x npm test",
  ]);
});

test("Bash ohne Rolle bau: abgekürzte Langoptionen werden wie die vollständige Option behandelt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "git fetch --mult upstream /tmp/K",
    "git fetch --upload-p=x upstream",
    "git fetch --ex=x upstream",
    "git push --rep=/tmp/K",
    "git push --rec=x origin",
    "git clone --templ=/tmp/v https://example.invalid/x.git /tmp/L",
    "git init --templ=/tmp/v",
    "git reset --har",
    "git reset --har HEAD~1",
    "git reset --kee HEAD~1",
    "git restore --staged --wor .",
    "git checkout-index --al",
    "git checkout-index --stdi",
    "git checkout-index --pre=src/ a.js",
    "git checkout-index --pref src/ a.js",
    "git apply --check --appl src.patch",
    "git diff --outp=src/a.js",
    "git log --out src/a.js",
    "git format-patch --output-d=src HEAD~1",
    "git config --fil src/x.cfg user.name x",
    "git rebase --exe 'sed -i s/a/b/ src/a.js' upstream/master",
    "git difftool --extc 'sed -i s/a/b/ src/a.js'",
    "sed --in-p s/a/b/ src/a.js",
    "tar --extr -f /tmp/x.tar",
    "npx --cal 'sed -i s/a/b/ src/a.js'",
    "prettier --wri docs/n.md src/a.js",
    "git apply --chec src.patch",
    "git restore --stag src/a.js",
    "git rm --cach src/a.js",
    "git clean --dr src",
    "gzip --tes src/a.js",
    "patch --dry docs/n.md < src.patch",
    "sort --outp=src/a.js docs/n.md",
    "cp --recu docs/n.md .",
  ]);
  assertFrei(worktree, [
    "git diff --stat",
    "git log --oneline -3",
    "git log --first-parent --follow -3",
    "git fetch --prune upstream",
    "git fetch --tags --force upstream",
    "git push --force-with-lease --follow-tags upstream HEAD:paket/x",
    "git status --short",
    "git rebase --continue",
    "git rebase --abort",
    "git commit --amend --no-edit",
    "git reset --soft HEAD~1",
    "git reset --mixed HEAD~1",
    "git clean --dry-run",
    "git restore --staged docs/n.md",
    "git rm --cached docs/n.md",
    "git apply --check docs.patch",
    "git apply --stat docs.patch",
  ]);
});

test("Bash ohne Rolle bau: ein Patch über einen duplizierten Deskriptor auf stdin ist gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "git apply 3< src.patch <&3",
    "patch -p1 3< src.patch <&3",
    "git apply 3< plain.patch <&3",
    "git apply 3< maskiert.patch <&3",
    "git am 3< docs.patch <&3",
  ]);
});

test("Bash ohne Rolle bau: die Befehle des Ablaufs mit src-Operand bleiben frei (auftrag karte/suche/dateien/kette/umfang, node --check, xargs, git diff -- src)", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "node tools/auftrag.mjs karte src/a.js",
    "node tools/auftrag.mjs suche -- export src",
    "node tools/auftrag.mjs suche export src/tief",
    "node tools/auftrag.mjs dateien src",
    "node tools/auftrag.mjs kette src/a.js:a src/tief/b.js:b",
    "find src scripts -type f \\( -name '*.js' -o -name '*.mjs' \\) -print0 | xargs -0 -n1 node --check",
    "git diff --name-only upstream/master HEAD -- src",
    "git diff --quiet HEAD -- src/",
    "git diff upstream/master HEAD --stat -- src/",
    "git push -u upstream paket/34-src",
    "PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true node src/a.js",
    "NODE_ENV=test npm test",
    "SCHWERLAUF_VORRANG=push npm run ci:lokal -- --basis abc",
    "ls scripts src",
    "node src",
    "npx eslint src/tief/b.js",
  ]);
});

test("Bash ohne Rolle bau: ein fremdes auftrag.mjs, ein anderer Unterbefehl und Befehle in Zuweisungen mit src/ sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "node fremd/tools/auftrag.mjs karte src/a.js",
    "bash tools/x.sh src/a.js",
    "sh tools/x.sh .",
    "node tools/auftrag.mjs lauf src/a.js",
    "node tools/auftrag.mjs karte src/a.js; node tools/x.mjs src/a.js",
    "GIT_SEQUENCE_EDITOR='sed -i s/a/b/ src/a.js' git rebase -i HEAD~1",
    "GIT_EDITOR='cp /tmp/neu.js src/a.js' git commit",
    "EDITOR='tee src/a.js' git commit",
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

test("Bash ohne Rolle bau: ein Verweis auf src/ und danach Schreiben durch den Verweis ist gesperrt, ebenso harte Verweise", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "ln -s src l && printf x > l/neu.js",
    "ln -s src l; cd l; touch neu.js",
    "ln -s ./src/ l && cat > l/neu.js",
    "ln -sf ../src /tmp/verweis-src",
    "ln -s -- src l",
    "ln -s s* l",
    "ln -t /tmp -s src",
    "ln src/a.js /tmp/hart.js",
    "ln src/a.js /tmp/hart.js && printf x > /tmp/hart.js",
    "cp -al src /tmp/kopie",
    "cp -l src/a.js /tmp/hart.js",
    "cp --link src/a.js /tmp/hart.js",
    "cp -s src/a.js /tmp/weich.js",
    "cp --symbolic-link src/a.js /tmp/weich.js",
    "rsync -a --link-dest=src docs /tmp/ziel",
    "ln -s docs l; echo src; printf x > l/neu.js",
    "ln -s $DIR l && printf x > l/neu.js; echo src",
  ]);
});

test("Bash ohne Rolle bau: nach einem Schreibbefehl sperrt ein weiterer Schreibbefehl, wenn src im Befehl vorkommt (Kette), Alias und Mount mit src sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "echo src > /tmp/n.txt && /tmp/s.sh",
    "echo src > /tmp/n.txt; printf x > /tmp/s.sh; chmod +x /tmp/s.sh; /tmp/s.sh",
    "cp docs/n.md /tmp/n.md; echo src; touch /tmp/n.md/x",
    "tee /tmp/n.txt < docs/n.md; echo src; rm /tmp/n.txt",
    "alias w=tee; w src/a.js",
    "mount -t nullfs src /tmp/m",
    "mount --bind src /tmp/m",
    "sed -i s/a/b/ /tmp/f; echo src; touch /tmp/g",
    "sed 'w /tmp/o' docs/n.md; echo src; touch /tmp/g",
    "awk '{print > \"/tmp/x\"}' docs/n.md; echo src; touch /tmp/g",
    "awk -i inplace '{print}' /tmp/f; echo src; touch /tmp/g",
    "sort -o /tmp/f docs/n.md; echo src; touch /tmp/g",
    "uniq docs/n.md /tmp/u; echo src; touch /tmp/g",
    "tree -o /tmp/t docs; echo src; touch /tmp/g",
    "xxd -r docs/n.md /tmp/x; echo src; touch /tmp/g",
    "timeout 60 cp docs/n.md /tmp/x; echo src; touch /tmp/g",
    "echo x > /tmp/f; echo src; printf x > /tmp/g",
    "echo x >> /tmp/f; echo src; printf x > /tmp/g",
    "echo x 2>&1 > /tmp/f; echo src; touch /tmp/g",
  ]);
});

test("Bash ohne Rolle bau: ein Interpreter oder eine Shell mit Skriptdatei außerhalb des Repos oder im selben Befehl geschrieben ist gesperrt, wenn src im Befehl vorkommt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "node /tmp/s.mjs; echo src",
    "python3 /tmp/s.py; ls src",
    "bash /tmp/s.sh; echo src",
    "sh ../../../../s.sh; echo src",
    "source /tmp/s.sh; echo src",
    ". /tmp/s.sh; echo src",
    "ruby /tmp/s.rb && ls src",
    "echo src > /tmp/n.txt; printf x > /tmp/s.mjs; node /tmp/s.mjs",
    "printf x > tools/s.mjs; node tools/s.mjs; ls src",
    "cat docs/n.md > /tmp/s.sh; bash /tmp/s.sh; echo src",
    "cp /tmp/s.mjs tools/s.mjs && node tools/s.mjs && ls src",
  ]);
});

test("Bash ohne Rolle bau: Verweise auf andere Ordner, ein einzelner Schreibbefehl, Lesen in Ketten und Skripte im Repo bleiben frei", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "ln -s docs /tmp/l-docs",
    "ln -s test /tmp/l-test && printf x > /tmp/l-test/neu.js",
    "ln -s /tmp/x l-extern",
    "cp -l docs/n.md /tmp/hart.md",
    "cp src/a.js /tmp/kopie.js",
    "cp -r src /tmp/kopie-src",
    "grep -rn export src > /tmp/treffer.txt",
    "grep export src | sort | uniq -c",
    "git diff -- src > /tmp/d.patch && cat /tmp/d.patch",
    "mkdir -p /tmp/k && cp src/a.js /tmp/k/",
    "find src -name '*.js' | xargs grep export",
    "git add docs/n.md && git commit -qm 'src bleibt unberührt'",
    "node /tmp/s.mjs",
    "python3 /tmp/s.py",
    "bash /tmp/s.sh",
    "node test/a.test.js && ls src",
    "node tools/auftrag.mjs karte src/a.js && node tools/auftrag.mjs suche export src",
    "python3 -I docs/x.py; ls src",
    "bash docs/x.sh; ls src",
    "timeout 60 npm test && ls src",
    "export X=1; ls src",
    "timeout 60 npm test && printf x > /tmp/f; echo src",
    "printf x > /tmp/f; cd docs; echo src",
    "printf x > /tmp/f; pushd docs; popd; echo src",
    "printf x > /tmp/f; export X=1; unset X; set -e; echo src",
    "printf x > /tmp/f; grep -rn export src; npm test; gh pr view; git status; cat docs/n.md | head",
    "sed -n 1,5p src/a.js | awk '{print $1}' | sort | uniq; printf x > /tmp/f; echo src; sed -n 1p docs/n.md; xxd docs/n.md; tree docs",
    "cat docs/n.md 2>&1; echo src; touch /tmp/g",
    "printf x > /tmp/f 2>/dev/null; echo src; ls /tmp > /dev/null",
    "printf x > /tmp/f; echo src >/dev/stderr; echo src >/dev/stdout; echo src >/dev/tty",
    "cat < docs/n.md; echo src; touch /tmp/g",
    "FOO=1 BAR=2 cat docs/n.md; echo src; touch /tmp/g",
    "FOO=1; echo src; touch /tmp/g",
    "touch /tmp/a; echo src; touch /tmp/g",
    "rm -f /tmp/a; echo src; touch /tmp/g",
    "node ../s.mjs; echo src",
  ]);
});

test("Bash ohne Rolle bau: npm, pnpm und yarn führen mit exec, dlx, x, node, run oder -c keinen Befehl aus, der src/ ändert", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "npm exec -c 'rm src/a.js'",
    "npm exec --call 'rm src/a.js'",
    "npm exec --call='rm src/a.js'",
    "npm exec -- sh -c 'rm src/a.js'",
    "npm exec --package=foo -- rm src/a.js",
    "npm x -- rm src/a.js",
    "npm --prefix docs exec -- rm src/a.js",
    "yarn node -e \"require('fs').rmSync('src/a.js')\"",
    "yarn exec rm src/a.js",
    "yarn run node -e 'x' src",
    "pnpm dlx sh -c 'rm src/a.js'",
    "pnpm exec rm src/a.js",
    "pnpm node -e 'x' src",
    "npm run node -- -e 'x' src",
    "npm explore foo -- rm src/a.js",
    "npm link ../src",
    "npm install ./src",
    "npm install file:src",
    "npm config set script-shell /tmp/sh.sh",
    "npm --script-shell /tmp/sh.sh run lint; echo src",
    "npm run lint --script-shell=/tmp/sh.sh; echo src",
    "npm exec -c 'sh /tmp/s.sh'; echo src",
  ]);
});

test("Bash ohne Rolle bau: Lese- und Prüfprogramme mit Option für einen Befehl, eine Konfiguration oder ein Plugin außerhalb des Repos sind gesperrt, wenn src im Befehl vorkommt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "rg --pre rm export src",
    "rg --pre=rm export src",
    "rg --hostname-bin 'rm src/a.js' x docs",
    "bat --pager 'rm src/a.js' docs/n.md",
    "ag --pager 'rm src/a.js' export docs",
    "ack --pager='rm src/a.js' export docs",
    "less +'!rm src/a.js' docs/n.md",
    "sort --compress-program 'rm src/a.js' docs/n.md",
    "tar -cf /tmp/x.tar --checkpoint=1 --checkpoint-action=exec='rm src/a.js' docs",
    "rsync -e 'rm src/a.js' docs /tmp/x",
    "eslint -c /tmp/evil.js docs; echo src",
    "eslint --config /tmp/evil.js docs; echo src",
    "eslint --resolve-plugins-relative-to /tmp docs; echo src",
    "knip -c /tmp/k.js; echo src",
    "node -r /tmp/e.js docs/x.js; echo src",
    "node --require /tmp/e.js docs/x.js; echo src",
    "node --import /tmp/e.mjs docs/x.js; echo src",
    "ruby -r /tmp/e.rb docs/x.rb; echo src",
    "curl -K /tmp/c.conf; echo src",
    "curl --config /tmp/c.conf; echo src",
    "gitleaks detect --report-path src/r.json",
    "ssh -o ProxyCommand='rm src/a.js' host",
    "ssh -o 'LocalCommand=rm src/a.js' host",
    "tsc -p /tmp/tsconfig.json; echo src",
    "tsc --outDir src",
    "tsc --outdir=src",
    "file -C -m src/zz",
    "make -f /tmp/M; echo src",
    "gh alias set w '!rm src/a.js'",
    "gh extension install /tmp/x",
    "gh extension exec x",
    "gh config set browser 'rm src/a.js'",
  ]);
});

test("Bash ohne Rolle bau: Umgebungsvariablen, die ein Programm Code laden lassen, sind gesperrt, wenn src im Befehl vorkommt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "NODE_OPTIONS='--require /tmp/e.js' node docs/x.js; echo src",
    "LESSOPEN='|rm %s' less docs/n.md; echo src",
    "RIPGREP_CONFIG_PATH=/tmp/rg.conf rg x docs; echo src",
    "BAT_CONFIG_PATH=/tmp/b.conf bat docs/n.md; echo src",
    "export BASH_ENV=/tmp/e.sh; echo src",
    "env PAGER=x ls; echo src",
    "PATH=/tmp/bin ls; echo src",
    "PYTHONSTARTUP=/tmp/p.py python3 docs/x.py; echo src",
    "npm_config_script_shell=/tmp/sh.sh npm test; echo src",
    "EDITOR=x git commit; echo src",
  ]);
});

test("Bash ohne Rolle bau: npm, pnpm, yarn und Prüfprogramme ohne Ausführungs-Option, Umgebungsvariablen ohne src und Konfiguration im Repo bleiben frei", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "npm test",
    "npm test -- test/werkzeuge/src-schutz-bash.test.js",
    "npm run lint",
    "npm run ci:lokal -- --basis abc",
    "npm exec -- eslint docs",
    "npm exec -c 'eslint docs'",
    "yarn lint",
    "pnpm test",
    "pnpm exec eslint docs",
    "npm ci",
    "npm install",
    "npm install lodash",
    "npm ls",
    "npm config get registry",
    "rg export src",
    "rg --pre-glob '*.js' export src",
    "bat --paging=never docs/n.md",
    "less docs/n.md",
    "sort docs/n.md",
    "tar -cf /tmp/x.tar docs",
    "rsync -a docs /tmp/x",
    "eslint docs",
    "eslint -c eslint.config.js src/tief/b.js",
    "tsc --noEmit",
    "tsc -p tsconfig.json --noEmit; echo src",
    "knip",
    "node -r dotenv/config docs/x.js; echo src",
    "ssh host ls",
    "curl -s https://example.com/x",
    "curl -K docs/c.conf; echo src",
    "gitleaks detect --report-path /tmp/r.json",
    "file docs/n.md",
    "gh pr view 1",
    "gh alias list",
    "gh config get editor",
    "gh extension list",
    "NODE_OPTIONS=--max-old-space-size=4096 node docs/x.js",
    "PORT=1 node docs/x.js",
    "make test",
    "PAGER=cat git log -1; echo src",
  ]);
});

test("Bash ohne Rolle bau: jede Option eines Programms, die einen Befehl, eine Konfiguration oder Code lädt, sperrt bei src im Befehl", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "rsync -e 'rm s*' docs /tmp/x",
    "tar -I 'rm src/a.js' -cf /tmp/x.tar docs",
    "tar --use-compress-program 'rm src/a.js' -cf /tmp/x.tar docs",
    "tar --to-command 'rm src/a.js' -xf /tmp/x.tar",
    "rsync --rsh 'rm src/a.js' docs /tmp/x",
    "scp -o ProxyCommand='rm src/a.js' a b",
    "sftp -o ProxyCommand='rm src/a.js' host",
    "eslint --plugin /tmp/p.js docs; echo src",
    "eslint --parser /tmp/p.js docs; echo src",
    "eslint --rulesdir /tmp/r docs; echo src",
    "prettier --config /tmp/p.js docs; echo src",
    "prettier --plugin /tmp/p.js docs; echo src",
    "markdownlint -c /tmp/m.json docs; echo src",
    "jscpd -c /tmp/j.json docs; echo src",
    "gitleaks -c /tmp/g.toml detect; echo src",
    "semgrep -c /tmp/r.yml docs; echo src",
    "semgrep -f /tmp/r.yml docs; echo src",
    "semgrep --config /tmp/r.yml docs; echo src",
    "commitlint -g /tmp/c.js; echo src",
    "commitlint --config /tmp/c.js; echo src",
    "tsc --project /tmp/t.json; echo src",
    "tsc -b /tmp/t.json; echo src",
    "tsc --build /tmp/t.json; echo src",
    "shellcheck --rcfile /tmp/rc docs/x.sh; echo src",
    "node --loader /tmp/l.mjs docs/x.js; echo src",
    "node --experimental-loader /tmp/l.mjs docs/x.js; echo src",
    "bun -r /tmp/e.js docs/x.js; echo src",
    "npm --userconfig /tmp/rc test; echo src",
    "npm --globalconfig /tmp/rc test; echo src",
    "npm --node-options=--require=/tmp/e.js test; echo src",
    "pnpm --userconfig /tmp/rc test; echo src",
    "yarn --script-shell /tmp/s run lint; echo src",
    "npx --userconfig /tmp/rc eslint docs; echo src",
  ]);
});

test("Bash ohne Rolle bau: Unterbefehle von npm, pnpm und yarn, die Befehle ausführen, Pakete verlinken oder die Konfiguration ändern, und gh-Befehle, die Befehle ablegen, sind gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "npm create foo -- rm src/a.js",
    "npm init foo -- rm src/a.js",
    "npm innit foo -- rm src/a.js",
    "npm run-script node -- -e x src",
    "npm rum node -- -e x src",
    "npm urn node -- -e x src",
    "npm ln ../src",
    "npm i ./src",
    "npm add ./src",
    "npm install-test ./src",
    "npm it ./src",
    "npm c set script-shell /tmp/s",
    "npm config edit",
    "npm config delete x",
    "npm config fix",
    "npm set script-shell=/tmp/s",
    "pnpm config set x y",
    "yarn config set x y",
    "gh alias import /tmp/a.yml",
    "gh extension create x",
    "gh extension upgrade --all",
    "npm run rm -- src/a.js",
    "gtar -I 'rm src/a.js' -cf /tmp/x.tar docs",
    "bsdtar -I 'rm src/a.js' -cf /tmp/x.tar docs",
    "tar --to-command=rm -xf /tmp/x.tar -C docs; echo src",
    "tar --rsh-command=rm -cf host:x docs; echo src",
    "pnpm --node-options=--require=/tmp/e.js test; echo src",
    "yarn --node-options=--require=/tmp/e.js test; echo src",
    "npx --node-options=--require=/tmp/e.js eslint docs; echo src",
    "knip --config /tmp/k.js; echo src",
    "markdownlint --config /tmp/m.json docs; echo src",
    "jscpd --config /tmp/j.json docs; echo src",
    "gitleaks --config /tmp/g.toml detect; echo src",
    "node --require=/tmp/e.js docs/x.js; echo src",
    "node --import=/tmp/e.mjs docs/x.js; echo src",
    "node --loader=/tmp/l.mjs docs/x.js; echo src",
    "node --experimental-loader=/tmp/l.mjs docs/x.js; echo src",
    "bun --require=/tmp/e.js docs/x.js; echo src",
    "ruby --require=/tmp/e.rb docs/x.rb; echo src",
    "npx --userconfig=/tmp/rc eslint docs; echo src",
    "node -r/usr/x.js docs/x.js; echo src",
    "bun -r/usr/x.js docs/x.js; echo src",
    "ruby -r/usr/x.rb docs/x.rb; echo src",
    "npm run-script rm -- src/a.js",
    "npm rum rm -- src/a.js",
    "npm urn rm -- src/a.js",
    "npm run python3 -- -c 'x' src",
    "npm run lint -- --fix src",
    "node -r/tmp/e.js docs/x.js; echo src",
    "ruby -r/tmp/e.rb docs/x.rb; echo src",
    "bun -r/tmp/e.js docs/x.js; echo src",
    "gh repo clone o/r src",
    "npm install link:src",
    "true || cd /tmp; node x.js; echo src",
    "actionlint -shellcheck /tmp/x; echo src",
    "actionlint -pyflakes /tmp/x; echo src",
  ]);
});

test("Bash ohne Rolle bau: Umgebungsvariablen, die Code, Konfiguration oder Pager laden, sind bei src im Befehl gesperrt", (context) => {
  const { worktree } = worktreeProbe(context);
  assertGesperrt(worktree, [
    "NODE_PATH=/tmp/m ls; echo src",
    "ENV=/tmp/e ls; echo src",
    "PROMPT_COMMAND=x ls; echo src",
    "CDPATH=/tmp ls; echo src",
    "IFS=x ls; echo src",
    "LD_PRELOAD=/tmp/l.so ls; echo src",
    "DYLD_INSERT_LIBRARIES=/tmp/l.dylib ls; echo src",
    "PYTHONPATH=/tmp ls; echo src",
    "PERL5OPT=-M/tmp/p ls; echo src",
    "RUBYOPT=-r/tmp/r ls; echo src",
    "NPM_CONFIG_USERCONFIG=/tmp/rc ls; echo src",
    "YARN_RC_FILENAME=/tmp/rc ls; echo src",
    "PNPM_HOME=/tmp ls; echo src",
    "BAT_PAGER=/tmp/p ls; echo src",
    "EDITOR=/tmp/e ls; echo src",
    "VISUAL=/tmp/e ls; echo src",
    "PAGER=/tmp/e ls; echo src",
    "MANPAGER=/tmp/e ls; echo src",
    "GH_PAGER=/tmp/e ls; echo src",
    "GH_EDITOR=/tmp/e ls; echo src",
    "GH_BROWSER=/tmp/e ls; echo src",
    "BROWSER=/tmp/e ls; echo src",
    "SHELL=/tmp/e ls; echo src",
    "LESSOPEN=/tmp/e ls; echo src",
    "LESSCLOSE=/tmp/e ls; echo src",
  ]);
});

test("Bash ohne Rolle bau: Shell-Eingebautes, harmlose Pager und Konfiguration außerhalb des Repos ohne src im Befehl bleiben frei", (context) => {
  const { worktree } = worktreeProbe(context);
  assertFrei(worktree, [
    "unset X; set -e; shift; local Y=1; declare Z=1; typeset W=1; popd; return; break; continue; ls src",
    "export X=1; ls src",
    "EDITOR=true git commit; echo src",
    "GH_PAGER=less gh pr view 1; echo src",
    "PAGER=more git log -1; echo src",
    "eslint -c /tmp/eslint.config.js docs",
    "less +F docs/n.md",
    "tsc -p /tmp/tsconfig.json --noEmit",
    "NODE_PATH=/tmp/m ls",
    "node -r /tmp/e.js docs/x.js",
    "chmod +x docs/x.sh; echo src",
    "date +%s; echo src",
    "npm run lint -- src/tief/b.js",
    "npm exec -- eslint src",
    "file src/a.js",
    "PAGER= git log -1; echo src",
    "grep export < src/a.js",
    "cat src/a.js 2>&1 | head",
  ]);
});
