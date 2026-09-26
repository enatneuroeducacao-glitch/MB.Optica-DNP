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

function getViewSize() {
  const rect = viewer.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height)
  };
}

// MediaPipe entrega coordenadas relativas ao quadro original da câmera.
// Como o vídeo usa object-fit: cover, parte das laterais é recortada.
// Esta função converte corretamente a coordenada da câmera para a área visível.
function toViewPoint(p) {
  const sourceW = video.videoWidth || 1280;
  const sourceH = video.videoHeight || 720;
  const { width, height } = getViewSize();

  const scale = Math.max(width / sourceW, height / sourceH);
  const renderedW = sourceW * scale;
  const renderedH = sourceH * scale;
  const cropX = (renderedW - width) / 2;
  const cropY = (renderedH - height) / 2;

  return {
    x: p.x * renderedW - cropX,
    y: p.y * renderedH - cropY
  };
}

// Usa o centro do iris refinado do MediaPipe.
// Média dos 5 landmarks do iris reduz pequenos deslocamentos do landmark central.
function irisCenter(landmarks, ids) {
  return averagePoint(landmarks, ids);
}

const LEFT_IRIS_IDS = [473, 474, 475, 476, 477];
const RIGHT_IRIS_IDS = [468, 469, 470, 471, 472];

function drawPoint(p, color) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawLine(a,b, color = "#4db2ff", width = 3) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawNasion(p) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#4db2ff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawAdaptiveRuler(landmarks, left, right) {
  const leftCornersRaw = averagePoint(landmarks, LEFT_EYE_CORNERS);
  const rightCornersRaw = averagePoint(landmarks, RIGHT_EYE_CORNERS);
  if (!leftCornersRaw || !rightCornersRaw) return;

  const leftCorners = toViewPoint(leftCornersRaw);
  const rightCorners = toViewPoint(rightCornersRaw);

  const y = (left.y + right.y) / 2;
  const eyeSpan = distance(leftCorners, rightCorners);
  const extension = eyeSpan * 0.16;

  const start = { x: Math.max(0, rightCorners.x - extension), y };
  const end = { x: Math.min(canvas.width, leftCorners.x + extension), y };

  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  for (const p of [start, end]) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 12);
    ctx.lineTo(p.x, p.y + 12);
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function onResults(res) {
  const { width, height } = getViewSize();
  if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
  }
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
  const rawRight = irisCenter(lm, RIGHT_IRIS_IDS);
  const rawLeft = irisCenter(lm, LEFT_IRIS_IDS);
  const rawNasion = point(lm, NASION);

  if (!rawLeft || !rawRight || !rawNasion) {
    liveState.textContent = "Olhos não detectados";
    smoothLeft = null;
    smoothRight = null;
    return;
  }

  smoothLeft = smooth(rawLeft, smoothLeft);
  smoothRight = smooth(rawRight, smoothRight);

  // Converte os landmarks para a mesma área visual do vídeo.
  // Isso corrige o deslocamento causado pelo object-fit: cover.
  const leftView = toViewPoint(smoothLeft);
  const rightView = toViewPoint(smoothRight);
  const nasion = toViewPoint(rawNasion);

  drawAdaptiveRuler(lm, leftView, rightView);
  drawPoint(leftView, "#55d6ff");
  drawPoint(rightView, "#55d6ff");
  drawNasion(nasion);

  // Medição monocular provisória em pixels da área visível.
  const odPx = distance(rightView, nasion);
  const oePx = distance(leftView, nasion);
  const totalPx = odPx + oePx;
  last = totalPx;

  drawLine(rightView, nasion, "rgba(85,214,255,.75)", 2);
  drawLine(nasion, leftView, "rgba(85,214,255,.75)", 2);

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
