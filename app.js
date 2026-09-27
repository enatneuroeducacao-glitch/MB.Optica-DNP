const $ = id => document.getElementById(id);

const video=$("video"), canvas=$("overlay"), ctx=canvas.getContext("2d");
const startBtn=$("startBtn"), frontBtn=$("frontBtn"), rearBtn=$("rearBtn");
const statusDot=$("statusDot"), workspace=$("workspace"), intro=$("intro"), viewer=$("viewer");
const calibrationOverlay=$("calibrationOverlay"), calibrationPanel=$("calibrationPanel");
const measurementPanel=$("measurementPanel"), osPanel=$("osPanel"), savedPanel=$("savedPanel"), settingsPanel=$("settingsPanel");
const cameraControls=document.querySelector(".camera-controls");
const measurementRuler=$("measurementRuler");
const referenceMmEl=$("referenceMm"), referenceHeightMmEl=$("referenceHeightMm"), scaleValue=$("scaleValue");
const calibrationState=$("calibrationState"), calibrationValidation=$("calibrationValidation");
const measurementState=$("measurementState"), faceState=$("faceState"), stabilityState=$("stabilityState");
const alignmentState=$("alignmentState"), readingCount=$("readingCount"), readingNote=$("readingNote");
const odEl=$("od"), oeEl=$("oe"), dnpEl=$("dnp"), useReadingBtn=$("useReadingBtn");
const nasalReferenceValue=$("nasalReferenceValue");
const customerName=$("customerName"), customerPhone=$("customerPhone"), customerCpf=$("customerCpf");
const saleNumber=$("saleNumber"), customerType=$("customerType"), customerNotes=$("customerNotes");
const osNumber=$("osNumber"), osDnp=$("osDnp"), osMono=$("osMono"), osValidation=$("osValidation");

let stream=null,running=false,cameraFacing="user",animationFrame=null;
const roiCanvas=document.createElement("canvas"),roiCtx=roiCanvas.getContext("2d");
const ROI_ZOOM=1.55; // zoom do campo óptico; a escala métrica continua vindo da referência física

let calibration=null,nasalPoint={x:0,y:0},nasalConfirmed=false,dragHandle=null,nasalDragging=false;
let samples=[],stableReading=null,selectedReading=null;
const STABLE_FRAMES=24;
let currentOs=null,savedRecord=null;

const handles={
  tl:$("handleTL"),tr:$("handleTR"),br:$("handleBR"),bl:$("handleBL")
};
const RIGHT_IRIS_CENTER_ID=468, LEFT_IRIS_CENTER_ID=473;
const RIGHT_IRIS_RING_IDS=[469,470,471,472], LEFT_IRIS_RING_IDS=[474,475,476,477];
const RIGHT_EYE_CONTOUR=[33,7,163,144,145,153,154,155,133];
const LEFT_EYE_CONTOUR=[362,382,381,380,374,373,390,249,263];

