const video = document.getElementById("webcam");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");

const gameCanvas = document.getElementById("gameCanvas");
const gameCtx = gameCanvas.getContext("2d");

const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const cameraSelect = document.getElementById("cameraSelect");
const statusText = document.getElementById("status");
const gamePanel = document.getElementById("gamePanel");

const pelhamBg = new Image();
pelhamBg.src = "pelham-catcher-bg.png";
let pelhamBgLoaded = false;
pelhamBg.onload = () => {
  pelhamBgLoaded = true;
};

let detector = null;
let started = false;
let selectedCameraId = "";

let latestKeypoints = null;
let isEstimating = false;

let wristScreen = null;
let shoulderScreen = null;
let elbowScreen = null;

let loadBox = null;
let readyBox = null;
let targetCenter = null;
let followGuide = null;

let impactZones = [];
let activeTargetZoneId = "glove";

let wristHistory = [];
let readyFrames = 0;
let readyLockout = false;
let throwCooldown = false;

let phase = "LOAD";
let pitchCount = 0;
const MAX_PITCHES = 6;

let feedbackText = "READY";
let feedbackTimer = 0;
let currentPower = 0;

let rings = [];
let sparks = [];
let confetti = [];
let flashes = [];
let starBursts = [];
let projectiles = [];
let hitLabels = [];
let shockwaves = [];
let impactDust = [];
let streaks = [];
let screenPulse = 0;
let zoneGlowBursts = [];

let bgFade = 0;
let bgFadeTarget = 0;
let mittFlash = 0;
let mittPulse = 0;
let shakePower = 0;
let shakeX = 0;
let shakeY = 0;

const FORWARD_DIRECTION = 1;
const HOLD_FRAMES_REQUIRED = 5;
const RELEASE_THRESHOLD = 32;
const MAX_HISTORY = 20;

const COLORS = {
  blue: "#6cc7ff",
  green: "#8ed857",
  yellow: "#f1c94c",
  orange: "#f29a45",
  pink: "#d87adf",
  aqua: "#7ef7ff",
  red: "#ff6b6b",
  white: "#ffffff",
  navy: "#07121f",
  dark: "#07131f",
  lime: "#bbff6a"
};

function setStatus(text) {
  if (statusText) statusText.textContent = text;
}

/* =========================
   AUDIO
========================= */
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playTone(freq = 440, duration = 0.08, type = "sine", volume = 0.04, slideTo = null) {
  ensureAudio();

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (slideTo !== null) {
    osc.frequency.linearRampToValueAtTime(slideTo, now + duration);
  }

  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + duration);
}

function playNoise(duration = 0.05, volume = 0.02, highpass = 1200) {
  ensureAudio();

  const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * duration, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();

  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = highpass;

  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  source.start();
  source.stop(audioCtx.currentTime + duration);
}

function playLoad() {
  playTone(520, 0.08, "triangle", 0.04);
}

function playThrow() {
  playTone(240, 0.08, "sawtooth", 0.045, 540);
  setTimeout(() => playNoise(0.04, 0.015, 1600), 18);
}

function playHit() {
  playTone(920, 0.05, "square", 0.05);
  setTimeout(() => playTone(1220, 0.08, "square", 0.045), 40);
}

function playNear() {
  playTone(720, 0.05, "triangle", 0.04);
  setTimeout(() => playTone(860, 0.07, "triangle", 0.032), 35);
}

function playMiss() {
  playTone(210, 0.08, "sawtooth", 0.03, 140);
}

function playSuccess() {
  playTone(620, 0.08, "triangle", 0.045);
  setTimeout(() => playTone(860, 0.08, "triangle", 0.04), 50);
  setTimeout(() => playTone(1120, 0.12, "triangle", 0.04), 100);
}

function playReset() {
  playTone(500, 0.05, "triangle", 0.03);
}

/* =========================
   CAMERA PICKER
========================= */
async function populateCameraSelect() {
  if (!cameraSelect) return;

  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");

    cameraSelect.innerHTML = "";

    if (!cams.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No cameras found";
      cameraSelect.appendChild(option);
    } else {
      cams.forEach((cam, i) => {
        const option = document.createElement("option");
        option.value = cam.deviceId;
        option.textContent = cam.label || `Camera ${i + 1}`;
        cameraSelect.appendChild(option);
      });

      const preferred =
        cams.find((d) => /obs virtual camera/i.test(d.label)) ||
        cams.find((d) => /azure|kinect/i.test(d.label)) ||
        cams[0];

      selectedCameraId = preferred.deviceId;
      cameraSelect.value = selectedCameraId;
    }

    cameraSelect.onchange = () => {
      selectedCameraId = cameraSelect.value;
    };

    tempStream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    console.error("populateCameraSelect error:", err);
    setStatus("Allow camera access, then refresh.");
  }
}

