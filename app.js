window.__MB_DNP_BOOT__=true;
const $=id=>document.getElementById(id);
const video=$("video"),canvas=$("overlay"),ctx=canvas.getContext("2d"),viewer=$("viewer");
const startBtn=$("startBtn"),intro=$("intro"),workspace=$("workspace"),statusDot=$("statusDot");
const cameraStatus=$("cameraStatus"),cameraQuality=$("cameraQuality"),captureBadge=$("captureBadge");
const frontBtn=$("frontBtn"),rearBtn=$("rearBtn"),faceState=$("faceState"),faceMetric=$("faceMetric");
const poseMetric=$("poseMetric"),scaleMetric=$("scaleMetric"),stabilityMetric=$("stabilityMetric");
const rightMetric=$("rightMetric"),leftMetric=$("leftMetric"),noseMetric=$("noseMetric"),biometricNote=$("biometricNote");
const measurementState=$("measurementState"),odEl=$("od"),oeEl=$("oe"),dnpEl=$("dnp"),readingCount=$("readingCount"),readingNote=$("readingNote"),zeroMetric=$("zeroMetric"),useReadingBtn=$("useReadingBtn");
const osPanel=$("osPanel"),customerName=$("customerName"),customerPhone=$("customerPhone"),customerCpf=$("customerCpf"),saleNumber=$("saleNumber"),customerType=$("customerType"),customerNotes=$("customerNotes"),osNumber=$("osNumber"),osDnp=$("osDnp"),osMono=$("osMono"),osValidation=$("osValidation");
const savedPanel=$("savedPanel"),savedTitle=$("savedTitle"),savedSummary=$("savedSummary");
let stream=null,running=false,faceLandmarker=null,lastVideoTime=-1,animationFrame=0,currentReading=null,samples=[],lastTimestampMs=0,loopErrorCount=0;
let cameraFacing="user",currentGeometry=null,currentScale=null,currentOs=null;
const STABLE_FRAMES=24;
const RIGHT_IRIS=468,LEFT_IRIS=473,NASAL=168,RIGHT_OUTER=33,LEFT_OUTER=263,FACE_LEFT=234,FACE_RIGHT=454,FACE_TOP=10,FACE_BOTTOM=152;
const RIGHT_IRIS_EDGES=[469,470,471,472],LEFT_IRIS_EDGES=[474,475,476,477];
const IRIS_DIAMETER_MM=11.7;
const STORE_KEY="mb_dnp_facial_biometric_v24";

