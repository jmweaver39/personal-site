/* The MacBook section that ends the rocket page. When the lens is in the tube
   the stage goes black: that black is the Mac's display, seen from up close.
   The scroll pulls back from it, with the rocket page's layers flattened onto
   the display as it plays, through to the end of the page. Only the rocket
   page's own scroll drives it. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/* where this section starts in the rocket page's scroll, 0..1 of its total:
   its "dark" stretch, 1286 of 1846svh. Keep in step with STRETCHES there */
const ROCKET_FROM = 1286 / 1846;
const CUT_IN = 0.012;                // the cut to the Mac's black display takes this much
const LOAD_AT = 0.02;                 // the model loads at the first bit of scroll, to be ready in time

const FEED_W = 1280, FEED_H = 832;    // the display's proportions
const SCREEN_MESH = "tfTbkkzhxqpKRgC";
/* 0..1 through this section: the zoom out starts as the charge fires */
const ZOOM0 = 0.1, ZOOM1 = 0.72;
const POWER_ON = 0.05;                // the display comes up over this much of the scroll
const GLOSS = 0.3;                    // at full strength the room's lights wash the picture out
const FILL = 0.78;                    // how much of the window the Mac ends up filling
const CALLOUT_AT = 0.3;               // the callout comes up during the zoom out, once the lid leaves it room
const CALLOUT_IN = 0.06;              // and fades in over this much, riding along with the Mac
const HUD_AT = [0.015, 0.94];         // the telemetry strip on the display, as u, v

const clamp01 = (x) => Math.min(1, Math.max(0, x));
/* quick out of the display, then slower and slower the further back it gets */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const css = document.createElement("style");
css.textContent = `
  /* the page's paper, pinned to the window: the dots hold still in the scroll */
  .mac-overlay {
    position: fixed;
    inset: 0;
    z-index: 3;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    background-color: var(--bg);
    background-image: radial-gradient(var(--dot) 1px, transparent 1.4px);
    background-size: 16px 16px;
  }
  .mac-overlay canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  /* the page's callouts, a size up; its orange leader, since a dark one would
     vanish over the laptop */
  .mac-callout {
    position: absolute;
    inset: 0;
    visibility: hidden;
    opacity: 0;
  }
  .mac-callout svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .mac-callout line {
    stroke: var(--accent);
    stroke-width: 1;
  }
  .mac-callout circle {
    fill: var(--accent);
  }
  .mac-label {
    position: absolute;
    left: 0;
    top: 0;
    white-space: nowrap;
  }
  .mac-label .t {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(17, 17, 17, 0.95);
  }
  .mac-label .d {
    margin-top: 3px;
    font: 500 11px ui-monospace, "SF Mono", Menlo, monospace;
    letter-spacing: 0.08em;
    color: rgba(17, 17, 17, 0.55);
  }
`;
document.head.append(css);

const overlay = document.createElement("div");
overlay.className = "mac-overlay";
overlay.innerHTML = `
  <canvas aria-label="MacBook Pro showing the rocket's separation on its display"></canvas>
  <div class="mac-callout">
    <svg aria-hidden="true"><line></line><circle r="2.5"></circle></svg>
    <div class="mac-label">
      <div class="t">Live telemetry and video</div>
      <div class="d">from the rocket · 5 km</div>
    </div>
  </div>`;
/* last on the stage: over all its layers, under its dots */
document.querySelector(".stage").append(overlay);
const canvas = overlay.querySelector("canvas");
const calloutEl = overlay.querySelector(".mac-callout");
const coLine = overlay.querySelector("line");
const coDot = overlay.querySelector("circle");
const coLabel = overlay.querySelector(".mac-label");

/* the rocket page's stage, in its stacking order */
const q = (s) => document.querySelector(s);
const track = q(".track"), stage = q(".stage");
const cloudsBox = q(".clouds"), clouds = q(".clouds canvas");
const glEl = q("canvas.gl"), smoke = q("canvas.smoke"), telem = q("canvas.telem");
const darkEl = q(".dark"), flashEl = q(".flash"), creditEl = q(".credit");

