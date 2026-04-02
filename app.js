const video = document.getElementById("webcam");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const gameCanvas = document.getElementById("gameCanvas");
const gameCtx = gameCanvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const statusText = document.getElementById("status");

let detector = null;
let started = false;
let cameraStarted = false;

let wristScreen = null;
let loadBox = null;

let wristHistory = [];
let readyPoseFrames = 0;
let readyLockout = false;
let throwCooldown = false;
let resultPauseTimer = 0;

let phase = "LOAD"; // LOAD / THROW / FOLLOW / RESET / DONE
let feedbackText = "READY";
let feedbackTimer = 0;

let formScores = {
  load: 0,
  release: 0,
  follow: 0,
  total: 0
};

let lastResult = {
  total: 0,
  note: "Complete a throw to get coaching feedback."
};

let sessionCount = 0;
let avgScore = 0;
let currentPower = 0;

let pitchCount = 0;
const MAX_PITCHES = 6;

let rings = [];
let trailDots = [];
let flashes = [];
let confetti = [];
let characterBall = null;

const FORWARD_DIRECTION = 1;

const BX = {
  yellow: "#f1c94c",
  orange: "#f29a45",
  blue: "#6cc7ff",
  pink: "#d87adf",
  green: "#8ed857",
  white: "#ffffff",
  navy: "#07121f",
  red: "#ff6b6b"
};

function setStatus(msg) {
  if (statusText) statusText.textContent = msg;
}

/* =========================
   FORCE OVERLAY VISIBILITY
========================= */
function forceOverlayVisibility() {
  const wrap = document.querySelector(".videoWrap");
  if (wrap) {
    wrap.style.position = "relative";
    wrap.style.isolation = "isolate";
  }

  video.style.position = "absolute";
  video.style.inset = "0";
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.zIndex = "1";
  video.style.objectFit = "cover";

  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.zIndex = "9999";
  overlay.style.pointerEvents = "none";
  overlay.style.display = "block";
  overlay.style.opacity = "1";
  overlay.style.background = "transparent";

  const tint = document.querySelector(".videoTint");
  if (tint) {
    tint.style.zIndex = "2";
    tint.style.pointerEvents = "none";
  }
}

