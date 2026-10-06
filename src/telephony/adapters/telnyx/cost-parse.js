import { CENTS_PER_EUR, MICRO_CENTS_PER_CENT } from "../../../store/defaults.js";

const MICRO_CENTS_PER_CURRENCY_UNIT = CENTS_PER_EUR * MICRO_CENTS_PER_CENT;
const MICRO_CENT_DECIMALS = String(MICRO_CENTS_PER_CURRENCY_UNIT).length - 1;

const COST_EXPONENT_MIN = -12;
const COST_EXPONENT_MAX = 6;
const COST_EXPONENT_MAX_DIGITS = 4;
const MICRO_CENTS_MAX_DIGITS = 15;

const COST_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;

function parseCostExponent(rawExponent) {
  if (rawExponent === undefined) return 0;
  const digits = rawExponent.replace(/^[+-]/, "");
  if (digits.length > COST_EXPONENT_MAX_DIGITS) return null;
  const exponent = Number(rawExponent);
  if (exponent < COST_EXPONENT_MIN || exponent > COST_EXPONENT_MAX) return null;
  return exponent;
}

function shiftDecimalToMicroCents(digits, fracLength, exponent) {
  const shift = MICRO_CENT_DECIMALS - (fracLength - exponent);
  let shifted;
  if (shift >= 0) shifted = digits + "0".repeat(shift);
  else if (shift <= -digits.length) shifted = "0";
  else shifted = digits.slice(0, shift);
  const microDigits = shifted.replace(/^0+/, "") || "0";
  if (microDigits.length > MICRO_CENTS_MAX_DIGITS) return null;
  return Number(microDigits);
}

export function parseDecimalToMicroCents(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = COST_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, sign, intPart, fracPart = "", rawExponent] = match;
  if (sign) return null;
  const exponent = parseCostExponent(rawExponent);
  if (exponent === null) return null;
  return shiftDecimalToMicroCents(intPart + fracPart, fracPart.length, exponent);
}

export function parseNonNegativeInteger(raw) {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return Number.isSafeInteger(n) ? n : null;
}