/* =========================
   START CAMERA
========================= */
async function startCamera() {
  ensureAudio();
  setStatus("Starting camera...");

  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 }
    },
    audio: false
  });

  video.srcObject = stream;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Camera timeout")), 12000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      resolve();
    };

    video.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Video failed to load"));
    };
  });

  await video.play();

  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;

  if (!detector) {
    await tf.setBackend("webgl");
    await tf.ready();

    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
      }
    );
  }

  if (gamePanel) {
    gamePanel.classList.add("game-active");
  }

  bgFadeTarget = 1;
  setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Put your throwing hand in the blue box.`);

  if (!started) {
    started = true;
    requestAnimationFrame(loop);
  }
}

/* =========================
   RESET
========================= */
function resetGame() {
  phase = "LOAD";
  pitchCount = 0;
  readyFrames = 0;
  readyLockout = false;
  throwCooldown = false;
  feedbackText = "READY";
  feedbackTimer = 0;
  currentPower = 0;
  wristHistory = [];
  rings = [];
  sparks = [];
  confetti = [];
  flashes = [];
  starBursts = [];
  projectiles = [];
  hitLabels = [];
  shockwaves = [];
  impactDust = [];
  streaks = [];
  zoneGlowBursts = [];
  mittFlash = 0;
  mittPulse = 0;
  shakePower = 0;
  screenPulse = 0;
  activeTargetZoneId = "glove";

  playReset();
  setStatus(`Pitch 1/${MAX_PITCHES} · Put your throwing hand in the blue box.`);
}

/* =========================
   BUTTONS
========================= */
startBtn.onclick = async () => {
  try {
    await startCamera();
  } catch (err) {
    console.error("Camera start error:", err);
    setStatus("Camera failed: " + err.message);
    alert("Camera failed: " + err.message);
  }
};

resetBtn.onclick = () => {
  resetGame();
};

/* =========================
   MAIN LOOP
========================= */
function loop() {
  requestAnimationFrame(loop);

  if (detector && video.readyState >= 2 && !isEstimating) {
    estimatePoseFrame();
  }

  processPose();
  updateFX();
  drawGame();
  drawOverlay();
}

async function estimatePoseFrame() {
  if (!detector) return;

  try {
    isEstimating = true;
    const poses = await detector.estimatePoses(video);

    if (poses?.length && poses[0].keypoints) {
      latestKeypoints = poses[0].keypoints;
    } else {
      latestKeypoints = null;
    }
  } catch (err) {
    console.error("Pose estimate error:", err);
    latestKeypoints = null;
  } finally {
    isEstimating = false;
  }
}

function processPose() {
  if (!latestKeypoints) {
    if (started) {
      setStatus("No body detected. Step back so your upper body is visible.");
    }
    return;
  }

  const rightWrist = findKeypoint(latestKeypoints, "right_wrist");
  const rightShoulder = findKeypoint(latestKeypoints, "right_shoulder");
  const rightElbow = findKeypoint(latestKeypoints, "right_elbow");
  const rightHip = findKeypoint(latestKeypoints, "right_hip");
  const leftShoulder = findKeypoint(latestKeypoints, "left_shoulder");

  if (
    !rightWrist || !rightShoulder || !rightElbow || !rightHip || !leftShoulder ||
    rightWrist.score < 0.2 ||
    rightShoulder.score < 0.2 ||
    rightElbow.score < 0.2 ||
    rightHip.score < 0.2 ||
    leftShoulder.score < 0.2
  ) {
    setStatus("Upper body not clear. Face camera and step back.");
    return;
  }

  wristScreen = { x: rightWrist.x, y: rightWrist.y };
  shoulderScreen = { x: rightShoulder.x, y: rightShoulder.y };
  elbowScreen = { x: rightElbow.x, y: rightElbow.y };

  const torsoHeight = Math.abs(rightHip.y - rightShoulder.y);
  const shoulderSpan = Math.abs(rightShoulder.x - leftShoulder.x);

  const boxW = Math.max(shoulderSpan * 1.45, 190);
  const boxH = Math.max(torsoHeight * 1.2, 220);

  loadBox = {
    x: shoulderScreen.x - boxW - 8,
    y: shoulderScreen.y - boxH * 0.05,
    w: boxW,
    h: boxH
  };

  readyBox = {
    x: loadBox.x + 6,
    y: loadBox.y + 6,
    w: loadBox.w - 12,
    h: loadBox.h - 12
  };

  const bgRect = getCoverRect(
    pelhamBgLoaded ? pelhamBg.width : 1365,
    pelhamBgLoaded ? pelhamBg.height : 768,
    gameCanvas.width,
    gameCanvas.height
  );

  buildImpactZones(bgRect);

  const activeZone = getActiveTargetZone();
  targetCenter = activeZone ? { x: activeZone.x, y: activeZone.y } : { x: gameCanvas.width * 0.72, y: gameCanvas.height * 0.38 };

  followGuide = {
    x1: targetCenter.x - 14,
    y1: targetCenter.y + 10,
    x2: targetCenter.x + 88,
    y2: targetCenter.y + 96
  };

  if (phase === "DONE" || throwCooldown) return;

  const inLoad = pointInRect(wristScreen.x, wristScreen.y, loadBox);
  const inReady = pointInRect(wristScreen.x, wristScreen.y, readyBox);

  if (phase === "LOAD" && readyLockout) {
    if (!inLoad) {
      readyLockout = false;
      readyFrames = 0;
      setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Re-enter the blue box.`);
    } else {
      setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Move arm out, then reload.`);
    }
    return;
  }

  wristHistory.push({
    x: wristScreen.x,
    y: wristScreen.y,
    t: performance.now()
  });

  if (wristHistory.length > MAX_HISTORY) {
    wristHistory.shift();
  }

  if (phase === "LOAD") {
    if (inReady) {
      readyFrames++;
      if (readyFrames >= HOLD_FRAMES_REQUIRED) {
        phase = "READY";
        feedbackText = "ARM READY";
        feedbackTimer = 999999;
        playLoad();
        wristHistory = [];
        setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Throw to Pelham!`);
      } else {
        setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Hold in the green zone...`);
      }
    } else {
      readyFrames = 0;
      setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Put your throwing hand in the blue box.`);
    }
    return;
  }

  if (phase === "READY") {
    if (wristHistory.length >= 4) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];

      const rawForwardX = (last.x - first.x) * FORWARD_DIRECTION;
      const upwardY = first.y - last.y;

      const forwardX = Math.max(0, rawForwardX);
      const power = forwardX + Math.max(0, upwardY) * 0.30;
      currentPower = Math.min(420, power * 3.2);

      if (forwardX > RELEASE_THRESHOLD) {
        triggerThrow(power);
      } else {
        setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Throw to Pelham.`);
      }
    }
  }
}

/* =========================
   IMPACT ZONES
========================= */
function buildImpactZones(bgRect) {
  const s = Math.min(bgRect.w, bgRect.h);

  impactZones = [
    {
      id: "glove",
      label: "GLOVE SNAP",
      shape: "ellipse",
      x: bgRect.x + bgRect.w * 0.765,
      y: bgRect.y + bgRect.h * 0.405,
      rx: s * 0.070,
      ry: s * 0.085,
      color: COLORS.yellow,
      bonus: true
    },
    {
      id: "gloveLow",
      label: "LOW SAVE",
      shape: "ellipse",
      x: bgRect.x + bgRect.w * 0.735,
      y: bgRect.y + bgRect.h * 0.470,
      rx: s * 0.060,
      ry: s * 0.072,
      color: COLORS.orange,
      bonus: false
    },
    {
      id: "mask",
      label: "MASK TAP",
      shape: "ellipse",
      x: bgRect.x + bgRect.w * 0.512,
      y: bgRect.y + bgRect.h * 0.262,
      rx: s * 0.060,
      ry: s * 0.055,
      color: COLORS.aqua,
      bonus: false
    },
    {
      id: "chest",
      label: "CHEST BLOCK",
      shape: "ellipse",
      x: bgRect.x + bgRect.w * 0.510,
      y: bgRect.y + bgRect.h * 0.515,
      rx: s * 0.095,
      ry: s * 0.110,
      color: COLORS.green,
      bonus: false
    },
    {
      id: "leftPad",
      label: "KNEE SAVE",
      shape: "ellipse",
      x: bgRect.x + bgRect.w * 0.314,
      y: bgRect.y + bgRect.h * 0.720,
      rx: s * 0.075,
      ry: s * 0.090,
      color: COLORS.pink,
      bonus: false
    },
    {
      id: "rightPad",
      label: "SHIN SAVE",
      shape: "ellipse",
      x: bgRect.x + bgRect.w * 0.690,
      y: bgRect.y + bgRect.h * 0.720,
      rx: s * 0.072,
      ry: s * 0.088,
      color: COLORS.lime,
      bonus: false
    },
    {
      id: "centerBlock",
      label: "CENTER BLOCK",
      shape: "ellipse",
      x: bgRect.x + bgRect.w * 0.555,
      y: bgRect.y + bgRect.h * 0.625,
      rx: s * 0.085,
      ry: s * 0.095,
      color: COLORS.blue,
      bonus: false
    }
  ];
}

function getActiveTargetZone() {
  return impactZones.find(z => z.id === activeTargetZoneId) || impactZones[0] || null;
}

function chooseNextTargetZone() {
  if (!impactZones.length) return;
  const choices = impactZones.filter(z => z.id !== activeTargetZoneId);
  const pickFrom = choices.length ? choices : impactZones;
  const picked = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  activeTargetZoneId = picked.id;
}

function pointInZone(px, py, zone) {
  if (zone.shape === "ellipse") {
    const dx = (px - zone.x) / zone.rx;
    const dy = (py - zone.y) / zone.ry;
    return dx * dx + dy * dy <= 1;
  }

  if (zone.shape === "circle") {
    const dx = px - zone.x;
    const dy = py - zone.y;
    return Math.hypot(dx, dy) <= zone.r;
  }

  return false;
}

function normalizedDistanceToZone(px, py, zone) {
  if (zone.shape === "ellipse") {
    const dx = (px - zone.x) / zone.rx;
    const dy = (py - zone.y) / zone.ry;
    return Math.sqrt(dx * dx + dy * dy);
  }

  if (zone.shape === "circle") {
    const dx = px - zone.x;
    const dy = py - zone.y;
    return Math.hypot(dx, dy) / zone.r;
  }

  return 999;
}

function findImpactZone(hitX, hitY) {
  let best = null;
  let bestNorm = Infinity;

  for (const zone of impactZones) {
    const norm = normalizedDistanceToZone(hitX, hitY, zone);
    if (norm <= 1 && norm < bestNorm) {
      bestNorm = norm;
      best = zone;
    }
  }

  return { zone: best, norm: bestNorm };
}

/* =========================
   THROW LOGIC
========================= */
function triggerThrow(power) {
  if (!wristScreen || !shoulderScreen || !elbowScreen) return;

  const activeZone = getActiveTargetZone();
  if (!activeZone) return;

  const histFirst = wristHistory[0] || wristScreen;
  const histLast = wristHistory[wristHistory.length - 1] || wristScreen;

  const motionDx = (histLast.x - histFirst.x) * FORWARD_DIRECTION;
  const motionDy = histFirst.y - histLast.y;

  const shoulderToWristX = (wristScreen.x - shoulderScreen.x) * FORWARD_DIRECTION;
  const shoulderToWristY = shoulderScreen.y - wristScreen.y;

  const elbowToWristX = (wristScreen.x - elbowScreen.x) * FORWARD_DIRECTION;
  const elbowToWristY = elbowScreen.y - wristScreen.y;

  const powerNorm = clamp(power / 220, 0, 1);

  const aimX =
    activeZone.x +
    clamp(
      shoulderToWristX * 1.15 +
      motionDx * 0.95 +
      elbowToWristX * 0.58,
      -240,
      240
    );

  const aimY =
    activeZone.y -
    clamp(
      shoulderToWristY * 0.90 +
      motionDy * 0.82 +
      elbowToWristY * 0.38,
      -165,
      180
    );

  const randomness =
    powerNorm < 0.35 ? 34 :
    powerNorm < 0.65 ? 22 : 14;

  const projectedHit = {
    x: clamp(aimX + rand(-randomness, randomness), 40, gameCanvas.width - 40),
    y: clamp(aimY + rand(-randomness, randomness), 60, gameCanvas.height - 50)
  };

  playThrow();
  spawnReleaseTrail(wristScreen.x, wristScreen.y, projectedHit.x, projectedHit.y, powerNorm);

  const impact = findImpactZone(projectedHit.x, projectedHit.y);
  const result = evaluateImpactResult(projectedHit, impact.zone, impact.norm, activeZone, powerNorm);

  feedbackText = result.label;
  feedbackTimer = 75;

  spawnBigImpact(projectedHit.x, projectedHit.y, result.impactColor, result.impactPower, result.tier);
  spawnHitLabel(projectedHit.x, projectedHit.y - 24, result.label, result.labelColor);
  spawnScreenShock(projectedHit.x, projectedHit.y, result.tier, result.impactColor);

  if (impact.zone) {
    spawnZoneGlowBurst(impact.zone);
  }

  shakePower = Math.max(shakePower, result.shake);
  screenPulse = Math.max(screenPulse, result.screenPulse);
  mittFlash = 1;
  mittPulse = 1;

  phase = "RESET";
  throwCooldown = true;
  pitchCount++;

  setStatus(`Pitch ${pitchCount}/${MAX_PITCHES} complete...`);

  const finalPitch = pitchCount >= MAX_PITCHES;

  setTimeout(() => {
    playSuccess();

    if (finalPitch) {
      phase = "DONE";
      feedbackText = "ROUND COMPLETE";
      feedbackTimer = 180;
      setStatus("Nice work! Press Reset Game to play again.");
      setTimeout(() => {
        throwCooldown = false;
      }, 2300);
      return;
    }

    readyLockout = true;
    readyFrames = 0;
    wristHistory = [];
    feedbackText = "READY";
    feedbackTimer = 0;
    currentPower = 0;

    chooseNextTargetZone();

    setStatus(`Reset for pitch ${pitchCount + 1}/${MAX_PITCHES}...`);

    setTimeout(() => {
      phase = "LOAD";
      throwCooldown = false;
      setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Move arm out, then reload.`);
    }, 1250);
  }, 700);
}

