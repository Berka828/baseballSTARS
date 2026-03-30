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

    statusText.innerText = "Ready. Stand back so your upper body is visible.";

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

    overlayCtx.beginPath();
    overlayCtx.arc(rightWrist.x, rightWrist.y, 10, 0, Math.PI * 2);
    overlayCtx.fillStyle = "yellow";
    overlayCtx.fill();

    statusText.innerText = "Body detected. Move your right arm forward.";

    wristHistory.push({
      x: rightWrist.x,
      y: rightWrist.y,
      t: performance.now()
    });

    if (wristHistory.length > 6) wristHistory.shift();

    if (wristHistory.length >= 2) {
      const first = wristHistory[0];
      const last = wristHistory[wristHistory.length - 1];

      const dx = last.x - first.x;
      const dy = first.y - last.y;
      const shoulderDistance = Math.abs(rightWrist.x - rightShoulder.x);

      const power = Math.abs(dx) + Math.abs(dy) * 0.5;

      if (power > 35 && shoulderDistance > 20 && !ball) {
        throwBall(power);
        wristHistory = [];
        statusText.innerText = "Throw detected!";
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
  ball = {
    x: 60,
    y: 300,
    vx: 8 + power * 0.18,
    vy: -8 - power * 0.05
  };
}

function updateGame() {
  if (ball) {
    ball.vy += 0.4;
    ball.x += ball.vx;
    ball.y += ball.vy;

    particles.push({
      x: ball.x,
      y: ball.y,
      vx: Math.random() * 2 - 1,
      vy: Math.random() * 2 - 1,
      size: 4 + Math.random() * 6
    });

    if (ball.y > 350 || ball.x > gameCanvas.width - 20) {
      explode(ball.x, Math.min(ball.y, 350));
      ball = null;
    }
  }

  particles.forEach((p) => {
    p.x += p.vx || 0;
    p.y += p.vy || 0;
    p.size *= 0.95;
  });

  particles = particles.filter((p) => p.size > 1);
}

function explode(x, y) {
  for (let i = 0; i < 35; i++) {
    particles.push({
      x,
      y,
      vx: Math.random() * 8 - 4,
      vy: Math.random() * 8 - 4,
      size: 5 + Math.random() * 10
    });
  }
}

function drawGame() {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  if (ball) {
    gameCtx.beginPath();
    gameCtx.arc(ball.x, ball.y, 10, 0, Math.PI * 2);
    gameCtx.fillStyle = "white";
    gameCtx.fill();
  }

  particles.forEach((p) => {
    gameCtx.beginPath();
    gameCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    gameCtx.fillStyle = "orange";
    gameCtx.fill();
  });
}
