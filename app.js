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

let trailDots = [];
let rings = [];
let flashes = [];
let confetti = [];

let wristHistory = [];
let throwCooldown = false;
let resultPauseTimer = 0;
let readyPoseArmed = false;
let readyPoseFrames = 0;
let readyLockout = false;

let loadBox = null;
let wristScreen = null;
let releasePoint = null;
let finishPoint = null;

let sessionCount = 0;
let totalFormScore = 0;

let currentPower = 0;
let feedbackText = "READY";
let feedbackTimer = 0;

let phase = "LOAD"; // LOAD, RELEASE, FINISH, RESET
let coachingText = "Move your throwing hand into the blue box.";

let formScores = {
  load: 0,
  release: 0,
  follow: 0,
  total: 0
};

let lastResult = {
  load: 0,
  release: 0,
  follow: 0,
  total: 0,
  note: ""
};

const FORWARD_DIRECTION = 1;

const miniMap = { x: 42, y: 620, w: 280, h: 108 };

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

/* AUDIO */
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
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
function playRelease() { playTone(380, 0.12, "sawtooth", 0.03, 140); }
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

/* BUTTONS */
startBtn.onclick = async () => {
  try {
    ensureAudio();
    setStatus("Starting camera...");

    // Stop previous stream only if already running
    if (video.srcObject) {
      const oldStream = video.srcObject;
      oldStream.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }

    // SINGLE clean camera request
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 }
      },
      audio: false
    });

    video.srcObject = stream;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Camera timeout"));
      }, 10000);

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

    setStatus("Loading pose detector...");

    if (!detector) {
      await tf.setBackend("webgl");
      await tf.ready();

      detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        {
          modelType:
            poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
        }
      );
    }

    cameraStarted = true;

    setStatus("STEP 1: Put your throwing hand in the blue box.");

    if (!started) {
      started = true;
      requestAnimationFrame(loop);
    }

  } catch (err) {
    console.error("Camera error:", err);
    setStatus("Camera failed. Check OBS Virtual Camera.");
    alert("Camera failed: " + err.message);
  }
};

resetBtn.onclick = () => {
  resetSession();
};

function resetSession() {
  trailDots = [];
  rings = [];
  flashes = [];
  confetti = [];

  wristHistory = [];
  throwCooldown = false;
  resultPauseTimer = 0;
  readyPoseArmed = false;
  readyPoseFrames = 0;
  readyLockout = false;

  loadBox = null;
  wristScreen = null;
  releasePoint = null;
  finishPoint = null;

  currentPower = 0;
  feedbackText = "READY";
  feedbackTimer = 0;

  phase = "LOAD";
  coachingText = "STEP 1: Load your arm in the blue box.";
  setStatus(coachingText);

  formScores = { load: 0, release: 0, follow: 0, total: 0 };

  playReset();
  drawGame();
}