function getView(){const r=viewer.getBoundingClientRect();return{w:r.width,h:r.height}}
function resize(){const s=getView(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(s.w*d);canvas.height=Math.round(s.h*d);canvas.style.width=s.w+"px";canvas.style.height=s.h+"px";ctx.setTransform(d,0,0,d,0,0)}
function vp(p){const s=getView();return{x:(1-p.x)*s.w,y:p.y*s.h}}
function rawPoint(p){return{x:p.x,y:p.y}}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function median(a){if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function std(a){if(a.length<2)return 0;const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length)}
function setStep(n){document.querySelectorAll(".step").forEach((e,i)=>{e.classList.toggle("active",i===n-1);e.classList.toggle("done",i<n-1)})}

function matrixScale(matrix){
 if(!matrix||matrix.length<16)return null;
 const sx=Math.hypot(matrix[0],matrix[1],matrix[2]);
 const sy=Math.hypot(matrix[4],matrix[5],matrix[6]);
 const sz=Math.hypot(matrix[8],matrix[9],matrix[10]);
 const s=(sx+sy+sz)/3;
 return Number.isFinite(s)&&s>0?s:null;
}
function irisDiameterPx(center,edges){
 const ds=edges.map(i=>dist(center,vp(currentLandmarks[i])));
 return ds.reduce((a,b)=>a+b,0)/ds.length*2;
}
let currentLandmarks=[];

function geometryFromResult(result){
 const lm=result.faceLandmarks?.[0],matrix=result.facialTransformationMatrixes?.[0]?.data;
 if(!lm)return null;
 currentLandmarks=lm;
 const r=vp(lm[RIGHT_IRIS]),l=vp(lm[LEFT_IRIS]),ro=vp(lm[RIGHT_OUTER]),lo=vp(lm[LEFT_OUTER]),n=vp(lm[NASAL]);
 const fl=vp(lm[FACE_LEFT]),fr=vp(lm[FACE_RIGHT]),ft=vp(lm[FACE_TOP]),fb=vp(lm[FACE_BOTTOM]);
 if([r,l,ro,lo,n,fl,fr,ft,fb].some(p=>!p))return null;
 const axis={x:l.x-r.x,y:l.y-r.y},axisLen=Math.hypot(axis.x,axis.y)||1,u={x:axis.x/axisLen,y:axis.y/axisLen};
 const roll=Math.atan2(axis.y,Math.abs(axis.x))*180/Math.PI;
 const mid={x:(r.x+l.x)/2,y:(r.y+l.y)/2};
 const faceWidth=dist(fl,fr),faceHeight=dist(ft,fb),eyeOuterPx=dist(ro,lo);
 const irisRightPx=irisDiameterPx(r,RIGHT_IRIS_EDGES),irisLeftPx=irisDiameterPx(l,LEFT_IRIS_EDGES);
 const irisPx=(irisRightPx+irisLeftPx)/2;
 if(!Number.isFinite(irisPx)||irisPx<4)return null;
 const mmPerPx=IRIS_DIAMETER_MM/irisPx;
 const scale=matrixScale(matrix)||1;
 const project=p=>(p.x-mid.x)*u.x+(p.y-mid.y)*u.y;
 const pr=project(r),pl=project(l),pn=project(n);
 const od=Math.abs(pn-pr)*mmPerPx,oe=Math.abs(pl-pn)*mmPerPx,dp=Math.abs(pl-pr)*mmPerPx;
 const yaw=Math.abs((n.x-mid.x)/Math.max(1,eyeOuterPx));
 return {r,l,n,ro,lo,fl,fr,ft,fb,roll,yaw,faceWidth,faceHeight,eyeOuterPx,irisRightPx,irisLeftPx,irisPx,scale,mmPerPx,od,oe,dp};
}

function drawLine(a,b,stroke="rgba(85,214,255,.65)",width=1){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke()}
function dot(p,r=3,fill="#55d6ff"){ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill()}
function text(t,x,y,fill="#dff5ff",size=9){ctx.save();ctx.translate(getView().w,0);ctx.scale(-1,1);ctx.font="800 "+size+"px Arial";ctx.textAlign="center";ctx.fillStyle=fill;ctx.fillText(t,x,y);ctx.restore()}
function drawBiometricMap(lm,g){
 ctx.clearRect(0,0,getView().w,getView().h);
 for(let i=0;i<lm.length;i+=4){const p=vp(lm[i]);dot(p,1.2,"rgba(102,211,255,.34)")}
 const outline=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,234,93,132,58,172,136,150,149,176,148,10];
 for(let i=0;i<outline.length-1;i++)drawLine(vp(lm[outline[i]]),vp(lm[outline[i+1]]),"rgba(122,222,255,.48)",1);
 drawLine(g.r,g.l,"rgba(255,255,255,.55)",1.5);
 drawLine(g.n,g.r,"rgba(255,204,102,.8)",1.5);
 drawLine(g.n,g.l,"rgba(255,204,102,.8)",1.5);
 dot(g.r,5,"#55d6ff");dot(g.l,5,"#55d6ff");dot(g.n,5,"#ffcc66");
 text("OD",g.r.x,g.r.y-13,"#9fe5ff",9);text("OE",g.l.x,g.l.y-13,"#9fe5ff",9);text("0",g.n.x,g.n.y-14,"#ffdf8a",10);
}

