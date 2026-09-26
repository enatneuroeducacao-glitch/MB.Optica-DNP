const $ = id => document.getElementById(id);

const video = $("video");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");

const startBtn = $("startBtn");
const frontBtn = $("frontBtn");
const rearBtn = $("rearBtn");
const statusDot = $("statusDot");
const workspace = $("workspace");
const intro = $("intro");
const viewer = $("viewer");
const calibrationOverlay = $("calibrationOverlay");
const calibrationPanel = $("calibrationPanel");
const measurementPanel = $("measurementPanel");
const osPanel = $("osPanel");
const savedPanel = $("savedPanel");
const settingsPanel = $("settingsPanel");

const handleA = $("handleA");
const handleB = $("handleB");
const calibrationLine = document.querySelector(".calibration-line");
const referenceMmEl = $("referenceMm");
const scaleValue = $("scaleValue");
const calibrationState = $("calibrationState");
const calibrationValidation = $("calibrationValidation");

const measurementState = $("measurementState");
const faceState = $("faceState");
const stabilityState = $("stabilityState");
const alignmentState = $("alignmentState");
const readingCount = $("readingCount");
const readingNote = $("readingNote");
const odEl = $("od");
const oeEl = $("oe");
const dnpEl = $("dnp");
const useReadingBtn = $("useReadingBtn");

const customerName = $("customerName");
const customerPhone = $("customerPhone");
const customerCpf = $("customerCpf");
const saleNumber = $("saleNumber");
const customerType = $("customerType");
const customerNotes = $("customerNotes");
const osNumber = $("osNumber");
const osDnp = $("osDnp");
const osMono = $("osMono");
const osValidation = $("osValidation");

let stream = null;
let running = false;
let cameraFacing = "user";
let animationFrame = null;

let calibration = null;
let calibrationPoints = { a: {x:0,y:0}, b: {x:0,y:0} };
let dragHandle = null;

let samples = [];
let stableReading = null;
const STABLE_FRAMES = 24;

let currentOs = null;
let savedRecord = null;

const RIGHT_IRIS_CENTER_ID = 468;
const LEFT_IRIS_CENTER_ID = 473;
const RIGHT_IRIS_RING_IDS = [469,470,471,472];
const LEFT_IRIS_RING_IDS = [474,475,476,477];
const RIGHT_EYE_CONTOUR = [33,7,163,144,145,153,154,155,133];
const LEFT_EYE_CONTOUR = [362,382,381,380,374,373,390,249,263];

