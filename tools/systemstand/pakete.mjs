const PACKAGE_LABEL = "paket";
const PACKAGE_TITLE = /^Paket (\d+)([a-z]*):/;
const PACKAGE_DIGITS = 2;
const LISTED_PACKAGES = 3;
const OPEN_STATE = "open";

const issueLists = new WeakMap();

function packageIssues(remote) {
  if (!issueLists.has(remote)) {
    issueLists.set(remote, remote.all(`/issues?labels=${PACKAGE_LABEL}&state=all`));
  }
  return issueLists.get(remote);
}

function packageOf(issue) {
  const match = PACKAGE_TITLE.exec(issue.title);
  if (match === null || issue.pull_request !== undefined) return [];
  const [, digits, suffix] = match;
  return [{ id: `${digits}${suffix}`, number: Number(digits), issue }];
}

function packageId(number) {
  return String(number).padStart(PACKAGE_DIGITS, "0");
}

function packageRange(first, last) {
  return Array.from({ length: last - first + 1 }, (slot, offset) => first + offset);
}

function listed(ids) {
  const shown = ids.slice(0, LISTED_PACKAGES);
  const rest = ids.length - shown.length;
  if (rest === 1) return `${shown.join(", ")} und 1 weiteres`;
  if (rest > 0) return `${shown.join(", ")} und ${rest} weitere`;
  return `${shown.slice(0, -1).join(", ")} und ${shown.at(-1)}`;
}

function missingReasons(ids) {
  if (ids.length === 0) return [];
  if (ids.length === 1) return [`das Issue von Paket ${ids[0]} fehlt`];
  return [`die Issues der Pakete ${listed(ids)} fehlen`];
}

function openReasons(ids) {
  if (ids.length === 0) return [];
  if (ids.length === 1) return [`Paket ${ids[0]} offen ist`];
  return [`die Pakete ${listed(ids)} offen sind`];
}

export function packagesClosed(first, last) {
  return async (remote) => {
    const packages = (await packageIssues(remote)).flatMap(packageOf);
    const inStep = packages.filter(({ number }) => number >= first && number <= last);
    const missing = packageRange(first, last)
      .filter((number) => !inStep.some((found) => found.number === number))
      .map(packageId);
    const open = inStep.filter(({ issue }) => issue.state === OPEN_STATE).map(({ id }) => id);
    return [...missingReasons(missing), ...openReasons([...new Set(open)].sort())];
  };
}