function evaluateImpactResult(projectedHit, hitZone, hitNorm, activeZone, powerNorm) {
  if (hitZone) {
    const cleanFactor = clamp(1 - hitNorm, 0, 1);
    const isActive = hitZone.id === activeZone.id;

    if (isActive && cleanFactor > 0.62) {
      playHit();
      flashGamePanel();
      return {
        tier: "bullseye",
        label: `${hitZone.label}!`,
        labelColor: hitZone.color,
        impactColor: hitZone.color,
        impactPower: 320 + cleanFactor * 220 + powerNorm * 120,
        shake: 18,
        screenPulse: 0.58
      };
    }

    if (isActive) {
      playHit();
      flashGamePanel();
      return {
        tier: "strong",
        label: "TARGET HIT",
        labelColor: hitZone.color,
        impactColor: hitZone.color,
        impactPower: 230 + cleanFactor * 150 + powerNorm * 90,
        shake: 12,
        screenPulse: 0.36
      };
    }

    if (cleanFactor > 0.58) {
      playNear();
      return {
        tier: "zonehit",
        label: hitZone.label,
        labelColor: hitZone.color,
        impactColor: hitZone.color,
        impactPower: 180 + cleanFactor * 120 + powerNorm * 70,
        shake: 9,
        screenPulse: 0.24
      };
    }

    playNear();
    return {
      tier: "graze",
      label: "NICE TRY",
      labelColor: COLORS.orange,
      impactColor: COLORS.orange,
      impactPower: 135 + cleanFactor * 80 + powerNorm * 60,
      shake: 7,
      screenPulse: 0.18
    };
  }

  playMiss();
  return {
    tier: "miss",
    label: "BIG THROW!",
    labelColor: COLORS.pink,
    impactColor: COLORS.pink,
    impactPower: 95 + powerNorm * 60,
    shake: 5,
    screenPulse: 0.12
  };
}

