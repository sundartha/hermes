import { test } from "node:test";
import { calleeIsOwner } from "../src/callee-is-owner.js";
test("TQ-Probe ohne Pruefung", () => { calleeIsOwner({ to: "+4930123", ownNumber: "+4930123" }); });