function point(lm,id){
  const p=lm[id];
  return p ? {x:p.x,y:p.y} : null;
}
function distance(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function median(values){
  if(!values.length)return 0;
  const s=[...values].sort((a,b)=>a-b);
  const m=Math.floor(s.length/2);
  return s.length%2?s[m]:(s[m-1]+s[m])/2;
}
function mean(values){ return values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0; }
function std(values){
  if(values.length<2)return 0;
  const m=mean(values);
  return Math.sqrt(mean(values.map(v=>(v-m)**2)));
}
function getViewSize(){
  const r=viewer.getBoundingClientRect();
  return {width:Math.max(1,r.width),height:Math.max(1,r.height)};
}
function toViewPoint(p){
  const sourceW=video.videoWidth||1280;
  const sourceH=video.videoHeight||720;
  const size=getViewSize();
  const scale=Math.max(size.width/sourceW,size.height/sourceH);
  const renderedW=sourceW*scale;
  const renderedH=sourceH*scale;
  const cropX=(renderedW-size.width)/2;
  const cropY=(renderedH-size.height)/2;
  return {x:p.x*renderedW-cropX,y:p.y*renderedH-cropY};
}
function setStep(n){
  document.querySelectorAll(".step").forEach(el=>{
    const s=Number(el.dataset.step);
    el.classList.toggle("active",s===n);
    el.classList.toggle("done",s<n);
  });
}
function resetCalibrationHandles(){
  const size=getViewSize();
  calibrationPoints.a={x:size.width*.22,y:size.height*.5};
  calibrationPoints.b={x:size.width*.78,y:size.height*.5};
  renderCalibrationHandles();
}
function renderCalibrationHandles(){
  const a=calibrationPoints.a,b=calibrationPoints.b;
  handleA.style.left=(a.x-14)+"px";
  handleA.style.top=(a.y-14)+"px";
  handleB.style.left=(b.x-14)+"px";
  handleB.style.top=(b.y-14)+"px";
  calibrationLine.style.left=Math.min(a.x,b.x)+"px";
  calibrationLine.style.width=Math.abs(b.x-a.x)+"px";
  calibrationLine.style.right="auto";
  calibrationLine.style.top=((a.y+b.y)/2)+"px";
  calibrationLine.style.transform="rotate("+Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI+"deg)";
  calibrationLine.style.transformOrigin="left center";
  const px=distance(a,b);
  const mm=Number(referenceMmEl.value)||0;
  scaleValue.textContent=mm>0&&px>0?(px.toFixed(0)+" px / "+mm.toFixed(1)+" mm"):"—";
}
function pointerPosition(e){
  const r=viewer.getBoundingClientRect();
  return {
    x:Math.max(12,Math.min(r.width-12,e.clientX-r.left)),
    y:Math.max(12,Math.min(r.height-12,e.clientY-r.top))
  };
}
function startDrag(handle,e){
  e.preventDefault();
  dragHandle=handle;
  handle==="a" ? handleA.setPointerCapture?.(e.pointerId) : handleB.setPointerCapture?.(e.pointerId);
}
function moveDrag(e){
  if(!dragHandle)return;
  const p=pointerPosition(e);
  calibrationPoints[dragHandle]=p;
  renderCalibrationHandles();
}
function endDrag(){ dragHandle=null; }

handleA.addEventListener("pointerdown",e=>startDrag("a",e));
handleB.addEventListener("pointerdown",e=>startDrag("b",e));
window.addEventListener("pointermove",moveDrag);
window.addEventListener("pointerup",endDrag);
window.addEventListener("resize",()=>{if(!workspace.classList.contains("hidden"))renderCalibrationHandles()});
referenceMmEl.addEventListener("input",renderCalibrationHandles);

$("repositionBtn").addEventListener("click",()=>{
  resetCalibrationHandles();
  calibrationValidation.textContent="Pontos reiniciados. Alinhe-os às extremidades da referência.";
  calibrationValidation.className="validation";
});

function setCalibrationFromHandles(){
  const mm=Number(referenceMmEl.value);
  const px=distance(calibrationPoints.a,calibrationPoints.b);

  if(!Number.isFinite(mm)||mm<10||mm>300){
    calibrationValidation.textContent="Informe uma dimensão física válida entre 10 e 300 mm.";
    calibrationValidation.className="validation error";
    return false;
  }
  if(px<80){
    calibrationValidation.textContent="A distância entre os pontos está pequena. Posicione os marcadores nas extremidades da referência.";
    calibrationValidation.className="validation warn";
    return false;
  }

  const pxPerMm=px/mm;
  calibration={
    pxPerMm:pxPerMm,
    referenceMm:mm,
    timestamp:new Date().toISOString(),
    cameraFacing:cameraFacing,
    viewport:getViewSize()
  };

  localStorage.setItem("mbDnpCalibration",JSON.stringify(calibration));
  localStorage.setItem("mbDnpCalibrationLabel",new Date().toLocaleString("pt-BR"));
  calibrationState.textContent="Calibrado";
  calibrationState.className="pill green";
  calibrationValidation.textContent="Calibração registrada: "+pxPerMm.toFixed(2)+" px/mm. Mantenha a câmera e a distância estáveis.";
  calibrationValidation.className="validation ok";
  scaleValue.textContent=pxPerMm.toFixed(2)+" px/mm";

  measurementPanel.classList.remove("hidden");
  calibrationOverlay.classList.add("hidden");
  setStep(3);
  resetSamples();
  return true;
}
$("confirmCalibrationBtn").addEventListener("click",setCalibrationFromHandles);

function loadLocalCalibration(){
  try{
    const saved=JSON.parse(localStorage.getItem("mbDnpCalibration")||"null");
    if(saved && saved.pxPerMm && saved.cameraFacing===cameraFacing){
      calibration=saved;
      calibrationState.textContent="Calibrado";
      calibrationState.className="pill green";
      calibrationValidation.textContent="Última calibração local: "+Number(saved.pxPerMm).toFixed(2)+" px/mm.";
      calibrationValidation.className="validation ok";
      scaleValue.textContent=Number(saved.pxPerMm).toFixed(2)+" px/mm";
    }
  }catch(e){console.warn(e);}
}
function invalidateCalibration(reason){
  calibration=null;
  calibrationState.textContent="Não calibrado";
  calibrationState.className="pill amber";
  calibrationValidation.textContent=reason||"Faça uma nova calibração.";
  calibrationValidation.className="validation warn";
  scaleValue.textContent="—";
  measurementPanel.classList.add("hidden");
  calibrationOverlay.classList.remove("hidden");
  setStep(2);
  resetSamples();
  resetCalibrationHandles();
}

function drawPoint(p,color){
  ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fillStyle=color||"#55d6ff";ctx.fill();
  ctx.beginPath();ctx.arc(p.x,p.y,11,0,Math.PI*2);ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();
}
function drawIris(lm,centerId,ringIds){
  const cRaw=point(lm,centerId);
  const ring=ringIds.map(id=>point(lm,id)).filter(Boolean);
  if(!cRaw||ring.length<3)return null;
  const c=toViewPoint(cRaw);
  const ringView=ring.map(toViewPoint);
  const r=median(ringView.map(p=>distance(c,p)));
  ctx.beginPath();ctx.arc(c.x,c.y,r,0,Math.PI*2);
  ctx.strokeStyle="rgba(85,214,255,.95)";ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.moveTo(c.x-9,c.y);ctx.lineTo(c.x+9,c.y);ctx.moveTo(c.x,c.y-9);ctx.lineTo(c.x,c.y+9);
  ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();
  drawPoint(c,"#55d6ff");
  return c;
}
function drawContour(lm,ids){
  const pts=ids.map(id=>point(lm,id)).filter(Boolean).map(toViewPoint);
  if(pts.length<2)return;
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.strokeStyle="rgba(255,255,255,.55)";ctx.lineWidth=1.2;ctx.stroke();
}
function drawLabel(text,p){
  ctx.font="800 11px system-ui,sans-serif";
  ctx.fillStyle="#fff";ctx.strokeStyle="rgba(0,0,0,.72)";ctx.lineWidth=3;
  ctx.strokeText(text,p.x+9,p.y-10);ctx.fillText(text,p.x+9,p.y-10);
}
function getFacialReference(lm,right,left){
  const bridge=point(lm,168);
  const nose=point(lm,1);
  if(!bridge||!nose)return null;
  return {x:(bridge.x+nose.x)/2,y:(right.y+left.y)/2};
}
function alignmentInfo(right,left){
  const dy=left.y-right.y;
  const dx=Math.max(.001,Math.abs(left.x-right.x));
  const roll=Math.atan2(dy,dx)*180/Math.PI;
  return {roll:roll,good:Math.abs(roll)<=5.5};
}
function addSample(lm,right,left,ref){
  if(!calibration)return;
  const rv=toViewPoint(right);
  const lv=toViewPoint(left);
  const refv=toViewPoint(ref);
  const odMm=Math.abs(rv.x-refv.x)/calibration.pxPerMm;
  const oeMm=Math.abs(lv.x-refv.x)/calibration.pxPerMm;
  const dnpMm=odMm+oeMm;
  if(![odMm,oeMm,dnpMm].every(Number.isFinite))return;

  samples.push({odMm:odMm,oeMm:oeMm,dnpMm:dnpMm});
  if(samples.length>STABLE_FRAMES)samples.shift();
  readingCount.textContent=samples.length+"/"+STABLE_FRAMES+" frames";

  if(samples.length<STABLE_FRAMES){
    const pct=Math.round(samples.length/STABLE_FRAMES*100);
    measurementState.textContent="Estabilizando";
    measurementState.className="pill";
    stabilityState.textContent=pct+"%";
    readingNote.textContent="Mantenha o rosto imóvel";
    useReadingBtn.disabled=true;
    return;
  }

  const od=median(samples.map(s=>s.odMm));
  const oe=median(samples.map(s=>s.oeMm));
  const dnp=od+oe;
  const stability=Math.max(std(samples.map(s=>s.odMm)),std(samples.map(s=>s.oeMm)));

  stableReading={
    odMm:od,oeMm:oe,dnpMm:dnp,sdMm:stability,
    timestamp:new Date().toISOString(),
    calibration:Object.assign({},calibration)
  };

  odEl.textContent=od.toFixed(1)+" mm";
  oeEl.textContent=oe.toFixed(1)+" mm";
  dnpEl.textContent=dnp.toFixed(1)+" mm";

  const stable=stability<=.65;
  const acceptable=stability<=1.25;
  stabilityState.textContent=stable?"Excelente":acceptable?"Boa":"Instável";
  alignmentState.textContent="Alinhado";
  measurementState.textContent=stable?"Leitura pronta":"Leitura estável";
  measurementState.className=stable?"pill green":"pill";
  readingNote.textContent=stable?"Variação baixa entre os frames":"Repita se desejar maior estabilidade";
  useReadingBtn.disabled=!acceptable;
}
function onResults(res){
  const size=getViewSize();
  if(canvas.width!==Math.round(size.width)||canvas.height!==Math.round(size.height)){
    canvas.width=Math.round(size.width);canvas.height=Math.round(size.height);
  }
  ctx.clearRect(0,0,canvas.width,canvas.height);

  if(!res.multiFaceLandmarks||!res.multiFaceLandmarks.length){
    faceState.textContent="Não detectado";
    alignmentState.textContent="—";
    statusDot.classList.remove("active");
    measurementState.textContent=calibration?"Aguardando":"Calibre primeiro";
    readingNote.textContent="Centralize o rosto dentro da área";
    return;
  }

  const lm=res.multiFaceLandmarks[0];
  const right=point(lm,RIGHT_IRIS_CENTER_ID);
  const left=point(lm,LEFT_IRIS_CENTER_ID);
  if(!right||!left){
    faceState.textContent="Olhos não detectados";
    return;
  }

  drawContour(lm,RIGHT_EYE_CONTOUR);
  drawContour(lm,LEFT_EYE_CONTOUR);
  const rightView=drawIris(lm,RIGHT_IRIS_CENTER_ID,RIGHT_IRIS_RING_IDS);
  const leftView=drawIris(lm,LEFT_IRIS_CENTER_ID,LEFT_IRIS_RING_IDS);
  if(!rightView||!leftView)return;

  const align=alignmentInfo(right,left);
  const ref=getFacialReference(lm,right,left);
  if(!ref)return;
  const refView=toViewPoint(ref);

  ctx.beginPath();ctx.moveTo(refView.x,refView.y-15);ctx.lineTo(refView.x,refView.y+15);
  ctx.strokeStyle="rgba(255,204,102,.95)";ctx.lineWidth=2;ctx.stroke();
  drawLabel("OD",rightView);drawLabel("OE",leftView);

  if(calibration){
    ctx.beginPath();ctx.moveTo(rightView.x,rightView.y);ctx.lineTo(refView.x,refView.y);ctx.lineTo(leftView.x,leftView.y);
    ctx.strokeStyle="rgba(85,214,255,.58)";ctx.lineWidth=1.5;ctx.stroke();
  }

  faceState.textContent="Detectado";
  alignmentState.textContent=align.good?"Alinhado":"Ajustar ("+align.roll.toFixed(1)+"°)";
  statusDot.classList.add("active");

  if(calibration&&align.good){
    addSample(lm,right,left,ref);
  }else if(!calibration){
    measurementState.textContent="Calibre primeiro";
    readingNote.textContent="Conclua a calibração física";
  }else{
    measurementState.textContent="Ajuste a cabeça";
    readingNote.textContent="Mantenha os olhos no mesmo nível";
  }
}

const faceMesh=new FaceMesh({
  locateFile:file=>"https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/"+file
});
faceMesh.setOptions({
  maxNumFaces:1,
  refineLandmarks:true,
  minDetectionConfidence:.6,
  minTrackingConfidence:.6
});
faceMesh.onResults(onResults);

async function openCamera(){
  stopCamera();
  const constraints={
    audio:false,
    video:{facingMode:{ideal:cameraFacing},width:{ideal:1280},height:{ideal:720}}
  };
  try{
    stream=await navigator.mediaDevices.getUserMedia(constraints);
  }catch(e){
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:true});
  }
  video.srcObject=stream;
  await video.play();
  $("cameraTitle").textContent=cameraFacing==="user"?"Frontal":"Traseira";
  $("cameraStatus").textContent=cameraFacing==="user"?"Câmera frontal selecionada":"Câmera traseira selecionada";
  $("cameraQuality").textContent="Ativa";
  statusDot.classList.add("active");
}
function stopCamera(){
  if(stream)stream.getTracks().forEach(t=>t.stop());
  stream=null;
  if(animationFrame)cancelAnimationFrame(animationFrame);
  animationFrame=null;
}
async function processFrame(){
  if(!running)return;
  if(video.readyState>=2){
    try{await faceMesh.send({image:video});}catch(e){console.error(e);}
  }
  animationFrame=requestAnimationFrame(processFrame);
}
async function selectCamera(facing){
  cameraFacing=facing;
  frontBtn.classList.toggle("active",facing==="user");
  rearBtn.classList.toggle("active",facing==="environment");
  if(!stream)return;
  try{
    await openCamera();
    invalidateCalibration("A câmera foi alterada. Faça uma nova calibração para esta câmera.");
  }catch(e){
    console.error(e);
    $("cameraQuality").textContent="Erro";
    alert("Não foi possível acessar a câmera selecionada.");
  }
}
function resetSamples(){
  samples=[];stableReading=null;
  odEl.textContent="—";oeEl.textContent="—";dnpEl.textContent="—";
  readingCount.textContent="0/"+STABLE_FRAMES+" frames";
  readingNote.textContent=calibration?"Aguardando rosto":"Calibre primeiro";
  stabilityState.textContent="—";faceState.textContent="—";alignmentState.textContent="—";
  measurementState.textContent=calibration?"Aguardando":"Aguardando";
  measurementState.className="pill";
  useReadingBtn.disabled=true;
}
async function start(){
  intro.classList.add("hidden");
  workspace.classList.remove("hidden");
  savedPanel.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  try{
    await openCamera();
    running=true;
    processFrame();
    calibrationOverlay.classList.remove("hidden");
    measurementPanel.classList.add("hidden");
    setStep(2);
    calibration=null;
    calibrationState.textContent="Não calibrado";
    calibrationState.className="pill amber";
    calibrationValidation.textContent="Faça a calibração física desta sessão antes de medir.";
    calibrationValidation.className="validation warn";
    scaleValue.textContent="—";
    resetCalibrationHandles();
  }catch(e){
    console.error(e);
    alert("Permita o acesso à câmera no navegador e tente novamente.");
    resetApp();
  }
}
function resetApp(){
  running=false;stopCamera();
  workspace.classList.add("hidden");intro.classList.remove("hidden");
  calibrationOverlay.classList.add("hidden");measurementPanel.classList.add("hidden");
  osPanel.classList.add("hidden");savedPanel.classList.add("hidden");
  setStep(1);statusDot.classList.remove("active");calibration=null;resetSamples();
}
function prepareOs(){
  if(!stableReading)return;
  osDnp.textContent=stableReading.dnpMm.toFixed(1)+" mm";
  osMono.textContent=stableReading.odMm.toFixed(1)+" / "+stableReading.oeMm.toFixed(1)+" mm";
  setStep(4);osPanel.classList.remove("hidden");
  osPanel.scrollIntoView({behavior:"smooth",block:"start"});
}
useReadingBtn.addEventListener("click",prepareOs);
$("newReadingBtn").addEventListener("click",()=>{resetSamples();setStep(3);});
startBtn.addEventListener("click",start);
frontBtn.addEventListener("click",()=>selectCamera("user"));
rearBtn.addEventListener("click",()=>selectCamera("environment"));