/* LOOP */
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

    if (throwCooldown || resultPauseTimer > 0) {
      return;
    }

    wristHistory.push({
      x: wristScreen.x,
      y: wristScreen.y,
      t: performance.now()
    });
    if (wristHistory.length > 18) wristHistory.shift();

    const wristInLoadBox = pointInRect(wristScreen.x, wristScreen.y, loadBox);

    if (phase === "LOAD") {
      if (!readyLockout) {
        if (wristInLoadBox) {
          readyPoseFrames++;
          coachingText = "STEP 1: Great. Hold your load.";
          setStatus(coachingText);
        } else {
          readyPoseFrames = 0;
          coachingText = "STEP 1: Move your throwing hand into the blue box.";
          setStatus(coachingText);
        }

        if (readyPoseFrames >= 7) {
          readyPoseArmed = true;
          phase = "RELEASE";
          formScores.load = 100;
          feedbackText = "GREAT LOAD";
          feedbackTimer = 45;
          playLoad();
          spawnCoachBurst(loadBox.x + loadBox.w / 2, loadBox.y + loadBox.h / 2, BX.blue);
          coachingText = "STEP 2: Throw forward.";
          setStatus(coachingText);
        }
      } else {
        coachingText = "Move your hand out, then reload in the blue box.";
        setStatus(coachingText);
        if (!wristInLoadBox) readyLockout = false;
      }
      return;
    }

    if (phase === "RELEASE" && wristHistory.length >= 6) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];

      const rawForwardX = (last.x - first.x) * FORWARD_DIRECTION;
      const upwardY = first.y - last.y;

      const forwardX = Math.max(0, rawForwardX);
      const power = forwardX + Math.max(0, upwardY) * 0.18;

      const movedOutOfBox = !pointInRect(wristScreen.x, wristScreen.y, loadBox);

      if (movedOutOfBox && forwardX > 52 && power > 55) {
        releasePoint = { x: wristScreen.x, y: wristScreen.y };
        currentPower = Math.min(280, power * 2);

        if (power < 70) lastThrowLabel = "SMOOTH RELEASE";
        else if (power < 95) lastThrowLabel = "STRONG RELEASE";
        else lastThrowLabel = "POWER THROW";

        formScores.release = Math.min(100, Math.round(power * 1.2));

        spawnCoachBurst(releasePoint.x, releasePoint.y, BX.orange, power);
        playRelease();

        phase = "FINISH";
        coachingText = "STEP 3: Finish across your body.";
        setStatus(coachingText);

        wristHistory = [];
      } else {
        setStatus("STEP 2: Throw forward.");
      }
      return;
    }

    if (phase === "FINISH" && wristHistory.length >= 4) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];

      const travel = Math.abs(last.x - first.x) + Math.abs(last.y - first.y);

      if (travel > 18) {
        finishPoint = { x: wristScreen.x, y: wristScreen.y };
        formScores.follow = Math.min(100, 40 + Math.round(travel * 1.8));
        finalizeThrow();
      } else {
        setStatus("STEP 3: Finish across your body.");
      }
    }
  } catch (err) {
    console.error(err);
    setStatus("Pose error: " + err.message);
  }
}

function finalizeThrow() {
  formScores.total = Math.round(
    formScores.load * 0.34 +
    formScores.release * 0.38 +
    formScores.follow * 0.28
  );

  sessionCount++;
  totalFormScore += formScores.total;

  let note = "";
  if (formScores.total >= 90) {
    note = "Excellent mechanics!";
    feedbackText = "EXCELLENT FORM";
    playGreat();
    spawnBigImpact(BX.yellow, currentPower);
  } else if (formScores.total >= 75) {
    note = "Strong throw. Nice mechanics.";
    feedbackText = "STRONG FORM";
    playGood();
    spawnBigImpact(BX.green, currentPower);
  } else if (formScores.follow < 55) {
    note = "Good start. Try a bigger follow-through.";
    feedbackText = "FOLLOW THROUGH MORE";
    playGood();
    spawnBigImpact(BX.orange, currentPower * 0.7);
  } else {
    note = "Try loading deeper behind your shoulder.";
    feedbackText = "LOAD DEEPER";
    playGood();
    spawnBigImpact(BX.blue, currentPower * 0.6);
  }

  feedbackTimer = 75;
  lastResult = {
    load: formScores.load,
    release: formScores.release,
    follow: formScores.follow,
    total: formScores.total,
    note
  };

  phase = "RESET";
  readyPoseArmed = false;
  readyPoseFrames = 0;
  readyLockout = true;
  wristHistory = [];
  throwCooldown = true;
  resultPauseTimer = 110;

  setStatus(note);

  setTimeout(() => {
    throwCooldown = false;
    phase = "LOAD";
    coachingText = "STEP 1: Load your arm in the blue box.";
    setStatus(coachingText);
  }, 1800);
}

/* UPDATE */
function updateGame() {
  if (resultPauseTimer > 0) resultPauseTimer--;

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

  if (feedbackTimer > 0) feedbackTimer--;
}