/* =========================
   AUDIO
========================= */
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playTone(freq = 440, duration = 0.08, type = "sine", volume = 0.04, slideTo = null) {
  ensureAudio();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (slideTo !== null) osc.frequency.linearRampToValueAtTime(slideTo, now + duration);

  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function playLoad() { playTone(520, 0.08, "triangle", 0.03); }
function playRelease() { playTone(380, 0.14, "sawtooth", 0.035, 120); }
function playGood() {
  playTone(760, 0.08, "square", 0.04);
  setTimeout(() => playTone(960, 0.08, "square", 0.035), 50);
}
function playGreat() {
  playTone(620, 0.08, "triangle", 0.04);
  setTimeout(() => playTone(860, 0.08, "triangle", 0.04), 55);
  setTimeout(() => playTone(1120, 0.12, "triangle", 0.045), 110);
}
function playReset() { playTone(520, 0.06, "triangle", 0.03); }

/* =========================
   CAMERA START
========================= */
async function startCamera() {
  forceOverlayVisibility();
  ensureAudio();
  setStatus("Starting camera...");

  if (video.srcObject) {
    const oldStream = video.srcObject;
    oldStream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(d => d.kind === "videoinput");

  const preferredDevice =
    videoDevices.find(d => /obs virtual camera/i.test(d.label)) ||
    videoDevices.find(d => /azure|kinect/i.test(d.label)) ||
    videoDevices.find(d => /camera|webcam|usb/i.test(d.label)) ||
    videoDevices[0];

  if (!preferredDevice) throw new Error("No video input device found.");

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: preferredDevice.deviceId ? { exact: preferredDevice.deviceId } : undefined,
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
  overlay.style.width = "100%";
  overlay.style.height = "100%";

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

  cameraStarted = true;
  setStatus("STEP 1: Put your throwing hand in the blue box.");

  if (!started) {
    started = true;
    requestAnimationFrame(loop);
  }
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

resetBtn.onclick = resetSession;

function resetSession() {
  wristHistory = [];
  readyPoseFrames = 0;
  readyLockout = false;
  throwCooldown = false;
  resultPauseTimer = 0;

  phase = "LOAD";
  feedbackText = "READY";
  feedbackTimer = 0;
  currentPower = 0;

  pitchCount = 0;

  formScores = { load: 0, release: 0, follow: 0, total: 0 };
  lastResult = {
    total: 0,
    note: "Complete a throw to get coaching feedback."
  };

  rings = [];
  trailDots = [];
  flashes = [];
  confetti = [];
  characterBall = null;

  playReset();
  setStatus("STEP 1: Put your throwing hand in the blue box.");
  drawGame();
}

/* =========================
   LOOP
========================= */
async function loop() {
  requestAnimationFrame(loop);

  updateGame();
  drawGame();

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (!detector || video.readyState < 2) {
    drawFallbackOverlay();
    return;
  }

  try {
    const poses = await detector.estimatePoses(video);

    if (!poses || poses.length === 0 || !poses[0].keypoints) {
      drawFallbackOverlay();
      setStatus("No body detected. Step back so your upper body is visible.");
      return;
    }

    const keypoints = poses[0].keypoints;

    const rightWrist = findKeypoint(keypoints, "right_wrist");
    const rightShoulder = findKeypoint(keypoints, "right_shoulder");
    const rightHip = findKeypoint(keypoints, "right_hip");
    const leftShoulder = findKeypoint(keypoints, "left_shoulder");

    if (
      !rightWrist || !rightShoulder || !rightHip || !leftShoulder ||
      rightWrist.score < 0.25 ||
      rightShoulder.score < 0.25 ||
      rightHip.score < 0.25 ||
      leftShoulder.score < 0.25
    ) {
      drawFallbackOverlay();
      setStatus("Upper body not clear. Face camera and step back.");
      return;
    }

    wristScreen = { x: rightWrist.x, y: rightWrist.y };

    const shoulderScreen = { x: rightShoulder.x, y: rightShoulder.y };
    const hipScreen = { x: rightHip.x, y: rightHip.y };
    const leftShoulderScreen = { x: leftShoulder.x, y: leftShoulder.y };

    const torsoHeight = Math.abs(hipScreen.y - shoulderScreen.y);
    const shoulderSpan = Math.abs(shoulderScreen.x - leftShoulderScreen.x);

    const boxW = Math.max(shoulderSpan * 0.8, 100);
    const boxH = Math.max(torsoHeight * 0.7, 120);

    loadBox = {
      x: shoulderScreen.x - boxW - 45,
      y: shoulderScreen.y - boxH * 0.25,
      w: boxW,
      h: boxH
    };

    drawSilhouette(keypoints);

    if (phase === "DONE") return;
    if (throwCooldown || resultPauseTimer > 0) return;

    wristHistory.push({
      x: wristScreen.x,
      y: wristScreen.y,
      t: performance.now()
    });
    if (wristHistory.length > 16) wristHistory.shift();

    const wristInLoadBox = pointInRect(wristScreen.x, wristScreen.y, loadBox);

    if (phase === "LOAD") {
      if (!readyLockout) {
        if (wristInLoadBox) {
          readyPoseFrames++;
          setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Hold your load.`);
        } else {
          readyPoseFrames = 0;
          setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Put your throwing hand in the blue box.`);
        }

        if (readyPoseFrames >= 4) {
          phase = "THROW";
          formScores.load = 100;
          feedbackText = "GREAT LOAD";
          feedbackTimer = 50;
          playLoad();
          spawnBurst(loadBox.x + loadBox.w / 2, loadBox.y + loadBox.h / 2, BX.blue, 70);
          setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Throw forward.`);
          wristHistory = [];
        }
      }
      return;
    }

    if (phase === "THROW" && wristHistory.length >= 5) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];

      const rawForwardX = (last.x - first.x) * FORWARD_DIRECTION;
      const upwardY = first.y - last.y;

      const forwardX = Math.max(0, rawForwardX);
      const power = forwardX + Math.max(0, upwardY) * 0.18;
      currentPower = Math.min(280, power * 2);

      if (forwardX > 30 && power > 35) {
        formScores.release = Math.min(100, Math.round(power * 1.5));
        phase = "FOLLOW";
        feedbackText = power > 85 ? "POWER THROW" : "STRONG RELEASE";
        feedbackTimer = 50;
        playRelease();
        spawnBurst(wristScreen.x, wristScreen.y, BX.orange, power);
        spawnCharacterBall(wristScreen.x, wristScreen.y, power);
        setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Follow through across your body.`);
        wristHistory = [];
      } else {
        setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Throw forward.`);
      }
      return;
    }

    if (phase === "FOLLOW" && wristHistory.length >= 4) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];
      const travel = Math.abs(last.x - first.x) + Math.abs(last.y - first.y);

      if (travel > 14) {
        formScores.follow = Math.min(100, 45 + Math.round(travel * 2));
        finalizeThrow();
      } else {
        setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Follow through across your body.`);
      }
    }
  } catch (err) {
    console.error("Pose error:", err);
    drawFallbackOverlay();
    setStatus("Pose error: " + err.message);
  }
}

function finalizeThrow() {
  formScores.total = Math.round(
    formScores.load * 0.34 +
    formScores.release * 0.38 +
    formScores.follow * 0.28
  );

  pitchCount++;
  sessionCount++;
  avgScore = Math.round(((avgScore * (sessionCount - 1)) + formScores.total) / sessionCount);

  let note = "";
  let burstColor = BX.blue;
  let burstPower = currentPower;

  if (formScores.total >= 90) {
    note = "Excellent mechanics!";
    feedbackText = "EXCELLENT FORM";
    burstColor = BX.yellow;
    burstPower = currentPower * 1.35;
    playGreat();
  } else if (formScores.total >= 75) {
    note = "Strong throw. Nice mechanics.";
    feedbackText = "STRONG FORM";
    burstColor = BX.green;
    burstPower = currentPower * 1.15;
    playGood();
  } else if (formScores.follow < 55) {
    note = "Good start. Try a bigger follow-through.";
    feedbackText = "FOLLOW THROUGH MORE";
    burstColor = BX.orange;
    burstPower = currentPower * 0.95;
    playGood();
  } else {
    note = "Try loading deeper behind your shoulder.";
    feedbackText = "LOAD DEEPER";
    burstColor = BX.blue;
    burstPower = currentPower * 0.9;
    playGood();
  }

  feedbackTimer = 80;
  lastResult = {
    total: formScores.total,
    note
  };

  spawnBigImpact(burstColor, burstPower);

  if (pitchCount >= MAX_PITCHES) {
    phase = "DONE";
    throwCooldown = true;
    resultPauseTimer = 160;
    setStatus(`Round complete. ${pitchCount} pitches done. Press Reset Game to play again.`);
    feedbackText = "ROUND COMPLETE";
    feedbackTimer = 120;
    return;
  }

  phase = "RESET";
  readyLockout = true;
  wristHistory = [];
  throwCooldown = true;
  resultPauseTimer = 75;

  setStatus(`${note} Reset for pitch ${pitchCount + 1}/${MAX_PITCHES}...`);

  setTimeout(() => {
    throwCooldown = false;
    phase = "LOAD";
    readyPoseFrames = 0;
    formScores = { ...formScores, load: 0, release: 0, follow: 0 };
    setStatus(`Pitch ${pitchCount + 1}/${MAX_PITCHES} · Put your throwing hand in the blue box.`);
  }, 1400);
}

/* =========================
   UPDATE
========================= */
function updateGame() {
  if (resultPauseTimer > 0) resultPauseTimer--;

  for (let i = trailDots.length - 1; i >= 0; i--) {
    const t = trailDots[i];
    t.x += t.vx;
    t.y += t.vy;
    t.size *= 0.965;
    t.alpha *= 0.94;
    if (t.size < 0.8 || t.alpha < 0.05) trailDots.splice(i, 1);
  }

  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.r += r.grow;
    r.alpha *= 0.928;
    if (r.alpha < 0.05) rings.splice(i, 1);
  }

  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].alpha *= 0.90;
    if (flashes[i].alpha < 0.05) flashes.splice(i, 1);
  }

  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.x += c.vx;
    c.y += c.vy;
    c.vy += 0.08;
    c.rot += c.spin;
    c.alpha *= 0.985;
    if (c.alpha < 0.05 || c.y > gameCanvas.height + 30) confetti.splice(i, 1);
  }

  if (characterBall) {
    characterBall.life--;
    characterBall.x += characterBall.vx;
    characterBall.y += characterBall.vy;
    characterBall.vy += 0.12;
    characterBall.rotation += characterBall.spin;
    if (characterBall.life <= 0) characterBall = null;
  }

  if (feedbackTimer > 0) feedbackTimer--;
}

