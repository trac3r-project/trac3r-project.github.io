"use strict";
// Four synchronised views in one WebGL2 canvas. World: z up. File layout: build_website_assets.py (paper repo).
(() => {
const DIR = "static/cases/", M = ["sam3d", "mira", "shaper", "trac3r"];
const NAME = {sam3d: "SAM 3D", mira: "Mira-Scene", shaper: "ShapeR", trac3r: "Trac3R (ours)"};
const $ = id => document.getElementById(id), canvas = $("gl"), msg = $("msg");

$("copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("bib").textContent); $("copy").textContent = "Copied"; }
  catch (e) { getSelection().selectAllChildren($("bib")); }
};
// file:// and browsers without fetch of local files: say so instead of an empty canvas
const gl = canvas.getContext("webgl2", {antialias: true, alpha: false});
if (!gl) { msg.textContent = "This browser does not support WebGL 2."; return; }

const VS = `#version 300 es
layout(location=0) in vec3 p;layout(location=1) in vec3 n;layout(location=2) in vec3 c;
uniform mat4 V,P;uniform float ps;out vec3 vn,vc;
void main(){vn=mat3(V)*n;vc=c;gl_Position=P*V*vec4(p,1.);gl_PointSize=ps;}`;
const FS = `#version 300 es
precision mediump float;in vec3 vn,vc;uniform vec3 flat_;uniform float useFlat,pts;out vec4 o;
void main(){if(pts>.5){vec2 d=gl_PointCoord-.5;if(dot(d,d)>.25)discard;o=vec4(flat_,1.);return;}
vec3 n=normalize(vn);if(!gl_FrontFacing)n=-n;
float l=.42+.45*max(dot(n,normalize(vec3(.25,.5,1.))),0.)+.18*max(n.y,0.);
o=vec4(min(mix(vc,flat_,useFlat)*l,1.),1.);}`;
let U, pr;
function program() {
  pr = gl.createProgram();
  for (const [t, s] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
    const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h);
    if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(h));
    gl.attachShader(pr, h);
  }
  gl.linkProgram(pr); U = {};
  for (const k of ["V", "P", "ps", "flat_", "useFlat", "pts"]) U[k] = gl.getUniformLocation(pr, k);
}
program();

async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw Error(r.status + " " + url);
  const b = await r.arrayBuffer(), u = new Uint8Array(b);
  if (u[0] !== 0x1f || u[1] !== 0x8b) return b;             // the server already decompressed it
  return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
function header(b) {
  const h = new DataView(b), f = i => h.getFloat32(8 + 4 * i, true);
  return {nV: h.getUint32(0, true), nF: h.getUint32(4, true), lo: [f(0), f(1), f(2)], hi: [f(3), f(4), f(5)]};
}
function decodeMesh(b) {
  const {nV, nF, lo, hi} = header(b), u = new Uint8Array(b, 32), n3 = nV * 3, f3 = nF * 3;
  const pos = new Float32Array(n3), col = new Uint8Array(n3), idx = new Uint32Array(f3), nrm = new Float32Array(n3);
  const s = [0, 1, 2].map(k => (hi[k] - lo[k]) / 65535), q = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < n3; i++) {
    const k = i % 3;
    q[k] = (q[k] + u[i] + (u[n3 + i] << 8)) & 65535; pos[i] = lo[k] + q[k] * s[k];
    col[i] = c[k] = (c[k] + u[2 * n3 + i]) & 255;
  }
  const o = 3 * n3; let a = 0;
  for (let i = 0; i < f3; i++) {
    const z = (u[o + i] | u[o + f3 + i] << 8 | u[o + 2 * f3 + i] << 16 | u[o + 3 * f3 + i] << 24) >>> 0;
    a += z & 1 ? -((z + 1) / 2) : z / 2; idx[i] = a;
  }
  for (let i = 0; i < f3; i += 3) {                          // area-weighted vertex normals
    const A = 3 * idx[i], B = 3 * idx[i + 1], C = 3 * idx[i + 2];
    const x1 = pos[B] - pos[A], y1 = pos[B + 1] - pos[A + 1], z1 = pos[B + 2] - pos[A + 2];
    const x2 = pos[C] - pos[A], y2 = pos[C + 1] - pos[A + 1], z2 = pos[C + 2] - pos[A + 2];
    const nx = y1 * z2 - z1 * y2, ny = z1 * x2 - x1 * z2, nz = x1 * y2 - y1 * x2;
    for (const v of [A, B, C]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
  }
  for (let i = 0; i < n3; i += 3) {                          // unit length: tiny cross products underflow mediump
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
  }
  return {pos, col, nrm, idx};
}
function decodePoints(b) {
  const {nV, lo, hi} = header(b), q = new Uint16Array(b, 32, nV * 3), pos = new Float32Array(nV * 3);
  for (let i = 0; i < q.length; i++) pos[i] = lo[i % 3] + q[i] / 65535 * (hi[i % 3] - lo[i % 3]);
  return {pos};
}
function upload(m) {
  const g = {vao: gl.createVertexArray(), bufs: [], n: m.idx ? m.idx.length : m.pos.length / 3, mesh: !!m.idx};
  const buf = (t, d) => { const x = gl.createBuffer(); gl.bindBuffer(t, x); gl.bufferData(t, d, gl.STATIC_DRAW); g.bufs.push(x); };
  gl.bindVertexArray(g.vao);
  const attr = (l, d, type, norm) => { buf(gl.ARRAY_BUFFER, d); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, type, norm, 0, 0); };
  attr(0, m.pos, gl.FLOAT, false);
  if (m.idx) { attr(1, m.nrm, gl.FLOAT, false); attr(2, m.col, gl.UNSIGNED_BYTE, true); buf(gl.ELEMENT_ARRAY_BUFFER, m.idx); }
  gl.bindVertexArray(null);
  return g;
}
function free(g) { if (g) { gl.deleteVertexArray(g.vao); g.bufs.forEach(b => gl.deleteBuffer(b)); } }

