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
let particles = [];
let rings = [];
let flashes = [];
let confetti = [];

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

const strikeZone = { x: 1135, y: 265, w: 120, h: 170 };
const mitt = { x: 1195, y: 350, r: 52, glow: 0.5 };
const miniMap = { x: 40, y: 620, w: 280, h: 105 };

// Change to -1 if throw direction feels reversed
const FORWARD_DIRECTION = 1;

// Move + style status under camera panel
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
    statusText.style.background = "rgba(12,24,42,0.88)";
    statusText.style.border = "2px solid rgba(143,215,255,0.35)";
    statusText.style.color = "#ffffff";
    statusText.style.boxShadow = "0 8px 24px rgba(0,0,0,0.28)";
  }
})();

function setStatus(msg) {
  statusText.textContent = msg;
}

// ---------- audio ----------
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
  if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, now + duration);

  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}
function playWhoosh() { playTone(420, 0.12, "sawtooth", 0.03, 160); }
function playStrike() {
  playTone(760, 0.08, "square", 0.04);
  setTimeout(() => playTone(960, 0.09, "square", 0.035), 55);
}
function playPerfect() {
  playTone(620, 0.08, "triangle", 0.04);
  setTimeout(() => playTone(860, 0.08, "triangle", 0.04), 55);
  setTimeout(() => playTone(1120, 0.12, "triangle", 0.04), 110);
}
function playMiss() { playTone(220, 0.14, "sawtooth", 0.035, 140); }
function playReset() { playTone(520, 0.06, "triangle", 0.03); }

// ---------- buttons ----------
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

      // Match overlay internal size to actual displayed video size
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
  particles = [];
  rings = [];
  flashes = [];
  confetti = [];

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

// ---------- main loop ----------
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

    // IMPORTANT: MoveNet keypoints are already in PIXELS.
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

    // ===========================
// TRUE PITCH WIND-UP BOX
// ===========================

const boxW = Math.max(shoulderSpan * 0.8, 100);
const boxH = Math.max(torsoHeight * 0.7, 120);

