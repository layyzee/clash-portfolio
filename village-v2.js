import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CONTENT } from "./content-v2.js";
import { PROJECT_MEDIA } from "./project-media-v1.js";

/* ------------------------------------------------------------------ */
/*  Page modes and tiny utilities                                      */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
const STILL = params.has("still");
const LOW = params.get("quality") === "low" || matchMedia("(pointer: coarse)").matches;
const isTouch = matchMedia("(pointer: coarse)").matches;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FORCE_PROFILE = params.get("profile") === "1";
const FORCE_ROTATE = params.get("rotate") === "1";
const LOAD_HOLD = params.get("loadhold") === "1";

if (STILL) document.documentElement.classList.add("still");

const app = document.getElementById("app");
const boot = document.getElementById("boot");
const bootFill = document.getElementById("boot-fill");
const bootStatus = document.getElementById("boot-status");
const bootProgress = boot.querySelector(".boot-bar");
const gate = document.getElementById("gate");
const gateEnter = document.getElementById("gate-enter");
const splash = document.getElementById("splash");
const INTRO_SKIP = STILL || params.get("intro") === "0";

// Two authorized intro cues: cue 1 belongs to the black splash, cue 2 to the
// loading screen. The splash stays up until cue 1 ends; the loading screen
// stays up until cue 2 ends and the village is ready.
const introOne = new Audio("assets/sfx/intro-1.mp3");
introOne.preload = "auto";
introOne.volume = 0.9;

const introTwo = new Audio("assets/sfx/intro-2.mp3");
introTwo.preload = "auto";
introTwo.volume = 0.5;

// These match the delivered files (2.25s and 4.00s) and are only used if the
// media element cannot report its own duration.
const INTRO_ONE_FALLBACK_MS = 2250;
const INTRO_TWO_FALLBACK_MS = 4000;
const MUTED_SPLASH_MS = 1600;
const SILENT_LOADING_MS = 1100;
const LOADING_TAIL_MS = 140;
// The gate fades in 260ms. On a portrait phone the rotation waits for that
// fade to finish so the logo never turns sideways; this fallback only covers
// a missed transitionend. The splash letters start in the same tick, which
// keeps the touch transition free of a black pause.
const GATE_HANDOFF_FALLBACK_MS = 400;

const intro = {
  started: false,
  sceneReady: false,
  tapAt: 0,
  startedAt: 0,
  cueOneEndedAt: 0,
  splashOutAt: 0,
  splashOutAudioTime: 0,
  cueTwoStartedAt: 0,
  loadingAt: 0,
  loadingCueDone: false,
  loadingDoneAt: 0,
  readyAt: 0,
  revealedAt: 0,
  revealed: false,
  audio: false,
  audio2: false,
  ticker: 0,
  revealTimer: 0,
  callbacks: [],
  buildReleased: false,
  buildWaiters: [],
  landscape: false,
  handoffTimer: 0,
  audioTimer: 0,
  silentTimer: 0,
  phase: "splash",
};

// Intro instrumentation for cleanup/tests. These are plain state objects,
// not a public API.
window.__intro = intro;
window.__introAudio = introOne;
window.__introAudio2 = introTwo;

let cameraIntroStarted = INTRO_SKIP || reduceMotion;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const smooth = (t) => t * t * (3 - 2 * t);

/* ------------------------------------------------------------------ */
/*  Player identity: age, display name and visit count                 */
/* ------------------------------------------------------------------ */

// The level is not a game stat. It is the player's current age, calculated
// live from the real date. Only the age is shown; the birth date never is.
const BIRTH_DATE = { year: 2004, month: 7, day: 26 };

function ageOn(date = new Date()) {
  return 7;
}

let playerAge = 7;

const DEVICE_VISIT_KEY = "village-device-visits";
const SESSION_VISIT_KEY = "village-session-counted";

// The owner identity is fixed. Visitors only look around, so there is no name
// capture anywhere in the village.

function applyPlayerAge() {
  playerAge = 7;
  const crest = document.getElementById("crest-level");
  if (crest) {
    crest.textContent = "7";
    crest.parentElement?.setAttribute("title", `Level 7 Citadel · 7+ Years IT & Agile Leadership`);
  }
}

/* ------------------------------------------------------------------ */
/*  Intro: black card → loading screen → village                       */
/* ------------------------------------------------------------------ */

function readSoundPref() {
  try {
    return localStorage.getItem("village-sound") !== "off";
  } catch {
    return true;
  }
}

function writeSoundPref(on) {
  try {
    localStorage.setItem("village-sound", on ? "on" : "off");
  } catch { /* storage can be blocked; keep the in-memory state */ }
}

function introSfxEnabled() {
  // First visit defaults to sound on. A deliberate mute is respected.
  return readSoundPref();
}

function setBootProgress(value) {
  const pct = clamp(value, 0, 100);
  // On the final tick, snap the bar to full instead of sweeping while the
  // loading screen fades; otherwise the number reads 100% over a part-filled bar.
  const snap = pct >= 100;
  if (snap) bootFill.style.transition = "none";
  bootFill.style.width = `${pct}%`;
  if (snap) {
    requestAnimationFrame(() => {
      bootFill.style.transition = "";
    });
  }
  if (bootProgress) bootProgress.setAttribute("aria-valuenow", String(Math.round(pct)));
}

function introOnReveal(fn) {
  if (intro.revealed) fn();
  else intro.callbacks.push(fn);
}

// Building the village is a heavy synchronous job. Hold it until the black
// card has handed over to the loading screen, otherwise it delays the very
// transition it is supposed to be loading behind.
function releaseIntroBuild() {
  if (intro.buildReleased) return;
  intro.buildReleased = true;
  for (const fn of intro.buildWaiters.splice(0)) fn();
}

function waitForIntroBuildWindow() {
  if (INTRO_SKIP || intro.buildReleased) return Promise.resolve();
  return new Promise((resolve) => intro.buildWaiters.push(resolve));
}

function introCueDuration(audio, fallbackMs) {
  const d = Number(audio.duration);
  return Number.isFinite(d) && d > 0 ? Math.ceil(d * 1000) : fallbackMs;
}

function clearIntroAudioTimer() {
  window.clearTimeout(intro.audioTimer);
  intro.audioTimer = 0;
}

function clearSilentTimer() {
  window.clearTimeout(intro.silentTimer);
  intro.silentTimer = 0;
}

function armIntroOneEnd() {
  clearIntroAudioTimer();
  introOne.addEventListener("ended", onIntroOneEnded, { once: true });
  // The +200ms only matters if the media element never fires `ended`; it keeps
  // the card from hanging forever without cutting a real cue short.
  intro.audioTimer = window.setTimeout(
    onIntroOneEnded,
    introCueDuration(introOne, INTRO_ONE_FALLBACK_MS) + 200
  );
}

function armIntroTwoEnd() {
  clearIntroAudioTimer();
  introTwo.addEventListener("ended", onIntroTwoEnded, { once: true });
  intro.audioTimer = window.setTimeout(
    onIntroTwoEnded,
    introCueDuration(introTwo, INTRO_TWO_FALLBACK_MS) + 200
  );
}

function beginSilentSplash(waitMs = MUTED_SPLASH_MS) {
  intro.audio = false;
  intro.phase = "splash";
  clearSilentTimer();
  intro.silentTimer = window.setTimeout(onIntroOneEnded, waitMs);
}

// Called directly from the entry tap so browsers count it as a user gesture.
function beginIntro(withAudio) {
  intro.audio = withAudio;
  intro.phase = "splash";
  setBootProgress(14);

  if (!withAudio) {
    beginSilentSplash(MUTED_SPLASH_MS);
    return;
  }

  introOne.currentTime = 0;
  const attempt = introOne.play();
  if (attempt && typeof attempt.then === "function") {
    attempt
      .then(() => {
        intro.audio = true;
        armIntroOneEnd();
      })
      .catch(() => {
        // The page still enters, just without cue 1.
        intro.audio = false;
        beginSilentSplash(MUTED_SPLASH_MS);
      });
  } else {
    intro.audio = true;
    armIntroOneEnd();
  }
}

function beginSilentLoading() {
  intro.audio2 = false;
  clearSilentTimer();
  intro.silentTimer = window.setTimeout(() => {
    intro.loadingCueDone = true;
    intro.loadingDoneAt = performance.now();
    setBootProgress(100);
    maybeRevealIntro();
  }, SILENT_LOADING_MS);
}

function startLoadingCue() {
  intro.loadingCueDone = false;
  intro.loadingDoneAt = 0;
  intro.cueTwoStartedAt = 0;
  if (!intro.audio || !introSfxEnabled()) {
    beginSilentLoading();
    return;
  }

  introTwo.currentTime = 0;
  const attempt = introTwo.play();
  if (attempt && typeof attempt.then === "function") {
    attempt
      .then(() => {
        intro.audio2 = true;
        intro.cueTwoStartedAt = performance.now();
        armIntroTwoEnd();
      })
      .catch(() => {
        // Cue 2 is unavailable, but the loading screen still resolves quickly.
        intro.audio = false;
        beginSilentLoading();
      });
  } else {
    intro.audio2 = true;
    intro.cueTwoStartedAt = performance.now();
    armIntroTwoEnd();
  }
}

// Hand the painted loading screen to the synchronous geometry build. Waiting
// two frames plus a short beat lets the splash fade play instead of freezing
// on its last frame while the main thread is busy.
function releaseIntroBuildAfterPaint() {
  if (LOAD_HOLD) {
    window.setTimeout(releaseIntroBuild, 9000);
    return;
  }
  requestAnimationFrame(() => {
    window.setTimeout(releaseIntroBuild, 240);
  });
  window.setTimeout(releaseIntroBuild, 700);
}

function onIntroOneEnded() {
  if (intro.phase !== "splash") return;
  clearIntroAudioTimer();
  clearSilentTimer();
  if (!introOne.ended && !introOne.paused) introOne.pause();
  intro.cueOneEndedAt = performance.now();
  intro.splashOutAudioTime = introOne.currentTime || 0;
  intro.splashOutAt = intro.cueOneEndedAt;
  intro.loadingAt = intro.splashOutAt;
  intro.phase = "loading";
  splash.classList.add("out");
  splash.setAttribute("aria-hidden", "true");

  // Cue 2 starts before the build so the loading screen and its audio begin
  // together. The build runs once the fade has had a chance to paint.
  startLoadingCue();

  if (intro.sceneReady) {
    setBootProgress(100);
  } else {
    setBootProgress(18);
    const step = () => {
      if (intro.sceneReady) return;
      const current = parseFloat(bootFill.style.width) || 0;
      setBootProgress(Math.min(88, current + 2.5 + Math.random() * 4.5));
      intro.ticker = window.setTimeout(step, 300 + Math.random() * 140);
    };
    intro.ticker = window.setTimeout(step, 360);
  }
  releaseIntroBuildAfterPaint();
  maybeRevealIntro();
}

function onIntroTwoEnded() {
  if (intro.phase !== "loading") return;
  clearIntroAudioTimer();
  if (!introTwo.ended && !introTwo.paused) introTwo.pause();
  intro.loadingCueDone = true;
  intro.loadingDoneAt = performance.now();
  setBootProgress(100);
  window.setTimeout(() => maybeRevealIntro(), LOADING_TAIL_MS);
}

function markIntroSceneReady() {
  intro.sceneReady = true;
  intro.readyAt = performance.now();
  if (INTRO_SKIP) return;
  window.clearTimeout(intro.ticker);
  intro.ticker = 0;
  const waitingOnCue = !intro.loadingCueDone;
  setBootProgress(waitingOnCue ? 92 : 100);
  bootStatus.textContent = "Ready";
  maybeRevealIntro();
}

function maybeRevealIntro() {
  if (INTRO_SKIP || intro.revealed || !intro.sceneReady || !intro.loadingAt) return;
  if (!intro.loadingCueDone) return;
  // Cue 2 already sets the pace; the minimums only stop the loading screen
  // from blinking on a muted/failed-audio run.
  const minLoading = reduceMotion ? 280 : 900;
  const tailWait = intro.loadingDoneAt
    ? Math.max(0, LOADING_TAIL_MS - (performance.now() - intro.loadingDoneAt))
    : 0;
  const wait = Math.max(minLoading - (performance.now() - intro.loadingAt), tailWait);
  if (wait > 0) {
    window.clearTimeout(intro.revealTimer);
    intro.revealTimer = window.setTimeout(maybeRevealIntro, wait + 30);
    return;
  }
  revealIntro();
}

function fadeIntroAudio() {
  const playing = [introOne, introTwo].filter((a) => !a.paused && !a.ended);
  if (!playing.length) return;
  const starts = playing.map((a) => a.volume);
  const t0 = performance.now();
  const fade = () => {
    const k = clamp((performance.now() - t0) / 800, 0, 1);
    playing.forEach((a, i) => {
      a.volume = starts[i] * (1 - k);
    });
    if (k < 1) {
      requestAnimationFrame(fade);
    } else {
      playing.forEach((a, i) => {
        a.pause();
        a.currentTime = 0;
        a.volume = starts[i];
      });
    }
  };
  requestAnimationFrame(fade);
}

function revealIntro() {
  if (intro.revealed) return;
  intro.revealed = true;
  intro.phase = "revealed";
  intro.revealedAt = performance.now();
  window.clearTimeout(intro.revealTimer);
  window.clearTimeout(intro.ticker);
  window.clearTimeout(intro.handoffTimer);
  clearIntroAudioTimer();
  clearSilentTimer();
  splash.classList.add("out");
  splash.setAttribute("aria-hidden", "true");
  setBootProgress(100);
  bootStatus.textContent = "Ready";
  boot.classList.add("done");
  cameraIntroStarted = true;
  if (reduceMotion) {
    introT = 1;
    distance = HOME_DISTANCE;
  } else {
    introT = 0;
    distance = introFrom;
  }
  updateCamera();
  fadeIntroAudio();

  const callbacks = intro.callbacks.splice(0);
  window.setTimeout(() => {
    for (const fn of callbacks) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }, 700);
}

function onGateKey(e) {
  if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
  e.preventDefault();
  onGateGesture();
}

function onGateGesture() {
  if (intro.started || intro.revealed) return;
  intro.started = true;
  intro.tapAt = performance.now();
  intro.startedAt = intro.tapAt;
  gate.classList.add("out");
  gate.setAttribute("aria-hidden", "true");
  // The gate stays upright. On a portrait phone, wait for its fade to finish,
  // then turn the page under the black SID / DHE / SHK splash and pop the
  // letters in landscape. Starting the letters in the same tick as the fade
  // removes the black pause the old fixed delay left behind. A phone already
  // held in landscape, and every desktop, plays the letters at once.
  window.clearTimeout(intro.handoffTimer);
  const turnUnderSplash = isTouch && window.innerHeight > window.innerWidth;
  if (turnUnderSplash) {
    const handoff = () => {
      gate.removeEventListener("transitionend", onGateFade);
      window.clearTimeout(intro.handoffTimer);
      intro.handoffTimer = 0;
      if (intro.landscape) return;
      intro.landscape = true;
      applyOrientation();
      splash.classList.add("play");
    };
    const onGateFade = (e) => {
      if (e.target === gate && e.propertyName === "opacity") handoff();
    };
    gate.addEventListener("transitionend", onGateFade);
    if (reduceMotion) handoff();
    else intro.handoffTimer = window.setTimeout(handoff, GATE_HANDOFF_FALLBACK_MS);
  } else {
    intro.landscape = true;
    applyOrientation();
    splash.classList.add("play");
  }
  gate.removeEventListener("click", onGateGesture);
  document.removeEventListener("keydown", onGateKey);
  beginIntro(introSfxEnabled());
}

function armIntro() {
  if (INTRO_SKIP) {
    gate.style.display = "none";
    splash.style.display = "none";
    boot.classList.add("done");
    return;
  }

  intro.phase = "splash";
  setBootProgress(8);

  // The logo gate is the only sound gate; the original intro starts on click.
  const label = gateEnter?.querySelector("span");
  if (label) label.textContent = isTouch ? "TAP TO ENTER" : "CLICK TO ENTER";

  gate.addEventListener("click", onGateGesture);
  document.addEventListener("keydown", onGateKey);
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261022);

/* The village is laid out like a base, not a list. These positions are
   shared by the geometry, the ground dressing and the walkable paths. */
const LAYOUT = {
  townhall: { x: 0, z: 0, r: 3.4 },
  workshop: { x: -7.0, z: 8.5, r: 3.2 },
  // Barracks and Clan Castle sit just outside the plaza ring instead of
  // drifting to the island rim, so the four landmarks read as one village.
  barracks: { x: -8.0, z: -3.0, r: 3.0 },
  // The castle sits a little further round the ring so it frames the meadow
  // instead of covering the waterfall.
  clan: { x: 7.4, z: 5.2, r: 3.0 },
  cannon: { x: 4.6, z: 8.8, r: 2.2 },
  gembox: { x: -3.5, z: 6.2, r: 1.6 },
};

// The Town Hall courtyard. Paths, props and ground dressing all treat this
// disc as occupied so the centre of the island reads as one designed place.
const PLAZA_RADIUS = 6.1;

const PATH_LANES = [
  // Main approach: Town Hall steps down to the harbour shore.
  { w: 2.15, pts: [[0, 3.3], [0, 14.3]] },
  // Barracks: front walk from the plaza's west rim to its door.
  { w: 1.6, pts: [[-5.1, -0.25], [-8.4, -0.5]] },
  // Workshop: leaves the plaza's south-west rim, swings below the
  // workshop and arrives at its front steps.
  { w: 1.55, pts: [[-2.55, 5.5], [-3.75, 12.1], [-6.75, 11.35]] },
  // Clan Castle: sweeps around the castle's south front to the gate.
  { w: 1.55, pts: [[3.0, 5.2], [5.6, 9.4], [7.35, 7.95]] },
];

const PATH_LINES = PATH_LANES.flatMap((lane) =>
  lane.pts.slice(1).map((p, i) => {
    const a = lane.pts[i];
    return [a[0], a[1], p[0], p[1], lane.w];
  })
);

function distanceToSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - x1) * dx + (pz - z1) * dz) / len2, 0, 1);
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}

function isOccupied(x, z, pad = 0.45) {
  return Object.values(LAYOUT).some((b) => Math.hypot(x - b.x, z - b.z) < b.r + pad);
}

function isOnPath(x, z, pad = 1.0) {
  if (Math.hypot(x, z) < PLAZA_RADIUS + pad) return true;
  return PATH_LINES.some((p) => distanceToSegment(x, z, p[0], p[1], p[2], p[3]) < p[4] / 2 + pad);
}

/* ------------------------------------------------------------------ */
/*  Renderer / scene / camera                                          */
/* ------------------------------------------------------------------ */

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
  stencil: false,
});
const BASE_DEVICE_PIXEL_RATIO = window.devicePixelRatio || 1;
let browserZoom = 1;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = !LOW ? true : true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc6ecfb);
scene.fog = new THREE.Fog(0xc8ecf8, 80, 172);

const camera = new THREE.PerspectiveCamera(31, window.innerWidth / window.innerHeight, 0.1, 260);

const HOME_TARGET = new THREE.Vector3(0, -3.2, 0);
const CAM_DIR = new THREE.Vector3(-0.64, 0.54, 0.64).normalize();
const HOME_DISTANCE = isTouch ? 60 : 64;
const MIN_DISTANCE = 34;
const MAX_DISTANCE = isTouch ? 94 : 98;
const PAN_BOUND = 7;

let target = HOME_TARGET.clone();
let distance = HOME_DISTANCE;
let cameraGoal = null;
let introT = reduceMotion || STILL ? 1 : 0;
let introFrom = HOME_DISTANCE * 1.22;

function viewSize() {
  const forced = app.classList.contains("force-landscape");
  return forced
    ? { w: window.innerHeight, h: window.innerWidth }
    : { w: window.innerWidth, h: window.innerHeight };
}

function toLocal(clientX, clientY) {
  const forced = app.classList.contains("force-landscape");
  return forced
    ? { x: clientY, y: window.innerWidth - clientX }
    : { x: clientX, y: clientY };
}

function updateCamera() {
  target.x = clamp(target.x, -PAN_BOUND, PAN_BOUND);
  target.z = clamp(target.z, -PAN_BOUND, PAN_BOUND);
  camera.position.copy(target).addScaledVector(CAM_DIR, distance);
  camera.lookAt(target);
}

updateCamera();

/* ------------------------------------------------------------------ */
/*  Canvas textures and materials                                      */
/* ------------------------------------------------------------------ */

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d") };
}

function canvasTexture(c, repeat = null) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  return t;
}

function grassTexture() {
  const { c, ctx } = makeCanvas(256, 256);
  const r = mulberry32(88);
  ctx.fillStyle = "#94d24f";
  ctx.fillRect(0, 0, 256, 256);

  // Soft, irregular colour patches instead of a checkerboard.
  for (let i = 0; i < 54; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const rx = 14 + r() * 46;
    const ry = 8 + r() * 28;
    ctx.fillStyle = r() > 0.5 ? "rgba(112,182,52,.26)" : "rgba(190,232,116,.26)";
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine blades and warm specks.
  for (let i = 0; i < 360; i++) {
    ctx.fillStyle = r() > 0.56 ? "rgba(60,112,28,.22)" : "rgba(219,248,156,.2)";
    ctx.fillRect(Math.floor(r() * 256), Math.floor(r() * 256), 1, 1 + (r() > 0.75 ? 2 : 0));
  }
  return canvasTexture(c, 5);
}

function skyTexture() {
  const { c, ctx } = makeCanvas(512, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#2E9CDB");
  g.addColorStop(0.34, "#67C7EF");
  g.addColorStop(0.58, "#B7E8FA");
  g.addColorStop(0.78, "#EAF9FF");
  g.addColorStop(1, "#FBFEFF");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);

  // Baked cloud puffs near the horizon band.
  const puff = (x, y, rx, ry, alpha) => {
    const cg = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    cg.addColorStop(0, `rgba(255,255,255,${alpha})`);
    cg.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.65})`);
    cg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  puff(58, 318, 92, 26, 0.55);
  puff(126, 300, 66, 22, 0.45);
  puff(330, 286, 120, 30, 0.5);
  puff(410, 324, 80, 24, 0.4);
  puff(238, 356, 150, 24, 0.35);
  return canvasTexture(c);
}

function earthSideTexture() {
  const { c, ctx } = makeCanvas(256, 256);
  const r = mulberry32(314);
  ctx.fillStyle = "#7d5831";
  ctx.fillRect(0, 0, 256, 256);

  // Wavy horizontal strata keep the floating underside from reading
  // as one flat slab of sand.
  for (let i = 0; i < 6; i++) {
    const y = 26 + i * 40 + r() * 8;
    const h = 7 + r() * 9;
    ctx.fillStyle = i % 2 ? "rgba(190,146,88,.16)" : "rgba(61,42,22,.2)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 24) {
      ctx.lineTo(x, y + Math.sin(x * 0.045 + i * 1.7) * 5 + (r() - 0.5) * 5);
    }
    ctx.lineTo(256, y + h);
    for (let x = 256; x >= 0; x -= 24) {
      ctx.lineTo(x, y + h + Math.sin(x * 0.045 + i * 1.7) * 4);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Vertical soil streaks and small embedded stones.
  for (let i = 0; i < 78; i++) {
    const x = r() * 256;
    const w = 2 + r() * 8;
    ctx.fillStyle =
      r() > 0.5 ? `rgba(89,59,29,${0.14 + r() * 0.22})` : `rgba(181,139,84,${0.1 + r() * 0.16})`;
    ctx.fillRect(x, 0, w, 256);
  }
  for (let i = 0; i < 100; i++) {
    ctx.fillStyle = r() > 0.6 ? "rgba(133,127,111,.3)" : "rgba(71,48,26,.24)";
    ctx.beginPath();
    ctx.ellipse(r() * 256, r() * 256, 1.5 + r() * 5, 1.5 + r() * 3, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Shadow under the grassy lip.
  const g = ctx.createLinearGradient(0, 0, 0, 86);
  g.addColorStop(0, "rgba(48,33,17,.55)");
  g.addColorStop(0.55, "rgba(48,33,17,.22)");
  g.addColorStop(1, "rgba(48,33,17,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 86);
  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

function rockFaceTexture() {
  const { c, ctx } = makeCanvas(256, 256);
  const r = mulberry32(515);
  ctx.fillStyle = "#8c8679";
  ctx.fillRect(0, 0, 256, 256);

  // Broad patches of lighter and darker stone.
  for (let i = 0; i < 46; i++) {
    ctx.fillStyle = r() > 0.5 ? "rgba(188,181,165,.13)" : "rgba(85,79,68,.15)";
    ctx.beginPath();
    ctx.ellipse(r() * 256, r() * 256, 8 + r() * 34, 4 + r() * 20, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Horizontal strata.
  for (let i = 0; i < 5; i++) {
    const y = 20 + i * 48 + r() * 8;
    ctx.strokeStyle = i % 2 ? "rgba(63,58,49,.2)" : "rgba(205,198,181,.14)";
    ctx.lineWidth = 2 + r() * 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 24) {
      ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 4 + (r() - 0.5) * 3);
    }
    ctx.stroke();
  }

  // Vertical cracks.
  for (let i = 0; i < 14; i++) {
    let x = r() * 256;
    let y = r() * 110;
    ctx.strokeStyle = "rgba(52,48,41,.28)";
    ctx.lineWidth = 1 + r() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 3 + Math.floor(r() * 3);
    for (let s = 0; s < steps; s++) {
      x += (r() - 0.5) * 15;
      y += 28 + r() * 34;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function softTexture() {
  const { c, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.38, "rgba(255,255,255,.78)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return canvasTexture(c);
}

const SOFT_TEX = softTexture();
const ROCK_FACE_TEX = rockFaceTexture();

function waterTexture() {
  const { c, ctx } = makeCanvas(512, 512);
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, "#3fb8ca");
  g.addColorStop(0.5, "#2ba2bd");
  g.addColorStop(1, "#4ac6d2");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);

  const r = mulberry32(812);
  for (let i = 0; i < 45; i++) {
    const y = r() * 512;
    const amp = 4 + r() * 11;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(190,250,255,${0.18 + r() * 0.28})`;
    ctx.lineWidth = 1.5 + r() * 3;
    for (let x = -20; x <= 532; x += 8) {
      const yy = y + Math.sin(x * 0.022 + i) * amp + Math.sin(x * 0.061 + i * 2) * 2.5;
      if (x === -20) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(225,255,255,${0.1 + r() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(r() * 512, r() * 512, 1 + r() * 4, 0.7 + r() * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/* The open sea gets its own near-white ripple map. The vertex colours
   carry the hue, so the texture must never tint the water grey. */
function oceanTexture() {
  const { c, ctx } = makeCanvas(512, 512);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 512, 512);
  const r = mulberry32(957);

  // Broad, soft patches stop the surface reading as flat paint.
  for (let i = 0; i < 24; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 60 + r() * 150;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, r() > 0.45 ? "rgba(255,255,255,.13)" : "rgba(120,230,244,.14)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }

  // Short broken crests instead of long stripes.
  ctx.lineCap = "round";
  for (let i = 0; i < 64; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const len = 18 + r() * 62;
    const amp = 1.5 + r() * 3.5;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.22})`;
    ctx.lineWidth = 1.6 + r() * 2.6;
    for (let s = 0; s <= len; s += 5) {
      const yy = y + Math.sin(s * 0.1 + i * 1.7) * amp;
      if (s === 0) ctx.moveTo(x + s, yy);
      else ctx.lineTo(x + s, yy);
    }
    ctx.stroke();
  }

  // A few soft sparkles.
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(r() * 512, r() * 512, 1.2 + r() * 4.5, 0.6 + r() * 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  return t;
}

function forestFloorTexture() {
  const { c, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = "#527f3d";
  ctx.fillRect(0, 0, 256, 256);
  const r = mulberry32(441);
  for (let i = 0; i < 150; i++) {
    const c1 = ["#3f6b30", "#628f48", "#456f33", "#6f5a34", "#365d2a"][i % 5];
    ctx.fillStyle = c1;
    ctx.globalAlpha = 0.25 + r() * 0.35;
    ctx.beginPath();
    ctx.ellipse(r() * 256, r() * 256, 3 + r() * 13, 2 + r() * 8, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(7, 7);
  return t;
}

function gridTexture() {
  const { c, ctx } = makeCanvas(64, 64);
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(34,82,41,.28)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 64, 64);
  ctx.fillStyle = "rgba(34,82,41,.1)";
  ctx.fillRect(0, 0, 2, 2);
  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 16);
  return t;
}

function fallFoamTexture() {
  const { c, ctx } = makeCanvas(256, 512);
  ctx.clearRect(0, 0, 256, 512);
  const r = mulberry32(377);
  for (let i = 0; i < 30; i++) {
    const x = r() * 256;
    const y = r() * 80;
    const len = 160 + r() * 350;
    const w = 1.5 + r() * 7;
    const grad = ctx.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, `rgba(255,255,255,${0.35 + r() * 0.45})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, Math.min(len, 512 - y));
  }
  for (let i = 0; i < 55; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(r() * 256, r() * 512, 1 + r() * 4, 3 + r() * 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.15, 1.35);
  return t;
}

function waterfallTexture() {
  const { c, ctx } = makeCanvas(256, 512);
  ctx.clearRect(0, 0, 256, 512);
  const r = mulberry32(993);

  // A barely-there cyan veil. The dark rock behind the fall supplies
  // the contrast, so the sheet stays transparent between streaks.
  const base = ctx.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, "rgba(196,250,255,.2)");
  base.addColorStop(0.55, "rgba(133,231,248,.13)");
  base.addColorStop(1, "rgba(240,255,255,.06)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 512);

  // Broad soft ribbons of moving water.
  for (let i = 0; i < 9; i++) {
    const x = r() * 256;
    const w = 9 + r() * 24;
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, `rgba(238,255,255,${0.1 + r() * 0.16})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, 0, w, 512);
  }

  // Fast vertical whitewater lines.
  for (let i = 0; i < 46; i++) {
    const x = r() * 256;
    const w = 1 + r() * 4.5;
    const y = r() * 90;
    const len = 130 + r() * 380;
    const grad = ctx.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, `rgba(255,255,255,${0.45 + r() * 0.4})`);
    grad.addColorStop(0.6, `rgba(240,255,255,${0.22 + r() * 0.3})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, Math.min(len, 512 - y));
  }

  // Broken spray and foam flecks.
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.16 + r() * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(r() * 256, r() * 512, 0.8 + r() * 3.2, 2 + r() * 9, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bright crest at the lip.
  const crest = ctx.createLinearGradient(0, 0, 0, 74);
  crest.addColorStop(0, "rgba(255,255,255,.88)");
  crest.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = crest;
  ctx.fillRect(0, 0, 256, 74);

  const t = canvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1.25);
  return t;
}

const WATER_TEX = waterTexture();
const OCEAN_TEX = oceanTexture();
const FALL_TEX = waterfallTexture();

function bannerTexture(title, sub) {
  const { c, ctx } = makeCanvas(512, 160);
  ctx.fillStyle = "#243566";
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = "#FFC83A";
  ctx.lineWidth = 10;
  ctx.strokeRect(7, 7, 498, 146);
  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, 472, 120);
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFF4D0";
  ctx.font = '400 54px "Lilita One", Impact, sans-serif';
  ctx.fillText(title, 256, 78);
  ctx.fillStyle = "#FFC83A";
  ctx.font = '900 24px "Nunito", sans-serif';
  ctx.fillText(sub, 256, 118);
  return canvasTexture(c);
}

function monitorTexture() {
  const { c, ctx } = makeCanvas(512, 256);
  ctx.fillStyle = "#0C1731";
  ctx.fillRect(0, 0, 512, 256);
  const g = ctx.createLinearGradient(0, 0, 512, 256);
  g.addColorStop(0, "rgba(98,230,255,.12)");
  g.addColorStop(1, "rgba(98,230,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = "rgba(98,230,255,.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * 28);
    ctx.lineTo(512, i * 28);
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#9CF3FF";
  ctx.font = '400 86px "Lilita One", Impact, sans-serif';
  ctx.fillText("</>", 256, 135);
  ctx.fillStyle = "rgba(255,200,58,.9)";
  ctx.font = '900 20px "Nunito", sans-serif';
  ctx.fillText("BALAJI PALANI", 256, 185);
  return canvasTexture(c);
}

function signTexture(title, sub) {
  const { c, ctx } = makeCanvas(512, 220);
  ctx.fillStyle = "#B07A3E";
  ctx.fillRect(0, 0, 512, 220);
  ctx.fillStyle = "#8A5B2C";
  ctx.fillRect(12, 12, 488, 196);
  ctx.strokeStyle = "#5E3B1A";
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 208);
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFF1C8";
  ctx.font = '400 50px "Lilita One", Impact, sans-serif';
  ctx.fillText(title, 256, 92);
  ctx.fillStyle = "#FFC83A";
  ctx.font = '900 24px "Nunito", sans-serif';
  ctx.fillText(sub, 256, 138);
  ctx.fillStyle = "rgba(255,241,200,.55)";
  ctx.font = '900 17px "Nunito", sans-serif';
  ctx.fillText("TAP TO OPEN", 256, 178);
  return canvasTexture(c);
}

function blueprintTexture(label) {
  const { c, ctx } = makeCanvas(256, 320);
  ctx.fillStyle = "#1e4f7a";
  ctx.fillRect(0, 0, 256, 320);
  ctx.strokeStyle = "rgba(178,225,255,.28)";
  ctx.lineWidth = 1;
  for (let x = 16; x < 256; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 320);
    ctx.stroke();
  }
  for (let y = 16; y < 320; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#d9f1ff";
  ctx.lineWidth = 4;
  ctx.strokeRect(32, 66, 192, 142);
  ctx.beginPath();
  ctx.moveTo(48, 184);
  ctx.lineTo(106, 132);
  ctx.lineTo(152, 158);
  ctx.lineTo(208, 92);
  ctx.stroke();
  ctx.fillStyle = "#ffe08a";
  ctx.font = '400 44px "Lilita One", Impact, sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(label, 128, 274);
  return canvasTexture(c);
}

const M = {
  grass: new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, metalness: 0 }),
  hedge: new THREE.MeshStandardMaterial({ color: 0x4b7f3b, roughness: 1 }),
  forestFloor: new THREE.MeshStandardMaterial({
    map: forestFloorTexture(),
    transparent: true,
    opacity: 0.86,
    roughness: 1,
  }),
  path: new THREE.MeshStandardMaterial({ color: 0xc9b17c, roughness: 0.96, metalness: 0 }),
  terrain: new THREE.MeshStandardMaterial({ color: 0x68a64a, roughness: 1, metalness: 0 }),
  earthSide: new THREE.MeshStandardMaterial({ map: earthSideTexture(), roughness: 1, metalness: 0 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0xc9a36b, roughness: 1, metalness: 0 }),
  dirtDark: new THREE.MeshStandardMaterial({ color: 0xa97f4b, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xcfc8b6, roughness: 0.92, metalness: 0 }),
  stoneDark: new THREE.MeshStandardMaterial({ color: 0x9d9586, roughness: 0.95, metalness: 0 }),
  stoneDeep: new THREE.MeshStandardMaterial({ color: 0x766f62, roughness: 0.98 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xb07a3e, roughness: 0.9, metalness: 0 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x7a4e25, roughness: 0.92 }),
  woodLight: new THREE.MeshStandardMaterial({ color: 0xcf9250, roughness: 0.88 }),
  cream: new THREE.MeshStandardMaterial({ color: 0xf6ebd0, roughness: 0.85 }),
  roofRed: new THREE.MeshStandardMaterial({ color: 0xd8453b, roughness: 0.78, metalness: 0.02 }),
  roofRedDark: new THREE.MeshStandardMaterial({ color: 0xa82f28, roughness: 0.84 }),
  roofBlue: new THREE.MeshStandardMaterial({ color: 0x3e7bd9, roughness: 0.78 }),
  roofBlueDark: new THREE.MeshStandardMaterial({ color: 0x2c5ca8, roughness: 0.84 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xffc83a, roughness: 0.58, metalness: 0.15 }),
  goldDark: new THREE.MeshStandardMaterial({ color: 0xd99a1e, roughness: 0.66, metalness: 0.1 }),
  obsidian: new THREE.MeshStandardMaterial({ color: 0x181e2b, roughness: 0.35, metalness: 0.65 }),
  obsidianDark: new THREE.MeshStandardMaterial({ color: 0x0c121d, roughness: 0.45, metalness: 0.75 }),
  gigaCrystal: new THREE.MeshStandardMaterial({
    color: 0x00f5ff,
    emissive: 0x00b4d8,
    emissiveIntensity: 2.2,
    roughness: 0.1,
    metalness: 0.3,
    transparent: true,
    opacity: 0.92,
  }),
  gigaGold: new THREE.MeshStandardMaterial({
    color: 0xffca28,
    emissive: 0xffa000,
    emissiveIntensity: 0.4,
    roughness: 0.22,
    metalness: 0.88,
  }),
  gigaGoldDark: new THREE.MeshStandardMaterial({
    color: 0xb78103,
    roughness: 0.38,
    metalness: 0.82,
  }),
  energyRune: new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 1.9,
    roughness: 0.2,
  }),
  crimsonCarpet: new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    roughness: 0.9,
  }),
  navy: new THREE.MeshStandardMaterial({ color: 0x243566, roughness: 0.8 }),
  navyLight: new THREE.MeshStandardMaterial({ color: 0x3b528e, roughness: 0.8 }),
  window: new THREE.MeshStandardMaterial({
    color: 0x9cf3ff,
    emissive: 0x3bb6d6,
    emissiveIntensity: 0.75,
    roughness: 0.35,
    metalness: 0.15,
  }),
  lamp: new THREE.MeshStandardMaterial({
    color: 0xffe8a0,
    emissive: 0xffb52e,
    emissiveIntensity: 1.2,
    roughness: 0.4,
  }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4e9b3a, roughness: 0.95, flatShading: true }),
  leafLight: new THREE.MeshStandardMaterial({ color: 0x6fbf4a, roughness: 0.95, flatShading: true }),
  leafDark: new THREE.MeshStandardMaterial({ color: 0x3c7a2e, roughness: 0.95, flatShading: true }),
  forestLeaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, flatShading: true }),
  sand: new THREE.MeshStandardMaterial({ color: 0xefd08a, roughness: 1 }),
  sandDark: new THREE.MeshStandardMaterial({ color: 0xc9a45f, roughness: 1 }),
  water: new THREE.MeshStandardMaterial({
    map: WATER_TEX,
    color: 0xb9f2f2,
    roughness: 0.26,
    metalness: 0.08,
  }),
  waterDeep: new THREE.MeshStandardMaterial({
    map: WATER_TEX,
    color: 0x58c2d0,
    roughness: 0.34,
    metalness: 0.05,
  }),
  ocean: new THREE.MeshBasicMaterial({
    map: OCEAN_TEX,
    vertexColors: true,
    toneMapped: false,
  }),
  oceanSide: new THREE.MeshStandardMaterial({
    color: 0x0a76a0,
    roughness: 0.5,
    metalness: 0.05,
    flatShading: true,
    side: THREE.DoubleSide,
  }),
  seaFoam: new THREE.MeshBasicMaterial({
    color: 0xf4ffff,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  }),
  wetSand: new THREE.MeshStandardMaterial({ color: 0xc3a064, roughness: 0.9 }),
  foam: new THREE.MeshStandardMaterial({
    color: 0xf2ffff,
    roughness: 0.6,
    transparent: true,
    opacity: 0.78,
  }),
  waterfall: new THREE.MeshStandardMaterial({
    map: FALL_TEX,
    color: 0xd7fbff,
    transparent: true,
    opacity: 0.88,
    roughness: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x7a4b2a, roughness: 1 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x9c9a8e, roughness: 1, flatShading: true }),
  warmRock: new THREE.MeshStandardMaterial({ color: 0x8b7357, roughness: 1, flatShading: true }),
  moss: new THREE.MeshStandardMaterial({ color: 0x5f8c39, roughness: 1, flatShading: true }),
  mossLight: new THREE.MeshStandardMaterial({ color: 0x87ac4c, roughness: 1, flatShading: true }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe9b98b, roughness: 0.9 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x3e7bd9, roughness: 0.9 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x6b4624, roughness: 0.95 }),
  hat: new THREE.MeshStandardMaterial({ color: 0xffc83a, roughness: 0.65 }),
  roofBrown: new THREE.MeshStandardMaterial({ color: 0x9f5a32, roughness: 0.82 }),
  roofBrownDark: new THREE.MeshStandardMaterial({ color: 0x764020, roughness: 0.88 }),
  roofTeal: new THREE.MeshStandardMaterial({ color: 0x2e9d9a, roughness: 0.76 }),
  roofTealDark: new THREE.MeshStandardMaterial({ color: 0x1e6f70, roughness: 0.84 }),
  elixir: new THREE.MeshStandardMaterial({ color: 0x9a5bd8, roughness: 0.68 }),
  elixirDark: new THREE.MeshStandardMaterial({ color: 0x653b9d, roughness: 0.78 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0xa9efff,
    transparent: true,
    opacity: 0.24,
    roughness: 0.18,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  liquid: new THREE.MeshStandardMaterial({
    color: 0x75efb0,
    emissive: 0x20c77b,
    emissiveIntensity: 0.8,
    roughness: 0.35,
    transparent: true,
    opacity: 0.9,
  }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.55, metalness: 0.35 }),
  straw: new THREE.MeshStandardMaterial({ color: 0xe8c76c, roughness: 0.95 }),
  target: new THREE.MeshStandardMaterial({ color: 0xd8453b, roughness: 0.8 }),
  smoke: new THREE.MeshStandardMaterial({
    color: 0xf2f5f7,
    transparent: true,
    opacity: 0.48,
    roughness: 1,
    depthWrite: false,
  }),
};

