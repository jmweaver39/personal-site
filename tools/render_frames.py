"""Blender headless script: render the Raven L-1420 payload turntable to WebP
frames that replicate the web page's pose timeline exactly.

Run:  blender -b -P render_frames.py

Scene mapping mirrors the page (three.js):
  three: alignG Ry(90deg) -> spinG Rx(theta) -> tiltG Ry(ty)Rz(tz), cam on +z
  blender: ALIGN Rz(90deg) -> SPIN Rx(theta) -> TILT euler (0, -tz, ty), cam on -y
Frames 0..ROT_FRAMES are one full turn about the long axis from the hero
azimuth; the rest hold that azimuth while tilting to a 45-degree diagonal
and dollying out (the page scrubs frame index directly).
"""
import bpy, math, json, os, glob, sys, re
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TEST = "--test" in ARGS

SRC = "/Users/jayweaver/Downloads/Payload Assembly.gltf"
OUT_DIR = "/Users/jayweaver/Projects/personal site/images/payload"
META = os.path.join(OUT_DIR, "render_meta.json")

FRAMES = 216
W, H = 3840, 2160
FOV_DEG = 32.0
THETA0 = 1.5859              # hero azimuth (engraved panel)
ROT_FRAMES = 180             # frames 0..180: one full turn; 181..215: tilt+zoom
TILT_Y, TILT_Z, DOLLY = 0.35, 0.7854, 1.55   # finale: 45-degree diagonal, zoomed out
FIT_W, FIT_H = 0.92, 0.34

os.makedirs(OUT_DIR, exist_ok=True)

# ---------- clean scene ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- import ----------
bpy.ops.import_scene.gltf(filepath=SRC)
imported = [o for o in scene.objects if o.parent is None and o.type in ("EMPTY", "MESH")]

# world bbox of everything
def scene_bbox():
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for o in scene.objects:
        if o.type != "MESH":
            continue
        for corner in o.bound_box:
            p = o.matrix_world @ Vector(corner)
            for k in range(3):
                mn[k] = min(mn[k], p[k])
                mx[k] = max(mx[k], p[k])
    return mn, mx

bpy.context.view_layer.update()
mn, mx = scene_bbox()
center = [(mn[k] + mx[k]) / 2 for k in range(3)]
size = [mx[k] - mn[k] for k in range(3)]
# blender(x,y,z) came from gltf(x, -z, y): gltf coords of the same box:
c_gltf = [center[0], center[2], -center[1]]
L = size[1]                       # gltf z (long axis) == blender -y extent
H_model = max(size[0], size[2])   # cross section
print("bbox size", size, "center", center, "L", L, "H", H_model)

# ---------- rig ----------
def empty(name):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    return e

tilt = empty("TILT")
spin = empty("SPIN")
align = empty("ALIGN")
spin.parent = tilt
align.parent = spin
align.rotation_euler = (0, 0, math.pi / 2)

for o in imported:
    o.parent = align
    o.matrix_parent_inverse.identity()
# shift model so its bbox center sits at ALIGN's origin
for o in imported:
    o.location.x -= center[0]
    o.location.y -= center[1]
    o.location.z -= center[2]

# ---------- material overrides (tools/materials.json) ----------
MAT_CFG = "/Users/jayweaver/Projects/personal site/tools/materials.json"
if os.path.exists(MAT_CFG):
    cfg = json.load(open(MAT_CFG))
    bmats = {}
    for mname, m in cfg["materials"].items():
        bm = bpy.data.materials.new("ovr_" + mname)
        bm.use_nodes = True
        bsdf = bm.node_tree.nodes["Principled BSDF"]
        c = m["color"]
        bsdf.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1.0)
        bsdf.inputs["Metallic"].default_value = m.get("metallic", 0.0)
        bsdf.inputs["Roughness"].default_value = m.get("roughness", 0.5)
        if "specular" in m and "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = m["specular"]
        if m.get("alpha", 1.0) < 1.0:
            bsdf.inputs["Alpha"].default_value = m["alpha"]
            if hasattr(bm, "blend_method"):
                bm.blend_method = "BLEND"
            if hasattr(bm, "surface_render_method"):
                bm.surface_render_method = "BLENDED"
        bmats[mname] = bm

    def is_grayish(mat):
        try:
            bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
            col = bsdf.inputs["Base Color"].default_value if bsdf else mat.diffuse_color
            r, g, b = col[0], col[1], col[2]
        except Exception:
            return False
        return 0.28 <= (r + g + b) / 3 <= 0.80 and max(r, g, b) - min(r, g, b) < 0.06

    rules = [(re.compile(r["match"], re.I), r["material"], r.get("gray_only", False))
             for r in cfg["rules"]]
    done, swapped = set(), 0
    for o in scene.objects:
        if o.type != "MESH" or o.data.name in done:
            continue
        nm = re.sub(r"\.\d+$", "", o.name)
        for rx, mname, gray_only in rules:
            if rx.search(nm):
                mesh = o.data
                if len(mesh.materials) == 0:
                    mesh.materials.append(bmats[mname])
                    swapped += 1
                else:
                    for k in range(len(mesh.materials)):
                        cur = mesh.materials[k]
                        if gray_only and (cur is None or not is_grayish(cur)):
                            continue
                        mesh.materials[k] = bmats[mname]
                        swapped += 1
                done.add(mesh.name)
                break
    print("material override: replaced", swapped, "slots on", len(done), "meshes")

