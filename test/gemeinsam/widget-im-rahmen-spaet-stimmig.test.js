import assert from "node:assert/strict";
import { test } from "node:test";

import { decodePng, findChrome, renderInFrame } from "./widget-im-rahmen.js";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const FRAME_WIDTH = 900;
const CARD_WIDTH = 300;
const REPORTED_HEIGHT = 200;
const LATE_HEIGHT = 120;

const LATE_GROWING_WIDGET = `<!doctype html><html><body style="margin:0;width:${CARD_WIDTH}px">
<div id="card" style="width:${CARD_WIDTH}px;height:${LATE_HEIGHT}px;background:rgb(10,20,30)"></div>
<script>
parent.postMessage({ method: "ui/notifications/size-changed", params: { width: ${CARD_WIDTH}, height: ${REPORTED_HEIGHT} } }, "*");
document.fonts.ready.then(() => requestAnimationFrame(() => {
  document.getElementById("card").style.height = "${REPORTED_HEIGHT}px";
}));
</script></body></html>`;

test("Rahmen meldet sich fertig, wenn die Karte erst nach dem Laden der Schriften auf die gemeldete Höhe wächst", { skip: SKIP, timeout: 30000 }, async () => {
  const shot = await renderInFrame(findChrome(), LATE_GROWING_WIDGET, { width: FRAME_WIDTH });
  assert.equal(shot.width, FRAME_WIDTH);
  assert.equal(shot.height, REPORTED_HEIGHT);
  const image = decodePng(shot.png);
  assert.deepEqual(image.at(CARD_WIDTH - 1, REPORTED_HEIGHT - 1), [10, 20, 30]);
});
