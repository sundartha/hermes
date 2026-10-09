import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { REPO_ROOT, isolatedEnvironment, probeDirectory } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/soll-vergleich.mjs");
const SOLL = join(REPO_ROOT, ".github/soll/einstellungen.json");
const RECORDINGS = join(REPO_ROOT, "test/werkzeuge/soll-vergleich");
const BASE = "/repos/sundartha/hermes";
const RULESET = `${BASE}/rulesets/24128981`;
const RULESETS = `${BASE}/rulesets`;
const PHASE_RULESET = `${BASE}/rulesets/24519520`;
const PHASE = "phase-schutz";
const PHASE_AREA = `Ruleset ${PHASE}`;
const COLLABORATORS = `${BASE}/collaborators`;
const CODEOWNERS = `${BASE}/contents/.github/CODEOWNERS`;
const ENVIRONMENTS = `${BASE}/environments`;
const ENVIRONMENT = `${BASE}/environments/rotproben`;
const MEASURED_ENVIRONMENTS = ["rotproben", "pruefer", "produktion", "warteschlange"];
const QUEUE = "warteschlange";
const QUEUE_POLICIES = `${ENVIRONMENTS}/${QUEUE}/deployment-branch-policies`;
const MERGE_QUEUE = "merge_queue";
const LARGER_GROUP = 2;
const SOLL_FILE = "einstellungen.json";
const BASE64 = "base64";
const EXIT_OK = 0;
const EXIT_DEVIATION = 1;
const EXIT_ERROR = 2;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const CHILD_TIMEOUT_MS = 30_000;
const BYPASS_ROLE_ID = 5;
const FOREIGN_ACCOUNT_ID = 4242;
const LOCKED_ACCOUNT_ID = 335012687;
const AGENT_APP_ID = 5250443;
const FOREIGN_RULESET_ID = 24600000;
const NOT_PROVABLE = "nicht prüfbar mit den Rechten dieses Tokens";
const runFile = promisify(execFile);

function recording(name) {
  return JSON.parse(readFileSync(join(RECORDINGS, `${name}.json`), "utf8"));
}

function answer(body) {
  return [HTTP_OK, body];
}

function environmentRoutes(answers, names) {
  const environments = names.map((name) => ({ ...answers.environment, name }));
  return [
    [ENVIRONMENTS, answer({ total_count: names.length, environments })],
    ...environments.flatMap((environment) => [
      [`${ENVIRONMENTS}/${environment.name}`, answer(environment)],
      [
        `${ENVIRONMENTS}/${environment.name}/deployment-branch-policies`,
        answer(answers.branchPolicies),
      ],
    ]),
  ];
}

function recordedRoutes(environments = MEASURED_ENVIRONMENTS) {
  const answers = recording("antworten");
  return new Map([
    [RULESET, answer(recording("ruleset-owner"))],
    [RULESETS, answer(recording("rulesets"))],
    [PHASE_RULESET, answer(recording("ruleset-phase-owner"))],
    [BASE, answer(answers.repo)],
    [COLLABORATORS, answer(answers.collaborators)],
    [CODEOWNERS, answer(answers.codeowners)],
    [`${BASE}/codeowners/errors`, answer(answers.codeownersErrors)],
    ...environmentRoutes(answers, environments),
  ]);
}

function changedRoutes(changes, environments) {
  const routes = recordedRoutes(environments);
  for (const [path, change] of Object.entries(changes)) {
    const [, body] = routes.get(path);
    routes.set(path, change(body));
  }
  return routes;
}

async function startApi(context, routes) {
  const requests = [];
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, "http://localhost");
    requests.push({ method: request.method, pathname });
    const [status, body] = routes.get(pathname) ?? [HTTP_NOT_FOUND, { message: "Not Found" }];
    response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  return { requests, address: `http://127.0.0.1:${server.address().port}` };
}

async function compare(context, { changes = {}, args = [], environments } = {}) {
  const api = await startApi(context, changedRoutes(changes, environments));
  const env = {
    ...isolatedEnvironment(),
    GITHUB_API_URL: api.address,
    GH_TOKEN: "probe",
    GITHUB_TOKEN: "",
  };
  const options = { cwd: REPO_ROOT, env, timeout: CHILD_TIMEOUT_MS };
  try {
    const { stdout, stderr } = await runFile(process.execPath, [TOOL, ...args], options);
    return { code: EXIT_OK, stdout, stderr, requests: api.requests };
  } catch (failure) {
    const { code, stdout, stderr } = failure;
    return { code, stdout, stderr, requests: api.requests };
  }
}

