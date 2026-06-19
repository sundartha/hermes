import { describe, it } from "node:test";
import { formatDuration } from "../src/utils/format-duration.js";
import assert from "node:assert";

describe("formatDuration — valid durations", () => {
  it("returns '0s' for zero", () => {
    assert.strictEqual(formatDuration(0), "0s");
  });

  it("returns '1s' for one second", () => {
    assert.strictEqual(formatDuration(1000), "1s");
  });

  it("returns '1m' for exactly one minute (seconds omitted)", () => {
    assert.strictEqual(formatDuration(60000), "1m");
  });

  it("returns '1m 1s' for one minute and one second", () => {
    assert.strictEqual(formatDuration(61000), "1m 1s");
  });

  it("returns '1m 30s' for ninety seconds", () => {
    assert.strictEqual(formatDuration(90000), "1m 30s");
  });

  it("returns '1h' for exactly one hour (minutes and seconds omitted)", () => {
    assert.strictEqual(formatDuration(3600000), "1h");
  });

  it("returns '1h 1s' for one hour and one second (minutes gap in the middle)", () => {
    assert.strictEqual(formatDuration(3601000), "1h 1s");
  });

  it("returns '1h 1m' for one hour and one minute (seconds omitted)", () => {
    assert.strictEqual(formatDuration(3660000), "1h 1m");
  });

  it("returns '1h 1m 1s' for all three units", () => {
    assert.strictEqual(formatDuration(3661000), "1h 1m 1s");
  });
});

describe("formatDuration — combinations and omitted units", () => {
  it("returns '59s' at the seconds upper bound", () => {
    assert.strictEqual(formatDuration(59000), "59s");
  });

  it("returns '1m 59s' just below two minutes", () => {
    assert.strictEqual(formatDuration(119000), "1m 59s");
  });

  it("returns '59m 59s' just below one hour", () => {
    assert.strictEqual(formatDuration(3599000), "59m 59s");
  });

  it("returns '1h 1m 30s' for hours, minutes and seconds", () => {
    assert.strictEqual(formatDuration(3690000), "1h 1m 30s");
  });

  it("returns '1h 30s' and omits a zero minute in the middle", () => {
    assert.strictEqual(formatDuration(3630000), "1h 30s");
  });

  it("returns '2h' for a multi-digit pure hour value", () => {
    assert.strictEqual(formatDuration(7200000), "2h");
  });
});

describe("formatDuration — sub-second values are floored to '0s'", () => {
  it("returns '0s' for 500ms", () => {
    assert.strictEqual(formatDuration(500), "0s");
  });

  it("returns '0s' for 999ms", () => {
    assert.strictEqual(formatDuration(999), "0s");
  });

  it("returns '1s' for 1500ms (floor, not round)", () => {
    assert.strictEqual(formatDuration(1500), "1s");
  });

  it("returns '1s' for 1500.7ms (float truncated)", () => {
    assert.strictEqual(formatDuration(1500.7), "1s");
  });

  it("returns '0s' for 1ms", () => {
    assert.strictEqual(formatDuration(1), "0s");
  });

  it("returns '0s' for a negative value (clamped to zero)", () => {
    assert.strictEqual(formatDuration(-5000), "0s");
  });

  it("returns '0s' for -1ms (clamped to zero)", () => {
    assert.strictEqual(formatDuration(-1), "0s");
  });
});

describe("formatDuration — boundary values", () => {
  it("returns '0s' for 999ms (just below one second)", () => {
    assert.strictEqual(formatDuration(999), "0s");
  });

  it("returns '59s' for 59999ms (just below one minute)", () => {
    assert.strictEqual(formatDuration(59999), "59s");
  });

  it("returns '59m 59s' for 3599999ms (just below one hour)", () => {
    assert.strictEqual(formatDuration(3599999), "59m 59s");
  });

  it("returns '23h 59m 59s' for 86399000ms (just below a day)", () => {
    assert.strictEqual(formatDuration(86399000), "23h 59m 59s");
  });
});

describe("formatDuration — large values (hours do not roll into days)", () => {
  it("returns '24h' for 86400000ms instead of '1d'", () => {
    assert.strictEqual(formatDuration(86400000), "24h");
  });

  it("returns '25h 1m 1s' for 90061000ms", () => {
    assert.strictEqual(formatDuration(90061000), "25h 1m 1s");
  });

  it("returns a valid hour-leading string for Number.MAX_SAFE_INTEGER without crashing", () => {
    assert.match(formatDuration(Number.MAX_SAFE_INTEGER), /^\d+h/);
  });
});

describe("formatDuration — invalid input throws TypeError", () => {
  it("throws for null", () => {
    assert.throws(() => formatDuration(null), TypeError);
  });

  it("throws for undefined", () => {
    assert.throws(() => formatDuration(undefined), TypeError);
  });

  it("throws for a non-numeric string", () => {
    assert.throws(() => formatDuration("string"), TypeError);
  });

  it("throws for a numeric string (no implicit coercion)", () => {
    assert.throws(() => formatDuration("1000"), TypeError);
  });

  it("throws for a plain object", () => {
    assert.throws(() => formatDuration({}), TypeError);
  });

  it("throws for an array (no unwrapping)", () => {
    assert.throws(() => formatDuration([]), TypeError);
  });

  it("throws for a boolean", () => {
    assert.throws(() => formatDuration(true), TypeError);
  });

  it("throws for NaN", () => {
    assert.throws(() => formatDuration(NaN), TypeError);
  });

  it("throws for Infinity", () => {
    assert.throws(() => formatDuration(Infinity), TypeError);
  });

  it("throws for -Infinity", () => {
    assert.throws(() => formatDuration(-Infinity), TypeError);
  });
});