/* FX */
function spawnCoachBurst(x, y, color, power = 40) {
  const ringCount = 2 + Math.floor(power / 28);

  for (let i = 0; i < ringCount; i++) {
    rings.push({
      x,
      y,
      r: 10 + i * 12,
      grow: 4 + i * 0.7,
      alpha: 0.85 - i * 0.1,
      color
    });
  }

  addFlash(color, 0.12);

  const dotCount = 4 + Math.floor(power / 25);
  for (let i = 0; i < dotCount; i++) {
    trailDots.push({
      x,
      y,
      vx: Math.random() * 4 - 2,
      vy: Math.random() * 4 - 2,
      size: 5 + Math.random() * 5,
      alpha: 0.9,
      color
    });
  }
}

function spawnBigImpact(color, power) {
  const ringCount = 4 + Math.floor(power / 40);

  for (let i = 0; i < ringCount; i++) {
    rings.push({
      x: gameCanvas.width * 0.70,
      y: gameCanvas.height * 0.42,
      r: 20 + i * 22,
      grow: 6 + i,
      alpha: 0.75 - i * 0.08,
      color
    });
  }

  const accent = [BX.blue, BX.orange, BX.yellow, BX.green, BX.pink];
  for (let i = 0; i < 20; i++) {
    confetti.push({
      x: gameCanvas.width * 0.70,
      y: gameCanvas.height * 0.42,
      vx: Math.random() * 10 - 5,
      vy: Math.random() * -7 - 1,
      w: 6 + Math.random() * 8,
      h: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.35,
      alpha: 1,
      color: accent[Math.floor(Math.random() * accent.length)]
    });
  }

  addFlash(color, 0.24);
}

function addFlash(color, alpha = 0.25) {
  flashes.push({ color, alpha });
}

/* DRAW */
function drawGame() {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  drawBackground();
  drawMiniMap();
  drawCoachZones();
  drawHUD();
  drawScoreBars();
  drawRings();
  drawTrail();
  drawConfetti();
  drawFeedbackBanner();
  drawLastResultPanel();
}

function drawBackground() {
  const bg = gameCtx.createLinearGradient(0, 0, 0, gameCanvas.height);
  bg.addColorStop(0, "#1e3348");
  bg.addColorStop(0.34, "#24394e");
  bg.addColorStop(0.35, "#1b2b3c");
  bg.addColorStop(1, "#204a29");
  gameCtx.fillStyle = bg;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  // cage roof / dark bay
  roundedRect(gameCtx, 0, 95, gameCanvas.width, 250, 0, "rgba(8,18,29,0.42)", null);

  // vertical cage posts
  for (let i = 0; i < 8; i++) {
    const x = 120 + i * 160;
    roundedRect(gameCtx, x, 90, 8, 270, 4, "rgba(180,210,230,0.10)", null);
  }

  // netting lines
  gameCtx.strokeStyle = "rgba(220,240,255,0.05)";
  gameCtx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    gameCtx.beginPath();
    gameCtx.moveTo(0, 110 + i * 18);
    gameCtx.lineTo(gameCanvas.width, 110 + i * 18);
    gameCtx.stroke();
  }

  // BXCM accent wall band
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

  // turf
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
  // release lane
  roundedRect(
    gameCtx,
    980,
    190,
    210,
    300,
    28,
    "rgba(255,255,255,0.03)",
    "rgba(108,199,255,0.12)",
    2
  );

  // strike/finish coach zone integrated into bay
  roundedRect(
    gameCtx,
    strikeZone.x - 28,
    strikeZone.y - 34,
    strikeZone.w + 56,
    strikeZone.h + 68,
    26,
    "rgba(9,20,33,0.44)",
    "rgba(255,255,255,0.08)",
    2
  );

  const glow = gameCtx.createRadialGradient(
    mitt.x, mitt.y, 10,
    mitt.x, mitt.y, 120
  );
  glow.addColorStop(0, "rgba(241,201,76,0.18)");
  glow.addColorStop(1, "rgba(241,201,76,0)");
  gameCtx.fillStyle = glow;
  gameCtx.fillRect(mitt.x - 130, mitt.y - 130, 260, 260);

  // mitt
  gameCtx.fillStyle = "rgba(177,105,43,0.95)";
  gameCtx.beginPath();
  gameCtx.ellipse(mitt.x, mitt.y, 52, 68, 0, 0, Math.PI * 2);
  gameCtx.fill();

  gameCtx.fillStyle = "rgba(223,151,78,0.95)";
  gameCtx.beginPath();
  gameCtx.ellipse(mitt.x + 2, mitt.y + 2, 34, 46, 0, 0, Math.PI * 2);
  gameCtx.fill();

  roundedRect(gameCtx, strikeZone.x, strikeZone.y, strikeZone.w, strikeZone.h, 18, null, "rgba(255,255,255,0.95)", 5);
  roundedRect(gameCtx, strikeZone.x + 18, strikeZone.y + strikeZone.h / 2 - 20, strikeZone.w - 36, 40, 14, null, BX.yellow, 3);

  roundedRect(gameCtx, strikeZone.x - 2, strikeZone.y - 42, 150, 34, 14, "rgba(6,16,28,0.78)", null);
  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 16px Arial";
  gameCtx.fillText("COACH TARGET", strikeZone.x + 10, strikeZone.y - 19);
}

