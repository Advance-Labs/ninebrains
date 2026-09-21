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
 *   3. The diorama. The Ninebrains mark as nine lit boxes that stay on stage for the whole visit,
 *      standing on a floor (a pool of light, a fading grid, a soft contact shadow per cube). Every
 *      scene gives them an arrangement and a camera, animated on the scene's clock (Lanes: four
 *      panes; The Brain: a hub and spokes; Gates: a conveyor through a frame; and so on).
 *
 * The page never lets the cubes near its text: layout.js measures a safe rectangle for the active
 * panel and the stage frames the scene into it. Each scene's whole timeline (every cube, wire and
 * floor corner, at the drift and parallax extremes) is measured once, and a lens (a clip-space
 * scale and shift) fits that extent inside the rectangle, so nothing can project outside it; a
 * scissor on the rectangle backs that up. Changing scene is a dissolve, never a flight: the old
 * arrangement shrinks away where it stands, then the new one assembles in its own rectangle.
 *
 * Budget: devicePixelRatio is capped at 1.5 and the backing store at 2.2M pixels; the loop stops
 * while the tab is hidden; under reduced motion it draws one still frame per change and nothing
 * else. It is decoration, so any failure just leaves the page's CSS gradient in place.
 */

const TAU = Math.PI * 2;
const SPACING = 1.78;
const CORE = 20 / 13;
/** A scene change: the old arrangement shrinks away, then the new one assembles, cube by cube. */
const OUT_MS = 240;
const IN_MS = 380;
const STAGGER = 28;
/**
 * The opening (see `intro()` below). The page paints a static mark first; once this stage can
 * draw, nine cubes fall out of the dark into that mark's exact footprint, hold, then fly into
 * their places in the live scene. The short version (a repeat visit, a deep link) starts from the
 * settled mark and only flies.
 */
/** The mark's own spacing (glyph.mjs: 21 between centres, 13 per arm square). */
const MARK_GAP = 21 / 13;
const FALL_MS = 760;
const FALL_STAGGER = 45;
/** The last arm starts its fall after the core and seven staggered arms. */
const FALL_END = 90 + 7 * FALL_STAGGER + FALL_MS;
const HOLD_MS = 180;
const FLIGHT_MS = { full: 680, short: 560 };
/** In the flight, the edge cubes leave this much after the core, the corners twice that. */
const FLIGHT_RIPPLE = 30;
/** Camera radii: close for the fall (so depth reads), far for the flat mark (near orthographic). */
const R_FALL = 9;
const R_MARK = 40;
/** Head room inside the safe rectangle, on top of the measured extent. */
const FIT_MARGIN = 0.94;
const FOV = 0.62;
const FOCAL = 1 / Math.tan(FOV / 2);
/** The most the idle drift plus pointer parallax ever turn the camera (see `view`). */
const DRIFT_YAW = 0.04 + 0.07;
const DRIFT_PITCH = 0.025 + 0.045;
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
  uniform float uDustAlpha;
  void main() { outColor = vec4(uSilver, vAlpha * vShade * uDustAlpha); }
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
  uniform float uRound;
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
    float alpha = uAlpha;
    // While a cube stands in for the flat mark, its outline takes the mark's rounded corners.
    if (uRound > 0.0) {
      vec2 q = abs(vLocal.xy) * uSize.xy - (uSize.xy * 0.5 - ${(2 / 13).toFixed(4)});
      float d = length(max(q, 0.0)) - ${(2 / 13).toFixed(4)};
      float aa = fwidth(d);
      if (d > aa) discard;
      alpha *= 1.0 - uRound * smoothstep(-aa, aa, d);
    }
    outColor = vec4(color, alpha);
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

/** A flat disc on the floor plane with a soft edge: the light pool and the contact shadows. */
const DISC_VS = `#version 300 es
  precision highp float;
  uniform mat4 uProj;
  uniform mat4 uView;
  uniform vec4 uLens;
  uniform vec3 uCenter;
  uniform vec2 uRadius;
  out vec2 vUv;
  void main() {
    vec2 c = vec2(float((gl_VertexID & 1) * 2 - 1), float((gl_VertexID >> 1) * 2 - 1));
    vUv = c;
    vec4 clip = uProj * uView * vec4(uCenter + vec3(c.x * uRadius.x, 0.0, c.y * uRadius.y), 1.0);
    clip.xy = clip.xy * uLens.xy + uLens.zw * clip.w;
    gl_Position = clip;
  }
`;

const DISC_FS = `#version 300 es
  precision mediump float;
  uniform vec4 uColor;
  uniform float uSoft;
  in vec2 vUv;
  out vec4 outColor;
  void main() {
    float a = 1.0 - smoothstep(uSoft, 1.0, length(vUv));
    outColor = vec4(uColor.rgb, uColor.a * a * a);
  }
`;

