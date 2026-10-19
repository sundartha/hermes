import { spawn, spawnSync } from "node:child_process";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { env, execPath, pid } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const APP_ID = "5250443";
const INSTALLATION_ID = "169596050";
const KEYCHAIN_SERVICE = "sundartha-agent-github-app-key";
const KEYCHAIN_ACCOUNT = APP_ID;
const BOT_LOGIN = "sundartha-agent[bot]";
const BOT_USER_ID = 340129717;
const BOT_EMAIL = `${BOT_USER_ID}+${BOT_LOGIN}@users.noreply.github.com`;
const EXPECTED_REPOSITORIES = ["sundartha/hermes"];
const GIT_USERNAME = "x-access-token";
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MIN_REMAINING_MINUTES = 10;
const MIN_REMAINING_MS = MIN_REMAINING_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;
const JWT_BACKDATE_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 540;
const JWT_HEADER = { alg: "RS256", typ: "JWT" };
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const FIRST_RETRY_PAUSE_SECONDS = 2;
const SECOND_RETRY_PAUSE_SECONDS = 5;
const RETRY_PAUSES_MS = [
  FIRST_RETRY_PAUSE_SECONDS * MS_PER_SECOND,
  SECOND_RETRY_PAUSE_SECONDS * MS_PER_SECOND,
];
const MAX_ATTEMPTS = RETRY_PAUSES_MS.length + 1;
const DEFAULT_PAUSE_SCALE = 1;
const GITHUB_API = "https://api.github.com";
const USER_AGENT = "hermes-sitzung";
const UPSTREAM_PREFIX = "https://github.com/sundartha/";
const BRANCH_PREFIX = "paket/";
const ORDER_FILE_PATTERN = /^prompt-(paket-.+)\.md$/;
const WORKTREE_PATH_PATTERN = /\/\.claude\/worktrees\/[^/]+$/;
const MODELS = ["opus", "sonnet"];
const DEFAULT_MODEL = "opus";
const API_OVERRIDE_VARIABLE = "SITZUNG_GITHUB_API";
const STORE_PREFIX = "sitzung-app-";
const STORE_SCRIPT = "sitzung.mjs";
const STORE_TOKEN = "token.json";
const STORE_BIN = "bin";
const GH = "gh";
const SCRIPT_MODE = 0o500;
const TOKEN_MODE = 0o600;
const PRIVATE_MODE = 0o700;
const SINGLE_QUOTE = /'/g;
const ESCAPED_SINGLE_QUOTE = "'\\''";
const EXIT_FAILURE = 1;

function parsePauseScale(value) {
  if (value === undefined) return DEFAULT_PAUSE_SCALE;
  const scale = Number(value);
  if (value.trim() === "" || !Number.isFinite(scale) || scale < 0) {
    throw new Error(`--wiederholpause-faktor erwartet eine Zahl ab 0, nicht „${value}“.`);
  }
  return scale;
}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      modell: { type: "string", default: DEFAULT_MODEL },
      "nur-pruefen": { type: "boolean", default: false },
      auftrag: { type: "string" },
      zugang: { type: "boolean", default: false },
      ablage: { type: "string" },
      "wiederholpause-faktor": { type: "string" },
    },
  });
  if (!MODELS.includes(values.modell)) {
    throw new Error(`Unbekanntes Modell ${values.modell}; erlaubt sind ${MODELS.join(" und ")}.`);
  }
  if (values.zugang !== (values.ablage !== undefined)) {
    throw new Error("--zugang und --ablage <ordner> gehören zusammen.");
  }
  return {
    model: values.modell,
    checkOnly: values["nur-pruefen"],
    orderFile: values.auftrag,
    store: values.ablage,
    pauseScale: parsePauseScale(values["wiederholpause-faktor"]),
  };
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
  return branch;
}

