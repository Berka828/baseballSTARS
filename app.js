import {
  PoseLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs";

const video = document.getElementById("webcam");
const statusText = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");

let poseLandmarker = null;
let started = false;

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

    statusText.innerText = "Loading pose tracker...";

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
    );

    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
      },
      runningMode: "VIDEO",
      numPoses: 1
    });

    statusText.innerText = "Pose ready. Stand where your upper body is visible.";

    if (!started) {
      started = true;
      requestAnimationFrame(loop);
    }
  } catch (err) {
    console.error(err);
    statusText.innerText = "Error: " + err.message;
  }
};

function loop(time) {
  requestAnimationFrame(loop);

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (!poseLandmarker || video.readyState < 2) return;

  const result = poseLandmarker.detectForVideo(video, time);

  if (!result.landmarks || result.landmarks.length === 0) {
    statusText.innerText = "No body detected. Step back a little.";
    return;
  }

  statusText.innerText = "Body detected.";

  const lm = result.landmarks[0];
  const rightWrist = lm[16];

  const x = rightWrist.x * overlay.width;
  const y = rightWrist.y * overlay.height;

  overlayCtx.beginPath();
  overlayCtx.arc(x, y, 10, 0, Math.PI * 2);
  overlayCtx.fillStyle = "yellow";
  overlayCtx.fill();
}
