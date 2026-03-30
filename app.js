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

const strikeZone = { x: 1120, y: 260, w: 125, h: 175 };
const mitt = { x: 1188, y: 348, r: 56, glow: 0.5 };
const miniMap = { x: 38, y: 618, w: 285, h: 110 };

// flip to -1 if direction feels reversed
const FORWARD_DIRECTION = 1;

// bigger status box
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
    statusText.style.background = "rgba(10,22,39,0.92)";
    statusText.style.border = "2px solid rgba(143,215,255,0.35)";
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
  playTone(380, 0.14, "sawtooth", 0.03, 130);
}
function playStrike() {
  playTone(700, 0.07, "square", 0.04);
  setTimeout(() => playTone(920, 0.08, "square", 0.035), 50);
}
function playPerfect() {
  playTone(620, 0.08, "triangle", 0.04);
  setTimeout(() => playTone(860, 0.08, "triangle", 0.04), 55);
  setTimeout(() => playTone(1120, 0.12, "triangle", 0.045), 110);
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

    // locked states
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

        // MORE HOLD REQUIRED THAN BEFORE
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

      // STRICTER TRIGGER THAN BEFORE
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

  // LONGER COOLDOWN
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

      // LONGER PAUSE AFTER RESULT
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

    spawnImpact(ball.x, ball.y, 2.6, "#ffe066", ball.strength);
    addFlash("#ffe066", 0.45);
    spawnConfetti(ball.x, ball.y, 34);
    playPerfect();
  } else if (isStrike) {
    score += 100;
    scoreFlash = "STRIKE +100";
    scoreFlashTimer = 68;

    spawnImpact(ball.x, ball.y, 1.9, "#8dffb2", ball.strength);
    addFlash("#8dffb2", 0.28);
    spawnConfetti(ball.x, ball.y, 18);
    playStrike();
  } else if (y < zoneTop) {
    scoreFlash = "HIGH BALL";
    scoreFlashTimer = 58;
    spawnImpact(ball.x, ball.y, 1.1, "#ff9f7a", ball.strength);
    playMiss();
  } else {
    scoreFlash = "LOW BALL";
    scoreFlashTimer = 58;
    spawnImpact(ball.x, ball.y, 1.1, "#ff9f7a", ball.strength);
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

/* =========================
   MODERN FX
========================= */
function spawnLaunchBurst(x, y, strength) {
  const colors = ["#7fd6ff", "#8dffb2", "#ffe066"];
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

  addFlash("#7fd6ff", 0.12);
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
      color: color
    });
  }

  if (strength > 70) {
    const accentColors = ["#7fd6ff", "#ff9f43", "#ffe066", "#8dffb2"];
    for (let i = 0; i < 3; i++) {
      rings.push({
        x,
        y,
        r: 18 + i * 18,
        grow: 6 + i,
        alpha: 0.55 - i * 0.1,
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
      color: strength > 85 ? "#ffe066" : "#ffb347"
    });
  }
}

function addFlash(color, alpha = 0.25) {
  flashes.push({ color, alpha });
}

