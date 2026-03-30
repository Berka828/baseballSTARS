const video = document.getElementById("webcam");
const statusText = document.getElementById("status");
const startBtn = document.getElementById("startBtn");

startBtn.onclick = async () => {
  try {
    statusText.innerText = "Requesting camera...";

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    statusText.innerText = "Camera is working.";
  } catch (err) {
    console.error(err);
    statusText.innerText = "Camera failed: " + err.message;
    alert("Camera failed: " + err.message);
  }
};