/* =========================
   FX
========================= */
function spawnBurst(x, y, color, power = 40) {
  const ringCount = 3 + Math.floor(power / 22);

  for (let i = 0; i < ringCount; i++) {
    rings.push({
      x,
      y,
      r: 10 + i * 16,
      grow: 4.5 + i * 0.9,
      alpha: 0.9 - i * 0.08,
      color
    });
  }

  for (let i = 0; i < 10; i++) {
    trailDots.push({
      x,
      y,
      vx: Math.random() * 8 - 4,
      vy: Math.random() * 8 - 4,
      size: 6 + Math.random() * 7,
      alpha: 0.95,
      color: i % 2 === 0 ? color : BX.yellow
    });
  }

  addFlash(color, 0.15);
}

function spawnBigImpact(color, power) {
  const ringCount = 6 + Math.floor(power / 28);
  const cx = gameCanvas.width * 0.68;
  const cy = gameCanvas.height * 0.36;

  for (let i = 0; i < ringCount; i++) {
    rings.push({
      x: cx,
      y: cy,
      r: 24 + i * 24,
      grow: 6 + i * 0.8,
      alpha: 0.82 - i * 0.065,
      color
    });
  }

  const accent = [BX.blue, BX.orange, BX.yellow, BX.green, BX.pink, BX.red];
  for (let i = 0; i < 34; i++) {
    confetti.push({
      x: cx,
      y: cy,
      vx: Math.random() * 14 - 7,
      vy: Math.random() * -10 - 1,
      w: 7 + Math.random() * 10,
      h: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.45,
      alpha: 1,
      color: accent[Math.floor(Math.random() * accent.length)]
    });
  }

  for (let i = 0; i < 18; i++) {
    trailDots.push({
      x: cx,
      y: cy,
      vx: Math.random() * 12 - 6,
      vy: Math.random() * 12 - 6,
      size: 7 + Math.random() * 12,
      alpha: 0.95,
      color: accent[Math.floor(Math.random() * accent.length)]
    });
  }

  addFlash(color, 0.26);
}