function point(lm,id){const p=lm[id];return p?{x:p.x,y:p.y}:null}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function median(v){if(!v.length)return 0;const s=[...v].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function mean(v){return v.length?v.reduce((a,b)=>a+b,0)/v.length:0}
function std(v){if(v.length<2)return 0;const m=mean(v);return Math.sqrt(mean(v.map(x=>(x-m)**2)))}
function getViewSize(){const r=viewer.getBoundingClientRect();return{width:Math.max(1,r.width),height:Math.max(1,r.height)}}
function getRoiSource(){
  const sw=video.videoWidth||1280,sh=video.videoHeight||720,s=getViewSize();
  const aspect=s.width/s.height;
  let cw=sw/ROI_ZOOM;
  let ch=cw/aspect;
  if(ch>sh){ch=sh;cw=ch*aspect}
  if(cw>sw){cw=sw;ch=cw/aspect}
  const x=(sw-cw)/2;
  const y=Math.max(0,Math.min(sh-ch,sh*.50-ch/2));
  return{x,y,width:cw,height:ch}
}
function drawMeasurementRoi(){
  if(video.readyState<2)return null;
  const s=getViewSize(),r=getRoiSource();
  const w=Math.max(2,Math.round(s.width)),h=Math.max(2,Math.round(s.height));
  if(roiCanvas.width!==w||roiCanvas.height!==h){roiCanvas.width=w;roiCanvas.height=h}
  roiCtx.clearRect(0,0,w,h);
  roiCtx.drawImage(video,r.x,r.y,r.width,r.height,0,0,w,h);
  return r
}
function toViewPoint(p){
  // FaceMesh recebe o canvas já recortado. Portanto p.x/p.y já estão
  // normalizados no mesmo plano da janela óptica.
  const s=getViewSize();
  return{x:p.x*s.width,y:p.y*s.height}
}
function setStep(n){document.querySelectorAll(".step").forEach(el=>{const s=Number(el.dataset.step);el.classList.toggle("active",s===n);el.classList.toggle("done",s<n)})}

function resetCalibrationHandles(){
  const s=getViewSize();
  calibrationPoints={
    tl:{x:s.width*.20,y:s.height*.28},tr:{x:s.width*.80,y:s.height*.28},
    br:{x:s.width*.80,y:s.height*.72},bl:{x:s.width*.20,y:s.height*.72}
  };
  renderCalibrationHandles();
}
let calibrationPoints={tl:{x:0,y:0},tr:{x:0,y:0},br:{x:0,y:0},bl:{x:0,y:0}};
function renderCalibrationHandles(){
  Object.entries(handles).forEach(([k,h])=>{
    const p=calibrationPoints[k];h.style.left=(p.x-14)+"px";h.style.top=(p.y-14)+"px";
  });
  const pts=["tl","tr","br","bl"].map(k=>calibrationPoints[k]);
  const minX=Math.min(...pts.map(p=>p.x)),maxX=Math.max(...pts.map(p=>p.x));
  const minY=Math.min(...pts.map(p=>p.y)),maxY=Math.max(...pts.map(p=>p.y));
  const rect=document.querySelector(".cal-rect"),line=document.querySelector(".cal-centerline");
  if(rect){rect.style.left=minX+"px";rect.style.top=minY+"px";rect.style.width=(maxX-minX)+"px";rect.style.height=(maxY-minY)+"px"}
  if(line){line.style.left=((minX+maxX)/2)+"px";line.style.top=minY+"px";line.style.height=(maxY-minY)+"px"}
  scaleValue.textContent="4 pontos • "+Number(referenceMmEl.value||0).toFixed(1)+" × "+Number(referenceHeightMmEl.value||0).toFixed(2)+" mm";
}
function pointerPosition(e){
  const r=viewer.getBoundingClientRect();
  return{x:Math.max(10,Math.min(r.width-10,e.clientX-r.left)),y:Math.max(10,Math.min(r.height-10,e.clientY-r.top))}
}
function startDrag(name,e){e.preventDefault();dragHandle=name}
function moveDrag(e){
  if(nasalDragging){nasalPoint=pointerPosition(e);renderNasalHandle();return}
  if(!dragHandle)return;calibrationPoints[dragHandle]=pointerPosition(e);renderCalibrationHandles()
}
function endDrag(){dragHandle=null;nasalDragging=false}
function renderNasalHandle(){
  if(!nasalHandle||!nasalPoint.x)return;
  nasalHandle.style.left=(nasalPoint.x-14)+"px";nasalHandle.style.top=(nasalPoint.y-14)+"px";
}
nasalHandle.addEventListener("pointerdown",e=>{e.preventDefault();nasalDragging=true});
Object.entries(handles).forEach(([k,h])=>h.addEventListener("pointerdown",e=>startDrag(k,e)));
window.addEventListener("pointermove",moveDrag);window.addEventListener("pointerup",endDrag);
window.addEventListener("resize",()=>{if(!workspace.classList.contains("hidden"))renderCalibrationHandles()});
referenceMmEl.addEventListener("input",renderCalibrationHandles);referenceHeightMmEl.addEventListener("input",renderCalibrationHandles);

$("repositionBtn").addEventListener("click",()=>{resetCalibrationHandles();calibrationValidation.textContent="Pontos reiniciados. Alinhe-os aos quatro cantos.";calibrationValidation.className="validation"});

/* Homografia: transforma os 4 cantos capturados no plano métrico conhecido. */
function solve8(A,b){
  const n=8,M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){
    let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
    if(Math.abs(M[p][c])<1e-10)return null;
    [M[c],M[p]]=[M[p],M[c]];
    const d=M[c][c];for(let j=c;j<=n;j++)M[c][j]/=d;
    for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];if(!f)continue;for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j]}
  }
  return M.map(r=>r[n])
}
function homographyFromCorners(src,W,H){
  const dst=[[0,0],[W,0],[W,H],[0,H]],A=[],b=[];
  for(let i=0;i<4;i++){
    const x=src[i].x,y=src[i].y,u=dst[i][0],v=dst[i][1];
    A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);
    A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);
  }
  const h=solve8(A,b);if(!h)return null;
  return[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1]
}
function applyH(H,p){
  const d=H[6]*p.x+H[7]*p.y+H[8],x=(H[0]*p.x+H[1]*p.y+H[2])/d,y=(H[3]*p.x+H[4]*p.y+H[5])/d;
  return{x,y}
}
function inverse3x3(m){
  const a=m[0],b=m[1],c=m[2],d=m[3],e=m[4],f=m[5],g=m[6],h=m[7],i=m[8];
  const A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d;
  const det=a*A+b*D+c*G;
  if(Math.abs(det)<1e-10)return null;
  return [A/det,D/det,G/det,B/det,E/det,H/det,C/det,F/det,I/det]
}
function screenXForMetric(targetMm,yScreen,guessX){
  if(!calibration?.homography)return null;
  const Hinv=inverse3x3(calibration.homography);if(!Hinv)return null;
  // O alvo é a coordenada X no plano métrico. Mantemos a altura da pupila
  // e encontramos a posição correspondente na imagem por busca binária.
  let lo=0,hi=getViewSize().width;
  const f=x=>applyH(calibration.homography,{x,y:yScreen}).x-targetMm;
  let flo=f(lo),fhi=f(hi);
  if(!Number.isFinite(flo)||!Number.isFinite(fhi))return null;
  // Em perspectiva extrema a função ainda pode não cruzar os extremos; usamos
  // uma busca local em torno do ponto 0.
  let center=Number.isFinite(guessX)?guessX:getViewSize().width/2;
  let span=Math.max(40,getViewSize().width*.45);
  lo=Math.max(0,center-span);hi=Math.min(getViewSize().width,center+span);
  flo=f(lo);fhi=f(hi);
  if(flo*fhi>0)return null;
  for(let n=0;n<28;n++){
    const mid=(lo+hi)/2,fm=f(mid);
    if(Math.abs(fm)<0.0005)return mid;
    if(flo*fm<=0){hi=mid;fhi=fm}else{lo=mid;flo=fm}
  }
  return (lo+hi)/2
}
function drawCalibratedRuler(nasalView,pupilY){
  if(!calibration?.homography)return;
  const s=getViewSize();
  const nasalMetric=applyH(calibration.homography,nasalView);
  const zeroX=nasalView.x;
  const y=Math.max(24,Math.min(s.height-28,pupilY+48));
  const maxEachSide=35;
  const step=1;

  ctx.save();
  ctx.strokeStyle="rgba(225,242,255,.86)";ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(Math.max(8,zeroX-300),y);
  ctx.lineTo(Math.min(s.width-8,zeroX+300),y);
  ctx.stroke();

  // Zero absoluto: ponte da armação.
  ctx.strokeStyle="#ffcc66";ctx.lineWidth=2.5;
  ctx.beginPath();ctx.moveTo(zeroX,y-12);ctx.lineTo(zeroX,y+14);ctx.stroke();
  ctx.fillStyle="#ffdf8a";ctx.font="900 9px system-ui";ctx.textAlign="center";
  ctx.fillText("0",zeroX,y+27);

  for(let mm=step;mm<=maxEachSide;mm+=step){
    const xr=screenXForMetric(nasalMetric.x-mm,y,zeroX-mm*4);
    const xl=screenXForMetric(nasalMetric.x+mm,y,zeroX+mm*4);

    for(const item of [[xr,"OD"],[xl,"OE"]]){
      const x=item[0];
      if(x==null||x<8||x>s.width-8)continue;
      const major10=mm%10===0, major5=mm%5===0;
      const tickH=major10?12:(major5?9:5);
      ctx.strokeStyle=major10?"rgba(255,255,255,.98)":major5?"rgba(225,242,255,.9)":"rgba(225,242,255,.58)";
      ctx.lineWidth=major10?1.8:(major5?1.4:1);
      ctx.beginPath();ctx.moveTo(x,y-tickH);ctx.lineTo(x,y+tickH*.55);ctx.stroke();

      if(major5){
        ctx.fillStyle=major10?"rgba(255,255,255,.98)":"rgba(225,242,255,.9)";
        ctx.font=major10?"800 8px system-ui":"700 7px system-ui";
        ctx.textAlign="center";
        ctx.fillText(String(mm),x,y+19);
      }
    }
  }

  ctx.fillStyle="rgba(210,236,255,.78)";ctx.font="800 7px system-ui";
  ctx.textAlign="left";ctx.fillText("OD • 0 → pupila",Math.max(8,zeroX-300),y-15);
  ctx.textAlign="right";ctx.fillText("pupila → 0 • OE",Math.min(s.width-8,zeroX+300),y-15);
  ctx.restore();
}
function renderMeasurementRuler(){
  if(!measurementRuler)return;
  measurementRuler.innerHTML='';
}