/** A flat wash over the field: the page's own background, fading out as the opening ends. */
const VEIL_FS = `#version 300 es
  precision mediump float;
  uniform vec4 uColor;
  out vec4 outColor;
  void main() { outColor = uColor; }
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
            b: 0.34,
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
      const p = [Math.cos(angle) * 2.3, -0.95, Math.sin(angle) * 2.3];
      const at = dispatch[k];
      const lit = at === undefined ? 0 : ramp(t, at, 0.35);
      const done = k === 1 ? ramp(t, 8.4, 0.4) : 0;
      cubes[i] = actor(p, 0.62, {
        b: 0.42 + 0.58 * lit,
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
    const front = -1.8;
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
        x = front - 0.8 * Math.max(k - moved, 0);
      } else if (k === 2) {
        // The one that fails: reaches the frame, is thrown back, waits, and tries again.
        if (u < hit) x = front + speed * u;
        else if (u < hit + 0.5) x = -1.5 * easeOut((u - hit) / 0.5);
        else if (u < hit + 1.05) x = -1.5;
        else x = -1.5 + speed * (u - hit - 1.05);
        const failAt = launches[k] + hit;
        passAt = failAt + 1.05 + 1.5 / speed;
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
      const waiting = u < 0 ? 0.55 : 1;
      // Waiting cubes are a little smaller, so the queue packs tight; three show at a time.
      const size = (u < 0 ? 0.7 : 0.9) * smooth(-4.3, -3.5, x) * (1 - smooth(2.7, 3.6, x));
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
    cubes[8] = actor([2.6, -0.3, 1.3], 0.42, { b: 0.3, r: [0, t * 0.5, 0] });
    const ink = frameFail > 0.02 ? [...STATE.fail, 0.3 + 0.6 * frameFail] : null;
    const color =
      ink ?? (framePass > 0.02 ? [...STATE.pass, 0.3 + 0.6 * framePass] : [1, 1, 1, 0.45]);
    const lines = wireBox([0, 0, 0], [0.06, 1.15, 1.15], color);
    lines.push([
      [-4.2, -0.5, 0],
      [3.7, -0.5, 0],
      [1, 1, 1, 0.12],
    ]);
    return {
      cubes,
      sparks: [hidden(), hidden(), hidden()],
      lines,
      cam: { yaw: -0.98, pitch: 0.32, target: [0, 0.2, 0], radius: 4.3 },
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
    const pos = nodes.map(([c, y]) => [(c - 2) * 1.8, y, 0]);
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
      const center = [(bundle - 1) * 2.55, 0.35 * on, 0];
      const angle = t * 0.35 + bundle * 1.3;
      const spread = 1 + 0.15 * on;
      local.forEach(([x, y, z], k) => {
        const rx = (x * Math.cos(angle) + z * Math.sin(angle)) * spread;
        const rz = (-x * Math.sin(angle) + z * Math.cos(angle)) * spread;
        cubes[bundle * 3 + k] = actor([center[0] + rx, center[1] + y * spread, rz], 0.76, {
          r: [0, angle, 0],
          b: 0.4 + 0.65 * on,
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
      // The limit is a state, so it flashes amber, then the cube settles to plain dark grey.
      tint: tinted('warn', 0.85 * ramp(t, 2.6, 0.15) * flash(t, 2.75, 1.3)),
    });
    const litB = ramp(t, 6.2, 0.5);
    cubes[5] = actor(b, 1.25, {
      r: [0.15, -0.5 - t * 0.5 * litB, 0],
      b: 0.3 + 0.7 * litB + 0.08 * Math.sin(t * 3) * litB,
      tint: tinted('run', 0.35 * flash(t, 6.2, 0.9)),
    });
    const small = [0, 1, 2, 4, 6, 7, 8];
    small.forEach((i, k) => {
      cubes[i] = actor([-2.4 + k * 0.8, -1.25, -2.2], 0.4, { b: 0.3, r: [0, t * 0.3 + k, 0] });
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
      cam: { yaw: 0.26, pitch: 0.18, target: [0.9, -0.1, 0], radius: 3.6 },
    };
  },
];

// --- shader plumbing -----------------------------------------------------------------------------

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
    dustAlpha: 0.72,
    lo: [0.035, 0.035, 0.04],
    hi: [0.82, 0.82, 0.84],
    edgeInk: [1, 1, 1],
    lineInk: [1, 1, 1],
    // The opening: the page background (#000) and the mark's ink (#fafafa), divided by the lit
    // front face's shading factor so a fully tinted cube face prints exactly that ink.
    veil: [0, 0, 0],
    ink: [0.98 / 1.01, 0.98 / 1.01, 0.98 / 1.01],
    /** How much ink a falling cube already carries: none on black, where lit cubes read. */
    fallInk: 0,
  },
  light: {
    base: [0.98, 0.98, 0.98],
    edge: [0.9, 0.9, 0.9],
    sky: [0.16, 0.16, 0.17],
    mid: [0.66, 0.66, 0.67],
    far: [0.9, 0.9, 0.905],
    silver: [0.34, 0.34, 0.36],
    dustAlpha: 0.42,
    lo: [0.6, 0.6, 0.62],
    hi: [1, 1, 1],
    edgeInk: [0.12, 0.12, 0.13],
    lineInk: [0, 0, 0],
    veil: [0.98, 0.98, 0.98],
    ink: [0.039 / 1.01, 0.039 / 1.01, 0.039 / 1.01],
    // Light cubes on a white veil barely read, so they fall already half inked.
    fallInk: 0.5,
  },
};

/** The floor each scene stands on: a pool of light, a fading grid and a soft shadow per cube. */
const GROUND = {
  dark: { pool: [1, 1, 1, 0.07], grid: 0.24, shadow: [0, 0, 0, 0.85] },
  light: { pool: [0, 0, 0, 0.045], grid: 0.22, shadow: [0, 0, 0, 0.28] },
};

// --- framing: every scene fits its whole timeline into the safe rectangle ----------------------

const PROJ = perspective(FOV, 1, 0.1, 200);

/** How far the camera stands from its target for a scene radius. */
const distanceFor = (radius) => radius / (Math.tan(FOV / 2) * 0.95) + radius * 0.35;

/** The view for a scene camera, turned by `dyaw` / `dpitch` of drift and parallax. */
function camera(cam, dyaw = 0, dpitch = 0) {
  const yaw = cam.yaw + dyaw;
  const pitch = cam.pitch + dpitch;
  const distance = distanceFor(cam.radius);
  const matrix = mul(
    mul(translate(0, 0, -distance), mul(rotX(pitch), rotY(yaw))),
    translate(-cam.target[0], -cam.target[1], -cam.target[2])
  );
  const cp = Math.cos(pitch);
  const eye = [
    cam.target[0] - distance * cp * Math.sin(yaw),
    cam.target[1] + distance * Math.sin(pitch),
    cam.target[2] + distance * cp * Math.cos(yaw),
  ];
  return { matrix, eye, proj: PROJ, vp: mul(PROJ, matrix) };
}

/** Normalised device coordinates of a world point (before the lens). */
function ndc(vp, p) {
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  return [
    (vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12]) / w,
    (vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13]) / w,
  ];
}

const drawn = (a) => a.a > 0.01 && a.s[0] * a.s[1] * a.s[2] > 1e-5;

/** The eight world-space corners of an actor. */
function corners(a) {
  const r = euler3(a.r);
  const out = [];
  for (const sx of [-0.5, 0.5])
    for (const sy of [-0.5, 0.5])
      for (const sz of [-0.5, 0.5]) {
        const l = [sx * a.s[0], sy * a.s[1], sz * a.s[2]];
        out.push([0, 1, 2].map((i) => a.p[i] + r[i] * l[0] + r[3 + i] * l[1] + r[6 + i] * l[2]));
      }
  return out;
}

/**
 * Walks a scene's whole timeline once and returns what the camera will ever show: the extent in
 * device coordinates (with the drift and parallax extremes folded in) and the floor under it.
 */
function measureScene(index, duration) {
  const samples = [];
  let floorY = Infinity;
  const xz = [Infinity, -Infinity, Infinity, -Infinity];
  for (let t = 0; t <= duration + 1e-6; t += 0.1) {
    const pose = SCENES[index](t);
    const points = [];
    for (const a of [...pose.cubes, ...pose.sparks]) {
      if (!drawn(a)) continue;
      for (const c of corners(a)) {
        points.push(c);
        floorY = Math.min(floorY, c[1]);
        xz[0] = Math.min(xz[0], c[0]);
        xz[1] = Math.max(xz[1], c[0]);
        xz[2] = Math.min(xz[2], c[2]);
        xz[3] = Math.max(xz[3], c[2]);
      }
    }
    for (const [from, to] of pose.lines) points.push(from, to);
    samples.push({ cam: pose.cam, points });
  }
  const margin = 0.4;
  const floor = {
    y: floorY - 0.02,
    x0: xz[0] - margin,
    x1: xz[1] + margin,
    z0: xz[2] - margin,
    z1: xz[3] + margin,
  };
  const floorCorners = [
    [floor.x0, floor.y, floor.z0],
    [floor.x1, floor.y, floor.z0],
    [floor.x0, floor.y, floor.z1],
    [floor.x1, floor.y, floor.z1],
  ];
  const box = [Infinity, -Infinity, Infinity, -Infinity];
  for (const { cam, points } of samples) {
    for (const dy of [-1, 1]) {
      for (const dp of [-1, 1]) {
        const { vp } = camera(cam, dy * DRIFT_YAW, dp * DRIFT_PITCH);
        for (const p of [...points, ...floorCorners]) {
          const [x, y] = ndc(vp, p);
          box[0] = Math.min(box[0], x);
          box[1] = Math.max(box[1], x);
          box[2] = Math.min(box[2], y);
          box[3] = Math.max(box[3], y);
        }
      }
    }
  }
  return { box, floor, grid: floorGrid(floor) };
}

/** Grid lines across the floor, cut into short pieces so each can fade towards the rim. */
function floorGrid(floor) {
  const step = SPACING / 2;
  const cx = (floor.x0 + floor.x1) / 2;
  const cz = (floor.z0 + floor.z1) / 2;
  const hx = (floor.x1 - floor.x0) / 2;
  const hz = (floor.z1 - floor.z0) / 2;
  const fade = (x, z) => 1 - smooth(0.35, 1, Math.hypot((x - cx) / hx, (z - cz) / hz));
  const segments = [];
  const pieces = 10;
  const run = (a, b) => {
    for (let i = 0; i < pieces; i++) {
      const p = a.map((v, k) => lerp(v, b[k], i / pieces));
      const q = a.map((v, k) => lerp(v, b[k], (i + 1) / pieces));
      const w = Math.min(fade(p[0], p[2]), fade(q[0], q[2]));
      if (w > 0.01) segments.push([p, q, w]);
    }
  };
  for (let x = cx - Math.floor(hx / step) * step; x <= floor.x1 + 1e-6; x += step) {
    run([x, floor.y, floor.z0], [x, floor.y, floor.z1]);
  }
  for (let z = cz - Math.floor(hz / step) * step; z <= floor.z1 + 1e-6; z += step) {
    run([floor.x0, floor.y, z], [floor.x1, floor.y, z]);
  }
  return segments;
}

/**
 * The lens that maps a scene's device-coordinate extent onto `rect` (CSS px) in a W x H viewport,
 * as a clip-space scale and shift: clip.xy = clip.xy * lens.xy + lens.zw * clip.w.
 */
function lensFor(box, rect, W, H) {
  const k = Math.min(rect.w / (box[1] - box[0]), rect.h / (box[3] - box[2])) * FIT_MARGIN;
  const mx = (box[0] + box[1]) / 2;
  const my = (box[2] + box[3]) / 2;
  const lx = (2 * k) / W;
  const ly = (2 * k) / H;
  return [
    lx,
    ly,
    (2 * (rect.x + rect.w / 2)) / W - 1 - mx * lx,
    1 - (2 * (rect.y + rect.h / 2)) / H - my * ly,
  ];
}

/**
 * A lens that draws the camera's target at (cx, cy) CSS px with `px` CSS px per world unit on the
 * plane through the target, facing the camera. A point there lands at distance `D` in view space,
 * so it projects to FOCAL * u / D in device coordinates; the lens scales that back to pixels.
 */
function lensAt(px, D, cx, cy, W, H) {
  const k = (px * D) / FOCAL;
  return [(2 * k) / W, (2 * k) / H, (2 * cx) / W - 1, 1 - (2 * cy) / H];
}

/** Cube `i` as the flat mark: glyph spacing, front faces all on the z = 0 plane. */
function markActor(i) {
  const s = i === 4 ? CORE : 1;
  return actor([((i % 3) - 1) * MARK_GAP, (1 - Math.floor(i / 3)) * MARK_GAP, -s / 2], s);
}

/** Where each cube falls in from, how it spins, and when it starts. Seeded: the same every load. */
function fallPlan() {
  let v = 9;
  const rnd = () => (v = (v * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const ranks = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
  }
  let arm = 0;
  return Array.from({ length: 9 }, (_, i) => {
    const spin = [(rnd() - 0.5) * 5, (rnd() - 0.5) * 6];
    // The core comes straight up out of the dark; the arms arrive from a ring around it.
    if (i === 4) return { from: [0, 0, -14], spin, delay: 0 };
    // One arm per eighth of the ring (jittered), and each next arrival from across the ring.
    const angle = ((((ranks[arm] * 3) % 8) + 0.5 + (rnd() - 0.5) * 0.7) / 8) * TAU + 0.4;
    const reach = 15 + rnd() * 10;
    const from = [Math.cos(angle) * reach, Math.sin(angle) * reach, -8 - rnd() * 12];
    return { from, spin, delay: 90 + ranks[arm++] * FALL_STAGGER };
  });
}

const lerp3 = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));

// --- the renderer -----------------------------------------------------------------------------

export function createStage(canvas, { reduced, sceneTime, scene, durations, debug = false }) {
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
  const disc = program(gl, DISC_VS, DISC_FS);
  const veil = program(gl, FIELD_VS, VEIL_FS);

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

  /** Per scene, measured once: what its timeline ever shows, and its floor. */
  const measured = [];
  const sceneBounds = (index) =>
    (measured[index] ??= measureScene(index, durations?.[index] ?? 14));

  /** Where the live scene draws (null: nowhere), and the dissolve in progress, if any. */
  let target = { rect: null, dim: 1 };
  let phase = null;
  /** The opening in progress, if any (see `intro()`). */
  let intro = null;
  let lastIndex = -1;
  let lastT = 0;
  /** Only filled in with `?debug=bounds`: what the last frame drew, for the overlap audit. */
  let debugFrame = null;

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

  /**
   * What to draw this frame: one scene, in one rectangle, with a per-cube size factor. Scene
   * changes never move a cube between rectangles: the old arrangement shrinks away where it
   * stands, then the new one assembles in its own place.
   */
  function currentLayer(now) {
    const index = scene();
    // Under reduced motion each scene holds one representative frame instead of its last.
    const t = reduced ? POSTER[index] : sceneTime();
    // A scene that loops back to its entry frame dissolves out and back in, never to blank.
    if (!reduced && index === lastIndex && t + 0.5 < lastT && target.rect && !phase) {
      phase = { kind: 'out', start: now, from: { index, t: lastT, ...target } };
    }
    if (phase?.kind === 'out') {
      const k = (now - phase.start) / OUT_MS;
      if (k < 1) {
        const { from } = phase;
        return {
          index: from.index,
          t: from.t,
          rect: from.rect,
          dim: from.dim,
          grow: (i) => 1 - easeInOut(clamp01(k * 1.25 - (i % 5) * 0.05)),
        };
      }
      phase = { kind: 'in', start: phase.start + OUT_MS };
    }
    lastIndex = index;
    lastT = t;
    if (!target.rect) return null;
    let grow = () => 1;
    if (phase?.kind === 'in') {
      const elapsed = now - phase.start;
      grow = (i) => easeOut(clamp01((elapsed - i * STAGGER) / IN_MS));
      if (elapsed > IN_MS + 9 * STAGGER) phase = null;
    }
    return { index, t, rect: target.rect, dim: target.dim, grow };
  }

  /** The actors of a layer, after the dissolve is applied. */
  function actorsFor(layer, pose) {
    return [...pose.cubes, ...pose.sparks].map((a, i) => {
      const f = layer.grow(i);
      return { ...a, s: a.s.map((v) => v * f), a: a.a * Math.min(1, f * 1.6) };
    });
  }

  /** The camera's idle drift plus pointer parallax, as extra yaw and pitch. */
  function drift(time) {
    if (reduced) return [0, 0];
    return [
      0.04 * Math.sin(time * 0.21) + smoothPointer[0] * 0.07,
      0.025 * Math.sin(time * 0.17) + smoothPointer[1] * 0.045,
    ];
  }

  function view(cam, time) {
    return camera(cam, ...drift(time));
  }

  /**
   * One frame of the opening: the camera, lens and actors to draw instead of the scene's own, how
   * much of the page background still veils the field, and how present the floor is. Its last
   * frame is the scene's settled frame: same camera (drift included), same lens, same actors.
   */
  function introFrame(now, time, layer, pose, bounds, colors) {
    const it = intro;
    // The first frame after `intro()` only warms the pipeline; the clock starts on the next one.
    if (it.start === null && it.warm) it.start = now;
    it.warm = true;
    const elapsed = it.start === null ? 0 : now - it.start;
    const full = it.mode === 'full';
    const px0 = (it.mark.w / 70) * 13;
    const cx0 = it.mark.x + it.mark.w / 2;
    const cy0 = it.mark.y + it.mark.h / 2;
    const flightStart = full ? FALL_END + HOLD_MS : 0;
    const flightMs = FLIGHT_MS[it.mode];
    const ink = colors.ink;
    const list = [...pose.cubes, ...pose.sparks];
    it.elapsed = elapsed;
    it.flightStart = flightStart;

    if (elapsed < flightStart) {
      // The fall: the camera pulls back and squares up while the mark plane keeps its size, so
      // cubes come up out of depth and the arrangement flattens into the logo as it lands.
      const s = easeInOut(clamp01(elapsed / FALL_END));
      const radius = R_FALL * (R_MARK / R_FALL) ** s;
      const cam = camera({
        yaw: -0.55 * (1 - s),
        pitch: 0.42 * (1 - s),
        target: [0, 0, 0],
        radius,
      });
      const actors = list.map((a, i) => {
        if (i >= 9) return hidden();
        const plan = it.plan[i];
        const local = clamp01((elapsed - plan.delay) / FALL_MS);
        const k = easeOut(local);
        const m = markActor(i);
        return {
          ...m,
          p: lerp3(plan.from, m.p, k),
          r: [plan.spin[0] * (1 - k), plan.spin[1] * (1 - k), 0],
          // Each one locks into the flat ink of the mark as it lands.
          tint: [...ink, lerp(colors.fallInk, 1, smooth(0.72, 1, local))],
          round: smooth(0.72, 1, local),
          a: Math.min(1, k * 1.6),
        };
      });
      return {
        cam,
        lens: lensAt(px0, distanceFor(radius), cx0, cy0, width, height),
        actors,
        veil: 1,
        floor: 0,
        done: false,
      };
    }

    const u = clamp01((elapsed - flightStart) / flightMs);
    const e = easeInOut(u);
    const veilOut = full
      ? 1 - smooth(flightStart - 140, flightStart + 520, elapsed)
      : 1 - smooth(0, 420, elapsed);
    if (!layer.rect) {
      // No room for the scene at this size: the mark just shrinks away where it stands.
      const cam = camera({ yaw: 0, pitch: 0, target: [0, 0, 0], radius: R_MARK });
      const actors = list.map((a, i) => {
        if (i >= 9) return hidden();
        const m = markActor(i);
        return { ...m, s: m.s.map((v) => v * (1 - e)), tint: [...ink, 1], round: 1, a: 1 - e };
      });
      const lens = lensAt(px0, distanceFor(R_MARK), cx0, cy0, width, height);
      return { cam, lens, actors, veil: veilOut, floor: 0, done: u >= 1 };
    }

    // The flight: camera, scale and centre all travel from the flat mark to the scene's own.
    const [dyaw, dpitch] = drift(time);
    const end = pose.cam;
    const lensEnd = lensFor(bounds.box, layer.rect, width, height);
    const pxEnd = (((lensEnd[0] * width) / 2) * FOCAL) / distanceFor(end.radius);
    const radius = R_MARK * (end.radius / R_MARK) ** e;
    const cam = camera({
      yaw: lerp(0, end.yaw + dyaw, e),
      pitch: lerp(0, end.pitch + dpitch, e),
      target: end.target.map((v) => v * e),
      radius,
    });
    const lens = lensAt(
      px0 * (pxEnd / px0) ** e,
      distanceFor(radius),
      lerp(cx0, ((lensEnd[2] + 1) / 2) * width, e),
      lerp(cy0, ((1 - lensEnd[3]) / 2) * height, e),
      width,
      height
    );
    const actors = list.map((a, i) => {
      if (i >= 9) return { ...a, s: a.s.map((v) => v * e), a: a.a * e };
      const ring = i === 4 ? 0 : i % 2 === 1 ? 1 : 2;
      const k = easeInOut(
        clamp01((u * flightMs - ring * FLIGHT_RIPPLE) / (flightMs - 2 * FLIGHT_RIPPLE))
      );
      const m = markActor(i);
      // The flat ink gives way to the scene's own light early, so the cubes gain depth as they go.
      const lit = smooth(0, 0.6, k);
      return {
        p: lerp3(m.p, a.p, k),
        s: lerp3(m.s, a.s, k),
        r: lerp3(m.r, a.r, k),
        b: lerp(m.b, a.b, k),
        tint: [...lerp3(ink, a.tint.slice(0, 3), lit), lerp(1, a.tint[3], lit)],
        round: 1 - smooth(0, 0.3, k),
        a: lerp(1, a.a, k),
      };
    });
    return { cam, lens, actors, veil: veilOut, floor: smooth(0.5, 1, e), done: u >= 1 };
  }

  /** Drops the opening and tells the page, which uncovers itself. */
  function endIntro() {
    const it = intro;
    intro = null;
    it?.hooks.done?.();
  }

  /** Fires the opening's cues whose moment has come, and ends it after its last frame. */
  function introCues() {
    const it = intro;
    if (!it || it.start === null) return;
    const cue = (name, at) => {
      if (it.fired.has(name) || it.elapsed < at) return;
      it.fired.add(name);
      it.hooks[name]?.();
    };
    cue('start', 0);
    if (it.mode === 'full') cue('land', FALL_END);
    // Never on the start frame itself: the page must be styled hidden for a frame to fade from.
    const late = it.revealLate ? FLIGHT_MS[it.mode] * 0.5 : -80;
    cue('reveal', Math.max(1, it.flightStart + late));
    if (it.finished && intro === it) {
      intro = null;
      it.hooks.done?.();
    }
  }

  function drawLines(lines, cam, lens, colors, visible) {
    if (lines.length === 0) return;
    const data = new Float32Array(lines.length * 14);
    let o = 0;
    for (const [from, to, color] of lines) {
      const ink = color[0] === 1 && color[1] === 1 && color[2] === 1;
      const rgb = ink ? colors.lineInk : color;
      const alpha = (color[3] ?? 1) * visible;
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
    gl.drawArrays(gl.LINES, 0, lines.length * 2);
  }

  function drawDisc(cam, lens, center, radius, color, soft) {
    gl.uniform3fv(disc.u.uCenter, center);
    gl.uniform2fv(disc.u.uRadius, radius);
    gl.uniform4fv(disc.u.uColor, color);
    gl.uniform1f(disc.u.uSoft, soft);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function draw(now) {
    resize();
    const colors = palette();
    const ground = lightQuery.matches ? GROUND.light : GROUND.dark;
    const time = (now - born) / 1000;
    const frames = reduced ? 1200 : time * 60;
    smoothPointer = smoothPointer.map((v, i) => v + (pointer[i] - v) * 0.06);

    gl.disable(gl.SCISSOR_TEST);
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
    gl.uniform1f(dust.u.uDustAlpha, colors.dustAlpha);
    gl.drawArrays(gl.POINTS, 0, g.count);

    // 3. the diorama: floor, shadows, cubes and wires, framed into the safe rectangle
    let layer = currentLayer(now);
    // The opening draws even where the scene has no rectangle (it shrinks away there instead).
    if (!layer && intro) layer = { index: scene(), t: lastT, rect: null, dim: 1, grow: () => 1 };
    debugFrame = null;
    if (layer) {
      const pose = SCENES[layer.index](layer.t);
      const bounds = sceneBounds(layer.index);
      const opening = intro ? introFrame(now, time, layer, pose, bounds, colors) : null;
      if (opening && opening.veil > 0.001) {
        gl.useProgram(veil.p);
        gl.bindVertexArray(emptyVao);
        gl.uniform4f(veil.u.uColor, ...colors.veil, opening.veil);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (opening?.done) intro.finished = true;
      // The opening's last frame is the settled scene, so from here the scene draws itself.
      drawLayer(layer, pose, bounds, opening?.done ? null : opening, time, colors, ground);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    introCues();
  }

  function drawLayer(layer, pose, bounds, opening, time, colors, ground) {
    const { rect, dim } = layer;
    if (!rect && !opening) return;
    const lens = opening ? opening.lens : lensFor(bounds.box, rect, width, height);
    const cam = opening ? opening.cam : view(pose.cam, time);
    const actors = opening ? opening.actors : actorsFor(layer, pose);
    const cubes = actors.slice(0, 9);
    const floorIn = opening ? opening.floor : 1;
    // How present the whole arrangement is (for the floor and wires during a dissolve).
    const present = (cubes.reduce((sum, a) => sum + Math.min(1, a.a), 0) / 9) * floorIn;

    // Belt and braces: nothing can draw outside the rectangle, even between timeline samples.
    // The opening flies in from the middle of the screen, so it alone draws unclipped.
    if (opening) gl.disable(gl.SCISSOR_TEST);
    else {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        Math.floor(rect.x * dpr),
        Math.floor((height - rect.y - rect.h) * dpr),
        Math.ceil(rect.w * dpr),
        Math.ceil(rect.h * dpr)
      );
    }
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.depthMask(false);

    // The floor: a pool of light, a grid that fades out, and a contact shadow under each cube.
    const { floor } = bounds;
    const floorAlpha = rect ? present * dim : 0;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(disc.p);
    gl.bindVertexArray(emptyVao);
    gl.uniformMatrix4fv(disc.u.uProj, false, cam.proj);
    gl.uniformMatrix4fv(disc.u.uView, false, cam.matrix);
    gl.uniform4fv(disc.u.uLens, lens);
    const mid = [(floor.x0 + floor.x1) / 2, floor.y, (floor.z0 + floor.z1) / 2];
    const half = [(floor.x1 - floor.x0) / 2, (floor.z1 - floor.z0) / 2];
    drawDisc(cam, lens, mid, half, [...ground.pool.slice(0, 3), ground.pool[3] * floorAlpha], 0);
    drawLines(
      bounds.grid.map(([a, b, w]) => [a, b, [1, 1, 1, ground.grid * w]]),
      cam,
      lens,
      colors,
      floorAlpha
    );
    gl.useProgram(disc.p);
    gl.bindVertexArray(emptyVao);
    for (const a of actors) {
      if (!drawn(a)) continue;
      const bottom = a.p[1] - Math.max(a.s[1], a.s[0] * 0.5) * 0.5;
      const lift = bottom - floor.y;
      const contact = clamp01(1 - lift / 1.4);
      if (contact <= 0.02 || !rect) continue;
      const spread = 0.62 + 0.25 * clamp01(lift / 1.4);
      const radius = [a.s[0] * spread + 0.08, a.s[2] * spread + a.s[0] * 0.2 + 0.08];
      const alpha = ground.shadow[3] * contact * Math.min(1, a.a) * dim * floorIn;
      drawDisc(
        cam,
        lens,
        [a.p[0], floor.y, a.p[2]],
        radius,
        [...ground.shadow.slice(0, 3), alpha],
        0.25
      );
    }

    // The cubes.
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
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
    for (const a of actors) {
      if (!drawn(a)) continue;
      gl.uniformMatrix3fv(cube.u.uRot, false, euler3(a.r));
      gl.uniform3fv(cube.u.uPos, a.p);
      gl.uniform3fv(
        cube.u.uSize,
        a.s.map((v) => Math.max(v, 1e-3))
      );
      gl.uniform1f(cube.u.uBright, a.b * (0.55 + 0.45 * dim));
      gl.uniform1f(cube.u.uAlpha, a.a);
      gl.uniform4fv(cube.u.uTint, a.tint);
      gl.uniform1f(cube.u.uRound, a.round ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }

    // The scene's own wires.
    gl.depthMask(false);
    drawLines(pose.lines, cam, lens, colors, present * dim);
    gl.depthMask(true);

    if (debug && rect) debugFrame = { actors, lines: pose.lines, bounds, cam, lens, rect, present };
  }

  function loop(now) {
    if (!running) return;
    try {
      draw(now);
    } catch {
      running = false;
      canvas.classList.remove('live');
      endIntro();
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
    endIntro();
  });

  resize();
  start();

  return {
    index: -1,
    /**
     * Point the stage at a scene and the rectangle it may use (null: none). A new scene dissolves
     * in unless `instant`; a new rectangle for the same scene (a resize) applies at once.
     */
    setScene(index, rect, { instant = false, dim = 1 } = {}) {
      const changed = index !== this.index;
      const previous = { index: this.index, t: lastT, ...target };
      this.index = index;
      target = { rect, dim };
      if (instant || reduced) {
        if (changed) phase = null;
      } else if (changed) {
        phase =
          previous.rect && previous.index >= 0
            ? { kind: 'out', start: performance.now(), from: previous }
            : { kind: 'in', start: performance.now() };
      }
      still();
    },
    /** A scene's on-screen width:height over its whole timeline, for choosing its rectangle. */
    aspect(index) {
      const b = sceneBounds(index).box;
      return (b[1] - b[0]) / (b[3] - b[2]);
    },
    setPointer(x, y) {
      pointer = [x, y];
    },
    /**
     * Plays the opening. `mark` is the static mark's box (CSS px) that the cubes settle into and
     * leave from; `mode` is 'full' (fall, hold, flight) or 'short' (flight only). `hooks` run on
     * the frame each moment is drawn: start, land (full only), reveal, done. `revealLate` holds the
     * reveal until the cubes are halfway home, for layouts where they fly across the copy. Returns false when
     * there is nothing to play (reduced motion, or the loop is not running).
     */
    intro({ mark, mode = 'full', revealLate = false, hooks = {} }) {
      if (reduced || !running) return false;
      intro = {
        mark,
        mode,
        revealLate,
        hooks,
        plan: fallPlan(),
        start: null,
        warm: false,
        elapsed: 0,
        flightStart: 0,
        fired: new Set(),
        finished: false,
      };
      return true;
    },
    /** Ends the opening at once: the next frame is the settled scene. */
    skipIntro() {
      intro = null;
    },
    /** `?debug=bounds` only: every drawn item's on-screen box (CSS px), clipped to the rectangle. */
    debugBounds() {
      const f = debugFrame;
      if (!f) return [];
      const vp = mul(f.cam.proj, f.cam.matrix);
      const project = (p) => {
        const [x, y] = ndc(vp, p);
        const nx = x * f.lens[0] + f.lens[2];
        const ny = y * f.lens[1] + f.lens[3];
        return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height];
      };
      const r = f.rect;
      const box = (points, name) => {
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const [u0, u1, v0, v1] = [
          Math.min(...xs),
          Math.max(...xs),
          Math.min(...ys),
          Math.max(...ys),
        ];
        const x0 = Math.max(u0, r.x);
        const y0 = Math.max(v0, r.y);
        const x1 = Math.min(u1, r.x + r.w);
        const y1 = Math.min(v1, r.y + r.h);
        if (x1 <= x0 || y1 <= y0) return null;
        // `cut` is how far the framing let it run past the rectangle (the scissor hides that part).
        const cut = Math.max(r.x - u0, r.y - v0, u1 - (r.x + r.w), v1 - (r.y + r.h), 0);
        return { name, x: x0, y: y0, w: x1 - x0, h: y1 - y0, cut };
      };
      const out = [];
      f.actors.forEach((a, i) => {
        if (!drawn(a)) return;
        const b = box(corners(a).map(project), i < 9 ? `cube${i}` : `spark${i - 9}`);
        if (b) out.push(b);
      });
      const wires = f.lines.filter((l) => (l[2][3] ?? 1) * f.present > 0.05);
      if (wires.length > 0) {
        const b = box(
          wires.flatMap(([a, c]) => [project(a), project(c)]),
          'wires'
        );
        if (b) out.push(b);
      }
      if (f.present > 0.05) {
        const fl = f.bounds.floor;
        const b = box(
          [
            [fl.x0, fl.y, fl.z0],
            [fl.x1, fl.y, fl.z0],
            [fl.x0, fl.y, fl.z1],
            [fl.x1, fl.y, fl.z1],
          ].map(project),
          'floor'
        );
        if (b) out.push(b);
      }
      return out;
    },
    /** `?debug=bounds` only: forget any dissolve or intro, so a sample shows the settled scene. */
    debugSettle() {
      phase = null;
      intro = null;
      lastIndex = -1;
      lastT = 0;
    },
  };
}