function quality(g){
 const roll=Math.abs(g.roll),yaw=g.yaw;
 const good=roll<=12&&yaw<=.25;
 return {good,roll,yaw};
}

function updateBiometric(g,lm){
 const q=quality(g);
 faceState.textContent="Mapeado";faceState.className="pill green";
 faceMetric.textContent=Math.round(g.faceWidth)+" × "+Math.round(g.faceHeight)+" px";
 poseMetric.textContent=q.good?"Frontal":"Ajustar";
 poseMetric.className=q.good?"pill green":"pill amber";
 scaleMetric.textContent=g.irisPx.toFixed(1)+" px/íris";
 rightMetric.textContent=g.r.x.toFixed(0)+", "+g.r.y.toFixed(0);
 leftMetric.textContent=g.l.x.toFixed(0)+", "+g.l.y.toFixed(0);
 noseMetric.textContent=g.n.x.toFixed(0)+", "+g.n.y.toFixed(0);
 biometricNote.textContent=q.good?"Mapa facial estável • escala métrica estimada pelo diâmetro da íris":"Centralize o rosto e mantenha a cabeça reta";
 if(q.good){samples.push({od:g.od,oe:g.oe,dp:g.dp,scale:g.scale,roll:g.roll,yaw:g.yaw});if(samples.length>STABLE_FRAMES)samples.shift()}
 readingCount.textContent=samples.length+"/"+STABLE_FRAMES+" quadros";
 stabilityMetric.textContent=samples.length<STABLE_FRAMES?"Capturando":(Math.max(std(samples.map(x=>x.od)),std(samples.map(x=>x.oe)))<.35?"Excelente":"Boa");
 if(samples.length===STABLE_FRAMES){
   const od=median(samples.map(x=>x.od)),oe=median(samples.map(x=>x.oe)),dp=median(samples.map(x=>x.dp)),spread=Math.max(std(samples.map(x=>x.od)),std(samples.map(x=>x.oe)));
   currentReading={od,oe,dp,spread,frames:STABLE_FRAMES,scale:median(samples.map(x=>x.scale)),roll:median(samples.map(x=>x.roll)),yaw:median(samples.map(x=>x.yaw)),method:"facial-landmarker+iris-metric-scale"};
   odEl.textContent=od.toFixed(1)+" mm";oeEl.textContent=oe.toFixed(1)+" mm";dnpEl.textContent=(od+oe).toFixed(1)+" mm";
   zeroMetric.textContent="landmark 168 • automático";
   measurementState.textContent="Leitura pronta";measurementState.className="pill green";
   readingNote.textContent="24 quadros • escala biométrica pela íris";
   useReadingBtn.disabled=false;
 }
}

async function initLandmarker(){
 if(faceLandmarker)return;
 cameraStatus.textContent="Carregando motor facial…";
 const {FilesetResolver,FaceLandmarker}=await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm");
 const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
 const options={baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",delegate:"GPU"},runningMode:"VIDEO",numFaces:1,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:true,minFaceDetectionConfidence:.65,minFacePresenceConfidence:.65,minTrackingConfidence:.65};
 try{
   faceLandmarker=await FaceLandmarker.createFromOptions(vision,options);
 }catch(gpuError){
   cameraStatus.textContent="GPU indisponível • usando processamento compatível…";
   options.baseOptions.delegate="CPU";
   faceLandmarker=await FaceLandmarker.createFromOptions(vision,options);
 }
}

async function initCamera(facing=cameraFacing){
 if(stream)stream.getTracks().forEach(t=>t.stop());
 cameraFacing=facing;
 stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}},audio:false});
 video.srcObject=stream;await video.play();resize();statusDot.classList.add("on");cameraStatus.textContent="Câmera ativa • centralize o rosto";cameraQuality.textContent="Ativa";running=true;lastVideoTime=-1;lastTimestampMs=0;loop();
}