const OUTLINE_MAT = new THREE.MeshBasicMaterial({
  color: 0x1b2340,
  side: THREE.BackSide,
});

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

function addOutline(mesh, scale = 1.035) {
  const o = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  o.scale.setScalar(scale);
  o.castShadow = false;
  o.receiveShadow = false;
  o.renderOrder = -1;
  mesh.add(o);
  return o;
}

function finishMesh(mesh, parent, opts = {}) {
  mesh.castShadow = opts.cast !== false;
  mesh.receiveShadow = opts.receive !== false;
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.ry) mesh.rotation.y = opts.ry;
  if (opts.rz) mesh.rotation.z = opts.rz;
  if (opts.outline) addOutline(mesh, opts.outlineScale ?? 1.035);
  parent.add(mesh);
  return mesh;
}

function rbox(parent, w, h, d, mat, x, y, z, opts = {}) {
  const r = opts.r ?? Math.min(0.12, Math.min(w, h, d) * 0.22);
  const geo = new RoundedBoxGeometry(w, h, d, 3, r);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return finishMesh(mesh, parent, opts);
}

function box(parent, w, h, d, mat, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return finishMesh(mesh, parent, opts);
}

function cyl(parent, rt, rb, h, seg, mat, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  mesh.position.set(x, y, z);
  return finishMesh(mesh, parent, opts);
}

function cone(parent, r, h, seg, mat, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
  mesh.position.set(x, y, z);
  return finishMesh(mesh, parent, opts);
}

function sphere(parent, r, seg, mat, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2)), mat);
  mesh.position.set(x, y, z);
  return finishMesh(mesh, parent, opts);
}

function torus(parent, r, tube, mat, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 36), mat);
  mesh.position.set(x, y, z);
  return finishMesh(mesh, parent, opts);
}

function plane(parent, w, h, mat, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(x, y, z);
  if (opts.rx !== undefined) mesh.rotation.x = opts.rx;
  if (opts.ry !== undefined) mesh.rotation.y = opts.ry;
  if (opts.rz !== undefined) mesh.rotation.z = opts.rz;
  mesh.castShadow = false;
  mesh.receiveShadow = opts.receive ?? false;
  parent.add(mesh);
  return mesh;
}

function glowSprite(parent, color, size, x, y, z, opacity = 0.5) {
  const mat = new THREE.SpriteMaterial({
    map: SOFT_TEX,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sp = new THREE.Sprite(mat);
  sp.position.set(x, y, z);
  sp.scale.set(size, size, 1);
  parent.add(sp);
  return sp;
}

function buildingGroup(x, z, rot = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  scene.add(g);
  return g;
}

function addFacadeSign(parent, title, sub, y, z, w = 2.0, h = 0.54) {
  rbox(parent, w + 0.16, h + 0.14, 0.12, M.woodDark, 0, y, z - 0.06, {
    r: 0.04,
    outline: true,
    outlineScale: 1.02,
  });
  plane(
    parent,
    w,
    h,
    new THREE.MeshBasicMaterial({ map: bannerTexture(title, sub) }),
    0,
    y,
    z + 0.02
  );
}

/* ------------------------------------------------------------------ */
/*  Sky, light, terrain                                                */
/* ------------------------------------------------------------------ */

let sky;
const clouds = [];

function buildSky() {
  sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 32, 20),
    new THREE.MeshBasicMaterial({
      map: skyTexture(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      toneMapped: false,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  glowSprite(scene, "#fff1b8", 18, -46, 40, -60, 0.22);

  // Clouds behind and under the floating plot.
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.SpriteMaterial({
      map: SOFT_TEX,
      color: i % 2 ? 0xffffff : 0xe8f7ff,
      transparent: true,
      opacity: 0.42 + rand() * 0.26,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const sp = new THREE.Sprite(mat);
    const high = i < 5;
    sp.position.set(
      -58 + i * 15 + rand() * 9,
      high ? 18 + rand() * 15 : -7 + rand() * 8,
      high ? -54 - rand() * 24 : -28 - rand() * 22
    );
    sp.scale.set(18 + rand() * 18, 5 + rand() * 5, 1);
    scene.add(sp);
    clouds.push({ sp, speed: 0.1 + rand() * 0.12, x0: sp.position.x });
  }

  // A few broad, soft clouds around the plot so the sky is not empty.
  for (const [x, y, z, sx, sy, o] of [
    [-48, 26, 6, 38, 11, 0.55],
    [12, 29, -56, 46, 12, 0.48],
    [-10, 17, -64, 30, 8, 0.5],
  ]) {
    const mat = new THREE.SpriteMaterial({
      map: SOFT_TEX,
      color: 0xffffff,
      transparent: true,
      opacity: o,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, y, z);
    sp.scale.set(sx, sy, 1);
    scene.add(sp);
  }


}

function buildLights() {
  scene.add(new THREE.HemisphereLight(0xd8f1ff, 0x7d9b52, 0.86));
  scene.add(new THREE.AmbientLight(0xffffff, 0.13));

  const sun = new THREE.DirectionalLight(0xfff2d0, 1.1);
  sun.position.set(-20, 32, 16);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const sm = LOW ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0x9ed8ff, 0.26);
  fill.position.set(22, 14, -18);
  scene.add(fill);

  // Camera-side fill keeps the facades bright instead of crushing them to black.
  const front = new THREE.DirectionalLight(0xfff7e6, 0.3);
  front.position.set(24, 20, 30);
  scene.add(front);

  const rim = new THREE.DirectionalLight(0xffd28a, 0.16);
  rim.position.set(12, 8, 26);
  scene.add(rim);
}

/* ------------------------------------------------------------------ */
/*  Organic island, beach and sea                                     */
/* ------------------------------------------------------------------ */

/* The island is a clock face when viewed from the game camera:
   12 o'clock is the back-right rim, 3 is the right rim, 6 is the
   front rim and 9 is the left rim. The radius wobble keeps every
   silhouette edge hand-shaped instead of circular. */
const ISLAND_R = 21.35;
const SEA_R = 31.5;

function islandEdgeRadius(a) {
  return (
    ISLAND_R +
    Math.sin(a * 3 + 0.82) * 0.96 +
    Math.sin(a * 5 - 1.14) * 0.54 +
    Math.sin(a * 8 + 0.31) * 0.3
  );
}

const DEG = Math.PI / 180;

function smooth01(t) {
  const v = clamp(t, 0, 1);
  return v * v * (3 - 2 * v);
}

// Screen-clock angle: 0 = 12 o'clock (back), 90 = 3 (right),
// 180 = 6 (front) and 270 = 9 (left).
function clockDeg(a) {
  return (((a * 180) / Math.PI + 45) % 360 + 360) % 360;
}

function angleDistDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function angleBand(deg, center, half, feather) {
  return 1 - smooth01((angleDistDeg(deg, center) - half) / feather);
}

// A sandy bay across the lower-left of the screen.
function coastSand(a) {
  return angleBand(clockDeg(a), 195, 55, 28);
}

// A grey, boulder-strewn coast on the lower-right under the fall.
function coastRock(a) {
  return angleBand(clockDeg(a), 104, 44, 22);
}

// 0 on the forest/back rim, 1 on the sandy/front rim.
function islandShore(a) {
  return clamp(coastSand(a) + coastRock(a) * 0.35, 0, 1);
}

// The beach fades in at its east end so it meets the rocky shelf flush.
function beachTaper(a) {
  return smooth01((a - 126 * DEG) / (20 * DEG));
}

// Height of the island rim, shared by the beach and the underside band
// so the sand never floats above a shadowed gap.
function islandRimY(a) {
  if (a >= 126 * DEG && a <= 260 * DEG) {
    const bw = 0.04 + coastSand(a) * beachTaper(a);
    return -0.14 - bw * 1.35;
  }
  if (a >= -18 * DEG && a <= 124 * DEG) return -0.1;
  return -0.12;
}

function islandGrassRadius(a) {
  return (
    islandEdgeRadius(a) -
    0.1 -
    coastSand(a) * 1.5 -
    coastRock(a) * 1.0
  );
}

function seaOuterRadius(a) {
  return SEA_R + Math.sin(a * 2 + 0.34) * 1.35 + Math.sin(a * 5 - 0.7) * 0.7;
}

// The ocean wraps the whole island now, from the front bay around the
// forested back rim, and continues to a hazy horizon.
const SEA_START = 0;
const SEA_END = Math.PI * 2;

function islandPoint(a, r, y) {
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
}

function normalisePlanarUv(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const w = bb.max.x - bb.min.x || 1;
  const d = bb.max.z - bb.min.z || 1;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - bb.min.x) / w, (pos.getZ(i) - bb.min.z) / d);
  }
  uv.needsUpdate = true;
}

function makeIslandCap() {
  const segments = 192;
  const shape = new THREE.Shape();
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = islandGrassRadius(a);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  normalisePlanarUv(geo);
  geo.computeVertexNormals();
  const cap = new THREE.Mesh(geo, M.grass);
  cap.position.y = 0.018;
  cap.receiveShadow = true;
  scene.add(cap);
}

/* A strip that follows the island contour. Rows let the beach curve
   down to the waterline instead of reading as a flat ribbon. */
function makeContourStrip(angleStart, angleEnd, segments, rows, material, cast = false) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const a = angleStart + ((angleEnd - angleStart) * i) / segments;
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      const r = row.r(a);
      const y = row.y(a);
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uvs.push(i / segments, j / (rows.length - 1));
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rows.length - 1; j++) {
      const a0 = i * rows.length + j;
      const a1 = a0 + 1;
      const b0 = (i + 1) * rows.length + j;
      const b1 = b0 + 1;
      indices.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = cast;
  scene.add(mesh);
  return mesh;
}

function buildBeach() {
  // The sand hugs the lower-left clock sector: 4 o'clock to 9 o'clock.
  const start = 126 * DEG;
  const end = 260 * DEG;
  const segments = 190;

  // The sand band fades in at its east end so it meets the rocky
  // shelf as a thin flat rim instead of a bright vertical wall.
  const taper = (a) => beachTaper(a);
  const bw = (a) => 0.04 + coastSand(a) * taper(a);
  const edge = (a) => islandEdgeRadius(a);

  // Dry sand slopes from the lawn down to the wet strip.
  makeContourStrip(start, end, segments, [
    { r: (a) => islandGrassRadius(a) + 0.03, y: () => 0.004 },
    { r: (a) => edge(a) - 0.12 - bw(a) * 1.62, y: (a) => -0.05 - bw(a) * 0.375 },
    { r: (a) => edge(a) - 0.12 - bw(a) * 0.86, y: (a) => -0.09 - bw(a) * 0.95 },
  ], M.sand);

  // Wet sand at the waterline.
  makeContourStrip(start, end, segments, [
    { r: (a) => edge(a) - 0.12 - bw(a) * 0.86, y: (a) => -0.09 - bw(a) * 0.95 },
    { r: (a) => edge(a) - bw(a) * 0.34, y: (a) => -0.12 - bw(a) * 1.18 },
    { r: (a) => edge(a) + 0.06, y: (a) => -0.14 - bw(a) * 1.35 },
  ], M.wetSand);
}

function buildRockyCoast() {
  // A flat rocky shelf carries the fall and the lower river at lawn
  // height, then drops as a short cliff into the bay.
  const start = -18 * DEG;
  const end = 124 * DEG;
  const segments = 140;
  const edge = (a) => islandEdgeRadius(a);
  // Plain stone for the shelf top: the streaked cliff texture reads as
  // wooden planks when it is stretched around a flat contour.
  const shelfMat = new THREE.MeshStandardMaterial({
    color: 0x877e6f,
    roughness: 1,
    flatShading: true,
  });
  const cliffTex = ROCK_FACE_TEX.clone();
  cliffTex.needsUpdate = true;
  cliffTex.repeat.set(16, 1);
  const cliffMat = new THREE.MeshStandardMaterial({
    map: cliffTex,
    color: 0x776e5f,
    roughness: 1,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  makeContourStrip(start, end, segments, [
    { r: (a) => islandGrassRadius(a) + 0.03, y: () => 0.004 },
    { r: (a) => edge(a) - 0.75, y: () => -0.02 },
    { r: (a) => edge(a) - 0.06, y: () => -0.1 },
  ], shelfMat, true);
  makeContourStrip(start, end, segments, [
    { r: (a) => edge(a) - 0.06, y: () => -0.1 },
    { r: (a) => edge(a) + 0.02, y: () => -0.72 },
    { r: (a) => edge(a) + 0.14, y: () => -1.62 },
  ], cliffMat, true);

  // Gravel and small stones break up the flat shelf.
  for (let i = 0; i < 26; i++) {
    const a = -0.28 + rand() * 2.4;
    const grass = islandGrassRadius(a);
    const rim = edge(a);
    const r = grass + 0.3 + rand() * Math.max(0.2, rim - grass - 0.55);
    const s = 0.1 + rand() * 0.2;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      i % 3 ? M.rock : M.stoneDark
    );
    rock.position.set(Math.cos(a) * r, -0.02 + s * 0.35, Math.sin(a) * r);
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.scale.y = 0.45 + rand() * 0.2;
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // Larger boulders make the rocky coast read as a broken shore.
  for (let i = 0; i < 18; i++) {
    const a = -0.2 + rand() * 2.28;
    if (Math.abs(a - 0.94) < 0.16) continue;
    const grass = islandGrassRadius(a);
    const rim = edge(a);
    const r = grass + 0.6 + rand() * Math.max(0.2, rim - grass - 0.9);
    const s = 0.34 + rand() * 0.55;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      i % 3 ? M.stoneDark : M.rock
    );
    rock.position.set(Math.cos(a) * r, -0.06 + s * 0.3, Math.sin(a) * r);
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.scale.set(1 + rand() * 0.25, 0.6 + rand() * 0.3, 1 + rand() * 0.25);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }
}

function buildIslandSide() {
  const segments = 176;
  const topY = (a) => islandRimY(a);
  const earth = M.earthSide.clone();
  earth.side = THREE.DoubleSide;
  const rock = new THREE.MeshStandardMaterial({
    color: 0x827a6c,
    roughness: 1,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const deep = new THREE.MeshStandardMaterial({
    color: 0x655e53,
    roughness: 1,
    flatShading: true,
    side: THREE.DoubleSide,
  });

  // Soil band.
  makeContourStrip(0, Math.PI * 2, segments, [
    { r: (a) => islandEdgeRadius(a) + 0.02, y: topY },
    { r: (a) => islandEdgeRadius(a) * 0.94, y: () => -2.9 },
    { r: (a) => islandEdgeRadius(a) * 0.81, y: () => -4.7 },
  ], earth, true);

  // Rock shoulder.
  makeContourStrip(0, Math.PI * 2, segments, [
    { r: (a) => islandEdgeRadius(a) * 0.81, y: () => -4.7 },
    { r: (a) => islandEdgeRadius(a) * 0.66, y: () => -6.25 },
  ], rock, true);

  // Tapered floating tip.
  makeContourStrip(0, Math.PI * 2, segments, [
    { r: (a) => islandEdgeRadius(a) * 0.66, y: () => -6.25 },
    { r: () => 9.4, y: () => -7.55 },
  ], deep, true);

  const tipGeo = new THREE.CylinderGeometry(9.6, 0.9, 2.9, 9, 3);
  tipGeo.rotateY(Math.PI / 9);
  const tip = new THREE.Mesh(tipGeo, rock);
  tip.position.y = -8.92;
  tip.castShadow = true;
  tip.receiveShadow = true;
  scene.add(tip);
}

function buildSea() {
  const segments = 200;
  const rings = 16;
  const positions = [];
  const colours = [];
  const uvs = [];
  const indices = [];
  const shore = new THREE.Color(0x7cebe8);
  const shallow = new THREE.Color(0x2ed3e2);
  const mid = new THREE.Color(0x12bce0);
  const deep = new THREE.Color(0x0a9dd4);
  const abyss = new THREE.Color(0x0a80b8);
  const mixed = new THREE.Color();

  const innerR = (a) => islandEdgeRadius(a) + 0.04;
  const widthR = (a) => seaOuterRadius(a) - innerR(a);

  for (let i = 0; i <= segments; i++) {
    const a = SEA_START + ((SEA_END - SEA_START) * i) / segments;
    const inner = innerR(a);
    const width = widthR(a);
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const r = inner + width * Math.pow(t, 0.88);
      const y = -1.62;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      positions.push(x, y, z);
      uvs.push(x / 8, z / 8);
      const d = r - inner;
      if (d < 0.9) mixed.copy(shore).lerp(shallow, d / 0.9);
      else if (d < 3.0) mixed.copy(shallow).lerp(mid, (d - 0.9) / 2.1);
      else if (d < 5.2) mixed.copy(mid).lerp(deep, (d - 3.0) / 2.2);
      else if (d < 8.2) mixed.copy(deep).lerp(abyss, (d - 5.2) / 3.0);
      else mixed.copy(abyss);

      // The surface runs all the way around the island, so it keeps its
      // deep-water hue instead of fading into the sky at the old bay ends.
      colours.push(mixed.r, mixed.g, mixed.b);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rings; j++) {
      const a0 = i * (rings + 1) + j;
      const a1 = a0 + 1;
      const b0 = (i + 1) * (rings + 1) + j;
      const b1 = b0 + 1;
      indices.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const sea = new THREE.Mesh(geo, M.ocean);
  sea.receiveShadow = true;
  sea.renderOrder = -1;
  scene.add(sea);

  // A short blue wall gives the bay weight at the front edge.
  // The bay is now wider than the frame, so no visible rim wall is needed.

  // Foam collar hugging the waterline.
  const collar = M.seaFoam.clone();
  collar.opacity = 0.42;
  makeContourStrip(0, Math.PI * 2, 220, [
    { r: (a) => islandEdgeRadius(a) + 0.07, y: () => -1.592 },
    { r: (a) => islandEdgeRadius(a) + 0.84, y: () => -1.588 },
    { r: (a) => islandEdgeRadius(a) + 0.36, y: () => -1.58 },
  ], collar);

  // A crisp white line right at the waterline.
  const line = M.seaFoam.clone();
  line.opacity = 0.55;
  makeContourStrip(0, Math.PI * 2, 220, [
    { r: (a) => islandEdgeRadius(a) + 0.03, y: () => -1.586 },
    { r: (a) => islandEdgeRadius(a) + 0.34, y: () => -1.586 },
  ], line);

  // The detailed near-water ring sits inside a much larger ocean plane
  // that carries the view out to the horizon on every side.
  const farGeo = new THREE.CircleGeometry(190, 96);
  farGeo.rotateX(-Math.PI / 2);
  const farPos = farGeo.attributes.position;
  const farUv = farGeo.attributes.uv;
  for (let i = 0; i < farPos.count; i++) {
    farUv.setXY(i, farPos.getX(i) / 8, farPos.getZ(i) / 8);
  }
  farUv.needsUpdate = true;
  const farSea = new THREE.Mesh(
    farGeo,
    new THREE.MeshBasicMaterial({
      map: OCEAN_TEX,
      color: 0x0a80b8,
      fog: true,
      toneMapped: false,
    })
  );
  farSea.position.y = -1.635;
  farSea.renderOrder = -2;
  scene.add(farSea);

  // Broken wave crests further out.
  const waveArcs = [
    [22.4, 0.72, 1.1, 0.09],
    [23.0, 1.5, 2.28, 0.09],
    [24.6, 1.72, 2.7, 0.08],
    [26.3, 1.94, 3.06, 0.07],
    [28.0, 1.42, 2.9, 0.08],
    [29.8, 1.7, 3.3, 0.07],
    [31.2, 1.9, 3.8, 0.06],
    [23.4, 3.22, 3.9, 0.08],
    [25.4, 3.12, 3.9, 0.07],
    [28.9, 3.3, 3.92, 0.07],
    [24.1, 0.72, 1.36, 0.08],
    [23.7, 2.15, 3.05, 0.08],
    [25.9, 2.28, 3.12, 0.07],
    [28.3, 2.4, 3.18, 0.06],
    [22.7, 3.16, 3.6, 0.07],
    [26.2, 2.0, 2.9, 0.06],
    [26.9, 0.75, 1.15, 0.06],
  ];
  for (const [radius, from, to, width] of waveArcs) {
    const mat = M.seaFoam.clone();
    mat.opacity = 0.44;
    makeContourStrip(from, to, 56, [
      { r: () => radius, y: () => -1.601 },
      { r: () => radius + width, y: () => -1.601 },
      { r: () => radius + width * 0.35, y: () => -1.596 },
    ], mat);
  }

  // Broad, faint swell bands keep the open sea from going flat toward
  // the top of the frame.
  for (const [radius, from, to, width, alpha] of [
    [37.5, 0.35, 1.85, 0.9, 0.1],
    [42.6, 2.05, 3.3, 1.15, 0.09],
    [48.4, 3.6, 4.95, 0.8, 0.08],
    [55.2, 0.6, 1.8, 1.3, 0.08],
    [62.8, 2.7, 4.15, 1.0, 0.07],
    [71.5, 4.7, 6.1, 1.5, 0.07],
    [81.0, 0.95, 2.2, 1.1, 0.06],
  ]) {
    const mat = M.seaFoam.clone();
    mat.opacity = alpha;
    makeContourStrip(from, to, 46, [
      { r: () => radius, y: () => -1.626 },
      { r: () => radius + width, y: () => -1.626 },
      { r: () => radius + width * 0.4, y: () => -1.62 },
    ], mat);
  }

  // A few bright wave dabs so the surface has depth without a shader.
  for (let i = 0; i < 26; i++) {
    const a = SEA_START + 0.1 + rand() * (SEA_END - SEA_START - 0.2);
    const inner = innerR(a);
    const width = widthR(a);
    if (width < 4) continue;
    const r = inner + 1.6 + rand() * (width - 2.6);
    const foam = new THREE.Mesh(new THREE.CircleGeometry(0.3 + rand() * 0.5, 8), M.seaFoam);
    foam.rotation.x = -Math.PI / 2;
    foam.rotation.z = rand() * Math.PI;
    foam.scale.y = 0.3 + rand() * 0.25;
    foam.position.set(Math.cos(a) * r, -1.575, Math.sin(a) * r);
    foam.material = foam.material.clone();
    foam.material.opacity = 0.2 + rand() * 0.22;
    scene.add(foam);
  }
}

function buildShoreRocks() {
  const drop = (x, z, s, y, mat) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat);
    rock.position.set(x, y, z);
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.scale.y = 0.66 + rand() * 0.38;
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  };

  // A spare line of boulders down the rocky right coast. The cliff
  // itself is the star here, so these stay small.
  for (let i = 0; i < 14; i++) {
    const a = 0.06 + rand() * 1.45;
    const base = islandEdgeRadius(a);
    const r = base + (rand() - 0.5) * 2.2;
    const s = 0.28 + rand() * 0.62;
    const y = r > base ? -1.42 + rand() * 0.35 : -0.18 + rand() * 0.14;
    if (Math.hypot(Math.cos(a) * r - 20.4, Math.sin(a) * r - 4.6) < 3.4) continue;
    drop(Math.cos(a) * r, Math.sin(a) * r, s, y, i % 2 ? M.rock : M.stoneDark);
  }

  // A broken line of rocks along the shelf lip.
  for (let i = 0; i < 26; i++) {
    const a = 0.02 + rand() * 1.95;
    if (angleDistDeg(clockDeg(a), 55) < 9) continue;
    if (angleDistDeg(clockDeg(a), 111) < 10) continue;
    const base = islandEdgeRadius(a);
    const r = base + (rand() - 0.5) * 0.55;
    const s = 0.22 + rand() * 0.45;
    drop(Math.cos(a) * r, Math.sin(a) * r, s, -0.24 + rand() * 0.16, i % 2 ? M.rock : M.stoneDark);
  }

  // Wet stones at the left end of the beach, where sand turns to rock.
  for (let i = 0; i < 8; i++) {
    const a = 4.35 + rand() * 0.5;
    const base = islandEdgeRadius(a);
    const r = base + (rand() - 0.5) * 1.9;
    const s = 0.22 + rand() * 0.52;
    drop(Math.cos(a) * r, Math.sin(a) * r, s, r > base ? -1.4 + rand() * 0.3 : -0.45 + rand() * 0.4, M.stoneDark);
  }

  // Boulders break up the long sandy waterline.
  for (let i = 0; i < 20; i++) {
    const a = 1.05 + rand() * 2.2;
    if (Math.abs(a - 2.51) < 0.14) continue;
    const base = islandEdgeRadius(a);
    const r = base + 0.35 + rand() * 1.3;
    const s = 0.3 + rand() * 0.55;
    drop(
      Math.cos(a) * r,
      Math.sin(a) * r,
      s,
      -1.5 + rand() * 0.18,
      i % 2 ? M.stoneDark : M.rock
    );
  }

  // A few dry rocks sitting on the sand itself.
  for (let i = 0; i < 10; i++) {
    const a = 1.15 + rand() * 1.95;
    if (Math.abs(a - 2.51) < 0.2) continue;
    const base = islandEdgeRadius(a);
    const r = base - 1.0 - rand() * 1.5;
    const s = 0.22 + rand() * 0.4;
    drop(
      Math.cos(a) * r,
      Math.sin(a) * r,
      s,
      -0.06 + rand() * 0.06,
      i % 2 ? M.rock : M.stoneDark
    );
  }

  // Small rocky islets dotting the bay.
  for (const [x, z, s, mat] of [
    [-22.4, 15.8, 1.35, M.stoneDark],
    [-18.6, 21.4, 1.05, M.rock],
    [-7.8, 25.6, 1.15, M.stoneDark],
    [4.2, 27.6, 0.85, M.rock],
    [-27.2, 6.4, 1.2, M.stoneDeep],
    [9.6, 24.0, 0.7, M.rock],
  ]) {
    drop(x, z, s, -1.48, mat);
    for (let i = 0; i < 2; i++) {
      drop(x + (rand() - 0.5) * 2.0, z + (rand() - 0.5) * 2.0, s * (0.35 + rand() * 0.3), -1.5, M.stoneDark);
    }
    // Foam collar so each islet sits in the water rather than on top of it.
    for (const [pad, op] of [[0.5, 0.3], [1.05, 0.16]]) {
      const mat = M.seaFoam.clone();
      mat.opacity = op;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(s * 0.9 + pad, s * 0.9 + pad + 0.22, 26),
        mat
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, -1.629, z);
      scene.add(ring);
    }
  }

  // A rocky point softens the sand-to-cliff seam on the front-left.
  for (const [x, z, s, y] of [
    [-12.4, 17.3, 0.62, -0.26],
    [-11.3, 16.4, 0.5, -0.14],
    [-13.3, 16.1, 0.44, -0.22],
    [-10.6, 15.6, 0.34, -0.1],
    [-11.9, 18.0, 0.9, -1.16],
    [-12.9, 17.6, 0.72, -0.94],
    [-11.1, 17.3, 0.56, -0.62],
  ]) {
    drop(x, z, s, y, M.stoneDark);
  }

  // Small pebbles and wet stones between the clusters.
  for (let i = 0; i < 16; i++) {
    const a = 0.1 + rand() * 2.5;
    const base = islandEdgeRadius(a);
    const r = base + (rand() > 0.4 ? 0.1 + rand() * 1.2 : -0.7 + rand() * 0.5);
    const s = 0.1 + rand() * 0.2;
    drop(Math.cos(a) * r, Math.sin(a) * r, s, r > base ? -1.5 + rand() * 0.16 : -0.1 + rand() * 0.08, M.stoneDark);
  }
}

function buildTerrain() {
  makeIslandCap();
  buildBeach();
  buildRockyCoast();
  buildIslandSide();
  buildSea();
  buildShoreRocks();
}

/* ------------------------------------------------------------------ */
/*  Paths and ground dressing                                          */
/* ------------------------------------------------------------------ */

function pathStrip(x1, z1, x2, z2, width = 1.9) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  const centerX = (x1 + x2) / 2;
  const centerZ = (z1 + z2) / 2;
  const edge = new THREE.Mesh(
    new RoundedBoxGeometry(width + 0.3, 0.045, len + 0.16, 2, 0.09),
    M.dirtDark
  );
  edge.position.set(centerX, 0.026, centerZ);
  edge.rotation.y = angle;
  edge.receiveShadow = true;
  scene.add(edge);
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, 0.06, len, 2, 0.08), M.path);
  mesh.position.set(centerX, 0.045, centerZ);
  mesh.rotation.y = angle;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function pathJoint(x, z, w) {
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(w / 2 + 0.15, w / 2 + 0.15, 0.045, 22),
    M.dirtDark
  );
  rim.position.set(x, 0.026, z);
  rim.receiveShadow = true;
  scene.add(rim);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.06, 22), M.path);
  top.position.set(x, 0.045, z);
  top.receiveShadow = true;
  scene.add(top);
}

