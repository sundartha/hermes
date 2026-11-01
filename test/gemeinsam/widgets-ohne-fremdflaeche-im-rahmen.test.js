import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { decodePng, findChrome, isHostGround, renderInFrame } from "./widget-im-rahmen.js";

const CARD_WIDTH_BY_WIDGET = {
  "agent-status": 530,
  "my-number": 530,
  calls: 530,
  call: 598,
};
const WIDE_FRAME = 900;
const NARROW_FRAME = 360;
const CORNER = 30;
const BAND = 6;
const EDGE_TOLERANCE = 2;
const EDGE_MARGIN = 4;
const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 120000 };

function hostGroundInBands(image) {
  const found = [];
  for (let y = CORNER; y < image.height - CORNER; y += 1) {
    for (let x = 0; x < BAND; x += 1) {
      if (isHostGround(image.at(x, y))) found.push(`links ${x},${y}`);
      if (isHostGround(image.at(image.width - 1 - x, y))) found.push(`rechts ${image.width - 1 - x},${y}`);
    }
  }
  for (let x = CORNER; x < image.width - CORNER; x += 1) {
    for (let y = 0; y < BAND; y += 1) {
      if (isHostGround(image.at(x, y))) found.push(`oben ${x},${y}`);
      if (isHostGround(image.at(x, image.height - 1 - y))) found.push(`unten ${x},${image.height - 1 - y}`);
    }
  }
  return found;
}

function cardRightEdge(image) {
  const row = Math.floor(image.height / 2);
  let edge = 0;
  for (let x = 0; x < image.width; x += 1) if (!isHostGround(image.at(x, row))) edge = x + 1;
  return edge;
}

function paintedBesideCard(image, cardWidth) {
  const found = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = cardWidth + EDGE_MARGIN; x < image.width; x += 1) {
      const [r, g, b] = image.at(x, y);
      if (r !== 255 || g !== 0 || b !== 255) found.push(`${x},${y}`);
    }
  }
  return found;
}

async function befundeJeWidget(frame, pruefe) {
  const widgets = await ausgelieferteWidgets();
  assert.deepEqual(Object.keys(widgets).sort(), Object.keys(CARD_WIDTH_BY_WIDGET).sort());
  const befunde = [];
  for (const [id, cardWidth] of Object.entries(CARD_WIDTH_BY_WIDGET)) {
    const shot = await renderInFrame(chrome, widgets[id], frame);
    for (const befund of pruefe(shot, cardWidth)) befunde.push(`${id}: ${befund}`);
  }
  return befunde;
}

test("Rahmen schrumpft auf die Karte, wenn der Host die gemeldete Breite übernimmt", OPTIONS, async () => {
  const befunde = await befundeJeWidget({ width: WIDE_FRAME, honorWidth: true }, (shot, cardWidth) => [
    ...(shot.width === cardWidth ? [] : [`Rahmen ${shot.width} px statt ${cardWidth} px`]),
    ...hostGroundInBands(decodePng(shot.png)).slice(0, 3),
  ]);
  assert.deepEqual(befunde, []);
});

test("Karte behält ihre Breite und daneben bleibt nichts Sichtbares, wenn der Host den Rahmen fest hält", OPTIONS, async () => {
  const befunde = await befundeJeWidget({ width: WIDE_FRAME }, (shot, cardWidth) => {
    const image = decodePng(shot.png);
    const edge = cardRightEdge(image);
    return [
      ...(shot.width === WIDE_FRAME ? [] : [`Rahmen ${shot.width} px statt ${WIDE_FRAME} px`]),
      ...(Math.abs(edge - cardWidth) <= EDGE_TOLERANCE ? [] : [`Karte ${edge} px statt ${cardWidth} px`]),
      ...paintedBesideCard(image, cardWidth).slice(0, 3),
    ];
  });
  assert.deepEqual(befunde, []);
});

test("Karte füllt einen schmalen Rahmen vollständig", OPTIONS, async () => {
  const befunde = await befundeJeWidget({ width: NARROW_FRAME }, (shot) => [
    ...(shot.width === NARROW_FRAME ? [] : [`Rahmen ${shot.width} px statt ${NARROW_FRAME} px`]),
    ...hostGroundInBands(decodePng(shot.png)).slice(0, 3),
  ]);
  assert.deepEqual(befunde, []);
});