# ---------- camera ----------
cam_data = bpy.data.cameras.new("cam")
cam_data.sensor_fit = "VERTICAL"
cam_data.angle_y = math.radians(FOV_DEG)
cam_data.clip_start = 0.01
cam_data.clip_end = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_euler = (math.pi / 2, 0, 0)  # look +y, z up

aspect = W / H
vfov = math.radians(FOV_DEG)
hfov = 2 * math.atan(math.tan(vfov / 2) * aspect)
base_dist = max((L / 2) / math.tan(hfov / 2) / FIT_W,
                (H_model / 2) / math.tan(vfov / 2) / FIT_H)
print("base_dist", base_dist)

# ---------- lighting ----------
scene.render.film_transparent = True
world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
nt = world.node_tree
bg = nt.nodes["Background"]
# bundled studio HDRI
cands = sorted(glob.glob(bpy.utils.resource_path("LOCAL") + "/datafiles/studiolights/world/*.exr"))
studio = next((c for c in cands if "studio" in c), cands[0] if cands else None)
if studio:
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(studio)
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.85   # bright even ambient, CAD-viewer style
    print("world HDRI:", studio)
else:
    bg.inputs["Color"].default_value = (0.8, 0.82, 0.85, 1)
    bg.inputs["Strength"].default_value = 0.85