/* =========================
   RELEASE TRAIL + LABELS
========================= */
function spawnReleaseTrail(x1, y1, x2, y2, throwFactor) {
  projectiles.push({
    x1,
    y1,
    x2,
    y2,
    progress: 0,
    speed: 0.16 + throwFactor * 0.10,
    alpha: 0.95,
    color: throwFactor > 0.6 ? COLORS.orange : COLORS.aqua,
    width: 4 + throwFactor * 4
  });

  for (let i = 0; i < 8; i++) {
    sparks.push({
      x: x1,
      y: y1,
      vx: Math.random() * 6 - 3,
      vy: Math.random() * 6 - 3,
      size: 3 + Math.random() * 4,
      alpha: 0.72,
      color: i % 2 === 0 ? COLORS.aqua : COLORS.orange
    });
  }

  for (let i = 0; i < 5; i++) {
    streaks.push({
      x: x1,
      y: y1,
      vx: (x2 - x1) * (0.03 + Math.random() * 0.02),
      vy: (y2 - y1) * (0.03 + Math.random() * 0.02),
      len: 16 + Math.random() * 16,
      alpha: 0.65,
      color: throwFactor > 0.6 ? COLORS.yellow : COLORS.aqua
    });
  }
}

function spawnHitLabel(x, y, text, color) {
  hitLabels.push({
    x,
    y,
    text,
    color,
    alpha: 1,
    vy: -0.35,
    scale: 1
  });
}

function spawnZoneGlowBurst(zone) {
  zoneGlowBursts.push({
    x: zone.x,
    y: zone.y,
    rx: zone.rx ? zone.rx * 0.7 : 40,
    ry: zone.ry ? zone.ry * 0.7 : 40,
    alpha: 0.6,
    color: zone.color
  });
}

/* =========================
   GAME PANEL FLASH
========================= */
function flashGamePanel() {
  if (!gamePanel) return;
  gamePanel.classList.add("impactFlash");
  setTimeout(() => {
    gamePanel.classList.remove("impactFlash");
  }, 280);
}