const rocketP = () => {
  const max = track.offsetHeight - window.innerHeight;
  return max > 0 ? clamp01(window.scrollY / max) : 0;
};

let renderer = null, scene = null, camera = null;
let displayMat = null;
let screenRect = null;                // the display's width and height, m
let screenCenter = null;
let screenNormal = null;
let hudPoint = null;                  // the telemetry strip, in the world
let lidCorner = null;
let frontCorner = null;
let modelBox = null;
let startDist = 1, endDist = 1;
const endTarget = new THREE.Vector3();
const target = new THREE.Vector3();
let dirty = true;
let roomBeside = true;

/* what the display shows, in the wallpaper's place: glTF's top-left UV origin */
const feedCanvas = document.createElement("canvas");
feedCanvas.width = FEED_W;
feedCanvas.height = FEED_H;
const g = feedCanvas.getContext("2d");
const canFilter = "filter" in g;
const feedTex = new THREE.CanvasTexture(feedCanvas);
feedTex.flipY = false;
feedTex.colorSpace = THREE.SRGBColorSpace;
feedTex.generateMipmaps = false;
feedTex.minFilter = THREE.LinearFilter;

/* the WebGL layer only holds its picture until the browser presents it and the
   page skips frames when nothing moved, so each render is copied right after
   it happens: this module's frame runs after the page's own tick */
const gl = glEl.getContext("webgl2");
let rendered = false;
const clearGl = gl.clear.bind(gl);
gl.clear = (mask) => { rendered = true; clearGl(mask); };
const glCopy = document.createElement("canvas");
glCopy.width = FEED_W;
glCopy.height = FEED_H;
const glCopyCtx = glCopy.getContext("2d");

/* flatten the stage onto the display: the picture fills it like the stage's
   own cover-fit, and the strip and credit keep their size along its bottom */
