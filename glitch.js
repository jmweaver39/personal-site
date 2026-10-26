/* Page transition: the RGB channel-split glitch from the SRX site.

   The page is split into red, green and blue copies with an SVG filter and
   screen-blended back together, so it is pixel-clean at rest and colour only
   appears once the copies are pulled apart. Red and blue pull sideways with
   jitter, green holds the middle so the form stays readable, and fainter
   echoes trail the split. The noise is stepped, so each glitch frame holds
   still while it shows, which is what makes it read as digital.

   The cut runs on a fixed 250 ms clock: the outgoing page glitches up to the
   peak, the browser swaps pages at the midpoint, and the incoming page glitches
   back down while it fades in.

   Mark the element to glitch with `data-glitch` and the links that should
   trigger it with `data-glitch-link`. */

(function () {
  var DURATION = 250;  // ms for the whole cut, split across the two pages
  var STEPS = 14;      // glitch frames per cut; low is chunkier, more digital
  var DRIFT = 10;      // sideways slam of the whole frame, px
  var ECHO = 2;        // trailing echo of the red and blue copies, as a multiple
  var KEY = "glitch-in";

  var target = document.querySelector("[data-glitch]");
  if (!target) return;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // How far red and blue pull apart, scaled to the screen like the type is
  function split() {
    return Math.max(12, window.innerWidth * 0.012);
  }

  // Deterministic per-step noise, so a glitch frame is stable while it shows
  function noise(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  // One channel isolated, alpha scaled for the echoes. `floor` drops the
  // page's dark background out of the echoes so they don't tint it.
  function channel(r, g, b, a, floor) {
    var k = 1 / (1 - (floor || 0));
    var o = -(floor || 0) * k;
    return (r * k) + " 0 0 0 " + (r * o) + "  0 " + (g * k) + " 0 0 " + (g * o) +
      "  0 0 " + (b * k) + " 0 " + (b * o) + "  0 0 0 " + a + " 0";
  }

  var svgNS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  svg.innerHTML =
    '<filter id="rgb-glitch" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">' +
      '<feColorMatrix in="SourceGraphic" type="matrix" values="' + channel(1, 0, 0, 1) + '" result="r"/>' +
      '<feColorMatrix in="SourceGraphic" type="matrix" values="' + channel(0, 1, 0, 1) + '" result="g"/>' +
      '<feColorMatrix in="SourceGraphic" type="matrix" values="' + channel(0, 0, 1, 1) + '" result="b"/>' +
      '<feColorMatrix in="SourceGraphic" type="matrix" values="' + channel(1, 0, 0, 0.42, 0.08) + '" result="re"/>' +
      '<feColorMatrix in="SourceGraphic" type="matrix" values="' + channel(0, 0, 1, 0.42, 0.08) + '" result="be"/>' +
      '<feOffset in="r" result="ro"/>' +
      '<feOffset in="g" result="go"/>' +
      '<feOffset in="b" result="bo"/>' +
      '<feOffset in="re" result="reo"/>' +
      '<feOffset in="be" result="beo"/>' +
      '<feBlend in="ro" in2="go" mode="screen" result="rg"/>' +
      '<feBlend in="rg" in2="bo" mode="screen" result="rgb"/>' +
      '<feBlend in="rgb" in2="reo" mode="screen" result="rgbe"/>' +
      '<feBlend in="rgbe" in2="beo" mode="screen"/>' +
    "</filter>";
  document.body.appendChild(svg);
  var offsets = svg.querySelectorAll("feOffset");  // r, g, b, red echo, blue echo

  function setOffset(node, dx, dy) {
    node.setAttribute("dx", dx.toFixed(1));
    node.setAttribute("dy", dy.toFixed(1));
  }

  // Draw one glitch frame: g is intensity 0..1, t is position 0..1 in the cut
  function frame(g, t) {
    var step = Math.floor(t * STEPS);
    var sp = g * split();
    var drift = (noise(step) - 0.5) * g * DRIFT;
    var rx = drift - sp * (0.7 + noise(step + 1) * 0.6);
    var bx = drift + sp * (0.7 + noise(step + 2) * 0.6);
    var ry = (noise(step + 3) - 0.5) * g * 6;
    var by = (noise(step + 4) - 0.5) * g * 6;
    setOffset(offsets[0], rx, ry);
    setOffset(offsets[1], drift * 0.4, 0);
    setOffset(offsets[2], bx, by);
    setOffset(offsets[3], rx * ECHO, ry * ECHO);
    setOffset(offsets[4], bx * ECHO, by * ECHO);
  }

  function clear() {
    target.style.filter = "";
    target.style.opacity = "";
  }

  // Run half of the cut: `out` swells to the peak, otherwise it dies away
  function play(out, done) {
    var half = DURATION / 2;
    var start = performance.now();
    target.style.filter = "url(#rgb-glitch)";

    function tick(now) {
      var u = Math.min(1, (now - start) / half);
      var t = out ? u * 0.5 : 0.5 + u * 0.5;  // position in the whole cut
      var g = 1 - Math.abs(2 * t - 1);         // peaks at the swap
      frame(g, t);
      if (!out) {
        // Fade in, with a stepped flicker on top while the glitch is loud
        var flicker = g > 0.3 && noise(Math.floor(t * STEPS) + 5) < 0.35 ? 0.7 : 1;
        target.style.opacity = String(Math.min(1, 0.25 + u) * flicker);
      }
      if (u < 1) {
        requestAnimationFrame(tick);
      } else {
        done();
      }
    }
    requestAnimationFrame(tick);
  }

  // Outgoing: glitch up to the peak, then hand over to the next page
  document.querySelectorAll("a[data-glitch-link]").forEach(function (link) {
    link.addEventListener("click", function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      if (reduced) {
        window.location.href = link.href;
        return;
      }
      try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
      play(true, function () { window.location.href = link.href; });
    });
  });

  // Incoming: if we arrived through a glitch, finish it here
  var arriving = false;
  try {
    arriving = sessionStorage.getItem(KEY) === "1";
    sessionStorage.removeItem(KEY);
  } catch (e) {}
  if (arriving && !reduced) {
    target.style.opacity = "0";
    play(false, clear);
  }

  // Coming back with the browser's Back button restores the old page mid-glitch
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) clear();
  });
})();