function setCalibration(){

  const W=Number(referenceMmEl.value),H=Number(referenceHeightMmEl.value);
  if(!Number.isFinite(W)||W<10||W>300||!Number.isFinite(H)||H<10||H>300){
    calibrationValidation.textContent="Informe largura e altura válidas entre 10 e 300 mm.";calibrationValidation.className="validation error";return false
  }
  const src=["tl","tr","br","bl"].map(k=>calibrationPoints[k]);
  if(distance(src[0],src[1])<80||distance(src[3],src[2])<80||distance(src[0],src[3])<40){
    calibrationValidation.textContent="Os 4 pontos precisam estar nos cantos da referência.";calibrationValidation.className="validation warn";return false
  }
  const Hm=homographyFromCorners(src,W,H);if(!Hm){calibrationValidation.textContent="Não foi possível calcular o plano métrico.";calibrationValidation.className="validation error";return false}
  calibration={widthMm:W,heightMm:H,homography:Hm,timestamp:new Date().toISOString(),cameraFacing,viewport:getViewSize(),reference:"retangulo-4-pontos"};
  localStorage.setItem("mbDnpCalibration",JSON.stringify(calibration));
  localStorage.setItem("mbDnpCalibrationLabel",new Date().toLocaleString("pt-BR"));
  calibrationState.textContent="Plano métrico";calibrationState.className="pill green";
  calibrationValidation.textContent="Plano métrico calibrado. Agora a tela muda para o enquadramento tipo armação; o ponto 0 será confirmado na ponte.";
  calibrationValidation.className="validation ok";scaleValue.textContent=W.toFixed(1)+" × "+H.toFixed(2)+" mm • homografia OK";
  measurementPanel.classList.remove("hidden");workspace.classList.add("measurement-mode");calibrationPanel.classList.add("hidden");cameraControls.classList.add("hidden");calibrationOverlay.classList.add("hidden");nasalHandle.classList.remove("hidden");measurementRuler.classList.remove("hidden");renderMeasurementRuler();nasalConfirmed=false;confirmNasalBtn.disabled=true;nasalReferenceValue.textContent="Posicione o marcador na ponte da armação";setStep(3);resetSamples();
  calibrationPanel.scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>measurementPanel.scrollIntoView({behavior:"smooth",block:"start"}),450);
  return true
}
$("confirmCalibrationBtn").addEventListener("click",setCalibration);

