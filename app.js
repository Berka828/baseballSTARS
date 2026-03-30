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

let ball = null;
let rings = [];
let flashes = [];
let confetti = [];
let trailDots = [];

let score = 0;
let pitchCount = 0;
const maxPitches = 5;
let gameOver = false;
let finalRank = "";

let currentPower = 0;
let lastThrowLabel = "READY";
let scoreFlash = "";
let scoreFlashTimer = 0;

let wristHistory = [];
let throwCooldown = false;
let resultPauseTimer = 0;
let readyPoseArmed = false;
let readyPoseFrames = 0;
let readyLockout = false;

let loadBox = null;
let wristScreen = null;

const strikeZone = { x: 1120, y: 248, w: 126, h: 182 };
const mitt = { x: 1188, y: 340, r: 58, glow: 0.55 };
const miniMap = { x: 42, y: 620, w: 280, h: 108 };

const FORWARD_DIRECTION = 1;

const BX = {
  yellow: "#f1c94c",
  orange: "#f29a45",
  blue: "#6cc7ff",
  pink: "#d87adf",
  green: "#8ed857",
  navy: "#0d2035",
  navy2: "#132c45",
  steel: "#25384d",
  turf: "#2e6d38",
  turf2: "#3d8444",
  white: "#ffffff"
};

// move status under silhouette, bigger
(function improveStatusUI() {
  const posePanel = document.querySelector(".posePanel");
  if (posePanel && statusText) {
    posePanel.appendChild(statusText);
    statusText.style.display = "block";
    statusText.style.marginTop = "14px";
    statusText.style.padding = "16px 18px";
    statusText.style.fontSize = "22px";
    statusText.style.lineHeight = "1.25";
    statusText.style.fontWeight = "800";
    statusText.style.textAlign = "center";
    statusText.style.borderRadius = "18px";
    statusText.style.background = "rgba(7,18,31,0.94)";
    statusText.style.border = "2px solid rgba(108,199,255,0.26)";
    statusText.style.color = "#ffffff";
    statusText.style.boxShadow = "0 8px 24px rgba(0,0,0,0.28)";
  }
})();

function setStatus(msg) {
  statusText.textContent = msg;
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

function playWhoosh() {
  playTone(360, 0.14, "sawtooth", 0.03, 120);
}
function playStrike() {
  playTone(680, 0.07, "square", 0.04);
  setTimeout(() => playTone(900, 0.08, "square", 0.034), 50);
}
function playPerfect() {
  playTone(620, 0.08, "triangle", 0.04);
  setTimeout(() => playTone(840, 0.08, "triangle", 0.04), 55);
  setTimeout(() => playTone(1080, 0.12, "triangle", 0.045), 110);
}
function playMiss() {
  playTone(200, 0.15, "sawtooth", 0.03, 120);
}
function playReset() {
  playTone(520, 0.06, "triangle", 0.03);
}

/* =========================
   BUTTONS
========================= */
startBtn.onclick = async () => {
  try {
    ensureAudio();

    if (!cameraStarted) {
      setStatus("Requesting camera access...");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });

      video.srcObject = stream;
      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve();
      });
      await video.play();

      overlay.width = video.videoWidth || video.clientWidth || 640;
      overlay.height = video.videoHeight || video.clientHeight || 480;

      setStatus("Loading pose detector...");

      await tf.setBackend("webgl");
      await tf.ready();

      detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
      );

      cameraStarted = true;
    }

    setStatus("Move your throwing hand into the blue box.");
    if (!started) {
      started = true;
      requestAnimationFrame(loop);
    }
  } catch (err) {
    console.error(err);
    setStatus("Error starting camera: " + err.message);
    alert("Error: " + err.message);
  }
};

resetBtn.onclick = () => {
  resetGame();
};

function resetGame() {
  ball = null;
  rings = [];
  flashes = [];
  confetti = [];
  trailDots = [];

  score = 0;
  pitchCount = 0;
  gameOver = false;
  finalRank = "";

  currentPower = 0;
  lastThrowLabel = "READY";
  scoreFlash = "";
  scoreFlashTimer = 0;

  wristHistory = [];
  throwCooldown = false;
  resultPauseTimer = 0;
  readyPoseArmed = false;
  readyPoseFrames = 0;
  readyLockout = false;

  loadBox = null;
  wristScreen = null;

  playReset();
  setStatus("Game reset. Move your throwing hand into the blue box.");
  drawGame();
}

