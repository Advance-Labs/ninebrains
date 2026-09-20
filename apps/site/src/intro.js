/**
 * The intro: nine cubes fall out of the dark and settle into the Ninebrains mark, then the mark
 * hands the page over to the hero.
 *
 * Hand-written WebGL, no library. The whole thing is nine cubes, one directional light and a
 * perspective camera, which is small enough to keep the page fast on a laptop that is already
 * running four coding agents.
 *
 * It is decoration, so it never gates the content: the hero is visible the moment this file
 * decides not to run (reduced motion, no WebGL context, a thrown error), and any click, key or
 * scroll skips straight to the end.
 */

const GRID = [-1, 0, 1];
/** Arm cubes are 1 unit; the centre is larger, in the mark's own proportion (20 / 13). */
const CORE_SCALE = 20 / 13;
/** Centre-to-centre spacing. The mark's own ratio is 21/13; 3D cubes read fatter than flat
 * squares, so the grid is opened slightly to keep the gaps. */
const SPACING = 1.78;
const DURATION = 1150;
const STAGGER = 45;
const HOLD = 260;
const FADE = 520;

const VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  uniform mat4 uProjection;
  uniform mat4 uView;
  uniform mat4 uModel;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    vWorld = world.xyz;
    // Every model matrix here is a rotation plus a uniform scale, so the upper 3x3 is a safe
    // normal matrix without inverting anything.
    vNormal = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal);
    gl_Position = uProjection * uView * world;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform vec3 uCamera;
  uniform float uAlpha;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 light = normalize(vec3(0.3, 0.52, 0.92));
    float lambert = max(dot(normal, light), 0.0);
    // Black and white: the faces are a grey ramp, never a hue.
    float shade = 0.42 + 0.58 * lambert;
    vec3 view = normalize(uCamera - vWorld);
    float rim = pow(1.0 - max(dot(normal, view), 0.0), 2.5) * 0.22;
    gl_FragColor = vec4(vec3(min(shade + rim, 1.0)) * uAlpha, 1.0);
  }
