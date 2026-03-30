const video = document.getElementById("webcam");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const gameCanvas = document.getElementById("gameCanvas");
const gameCtx = gameCanvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("status");

let detector = null;
let started = false;
let wristHistory = [];
let ball = null;
let particles = [];
let throwCooldown = false;
let currentPower = 0;
let lastThrowLabel = "READY";
let strikeZone = {
  x: 690,
  y: 180,
  w: 60,
  h: 90
};

startBtn.onclick = async () => {
  try {
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
    overlay.height = video.videoHeight || 480;

    statusText.innerText = "Loading pose detector...";

    await tf.setBackend("webgl");
    await tf.ready();

    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
      }
    );

    statusText.innerText = "Ready. Hold your right hand up, then throw forward.";

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

async function loop() {
  requestAnimationFrame(loop);

  drawGame();
  updateGame();

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (!detector || video.readyState < 2) return;

  try {
    const poses = await detector.estimatePoses(video);

    if (!poses || poses.length === 0 || !poses[0].keypoints) {
      statusText.innerText = "No body detected. Step back a little.";
      return;
    }

    const keypoints = poses[0].keypoints;

    const rightWrist = findKeypoint(keypoints, "right_wrist");
    const rightShoulder = findKeypoint(keypoints, "right_shoulder");

    if (!rightWrist || !rightShoulder || rightWrist.score < 0.25 || rightShoulder.score < 0.25) {
      statusText.innerText = "Right arm not clear. Face camera and step back.";
      return;
    }

    // Wrist marker
    overlayCtx.beginPath();
    overlayCtx.arc(rightWrist.x, rightWrist.y, 10, 0, Math.PI * 2);
    overlayCtx.fillStyle = "yellow";
    overlayCtx.fill();

    // Shoulder marker
    overlayCtx.beginPath();
    overlayCtx.arc(rightShoulder.x, rightShoulder.y, 8, 0, Math.PI * 2);
    overlayCtx.fillStyle = "cyan";
    overlayCtx.fill();

    wristHistory.push({
      x: rightWrist.x,
      y: rightWrist.y,
      t: performance.now()
    });

    if (wristHistory.length > 8) wristHistory.shift();

    if (wristHistory.length >= 4 && !throwCooldown && !ball) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];

      const dx = last.x - first.x;
      const dy = first.y - last.y;
      const distanceFromShoulder = Math.abs(rightWrist.x - rightShoulder.x);

      const power = Math.abs(dx) + Math.abs(dy) * 0.35;

      if (distanceFromShoulder < 55) {
        statusText.innerText = "Ready position found. Throw forward now.";
      } else {
        statusText.innerText = "Bring hand near shoulder, then throw.";
      }

      // Throw trigger:
      // hand starts near shoulder, then moves strongly away
      if (distanceFromShoulder > 70 && power > 45) {
        throwBall(power);
        makeBurst(85, 305, 0.45);
        wristHistory = [];
        throwCooldown = true;
        statusText.innerText = "Throw detected!";

        setTimeout(() => {
          throwCooldown = false;
        }, 900);
      }
    }
  } catch (err) {
    console.error(err);
    statusText.innerText = "Pose error: " + err.message;
  }
}

function findKeypoint(keypoints, name) {
  return keypoints.find(k => k.name === name);
}

function throwBall(power) {
  const strength = Math.min(power, 180);

  currentPower = Math.min(200, strength);

  if (strength < 60) {
    lastThrowLabel = "SOFT TOSS";
  } else if (strength < 90) {
    lastThrowLabel = "FAST BALL";
  } else if (strength < 125) {
    lastThrowLabel = "POWER PITCH";
  } else {
    lastThrowLabel = "SUPER HEATER";
  }

  ball = {
    x: 85,
    y: 305,
    vx: 7 + strength * 0.11,
    vy: -8 - strength * 0.045,
    r: 10
  };
}

function updateGame() {
  if (ball) {
    ball.vy += 0.36;
    ball.x += ball.vx;
    ball.y += ball.vy;

    particles.push({
      x: ball.x,
      y: ball.y,
      vx: Math.random() * 1.8 - 0.9,
      vy: Math.random() * 1.8 - 0.9,
      size: 3 + Math.random() * 5,
      alpha: 1
    });

    if (ball.y > 345 || ball.x > gameCanvas.width - 20) {
      makeBurst(ball.x, Math.min(ball.y, 345), 1);
      ball = null;
    }
  }

  particles.forEach((p) => {
    p.x += p.vx || 0;
    p.y += p.vy || 0;
    p.size *= 0.96;
    p.alpha *= 0.95;
  });

  particles = particles.filter((p) => p.size > 0.8 && p.alpha > 0.05);
}

function makeBurst(x, y, scale) {
  const count = Math.floor(20 + scale * 30);

  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() * 8 - 4) * scale,
      vy: (Math.random() * 8 - 4) * scale,
      size: (4 + Math.random() * 8) * scale,
      alpha: 1
    });
  }
}