function loop(){
 if(!running)return;
 try{
   if(video.readyState>=2&&video.currentTime!==lastVideoTime&&faceLandmarker){
     lastVideoTime=video.currentTime;
     const nowMs=Math.round(performance.now());
     const timestampMs=nowMs<=lastTimestampMs?lastTimestampMs+1:nowMs;
     lastTimestampMs=timestampMs;
     const result=faceLandmarker.detectForVideo(video,timestampMs);
     if(result?.faceLandmarks?.length){
       const g=geometryFromResult(result);
       if(g){
         loopErrorCount=0;
         currentGeometry=g;
         drawBiometricMap(result.faceLandmarks[0],g);
         const q=quality(g);
         cameraQuality.textContent=q.good?"Boa captura":"Ajustar";
         cameraQuality.className=q.good?"pill green":"pill amber";
         captureBadge.textContent=q.good?"ROSTO MAPEADO":"AJUSTE DE POSE";
         updateBiometric(g,result.faceLandmarks[0]);
       }
     }else{
       ctx.clearRect(0,0,getView().w,getView().h);
       faceState.textContent="Não detectado";
       cameraQuality.textContent="Sem rosto";
       captureBadge.textContent="APROXIME O ROSTO";
     }
   }
 }catch(e){
   loopErrorCount++;
   console.error("MB DNP loop:",e);
   cameraStatus.textContent="Câmera ativa • aguardando leitura facial";
   cameraQuality.textContent="Motor facial";
   if(loopErrorCount===1) biometricNote.textContent="Motor facial carregado; recuperando a leitura…";
 }
 animationFrame=requestAnimationFrame(loop);
}

async function start(){
 try{intro.classList.add("hidden");workspace.classList.remove("hidden");setStep(1);resize();await initLandmarker();await initCamera("user");}
 catch(e){workspace.classList.remove("hidden");cameraStatus.textContent="Não foi possível iniciar a biometria: "+(e?.message||e);cameraQuality.textContent="Erro";cameraQuality.className="pill amber";captureBadge.textContent="ERRO DE INICIALIZAÇÃO";console.error(e)}
}
startBtn.addEventListener("click",start);
frontBtn.addEventListener("click",async()=>{
  try{
    frontBtn.classList.add("active");rearBtn.classList.remove("active");
    cameraStatus.textContent="Trocando para câmera frontal…";
    await initCamera("user");
  }catch(e){
    cameraStatus.textContent="Não foi possível trocar a câmera: "+(e?.message||e);
    console.error(e);
  }
});
rearBtn.addEventListener("click",async()=>{
  try{
    rearBtn.classList.add("active");frontBtn.classList.remove("active");
    cameraStatus.textContent="Trocando para câmera traseira…";
    await initCamera("environment");
  }catch(e){
    cameraStatus.textContent="Não foi possível trocar a câmera: "+(e?.message||e);
    console.error(e);
  }
});
window.addEventListener("resize",resize);
window.addEventListener("error",e=>{
  console.error("MB DNP:",e.error||e.message);
});
window.addEventListener("unhandledrejection",e=>{
  console.error("MB DNP promise:",e.reason);
});

$("newReadingBtn").addEventListener("click",()=>{
  samples=[];
  currentReading=null;
  useReadingBtn.disabled=true;
  measurementState.textContent="Capturando";
  measurementState.className="pill";
  readingCount.textContent="0/"+STABLE_FRAMES+" quadros";
  readingNote.textContent="Nova sequência facial iniciada";
  odEl.textContent="—";oeEl.textContent="—";dnpEl.textContent="—";zeroMetric.textContent="—";
  biometricNote.textContent="Aguardando nova sequência facial…";
  setStep(3);
});
useReadingBtn.addEventListener("click",()=>{
  if(!currentReading)return;
  osPanel.classList.remove("hidden");
  osDnp.textContent=(currentReading.od+currentReading.oe).toFixed(1)+" mm";
  osMono.textContent=currentReading.od.toFixed(1)+" / "+currentReading.oe.toFixed(1)+" mm";
  osNumber.textContent="Será gerada";
  osPanel.scrollIntoView({behavior:"smooth",block:"start"});
  setStep(4);
});

