window.__MB_DNP_V37__=true;
const $=id=>document.getElementById(id);
const el={
  intro:$('intro'),workspace:$('workspace'),start:$('startBtn'),startError:$('startError'),statusDot:$('statusDot'),settings:$('settingsBtn'),
  viewer:$('viewer'),video:$('video'),canvas:$('overlay'),capture:$('captureBadge'),viewerDnp:$('viewerDnp'),viewerOsBtn:$('viewerOsBtn'),osClose:$('osCloseBtn'),cameraStatus:$('cameraStatus'),cameraQuality:$('cameraQuality'),front:$('frontBtn'),rear:$('rearBtn'),
  faceState:$('faceState'),faceMetric:$('faceMetric'),poseMetric:$('poseMetric'),scaleMetric:$('scaleMetric'),stabilityMetric:$('stabilityMetric'),rightMetric:$('rightMetric'),noseMetric:$('noseMetric'),leftMetric:$('leftMetric'),biometricNote:$('biometricNote'),
  measurementState:$('measurementState'),od:$('od'),oe:$('oe'),dnp:$('dnp'),readingCount:$('readingCount'),readingNote:$('readingNote'),zeroMetric:$('zeroMetric'),newReading:$('newReadingBtn'),useReading:$('useReadingBtn'),
  osPanel:$('osPanel'),name:$('customerName'),phone:$('customerPhone'),cpf:$('customerCpf'),sale:$('saleNumber'),type:$('customerType'),notes:$('customerNotes'),osNumber:$('osNumber'),osDnp:$('osDnp'),osMono:$('osMono'),osValidation:$('osValidation'),saveDraft:$('saveDraftBtn'),generate:$('generateOsBtn'),
  saved:$('savedPanel'),savedTitle:$('savedTitle'),savedSummary:$('savedSummary'),pdf:$('pdfBtn'),print:$('printBtn'),another:$('anotherBtn')
};
const ctx=el.canvas.getContext('2d');
const CFG={
  version:'37',stableFrames:24,detectEveryMs:110,
  odIris:473,oeIris:468,nasal:168,odOuter:263,oeOuter:33,faceLeft:234,faceRight:454,faceTop:10,faceBottom:152,
  odIrisEdges:[474,475,476,477],oeIrisEdges:[469,470,471,472],irisMm:11.7,canonicalEyeMm:88.91718,
  storeKey:'mb_dnp_facial_biometric_v37'
};
const state={engine:null,stream:null,running:false,busy:false,raf:0,lastDetectAt:0,timestamp:0,facing:'user',samples:[],reading:null,readingLocked:false,os:null,errorCount:0,pupilTrack:null};