function readOrder(orderFile, branch) {
  const fileName = basename(orderFile);
  const expectedBranch = fileName.match(ORDER_FILE_PATTERN)?.[1].replace(/^paket-/, BRANCH_PREFIX);
  if (expectedBranch !== branch) {
    throw new Error(`Der Auftrag ${fileName} gehört nicht zum Branch ${branch}.`);
  }
  let order;
  try {
    order = readFileSync(orderFile, "utf8");
  } catch {
    throw new Error(`Der Auftrag ${orderFile} lässt sich nicht lesen.`);
  }
  if (order.trim() === "") throw new Error(`Der Auftrag ${orderFile} ist leer.`);
  return order;
}

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findGh() {
  const directories = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const found = directories.map((directory) => join(directory, GH)).find(isExecutableFile);
  if (found === undefined) throw new Error("gh ist nicht installiert.");
  return found;
}

function readPrivateKey() {
  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `Kein Schlüssel im Schlüsselbund unter ${KEYCHAIN_SERVICE} (Konto ${KEYCHAIN_ACCOUNT}).`,
    );
  }
  try {
    return createPrivateKey(Buffer.from(result.stdout.trim(), "base64").toString("utf8"));
  } catch {
    throw new Error(`Der Eintrag ${KEYCHAIN_SERVICE} ist kein gültiger privater Schlüssel.`);
  }
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function appJwt(key) {
  const now = Math.floor(Date.now() / MS_PER_SECOND);
  const claims = { iat: now - JWT_BACKDATE_SECONDS, exp: now + JWT_LIFETIME_SECONDS, iss: APP_ID };
  const unsigned = `${base64url(JWT_HEADER)}.${base64url(claims)}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), key).toString("base64url")}`;
}

async function sendOnce(url, init) {
  try {
    return { response: await fetch(url, init) };
  } catch (error) {
    return { error };
  }
}

function isTransientStatus(status) {
  return status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR;
}

function retryPause(attempt, pauseScale) {
  return RETRY_PAUSES_MS[attempt - 1] * pauseScale;
}

function describeNetworkError({ message, cause }) {
  const code = cause?.code;
  return code === undefined ? message : `${message}: ${code}`;
}

function attemptNote(attempts) {
  return attempts > 1 ? ` nach ${attempts} Versuchen` : "";
}

async function githubRequest(path, { method, bearer, pauseScale = DEFAULT_PAUSE_SCALE }) {
  const url = `${env[API_OVERRIDE_VARIABLE] || GITHUB_API}${path}`;
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
  };
  for (let attempt = 1; ; attempt += 1) {
    const { response, error } = await sendOnce(url, init);
    if (error === undefined && !isTransientStatus(response.status)) {
      return { response, attempts: attempt };
    }
    if (attempt === MAX_ATTEMPTS) {
      if (error === undefined) return { response, attempts: attempt };
      throw new Error(
        `GitHub ist nicht erreichbar nach ${attempt} Versuchen (${describeNetworkError(error)}).`,
      );
    }
    await sleep(retryPause(attempt, pauseScale));
  }
}

async function createInstallationToken(key, pauseScale) {
  const { response, attempts } = await githubRequest(
    `/app/installations/${INSTALLATION_ID}/access_tokens`,
    { method: "POST", bearer: appJwt(key), pauseScale },
  );
  if (response.status !== HTTP_CREATED) {
    throw new Error(
      `GitHub gibt kein Installations-Token aus (HTTP ${response.status}${attemptNote(attempts)}).`,
    );
  }
  const { token, expires_at: expiresAt } = await response.json();
  return { token, expires_at: expiresAt };
}

async function checkInstallation(token, pauseScale) {
  const { response, attempts } = await githubRequest("/installation/repositories?per_page=100", {
    method: "GET",
    bearer: token,
    pauseScale,
  });
  if (response.status !== HTTP_OK) {
    throw new Error(
      `GitHub lehnt das Installations-Token ab (HTTP ${response.status}${attemptNote(attempts)}).`,
    );
  }
  const { total_count: totalCount, repositories } = await response.json();
  const names = repositories.map(({ full_name: fullName }) => fullName);
  const expected = EXPECTED_REPOSITORIES.join(", ");
  if (totalCount !== EXPECTED_REPOSITORIES.length || names.join(", ") !== expected) {
    const seen = names.join(", ") || "kein Repo";
    throw new Error(
      `Die App sieht ${seen} (insgesamt ${totalCount}), erwartet ist nur ${expected}.`,
    );
  }
}