function osNum(){return"MB-DNP-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+Math.floor(1000+Math.random()*9000)}
function saveOs(){
 if(!currentReading)return null;
 const os={schema:"MB.Optica.DNP.OS.v4",id:crypto.randomUUID?.()||String(Date.now()),number:osNum(),createdAt:new Date().toISOString(),customer:{name:customerName.value.trim(),phone:customerPhone.value.trim(),cpf:customerCpf.value.trim(),saleNumber:saleNumber.value.trim(),type:customerType.value,notes:customerNotes.value.trim()},measurement:{method:currentReading.method,odMm:currentReading.od,oeMm:currentReading.oe,dnpMm:currentReading.od+currentReading.oe,dpMm:currentReading.dp,referenceNasalLandmark:NASAL,frames:currentReading.frames,stabilityMm:currentReading.spread,modelScale:currentReading.scale,pose:{roll:currentReading.roll,yaw:currentReading.yaw}}};
 const list=JSON.parse(localStorage.getItem(STORE_KEY)||"[]");list.push(os);localStorage.setItem(STORE_KEY,JSON.stringify(list));currentOs=os;return os;
}
$("saveDraftBtn").addEventListener("click",()=>{if(!customerName.value.trim()){osValidation.textContent="Informe o nome do cliente.";osValidation.className="validation error";osValidation.classList.remove("hidden");return}const os=saveOs();osValidation.textContent="Rascunho salvo neste dispositivo: "+os.number;osValidation.className="validation ok";osValidation.classList.remove("hidden")});
$("generateOsBtn").addEventListener("click",()=>{if(!customerName.value.trim()){osValidation.textContent="Informe o nome do cliente.";osValidation.className="validation error";osValidation.classList.remove("hidden");return}const os=saveOs();savedTitle.textContent="O.S. "+os.number;savedSummary.textContent=customerName.value+" • DNP "+os.measurement.dnpMm.toFixed(1)+" mm • OD "+os.measurement.odMm.toFixed(1)+" mm • OE "+os.measurement.oeMm.toFixed(1)+" mm.";savedPanel.classList.remove("hidden");osPanel.classList.add("hidden");savedPanel.scrollIntoView({behavior:"smooth",block:"start"})});
$("printBtn").addEventListener("click",()=>{if(!currentOs)return;const m=currentOs.measurement,c=currentOs.customer,w=window.open("","_blank","width=800,height=700");w.document.write("<html><head><title>"+currentOs.number+"</title><style>body{font-family:Arial;padding:32px;color:#111}.box{border:1px solid #aaa;padding:16px;margin:12px 0}.big{font-size:28px;font-weight:800}</style></head><body><h1>MB.Óptica — O.S.</h1>"+currentOs.number+"<div class=box><b>Cliente</b><br>"+c.name+"<br>"+c.phone+" "+c.cpf+"</div><div class=box><b>Biometria facial</b><div class=big>DNP "+m.dnpMm.toFixed(1)+" mm</div>OD "+m.odMm.toFixed(1)+" mm • OE "+m.oeMm.toFixed(1)+" mm • DP "+m.dpMm.toFixed(1)+" mm</div><div class=box>Método: Face Landmarker + escala biométrica pela íris • 24 quadros estáveis • referência nasal automática (landmark "+m.referenceNasalLandmark+")</div></body></html>");w.document.close();w.print()});
$("anotherBtn").addEventListener("click",()=>location.reload());
$("settingsBtn").addEventListener("click",()=>alert("MB DNP v24 • biometria facial • dados locais neste dispositivo"));