// place box BEHIND throwing shoulder
loadBox = {
  x: shoulderScreen.x - boxW - 45,
  y: shoulderScreen.y - boxH * 0.25,
  w: boxW,
  h: boxH
};

    drawSilhouette(keypoints);

    if (gameOver || throwCooldown || resultPauseTimer > 0 || ball) return;

    wristHistory.push({
      x: wristScreen.x,
      y: wristScreen.y,
      t: performance.now()
    });
    if (wristHistory.length > 14) wristHistory.shift();

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

        if (readyPoseFrames >= 4) {
          readyPoseArmed = true;
          setStatus("Loaded. Throw forward now.");
        }
      } else {
        setStatus("Move your hand out, then back into the blue box.");
        if (!wristInLoadBox) readyLockout = false;
      }
      return;
    }

    if (wristHistory.length >= 5) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];

      const rawForwardX = (last.x - first.x) * FORWARD_DIRECTION;
      const upwardY = first.y - last.y;

      const forwardX = Math.max(0, rawForwardX);
      const power = forwardX + Math.max(0, upwardY) * 0.2;

      const movedOutOfBox = !pointInRect(wristScreen.x, wristScreen.y, loadBox);

      if (movedOutOfBox && forwardX > 40 && power > 45) {
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

// ---------- throw / scoring ----------
function triggerThrow(power) {
  const strength = Math.min(power, 110);
  currentPower = Math.min(280, strength * 2.2);

  if (strength < 35) lastThrowLabel = "SOFT TOSS";
  else if (strength < 52) lastThrowLabel = "FAST BALL";
  else if (strength < 74) lastThrowLabel = "POWER PITCH";
  else lastThrowLabel = "SUPER HEATER";

  ball = {
  x: 175,
  y: 500,

  // MUCH stronger forward velocity
  vx: 14 + strength * 0.18,

  // cleaner arc
  vy: -6.5 - strength * 0.03,

  r: 14
};

  makeBurst(175, 500, 1.2, "#7fd6ff");
  makeRing(175, 500, "#7fd6ff");
  playWhoosh();

  readyPoseArmed = false;
  readyPoseFrames = 0;
  readyLockout = true;
  wristHistory = [];
  throwCooldown = true;

  setStatus("Pitch launched.");

  setTimeout(() => {
    throwCooldown = false;
    if (!gameOver) setStatus("Reload inside the blue box.");
  }, 1100);
}

function updateGame() {
  if (resultPauseTimer > 0) resultPauseTimer--;

  if (ball && !gameOver) {
    ball.vy += 0.18;
    ball.x += ball.vx;
    ball.y += ball.vy;

    addTrail(ball.x, ball.y);

    if (ball.x >= strikeZone.x) {
      resolvePitch();
      ball = null;
      resultPauseTimer = 55;
    }

    if (ball && (ball.y > 680 || ball.x > gameCanvas.width + 40)) {
      pitchCount++;
      scoreFlash = "MISS";
      scoreFlashTimer = 58;

      makeBurst(ball.x, Math.min(ball.y, 680), 1.0, "#ff7b7b");
      makeRing(ball.x, Math.min(ball.y, 680), "#ff7b7b");
      playMiss();

      ball = null;
      resultPauseTimer = 55;
      checkGameOver();

      if (!gameOver) setStatus("Miss. Reload inside the blue box.");
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.size *= 0.975;
    p.alpha *= 0.95;
    if (p.size < 0.8 || p.alpha < 0.05) particles.splice(i, 1);
  }

  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].r += 5;
    rings[i].alpha *= 0.92;
    if (rings[i].alpha < 0.05) rings.splice(i, 1);
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

  // tighter vertical windows
  const perfectWindow = 8;
  const strikeWindowTop = zoneTop + 24;
  const strikeWindowBottom = zoneBottom - 24;

  const isPerfect = distanceFromCenter <= perfectWindow;
  const isStrike = y >= strikeWindowTop && y <= strikeWindowBottom;

  if (isPerfect) {
    score += 200;
    scoreFlash = "PERFECT +200";
    scoreFlashTimer = 78;

    makeBurst(ball.x, ball.y, 2.4, "#ffe066");
    makeRing(ball.x, ball.y, "#ffe066");
    addFlash("#ffe066");
    spawnConfetti(ball.x, ball.y, 26);
    playPerfect();
  } else if (isStrike) {
    score += 100;
    scoreFlash = "STRIKE +100";
    scoreFlashTimer = 68;

    makeBurst(ball.x, ball.y, 1.8, "#8dffb2");
    makeRing(ball.x, ball.y, "#8dffb2");
    addFlash("#8dffb2");
    spawnConfetti(ball.x, ball.y, 12);
    playStrike();
  } else if (y < zoneTop) {
    scoreFlash = "HIGH BALL";
    scoreFlashTimer = 58;

    makeBurst(ball.x, ball.y, 1.2, "#ff9f7a");
    makeRing(ball.x, ball.y, "#ff9f7a");
    playMiss();
  } else {
    scoreFlash = "LOW BALL";
    scoreFlashTimer = 58;

    makeBurst(ball.x, ball.y, 1.2, "#ff9f7a");
    makeRing(ball.x, ball.y, "#ff9f7a");
    playMiss();
  }

  if ((isPerfect || isStrike) && currentPower > 165) {
    score += 50;
    scoreFlash += "  HEAT +50";
    scoreFlashTimer = 80;
  }

  checkGameOver();

  if (!gameOver) {
    setStatus("Result locked. Reload inside the blue box.");
  }
}

function checkGameOver() {
  if (pitchCount >= maxPitches) {
    gameOver = true;

    if (score < 200) finalRank = "ROOKIE";
    else if (score < 400) finalRank = "ALL-STAR";
    else if (score < 650) finalRank = "ACE PITCHER";
    else finalRank = "BXCM LEGEND";

    setStatus("Round complete. Press Reset Game to play again.");
  }
}

// ---------- fx ----------
function addTrail(x, y) {
  for (let i = 0; i < 4; i++) {
    particles.push({
      x, y,
      vx: Math.random() * 2 - 3,
      vy: Math.random() * 2 - 1.1,
      size: 4 + Math.random() * 8,
      alpha: 0.95,
      color: "#ffb347"
    });
  }
}

function makeBurst(x, y, scale, color) {
  const count = Math.floor(28 + scale * 34);
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() * 12 - 6) * scale,
      vy: (Math.random() * 12 - 6) * scale,
      size: (3 + Math.random() * 10) * scale,
      alpha: 1,
      color
    });
  }
}

