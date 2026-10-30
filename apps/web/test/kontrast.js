const HEX_COLOR = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const CHANNELS = 3;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_CHANNEL = 2;
const FULL = 255;
const BACKDROP_RED = 0x1b;
const BACKDROP_GREEN = 0x4f;
const BACKDROP_BLUE = 0x86;
const LIGHTEST_PAGE_BACKDROP = Object.freeze([BACKDROP_RED, BACKDROP_GREEN, BACKDROP_BLUE, 1]);
const LINEAR_CUTOFF = 0.03928;
const LINEAR_DIVISOR = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_DIVISOR = 1.055;
const GAMMA = 2.4;
const WEIGHT_RED = 0.2126;
const WEIGHT_GREEN = 0.7152;
const WEIGHT_BLUE = 0.0722;
const FLARE = 0.05;
const BLUE_INDEX = 2;
const CHANNEL_INDEXES = [0, 1, BLUE_INDEX];

export const AA_NORMAL_TEXT = 4.5;
export const RATIO_DECIMALS = 2;

function rgba(color) {
  const hit = HEX_COLOR.exec(color);
  if (!hit) return null;
  const channels = CHANNEL_INDEXES.map((index) => {
    const start = index * HEX_DIGITS_PER_CHANNEL;
    return parseInt(hit[1].slice(start, start + HEX_DIGITS_PER_CHANNEL), HEX_RADIX);
  });
  return [...channels, hit[2] ? parseInt(hit[2], HEX_RADIX) / FULL : 1];
}

function over(top, below) {
  const alpha = top[CHANNELS];
  const mixed = top.slice(0, CHANNELS).map((value, index) => value * alpha + below[index] * (1 - alpha));
  return [...mixed, 1];
}

function linear(value) {
  const unit = value / FULL;
  return unit <= LINEAR_CUTOFF ? unit / LINEAR_DIVISOR : ((unit + GAMMA_OFFSET) / GAMMA_DIVISOR) ** GAMMA;
}

function luminance(color) {
  const [red, green, blue] = color.slice(0, CHANNELS).map(linear);
  return WEIGHT_RED * red + WEIGHT_GREEN * green + WEIGHT_BLUE * blue;
}

export function contrastOf(look) {
  let ground = LIGHTEST_PAGE_BACKDROP;
  for (const layer of [...look.backdrop, look.background]) {
    const parsed = rgba(layer);
    if (parsed) ground = over(parsed, ground);
  }
  const text = over(rgba(look.color), ground);
  const [light, dark] = [luminance(text), luminance(ground)].sort((first, second) => second - first);
  return (light + FLARE) / (dark + FLARE);
}