function spawnConfetti(x, y, count) {
  const palette = ["#ffe066", "#8dffb2", "#7fd6ff", "#ff9f43", "#ff4d4d"];
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
   DRAW
========================= */
function drawGame() {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  drawBackground();
  drawMiniMap();
  drawCatcherMitt();
  drawStrikeZone();
  drawHUD();
  drawRings();
  drawTrail();
  drawConfetti();
  drawBall();
  drawCelebrationFlash();
  drawEndScreen();
}

function drawBackground() {
  const sky = gameCtx.createLinearGradient(0, 0, 0, gameCanvas.height);
  sky.addColorStop(0, "#7ea4c5");
  sky.addColorStop(0.30, "#b7c6d3");
  sky.addColorStop(0.31, "#49627b");
  sky.addColorStop(0.55, "#32485f");
  sky.addColorStop(0.56, "#4f8c49");
  sky.addColorStop(1, "#295a33");
  gameCtx.fillStyle = sky;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  roundedRect(gameCtx, 0, 90, gameCanvas.width, 255, 0, "#5f7286", null);

  const letters = [
    { ch: "B", x: 95, color: "rgba(247,215,78,0.55)" },
    { ch: "R", x: 360, color: "rgba(245,163,84,0.55)" },
    { ch: "O", x: 620, color: "rgba(83,191,255,0.50)" },
    { ch: "N", x: 885, color: "rgba(222,108,195,0.45)" },
    { ch: "X", x: 1140, color: "rgba(130,221,92,0.48)" }
  ];

  for (let col = 0; col < 5; col++) {
    const x = 60 + col * 260;
    roundedRect(gameCtx, x, 35, 205, 230, 0, "rgba(210,225,235,0.20)", "rgba(255,255,255,0.18)");
    for (let r = 0; r < 4; r++) {
      gameCtx.strokeStyle = "rgba(70,85,102,0.95)";
      gameCtx.lineWidth = 5;
      gameCtx.beginPath();
      gameCtx.moveTo(x, 35 + r * 58);
      gameCtx.lineTo(x + 205, 35 + r * 58);
      gameCtx.stroke();
    }
    for (let c = 1; c < 3; c++) {
      gameCtx.beginPath();
      gameCtx.moveTo(x + c * 68, 35);
      gameCtx.lineTo(x + c * 68, 265);
      gameCtx.stroke();
    }
  }

  letters.forEach((l) => {
    gameCtx.fillStyle = l.color;
    gameCtx.font = "bold 210px Arial";
    gameCtx.fillText(l.ch, l.x, 225);
  });

  gameCtx.fillStyle = "rgba(40,55,72,0.28)";
  for (let i = 0; i < 20; i++) {
    const x = 20 + i * 70;
    const h = 35 + (i % 5) * 18;
    gameCtx.fillRect(x, 210 - h, 28 + (i % 3) * 10, h);
  }

  roundedRect(gameCtx, 0, 325, gameCanvas.width, 82, 0, "#2b3950", null);

  for (let i = 0; i < 6; i++) {
    const x = 105 + i * 210;
    gameCtx.fillStyle = "rgba(255,255,255,0.88)";
    gameCtx.font = "bold 24px Arial";
    gameCtx.fillText("PLAYERS", x, 370);
    gameCtx.fillText("ALLIANCE", x, 397);

    roundedRect(gameCtx, x - 48, 353, 34, 10, 3, "#e1ae3e", null);
    roundedRect(gameCtx, x - 48, 372, 34, 10, 3, "#e1ae3e", null);
  }

  gameCtx.strokeStyle = "rgba(255,255,255,0.24)";
  gameCtx.lineWidth = 4;
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
  const glow = gameCtx.createRadialGradient(mitt.x, mitt.y, 10, mitt.x, mitt.y, 120);
  glow.addColorStop(0, `rgba(255,214,90,${0.20 + mitt.glow * 0.22})`);
  glow.addColorStop(1, "rgba(255,214,90,0)");
  gameCtx.fillStyle = glow;
  gameCtx.fillRect(mitt.x - 130, mitt.y - 130, 260, 260);

  gameCtx.fillStyle = "#a85f26";
  gameCtx.beginPath();
  gameCtx.ellipse(mitt.x, mitt.y, 55, 72, 0, 0, Math.PI * 2);
  gameCtx.fill();

  gameCtx.fillStyle = "#d18a45";
  gameCtx.beginPath();
  gameCtx.ellipse(mitt.x + 4, mitt.y + 2, 40, 52, 0, 0, Math.PI * 2);
  gameCtx.fill();

  gameCtx.strokeStyle = "rgba(90,40,10,0.85)";
  gameCtx.lineWidth = 3;
  gameCtx.beginPath();
  gameCtx.arc(mitt.x + 3, mitt.y + 2, 22, 0, Math.PI * 2);
  gameCtx.stroke();

  mitt.glow = 0.5 + Math.sin(performance.now() * 0.005) * 0.14;
}

function drawStrikeZone() {
  const glow = gameCtx.createRadialGradient(
    strikeZone.x + strikeZone.w / 2,
    strikeZone.y + strikeZone.h / 2,
    10,
    strikeZone.x + strikeZone.w / 2,
    strikeZone.y + strikeZone.h / 2,
    130
  );
  glow.addColorStop(0, "rgba(255,230,100,0.16)");
  glow.addColorStop(1, "rgba(255,230,100,0)");
  gameCtx.fillStyle = glow;
  gameCtx.fillRect(strikeZone.x - 70, strikeZone.y - 70, strikeZone.w + 140, strikeZone.h + 140);

  roundedRect(gameCtx, strikeZone.x - 18, strikeZone.y - 18, strikeZone.w + 36, strikeZone.h + 36, 18, "rgba(0,0,0,0.18)", null);
  roundedRect(gameCtx, strikeZone.x, strikeZone.y, strikeZone.w, strikeZone.h, 14, null, "white", 6);
  roundedRect(gameCtx, strikeZone.x + 18, strikeZone.y + strikeZone.h / 2 - 18, strikeZone.w - 36, 36, 12, null, "rgba(255,215,0,0.95)", 3);

  gameCtx.strokeStyle = "rgba(255,255,255,0.16)";
  gameCtx.lineWidth = 2;
  gameCtx.beginPath();
  gameCtx.moveTo(strikeZone.x + strikeZone.w / 2, strikeZone.y);
  gameCtx.lineTo(strikeZone.x + strikeZone.w / 2, strikeZone.y + strikeZone.h);
  gameCtx.stroke();

  gameCtx.beginPath();
  gameCtx.moveTo(strikeZone.x, strikeZone.y + strikeZone.h / 2);
  gameCtx.lineTo(strikeZone.x + strikeZone.w, strikeZone.y + strikeZone.h / 2);
  gameCtx.stroke();

  roundedRect(gameCtx, strikeZone.x - 6, strikeZone.y - 42, 156, 30, 12, "rgba(0,0,0,0.54)", null);
  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 16px Arial";
  gameCtx.fillText("STRIKE ZONE", strikeZone.x + 10, strikeZone.y - 21);
}

function drawMiniMap() {
  roundedRect(gameCtx, miniMap.x, miniMap.y, miniMap.w, miniMap.h, 18, "rgba(0,0,0,0.38)", "rgba(255,255,255,0.20)", 2);

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

  roundedRect(gameCtx, miniMap.x + 228, miniMap.y + 44, 26, 48, 8, null, "white", 2);

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
  roundedRect(gameCtx, 34, 28, 280, 34, 16, "rgba(0,0,0,0.42)", "rgba(255,255,255,0.22)", 2);

  let meterColor = "#5dc7ff";
  if (currentPower > 90) meterColor = "#ffe066";
  if (currentPower > 140) meterColor = "#ff9f43";
  if (currentPower > 190) meterColor = "#ff4d4d";

  roundedRect(gameCtx, 36, 30, Math.min(currentPower, 276), 30, 14, meterColor, null);

  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 15px Arial";
  gameCtx.fillText("PITCH POWER", 34, 20);

  roundedRect(gameCtx, 1030, 28, 300, 84, 18, "rgba(0,0,0,0.45)", "rgba(255,255,255,0.20)", 2);
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
    gameCtx.font = "bold 34px Arial";
    gameCtx.fillStyle = "#fff28a";
    gameCtx.fillText(scoreFlash, gameCanvas.width / 2, 140);
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

function drawTrail() {
  trailDots.forEach((t) => {
    gameCtx.fillStyle = hexToRgba(t.color, t.alpha);
    gameCtx.beginPath();
    gameCtx.arc(t.x, t.y, t.size, 0, Math.PI * 2);
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

  roundedRect(gameCtx, 400, 180, 620, 280, 28, "rgba(0,0,0,0.72)", "rgba(255,255,255,0.18)", 2);

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

/* =========================
   SILHOUETTE / LOAD BOX
========================= */
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