/* =========================
   FX UPDATE
========================= */
function updateFX() {
  bgFade += (bgFadeTarget - bgFade) * 0.06;

  mittFlash *= 0.90;
  mittPulse *= 0.92;
  screenPulse *= 0.90;

  shakePower *= 0.86;
  shakeX = (Math.random() * 2 - 1) * shakePower;
  shakeY = (Math.random() * 2 - 1) * shakePower;

  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].r += rings[i].grow;
    rings[i].alpha *= 0.92;
    if (rings[i].alpha < 0.04) rings.splice(i, 1);
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx;
    s.y += s.vy;
    s.size *= 0.96;
    s.alpha *= 0.94;
    if (s.size < 0.8 || s.alpha < 0.05) sparks.splice(i, 1);
  }

  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.x += c.vx;
    c.y += c.vy;
    c.vy += 0.08;
    c.rot += c.spin;
    c.alpha *= 0.985;
    if (c.alpha < 0.05 || c.y > gameCanvas.height + 40) confetti.splice(i, 1);
  }

  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].alpha *= 0.9;
    if (flashes[i].alpha < 0.04) flashes.splice(i, 1);
  }

  for (let i = starBursts.length - 1; i >= 0; i--) {
    const s = starBursts[i];
    s.life--;
    s.scale *= 1.02;
    s.alpha *= 0.93;
    if (s.life <= 0 || s.alpha < 0.04) starBursts.splice(i, 1);
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.progress += p.speed;
    p.alpha *= 0.97;
    if (p.progress >= 1 || p.alpha < 0.04) {
      projectiles.splice(i, 1);
    }
  }

  for (let i = hitLabels.length - 1; i >= 0; i--) {
    const h = hitLabels[i];
    h.y += h.vy;
    h.alpha *= 0.95;
    h.scale *= 1.01;
    if (h.alpha < 0.05) {
      hitLabels.splice(i, 1);
    }
  }

  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.radius += s.grow;
    s.alpha *= 0.92;
    if (s.alpha < 0.04) shockwaves.splice(i, 1);
  }

  for (let i = impactDust.length - 1; i >= 0; i--) {
    const d = impactDust[i];
    d.x += d.vx;
    d.y += d.vy;
    d.radius *= 1.02;
    d.alpha *= 0.95;
    if (d.alpha < 0.04) impactDust.splice(i, 1);
  }

  for (let i = streaks.length - 1; i >= 0; i--) {
    const s = streaks[i];
    s.x += s.vx;
    s.y += s.vy;
    s.alpha *= 0.94;
    s.len *= 0.98;
    if (s.alpha < 0.05 || s.len < 4) streaks.splice(i, 1);
  }

  for (let i = zoneGlowBursts.length - 1; i >= 0; i--) {
    const z = zoneGlowBursts[i];
    z.rx *= 1.03;
    z.ry *= 1.03;
    z.alpha *= 0.92;
    if (z.alpha < 0.04) zoneGlowBursts.splice(i, 1);
  }

  if (feedbackTimer > 0 && feedbackTimer < 999999) feedbackTimer--;
}

/* =========================
   FX SPAWN
========================= */
function spawnBigImpact(x, y, color, power = 160, tier = "graze") {
  const ringCount =
    power > 340 ? 24 :
    power > 260 ? 19 :
    power > 180 ? 14 : 9;

  const ringScale =
    power > 340 ? 3.4 :
    power > 260 ? 2.65 :
    power > 180 ? 2.0 : 1.35;

  for (let i = 0; i < ringCount; i++) {
    rings.push({
      x,
      y,
      r: (10 + i * 18) * ringScale,
      grow: (6 + i * 0.9) * ringScale,
      alpha: 0.96 - i * 0.036,
      color: i % 3 === 0 ? COLORS.yellow : i % 3 === 1 ? color : COLORS.aqua
    });
  }

  const confettiCount =
    tier === "bullseye" ? ringCount * 12 :
    tier === "strong" ? ringCount * 8 :
    tier === "zonehit" ? ringCount * 7 :
    tier === "graze" ? ringCount * 5 : ringCount * 2;

  for (let i = 0; i < confettiCount; i++) {
    confetti.push({
      x,
      y,
      vx: Math.random() * 24 - 12,
      vy: Math.random() * -18 - 2,
      w: 8 + Math.random() * 18,
      h: 5 + Math.random() * 12,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.7,
      alpha: 1,
      color: [COLORS.blue, COLORS.orange, COLORS.yellow, COLORS.green, COLORS.pink, COLORS.aqua][Math.floor(Math.random() * 6)]
    });
  }

  const sparkCount =
    tier === "bullseye" ? 42 :
    tier === "strong" ? 32 :
    tier === "zonehit" ? 26 :
    tier === "graze" ? 20 : 12;

  for (let i = 0; i < sparkCount; i++) {
    sparks.push({
      x,
      y,
      vx: Math.random() * 22 - 11,
      vy: Math.random() * 22 - 11,
      size: 6 + Math.random() * 16,
      alpha: 0.98,
      color: [COLORS.yellow, COLORS.aqua, COLORS.orange, COLORS.pink][Math.floor(Math.random() * 4)]
    });
  }

  const burstCount =
    tier === "bullseye" ? 5 :
    tier === "strong" ? 4 :
    tier === "zonehit" ? 4 :
    tier === "graze" ? 3 : 2;

  for (let i = 0; i < burstCount; i++) {
    starBursts.push({
      x: x + (Math.random() * 90 - 45),
      y: y + (Math.random() * 90 - 45),
      scale: 0.9 + Math.random() * 0.7,
      alpha: 0.95,
      life: 30 + Math.floor(Math.random() * 14),
      color: [COLORS.yellow, COLORS.aqua, COLORS.pink, COLORS.orange][Math.floor(Math.random() * 4)]
    });
  }

  for (let i = 0; i < 3; i++) {
    shockwaves.push({
      x,
      y,
      radius: 20 + i * 16,
      grow: 10 + i * 2,
      alpha: 0.28 - i * 0.05,
      color
    });
  }

  for (let i = 0; i < 10; i++) {
    impactDust.push({
      x,
      y,
      vx: Math.random() * 8 - 4,
      vy: Math.random() * 8 - 4,
      radius: 10 + Math.random() * 18,
      alpha: 0.24 + Math.random() * 0.12,
      color: i % 2 === 0 ? COLORS.white : color
    });
  }

  flashes.push({ color, alpha: tier === "bullseye" ? 0.42 : tier === "strong" ? 0.30 : 0.18 });
}