function spawnCharacterBall(x, y, power) {
  characterBall = {
    x,
    y,
    vx: 4 + power * 0.04,
    vy: -2.5 - power * 0.015,
    life: 42,
    rotation: 0,
    spin: 0.08 + power * 0.0006,
    size: 20 + Math.min(12, power * 0.05),
    mood: power > 85 ? "fierce" : "happy"
  };
}

function addFlash(color, alpha = 0.25) {
  flashes.push({ color, alpha });
}

/* =========================
   DRAW
========================= */
function drawGame() {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  drawBackground();
  drawCoachZones();
  drawHUD();
  drawMiniMap();
  drawFormPanel();
  drawFeedbackBanner();
  drawLastResultPanel();
  drawRings();
  drawTrail();
  drawCharacterBall();
  drawConfetti();
  drawCelebrationFlash();
}

function drawBackground() {
  const bg = gameCtx.createLinearGradient(0, 0, 0, gameCanvas.height);
  bg.addColorStop(0, "#1e3348");
  bg.addColorStop(0.34, "#24394e");
  bg.addColorStop(0.35, "#1b2b3c");
  bg.addColorStop(1, "#204a29");
  gameCtx.fillStyle = bg;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  roundedRect(gameCtx, 0, 95, gameCanvas.width, 250, 0, "rgba(8,18,29,0.42)", null);

  for (let i = 0; i < 8; i++) {
    const x = 120 + i * 160;
    roundedRect(gameCtx, x, 90, 8, 270, 4, "rgba(180,210,230,0.10)", null);
  }

  gameCtx.strokeStyle = "rgba(220,240,255,0.05)";
  gameCtx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    gameCtx.beginPath();
    gameCtx.moveTo(0, 110 + i * 18);
    gameCtx.lineTo(gameCanvas.width, 110 + i * 18);
    gameCtx.stroke();
  }

  roundedRect(gameCtx, 0, 315, gameCanvas.width, 78, 0, "rgba(17,35,58,0.65)", null);

  const chips = [
    { x: 120, c: BX.yellow },
    { x: 360, c: BX.orange },
    { x: 600, c: BX.blue },
    { x: 840, c: BX.pink },
    { x: 1080, c: BX.green }
  ];

  chips.forEach((chip) => {
    roundedRect(gameCtx, chip.x, 340, 140, 24, 12, `${chip.c}22`, `${chip.c}55`, 2);
  });

  for (let i = 0; i < 10; i++) {
    gameCtx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
    gameCtx.fillRect(0, 455 + i * 30, gameCanvas.width, 30);
  }

  gameCtx.fillStyle = "#bd8149";
  gameCtx.beginPath();
  gameCtx.ellipse(175, 520, 54, 18, 0, 0, Math.PI * 2);
  gameCtx.fill();
}

