// Treibende-Wolken-Video robust abspielen (Autoplay-Policies, Tab-Wechsel,
// Off-Screen). Portiert aus dem x-dc-componentDidMount des Quell-Designs
// "Hermes Hero.dc.html". Bewusst als statische Datei unter /public/assets:
// die strikte Produktions-CSP (script-src 'self', KEIN 'unsafe-inline') verbietet
// Inline-Skripte; ein gebundeltes Astro-<script> wuerde inline landen -> blockiert.
// Fehlt das Video, zeigt <video> still das poster-Bild.
(function () {
  var v = document.getElementById("hermesSky");
  if (!v) return;
  v.muted = true;
  v.playsInline = true;
  v.loop = true;
  var RATE = 0.7;
  var onScreen = true;
  var apply = function () { try { v.playbackRate = RATE; } catch (e) {} };
  var play = function () {
    apply();
    if (onScreen && document.visibilityState === "visible") {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    }
  };
  v.addEventListener("loadedmetadata", apply);
  v.addEventListener("play", apply);
  v.addEventListener("pause", function () { if (onScreen) setTimeout(play, 140); });
  document.addEventListener("visibilitychange", play);
  try {
    var io = new IntersectionObserver(function (es) {
      onScreen = es[0].isIntersecting;
      if (onScreen) play(); else v.pause();
    }, { threshold: 0.02 });
    io.observe(v);
  } catch (e) {}
  play();
  setTimeout(play, 200);
  setTimeout(play, 800);
  setTimeout(play, 2000);
})();