function invalidateCalibration(reason){
  calibration=null;calibrationState.textContent="Não calibrado";calibrationState.className="pill amber";
  calibrationValidation.textContent=reason||"Faça uma nova calibração.";calibrationValidation.className="validation warn";
  scaleValue.textContent="—";measurementPanel.classList.add("hidden");workspace.classList.remove("measurement-mode");calibrationPanel.classList.remove("hidden");cameraControls.classList.remove("hidden");calibrationOverlay.classList.remove("hidden");measurementRuler.classList.add("hidden");
  setStep(2);resetSamples();nasalConfirmed=false;nasalHandle.classList.add("hidden");confirmNasalBtn.disabled=true;resetCalibrationHandles()
}

function drawPoint(p,color="#55d6ff"){
  ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
  ctx.beginPath();ctx.arc(p.x,p.y,11,0,Math.PI*2);ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke()
}
function drawIris(lm,cid,rids){
  const cRaw=point(lm,cid);if(!cRaw)return null;
  const c=toViewPoint(cRaw);
  // Cursor compacto: centro + pequena cruz, sem círculos grandes.
  ctx.beginPath();ctx.arc(c.x,c.y,3.5,0,Math.PI*2);
  ctx.fillStyle="#55d6ff";ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c.x-11,c.y);ctx.lineTo(c.x+11,c.y);
  ctx.moveTo(c.x,c.y-11);ctx.lineTo(c.x,c.y+11);
  ctx.strokeStyle="rgba(255,255,255,.95)";ctx.lineWidth=1.8;ctx.stroke();
  ctx.beginPath();ctx.arc(c.x,c.y,7,0,Math.PI*2);
  ctx.strokeStyle="rgba(85,214,255,.72)";ctx.lineWidth=1.5;ctx.stroke();
  return c
}
function drawLensFrame(center,label,side){
  const w=170,h=112;
  // Na câmera frontal espelhada, o lado esquerdo da tela corresponde ao OD do usuário
  // e o lado direito ao OE. O quadro é ancorado pela pupila detectada.
  const x=side==="OD" ? center.x-w-18 : center.x+18;
  const y=center.y-h/2;
  const radius=28;
  ctx.save();
  ctx.strokeStyle="rgba(85,214,255,.78)";ctx.lineWidth=2;
  ctx.fillStyle="rgba(85,214,255,.045)";
  ctx.beginPath();ctx.roundRect(x,y,w,h,radius);ctx.fill();ctx.stroke();
  ctx.font="800 10px system-ui";ctx.fillStyle="rgba(225,246,255,.92)";
  ctx.fillText(label,x+12,y+18);
  ctx.restore();
  return{x,y,w,h}
}
function drawMetricLine(a,b,label,value,side){
  const y=a.y+(b.y-a.y)*0.62;
  const x1=a.x,x2=b.x;
  ctx.save();
  ctx.strokeStyle="rgba(255,204,102,.92)";ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();
  [x1,x2].forEach(x=>{ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x,y+6);ctx.stroke()});
  ctx.font="800 9px system-ui";ctx.fillStyle="#ffdf8a";
  ctx.textAlign=side==="OD"?"right":"left";
  ctx.fillText(label+"  "+value.toFixed(1)+" mm",(x1+x2)/2,y-8);
  ctx.restore();
}
function drawMeasurementGuides(rv,lv,nasal){
  const s=getViewSize();
  const odMm=Math.abs(applyH(calibration.homography,nasal).x-applyH(calibration.homography,rv).x);
  const oeMm=Math.abs(applyH(calibration.homography,lv).x-applyH(calibration.homography,nasal).x);
  // Quadros visuais lembram a armação; a régua é calculada do ponto 0 até cada pupila.
  drawLensFrame(rv,"OD • LENTE DIREITA","OD");
  drawLensFrame(lv,"OE • LENTE ESQUERDA","OE");
  drawMetricLine(nasal,rv,"OD",odMm,"OD");
  drawMetricLine(nasal,lv,"OE",oeMm,"OE");
  ctx.save();
  ctx.strokeStyle="rgba(255,204,102,.95)";ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(nasal.x,nasal.y-24);ctx.lineTo(nasal.x,nasal.y+24);ctx.stroke();
  ctx.font="900 10px system-ui";ctx.fillStyle="#ffdf8a";ctx.textAlign="center";
  ctx.fillText("0 • PONTE",nasal.x,nasal.y+38);
  ctx.restore();
}
function drawContour(lm,ids){const pts=ids.map(id=>point(lm,id)).filter(Boolean).map(toViewPoint);if(pts.length<2)return;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.strokeStyle="rgba(255,255,255,.55)";ctx.lineWidth=1.2;ctx.stroke()}
function drawLabel(t,p){ctx.font="800 11px system-ui";ctx.fillStyle="#fff";ctx.strokeStyle="rgba(0,0,0,.75)";ctx.lineWidth=3;ctx.strokeText(t,p.x+9,p.y-10);ctx.fillText(t,p.x+9,p.y-10)}
function getNasalCandidate(lm){
  const p=point(lm,168);return p?toViewPoint(p):null
}
function alignmentInfo(r,l){const dy=l.y-r.y,dx=Math.max(.001,Math.abs(l.x-r.x)),roll=Math.atan2(dy,dx)*180/Math.PI;return{roll,good:Math.abs(roll)<=5.5}}