function drawHUD() {
  roundedRect(gameCtx, 36, 30, 300, 36, 18, "rgba(6,16,28,0.78)", "rgba(255,255,255,0.10)", 2);
  roundedRect(gameCtx, 38, 32, Math.min(currentPower, 296), 32, 16, currentPower > 180 ? BX.orange : BX.blue, null);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 15px Arial";
  gameCtx.fillText("MOTION ENERGY", 38, 22);

  roundedRect(gameCtx, 1040, 28, 260, 90, 22, "rgba(6,16,28,0.76)", "rgba(255,255,255,0.10)", 2);
  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 28px Arial";
  gameCtx.fillText(`Throws: ${sessionCount}`, 1065, 62);

  const avg = sessionCount > 0 ? Math.round(totalFormScore / sessionCount) : 0;
  gameCtx.fillText(`Avg Form: ${avg}`, 1065, 97);

  roundedRect(gameCtx, 430, 26, 500, 86, 24, "rgba(6,16,28,0.60)", "rgba(255,255,255,0.06)", 1);

  gameCtx.textAlign = "center";
  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 24px Arial";
  gameCtx.fillText("BXCM THROW LAB", gameCanvas.width / 2, 58);

  gameCtx.font = "bold 40px Arial";
  if (phase === "LOAD") gameCtx.fillStyle = BX.blue;
  else if (phase === "RELEASE") gameCtx.fillStyle = BX.orange;
  else if (phase === "FINISH") gameCtx.fillStyle = BX.green;
  else gameCtx.fillStyle = BX.yellow;

  gameCtx.fillText(phase, gameCanvas.width / 2, 96);
  gameCtx.textAlign = "start";
}

function drawScoreBars() {
  const panelX = 58;
  const panelY = 670;
  const panelW = 520;
  const rowH = 24;

  roundedRect(gameCtx, panelX, panelY, panelW, 110, 20, "rgba(6,16,28,0.72)", "rgba(255,255,255,0.10)", 2);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 18px Arial";
  gameCtx.fillText("FORM BREAKDOWN", panelX + 18, panelY + 26);

  drawBar(panelX + 18, panelY + 42, 150, rowH, "LOAD", formScores.load, BX.blue);
  drawBar(panelX + 18, panelY + 72, 150, rowH, "RELEASE", formScores.release, BX.orange);
  drawBar(panelX + 260, panelY + 42, 150, rowH, "FOLLOW", formScores.follow, BX.green);
  drawBar(panelX + 260, panelY + 72, 150, rowH, "TOTAL", formScores.total, BX.yellow);
}

