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

let score = 0;
let pitchCount = 0;
const maxPitches = 5;
let gameOver = false;
let finalRank = "";
let scoreFlash = "";
let scoreFlashTimer = 0;

let currentPower = 0;
let lastThrowLabel = "READY";

let throwCooldown = false;
let readyPoseArmed = false;
let readyPoseFrames = 0;
let releaseReady = false;
let wristHistory = [];
let resultPauseTimer = 0;

const strikeZone = { x: 1135, y: 275, w: 110, h: 155 };
const miniMap = { x: 40, y: 620, w: 280, h: 105 };

startBtn.onclick = async () => {
  try {
    if (!cameraStarted) {
      statusText.innerText = "Requesting camera...";

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });

      video.srcObject = stream;

      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve();
      });

      await video.play();

      overlay.width = video.videoWidth || 640;
      overlay.height = video.videoHeight || 800;

      statusText.innerText = "Loading pose detector...";

      await tf.setBackend("webgl");
      await tf.ready();

      detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        {
          modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
        }
      );

      cameraStarted = true;
    }

    statusText.innerText = "Bring your throwing hand near your shoulder and hold it there briefly.";

    if (!started) {
      started = true;
      requestAnimationFrame(loop);
    }
  } catch (err) {
    console.error(err);
    statusText.innerText = "Error: " + err.message;
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
  score = 0;
  pitchCount = 0;
  gameOver = false;
  finalRank = "";
  scoreFlash = "";
  scoreFlashTimer = 0;
  currentPower = 0;
  lastThrowLabel = "READY";
  throwCooldown = false;
  readyPoseArmed = false;
  readyPoseFrames = 0;
  releaseReady = false;
  wristHistory = [];
  resultPauseTimer = 0;
  statusText.innerText = "Game reset. Load your arm near your shoulder.";
}

async function loop() {
  requestAnimationFrame(loop);

  drawGame();
  updateGame();

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (!detector || video.readyState < 2) return;

  try {
    const poses = await detector.estimatePoses(video);

    if (!poses || poses.length === 0 || !poses[0].keypoints) {
      statusText.innerText = "No body detected. Step back so your upper body is visible.";
      return;
    }

    const keypoints = poses[0].keypoints;

    const rightWrist = findKeypoint(keypoints, "right_wrist");
    const rightElbow = findKeypoint(keypoints, "right_elbow");
    const rightShoulder = findKeypoint(keypoints, "right_shoulder");

    if (
      !rightWrist || !rightElbow || !rightShoulder ||
      rightWrist.score < 0.25 ||
      rightElbow.score < 0.25 ||
      rightShoulder.score < 0.25
    ) {
      statusText.innerText = "Right arm not clear. Face camera and step back.";
      return;
    }

    drawSilhouette(keypoints);

    if (gameOver || throwCooldown || resultPauseTimer > 0 || ball) return;

    const shoulderDist = dist(rightWrist.x, rightWrist.y, rightShoulder.x, rightShoulder.y);
    const elbowDist = dist(rightWrist.x, rightWrist.y, rightElbow.x, rightElbow.y);

    wristHistory.push({
      x: rightWrist.x,
      y: rightWrist.y,
      t: performance.now()
    });
    if (wristHistory.length > 10) wristHistory.shift();

    const loadedPose = shoulderDist < 0.14 && elbowDist < 0.20;

    if (!readyPoseArmed) {
      if (loadedPose) {
        readyPoseFrames++;
        statusText.innerText = "Hold... loading pitch.";
      } else {
        readyPoseFrames = 0;
        statusText.innerText = "Bring your hand near your shoulder to load the pitch.";
      }

      if (readyPoseFrames >= 10) {
        readyPoseArmed = true;
        releaseReady = true;
        statusText.innerText = "Loaded. Throw forward now.";
      }
      return;
    }

    if (releaseReady && wristHistory.length >= 5) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];

      const dx = (last.x - first.x) * overlay.width;
      const dy = (first.y - last.y) * overlay.height;
      const power = Math.abs(dx) + Math.max(0, dy) * 0.30;

      // require the hand to move meaningfully away from shoulder after loading
      if (shoulderDist > 0.23 && power > 110) {
        triggerThrow(power);
      } else {
        statusText.innerText = "Loaded. Throw forward now.";
      }
    }
  } catch (err) {
    console.error(err);
    statusText.innerText = "Pose error: " + err.message;
  }
}