# Onshape-viewer look: strong even ambient + one soft sun for gentle shading
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 2.0
sun_data.angle = math.radians(25)
sun = bpy.data.objects.new("sun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(55), math.radians(-12), math.radians(20))

scene.view_settings.exposure = 0.0

# Onshape exports everything at roughness 1.0 (fully diffuse). Solder mask
# gets properly glossy; everything else stays matte with low specular so
# surfaces don't pick up a hazy sheen from the bright environment.
for mat in bpy.data.materials:
    if mat.name.startswith("ovr_") or not mat.use_nodes:
        continue
    b = mat.node_tree.nodes.get("Principled BSDF")
    if not b:
        continue
    col = b.inputs["Base Color"].default_value
    if col[2] > 0.3 and col[2] > col[0] * 1.3:          # solder-mask blues: satin, not glossy
        b.inputs["Roughness"].default_value = 0.55
        if "Specular IOR Level" in b.inputs:
            b.inputs["Specular IOR Level"].default_value = 0.25
    elif b.inputs["Roughness"].default_value > 0.6:
        b.inputs["Roughness"].default_value = 0.65
        if "Specular IOR Level" in b.inputs and b.inputs["Metallic"].default_value < 0.5:
            b.inputs["Specular IOR Level"].default_value = 0.2

# The Orange Pi comes in as unnamed pale bodies from its STEP file; recolor
# it by geometry to match the real board: blue PCB, silver shields, black ICs.
def pi_mat(name, color, metallic, rough, spec=None):
    bm = bpy.data.materials.new(name)
    bm.use_nodes = True
    bb = bm.node_tree.nodes["Principled BSDF"]
    bb.inputs["Base Color"].default_value = (*color, 1.0)
    bb.inputs["Metallic"].default_value = metallic
    bb.inputs["Roughness"].default_value = rough
    if spec is not None and "Specular IOR Level" in bb.inputs:
        bb.inputs["Specular IOR Level"].default_value = spec
    return bm

pi_pcb = pi_mat("ovr_pi_pcb", (0.012, 0.09, 0.32), 0.0, 0.55, 0.25)
pi_shield = pi_mat("ovr_pi_shield", (0.65, 0.66, 0.67), 1.0, 0.35)
pi_chip = pi_mat("ovr_pi_chip", (0.04, 0.04, 0.045), 0.0, 0.6, 0.2)
for o in scene.objects:
    if o.type != "MESH" or not o.name.startswith("Orange Pi 3B"):
        continue
    d = sorted(o.dimensions)
    if d[2] > 0.04 and d[0] <= 0.004:
        tgt = pi_pcb          # the board slab itself
    elif d[0] >= 0.008:
        tgt = pi_shield       # chunky boxes: USB / RJ45 shields
    elif d[2] >= 0.007 and d[0] <= 0.0035:
        tgt = pi_chip         # flat packages: SoC, RAM, PMIC
    else:
        tgt = pi_shield       # small bits: pins, SD slot, passives
    mesh = o.data
    if len(mesh.materials) == 0:
        mesh.materials.append(tgt)
    else:
        for k in range(len(mesh.materials)):
            mesh.materials[k] = tgt

# GPS module: brown ceramic patch on top, metallic sides, black PCB
gps_top = pi_mat("ovr_gps_top", (0.45, 0.30, 0.17), 0.0, 0.55, 0.25)
gps_pcb = pi_mat("ovr_gps_pcb", (0.02, 0.02, 0.022), 0.0, 0.6, 0.2)

def is_tan(matslot):
    if not (matslot.material and matslot.material.use_nodes):
        return False
    bb = matslot.material.node_tree.nodes.get("Principled BSDF")
    if not bb:
        return False
    c = bb.inputs["Base Color"].default_value
    return c[0] > 0.6 and c[1] > 0.45 and c[2] < 0.55 and c[0] > c[2]

gps_done = set()
for o in scene.objects:
    if o.type != "MESH" or o.data.name in gps_done:
        continue
    nm = re.sub(r"\.\d+$", "", o.name)
    if nm.startswith("GPS Tracker"):
        mesh = o.data
        gps_done.add(mesh.name)
        for k in range(max(1, len(mesh.materials))):
            if k < len(mesh.materials):
                mesh.materials[k] = gps_pcb
            else:
                mesh.materials.append(gps_pcb)
    elif nm.startswith("fsr53787"):
        mesh = o.data
        gps_done.add(mesh.name)
        for k, slot in enumerate(o.material_slots):
            mesh.materials[k] = gps_top if is_tan(slot) else pi_shield

# ---------- render settings: fast Eevee by default, --cycles for ray tracing ----------
if "--cycles" in ARGS:
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = True
    scene.cycles.device = "GPU"
    scene.cycles.samples = 256
    scene.cycles.use_denoising = True
else:
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = 64
    if hasattr(scene.eevee, "use_raytracing"):
        scene.eevee.use_raytracing = True
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.quality = 85

# ---------- frames ----------
def frame_pose(i):
    if i <= ROT_FRAMES:
        return THETA0 + 2 * math.pi * i / ROT_FRAMES, 0.0
    t = (i - ROT_FRAMES) / (FRAMES - 1 - ROT_FRAMES)
    return THETA0 + 2 * math.pi, t

def render_frame(i, path):
    theta, t = frame_pose(i)
    spin.rotation_euler = (theta, 0, 0)
    tilt.rotation_euler = (0, -TILT_Z * t, TILT_Y * t)
    cam.location = (0, -base_dist * (1 + (DOLLY - 1) * t), 0)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

if "--save" in ARGS:
    # pose the scene at the hero frame and save an openable .blend
    spin.rotation_euler = (THETA0, 0, 0)
    tilt.rotation_euler = (0, 0, 0)
    cam.location = (0, -base_dist, 0)
    blend_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "payload.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print("SAVED", blend_path)
    raise SystemExit(0)

if TEST:
    for i in (0, 95, 150):
        render_frame(i, os.path.join(OUT_DIR, f"test_{i:04d}"))
    print("TEST DONE")
    raise SystemExit(0)

for i in range(FRAMES):
    render_frame(i, os.path.join(OUT_DIR, f"frame_{i:04d}"))
    if i % 20 == 0:
        print(f"rendered {i+1}/{FRAMES}")

json.dump({
    "frames": FRAMES, "w": W, "h": H, "fov": FOV_DEG,
    "theta0": THETA0, "rotFrames": ROT_FRAMES,
    "tiltY": TILT_Y, "tiltZ": TILT_Z, "dolly": DOLLY,
    "baseDist": base_dist, "centerGltf": c_gltf, "L": L, "Hm": H_model,
}, open(META, "w"), indent=1)
print("DONE", FRAMES, "frames ->", OUT_DIR)