function spawnScreenShock(x, y, tier, color) {
  const lineCount =
    tier === "bullseye" ? 18 :
    tier === "strong" ? 12 :
    tier === "zonehit" ? 10 :
    tier === "graze" ? 8 : 5;

  for (let i = 0; i < lineCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = tier === "bullseye" ? 14 : tier === "strong" ? 10 : 7;
    streaks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      len: tier === "bullseye" ? 34 : tier === "strong" ? 28 : 20,
      alpha: 0.85,
      color
    });
  }
}

/* =========================
   DRAW GAME
========================= */
function drawGame() {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  gameCtx.save();
  gameCtx.translate(shakeX, shakeY);

  drawBackground();
  drawImpactZones();
  drawTargetGlow();
  drawProjectileTrails();
  drawShockwaves();
  drawImpactDust();
  drawStreaks();
  drawHUD();
  drawTopFade();
  drawRings();
  drawSparks();
  drawConfetti();
  drawStarBursts();
  drawHitLabels();
  drawFlashes();

  gameCtx.restore();

  drawScreenPulse();
}

function drawBackground() {
  if (pelhamBgLoaded) {
    const r = getCoverRect(pelhamBg.width, pelhamBg.height, gameCanvas.width, gameCanvas.height);
    gameCtx.drawImage(pelhamBg, r.x, r.y, r.w, r.h);
  } else {
    const bg = gameCtx.createLinearGradient(0, 0, 0, gameCanvas.height);
    bg.addColorStop(0, "#173149");
    bg.addColorStop(0.35, "#1e3b55");
    bg.addColorStop(1, "#234e2b");
    gameCtx.fillStyle = bg;
    gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  }

  const darkAlpha = 0.28 + bgFade * 0.48;
  gameCtx.fillStyle = `rgba(5, 12, 22, ${darkAlpha})`;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
}

function drawImpactZones() {
  const activeZone = getActiveTargetZone();
  const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.05 + mittPulse * 0.06;

  for (const zone of impactZones) {
    const isActive = activeZone && zone.id === activeZone.id;
    const alphaFill = isActive ? 0.14 : 0.05;
    const alphaStroke = isActive ? 0.48 : 0.14;
    const scale = isActive ? pulse : 1;

    gameCtx.save();

    for (const glow of zoneGlowBursts) {
      if (Math.abs(glow.x - zone.x) < 1 && Math.abs(glow.y - zone.y) < 1) {
        gameCtx.fillStyle = rgbaFromHex(glow.color, glow.alpha * 0.32);
        gameCtx.beginPath();
        gameCtx.ellipse(glow.x, glow.y, glow.rx, glow.ry, 0, 0, Math.PI * 2);
        gameCtx.fill();
      }
    }

    gameCtx.fillStyle = rgbaFromHex(zone.color, alphaFill);
    gameCtx.strokeStyle = rgbaFromHex(isActive ? COLORS.white : zone.color, alphaStroke);
    gameCtx.lineWidth = isActive ? 3 : 2;

    if (zone.shape === "ellipse") {
      gameCtx.beginPath();
      gameCtx.ellipse(zone.x, zone.y, zone.rx * scale, zone.ry * scale, 0, 0, Math.PI * 2);
      gameCtx.fill();
      gameCtx.stroke();
    }

    if (isActive) {
      gameCtx.strokeStyle = rgbaFromHex(zone.color, 0.85);
      gameCtx.lineWidth = 2;
      gameCtx.beginPath();
      gameCtx.moveTo(zone.x - zone.rx * 0.35, zone.y);
      gameCtx.lineTo(zone.x + zone.rx * 0.35, zone.y);
      gameCtx.moveTo(zone.x, zone.y - zone.ry * 0.35);
      gameCtx.lineTo(zone.x, zone.y + zone.ry * 0.35);
      gameCtx.stroke();
    }

    gameCtx.restore();
  }
}

function drawTargetGlow() {
  const activeZone = getActiveTargetZone();
  if (!activeZone || phase === "DONE") return;

  const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.06 + mittPulse * 0.06;

  const g = gameCtx.createRadialGradient(
    activeZone.x,
    activeZone.y,
    10,
    activeZone.x,
    activeZone.y,
    Math.max(activeZone.rx, activeZone.ry) * 2.3 * pulse
  );

  g.addColorStop(0, rgbaFromHex(activeZone.color, 0.22));
  g.addColorStop(0.45, rgbaFromHex(activeZone.color, 0.08));
  g.addColorStop(1, rgbaFromHex(activeZone.color, 0));

  gameCtx.fillStyle = g;
  gameCtx.beginPath();
  gameCtx.arc(activeZone.x, activeZone.y, Math.max(activeZone.rx, activeZone.ry) * 2.2 * pulse, 0, Math.PI * 2);
  gameCtx.fill();
}

function drawProjectileTrails() {
  projectiles.forEach((p) => {
    const curX = lerp(p.x1, p.x2, p.progress);
    const curY = lerp(p.y1, p.y2, p.progress);

    const tail = Math.max(0, p.progress - 0.18);
    const tailX = lerp(p.x1, p.x2, tail);
    const tailY = lerp(p.y1, p.y2, tail);

    gameCtx.strokeStyle = rgbaFromHex(p.color, p.alpha);
    gameCtx.lineWidth = p.width;
    gameCtx.lineCap = "round";
    gameCtx.beginPath();
    gameCtx.moveTo(tailX, tailY);
    gameCtx.lineTo(curX, curY);
    gameCtx.stroke();

    gameCtx.fillStyle = rgbaFromHex(COLORS.white, p.alpha * 0.9);
    gameCtx.beginPath();
    gameCtx.arc(curX, curY, 5 + p.width * 0.25, 0, Math.PI * 2);
    gameCtx.fill();
  });
}

function drawShockwaves() {
  shockwaves.forEach((s) => {
    gameCtx.strokeStyle = rgbaFromHex(s.color, s.alpha);
    gameCtx.lineWidth = 6;
    gameCtx.beginPath();
    gameCtx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    gameCtx.stroke();
  });
}