function buildPaths() {
  for (const [x1, z1, x2, z2, w] of PATH_LINES) {
    pathStrip(x1, z1, x2, z2, w);
  }

  // Round off the bends so the lanes read as one continuous road, and
  // give every building a small landing pad at its door.
  PATH_LANES.forEach((lane, laneIndex) => {
    for (let i = 1; i < lane.pts.length - 1; i++) {
      pathJoint(lane.pts[i][0], lane.pts[i][1], lane.w);
    }
    const last = lane.pts[lane.pts.length - 1];
    if (laneIndex > 0) pathJoint(last[0], last[1], lane.w + 0.2);
  });
}

function buildPlaza() {
  const disc = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_RADIUS, 72), M.path);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.052;
  disc.receiveShadow = true;
  scene.add(disc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(PLAZA_RADIUS - 0.5, PLAZA_RADIUS, 80),
    M.stone
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.064;
  ring.receiveShadow = true;
  scene.add(ring);

  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(4.55, 4.68, 72),
    M.stoneDark
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.06;
  innerRing.receiveShadow = true;
  scene.add(innerRing);

  // Flagstones around the rim.
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + Math.PI / 16;
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.075, 6), M.stone);
    stone.position.set(Math.cos(angle) * 5.35, 0.07, Math.sin(angle) * 5.35);
    stone.rotation.y = angle;
    stone.receiveShadow = true;
    scene.add(stone);
  }

  // Three broad steps down to the south path.
  for (let i = 0; i < 3; i++) {
    rbox(scene, 3.5 - i * 0.18, 0.1, 0.55, M.stone, 0, 0.05 + i * 0.05, 5.85 + i * 0.5, {
      r: 0.03,
      outline: true,
      outlineScale: 1.03,
    });
  }

  // Planters flank the steps.
  for (const x of [-2.35, 2.35]) {
    cyl(scene, 0.42, 0.5, 0.52, 10, M.stone, x, 0.26, 6.35, {
      outline: true,
      outlineScale: 1.04,
    });
    cyl(scene, 0.36, 0.36, 0.08, 10, M.dirtDark, x, 0.54, 6.35, { cast: false });
    for (let i = 0; i < 5; i++) {
      const fx = x + (rand() - 0.5) * 0.45;
      const fz = 6.35 + (rand() - 0.5) * 0.45;
      cyl(scene, 0.016, 0.02, 0.24, 4, M.leafDark, fx, 0.65, fz, { cast: false });
      sphere(scene, 0.08, 6, i % 2 ? M.gold : M.roofRed, fx, 0.78, fz, {
        cast: false,
        receive: false,
      });
    }
  }

  // Four pennants frame the courtyard.
  makeBannerPole(-4.6, -4.6, 0x4cb8ff, 0.4);
  makeBannerPole(4.6, -4.6, 0xffc83a, 1.7);
  makeBannerPole(-4.6, 4.6, 0xd94a3a, 2.6);
  makeBannerPole(4.6, 4.6, 0x7bc043, 3.3);
}

function makeBannerPole(x, z, color, phase) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  cyl(g, 0.07, 0.1, 3.35, 6, M.woodDark, 0, 1.68, 0, {
    cast: true,
    outline: true,
    outlineScale: 1.08,
  });
  sphere(g, 0.14, 8, M.gold, 0, 3.4, 0, { cast: true });
  const geo = new THREE.PlaneGeometry(0.92, 0.5, 5, 2);
  geo.translate(0.46, 0, 0);
  const cloth = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide })
  );
  cloth.position.set(0.04, 2.92, 0);
  cloth.castShadow = true;
  g.add(cloth);
  flags.push({ cloth, base: geo.attributes.position.array.slice(), phase });
}

function buildFlowerClusters() {
  const frand = mulberry32(77123);
  const palette = [0xffd85c, 0xff9fc4, 0xfff4e2, 0xbf9cff, 0xff806e];
  const clusters = [
    [-4.2, -7.4, 1.05],
    [4.3, -5.6, 0.9],
    [8.2, -4.4, 0.95],
    [2.1, 9.8, 0.9],
    [-10.8, 6.4, 0.95],
    [-13.6, -5.4, 1.15],
    [12.2, 4.0, 0.9],
    [6.6, 12.4, 0.95],
    [-2.8, 11.6, 0.85],
    [4.0, 13.6, 0.8],
    [-15.2, 5.0, 0.9],
  ];

  const data = [];
  clusters.forEach(([cx, cz, spread], ci) => {
    const color = palette[ci % palette.length];
    const count = 13 + Math.floor(frand() * 7);
    for (let i = 0; i < count; i++) {
      const a = frand() * Math.PI * 2;
      const rad = Math.sqrt(frand()) * spread;
      const x = cx + Math.cos(a) * rad;
      const z = cz + Math.sin(a) * rad;
      if (isOccupied(x, z, 0.45) || isOnPath(x, z, 0.3)) continue;
      if (distanceToPolylineV2(x, z, LOWER_RIVER_PATH) < 2.6) continue;
      if (distanceToPolylineV2(x, z, RIVER_PATH) < 2.4) continue;
      data.push({
        x,
        z,
        h: 0.12 + frand() * 0.16,
        s: 0.95 + frand() * 0.6,
        color: frand() < 0.16 ? 0xfff4e2 : color,
        lean: (frand() - 0.5) * 0.16,
      });
    }
  });
  if (!data.length) return;

  const stemGeo = new THREE.CylinderGeometry(0.01, 0.015, 1, 4);
  const stems = new THREE.InstancedMesh(stemGeo, M.leafDark, data.length);
  const headGeo = new THREE.SphereGeometry(0.1, 6, 4);
  const heads = new THREE.InstancedMesh(
    headGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, flatShading: true }),
    data.length
  );
  const dummy = new THREE.Object3D();
  data.forEach((f, i) => {
    dummy.position.set(f.x, f.h / 2, f.z);
    dummy.rotation.set(0, 0, f.lean);
    dummy.scale.set(1, f.h, 1);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);

    dummy.position.set(f.x, f.h + 0.03, f.z);
    dummy.rotation.set(frand() * 0.4, frand() * 6.28, frand() * 0.4);
    dummy.scale.set(f.s, f.s * 0.72, f.s);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    heads.setColorAt(i, new THREE.Color(f.color));
  });
  stems.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  stems.castShadow = false;
  heads.castShadow = false;
  scene.add(stems, heads);
}

function buildGroveUnderstory() {
  const frand = mulberry32(51507);
  const fernSpots = [
    [-18.0, -3.2],
    [-16.4, 0.1],
    [-19.0, 1.8],
    [-17.2, 4.1],
    [-15.6, 5.6],
    [-14.0, -2.1],
    [-14.6, 2.6],
    [-13.9, 6.4],
    [-18.6, -0.7],
    [-16.8, -4.5],
    [-19.8, 4.0],
    [-15.1, 1.4],
    [-13.6, -4.3],
    [-12.9, 0.9],
    [-19.4, 6.3],
    [-14.7, 7.5],
  ];
  const frondGeo = new THREE.SphereGeometry(0.42, 5, 3);
  const fronds = new THREE.InstancedMesh(frondGeo, M.leafDark, fernSpots.length * 6);
  const dummy = new THREE.Object3D();
  let fi = 0;
  for (const [x, z] of fernSpots) {
    const scale = 0.75 + frand() * 0.6;
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2 + frand() * 0.4;
      dummy.position.set(
        x + Math.cos(a) * 0.22 * scale,
        0.13 + frand() * 0.05,
        z + Math.sin(a) * 0.22 * scale
      );
      dummy.rotation.set(0, -a, 0);
      dummy.scale.set(0.62 * scale, 0.16 * scale, 0.3 * scale);
      dummy.updateMatrix();
      fronds.setMatrixAt(fi++, dummy.matrix);
    }
  }
  fronds.instanceMatrix.needsUpdate = true;
  fronds.receiveShadow = true;
  scene.add(fronds);

  const bushSpots = [
    [-18.5, 2.4, 0.55],
    [-17.0, -1.8, 0.42],
    [-15.0, 3.4, 0.48],
    [-13.7, 5.2, 0.38],
    [-19.2, 5.6, 0.44],
    [-16.2, -5.4, 0.36],
    [-14.2, -1.2, 0.4],
    [-20.2, 0.6, 0.34],
    [-12.9, 3.3, 0.3],
  ];
  const bushGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const bushes = new THREE.InstancedMesh(
    bushGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
    bushSpots.length
  );
  const bushColors = [0x337a2c, 0x448f34, 0x2a6b25, 0x5aa643];
  bushSpots.forEach(([x, z, s], i) => {
    dummy.position.set(x, s * 0.48, z);
    dummy.rotation.set(frand() * 0.3, frand() * 6.28, frand() * 0.2);
    dummy.scale.set(s * 1.35, s * 0.72, s * 1.1);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
    bushes.setColorAt(i, new THREE.Color(bushColors[i % bushColors.length]));
  });
  bushes.instanceMatrix.needsUpdate = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  scene.add(bushes);

  // A fallen log with a mossy cap makes the grove feel lived in.
  const log = cyl(scene, 0.19, 0.27, 3.0, 7, M.trunk, -17.4, 0.29, 6.0, {
    rz: Math.PI / 2,
    ry: 0.35,
    cast: true,
    receive: true,
  });
  log.rotation.z = 0.06;
  for (let i = 0; i < 5; i++) {
    const moss = sphere(
      scene,
      0.16 + frand() * 0.16,
      6,
      i % 2 ? M.moss : M.mossLight,
      -18.5 + i * 0.55,
      0.48,
      5.95 + Math.sin(i) * 0.14,
      { cast: false }
    );
    moss.scale.set(1.2, 0.34, 0.9);
  }
}

function buildGroundDressing() {
  const dummy = new THREE.Object3D();

  // Grass tufts.
  const tuftGeo = new THREE.ConeGeometry(0.075, 0.26, 4);
  const tufts = new THREE.InstancedMesh(tuftGeo, M.leafDark, 180);
  tufts.castShadow = false;
  tufts.receiveShadow = false;
  for (let i = 0; i < 180; i++) {
    const x = -14 + rand() * 28;
    const z = -14 + rand() * 28;
    const skip = isOccupied(x, z, 0.6) || isOnPath(x, z, 0.55);
    dummy.position.set(skip ? 0 : x, skip ? -60 : 0.11, skip ? 0 : z);
    dummy.rotation.y = rand() * Math.PI;
    dummy.scale.setScalar(skip ? 0.001 : 0.7 + rand() * 0.7);
    dummy.updateMatrix();
    tufts.setMatrixAt(i, dummy.matrix);
  }
  tufts.instanceMatrix.needsUpdate = true;
  scene.add(tufts);

  // Flowers.
  const flowerGeo = new THREE.SphereGeometry(0.075, 6, 4);
  const flowers = new THREE.InstancedMesh(
    flowerGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
    48
  );
  for (let i = 0; i < 48; i++) {
    const x = -14 + rand() * 28;
    const z = -14 + rand() * 28;
    const skip = isOccupied(x, z, 0.45) || isOnPath(x, z, 0.4);
    dummy.position.set(skip ? 0 : x, skip ? -60 : 0.13, skip ? 0 : z);
    dummy.scale.setScalar(skip ? 0.001 : 0.7 + rand() * 0.7);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    flowers.setColorAt(i, new THREE.Color().setHSL(0.11 + rand() * 0.08, 0.85, 0.78));
  }
  flowers.instanceMatrix.needsUpdate = true;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  scene.add(flowers);

  // Rocks.
  for (let i = 0; i < 12; i++) {
    const x = -13.5 + rand() * 27;
    const z = -13.5 + rand() * 27;
    if (isOccupied(x, z, 0.8) || isOnPath(x, z, 0.6)) continue;
    const s = 0.5 + rand() * 0.75;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), M.rock);
    rock.position.set(x, s * 0.55, z);
    rock.rotation.set(rand(), rand(), rand());
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // Mushrooms near the west bank.
  for (let i = 0; i < 3; i++) {
    const mx = -6.2 + i * 0.5;
    const mz = 10.8 + (i % 2) * 0.35;
    cyl(scene, 0.07, 0.09, 0.28, 7, M.cream, mx, 0.14, mz, { cast: true });
    const cap = sphere(scene, 0.22, 10, M.roofRed, mx, 0.33, mz, { cast: true });
    cap.scale.y = 0.52;
  }
}

/* ------------------------------------------------------------------ */
/*  Shared waterfall animation state                                   */
/* ------------------------------------------------------------------ */

const waterfallMists = [];
const waterfallMats = [];

/* ------------------------------------------------------------------ */
/*  Wilds v2: elevated pool, east river, waterfall, forest            */
/* ------------------------------------------------------------------ */

/* One tall, round mesa carries the pool. The fall drops from the lip
   of that pool on the camera-facing side, then the lower river runs
   south across the meadow and under the bridge toward the bay. */
const FALL_MESA = { x: 18.4, z: -1.8, top: 4.6, topR: 4.35, baseR: 4.85 };
const FALL_ROT = -Math.PI / 4;
const FALL_DIR = { x: -Math.SQRT1_2, z: Math.SQRT1_2 };
const RIVER_POOL = { x: 17.0, z: -0.4, r: 2.35, y: FALL_MESA.top };
const RIVER_LIP = {
  x: RIVER_POOL.x + FALL_DIR.x * (RIVER_POOL.r + 0.02),
  z: RIVER_POOL.z + FALL_DIR.z * (RIVER_POOL.r + 0.02),
  y: FALL_MESA.top,
};
const RIVER_POINTS = [
  [15.85, 0.55, FALL_MESA.top + 0.13],
  [15.62, 0.86, FALL_MESA.top + 0.13],
  [RIVER_LIP.x, RIVER_LIP.z, FALL_MESA.top + 0.13],
];
const RIVER_PATH = RIVER_POINTS.map(([x, z]) => [x, z]);
const FALL_BOTTOM_Y = 0.0;

// The lower river runs across the flat meadow, then spills over the
// rim into the bay. The last point is the sea below the lip.
const LOWER_RIVER_POINTS = [
  [15.0, 1.7, 0.055],
  [15.5, 4.4, 0.058],
  [15.3, 6.8, 0.06],
  [14.5, 9.2, 0.062],
  [13.2, 11.6, 0.064],
  [11.7, 13.9, 0.06],
  [10.0, 16.1, 0.055],
  [8.6, 17.9, -0.05],
  [8.0, 18.5, -1.58],
];
const LOWER_RIVER_PATH = LOWER_RIVER_POINTS.map(([x, z]) => [x, z]);
const LOWER_RIVER_LIP = 7;

function lowerRiverAt(t) {
  const progress = clamp(t, 0, 0.9999) * (LOWER_RIVER_POINTS.length - 1);
  const i = Math.floor(progress);
  const f = progress - i;
  const a = LOWER_RIVER_POINTS[i];
  const b = LOWER_RIVER_POINTS[Math.min(LOWER_RIVER_POINTS.length - 1, i + 1)];
  return {
    x: a[0] + (b[0] - a[0]) * f,
    z: a[1] + (b[1] - a[1]) * f,
    y: a[2] + (b[2] - a[2]) * f,
  };
}

function distanceToPolylineV2(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

function makeWaterRibbon3D(points, width, mat, drop = 0) {
  const verts = [];
  const uvs = [];
  const indices = [];
  let run = 0;

  for (let i = 0; i < points.length; i++) {
    const [x, z, y] = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz;
    const nz = tx;
    const wobble = 1 + Math.sin(i * 1.7) * 0.07;
    const w = (width * wobble) / 2;
    verts.push(x + nx * w, y + drop, z + nz * w);
    verts.push(x - nx * w, y + drop, z - nz * w);
    if (i > 0) {
      run += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    }
    uvs.push(0, run / 5, 1, run / 5);
    if (i < points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function riverAt(t) {
  const progress = clamp(t, 0, 0.9999) * (RIVER_POINTS.length - 1);
  const i = Math.floor(progress);
  const f = progress - i;
  const a = RIVER_POINTS[i];
  const b = RIVER_POINTS[Math.min(RIVER_POINTS.length - 1, i + 1)];
  return {
    x: a[0] + (b[0] - a[0]) * f,
    z: a[1] + (b[1] - a[1]) * f,
    y: a[2] + (b[2] - a[2]) * f,
  };
}

function forestAllowedV2(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  const edge = islandGrassRadius(a);
  if (r > edge - 0.35 || r < 11.9) return false;

  // The sandy bay and the waterfall notch stay open.
  if (coastSand(a) > 0.22) return false;

  if (isOccupied(x, z, 1.35)) return false;
  // Keep the fall, the lower river, the Clan Castle frontage and the whole
  // sandy forecourt readable from the home camera; the forest frames this
  // corridor instead of filling it.
  if (x > -2.0 && z > 7.0) return false;
  if (x > 6.0 && x < 18.5 && z > 6.5 && z < 19.0) return false;
  if (x > 9.0 && x < 17.4 && z > 2.4 && z < 11.6) return false;
  if (distanceToPolylineV2(x, z, RIVER_PATH) < 2.5) return false;
  if (distanceToPolylineV2(x, z, LOWER_RIVER_PATH) < 2.6) return false;
  if (Math.hypot(x - FALL_MESA.x, z - FALL_MESA.z) < 6.0) return false;
  if (Math.hypot(x - 20.2, z - 4.6) < 3.4) return false;
  if (Math.hypot(x - 10.5, z - 13.0) < 2.1) return false;
  if (Math.hypot(x + 16.6, z - 4.6) < 3.0) return false;
  if (isOnPath(x, z, 1.0)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  The high pool, the rim stream and the waterfall cape               */
/* ------------------------------------------------------------------ */

function buildPoolAndRiver() {
  const mx = FALL_MESA.x;
  const mz = FALL_MESA.z;
  const topY = FALL_MESA.top;
  const topR = FALL_MESA.topR;
  const baseR = FALL_MESA.baseR;
  const cx = RIVER_POOL.x;
  const cz = RIVER_POOL.z;
  const poolR = RIVER_POOL.r;

  const mesaTex = ROCK_FACE_TEX.clone();
  mesaTex.needsUpdate = true;
  mesaTex.repeat.set(2, 1);
  const rockMat = new THREE.MeshStandardMaterial({
    map: mesaTex,
    color: 0x8a7156,
    roughness: 1,
    flatShading: true,
  });

  // A tall cliff shelf carries the high pool and gives the fall its drop.
  const mesaGeo = new THREE.CylinderGeometry(topR, baseR, topY, 20, 3);
  const mp = mesaGeo.attributes.position;
  for (let i = 0; i < mp.count; i++) {
    const vx = mp.getX(i);
    const vy = mp.getY(i);
    const vz = mp.getZ(i);
    if (Math.hypot(vx, vz) > 0.4) {
      const jitter = 0.9 + Math.abs(Math.sin(i * 8.73 + 1.7)) * 0.18;
      mp.setX(i, vx * jitter);
      mp.setZ(i, vz * jitter);
    }
    if (vy < topY / 2 - 0.12) {
      mp.setX(i, mp.getX(i) + Math.sin(i * 1.91) * 0.14);
      mp.setZ(i, mp.getZ(i) + Math.cos(i * 2.27) * 0.14);
    }
  }
  mesaGeo.computeVertexNormals();
  const mesa = new THREE.Mesh(mesaGeo, rockMat);
  mesa.position.set(mx, topY / 2, mz);
  mesa.castShadow = true;
  mesa.receiveShadow = true;
  scene.add(mesa);

  // A darker shoulder under the shelf reads as layered coastal rock.
  const shoulderMat = new THREE.MeshStandardMaterial({
    color: 0x6c5944,
    roughness: 1,
    flatShading: true,
  });
  const shoulder = new THREE.Mesh(
    new THREE.CylinderGeometry(topR * 0.98, baseR * 1.08, 1.35, 18, 1),
    shoulderMat
  );
  shoulder.position.set(mx, 0.62, mz);
  shoulder.castShadow = true;
  shoulder.receiveShadow = true;
  scene.add(shoulder);

  // Skirt boulders blend the shelf into the coast, but the whole
  // camera-facing arc stays low and clear so the white curtain is never
  // buried behind a pile of rocks.
  for (let i = 0; i < 20; i++) {
    const a = rand() * Math.PI * 2;
    if (Math.cos(a) * FALL_DIR.x + Math.sin(a) * FALL_DIR.z > 0.4) continue;
    const rad = baseR + 0.1 + rand() * 1.25;
    const s = 0.34 + rand() * 0.58;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      i % 2 ? M.rock : M.warmRock
    );
    rock.position.set(
      mx + Math.cos(a) * rad,
      0.02 + rand() * 0.95,
      mz + Math.sin(a) * rad
    );
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.scale.set(1 + rand() * 0.3, 0.7 + rand() * 0.5, 1 + rand() * 0.3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // Grass on top, with a stone lip around the whole shelf.
  const turf = new THREE.Mesh(
    new THREE.CircleGeometry(topR * 0.93, 36),
    M.grass
  );
  turf.rotation.x = -Math.PI / 2;
  turf.position.set(mx, topY + 0.035, mz);
  turf.receiveShadow = true;
  scene.add(turf);

  const topRim = new THREE.Mesh(
    new THREE.RingGeometry(topR * 0.88, topR * 1.005, 36),
    M.stone
  );
  topRim.rotation.x = -Math.PI / 2;
  topRim.position.set(mx, topY + 0.055, mz);
  topRim.receiveShadow = true;
  scene.add(topRim);

  // The high pool, sunk into the grass with a pale stone rim.
  const poolBase = new THREE.Mesh(
    new THREE.CircleGeometry(poolR + 0.26, 32),
    M.stoneDeep
  );
  poolBase.rotation.x = -Math.PI / 2;
  poolBase.position.set(cx, topY + 0.06, cz);
  poolBase.receiveShadow = true;
  scene.add(poolBase);

  const pool = new THREE.Mesh(new THREE.CircleGeometry(poolR, 32), M.water);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(cx, topY + 0.11, cz);
  pool.receiveShadow = true;
  scene.add(pool);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(poolR, poolR + 0.26, 36),
    M.stone
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(cx, topY + 0.125, cz);
  rim.receiveShadow = true;
  scene.add(rim);

  // Palms and small trees frame the pool from behind, leaving the
  // camera-facing lip clear so the fall reads as one wide curtain.
  makePalm(15.9, -4.8, 0.72, topY + 0.02);
  makePalm(20.4, -3.9, 0.82, topY + 0.02);
  makeTree(20.7, -0.6, 0.48, false, topY + 0.02);
  for (const [bx, bz, s] of [
    [20.8, 1.1, 0.34],
    [16.3, -4.2, 0.3],
    [20.9, -2.2, 0.28],
  ]) {
    const bush = sphere(scene, s, 7, M.leafDark, bx, topY + 0.24, bz, {
      cast: true,
    });
    bush.scale.set(1.25, 0.6, 1.1);
  }

  // Two small pines on the back rim, like the reference mesa.
  for (const [px, pz, s] of [
    [17.35, -5.15, 0.5],
    [19.2, -5.0, 0.42],
  ]) {
    cyl(scene, 0.06 * s, 0.1 * s, 0.62 * s, 5, M.trunk, px, topY + 0.31 * s, pz, {
      cast: true,
    });
    cone(scene, 0.62 * s, 1.15 * s, 7, M.leafDark, px, topY + 1.03 * s, pz, {
      cast: true,
    });
    cone(scene, 0.44 * s, 0.82 * s, 7, M.leaf, px, topY + 1.62 * s, pz, {
      cast: true,
    });
  }

  // A half-submerged boulder gives the top pool some depth.
  const poolRock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.38, 0),
    M.stoneDeep
  );
  poolRock.position.set(RIVER_POOL.x + 0.45, topY + 0.12, RIVER_POOL.z + 0.2);
  poolRock.rotation.set(rand(), rand(), rand());
  poolRock.scale.set(1.2, 0.62, 1.0);
  poolRock.castShadow = true;
  poolRock.receiveShadow = true;
  scene.add(poolRock);

  // The short top stream carries the pool over the lip.
  makeWaterRibbon3D(RIVER_POINTS, 2.35, M.stoneDeep, -0.02);
  makeWaterRibbon3D(RIVER_POINTS, 1.8, M.sandDark, 0.0);
  makeWaterRibbon3D(RIVER_POINTS, 1.15, M.water, 0.035);

  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const p = riverAt(t);
    const q = riverAt(Math.min(1, t + 0.03));
    let dx = q.x - p.x;
    let dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const nx = -dz;
    const nz = dx;
    for (const side of [-1, 1]) {
      if (rand() < 0.3) continue;
      const s = 0.15 + rand() * 0.25;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(s, 0),
        rand() > 0.5 ? M.rock : M.stoneDark
      );
      rock.position.set(
        p.x + nx * (1.0 + rand() * 0.26) * side,
        topY + 0.1,
        p.z + nz * (1.0 + rand() * 0.26) * side
      );
      rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
      rock.castShadow = true;
      scene.add(rock);
    }
  }
  for (let i = 0; i < 16; i++) {
    const p = riverAt(0.04 + rand() * 0.9);
    const foam = sphere(
      scene,
      0.06 + rand() * 0.1,
      6,
      M.foam,
      p.x + (rand() - 0.5) * 0.7,
      topY + 0.15,
      p.z + (rand() - 0.5) * 0.55,
      { cast: false, receive: false }
    );
    foam.scale.set(1.1, 0.16, 0.8);
  }

  // No boulder tower here: the shelf itself carries the weight of the
  // pool, and a clear flank lets the full curtain read from the home view.

  // A jagged rock lip replaces a flat sill so the crest reads as a
  // natural break in the shelf.
  const lipLx = Math.cos(FALL_ROT);
  const lipLz = -Math.sin(FALL_ROT);
  for (const [off, s] of [
    [-2.0, 0.46],
    [-1.25, 0.42],
    [-0.62, 0.34],
    [0.0, 0.38],
    [0.68, 0.32],
    [1.3, 0.4],
    [2.0, 0.46],
  ]) {
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      M.stoneDeep
    );
    stone.position.set(
      RIVER_LIP.x + lipLx * off,
      topY + 0.06,
      RIVER_LIP.z + lipLz * off
    );
    stone.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    stone.scale.set(1.1, 0.6, 0.9);
    stone.castShadow = true;
    stone.receiveShadow = true;
    scene.add(stone);
  }

  // Moss and flowers soften the shelf top.
  const fallAngle = Math.atan2(FALL_DIR.z, FALL_DIR.x);
  const cliffRadius = (y) => baseR + (topR - baseR) * clamp(y / topY, 0, 1);

  // Mossy drapes break up the tall bare cliff. They stop short of the
  // fall face so the water keeps a clean dark backing.
  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2;
    if (Math.cos(a - fallAngle) > 0.52) continue;
    const y = 0.85 + rand() * (topY - 1.5);
    const rr = cliffRadius(y) + 0.04 + rand() * 0.1;
    const moss = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.38 + rand() * 0.62, 0),
      i % 4 === 0 ? M.mossLight : M.moss
    );
    moss.position.set(mx + Math.cos(a) * rr, y, mz + Math.sin(a) * rr);
    moss.rotation.set(0, Math.PI / 2 - a, 0);
    moss.scale.set(1 + rand() * 0.4, 0.45 + rand() * 0.55, 0.24 + rand() * 0.12);
    moss.receiveShadow = true;
    scene.add(moss);
  }

  // A mossy fringe spills over the rim, with grass tufts and tiny
  // blossoms tucked between the stones.
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    if (Math.cos(a - fallAngle) > 0.4) continue;
    const rad = topR * (0.86 + rand() * 0.12);
    const x = mx + Math.cos(a) * rad;
    const z = mz + Math.sin(a) * rad;
    const clump = sphere(
      scene,
      0.26 + rand() * 0.4,
      6,
      i % 3 === 0 ? M.mossLight : M.moss,
      x,
      topY + 0.05 + rand() * 0.1,
      z,
      { cast: false }
    );
    clump.scale.set(1.25, 0.4, 0.9);
  }

  for (let i = 0; i < 20; i++) {
    const a = rand() * Math.PI * 2;
    if (Math.cos(a - fallAngle) > 0.45) continue;
    const rad = topR * (0.7 + rand() * 0.24);
    const x = mx + Math.cos(a) * rad;
    const z = mz + Math.sin(a) * rad;
    const h = 0.16 + rand() * 0.22;
    const tuft = new THREE.Mesh(
      new THREE.ConeGeometry(0.05 + rand() * 0.04, h, 4),
      M.leafDark
    );
    tuft.position.set(x, topY + h / 2, z);
    tuft.rotation.y = rand() * 3;
    scene.add(tuft);
  }

  // Vines trail down the shaded sides of the mesa.
  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2;
    if (Math.cos(a - fallAngle) > 0.5) continue;
    const len = 1.1 + rand() * 2.1;
    const x = mx + Math.cos(a) * (topR - 0.05);
    const z = mz + Math.sin(a) * (topR - 0.05);
    cyl(scene, 0.02, 0.05, len, 5, i % 2 ? M.leafDark : M.moss, x, topY - len / 2, z, {
      rx: (rand() - 0.5) * 0.16,
      rz: (rand() - 0.5) * 0.22,
      cast: true,
    });
    for (let j = 0; j < 3; j++) {
      const leaf = sphere(
        scene,
        0.12 + rand() * 0.12,
        6,
        i % 2 ? M.leafDark : M.mossLight,
        x + (rand() - 0.5) * 0.32,
        topY - 0.22 - j * (len / 3.2),
        z + (rand() - 0.5) * 0.32,
        { cast: false }
      );
      leaf.scale.set(1.35, 0.62, 0.8);
    }
  }

  // A few wildflowers and grasses on the shelf top.
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const rad = topR * (0.5 + rand() * 0.42);
    const x = mx + Math.cos(a) * rad;
    const z = mz + Math.sin(a) * rad;
    if (Math.hypot(x - RIVER_POOL.x, z - RIVER_POOL.z) < poolR + 0.35) continue;
    const h = 0.14 + rand() * 0.14;
    cyl(scene, 0.01, 0.014, h, 4, M.leafDark, x, topY + h / 2, z, { cast: false });
    sphere(
      scene,
      0.045 + rand() * 0.035,
      5,
      i % 3 === 0 ? M.gold : i % 3 === 1 ? M.cream : M.roofRed,
      x,
      topY + h + 0.02,
      z,
      { cast: false, receive: false }
    );
  }

  // Lily pads and one small blossom give the high pool a focal point.
  for (const [lx, lz, ls] of [
    [16.35, -0.35, 0.26],
    [17.45, 0.35, 0.21],
    [16.75, 0.75, 0.17],
  ]) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(ls, 8),
      M.leafDark
    );
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = rand() * 3;
    pad.position.set(lx, topY + 0.128, lz);
    pad.receiveShadow = true;
    scene.add(pad);
  }
  sphere(scene, 0.07, 6, M.roofRed, 16.35, topY + 0.16, -0.35, {
    cast: false,
    receive: false,
  });
}