function assertRow(result, cells) {
  const row = `| ${cells.join(" | ")} |`;
  assert.ok(result.stdout.split("\n").includes(row), `${row} fehlt in:\n${result.stdout}`);
}

function withRuleParameters(ruleset, type, update) {
  const rules = ruleset.rules.map((rule) =>
    rule.type === type ? { ...rule, parameters: update(rule.parameters) } : rule,
  );
  return answer({ ...ruleset, rules });
}

function withRole(collaborators, login, role) {
  return answer(
    collaborators.map((entry) => (entry.login === login ? { ...entry, role_name: role } : entry)),
  );
}

function sollFile(context, change) {
  const soll = change(JSON.parse(readFileSync(SOLL, "utf8")));
  const directory = probeDirectory(context, { [SOLL_FILE]: JSON.stringify(soll) });
  return join(directory, SOLL_FILE);
}

function withEnvironments(soll, entries) {
  return { ...soll, environments: Object.fromEntries(entries) };
}

function withoutCodeownersLine(file, pattern) {
  const lines = Buffer.from(file.content, BASE64).toString("utf8").split("\n");
  const kept = lines.filter((line) => !line.startsWith(`${pattern} `)).join("\n");
  return answer({ ...file, content: Buffer.from(kept).toString(BASE64) });
}

