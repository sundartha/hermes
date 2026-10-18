import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { fakeGitHub } from "../../tools/pruefungen-messen.mjs";
import { REPO_ROOT, isolatedEnvironment } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/tests-nur-ergaenzt.mjs");
export const EXIT_OK = 0;
const EXIT_FINDING = 1;
const PULL_REQUEST = "7";
const NO_APPROVAL = /ohne Freigabe/;
export const WHOLE_FILE_DELETED = "die ganze Testdatei ist gelöscht; das ist immer gesperrt.";

const execFileAsync = promisify(execFile);

export async function check({ directory, basis }) {
  const server = await fakeGitHub();
  const requests = [];
  server.on("request", ({ method, url }) => requests.push(`${method} ${url}`));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const env = {
    ...isolatedEnvironment(),
    GITHUB_TOKEN: "attrappe",
    GITHUB_REPOSITORY: "probe/hermes",
    GITHUB_API_URL: apiUrl,
    GITHUB_GRAPHQL_URL: `${apiUrl}/graphql`,
  };
  const args = [TOOL, "--basis", basis, "--pr", PULL_REQUEST];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, { cwd: directory, env });
    return { status: EXIT_OK, output: `${stdout}${stderr}`, requests };
  } catch (error) {
    return { status: error.code, output: `${error.stdout}${error.stderr}`, requests };
  } finally {
    server.close();
  }
}

export function assertPassedWithoutGitHub(result) {
  assert.equal(result.status, EXIT_OK, result.output);
  assert.deepEqual(result.requests, []);
}

export function assertStopped(result) {
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, NO_APPROVAL);
}
