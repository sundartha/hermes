(function () {
  const VEIL_MAX_MS = 8000;
  if (location.hash !== "#kuendigen") return;
  const root = document.documentElement;
  root.setAttribute("data-cancel-arrival", "");
  setTimeout(function () {
    root.removeAttribute("data-cancel-arrival");
  }, VEIL_MAX_MS);
})();