function setStep(n){document.querySelectorAll('.step').forEach((node,i)=>{node.classList.toggle('active',i===n-1);node.classList.toggle('done',i<n-1)})}
function setPill(node,text,tone=''){node.textContent=text;node.className='pill'+(tone?' '+tone:'')}
function view(){const r=el.viewer.getBoundingClientRect();return{w:r.width,h:r.height}}
function resize(){const s=view(),d=Math.min(window.devicePixelRatio||1,2);el.canvas.width=Math.max(1,Math.round(s.w*d));el.canvas.height=Math.max(1,Math.round(s.h*d));el.canvas.style.width=s.w+'px';el.canvas.style.height=s.h+'px';ctx.setTransform(d,0,0,d,0,0)}
function screenPoint(p){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return null;const s=view();return{x:(1-p.x)*s.w,y:p.y*s.h}}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function median(values){if(!values.length)return 0;const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function deviation(values){if(values.length<2)return 0;const m=values.reduce((a,b)=>a+b,0)/values.length;return Math.sqrt(values.reduce((a,b)=>a+(b-m)**2,0)/values.length)}
function clamp(v,min,max){return Math.min(max,Math.max(min,v))}
function showStartError(message){el.startError.textContent=message;el.startError.className='start-error';el.start.disabled=false;el.start.textContent='Tentar novamente'}
function clearStartError(){el.startError.textContent='';el.startError.className='start-error hidden'}

function irisDiameter(lm,centerIndex,edgeIndexes){
  const center=screenPoint(lm[centerIndex]);
  if(!center)return null;
  const radii=edgeIndexes.map(i=>{const p=screenPoint(lm[i]);return p?distance(center,p):null}).filter(Number.isFinite);
  return radii.length===4?2*radii.reduce((a,b)=>a+b,0)/4:null;
}
function fixedNasalPoint(){
  const s=view();
  return{x:s.w*.5,y:s.h*.48};
}
function smoothPoint(previous,current,alpha=.62){
  if(!previous)return{x:current.x,y:current.y};
  return{x:previous.x+(current.x-previous.x)*alpha,y:previous.y+(current.y-previous.y)*alpha};
}
function trackPupils(g){
  state.pupilTrack={
    r:smoothPoint(state.pupilTrack?.r,g.r,.62),
    l:smoothPoint(state.pupilTrack?.l,g.l,.62)
  };
  return state.pupilTrack;
}
function anatomy(lm,tracked=null){
  const rawR=screenPoint(lm[CFG.odIris]),rawL=screenPoint(lm[CFG.oeIris]),n=screenPoint(lm[CFG.nasal]),ro=screenPoint(lm[CFG.odOuter]),lo=screenPoint(lm[CFG.oeOuter]);
  const r=tracked?.r||rawR,l=tracked?.l||rawL;
  const fl=screenPoint(lm[CFG.faceLeft]),fr=screenPoint(lm[CFG.faceRight]),ft=screenPoint(lm[CFG.faceTop]),fb=screenPoint(lm[CFG.faceBottom]);
  if([r,l,n,ro,lo,fl,fr,ft,fb].some(p=>!p))return null;
  const axis={x:l.x-r.x,y:l.y-r.y},len=Math.hypot(axis.x,axis.y)||1,u={x:axis.x/len,y:axis.y/len};
  const midpoint={x:(r.x+l.x)/2,y:(r.y+l.y)/2};
  const eyeOuter=distance(ro,lo);
  const irisR=irisDiameter(lm,CFG.odIris,CFG.odIrisEdges),irisL=irisDiameter(lm,CFG.oeIris,CFG.oeIrisEdges);
  if(!Number.isFinite(irisR)||!Number.isFinite(irisL)||irisR<4||irisL<4||eyeOuter<40)return null;
  const irisPx=(irisR+irisL)/2;
  const irisScale=CFG.irisMm/irisPx;
  const faceScale=CFG.canonicalEyeMm/eyeOuter;
  const mmPerPx=irisScale*.65+faceScale*.35;
  const roll=Math.atan2(axis.y,Math.abs(axis.x))*180/Math.PI;
  const noseOffset=((n.x-midpoint.x)*u.x+(n.y-midpoint.y)*u.y)/(eyeOuter/2);
  const yawDeg=Math.asin(clamp(noseOffset,-.85,.85))*180/Math.PI;
  const correction=1/Math.max(.82,Math.cos(yawDeg*Math.PI/180));
  const anchor=fixedNasalPoint();
  const project=(p,origin=anchor)=>(p.x-origin.x)*u.x+(p.y-origin.y)*u.y;
  const pa=project(anchor),pr=project(r),pl=project(l);
  const od=Math.abs(pr-pa)*mmPerPx*correction,oe=Math.abs(pl-pa)*mmPerPx*correction;
  const dnp=od+oe;
  const anchorDistance=distance(n,anchor);
  const anchorTolerance=Math.max(30,distance(fl,fr)*.10);
  const aligned=anchorDistance<=anchorTolerance;
  const valid=roll<=7&&Math.abs(yawDeg)<=12&&od>=15&&od<=45&&oe>=15&&oe<=45&&dnp>=45&&dnp<=90&&aligned;
  return{r,l,n,anchor,anchorDistance,anchorTolerance,aligned,ro,lo,fl,fr,ft,fb,eyeOuter,irisR,irisL,irisPx,mmPerPx,roll,yawDeg,od,oe,dnp,valid};
}

function draw(lm,g){
  const s=view();ctx.clearRect(0,0,s.w,s.h);
  for(let i=0;i<lm.length;i+=5){const p=screenPoint(lm[i]);if(p){ctx.beginPath();ctx.arc(p.x,p.y,1.1,0,Math.PI*2);ctx.fillStyle='rgba(102,211,255,.34)';ctx.fill()}}
  const outline=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,400,377,152,234,93,132,58,172,136,150,149,176,148,10];
  for(let i=0;i<outline.length-1;i++){const a=screenPoint(lm[outline[i]]),b=screenPoint(lm[outline[i+1]]);if(a&&b){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='rgba(122,222,255,.46)';ctx.lineWidth=1;ctx.stroke()}}
  const anchor=g.anchor||fixedNasalPoint();
  [[g.r,g.l,'rgba(255,255,255,.6)'],[anchor,g.r,'rgba(255,204,102,.85)'],[anchor,g.l,'rgba(255,204,102,.85)']].forEach(([a,b,color])=>{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke()});
  ctx.beginPath();ctx.arc(anchor.x,anchor.y,7,0,Math.PI*2);ctx.strokeStyle='rgba(255,204,102,.95)';ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.moveTo(anchor.x-10,anchor.y);ctx.lineTo(anchor.x+10,anchor.y);ctx.moveTo(anchor.x,anchor.y-10);ctx.lineTo(anchor.x,anchor.y+10);ctx.strokeStyle='rgba(255,204,102,.72)';ctx.lineWidth=1;ctx.stroke();
  [[g.r,'#55d6ff'],[g.l,'#55d6ff']].forEach(([p,color])=>{ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.strokeStyle='rgba(85,214,255,.35)';ctx.lineWidth=1.5;ctx.stroke()});
}
function resetMeasurement(){
  state.samples=[];state.reading=null;state.readingLocked=false;state.pupilTrack=null;el.useReading.disabled=true;el.viewerDnp.textContent='—';el.viewerOsBtn.disabled=true;el.viewerOsBtn.textContent='Gerar O.S. DNP';
  el.od.textContent='—';el.oe.textContent='—';el.dnp.textContent='—';el.zeroMetric.textContent='—';
  el.readingCount.textContent='0/'+CFG.stableFrames+' quadros';el.readingNote.textContent='Aguardando captura';
  setPill(el.measurementState,'Aguardando');setPill(el.stabilityMetric,'—');el.biometricNote.textContent='Aguardando o rosto.';
}
function updateBiometric(g){
  el.faceMetric.textContent=Math.round(distance(g.fl,g.fr))+' × '+Math.round(distance(g.ft,g.fb))+' px';
  const poseOk=Math.abs(g.roll)<=10&&Math.abs(g.yawDeg)<=18;
  setPill(el.faceState,'Mapeado','green');setPill(el.poseMetric,poseOk?'Frontal':'Ajustar',poseOk?'green':'amber');
  el.scaleMetric.textContent=g.mmPerPx.toFixed(3)+' mm/px';
  el.rightMetric.textContent=g.r.x.toFixed(0)+', '+g.r.y.toFixed(0);el.leftMetric.textContent=g.l.x.toFixed(0)+', '+g.l.y.toFixed(0);el.noseMetric.textContent=g.n.x.toFixed(0)+', '+g.n.y.toFixed(0);
  if(state.readingLocked&&state.reading){return;}
  if(g.valid){state.samples.push(g);if(state.samples.length>CFG.stableFrames)state.samples.shift();el.biometricNote.textContent='Face, íris e pose válidos • acumulando sequência estável.'}
  else{el.biometricNote.textContent=g.aligned?'Rosto detectado • ajuste posição/pose para validar a medição.':'Ajuste o rosto até a ponte nasal coincidir com o marcador fixo.'}
  el.readingCount.textContent=state.samples.length+'/'+CFG.stableFrames+' quadros';
  if(state.samples.length<CFG.stableFrames){setPill(el.stabilityMetric,'Capturando');setPill(el.measurementState,'Capturando')}
  if(state.samples.length===CFG.stableFrames){
    const od=median(state.samples.map(x=>x.od)),oe=median(state.samples.map(x=>x.oe)),dnp=od+oe,spread=Math.max(deviation(state.samples.map(x=>x.od)),deviation(state.samples.map(x=>x.oe)),deviation(state.samples.map(x=>x.dnp)));
    state.reading={od,oe,dnp,spread,frames:CFG.stableFrames,scale:median(state.samples.map(x=>x.mmPerPx)),roll:median(state.samples.map(x=>x.roll)),yaw:median(state.samples.map(x=>x.yawDeg)),method:'facial-landmarker+iris-eye-scale'};
    el.od.textContent=od.toFixed(1)+' mm';el.oe.textContent=oe.toFixed(1)+' mm';el.dnp.textContent=dnp.toFixed(1)+' mm';el.viewerDnp.textContent=dnp.toFixed(1)+' mm';el.viewerOsBtn.disabled=false;el.zeroMetric.textContent='168 • automático';el.readingNote.textContent=spread<=.35?'24 quadros • variação baixa':'24 quadros • variação aceitável';setPill(el.stabilityMetric,spread<=.35?'Excelente':'Boa','green');setPill(el.measurementState,'Leitura pronta','green');el.useReading.disabled=false;
  }
}