function buildWaterfall() {
  const lip = RIVER_LIP;
  const cosR = Math.cos(FALL_ROT);
  const sinR = Math.sin(FALL_ROT);
  const lx = cosR;
  const lz = -sinR;
  const nx = sinR;
  const nz = cosR;

  const fall = new THREE.Group();
  fall.position.set(lip.x + nx * 0.5, lip.y, lip.z + nz * 0.5);
  fall.rotation.y = FALL_ROT;
  scene.add(fall);

  const sheetH = lip.y - FALL_BOTTOM_Y;
  const sheetW = 5.0;
  const fallMat = new THREE.MeshBasicMaterial({
    map: FALL_TEX.clone(),
    transparent: true,
    opacity: 0.98,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  fallMat.map.needsUpdate = true;
  fallMat.map.wrapS = THREE.RepeatWrapping;
  fallMat.map.wrapT = THREE.RepeatWrapping;
  fallMat.map.repeat.set(1.15, 1.55);
  fallMat.userData.speed = 0.34;
  waterfallMats.push(fallMat);
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW, sheetH),
    fallMat
  );
  sheet.position.set(0, 0.02 - sheetH / 2, 0.22);
  fall.add(sheet);

  // A turquoise under-pane gives the curtain body; the white streak
  // texture on top supplies the moving foam.
  const tint = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW * 0.95, sheetH * 0.99),
    new THREE.MeshBasicMaterial({
      color: 0x5fdcef,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  tint.position.set(0, 0.01 - sheetH * 0.495, 0.14);
  fall.add(tint);

  const core = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW * 0.78, sheetH * 0.94),
    new THREE.MeshBasicMaterial({
      color: 0xd8fcff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  core.position.set(0, 0.01 - sheetH * 0.48, 0.27);
  fall.add(core);

  const backMat = fallMat.clone();
  backMat.map = fallMat.map.clone();
  backMat.map.needsUpdate = true;
  backMat.opacity = 0.22;
  backMat.userData.speed = 0.4;
  waterfallMats.push(backMat);
  const backSheet = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW * 1.06, sheetH * 0.96),
    backMat
  );
  backSheet.position.set(0, 0.01 - sheetH * 0.48, 0.02);
  fall.add(backSheet);

  // A dark rock face directly behind the water gives the pale sheet
  // contrast from across the island. Boulders break up its edges.
  const backTex = ROCK_FACE_TEX.clone();
  backTex.needsUpdate = true;
  backTex.repeat.set(1.5, 1.1);
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW * 0.96, sheetH * 0.98),
    new THREE.MeshStandardMaterial({
      map: backTex,
      color: 0x705b43,
      roughness: 1,
      side: THREE.DoubleSide,
    })
  );
  backdrop.position.set(0, -sheetH * 0.5, -0.38);
  backdrop.receiveShadow = true;
  fall.add(backdrop);
  for (const [bx, by, bs] of [
    [-sheetW * 0.82, 0.55, 0.9],
    [-sheetW * 0.8, 2.1, 0.78],
    [sheetW * 0.82, 0.75, 0.82],
    [sheetW * 0.78, 2.7, 0.66],
  ]) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(bs, 0),
      M.warmRock
    );
    rock.position.set(bx, by - sheetH, -0.42);
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.scale.set(1.05, 0.9, 0.75);
    rock.castShadow = true;
    rock.receiveShadow = true;
    fall.add(rock);
  }

  const foamMat = new THREE.MeshBasicMaterial({
    map: fallFoamTexture(),
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  foamMat.userData.speed = 0.44;
  waterfallMats.push(foamMat);
  const foamSheet = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW * 1.04, sheetH * 1.02),
    foamMat
  );
  foamSheet.position.set(0, 0.02 - sheetH / 2, 0.31);
  fall.add(foamSheet);

  // Bright crest and foot make the fall read from a distance.
  const crest = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW * 1.04, 0.55),
    new THREE.MeshBasicMaterial({
      color: 0xf2ffff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    })
  );
  crest.position.set(0, -0.12, 0.34);
  fall.add(crest);

  // A second thin strand gives the curtain a little asymmetry.
  const strandMat = fallMat.clone();
  strandMat.map = fallMat.map.clone();
  strandMat.map.needsUpdate = true;
  strandMat.opacity = 0.55;
  strandMat.userData.speed = 0.5;
  waterfallMats.push(strandMat);
  const strand = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW * 0.3, sheetH * 0.88),
    strandMat
  );
  strand.position.set(sheetW * 0.3, -0.1 - sheetH * 0.44, 0.38);
  fall.add(strand);

  const strand2 = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW * 0.24, sheetH * 0.8),
    strandMat
  );
  strand2.position.set(-sheetW * 0.32, -0.12 - sheetH * 0.4, 0.4);
  fall.add(strand2);

  // Dark rock right behind the sheet for contrast, kept far enough
  // back that it never pokes through the falling water.
  for (const [ox, oy, s, back] of [
    [-1.35, -2.1, 1.5, 1.9],
    [0.35, -2.0, 1.7, 1.9],
    [1.7, -2.15, 1.45, 1.9],
    [0.9, -1.15, 1.0, 1.15],
    [-0.35, -3.0, 1.05, 1.15],
  ]) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      M.stoneDeep
    );
    rock.position.set(
      fall.position.x + lx * ox + nx * -back,
      fall.position.y + oy,
      fall.position.z + lz * ox + nz * -back
    );
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.scale.set(1.0, 0.9, 0.7);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // Rock jambs break up the straight sides of the curtain so it reads
  // as water squeezing between boulders rather than a hanging flag.
  for (const side of [-1, 1]) {
    for (const [ey, es] of [
      [0.9, 0.52],
      [2.55, 0.58],
    ]) {
      const jamb = new THREE.Mesh(
        new THREE.DodecahedronGeometry(es, 0),
        side > 0 ? M.warmRock : M.stoneDark
      );
      jamb.position.set(
        side * (sheetW * 0.5 + 0.02),
        ey - sheetH,
        0.16
      );
      jamb.rotation.set(rand() * 2, rand() * 3, rand() * 2);
      jamb.scale.set(1.15, 1.15, 0.9);
      jamb.castShadow = true;
      jamb.receiveShadow = true;
      fall.add(jamb);
    }
  }

  // A jagged rock brow funnels the stream over the lip.
  for (const [bx, bs, by] of [
    [-2.2, 0.62, 0.1],
    [-1.35, 0.48, 0.06],
    [1.3, 0.5, 0.06],
    [2.15, 0.6, 0.12],
  ]) {
    const brow = new THREE.Mesh(
      new THREE.DodecahedronGeometry(bs, 0),
      bs > 0.55 ? M.warmRock : M.stoneDark
    );
    brow.position.set(bx, by, 0.55);
    brow.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    brow.scale.set(1.05, 0.8, 0.95);
    brow.castShadow = true;
    brow.receiveShadow = true;
    fall.add(brow);
  }

  // Framing boulders sit to the sides, never in front of the curtain.
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const off = sheetW * 0.5 + 0.7 + rand() * 0.8;
    const fwd = -0.25 + rand() * 0.5;
    const s = 0.3 + rand() * 0.45;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      i % 3 ? M.rock : M.warmRock
    );
    rock.position.set(
      fall.position.x + lx * off * side + nx * fwd,
      -0.28 + rand() * 0.85,
      fall.position.z + lz * off * side + nz * fwd
    );
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.scale.set(0.95 + rand() * 0.4, 0.8 + rand() * 0.45, 0.95 + rand() * 0.4);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // Mossy tufts frame the curtain without covering the white water.
  for (const [mx2, my2, mz2, ms] of [
    [-sheetW * 0.5 - 0.4, -0.15, 0.42, 0.42],
    [-sheetW * 0.5 - 0.2, -1.25, 0.3, 0.32],
    [sheetW * 0.5 + 0.35, -0.3, 0.44, 0.46],
    [sheetW * 0.5 + 0.15, -1.7, 0.28, 0.34],
    [-sheetW * 0.5 + 0.1, -2.9, 0.26, 0.3],
    [sheetW * 0.5 - 0.1, -3.15, 0.25, 0.28],
  ]) {
    const tuft = sphere(fall, ms, 6, M.moss, mx2, my2, mz2, {
      cast: false,
    });
    tuft.scale.set(1.2, 0.55, 0.7);
  }

  // The plunge pool and foam at the foot of the fall. The whole basin sits
  // just above the grass cap so the fall visibly feeds the lower river.
  const splashX = fall.position.x + nx * 0.4;
  const splashZ = fall.position.z + nz * 0.4;
  const plungeMat = M.water.clone();
  plungeMat.color = new THREE.Color(0x6fdfe9);
  plungeMat.roughness = 0.46;
  const plunge = new THREE.Mesh(new THREE.CircleGeometry(2.35, 40), plungeMat);
  plunge.rotation.x = -Math.PI / 2;
  plunge.scale.set(1.25, 1, 1.05);
  plunge.position.set(splashX, 0.056, splashZ);
  plunge.receiveShadow = true;
  scene.add(plunge);
  const plungeRim = new THREE.Mesh(
    new THREE.RingGeometry(2.35, 2.62, 40),
    M.sandDark
  );
  plungeRim.rotation.x = -Math.PI / 2;
  plungeRim.scale.set(1.25, 1, 1.05);
  plungeRim.position.set(splashX, 0.05, splashZ);
  plungeRim.receiveShadow = true;
  scene.add(plungeRim);
  const shallow = new THREE.Mesh(
    new THREE.CircleGeometry(2.45, 34),
    new THREE.MeshBasicMaterial({
      color: 0xb8fff4,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    })
  );
  shallow.rotation.x = -Math.PI / 2;
  shallow.scale.set(1.3, 1, 1.0);
  shallow.position.set(splashX, 0.06, splashZ);
  scene.add(shallow);
  for (const [r, op] of [
    [1.4, 0.24],
    [2.0, 0.14],
    [2.6, 0.08],
  ]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 0.22, 40),
      new THREE.MeshBasicMaterial({
        color: 0xf4ffff,
        transparent: true,
        opacity: op,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(splashX, 0.064, splashZ);
    scene.add(ring);
  }

  // The lower river runs inland across the meadow, then over the rim.
  const shelfRiver = LOWER_RIVER_POINTS.slice(0, LOWER_RIVER_LIP + 1);
  const mouthRiver = LOWER_RIVER_POINTS.slice(LOWER_RIVER_LIP);
  const riverMat = M.water.clone();
  riverMat.color = new THREE.Color(0x5fdbe8);
  riverMat.roughness = 0.62;
  const bankMat = new THREE.MeshStandardMaterial({
    color: 0x86623c,
    roughness: 1,
  });
  makeWaterRibbon3D(shelfRiver, 4.2, bankMat, -0.017);
  makeWaterRibbon3D(shelfRiver, 3.4, M.sandDark, -0.004);
  makeWaterRibbon3D(shelfRiver, 2.9, riverMat, 0.0);
  makeWaterRibbon3D(mouthRiver, 3.3, riverMat, 0.0);

  // A few boulders sit close to the fall and the mouth; the grassy middle
  // stretch stays open so the stream reads clearly from the game camera.
  for (const [t, side, off, s] of [
    [0.03, -1, 1.75, 0.4],
    [0.05, 1, 1.85, 0.34],
    [0.1, -1, 2.0, 0.3],
    [0.16, 1, 1.95, 0.28],
    [0.86, -1, 1.85, 0.36],
    [0.9, 1, 1.8, 0.42],
    [0.93, -1, 2.0, 0.32],
  ]) {
    const p = lowerRiverAt(t);
    const q = lowerRiverAt(Math.min(1, t + 0.03));
    let dx = q.x - p.x;
    let dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      rand() > 0.45 ? M.rock : M.stoneDark
    );
    rock.position.set(
      p.x + -dz * off * side,
      p.y + 0.02,
      p.z + dx * off * side
    );
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.scale.y = 0.6 + rand() * 0.35;
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // Low bushes and reeds soften the green banks.
  for (let i = 0; i < 30; i++) {
    const t = 0.06 + rand() * 0.82;
    const p = lowerRiverAt(t);
    const q = lowerRiverAt(Math.min(1, t + 0.03));
    let dx = q.x - p.x;
    let dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const side = rand() < 0.5 ? -1 : 1;
    const off = 1.9 + rand() * 0.7;
    const x = p.x + -dz * off * side;
    const z = p.z + dx * off * side;
    if (i % 3 === 0) {
      const bush = sphere(
        scene,
        0.28 + rand() * 0.32,
        7,
        i % 2 ? M.leafDark : M.leaf,
        x,
        0.16,
        z,
        { cast: false }
      );
      bush.scale.set(1.25, 0.72, 1.1);
    } else {
      const reed = new THREE.Mesh(
        new THREE.ConeGeometry(0.16 + rand() * 0.1, 0.5 + rand() * 0.35, 5),
        M.leafDark
      );
      reed.position.set(x, 0.26, z);
      reed.rotation.y = rand() * 3;
      scene.add(reed);
    }
  }

  // Rapids.
  for (let i = 0; i < 14; i++) {
    const p = lowerRiverAt(0.02 + rand() * 0.85);
    const foam = sphere(
      scene,
      0.07 + rand() * 0.13,
      6,
      M.foam,
      p.x + (rand() - 0.5) * 0.9,
      p.y + 0.035,
      p.z + (rand() - 0.5) * 0.7,
      { cast: false, receive: false }
    );
    foam.scale.set(1.0 + rand() * 0.9, 0.16, 0.7 + rand() * 0.7);
  }

  // The mouth cascade spills over the rim into the bay.
  const mouth = LOWER_RIVER_POINTS[LOWER_RIVER_LIP + 1];

  // A small plunge pool of foam where the river meets the sea.
  for (let i = 0; i < 10; i++) {
    const foam = sphere(
      scene,
      0.1 + rand() * 0.16,
      6,
      M.foam,
      mouth[0] + (rand() - 0.5) * 3.1,
      -1.55 + rand() * 0.08,
      mouth[1] + (rand() - 0.5) * 1.9,
      { cast: false, receive: false }
    );
    foam.scale.set(1.5, 0.16, 1.1);
  }
  for (const [r, op] of [
    [1.5, 0.22],
    [2.3, 0.13],
    [3.1, 0.07],
  ]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 0.22, 40),
      new THREE.MeshBasicMaterial({
        color: 0xf4ffff,
        transparent: true,
        opacity: op,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(mouth[0], -1.56, mouth[1]);
    scene.add(ring);
  }
  for (let i = 0; i < 8; i++) {
    const mist = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: SOFT_TEX,
        color: 0xf0ffff,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
      })
    );
    mist.position.set(
      mouth[0] + (rand() - 0.5) * 3.0,
      -1.25 + rand() * 1.0,
      mouth[1] + (rand() - 0.5) * 2.2
    );
    mist.scale.setScalar(1.2 + rand() * 1.4);
    scene.add(mist);
    waterfallMists.push({ sp: mist, phase: rand() * 6.28, base: mist.position.clone() });
  }

  // Stepping stones cross the stream at its calm bend.
  const crossT = 0.58;
  const cp = lowerRiverAt(crossT);
  const cq = lowerRiverAt(Math.min(1, crossT + 0.03));
  const cdx = cq.x - cp.x;
  const cdz = cq.z - cp.z;
  const clen = Math.hypot(cdx, cdz) || 1;
  const cnx = -cdz / clen;
  const cnz = cdx / clen;
  for (const [off, s] of [
    [-0.96, 0.34],
    [-0.32, 0.29],
    [0.32, 0.31],
    [0.96, 0.28],
  ]) {
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      M.stoneDark
    );
    stone.position.set(
      cp.x + cnx * off,
      cp.y + 0.05,
      cp.z + cnz * off
    );
    stone.rotation.set(rand() * 0.4, rand() * 3, rand() * 0.4);
    stone.scale.set(1.15, 0.22, 1.0);
    stone.castShadow = true;
    stone.receiveShadow = true;
    scene.add(stone);
  }

  // A timber footbridge crosses the stream just below the fall.
  {
    const crossT = 0.22;
    const p = lowerRiverAt(crossT);
    const q = lowerRiverAt(Math.min(1, crossT + 0.03));
    let dx = q.x - p.x;
    let dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const px = -dz;
    const pz = dx;
    const bridge = new THREE.Group();
    bridge.position.set(p.x, p.y + 0.02, p.z);
    bridge.rotation.y = Math.atan2(-pz, px);
    scene.add(bridge);
    for (let i = 0; i < 11; i++) {
      const off = -2.2 + i * 0.44;
      rbox(bridge, 0.4, 0.1, 1.92, i % 2 ? M.wood : M.woodLight, off, 0.3, 0, {
        r: 0.03,
        cast: true,
        receive: true,
      });
    }
    for (const side of [-1, 1]) {
      box(bridge, 4.6, 0.11, 0.11, M.woodDark, 0, 0.54, side * 0.98, { cast: true });
      box(bridge, 4.6, 0.11, 0.11, M.woodDark, 0, 0.84, side * 0.98, { cast: true });
      for (const off of [-2.05, 0, 2.05]) {
        box(bridge, 0.11, 0.54, 0.11, M.woodDark, off, 0.63, side * 0.98, { cast: true });
      }
    }
    for (const sx of [-1.7, 1.7]) {
      for (const sz of [-0.7, 0.7]) {
        cyl(bridge, 0.09, 0.12, 0.92, 6, M.woodDark, sx, 0.0, sz, { cast: true });
      }
    }
  }

  // Palms and grasses line the river banks.
  makePalm(12.8, 6.2, 0.62, 0);
  makePalm(11.0, 11.0, 0.58, 0);
  makePalm(7.2, 16.8, 0.55, 0);
  makePalm(6.8, 15.2, 0.5, 0);
  for (let i = 0; i < 10; i++) {
    const t = 0.2 + rand() * 0.55;
    const p = lowerRiverAt(t);
    const side = rand() > 0.5 ? 1 : -1;
    const q = lowerRiverAt(Math.min(1, t + 0.03));
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    cyl(
      scene,
      0.025,
      0.045,
      0.4 + rand() * 0.5,
      5,
      M.leafDark,
      p.x + (-dz / len) * side * (1.6 + rand() * 0.5),
      p.y + 0.12,
      p.z + (dx / len) * side * (1.6 + rand() * 0.5),
      { rx: (rand() - 0.5) * 0.16, rz: side * (0.06 + rand() * 0.12), cast: false }
    );
  }

  // Mist and spray.
  for (let i = 0; i < 9; i++) {
    const mist = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: SOFT_TEX,
        color: 0xefffff,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
      })
    );
    mist.position.set(
      splashX + (rand() - 0.5) * 3.6,
      -0.4 + rand() * 1.7,
      splashZ + (rand() - 0.5) * 2.4
    );
    mist.scale.setScalar(1.5 + rand() * 1.8);
    scene.add(mist);
    waterfallMists.push({
      sp: mist,
      phase: rand() * 6.28,
      base: mist.position.clone(),
    });
  }
  for (let i = 0; i < 6; i++) {
    const spray = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: SOFT_TEX,
        color: 0xffffff,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
      })
    );
    spray.position.set(
      fall.position.x + lx * (-1.7 + i * 0.68) + nx * 0.42,
      fall.position.y + 0.05 + rand() * 0.25,
      fall.position.z + lz * (-1.7 + i * 0.68) + nz * 0.42
    );
    spray.scale.setScalar(0.9 + rand() * 0.5);
    scene.add(spray);
    waterfallMists.push({
      sp: spray,
      phase: rand() * 6.28,
      base: spray.position.clone(),
    });
  }
}

function makePalm(x, z, scale = 1, yBase = 0) {
  const g = new THREE.Group();
  g.position.set(x, yBase, z);
  g.scale.setScalar(scale);
  scene.add(g);

  // A gently leaning segmented trunk.
  const segments = 7;
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const px = Math.sin(t * 1.1) * 0.4;
    const seg = cyl(
      g,
      0.09,
      0.13,
      0.62,
      6,
      M.trunk,
      px,
      0.3 + t * 2.6,
      0,
      { cast: true }
    );
    seg.rotation.z = -0.05 - t * 0.1;
  }

  const crown = new THREE.Group();
  crown.position.set(0.42, 3.02, 0);
  g.add(crown);

  const frondGeo = new THREE.ConeGeometry(0.22, 1.55, 4);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const frond = new THREE.Mesh(
      frondGeo,
      i % 3 === 0 ? M.leafDark : M.leaf
    );
    frond.position.set(Math.cos(a) * 0.5, 0.05 - (i % 2) * 0.07, Math.sin(a) * 0.5);
    frond.rotation.y = -a;
    frond.rotation.z = Math.PI / 2 + 0.3;
    frond.scale.set(1, 1, 0.5);
    frond.castShadow = true;
    crown.add(frond);
  }
  sphere(crown, 0.22, 7, M.trunk, 0, 0.02, 0, { cast: true });
  for (let i = 0; i < 3; i++) {
    const a = 0.8 + i * 2.1;
    sphere(
      crown,
      0.09,
      5,
      M.woodDark,
      Math.cos(a) * 0.28,
      -0.18,
      Math.sin(a) * 0.28,
      { cast: false }
    );
  }
  return g;
}

function buildForestFloorV2() {
  const patches = [
    [-7.5, -15.0, 6.6, 3.2, 0.2],
    [3.5, -16.0, 7.2, 3.4, -0.3],
    [13.0, -13.0, 5.0, 3.0, 0.5],
    [-15.0, -9.0, 4.4, 5.6, 0.4],
    [-16.2, -1.4, 4.0, 5.2, -0.2],
    [12.0, -9.2, 3.6, 4.6, 0.3],
    [9.4, -11.2, 4.6, 3.0, 0.1],
  ];
  for (const [x, z, rx, rz, rot] of patches) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 24), M.forestFloor);
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = rot;
    patch.scale.set(rx, rz, 1);
    patch.position.set(x, 0.031, z);
    patch.receiveShadow = true;

    // Keep the mossy floor inside the grass silhouette. Without this the
    // west patch spills over the cliff and reads as a flat green shadow.
    patch.updateMatrixWorld(true);
    const pos = patch.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      patch.localToWorld(v);
      const a = Math.atan2(v.z, v.x);
      const maxR = islandGrassRadius(a) - 0.55;
      const r = Math.hypot(v.x, v.z);
      if (r > maxR) {
        const k = maxR / r;
        v.x *= k;
        v.z *= k;
        patch.worldToLocal(v);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    scene.add(patch);
  }
}

function buildForestV2() {
  const treeData = [];
  for (let gx = -23.0; gx <= 23.0; gx += 1.2) {
    for (let gz = -23.0; gz <= 23.0; gz += 1.2) {
      const x = gx + (rand() - 0.5) * 0.95;
      const z = gz + (rand() - 0.5) * 0.95;
      if (!forestAllowedV2(x, z)) continue;
      if (rand() < 0.04) continue;
      const pine = rand() < 0.24;
      let scale = 0.88 + rand() * 0.8;
      const r = Math.hypot(x, z);
      if (r > 18.0) scale *= 1.1;
      if (z > 2 && x < 0) scale *= 0.92;
      treeData.push({
        x,
        z,
        s: scale,
        pine,
        hue: rand(),
        h: pine ? 2.0 + rand() * 1.05 : 1.7 + rand() * 1.3,
      });
    }
  }

  // Tall sentinels frame the back and the two upper corners.
  for (const [x, z, s] of [
    [-16.0, -17.2, 1.56],
    [-11.0, -18.8, 1.68],
    [-5.5, -19.6, 1.64],
    [0.6, -19.7, 1.72],
    [6.6, -19.1, 1.6],
    [12.0, -17.9, 1.56],
    [16.4, -15.4, 1.5],
    [19.2, -12.4, 1.46],
    [-18.0, -13.0, 1.45],
    [-19.6, -7.8, 1.4],
    [-18.8, -1.8, 1.35],
    [-17.9, 3.4, 1.28],
    [13.2, -14.2, 1.42],
    [9.0, -16.4, 1.5],
    [15.8, -12.6, 1.55],
    [18.4, -9.0, 1.45],
    [14.0, -7.4, 1.4],
    [12.6, -2.6, 1.3],
  ]) {
    if (forestAllowedV2(x, z)) treeData.push({ x, z, s, pine: rand() < 0.4, hue: rand(), h: 2.5 + rand() * 0.6 });
  }

  // A dense pine wall along the back rim, following the clock.
  for (let deg = 228; deg <= 400; deg += 7.5) {
    const a = deg * DEG;
    const rr = islandGrassRadius(a) - 1.05 - rand() * 1.55;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (!forestAllowedV2(x, z)) continue;
    if (rand() < 0.22) continue;
    treeData.push({
      x,
      z,
      s: 1.24 + rand() * 0.5,
      pine: rand() < 0.58,
      hue: rand(),
      h: 2.45 + rand() * 0.75,
    });
  }

  // A taller stand behind the waterfall shelf.
  for (const [x, z, s] of [
    [15.6, -8.8, 1.5],
    [18.6, -8.2, 1.62],
    [13.2, -10.4, 1.38],
    [18.9, -6.0, 1.5],
    [20.0, -3.8, 1.42],
    [16.6, -7.6, 1.36],
  ]) {
    treeData.push({
      x,
      z,
      s,
      pine: true,
      hue: rand(),
      h: 2.7 + rand() * 0.6,
    });
  }

  // The left rim is classified as sandy coast, so the normal scatter
  // leaves its green forest-floor patch bare. Fill that clearing with a
  // deliberate grove so the shadow under the trees reads as forest.
  for (const [x, z, s, pine] of [
    [-15.6, -3.6, 1.2, false],
    [-17.2, -2.4, 1.34, false],
    [-16.4, -1.2, 1.12, true],
    [-18.4, 0.2, 1.4, false],
    [-16.8, 1.6, 1.26, true],
    [-18.9, 2.8, 1.3, false],
    [-15.2, 0.6, 1.04, false],
    [-17.6, 4.0, 1.16, true],
    [-19.2, -1.2, 1.28, false],
    [-15.9, 3.0, 0.96, false],
    [-19.2, 4.8, 1.18, false],
    [-18.4, 6.2, 1.02, true],
    [-17.6, 5.2, 0.92, false],
  ]) {
    treeData.push({
      x,
      z,
      s,
      pine,
      hue: rand(),
      h: 2.35 + rand() * 0.65,
    });
  }

  const broad = treeData.filter((t) => !t.pine);
  const pines = treeData.filter((t) => t.pine);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.27, 1, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, M.trunk, treeData.length);
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  scene.add(trunks);

  const dummy = new THREE.Object3D();
  treeData.forEach((t, i) => {
    dummy.position.set(t.x, t.h * 0.5, t.z);
    dummy.rotation.set(0, t.hue * 6.28, 0);
    dummy.scale.set(0.9 + t.s * 0.16, t.h, 0.9 + t.s * 0.16);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  });

  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  const canopyMesh = new THREE.InstancedMesh(canopyGeo, M.forestLeaf, broad.length * 4);
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  const leafColors = [0x2f7a2a, 0x3f9432, 0x256a20, 0x5cb43f, 0x1f5c1c, 0x7ccb4d];
  let ci = 0;
  for (const t of broad) {
    const baseY = t.h + 0.65 * t.s;
    const blobs = [
      [0, 0.18, 0, 1.38],
      [0.5, -0.08, 0.34, 1.02],
      [-0.42, 0.05, -0.38, 0.92],
      [0.18, 0.5, -0.3, 0.82],
    ];
    for (const [ox, oy, oz, rs] of blobs) {
      const scale = rs * t.s;
      dummy.position.set(t.x + ox * t.s, baseY + oy * t.s, t.z + oz * t.s);
      dummy.rotation.set(rand() * 0.5, rand() * 6.28, rand() * 0.5);
      dummy.scale.set(scale * (1 + rand() * 0.18), scale * (0.86 + rand() * 0.22), scale);
      dummy.updateMatrix();
      canopyMesh.setMatrixAt(ci, dummy.matrix);
      canopyMesh.setColorAt(ci, new THREE.Color(leafColors[Math.floor(((t.hue + ci * 0.17) % 1) * leafColors.length)]));
      ci++;
    }
  }
  canopyMesh.instanceMatrix.needsUpdate = true;
  if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
  scene.add(canopyMesh);

  const coneGeo = new THREE.ConeGeometry(1, 1, 7);
  const pineCones = new THREE.InstancedMesh(coneGeo, M.forestLeaf, pines.length * 3);
  pineCones.castShadow = true;
  pineCones.receiveShadow = true;
  let pi = 0;
  for (const t of pines) {
    const layers = [
      [1.25 * t.s, 1.45 * t.s, t.h + 0.7 * t.s],
      [0.94 * t.s, 1.2 * t.s, t.h + 1.45 * t.s],
      [0.62 * t.s, 0.95 * t.s, t.h + 2.08 * t.s],
    ];
    for (const [r, h, y] of layers) {
      dummy.position.set(t.x, y, t.z);
      dummy.rotation.set(0, rand() * 6.28, 0);
      dummy.scale.set(r, h, r);
      dummy.updateMatrix();
      pineCones.setMatrixAt(pi, dummy.matrix);
      pineCones.setColorAt(pi, new THREE.Color(rand() > 0.5 ? 0x24652c : 0x357f37));
      pi++;
    }
  }
  pineCones.instanceMatrix.needsUpdate = true;
  if (pineCones.instanceColor) pineCones.instanceColor.needsUpdate = true;
  scene.add(pineCones);

  // Low bushes fill the gaps between trunks.
  const bushGeo = new THREE.IcosahedronGeometry(0.6, 0);
  const bushCount = 260;
  const bushes = new THREE.InstancedMesh(bushGeo, M.forestLeaf, bushCount);
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  for (let i = 0; i < bushCount; i++) {
    let x = 0;
    let z = 0;
    let ok = false;
    for (let guard = 0; guard < 60; guard++) {
      const a = rand() * Math.PI * 2;
      const r = 12.4 + rand() * 8.2;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      if (forestAllowedV2(x, z)) {
        ok = true;
        break;
      }
    }
    const s = 0.42 + rand() * 0.7;
    dummy.position.set(ok ? x : 0, ok ? 0.2 + s * 0.3 : -70, ok ? z : 0);
    dummy.rotation.set(rand(), rand() * 6.28, rand());
    dummy.scale.set(ok ? s * 1.25 : 0.001, ok ? s * 0.7 : 0.001, ok ? s : 0.001);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
    bushes.setColorAt(i, new THREE.Color(leafColors[i % leafColors.length]));
  }
  bushes.instanceMatrix.needsUpdate = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  scene.add(bushes);

  // Wildflowers only on the open lawn, never in the sea.
  const flowerGeo = new THREE.SphereGeometry(0.085, 5, 4);
  const flowers = new THREE.InstancedMesh(flowerGeo, M.forestLeaf, 90);
  const flowerColors = [0xffd85c, 0xffa8c8, 0xfff4e2, 0xb68cff];
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    const r = 3.0 + rand() * 14.0;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const onGrass = r < islandGrassRadius(a) - 0.8;
    const skip = !onGrass || isOccupied(x, z, 0.45) || isOnPath(x, z, 0.45);
    const s = 0.7 + rand() * 0.9;
    dummy.position.set(skip ? 0 : x, skip ? -70 : 0.16, skip ? 0 : z);
    dummy.rotation.set(0, rand() * 6.28, 0);
    dummy.scale.setScalar(skip ? 0.001 : s);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    flowers.setColorAt(i, new THREE.Color(flowerColors[i % flowerColors.length]));
  }
  flowers.instanceMatrix.needsUpdate = true;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  scene.add(flowers);

  // A fallen log in the east wood, with mushrooms.
  const log = cyl(scene, 0.25, 0.34, 3.8, 7, M.trunk, 12.6, 0.32, -13.2, {
    rz: Math.PI / 2,
    ry: 0.5,
    cast: true,
    receive: true,
  });
  log.rotation.z = 0.08;
  for (let i = 0; i < 3; i++) {
    const mx = 12.2 + i * 0.55;
    const mz = -12.9 + (i % 2) * 0.4;
    cyl(scene, 0.06, 0.09, 0.22, 6, M.cream, mx, 0.11, mz, { cast: true });
    const cap = sphere(scene, 0.2, 9, M.roofRed, mx, 0.26, mz, { cast: true });
    cap.scale.y = 0.5;
  }

  // Vines and roots over the cliff edge, kept clear of the fall.
  for (let i = 0; i < 14; i++) {
    const a = 0.06 * Math.PI + rand() * 0.88 * Math.PI;
    if ((a > 0.08 && a < 0.56) || (a > 0.94 && a < 1.24)) continue;
    const r = islandEdgeRadius(a) + 0.16;
    const len = 2.2 + rand() * 2.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const startY = -1.0 - rand() * 0.5;
    cyl(scene, 0.035, 0.07, len, 5, rand() > 0.35 ? M.leafDark : M.woodDark, x, startY - len / 2, z, {
      rx: 0.04,
      rz: (rand() - 0.5) * 0.12,
      cast: true,
    });
    for (let j = 0; j < 3; j++) {
      const ly = startY - 0.55 - j * (len / 3.5);
      const leaf = sphere(scene, 0.18 + rand() * 0.13, 6, M.leafDark, x + (rand() - 0.5) * 0.3, ly, z + (rand() - 0.5) * 0.3, {
        cast: false,
      });
      leaf.scale.set(1.35, 0.62, 1.05);
    }
  }

  // Loose rock under the floating base.
  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2;
    const r = 8.0 + rand() * 5.0;
    const s = 0.35 + rand() * 0.8;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), M.stoneDeep);
    rock.position.set(Math.cos(a) * r, -7.9 - rand() * 1.8, Math.sin(a) * r);
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.castShadow = true;
    scene.add(rock);
  }
}