function drawBar(x, y, w, h, label, value, color) {
  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 14px Arial";
  gameCtx.fillText(label, x, y - 6);

  roundedRect(gameCtx, x, y, w, h, 10, "rgba(255,255,255,0.08)", null);
  roundedRect(gameCtx, x + 2, y + 2, Math.max(0, (w - 4) * (value / 100)), h - 4, 8, color, null);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 13px Arial";
  gameCtx.fillText(String(Math.round(value)), x + w + 10, y + 17);
}

function drawMiniMap() {
  roundedRect(gameCtx, miniMap.x, miniMap.y, miniMap.w, miniMap.h, 18, "rgba(6,16,28,0.62)", "rgba(255,255,255,0.10)", 2);

  gameCtx.fillStyle = BX.blue;
  gameCtx.font = "bold 14px Arial";
  gameCtx.fillText("MOTION MAP", miniMap.x + 14, miniMap.y + 21);

  gameCtx.strokeStyle = "rgba(255,255,255,0.18)";
  gameCtx.beginPath();
  gameCtx.moveTo(miniMap.x + 32, miniMap.y + 68);
  gameCtx.lineTo(miniMap.x + 236, miniMap.y + 68);
  gameCtx.stroke();

  gameCtx.fillStyle = "#bd8149";
  gameCtx.beginPath();
  gameCtx.arc(miniMap.x + 32, miniMap.y + 68, 8, 0, Math.PI * 2);
  gameCtx.fill();

  roundedRect(gameCtx, miniMap.x + 228, miniMap.y + 45, 24, 46, 8, null, BX.white, 2);

  if (releasePoint) {
    gameCtx.fillStyle = BX.orange;
    gameCtx.beginPath();
    gameCtx.arc(miniMap.x + 120, miniMap.y + 68, 6, 0, Math.PI * 2);
    gameCtx.fill();
  }
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
  roundedRect(gameCtx, 1000, 540, 300, 210, 22, "rgba(6,16,28,0.76)", "rgba(255,255,255,0.10)", 2);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 22px Arial";
  gameCtx.fillText("LAST THROW", 1022, 572);

  gameCtx.font = "bold 18px Arial";
  gameCtx.fillStyle = BX.blue;
  gameCtx.fillText(`Load: ${lastResult.load || 0}`, 1022, 610);

  gameCtx.fillStyle = BX.orange;
  gameCtx.fillText(`Release: ${lastResult.release || 0}`, 1022, 640);

  gameCtx.fillStyle = BX.green;
  gameCtx.fillText(`Follow: ${lastResult.follow || 0}`, 1022, 670);

  gameCtx.fillStyle = BX.yellow;
  gameCtx.fillText(`Total: ${lastResult.total || 0}`, 1022, 702);

  gameCtx.fillStyle = BX.white;
  gameCtx.font = "bold 16px Arial";
  wrapText(lastResult.note || "Complete a throw to get coaching feedback.", 1022, 732, 250, 22);
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

function drawTrail() {
  trailDots.forEach((t) => {
    gameCtx.fillStyle = hexToRgba(t.color, t.alpha);
    gameCtx.beginPath();
    gameCtx.arc(t.x, t.y, t.size, 0, Math.PI * 2);
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

function drawCelebrationFlash() {
  flashes.forEach((f) => {
    gameCtx.fillStyle = hexToRgba(f.color, f.alpha * 0.20);
    gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  });
}

/* SILHOUETTE */
function drawSilhouette(keypoints) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (loadBox) {
    overlayCtx.fillStyle = phase === "LOAD"
      ? "rgba(70,170,255,0.18)"
      : "rgba(0,255,140,0.18)";
    overlayCtx.strokeStyle = phase === "LOAD"
      ? "rgba(70,170,255,0.95)"
      : "rgba(0,255,140,0.95)";
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

/* HELPERS */
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
