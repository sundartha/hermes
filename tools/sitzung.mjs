import { spawn, spawnSync } from "node:child_process";
import { env } from "node:process";
import { parseArgs } from "node:util";

const BOT_LOGIN = "sundartha-bot";
const KEYCHAIN_SERVICE = "sundartha-bot-github-token";
const GITHUB_API = "https://api.github.com";
const UPSTREAM_PREFIX = "https://github.com/sundartha/";
const BRANCH_PREFIX = "paket/";
const WORKTREE_PATH_PATTERN = /\/\.claude\/worktrees\/[^/]+$/;
const MODELS = ["opus", "sonnet"];
const DEFAULT_MODEL = "opus";
const TOKEN_OVERRIDE_VARIABLE = "SITZUNG_TOKEN";
const API_OVERRIDE_VARIABLE = "SITZUNG_GITHUB_API";
const EXIT_FAILURE = 1;

function parseOptions() {
  const { values } = parseArgs({
    options: {
      modell: { type: "string", default: DEFAULT_MODEL },
      "nur-pruefen": { type: "boolean", default: false },
    },
  });
  if (!MODELS.includes(values.modell)) {
    throw new Error(`Unbekanntes Modell ${values.modell}; erlaubt sind ${MODELS.join(" und ")}.`);
  }
  return { model: values.modell, checkOnly: values["nur-pruefen"] };
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} ist gescheitert: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function checkWorkspace() {
  const topLevel = git(["rev-parse", "--show-toplevel"]);
  if (!WORKTREE_PATH_PATTERN.test(topLevel)) {
    throw new Error(`${topLevel} liegt nicht unter .claude/worktrees/.`);
  }
  const [gitDir, commonDir] = git([
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
    "--git-common-dir",
  ]).split("\n");
  if (gitDir === commonDir) throw new Error(`${topLevel} ist kein verknüpfter Worktree.`);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch.startsWith(BRANCH_PREFIX)) {
    throw new Error(`Der Branch ${branch} beginnt nicht mit ${BRANCH_PREFIX}.`);
  }
  const upstream = git(["remote", "get-url", "upstream"]);
  if (!upstream.startsWith(UPSTREAM_PREFIX)) {
    throw new Error(`upstream zeigt auf ${upstream}, erwartet ist ${UPSTREAM_PREFIX}…`);
  }
}

function readToken() {
  if (env[TOKEN_OVERRIDE_VARIABLE]) return env[TOKEN_OVERRIDE_VARIABLE];
  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", BOT_LOGIN, "-w"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Kein Token im Schlüsselbund unter ${KEYCHAIN_SERVICE} (Konto ${BOT_LOGIN}).`);
  }
  return result.stdout.trim();
}

async function fetchIdentity(token) {
  const response = await fetch(`${env[API_OVERRIDE_VARIABLE] || GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "hermes-sitzung",
    },
  });
  if (!response.ok) throw new Error(`GitHub lehnt das Token ab (HTTP ${response.status}).`);
  const { login, id } = await response.json();
  if (login !== BOT_LOGIN) {
    throw new Error(`Das Token gehört zu ${login}, erwartet ist ${BOT_LOGIN}.`);
  }
  return { login, id };
}

function sessionEnvironment(token, { login, id }) {
  const gitSettings = [
    ["credential.helper", ""],
    ["credential.helper", `!f() { echo username=${login}; echo "password=$GH_TOKEN"; }; f`],
    ["user.name", login],
    ["user.email", `${id}+${login}@users.noreply.github.com`],
  ];
  const gitVariables = gitSettings.flatMap(([key, value], index) => [
    [`GIT_CONFIG_KEY_${index}`, key],
    [`GIT_CONFIG_VALUE_${index}`, value],
  ]);
  return {
    ...env,
    ...Object.fromEntries(gitVariables),
    GIT_CONFIG_COUNT: String(gitSettings.length),
    GH_TOKEN: token,
  };
}

function startSession(model, sessionEnv) {
  const child = spawn(
    "caffeinate",
    ["-i", "claude", "--model", model, "--permission-mode", "acceptEdits"],
    { stdio: "inherit", env: sessionEnv },
  );
  child.on("error", (error) => {
    console.error(`Abbruch: caffeinate ließ sich nicht starten (${error.message}).`);
    process.exitCode = EXIT_FAILURE;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? EXIT_FAILURE;
  });
}

async function main() {
  const { model, checkOnly } = parseOptions();
  checkWorkspace();
  const token = readToken();
  const identity = await fetchIdentity(token);
  if (checkOnly) {
    console.log(identity.login);
    return;
  }
  startSession(model, sessionEnvironment(token, identity));
}

main().catch((error) => {
  console.error(`Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
});