/* Dock, rowboat, sailboat and a small lighthouse: all scenery, no UI. */
function buildMaritime() {
  // Dock reaches from the sandy beach into the bay at about 6:30.
  const dockAngle = 144 * DEG;
  const dock = new THREE.Group();
  dock.position.set(Math.cos(dockAngle) * 18.7, -1.02, Math.sin(dockAngle) * 18.7);
  dock.rotation.y = Math.PI / 2 - dockAngle;
  dock.scale.setScalar(0.86);
  scene.add(dock);

  // Main walkway.
  for (let i = 0; i < 12; i++) {
    rbox(dock, 2.35, 0.1, 0.44, i % 2 ? M.wood : M.woodLight, 0, 0.02, 0.24 + i * 0.46, {
      r: 0.03,
      cast: true,
      receive: true,
    });
  }
  for (const px of [-1.06, 1.06]) {
    for (let i = 0; i < 4; i++) {
      cyl(dock, 0.1, 0.13, 2.3, 6, M.woodDark, px, -1.06, 0.7 + i * 1.85, { cast: true });
    }
  }
  for (const px of [-1.06, 1.06]) {
    box(dock, 0.11, 0.11, 5.2, M.woodDark, px, 0.8, 2.9, { cast: true });
    for (let i = 0; i < 3; i++) {
      box(dock, 0.11, 1.0, 0.11, M.woodDark, px, 0.35, 0.6 + i * 1.75, { cast: true });
    }
  }

  // T-branch at the end of the pier.
  for (let i = 0; i < 11; i++) {
    const off = -2.2 + i * 0.44;
    rbox(dock, 0.42, 0.1, 2.05, i % 2 ? M.woodLight : M.wood, off, 0.02, 5.95, {
      r: 0.03,
      cast: true,
      receive: true,
    });
  }
  for (const px of [-2.35, 2.35]) {
    for (const pz of [5.25, 6.65]) {
      cyl(dock, 0.1, 0.13, 2.3, 6, M.woodDark, px, -1.06, pz, { cast: true });
    }
    box(dock, 0.12, 1.05, 0.12, M.woodDark, px, 0.42, 6.7, { cast: true });
    sphere(dock, 0.14, 6, M.woodDark, px, 0.98, 6.7, { cast: false });
  }

  // Lamp at the end of the pier.
  cyl(dock, 0.09, 0.11, 2.2, 6, M.woodDark, 1.06, 1.1, 4.95, { cast: true });
  sphere(dock, 0.27, 8, M.lamp, 1.06, 2.3, 4.95, { cast: false, receive: false });
  glowSprite(dock, "#ffe29a", 1.0, 1.06, 2.32, 4.95, 0.12);

  // Rowboat tied beside the T-branch, broadside to the home camera.
  const row = new THREE.Group();
  row.position.set(3.35, -0.5, 6.15);
  row.rotation.y = 0.72;
  row.scale.setScalar(0.9);
  dock.add(row);
  rbox(row, 2.0, 0.38, 0.86, M.woodDark, 0, 0.18, 0, { r: 0.26, outline: true, outlineScale: 1.04 });
  rbox(row, 1.62, 0.16, 0.62, M.wood, 0, 0.38, 0, { r: 0.22 });
  box(row, 0.45, 0.1, 0.58, M.woodLight, -0.55, 0.43, 0, { cast: true });
  box(row, 0.1, 0.08, 2.0, M.wood, 0.2, 0.5, 0.2, { cast: true, ry: 0.14 });

  // A small sailing ship in the lower bay at about 5:20.
  const sail = new THREE.Group();
  sail.position.set(-10.2, -1.52, 23.2);
  sail.rotation.y = -0.26;
  sail.scale.setScalar(1.05);
  scene.add(sail);
  rbox(sail, 3.4, 0.58, 1.2, M.woodDark, 0, 0.16, 0, { r: 0.3, outline: true, outlineScale: 1.03 });
  rbox(sail, 2.7, 0.2, 0.92, M.woodLight, 0, 0.47, 0, { r: 0.2 });
  rbox(sail, 0.8, 0.42, 0.7, M.wood, -1.05, 0.72, 0, { r: 0.1, cast: true });
  cyl(sail, 0.07, 0.09, 4.7, 6, M.wood, 0.1, 2.55, 0, { cast: true });
  box(sail, 1.5, 0.07, 0.07, M.wood, 1.85, 0.64, 0, { cast: true, rz: -0.28 });
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute("position", new THREE.Float32BufferAttribute([
    0.16, 0.8, 0,
    0.16, 4.55, 0,
    1.85, 0.98, 0,
  ], 3));
  sailGeo.computeVertexNormals();
  const sailMesh = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({
    color: 0xfff4da,
    roughness: 0.85,
    side: THREE.DoubleSide,
  }));
  sailMesh.castShadow = true;
  sail.add(sailMesh);
  const jibGeo = new THREE.BufferGeometry();
  jibGeo.setAttribute("position", new THREE.Float32BufferAttribute([
    0.16, 4.35, 0,
    -1.7, 1.02, 0,
    0.16, 1.12, 0,
  ], 3));
  jibGeo.computeVertexNormals();
  const jibMesh = new THREE.Mesh(jibGeo, new THREE.MeshStandardMaterial({
    color: 0xfff9ea,
    roughness: 0.88,
    side: THREE.DoubleSide,
  }));
  jibMesh.castShadow = true;
  sail.add(jibMesh);
  box(sail, 0.06, 0.06, 0.75, M.wood, 0.15, 4.42, 0, { cast: true });
  const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 3), M.roofRed);
  pennant.rotation.z = -Math.PI / 2;
  pennant.position.set(0.42, 4.5, 0);
  sail.add(pennant);

  // Wake and foam around the hull.
  const wake = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 24),
    new THREE.MeshBasicMaterial({
      color: 0xeaffff,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.scale.set(1.4, 0.5, 1);
  wake.position.set(0.25, -0.09, 0);
  sail.add(wake);
  for (let i = 0; i < 6; i++) {
    const foam = sphere(
      scene,
      0.12 + rand() * 0.16,
      6,
      M.foam,
      -14.0 - rand() * 2.2,
      -1.635,
      23.6 + (rand() - 0.5) * 2.0,
      { cast: false, receive: false }
    );
    foam.scale.set(1.6, 0.14, 0.8);
  }

  // Bright buoys mark the bay.
  const buoyMat = new THREE.MeshStandardMaterial({ color: 0xffb63a, roughness: 0.6 });
  for (const [bx, bz, mat] of [
    [-16.2, 21.6, buoyMat],
    [-4.9, 23.2, M.roofRed],
    [15.0, 20.4, buoyMat],
    [7.6, 25.6, M.roofRed],
  ]) {
    cyl(scene, 0.16, 0.22, 0.4, 6, M.woodDark, bx, -1.44, bz, { cast: true });
    sphere(scene, 0.13, 6, mat, bx, -1.2, bz, { cast: false, receive: false });
  }

  // Lighthouse on a rock islet offshore at about 7:20.
  const LIGHT_X = -24.4;
  const LIGHT_Z = 4.4;
  const light = new THREE.Group();
  light.position.set(LIGHT_X, -1.5, LIGHT_Z);
  light.scale.setScalar(0.92);
  scene.add(light);

  const islet = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.85, 1.75, 9), M.stoneDeep);
  islet.position.set(0, -0.18, 0);
  islet.castShadow = true;
  islet.receiveShadow = true;
  light.add(islet);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.95, 0.2, 9),
    new THREE.MeshStandardMaterial({ color: 0x5d7f3f, roughness: 1, flatShading: true })
  );
  cap.position.set(0, 0.73, 0);
  cap.castShadow = true;
  cap.receiveShadow = true;
  light.add(cap);

  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.35;
    const rad = 1.3 + rand() * 1.7;
    const s = 0.4 + rand() * 0.55;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      i % 3 ? M.stoneDark : M.rock
    );
    rock.position.set(Math.cos(a) * rad, -0.5 + rand() * 0.85, Math.sin(a) * rad);
    rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
    rock.scale.y = 0.75;
    rock.castShadow = true;
    rock.receiveShadow = true;
    light.add(rock);
  }

  cyl(light, 0.78, 1.05, 4.2, 10, M.cream, 0, 2.15, 0, {
    cast: true,
    outline: true,
    outlineScale: 1.02,
  });
  cyl(light, 1.12, 1.12, 0.22, 10, M.stoneDark, 0, 4.28, 0, { cast: true });
  for (const y of [0.5, 1.95, 3.4]) {
    cyl(light, 0.82, 1.0, 0.34, 10, M.roofRed, 0, y, 0, { cast: true });
  }
  cyl(light, 0.6, 0.6, 0.8, 8, M.window, 0, 4.72, 0, { cast: false });
  cyl(light, 0.86, 0.86, 0.12, 8, M.roofRedDark, 0, 5.14, 0, { cast: true });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.86, 0.95, 8), M.roofRed);
  roof.position.set(0, 5.66, 0);
  roof.castShadow = true;
  light.add(roof);
  box(light, 0.4, 0.66, 0.14, M.woodDark, 0, 0.6, 0.96, { cast: false });
  box(light, 0.24, 0.34, 0.12, M.window, 0.72, 2.75, 0.42, { cast: false, ry: 0.9 });
  glowSprite(scene, "#ffe29a", 1.7, LIGHT_X, 3.25, LIGHT_Z, 0.16);

  // Foam collars around the islet.
  for (const [r, op] of [[3.4, 0.34], [4.2, 0.2], [5.0, 0.12]]) {
    const mat = M.seaFoam.clone();
    mat.opacity = op;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.26, 36), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(LIGHT_X, -1.629, LIGHT_Z);
    scene.add(ring);
  }
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2;
    const rr = 3.1 + rand() * 1.9;
    const foam = sphere(
      scene,
      0.12 + rand() * 0.16,
      6,
      M.foam,
      LIGHT_X + Math.cos(a) * rr,
      -1.63,
      LIGHT_Z + Math.sin(a) * rr,
      { cast: false, receive: false }
    );
    foam.scale.set(1.6, 0.14, 0.9);
  }

  // Cargo waiting on the sand: crates and barrels by the pier and the
  // river mouth, matching the reference's lived-in beach.
  const propCrate = (x, z, s, ry) => {
    const g = new THREE.Group();
    g.position.set(x, 0.0, z);
    g.rotation.y = ry;
    g.scale.setScalar(s);
    scene.add(g);
    rbox(g, 0.72, 0.72, 0.72, M.wood, 0, 0.36, 0, { r: 0.05, outline: true });
    box(g, 0.76, 0.08, 0.76, M.woodDark, 0, 0.52, 0, { cast: false });
    box(g, 0.08, 0.74, 0.76, M.woodDark, 0, 0.36, 0, { cast: false });
  };
  const propBarrel = (x, z, s) => {
    const g = new THREE.Group();
    g.position.set(x, 0.0, z);
    g.scale.setScalar(s);
    scene.add(g);
    cyl(g, 0.3, 0.34, 0.72, 12, M.wood, 0, 0.36, 0, { outline: true, outlineScale: 1.04 });
    for (const y of [0.16, 0.56]) {
      torus(g, 0.33, 0.03, M.woodDark, 0, y, 0, { rx: Math.PI / 2 });
    }
  };
  propCrate(-13.15, 13.35, 0.95, 0.3);
  propCrate(-12.25, 13.85, 0.78, -0.5);
  propBarrel(-14.15, 12.55, 0.95);
  propCrate(1.55, 16.55, 0.85, 0.15);
  propBarrel(2.55, 16.0, 0.9);
  propBarrel(-2.1, 17.35, 0.8);

  // Palms frame the beach above and beside the dock.
  makePalm(-17.2, 9.1, 0.62, 0);
  makePalm(-12.4, 15.3, 0.58, 0);
  makePalm(-9.8, 16.4, 0.5, 0);
  makePalm(-6.5, 17.2, 0.56, 0);
  makePalm(0.6, 18.9, 0.5, 0);
}

function buildWilds() {
  buildPoolAndRiver();
  buildWaterfall();
  buildForestFloorV2();
  buildForestV2();
  buildMaritime();
}

/* ------------------------------------------------------------------ */
/*  Trees                                                              */
/* ------------------------------------------------------------------ */

function makeTree(x, z, scale = 1, outlined = false, yBase = 0) {
  const g = new THREE.Group();
  g.position.set(x, yBase, z);
  g.scale.setScalar(scale);
  scene.add(g);
  cyl(g, 0.16, 0.24, 1.5, 7, M.trunk, 0, 0.75, 0, {
    r: 0.06,
    outline: outlined,
    outlineScale: 1.04,
  });
  const f1 = sphere(g, 0.95, 9, M.leaf, 0, 1.85, 0, {
    outline: outlined,
    outlineScale: 1.035,
  });
  f1.scale.set(1, 0.95, 1);
  sphere(g, 0.7, 8, M.leafLight, -0.48, 1.55, 0.2, { outline: false });
  sphere(g, 0.62, 8, M.leafDark, 0.52, 1.5, -0.16, { outline: false });
  return g;
}

function buildTrees() {
  // Inside the plot, deliberately placed so every building keeps a clean silhouette.
  makeTree(14.2, -13.6, 0.95, true);
  makeTree(13.0, 8.2, 0.62, true);
  makeTree(-14.3, 2.8, 0.88, true);
  makeTree(5.0, -11.8, 0.58, false);
  makeTree(-5.0, -11.8, 0.55, false);
  makeTree(13.8, -4.4, 0.55, false);
  makeTree(-14.1, 8.5, 0.52, false);
}

/* ------------------------------------------------------------------ */
/*  Small props                                                        */
/* ------------------------------------------------------------------ */

function makeFence(x, z, rotY, segments = 3) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  const span = segments * 0.85;
  for (let i = 0; i <= segments; i++) {
    rbox(g, 0.14, 0.88, 0.14, M.wood, i * 0.85 - span / 2, 0.44, 0, {
      r: 0.03,
      outline: true,
      outlineScale: 1.05,
    });
  }
  box(g, span + 0.28, 0.1, 0.1, M.wood, 0, 0.64, 0, { cast: true });
  box(g, span + 0.28, 0.1, 0.1, M.wood, 0, 0.38, 0, { cast: true });
}

function makeMarketStall(x, z, rotY, accentMat) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);

  rbox(g, 2.3, 0.82, 1.15, M.wood, 0, 0.41, 0, { r: 0.05, outline: true, outlineScale: 1.03 });
  box(g, 2.45, 0.1, 1.3, M.woodDark, 0, 0.89, 0, { cast: true });
  for (const sx of [-1.06, 1.06]) {
    for (const sz of [-0.5, 0.5]) {
      rbox(g, 0.11, 2.35, 0.11, M.woodDark, sx, 1.18, sz, { r: 0.02 });
    }
  }

  // Striped awning.
  for (let i = 0; i < 6; i++) {
    box(
      g,
      2.45 / 6,
      0.1,
      1.6,
      i % 2 ? accentMat : M.cream,
      -1.06 + (i + 0.5) * (2.45 / 6),
      2.38,
      0,
      { cast: true }
    );
  }
  box(g, 2.45, 0.2, 0.07, accentMat, 0, 2.27, 0.8, { cast: false });

  // Goods on the counter.
  for (let i = 0; i < 4; i++) {
    sphere(g, 0.14, 7, i % 2 ? M.gold : M.roofRed, -0.78 + i * 0.52, 1.02, 0.18, {
      cast: false,
    });
  }
  rbox(g, 0.62, 0.62, 0.62, M.wood, 1.52, 0.31, 0.35, {
    r: 0.04,
    outline: true,
    outlineScale: 1.04,
  });
}

function buildProps() {
  // Crates beside the workshop.
  const crate = new THREE.Group();
  crate.position.set(-5.9, 0, 6.3);
  crate.rotation.y = 0.28;
  scene.add(crate);
  rbox(crate, 0.75, 0.75, 0.75, M.wood, 0, 0.38, 0, { r: 0.05, outline: true });
  box(crate, 0.78, 0.08, 0.78, M.woodDark, 0, 0.55, 0, { cast: false });
  box(crate, 0.08, 0.78, 0.78, M.woodDark, 0, 0.38, 0, { cast: false });

  // Barrel.
  const barrel = new THREE.Group();
  barrel.position.set(-10.9, 0, 10.8);
  scene.add(barrel);
  cyl(barrel, 0.34, 0.38, 0.78, 12, M.wood, 0, 0.39, 0, { outline: true, outlineScale: 1.04 });
  for (const y of [0.2, 0.58]) {
    torus(barrel, 0.37, 0.035, M.woodDark, 0, y, 0, { rx: Math.PI / 2 });
  }

  // Fence on the meadow side of the gem box, clear of the river.
  const fence = new THREE.Group();
  fence.position.set(7.9, 0, 12.9);
  fence.rotation.y = 0.55;
  scene.add(fence);
  for (let i = 0; i < 4; i++) {
    rbox(fence, 0.16, 0.9, 0.16, M.wood, i * 0.9, 0.45, 0, { r: 0.03, outline: true, outlineScale: 1.05 });
  }
  box(fence, 3.0, 0.12, 0.12, M.wood, 1.35, 0.68, 0, { cast: true });
  box(fence, 3.0, 0.12, 0.12, M.wood, 1.35, 0.4, 0, { cast: true });

  // A tiny flower bed by the Town Hall.
  const bed = new THREE.Group();
  bed.position.set(4.8, 0, -1.2);
  scene.add(bed);
  rbox(bed, 2.3, 0.22, 1.1, M.woodDark, 0, 0.11, 0, { r: 0.08 });
  for (let i = 0; i < 6; i++) {
    const fx = -0.9 + i * 0.36;
    cyl(bed, 0.025, 0.025, 0.28, 4, M.leafDark, fx, 0.28, 0, { cast: false });
    sphere(bed, 0.1, 7, i % 2 ? M.gold : M.roofRed, fx, 0.44, 0, { cast: false });
  }

  // Warm lanterns mark the crossings without adding a second light source.
  const lanternGlow = new THREE.MeshBasicMaterial({ color: 0xffe6a3 });
  for (const [x, z, h] of [
    [2.05, 5.2, 1.55],
    [-2.05, 9.8, 1.45],
    [8.9, 8.6, 1.5],
    [-5.0, 6.5, 1.35],
    [2.4, 3.3, 1.5],
    [-1.9, 8.2, 1.4],
    [2.6, 12.4, 1.45],
  ]) {
    const post = new THREE.Group();
    post.position.set(x, 0, z);
    scene.add(post);
    cyl(post, 0.055, 0.085, h, 5, M.woodDark, 0, h / 2, 0, { outline: true, outlineScale: 1.08 });
    box(post, 0.25, 0.07, 0.25, M.woodDark, 0, h + 0.02, 0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 5), lanternGlow);
    lamp.position.y = h + 0.12;
    post.add(lamp);
  }

  // Rail fences frame the south approach without closing it.
  makeFence(2.62, 7.9, Math.PI / 2, 2);
  makeFence(2.62, 11.1, Math.PI / 2, 2);

  // Two small market stalls: one off the east path, one on the open
  // foreground lawn so the south-west side of the island is not bare.
  makeMarketStall(-16.2, 8.2, -0.55, M.roofRed);
  makeMarketStall(11.2, 8.4, -0.2, M.roofBlue);

  // Boulders frame the Clan Castle's rocky side.
  for (const [x, z, s] of [
    [13.4, 11.4, 1.0],
    [13.5, 9.2, 0.85],
    [12.7, 6.8, 0.75],
    [8.3, 12.4, 0.95],
    [7.1, 11.2, 0.65],
  ]) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), M.rock);
    rock.position.set(x, s * 0.5, z);
    rock.rotation.set(rand(), rand(), rand());
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // Clusters of colour at the edge of the main lawn.
  for (const [x, z] of [
    [2.8, 2.7],
    [-3.0, 4.2],
    [6.2, -1.8],
    [-6.4, 2.5],
  ]) {
    for (let i = 0; i < 5; i++) {
      const fx = x + (rand() - 0.5) * 0.7;
      const fz = z + (rand() - 0.5) * 0.7;
      cyl(scene, 0.018, 0.022, 0.24, 4, M.leafDark, fx, 0.12, fz, { cast: false });
      sphere(scene, 0.085, 6, i % 3 === 0 ? M.gold : i % 3 === 1 ? M.roofRed : M.cream, fx, 0.26, fz, {
        cast: false,
        receive: false,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Town Hall                                                          */
/* ------------------------------------------------------------------ */

function buildTownHall() {
  const g = new THREE.Group();
  g.position.set(0, 0, 0);
  scene.add(g);

  // 1. Massive Stepped Obsidian Plinth & Base Foundation
  // Ground Tier
  rbox(g, 6.8, 0.45, 6.4, M.obsidianDark, 0, 0.22, 0, {
    r: 0.16,
    outline: true,
    outlineScale: 1.02,
  });
  // Upper Plinth Tier
  rbox(g, 5.9, 0.38, 5.5, M.obsidian, 0, 0.62, 0, {
    r: 0.14,
    outline: true,
    outlineScale: 1.02,
  });

  // Heavy Gold Corner Anchor Blocks with Pyramid Spikes
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      rbox(g, 0.95, 0.44, 0.95, M.gigaGold, sx * 2.9, 0.42, sz * 2.7, {
        r: 0.08,
        outline: true,
      });
      cone(g, 0.35, 0.45, 4, M.gigaGoldDark, sx * 2.9, 0.84, sz * 2.7, { outline: true });
    }
  }

  // Glowing Arcane Energy Channels inset into the foundation floor
  box(g, 4.8, 0.06, 0.14, M.energyRune, 0, 0.82, 2.7, { cast: false });
  box(g, 4.8, 0.06, 0.14, M.energyRune, 0, 0.82, -2.7, { cast: false });
  box(g, 0.14, 0.06, 5.2, M.energyRune, 2.9, 0.82, 0, { cast: false });
  box(g, 0.14, 0.06, 5.2, M.energyRune, -2.9, 0.82, 0, { cast: false });

  // 2. Ceremonial Approach & Royal Crimson Carpet
  for (let i = 0; i < 4; i++) {
    rbox(g, 2.5 - i * 0.14, 0.16, 0.55, M.stoneDark, 0, 0.1 + i * 0.15, 2.85 + i * 0.38, {
      r: 0.04,
      outline: i === 0,
    });
  }
  // Crimson carpet runner
  box(g, 1.45, 0.04, 2.5, M.crimsonCarpet, 0, 0.46, 3.3, { rx: -0.22, cast: false });
  // Gold carpet borders
  box(g, 0.08, 0.05, 2.5, M.gigaGold, -0.74, 0.46, 3.3, { rx: -0.22, cast: false });
  box(g, 0.08, 0.05, 2.5, M.gigaGold, 0.74, 0.46, 3.3, { rx: -0.22, cast: false });

  // 3. Central Fortress Citadel (Tier 1 Keep)
  rbox(g, 5.1, 2.7, 4.7, M.obsidianDark, 0, 2.12, 0, {
    r: 0.16,
    outline: true,
    outlineScale: 1.025,
  });

  // Reinforced Titanium/Obsidian Armor Bands
  box(g, 5.16, 0.16, 4.76, M.gigaGoldDark, 0, 1.25, 0, { cast: false });
  box(g, 5.16, 0.16, 4.76, M.gigaGoldDark, 0, 2.45, 0, { cast: false });

  // Glowing vertical energy rune conduits carved on fortress walls
  for (const sx of [-1, 1]) {
    box(g, 0.12, 2.3, 0.08, M.energyRune, sx * 1.85, 2.15, 2.38, { cast: false });
    box(g, 0.12, 2.3, 0.08, M.energyRune, sx * 1.85, 2.15, -2.38, { cast: false });
    box(g, 0.08, 2.3, 0.12, M.energyRune, sx * 2.58, 2.15, 1.3, { cast: false });
    box(g, 0.08, 2.3, 0.12, M.energyRune, sx * 2.58, 2.15, -1.3, { cast: false });
  }

  // 4 Corner Fortified Lookout Bastions
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Octagonal Bastion Pillar
      cyl(g, 0.76, 0.86, 3.5, 8, M.obsidian, sx * 2.5, 2.35, sz * 2.3, {
        outline: true,
        outlineScale: 1.03,
      });
      // Mid-level Gold Girdle Ring
      torus(g, 0.82, 0.08, M.gigaGold, sx * 2.5, 2.25, sz * 2.3);
      // Gilded Crenellated Bastion Cap
      cyl(g, 0.92, 0.8, 0.55, 8, M.gigaGoldDark, sx * 2.5, 4.15, sz * 2.3, { outline: true });
      // Glowing Cyan Eye Embrasures
      sphere(g, 0.16, 8, M.gigaCrystal, sx * 2.5, 4.15, sz * 2.3 + 0.82 * sz, { cast: false });
      // Conical Spire in Royal Navy
      cone(g, 0.95, 1.55, 8, M.roofBlueDark, sx * 2.5, 5.05, sz * 2.3, { outline: true });
      // Gilded Spire Ridge Tip
      cone(g, 0.38, 0.75, 8, M.gigaGold, sx * 2.5, 5.5, sz * 2.3, { outline: true });
      // Lightning Rod Needle
      cyl(g, 0.035, 0.05, 0.85, 6, M.gigaGold, sx * 2.5, 6.05, sz * 2.3, { cast: false });
      // Apex Glowing Energy Sphere
      sphere(g, 0.1, 8, M.gigaCrystal, sx * 2.5, 6.52, sz * 2.3, { cast: false });
    }
  }

  // 4. Fortified Giga Portcullis & Gateway
  rbox(g, 1.85, 2.25, 0.55, M.obsidianDark, 0, 1.62, 2.3, { r: 0.1 });
  rbox(g, 0.32, 2.35, 0.38, M.gigaGoldDark, -0.98, 1.58, 2.36, { r: 0.05 });
  rbox(g, 0.32, 2.35, 0.38, M.gigaGoldDark, 0.98, 1.58, 2.36, { r: 0.05 });
  rbox(g, 2.28, 0.36, 0.38, M.gigaGold, 0, 2.76, 2.36, { r: 0.05, outline: true });

  // Portcullis Iron Grille Spikes
  for (const gx of [-0.6, -0.3, 0, 0.3, 0.6]) {
    cyl(g, 0.038, 0.038, 1.95, 6, M.gigaGoldDark, gx, 1.52, 2.36);
  }
  for (const gy of [0.95, 1.5, 2.05]) {
    box(g, 1.55, 0.065, 0.055, M.gigaGoldDark, 0, gy, 2.38);
  }

  // Royal Lion / Titan Crest above Gate
  sphere(g, 0.3, 8, M.gigaGold, 0, 2.78, 2.55, { cast: false });
  sphere(g, 0.07, 6, M.gigaCrystal, -0.11, 2.82, 2.75, { cast: false });
  sphere(g, 0.07, 6, M.gigaCrystal, 0.11, 2.82, 2.75, { cast: false });

  // Interactive Town Hall Banner
  plane(
    g,
    2.4,
    0.64,
    new THREE.MeshBasicMaterial({ map: bannerTexture("TOWN HALL 18", "AGILE TITAN CITADEL") }),
    0,
    3.32,
    2.4
  );

  // Twin Arcane Energy Torches / Braziers flanking the Gate
  for (const lx of [-1.55, 1.55]) {
    cyl(g, 0.14, 0.18, 1.5, 8, M.obsidian, lx, 1.45, 2.45, { outline: true });
    cyl(g, 0.3, 0.18, 0.35, 8, M.gigaGold, lx, 2.25, 2.45, { outline: true });
    sphere(g, 0.12, 8, M.gigaCrystal, lx, 2.35, 2.45, { cast: false });
    glowSprite(g, "#00f5ff", 1.4, lx, 2.4, 2.6, 0.6);
  }

  // 5. Tier 2 Upper Promenade & Crenellated Battlements
  rbox(g, 4.5, 0.32, 4.1, M.obsidian, 0, 3.58, 0, { r: 0.08, outline: true });

  // Gold Crenellations around the upper deck
  for (const bx of [-1.55, -0.78, 0.78, 1.55]) {
    rbox(g, 0.48, 0.38, 0.2, M.gigaGold, bx, 3.88, 2.1, { r: 0.04, outline: true });
    rbox(g, 0.48, 0.38, 0.2, M.gigaGold, bx, 3.88, -2.1, { r: 0.04, outline: true });
  }

  // Upper Citadel Chamber
  rbox(g, 3.5, 1.95, 3.1, M.obsidianDark, 0, 4.58, 0, {
    r: 0.12,
    outline: true,
    outlineScale: 1.025,
  });

  // Tactical Command Screen / Monitor on Front
  rbox(g, 1.95, 1.18, 0.24, M.gigaGold, 0, 4.58, 1.6, { r: 0.06, outline: true });
  plane(
    g,
    1.7,
    0.98,
    new THREE.MeshBasicMaterial({ map: monitorTexture() }),
    0,
    4.58,
    1.73
  );
  rbox(g, 2.15, 0.12, 0.3, M.gigaGoldDark, 0, 5.22, 1.62, { r: 0.03 });

  // 6. Tier 3 Stepped Gemstone Pagoda Roof
  // Lower Pagoda Tier
  rbox(g, 4.2, 0.34, 3.8, M.roofBlueDark, 0, 5.62, 0, {
    r: 0.06,
    outline: true,
    outlineScale: 1.02,
  });
  rbox(g, 4.35, 0.12, 3.95, M.gigaGold, 0, 5.48, 0, { r: 0.04 });

  // Mid Pagoda Tier
  rbox(g, 3.3, 0.45, 3.0, M.roofBlue, 0, 5.96, 0, {
    r: 0.08,
    outline: true,
    outlineScale: 1.02,
  });
  rbox(g, 3.45, 0.12, 3.15, M.gigaGold, 0, 5.76, 0, { r: 0.04 });

  // Upper Pagoda Tier
  rbox(g, 2.4, 0.5, 2.2, M.roofBlueDark, 0, 6.38, 0, {
    r: 0.08,
    outline: true,
    outlineScale: 1.02,
  });
  rbox(g, 2.55, 0.12, 2.35, M.gigaGold, 0, 6.16, 0, { r: 0.04 });

  // High Clan Battle Banners
  makeFlag(g, -2.15, 6.45, 0.9, 0.85, 0.52, M.roofBlue, 0.25);
  makeFlag(g, 2.15, 6.45, 0.9, 0.85, 0.52, M.roofRed, -0.25);

  // 7. Tier 4 Apex Giga-Altar & Floating Arcane Core
  // Golden circular altar
  cyl(g, 1.3, 1.5, 0.42, 16, M.gigaGold, 0, 6.78, 0, { outline: true, outlineScale: 1.03 });
  torus(g, 1.1, 0.07, M.energyRune, 0, 7.0, 0, { rx: Math.PI / 2 });

  // 4 Golden Dragon Talons / Focusing Pylons
  for (const ax of [-0.85, 0.85]) {
    for (const az of [-0.85, 0.85]) {
      rbox(g, 0.28, 0.65, 0.28, M.gigaGold, ax, 7.15, az, { r: 0.06, outline: true });
      cyl(g, 0.11, 0.15, 0.88, 6, M.gigaGold, ax * 0.85, 7.68, az * 0.85, {
        rx: az * -0.28,
        rz: ax * 0.28,
        outline: true,
      });
      cone(g, 0.12, 0.48, 6, M.gigaGoldDark, ax * 0.7, 8.1, az * 0.7, {
        rx: az * -0.52,
        rz: ax * 0.52,
      });
      sphere(g, 0.075, 6, M.energyRune, ax * 0.58, 8.22, az * 0.58, { cast: false });
    }
  }

  // Floating Giga Arcane Crystal Core Group
  const crystalGroup = new THREE.Group();
  crystalGroup.position.set(0, 8.0, 0);
  g.add(crystalGroup);

  // Faceted Octahedron Gem Core
  const coreGeo = new THREE.OctahedronGeometry(0.85, 0);
  const coreMesh = new THREE.Mesh(coreGeo, M.gigaCrystal);
  coreMesh.castShadow = false;
  crystalGroup.add(coreMesh);
  addOutline(coreMesh, 1.04);

  // Inner blazing gold energy sphere
  const innerSphere = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12), M.gigaGold);
  innerSphere.castShadow = false;
  crystalGroup.add(innerSphere);

  // Top & bottom golden crystal spire caps
  cone(crystalGroup, 0.3, 0.58, 6, M.gigaGold, 0, 0.9, 0, { rx: 0 });
  cone(crystalGroup, 0.3, 0.58, 6, M.gigaGold, 0, -0.9, 0, { rx: Math.PI });

  thAnimations.crystal = crystalGroup;

  // Concentric Orbital Energy Rings
  const ring1 = torus(g, 1.35, 0.052, M.gigaGold, 0, 8.0, 0, { rx: Math.PI / 4 });
  thAnimations.ring1 = ring1;

  const ring2 = torus(g, 1.62, 0.04, M.energyRune, 0, 8.0, 0, { rx: -Math.PI / 4 });
  thAnimations.ring2 = ring2;

  // Dynamic Cyan Light illuminating the Citadel
  const thLight = new THREE.PointLight(0x00f5ff, 3.0, 15, 1.1);
  thLight.position.set(0, 8.0, 0);
  g.add(thLight);
  thAnimations.light = thLight;

  // Intense Arcane Ethereal Glow Halos
  glowSprite(g, "#00f5ff", 4.5, 0, 8.0, 0, 0.65);
  glowSprite(g, "#ffd700", 2.4, 0, 8.0, 0, 0.4);

  return {
    group: g,
    id: "townhall",
    label: "Town Hall 18",
    sub: "Agile Titan Citadel",
    level: 18,
    anchor: new THREE.Vector3(0, 8.8, 0),
    focus: new THREE.Vector3(0, 2.5, 0),
    open: openTownhall,
  };
}

/* ------------------------------------------------------------------ */
/*  Builder workshop                                                   */
/* ------------------------------------------------------------------ */