function addSample(lm,right,left,nasalView){
  if(!calibration||selectedReading)return;
  const rv=toViewPoint(right),lv=toViewPoint(left);
  const nasal=applyH(calibration.homography,nasalView);
  const r=applyH(calibration.homography,rv),l=applyH(calibration.homography,lv);
  /* Ponto 0 é a posição confirmada da ponte; OD/OE são distâncias horizontais a partir dele. */
  const od=nasal.x-r.x,oe=l.x-nasal.x,dnp=od+oe;
  // Para uma leitura válida, a ponte precisa ficar entre as duas pupilas.
  if(!(r.x<nasal.x&&nasal.x<l.x))return;
  if(![od,oe,dnp].every(Number.isFinite)||od<0||oe<0||dnp<=0)return;
  // Evita aceitar leituras obviamente incompatíveis com a geometria capturada.
  // Não impõe mínimo de DNP; apenas bloqueia escala degenerada.
  if(dnp<20||dnp>100){
    readingNote.textContent="Escala fora da faixa de validação. Refaça a calibração física.";
    useReadingBtn.disabled=true;
    return;
  }
  samples.push({odMm:od,oeMm:oe,dnpMm:dnp,nasalX:nasal.x});if(samples.length>STABLE_FRAMES)samples.shift();
  readingCount.textContent=samples.length+"/"+STABLE_FRAMES+" frames";
  if(samples.length<STABLE_FRAMES){measurementState.textContent="Estabilizando";measurementState.className="pill";stabilityState.textContent=Math.round(samples.length/STABLE_FRAMES*100)+"%";readingNote.textContent="Mantenha o rosto imóvel";useReadingBtn.disabled=true;return}
  const odM=median(samples.map(s=>s.odMm)),oeM=median(samples.map(s=>s.oeMm)),dnpM=odM+oeM;
  const stability=Math.max(std(samples.map(s=>s.odMm)),std(samples.map(s=>s.oeMm)));
  stableReading={odMm:odM,oeMm:oeM,dnpMm:dnpM,sdMm:stability,nasalReferenceMm:0,timestamp:new Date().toISOString(),calibration:Object.assign({},calibration)};
  odEl.textContent=odM.toFixed(1)+" mm";oeEl.textContent=oeM.toFixed(1)+" mm";dnpEl.textContent=dnpM.toFixed(1)+" mm";
  const stable=stability<=.65,acceptable=stability<=1.25;
  stabilityState.textContent=stable?"Excelente":acceptable?"Boa":"Instável";alignmentState.textContent="Alinhado";
  measurementState.textContent=stable?"Leitura pronta":"Leitura estável";measurementState.className=stable?"pill green":"pill";
  readingNote.textContent=stable?"Variação baixa entre os frames":"Repita se desejar maior estabilidade";useReadingBtn.disabled=!acceptable
}