/* =========================
   MAIN LOOP
========================= */
async function loop() {
  requestAnimationFrame(loop);

  updateGame();
  drawGame();

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (!detector || video.readyState < 2) return;

  try {
    const poses = await detector.estimatePoses(video);

    if (!poses || poses.length === 0 || !poses[0].keypoints) {
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
      setStatus("Upper body not clear. Face camera and step back.");
      return;
    }

    wristScreen = {
      x: rightWrist.x,
      y: rightWrist.y
    };

    const shoulderScreen = {
      x: rightShoulder.x,
      y: rightShoulder.y
    };

    const hipScreen = {
      x: rightHip.x,
      y: rightHip.y
    };

    const leftShoulderScreen = {
      x: leftShoulder.x,
      y: leftShoulder.y
    };

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

    if (gameOver || throwCooldown || resultPauseTimer > 0 || ball) {
      if (!gameOver && resultPauseTimer > 0) {
        setStatus("Pause... reset your arm for the next pitch.");
      }
      return;
    }

    wristHistory.push({
      x: wristScreen.x,
      y: wristScreen.y,
      t: performance.now()
    });
    if (wristHistory.length > 16) wristHistory.shift();

    const wristInLoadBox = pointInRect(wristScreen.x, wristScreen.y, loadBox);

    if (!readyPoseArmed) {
      if (!readyLockout) {
        if (wristInLoadBox) {
          readyPoseFrames++;
          setStatus("Hold... loaded pose found.");
        } else {
          readyPoseFrames = 0;
          setStatus("Move your throwing hand into the blue box.");
        }

        if (readyPoseFrames >= 7) {
          readyPoseArmed = true;
          setStatus("Loaded. Throw forward now.");
        }
      } else {
        setStatus("Move your hand out, then back into the blue box.");
        if (!wristInLoadBox) {
          readyLockout = false;
        }
      }
      return;
    }

    if (wristHistory.length >= 6) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];

      const rawForwardX = (last.x - first.x) * FORWARD_DIRECTION;
      const upwardY = first.y - last.y;

      const forwardX = Math.max(0, rawForwardX);
      const power = forwardX + Math.max(0, upwardY) * 0.18;

      const movedOutOfBox = !pointInRect(wristScreen.x, wristScreen.y, loadBox);

      if (movedOutOfBox && forwardX > 58 && power > 62) {
        triggerThrow(power);
      } else {
        setStatus("Loaded. Throw forward now.");
      }
    }
  } catch (err) {
    console.error(err);
    setStatus("Pose error: " + err.message);
  }
}

/* =========================
   THROW / SCORING
========================= */
function triggerThrow(power) {
  const strength = Math.min(power, 130);
  currentPower = Math.min(280, strength * 2.0);

  if (strength < 50) lastThrowLabel = "SOFT TOSS";
  else if (strength < 72) lastThrowLabel = "FAST BALL";
  else if (strength < 95) lastThrowLabel = "POWER PITCH";
  else lastThrowLabel = "SUPER HEATER";

  ball = {
    x: 175,
    y: 500,
    vx: 14 + strength * 0.18,
    vy: -6.5 - strength * 0.03,
    r: 14,
    strength
  };

  spawnLaunchBurst(175, 500, strength);
  playWhoosh();

  readyPoseArmed = false;
  readyPoseFrames = 0;
  readyLockout = true;
  wristHistory = [];
  throwCooldown = true;

  setStatus("Pitch launched.");

  setTimeout(() => {
    throwCooldown = false;
    if (!gameOver && resultPauseTimer <= 0) {
      setStatus("Now reset. Move your hand out, then reload in the blue box.");
    }
  }, 1600);
}

function updateGame() {
  if (resultPauseTimer > 0) {
    resultPauseTimer--;
  }

  if (ball && !gameOver) {
    ball.vy += 0.16;
    ball.x += ball.vx;
    ball.y += ball.vy;

    addTrail(ball.x, ball.y, ball.strength);

    if (ball.x >= strikeZone.x) {
      resolvePitch();
      ball = null;
      resultPauseTimer = 95;
    }

    if (ball && (ball.y > 700 || ball.x > gameCanvas.width + 40)) {
      pitchCount++;
      scoreFlash = "MISS";
      scoreFlashTimer = 58;

      spawnImpact(ball.x, Math.min(ball.y, 700), 0.9, "#ff7b7b", ball.strength);
      playMiss();

      ball = null;
      resultPauseTimer = 95;
      checkGameOver();

      if (!gameOver) {
        setStatus("Miss. Pause... reset your arm, then reload.");
      }
    }
  }

  for (let i = trailDots.length - 1; i >= 0; i--) {
    const t = trailDots[i];
    t.x += t.vx;
    t.y += t.vy;
    t.size *= 0.97;
    t.alpha *= 0.94;
    if (t.size < 0.8 || t.alpha < 0.05) trailDots.splice(i, 1);
  }

  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.r += r.grow;
    r.alpha *= 0.93;
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

  if (scoreFlashTimer > 0) scoreFlashTimer--;
}