function buildWorkshop(x, z) {
  const g = buildingGroup(x, z, 0.05);

  // Stone footing and timber workshop shell.
  rbox(g, 5.2, 0.42, 4.6, M.stoneDark, 0, 0.21, 0, {
    r: 0.12,
    outline: true,
    outlineScale: 1.025,
  });
  rbox(g, 4.5, 1.05, 3.8, M.stone, 0, 0.92, 0, {
    r: 0.1,
    outline: true,
    outlineScale: 1.025,
  });
  rbox(g, 4.25, 1.5, 3.55, M.cream, 0, 2.18, 0, {
    r: 0.1,
    outline: true,
    outlineScale: 1.03,
  });

  // Timber framing.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      rbox(g, 0.19, 2.5, 0.19, M.woodDark, sx * 2.02, 1.55, sz * 1.68, { r: 0.03 });
    }
  }
  box(g, 4.35, 0.18, 3.65, M.woodDark, 0, 1.52, 0, { cast: true });
  box(g, 4.35, 0.16, 3.65, M.woodDark, 0, 2.87, 0, { cast: true });

  // Roof.
  const roofAngle = Math.atan2(1.35, 2.0);
  const roofDepth = Math.hypot(2.0, 1.35);
  for (const side of [-1, 1]) {
    rbox(g, 5.05, 0.22, roofDepth, M.roofBrown, 0, 3.48, side * 1.02, {
      r: 0.04,
      rx: side * roofAngle,
      outline: true,
      outlineScale: 1.025,
    }).castShadow = true;
  }
  rbox(g, 5.1, 0.17, 0.34, M.roofBrownDark, 0, 4.12, 0, { r: 0.04, outline: true });
  rbox(g, 4.95, 0.18, 0.4, M.roofBrownDark, 0, 2.98, 2.18, { r: 0.03 });

  // Open work bay with a warm interior.
  rbox(g, 1.55, 1.6, 0.16, M.woodDark, 0, 1.05, 1.82, {
    r: 0.04,
    outline: true,
    outlineScale: 1.04,
  });
  plane(
    g,
    1.35,
    1.4,
    new THREE.MeshBasicMaterial({ color: 0x3a2718 }),
    -0.0,
    1.05,
    1.93
  );
  box(g, 1.25, 0.16, 0.55, M.woodLight, -0.0, 0.86, 1.82, { cast: false });
  box(g, 0.7, 0.06, 0.4, M.window, 0.05, 0.96, 1.8, { cast: false });
  glowSprite(g, "#ffca72", 1.3, 0, 1.15, 2.05, 0.22);

  // Two blueprints pinned by the door.
  for (const bx of [-1.65, 1.65]) {
    rbox(g, 0.62, 0.8, 0.1, M.woodDark, bx, 1.65, 1.78, { r: 0.02 });
    plane(
      g,
      0.5,
      0.64,
      new THREE.MeshBasicMaterial({ map: blueprintTexture(bx < 0 ? "01" : "11") }),
      bx,
      1.65,
      1.85
    );
  }

  // Big workshop sign.
  addFacadeSign(g, "WORKSHOP", "HACKATHONS + SOLO", 2.72, 1.86, 3.55, 0.56);

  // Chunky gear on the gable (animated)
  const gearGroup = new THREE.Group();
  gearGroup.position.set(1.45, 3.42, 1.84);
  g.add(gearGroup);
  cyl(gearGroup, 0.42, 0.42, 0.12, 16, M.goldDark, 0, 0, 0, { rx: Math.PI / 2, outline: true });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    box(gearGroup, 0.17, 0.17, 0.14, M.gold, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0, { cast: false });
  }
  cyl(gearGroup, 0.16, 0.16, 0.16, 12, M.navy, 0, 0, 0.08, { rx: Math.PI / 2 });
  thAnimations.gears.push(gearGroup);

  // Crane on the right side.
  const crane = new THREE.Group();
  crane.position.set(2.7, 0, -0.2);
  g.add(crane);
  cyl(crane, 0.12, 0.16, 3.5, 7, M.woodDark, 0, 1.75, 0, { outline: true });
  box(crane, 2.5, 0.16, 0.16, M.woodDark, 1.15, 3.4, 0, { cast: true });
  box(crane, 0.14, 0.14, 1.35, M.woodDark, 2.25, 3.22, 0, { cast: true });
  cyl(crane, 0.035, 0.035, 1.55, 5, M.rope || M.woodLight, 2.25, 2.45, 0, { cast: false });
  torus(crane, 0.13, 0.035, M.darkMetal, 2.25, 1.65, 0, { rx: Math.PI / 2 });
  rbox(crane, 0.55, 0.5, 0.55, M.wood, 2.25, 1.25, 0, { r: 0.04, outline: true });
  box(crane, 0.6, 0.08, 0.6, M.woodDark, 2.25, 1.47, 0, { cast: false });

  // Lumber pile, saw blade and workbench outside.
  for (let i = 0; i < 4; i++) {
    const y = 0.18 + (i % 2) * 0.36;
    const zz = 1.45 + Math.floor(i / 2) * 0.34;
    cyl(g, 0.16, 0.16, 2.1, 7, i % 2 ? M.woodLight : M.wood, -2.4, y, zz, {
      rz: Math.PI / 2,
      cast: true,
      outline: true,
    });
  }
  cyl(g, 0.58, 0.58, 0.07, 24, M.stone, -2.7, 0.72, 0.3, {
    rz: 0.26,
    ry: 0.4,
    outline: true,
  });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    box(g, 0.16, 0.14, 0.08, M.stoneDark, -2.7 + Math.cos(a) * 0.65, 0.72 + Math.sin(a) * 0.65, 0.3, {
      cast: false,
    });
  }
  const bench = new THREE.Group();
  bench.position.set(2.25, 0, 1.55);
  bench.rotation.y = -0.18;
  g.add(bench);
  rbox(bench, 1.5, 0.14, 0.7, M.woodLight, 0, 0.82, 0, { r: 0.04, outline: true });
  for (const bx of [-0.58, 0.58]) {
    for (const bz of [-0.24, 0.24]) {
      box(bench, 0.12, 0.75, 0.12, M.woodDark, bx, 0.4, bz, { cast: true });
    }
  }
  plane(
    bench,
    1.0,
    0.42,
    new THREE.MeshBasicMaterial({ map: blueprintTexture("BUILD") }),
    0,
    0.9,
    0.02
  );
  box(bench, 0.4, 0.06, 0.08, M.gold, 0.38, 0.94, 0.12, { cast: false });

  // Chimney and smoke.
  rbox(g, 0.42, 1.15, 0.42, M.stoneDark, -1.65, 3.25, -1.05, {
    r: 0.04,
    outline: true,
    outlineScale: 1.04,
  });
  for (let i = 0; i < 4; i++) {
    const puff = sphere(g, 0.16 + i * 0.02, 7, M.smoke.clone(), -1.65, 4.0 + i * 0.25, -1.05, {
      cast: false,
      receive: false,
    });
    puff.userData.phase = i / 4;
    puff.userData.baseX = -1.65;
    puff.userData.baseY = 4.0;
    puff.userData.baseZ = -1.05;
    smokePuffs.push(puff);
  }

  // A builder at the bench.
  makeBuilder(x + 1.55, z + 2.55, Math.PI * 0.9);

  return {
    group: g,
    id: "workshop",
    label: "Workshop",
    sub: "Few projects of mine",
    level: 11,
    anchor: new THREE.Vector3(x, 4.2, z),
    focus: new THREE.Vector3(x + 0.2, 1.4, z + 1.4),
    open: openWorkshop,
  };
}

/* ------------------------------------------------------------------ */
/*  Laboratory                                                         */
/* ------------------------------------------------------------------ */

function buildLaboratory(x, z) {
  const g = buildingGroup(x, z, -0.06);

  rbox(g, 4.6, 0.34, 4.2, M.stoneDark, 0, 0.17, 0, {
    r: 0.1,
    outline: true,
    outlineScale: 1.025,
  });
  rbox(g, 3.65, 1.65, 3.25, M.cream, 0, 1.15, 0, {
    r: 0.12,
    outline: true,
    outlineScale: 1.03,
  });
  rbox(g, 3.9, 0.2, 3.5, M.woodDark, 0, 2.0, 0, { r: 0.04, outline: true });
  cyl(g, 1.62, 1.72, 0.38, 16, M.elixirDark, 0, 2.2, 0, { outline: true, outlineScale: 1.025 });

  // The potion vat: glass dome, glowing liquid, bubbles.
  const liquid = cyl(g, 1.2, 1.28, 0.8, 16, M.liquid, 0, 2.58, 0, {
    cast: false,
    outline: false,
  });
  liquid.material = M.liquid.clone();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    M.glass
  );
  dome.position.y = 2.55;
  dome.castShadow = false;
  dome.receiveShadow = false;
  g.add(dome);
  torus(g, 1.55, 0.07, M.gold, 0, 2.55, 0, { rx: Math.PI / 2 });
  sphere(g, 0.13, 8, M.gold, 0, 4.16, 0, { cast: false });

  for (let i = 0; i < 6; i++) {
    const b = sphere(g, 0.075 + rand() * 0.06, 7, M.liquid, -0.7 + rand() * 1.4, 2.7 + rand() * 1.0, -0.6 + rand() * 1.2, {
      cast: false,
      receive: false,
    });
    bubbles.push({ mesh: b, phase: rand(), x: b.position.x, z: b.position.z });
  }

  // Side tanks and pipes.
  for (const sx of [-1.45, 1.45]) {
    cyl(g, 0.38, 0.42, 1.35, 10, M.glass, sx, 1.15, 0.98, { cast: false });
    cyl(g, 0.3, 0.34, 1.0, 10, M.liquid, sx, 1.1, 0.98, { cast: false });
    cyl(g, 0.46, 0.46, 0.12, 10, M.goldDark, sx, 1.86, 0.98, { cast: false });
    cyl(g, 0.46, 0.46, 0.12, 10, M.goldDark, sx, 0.45, 0.98, { cast: false });
    box(g, 0.12, 0.12, 1.4, M.darkMetal, sx * 0.9, 1.7, 0.7, { cast: false });
  }

  // Door and windows.
  rbox(g, 0.86, 1.26, 0.14, M.woodDark, 0.75, 0.82, 1.63, {
    r: 0.04,
    outline: true,
    outlineScale: 1.04,
  });
  sphere(g, 0.05, 7, M.gold, 1.02, 0.8, 1.72, { cast: false });
  for (const wx of [-1.12, -0.28]) {
    box(g, 0.55, 0.66, 0.07, M.window, wx, 1.38, 1.64, { cast: false });
    rbox(g, 0.7, 0.8, 0.11, M.woodDark, wx, 1.38, 1.58, { r: 0.03 });
  }

  // Antenna with a glowing sample.
  cyl(g, 0.05, 0.06, 1.8, 6, M.darkMetal, -1.2, 2.95, -0.8, { cast: true });
  sphere(g, 0.17, 8, M.liquid, -1.2, 3.9, -0.8, { cast: false });
  glowSprite(g, "#62ffc2", 1.8, -1.2, 3.9, -0.8, 0.45);

  addFacadeSign(g, "LABORATORY", "SKILLS · TECH TREE", 1.72, 1.64, 1.95, 0.46);

  return {
    group: g,
    id: "lab",
    label: "Laboratory",
    sub: "Skills / Tech tree",
    level: 12,
    anchor: new THREE.Vector3(x, 4.6, z),
    focus: new THREE.Vector3(x, 1.2, z),
  };
}

/* ------------------------------------------------------------------ */
/*  Barracks                                                           */
/* ------------------------------------------------------------------ */

function buildBarracks(x, z) {
  const g = buildingGroup(x, z, 0.07);

  rbox(g, 4.9, 0.34, 4.25, M.stoneDark, 0, 0.17, 0, {
    r: 0.1,
    outline: true,
    outlineScale: 1.025,
  });
  rbox(g, 4.0, 1.5, 3.25, M.wood, 0, 1.1, 0, {
    r: 0.1,
    outline: true,
    outlineScale: 1.03,
  });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      rbox(g, 0.16, 1.5, 0.16, M.woodDark, sx * 1.9, 1.1, sz * 1.55, { r: 0.03 });
    }
  }

  // Gable roof.
  const angle = Math.atan2(1.3, 1.95);
  const slope = Math.hypot(1.95, 1.3);
  for (const side of [-1, 1]) {
    rbox(g, 4.55, 0.24, slope + 0.25, M.roofBrown, 0, 2.5, side * 0.98, {
      r: 0.05,
      rx: side * angle,
      outline: true,
      outlineScale: 1.025,
    });
  }
  rbox(g, 4.65, 0.18, 0.32, M.roofBrownDark, 0, 3.2, 0, { r: 0.05 });

  // Heavy timber gable face at the front.
  const shape = new THREE.Shape();
  shape.moveTo(-2.0, 0);
  shape.lineTo(2.0, 0);
  shape.lineTo(0, 1.28);
  shape.closePath();
  const gable = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }),
    M.cream
  );
  gable.position.set(0, 1.86, 1.86);
  gable.castShadow = true;
  gable.receiveShadow = true;
  addOutline(gable, 1.025);
  g.add(gable);
  addFacadeSign(g, "BARRACKS", "LANGUAGES + TOOLS", 2.35, 1.98, 1.95, 0.46);

  // Door and windows.
  rbox(g, 0.94, 1.35, 0.14, M.woodDark, -0.6, 0.85, 1.66, {
    r: 0.04,
    outline: true,
    outlineScale: 1.04,
  });
  sphere(g, 0.05, 7, M.gold, -0.3, 0.82, 1.75, { cast: false });
  for (const wx of [0.65, 1.35]) {
    box(g, 0.48, 0.58, 0.07, M.window, wx, 1.3, 1.67, { cast: false });
    rbox(g, 0.6, 0.7, 0.1, M.woodDark, wx, 1.3, 1.61, { r: 0.03 });
  }

  // Crossed golden swords crest above the door
  const swordCrest = new THREE.Group();
  swordCrest.position.set(-0.6, 1.85, 1.76);
  g.add(swordCrest);
  box(swordCrest, 0.07, 0.55, 0.04, M.gigaGold, 0, 0, 0, { rz: Math.PI / 4 });
  box(swordCrest, 0.07, 0.55, 0.04, M.gigaGold, 0, 0, 0, { rz: -Math.PI / 4 });
  sphere(swordCrest, 0.09, 8, M.gigaCrystal, 0, 0, 0.04);

  // Training dummy with a target shield, parked on the far side of the
  // front yard so the new path reaches the door without a detour.
  const dummy = new THREE.Group();
  dummy.position.set(-2.55, 0, 1.35);
  g.add(dummy);
  cyl(dummy, 0.07, 0.09, 1.55, 6, M.woodDark, 0, 0.78, 0, { outline: true });
  rbox(dummy, 0.55, 0.55, 0.34, M.straw, 0, 1.25, 0, { r: 0.12, outline: true });
  sphere(dummy, 0.2, 8, M.straw, 0, 1.68, 0, { outline: true });
  box(dummy, 1.15, 0.12, 0.12, M.wood, 0, 1.3, 0.15, { cast: true });
  const targetShield = new THREE.Group();
  targetShield.position.set(0, 1.15, 0.3);
  dummy.add(targetShield);
  torus(targetShield, 0.36, 0.07, M.target, 0, 0, 0);
  torus(targetShield, 0.19, 0.05, M.cream, 0, 0, 0.02);
  sphere(targetShield, 0.08, 7, M.target, 0, 0, 0.04);

  return {
    group: g,
    id: "barracks",
    label: "Barracks",
    sub: "Tech stack",
    level: 11,
    anchor: new THREE.Vector3(x, 4.6, z),
    focus: new THREE.Vector3(x, 1.2, z),
    open: openBarracks,
  };
}

/* ------------------------------------------------------------------ */
/*  Clan Castle                                                        */
/* ------------------------------------------------------------------ */

function buildClanCastle(x, z) {
  const g = buildingGroup(x, z, 0);

  rbox(g, 4.9, 0.4, 4.45, M.stoneDark, 0, 0.2, 0, {
    r: 0.1,
    outline: true,
    outlineScale: 1.025,
  });
  rbox(g, 3.85, 2.5, 3.4, M.stone, 0, 1.45, 0, {
    r: 0.12,
    outline: true,
    outlineScale: 1.03,
  });

  // Crenellations.
  for (let i = 0; i < 5; i++) {
    box(g, 0.58, 0.46, 0.24, M.stone, -1.55 + i * 0.78, 2.82, 1.58, {
      outline: i === 0 || i === 4,
      outlineScale: 1.03,
    });
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      box(g, 0.24, 0.46, 0.55, M.stone, sx * 1.8, 2.82, -0.8 + i * 0.8, { cast: true });
    }
  }

  // Gate and trim.
  rbox(g, 1.35, 1.95, 0.16, M.woodDark, 0, 1.28, 1.72, {
    r: 0.05,
    outline: true,
    outlineScale: 1.04,
  });
  rbox(g, 1.05, 1.62, 0.08, M.wood, 0, 1.28, 1.82, { r: 0.03 });
  for (const sx of [-1, 1]) {
    rbox(g, 0.28, 2.1, 0.3, M.stoneDark, sx * 0.86, 1.3, 1.7, { r: 0.04 });
  }
  rbox(g, 1.95, 0.25, 0.34, M.stoneDark, 0, 2.32, 1.7, { r: 0.04 });

  // Clan Castle Golden Shield Crest above the main gate
  const ccShield = new THREE.Group();
  ccShield.position.set(0, 2.7, 1.82);
  g.add(ccShield);
  rbox(ccShield, 0.65, 0.72, 0.12, M.gigaGold, 0, 0, 0, { r: 0.08, outline: true });
  rbox(ccShield, 0.45, 0.52, 0.08, M.roofRed, 0, 0, 0.06, { r: 0.05 });
  sphere(ccShield, 0.12, 8, M.gigaGold, 0, 0, 0.12);
  box(g, 4.0, 0.1, 0.26, M.gigaGoldDark, 0, 2.6, 1.6);

  // Round tower with a conical roof and a flag.
  cyl(g, 0.9, 1.0, 3.6, 12, M.stone, -2.15, 1.8, 0.7, {
    outline: true,
    outlineScale: 1.03,
  });
  for (const y of [0.9, 2.2]) {
    cyl(g, 0.96, 0.96, 0.16, 12, M.stoneDark, -2.15, y, 0.7, { cast: false });
  }
  cone(g, 1.25, 1.45, 8, M.roofRed, -2.15, 4.3, 0.7, {
    outline: true,
    outlineScale: 1.025,
  });
  makeFlag(g, -2.15, 5.35, 0.7, 0.75, 0.48, M.roofRed, 0.8);

  // Narrow windows.
  for (const wx of [-0.55, 0.55]) {
    box(g, 0.22, 0.75, 0.07, M.window, wx, 1.82, 1.59, { cast: false });
    rbox(g, 0.34, 0.88, 0.1, M.stoneDark, wx, 1.82, 1.53, { r: 0.02 });
  }
  addFacadeSign(g, "CLAN CASTLE", "WORK HISTORY", 2.55, 1.79, 2.15, 0.44);
  sphere(g, 0.15, 8, M.gold, 2.15, 2.82, 1.58, { cast: false });

  return {
    group: g,
    id: "clan",
    label: "Clan Castle",
    sub: "Work experience",
    level: 10,
    anchor: new THREE.Vector3(x, 6.0, z),
    focus: new THREE.Vector3(x, 1.2, z),
    open: openClan,
  };
}

/* ------------------------------------------------------------------ */
/*  Resource stores                                                    */
/* ------------------------------------------------------------------ */

function buildGoldStorage(x, z) {
  const g = buildingGroup(x, z, -0.1);

  rbox(g, 3.75, 0.32, 3.55, M.stoneDark, 0, 0.16, 0, {
    r: 0.1,
    outline: true,
    outlineScale: 1.025,
  });
  rbox(g, 3.05, 0.95, 2.85, M.stone, 0, 0.76, 0, {
    r: 0.1,
    outline: true,
    outlineScale: 1.03,
  });
  cyl(g, 1.3, 1.4, 1.05, 16, M.gold, 0, 1.75, 0, { outline: true, outlineScale: 1.025 });
  for (const y of [1.4, 2.1]) {
    cyl(g, 1.42, 1.42, 0.12, 16, M.goldDark, 0, y, 0, { cast: false });
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2), M.gold);
  dome.position.y = 2.27;
  dome.castShadow = true;
  dome.receiveShadow = true;
  g.add(dome);
  sphere(g, 0.14, 8, M.goldDark, 0, 3.6, 0, { cast: false });

  rbox(g, 0.9, 1.15, 0.14, M.woodDark, 0, 0.73, 1.46, {
    r: 0.04,
    outline: true,
    outlineScale: 1.04,
  });
  sphere(g, 0.05, 7, M.goldDark, 0.28, 0.7, 1.55, { cast: false });

  for (let i = 0; i < 3; i++) {
    const cx = 1.8 + (i % 2) * 0.35;
    const cz = 1.1 + Math.floor(i / 2) * 0.42;
    cyl(g, 0.26, 0.26, 0.16, 10, M.gold, cx, 0.42, cz, { outline: true, outlineScale: 1.04 });
    cyl(g, 0.22, 0.22, 0.14, 10, M.gold, cx, 0.57, cz, { cast: true });
  }

  addFacadeSign(g, "GOLD STORAGE", "PROOF · MEASURED IMPACT", 1.35, 1.47, 1.85, 0.42);

  return {
    group: g,
    id: "gold",
    label: "Gold Storage",
    sub: "Proof / Measured impact",
    level: 9,
    anchor: new THREE.Vector3(x - 1.1, 4.65, z - 0.5),
    focus: new THREE.Vector3(x, 0.9, z),
  };
}

function buildElixirStorage(x, z) {
  const g = buildingGroup(x, z, 0.1);

  rbox(g, 3.75, 0.32, 3.55, M.stoneDark, 0, 0.16, 0, {
    r: 0.1,
    outline: true,
    outlineScale: 1.025,
  });
  rbox(g, 2.9, 0.8, 2.65, M.stone, 0, 0.65, 0, { r: 0.1, outline: true, outlineScale: 1.03 });
  cyl(g, 1.3, 1.4, 1.9, 16, M.elixir, 0, 1.8, 0, { outline: true, outlineScale: 1.025 });
  for (const y of [1.05, 1.85, 2.65]) {
    cyl(g, 1.42, 1.42, 0.12, 16, M.goldDark, 0, y, 0, { cast: false });
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2),
    M.elixir
  );
  dome.position.y = 2.75;
  dome.castShadow = true;
  dome.receiveShadow = true;
  g.add(dome);
  sphere(g, 0.14, 8, M.gold, 0, 4.02, 0, { cast: false });

  // Glass porthole with glowing contents.
  rbox(g, 0.9, 0.95, 0.1, M.goldDark, 0, 1.75, 1.34, { r: 0.08 });
  box(g, 0.7, 0.75, 0.06, M.liquid, 0, 1.75, 1.41, { cast: false });

  // Outflow pipe.
  cyl(g, 0.12, 0.12, 1.4, 8, M.darkMetal, 1.55, 0.75, 0.7, {
    rz: Math.PI / 2,
    cast: true,
  });
  cyl(g, 0.18, 0.18, 0.2, 8, M.goldDark, 2.2, 0.75, 0.7, { rx: 0, cast: false });

  addFacadeSign(g, "ELIXIR STORAGE", "LIVE SIGNALS · GITHUB", 1.15, 1.34, 1.95, 0.42);

  return {
    group: g,
    id: "elixir",
    label: "Elixir Storage",
    sub: "Live signals / GitHub",
    level: 9,
    anchor: new THREE.Vector3(x, 4.3, z),
    focus: new THREE.Vector3(x, 1.0, z),
  };
}

/* ------------------------------------------------------------------ */
/*  Signpost, gem box, defenses                                        */
/* ------------------------------------------------------------------ */

function buildSignpost(x, z) {
  const g = buildingGroup(x, z, 0.34);
  cyl(g, 0.11, 0.14, 2.9, 7, M.woodDark, 0, 1.45, 0, {
    outline: true,
    outlineScale: 1.05,
  });
  sphere(g, 0.14, 8, M.gold, 0, 2.95, 0, { cast: false });

  const boards = [
    { y: 2.35, title: "RESUME", sub: "PDF · TAP TO OPEN", ry: -0.12 },
    { y: 1.7, title: "PROJECTS", sub: "8 SHIPPED BUILDS", ry: 0.09 },
  ];
  for (const b of boards) {
    const holder = new THREE.Group();
    holder.position.set(0, b.y, 0.12);
    holder.rotation.y = b.ry;
    g.add(holder);
    rbox(holder, 1.85, 0.56, 0.12, M.woodDark, 0, 0, 0, {
      r: 0.04,
      outline: true,
      outlineScale: 1.02,
    });
    plane(
      holder,
      1.7,
      0.46,
      new THREE.MeshBasicMaterial({ map: signTexture(b.title, b.sub) }),
      0,
      0,
      0.08
    );
  }

  return {
    group: g,
    id: "signpost",
    label: "Signpost",
    sub: "Resume / PDF",
    level: 1,
    anchor: new THREE.Vector3(x, 3.3, z),
    focus: new THREE.Vector3(x, 0.8, z),
  };
}

let playerGems = 750;
const gemParticles = [];

function playGemChimeSfx() {
  if (!soundOn) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [659.25, 830.61, 987.77, 1318.51, 1661.22];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + i * 0.07);
    gain.gain.setValueAtTime(0.001, now + i * 0.07);
    gain.gain.linearRampToValueAtTime(0.2, now + i * 0.07 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.07);
    osc.stop(now + i * 0.07 + 0.6);
  });
}

function collectGems() {
  playerGems += 25;
  const gemCountEl = document.getElementById("gem-count");
  if (gemCountEl) {
    gemCountEl.textContent = playerGems;
    gemCountEl.style.transform = "scale(1.4)";
    setTimeout(() => { gemCountEl.style.transform = "scale(1)"; }, 280);
  }
  playGemChimeSfx();
  for (let i = 0; i < 7; i++) {
    const p = glowSprite(scene, "#10b981", 1.1, -3.5 + (Math.random() - 0.5) * 0.9, 1.2, 6.2 + (Math.random() - 0.5) * 0.9, 0.85);
    gemParticles.push({ sprite: p, vy: 0.045 + Math.random() * 0.035, life: 1.0 });
  }
  toast("💎 +25 GEMS UNLOCKED! Agile Secret: 'Focus on working software over paperwork.'", 4500);
}

function buildGemBox(x, z) {
  const g = buildingGroup(x, z, -0.25);
  rbox(g, 1.3, 0.58, 1.0, M.wood, 0, 0.29, 0, {
    r: 0.07,
    outline: true,
    outlineScale: 1.04,
  });
  rbox(g, 1.34, 0.14, 1.04, M.woodDark, 0, 0.64, -0.28, {
    r: 0.04,
    outline: true,
    rx: -0.95,
  });
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshStandardMaterial({
      color: 0x64ffc8,
      emissive: 0x16d58e,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.2,
    })
  );
  gem.position.set(0, 1.0, 0);
  gem.castShadow = true;
  g.add(gem);
  gems.push(gem);
  glowSprite(g, "#5effc0", 2.2, 0, 1.05, 0, 0.55);
  for (let i = 0; i < 4; i++) {
    cyl(g, 0.11, 0.11, 0.05, 8, M.gold, -0.45 + i * 0.3, 0.64, 0.35 + (i % 2) * 0.16, {
      cast: false,
    });
  }

  return {
    group: g,
    id: "gem",
    label: "Gem Box",
    sub: "Tap to collect gems!",
    level: 1,
    kind: "fun",
    funFact: "You found the Gem Box! Tap to harvest +25 gems for your village.",
    anchor: new THREE.Vector3(x, 2.2, z),
    focus: new THREE.Vector3(x, 0.7, z),
    open: collectGems,
  };
}

let cannonBarrelGroup = null;
let activeCannonballs = [];
let cannonRecoil = 0;

function playCannonBoomSfx() {
  if (!soundOn) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(32, now + 0.35);

  gain.gain.setValueAtTime(0.38, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.48);

  const bufferSize = Math.floor(ctx.sampleRate * 0.35);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.09));
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.setValueAtTime(700, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(90, now + 0.32);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.45, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(now);
}

function fireCannon() {
  playCannonBoomSfx();
  cannonRecoil = 1.0;

  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), M.darkMetal);
  ballMesh.position.set(4.6 + 0.8, 1.2, 8.8);
  ballMesh.castShadow = true;
  scene.add(ballMesh);

  activeCannonballs.push({
    mesh: ballMesh,
    t: 0,
    start: new THREE.Vector3(4.6 + 0.8, 1.2, 8.8),
    target: new THREE.Vector3(7.8, 0.4, 13.2),
  });

  toast("💥 CANNON FIRED! Mid-sprint blocker eradicated! (-40% blocker SLA)", 4500);
}

function buildCannon(x, z) {
  const g = buildingGroup(x, z, -0.55);

  cyl(g, 1.15, 1.28, 0.48, 12, M.stone, 0, 0.24, 0, {
    outline: true,
    outlineScale: 1.025,
  });
  cyl(g, 1.02, 1.08, 0.18, 12, M.woodDark, 0, 0.56, 0, { cast: false });
  for (const sz of [-0.58, 0.58]) {
    cyl(g, 0.48, 0.48, 0.16, 14, M.woodDark, 0, 0.56, sz, {
      rx: Math.PI / 2,
      outline: true,
      outlineScale: 1.04,
    });
    cyl(g, 0.24, 0.24, 0.18, 12, M.goldDark, 0, 0.56, sz, {
      rx: Math.PI / 2,
      cast: false,
    });
  }

  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(0.35, 0.92, 0);
  g.add(barrelGroup);
  cannonBarrelGroup = barrelGroup;

  const barrel = cyl(barrelGroup, 0.26, 0.34, 1.65, 12, M.darkMetal, 0, 0, 0, {
    rz: Math.PI / 2 - 0.12,
    outline: true,
    outlineScale: 1.04,
  });
  barrel.castShadow = true;
  cyl(barrelGroup, 0.37, 0.37, 0.14, 12, M.gold, 0.73, 0.08, 0, {
    rz: Math.PI / 2 - 0.12,
    cast: false,
  });
  cyl(barrelGroup, 0.42, 0.42, 0.1, 12, M.darkMetal, 0.79, 0.08, 0, {
    rz: Math.PI / 2 - 0.12,
    cast: false,
  });
  for (const y of [-0.37, -0.07]) {
    cyl(barrelGroup, 0.36, 0.36, 0.08, 12, M.gold, 0, y, 0, {
      rz: Math.PI / 2 - 0.12,
      cast: false,
    });
  }

  for (let i = 0; i < 3; i++) {
    sphere(g, 0.16, 8, M.darkMetal, 0.8 + (i % 2) * 0.35, 0.16, 0.9 + Math.floor(i / 2) * 0.3, {
      cast: true,
    });
  }
  addFacadeSign(g, "CANNON", "DEFEND SPRINT", 0.6, 1.25, 1.55, 0.38);

  return {
    group: g,
    id: "cannon",
    label: "Cannon Lvl 8",
    sub: "Tap to fire cannon!",
    level: 8,
    kind: "fun",
    funFact: "Target defense locked! Ready to blast blockers.",
    anchor: new THREE.Vector3(x, 2.8, z),
    focus: new THREE.Vector3(x, 0.8, z),
    open: fireCannon,
  };
}

function buildArcherTower(x, z) {
  const g = buildingGroup(x, z, 0.3);

  // A tall, narrow tower so it reads as a defense, not another hut.
  cyl(g, 0.9, 1.05, 3.25, 12, M.stone, 0, 1.62, 0, {
    outline: true,
    outlineScale: 1.03,
  });
  for (const y of [0.55, 1.8, 3.05]) {
    cyl(g, 1.08, 1.08, 0.15, 12, M.stoneDark, 0, y, 0, { cast: false });
  }
  rbox(g, 2.2, 0.2, 2.2, M.woodDark, 0, 3.32, 0, { r: 0.04, outline: true });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      rbox(g, 0.12, 0.72, 0.12, M.wood, sx * 0.92, 3.72, sz * 0.92, {
        r: 0.02,
        outline: true,
      });
    }
  }
  for (const sz of [-0.92, 0.92]) {
    box(g, 1.92, 0.1, 0.1, M.wood, 0, 4.02, sz, { cast: true });
  }
  for (const sx of [-0.92, 0.92]) {
    box(g, 0.1, 0.1, 1.92, M.wood, sx, 4.02, 0, { cast: true });
  }
  cone(g, 1.65, 1.15, 4, M.roofTeal, 0, 4.95, 0, {
    ry: Math.PI / 4,
    outline: true,
    outlineScale: 1.025,
  });
  sphere(g, 0.1, 8, M.gold, 0, 5.6, 0, { cast: false });

  // Ladder up the front face.
  for (const lx of [-0.28, 0.28]) {
    box(g, 0.07, 2.6, 0.07, M.woodDark, lx, 1.55, 1.0, { cast: true });
  }
  for (let i = 0; i < 7; i++) {
    box(g, 0.58, 0.06, 0.07, M.wood, 0, 0.35 + i * 0.4, 1.0, { cast: false });
  }

  // A small archer on the platform.
  const archer = new THREE.Group();
  archer.position.set(0, 3.42, 0.12);
  g.add(archer);
  cyl(archer, 0.16, 0.19, 0.5, 7, M.shirt, 0, 0.25, 0, { outline: true });
  sphere(archer, 0.16, 8, M.skin, 0, 0.58, 0, { outline: true });
  cyl(archer, 0.18, 0.21, 0.09, 8, M.hat, 0, 0.72, 0, { cast: false });
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.028, 6, 14, Math.PI),
    M.woodDark
  );
  bow.position.set(0.3, 0.36, 0.06);
  bow.rotation.z = -Math.PI / 2;
  archer.add(bow);
  box(archer, 0.04, 0.52, 0.04, M.cream, 0.3, 0.36, 0.04, { cast: false });

  addFacadeSign(g, "ARCHER", "HIRE ME", 1.3, 1.07, 1.25, 0.38);

  return {
    group: g,
    id: "archer",
    label: "Archer Tower",
    sub: "Hire me / Defend the village",
    level: 8,
    anchor: new THREE.Vector3(x, 5.35, z),
    focus: new THREE.Vector3(x, 1.5, z),
    open: openProfile,
  };
}

/* ------------------------------------------------------------------ */
/*  Flags, builder, animated bits                                      */
/* ------------------------------------------------------------------ */

const flags = [];
const smokePuffs = [];
const builders = [];
const bubbles = [];
const gems = [];
const thAnimations = {
  crystal: null,
  ring1: null,
  ring2: null,
  light: null,
  gears: [],
};

function makeFlag(parent, x, y, z, w, h, mat, phase) {
  const pole = new THREE.Group();
  pole.position.set(x, y, z);
  parent.add(pole);
  cyl(pole, 0.035, 0.045, 1.15, 6, M.stoneDeep, 0, -0.4, 0, { cast: false, outline: false });
  const geo = new THREE.PlaneGeometry(w, h, 6, 3);
  geo.translate(w / 2, 0, 0);
  const cloth = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: mat.color,
      roughness: 0.9,
      side: THREE.DoubleSide,
    })
  );
  cloth.position.set(0.02, 0.02, 0);
  cloth.castShadow = true;
  pole.add(cloth);
  flags.push({ cloth, base: geo.attributes.position.array.slice(), phase });
  return pole;
}

function makeBuilder(x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);

  // Legs.
  for (const lx of [-0.12, 0.12]) {
    cyl(g, 0.09, 0.11, 0.5, 7, M.pants, lx, 0.25, 0, { cast: true, outline: true, outlineScale: 1.06 });
  }
  // Body.
  rbox(g, 0.5, 0.62, 0.36, M.shirt, 0, 0.82, 0, { r: 0.12, outline: true, outlineScale: 1.05 });
  // Head.
  sphere(g, 0.22, 12, M.skin, 0, 1.27, 0, { cast: true, outline: true, outlineScale: 1.05 });
  // Hard hat.
  cyl(g, 0.24, 0.26, 0.13, 12, M.hat, 0, 1.45, 0, { cast: true, outline: true, outlineScale: 1.05 });
  cyl(g, 0.3, 0.3, 0.035, 12, M.hat, 0, 1.39, 0.02, { cast: false });
  // Arms.
  const armPivot = new THREE.Group();
  armPivot.position.set(0.28, 1.0, 0);
  armPivot.rotation.z = -0.4;
  g.add(armPivot);
  cyl(armPivot, 0.055, 0.065, 0.48, 7, M.skin, 0, -0.24, 0, { cast: true, outline: true, outlineScale: 1.07 });
  const hammer = new THREE.Group();
  hammer.position.set(0, -0.48, 0);
  armPivot.add(hammer);
  cyl(hammer, 0.025, 0.025, 0.42, 6, M.woodDark, 0, -0.16, 0, { cast: true });
  rbox(hammer, 0.28, 0.16, 0.16, M.stoneDeep, 0, -0.38, 0, { r: 0.03, outline: true, outlineScale: 1.06 });
  const arm2 = cyl(g, 0.055, 0.065, 0.5, 7, M.skin, -0.29, 0.76, 0.02, { cast: true, outline: true, outlineScale: 1.07 });
  arm2.rotation.z = 0.45;

  builders.push({ group: g, armPivot, base: g.position.clone(), phase: rand() * 6 });
  return g;
}