function writeTokenFile(store, installationToken) {
  const temporary = join(store, `${STORE_TOKEN}.${pid}.${randomUUID()}`);
  writeFileSync(temporary, JSON.stringify(installationToken), { mode: TOKEN_MODE, flag: "wx" });
  renameSync(temporary, join(store, STORE_TOKEN));
}

function readCachedToken(store) {
  try {
    return JSON.parse(readFileSync(join(store, STORE_TOKEN), "utf8"));
  } catch {
    throw new Error(`In der Ablage ${store} liegt kein lesbares Token.`);
  }
}

async function accessToken(store) {
  const cached = readCachedToken(store);
  if (Date.parse(cached.expires_at) - Date.now() >= MIN_REMAINING_MS) return cached.token;
  const fresh = await createInstallationToken(readPrivateKey());
  writeTokenFile(store, fresh);
  return fresh.token;
}

function shellQuote(value) {
  return `'${value.replace(SINGLE_QUOTE, ESCAPED_SINGLE_QUOTE)}'`;
}

function helperCommand(store) {
  const script = shellQuote(join(store, STORE_SCRIPT));
  return `${shellQuote(execPath)} ${script} --zugang --ablage ${shellQuote(store)}`;
}

function ghWrapper(store, realGh) {
  return [
    "#!/bin/sh",
    `GH_TOKEN="$(${helperCommand(store)})" || exit 1`,
    "export GH_TOKEN",
    `exec ${shellQuote(realGh)} "$@"`,
    "",
  ].join("\n");
}

function removeStore(store) {
  rmSync(store, { recursive: true, force: true });
}

function createStore(installationToken, realGh) {
  const store = mkdtempSync(join(tmpdir(), STORE_PREFIX));
  try {
    const script = join(store, STORE_SCRIPT);
    copyFileSync(fileURLToPath(import.meta.url), script);
    chmodSync(script, SCRIPT_MODE);
    writeTokenFile(store, installationToken);
    mkdirSync(join(store, STORE_BIN), { mode: PRIVATE_MODE });
    writeFileSync(join(store, STORE_BIN, GH), ghWrapper(store, realGh), { mode: PRIVATE_MODE });
  } catch (error) {
    removeStore(store);
    throw error;
  }
  return store;
}

function sessionEnvironment(token, store) {
  const gitSettings = [
    ["credential.helper", ""],
    [
      "credential.helper",
      `!f() { token="$(${helperCommand(store)})" || exit 1; echo username=${GIT_USERNAME}; echo "password=$token"; }; f`,
    ],
    ["user.name", BOT_LOGIN],
    ["user.email", BOT_EMAIL],
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
    PATH: `${join(store, STORE_BIN)}${delimiter}${env.PATH}`,
  };
}

function startSession({ model, order, token, store }) {
  const claudeArguments = ["--model", model, "--permission-mode", "acceptEdits"];
  if (order !== undefined) claudeArguments.push("--", order);
  process.on("SIGINT", () => {});
  const child = spawn("caffeinate", ["-i", "claude", ...claudeArguments], {
    stdio: "inherit",
    env: sessionEnvironment(token, store),
  });
  child.on("error", (error) => {
    removeStore(store);
    console.error(`Abbruch: caffeinate ließ sich nicht starten (${error.message}).`);
    process.exitCode = EXIT_FAILURE;
  });
  child.on("exit", (code) => {
    removeStore(store);
    process.exitCode = code ?? EXIT_FAILURE;
  });
}

async function startMode({ model, checkOnly, orderFile, pauseScale }) {
  const branch = checkWorkspace();
  const order = orderFile === undefined ? undefined : readOrder(orderFile, branch);
  const realGh = checkOnly ? undefined : findGh();
  const installationToken = await createInstallationToken(readPrivateKey(), pauseScale);
  await checkInstallation(installationToken.token, pauseScale);
  if (checkOnly) {
    console.log(BOT_LOGIN);
    return;
  }
  const store = createStore(installationToken, realGh);
  startSession({ model, order, token: installationToken.token, store });
}

async function main() {
  const options = parseOptions();
  if (options.store === undefined) {
    await startMode(options);
    return;
  }
  process.stdout.write(await accessToken(options.store));
}

main().catch((error) => {
  console.error(`Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
});
