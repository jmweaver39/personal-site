/* Page transition: two full-screen panels slide across, an orange edge and then
   the colour of the page being opened. The browser swaps pages under the
   panels, and the new page lets them carry on off the far side.

   Mark links with `data-wipe-link` (and `data-wipe="dark"` when they lead to a
   black page). Load this in the <head>, so a page arriving under the panels
   never shows a frame without them. Give the script tag `data-end="url"` to
   leave for that url at the end of a scroll piece: the panels come in with the
   last stretch of the scroll, and go back if the scroll does. */

(function () {
  var COVER = 620;     // ms for a panel to cross the screen
  var STAGGER = 110;   // the page's panel follows the orange one
  var END_RUN = 0.035; // the last stretch of the scroll the panels cross in, 0..1 of it
  var CATCH_UP = 0.14; // how quickly the panels follow the scroll, each frame
  var KEY = "wipe-in";
  var EASE = "cubic-bezier(0.76, 0, 0.24, 1)";

  var script = document.currentScript;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var css = document.createElement("style");
  css.textContent =
    ".wipe{position:fixed;inset:0;z-index:100;overflow:hidden;pointer-events:none}" +
    ".wipe i{position:absolute;inset:0;display:block;will-change:transform}" +
    ".wipe-edge{background:#ff5a1f}" +
    ".wipe-paper{background-color:#f2f1ef;" +
      "background-image:radial-gradient(rgba(0,0,0,.14) 1px,transparent 1.4px);background-size:16px 16px}" +
    ".wipe-dark{background:#000}";
  document.documentElement.appendChild(css);

  function panels(kind, at) {
    var wrap = document.createElement("div");
    wrap.className = "wipe";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = '<i class="wipe-edge"></i><i class="wipe-' + kind + '"></i>';
    wrap.children[0].style.transform = wrap.children[1].style.transform = "translateX(" + at + "%)";
    document.documentElement.appendChild(wrap);
    return wrap;
  }

  // Both panels from `from` to `to` percent of the screen; the orange one leads
  function slide(wrap, from, to) {
    var moves = [].map.call(wrap.children, function (el, i) {
      var move = el.animate(
        [{ transform: "translateX(" + from + "%)" }, { transform: "translateX(" + to + "%)" }],
        { duration: COVER, delay: i * STAGGER, easing: EASE, fill: "both" }
      );
      return move.finished;
    });
    return Promise.all(moves);
  }

  function leave(href, kind, dir) {
    if (reduced) {
      window.location.href = href;
      return;
    }
    var wrap = panels(kind, -100 * dir);
    slide(wrap, -100 * dir, 0).then(function () {
      try { sessionStorage.setItem(KEY, JSON.stringify({ kind: kind, dir: dir })); } catch (e) {}
      window.location.href = href;
    });
  }

  // Arriving under the panels: they cover the page until it has something to show
  var arriving = null;
  try {
    arriving = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
  } catch (e) {}
  if (arriving) {
    var cover = panels(arriving.kind, 0);
    var reveal = function () {
      setTimeout(function () {
        slide(cover, 0, 100 * arriving.dir).then(function () { cover.remove(); });
      }, 120);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reveal);
    else reveal();
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("[data-wipe-link]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    leave(link.getAttribute("href"), link.getAttribute("data-wipe") || "paper", 1);
  });

  // Coming back with the browser's back button restores the page, panels and all
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    [].forEach.call(document.querySelectorAll(".wipe"), function (el) { el.remove(); });
  });

  // The way out of a scroll piece, the way it came in but in reverse
  var end = script && script.getAttribute("data-end");
  if (end) {
    var wrap = null;
    var shown = 0;
    var left = false;
    var scrollMax = function () {
      return document.documentElement.scrollHeight - window.innerHeight;
    };
    var ease = function (p) {
      return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    };
    var run = function () {
      var max = scrollMax();
      var at = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      var aim = Math.max(0, Math.min(1, (at - (1 - END_RUN)) / END_RUN));
      shown += (aim - shown) * CATCH_UP;
      if (aim >= 1 && shown > 0.995) shown = 1;
      if (shown < 0.002 && aim === 0) shown = 0;

      if (shown > 0 && !wrap) wrap = panels("dark", 100);
      if (shown === 0 && wrap) {
        wrap.remove();
        wrap = null;
      }
      if (wrap) {
        // The orange panel leads, the black one lands exactly as the scroll ends
        var edge = ease(Math.min(1, shown * 1.3));
        wrap.children[0].style.transform = "translateX(" + 100 * (1 - edge) + "%)";
        wrap.children[1].style.transform = "translateX(" + 100 * (1 - ease(shown)) + "%)";
      }
      if (shown === 1 && !left) {
        left = true;
        try { sessionStorage.setItem(KEY, JSON.stringify({ kind: "dark", dir: -1 })); } catch (e) {}
        window.location.href = end;
        return;
      }
      if (!left) requestAnimationFrame(run);
    };

    // Coming back to the end of the page mustn't send the visitor straight off again
    var stepBack = function () {
      var max = scrollMax();
      if (max > 0 && window.scrollY > max * (1 - END_RUN)) window.scrollTo(0, max * (1 - END_RUN) - 1);
    };
    window.addEventListener("pageshow", function (event) {
      stepBack();
      if (event.persisted && left) {
        left = false;
        shown = 0;
        requestAnimationFrame(run);
      }
    });

    if (reduced) {
      window.addEventListener("scroll", function () {
        var max = scrollMax();
        if (!left && max > 0 && window.scrollY >= max - 2) {
          left = true;
          window.location.href = end;
        }
      }, { passive: true });
    } else {
      requestAnimationFrame(run);
    }
  }
})();