function buildCharacters() {
}

/* ------------------------------------------------------------------ */
/*  Registry and scene assembly                                        */
/* ------------------------------------------------------------------ */

const buildings = [];
const buildingGroups = [];

function registerBuilding(def) {
  buildings.push(def);
  buildingGroups.push(def.group);
  def.group.userData.buildingId = def.id;
  return def;
}

function buildFunProps() {
  // One rock and one tree are clickable fun-fact props. The rest are scenery.
  const rockGroup = new THREE.Group();
  rockGroup.position.set(6.2, 0, 13.6);
  rockGroup.rotation.y = 0.4;
  scene.add(rockGroup);
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.78, 0), M.rock);
  rock.position.y = 0.52;
  rock.rotation.set(0.4, 0.8, 0.2);
  rock.castShadow = true;
  rock.receiveShadow = true;
  rockGroup.add(rock);
  const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 0), M.rock);
  pebble.position.set(0.7, 0.24, 0.2);
  pebble.castShadow = true;
  rockGroup.add(pebble);

  registerBuilding({
    group: rockGroup,
    id: "fun-rock",
    label: "Odd Rock",
    sub: "Fun fact",
    level: 1,
    kind: "fun",
    funFact: CONTENT.funFacts[6],
    anchor: new THREE.Vector3(6.2, 2.0, 13.6),
    focus: new THREE.Vector3(6.2, 0.5, 13.6),
  });
}

function buildVillage() {
  buildSky();
  buildLights();
  buildTerrain();
  buildWilds();
  buildPaths();
  buildPlaza();
  buildGroundDressing();
  buildTrees();
  buildProps();

  // Four landmarks. Every other builder below is deliberately left out of the
  // scene; the village is the product, not the asset count.
  const townhall = registerBuilding(buildTownHall());
  const workshop = registerBuilding(buildWorkshop(LAYOUT.workshop.x, LAYOUT.workshop.z));
  const barracks = registerBuilding(buildBarracks(LAYOUT.barracks.x, LAYOUT.barracks.z));
  const clan = registerBuilding(buildClanCastle(LAYOUT.clan.x, LAYOUT.clan.z));
  const cannon = registerBuilding(buildCannon(LAYOUT.cannon.x, LAYOUT.cannon.z));
  const gembox = registerBuilding(buildGemBox(LAYOUT.gembox.x, LAYOUT.gembox.z));

  buildCharacters();

  // Extra ground detail is added last so the seeded scatter above keeps
  // its established layout.
  buildFlowerClusters();
  buildGroveUnderstory();

  return { townhall, workshop, barracks, clan, cannon, gembox };
}

/* ------------------------------------------------------------------ */
/*  Camera interaction                                                 */
/* ------------------------------------------------------------------ */

let dragging = false;
let dragPointerId = null;
let lastPointer = null;
let pointerDownAt = 0;
let pointerMoved = 0;
let pinchStartDist = 0;
let pinchStartCameraDist = 0;
const activePointers = new Map();

function cancelCameraGoal() {
  cameraGoal = null;
}

function focusOn(point, dist = 42, immediate = false) {
  const goalDistance = clamp(dist, MIN_DISTANCE, MAX_DISTANCE);
  if (immediate || reduceMotion) {
    target.copy(point);
    distance = goalDistance;
    cameraGoal = null;
    updateCamera();
    return;
  }
  cameraGoal = {
    startTarget: target.clone(),
    startDistance: distance,
    target: point.clone(),
    distance: goalDistance,
    t: 0,
    speed: 2.8,
  };
}

function panCamera(dx, dy) {
  const view = viewSize();
  const scale = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / view.h;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  right.y = 0;
  right.normalize();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  target.addScaledVector(right, -dx * scale);
  target.addScaledVector(forward, dy * scale);
  target.x = clamp(target.x, -PAN_BOUND, PAN_BOUND);
  target.z = clamp(target.z, -PAN_BOUND, PAN_BOUND);
  updateCamera();
}

function zoomCamera(factor) {
  distance = clamp(distance * factor, MIN_DISTANCE, MAX_DISTANCE);
  updateCamera();
}

function setCanvasCursor(mode) {
  canvas.classList.toggle("is-pointer", mode === "pointer");
  canvas.classList.toggle("is-default", mode === "default");
  canvas.classList.toggle("is-grabbing", mode === "grabbing");
}

function onPointerDown(e) {
  if (e.target.closest("button, a, .sheet, .profile-chip, .cta-row, .top-actions")) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 1) {
    dragging = true;
    dragPointerId = e.pointerId;
    lastPointer = { x: e.clientX, y: e.clientY };
    pointerDownAt = performance.now();
    pointerMoved = 0;
    setCanvasCursor("grabbing");
    cancelCameraGoal();
  } else if (activePointers.size === 2) {
    dragging = false;
    const pts = [...activePointers.values()];
    pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    pinchStartCameraDist = distance;
  }
  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {
    // Synthetic pointers and some embedded browsers do not support capture.
  }
}

function onPointerMove(e) {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  if (activePointers.size === 2) {
    const pts = [...activePointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (pinchStartDist > 0) {
      distance = clamp((pinchStartCameraDist * pinchStartDist) / Math.max(1, d), MIN_DISTANCE, MAX_DISTANCE);
      updateCamera();
    }
    return;
  }

  if (!dragging || e.pointerId !== dragPointerId || !lastPointer) {
    updateHover(e.clientX, e.clientY);
    return;
  }

  const dx = e.clientX - lastPointer.x;
  const dy = e.clientY - lastPointer.y;
  pointerMoved += Math.hypot(dx, dy);
  if (pointerMoved > 4) {
    hovered = null;
    tooltip.classList.remove("show");
  }
  lastPointer = { x: e.clientX, y: e.clientY };
  // The phone view is turned with a CSS rotation, so screen deltas must be
  // rotated back before they can pan the landscape scene. Without this a
  // horizontal swipe pans the world vertically and vice versa.
  if (app.classList.contains("force-landscape")) {
    panCamera(dy, -dx);
  } else {
    panCamera(dx, dy);
  }
}

function onPointerUp(e) {
  const wasDragging = dragging;
  const moved = pointerMoved;
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) {
    dragging = false;
    dragPointerId = null;
    lastPointer = null;
    pinchStartDist = 0;
    setCanvasCursor("grab");
  }
  if (!wasDragging) return;
  // handleTap feeds pickBuilding, which performs the landscape conversion
  // itself. Pass screen coordinates here; converting twice misses every
  // building on phones.
  if (moved < (isTouch ? 14 : 7) && performance.now() - pointerDownAt < 650) {
    handleTap(e.clientX, e.clientY);
  }
}

function onPointerCancel(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) {
    dragging = false;
    dragPointerId = null;
    lastPointer = null;
    pinchStartDist = 0;
    setCanvasCursor("grab");
  }
}

function onWheel(e) {
  e.preventDefault();
  cancelCameraGoal();
  zoomCamera(e.deltaY > 0 ? 1.08 : 0.925);
}

/* ------------------------------------------------------------------ */
/*  Raycasting and selection                                           */
/* ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const tooltip = document.getElementById("tooltip");
const ttName = document.getElementById("tt-name");
const ttSub = document.getElementById("tt-sub");
let tooltipWidth = 0;
let tooltipHeight = 0;
const tooltipSize = new ResizeObserver(() => {
  tooltipWidth = tooltip.offsetWidth;
  tooltipHeight = tooltip.offsetHeight;
  positionTooltip();
});
tooltipSize.observe(tooltip);
const selection = document.getElementById("selection");
const selName = document.getElementById("sel-name");
const selLevel = document.getElementById("sel-level");
const selInfo = document.getElementById("sel-info");
const selOpen = document.getElementById("sel-open");
let selected = null;
let selectedRing = null;
let hovered = null;
let lastHoverCheck = 0;

function pickBuilding(clientX, clientY) {
  const view = viewSize();
  const local = toLocal(clientX, clientY);
  pointerNdc.set((local.x / view.w) * 2 - 1, -(local.y / view.h) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(buildingGroups, true);
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && !obj.userData.buildingId) obj = obj.parent;
    if (obj?.userData.buildingId) {
      return buildings.find((b) => b.id === obj.userData.buildingId) || null;
    }
  }
  return null;
}

function positionTooltip() {
  if (!hovered || !tooltip.classList.contains("show")) return;
  const view = viewSize();
  const projected = hovered.anchor.clone().project(camera);
  const x = (projected.x * 0.5 + 0.5) * view.w;
  const y = (-projected.y * 0.5 + 0.5) * view.h;
  const halfWidth = tooltipWidth / 2;
  const height = tooltipHeight;
  tooltip.style.left = `${clamp(x, halfWidth + 8, view.w - halfWidth - 8)}px`;
  tooltip.style.top = `${clamp(y, height + 8, view.h - 8)}px`;
}

function updateHover(clientX, clientY) {
  const now = performance.now();
  if (now - lastHoverCheck < 40) return;
  lastHoverCheck = now;
  if (tour.active) {
    hovered = null;
    tooltip.classList.remove("show");
    setCanvasCursor("default");
    return;
  }
  if (document.querySelector(".sheet.show")) {
    hovered = null;
    tooltip.classList.remove("show");
    setCanvasCursor("grab");
    return;
  }
  const b = pickBuilding(clientX, clientY);
  hovered = b;
  if (!b) {
    tooltip.classList.remove("show");
    setCanvasCursor("grab");
    return;
  }
  setCanvasCursor("pointer");
  ttName.textContent = b.label;
  ttSub.textContent = b.sub;
  tooltip.classList.add("show");
  positionTooltip();
}

function selectBuilding(b, options = {}) {
  if (!options.silent) {
    playSelectSfx();
    if (b.id === "townhall") {
      playCrystalResonanceSfx();
    }
  }

  if (b.kind === "fun") {
    squashBuilding(b.group);
    focusOn(b.focus, b.id === "gem" ? 36 : 40);
    selection.classList.remove("show");
    if (selectedRing) selectedRing.visible = false;
    selected = null;
    if (b.open) b.open();
    else {
      toast(`${b.funFact}  ·  +1 coin`, 4400);
    }
    return;
  }

  selected = b;

  if (!selectedRing) {
    const g = new THREE.Group();

    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffe7a0,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.RingGeometry(2.06, 2.3, 72), haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.072;
    g.add(halo);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.82, 2.06, 72),
      new THREE.MeshBasicMaterial({
        color: 0xffcf4a,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.082;
    g.add(ring);

    const inner = new THREE.Mesh(
      new THREE.RingGeometry(1.7, 1.78, 72),
      new THREE.MeshBasicMaterial({
        color: 0xfff6d6,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.078;
    g.add(inner);

    const tickMat = new THREE.MeshBasicMaterial({
      color: 0xfff0b8,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(
        new THREE.RingGeometry(2.08, 2.2, 10, 1, i * (Math.PI / 2) + 0.16, 0.24),
        tickMat
      );
      tick.rotation.x = -Math.PI / 2;
      tick.position.y = 0.086;
      g.add(tick);
    }

    g.visible = false;
    g.userData = { baseScale: 1, haloMat };
    scene.add(g);
    selectedRing = g;
  }

  selectedRing.visible = true;
  selectedRing.position.set(b.group.position.x, 0, b.group.position.z);
  const ringScale = b.id === "townhall" ? 1.55 : 1.45;
  selectedRing.userData.baseScale = ringScale;
  selectedRing.scale.setScalar(ringScale);

  selName.textContent = b.label;
  selLevel.textContent = `LVL. ${b.level}`;
  selInfo.onclick = () => {
    if (b.open) b.open();
    else if (b.projectId) openProject(b.projectId);
  };
  if (b.projectId) {
    const project = CONTENT.projects.find((p) => p.id === b.projectId);
    const live = project?.links.find((l) => l.label === "Live");
    if (live) {
      selOpen.hidden = false;
      selOpen.onclick = () => window.open(live.url, "_blank", "noopener");
    } else {
      selOpen.hidden = true;
    }
  } else {
    selOpen.hidden = true;
  }
  selection.classList.add("show");
  hovered = null;
  tooltip.classList.remove("show");

  // Squash and focus, then stay selected until INFO or another tap.
  squashBuilding(b.group);
  const focusDistance = b.id === "townhall" ? 46 : b.id === "workshop" ? 42 : 44;
  focusOn(b.focus, focusDistance);
}

const squashes = [];
function squashBuilding(group) {
  squashes.push({ group, t: 0 });
}

function handleTap(x, y) {
  if (tour.active) return;
  const b = pickBuilding(x, y);
  if (b) selectBuilding(b);
  else {
    selection.classList.remove("show");
    if (selectedRing) selectedRing.visible = false;
    selected = null;
  }
}

/* ------------------------------------------------------------------ */
/*  UI                                                                 */
/* ------------------------------------------------------------------ */

const scrim = document.getElementById("scrim");
const profileSheet = document.getElementById("profile-sheet");
const townhallSheet = document.getElementById("townhall-sheet");
const projectSheet = document.getElementById("project-sheet");
const workshopSheet = document.getElementById("workshop-sheet");
const clanSheet = document.getElementById("clan-sheet");
const infoSheet = document.getElementById("info-sheet");
const settingsSheet = document.getElementById("settings-sheet");
const toastEl = document.getElementById("toast");
let toastTimer = 0;
let projectBackSheet = workshopSheet;
let projectHls = null;
let projectVideoSource = "";
let projectPlayToken = 0;
let projectHlsRetries = 0;
let hlsLibraryPromise = null;

// hls.js is only fetched when a film is actually opened, so the village's
// first load stays light. Safari and iOS play the same playlists natively.
function loadHlsLibrary() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLibraryPromise) {
    hlsLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/hls.min.js";
      script.async = true;
      script.onload = () => {
        if (window.Hls) resolve(window.Hls);
        else reject(new Error("HLS library missing"));
      };
      script.onerror = () => reject(new Error("HLS library failed"));
      document.head.appendChild(script);
    });
  }
  return hlsLibraryPromise;
}

function destroyProjectHls() {
  if (projectHls) {
    projectHls.destroy();
    projectHls = null;
  }
}

function stopProjectVideo() {
  const video = document.getElementById("project-video");
  projectPlayToken++;
  destroyProjectHls();
  projectVideoSource = "";
  if (!video) return;
  video.pause();
  if (Number.isFinite(video.duration)) video.currentTime = 0;
  video.removeAttribute("src");
  video.load();
}

function isIOSDevice() {
  const platform = navigator.platform || "";
  return /iP(hone|ad|od)/.test(platform) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// hls.js starts playback as soon as the first 1-second piece arrives, while
// native players buffer several pieces first. Prefer it everywhere MSE runs;
// iOS keeps native HLS, which is hardware-accelerated.
function useHlsJs() {
  if (isIOSDevice()) return false;
  return typeof window.MediaSource !== "undefined" || typeof window.ManagedMediaSource !== "undefined";
}

// Non-iOS players get the fast-start playlist: same bytes, but the first GOP
// is cut into 1-second transport-stream pieces so the first frame arrives
// sooner. iOS keeps the fully keyframe-aligned playlist for its stricter
// native HLS pipeline.
function projectPlaybackSource(source) {
  if (!source || !/\.m3u8(?:[?#]|$)/i.test(source)) return source;
  if (isIOSDevice()) return source;
  return source.replace(/\/index\.m3u8(?:[?#]|$)/i, "/fast.m3u8");
}

function attachProjectHls(Hls, video, source) {
  destroyProjectHls();
  projectHlsRetries = 0;
  projectHls = new Hls({ enableWorker: true });
  projectHls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;
    if (projectHls !== null) {
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && projectHlsRetries < 2) {
        projectHlsRetries++;
        projectHls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && projectHlsRetries < 2) {
        projectHlsRetries++;
        projectHls.recoverMediaError();
        return;
      }
    }
    destroyProjectHls();
    toast("FILM COULD NOT LOAD");
  });
  projectHls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (projectVideoSource !== source) return;
    const play = video.play();
    if (play?.catch) play.catch(() => {});
  });
  projectHls.loadSource(source);
  projectHls.attachMedia(video);
}

function toast(message, ms = 2400) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), ms);
}

function closeSheets() {
  document.querySelectorAll(".sheet.show").forEach((s) => s.classList.remove("show"));
  scrim.classList.remove("show");
  const video = document.getElementById("project-video");
  if (video) {
    video.pause();
    if (Number.isFinite(video.duration)) video.currentTime = 0;
  }
  closeArchLightbox();
}

function openSheet(sheet) {
  closeSheets();
  sheet.classList.add("show");
  const body = sheet.querySelector(".sheet-body");
  if (body) body.scrollTop = 0;
  scrim.classList.add("show");
  hovered = null;
  tooltip.classList.remove("show");
  requestAnimationFrame(() => {
    if (body) body.scrollTop = 0;
  });
}

function openInfo({ title, sub, tech }) {
  const titleEl = document.getElementById("info-title");
  const first = titleEl.firstChild;
  if (first && first.nodeType === Node.TEXT_NODE) first.nodeValue = `${title} `;
  else titleEl.insertBefore(document.createTextNode(`${title} `), titleEl.firstChild);
  document.getElementById("info-sub").textContent = sub || "";

  const list = document.getElementById("info-list");
  list.innerHTML = "";

  if (tech?.length) {
    const items = tech.flatMap((entry) => (Array.isArray(entry.items) ? entry.items : [entry]));
    const grid = document.createElement("div");
    grid.className = "tech-grid";
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "tech-card";
      card.title = item.name;
      const box = document.createElement("span");
      box.className = "tech-logo-box";
      const img = document.createElement("img");
      img.src = `assets/tech/${item.logo}.svg`;
      img.alt = "";
      img.decoding = "async";
      img.loading = "eager";
      img.width = 20;
      img.height = 20;
      img.addEventListener("error", () => {
        // One retry covers a dropped request on a busy local server. Only a
        // second failure falls back to initials.
        if (!img.dataset.retried) {
          img.dataset.retried = "1";
          setTimeout(() => {
            img.src = `assets/tech/${item.logo}.svg?retry=1`;
          }, 350);
          return;
        }
        box.textContent = "";
        const fallback = document.createElement("span");
        fallback.className = "tech-fallback";
        fallback.textContent = item.name.slice(0, 2).toUpperCase();
        box.appendChild(fallback);
      });
      box.appendChild(img);
      const name = document.createElement("b");
      name.textContent = item.name;
      card.append(box, name);
      grid.appendChild(card);
    });
    list.appendChild(grid);
  }

  openSheet(infoSheet);
}

function openBarracks() {
  const tools = CONTENT.techStack.flatMap((group) => group.items);
  openInfo({
    title: "BARRACKS",
    sub: "THE LANGUAGES, FRAMEWORKS & TOOLS I USE OR AM FAMILIAR WITH",
    tech: tools,
  });
}

// Ranked for startup applications: measured outcomes and hard systems first,
// then product depth, with narrower bets and offline builds last.
const PROJECT_ORDER = [
  "recoup",
  "clockwork",
  "starthunt",
  "sandbox-code-agent",
  "litmus",
  "verdict",
  "bug-gym",
  "workflow-to-agent",
  "isotherm",
  "vibely",
  "speakwell",
];

function orderedProjects() {
  const rank = new Map(PROJECT_ORDER.map((id, index) => [id, index]));
  return [...CONTENT.projects].sort(
    (a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)
  );
}

function projectBadge(projectId) {
  const index = PROJECT_ORDER.indexOf(projectId);
  return index >= 0 ? String(index + 1).padStart(2, "0") : "••";
}

function openTownhall() {
  const copy = document.getElementById("townhall-copy");
  copy.innerHTML = "";
  [CONTENT.about.intro, ...CONTENT.about.paragraphs].forEach((paragraph) => {
    const p = document.createElement("p");
    p.textContent = paragraph;
    copy.appendChild(p);
  });
  openSheet(townhallSheet);
}

function openProfile() {
  applyPlayerAge();

  const intro = document.getElementById("profile-intro");
  intro.innerHTML = "";
  [CONTENT.about.intro, CONTENT.identity.tagline].forEach((paragraph) => {
    const p = document.createElement("p");
    p.textContent = paragraph;
    intro.appendChild(p);
  });
  openSheet(profileSheet);
}

const ACTION_ICONS = {
  architecture:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
  video:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5Z"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.15-1.1-1.46-1.1-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.88 1.52 2.32 1.08 2.89.82.09-.64.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.8a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>',
  live:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
};

function formatMediaDuration(seconds) {
  if (!seconds) return "";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function projectActionTile({ variant, label, sub, href, onClick }) {
  const el = document.createElement(href ? "a" : onClick ? "button" : "span");
  el.className = `project-action is-${variant}`;
  if (href) {
    el.href = href;
    el.target = "_blank";
    el.rel = "noreferrer";
  } else if (onClick) {
    el.type = "button";
    el.addEventListener("click", onClick);
  } else {
    el.classList.add("is-off");
    el.setAttribute("aria-disabled", "true");
  }
  el.innerHTML = `
    <span class="pa-icon">${ACTION_ICONS[variant] || ""}</span>
    <span class="pa-copy"><b>${label}</b><small>${sub}</small></span>
    <span class="pa-arrow" aria-hidden="true">${href ? "↗" : onClick ? "→" : "·"}</span>`;
  return el;
}

function openArchLightbox(source, title) {
  if (!source) return;
  stopProjectVideo();
  const video = document.getElementById("project-video");
  if (video) video.hidden = true;
  const img = document.getElementById("arch-lightbox-img");
  img.hidden = false;
  img.src = source;
  img.alt = title ? `${title}, hand-drawn architecture diagram` : "Hand-drawn architecture diagram";
  document.getElementById("arch-lightbox-kicker").textContent = "WORKSHOP · SYSTEM ARCHITECTURE";
  document.getElementById("arch-lightbox-title").textContent = title || "ARCHITECTURE";
  const box = document.getElementById("arch-lightbox");
  box.classList.add("show");
  box.setAttribute("aria-hidden", "false");
}

function openVideoLightbox(source, poster, title) {
  if (!source) return;
  const token = ++projectPlayToken;
  const img = document.getElementById("arch-lightbox-img");
  img.hidden = true;
  const video = document.getElementById("project-video");
  const playbackSource = projectPlaybackSource(source);
  video.hidden = false;
  video.poster = poster || "";
  document.getElementById("arch-lightbox-kicker").textContent = "WORKSHOP · PROJECT FILM";
  document.getElementById("arch-lightbox-title").textContent = title || "PROJECT FILM";
  const box = document.getElementById("arch-lightbox");
  box.classList.add("show");
  box.setAttribute("aria-hidden", "false");

  if (projectVideoSource === playbackSource) {
    video.currentTime = 0;
    const play = video.play();
    if (play?.catch) play.catch(() => {});
    return;
  }

  destroyProjectHls();
  projectVideoSource = playbackSource;
  video.pause();
  video.removeAttribute("src");
  video.load();

  if (/\.m3u8(?:[?#]|$)/i.test(source) && useHlsJs()) {
    loadHlsLibrary()
      .then((Hls) => {
        if (token !== projectPlayToken || projectVideoSource !== playbackSource) return;
        if (!Hls.isSupported()) {
          toast("FILM COULD NOT LOAD");
          return;
        }
        attachProjectHls(Hls, video, playbackSource);
      })
      .catch(() => {
        if (token !== projectPlayToken) return;
        toast("FILM COULD NOT LOAD");
      });
    return;
  }

  video.src = playbackSource;
  video.load();
  const play = video.play();
  if (play?.catch) play.catch(() => {});
}

function closeArchLightbox() {
  const box = document.getElementById("arch-lightbox");
  if (!box) return;
  stopProjectVideo();
  const video = document.getElementById("project-video");
  if (video) video.hidden = true;
  const img = document.getElementById("arch-lightbox-img");
  if (img) img.hidden = false;
  box.classList.remove("show");
  box.setAttribute("aria-hidden", "true");
}

function openProject(projectId, backSheet = workshopSheet) {
  const p = CONTENT.projects.find((x) => x.id === projectId);
  if (!p) return;
  projectBackSheet = backSheet || workshopSheet;
  document.getElementById("project-title").textContent = p.title.toUpperCase();
  document.getElementById("project-pitch").textContent = p.pitch || p.summary;

  const media = PROJECT_MEDIA[p.id];
  if (media?.video && useHlsJs()) loadHlsLibrary().catch(() => {});
  const github = p.links.find((l) => l.label === "GitHub");
  const live = p.links.find((l) => l.label === "Live");
  const actions = document.getElementById("project-actions");
  actions.innerHTML = "";

  [
    {
      variant: "architecture",
      label: "Architecture",
      sub: media?.architecture ? "SYSTEM BOARD" : "NOT AVAILABLE",
      onClick: media?.architecture
        ? () => openArchLightbox(media.architecture, `${p.title} · ${media.diagramTitle || "ARCHITECTURE"}`)
        : null,
    },
    {
      variant: "video",
      label: "Video",
      sub: media?.video
        ? `NARRATED FILM${media.seconds ? ` · ${formatMediaDuration(media.seconds)}` : ""}`
        : "NOT AVAILABLE",
      onClick: media?.video
        ? () => openVideoLightbox(media.video, media.poster, `${p.title} · NARRATED FILM`)
        : null,
    },
    {
      variant: "github",
      label: "GitHub",
      sub: github ? "SOURCE CODE" : "REPO NOT PUBLIC",
      href: github?.url || "",
    },
    {
      variant: "live",
      label: "Live",
      sub: live ? "OPEN DEPLOYMENT" : "NOT DEPLOYED",
      href: live?.url || "",
    },
  ].forEach((action) => actions.appendChild(projectActionTile(action)));

  openSheet(projectSheet);
}

function backFromProject() {
  if (projectBackSheet === profileSheet) openSheet(profileSheet);
  else if (projectBackSheet === clanSheet) openClan();
  else openWorkshop();
}

function openWorkshop() {
  const list = document.getElementById("workshop-list");
  list.innerHTML = "";
  orderedProjects().forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "project-row";
    btn.innerHTML = `
      <span class="lvl">${projectBadge(p.id)}</span>
      <span class="row-copy"><b>${p.title}</b><small>${p.result || p.summary}</small></span>
      <span class="arrow">→</span>`;
    btn.title = p.role;
    btn.addEventListener("click", () => openProject(p.id, workshopSheet));
    list.appendChild(btn);
  });
  openSheet(workshopSheet);
}

function openSettings() {
  setSound(soundOn, false, true);
  openSheet(settingsSheet);
}

/* ------------------------------------------------------------------ */
/*  Clan Castle                                                        */
/* ------------------------------------------------------------------ */

const clanBoard = document.getElementById("clan-board");
const clanSubtitle = document.getElementById("clan-subtitle");

const CLAN_TABS = {
  myclan: {
    subtitle: "work I am doing right now",
    render: renderMyClan,
  },
  history: {
    subtitle: "work I did in past",
    render: renderClanHistory,
  },
  bookmarks: {
    subtitle: "startups I wanna work with",
    render: renderClanBookmarks,
  },
};

let clanTab = "myclan";
const CLAN_HISTORY_PREVIEW = 3;
let clanHistoryCardSeq = 0;

function clanCrest(label, tone = "blue", logo = "") {
  const crest = document.createElement("span");
  crest.className = `clan-crest tone-${tone}`;
  if (logo) {
    crest.classList.add("has-logo");
    const img = document.createElement("img");
    img.className = "clan-crest-logo";
    img.src = logo;
    img.alt = "";
    img.decoding = "async";
    crest.appendChild(img);
  } else {
    const main = document.createElement("b");
    main.textContent = label;
    crest.appendChild(main);
  }
  return crest;
}

function clanLink(label, href, className = "clan-link") {
  const link = document.createElement("a");
  link.className = className;
  link.href = href;
  link.textContent = label;
  if (/^https?:/i.test(href)) {
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  const platform = /discord\.(gg|com)/i.test(href)
    ? "discord"
    : /instagram\.com/i.test(href)
      ? "instagram"
      : "";
  if (platform) {
    const icon = document.createElement("img");
    icon.className = "clan-link-icon";
    icon.src = `assets/clans/${platform}.svg`;
    icon.alt = "";
    icon.decoding = "async";
    link.prepend(icon);
  }
  return link;
}

function clanEmpty(title, copy) {
  const box = document.createElement("div");
  box.className = "clan-empty";
  const name = document.createElement("b");
  name.textContent = title;
  const note = document.createElement("p");
  note.textContent = copy;
  box.append(name, note);
  return box;
}

function buildHistoryCard(job) {
  const card = document.createElement("article");
  card.className = "clan-card clan-history-card";
  if (job.current) card.classList.add("is-current");

  const crest = clanCrest(job.crest, job.tone, job.logo);
  const body = document.createElement("div");
  body.className = "clan-history-body";

  const top = document.createElement("div");
  top.className = "clan-history-top";
  const name = document.createElement("h4");
  name.textContent = job.company;
  if (job.suffix) {
    const suffix = document.createElement("small");
    suffix.className = "clan-suffix";
    suffix.textContent = job.suffix;
    name.appendChild(suffix);
  }
  top.appendChild(name);

  const tenure = document.createElement("span");
  tenure.className = `clan-tenure${job.current ? " is-current" : ""}`;
  tenure.textContent = job.tenure;
  top.appendChild(tenure);
  body.appendChild(top);

  const role = document.createElement("div");
  role.className = "clan-history-role";
  role.textContent = job.role;
  body.appendChild(role);

  const period = document.createElement("div");
  period.className = "clan-history-period";
  period.textContent = job.period;
  body.appendChild(period);

  if (job.links?.length) {
    const links = document.createElement("div");
    links.className = "clan-links";
    job.links.forEach(({ label, href }) => {
      links.appendChild(clanLink(`${label} ↗`, href, "clan-job-link"));
    });
    body.appendChild(links);
  }

  if (job.bullets?.length) {
    const list = document.createElement("ul");
    list.className = "clan-history-bullets";
    list.id = `clan-history-bullets-${++clanHistoryCardSeq}`;
    job.bullets.forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      list.appendChild(item);
    });
    body.appendChild(list);

    const hiddenCount = job.bullets.length - CLAN_HISTORY_PREVIEW;
    if (hiddenCount > 0) {
      card.classList.add("is-collapsed");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "clan-history-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", list.id);
      toggle.innerHTML = `
        <span class="clan-history-toggle-label">SEE MORE</span>
        <span class="clan-history-toggle-count">+${hiddenCount}</span>
        <span class="clan-history-toggle-chevron" aria-hidden="true">▾</span>`;
      toggle.addEventListener("click", () => {
        const expanded = !card.classList.toggle("is-collapsed");
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.querySelector(".clan-history-toggle-label").textContent = expanded
          ? "SEE LESS"
          : "SEE MORE";
      });
      body.appendChild(toggle);
    }
  }

  card.append(crest, body);
  return card;
}

function renderMyClan(board) {
  const list = document.createElement("div");
  list.className = "clan-stack";
  if (CONTENT.myClan) list.appendChild(buildHistoryCard(CONTENT.myClan));
  if (!list.children.length) {
    list.appendChild(clanEmpty("No current clan yet.", "The current role appears here."));
  }
  board.appendChild(list);
}

function renderClanHistory(board) {
  const list = document.createElement("div");
  list.className = "clan-stack";
  CONTENT.experience.forEach((job) => list.appendChild(buildHistoryCard(job)));
  if (!list.children.length) {
    list.appendChild(clanEmpty("No previous clans yet.", "Work history appears here."));
  }
  board.appendChild(list);
}

function buildTargetCard(target) {
  const card = document.createElement("article");
  card.className = "clan-card clan-target-card";

  const crest = clanCrest(target.crest, target.tone, target.logo);
  const body = document.createElement("div");
  body.className = "clan-history-body";

  const top = document.createElement("div");
  top.className = "clan-history-top";
  const name = document.createElement("h4");
  const link = document.createElement("a");
  link.className = "clan-target-link";
  link.href = target.link;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = target.name;
  name.appendChild(link);
  top.appendChild(name);
  body.appendChild(top);

  const summary = document.createElement("p");
  summary.className = "clan-target-summary";
  summary.textContent = target.summary;
  body.appendChild(summary);

  card.append(crest, body);
  return card;
}

function renderClanBookmarks(board) {
  const list = document.createElement("div");
  list.className = "clan-stack";
  (CONTENT.targetClans || []).forEach((target) => list.appendChild(buildTargetCard(target)));
  if (!list.children.length) {
    list.appendChild(clanEmpty("No target clans yet.", "Bookmarks appear here only when they are real."));
  }
  board.appendChild(list);
}

function renderClanTab(tab) {
  const config = CLAN_TABS[tab] || CLAN_TABS.myclan;
  clanBoard.innerHTML = "";
  config.render(clanBoard);
  clanBoard.scrollTop = 0;
}

function setClanTab(tab) {
  const next = CLAN_TABS[tab] ? tab : "myclan";
  clanTab = next;
  document.querySelectorAll(".clan-tab").forEach((btn) => {
    const active = btn.dataset.tab === next;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
  });
  clanSubtitle.textContent = CLAN_TABS[next].subtitle;
  renderClanTab(next);
}

function openClan() {
  openSheet(clanSheet);
  setClanTab(clanTab);
}

/* ------------------------------------------------------------------ */
/*  Sound                                                              */
/* ------------------------------------------------------------------ */

// One-time migration for the intro2 build: an old mute from the previous SFX
// build should not silently kill the new intro. A mute chosen from now on
// still persists.
const SOUND_PREF_VERSION = "intro2-2026-10";
try {
  if (localStorage.getItem("village-sound-version") !== SOUND_PREF_VERSION) {
    localStorage.setItem("village-sound", "on");
    localStorage.setItem("village-sound-version", SOUND_PREF_VERSION);
  }
} catch { /* storage can be blocked; keep the in-memory default */ }

let soundOn = readSoundPref();

// Building selection keeps the CoC-style request tick. Ogg Vorbis is not
// available on older Safari, so those browsers get an MP3 copy.
const selectAudio = new Audio();
selectAudio.preload = "auto";
selectAudio.volume = 0.5;
selectAudio.src = selectAudio.canPlayType('audio/ogg; codecs="vorbis"')
  ? "assets/sfx/thselect.ogg"
  : "assets/sfx/thselect.mp3";