`;

/** A unit cube as 36 vertices of position + normal. */
function cubeGeometry() {
  const faces = [
    {
      normal: [0, 0, 1],
      corners: [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
    },
    {
      normal: [0, 0, -1],
      corners: [
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    },
    {
      normal: [0, 1, 0],
      corners: [
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
        [-1, 1, -1],
      ],
    },
    {
      normal: [0, -1, 0],
      corners: [
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
        [-1, -1, 1],
      ],
    },
    {
      normal: [1, 0, 0],
      corners: [
        [1, -1, 1],
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
      ],
    },
    {
      normal: [-1, 0, 0],
      corners: [
        [-1, -1, -1],
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
      ],
    },
  ];
  const data = [];
  for (const { normal, corners } of faces) {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      data.push(...corners[index].map((value) => value * 0.5), ...normal);
    }
  }
  return new Float32Array(data);
}

// --- the smallest mat4 helpers that do the job ---------------------------------------------

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const range = 1 / (near - far);
  return [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (near + far) * range,
    -1,
    0,
    0,
    near * far * range * 2,
    0,
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      for (let k = 0; k < 4; k++) out[row * 4 + column] += a[k * 4 + column] * b[row * 4 + k];
    }
  }
  return out;
}

function translation(x, y, z) {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function scaling(s) {
  const m = identity();
  m[0] = m[5] = m[10] = s;
  return m;
}

function rotationX(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

function rotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Deterministic pseudo-random, so the intro is the same every load and in every screenshot. */
function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

/** The nine cubes: where each one ends up, and where it falls in from. */
function buildCubes() {
  const random = seeded(9);
  const cubes = [];
  for (const x of GRID) {
    for (const y of GRID) {
      const core = x === 0 && y === 0;
      const angle = random() * Math.PI * 2;
      const distance = 7 + random() * 6;
      cubes.push({
        target: [x * SPACING, -y * SPACING, 0],
        scale: core ? CORE_SCALE : 1,
        // Arms arrive from a ring out in the dark; the centre comes straight at the camera.
        from: core
          ? [0, 0, -14]
          : [Math.cos(angle) * distance, Math.sin(angle) * distance, -6 - random() * 10],
        spin: [random() * Math.PI * 2, random() * Math.PI * 2],
        // The centre lands first and the arms follow, so the mark builds outwards.
        delay: core ? 0 : 120 + random() * STAGGER * 6,
      });
    }
  }
  return cubes;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed to compile');
  }
  return shader;
}

export function runIntro({ canvas, onDone }) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) {
    onDone();
    return () => {};
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'program failed to link');
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, cubeGeometry(), gl.STATIC_DRAW);

  const stride = 6 * 4;
  const aPosition = gl.getAttribLocation(program, 'aPosition');
  const aNormal = gl.getAttribLocation(program, 'aNormal');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aNormal);
  gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, stride, 3 * 4);

  const uniform = (name) => gl.getUniformLocation(program, name);
  const uProjection = uniform('uProjection');
  const uView = uniform('uView');
  const uModel = uniform('uModel');
  const uCamera = uniform('uCamera');
  const uAlpha = uniform('uAlpha');

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 1);

  const cubes = buildCubes();
  const total = DURATION + STAGGER * 6 + HOLD;
  let start = null;
  let frame = 0;
  let finished = false;
  let skipped = false;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(canvas.clientWidth * ratio);
    const height = Math.floor(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw(elapsed) {
    resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const assembly = Math.min(elapsed / (DURATION + STAGGER * 6), 1);
    // The camera pulls back as the mark forms, the way a shot opens out, so the mark lands at
    // logo size rather than filling the frame.
    const cameraZ = 7.6 + 3.9 * easeInOutCubic(assembly);
    const aspect = canvas.width / Math.max(canvas.height, 1);
    // On a phone the mark has to fit a narrow viewport, so widen the field of view.
    const fov = aspect < 1 ? 1.15 : 0.82;
    gl.uniformMatrix4fv(uProjection, false, new Float32Array(perspective(fov, aspect, 0.1, 100)));
    gl.uniformMatrix4fv(uView, false, new Float32Array(translation(0, 0, -cameraZ)));
    gl.uniform3f(uCamera, 0, 0, cameraZ);

    // The whole mark keeps a slight tilt until it settles square to the camera.
    const settle = easeInOutCubic(assembly);
    const groupTilt = multiply(rotationX(0.42 * (1 - settle)), rotationY(-0.55 * (1 - settle)));

    for (const cube of cubes) {
      const local = Math.min(Math.max((elapsed - cube.delay) / DURATION, 0), 1);
      const eased = easeOutCubic(local);
      const position = cube.target.map(
        (value, axis) => cube.from[axis] + (value - cube.from[axis]) * eased
      );
      const spin = 1 - eased;
      const model = multiply(
        multiply(groupTilt, translation(position[0], position[1], position[2])),
        multiply(
          multiply(rotationX(cube.spin[0] * spin), rotationY(cube.spin[1] * spin)),
          scaling(cube.scale)
        )
      );
      gl.uniformMatrix4fv(uModel, false, new Float32Array(model));
      // Cubes fade up as they arrive, so nothing pops into frame.
      gl.uniform1f(uAlpha, Math.min(eased * 1.6, 1));
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    onDone();
  }

  function loop(now) {
    if (start === null) start = now;
    const elapsed = skipped ? total : now - start;
    try {
      draw(elapsed);
    } catch {
      finish();
      return;
    }
    if (elapsed >= total) {
      // Hand over while the last frame is still on screen; CSS fades the canvas out.
      canvas.dataset.state = 'done';
      setTimeout(finish, FADE);
      return;
    }
    frame = requestAnimationFrame(loop);
  }

  frame = requestAnimationFrame(loop);
  return () => {
    skipped = true;
  };
}