function nextOsNumber(){
  const day=new Date().toISOString().slice(0,10).replaceAll("-","");
  const key="mbDnpOsCounter_"+day;
  const n=Number(localStorage.getItem(key)||0)+1;
  localStorage.setItem(key,String(n));
  return "DNP-"+day+"-"+String(n).padStart(3,"0");
}
function collectRecord(){
  if(!stableReading)return null;
  const name=customerName.value.trim();
  if(!name){
    osValidation.textContent="Informe o nome do cliente para gerar a O.S.";
    osValidation.className="validation error";
    customerName.focus();
    return null;
  }
  const number=currentOs&&currentOs.number?currentOs.number:nextOsNumber();
  currentOs={number:number};
  return {
    schema:"MB.Optica.DNP.OS.v1",
    number:number,
    createdAt:new Date().toISOString(),
    customer:{
      name:name,
      phone:customerPhone.value.trim(),
      cpf:customerCpf.value.trim(),
      type:customerType.value,
      notes:customerNotes.value.trim()
    },
    sale:{number:saleNumber.value.trim()},
    measurement:{
      odMm:stableReading.odMm,
      oeMm:stableReading.oeMm,
      dnpMm:stableReading.dnpMm,
      stabilitySdMm:stableReading.sdMm
    },
    calibration:stableReading.calibration,
    source:"MB.Óptica DNP",
    integrationStatus:"pending"
  };
}
function saveRecord(){
  const record=collectRecord();
  if(!record)return;
  const list=JSON.parse(localStorage.getItem("mbDnpOrders")||"[]");
  const existing=list.findIndex(x=>x.number===record.number);
  if(existing>=0)list[existing]=record;else list.unshift(record);
  localStorage.setItem("mbDnpOrders",JSON.stringify(list));
  savedRecord=record;
  osNumber.textContent=record.number;
  osValidation.textContent="O.S. salva neste dispositivo.";
  osValidation.className="validation ok";
  savedPanel.classList.remove("hidden");
  $("savedTitle").textContent="O.S. "+record.number+" criada";
  $("savedSummary").textContent=record.customer.name+" • DNP "+record.measurement.dnpMm.toFixed(1)+" mm • OD "+record.measurement.odMm.toFixed(1)+" mm • OE "+record.measurement.oeMm.toFixed(1)+" mm.";
  updateLocalStats();
  savedPanel.scrollIntoView({behavior:"smooth",block:"start"});
}
$("generateOsBtn").addEventListener("click",saveRecord);
$("saveDraftBtn").addEventListener("click",()=>{
  const record=collectRecord();
  if(!record)return;
  record.integrationStatus="draft";
  const list=JSON.parse(localStorage.getItem("mbDnpOrders")||"[]");
  const existing=list.findIndex(x=>x.number===record.number);
  if(existing>=0)list[existing]=record;else list.unshift(record);
  localStorage.setItem("mbDnpOrders",JSON.stringify(list));
  osNumber.textContent=record.number;
  osValidation.textContent="Rascunho "+record.number+" salvo localmente.";
  osValidation.className="validation ok";
  updateLocalStats();
});

