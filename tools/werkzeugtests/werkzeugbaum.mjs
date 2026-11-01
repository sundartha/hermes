import { TOOL_TEST_DIRECTORY } from "../../test/testbaenke-run.mjs";

const HARNESS_FILES = ["test/testbaenke-run.mjs", "test/i18n-catalog-run.mjs", "test/package.json"];
export const HIDDEN_DIRECTORIES = ["src/", "plaene/"];
const TEST_DIRECTORY = "test/";

export function isToolTreePath(path) {
  if (HIDDEN_DIRECTORIES.some((prefix) => path.startsWith(prefix))) return false;
  if (!path.startsWith(TEST_DIRECTORY)) return true;
  return path.startsWith(TOOL_TEST_DIRECTORY) || HARNESS_FILES.includes(path);
}