function drawGame() {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  // =======================
  // 1. BIG STADIUM BACKGROUND
  // =======================
  const sky = gameCtx.createLinearGradient(0, 0, 0, gameCanvas.height);
  sky.addColorStop(0, "#6ec6ff");
  sky.addColorStop(0.45, "#dff4ff");
  sky.addColorStop(0.46, "#4aa658");
  sky.addColorStop(1, "#26753a");

  gameCtx.fillStyle = sky;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  // stadium seating deck
  gameCtx.fillStyle = "#24384f";
  gameCtx.fillRect(0, 110, gameCanvas.width, 70);

  // crowd dots
  for (let i = 0; i < 120; i++) {
    gameCtx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.25})`;
    gameCtx.beginPath();
    gameCtx.arc(
      20 + i * 6,
      120 + Math.random() * 45,
      2 + Math.random() * 1.5,
      0,
      Math.PI * 2
    );
    gameCtx.fill();
  }

  // stadium lights
  for (let i = 0; i < 8; i++) {
    gameCtx.fillStyle = "rgba(255,255,180,0.85)";
    gameCtx.beginPath();
    gameCtx.arc(60 + i * 95, 45, 9, 0, Math.PI * 2);
    gameCtx.fill();
  }

  // back fence
  gameCtx.strokeStyle = "rgba(255,255,255,0.45)";
  gameCtx.lineWidth = 4;
  gameCtx.beginPath();
  gameCtx.moveTo(0, 280);
  gameCtx.lineTo(gameCanvas.width, 280);
  gameCtx.stroke();

  // grass stripes
  for (let i = 0; i < 8; i++) {
    gameCtx.fillStyle =
      i % 2 === 0
        ? "rgba(255,255,255,0.04)"
        : "rgba(0,0,0,0.04)";

    gameCtx.fillRect(0, 300 + i * 14, gameCanvas.width, 14);
  }

  // throw mound
  gameCtx.fillStyle = "#c98b52";
  gameCtx.beginPath();
  gameCtx.ellipse(85, 315, 30, 10, 0, 0, Math.PI * 2);
  gameCtx.fill();

  // =======================
  // 2. STRIKE ZONE TARGET
  // =======================
  gameCtx.strokeStyle = "white";
  gameCtx.lineWidth = 4;
  gameCtx.strokeRect(strikeZone.x, strikeZone.y, strikeZone.w, strikeZone.h);

  // inner target box
  gameCtx.strokeStyle = "rgba(255,215,0,0.9)";
  gameCtx.lineWidth = 2;
  gameCtx.strokeRect(
    strikeZone.x + 12,
    strikeZone.y + 18,
    strikeZone.w - 24,
    strikeZone.h - 36
  );

  // label
  gameCtx.fillStyle = "rgba(0,0,0,0.45)";
  gameCtx.fillRect(strikeZone.x - 10, strikeZone.y - 34, 110, 24);
  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 14px Arial";
  gameCtx.fillText("STRIKE ZONE", strikeZone.x, strikeZone.y - 16);

  // =======================
  // 3. SPEED / POWER METER
  // =======================
  gameCtx.fillStyle = "rgba(0,0,0,0.5)";
  gameCtx.fillRect(20, 20, 220, 24);

  let meterColor = "#4db8ff";
  if (currentPower > 50) meterColor = "#ffe066";
  if (currentPower > 90) meterColor = "#ff9f43";
  if (currentPower > 130) meterColor = "#ff4d4d";

  gameCtx.fillStyle = meterColor;
  gameCtx.fillRect(20, 20, Math.min(currentPower, 220), 24);

  gameCtx.strokeStyle = "white";
  gameCtx.lineWidth = 2;
  gameCtx.strokeRect(20, 20, 220, 24);

  gameCtx.fillStyle = "white";
  gameCtx.font = "bold 14px Arial";
  gameCtx.fillText("PITCH POWER", 20, 16);

  // =======================
  // 4. BIG THROW FEEDBACK TEXT
  // =======================
  gameCtx.font = "bold 38px Arial";
  gameCtx.textAlign = "center";

  if (lastThrowLabel === "SOFT TOSS") {
    gameCtx.fillStyle = "#d6f0ff";
  } else if (lastThrowLabel === "FAST BALL") {
    gameCtx.fillStyle = "#ffe066";
  } else if (lastThrowLabel === "POWER PITCH") {
    gameCtx.fillStyle = "#ff9f43";
  } else if (lastThrowLabel === "SUPER HEATER") {
    gameCtx.fillStyle = "#ff4d4d";
  } else {
    gameCtx.fillStyle = "white";
  }

  gameCtx.fillText(lastThrowLabel, gameCanvas.width / 2, 70);
  gameCtx.textAlign = "start";

  // =======================
  // 5. BALL
  // =======================
  if (ball) {
    gameCtx.beginPath();
    gameCtx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    gameCtx.fillStyle = "white";
    gameCtx.fill();

    gameCtx.strokeStyle = "#cc3333";
    gameCtx.lineWidth = 2;
    gameCtx.beginPath();
    gameCtx.arc(ball.x, ball.y, ball.r - 3, 0.5, 2.4);
    gameCtx.stroke();

    gameCtx.beginPath();
    gameCtx.arc(ball.x, ball.y, ball.r - 3, 3.6, 5.6);
    gameCtx.stroke();
  }

  // =======================
  // 6. PARTICLES
  // =======================
  particles.forEach((p) => {
    gameCtx.fillStyle = `rgba(255,165,0,${p.alpha})`;
    gameCtx.beginPath();
    gameCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    gameCtx.fill();
  });
}