let cases = [], cur = null, gpu = {}, token = 0, cam = null, spin = false, dirty = true, active = false, visible = false;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FOV = 0.6;
// Observed points drawn (the files hold more, in random order): per object of a scene, for a single object, size in px.
const PTS_SCENE = 120, PTS_OBJ = 800, PT_SIZE = 1.6;
const nPoints = c => c.n_obj > 1 ? PTS_SCENE * c.n_obj : PTS_OBJ;
function resetView() {
  const d = cur.cam.map((v, i) => v - cur.center[i]), l = Math.hypot(...d);
  cam = {yaw: Math.atan2(d[1], d[0]), pitch: Math.max(0.12, Math.min(1.2, Math.asin(d[2] / l))), zoom: 1};
  cam.yaw0 = cam.yaw; spin = !reduce; t0 = performance.now(); dirty = true;
}
let t0 = 0;
async function load(c) {
  cur = c; const my = ++token;
  M.concat("points").forEach(k => free(gpu[k])); gpu = {};
  document.querySelectorAll("#picker button").forEach(b => b.setAttribute("aria-pressed", b.dataset.id === c.id));
  $("inimg").src = DIR + c.id + ".jpg"; $("inimg").alt = "Input image: " + c.title;
  $("incap").textContent = `Input image. ${c.dataset}, ${c.depth}, ${c.n_obj} object${c.n_obj > 1 ? "s" : ""}.`;
  document.querySelectorAll(".tag").forEach(t => {
    const m = c.methods[t.dataset.m], b = document.createElement("b");
    b.textContent = NAME[t.dataset.m];
    t.replaceChildren(b, `CD ${m.cd.toFixed(1)} ${c.unit}`, document.createElement("br"), `${m.sec.toFixed(1)} s / object`);
  });
  resetView(); msg.textContent = "Loading…";
  try {
    await Promise.all(["trac3r", "points", "sam3d", "mira", "shaper"].map(async k => {
      const b = await fetchBin(`${DIR}${c.id}_${k}.bin.gz`);
      if (my !== token) return;
      gpu[k] = upload(k === "points" ? decodePoints(b) : decodeMesh(b)); dirty = true;
    }));
    if (my === token) { msg.textContent = ""; t0 = performance.now(); }
  } catch (e) { if (my === token) msg.textContent = "Could not load this case."; console.error(e); }
}
function matrices(asp) {
  const {yaw, pitch, zoom} = cam, f = 1 / Math.tan(FOV / 2);
  const dist = 1.12 * cur.radius * f / Math.min(1, asp) * zoom, cp = Math.cos(pitch);
  const z = [cp * Math.cos(yaw), cp * Math.sin(yaw), Math.sin(pitch)];
  const x = [-Math.sin(yaw), Math.cos(yaw), 0];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const e = cur.center.map((c, i) => c + dist * z[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const V = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  const n = Math.max(dist * 0.02, dist - 5 * cur.radius), F = dist + 8 * cur.radius;
  return [V, [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (F + n) / (n - F), -1, 0, 0, 2 * F * n / (n - F), 0]];
}
function draw() {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
  if (!W || !H) return;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  gl.clearColor(1, 1, 1, 1); gl.viewport(0, 0, W, H); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.useProgram(pr);
  const w = W >> 1, h = H >> 1, [V, P] = matrices(w / h);
  gl.uniformMatrix4fv(U.V, false, V); gl.uniformMatrix4fv(U.P, false, P);
  gl.uniform1f(U.ps, PT_SIZE * dpr);
  M.forEach((k, i) => {
    gl.viewport((i % 2) * w, i < 2 ? h : 0, w, h);
    const g = gpu[k];
    if (g) {
      gl.uniform1f(U.pts, 0); gl.uniform1f(U.useFlat, $("t-err").checked ? 0 : 1); gl.uniform3f(U.flat_, .62, .72, .88);
      gl.bindVertexArray(g.vao); gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_INT, 0);
    }
    if (gpu.points && $("t-pts").checked) {
      gl.uniform1f(U.pts, 1); gl.uniform3f(U.flat_, .14, .36, .84);
      gl.bindVertexArray(gpu.points.vao); gl.drawArrays(gl.POINTS, 0, Math.min(gpu.points.n, nPoints(cur)));
    }
  });
  gl.bindVertexArray(null);
}
function frame(t) {
  if (cur && visible && !document.hidden) {
    if (spin) { cam.yaw = cam.yaw0 + 0.6 * Math.sin((t - t0) / 2600); dirty = true; }
    if (dirty && !gl.isContextLost()) { dirty = false; draw(); }
  }
  requestAnimationFrame(frame);
}
const touch = new Map();
const stop = () => { spin = false; dirty = true; };
canvas.addEventListener("pointerdown", e => { canvas.setPointerCapture(e.pointerId); touch.set(e.pointerId, [e.clientX, e.clientY]); active = true; stop(); });
for (const k of ["pointerup", "pointercancel"]) canvas.addEventListener(k, e => touch.delete(e.pointerId));
canvas.addEventListener("pointerleave", () => { if (!touch.size) active = false; });
const clampZ = z => Math.max(0.15, Math.min(4, z));
canvas.addEventListener("pointermove", e => {
  const a = touch.get(e.pointerId);
  if (!a || !cam) return;
  const gap = () => { const [p, q] = [...touch.values()]; return Math.hypot(p[0] - q[0], p[1] - q[1]) || 1; };
  const two = touch.size === 2, g0 = two ? gap() : 1;
  touch.set(e.pointerId, [e.clientX, e.clientY]);
  if (two) cam.zoom = clampZ(cam.zoom * g0 / gap());
  else {
    cam.yaw -= (e.clientX - a[0]) * 0.008;
    cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + (e.clientY - a[1]) * 0.008));
  }
  dirty = true;
});
canvas.addEventListener("touchmove", e => { if (e.touches.length > 1) e.preventDefault(); }, {passive: false});
canvas.addEventListener("wheel", e => { if (!active || !cam) return; e.preventDefault(); stop(); cam.zoom = clampZ(cam.zoom * Math.exp(e.deltaY * 0.0012)); }, {passive: false});
canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); gpu = {}; });
canvas.addEventListener("webglcontextrestored", () => { program(); if (cur) load(cur); });
for (const k of ["t-err", "t-pts"]) $(k).onchange = () => { dirty = true; document.querySelector(".legend").classList.toggle("off", !$("t-err").checked); };
$("t-reset").onclick = () => cur && resetView();
new ResizeObserver(() => { dirty = true; }).observe(canvas);

let started = false;
new IntersectionObserver(es => {                              // load 3-D data only when the section is near
  visible = es[es.length - 1].isIntersecting;
  if (visible && !started && cases.length) { started = true; load(cases[0]); }
  dirty = true;
}, {rootMargin: "200px"}).observe(canvas);
fetch(DIR + "cases.json").then(r => r.json()).then(js => {
  cases = js;
  for (const c of cases) {
    const b = document.createElement("button"), im = document.createElement("img");
    b.type = "button"; b.dataset.id = c.id; b.setAttribute("aria-pressed", "false");
    im.src = DIR + c.id + ".jpg"; im.alt = ""; im.loading = "lazy";
    b.append(im, c.title); b.onclick = () => { started = true; load(c); };
    $("picker").append(b);
  }
  if (visible && !started) { started = true; load(cases[0]); }
}).catch(() => { msg.textContent = "Open this page through a web server (python3 -m http.server)."; });
requestAnimationFrame(frame);
})();