async function loadEngine(){
  if(state.engine)return;
  const {FilesetResolver,FaceLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs');
  const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  const common={runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:true,minFaceDetectionConfidence:.55,minFacePresenceConfidence:.55,minTrackingConfidence:.55};
  const model='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  try{state.engine=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:model,delegate:'GPU'},...common})}
  catch(gpuError){console.warn('MB DNP GPU:',gpuError);state.engine=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:model,delegate:'CPU'},...common})}
  if(!state.engine)throw new Error('Motor facial não foi criado.');
}
async function startCamera(facing){
  stopCamera();state.facing=facing;
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Este navegador não disponibilizou acesso à câmera.');
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}},audio:false});
  state.stream=stream;el.video.srcObject=stream;await el.video.play();resize();
  state.running=true;state.busy=false;state.lastDetectAt=0;state.timestamp=0;state.errorCount=0;el.statusDot.classList.add('on');setPill(el.cameraQuality,'Ativa','green');el.cameraStatus.textContent='Câmera ativa • procurando rosto';el.capture.textContent='PROCURANDO ROSTO';requestLoop();
}
function stopCamera(){
  state.running=false;state.busy=false;if(state.raf)cancelAnimationFrame(state.raf);state.raf=0;
  if(state.stream){state.stream.getTracks().forEach(track=>track.stop());state.stream=null}
  el.statusDot.classList.remove('on');
}
function requestLoop(){if(state.running)state.raf=requestAnimationFrame(detectLoop)}
function detectLoop(now){
  if(!state.running)return;
  state.raf=requestAnimationFrame(detectLoop);
  if(state.busy||now-state.lastDetectAt<CFG.detectEveryMs)return;
  if(!state.engine||el.video.readyState<2||!el.video.videoWidth)return;
  state.busy=true;state.lastDetectAt=now;
  try{
    state.timestamp=Math.max(Math.round(now),state.timestamp+1);
    const result=state.engine.detectForVideo(el.video,state.timestamp);
    const lm=result?.faceLandmarks?.[0];
    if(!lm){
      state.pupilTrack=null;
      ctx.clearRect(0,0,view().w,view().h);setPill(el.faceState,'Sem rosto','amber');setPill(el.cameraQuality,'Sem rosto','amber');el.capture.textContent='APROXIME O ROSTO';el.cameraStatus.textContent='Câmera ativa • procurando rosto';el.biometricNote.textContent='Nenhum rosto válido no enquadramento.';resetLiveMeasurementState();return;
    }
    const raw=anatomy(lm);
    if(!raw){setPill(el.faceState,'Analisando','amber');el.capture.textContent='ANALISANDO ROSTO';el.cameraStatus.textContent='Câmera ativa • refinando olhos e íris';return}
    const g=anatomy(lm,trackPupils(raw));
    draw(lm,g);updateBiometric(g);setPill(el.cameraQuality,g.valid?'Boa captura':'Ajustar',g.valid?'green':'amber');el.capture.textContent=g.valid?'ROSTO MAPEADO':(g.aligned?'AJUSTE DE POSE':'ALINHE A PONTE');el.cameraStatus.textContent=g.valid?'Câmera ativa • leitura facial válida':(g.aligned?'Câmera ativa • ajuste o rosto':'Centralize a ponte nasal no marcador fixo');state.errorCount=0;
  }catch(error){
    state.errorCount++;console.error('MB DNP detection:',error);setPill(el.cameraQuality,'Erro facial','amber');el.capture.textContent='ERRO MOMENTÂNEO';el.cameraStatus.textContent='Motor facial tentando novamente';if(state.errorCount>=5)el.biometricNote.textContent='O motor facial encontrou erros repetidos. Reinicie a leitura se persistir.';
  }finally{state.busy=false}
}
function resetLiveMeasurementState(){
  if(state.samples.length===0)return;
  state.samples=[];state.reading=null;el.useReading.disabled=true;el.viewerDnp.textContent='—';el.viewerOsBtn.disabled=true;el.viewerOsBtn.textContent='Gerar O.S. DNP';el.readingCount.textContent='0/'+CFG.stableFrames+' quadros';el.od.textContent='—';el.oe.textContent='—';el.dnp.textContent='—';setPill(el.measurementState,'Aguardando');setPill(el.stabilityMetric,'—');
}