function resolvePitch() {
  pitchCount++;

  const zoneTop = strikeZone.y;
  const zoneBottom = strikeZone.y + strikeZone.h;
  const zoneCenterY = strikeZone.y + strikeZone.h / 2;

  const y = ball.y;
  const distanceFromCenter = Math.abs(y - zoneCenterY);

  const perfectWindow = 10;
  const strikeWindowTop = zoneTop + 22;
  const strikeWindowBottom = zoneBottom - 22;

  const isPerfect = distanceFromCenter <= perfectWindow;
  const isStrike = y >= strikeWindowTop && y <= strikeWindowBottom;

  if (isPerfect) {
    score += 200;
    scoreFlash = "PERFECT +200";
    scoreFlashTimer = 78;

    spawnImpact(ball.x, ball.y, 2.6, BX.yellow, ball.strength);
    addFlash(BX.yellow, 0.45);
    spawnConfetti(ball.x, ball.y, 34);
    playPerfect();
  } else if (isStrike) {
    score += 100;
    scoreFlash = "STRIKE +100";
    scoreFlashTimer = 68;

    spawnImpact(ball.x, ball.y, 1.9, BX.green, ball.strength);
    addFlash(BX.green, 0.28);
    spawnConfetti(ball.x, ball.y, 18);
    playStrike();
  } else if (y < zoneTop) {
    scoreFlash = "HIGH BALL";
    scoreFlashTimer = 58;
    spawnImpact(ball.x, ball.y, 1.1, BX.orange, ball.strength);
    playMiss();
  } else {
    scoreFlash = "LOW BALL";
    scoreFlashTimer = 58;
    spawnImpact(ball.x, ball.y, 1.1, BX.orange, ball.strength);
    playMiss();
  }

  if ((isPerfect || isStrike) && currentPower > 165) {
    score += 50;
    scoreFlash += "  HEAT +50";
    scoreFlashTimer = 82;
  }

  checkGameOver();

  if (!gameOver) {
    setStatus("Result locked. Pause... reset your arm, then reload.");
  }
}

/* =========================
   FX
========================= */
function spawnLaunchBurst(x, y, strength) {
  const colors = [BX.blue, BX.green, BX.yellow];
  const ringCount = 2 + Math.floor(strength / 28);

  for (let i = 0; i < ringCount; i++) {
    rings.push({
      x,
      y,
      r: 8 + i * 10,
      grow: 4 + i * 0.6,
      alpha: 0.8 - i * 0.08,
      color: colors[i % colors.length]
    });
  }

  addFlash(BX.blue, 0.10);
}

function spawnImpact(x, y, scale, color, strength) {
  const ringCount = 3 + Math.floor(strength / 22);

  for (let i = 0; i < ringCount; i++) {
    rings.push({
      x,
      y,
      r: 12 + i * 14,
      grow: 5 + i * 0.8,
      alpha: 0.9 - i * 0.08,
      color
    });
  }

  if (strength > 70) {
    const accentColors = [BX.blue, BX.orange, BX.yellow, BX.green, BX.pink];
    for (let i = 0; i < 4; i++) {
      rings.push({
        x,
        y,
        r: 18 + i * 18,
        grow: 6 + i,
        alpha: 0.58 - i * 0.1,
        color: accentColors[i % accentColors.length]
      });
    }
  }
}

function addTrail(x, y, strength) {
  const count = 2 + Math.floor(strength / 35);

  for (let i = 0; i < count; i++) {
    trailDots.push({
      x,
      y,
      vx: Math.random() * 2 - 2.6,
      vy: Math.random() * 2 - 1.1,
      size: 4 + Math.random() * 5 + strength * 0.01,
      alpha: 0.9,
      color: strength > 85 ? BX.yellow : BX.orange
    });
  }
}

function addFlash(color, alpha = 0.25) {
  flashes.push({ color, alpha });
}

function spawnConfetti(x, y, count) {
  const palette = [BX.yellow, BX.green, BX.blue, BX.orange, BX.pink];
  for (let i = 0; i < count; i++) {
    confetti.push({
      x,
      y,
      vx: Math.random() * 10 - 5,
      vy: Math.random() * -6 - 1,
      w: 6 + Math.random() * 8,
      h: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.35,
      alpha: 1,
      color: palette[Math.floor(Math.random() * palette.length)]
    });
  }
}

/* =========================
   DRAW HELPERS
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