function drawCoachZones() {
  roundedRect(
    gameCtx,
    980,
    190,
    220,
    300,
    28,
    "rgba(255,255,255,0.03)",
    "rgba(108,199,255,0.12)",
    2
  );

  roundedRect(
    gameCtx,
    1088,
    236,
    170,
    206,
    26,
    "rgba(9,20,33,0.44)",
    "rgba(255,255,255,0.08)",
    2
  );

  const glow = gameCtx.createRadialGradient(1188, 340, 10, 1188, 340, 120);
  glow.addColorStop(0, "rgba(241,201,76,0.18)");
  glow.addColorStop(1, "rgba(241,201,76,0)");
  gameCtx.fillStyle = glow;
  gameCtx.fillRect(1050, 210, 270, 270);

  gameCtx.fillStyle = "rgba(177,105,43,0.95)";
  gameCtx.beginPath();
  gameCtx.ellipse(1188, 340, 52, 68, 0, 0, Math.PI * 2);
  gameCtx.fill();

  gameCtx.fillStyle = "rgba(223,151,78,0.95)";
  gameCtx.beginPath();
  gameCtx.ellipse(1190, 342, 34, 46, 0, 0, Math.PI * 2);
  gameCtx.fill();

  roundedRect(gameCtx, 1120, 248, 126, 182, 18, null, "rgba(255,255,255,0.95)", 5);
  roundedRect(gameCtx, 1138, 319, 90, 40, 14, null, BX.yellow, 3);

  roundedRect(gameCtx, 1116, 204, 150, 34, 14, "rgba(6,16,28,0.78)", null);
  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 16px Arial";
  gameCtx.fillText("FINISH TARGET", 1128, 227);
}

