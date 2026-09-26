const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const intro = document.getElementById("intro");
const viewer = document.getElementById("viewer");
const results = document.getElementById("results");
const instructions = document.getElementById("instructions");
const liveState = document.getElementById("liveState");
const odEl = document.getElementById("od");
const oeEl = document.getElementById("oe");
const dnpEl = document.getElementById("dnp");
const statusDot = document.getElementById("statusDot");

let camera = null;
let last = null;

const LEFT_IRIS = [474, 475, 476, 477];
const RIGHT_IRIS = [469, 470, 471, 472];

function averagePoint(landmarks, ids) {
  const pts = ids.map(i => landmarks[i]).filter(Boolean);
  if (!pts.length) return null;
  return pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), {x:0,y:0});
}

function center(landmarks, ids) {
  const p = averagePoint(landmarks, ids);
  if (!p) return null;
  return { x: p.x / ids.length, y: p.y / ids.length };
}

function distance(a,b) {
  return Math.hypot(a.x-b.x, a.y-b.y);
}

function drawPoint(p, color) {
  ctx.beginPath();
  ctx.arc(p.x * canvas.width, p.y * canvas.height, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x * canvas.width, p.y * canvas.height, 13, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawLine(a,b) {
  ctx.beginPath();
  ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
  ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
  ctx.strokeStyle = "#4db2ff";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function onResults(res) {
  canvas.width = video.videoWidth || 720;
  canvas.height = video.videoHeight || 960;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  if (!res.multiFaceLandmarks || !res.multiFaceLandmarks.length) {
    liveState.textContent = "Rosto não detectado";
    statusDot.classList.remove("active");
    odEl.textContent = "—";
    oeEl.textContent = "—";
    dnpEl.textContent = "—";
    return;
  }

  const lm = res.multiFaceLandmarks[0];
  const left = center(lm, LEFT_IRIS);
  const right = center(lm, RIGHT_IRIS);

  if (!left || !right) {
    liveState.textContent = "Olhos não detectados";
    return;
  }

  drawPoint(left, "#55d6ff");
  drawPoint(right, "#55d6ff");
  drawLine(left, right);

  const px = distance(left, right) * canvas.width;
  last = px;

  liveState.textContent = "Pupilas detectadas";
  statusDot.classList.add("active");

  // Nesta fase mostramos a distância na imagem em pixels.
  // A calibração milimétrica será implementada na próxima etapa.
  odEl.textContent = "OK";
  oeEl.textContent = "OK";
  dnpEl.textContent = Math.round(px) + " px";
}

const faceMesh = new FaceMesh({
  locateFile: file => "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/" + file
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

faceMesh.onResults(onResults);

async function start() {
  try {
    intro.classList.add("hidden");
    viewer.classList.remove("hidden");
    results.classList.remove("hidden");
    instructions.classList.remove("hidden");

    camera = new Camera(video, {
      onFrame: async () => await faceMesh.send({ image: video }),
      width: 720,
      height: 960
    });

    await camera.start();
    statusDot.classList.add("active");
  } catch (err) {
    console.error(err);
    liveState.textContent = "Não foi possível acessar a câmera.";
    alert("Permita o acesso à câmera e tente novamente.");
  }
}

function reset() {
  if (camera) camera.stop();
  video.srcObject = null;
  canvas.width = 1;
  canvas.height = 1;
  ctx.clearRect(0,0,1,1);
  results.classList.add("hidden");
  viewer.classList.add("hidden");
  instructions.classList.add("hidden");
  intro.classList.remove("hidden");
  statusDot.classList.remove("active");
  last = null;
}

startBtn.addEventListener("click", start);
resetBtn.addEventListener("click", reset);
