/* The hover fills on the home words and the rows in their drawers: Figma's
   "Scrolling spectrogram" and "Corona plasma" shaders, ported from WGSL to
   WebGL2, each showing through its letters. Nothing runs until something is
   hovered or focused, and a canvas stops drawing once it has faded away.

   Each `canvas.fill` sits in a `[data-fill]` element next to an svg <text>. The
   letters are drawn into a mask from the positions the svg gave them, so they
   land exactly on the outline. The shaders' uv spans the letters, not the line, and their
   colours are used as they are, with no sRGB conversion: both measured against
   the Figma renders. */

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform float time;
uniform vec2 dims;
uniform sampler2D letters;
vec4 fill();
void main() {
  float a = texture(letters, uv).a;
  color = vec4(fill().rgb * a, a);
}
`;

const SPECTROGRAM = HEAD + `
const float SPEED = 0.51, INTENSITY = 1.0, CONTRAST = 1.47, DETAIL = 1.47, GRAIN = 0.54, DENSITY = 0.8, SEED = 7.0, THICKNESS = 1.0;
const vec3 HEAT[8] = vec3[8](vec3(0.0), vec3(0.008, 0.015, 0.16), vec3(0.2, 0.0, 0.47), vec3(0.65, 0.0, 0.48),
  vec3(1.0, 0.015, 0.015), vec3(1.0, 0.3, 0.0), vec3(1.0, 0.92, 0.0), vec3(1.0, 1.0, 0.88));
const float STOPS[8] = float[8](0.0, 0.13, 0.29, 0.43, 0.57, 0.73, 0.88, 1.0);

