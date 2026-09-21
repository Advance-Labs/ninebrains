/**
 * The stage: one full-bleed WebGL2 canvas behind the page.
 *
 * Three passes, all hand-written, no library:
 *   1. The field. A monochrome port of omp.sh's "eclipse" shader: the limb of a huge off-screen
 *      circle drawn as a dithered field of 2px cells in three grey levels, with a slow brightness
 *      wave travelling along the rim, a twinkle that re-rolls cells in staggered buckets, film
 *      grain, a vignette and a sparse salt-and-pepper grade.
 *   2. Dust. A few thousand silver points drifting off the limb, positioned entirely in the vertex
 *      shader from `gl_VertexID`, so there is no particle buffer at all.
 *   3. The nine cubes. The Ninebrains mark, as nine lit boxes that stay on stage for the whole
 *      visit. Every scene gives them an arrangement and a camera, animated on the scene's clock
 *      (Lanes: four panes; The Brain: a hub and spokes; Gates: a conveyor through a frame; and so
 *      on). Changing scene tweens every cube, the camera and the on-screen slot over 900ms.
 *
 * The cubes are drawn into the active panel's `[data-slot]` box with a lens shift: the projection
 * is squeezed and moved in clip space onto that box, so the arrangement sits exactly in the layout
 * without a second canvas and without clipping at the box edge.
 *
 * Budget: devicePixelRatio is capped at 1.5 and the backing store at 2.2M pixels; the loop stops
 * while the tab is hidden; under reduced motion it draws one still frame per change and nothing
 * else. It is decoration, so any failure just leaves the page's CSS gradient in place.
 */

const TAU = Math.PI * 2;
const SPACING = 1.78;
const CORE = 20 / 13;
const SWITCH_MS = 900;
const INTRO_MS = 1150;
const MAX_PIXELS = 2.2e6;
/** The still frame (seconds into each scene) shown when motion is reduced. */
const POSTER = [5, 8, 10, 6.2, 10.6, 6, 7.4];

const STATE = {
  pass: [0.29, 0.87, 0.5],
  fail: [0.97, 0.44, 0.44],
  warn: [0.98, 0.75, 0.14],
  run: [0.38, 0.65, 0.98],
};

// --- shaders ----------------------------------------------------------------------------------

const HASH = `
  uint hash(uint v) {
    v ^= v >> 16u; v *= 0x7feb352du;
    v ^= v >> 15u; v *= 0x846ca68bu;
    return v ^ (v >> 16u);
  }
  float rnd(uint v) { return float(hash(v) >> 8u) / 16777216.0; }
`;

const FIELD_VS = `#version 300 es
  void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const FIELD_FS = `#version 300 es
  precision highp float;
  precision highp int;
  uniform vec2 uRes;      // css px
  uniform float uDpr;
  uniform vec2 uCenter;   // css px, y up
  uniform float uRadius;
  uniform float uScale;
  uniform float uFrame;
  uniform float uWaveK;
  uniform float uLight;
  uniform vec3 uBase;
  uniform vec3 uEdge;
  uniform vec3 uSky;
  uniform vec3 uMid;
  uniform vec3 uFar;
  out vec4 outColor;
  ${HASH}
  float vignette(vec2 p) {
    float n = distance(p, uRes * 0.5) / (1600.0 * uScale);
    return max(0.2, 1.0 - n * n * n);
  }
  void main() {
    vec2 css = gl_FragCoord.xy / uDpr;
    uvec2 px = uvec2(gl_FragCoord.xy);
    uint pixel = px.y * 8192u + px.x;
    float grain = (rnd(pixel ^ 0x9e3779b9u ^ (uint(uFrame) * 0x27d4eb2fu)) - 0.5) * (20.0 / 255.0);
    float v = vignette(css);
    vec3 base = mix(uEdge, uBase, v);
    vec3 color = base;

    vec2 cell = floor(css * 0.5) * 2.0;
    vec2 delta = cell - uCenter;
    float rim = length(delta) - uRadius;
    if (rim >= 0.0) {
      float s = uScale;
      float theta = atan(delta.y, delta.x);
      float glimmer = 1.0 + 0.24 * sin(theta * uWaveK - uFrame * (6.2831853 * 2.2 / 720.0));
      float shade = mix(v, 1.0, uLight);
      vec3 ink = vec3(-1.0);
      if (rim < 5.0 * s) {
        ink = uSky;
      } else {
        float sky = exp(-rim / (14.0 * s));
        float mid = exp(-rim / (120.0 * s)) * min(1.0, rim / (10.0 * s)) * 0.85;
        float far = exp(-rim / (600.0 * s)) * min(1.0, rim / (30.0 * s)) * 0.7;
        float total = min(1.0, sky + mid + far);
        if (total > 0.003) {
          uint columns = uint(ceil(uRes.x * 0.5));
          uint index = uint(cell.y * 0.5) * columns + uint(cell.x * 0.5);
          uint bucket = hash(index ^ 0x85ebca6bu) % 90u;
          uint generation = (uint(max(0.0, floor(uFrame))) + 89u - bucket) / 90u;
          float roll = rnd(index ^ (generation * 0xc2b2ae35u) ^ 0x20260712u);
          if (roll < sky) ink = uSky;
          else if (roll < sky + mid) ink = uMid;
          else if (roll < total) ink = uFar;
        }
      }
      if (ink.x >= 0.0) {
        float lift = ink == uSky ? glimmer : 1.0;
        color = base + (ink - base) * clamp(shade * lift, 0.0, 1.25);
      }
    }
    // The grade: a fixed sprinkle of pure black and white at 10/255, like dust on film.
    uvec2 tile = px % uvec2(512u);
    float speck = rnd((tile.y * 512u + tile.x) ^ 0xc2b2ae35u);
    if (speck < 0.045) color = mix(color, vec3(speck < 0.023 ? 0.0 : 1.0), 10.0 / 255.0);
    outColor = vec4(max(color + grain, vec3(0.0)), 1.0);
  }
