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
let smoothLeft = null;
let smoothRight = null;

// O MediaPipe Face Mesh fornece um landmark central específico para cada íris.
// Usá-lo é mais preciso do que calcular a média dos quatro pontos periféricos.
const LEFT_IRIS_CENTER = 473;
const RIGHT_IRIS_CENTER = 468;

// Cantos dos olhos: usados para criar uma régua/guia adaptativa ao tamanho
// real do rosto, em vez de uma régua com posição fixa.
const LEFT_EYE_CORNERS = [362, 263];
const RIGHT_EYE_CORNERS = [33, 133];

function point(landmarks, id) {
  const p = landmarks[id];
  return p ? { x: p.x, y: p.y } : null;
}

function averagePoint(landmarks, ids) {
  const pts = ids.map(i => point(landmarks, i)).filter(Boolean);
  if (!pts.length) return null;
  return pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), {x:0,y:0});
}

function distance(a,b) {
  return Math.hypot(a.x-b.x, a.y-b.y);
}

function smooth(current, previous, factor = 0.35) {
  if (!previous) return current;
  return {
    x: previous.x + (current.x - previous.x) * factor,
    y: previous.y + (current.y - previous.y) * factor
  };
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

function drawAdaptiveRuler(landmarks, left, right) {
  const leftCorners = averagePoint(landmarks, LEFT_EYE_CORNERS);
  const rightCorners = averagePoint(landmarks, RIGHT_EYE_CORNERS);
  if (!leftCorners || !rightCorners) return;

  // A régua acompanha automaticamente a largura dos olhos/rosto.
  // Os marcadores de medição continuam presos aos centros das íris.
  const y = (left.y + right.y) / 2;
  const eyeSpan = distance(leftCorners, rightCorners);
  const extension = eyeSpan * 0.16;

  const start = {
    x: Math.max(0, rightCorners.x - extension),
    y
  };
  const end = {
    x: Math.min(1, leftCorners.x + extension),
    y
  };

  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
  ctx.lineTo(end.x * canvas.width, end.y * canvas.height);
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Pequenas marcas verticais nas extremidades da régua.
  for (const p of [start, end]) {
    ctx.beginPath();
    ctx.moveTo(p.x * canvas.width, (p.y - 0.018) * canvas.height);
    ctx.lineTo(p.x * canvas.width, (p.y + 0.018) * canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
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

  // 468 = centro da íris direita; 473 = centro da íris esquerda.
  // Esses dois landmarks acompanham diretamente as pupilas/íris,
  // independentemente do tamanho do rosto na câmera.
  const rawRight = point(lm, RIGHT_IRIS_CENTER);
  const rawLeft = point(lm, LEFT_IRIS_CENTER);

  if (!rawLeft || !rawRight) {
    liveState.textContent = "Olhos não detectados";
    smoothLeft = null;
    smoothRight = null;
    return;
  }

  smoothLeft = smooth(rawLeft, smoothLeft);
  smoothRight = smooth(rawRight, smoothRight);

  drawAdaptiveRuler(lm, smoothLeft, smoothRight);
  drawPoint(smoothLeft, "#55d6ff");
  drawPoint(smoothRight, "#55d6ff");
  drawLine(smoothLeft, smoothRight);

  const px = distance(smoothLeft, smoothRight) * canvas.width;
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
  smoothLeft = null;
  smoothRight = null;
}

startBtn.addEventListener("click", start);
resetBtn.addEventListener("click", reset);