function makeRing(x, y, color) {
  rings.push({ x, y, r: 10, alpha: 0.9, color });
}

function addFlash(color) {
  flashes.push({ alpha: 0.35, color });
}

function spawnConfetti(x, y, count) {
  const palette = ["#ffe066", "#8dffb2", "#7fd6ff", "#ff9f43", "#ff4d4d"];
  for (let i = 0; i < count; i++) {
    confetti.push({
      x, y,
      vx: Math.random() * 8 - 4,
      vy: Math.random() * -5 - 1,
      w: 6 + Math.random() * 7,
      h: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      alpha: 1,
      color: palette[Math.floor(Math.random() * palette.length)]
    });
  }
}

// ---------- draw ----------
function drawGame() {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  drawBackground();
  drawMiniMap();
  drawCatcherMitt();
  drawStrikeZone();
  drawHUD();
  drawRings();
  drawParticles();
  drawConfetti();
  drawBall();
  drawCelebrationFlash();
  drawEndScreen();
}

function drawBackground() {
  const sky = gameCtx.createLinearGradient(0, 0, 0, gameCanvas.height);
  sky.addColorStop(0, "#99e0ff");
  sky.addColorStop(0.42, "#ebf9ff");
  sky.addColorStop(0.43, "#69b86d");
  sky.addColorStop(1, "#265f37");
  gameCtx.fillStyle = sky;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  gameCtx.fillStyle = "rgba(41,68,96,0.55)";
  for (let i = 0; i < 20; i++) {
    const x = 40 + i * 70;
    const h = 20 + (i % 4) * 18;
    gameCtx.fillRect(x, 300 - h, 34, h);
  }

  for (let i = 0; i < 120; i++) {
    gameCtx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`;
    gameCtx.beginPath();
    gameCtx.arc(20 + i * 11, 318 + Math.random() * 24, 1.2 + Math.random(), 0, Math.PI * 2);
    gameCtx.fill();
  }

  for (let i = 0; i < 10; i++) {
    gameCtx.fillStyle = "rgba(255,248,190,0.85)";
    gameCtx.beginPath();
    gameCtx.arc(80 + i * 135, 72, 10, 0, Math.PI * 2);
    gameCtx.fill();
  }

  gameCtx.strokeStyle = "rgba(255,255,255,0.24)";
  gameCtx.lineWidth = 5;
  gameCtx.beginPath();
  gameCtx.moveTo(0, 455);
  gameCtx.lineTo(gameCanvas.width, 455);
  gameCtx.stroke();

  for (let i = 0; i < 10; i++) {
    gameCtx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.03)";
    gameCtx.fillRect(0, 470 + i * 28, gameCanvas.width, 28);
  }

  gameCtx.fillStyle = "#c98b52";
  gameCtx.beginPath();
  gameCtx.ellipse(175, 520, 52, 18, 0, 0, Math.PI * 2);
  gameCtx.fill();

  gameCtx.strokeStyle = "rgba(255,255,255,0.10)";
  gameCtx.lineWidth = 3;
  gameCtx.beginPath();
  gameCtx.moveTo(175, 505);
  gameCtx.lineTo(strikeZone.x + strikeZone.w / 2, strikeZone.y + strikeZone.h / 2);
  gameCtx.stroke();
}

function drawCatcherMitt() {
  const glow = gameCtx.createRadialGradient(mitt.x, mitt.y, 10, mitt.x, mitt.y, 100);
  glow.addColorStop(0, `rgba(255,214,90,${0.18 + mitt.glow * 0.18})`);
  glow.addColorStop(1, "rgba(255,214,90,0)");
  gameCtx.fillStyle = glow;
  gameCtx.fillRect(mitt.x - 110, mitt.y - 110, 220, 220);

  gameCtx.fillStyle = "#b46d2f";
  gameCtx.beginPath();
  gameCtx.ellipse(mitt.x, mitt.y, 55, 70, 0, 0, Math.PI * 2);
  gameCtx.fill();

  gameCtx.fillStyle = "#d18a45";
  gameCtx.beginPath();
  gameCtx.ellipse(mitt.x + 5, mitt.y + 4, 38, 48, 0, 0, Math.PI * 2);
  gameCtx.fill();

  gameCtx.strokeStyle = "rgba(90,40,10,0.8)";
  gameCtx.lineWidth = 3;
  gameCtx.beginPath();
  gameCtx.arc(mitt.x + 3, mitt.y + 2, 22, 0, Math.PI * 2);
  gameCtx.stroke();

  mitt.glow = 0.5 + Math.sin(performance.now() * 0.005) * 0.12;
}

function drawStrikeZone() {
  const glow = gameCtx.createRadialGradient(
    strikeZone.x + strikeZone.w / 2,
    strikeZone.y + strikeZone.h / 2,
    10,
    strikeZone.x + strikeZone.w / 2,
    strikeZone.y + strikeZone.h / 2,
    120
  );
  glow.addColorStop(0, "rgba(255,230,100,0.16)");
  glow.addColorStop(1, "rgba(255,230,100,0)");
  gameCtx.fillStyle = glow;
  gameCtx.fillRect(strikeZone.x - 60, strikeZone.y - 60, strikeZone.w + 120, strikeZone.h + 120);

  gameCtx.fillStyle = "rgba(0,0,0,0.18)";
  gameCtx.fillRect(strikeZone.x - 18, strikeZone.y - 18, strikeZone.w + 36, strikeZone.h + 36);

  // outer frame
  gameCtx.strokeStyle = "white";
  gameCtx.lineWidth = 6;
  gameCtx.strokeRect(strikeZone.x, strikeZone.y, strikeZone.w, strikeZone.h);

  // strike area
  gameCtx.strokeStyle = "rgba(140,255,180,0.95)";
  gameCtx.lineWidth = 3;
  gameCtx.strokeRect(
    strikeZone.x + 8,
    strikeZone.y + 12,
    strikeZone.w - 16,
    strikeZone.h - 24
  );

  // perfect area
  gameCtx.strokeStyle = "rgba(255,215,0,0.95)";
  gameCtx.lineWidth = 3;
  gameCtx.strokeRect(
    strikeZone.x + 24,
    strikeZone.y + strikeZone.h / 2 - 14,
    strikeZone.w - 48,
    28
  );

  // crosshair
  gameCtx.strokeStyle = "rgba(255,255,255,0.18)";
  gameCtx.lineWidth = 2;
  gameCtx.beginPath();
  gameCtx.moveTo(strikeZone.x + strikeZone.w / 2, strikeZone.y);
  gameCtx.lineTo(strikeZone.x + strikeZone.w / 2, strikeZone.y + strikeZone.h);
  gameCtx.stroke();

  gameCtx.beginPath();
  gameCtx.moveTo(strikeZone.x, strikeZone.y + strikeZone.h / 2);
  gameCtx.lineTo(strikeZone.x + strikeZone.w, strikeZone.y + strikeZone.h / 2);
  gameCtx.stroke();

  gameCtx.fillStyle = "rgba(0,0,0,0.54)";
  gameCtx.fillRect(strikeZone.x - 6, strikeZone.y - 42, 150, 30);

  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 16px Arial";
  gameCtx.fillText("STRIKE ZONE", strikeZone.x + 8, strikeZone.y - 21);
}

function drawMiniMap() {
  gameCtx.fillStyle = "rgba(0,0,0,0.38)";
  gameCtx.fillRect(miniMap.x, miniMap.y, miniMap.w, miniMap.h);

  gameCtx.strokeStyle = "rgba(255,255,255,0.28)";
  gameCtx.strokeRect(miniMap.x, miniMap.y, miniMap.w, miniMap.h);

  gameCtx.fillStyle = "#8fd7ff";
  gameCtx.font = "bold 14px Arial";
  gameCtx.fillText("OVERHEAD VIEW", miniMap.x + 14, miniMap.y + 21);

  gameCtx.strokeStyle = "rgba(255,255,255,0.22)";
  gameCtx.beginPath();
  gameCtx.moveTo(miniMap.x + 35, miniMap.y + 68);
  gameCtx.lineTo(miniMap.x + 235, miniMap.y + 68);
  gameCtx.stroke();

  gameCtx.fillStyle = "#c98b52";
  gameCtx.beginPath();
  gameCtx.arc(miniMap.x + 35, miniMap.y + 68, 9, 0, Math.PI * 2);
  gameCtx.fill();

  gameCtx.strokeStyle = "white";
  gameCtx.lineWidth = 2;
  gameCtx.strokeRect(miniMap.x + 228, miniMap.y + 44, 26, 48);

  if (ball) {
    const t = Math.min(1, (ball.x - 175) / (strikeZone.x - 175));
    const miniX = miniMap.x + 35 + t * 200;
    gameCtx.fillStyle = "#ffb347";
    gameCtx.beginPath();
    gameCtx.arc(miniX, miniMap.y + 68, 6, 0, Math.PI * 2);
    gameCtx.fill();
  }
}

function drawHUD() {
  gameCtx.fillStyle = "rgba(0,0,0,0.42)";
  gameCtx.fillRect(34, 28, 280, 32);

  let meterColor = "#5dc7ff";
  if (currentPower > 90) meterColor = "#ffe066";
  if (currentPower > 140) meterColor = "#ff9f43";
  if (currentPower > 190) meterColor = "#ff4d4d";

  gameCtx.fillStyle = meterColor;
  gameCtx.fillRect(34, 28, Math.min(currentPower, 280), 32);

  gameCtx.strokeStyle = "rgba(255,255,255,0.75)";
  gameCtx.lineWidth = 2;
  gameCtx.strokeRect(34, 28, 280, 32);

  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 15px Arial";
  gameCtx.fillText("PITCH POWER", 34, 20);

  gameCtx.fillStyle = "rgba(0,0,0,0.45)";
  gameCtx.fillRect(1030, 28, 300, 82);
  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 28px Arial";
  gameCtx.fillText(`Score: ${score}`, 1055, 62);
  gameCtx.fillText(`Pitch: ${pitchCount}/${maxPitches}`, 1055, 96);

  gameCtx.textAlign = "center";
  gameCtx.font = "bold 58px Arial";

  if (lastThrowLabel === "SOFT TOSS") gameCtx.fillStyle = "#d6f0ff";
  else if (lastThrowLabel === "FAST BALL") gameCtx.fillStyle = "#ffe066";
  else if (lastThrowLabel === "POWER PITCH") gameCtx.fillStyle = "#ff9f43";
  else if (lastThrowLabel === "SUPER HEATER") gameCtx.fillStyle = "#ff4d4d";
  else gameCtx.fillStyle = "white";

  gameCtx.fillText(lastThrowLabel, gameCanvas.width / 2, 92);

  if (scoreFlashTimer > 0) {
    gameCtx.font = "bold 32px Arial";
    gameCtx.fillStyle = "#fff28a";
    gameCtx.fillText(scoreFlash, gameCanvas.width / 2, 136);
  }

  gameCtx.textAlign = "start";
}

function drawBall() {
  if (!ball) return;

  gameCtx.beginPath();
  gameCtx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  gameCtx.fillStyle = "white";
  gameCtx.fill();

  gameCtx.strokeStyle = "#d33";
  gameCtx.lineWidth = 2;
  gameCtx.beginPath();
  gameCtx.arc(ball.x, ball.y, ball.r - 3, 0.5, 2.4);
  gameCtx.stroke();

  gameCtx.beginPath();
  gameCtx.arc(ball.x, ball.y, ball.r - 3, 3.6, 5.6);
  gameCtx.stroke();
}

function drawParticles() {
  particles.forEach((p) => {
    gameCtx.fillStyle = hexToRgba(p.color || "#ffb347", p.alpha);
    gameCtx.beginPath();
    gameCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    gameCtx.fill();
  });
}

function drawRings() {
  rings.forEach((r) => {
    gameCtx.strokeStyle = hexToRgba(r.color || "#ffffff", r.alpha);
    gameCtx.lineWidth = 5;
    gameCtx.beginPath();
    gameCtx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    gameCtx.stroke();
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

function drawCelebrationFlash() {
  flashes.forEach((f) => {
    gameCtx.fillStyle = hexToRgba(f.color, f.alpha * 0.24);
    gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  });
}

function drawEndScreen() {
  if (!gameOver) return;

  gameCtx.fillStyle = "rgba(0,0,0,0.72)";
  gameCtx.fillRect(400, 180, 620, 280);

  gameCtx.strokeStyle = "rgba(255,255,255,0.18)";
  gameCtx.strokeRect(400, 180, 620, 280);

  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 50px Arial";
  gameCtx.fillText("CHALLENGE COMPLETE", 470, 255);

  gameCtx.fillStyle = "#ffe066";
  gameCtx.font = "bold 46px Arial";
  gameCtx.fillText(finalRank, 575, 320);

  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 32px Arial";
  gameCtx.fillText(`FINAL SCORE: ${score}`, 590, 378);

  gameCtx.font = "bold 22px Arial";
  gameCtx.fillText("Press Reset Game to play again", 555, 425);
}

// ---------- silhouette ----------
function drawSilhouette(keypoints) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (loadBox) {
    overlayCtx.fillStyle = readyPoseArmed
      ? "rgba(0,255,140,0.18)"
      : "rgba(70,170,255,0.18)";
    overlayCtx.strokeStyle = readyPoseArmed
      ? "rgba(0,255,140,0.95)"
      : "rgba(70,170,255,0.95)";
    overlayCtx.lineWidth = 3;
    overlayCtx.fillRect(loadBox.x, loadBox.y, loadBox.w, loadBox.h);
    overlayCtx.strokeRect(loadBox.x, loadBox.y, loadBox.w, loadBox.h);
  }

  overlayCtx.strokeStyle = "rgba(111,214,255,0.95)";
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
      overlayCtx.fillStyle = "rgba(255,230,120,0.92)";
      overlayCtx.beginPath();
      overlayCtx.arc(k.x, k.y, 5, 0, Math.PI * 2);
      overlayCtx.fill();
    }
  });

  if (wristScreen) {
    overlayCtx.fillStyle = "rgba(255,255,255,0.95)";
    overlayCtx.beginPath();
    overlayCtx.arc(wristScreen.x, wristScreen.y, 11, 0, Math.PI * 2);
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

// ---------- helpers ----------
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
