#!/usr/bin/env python3
"""Project the 18 callout anchors into frame pixel coordinates for every
rendered frame, replicating the render rig: Ry(90) -> Rx(theta) -> Ry/Rz tilt,
camera on +z (three.js space), vertical fov. Writes payload_anim.json that the
page fetches (render meta + per-frame anchor pixels)."""
import json, math, os
import numpy as np

META = "/Users/jayweaver/Projects/personal site/images/payload/render_meta.json"
OUT = "/Users/jayweaver/Projects/personal site/images/payload/payload_anim.json"

m = json.load(open(META))
M, W, H = m["frames"], m["w"], m["h"]
vfov = math.radians(m["fov"])
aspect = W / H
f = 1 / math.tan(vfov / 2)
c = np.array(m["centerGltf"])

# Flat anchor list in the page's GROUPS order (6 groups, items in order)
ANCHORS = [
    [ 0.0258, 0.0018, 0.425 ], [ 0.0266, 0.0001, 0.2485], [ 0.0304, 0.0,    0.0485], [ 0.0262,-0.0,    0.153 ],
    [ 0.0,   -0.028,  0.0066],
    [-0.0207,-0.0248, 0.1715], [-0.0242,-0.0165, 0.1953],
    [-0.0486, 0.0,    0.2349], [-0.0486,-0.0,    0.2625], [-0.0194, 0.0,    0.1667], [-0.025,  0.0018, 0.0747],
    [-0.0177, 0.002,  0.0373], [-0.0169, 0.0065, 0.0515], [-0.0242, 0.0102, 0.1955],
    [-0.0029, 0.0264, 0.3606], [-0.0018, 0.021,  0.3367], [ 0.0016, 0.0215, 0.3835], [ 0.0034, 0.0186, 0.0897],
]

def ry(a):
    ca, sa = math.cos(a), math.sin(a)
    return np.array([[ca, 0, sa], [0, 1, 0], [-sa, 0, ca]])

def rz(a):
    ca, sa = math.cos(a), math.sin(a)
    return np.array([[ca, -sa, 0], [sa, ca, 0], [0, 0, 1]])

def rx(a):
    ca, sa = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])

align = ry(math.pi / 2)
frames_px = []
for i in range(M):
    theta = m["theta0"] + (m["theta1"] - m["theta0"]) * i / (M - 1)
    t = min(1.0, max(0.0, (theta - m["thetaLast"]) / (m["theta1"] - m["thetaLast"])))
    R = ry(m["tiltY"] * t) @ rz(m["tiltZ"] * t) @ rx(theta) @ align
    D = m["baseDist"] * (1 + (m["dolly"] - 1) * t)
    row = []
    for a in ANCHORS:
        p = R @ (np.array(a) - c)
        zc = p[2] - D                       # camera at (0,0,D) looking -z
        ndc_x = (f / aspect) * p[0] / (-zc)
        ndc_y = f * p[1] / (-zc)
        px = (ndc_x * 0.5 + 0.5) * W
        py = (0.5 - ndc_y * 0.5) * H
        row.append([round(px, 1), round(py, 1)])
    frames_px.append(row)

json.dump({"frames": M, "w": W, "h": H, "anchors": frames_px}, open(OUT, "w"))
print("wrote", OUT, os.path.getsize(OUT), "bytes")