async function start(){
  clearStartError();el.start.disabled=true;el.start.textContent='Carregando motor facial…';
  try{await loadEngine();el.intro.classList.add('hidden');el.workspace.classList.remove('hidden');setStep(1);resetMeasurement();el.cameraStatus.textContent='Solicitando câmera…';await startCamera('user')}
  catch(error){stopCamera();el.workspace.classList.add('hidden');el.intro.classList.remove('hidden');showStartError('Não foi possível iniciar: '+(error?.message||String(error)));console.error('MB DNP start:',error)}
}
async function switchCamera(facing){
  if(!state.engine||!state.running)return;
  el.front.classList.toggle('active',facing==='user');el.rear.classList.toggle('active',facing==='environment');el.front.disabled=true;el.rear.disabled=true;el.cameraStatus.textContent='Trocando câmera…';
  try{resetMeasurement();await startCamera(facing)}catch(error){el.cameraStatus.textContent='Não foi possível trocar a câmera: '+(error?.message||String(error));setPill(el.cameraQuality,'Erro','amber')}
  finally{el.front.disabled=false;el.rear.disabled=false}
}

function osNumber(){return'MB-DNP-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+String(Math.floor(1000+Math.random()*9000))}
function escapeHtml(value){return String(value??'').replace(/[&<>'\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[ch]))}
function buildOS(status='rascunho'){
  if(!state.reading)return null;
  const existing=state.os||{};
  return{id:existing.id||crypto.randomUUID?.()||String(Date.now()),number:existing.number||osNumber(),status,schema:'MB.Optica.DNP.OS.v37',createdAt:existing.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),customer:{name:el.name.value.trim(),phone:el.phone.value.trim(),cpf:el.cpf.value.trim(),saleNumber:el.sale.value.trim(),type:el.type.value,notes:el.notes.value.trim()},measurement:{method:state.reading.method,odMm:state.reading.od,oeMm:state.reading.oe,dnpMm:state.reading.dnp,frames:state.reading.frames,stabilityMm:state.reading.spread,scaleMmPerPx:state.reading.scale,pose:{roll:state.reading.roll,yaw:state.reading.yaw},reference:'fixed-field-nasal-bridge'}};
}
function persistOS(status){const os=buildOS(status);if(!os)return null;const list=JSON.parse(localStorage.getItem(CFG.storeKey)||'[]');const index=list.findIndex(item=>item.id===os.id);if(index>=0)list[index]=os;else list.push(os);localStorage.setItem(CFG.storeKey,JSON.stringify(list));state.os=os;return os}
function validateCustomer(){if(!el.name.value.trim()){el.osValidation.textContent='Informe o nome do cliente.';el.osValidation.className='validation error';el.osValidation.classList.remove('hidden');el.name.focus();return false}el.osValidation.className='validation hidden';return true}

el.start.addEventListener('click',start);
el.front.addEventListener('click',()=>switchCamera('user'));el.rear.addEventListener('click',()=>switchCamera('environment'));window.addEventListener('resize',resize);
el.newReading.addEventListener('click',()=>{resetMeasurement();setStep(3);el.biometricNote.textContent='Nova sequência facial iniciada.'});
function openOsPanel(){if(!state.reading)return;state.readingLocked=true;el.viewerDnp.textContent=state.reading.dnp.toFixed(1)+' mm';el.viewerOsBtn.textContent='DNP bloqueada • O.S.';el.osPanel.classList.remove('hidden');el.osPanel.classList.add('floating-os');document.body.classList.add('os-open');document.documentElement.classList.add('os-open');el.osDnp.textContent=state.reading.dnp.toFixed(1)+' mm';el.osMono.textContent=state.reading.od.toFixed(1)+' / '+state.reading.oe.toFixed(1)+' mm';el.osNumber.textContent='Será gerada';setStep(4)}
function closeOsPanel(){el.osPanel.classList.add('hidden');el.osPanel.classList.remove('floating-os');document.body.classList.remove('os-open');document.documentElement.classList.remove('os-open')}
el.useReading.addEventListener('click',openOsPanel);
el.viewerOsBtn.addEventListener('click',openOsPanel);
el.osClose.addEventListener('click',closeOsPanel);
el.saveDraft.addEventListener('click',()=>{if(!validateCustomer())return;const os=persistOS('rascunho');el.osNumber.textContent=os.number;el.osValidation.textContent='Rascunho salvo neste dispositivo: '+os.number;el.osValidation.className='validation ok';el.osValidation.classList.remove('hidden')});
async function loadPdfLibrary(){if(window.jspdf?.jsPDF)return window.jspdf.jsPDF;if(loadPdfLibrary.promise)return loadPdfLibrary.promise;loadPdfLibrary.promise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';s.onload=()=>window.jspdf?.jsPDF?resolve(window.jspdf.jsPDF):reject(new Error('jsPDF carregou sem disponibilizar o motor PDF.'));s.onerror=()=>reject(new Error('Não foi possível carregar o motor PDF.'));document.head.appendChild(s)});return loadPdfLibrary.promise}
async function generatePdf(os){const jsPDF=await loadPdfLibrary();if(!jsPDF)throw new Error('Biblioteca PDF não carregada.');const doc=new jsPDF({unit:'mm',format:'a4'}),m=os.measurement,c=os.customer;doc.setFont('helvetica','bold');doc.setFontSize(20);doc.text('MB.Óptica',20,22);doc.setFontSize(13);doc.text('ORDEM DE SERVIÇO — DNP',20,31);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(os.number,190,22,{align:'right'});doc.line(20,36,190,36);doc.setFontSize(11);doc.setFont('helvetica','bold');doc.text('CLIENTE',20,47);doc.setFont('helvetica','normal');doc.text('Nome: '+(c.name||'—'),20,55);doc.text('Telefone: '+(c.phone||'—'),20,62);doc.text('CPF: '+(c.cpf||'—'),20,69);doc.text('Nº da venda: '+(c.saleNumber||'—'),20,76);doc.text('Tipo: '+(c.type||'—'),20,83);doc.setFont('helvetica','bold');doc.text('MEDIÇÃO FACIAL DA DNP',20,96);doc.setFont('helvetica','normal');doc.setFontSize(18);doc.text('DNP: '+m.dnpMm.toFixed(1)+' mm',20,108);doc.setFontSize(13);doc.text('OD: '+m.odMm.toFixed(1)+' mm     OE: '+m.oeMm.toFixed(1)+' mm',20,117);doc.setFontSize(10);doc.text('Estabilidade: '+m.stabilityMm.toFixed(2)+' mm',20,127);doc.text('Quadros analisados: '+m.frames,20,134);doc.text('Método: Face Landmarker + referência fixa de ponte + escala combinada de íris/face',20,141);doc.text('Referência fixa do campo biométrico • ponte alinhada ao marcador',20,148);doc.text('Pose — roll: '+m.pose.roll.toFixed(1)+'°  yaw: '+m.pose.yaw.toFixed(1)+'°',20,155);if(c.notes){doc.setFont('helvetica','bold');doc.text('OBSERVAÇÕES',20,168);doc.setFont('helvetica','normal');const lines=doc.splitTextToSize(c.notes,170);doc.text(lines,20,176)}doc.setFontSize(8);doc.setTextColor(90);doc.text('MB.Óptica DNP • documento gerado localmente neste dispositivo',20,285);doc.save(os.number+'.pdf');return true}
el.generate.addEventListener('click',async()=>{if(!validateCustomer())return;const os=persistOS('gerada');el.osNumber.textContent=os.number;el.savedTitle.textContent='O.S. '+os.number;el.savedSummary.textContent=os.customer.name+' • DNP '+os.measurement.dnpMm.toFixed(1)+' mm • OD '+os.measurement.odMm.toFixed(1)+' mm • OE '+os.measurement.oeMm.toFixed(1)+' mm.';closeOsPanel();el.saved.classList.remove('hidden');setStep(4);try{await generatePdf(os);el.savedSummary.textContent+=' PDF gerado automaticamente.';el.pdf.textContent='Gerar PDF novamente'}catch(error){console.error('MB DNP PDF:',error);el.savedSummary.textContent+=' O.S. registrada. O PDF automático não foi gerado; use o botão Gerar PDF.'}});
el.pdf.addEventListener('click',async()=>{if(!state.os)return;el.pdf.disabled=true;el.pdf.textContent='Gerando PDF…';try{await generatePdf(state.os);el.pdf.textContent='PDF gerado';}catch(error){console.error('MB DNP PDF:',error);el.pdf.textContent='Falha ao gerar PDF';}finally{setTimeout(()=>{el.pdf.disabled=false;el.pdf.textContent='Gerar PDF novamente'},1400)}});
el.print.addEventListener('click',()=>{if(!state.os)return;const os=state.os,m=os.measurement,c=os.customer,w=window.open('','_blank','width=800,height=700');if(!w)return;w.document.write('<!doctype html><html><head><title>'+escapeHtml(os.number)+'</title><style>body{font-family:Arial;padding:32px;color:#111}.box{border:1px solid #aaa;padding:16px;margin:12px 0}.big{font-size:28px;font-weight:800}</style></head><body><h1>MB.Óptica — O.S.</h1><div>'+escapeHtml(os.number)+'</div><div class="box"><b>Cliente</b><br>'+escapeHtml(c.name)+'<br>'+escapeHtml(c.phone)+' '+escapeHtml(c.cpf)+'</div><div class="box"><b>Leitura facial</b><div class="big">DNP '+m.dnpMm.toFixed(1)+' mm</div>OD '+m.odMm.toFixed(1)+' mm • OE '+m.oeMm.toFixed(1)+' mm</div><div class="box">Método: Face Landmarker + referência fixa de ponte • '+m.frames+' quadros</div></body></html>');w.document.close();w.focus();w.print()});
el.another.addEventListener('click',()=>{stopCamera();location.reload()});
el.settings.addEventListener('click',()=>alert('MB DNP v36\n\nLeitura facial local com MediaPipe Face Landmarker.\nNenhuma imagem do rosto é salva pelo aplicativo.\nOs dados da O.S. ficam no armazenamento local deste dispositivo.\n\nA medição deve ser validada contra instrumento de referência antes do uso profissional.'));
window.addEventListener('beforeunload',stopCamera);
resize();