function triggerThrow(power) {
  const strength = Math.min(power, 200);
  currentPower = Math.min(260, strength);

  if (strength < 120) lastThrowLabel = "SOFT TOSS";
  else if (strength < 145) lastThrowLabel = "FAST BALL";
  else if (strength < 170) lastThrowLabel = "POWER PITCH";
  else lastThrowLabel = "SUPER HEATER";

  ball = {
    x: 175,
    y: 500,
    vx: 11 + strength * 0.12,
    vy: -6.5 - strength * 0.032,
    r: 14
  };

  makeBurst(175, 500, 1.2, "#7fd6ff");
  makeRing(175, 500, "#7fd6ff");

  readyPoseArmed = false;
  readyPoseFrames = 0;
  releaseReady = false;
  throwCooldown = true;
  wristHistory = [];

  statusText.innerText = "Pitch launched.";

  setTimeout(() => {
    throwCooldown = false;
  }, 500);
}

function updateGame() {
  if (resultPauseTimer > 0) {
    resultPauseTimer--;
  }

  if (ball && !gameOver) {
    ball.vy += 0.23;
    ball.x += ball.vx;
    ball.y += ball.vy;

    addTrail(ball.x, ball.y);

    if (ball.x >= strikeZone.x) {
      resolvePitch();
      ball = null;
      resultPauseTimer = 40;
    }

    if (ball && (ball.y > 660 || ball.x > gameCanvas.width + 40)) {
      pitchCount++;
      scoreFlash = "MISS";
      scoreFlashTimer = 55;
      makeBurst(ball.x, Math.min(ball.y, 660), 1.0, "#ff7b7b");
      makeRing(ball.x, Math.min(ball.y, 660), "#ff7b7b");
      ball = null;
      resultPauseTimer = 40;
      checkGameOver();
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

  if (scoreFlashTimer > 0) scoreFlashTimer--;
}

function resolvePitch() {
  pitchCount++;

  const centerY = strikeZone.y + strikeZone.h / 2;
  const distanceFromCenter = Math.abs(ball.y - centerY);

  const inZone = ball.y >= strikeZone.y && ball.y <= strikeZone.y + strikeZone.h;

  if (inZone) {
    if (distanceFromCenter < 20) {
      score += 200;
      scoreFlash = "PERFECT +200";
      scoreFlashTimer = 70;
      makeBurst(ball.x, ball.y, 2.1, "#ffe066");
      makeRing(ball.x, ball.y, "#ffe066");
      addFlash("#ffe066");
    } else {
      score += 100;
      scoreFlash = "STRIKE +100";
      scoreFlashTimer = 65;
      makeBurst(ball.x, ball.y, 1.6, "#8dffb2");
      makeRing(ball.x, ball.y, "#8dffb2");
      addFlash("#8dffb2");
    }

    if (currentPower > 160) {
      score += 50;
      scoreFlash += "  HEAT +50";
      scoreFlashTimer = 75;
    }
  } else {
    scoreFlash = "BALL";
    scoreFlashTimer = 55;
    makeBurst(ball.x, ball.y, 1.1, "#ff9f7a");
    makeRing(ball.x, ball.y, "#ff9f7a");
  }

  checkGameOver();

  if (!gameOver) {
    statusText.innerText = "Result locked. Reload your arm for the next pitch.";
  }
}

function checkGameOver() {
  if (pitchCount >= maxPitches) {
    gameOver = true;

    if (score < 200) finalRank = "ROOKIE";
    else if (score < 400) finalRank = "ALL-STAR";
    else if (score < 650) finalRank = "ACE PITCHER";
    else finalRank = "BXCM LEGEND";

    statusText.innerText = "Round complete. Press Reset Game to play again.";
  }
}

function addTrail(x, y) {
  for (let i = 0; i < 4; i++) {
    particles.push({
      x,
      y,
      vx: Math.random() * 2 - 3.0,
      vy: Math.random() * 2 - 1.1,
      size: 4 + Math.random() * 8,
      alpha: 0.95,
      color: "#ffb347"
    });
  }
}

function makeBurst(x, y, scale, color) {
  const count = Math.floor(24 + scale * 32);
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() * 12 - 6) * scale,
      vy: (Math.random() * 12 - 6) * scale,
      size: (3 + Math.random() * 9) * scale,
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

function drawGame() {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  drawBackground();
  drawMiniMap();
  drawStrikeZone();
  drawHUD();
  drawRings();
  drawParticles();
  drawBall();
  drawCelebrationFlash();
  drawEndScreen();
}

function drawBackground() {
  const sky = gameCtx.createLinearGradient(0, 0, 0, gameCanvas.height);
  sky.addColorStop(0, "#99e0ff");
  sky.addColorStop(0.32, "#ebf9ff");
  sky.addColorStop(0.33, "#314b6b");
  sky.addColorStop(0.53, "#21364d");
  sky.addColorStop(0.54, "#4db45e");
  sky.addColorStop(1, "#265f37");
  gameCtx.fillStyle = sky;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  // crowd deck
  gameCtx.fillStyle = "#253b53";
  gameCtx.fillRect(0, 220, gameCanvas.width, 95);

  for (let i = 0; i < 220; i++) {
    gameCtx.fillStyle = `rgba(255,255,255,${0.10 + Math.random() * 0.35})`;
    gameCtx.beginPath();
    gameCtx.arc(12 + i * 7, 235 + Math.random() * 62, 1.5 + Math.random() * 1.7, 0, Math.PI * 2);
    gameCtx.fill();
  }

  // stadium lights
  for (let i = 0; i < 10; i++) {
    gameCtx.fillStyle = "rgba(255,248,190,0.95)";
    gameCtx.beginPath();
    gameCtx.arc(80 + i * 135, 60, 12, 0, Math.PI * 2);
    gameCtx.fill();
  }

  // fence line
  gameCtx.strokeStyle = "rgba(255,255,255,0.28)";
  gameCtx.lineWidth = 5;
  gameCtx.beginPath();
  gameCtx.moveTo(0, 455);
  gameCtx.lineTo(gameCanvas.width, 455);
  gameCtx.stroke();

  // grass stripes
  for (let i = 0; i < 10; i++) {
    gameCtx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
    gameCtx.fillRect(0, 470 + i * 28, gameCanvas.width, 28);
  }

  // pitcher mound
  gameCtx.fillStyle = "#c98b52";
  gameCtx.beginPath();
  gameCtx.ellipse(175, 520, 52, 18, 0, 0, Math.PI * 2);
  gameCtx.fill();

  // subtle home plate path
  gameCtx.strokeStyle = "rgba(255,255,255,0.10)";
  gameCtx.lineWidth = 3;
  gameCtx.beginPath();
  gameCtx.moveTo(175, 505);
  gameCtx.lineTo(strikeZone.x + strikeZone.w / 2, strikeZone.y + strikeZone.h / 2);
  gameCtx.stroke();
}

function drawStrikeZone() {
  // catcher backplate glow
  const glow = gameCtx.createRadialGradient(
    strikeZone.x + strikeZone.w / 2,
    strikeZone.y + strikeZone.h / 2,
    10,
    strikeZone.x + strikeZone.w / 2,
    strikeZone.y + strikeZone.h / 2,
    120
  );
  glow.addColorStop(0, "rgba(255,230,100,0.18)");
  glow.addColorStop(1, "rgba(255,230,100,0)");
  gameCtx.fillStyle = glow;
  gameCtx.fillRect(strikeZone.x - 50, strikeZone.y - 50, strikeZone.w + 100, strikeZone.h + 100);

  // catcher frame
  gameCtx.fillStyle = "rgba(0,0,0,0.22)";
  gameCtx.fillRect(strikeZone.x - 18, strikeZone.y - 18, strikeZone.w + 36, strikeZone.h + 36);

  gameCtx.strokeStyle = "white";
  gameCtx.lineWidth = 6;
  gameCtx.strokeRect(strikeZone.x, strikeZone.y, strikeZone.w, strikeZone.h);

  gameCtx.strokeStyle = "rgba(255,215,0,0.95)";
  gameCtx.lineWidth = 3;
  gameCtx.strokeRect(
    strikeZone.x + 18,
    strikeZone.y + 24,
    strikeZone.w - 36,
    strikeZone.h - 48
  );

  // crosshair
  gameCtx.strokeStyle = "rgba(255,255,255,0.22)";
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
  gameCtx.fillRect(strikeZone.x - 6, strikeZone.y - 42, 146, 30);

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
  // power bar
  gameCtx.fillStyle = "rgba(0,0,0,0.40)";
  gameCtx.fillRect(34, 28, 280, 30);

  let meterColor = "#5dc7ff";
  if (currentPower > 90) meterColor = "#ffe066";
  if (currentPower > 140) meterColor = "#ff9f43";
  if (currentPower > 175) meterColor = "#ff4d4d";

  gameCtx.fillStyle = meterColor;
  gameCtx.fillRect(34, 28, Math.min(currentPower, 280), 30);

  gameCtx.strokeStyle = "rgba(255,255,255,0.75)";
  gameCtx.lineWidth = 2;
  gameCtx.strokeRect(34, 28, 280, 30);

  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 15px Arial";
  gameCtx.fillText("PITCH POWER", 34, 20);

  // score card
  gameCtx.fillStyle = "rgba(0,0,0,0.45)";
  gameCtx.fillRect(1030, 28, 300, 78);
  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 28px Arial";
  gameCtx.fillText(`Score: ${score}`, 1055, 60);
  gameCtx.fillText(`Pitch: ${pitchCount}/${maxPitches}`, 1055, 93);

  // big label
  gameCtx.textAlign = "center";
  gameCtx.font = "bold 58px Arial";

  if (lastThrowLabel === "SOFT TOSS") gameCtx.fillStyle = "#d6f0ff";
  else if (lastThrowLabel === "FAST BALL") gameCtx.fillStyle = "#ffe066";
  else if (lastThrowLabel === "POWER PITCH") gameCtx.fillStyle = "#ff9f43";
  else if (lastThrowLabel === "SUPER HEATER") gameCtx.fillStyle = "#ff4d4d";
  else gameCtx.fillStyle = "white";

  gameCtx.fillText(lastThrowLabel, gameCanvas.width / 2, 90);

  if (scoreFlashTimer > 0) {
    gameCtx.font = "bold 30px Arial";
    gameCtx.fillStyle = "#fff28a";
    gameCtx.fillText(scoreFlash, gameCanvas.width / 2, 132);
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

function drawCelebrationFlash() {
  flashes.forEach((f) => {
    gameCtx.fillStyle = hexToRgba(f.color, f.alpha * 0.22);
    gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  });
}

function drawEndScreen() {
  if (!gameOver) return;

  gameCtx.fillStyle = "rgba(0,0,0,0.70)";
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

function drawSilhouette(keypoints) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

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

  const wrist = findKeypoint(keypoints, "right_wrist");
  if (wrist && wrist.score > 0.25) {
    overlayCtx.fillStyle = "rgba(255,255,255,0.95)";
    overlayCtx.beginPath();
    overlayCtx.arc(wrist.x, wrist.y, 10, 0, Math.PI * 2);
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

function findKeypoint(keypoints, name) {
  return keypoints.find(k => k.name === name);
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function hexToRgba(hex, alpha) {
  const c = hex.replace("#", "");
  const bigint = parseInt(c, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
