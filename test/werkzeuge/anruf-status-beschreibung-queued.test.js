import assert from "node:assert/strict";
import { test } from "node:test";

import { stdioSnapshot } from "../mcp-draht-pfade.js";

test("get_call_status nennt queued in der Statusliste der Werkzeugbeschreibung", async () => {
  const { tools } = await stdioSnapshot({});
  const tool = tools.find((entry) => entry.name === "get_call_status");
  assert.match(
    tool.description,
    /status \(queued\|dialing\|in_progress\|completed\|failed\|cancelled\), duration/,
  );
});