$("printBtn").addEventListener("click",()=>{
  if(!savedRecord)return;
  const w=window.open("","_blank","width=800,height=900");
  if(!w){alert("O navegador bloqueou a janela de impressão.");return}
  const r=savedRecord;
  w.document.write(
    "<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><title>"+r.number+"</title><style>"+
    "body{font-family:Arial,sans-serif;color:#111;padding:36px;max-width:760px;margin:auto}"+
    "h1{margin:0 0 4px}h2{margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}"+
    ".muted{color:#666;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}"+
    ".box{border:1px solid #ccc;padding:14px;border-radius:8px}.label{font-size:11px;color:#666}.value{font-size:20px;font-weight:700;margin-top:5px}"+
    "table{width:100%;border-collapse:collapse;margin-top:14px}td,th{border:1px solid #ddd;padding:9px;text-align:left}.footer{margin-top:40px;font-size:11px;color:#666}"+
    "</style></head><body><h1>MB.Óptica</h1><div class='muted'>Ordem de Serviço • "+r.number+"</div>"+
    "<h2>Cliente</h2><p><b>"+escapeHtml(r.customer.name)+"</b><br>Telefone: "+escapeHtml(r.customer.phone||"—")+"<br>CPF: "+escapeHtml(r.customer.cpf||"—")+"<br>Tipo: "+escapeHtml(r.customer.type)+"</p>"+
    "<h2>Medição DNP</h2><div class='grid'><div class='box'><div class='label'>OD</div><div class='value'>"+r.measurement.odMm.toFixed(1)+" mm</div></div>"+
    "<div class='box'><div class='label'>OE</div><div class='value'>"+r.measurement.oeMm.toFixed(1)+" mm</div></div>"+
    "<div class='box'><div class='label'>DNP</div><div class='value'>"+r.measurement.dnpMm.toFixed(1)+" mm</div></div></div>"+
    "<h2>Dados do atendimento</h2><table><tr><th>Venda</th><td>"+escapeHtml(r.sale.number||"—")+"</td></tr><tr><th>Estabilidade</th><td>±"+r.measurement.stabilitySdMm.toFixed(2)+" mm</td></tr>"+
    "<tr><th>Calibração</th><td>"+r.calibration.referenceMm.toFixed(1)+" mm • "+r.calibration.pxPerMm.toFixed(2)+" px/mm</td></tr></table>"+
    "<h2>Observações</h2><p>"+escapeHtml(r.customer.notes||"—")+"</p><div class='footer'>MB.Óptica DNP • registro local • validar conforme protocolo da ótica.</div></body></html>"
  );
  w.document.close();w.focus();w.print();
});