function compose() {
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const s = Math.max(FEED_W / sw, FEED_H / sh);
  const film = glEl.style.filter;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#000";
  g.fillRect(0, 0, FEED_W, FEED_H);
  g.setTransform(s, 0, 0, s, (FEED_W - sw * s) / 2, (FEED_H - sh * s) / 2);
  if (canFilter) g.filter = film || "none";
  if (cloudsBox.style.opacity === "1") {
    const c = Math.max(sw / clouds.width, sh / clouds.height);
    const w = clouds.width * c, h = clouds.height * c;
    g.imageSmoothingEnabled = false;
    g.drawImage(clouds, (sw - w) / 2, (sh - h) / 2, w, h);
    g.imageSmoothingEnabled = true;
  }
  g.drawImage(glCopy, 0, 0, sw, sh);
  g.drawImage(smoke, 0, 0, sw, sh);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (canFilter) {
    g.filter = "none";
  } else if (film.startsWith("grayscale(1)")) {
    g.globalCompositeOperation = "saturation";
    g.fillRect(0, 0, FEED_W, FEED_H);
    g.globalCompositeOperation = "source-over";
  }
  g.fillStyle = `rgba(0, 0, 0, ${darkEl.style.opacity || 0})`;
  g.fillRect(0, 0, FEED_W, FEED_H);
  g.fillStyle = `rgba(255, 255, 255, ${flashEl.style.opacity || 0})`;
  g.fillRect(0, 0, FEED_W, FEED_H);
  const ts = Math.min(FEED_W / sw, 1.6);
  if (telem.style.opacity === "1") g.drawImage(telem, 0, FEED_H - 150 * ts, sw * ts, 150 * ts);
  if (creditEl.style.opacity === "1") {
    const style = window.getComputedStyle(creditEl), box = creditEl.getBoundingClientRect();
    g.setTransform(ts, 0, 0, ts, 0, 0);
    g.font = style.font;
    g.fillStyle = style.color;
    g.textBaseline = "top";
    g.textAlign = "right";
    g.fillText(creditEl.textContent, (FEED_W - 12) / ts, FEED_H / ts - (sh - box.top));
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  feedTex.needsUpdate = true;
  dirty = true;
}

/* the end shot: the distance and aim that centre the laptop's outline (lid top,
   hinge, front edge) in the window and fill FILL of it */
function fitView() {
  const { min, max } = modelBox;
  const pts = [min.x, max.x].flatMap((x) => [
    new THREE.Vector3(x, max.y, min.z),
    new THREE.Vector3(x, min.y, min.z + (max.z - min.z) / 3),
    new THREE.Vector3(x, min.y, max.z),
  ]);
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const v = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const aim = (d) => {
    camera.position.copy(endTarget).addScaledVector(screenNormal, d);
    camera.lookAt(endTarget);
    camera.updateMatrixWorld();
    return pts.map((p) => v.copy(p).project(camera).toArray());
  };
  modelBox.getCenter(endTarget);
  let d = 1;
  for (let pass = 0; pass < 4; pass++) {
    let lo = 0.1, hi = 4;
    for (let i = 0; i < 24; i++) {
      d = (lo + hi) / 2;
      if (aim(d).every(([x, y]) => Math.abs(x) <= FILL && Math.abs(y) <= FILL)) hi = d; else lo = d;
    }
    d = hi;
    const ndc = aim(d);
    const cx = (Math.min(...ndc.map((p) => p[0])) + Math.max(...ndc.map((p) => p[0]))) / 2;
    const cy = (Math.min(...ndc.map((p) => p[1])) + Math.max(...ndc.map((p) => p[1]))) / 2;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    endTarget.addScaledVector(right, cx * tanY * camera.aspect * d);
    endTarget.addScaledVector(up, cy * tanY * d);
  }
  endDist = d;
}

const toPage = (pos) => {
  const v = pos.clone().project(camera);
  return {
    x: (v.x + 1) / 2 * overlay.clientWidth,
    y: (1 - v.y) / 2 * overlay.clientHeight,
  };
};

/* in the margin beside the lid, or under the Mac where there's no room for it
   (a phone), with its leader on the telemetry strip */
function placeCallout(p) {
  const o = clamp01((p - CALLOUT_AT) / CALLOUT_IN);
  calloutEl.style.opacity = o;
  calloutEl.style.visibility = o > 0 ? "visible" : "hidden";
  if (!o) return;
  const hud = toPage(hudPoint), lidX = toPage(lidCorner).x;
  const labelW = coLabel.offsetWidth, labelH = coLabel.offsetHeight;
  const beside = roomBeside;
  const x = Math.max(16, beside ? lidX - labelW - 44 : hud.x);
  const y = beside ? hud.y - labelH / 2
    : Math.min(toPage(frontCorner).y + 28, overlay.clientHeight - labelH - 16);
  coLabel.style.transform = `translate(${x}px, ${y}px)`;
  coLabel.style.textAlign = beside ? "right" : "left";
  coLine.setAttribute("x1", beside ? x + labelW + 8 : hud.x);
  coLine.setAttribute("y1", beside ? hud.y : y - 6);
  coLine.setAttribute("x2", hud.x);
  coLine.setAttribute("y2", hud.y);
  coDot.setAttribute("cx", hud.x);
  coDot.setAttribute("cy", hud.y);
}

function drawMac(p) {
  const t = easeOut(clamp01((p - ZOOM0) / (ZOOM1 - ZOOM0)));
  /* always square on to the display: the pull back never turns or tilts */
  target.lerpVectors(screenCenter, endTarget, t);
  const dist = startDist * Math.pow(endDist / startDist, t);
  camera.position.copy(target).addScaledVector(screenNormal, dist);
  camera.lookAt(target);
  /* off, the display is flat black: its gloss comes up with the picture, or
     the room's lights would show on it from this close */
  const power = clamp01((p - ZOOM0) / POWER_ON);
  displayMat.emissiveIntensity = power;
  displayMat.envMapIntensity = power * GLOSS;
  renderer.render(scene, camera);
  placeCallout(p);
}

function layout() {
  if (!displayMat) return;
  const w = Math.max(1, overlay.clientWidth);
  const h = Math.max(1, overlay.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  /* inside the display, with the notch and rounded corners out of the window */
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  startDist = Math.min(screenRect.h / (2 * tanY), screenRect.w / (2 * tanY * camera.aspect)) / 1.3;
  fitView();
  /* decided on the end shot, so the label doesn't jump sides as the Mac pulls back */
  roomBeside = toPage(lidCorner).x - coLabel.offsetWidth - 44 >= 16;
  dirty = true;
}

function loadMac() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  feedTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  /* the laptop is dark metal, and the stock room is unlit below and behind it,
     so the lid back and underside reflected pure black until these panels */
  const room = new RoomEnvironment();
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(1), side: THREE.DoubleSide })
  );
  const floorPanel = panel.clone();
  floorPanel.scale.setScalar(26);
  floorPanel.rotation.x = Math.PI / 2;
  floorPanel.position.y = -0.5;
  const backPanel = panel.clone();
  backPanel.scale.setScalar(20);
  backPanel.position.set(0, 8, -13);
  room.add(floorPanel, backPanel);
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();

  camera = new THREE.PerspectiveCamera(30, 1, 0.005, 5);

  new GLTFLoader().load(
    new URL("macbook_pro_14_inch_M5.glb", import.meta.url).href,
    (gltf) => {
      const model = gltf.scene;
      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      model.traverse((o) => {
        if (!o.isMesh) return;
        for (const value of Object.values(o.material)) {
          if (value && value.isTexture) value.anisotropy = maxAniso;
        }
      });
      scene.add(model);
      model.updateMatrixWorld(true);

      /* the display keeps the material it was modelled with (near-black gloss,
         lit by its emissive map): only the map changes */
      const display = model.getObjectByName(SCREEN_MESH);
      const mat = display.material;
      mat.emissiveMap = feedTex;
      mat.emissiveIntensity = 0;
      mat.envMapIntensity = 0;
      mat.needsUpdate = true;

      display.geometry.computeBoundingBox();
      const { min, max } = display.geometry.boundingBox;
      const [tl, tr, bl] = [
        new THREE.Vector3(min.x, min.y, min.z),
        new THREE.Vector3(max.x, min.y, min.z),
        new THREE.Vector3(min.x, max.y, max.z),
      ].map((v) => v.applyMatrix4(display.matrixWorld));
      screenRect = { w: tl.distanceTo(tr), h: tl.distanceTo(bl) };
      screenCenter = tr.clone().add(bl).multiplyScalar(0.5);
      screenNormal = bl.clone().sub(tl).cross(tr.clone().sub(tl)).normalize();
      modelBox = new THREE.Box3().setFromObject(model);
      hudPoint = tl.clone()
        .addScaledVector(tr.clone().sub(tl), HUD_AT[0])
        .addScaledVector(bl.clone().sub(tl), HUD_AT[1]);
      lidCorner = new THREE.Vector3(modelBox.min.x, modelBox.max.y, modelBox.min.z);
      frontCorner = new THREE.Vector3(modelBox.min.x, modelBox.min.y, modelBox.max.z);
      displayMat = mat;
      layout();
    },
    undefined,
    /* the rocket page simply plays on without the Mac */
    (err) => console.error(err)
  );
}

let lastR = -1;

function frame() {
  const r = rocketP();
  if (!renderer && r > LOAD_AT) loadMac();
  if (r !== lastR) {
    lastR = r;
    dirty = true;
  }
  if (rendered) {
    rendered = false;
    if (r >= ROCKET_FROM) {
      glCopyCtx.clearRect(0, 0, FEED_W, FEED_H);
      glCopyCtx.drawImage(glEl, 0, 0, FEED_W, FEED_H);
      compose();
    }
  }
  const shown = displayMat ? clamp01((r - ROCKET_FROM) / CUT_IN) : 0;
  overlay.style.opacity = shown;
  overlay.style.visibility = shown > 0 ? "visible" : "hidden";
  if (dirty && shown > 0) {
    dirty = false;
    drawMac((r - ROCKET_FROM) / (1 - ROCKET_FROM));
  }
  requestAnimationFrame(frame);
}

window.addEventListener("resize", layout);
frame();
