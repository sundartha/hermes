import { test } from "node:test";
import { setTimeout as schlafen } from "node:timers/promises";
const WARTE_MS = 500;
test("wartet", async () => {
  await schlafen(WARTE_MS);
});