function playSelectSfx() {
  if (!soundOn) return;
  try {
    selectAudio.currentTime = 0;
    selectAudio.play().catch(() => {});
  } catch { /* ignore */ }
}

// The pop covers every UI control: sheets, tabs, links, tour controls and
// the settings switch. Building selection deliberately stays on its own tick.
const popAudio = new Audio("assets/sfx/ui-pop.mp3");
popAudio.preload = "auto";
popAudio.volume = 0.55;

function playPopSfx() {
  if (!soundOn) return;
  try {
    popAudio.currentTime = 0;
    popAudio.play().catch(() => {});
  } catch { /* ignore */ }
}

// X and close buttons get their own cue, cleaned up from the supplied
// recording: denoised, trimmed, fade-edged and loudness-normalised.
const closeAudio = new Audio("assets/sfx/ui-close.mp3");
closeAudio.preload = "auto";
closeAudio.volume = 0.8;

function playCloseSfx() {
  if (!soundOn) return;
  try {
    popAudio.pause();
    popAudio.currentTime = 0;
    closeAudio.pause();
    closeAudio.currentTime = 0;
    closeAudio.play().catch(() => {});
  } catch { /* ignore */ }
}

// Web Audio Synthesizer for Procedural Clash SFX & Arcane Resonance
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playCrystalResonanceSfx() {
  if (!soundOn) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const freqs = [523.25, 659.25, 783.99, 1046.5]; // C-E-G-C shimmering chord
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.001, now);
  masterGain.gain.exponentialRampToValueAtTime(0.2, now + 0.12);
  masterGain.gain.exponentialRampToValueAtTime(0.001, now + 2.1);
  masterGain.connect(ctx.destination);

  freqs.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = idx === 0 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.detune.setValueAtTime((idx - 1.5) * 7, now);

    gain.gain.setValueAtTime(0.22 / freqs.length, now);
    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 2.2);
  });
}

const soundToggle = document.getElementById("settings-sound");
function setSound(on, announce = true, silent = false) {
  soundOn = on;
  writeSoundPref(on);
  if (soundToggle) soundToggle.setAttribute("aria-checked", String(on));
  const state = document.getElementById("settings-sound-state");
  if (state) state.textContent = on ? "ON" : "OFF";
  
  // Sync top HUD quick-sound button
  const soundQuickBtn = document.getElementById("sound-quick-btn");
  const iconOn = document.getElementById("sound-icon-on");
  const iconOff = document.getElementById("sound-icon-off");
  if (soundQuickBtn) soundQuickBtn.classList.toggle("is-muted", !on);
  if (iconOn) iconOn.style.display = on ? "block" : "none";
  if (iconOff) iconOff.style.display = on ? "none" : "block";

  if (announce) toast(on ? "Sound on" : "Sound off");
}
soundToggle?.addEventListener("click", () => {
  if (soundOn) {
    playPopSfx();
    setSound(false);
  } else {
    setSound(true);
    playPopSfx();
  }
});

// Quick HUD sound toggle
document.getElementById("sound-quick-btn")?.addEventListener("click", () => {
  setSound(!soundOn);
  playPopSfx();
});

// Quick HUD connect button -> opens Profile sheet
document.getElementById("connect-quick-btn")?.addEventListener("click", () => {
  playPopSfx();
  openProfile();
});

// Quick HUD resume button -> pop SFX
document.getElementById("resume-quick-btn")?.addEventListener("click", () => {
  playPopSfx();
});

// Reflect the saved preference in the settings switch on load.
setSound(soundOn, false, true);

async function initVisitCounter() {
  const countEl = document.getElementById("visit-count");
  const labelEl = document.getElementById("visit-label");
  const statEl = document.getElementById("visit-stat");
  if (!countEl) return;

  const paint = (value, live) => {
    const n = Math.max(0, Math.round(value));
    countEl.textContent = n.toLocaleString("en-US");
    if (labelEl) labelEl.textContent = live ? "VISITS" : n === 1 ? "YOUR VISIT" : "YOUR VISITS";
    if (statEl) {
      statEl.title = live
        ? "Live visit count for this preview"
        : "Visits from this device";
    }
  };

  // The local preview server owns a real counter. On a static host this
  // endpoint will not exist, so fall back to an honest per-device count.
  try {
    const response = await fetch("/api/visits", {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const data = await response.json();
      const n = Number(data?.count);
      if (Number.isFinite(n)) {
        paint(n, true);
        return;
      }
    }
  } catch { /* fall through to the per-device counter */ }

  let n = 1;
  try {
    const stored = Number(localStorage.getItem(DEVICE_VISIT_KEY) || 0);
    const counted = sessionStorage.getItem(SESSION_VISIT_KEY) === "1";
    n = Number.isFinite(stored) && stored > 0 ? stored : 0;
    if (!counted) {
      n += 1;
      localStorage.setItem(DEVICE_VISIT_KEY, String(n));
      sessionStorage.setItem(SESSION_VISIT_KEY, "1");
    } else if (!n) {
      n = 1;
    }
  } catch { n = 1; }
  paint(n, false);
}

/* ------------------------------------------------------------------ */
/*  Bind UI                                                            */
/* ------------------------------------------------------------------ */

function bindUI() {
  // Content.
  applyPlayerAge();
  document.getElementById("availability-text").textContent = CONTENT.identity.availability.toUpperCase();
  document.getElementById("xp-fill").style.width = "72%";

  // One capture listener covers every UI control, including controls inside
  // sheets that stop bubbling. Building selection is canvas-only and keeps its
  // own tick; the gate owns the intro audio and the sound switch handles itself.
  // The X buttons use the dedicated close cue instead of the generic pop.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest("#gate, #settings-sound")) return;
      const control = target.closest("button, a, [role='tab'], [role='switch'], [role='button']");
      if (!control || control.disabled || control.getAttribute("aria-disabled") === "true") return;
      if (control.matches(".close-btn, .tour-close, .arch-lightbox-close")) {
        playCloseSfx();
        return;
      }
      playPopSfx();
    },
    true
  );

  document.getElementById("profile-chip").addEventListener("click", () => {
    cancelCameraGoal();
    openProfile();
  });
  document.getElementById("profile-close").addEventListener("click", closeSheets);
  document.getElementById("townhall-close").addEventListener("click", closeSheets);

  document.getElementById("project-close").addEventListener("click", closeSheets);
  document.getElementById("project-back").addEventListener("click", backFromProject);
  document.getElementById("workshop-close").addEventListener("click", closeSheets);
  document.getElementById("clan-close").addEventListener("click", closeSheets);
  const clanTabButtons = [...document.querySelectorAll(".clan-tab")];
  clanTabButtons.forEach((btn, index) => {
    btn.addEventListener("click", () => setClanTab(btn.dataset.tab));
    btn.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = (index + step + clanTabButtons.length) % clanTabButtons.length;
      setClanTab(clanTabButtons[next].dataset.tab);
      clanTabButtons[next].focus();
    });
  });
  document.getElementById("arch-lightbox-close").addEventListener("click", closeArchLightbox);
  document.getElementById("arch-lightbox").addEventListener("click", (event) => {
    if (event.target.id === "arch-lightbox") {
      playPopSfx();
      closeArchLightbox();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById("arch-lightbox").classList.contains("show")) closeArchLightbox();
  });
  document.getElementById("info-close").addEventListener("click", closeSheets);
  document.getElementById("settings-close").addEventListener("click", closeSheets);

  scrim.addEventListener("click", () => {
    playPopSfx();
    closeSheets();
  });

  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("tour-btn").addEventListener("click", startTour);

  document.querySelectorAll(".sheet").forEach((sheet) => {
    sheet.addEventListener("click", (e) => e.stopPropagation());
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", () => {
    hovered = null;
    tooltip.classList.remove("show");
    setCanvasCursor("grab");
  });
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (tour.active) {
      endTour();
      return;
    }
    closeSheets();
    selection.classList.remove("show");
    if (selectedRing) selectedRing.visible = false;
    selected = null;
  });

  // Sound state without announcing or clicking over the intro on load.
  setSound(soundOn, false, true);
  initVisitCounter();
  window.setInterval(applyPlayerAge, 60 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) applyPlayerAge();
  });
}

/* ------------------------------------------------------------------ */
/*  Tour                                                               */
/* ------------------------------------------------------------------ */

const tourGuide = document.getElementById("tour-guide");
const tourLine = document.getElementById("tour-line");
const tourCount = document.getElementById("tour-count");
const tourPlace = document.getElementById("tour-place");
const tourNext = document.getElementById("tour-next");
const tourClose = document.getElementById("tour-close");
const tourPin = document.getElementById("tour-pin");
const tourPinIndex = document.getElementById("tour-pin-index");
const tourPinName = document.getElementById("tour-pin-name");
const tourPinSub = document.getElementById("tour-pin-sub");

// The tour speaks in a low, unhurried male voice. Pitch and rate are the same
// for every browser voice, so the guide keeps one personality.
const TOUR_VOICE_PITCH = 0.82;
const TOUR_VOICE_RATE = 0.98;
const TOUR_VOICE_NAMES = [
  /google uk english male/i,
  /microsoft (guy|ryan|george|david)/i,
  /\bdaniel\b/i,
  /\balex\b/i,
  /\bfred\b/i,
];
let tourVoiceCache = [];

const TOUR_STEPS = [
  {
    id: "townhall",
    place: "TOWN HALL 18",
    sub: "AGILE TITAN CITADEL",
    dist: 45,
    shiftX: -3.2,
    shiftY: -2.3,
    line:
      "Welcome to the Town Hall 18 Titan Citadel! I'm Balaji Palani, a Senior Scrum Master and Agile Delivery Lead with 7+ years of experience leading cross-functional squads, optimizing delivery flow, and shipping scalable tech products. Let's tour the village!",
  },
  {
    id: "workshop",
    place: "WORKSHOP",
    sub: "PRODUCTS & TOOLS",
    dist: 37,
    shiftX: -7.4,
    shiftY: -2.3,
    line:
      "This is the Workshop: full-stack products and tools I've built, including SlotCraft Clinic SaaS, Sai Satcharitra reader, and the Career-Ops autonomous engine. Tap any building to inspect the architecture and source code.",
  },
  {
    id: "barracks",
    place: "BARRACKS",
    sub: "AGILE & TECH STACK",
    dist: 36,
    shiftY: -2.3,
    line:
      "The Barracks is my delivery stack: Scrum, SAFe 6.0, Jira Automation, React, Next.js, and cloud CI/CD pipelines.",
  },
  {
    id: "clan",
    place: "CLAN CASTLE",
    sub: "ENTERPRISE LEADERSHIP",
    dist: 38,
    shiftY: -2.3,
    line:
      "The Clan Castle holds my enterprise track record: managing 3 squads on the UK BFSI banking initiative with MITS Global, and 10 distributed squads across the Verizon Agile Release Train with Incedo. Tap my Profile to connect directly on WhatsApp or Email.",
  },
];

// Narration mode. Switched to "ai" browser speech synthesis for Balaji Palani.
const TOUR_VOICE_MODE = "ai";
// Let the camera land before the guide starts talking, then leave a clear beat
// after the clip ends before moving to the next stop on its own.
const TOUR_VOICE_SETTLE_MS = 240;
const TOUR_ADVANCE_PAUSE_MS = 1800;
// Never hold the narration indefinitely if a low-frame-rate device is slow to
// finish the zoom tween.
const TOUR_FOCUS_MAX_MS = 1200;
const TOUR_RECORDINGS = [];
let tourVoiceClips = [];

function ensureTourVoiceClips() {
  return [];
}

const tour = {
  active: false,
  index: 0,
  timer: 0,
  narrationTimer: 0,
  speechToken: 0,
};

function refreshTourVoices() {
  if (!("speechSynthesis" in window)) return;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (voices?.length) tourVoiceCache = voices;
  } catch { /* speech synthesis can be disabled */ }
}

function pickTourVoice() {
  refreshTourVoices();
  const voices = tourVoiceCache;
  if (!voices.length) return null;
  for (const re of TOUR_VOICE_NAMES) {
    const match = voices.find((v) => re.test(v.name) || re.test(v.voiceURI || ""));
    if (match) return match;
  }
  return (
    voices.find((v) => /male|man/i.test(v.name) && /^en/i.test(v.lang)) ||
    voices.find((v) => /^en-(gb|us)/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    null
  );
}

function stopTourSpeech() {
  // Invalidate pending utterance callbacks before cancelling, so a cancelled
  // voice can never advance the next step or schedule a second timer.
  tour.speechToken++;
  window.clearTimeout(tour.timer);
  tour.timer = 0;
  window.clearTimeout(tour.narrationTimer);
  tour.narrationTimer = 0;
  for (const clip of tourVoiceClips) {
    try {
      clip.onended = null;
      clip.onerror = null;
      clip.pause();
      clip.currentTime = 0;
    } catch { /* metadata may not be ready yet */ }
  }
  if (!("speechSynthesis" in window)) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

function queueTourAdvance(ms) {
  window.clearTimeout(tour.timer);
  tour.timer = window.setTimeout(() => {
    tour.timer = 0;
    if (!tour.active) return;
    if (tour.index >= TOUR_STEPS.length - 1) endTour();
    else showTourStep(tour.index + 1);
  }, Math.max(600, ms));
}

// Parked synthesized guide. Kept intact so the AI voice can be restored by
// switching TOUR_VOICE_MODE back to "ai".
function sayTourLineAI(line) {
  stopTourSpeech();
  const token = tour.speechToken;
  const words = line.split(/\s+/).filter(Boolean).length;
  const readMs = clamp(words * 340, 5200, 16000);

  if (!soundOn || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    queueTourAdvance(readMs);
    return;
  }

  try {
    const utter = new SpeechSynthesisUtterance(line);
    const voice = pickTourVoice();
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang || "en-GB";
    utter.pitch = TOUR_VOICE_PITCH;
    utter.rate = TOUR_VOICE_RATE;
    utter.volume = 1;

    let settled = false;
    let safety = 0;
    const finish = (delay) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(safety);
      if (!tour.active || token !== tour.speechToken) return;
      queueTourAdvance(delay);
    };
    utter.onend = () => finish(1800);
    // If a browser voice fails or is blocked, fall back to reading time rather
    // than racing through the tour.
    utter.onerror = () => finish(readMs);
    // If a browser voice hangs without firing onend, keep the tour moving.
    safety = window.setTimeout(() => finish(readMs), readMs + 7000);
    window.speechSynthesis.speak(utter);
  } catch {
    queueTourAdvance(readMs);
  }
}

function sayTourLine(step) {
  if (TOUR_VOICE_MODE === "ai") {
    sayTourLineAI(step.line);
    return;
  }

  stopTourSpeech();
  const token = tour.speechToken;
  const index = TOUR_STEPS.indexOf(step);
  const clip = soundOn ? ensureTourVoiceClips()[index] : tourVoiceClips[index];
  const words = step.line.split(/\s+/).filter(Boolean).length;
  const readMs = clamp(words * 340, 5200, 16000);

  // With sound off the tour still moves at a natural reading pace.
  if (!soundOn || !clip) {
    queueTourAdvance(readMs);
    return;
  }

  let settled = false;
  let safety = 0;
  const finish = (delay) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(safety);
    clip.onended = null;
    clip.onerror = null;
    if (!tour.active || token !== tour.speechToken) return;
    queueTourAdvance(delay);
  };

  clip.onended = () => finish(TOUR_ADVANCE_PAUSE_MS);
  clip.onerror = () => finish(readMs);
  // The read-time estimate is always a little longer than the recording, so
  // this safety net only fires if the clip never reports that it ended.
  safety = window.setTimeout(() => finish(readMs), readMs + 8000);

  try {
    clip.currentTime = 0;
    const attempt = clip.play();
    if (attempt?.catch) attempt.catch(() => finish(readMs));
  } catch {
    finish(readMs);
  }
}

function positionTourPin() {
  if (!tour.active) {
    tourPin.classList.remove("show");
    return;
  }
  const step = TOUR_STEPS[tour.index];
  const b = step ? buildings.find((item) => item.id === step.id) : null;
  if (!b) {
    tourPin.classList.remove("show");
    return;
  }

  const view = viewSize();
  const projected = b.anchor.clone().project(camera);
  if (projected.z > 1) {
    tourPin.classList.remove("show");
    return;
  }
  const x = (projected.x * 0.5 + 0.5) * view.w;
  const y = (-projected.y * 0.5 + 0.5) * view.h;
  const padX = 86;
  tourPin.style.left = `${clamp(x, padX, view.w - padX)}px`;
  tourPin.style.top = `${clamp(y, 94, view.h - 148)}px`;
  tourPin.classList.add("show");
}

function queueTourNarration(step) {
  const token = tour.speechToken;
  const index = tour.index;
  const stillCurrent = () =>
    tour.active && token === tour.speechToken && index === tour.index;

  const begin = () => {
    if (!stillCurrent()) return;
    // A short settle after the zoom, so the voice lands with the building
    // already in frame instead of talking over the camera move.
    tour.narrationTimer = window.setTimeout(() => {
      tour.narrationTimer = 0;
      if (!stillCurrent()) return;
      sayTourLine(step);
    }, TOUR_VOICE_SETTLE_MS);
  };

  const focusWaitStarted = performance.now();
  const waitForFocus = () => {
    if (!stillCurrent()) return;
    const waited = performance.now() - focusWaitStarted;
    if (cameraGoal && waited < TOUR_FOCUS_MAX_MS) {
      tour.narrationTimer = window.setTimeout(waitForFocus, 40);
      return;
    }
    begin();
  };

  waitForFocus();
}

function showTourStep(index) {
  if (!tour.active) return;
  const step = TOUR_STEPS[index];
  const b = step ? buildings.find((item) => item.id === step.id) : null;
  if (!step || !b) {
    endTour();
    return;
  }

  tour.index = index;
  stopTourSpeech();
  tourPin.classList.remove("show");

  const count = String(index + 1).padStart(2, "0");
  const total = String(TOUR_STEPS.length).padStart(2, "0");
  tourCount.textContent = `${count} / ${total}`;
  tourPlace.textContent = step.place;
  tourPinIndex.textContent = count;
  tourPinName.textContent = step.place;
  tourPinSub.textContent = step.sub;
  tourNext.textContent = index === TOUR_STEPS.length - 1 ? "FINISH" : "NEXT →";
  tourLine.textContent = step.line;

  // selectBuilding gives the building its gold ring and squash without the
  // click cue or opening a sheet. Then the tour uses its own zoom distance and
  // a small framing offset so the speech bubble never covers the landmark.
  selectBuilding(b, { silent: true });
  const focus = b.focus.clone();
  if (step.shiftX) focus.x += step.shiftX;
  if (step.shiftY) focus.y += step.shiftY;
  focusOn(focus, step.dist);
  queueTourNarration(step);
}

function startTour() {
  if (tour.active) return;
  closeSheets();
  tour.active = true;
  tour.index = 0;
  app.classList.add("touring");
  tourGuide.classList.add("show");
  selection.classList.remove("show");
  tooltip.classList.remove("show");
  refreshTourVoices();
  if (soundOn) ensureTourVoiceClips();
  showTourStep(0);
}

function endTour() {
  if (!tour.active) return;
  tour.active = false;
  stopTourSpeech();
  tourGuide.classList.remove("show");
  tourPin.classList.remove("show");
  app.classList.remove("touring");
  selection.classList.remove("show");
  if (selectedRing) selectedRing.visible = false;
  selected = null;
  hovered = null;
  tooltip.classList.remove("show");
  setCanvasCursor("grab");
  focusOn(HOME_TARGET, HOME_DISTANCE);
}

function advanceTour() {
  if (!tour.active) return;
  if (tour.index >= TOUR_STEPS.length - 1) endTour();
  else showTourStep(tour.index + 1);
}

tourNext.addEventListener("click", advanceTour);
tourClose.addEventListener("click", () => endTour());
if ("speechSynthesis" in window) {
  refreshTourVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", refreshTourVoices);
}

/* ------------------------------------------------------------------ */
/*  Resize / orientation                                               */
/* ------------------------------------------------------------------ */

let forcedLandscape = false;

function applyOrientation() {
  // Phones keep the logo gate upright in portrait. The village itself still
  // turns to landscape as soon as the gate is tapped.
  const rotated = FORCE_ROTATE || (isTouch && (INTRO_SKIP || intro.landscape));
  const shouldForce = rotated && window.innerHeight > window.innerWidth;
  forcedLandscape = shouldForce;
  app.classList.toggle("force-landscape", shouldForce);
  resize();
}

function resize() {
  const view = viewSize();
  const dpr = window.devicePixelRatio || 1;
  // Browser zoom changes the CSS viewport and the device pixel ratio. A
  // full-viewport WebGL canvas normally ignores that and keeps the village
  // pinned to the same physical size. Fold the ratio into the camera so the
  // whole scene scales with the page instead of only the HTML HUD.
  browserZoom = clamp(dpr / BASE_DEVICE_PIXEL_RATIO, 0.5, 3);
  camera.aspect = view.w / view.h;
  camera.zoom = browserZoom;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(dpr, isTouch ? 1.5 : 2));
  renderer.setSize(view.w, view.h, false);
  positionTooltip();
}

window.addEventListener("resize", applyOrientation);
screen.orientation?.addEventListener?.("change", applyOrientation);

/* ------------------------------------------------------------------ */
/*  Boot and animation                                                 */
/* ------------------------------------------------------------------ */

let last = performance.now();

function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  // Intro camera move. It waits for the boot card and loading screen to clear.
  if (cameraIntroStarted && introT < 1) {
    introT = Math.min(1, introT + dt * 0.62);
    const e = easeOut(introT);
    distance = lerp(introFrom, HOME_DISTANCE, e);
    updateCamera();
  }

  // Focus goal.
  if (cameraGoal) {
    cameraGoal.t = Math.min(1, cameraGoal.t + dt * cameraGoal.speed);
    const e = smooth(cameraGoal.t);
    target.lerpVectors(cameraGoal.startTarget, cameraGoal.target, e);
    distance = lerp(cameraGoal.startDistance, cameraGoal.distance, e);
    updateCamera();
    if (cameraGoal.t >= 1) cameraGoal = null;
  }

  // TH18 Giga Arcane Core, Orbital Rings & Workshop Gears
  if (thAnimations.crystal) {
    thAnimations.crystal.rotation.y = t * 0.95;
    thAnimations.crystal.rotation.x = Math.sin(t * 0.6) * 0.16;
    thAnimations.crystal.position.y = 8.0 + Math.sin(t * 1.8) * 0.14;
  }
  if (thAnimations.ring1) {
    thAnimations.ring1.rotation.z = t * 1.6;
    thAnimations.ring1.rotation.x = Math.PI / 4 + Math.sin(t * 0.8) * 0.18;
    thAnimations.ring1.position.y = 8.0 + Math.sin(t * 1.8) * 0.14;
  }
  if (thAnimations.ring2) {
    thAnimations.ring2.rotation.y = -t * 1.9;
    thAnimations.ring2.rotation.z = -Math.PI / 4 + Math.cos(t * 0.9) * 0.18;
    thAnimations.ring2.position.y = 8.0 + Math.sin(t * 1.8) * 0.14;
  }
  if (thAnimations.light) {
    thAnimations.light.intensity = 2.6 + Math.sin(t * 3.5) * 0.8;
  }
  for (const gear of thAnimations.gears) {
    gear.rotation.z = t * 0.75;
  }

  // Cannon recoil animation
  if (cannonRecoil > 0) {
    cannonRecoil = Math.max(0, cannonRecoil - dt * 3.5);
    if (cannonBarrelGroup) {
      cannonBarrelGroup.position.x = 0.35 - Math.sin(cannonRecoil * Math.PI) * 0.28;
    }
  }

  // Active Cannonballs trajectory
  for (let i = activeCannonballs.length - 1; i >= 0; i--) {
    const cb = activeCannonballs[i];
    cb.t += dt * 1.8;
    if (cb.t >= 1) {
      scene.remove(cb.mesh);
      activeCannonballs.splice(i, 1);
      // Spawn impact smoke puffs
      for (let p = 0; p < 4; p++) {
        const puff = sphere(scene, 0.28, 6, M.smoke, cb.target.x + (rand() - 0.5) * 0.5, 0.4 + rand() * 0.3, cb.target.z + (rand() - 0.5) * 0.5, { cast: false });
        smokePuffs.push(puff);
      }
    } else {
      cb.mesh.position.lerpVectors(cb.start, cb.target, cb.t);
      cb.mesh.position.y = cb.start.y + Math.sin(cb.t * Math.PI) * 2.2 - cb.t * 0.8;
    }
  }

  // Gem particles floating up
  for (let i = gemParticles.length - 1; i >= 0; i--) {
    const gp = gemParticles[i];
    gp.life -= dt * 0.9;
    gp.sprite.position.y += gp.vy;
    gp.sprite.material.opacity = gp.life * 0.85;
    if (gp.life <= 0) {
      scene.remove(gp.sprite);
      gemParticles.splice(i, 1);
    }
  }

  // Flags.
  for (const f of flags) {
    const pos = f.cloth.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = f.base[i * 3];
      const by = f.base[i * 3 + 1];
      const wave = Math.sin(t * 3.2 + bx * 4.2 + f.phase) * 0.055 * (bx + 0.1);
      pos.setZ(i, wave);
      pos.setY(i, by + Math.sin(t * 2.4 + bx * 3 + f.phase) * 0.012 * bx);
    }
    pos.needsUpdate = true;
  }

  // Smoke.
  for (const p of smokePuffs) {
    const phase = (t * 0.22 + p.userData.phase) % 1;
    const baseX = p.userData.baseX ?? -0.72;
    const baseY = p.userData.baseY ?? 2.7;
    const baseZ = p.userData.baseZ ?? -0.4;
    p.position.y = baseY + phase * 1.15;
    p.position.x = baseX + Math.sin(t * 1.6 + p.userData.phase * 8) * 0.1 * phase;
    p.position.z = baseZ + Math.cos(t * 1.3 + p.userData.phase * 5) * 0.08 * phase;
    p.scale.setScalar(0.75 + phase * 1.1);
    p.material.opacity = 0.36 * (1 - phase);
  }

  // Water.
  WATER_TEX.offset.y = -(t * 0.028) % 1;
  WATER_TEX.offset.x = Math.sin(t * 0.18) * 0.012;
  OCEAN_TEX.offset.y = -(t * 0.012) % 1;
  OCEAN_TEX.offset.x = Math.sin(t * 0.1) * 0.008;
  for (const mat of waterfallMats) {
    if (!mat.map) continue;
    mat.map.offset.y = -(t * (mat.userData.speed || 0.25)) % 1;
    mat.map.offset.x = Math.sin(t * 0.22) * 0.015;
  }
  for (const m of waterfallMists) {
    const pulse = 0.5 + Math.sin(t * 0.8 + m.phase) * 0.5;
    m.sp.position.y = m.base.y + pulse * 0.65;
    m.sp.position.x = m.base.x + Math.sin(t * 0.35 + m.phase) * 0.3;
    m.sp.material.opacity = 0.2 + pulse * 0.15;
    m.sp.scale.setScalar(3.0 + pulse * 2.4);
  }

  // Builders.
  for (const b of builders) {
    b.armPivot.rotation.x = Math.sin(t * 5.8 + b.phase) * 0.55;
    b.armPivot.rotation.z = -0.4 + Math.sin(t * 5.8 + b.phase + 0.7) * 0.1;
    b.group.position.y = b.base.y + Math.abs(Math.sin(t * 5.8 + b.phase)) * 0.015;
  }

  // Clouds.
  for (const c of clouds) {
    c.sp.position.x += dt * c.speed;
    if (c.sp.position.x > 70) c.sp.position.x = -70;
  }

  // Lab bubbles.
  for (const b of bubbles) {
    const p = (t * 0.34 + b.phase) % 1;
    b.mesh.position.y = 2.66 + p * 1.18;
    b.mesh.position.x = b.x + Math.sin(t * 1.6 + b.phase * 9) * 0.16 * p;
    b.mesh.position.z = b.z + Math.cos(t * 1.4 + b.phase * 7) * 0.12 * p;
    b.mesh.scale.setScalar(0.75 + p * 0.55);
  }

  // Gem box.
  for (const gem of gems) {
    gem.rotation.y += dt * 1.6;
    gem.position.y = 1.02 + Math.sin(t * 2.1) * 0.08;
  }

  // Selection ring: a flat ground marker with a soft, slow pulse.
  if (selectedRing?.visible) {
    const base = selectedRing.userData.baseScale || 1;
    selectedRing.scale.setScalar(base * (1 + Math.sin(t * 2.2) * 0.012));
    if (selectedRing.userData.haloMat) {
      selectedRing.userData.haloMat.opacity = 0.13 + Math.sin(t * 2.2) * 0.045;
    }
  }

  // Squash.
  for (let i = squashes.length - 1; i >= 0; i--) {
    const s = squashes[i];
    s.t += dt * 4.4;
    const k = Math.sin(Math.min(1, s.t) * Math.PI);
    s.group.scale.set(1 - k * 0.07, 1 + k * 0.05, 1 - k * 0.07);
    if (s.t >= 1) {
      s.group.scale.set(1, 1, 1);
      squashes.splice(i, 1);
    }
  }

  // Keep the hover label and tour marker pinned to their buildings while the
  // camera zooms or the browser reflows, not only when the pointer moves.
  positionTooltip();
  positionTourPin();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function renderStill() {
  // Let fonts settle, then render a handful of frames for a deterministic still.
  scene.updateMatrixWorld(true);
  boot.style.display = "none";
  for (let i = 0; i < 3; i++) renderer.render(scene, camera);
  console.log("[village-v2] still rendered", renderer.info.render);
}

async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load('400 48px "Lilita One"'),
      document.fonts.load('400 24px "Lilita One"'),
      document.fonts.load('400 112px "Dela Logo"'),
      document.fonts.load('900 14px "Nunito"'),
      document.fonts.load('700 14px "Nunito"'),
    ]);
    await document.fonts.ready;
  } catch (e) {
    console.warn("Font load skipped", e);
  }
}

async function init() {
  setBootProgress(4);
  bootStatus.textContent = "Loading fonts";
  applyOrientation();
  await loadFonts();

  if (!intro.loadingAt) setBootProgress(6);
  bootStatus.textContent = "Shaping the island";

  // Hold the synchronous build until the entry tap and cue 1 have finished.
  // The loading screen then owns the wait, with cue 2 playing over it.
  await waitForIntroBuildWindow();

  buildVillage();
  bindUI();

  if (STILL) {
    // A still should show the village, not the auto-open profile.
    bootFill.style.width = "100%";
    bootStatus.textContent = "Ready";
    renderStill();
    return;
  }

  window.__village = {
    scene,
    camera,
    renderer,
    openProfile,
    openTownhall,
    openProject,
    openWorkshop,
    openContact: openProfile,
    openInfo,
    openBarracks,
    openClan,
    setClanTab,
    openSettings,
    focusOn,
    resetView: () => focusOn(HOME_TARGET, HOME_DISTANCE, true),
    getCameraState: () => ({
      target: target.toArray(),
      distance,
      goal: cameraGoal
        ? { target: cameraGoal.target.toArray(), distance: cameraGoal.distance, t: cameraGoal.t }
        : null,
    }),
    getZoomState: () => ({
      browserZoom,
      baseDPR: BASE_DEVICE_PIXEL_RATIO,
      dpr: window.devicePixelRatio || 1,
      cameraZoom: camera.zoom,
    }),
    getPlayerState: () => ({ age: playerAge }),
    pickBuilding,
    selectBuilding,
    handleTap,
    buildings,
    CONTENT,
    intro,
    introOne,
    introTwo,
    selectAudio,
    popAudio,
    closeAudio,
    tour: {
      start: startTour,
      end: endTour,
      next: advanceTour,
      // Deterministic hooks for QA; normal visitors only use the on-screen UI.
      show: (index) => showTourStep(index),
      hold: () => {
        window.clearTimeout(tour.timer);
        tour.timer = 0;
      },
      state: () => ({
        active: tour.active,
        index: tour.index,
        total: TOUR_STEPS.length,
        step: TOUR_STEPS[tour.index]?.id || null,
        line: tourLine.textContent,
        voiceMode: TOUR_VOICE_MODE,
        speaking:
          TOUR_VOICE_MODE === "recorded"
            ? tourVoiceClips.some((clip) => !clip.paused && !clip.ended)
            : "speechSynthesis" in window
              ? window.speechSynthesis.speaking
              : false,
      }),
      get clips() {
        return tourVoiceClips;
      },
    },
  };

  const panelActions = {
    profile: openProfile,
    about: openTownhall,
    townhall: openTownhall,
    workshop: openWorkshop,
    projects: openWorkshop,
    barracks: openBarracks,
    stack: openBarracks,
    clan: openClan,
    contact: openProfile,
    settings: openSettings,
  };
  const panel = params.get("panel");

  function afterIntro() {
    if (panel) {
      const action = panelActions[panel] || (() => openProject(panel));
      window.setTimeout(action, reduceMotion ? 120 : 500);
      return;
    }
    // No automatic profile. Only the explicit ?profile=1 test hook opens it.
    if (FORCE_PROFILE) {
      window.setTimeout(() => {
        if (!document.querySelector(".sheet.show")) openProfile();
      }, reduceMotion ? 350 : 700);
    }
  }

  if (INTRO_SKIP) {
    intro.revealed = true;
    intro.started = true;
    intro.sceneReady = true;
    cameraIntroStarted = true;
    introT = 1;
    distance = HOME_DISTANCE;
    updateCamera();
    afterIntro();
  } else {
    introOnReveal(afterIntro);
    markIntroSceneReady();
  }

  requestAnimationFrame((now) => {
    last = now;
    animate(now);
  });
}

if (INTRO_SKIP) {
  gate.style.display = "none";
  splash.style.display = "none";
  boot.classList.add("done");
}

// The logo gate waits for a click. That click is the user gesture that lets
// cue 1 start, then the original SID / DHE / SHK splash runs unchanged.
if (!INTRO_SKIP) armIntro();

init().catch((err) => {
  console.error(err);
  bootStatus.textContent = "The village failed to build — check the console.";
  boot.classList.add("failed");
  setBootProgress(100);
});