function drawImpactDust() {
  impactDust.forEach((d) => {
    gameCtx.fillStyle = rgbaFromHex(d.color, d.alpha);
    gameCtx.beginPath();
    gameCtx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    gameCtx.fill();
  });
}

function drawStreaks() {
  streaks.forEach((s) => {
    gameCtx.strokeStyle = rgbaFromHex(s.color, s.alpha);
    gameCtx.lineWidth = 3;
    gameCtx.lineCap = "round";
    gameCtx.beginPath();
    gameCtx.moveTo(s.x, s.y);
    gameCtx.lineTo(s.x - s.vx * 1.5, s.y - s.vy * 1.5);
    gameCtx.stroke();
  });
}

function drawHUD() {
  const activeZone = getActiveTargetZone();

  gameCtx.fillStyle = "rgba(6,16,28,0.78)";
  roundRectFill(30, 24, 320, 44, 18);
  roundRectFill(1040, 24, 250, 104, 20);
  roundRectFill(390, 22, 580, 102, 24);

  roundRectColor(
    34,
    30,
    Math.min(currentPower, 300),
    30,
    14,
    currentPower > 180 ? COLORS.orange : COLORS.blue
  );

  gameCtx.fillStyle = COLORS.white;
  gameCtx.font = "bold 15px Arial";
  gameCtx.fillText("THROW POWER", 38, 20);

  gameCtx.font = "bold 26px Arial";
  const pitchDisplay = phase === "DONE" ? MAX_PITCHES : Math.min(pitchCount + 1, MAX_PITCHES);
  gameCtx.fillText(`Pitch: ${pitchDisplay}/${MAX_PITCHES}`, 1064, 58);
  gameCtx.fillText(`Completed: ${pitchCount}`, 1064, 88);

  gameCtx.textAlign = "center";
  gameCtx.font = "bold 24px Arial";
  gameCtx.fillText("PITCH TO PELHAM", gameCanvas.width / 2, 50);

  gameCtx.font = "bold 18px Arial";
  gameCtx.fillStyle = activeZone ? activeZone.color : COLORS.white;
  gameCtx.fillText(
    activeZone ? `TARGET: ${activeZone.label}` : "TARGET LOCKING...",
    gameCanvas.width / 2,
    78
  );

  gameCtx.font = "bold 14px Arial";
  gameCtx.fillStyle = "rgba(255,255,255,0.9)";
  gameCtx.fillText("Hit the glowing zone for bigger reactions", gameCanvas.width / 2, 98);

  gameCtx.font = "bold 34px Arial";
  gameCtx.fillStyle =
    phase === "LOAD" ? COLORS.blue :
    phase === "READY" ? COLORS.green :
    phase === "RESET" ? COLORS.orange :
    phase === "DONE" ? COLORS.yellow :
    COLORS.white;

  gameCtx.fillText(phase, gameCanvas.width / 2, 124);

  if (feedbackTimer > 0) {
    roundRectFill(490, 146, 415, 60, 18);
    gameCtx.fillStyle = COLORS.white;
    gameCtx.font = "bold 30px Arial";
    gameCtx.fillText(feedbackText, gameCanvas.width / 2, 185);
  }

  gameCtx.textAlign = "start";
}

function drawTopFade() {
  const topFade = gameCtx.createLinearGradient(0, 0, 0, 170);
  topFade.addColorStop(0, "rgba(0,0,0,0.72)");
  topFade.addColorStop(1, "rgba(0,0,0,0)");
  gameCtx.fillStyle = topFade;
  gameCtx.fillRect(0, 0, gameCanvas.width, 170);
}

function drawRings() {
  rings.forEach((r) => {
    gameCtx.strokeStyle = rgbaFromHex(r.color, r.alpha);
    gameCtx.lineWidth = 5 + r.grow * 0.08;
    gameCtx.beginPath();
    gameCtx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    gameCtx.stroke();
  });
}

function drawSparks() {
  sparks.forEach((s) => {
    gameCtx.fillStyle = rgbaFromHex(s.color, s.alpha);
    gameCtx.beginPath();
    gameCtx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    gameCtx.fill();
  });
}

function drawConfetti() {
  confetti.forEach((c) => {
    gameCtx.save();
    gameCtx.globalAlpha = c.alpha;
    gameCtx.translate(c.x, c.y);
    gameCtx.rotate(c.rot);
    gameCtx.fillStyle = c.color;
    gameCtx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    gameCtx.restore();
  });
}

function drawStarBursts() {
  starBursts.forEach((s) => {
    gameCtx.save();
    gameCtx.translate(s.x, s.y);
    gameCtx.scale(s.scale, s.scale);
    gameCtx.globalAlpha = s.alpha;
    gameCtx.strokeStyle = s.color;
    gameCtx.lineWidth = 4;

    for (let i = 0; i < 4; i++) {
      gameCtx.rotate(Math.PI / 4);
      gameCtx.beginPath();
      gameCtx.moveTo(-18, 0);
      gameCtx.lineTo(18, 0);
      gameCtx.stroke();
    }

    gameCtx.restore();
  });
}

function drawHitLabels() {
  hitLabels.forEach((h) => {
    gameCtx.save();
    gameCtx.globalAlpha = h.alpha;
    gameCtx.translate(h.x, h.y);
    gameCtx.scale(h.scale, h.scale);
    gameCtx.textAlign = "center";
    gameCtx.fillStyle = h.color;
    gameCtx.strokeStyle = "rgba(0,0,0,0.45)";
    gameCtx.lineWidth = 6;
    gameCtx.font = "bold 28px Arial";
    gameCtx.strokeText(h.text, 0, 0);
    gameCtx.fillText(h.text, 0, 0);
    gameCtx.restore();
  });
  gameCtx.textAlign = "start";
}

function drawFlashes() {
  flashes.forEach((f) => {
    gameCtx.fillStyle = rgbaFromHex(f.color, f.alpha * 0.20);
    gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  });
}

