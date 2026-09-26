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

// Diagnóstico: usamos o landmark CENTRAL da íris fornecido pelo MediaPipe.
// 468 = centro da íris do olho direito.
// 473 = centro da íris do olho esquerdo.
// Os demais landmarks do anel servem apenas para desenhar a geometria da íris.
const LEFT_IRIS_CENTER_ID = 473;
const RIGHT_IRIS_CENTER_ID = 468;
const LEFT_IRIS_RING_IDS = [474, 475, 476, 477];
const RIGHT_IRIS_RING_IDS = [469, 470, 471, 472];

// Contornos aproximados das pálpebras para conferência visual.
const RIGHT_EYE_CONTOUR = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const LEFT_EYE_CONTOUR = [362, 382, 381, 380, 374, 373, 390, 249, 263];

function drawPoint(p, color) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawIris(landmarks, centerId, ringIds) {
  const centerRaw = point(landmarks, centerId);
  const ringRaw = ringIds.map(id => point(landmarks, id)).filter(Boolean);
  if (!centerRaw || ringRaw.length < 3) return null;

  const center = toViewPoint(centerRaw);
  const ring = ringRaw.map(toViewPoint);

  const radius = ring.reduce((sum, p) => sum + distance(center, p), 0) / ring.length;

  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(85,214,255,.95)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Pequena cruz no centro exato do landmark 468/473.
  ctx.beginPath();
  ctx.moveTo(center.x - 9, center.y);
  ctx.lineTo(center.x + 9, center.y);
  ctx.moveTo(center.x, center.y - 9);
  ctx.lineTo(center.x, center.y + 9);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  drawPoint(center, "#55d6ff");
  return center;
}

function drawEyeContour(landmarks, ids) {
  const pts = ids.map(id => point(landmarks, id)).filter(Boolean).map(toViewPoint);
  if (pts.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = "rgba(255,255,255,.65)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawNasion(p) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#ffcc66";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawLabel(text, p, offsetX = 8, offsetY = -10) {
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.95)";
  ctx.strokeStyle = "rgba(0,0,0,.65)";
  ctx.lineWidth = 3;
  ctx.strokeText(text, p.x + offsetX, p.y + offsetY);
  ctx.fillText(text, p.x + offsetX, p.y + offsetY);
}

function drawLine(a,b, color = "#4db2ff", width = 2) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!res.multiFaceLandmarks || !res.multiFaceLandmarks.length) {
    liveState.textContent = "Rosto não detectado";
    statusDot.classList.remove("active");
    odEl.textContent = "—";
    oeEl.textContent = "—";
    dnpEl.textContent = "—";
    return;
  }

  const lm = res.multiFaceLandmarks[0];

  // Desenha os contornos primeiro para que os marcadores fiquem por cima.
  drawEyeContour(lm, RIGHT_EYE_CONTOUR);
  drawEyeContour(lm, LEFT_EYE_CONTOUR);

  const rightView = drawIris(lm, RIGHT_IRIS_CENTER_ID, RIGHT_IRIS_RING_IDS);
  const leftView = drawIris(lm, LEFT_IRIS_CENTER_ID, LEFT_IRIS_RING_IDS);
  const rawNasion = point(lm, NASION);

  if (!rightView || !leftView || !rawNasion) {
    liveState.textContent = "Olhos não detectados";
    smoothLeft = null;
    smoothRight = null;
    odEl.textContent = "—";
    oeEl.textContent = "—";
    dnpEl.textContent = "—";
    return;
  }

  const nasion = toViewPoint(rawNasion);

  // Sem cálculo de DNP nesta fase: o objetivo é validar visualmente
  // se os centros 468/473 coincidem com as pupilas.
  drawNasion(nasion);
  drawLabel("OD", rightView, 10, -10);
  drawLabel("OE", leftView, 10, -10);

  liveState.textContent = "Diagnóstico ocular — verifique os centros";
  statusDot.classList.add("active");

  odEl.textContent = "✓";
  oeEl.textContent = "✓";
  dnpEl.textContent = "—";
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