function drawHUD() {
  roundedRect(gameCtx, 36, 30, 300, 36, 18, "rgba(6,16,28,0.78)", "rgba(255,255,255,0.10)", 2);
  roundedRect(gameCtx, 38, 32, Math.min(currentPower, 296), 32, 16, currentPower > 180 ? BX.orange : BX.blue, null);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 15px Arial";
  gameCtx.fillText("MOTION ENERGY", 38, 22);

  roundedRect(gameCtx, 1040, 28, 250, 100, 22, "rgba(6,16,28,0.76)", "rgba(255,255,255,0.10)", 2);
  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 26px Arial";
  gameCtx.fillText(`Pitch: ${pitchCount}/${MAX_PITCHES}`, 1064, 58);
  gameCtx.fillText(`Throws: ${sessionCount}`, 1064, 88);
  gameCtx.fillText(`Avg: ${avgScore}`, 1064, 118);

  roundedRect(gameCtx, 430, 26, 500, 86, 24, "rgba(6,16,28,0.60)", "rgba(255,255,255,0.06)", 1);

  gameCtx.textAlign = "center";
  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 24px Arial";
  gameCtx.fillText("BXCM THROW LAB", gameCanvas.width / 2, 58);

  gameCtx.font = "bold 38px Arial";
  if (phase === "LOAD") gameCtx.fillStyle = BX.blue;
  else if (phase === "THROW") gameCtx.fillStyle = BX.orange;
  else if (phase === "FOLLOW") gameCtx.fillStyle = BX.green;
  else if (phase === "DONE") gameCtx.fillStyle = BX.yellow;
  else gameCtx.fillStyle = BX.yellow;

  gameCtx.fillText(phase, gameCanvas.width / 2, 94);
  gameCtx.textAlign = "start";
}

function drawMiniMap() {
  roundedRect(gameCtx, 42, 620, 280, 108, 18, "rgba(6,16,28,0.62)", "rgba(255,255,255,0.10)", 2);

  gameCtx.fillStyle = BX.blue;
  gameCtx.font = "bold 14px Arial";
  gameCtx.fillText("MOTION MAP", 56, 641);

  gameCtx.strokeStyle = "rgba(255,255,255,0.18)";
  gameCtx.beginPath();
  gameCtx.moveTo(74, 688);
  gameCtx.lineTo(278, 688);
  gameCtx.stroke();

  gameCtx.fillStyle = "#bd8149";
  gameCtx.beginPath();
  gameCtx.arc(74, 688, 8, 0, Math.PI * 2);
  gameCtx.fill();

  roundedRect(gameCtx, 270, 665, 24, 46, 8, null, BX.white, 2);
}

function drawFormPanel() {
  const panelX = 360;
  const panelY = 650;

  roundedRect(gameCtx, panelX, panelY, 400, 120, 22, "rgba(6,16,28,0.72)", "rgba(255,255,255,0.10)", 2);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 18px Arial";
  gameCtx.fillText("FORM SCORE", panelX + 18, panelY + 24);

  drawBar(panelX + 18, panelY + 42, 140, 20, "LOAD", formScores.load, BX.blue);
  drawBar(panelX + 18, panelY + 74, 140, 20, "RELEASE", formScores.release, BX.orange);
  drawBar(panelX + 210, panelY + 42, 140, 20, "FOLLOW", formScores.follow, BX.green);
  drawBar(panelX + 210, panelY + 74, 140, 20, "TOTAL", formScores.total, BX.yellow);
}