function drawScreenPulse() {
  if (screenPulse <= 0.01) return;

  const alpha = Math.min(0.16, screenPulse * 0.18);
  const grad = gameCtx.createRadialGradient(
    gameCanvas.width * 0.5,
    gameCanvas.height * 0.5,
    80,
    gameCanvas.width * 0.5,
    gameCanvas.height * 0.5,
    Math.max(gameCanvas.width, gameCanvas.height)
  );
  grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
  grad.addColorStop(1, "rgba(255,255,255,0)");

  gameCtx.save();
  gameCtx.fillStyle = grad;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  gameCtx.restore();
}

/* =========================
   OVERLAY
========================= */
function drawOverlay() {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (!latestKeypoints) {
    drawFallbackOverlay();
    return;
  }

  if (loadBox) {
    overlayCtx.fillStyle = "rgba(0,140,255,0.16)";
    overlayCtx.strokeStyle = "rgba(0,220,255,0.95)";
    overlayCtx.lineWidth = 4;
    overlayCtx.fillRect(loadBox.x, loadBox.y, loadBox.w, loadBox.h);
    overlayCtx.strokeRect(loadBox.x, loadBox.y, loadBox.w, loadBox.h);
  }

  if (readyBox) {
    overlayCtx.fillStyle = phase === "LOAD" ? "rgba(80,255,140,0.14)" : "rgba(242,154,69,0.16)";
    overlayCtx.strokeStyle = phase === "LOAD" ? "rgba(80,255,140,0.9)" : "rgba(242,154,69,0.95)";
    overlayCtx.lineWidth = phase === "LOAD" ? 5 : 4;
    overlayCtx.fillRect(readyBox.x, readyBox.y, readyBox.w, readyBox.h);
    overlayCtx.strokeRect(readyBox.x, readyBox.y, readyBox.w, readyBox.h);
  }

  if (followGuide && phase === "RESET") {
    overlayCtx.strokeStyle = "rgba(242,154,69,0.88)";
    overlayCtx.lineWidth = 5;
    overlayCtx.beginPath();
    overlayCtx.moveTo(followGuide.x1, followGuide.y1);
    overlayCtx.lineTo(followGuide.x2, followGuide.y2);
    overlayCtx.stroke();
  }

  overlayCtx.strokeStyle =
    phase === "READY" ? "rgba(80,255,140,0.98)" :
    phase === "RESET" ? "rgba(242,154,69,0.98)" :
    "rgba(111,214,255,0.98)";

  overlayCtx.lineWidth = 6;
  overlayCtx.lineCap = "round";

  drawBone(latestKeypoints, "left_shoulder", "right_shoulder");
  drawBone(latestKeypoints, "left_shoulder", "left_elbow");
  drawBone(latestKeypoints, "left_elbow", "left_wrist");
  drawBone(latestKeypoints, "right_shoulder", "right_elbow");
  drawBone(latestKeypoints, "right_elbow", "right_wrist");
  drawBone(latestKeypoints, "left_shoulder", "left_hip");
  drawBone(latestKeypoints, "right_shoulder", "right_hip");
  drawBone(latestKeypoints, "left_hip", "right_hip");

  latestKeypoints.forEach((k) => {
    if (k.score > 0.25) {
      overlayCtx.fillStyle = "rgba(255,230,120,0.95)";
      overlayCtx.beginPath();
      overlayCtx.arc(k.x, k.y, 6, 0, Math.PI * 2);
      overlayCtx.fill();
    }
  });

  if (wristScreen) {
    overlayCtx.fillStyle =
      phase === "READY" ? "rgba(80,255,140,1)" :
      phase === "RESET" ? "rgba(242,154,69,1)" :
      "rgba(255,255,255,1)";

    overlayCtx.beginPath();
    overlayCtx.arc(wristScreen.x, wristScreen.y, 12, 0, Math.PI * 2);
    overlayCtx.fill();
  }
}

function drawFallbackOverlay() {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  overlayCtx.fillStyle = "rgba(0,140,255,0.22)";
  overlayCtx.strokeStyle = "rgba(0,220,255,1)";
  overlayCtx.lineWidth = 5;
  overlayCtx.fillRect(40, 80, 120, 140);
  overlayCtx.strokeRect(40, 80, 120, 140);
}

/* =========================
   HELPERS
========================= */
function getCoverRect(imgW, imgH, canvasW, canvasH) {
  const scale = Math.max(canvasW / imgW, canvasH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const x = (canvasW - w) / 2;
  const y = (canvasH - h) / 2;
  return { x, y, w, h };
}

function roundRectFill(x, y, w, h, r) {
  gameCtx.beginPath();
  gameCtx.moveTo(x + r, y);
  gameCtx.lineTo(x + w - r, y);
  gameCtx.quadraticCurveTo(x + w, y, x + w, y + r);
  gameCtx.lineTo(x + w, y + h - r);
  gameCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  gameCtx.lineTo(x + r, y + h);
  gameCtx.quadraticCurveTo(x, y + h, x, y + h - r);
  gameCtx.lineTo(x, y + r);
  gameCtx.quadraticCurveTo(x, y, x + r, y);
  gameCtx.closePath();
  gameCtx.fill();
}

function roundRectColor(x, y, w, h, r, color) {
  gameCtx.save();
  gameCtx.fillStyle = color;
  roundRectFill(x, y, w, h, r);
  gameCtx.restore();
}

function findKeypoint(keypoints, name) {
  return keypoints.find((k) => k.name === name);
}

function drawBone(keypoints, aName, bName) {
  const a = findKeypoint(keypoints, aName);
  const b = findKeypoint(keypoints, bName);
  if (!a || !b || a.score < 0.25 || b.score < 0.25) return;

  overlayCtx.beginPath();
  overlayCtx.moveTo(a.x, a.y);
  overlayCtx.lineTo(b.x, b.y);
  overlayCtx.stroke();
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function rgbaFromHex(hex, alpha) {
  const c = hex.replace("#", "");
  const n = parseInt(c, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/* =========================
   INIT
========================= */
populateCameraSelect();