function onResults(res){
  const s=getViewSize();
  if(canvas.width!==Math.round(s.width)||canvas.height!==Math.round(s.height)){canvas.width=Math.round(s.width);canvas.height=Math.round(s.height)}
  // Canvas transparente: somente marcadores e guias são desenhados aqui.
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!res.multiFaceLandmarks?.length){faceState.textContent="Não detectado";alignmentState.textContent="—";statusDot.classList.remove("active");measurementState.textContent=calibration?"Aguardando":"Calibre primeiro";readingNote.textContent="Centralize o rosto dentro da área";return}
  const lm=res.multiFaceLandmarks[0],right=point(lm,RIGHT_IRIS_CENTER_ID),left=point(lm,LEFT_IRIS_CENTER_ID);if(!right||!left){faceState.textContent="Olhos não detectados";return}
  drawContour(lm,RIGHT_EYE_CONTOUR);drawContour(lm,LEFT_EYE_CONTOUR);
  const rv=drawIris(lm,RIGHT_IRIS_CENTER_ID,RIGHT_IRIS_RING_IDS),lv=drawIris(lm,LEFT_IRIS_CENTER_ID,LEFT_IRIS_RING_IDS);if(!rv||!lv)return;
  const align=alignmentInfo(right,left),candidate=getNasalCandidate(lm);if(!candidate)return;
  if(!nasalConfirmed){nasalPoint=candidate;renderNasalHandle();confirmNasalBtn.disabled=false;nasalReferenceValue.textContent="Marcador amarelo = ponto inicial; arraste até o apoio da ponte";}
  if(!calibration){
    ctx.beginPath();ctx.moveTo(candidate.x,candidate.y-18);ctx.lineTo(candidate.x,candidate.y+18);ctx.strokeStyle="rgba(255,204,102,.95)";ctx.lineWidth=2;ctx.stroke();
    drawLabel("PONTE / 0",candidate)
  }
  faceState.textContent="Detectado";alignmentState.textContent=align.good?"Alinhado":"Ajustar ("+align.roll.toFixed(1)+"°)";statusDot.classList.add("active");
  if(calibration&&align.good){
    if(!nasalConfirmed){measurementState.textContent="Confirme o ponto 0";readingNote.textContent="Arraste o marcador até o local exato onde a ponte da armação apoia";return;}
    ctx.beginPath();ctx.moveTo(rv.x,rv.y);ctx.lineTo(nasalPoint.x,nasalPoint.y);ctx.lineTo(lv.x,lv.y);ctx.strokeStyle="rgba(85,214,255,.35)";ctx.lineWidth=1.5;ctx.stroke();
    drawMeasurementGuides(rv,lv,nasalPoint);
    drawCalibratedRuler(nasalPoint,(rv.y+lv.y)/2);
    nasalReferenceValue.textContent=nasalConfirmed?"0,0 mm • ponto fixado na ponte":"Confirme o ponto 0";
    addSample(lm,right,left,nasalPoint)
  }else if(!calibration){measurementState.textContent="Calibre primeiro";readingNote.textContent="Conclua o plano métrico de 4 pontos"}
  else{measurementState.textContent="Ajuste a cabeça";readingNote.textContent="Mantenha os olhos no mesmo nível"}
}

let faceMesh=null;
function initFaceMesh(){
  if(faceMesh)return true;
  if(typeof FaceMesh!=="function"){
    alert("O módulo de visão não foi carregado. Verifique a conexão com a internet e recarregue a página.");
    return false;
  }
  faceMesh=new FaceMesh({locateFile:file=>"https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/"+file});
  faceMesh.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:.6,minTrackingConfidence:.6});
  faceMesh.onResults(onResults);
  return true
}

async function openCamera(){
  stopCamera();const constraints={audio:false,video:{facingMode:{ideal:cameraFacing},width:{ideal:1280},height:{ideal:720}}};
  try{stream=await navigator.mediaDevices.getUserMedia(constraints)}catch(e){stream=await navigator.mediaDevices.getUserMedia({audio:false,video:true})}
  video.srcObject=stream;await video.play();
  if(video.readyState<2) await new Promise(resolve=>{const done=()=>{video.removeEventListener("loadeddata",done);resolve()};video.addEventListener("loadeddata",done);setTimeout(resolve,1500)});
  $("cameraTitle").textContent=cameraFacing==="user"?"Frontal":"Traseira";$("cameraStatus").textContent=cameraFacing==="user"?"Câmera frontal selecionada":"Câmera traseira selecionada";$("cameraQuality").textContent=video.readyState>=2?"Ativa":"Aguardando imagem";statusDot.classList.add("active")
}
function stopCamera(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;if(animationFrame)cancelAnimationFrame(animationFrame);animationFrame=null}
async function processFrame(){
  if(!running)return;
  if(video.readyState>=2){
    try{
      // O vídeo permanece como imagem viva da câmera.
      // O ROI é usado somente pelo FaceMesh, evitando uma camada congelada sobre o vídeo.
      drawMeasurementRoi();
      await faceMesh.send({image:roiCanvas});
    }catch(e){console.error(e)}
  }
  animationFrame=requestAnimationFrame(processFrame)
}
async function selectCamera(facing){cameraFacing=facing;frontBtn.classList.toggle("active",facing==="user");rearBtn.classList.toggle("active",facing==="environment");if(!stream)return;try{await openCamera();invalidateCalibration("A câmera foi alterada. Faça uma nova calibração para esta câmera.")}catch(e){console.error(e);$("cameraQuality").textContent="Erro";alert("Não foi possível acessar a câmera selecionada.")}}