function drawBar(x, y, w, h, label, value, color) {
  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 14px Arial";
  gameCtx.fillText(label, x, y - 6);

  roundedRect(gameCtx, x, y, w, h, 10, "rgba(255,255,255,0.08)", null);
  roundedRect(gameCtx, x + 2, y + 2, Math.max(0, (w - 4) * (value / 100)), h - 4, 8, color, null);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 13px Arial";
  gameCtx.fillText(String(Math.round(value)), x + w + 8, y + 15);
}

function drawFeedbackBanner() {
  if (feedbackTimer <= 0) return;

  roundedRect(gameCtx, 505, 128, 390, 56, 18, "rgba(6,16,28,0.76)", "rgba(255,255,255,0.08)", 1);

  gameCtx.textAlign = "center";
  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 30px Arial";
  gameCtx.fillText(feedbackText, gameCanvas.width / 2, 164);
  gameCtx.textAlign = "start";
}

function drawLastResultPanel() {
  roundedRect(gameCtx, 970, 560, 320, 160, 22, "rgba(6,16,28,0.76)", "rgba(255,255,255,0.10)", 2);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 22px Arial";
  gameCtx.fillText("COACH NOTE", 992, 592);

  gameCtx.fillStyle = BX.yellow;
  gameCtx.font = "bold 18px Arial";
  gameCtx.fillText(`Last Score: ${lastResult.total || 0}`, 992, 624);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 16px Arial";
  wrapText(lastResult.note || "Complete a throw to get coaching feedback.", 992, 655, 270, 22);
}

function drawRings() {
  rings.forEach((r) => {
    gameCtx.strokeStyle = hexToRgba(r.color || "#ffffff", r.alpha);
    gameCtx.lineWidth = 5 + Math.max(0, r.grow * 0.12);
    gameCtx.beginPath();
    gameCtx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    gameCtx.stroke();
  });
}

function drawTrail() {
  trailDots.forEach((t) => {
    gameCtx.fillStyle = hexToRgba(t.color, t.alpha);
    gameCtx.beginPath();
    gameCtx.arc(t.x, t.y, t.size, 0, Math.PI * 2);
    gameCtx.fill();
  });
}

