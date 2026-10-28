import process, { env } from "node:process";
import { mock } from "node:test";

import { BUDGET_MS, SCHAETZUNG_MS } from "./mutationspruefung-budget-ersatz.mjs";

const EINGEFROREN = env.BUDGET_UHR === "eingefroren";
const EINE_MS = 1;
const SEHR_TEUER_MS = 1_000_000;

Object.assign(BUDGET_MS, { normal: EINE_MS, testumbau: EINE_MS });
if (EINGEFROREN) Object.assign(SCHAETZUNG_MS, { aufruf: SEHR_TEUER_MS, mutant: SEHR_TEUER_MS });

mock.timers.enable({ apis: EINGEFROREN ? ["setTimeout", "Date"] : ["setTimeout"] });
process.on("beforeExit", () => mock.timers.tick(EINE_MS));