test("Soll-Vergleich: stimmt alles mit dem Soll überein, endet er mit 0 und meldet „Keine Abweichung.“", async (context) => {
  const result = await compare(context);
  assert.equal(result.code, EXIT_OK, result.stderr);
  assert.match(result.stdout, /^## Soll-Vergleich$/m);
  assert.match(result.stdout, /^Keine Abweichung\.$/m);
  assert.doesNotMatch(result.stdout, /nicht prüfbar/);
  assert.deepEqual(new Set(result.requests.map(({ method }) => method)), new Set(["GET"]));
  const asked = new Set(result.requests.map(({ pathname }) => pathname));
  assert.deepEqual(asked, new Set(recordedRoutes().keys()));
});

test("Soll-Vergleich: fehlt bypass_actors in der Bot-Sicht, bleibt er grün und meldet „nicht prüfbar“", async (context) => {
  const result = await compare(context, {
    changes: { [RULESET]: () => answer(recording("ruleset-bot")) },
  });
  assert.equal(result.code, EXIT_OK, result.stderr);
  assert.match(result.stdout, /^Keine Abweichung\.$/m);
  assert.match(result.stdout, new RegExp(`^- Ruleset bypass_actors: ${NOT_PROVABLE} `, "m"));
});

test("Soll-Vergleich: fehlt ein Pflicht-Check, endet er mit 1", async (context) => {
  const withoutCheck = (parameters) => ({
    ...parameters,
    required_status_checks: parameters.required_status_checks.filter(
      ({ context: name }) => name !== "Lieferkette",
    ),
  });
  const result = await compare(context, {
    changes: {
      [RULESET]: (ruleset) => withRuleParameters(ruleset, "required_status_checks", withoutCheck),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [
    "Ruleset",
    "rules[required_status_checks].parameters.required_status_checks[Lieferkette]",
    '{"context":"Lieferkette","integration_id":15368}',
    "fehlt",
  ]);
});

test("Soll-Vergleich: ein zusätzlicher Bypass-Eintrag ergibt Exit 1", async (context) => {
  const actor = { actor_id: BYPASS_ROLE_ID, actor_type: "RepositoryRole", bypass_mode: "always" };
  const result = await compare(context, {
    changes: { [RULESET]: (ruleset) => answer({ ...ruleset, bypass_actors: [actor] }) },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [
    "Ruleset",
    `bypass_actors[RepositoryRole ${BYPASS_ROLE_ID}]`,
    "nicht im Soll",
    JSON.stringify(actor),
  ]);
});

test("Soll-Vergleich: fehlt die Regel für gerade Historie, endet er mit 1", async (context) => {
  const linear = "required_linear_history";
  const result = await compare(context, {
    changes: {
      [RULESET]: (ruleset) =>
        answer({ ...ruleset, rules: ruleset.rules.filter(({ type }) => type !== linear) }),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["Ruleset", `rules[${linear}]`, JSON.stringify({ type: linear }), "fehlt"]);
});

test("Soll-Vergleich: fehlt die Regel merge_queue, endet er mit 1", async (context) => {
  const queueRule = recording("ruleset-owner").rules.find(({ type }) => type === MERGE_QUEUE);
  const result = await compare(context, {
    changes: {
      [RULESET]: (ruleset) =>
        answer({ ...ruleset, rules: ruleset.rules.filter(({ type }) => type !== MERGE_QUEUE) }),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["Ruleset", `rules[${MERGE_QUEUE}]`, JSON.stringify(queueRule), "fehlt"]);
});

test("Soll-Vergleich: baut die Warteschlange mit HEADGREEN oder Gruppen aus 2, endet er mit 1", async (context) => {
  const looser = (parameters) => ({
    ...parameters,
    grouping_strategy: "HEADGREEN",
    max_entries_to_merge: LARGER_GROUP,
  });
  const result = await compare(context, {
    changes: { [RULESET]: (ruleset) => withRuleParameters(ruleset, MERGE_QUEUE, looser) },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  const field = `rules[${MERGE_QUEUE}].parameters`;
  assertRow(result, ["Ruleset", `${field}.grouping_strategy`, "ALLGREEN", "HEADGREEN"]);
  assertRow(result, ["Ruleset", `${field}.max_entries_to_merge`, "1", String(LARGER_GROUP)]);
});

test("Soll-Vergleich: fehlt das Environment warteschlange auf GitHub, endet er mit 1", async (context) => {
  const result = await compare(context, {
    environments: MEASURED_ENVIRONMENTS.filter((name) => name !== QUEUE),
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [`Environment ${QUEUE}`, "Environment", "vorhanden", "fehlt"]);
});

test("Soll-Vergleich: erlaubt warteschlange weitere Branches, endet er mit 1", async (context) => {
  const extra = { name: "phase/*", type: "branch" };
  const result = await compare(context, {
    changes: {
      [QUEUE_POLICIES]: ({ total_count: count, branch_policies: policies }) =>
        answer({ total_count: count + 1, branch_policies: [...policies, extra] }),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [
    `Environment ${QUEUE}`,
    `branch_policies[${extra.name}]`,
    "nicht im Soll",
    JSON.stringify(extra),
  ]);
});

function withRules(ruleset, update) {
  return answer({ ...ruleset, rules: update(ruleset.rules) });
}

function withoutPhase(list) {
  return answer(list.filter(({ name }) => name !== PHASE));
}

test("Soll-Vergleich: verbietet phase-schutz zusätzlich das Löschen, endet er mit 1", async (context) => {
  const deletion = { type: "deletion" };
  const result = await compare(context, {
    changes: { [PHASE_RULESET]: (ruleset) => withRules(ruleset, (rules) => [...rules, deletion]) },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [PHASE_AREA, "rules[deletion]", "nicht im Soll", JSON.stringify(deletion)]);
});

test("Soll-Vergleich: fehlt in phase-schutz die Regel update, endet er mit 1", async (context) => {
  const result = await compare(context, {
    changes: {
      [PHASE_RULESET]: (ruleset) =>
        withRules(ruleset, (rules) => rules.filter(({ type }) => type !== "update")),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [PHASE_AREA, "rules[update]", JSON.stringify({ type: "update" }), "fehlt"]);
});

test("Soll-Vergleich: schützt phase-schutz andere Branches, endet er mit 1", async (context) => {
  const target = ["refs/heads/**"];
  const result = await compare(context, {
    changes: {
      [PHASE_RULESET]: (ruleset) =>
        answer({ ...ruleset, conditions: { ref_name: { exclude: [], include: target } } }),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [
    PHASE_AREA,
    "conditions.ref_name.include",
    JSON.stringify(["refs/heads/phase/*"]),
    JSON.stringify(target),
  ]);
});

test("Soll-Vergleich: darf in phase-schutz ein weiterer Akteur vorbei, endet er mit 1", async (context) => {
  const actor = { actor_id: BYPASS_ROLE_ID, actor_type: "RepositoryRole", bypass_mode: "always" };
  const result = await compare(context, {
    changes: {
      [PHASE_RULESET]: (ruleset) =>
        answer({ ...ruleset, bypass_actors: [...ruleset.bypass_actors, actor] }),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [
    PHASE_AREA,
    `bypass_actors[RepositoryRole ${BYPASS_ROLE_ID}]`,
    "nicht im Soll",
    JSON.stringify(actor),
  ]);
});

test("Soll-Vergleich: darf in phase-schutz das gesperrte Konto vorbei, ist das eine Abweichung, die App nicht", async (context) => {
  const locked = { actor_id: LOCKED_ACCOUNT_ID, actor_type: "User", bypass_mode: "always" };
  const phase = recording("ruleset-phase-owner");
  const result = await compare(context, {
    changes: { [PHASE_RULESET]: () => answer({ ...phase, bypass_actors: [locked, ...phase.bypass_actors] }) },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [PHASE_AREA, `bypass_actors[User ${LOCKED_ACCOUNT_ID}]`, "nicht im Soll", JSON.stringify(locked)]);
  assert.doesNotMatch(result.stdout, new RegExp(`Integration ${AGENT_APP_ID}`));
});

test("Soll-Vergleich: gibt es auf GitHub ein Ruleset, das nicht im Soll steht, endet er mit 1", async (context) => {
  const result = await compare(context, {
    changes: {
      [RULESETS]: (list) => answer([...list, { ...list[0], id: FOREIGN_RULESET_ID, name: "neu" }]),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["Ruleset neu", "Ruleset", "nicht im Soll", "vorhanden"]);
});

test("Soll-Vergleich: fehlt phase-schutz (404), endet er mit 1", async (context) => {
  const result = await compare(context, {
    changes: { [PHASE_RULESET]: () => [HTTP_NOT_FOUND, { message: "Not Found" }] },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [PHASE_AREA, "Ruleset", "vorhanden", "fehlt"]);
});

test("Soll-Vergleich: fehlt phase-schutz in der Liste von GitHub, endet er mit 1", async (context) => {
  const result = await compare(context, { changes: { [RULESETS]: withoutPhase } });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [PHASE_AREA, "Ruleset", "vorhanden", "fehlt"]);
});

test("Soll-Vergleich: fehlt bypass_actors von phase-schutz in der Bot-Sicht, bleibt er grün und meldet „nicht prüfbar“", async (context) => {
  const result = await compare(context, {
    changes: {
      [RULESET]: () => answer(recording("ruleset-bot")),
      [PHASE_RULESET]: () => answer(recording("ruleset-phase-bot")),
    },
  });
  assert.equal(result.code, EXIT_OK, result.stderr);
  assert.match(result.stdout, /^Keine Abweichung\.$/m);
  assert.match(result.stdout, new RegExp(`^- Ruleset bypass_actors: ${NOT_PROVABLE} `, "m"));
  assert.match(result.stdout, new RegExp(`^- ${PHASE_AREA} bypass_actors: ${NOT_PROVABLE} `, "m"));
});

test("Soll-Vergleich: hat jonas986 plötzlich nur noch write, endet er mit 1", async (context) => {
  const result = await compare(context, {
    changes: { [COLLABORATORS]: (list) => withRole(list, "jonas986", "write") },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["Mitarbeiter", "jonas986", "admin", "write"]);
});

test("Soll-Vergleich: ein zusätzliches Konto ergibt Exit 1", async (context) => {
  const stranger = { login: "fremdes-konto", id: FOREIGN_ACCOUNT_ID, role_name: "write" };
  const result = await compare(context, {
    changes: { [COLLABORATORS]: (list) => answer([...list, stranger]) },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["Mitarbeiter", "fremdes-konto", "kein Zugang", "write"]);
});

test("Soll-Vergleich: ist Squash erlaubt, endet er mit 1", async (context) => {
  const result = await compare(context, {
    changes: { [BASE]: (repo) => answer({ ...repo, allow_squash_merge: true }) },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["Repo-Einstellungen", "allow_squash_merge", "false", "true"]);
});

test("Soll-Vergleich: require_last_push_approval true ergibt Exit 1", async (context) => {
  const strict = (parameters) => ({ ...parameters, require_last_push_approval: true });
  const result = await compare(context, {
    changes: { [RULESET]: (ruleset) => withRuleParameters(ruleset, "pull_request", strict) },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [
    "Ruleset",
    "rules[pull_request].parameters.require_last_push_approval",
    "false",
    "true",
  ]);
});

test("Soll-Vergleich: fehlt eine CODEOWNERS-Zeile, endet er mit 1", async (context) => {
  const pattern = "/test/werkzeuge/";
  const result = await compare(context, {
    changes: { [CODEOWNERS]: (file) => withoutCodeownersLine(file, pattern) },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["CODEOWNERS", pattern, `${pattern} @Antonio20045 @jonas986`, "fehlt"]);
});

test("Soll-Vergleich: fehlt das Environment rotproben (404), endet er mit 1", async (context) => {
  const result = await compare(context, {
    changes: { [ENVIRONMENT]: () => [HTTP_NOT_FOUND, { message: "Not Found" }] },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["Environment rotproben", "Environment", "vorhanden", "fehlt"]);
});

test("Soll-Vergleich: erlaubt das Environment alle Branches, endet er mit 1", async (context) => {
  const result = await compare(context, {
    changes: {
      [ENVIRONMENT]: (environment) =>
        answer({ ...environment, protection_rules: [], deployment_branch_policy: null }),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, [
    "Environment rotproben",
    "deployment_branch_policy",
    JSON.stringify({ protected_branches: false, custom_branch_policies: true }),
    "null",
  ]);
});

test("Soll-Vergleich: gibt es auf GitHub ein Environment, das nicht im Soll steht, endet er mit 1", async (context) => {
  const result = await compare(context, {
    changes: {
      [ENVIRONMENTS]: ({ total_count: count, environments }) =>
        answer({
          total_count: count + 1,
          environments: [...environments, { ...environments[0], name: "vorschau" }],
        }),
    },
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["Environment vorschau", "Environment", "nicht im Soll", "vorhanden"]);
});

test("Soll-Vergleich: fehlt pruefer in der Soll-Datei, meldet er das vorhandene Environment mit Exit 1", async (context) => {
  const withoutPruefer = (soll) =>
    withEnvironments(
      soll,
      Object.entries(soll.environments).filter(([name]) => name !== "pruefer"),
    );
  const result = await compare(context, {
    environments: MEASURED_ENVIRONMENTS,
    args: ["--soll", sollFile(context, withoutPruefer)],
  });
  assert.equal(result.code, EXIT_DEVIATION, result.stderr);
  assertRow(result, ["Environment pruefer", "Environment", "nicht im Soll", "vorhanden"]);
});

test("Soll-Vergleich: stehen alle Environments von GitHub gleich im Soll, meldet er „Keine Abweichung.“", async (context) => {
  const measured = (soll) =>
    withEnvironments(
      soll,
      MEASURED_ENVIRONMENTS.map((name) => [name, soll.environments.rotproben]),
    );
  const result = await compare(context, {
    environments: MEASURED_ENVIRONMENTS,
    args: ["--soll", sollFile(context, measured)],
  });
  assert.equal(result.code, EXIT_OK, result.stderr);
  assert.match(result.stdout, /^Keine Abweichung\.$/m);
  const asked = new Set(result.requests.map(({ pathname }) => pathname));
  assert.deepEqual(asked, new Set(recordedRoutes(MEASURED_ENVIRONMENTS).keys()));
});

test("Soll-Vergleich: antwortet die API mit 500, endet er mit 2", async (context) => {
  const result = await compare(context, {
    changes: { [COLLABORATORS]: () => [HTTP_SERVER_ERROR, { message: "Server Error" }] },
  });
  assert.equal(result.code, EXIT_ERROR, result.stdout);
  assert.match(result.stderr, /^Soll-Vergleich abgebrochen, weil .*collaborators.* HTTP 500/m);
  assert.equal(result.stdout, "");
});

test("Soll-Vergleich: fehlt die Soll-Datei, endet er mit 2", async (context) => {
  const missing = join(RECORDINGS, "gibt-es-nicht.json");
  const result = await compare(context, { args: ["--soll", missing] });
  assert.equal(result.code, EXIT_ERROR, result.stdout);
  assert.match(result.stderr, /^Soll-Vergleich abgebrochen, weil die Soll-Datei .* fehlt/m);
});
