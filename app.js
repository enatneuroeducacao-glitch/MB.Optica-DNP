const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const frontBtn = document.getElementById("frontBtn");
const rearBtn = document.getElementById("rearBtn");
const cameraControls = document.getElementById("cameraControls");
const cameraStatus = document.getElementById("cameraStatus");
const intro = document.getElementById("intro");
const viewer = document.getElementById("viewer");
const results = document.getElementById("results");
const instructions = document.getElementById("instructions");
const liveState = document.getElementById("liveState");
const odEl = document.getElementById("od");
const oeEl = document.getElementById("oe");
const dnpEl = document.getElementById("dnp");
const statusDot = document.getElementById("statusDot");

let stream = null;
let running = false;
let cameraFacing = "user";
let last = null;
let smoothLeft = null;
let smoothRight = null;

const LEFT_IRIS_CENTER = 473;
const RIGHT_IRIS_CENTER = 468;
const LEFT_EYE_CORNERS = [362, 263];
const RIGHT_EYE_CORNERS = [33, 133];

// Referência central do nariz/násion para separar a DNP monocular.
// Nesta fase o resultado é exibido em pixels; a calibração para mm virá depois.
const NASION = 168;

function point(landmarks, id) {
  const p = landmarks[id];
  return p ? { x: p.x, y: p.y } : null;
}

function averagePoint(landmarks, ids) {
  const pts = ids.map(i => point(landmarks, i)).filter(Boolean);
  if (!pts.length) return null;
  const sum = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), {x:0,y:0});
  return { x: sum.x / pts.length, y: sum.y / pts.length };
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

function drawLine(a,b, color = "#4db2ff", width = 3) {
  ctx.beginPath();
  ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
  ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawNasion(p) {
  ctx.beginPath();
  ctx.arc(p.x * canvas.width, p.y * canvas.height, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#4db2ff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawAdaptiveRuler(landmarks, left, right) {
  const leftCorners = averagePoint(landmarks, LEFT_EYE_CORNERS);
  const rightCorners = averagePoint(landmarks, RIGHT_EYE_CORNERS);
  if (!leftCorners || !rightCorners) return;

  const y = (left.y + right.y) / 2;
  const eyeSpan = distance(leftCorners, rightCorners);
  const extension = eyeSpan * 0.16;

  const start = { x: Math.max(0, rightCorners.x - extension), y };
  const end = { x: Math.min(1, leftCorners.x + extension), y };

  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
  ctx.lineTo(end.x * canvas.width, end.y * canvas.height);
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

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
  const rawRight = point(lm, RIGHT_IRIS_CENTER);
  const rawLeft = point(lm, LEFT_IRIS_CENTER);
  const rawNasion = point(lm, NASION);

  if (!rawLeft || !rawRight || !rawNasion) {
    liveState.textContent = "Olhos não detectados";
    smoothLeft = null;
    smoothRight = null;
    return;
  }

  smoothLeft = smooth(rawLeft, smoothLeft);
  smoothRight = smooth(rawRight, smoothRight);
  const nasion = rawNasion;

  drawAdaptiveRuler(lm, smoothLeft, smoothRight);
  drawPoint(smoothLeft, "#55d6ff");
  drawPoint(smoothRight, "#55d6ff");
  drawNasion(nasion);

  // Medição monocular provisória: cada pupila até a referência central do nariz.
  // A soma das duas medidas corresponde à DNP binocular provisória.
  const odPx = distance(smoothRight, nasion) * canvas.width;
  const oePx = distance(smoothLeft, nasion) * canvas.width;
  const totalPx = odPx + oePx;
  last = totalPx;

  drawLine(smoothRight, nasion, "rgba(85,214,255,.75)", 2);
  drawLine(nasion, smoothLeft, "rgba(85,214,255,.75)", 2);

  liveState.textContent = "Pupilas detectadas";
  statusDot.classList.add("active");
  odEl.textContent = Math.round(odPx) + " px";
  oeEl.textContent = Math.round(oePx) + " px";
  dnpEl.textContent = Math.round(totalPx) + " px";
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

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Este navegador não disponibiliza acesso à câmera.");
  }

  stopCamera();

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: cameraFacing },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    // Alguns aparelhos não aceitam facingMode ideal; tenta uma configuração simples.
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }

  video.srcObject = stream;
  await video.play();

  cameraStatus.textContent =
    cameraFacing === "user" ? "Câmera frontal selecionada" : "Câmera traseira selecionada";

  statusDot.classList.add("active");
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  video.srcObject = null;
}

async function processFrame() {
  if (!running) return;
  if (video.readyState >= 2) {
    try {
      await faceMesh.send({ image: video });
    } catch (err) {
      console.error("Erro no processamento da câmera:", err);
    }
  }
  requestAnimationFrame(processFrame);
}

async function selectCamera(facing) {
  cameraFacing = facing;
  frontBtn.classList.toggle("active", facing === "user");
  rearBtn.classList.toggle("active", facing === "environment");

  if (!stream) {
    cameraStatus.textContent =
      facing === "user" ? "Câmera frontal selecionada" : "Câmera traseira selecionada";
    return;
  }

  liveState.textContent = "Trocando câmera…";

  try {
    await openCamera();
    liveState.textContent = "Câmera ativa — centralize o rosto";
  } catch (err) {
    console.error(err);
    liveState.textContent = "Não foi possível abrir esta câmera.";
    alert("Não foi possível acessar a câmera selecionada. Verifique as permissões do navegador.");
  }
}

async function start() {
  try {
    intro.classList.add("hidden");
    viewer.classList.remove("hidden");
    results.classList.remove("hidden");
    instructions.classList.remove("hidden");
    cameraControls.classList.remove("hidden");

    await openCamera();

    running = true;
    processFrame();
    liveState.textContent = "Câmera ativa — centralize o rosto";
  } catch (err) {
    console.error(err);
    running = false;
    liveState.textContent = "Não foi possível acessar a câmera.";
    alert("Permita o acesso à câmera no navegador. Se já permitiu, recarregue a página e tente novamente.");
  }
}

function reset() {
  running = false;
  stopCamera();
  canvas.width = 1;
  canvas.height = 1;
  ctx.clearRect(0,0,1,1);
  results.classList.add("hidden");
  viewer.classList.add("hidden");
  cameraControls.classList.add("hidden");
  instructions.classList.add("hidden");
  intro.classList.remove("hidden");
  statusDot.classList.remove("active");
  last = null;
  smoothLeft = null;
  smoothRight = null;
}

frontBtn.addEventListener("click", () => selectCamera("user"));
rearBtn.addEventListener("click", () => selectCamera("environment"));
startBtn.addEventListener("click", start);
resetBtn.addEventListener("click", reset);