function drawCharacterBall() {
  if (!characterBall) return;

  gameCtx.save();
  gameCtx.translate(characterBall.x, characterBall.y);
  gameCtx.rotate(characterBall.rotation);

  // glow
  const glow = gameCtx.createRadialGradient(0, 0, 4, 0, 0, characterBall.size * 1.8);
  glow.addColorStop(0, "rgba(255,255,255,0.25)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  gameCtx.fillStyle = glow;
  gameCtx.beginPath();
  gameCtx.arc(0, 0, characterBall.size * 1.8, 0, Math.PI * 2);
  gameCtx.fill();

  // ball body
  gameCtx.fillStyle = "#ffffff";
  gameCtx.beginPath();
  gameCtx.arc(0, 0, characterBall.size, 0, Math.PI * 2);
  gameCtx.fill();

  // seams
  gameCtx.strokeStyle = "#d94141";
  gameCtx.lineWidth = 2.5;
  gameCtx.beginPath();
  gameCtx.arc(0, 0, characterBall.size - 4, 0.45, 2.55);
  gameCtx.stroke();
  gameCtx.beginPath();
  gameCtx.arc(0, 0, characterBall.size - 4, 3.6, 5.7);
  gameCtx.stroke();

  // eyes
  gameCtx.fillStyle = BX.navy;
  gameCtx.beginPath();
  gameCtx.arc(-characterBall.size * 0.28, -characterBall.size * 0.1, 2.5, 0, Math.PI * 2);
  gameCtx.arc(characterBall.size * 0.12, -characterBall.size * 0.1, 2.5, 0, Math.PI * 2);
  gameCtx.fill();

  // mouth
  gameCtx.strokeStyle = BX.navy;
  gameCtx.lineWidth = 2;
  gameCtx.beginPath();
  if (characterBall.mood === "fierce") {
    gameCtx.moveTo(-characterBall.size * 0.18, characterBall.size * 0.18);
    gameCtx.lineTo(characterBall.size * 0.16, characterBall.size * 0.12);
  } else {
    gameCtx.arc(-1, characterBall.size * 0.1, characterBall.size * 0.18, 0.15, 2.8);
  }
  gameCtx.stroke();

  gameCtx.restore();
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

function drawCelebrationFlash() {
  flashes.forEach((f) => {
    gameCtx.fillStyle = hexToRgba(f.color, f.alpha * 0.20);
    gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  });
}

/* =========================
   OVERLAY
========================= */
function drawFallbackOverlay() {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  overlayCtx.fillStyle = "rgba(0,140,255,0.22)";
  overlayCtx.strokeStyle = "rgba(0,220,255,1)";
  overlayCtx.lineWidth = 5;

  overlayCtx.fillRect(40, 80, 120, 140);
  overlayCtx.strokeRect(40, 80, 120, 140);

  overlayCtx.fillStyle = "rgba(255,255,255,0.95)";
  overlayCtx.font = "bold 20px Arial";
  overlayCtx.fillText("TEST BOX", 40, 68);
}

function drawSilhouette(keypoints) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  overlayCtx.fillStyle = "rgba(0,140,255,0.22)";
  overlayCtx.strokeStyle = "rgba(0,220,255,1)";
  overlayCtx.lineWidth = 5;

  if (loadBox) {
    overlayCtx.fillRect(loadBox.x, loadBox.y, loadBox.w, loadBox.h);
    overlayCtx.strokeRect(loadBox.x, loadBox.y, loadBox.w, loadBox.h);

    overlayCtx.fillStyle = "rgba(255,255,255,0.95)";
    overlayCtx.font = "bold 20px Arial";
    overlayCtx.fillText("LOAD BOX", loadBox.x, Math.max(24, loadBox.y - 10));
  } else {
    overlayCtx.fillRect(40, 80, 120, 140);
    overlayCtx.strokeRect(40, 80, 120, 140);

    overlayCtx.fillStyle = "rgba(255,255,255,0.95)";
    overlayCtx.font = "bold 20px Arial";
    overlayCtx.fillText("TEST BOX", 40, 68);
  }

  overlayCtx.strokeStyle = "rgba(111,214,255,0.98)";
  overlayCtx.lineWidth = 6;
  overlayCtx.lineCap = "round";

  drawBone(keypoints, "left_shoulder", "right_shoulder");
  drawBone(keypoints, "left_shoulder", "left_elbow");
  drawBone(keypoints, "left_elbow", "left_wrist");
  drawBone(keypoints, "right_shoulder", "right_elbow");
  drawBone(keypoints, "right_elbow", "right_wrist");
  drawBone(keypoints, "left_shoulder", "left_hip");
  drawBone(keypoints, "right_shoulder", "right_hip");
  drawBone(keypoints, "left_hip", "right_hip");

  keypoints.forEach((k) => {
    if (k.score > 0.25) {
      overlayCtx.fillStyle = "rgba(255,230,120,0.95)";
      overlayCtx.beginPath();
      overlayCtx.arc(k.x, k.y, 6, 0, Math.PI * 2);
      overlayCtx.fill();
    }
  });

  if (wristScreen) {
    overlayCtx.fillStyle = "rgba(255,255,255,1)";
    overlayCtx.beginPath();
    overlayCtx.arc(wristScreen.x, wristScreen.y, 12, 0, Math.PI * 2);
    overlayCtx.fill();
  }
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

/* =========================
   HELPERS
========================= */
function roundedRect(ctx, x, y, w, h, r, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function findKeypoint(keypoints, name) {
  return keypoints.find((k) => k.name === name);
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function hexToRgba(hex, alpha) {
  const c = hex.replace("#", "");
  const bigint = parseInt(c, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function wrapText(text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = gameCtx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && n > 0) {
      gameCtx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  gameCtx.fillText(line, x, y);
}