`;

const DUST_VS = `#version 300 es
  precision highp float;
  precision highp int;
  uniform vec2 uRes;
  uniform float uDpr;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uScale;
  uniform float uFrame;
  uniform vec2 uArc;
  uniform float uDepth;
  out float vAlpha;
  out float vShade;
  ${HASH}
  void main() {
    uint seed = hash(uint(gl_VertexID) ^ 0xa511e9b3u);
    float thetaBase = mix(uArc.x, uArc.y, rnd(seed));
    float sampled = uDepth * (1.0 - pow(rnd(seed ^ 0x63d83595u), 1.0 / 3.0));
    float maxDepth = max(sampled, 14.0 * uScale);
    float speed = (0.14 + rnd(seed ^ 0x9e3779b9u) * 0.22) * uScale;
    float offset = rnd(seed ^ 0xc2b2ae35u) * maxDepth;
    float travel = uFrame * speed + offset;
    float depth = travel - floor(travel / maxDepth) * maxDepth;
    float radius = uRadius - depth;
    float freq = 0.004 + rnd(seed ^ 0x27d4eb2fu) * 0.011;
    float phase = rnd(seed ^ 0x165667b1u) * 6.2831853;
    float wander = -(0.06 * uScale / freq) * cos(uFrame * freq + phase) / max(radius, 1.0);
    float theta = thetaBase + wander;
    vec2 p = uCenter + radius * vec2(cos(theta), sin(theta));
    gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 2.0 * uDpr;
    float n = distance(p, uRes * 0.5) / (1600.0 * uScale);
    vShade = max(0.2, 1.0 - n * n * n);
    vAlpha = max(0.0, min(min(1.0, depth / 3.0), (maxDepth - depth) / (maxDepth * 0.25)));
  }
`;

const DUST_FS = `#version 300 es
  precision mediump float;
  uniform vec3 uSilver;
  in float vAlpha;
  in float vShade;
  out vec4 outColor;
  void main() { outColor = vec4(uSilver, vAlpha * vShade * 0.72); }
`;

const CUBE_VS = `#version 300 es
  precision highp float;
  in vec3 aPos;
  in vec3 aNormal;
  uniform mat4 uProj;
  uniform mat4 uView;
  uniform mat3 uRot;
  uniform vec3 uPos;
  uniform vec3 uSize;
  uniform vec4 uLens;
  out vec3 vNormal;
  out vec3 vWorld;
  out vec3 vLocal;
  void main() {
    vec3 world = uPos + uRot * (aPos * uSize);
    vWorld = world;
    vLocal = aPos;
    vNormal = normalize(uRot * (aNormal / uSize));
    vec4 clip = uProj * uView * vec4(world, 1.0);
    clip.xy = clip.xy * uLens.xy + uLens.zw * clip.w;
    gl_Position = clip;
  }
`;

const CUBE_FS = `#version 300 es
  precision highp float;
  uniform vec3 uEye;
  uniform vec3 uSize;
  uniform float uBright;
  uniform float uAlpha;
  uniform vec4 uTint;
  uniform vec3 uLo;
  uniform vec3 uHi;
  uniform vec3 uEdgeInk;
  uniform vec3 uBg;
  in vec3 vNormal;
  in vec3 vWorld;
  in vec3 vLocal;
  out vec4 outColor;
  void main() {
    vec3 n = normalize(vNormal);
    float lambert = max(dot(n, normalize(vec3(0.35, 0.62, 0.85))), 0.0);
    float fill = max(dot(n, normalize(vec3(-0.6, -0.2, 0.4))), 0.0) * 0.18;
    vec3 view = normalize(uEye - vWorld);
    float rim = pow(1.0 - max(dot(n, view), 0.0), 2.5) * 0.3;
    vec3 color = mix(uLo, uHi, clamp(0.16 + 0.76 * lambert + fill, 0.0, 1.0)) + rim;
    // Bevel: where two faces meet, draw a crisp line so the cubes read as objects, not blobs.
    vec3 fromEdge = (0.5 - abs(vLocal)) * uSize;
    float w = 0.022 + 0.012 * max(uSize.x, max(uSize.y, uSize.z));
    vec3 near = step(fromEdge, vec3(w));
    float edge = step(1.5, near.x + near.y + near.z);
    color = mix(color, uEdgeInk, edge * 0.8);
    color = mix(color, uTint.rgb * (0.55 + 0.6 * lambert) + rim * 0.5, uTint.a);
    color += max(uBright - 1.0, 0.0) * 0.6;
    color = mix(uBg, color, clamp(0.16 + 0.84 * uBright, 0.0, 1.0));
    outColor = vec4(color, uAlpha);
  }
`;

const LINE_VS = `#version 300 es
  precision highp float;
  in vec3 aPos;
  in vec4 aColor;
  uniform mat4 uProj;
  uniform mat4 uView;
  uniform vec4 uLens;
  out vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 clip = uProj * uView * vec4(aPos, 1.0);
    clip.xy = clip.xy * uLens.xy + uLens.zw * clip.w;
    gl_Position = clip;
  }
`;

const LINE_FS = `#version 300 es
  precision mediump float;
  in vec4 vColor;
  out vec4 outColor;
  void main() { outColor = vColor; }