function resetSamples(){
  samples=[];stableReading=null;selectedReading=null;odEl.textContent="—";oeEl.textContent="—";dnpEl.textContent="—";
  readingCount.textContent="0/"+STABLE_FRAMES+" frames";readingNote.textContent=calibration?"Aguardando rosto":"Calibre primeiro";
  stabilityState.textContent="—";faceState.textContent="—";alignmentState.textContent="—";measurementState.textContent=calibration?"Aguardando":"Aguardando";measurementState.className="pill";useReadingBtn.disabled=true
}
async function start(){
  if(!initFaceMesh())return;
  intro.classList.add("hidden");workspace.classList.remove("hidden","measurement-mode");calibrationPanel.classList.remove("hidden");cameraControls.classList.remove("hidden");measurementRuler.classList.add("hidden");savedPanel.classList.add("hidden");settingsPanel.classList.add("hidden");
  try{await openCamera();running=true;processFrame();calibrationOverlay.classList.remove("hidden");measurementPanel.classList.add("hidden");setStep(2);calibration=null;nasalPoint={x:0,y:0};nasalConfirmed=false;nasalHandle.classList.add("hidden");calibrationState.textContent="Não calibrado";calibrationState.className="pill amber";calibrationValidation.textContent="Faça a calibração física desta sessão antes de medir.";calibrationValidation.className="validation warn";scaleValue.textContent="—";resetCalibrationHandles()}
  catch(e){console.error(e);alert("Permita o acesso à câmera no navegador e tente novamente.");resetApp()}
}
function resetApp(){running=false;stopCamera();workspace.classList.add("hidden");intro.classList.remove("hidden");calibrationOverlay.classList.add("hidden");measurementPanel.classList.add("hidden");osPanel.classList.add("hidden");savedPanel.classList.add("hidden");setStep(1);statusDot.classList.remove("active");calibration=null;resetSamples()}
function prepareOs(){
  if(!stableReading)return;selectedReading=JSON.parse(JSON.stringify(stableReading));osDnp.textContent=selectedReading.dnpMm.toFixed(1)+" mm";osMono.textContent=selectedReading.odMm.toFixed(1)+" / "+selectedReading.oeMm.toFixed(1)+" mm";
  useReadingBtn.disabled=true;measurementState.textContent="DNP selecionada";measurementState.className="pill green";readingNote.textContent="Leitura congelada para a O.S.";setStep(4);osPanel.classList.remove("hidden");osPanel.scrollIntoView({behavior:"smooth",block:"start"})
}
confirmNasalBtn.addEventListener("click",()=>{if(!nasalPoint.x)return;nasalConfirmed=true;confirmNasalBtn.disabled=true;nasalReferenceValue.textContent="0,0 mm • ponto fixado na ponte";readingNote.textContent="Ponto 0 fixado. Mantenha a cabeça imóvel.";resetSamples()});
repositionNasalBtn.addEventListener("click",()=>{nasalConfirmed=false;confirmNasalBtn.disabled=false;readingNote.textContent="Arraste o marcador amarelo até o apoio da ponte";resetSamples()});
useReadingBtn.addEventListener("click",prepareOs);$("newReadingBtn").addEventListener("click",()=>{resetSamples();setStep(3)});
startBtn.addEventListener("click",start);frontBtn.addEventListener("click",()=>selectCamera("user"));rearBtn.addEventListener("click",()=>selectCamera("environment"));

function nextOsNumber(){const day=new Date().toISOString().slice(0,10).replaceAll("-",""),key="mbDnpOsCounter_"+day,n=Number(localStorage.getItem(key)||0)+1;localStorage.setItem(key,String(n));return"DNP-"+day+"-"+String(n).padStart(3,"0")}
function collectRecord(){
  const reading=selectedReading||stableReading;if(!reading)return null;const name=customerName.value.trim();
  if(!name){osValidation.textContent="Informe o nome do cliente para gerar a O.S.";osValidation.className="validation error";customerName.focus();return null}
  const number=currentOs?.number||nextOsNumber();currentOs={number};
  return{schema:"MB.Optica.DNP.OS.v2",number,createdAt:new Date().toISOString(),customer:{name,phone:customerPhone.value.trim(),cpf:customerCpf.value.trim(),type:customerType.value,notes:customerNotes.value.trim()},sale:{number:saleNumber.value.trim()},measurement:{odMm:reading.odMm,oeMm:reading.oeMm,dnpMm:reading.dnpMm,stabilitySdMm:reading.sdMm,nasalReferenceMm:0,referenceType:"ponte-da-armacao"},calibration:reading.calibration,source:"MB.Óptica DNP",integrationStatus:"pending"}
}
function saveRecord(){
  const record=collectRecord();if(!record)return;const list=JSON.parse(localStorage.getItem("mbDnpOrders")||"[]"),existing=list.findIndex(x=>x.number===record.number);if(existing>=0)list[existing]=record;else list.unshift(record);
  localStorage.setItem("mbDnpOrders",JSON.stringify(list));savedRecord=record;osNumber.textContent=record.number;osValidation.textContent="O.S. salva neste dispositivo.";osValidation.className="validation ok";savedPanel.classList.remove("hidden");
  $("savedTitle").textContent="O.S. "+record.number+" criada";$("savedSummary").textContent=record.customer.name+" • DNP "+record.measurement.dnpMm.toFixed(1)+" mm • OD "+record.measurement.odMm.toFixed(1)+" mm • OE "+record.measurement.oeMm.toFixed(1)+" mm.";updateLocalStats();savedPanel.scrollIntoView({behavior:"smooth",block:"start"})
}
$("generateOsBtn").addEventListener("click",saveRecord);
$("saveDraftBtn").addEventListener("click",()=>{const record=collectRecord();if(!record)return;record.integrationStatus="draft";const list=JSON.parse(localStorage.getItem("mbDnpOrders")||"[]"),existing=list.findIndex(x=>x.number===record.number);if(existing>=0)list[existing]=record;else list.unshift(record);localStorage.setItem("mbDnpOrders",JSON.stringify(list));osNumber.textContent=record.number;osValidation.textContent="Rascunho "+record.number+" salvo localmente.";osValidation.className="validation ok";updateLocalStats()});

