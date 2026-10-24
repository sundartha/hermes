import { cwd } from "node:process";

import { cruise } from "dependency-cruiser";

const GRAPH_ROOTS = ["src", "test"];
const CRUISE_OPTIONS = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
export const TEST_FILE = /^test\/.+\.test\.[jt]s$/;

export async function dependentsGraph(baseDir = cwd()) {
  const { output } = await cruise(GRAPH_ROOTS, { ...CRUISE_OPTIONS, baseDir });
  const edges = output.modules.flatMap(({ source, dependencies }) =>
    dependencies.map(({ resolved }) => ({ source, resolved })),
  );
  return Map.groupBy(edges, (edge) => edge.resolved);
}

export function reachingFiles(start, dependents) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const importers = dependents.get(queue.pop()) ?? [];
    const unseen = importers.map((edge) => edge.source).filter((source) => !seen.has(source));
    for (const source of unseen) seen.add(source);
    queue.push(...unseen);
  }
  return seen;
}

export function testsReaching(start, dependents) {
  return [...reachingFiles(start, dependents)].filter((file) => TEST_FILE.test(file));
}