function escapeHtml(v){
  return String(v).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c];
  });
}
$("anotherBtn").addEventListener("click",()=>{
  customerName.value="";customerPhone.value="";customerCpf.value="";saleNumber.value="";customerNotes.value="";
  currentOs=null;savedRecord=null;savedPanel.classList.add("hidden");osPanel.classList.add("hidden");
  invalidateCalibration("Novo atendimento: faça uma nova calibração para a posição atual.");
  workspace.scrollIntoView({behavior:"smooth"});
});
$("settingsBtn").addEventListener("click",()=>{
  settingsPanel.classList.toggle("hidden");updateLocalStats();
});
$("closeSettingsBtn").addEventListener("click",()=>settingsPanel.classList.add("hidden"));
$("clearLocalBtn").addEventListener("click",()=>{
  if(!confirm("Limpar calibração e O.S. salvas neste dispositivo?"))return;
  localStorage.removeItem("mbDnpCalibration");
  localStorage.removeItem("mbDnpCalibrationLabel");
  localStorage.removeItem("mbDnpOrders");
  calibration=null;updateLocalStats();
  if(running)invalidateCalibration("Dados locais limpos. Faça uma nova calibração.");
});
function updateLocalStats(){
  $("lastCalibration").textContent=localStorage.getItem("mbDnpCalibrationLabel")||"Nenhuma";
  const list=JSON.parse(localStorage.getItem("mbDnpOrders")||"[]");
  $("localCount").textContent=String(list.length);
}
updateLocalStats();
setStep(1);