$("printBtn").addEventListener("click",()=>{
  if(!savedRecord)return;const w=window.open("","_blank","width=800,height=900");if(!w){alert("O navegador bloqueou a janela de impressão.");return}const r=savedRecord;
  w.document.write("<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><title>"+r.number+"</title><style>body{font-family:Arial;color:#111;padding:36px;max-width:760px;margin:auto}h1{margin:0 0 4px}h2{margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}.muted{color:#666;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}.box{border:1px solid #ccc;padding:14px;border-radius:8px}.label{font-size:11px;color:#666}.value{font-size:20px;font-weight:700;margin-top:5px}table{width:100%;border-collapse:collapse;margin-top:14px}td,th{border:1px solid #ddd;padding:9px;text-align:left}.footer{margin-top:40px;font-size:11px;color:#666}</style></head><body><h1>MB.Óptica</h1><div class='muted'>Ordem de Serviço • "+r.number+"</div><h2>Cliente</h2><p><b>"+escapeHtml(r.customer.name)+"</b><br>Telefone: "+escapeHtml(r.customer.phone||"—")+"<br>CPF: "+escapeHtml(r.customer.cpf||"—")+"<br>Tipo: "+escapeHtml(r.customer.type)+"</p><h2>Medição DNP</h2><div class='grid'><div class='box'><div class='label'>OD</div><div class='value'>"+r.measurement.odMm.toFixed(1)+" mm</div></div><div class='box'><div class='label'>OE</div><div class='value'>"+r.measurement.oeMm.toFixed(1)+" mm</div></div><div class='box'><div class='label'>DNP</div><div class='value'>"+r.measurement.dnpMm.toFixed(1)+" mm</div></div></div><h2>Referência da medição</h2><table><tr><th>Ponto 0</th><td>Ponte da armação</td></tr><tr><th>Estabilidade</th><td>±"+r.measurement.stabilitySdMm.toFixed(2)+" mm</td></tr><tr><th>Plano métrico</th><td>"+r.calibration.widthMm.toFixed(1)+" × "+r.calibration.heightMm.toFixed(2)+" mm • 4 pontos + homografia</td></tr></table><h2>Observações</h2><p>"+escapeHtml(r.customer.notes||"—")+"</p><div class='footer'>MB.Óptica DNP • registro local • validar conforme protocolo da ótica.</div></body></html>");
  w.document.close();w.focus();w.print()
});
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]))}
$("anotherBtn").addEventListener("click",()=>{customerName.value="";customerPhone.value="";customerCpf.value="";saleNumber.value="";customerNotes.value="";currentOs=null;savedRecord=null;savedPanel.classList.add("hidden");osPanel.classList.add("hidden");invalidateCalibration("Novo atendimento: faça uma nova calibração para a posição atual.");workspace.scrollIntoView({behavior:"smooth"})});
$("settingsBtn").addEventListener("click",()=>{settingsPanel.classList.toggle("hidden");updateLocalStats()});
$("closeSettingsBtn").addEventListener("click",()=>settingsPanel.classList.add("hidden"));
$("clearLocalBtn").addEventListener("click",()=>{if(!confirm("Limpar calibração e O.S. salvas neste dispositivo?"))return;localStorage.removeItem("mbDnpCalibration");localStorage.removeItem("mbDnpCalibrationLabel");localStorage.removeItem("mbDnpOrders");calibration=null;updateLocalStats();if(running)invalidateCalibration("Dados locais limpos. Faça uma nova calibração.")});
function updateLocalStats(){$("lastCalibration").textContent=localStorage.getItem("mbDnpCalibrationLabel")||"Nenhuma";const list=JSON.parse(localStorage.getItem("mbDnpOrders")||"[]");$("localCount").textContent=String(list.length)}
updateLocalStats();setStep(1);