vec3 heatmap(float t) {
  for (int i = 0; i < 7; i++) {
    if (t <= STOPS[i + 1]) return mix(HEAT[i], HEAT[i + 1], (t - STOPS[i]) / max(STOPS[i + 1] - STOPS[i], 1e-5));
  }
  return HEAT[7];
}
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise21(vec2 p) {
  vec2 cell = floor(p), f = fract(p), w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), w.x), mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0)), w.x), w.y);
}
float bell(float v, float center, float width) {
  float d = (v - center) / width;
  return exp(-0.5 * d * d);
}
float speechField(float x, float frequency, float variation, float freqDetail, float occupancy) {
  float cell = floor(x), energy = 0.0;
  for (int j = -1; j <= 1; j++) {
    float id = cell + float(j);
    float r0 = hash21(vec2(id, variation + 2.0)), r1 = hash21(vec2(id, variation + 31.0));
    float r2 = hash21(vec2(id, variation + 73.0)), r3 = hash21(vec2(id, variation + 117.0));
    float start = id + 0.04 + r0 * 0.18, duration = 0.32 + r1 * 0.62;
    float phase = (x - start) / duration;
    float gate = smoothstep(0.0, 0.035, phase) * (1.0 - smoothstep(0.67, 1.0, phase));
    float syllable = gate * smoothstep(r2 - 0.08, r2 + 0.08, occupancy);
    float t = clamp(phase, 0.0, 1.0);
    float pitch = (0.014 + 0.009 * r3) * (1.0 + 0.13 * sin(t * 4.8 + r1 * 5.0) + 0.08 * t) / freqDetail;
    float harmonicPhase = frequency / pitch;
    float ridgeDistance = abs(fract(harmonicPhase + 0.5) - 0.5);
    float ridgeWidth = max(0.10, min(0.35, fwidth(harmonicPhase) * 0.65)) * THICKNESS;
    float ridges = exp(-pow(ridgeDistance / ridgeWidth, 2.0));
    float skirt = exp(-pow(ridgeDistance / (0.31 * THICKNESS), 2.0));
    float f1 = 0.045 + 0.07 * r0 + 0.065 * sin(t * 2.7 + r1 * 2.0);
    float f2 = 0.15 + 0.10 * r1 + 0.035 * cos(t * 4.0 + r2 * 4.0);
    float f3 = 0.29 + 0.08 * r2 + 0.035 * sin(t * 3.4 + r3 * 6.0);
    float formants = 0.73 * bell(frequency, f1, (0.017 + r0 * 0.012) * THICKNESS)
      + 0.52 * bell(frequency, f2, 0.025 * THICKNESS) + 0.27 * bell(frequency, f3, 0.035 * THICKNESS);
    float lowBand = 0.80 * exp(-frequency * 20.0) + 0.25 * exp(-frequency * 5.0);
    float harmonic = (0.30 + 0.70 * ridges) * (lowBand + formants) + 0.08 * skirt * exp(-frequency * 3.0);
    float breath = noise21(vec2(x * 19.0 + variation, frequency * 110.0));
    float highFormant = 0.50 * bell(frequency, 0.57 + r1 * 0.21, 0.12);
    float onset = exp(-pow((t - 0.06) / 0.045, 2.0));
    float fricative = smoothstep(0.40, 0.90, r3) * bell(t, 0.55, 0.30);
    float broadband = (0.08 + highFormant) * (0.35 + 0.65 * breath) + 0.16 * onset * (0.4 + breath)
      + 0.19 * fricative * smoothstep(0.20, 0.50, frequency) * breath;
    energy += syllable * (harmonic + broadband);
  }
  return energy;
}
vec4 fill() {
  float x = uv.x * (dims.x / dims.y) * 3.1 + time * SPEED;
  float frequency = clamp(1.0 - uv.y, 0.0, 1.0);
  float signal = speechField(x, frequency, SEED, DETAIL, DENSITY);
  float fine = noise21(vec2(x * 165.0 + SEED * 13.0, frequency * 470.0 * DETAIL));
  float streak = noise21(vec2(x * 29.0 - SEED, frequency * 530.0 * DETAIL));
  float speckle = hash21(floor(vec2(x * 250.0 + SEED, frequency * 520.0 * DETAIL)));
  float mottling = mix(1.0, 0.32 + 0.80 * fine + 0.30 * streak, GRAIN);
  float bed = noise21(vec2(x * 4.7 + SEED, frequency * 23.0 * DETAIL));
  float ridgePhase = frequency * 48.0 * DETAIL + 0.55 * sin(x * 3.7 + SEED);
  float ridgeDistance = abs(fract(ridgePhase + 0.5) - 0.5);
  float ridgeWidth = clamp(fwidth(ridgePhase) * 0.65, 0.12, 0.35) * THICKNESS;
  float continuousRidges = exp(-pow(ridgeDistance / ridgeWidth, 2.0));
  float noiseFloor = 0.29 + (0.10 + 0.12 * DENSITY) * bed + 0.12 * streak + 0.06 * fine
    + 0.075 * continuousRidges + 0.10 * exp(-frequency * 3.0);
  float energy = 0.62 * signal * mottling + noiseFloor + GRAIN * (speckle - 0.5) * 0.08;
  return vec4(heatmap(pow(clamp(energy * INTENSITY, 0.0, 1.0), CONTRAST)), 1.0);
}`;

const CORONA = HEAD + `
const vec3 CORE = vec3(0.8132, 0.9660, 1.0), HALO = vec3(0.6306, 0.4757, 1.0), BACK = vec3(0.006, 0.009, 0.032);
const float BRIGHTNESS = 1.25, SPREAD = 0.75, FALLOFF = 1.5, SIZE = 1.0, STREAK = 1.0, SPEED = 1.25, SEED = 7.0;
const int COUNT = 50;
float particleHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
vec4 fill() {
  float fromBottom = max(1.0 - uv.y, 0.0);
  float broadGlow = exp(-3.0 * pow(fromBottom / SPREAD, FALLOFF));
  float hotEdge = exp(-fromBottom / max(SPREAD * 0.075, 0.003));
  float coreEnergy = hotEdge * 0.65 * BRIGHTNESS;
  float haloEnergy = broadGlow * 1.5 * BRIGHTNESS;
  float motion = time * SPEED;
  vec2 point = uv * dims;
  for (int i = 0; i < COUNT; i++) {
    float ident = float(i) + SEED * 103.3;
    float phase = particleHash(ident + 1.8);
    float velocity = 0.82 + 0.4 * particleHash(ident + 8.3);
    float progress = fract(phase + motion * velocity * 2.5);
    float centerY = 1.08 - progress * 1.16;
    float drift = sin(progress * 3.0 + phase * 6.2831853) * 0.003;
    float centerX = 0.015 + 0.97 * particleHash(ident + 29.7) + drift;
    vec2 delta = point - vec2(centerX, centerY) * dims;
    float radius = SIZE * (0.65 + 0.7 * particleHash(ident + 45.9));
    float fade = smoothstep(0.0, 0.09, centerY) * (1.0 - smoothstep(0.91, 1.0, centerY));
    float streakLength = radius * (1.0 + STREAK * 5.0);
    float axisY = delta.y / (delta.y > 0.0 ? streakLength : radius);
    float elliptical = delta.x * delta.x / (radius * radius) + axisY * axisY;
    float head = exp(-2.0 * dot(delta, delta) / (radius * radius));
    float trail = exp(-2.0 * elliptical);
    float softHalo = exp(-0.4 * elliptical);
    float sparkle = fade * (0.45 + 0.55 * particleHash(ident + 64.2));
    coreEnergy += (head * 1.8 + trail * 0.65) * sparkle;
    haloEnergy += softHalo * 0.22 * sparkle;
  }
  float energy = coreEnergy + haloEnergy;
  float glow = 1.0 - exp(-energy);
  vec3 light = (CORE * coreEnergy + HALO * haloEnergy) / max(energy, 0.00001);
  return vec4(light * glow + BACK * (1.0 - glow), 1.0);
}`;

const SHADERS = { spectrogram: SPECTROGRAM, corona: CORONA };
const FADE = 220;        // ms for a fill to come up or go away
const MAX_SCALE = 1.5;   // canvas pixels per CSS pixel: small grain, cheap enough to run

const reduce = matchMedia("(prefers-reduced-motion: reduce)");

function compile(gl, source) {
  const program = gl.createProgram();
  for (const [type, text] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, source]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);
  return program;
}

class Fill {
  constructor(line) {
    this.line = line;
    this.canvas = line.querySelector("canvas.fill");
    this.text = line.querySelector("text.ink");
    this.on = false;
    this.pinned = false;     // an open drawer's word keeps its fill running
    this.shown = 0;
    this.gl = this.canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!this.gl) return;
    const gl = this.gl;
    const program = compile(gl, SHADERS[this.canvas.dataset.shader]);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "pos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uTime = gl.getUniformLocation(program, "time");
    this.uDims = gl.getUniformLocation(program, "dims");
  }

  /* draws the letters where the svg put them, then crops to their ink, which is
     the box the shader's uv spans */
  layout() {
    if (!this.gl) return;
    const svg = this.text.ownerSVGElement;
    const figma = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;   // CSS px per Figma px
    if (!figma) return;
    const scale = figma * Math.min(devicePixelRatio || 1, MAX_SCALE);
    const pad = 60;       // Figma px around the word, for overhang
    const word = this.text.textContent;
    const ends = this.text.getEndPositionOfChar(word.length - 1);
    const w = Math.ceil((ends.x + pad * 2) * scale);
    const css = getComputedStyle(this.text);
    const size = parseFloat(css.fontSize);   // the svg's own units, Figma px
    const h = Math.ceil((size + pad * 2) * scale);
    const big = document.createElement("canvas");
    big.width = w;
    big.height = h;
    const g = big.getContext("2d", { willReadFrequently: true });
    g.font = `${css.fontWeight} ${size * scale}px ${css.fontFamily}`;
    g.textBaseline = "alphabetic";
    const originY = this.text.getStartPositionOfChar(0).y - size * 0.82;  // the mask's top, Figma px
    [...word].forEach((ch, i) => {
      const at = this.text.getStartPositionOfChar(i);
      g.fillText(ch, (at.x + pad) * scale, (at.y - originY + pad) * scale);
    });
    const { data } = g.getImageData(0, 0, w, h);
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] < 8) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0) return;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const crop = document.createElement("canvas");
    crop.width = cw;
    crop.height = ch;
    crop.getContext("2d").drawImage(big, -x0, -y0);

    this.canvas.width = cw;
    this.canvas.height = ch;
    const per = scale / figma;  // canvas px per CSS px
    Object.assign(this.canvas.style, {
      left: `${x0 / per - pad * figma}px`,
      top: `${y0 / per + (originY - pad) * figma}px`,
      width: `${cw / per}px`,
      height: `${ch / per}px`,
    });
    const gl = this.gl;
    gl.viewport(0, 0, cw, ch);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, crop);
    gl.uniform2f(this.uDims, cw / scale, ch / scale);
    this.draw(0);
  }

  draw(seconds) {
    if (!this.gl) return;
    const gl = this.gl;
    gl.uniform1f(this.uTime, seconds);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

const fills = [...document.querySelectorAll("[data-fill]")].map((l) => new Fill(l));
const body = document.body;
let running = false;
let last = 0;
let clock = 0;

function frame(now) {
  const dt = last ? Math.min(now - last, 64) : 0;
  last = now;
  if (!reduce.matches) clock += dt / 1000;
  let alive = false;
  for (const fill of fills) {
    fill.shown = Math.min(1, Math.max(0, fill.shown + ((fill.on || fill.pinned ? 1 : -1) * dt) / FADE));
    fill.canvas.style.opacity = fill.shown.toFixed(3);
    if (fill.shown > 0) {
      fill.draw(clock);
      alive = true;
    }
  }
  if (alive || fills.some((f) => f.on || f.pinned)) {
    requestAnimationFrame(frame);
  } else {
    running = false;
    last = 0;
  }
}

function wake() {
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
}

function set(fill, on) {
  fill.on = on;
  fill.line.classList.toggle("on", on);
  const lit = fills.find((f) => f.on);
  body.dataset.hover = lit ? lit.line.dataset.fill : "";
  wake();
}

for (const fill of fills) {
  const { line } = fill;
  line.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch" || line.closest('[data-open] .word, [data-opening="running"] *')) return;
    set(fill, true);
  });
  line.addEventListener("pointerleave", () => set(fill, false));
  line.addEventListener("focus", () => {
    if (line.matches(":focus-visible") && !line.closest("[data-open] .word")) set(fill, true);
  });
  line.addEventListener("blur", () => set(fill, false));
}

const layout = () => fills.forEach((f) => f.layout());
let timer = 0;
addEventListener("resize", () => {
  clearTimeout(timer);
  timer = setTimeout(layout, 150);
});
/* the page drops every hover the moment a drawer opens, and pins its word */
document.addEventListener("fills:pin", (e) => {
  for (const fill of fills) fill.pinned = fill.line.dataset.fill === e.detail;
  wake();
});
document.addEventListener("fills:clear", () => fills.forEach((f) => { if (f.on) set(f, false); }));
Promise.all([
  document.fonts.load('200px "League Gothic"', "ProjectsResearch"),
  document.fonts.load('44px "IBM Plex Mono"', "Raven L-1420 Electrode test setup"),
]).then(layout);