`;

// --- small math -------------------------------------------------------------------------------

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const lerp = (a, b, k) => a + (b - a) * k;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 0 before `a`, eases to 1 by `a + d`. */
const ramp = (t, a, d = 0.5) => easeInOut(clamp01((t - a) / d));
/** A flash that jumps to 1 at `a` and decays. */
const flash = (t, a, decay = 1.6) => (t < a ? 0 : Math.exp(-(t - a) * decay));

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const r = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (near + far) * r, -1, 0, 0, 2 * near * far * r, 0];
}

function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
function rotX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
function rotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** Column-major 3x3 rotation from Euler angles, applied Z, then X, then Y. */
function euler3([x, y, z]) {
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(x),
    Math.sin(x),
    Math.cos(y),
    Math.sin(y),
    Math.cos(z),
    Math.sin(z),
  ];
  // R = Ry * Rx * Rz
  const m00 = cy * cz + sy * sx * sz;
  const m01 = -cy * sz + sy * sx * cz;
  const m02 = sy * cx;
  const m10 = cx * sz;
  const m11 = cx * cz;
  const m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz;
  const m21 = sy * sz + cy * sx * cz;
  const m22 = cy * cx;
  return new Float32Array([m00, m10, m20, m01, m11, m21, m02, m12, m22]);
}

function cubeGeometry() {
  const faces = [
    [
      [0, 0, 1],
      [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
    ],
    [
      [0, 0, -1],
      [
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
        [-1, 1, -1],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
        [-1, -1, 1],
      ],
    ],
    [
      [1, 0, 0],
      [
        [1, -1, 1],
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-1, -1, -1],
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
      ],
    ],
  ];
  const data = [];
  for (const [normal, corners] of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) data.push(...corners[i].map((v) => v * 0.5), ...normal);
  }
  return new Float32Array(data);
}

// --- cube states and the scenes ---------------------------------------------------------------

/** One actor: position, size, Euler rotation, brightness, state tint (rgb + amount), alpha. */
function actor(p, size = 1, extra = {}) {
  const s = typeof size === 'number' ? [size, size, size] : size;
  return {
    p: [...p],
    s: [...s],
    r: extra.r ?? [0, 0, 0],
    b: extra.b ?? 1,
    tint: extra.tint ?? [1, 1, 1, 0],
    a: extra.a ?? 1,
  };
}

const hidden = () => actor([0, 0, 0], 0, { a: 0, b: 0 });

function tinted(color, amount) {
  return [...STATE[color], clamp01(amount)];
}

function markPosition(i) {
  return [((i % 3) - 1) * SPACING, (1 - Math.floor(i / 3)) * SPACING, 0];
}

/** A wire box around `c` with half-extents `h`, as line segments. */
function wireBox(c, h, color) {
  const [x, y, z] = c;
  const [a, b, d] = h;
  const corners = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) corners.push([x + sx * a, y + sy * b, z + sz * d]);
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  return edges.map(([i, j]) => [corners[i], corners[j], color]);
}

/** A polyline through a quadratic arc from `a` to `b`, lifted by `h`, as segments. */
function arc(a, b, h, color, steps = 18) {
  const segs = [];
  const at = (k) => [
    lerp(a[0], b[0], k),
    lerp(a[1], b[1], k) + Math.sin(k * Math.PI) * h,
    lerp(a[2], b[2], k),
  ];
  for (let i = 0; i < steps; i++) segs.push([at(i / steps), at((i + 1) / steps), color]);
  return segs;
}

const arcPoint = (a, b, h, k) => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k) + Math.sin(k * Math.PI) * h,
  lerp(a[2], b[2], k),
];

/**
 * Each scene returns { cubes: 9 actors, sparks: 3 actors, lines, cam }. `ink` is the neutral line
 * colour for the current theme. `t` is the scene clock in seconds.
 */
const SCENES = [
  // 00 Overview: the mark, turning slowly in the dark.
  (t) => {
    const cubes = [];
    for (let i = 0; i < 9; i++) {
      const p = markPosition(i);
      p[2] = 0.16 * Math.sin(t * 1.25 + i * 0.8);
      cubes.push(actor(p, i === 4 ? CORE : 1, { b: i === 4 ? 1.02 : 0.9 }));
    }
    return {
      cubes,
      sparks: [hidden(), hidden(), hidden()],
      lines: [],
      cam: {
        yaw: -0.42 + 0.5 * Math.sin((t / 11) * TAU),
        pitch: 0.24 + 0.08 * Math.sin(t * 0.45),
        target: [0, 0, 0],
        radius: 3.35,
      },
    };
  },

  // 01 Lanes: four lit panes in a 2x2 grid, the other five parked and dim below.
  (t) => {
    const cubes = [];
    const panes = { 0: [-1.1, 0.74], 2: [1.1, 0.74], 6: [-1.1, -0.74], 8: [1.1, -0.74] };
    let parked = 0;
    for (let i = 0; i < 9; i++) {
      if (panes[i]) {
        const [x, y] = panes[i];
        const done = i === 2 ? flash(t, 7, 0.8) * 0.8 : 0;
        cubes.push(
          actor([x, y, 0.06 * Math.sin(t * 1.4 + i)], [2.02, 1.3, 0.12], {
            b: 0.86 + 0.14 * Math.sin(t * 3.1 + i * 1.7),
            tint: tinted('pass', done),
          })
        );
      } else {
        const k = parked++;
        cubes.push(
          actor([-1.6 + k * 0.8, -2.08 + 0.05 * Math.sin(t * 2 + k), 0.2], 0.4, {
            b: 0.2,
            r: [0, t * 0.4 + k, 0],
          })
        );
      }
    }
    return {
      cubes,
      sparks: [hidden(), hidden(), hidden()],
      lines: [],
      cam: {
        yaw: -0.52 + 0.08 * Math.sin(t * 0.5),
        pitch: 0.14,
        target: [0, -0.3, 0],
        radius: 2.95,
      },
    };
  },

  // 02 The Brain: the core rises as the hub; jobs travel down the spokes to idle lanes.
  (t) => {
    const hub = [0, 1.35, 0];
    const ring = [0, 1, 2, 3, 5, 6, 7, 8];
    const dispatch = { 1: 4.4, 3: 6.2, 5: 8.8, 7: 9.4 };
    const cubes = new Array(9);
    cubes[4] = actor(hub, 1.3, { r: [0.2, t * 0.6, 0], b: 1.05 + 0.1 * Math.sin(t * 2.2) });
    const lines = [];
    const sparks = [hidden(), hidden(), hidden()];
    ring.forEach((i, k) => {
      const angle = (k / 8) * TAU + t * 0.12;
      const p = [Math.cos(angle) * 2.7, -0.95, Math.sin(angle) * 2.7];
      const at = dispatch[k];
      const lit = at === undefined ? 0 : ramp(t, at, 0.35);
      const done = k === 1 ? ramp(t, 8.4, 0.4) : 0;
      cubes[i] = actor(p, 0.62, {
        b: 0.3 + 0.7 * lit,
        r: [0, -angle, 0],
        tint: done > 0 ? tinted('pass', 0.55 * done) : tinted('run', 0.35 * lit),
      });
      lines.push([hub, p, [1, 1, 1, 0.1 + 0.35 * lit]]);
      if (at !== undefined && t > at - 0.9 && t < at + 0.1) {
        const e = easeInOut(clamp01((t - (at - 0.9)) / 0.9));
        sparks[k % 3] = actor(arcPoint(hub, p, 0.6, e), 0.17, { b: 1.9 });
      }
    });
    return {
      cubes,
      sparks,
      lines,
      cam: { yaw: -0.3, pitch: 0.42, target: [0, 0.15, 0], radius: 3.5 },
    };
  },

  // 03 Gates: cubes ride through a frame one by one; one bounces back red, retries, passes green.
  (t) => {
    const launches = [0.6, 1.7, 2.8, 5.8, 6.9, 8.0, 9.1];
    const conveyor = [0, 1, 2, 3, 5, 6, 7];
    const speed = 3.5;
    // Waiting cubes queue up to the left of the frame and shuffle forward as each one leaves.
    const front = -2.2;
    const hit = -front / speed;
    const moved = launches.reduce((sum, at) => sum + ramp(t, at, 0.5), 0);
    const cubes = new Array(9);
    let frameFail = 0;
    let framePass = 0;
    conveyor.forEach((i, k) => {
      const u = t - launches[k];
      let x;
      let tint = [1, 1, 1, 0];
      let passAt = launches[k] + hit;
      if (u < 0) {
        x = front - 1.0 * Math.max(k - moved, 0);
      } else if (k === 2) {
        // The one that fails: reaches the frame, is thrown back, waits, and tries again.
        if (u < hit) x = front + speed * u;
        else if (u < hit + 0.5) x = -1.8 * easeOut((u - hit) / 0.5);
        else if (u < hit + 1.05) x = -1.8;
        else x = -1.8 + speed * (u - hit - 1.05);
        const failAt = launches[k] + hit;
        passAt = failAt + 1.05 + 1.8 / speed;
        if (t >= failAt && t < passAt) {
          tint = tinted('fail', 0.9);
          frameFail = Math.max(frameFail, flash(t, failAt, 1.2));
        }
      } else {
        x = front + speed * u;
      }
      if (u >= 0 && t >= passAt) {
        tint = tinted('pass', 0.85 * flash(t, passAt, 1.1));
        framePass = Math.max(framePass, flash(t, passAt, 2.2));
      }
      const size = 0.9 * smooth(-5.6, -4.4, x) * (1 - smooth(4.2, 5.4, x));
      const waiting = u < 0 ? 0.55 : 1;
      cubes[i] = actor([x, 0, 0], size, {
        tint,
        b: waiting,
        r: [0, 0, -x * 0.15],
        a: size > 0.01 ? 1 : 0,
      });
    });
    cubes[4] = actor([0, 1.72, 0], 0.62, {
      r: [0.3, t * 0.8, 0],
      b: 0.9 + 0.5 * framePass,
    });
    cubes[8] = actor([4.6, -1.15, 0.6], 0.42, { b: 0.2, r: [0, t * 0.5, 0] });
    const ink = frameFail > 0.02 ? [...STATE.fail, 0.3 + 0.6 * frameFail] : null;
    const color =
      ink ?? (framePass > 0.02 ? [...STATE.pass, 0.3 + 0.6 * framePass] : [1, 1, 1, 0.45]);
    const lines = wireBox([0, 0, 0], [0.06, 1.15, 1.15], color);
    lines.push([
      [-5.4, -0.5, 0],
      [5.4, -0.5, 0],
      [1, 1, 1, 0.12],
    ]);
    return {
      cubes,
      sparks: [hidden(), hidden(), hidden()],
      lines,
      cam: { yaw: -0.78, pitch: 0.3, target: [0, 0.2, 0], radius: 4.3 },
    };
  },

  // 04 Planner: a job DAG laid out left to right; a cycle is refused, then it compiles.
  (t) => {
    const nodes = [
      [0, 0],
      [1, 1.1],
      [1, -1.1],
      [2, 1.6],
      [2, 0],
      [2, -1.6],
      [3, 0.8],
      [3, -0.8],
      [4, 0],
    ];
    const edges = [
      [0, 1],
      [0, 2],
      [1, 3],
      [1, 4],
      [2, 4],
      [2, 5],
      [3, 6],
      [4, 6],
      [5, 7],
      [6, 8],
      [7, 8],
    ];
    const cycle = new Set([0, 1, 4, 6, 8]);
    const pos = nodes.map(([c, y]) => [(c - 2) * 2.1, y, 0]);
    const inCycle = t >= 4.4 && t < 7.4;
    const cubes = nodes.map(([c], i) => {
      const grow = easeOut(clamp01((t - 0.2 - i * 0.16) / 0.45));
      const compiled = ramp(t, 9.3 + c * 0.22, 0.35);
      let tint = [1, 1, 1, 0];
      if (inCycle && cycle.has(i)) tint = tinted('fail', 0.75);
      else if (compiled > 0) tint = tinted('pass', 0.8 * flash(t, 9.3 + c * 0.22, 1.2));
      return actor(pos[i], [1.3 * grow, 0.72 * grow, 0.3 * grow], {
        b: 0.5 + 0.5 * compiled,
        tint,
        a: grow > 0.01 ? 1 : 0,
      });
    });
    const lines = [];
    for (const [a, b] of edges) {
      const shown = ramp(t, 0.5 + Math.max(a, b) * 0.16, 0.3);
      if (shown <= 0) continue;
      const from = [pos[a][0] + 0.65, pos[a][1], 0];
      const to = [pos[b][0] - 0.65, pos[b][1], 0];
      const red = inCycle && cycle.has(a) && cycle.has(b);
      lines.push([from, to, red ? [...STATE.fail, 0.8] : [1, 1, 1, 0.45 * shown]]);
    }
    if (t >= 2.6 && t < 7.4) {
      const fade = ramp(t, 2.6, 0.4) * (1 - ramp(t, 7, 0.4));
      lines.push(...arc(pos[8], pos[0], 3, [...STATE.fail, 0.85 * fade], 28));
    }
    return {
      cubes,
      sparks: [hidden(), hidden(), hidden()],
      lines,
      cam: { yaw: -0.3, pitch: 0.34, target: [0, 0.2, 0], radius: 4.9 },
    };
  },

  // 05 Packs: three bundles of three; the coding pack switches on, the others stay off.
  (t) => {
    const cubes = new Array(9);
    const lines = [];
    const local = [
      [-0.45, -0.4, 0.22],
      [0.45, -0.4, -0.22],
      [0, 0.44, 0],
    ];
    for (let bundle = 0; bundle < 3; bundle++) {
      const on = bundle === 0 ? ramp(t, 3.4, 0.5) : 0;
      const center = [(bundle - 1) * 2.9, 0.35 * on, 0];
      const angle = t * 0.35 + bundle * 1.3;
      const spread = 1 + 0.15 * on;
      local.forEach(([x, y, z], k) => {
        const rx = (x * Math.cos(angle) + z * Math.sin(angle)) * spread;
        const rz = (-x * Math.sin(angle) + z * Math.cos(angle)) * spread;
        cubes[bundle * 3 + k] = actor([center[0] + rx, center[1] + y * spread, rz], 0.76, {
          r: [0, angle, 0],
          b: 0.3 + 0.75 * on,
          tint: tinted('pass', 0.5 * flash(t, 3.4, 1.4) * on),
        });
      });
      const alpha = 0.16 + 0.5 * on;
      lines.push(...wireBox(center, [1.12, 1.02, 0.95], [1, 1, 1, alpha]));
    }
    return {
      cubes,
      sparks: [hidden(), hidden(), hidden()],
      lines,
      cam: { yaw: -0.22, pitch: 0.3, target: [0, 0.1, 0], radius: 4.3 },
    };
  },

  // 06 Freebuff: one agent hits its limit and dims; a glowing token carries the lane across.
  (t) => {
    const cubes = new Array(9);
    const a = [-1.9, 0, 0];
    const b = [1.9, 0, 0];
    const dimA = ramp(t, 2.6, 1);
    cubes[3] = actor(a, 1.25, {
      r: [0.15, 0.5 + t * 0.5 * (1 - dimA), 0],
      b: (0.95 + 0.1 * Math.sin(t * 3)) * (1 - 0.72 * dimA),
      tint: tinted('warn', 0.75 * ramp(t, 2.6, 0.3) * (1 - 0.4 * ramp(t, 6, 1.5))),
    });
    const litB = ramp(t, 6.2, 0.5);
    cubes[5] = actor(b, 1.25, {
      r: [0.15, -0.5 - t * 0.5 * litB, 0],
      b: 0.3 + 0.7 * litB + 0.08 * Math.sin(t * 3) * litB,
      tint: tinted('run', 0.35 * flash(t, 6.2, 0.9)),
    });
    const small = [0, 1, 2, 4, 6, 7, 8];
    small.forEach((i, k) => {
      cubes[i] = actor([-2.4 + k * 0.8, -1.25, -2.2], 0.4, { b: 0.2, r: [0, t * 0.3 + k, 0] });
    });
    const sparks = [hidden(), hidden(), hidden()];
    const from = [a[0] + 0.3, a[1] + 0.2, 0];
    const to = [b[0] - 0.3, b[1] + 0.2, 0];
    if (t >= 4.3 && t < 4.8) {
      sparks[0] = actor(from, 0.28 * ramp(t, 4.3, 0.5), { b: 1.9 });
    } else if (t >= 4.8 && t < 6.3) {
      const e = easeInOut(clamp01((t - 4.8) / 1.4));
      sparks[0] = actor(arcPoint(from, to, 1.7, e), 0.28, { b: 1.9, r: [t * 2, t * 3, 0] });
    }
    const lines = [];
    if (t >= 4.3 && t < 7.4) {
      const alpha = 0.3 * ramp(t, 4.3, 0.4) * (1 - ramp(t, 6.8, 0.6));
      lines.push(...arc(from, to, 1.7, [1, 1, 1, alpha], 22));
    }
    return {
      cubes,
      sparks,
      lines,
      cam: { yaw: 0.26, pitch: 0.18, target: [0, -0.1, 0], radius: 3.4 },
    };
  },
];

function blendActor(from, to, k) {
  return {
    p: from.p.map((v, i) => lerp(v, to.p[i], k)),
    s: from.s.map((v, i) => lerp(v, to.s[i], k)),
    r: from.r.map((v, i) => lerp(v, to.r[i], k)),
    b: lerp(from.b, to.b, k),
    tint: from.tint.map((v, i) => lerp(v, to.tint[i], k)),
    a: lerp(from.a, to.a, k),
  };
}

function blendCam(from, to, k) {
  return {
    yaw: lerp(from.yaw, to.yaw, k),
    pitch: lerp(from.pitch, to.pitch, k),
    target: from.target.map((v, i) => lerp(v, to.target[i], k)),
    radius: lerp(from.radius, to.radius, k),
  };
}

function blendRect(from, to, k) {
  return {
    x: lerp(from.x, to.x, k),
    y: lerp(from.y, to.y, k),
    w: lerp(from.w, to.w, k),
    h: lerp(from.h, to.h, k),
    dim: lerp(from.dim, to.dim, k),
  };
}

/** Where the cubes fall in from during the intro: a deterministic ring out in the dark. */
function introFrom() {
  let seed = 9;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return Array.from({ length: 9 }, (_, i) => {
    const angle = random() * TAU;
    const distance = 7 + random() * 6;
    const core = i === 4;
    return {
      from: actor(
        core
          ? [0, 0, -14]
          : [Math.cos(angle) * distance, Math.sin(angle) * distance, -6 - random() * 10],
        core ? CORE : 1,
        { r: [random() * TAU, random() * TAU, 0], a: 0 }
      ),
      delay: core ? 0 : 120 + random() * 270,
    };
  });
}

// --- the renderer -----------------------------------------------------------------------------

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed to compile');
  }
  return shader;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) ?? 'program failed to link');
  }
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(p, i).name;
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { p, u: uniforms };
}

const PALETTES = {
  dark: {
    base: [0.012, 0.012, 0.014],
    edge: [0, 0, 0],
    sky: [0.8, 0.8, 0.82],
    mid: [0.34, 0.34, 0.35],
    far: [0.12, 0.12, 0.125],
    silver: [0.9, 0.9, 0.93],
    lo: [0.035, 0.035, 0.04],
    hi: [0.82, 0.82, 0.84],
    edgeInk: [1, 1, 1],
    lineInk: [1, 1, 1],
  },
  light: {
    base: [0.98, 0.98, 0.98],
    edge: [0.9, 0.9, 0.9],
    sky: [0.1, 0.1, 0.11],
    mid: [0.45, 0.45, 0.46],
    far: [0.76, 0.76, 0.77],
    silver: [0.18, 0.18, 0.2],
    lo: [0.6, 0.6, 0.62],
    hi: [1, 1, 1],
    edgeInk: [0.12, 0.12, 0.13],
    lineInk: [0, 0, 0],
  },
};

export function createStage(canvas, { reduced, sceneTime, scene }) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;

  const field = program(gl, FIELD_VS, FIELD_FS);
  const dust = program(gl, DUST_VS, DUST_FS);
  const cube = program(gl, CUBE_VS, CUBE_FS);
  const line = program(gl, LINE_VS, LINE_FS);

  const emptyVao = gl.createVertexArray();

  const cubeVao = gl.createVertexArray();
  gl.bindVertexArray(cubeVao);
  const cubeBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, cubeGeometry(), gl.STATIC_DRAW);
  const cPos = gl.getAttribLocation(cube.p, 'aPos');
  const cNormal = gl.getAttribLocation(cube.p, 'aNormal');
  gl.enableVertexAttribArray(cPos);
  gl.vertexAttribPointer(cPos, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(cNormal);
  gl.vertexAttribPointer(cNormal, 3, gl.FLOAT, false, 24, 12);

  const lineVao = gl.createVertexArray();
  gl.bindVertexArray(lineVao);
  const lineBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  const lPos = gl.getAttribLocation(line.p, 'aPos');
  const lColor = gl.getAttribLocation(line.p, 'aColor');
  gl.enableVertexAttribArray(lPos);
  gl.vertexAttribPointer(lPos, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(lColor);
  gl.vertexAttribPointer(lColor, 4, gl.FLOAT, false, 28, 12);
  gl.bindVertexArray(null);

  const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
  const born = performance.now();
  let width = 1;
  let height = 1;
  let dpr = 1;
  let geometry = null;
  let pointer = [0, 0];
  let smoothPointer = [0, 0];
  let frame = 0;
  let running = false;

  /** The live scene target, and the frozen snapshot we are tweening away from. */
  let targetRect = { x: 0, y: 0, w: 1, h: 1, dim: 1 };
  let transition = null;
  let intro = null;
  let lastDrawn = null;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    ratio = Math.min(ratio, Math.sqrt(MAX_PIXELS / Math.max(w * h, 1)));
    const pw = Math.max(1, Math.floor(w * ratio));
    const ph = Math.max(1, Math.floor(h * ratio));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    if (w === width && h === height && ratio === dpr && geometry) return;
    width = w;
    height = h;
    dpr = pw / w;
    geometry = limb(w, h);
  }

  /** The limb crosses the bottom edge at 45% and the right edge at 40% height (y down). */
  function limb(w, h) {
    const scale = Math.min(Math.max(Math.sqrt((w * h) / (1920 * 1080)), 0.5), 2);
    const portrait = h > w;
    const p1 = [w * (portrait ? 0.3 : 0.52), h];
    const p2 = [w, h * (portrait ? 0.62 : 0.44)];
    const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const dir = [p2[0] - p1[0], p2[1] - p1[1]];
    const len = Math.hypot(dir[0], dir[1]);
    const normal = [-dir[1] / len, dir[0] / len];
    // Push the centre up and left along the chord's normal; the farther, the flatter the arc.
    const reach = Math.max(w, h) * 1.05;
    const sign = normal[0] < 0 ? 1 : -1;
    const center = [mid[0] + normal[0] * reach * sign, mid[1] + normal[1] * reach * sign];
    const radius = Math.hypot(p1[0] - center[0], p1[1] - center[1]);
    // To GL's y-up space.
    const cy = h - center[1];
    const theta = (p) => Math.atan2(h - p[1] - cy, p[0] - center[0]);
    let t1 = theta(p1);
    let t2 = theta(p2);
    if (t1 > t2) [t1, t2] = [t2, t1];
    const pad = 0.08;
    const count = Math.round(Math.min(Math.max((w * h) / 260, 1800), 7000));
    return {
      center: [center[0], cy],
      radius,
      scale,
      arc: [t1 - pad, t2 + pad],
      depth: 420 * scale,
      waveK: Math.max(8, Math.round(radius / 120)),
      count,
    };
  }

  function palette() {
    return lightQuery.matches ? PALETTES.light : PALETTES.dark;
  }

  function poseAt(index, t) {
    return SCENES[index](t);
  }

  function currentPose(now) {
    const index = scene();
    // Under reduced motion each scene holds one representative frame instead of its last.
    const t = reduced ? POSTER[index] : sceneTime();
    const live = poseAt(index, t);
    const rect = targetRect;
    let cubes = live.cubes;
    let sparks = live.sparks;
    let cam = live.cam;
    let lens = rect;
    let lines = live.lines.map((l) => [l[0], l[1], l[2], 1]);

    if (transition) {
      const elapsed = now - transition.start;
      const k = easeInOut(clamp01(elapsed / SWITCH_MS));
      cubes = cubes.map((to, i) => {
        const local = easeInOut(clamp01((elapsed - i * 22) / (SWITCH_MS - 9 * 22)));
        return blendActor(transition.from.cubes[i], to, local);
      });
      sparks = sparks.map((to, i) => blendActor(transition.from.sparks[i], to, k));
      cam = blendCam(transition.from.cam, cam, k);
      lens = blendRect(transition.from.rect, rect, k);
      lines = [
        ...transition.from.lines.map((l) => [l[0], l[1], l[2], l[3] * (1 - k)]),
        ...lines.map((l) => [l[0], l[1], l[2], l[3] * k]),
      ];
      if (elapsed >= SWITCH_MS) transition = null;
    }

    if (intro) {
      const elapsed = now - intro.start;
      cubes = cubes.map((to, i) => {
        const { from, delay } = intro.cubes[i];
        const k = easeOut(clamp01((elapsed - delay) / INTRO_MS));
        const blended = blendActor(from, to, k);
        blended.a = to.a * Math.min(k * 1.6, 1);
        return blended;
      });
      // The camera opens out as the mark forms, the way a shot does.
      const open = easeInOut(clamp01(elapsed / (INTRO_MS + 300)));
      cam = { ...cam, radius: cam.radius * (0.72 + 0.28 * open), yaw: cam.yaw - 0.5 * (1 - open) };
      if (elapsed > INTRO_MS + 420) intro = null;
    }

    return { cubes, sparks, cam, rect: lens, lines };
  }

  function view(cam, time) {
    const drift = reduced ? 0 : 1;
    const yaw = cam.yaw + drift * (0.04 * Math.sin(time * 0.21) + smoothPointer[0] * 0.07);
    const pitch = cam.pitch + drift * (0.025 * Math.sin(time * 0.17) + smoothPointer[1] * 0.045);
    const fov = 0.62;
    const aspect = Math.max(targetAspect(), 0.2);
    const half = Math.tan(fov / 2);
    const fit = Math.min(half, half * aspect);
    const distance = cam.radius / (fit * 0.95) + cam.radius * 0.35;
    const matrix = mul(
      mul(translate(0, 0, -distance), mul(rotX(pitch), rotY(yaw))),
      translate(-cam.target[0], -cam.target[1], -cam.target[2])
    );
    // Eye position in world space, for the rim light.
    const cp = Math.cos(pitch);
    const eye = [
      cam.target[0] - distance * cp * Math.sin(yaw),
      cam.target[1] + distance * Math.sin(pitch),
      cam.target[2] + distance * cp * Math.cos(yaw),
    ];
    return { matrix, eye, proj: perspective(fov, aspect, 0.1, 200) };
  }

  let aspectNow = 1;
  function targetAspect() {
    return aspectNow;
  }

  function draw(now) {
    resize();
    const colors = palette();
    const time = (now - born) / 1000;
    const frames = reduced ? 1200 : time * 60;
    smoothPointer = smoothPointer.map((v, i) => v + (pointer[i] - v) * 0.06);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // 1. field
    const g = geometry;
    const shift = reduced ? [0, 0] : [smoothPointer[0] * -14, smoothPointer[1] * 10];
    const center = [g.center[0] + shift[0], g.center[1] + shift[1]];
    gl.useProgram(field.p);
    gl.bindVertexArray(emptyVao);
    gl.uniform2f(field.u.uRes, width, height);
    gl.uniform1f(field.u.uDpr, dpr);
    gl.uniform2f(field.u.uCenter, center[0], center[1]);
    gl.uniform1f(field.u.uRadius, g.radius);
    gl.uniform1f(field.u.uScale, g.scale);
    gl.uniform1f(field.u.uFrame, frames);
    gl.uniform1f(field.u.uWaveK, g.waveK);
    gl.uniform1f(field.u.uLight, lightQuery.matches ? 1 : 0);
    gl.uniform3fv(field.u.uBase, colors.base);
    gl.uniform3fv(field.u.uEdge, colors.edge);
    gl.uniform3fv(field.u.uSky, colors.sky);
    gl.uniform3fv(field.u.uMid, colors.mid);
    gl.uniform3fv(field.u.uFar, colors.far);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. dust
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(dust.p);
    gl.uniform2f(dust.u.uRes, width, height);
    gl.uniform1f(dust.u.uDpr, dpr);
    gl.uniform2f(dust.u.uCenter, center[0], center[1]);
    gl.uniform1f(dust.u.uRadius, g.radius);
    gl.uniform1f(dust.u.uScale, g.scale);
    gl.uniform1f(dust.u.uFrame, frames);
    gl.uniform2f(dust.u.uArc, g.arc[0], g.arc[1]);
    gl.uniform1f(dust.u.uDepth, g.depth);
    gl.uniform3fv(dust.u.uSilver, colors.silver);
    gl.drawArrays(gl.POINTS, 0, g.count);

    // 3. cubes
    const pose = currentPose(now);
    lastDrawn = pose;
    const rect = pose.rect;
    const visible = clamp01((Math.min(rect.w, rect.h) - 40) / 80) * rect.dim;
    if (visible > 0.01) {
      aspectNow = rect.w / Math.max(rect.h, 1);
      const cam = view(pose.cam, time);
      const lens = [
        rect.w / width,
        rect.h / height,
        ((rect.x + rect.w / 2) / width) * 2 - 1,
        1 - ((rect.y + rect.h / 2) / height) * 2,
      ];
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      gl.useProgram(cube.p);
      gl.bindVertexArray(cubeVao);
      gl.uniformMatrix4fv(cube.u.uProj, false, cam.proj);
      gl.uniformMatrix4fv(cube.u.uView, false, cam.matrix);
      gl.uniform4fv(cube.u.uLens, lens);
      gl.uniform3fv(cube.u.uEye, cam.eye);
      gl.uniform3fv(cube.u.uLo, colors.lo);
      gl.uniform3fv(cube.u.uHi, colors.hi);
      gl.uniform3fv(cube.u.uEdgeInk, colors.edgeInk);
      gl.uniform3fv(cube.u.uBg, colors.base);
      for (const a of [...pose.cubes, ...pose.sparks]) {
        const alpha = a.a * visible;
        if (alpha <= 0.01 || a.s[0] * a.s[1] * a.s[2] <= 1e-5) continue;
        gl.uniformMatrix3fv(cube.u.uRot, false, euler3(a.r));
        gl.uniform3fv(cube.u.uPos, a.p);
        gl.uniform3fv(
          cube.u.uSize,
          a.s.map((v) => Math.max(v, 1e-3))
        );
        gl.uniform1f(cube.u.uBright, a.b * (0.55 + 0.45 * rect.dim));
        gl.uniform1f(cube.u.uAlpha, alpha);
        gl.uniform4fv(cube.u.uTint, a.tint);
        gl.drawArrays(gl.TRIANGLES, 0, 36);
      }

      if (pose.lines.length > 0) {
        const data = new Float32Array(pose.lines.length * 14);
        let o = 0;
        for (const [from, to, color, weight] of pose.lines) {
          const ink = color.length === 4 && color[0] === 1 && color[1] === 1 && color[2] === 1;
          const rgb = ink ? colors.lineInk : color;
          const alpha = (color[3] ?? 1) * weight * visible;
          for (const p of [from, to]) {
            data.set([p[0], p[1], p[2], rgb[0], rgb[1], rgb[2], alpha], o);
            o += 7;
          }
        }
        gl.useProgram(line.p);
        gl.bindVertexArray(lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        gl.uniformMatrix4fv(line.u.uProj, false, cam.proj);
        gl.uniformMatrix4fv(line.u.uView, false, cam.matrix);
        gl.uniform4fv(line.u.uLens, lens);
        gl.depthMask(false);
        gl.drawArrays(gl.LINES, 0, pose.lines.length * 2);
        gl.depthMask(true);
      }
    }
    gl.bindVertexArray(null);
  }

  function loop(now) {
    if (!running) return;
    try {
      draw(now);
    } catch {
      running = false;
      canvas.classList.remove('live');
      return;
    }
    frame = requestAnimationFrame(loop);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    frame = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  /** Reduced motion: no loop, just one still frame whenever something changes. */
  function still() {
    if (!reduced) return;
    requestAnimationFrame((now) => draw(now));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  lightQuery.addEventListener?.('change', still);
  window.addEventListener('resize', still);
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    stop();
    canvas.classList.remove('live');
  });

  resize();
  start();

  return {
    setScene(index, rect, { instant = false, dim = 1 } = {}) {
      const next = rect ? { ...rect, dim } : { ...targetRect, w: 0, h: 0, dim };
      const changed = index !== this.index;
      this.index = index;
      if (changed && !instant && lastDrawn) {
        transition = {
          start: performance.now(),
          from: {
            cubes: lastDrawn.cubes,
            sparks: lastDrawn.sparks,
            cam: lastDrawn.cam,
            rect: lastDrawn.rect,
            lines: lastDrawn.lines,
          },
        };
      } else if (instant) {
        transition = null;
      }
      targetRect = next;
      still();
    },
    setPointer(x, y) {
      pointer = [x, y];
    },
    intro() {
      if (reduced) return;
      intro = { start: performance.now(), cubes: introFrom() };
    },
    index: -1,
  };
}
