(function () {
  var root = document.documentElement;
  root.classList.add("js-rv");
  try {
    if (window.localStorage.getItem("hermes.lang.v2") === "de") root.lang = "de";
  } catch {
  }
  window.addEventListener("load", function () {
    if (!root.classList.contains("rv-ready")) root.classList.remove("js-rv");
  });
})();
