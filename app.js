(function(){
'use strict';

/* =========================================================
   1. 설정값 (팀에서 확정되면 여기만 바꾸면 됩니다)
   ========================================================= */
var CFG = {
  VAC_LIMIT: 1e-2,   // [기준값] 진공도 주의 기준 (Pa) - 팀 확정 전 임시값
  EPS_EFF: 0.0928,   // MLI 없을 때 진공층 유효 방사율
  MLI_K: 0.38,       // MLI 층당 저감 계수: q = q0 / (1 + k x 층수)
  GAS_G: 0.738,      // 자유분자 영역 잔류가스 전도 W/(m2.Pa.K)
  GAS_H: 0.306,      // 압력이 높아질 때 잔류가스 전도 상한 W/(m2.K)
  SIGMA: 5.670e-8,
  REF_DT: 278        // 지지대 열전도 적분값의 기준 온도차 (25 C -> -253 C)
};
var FLUIDS = {
  LH2:{label:'LH2 액화수소', short:'LH2', T:-253, latent:446},
  LN2:{label:'LN2 액화질소', short:'LN2', T:-196, latent:199},
  LNG:{label:'LNG 액화천연가스', short:'LNG', T:-162, latent:510}
};
var SUPMAT = {
  'G10':{kint:157, area:60, len:30},
  'PTFE':{kint:60, area:150, len:60},
  'SUS304':{kint:3000, area:20, len:120}
};
var PARTTYPES = {'밸브':2.5,'바요넷':1.2,'엘보':0.3,'플랜지':0.8,'기타':1.0};
var PIPEMATS = ['SUS316L','SUS304','알루미늄'];
var COLORS = {parts:'#22303F', rad:'#1E63B5', sup:'#D08A2E', gas:'#8DBBEA', foam:'#5F7C9E'};
var TILE = {A:{bg:'#BCC5CE',dark:false}, B:{bg:'#7F98B6',dark:false}, C:{bg:'#1E63B5',dark:true}};
var GROUPS = [['project','프로젝트'],['op','운전 조건'],['seg','배관 구간'],['ins','단열 구성'],['sup','지지대'],['parts','부품']];
var GNAME = {}; GROUPS.forEach(function(g){GNAME[g[0]]=g[1];});
var STORE_KEY = 'nexergy-ui-v2';

function defaults(){
  return {
    project:{name:'○○ 액화수소충전소 이송배관 (예시)', author:'Nexergy', date:'2026-10-30', memo:''},
    op:{fluid:'LH2', pressure:'2.0', ambient:'25', hours:'8,760', price:'10,000', recovery:'0'},
    segs:[
      {name:'A 탱크→펌프', len:'12.0', iod:'48.6', it:'2.0', ood:'114.3', ot:'3.0', mat:'SUS316L'},
      {name:'B 펌프→디스펜서', len:'25.0', iod:'34.0', it:'1.65', ood:'89.1', ot:'3.0', mat:'SUS316L'},
      {name:'C 리턴', len:'8.0', iod:'34.0', it:'1.65', ood:'89.1', ot:'3.0', mat:'SUS316L'}
    ],
    ins:{method:'mli', mli:'20', vm:'1.0', ve:'-3', foamT:'50', foamK:'0.020'},
    sup:{mat:'G10', spacing:'2.0', area:'60', len:'30', kint:'157'},
    parts:[{type:'밸브',qty:'4',w:'2.5'},{type:'바요넷',qty:'6',w:'1.2'},{type:'엘보',qty:'8',w:'0.3'}],
    ui:{tab:'input', calcOpen:false, adv:false, metric:'heat', logY:true, base:'A',
        pbBase:'B', pbAlt:'C', invest:'30,000,000', rep:{cmp:true,pb:true,asm:true}, zoom:'fit', hs:false}
  };
}

var state = load();

function load(){
  var d = defaults();
  try{
    var raw = window.localStorage.getItem(STORE_KEY);
    if(raw){
      var s = JSON.parse(raw);
      ['project','op','ins','sup','ui'].forEach(function(k){ if(s[k]) d[k]=Object.assign(d[k], s[k]); });
      if(Array.isArray(s.segs)) d.segs = s.segs;
      if(Array.isArray(s.parts)) d.parts = s.parts;
      d.ui.rep = Object.assign({cmp:true,pb:true,asm:true}, d.ui.rep||{});
    }
  }catch(e){}
  return d;
}
/* 자동 저장: 값이 바뀔 때마다 바로 저장. 저장이 막힌 환경이면 상단에 알려 줌 */
var STORE_OK=(function(){
  try{ var k='__nx_test'; window.localStorage.setItem(k,'1'); var ok=window.localStorage.getItem(k)==='1'; window.localStorage.removeItem(k); return ok; }
  catch(e){ return false; }
})();
var lastSaved='';
function writeStore(){
  if(!STORE_OK) return false;
  try{ window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); lastSaved=new Date(); return true; }
  catch(e){ STORE_OK=false; return false; }
}
function saveLabel(){
  if(!STORE_OK) return '자동 저장 안 됨';
  if(!lastSaved) return '자동 저장 켜짐';
  var z=function(n){return (n<10?'0':'')+n;};
  return '자동 저장됨 '+z(lastSaved.getHours())+':'+z(lastSaved.getMinutes())+':'+z(lastSaved.getSeconds());
}
function paintSaved(){
  var el=document.getElementById('saved-txt'), box=document.getElementById('saved-box');
  if(el) el.textContent=saveLabel();
  if(box){ box.classList.toggle('off',!STORE_OK); box.title=STORE_OK?'입력값을 이 브라우저에 저장합니다. 새로고침하거나 다시 열어도 그대로 남습니다.':'지금 여는 화면(미리보기, 시크릿 창 등)은 브라우저 저장이 막혀 있습니다. 파일을 크롬·엣지에서 직접 열면 저장됩니다.'; }
}
function save(){ writeStore(); paintSaved(); }
window.addEventListener('pagehide',writeStore);
window.addEventListener('beforeunload',writeStore);

/* =========================================================
   2. 숫자 / 표기 도우미
   ========================================================= */
function num(s){
  if(s===null||s===undefined) return NaN;
  s=String(s).replace(/,/g,'').replace(/[−–]/g,'-').trim();
  if(s===''||s==='-') return NaN;
  var n=Number(s); return isFinite(n)?n:NaN;
}
function comma(n,dec){
  if(!isFinite(n)) return '–';
  return n.toLocaleString('en-US',{minimumFractionDigits:dec||0, maximumFractionDigits:dec||0});
}
function sigDec(v){ if(v===0) return 0; var d=Math.floor(Math.log10(Math.abs(v)))+1; return Math.max(0,3-d); }
function sig3v(v){ if(!isFinite(v)||v===0) return v; var d=sigDec(v); var m=Math.pow(10,3-(Math.floor(Math.log10(Math.abs(v)))+1)); return Math.round(v*m)/m; }
function fs3(v){ if(!isFinite(v)) return '–'; var r=sig3v(v); return comma(r, sigDec(r)); }
function fW(v){ if(!isFinite(v)) return '–'; return v>=99.95?comma(Math.round(v)):v.toFixed(1); }
function fWm(v){ return isFinite(v)?v.toFixed(3):'–'; }
function fPct(v){ return isFinite(v)?v.toFixed(1)+' %':'–'; }
function fRed(r){ if(!isFinite(r)) return '–'; var s=r<0?'−':'+'; return s+Math.abs(r).toFixed(1)+' %'; }
function fLen(v){ return Math.abs(v-Math.round(v))<1e-9?String(Math.round(v)):v.toFixed(1); }
function moneyParts(won){ // {v,u}
  if(!isFinite(won)) return {v:'–',u:''};
  var a=Math.abs(won);
  if(a>=1e8){ var x=sig3v(won/1e8); return {v:comma(x,sigDec(x)), u:'억원'}; }
  if(a>=1e4){ var y=sig3v(won)/1e4; return {v:comma(y, y<10?Math.min(2,sigDec(sig3v(won))):0), u:'만원'}; }
  return {v:comma(Math.round(won)), u:'원'};
}
function fMoney(won){ var m=moneyParts(won); return m.v+m.u; }
function fWonFull(won){ return isFinite(won)?comma(sig3v(won))+'원':'–'; }
var SUP={'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
function supStr(n){ return String(n).split('').map(function(c){return SUP[c]||c;}).join(''); }
function sciP(m,e){ return Number(m).toFixed(1)+' × 10'+supStr(e)+' Pa'; }
function sciOf(P){ if(!(P>0)) return '–'; var e=Math.floor(Math.log10(P)); var m=P/Math.pow(10,e); if(m>=9.95){m=1;e++;} return sciP(m,e); }
function fPayback(y){
  if(!isFinite(y)||y<=0) return {v:'–',u:'',txt:'회수 안 됨'};
  if(y<1){ var mo=Math.max(1,Math.round(y*12)); return {v:'약 '+mo,u:'개월',txt:'약 '+mo+'개월'}; }
  var yy=Math.floor(y), mm=Math.round((y-yy)*12); if(mm===12){yy++;mm=0;}
  return {v:'약 '+y.toFixed(1), u:'년', txt:'약 '+yy+'년'+(mm?' '+mm+'개월':'')};
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function segTag(s,i){ var n=(s.name||'').trim(); if(!n) return String.fromCharCode(65+i); return n.split(/\s+/)[0]; }

/* =========================================================
   3. 아이콘
   ========================================================= */
function ic(name,size,sw){
  size=size||16; sw=sw||2;
  var P={
    chev:'<path d="M6 9l6 6 6-6"/>',
    right:'<path d="M9 6l6 6-6 6"/>',
    left:'<path d="M15 6l-6 6 6 6"/>',
    check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    reset:'<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
    trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    cal:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    err:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.2v.3"/>',
    warn:'<path d="M10.3 4.1L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 16.8v.3"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.7v.3"/>',
    edit:'<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    doc:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    sort:'<path d="M4 6h9M4 12h6M4 18h3M17 5v14M14 16l3 3 3-3"/>',
    print:'<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
    down:'<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    tap:'<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5a1.5 1.5 0 0 1 3 0V12"/><path d="M15 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2.6-3.6a1.5 1.5 0 0 1 2.3-1.9L9 15"/>'
  };
  return '<svg class="ic" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+sw+'" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+P[name]+'</svg>';
}

/* =========================================================
   4. 검증
   ========================================================= */
function validate(st){
  var list=[], by={};
  function add(g,key,lvl,msg,sum){ var it={g:g,key:key,lvl:lvl,msg:msg,sum:sum||msg}; list.push(it); if(!by[key]||lvl==='err') by[key]=it; }
  var op=st.op, fl=FLUIDS[op.fluid]||FLUIDS.LH2;
  var amb=num(op.ambient), hrs=num(op.hours), pr=num(op.price), rec=num(op.recovery), pres=num(op.pressure);
  if(!isFinite(pres)) add('op','op.pressure','err','운전 압력을 입력하세요.');
  else if(pres<0) add('op','op.pressure','err','0 이상으로 입력하세요.','운전 압력은 0 이상으로 입력하세요.');
  if(!isFinite(amb)) add('op','op.ambient','err','외기 온도를 입력하세요.');
  else if(amb<-50||amb>60) add('op','op.ambient','err','−50~60 °C 사이로 입력하세요.','외기 온도는 −50~60 °C 사이로 입력하세요.');
  else if(amb<=fl.T) add('op','op.ambient','err','유체 온도보다 높아야 합니다.','외기 온도가 유체 온도보다 높아야 합니다.');
  if(!isFinite(hrs)) add('op','op.hours','err','연간 운전시간을 입력하세요.');
  else if(hrs<0||hrs>8760) add('op','op.hours','err','0~8,760 h 사이로 입력하세요.','연간 운전시간은 0~8,760 h 사이로 입력하세요.');
  if(!isFinite(pr)) add('op','op.price','err','유체 단가를 입력하세요.');
  else if(pr<0) add('op','op.price','err','0 이상으로 입력하세요.','유체 단가는 0 이상으로 입력하세요.');
  if(!isFinite(rec)) add('op','op.recovery','err','BOG 회수율을 입력하세요.');
  else if(rec<0||rec>100) add('op','op.recovery','err','0~100 % 사이로 입력하세요.','BOG 회수율은 0~100 % 사이로 입력하세요.');

  if(!st.segs.length) add('seg','seg.none','err','배관 구간을 하나 이상 넣으세요.');
  st.segs.forEach(function(s,i){
    var t=segTag(s,i), L=num(s.len), d=num(s.iod), th=num(s.it), D=num(s.ood), Dt=num(s.ot);
    if(!isFinite(L)) add('seg','seg.'+i+'.len','err','구간 '+t+'의 길이를 입력하세요.');
    else if(L<=0) add('seg','seg.'+i+'.len','err','구간 '+t+'의 길이는 0보다 커야 합니다.');
    if(!isFinite(d)) add('seg','seg.'+i+'.iod','err','구간 '+t+'의 내관 외경을 입력하세요.');
    else if(d<=0) add('seg','seg.'+i+'.iod','err','구간 '+t+'의 내관 외경은 0보다 커야 합니다.');
    if(!isFinite(th)) add('seg','seg.'+i+'.it','err','구간 '+t+'의 내관 두께를 입력하세요.');
    else if(th<=0||(isFinite(d)&&th>=d/2)) add('seg','seg.'+i+'.it','err','구간 '+t+'의 내관 두께가 외경에 맞지 않습니다.');
    if(st.ins.method!=='foam'){
      if(!isFinite(D)) add('seg','seg.'+i+'.ood','err','구간 '+t+'의 외관 외경을 입력하세요.');
      else if(isFinite(d)&&isFinite(Dt)&&D-2*Dt<=d) add('seg','seg.'+i+'.ood','err','구간 '+t+'의 외관 안지름이 내관 외경보다 커야 합니다.');
      if(!isFinite(Dt)) add('seg','seg.'+i+'.ot','err','구간 '+t+'의 외관 두께를 입력하세요.');
      else if(Dt<=0) add('seg','seg.'+i+'.ot','err','구간 '+t+'의 외관 두께는 0보다 커야 합니다.');
    }
  });

  var ins=st.ins;
  if(ins.method==='mli'){
    var N=num(ins.mli);
    if(!isFinite(N)) add('ins','ins.mli','err','MLI 층수를 입력하세요.');
    else if(N<1||N>100||Math.round(N)!==N) add('ins','ins.mli','err','1~100 사이 정수로 입력하세요.','MLI 층수는 1~100 사이 정수로 입력하세요.');
  }
  if(ins.method!=='foam'){
    var m=num(ins.vm), e=num(ins.ve);
    if(!isFinite(m)||!isFinite(e)) add('ins','ins.vac','err','진공도를 입력하세요.');
    else if(m<1||m>=10) add('ins','ins.vac','err','앞자리는 1 이상 10 미만으로 입력하세요.','진공도 앞자리는 1 이상 10 미만으로 입력하세요.');
    else if(Math.round(e)!==e||e<-9||e>5) add('ins','ins.vac','err','지수는 −9~5 사이 정수로 입력하세요.','진공도 지수는 −9~5 사이 정수로 입력하세요.');
    else if(m*Math.pow(10,e)>CFG.VAC_LIMIT) add('ins','ins.vac','warn','진공도가 기준값 '+sciOf(CFG.VAC_LIMIT)+'보다 나쁘면 단열 성능이 크게 떨어집니다.','진공도가 기준보다 나쁩니다. 계산에는 그대로 씁니다.');
  } else {
    var ft=num(ins.foamT), fk=num(ins.foamK);
    if(!isFinite(ft)) add('ins','ins.foamT','err','폼 두께를 입력하세요.');
    else if(ft<=0) add('ins','ins.foamT','err','0보다 크게 입력하세요.','폼 두께는 0보다 커야 합니다.');
    if(!isFinite(fk)) add('ins','ins.foamK','err','열전도도를 입력하세요.');
    else if(fk<=0||fk>1) add('ins','ins.foamK','err','0~1 W/m·K 사이로 입력하세요.','폼 열전도도는 0~1 W/m·K 사이로 입력하세요.');
  }

  if(ins.method!=='foam'){
    var sp=num(st.sup.spacing);
    if(!isFinite(sp)) add('sup','sup.spacing','err','설치 간격을 입력하세요.');
    else if(sp<0.2||sp>20) add('sup','sup.spacing','err','0.2~20 m 사이로 입력하세요.','지지대 설치 간격은 0.2~20 m 사이로 입력하세요.');
    ['area','len'].forEach(function(k){   /* 열전도 적분값은 화면에서 숨김 (재질별 자동) */
      var v=num(st.sup[k]);
      if(!isFinite(v)||v<=0) add('sup','sup.'+k,'err','0보다 큰 값을 입력하세요.','지지대 고급 설정 값을 확인하세요.');
    });
  }

  st.parts.forEach(function(p,i){
    var q=num(p.qty), w=num(p.w), nm=p.type||('부품 '+(i+1));
    if(!isFinite(q)) add('parts','part.'+i+'.qty','err',nm+'의 수량을 입력하세요.');
    else if(q<0||Math.round(q)!==q) add('parts','part.'+i+'.qty','err',nm+'의 수량은 0 이상 정수로 입력하세요.');
    if(!isFinite(w)) add('parts','part.'+i+'.w','err',nm+'의 개당 열유입을 입력하세요.');
    else if(w<0) add('parts','part.'+i+'.w','err',nm+'의 개당 열유입은 0 이상으로 입력하세요.');
  });

  var errs=list.filter(function(x){return x.lvl==='err';});
  return {list:list, by:by, errs:errs, warns:list.filter(function(x){return x.lvl==='warn';}), ok:errs.length===0};
}

/* =========================================================
   5. 계산
   ========================================================= */
function params(st){
  var fl=FLUIDS[st.op.fluid]||FLUIDS.LH2, ins=st.ins, sm=st.sup;
  var foamT=num(ins.foamT), foamK=num(ins.foamK);
  if(!(foamT>0)) foamT=50; if(!(foamK>0)) foamK=0.020;
  return {
    fluid:fl, Ta:num(st.op.ambient), Tf:fl.T, latent:fl.latent,
    hours:num(st.op.hours), price:num(st.op.price), rec:num(st.op.recovery),
    pressure:num(st.op.pressure),
    /* [Nexergy 수정] it/ood/ot(내관 두께·외관 외경·외관 두께, mm) 추가 — nexergy-calc.js가 '진공만' 복사·가스전도에 외관 치수를 씀 */
    segs:st.segs.map(function(s,i){return {name:s.name, tag:segTag(s,i), L:num(s.len), D:num(s.iod)/1000, mat:s.mat, it:num(s.it), ood:num(s.ood), ot:num(s.ot)};}),
    method:ins.method, N:num(ins.mli), P:num(ins.vm)*Math.pow(10,num(ins.ve)),
    foamT:foamT/1000, foamK:foamK,
    supMat:sm.mat, spacing:num(sm.spacing), supArea:num(sm.area), supLen:num(sm.len), supKint:num(sm.kint),
    parts:st.parts.map(function(p){return {type:p.type, qty:num(p.qty), w:num(p.w)};})
  };
}
function scenParams(st,key){
  var p=params(st);
  if(key==='A'){ p.method='foam'; }
  else if(key==='B'){ if(p.method==='mli'||p.method==='foam'){ p.method='vac'; } if(!(p.P>0)) p.P=1e-3; }
  return p;
}
function coreSample(p){ /* 화면 시연용 예시 계산 (정확성 보증 안 함) */
  var Th=p.Ta+273.15, Tc=p.Tf+273.15, dT=Th-Tc;
  var foam=p.method==='foam';
  var q0=CFG.SIGMA*(Math.pow(Th,4)-Math.pow(Tc,4))/(2/CFG.EPS_EFF-1);
  var qrad=foam?0:q0/(1+CFG.MLI_K*(p.method==='mli'?p.N:0));
  var qfm=CFG.GAS_G*p.P*dT, qmax=CFG.GAS_H*dT;
  var qgas=foam?0:qfm/(1+qfm/qmax);
  var qsup1=foam?0:p.supKint*(p.supArea*1e-6)/(p.supLen*1e-3)*(dT/CFG.REF_DT);
  var segs=p.segs.map(function(s){
    var A=Math.PI*s.D*s.L, r={name:s.name, tag:s.tag, L:s.L, rad:0,gas:0,sup:0,foam:0,nsup:0};
    if(foam){ var r1=s.D/2; r.foam=2*Math.PI*p.foamK*s.L*dT/Math.log((r1+p.foamT)/r1); }
    else { r.rad=qrad*A; r.gas=qgas*A; r.nsup=Math.max(1,Math.floor(s.L/p.spacing+1e-9)); r.sup=r.nsup*qsup1; }
    r.Q=r.rad+r.gas+r.sup+r.foam; return r;
  });
  var parts=p.parts.map(function(x){return {type:x.type, qty:x.qty, w:x.w, Q:x.qty*x.w};});
  function sum(a,k){return a.reduce(function(s,x){return s+x[k];},0);}
  var L=sum(segs,'L'), nsup=sum(segs,'nsup'), pq=sum(parts,'qty');
  var Qp=sum(parts,'Q'), Qr=sum(segs,'rad'), Qg=sum(segs,'gas'), Qs=sum(segs,'sup'), Qf=sum(segs,'foam');
  var Q=Qp+Qr+Qg+Qs+Qf;
  var bogYr=Q*p.hours*3600/(p.latent*1000), bogDay=Q*86400/(p.latent*1000);
  var loss=sig3v(bogYr)*p.price*(1-p.rec/100);
  return {p:p,dT:dT,segs:segs,parts:parts,L:L,nsup:nsup,partQty:pq,Q:Q,perM:Q/L,bogYr:bogYr,bogDay:bogDay,loss:loss,
    Qp:Qp,Qr:Qr,Qg:Qg,Qs:Qs,Qf:Qf};
}
/* =========================================================
   5-1. 계산 파일 연결: Nexergy 계산 파일로 바꿔 끼우기
   - 파일 올리기: 올린 사람의 브라우저에서만 반영 (테스트용)
   - 주소 연결: CALC_URL_DEFAULT에 주소를 적으면 페이지를 여는 모든 사람에게 반영 (공개용)
   - 계산 파일 형식: window.NexergyCalc = { name: '...', core: function (p) { return {...}; } }
   ========================================================= */
var CALC_URL_DEFAULT = '';
var CALC_SRC_KEY = 'nexergy-calc-src', CALC_NAME_KEY = 'nexergy-calc-name', CALC_URL_KEY = 'nexergy-calc-url';
var CALC_REQ = ['Q','perM','bogDay','bogYr','loss','Qp','Qr','Qs','Qg','Qf','segs','parts'];
var calc = {mode:'sample', name:'', fn:null, err:''};
var calcWarnAt = 0;
function core(p){
  if(calc.fn){
    try{
      var o = calc.fn(p);
      if(!o || typeof o !== 'object') throw new Error('core 함수가 결과 객체를 돌려주지 않았습니다');
      var miss = CALC_REQ.filter(function(k){ return o[k] === undefined; });
      if(miss.length) throw new Error('돌려준 값에 빠진 항목이 있습니다: ' + miss.join(', '));
      if(!Array.isArray(o.segs) || !Array.isArray(o.parts)) throw new Error('segs와 parts는 배열이어야 합니다');
      if(o.p === undefined) o.p = p;
      if(o.dT === undefined) o.dT = (p.Ta + 273.15) - (p.Tf + 273.15);
      if(o.L === undefined) o.L = o.segs.reduce(function(s,x){ return s + (+x.L || 0); }, 0);
      if(o.nsup === undefined) o.nsup = o.segs.reduce(function(s,x){ return s + (+x.nsup || 0); }, 0);
      if(o.partQty === undefined) o.partQty = o.parts.reduce(function(s,x){ return s + (+x.qty || 0); }, 0);
      calc.err = '';
      return o;
    }catch(e){
      calc.err = String(e && e.message || e);
      if(Date.now() - calcWarnAt > 4000){ calcWarnAt = Date.now(); setTimeout(function(){ toast('올린 계산 파일에서 오류가 나서 예시 계산으로 보여 줍니다. [계산] 메뉴에서 내용을 확인하세요.'); }, 0); }
    }
  }
  return coreSample(p);
}
function useCalcObj(obj, mode, fallbackName){
  if(!obj || typeof obj.core !== 'function') throw new Error('파일 안에 window.NexergyCalc = { core: function (p) {...} } 형식이 없습니다');
  calc = {mode:mode, name:String(obj.name || fallbackName || '계산 파일'), fn:obj.core, err:''};
  calcWarnAt = Date.now();
  core(params(state));   /* 한 번 돌려 보고 형식이 틀리면 받지 않음 */
  if(calc.err){ var m = calc.err; calc = {mode:'sample', name:'', fn:null, err:m}; throw new Error(m); }
}
function runCalcSource(code, fallbackName){
  window.NexergyCalc = undefined;
  (new Function(code))();
  useCalcObj(window.NexergyCalc, 'upload', fallbackName);
}
function loadCalcUrl(url, done){
  window.NexergyCalc = undefined;
  var sc = document.createElement('script');
  sc.src = url + (url.indexOf('?') < 0 ? '?' : '&') + 'v=' + Date.now();
  sc.onload = function(){ try{ useCalcObj(window.NexergyCalc, 'url', url); calc.url = url; done(null); }catch(e){ done(e); } };
  sc.onerror = function(){ done(new Error('주소에서 계산 파일을 불러오지 못했습니다. 주소와 공개 설정을 확인하세요.')); };
  document.head.appendChild(sc);
}
function lsGet(k){ try{ return window.localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ if(v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k,v); return true; }catch(e){ return false; } }
function calcChipHTML(){
  var on = calc.mode !== 'sample';
  var label = calc.mode === 'upload' ? '올린 계산 · ' + calc.name : calc.mode === 'url' ? '연결된 계산 · ' + calc.name : '예시 계산 (시연용)';
  return '<button type="button" class="calc-chip' + (on ? ' on' : '') + '" data-act="calc-open" title="계산 파일 올리기 · 주소 연결">' + ic(on ? 'check' : 'warn', 14) + esc(label) + '</button>';
}
var CALC_EXAMPLE = "window.NexergyCalc = {\n  name: 'Nexergy 계산 v1',\n  core: function (p) {\n    // p: 화면 입력값 (계산 연결 규칙 문서 참고)\n    // 여기에 Nexergy 계산식을 넣습니다\n    return {\n      Q: 0, perM: 0, bogDay: 0, bogYr: 0, loss: 0,\n      Qp: 0, Qr: 0, Qs: 0, Qg: 0, Qf: 0,\n      segs: [ /* {name, tag, L, rad, gas, sup, foam, nsup, Q} */ ],\n      parts: [ /* {type, qty, w, Q} */ ]\n    };\n  }\n};";
function calcModalHTML(){
  var now = calc.mode === 'sample'
    ? '<div class="cm-now warn"><b>지금은 예시 계산을 쓰고 있습니다.</b><br>화면 시연용 임시 계산이며, 계산 결과의 정확성은 보증하지 않습니다. Nexergy 계산 파일을 연결하면 모든 화면이 그 계산으로 바뀝니다.</div>'
    : '<div class="cm-now"><b>' + (calc.mode === 'upload' ? '올린 계산 파일' : '연결된 계산 파일') + ': ' + esc(calc.name) + '</b><br>결과 · 단열 비교 · 회수기간 · 리포트가 이 계산으로 그려지고 있습니다.</div>';
  var err = calc.err ? '<div class="cm-err">계산 파일 오류: ' + esc(calc.err) + '</div>' : '';
  var url = lsGet(CALC_URL_KEY) || CALC_URL_DEFAULT || '';
  return '<div class="cm" role="dialog" aria-modal="true" aria-labelledby="cm-title">' +
    '<div class="cm-head"><h2 id="cm-title">계산 파일 연결</h2><button type="button" class="btn" data-act="calc-close">닫기</button></div>' + now + err +
    '<div class="cm-sec"><h3>1. 파일 올리기<span>테스트용 · 이 브라우저에서만 반영</span></h3><p>계산 파일(.js)을 고르면 바로 다시 계산합니다. 다른 사람이 이 페이지를 열면 예시 계산이 보입니다.</p><div class="cm-row"><input type="file" id="calc-file" class="cm-file" accept=".js,text/javascript"></div></div>' +
    '<div class="cm-sec"><h3>2. 주소로 연결<span>공개용</span></h3><p>계산 파일을 서버나 GitHub Pages 등에 올리고 주소를 넣습니다. 모든 사람에게 보이게 하려면 코드의 CALC_URL_DEFAULT에 이 주소를 적어 두세요.</p><div class="cm-row"><input type="text" id="calc-url" placeholder="https://.../nexergy-calc.js" value="' + esc(url) + '"><button type="button" class="btn primary" data-act="calc-url">연결</button></div></div>' +
    '<div class="cm-sec"><h3>계산 파일 형식</h3><p>들어가는 값 p와 돌려줄 값의 이름 · 단위는 계산 연결 규칙 문서를 따릅니다.</p><div class="cm-code">' + esc(CALC_EXAMPLE) + '</div></div>' +
    '<div class="cm-foot"><button type="button" class="btn" data-act="calc-template">' + ic('down') + '빈 계산 파일 받기</button><button type="button" class="btn" data-act="calc-reset"' + (calc.mode === 'sample' ? ' disabled' : '') + '>' + ic('reset') + '예시 계산으로 되돌리기</button></div></div>';
}
function openCalcModal(){ var m = document.getElementById('calc-modal'); m.innerHTML = calcModalHTML(); m.hidden = false; }
function closeCalcModal(){ var m = document.getElementById('calc-modal'); m.hidden = true; m.innerHTML = ''; }
function calcModalOpen(){ var m = document.getElementById('calc-modal'); return m && !m.hidden; }
function afterCalcChange(msg){ renderAll(); if(calcModalOpen()) openCalcModal(); if(msg) toast(msg); }
function downloadText(name, text, type){
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type:type || 'text/plain;charset=utf-8'}));
  a.download = name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
var CALC_TEMPLATE = "/* Nexergy 계산 파일 (빈 틀)\n   계산식을 채운 뒤 화면 오른쪽 위 [계산] 메뉴에서 올리거나 주소로 연결하세요.\n   들어가는 값 p와 돌려줄 값의 이름 · 단위는 계산 연결 규칙 문서를 따릅니다. */\nwindow.NexergyCalc = {\n  name: 'Nexergy 계산 v0.1',\n  core: function (p) {\n    var segs = p.segs.map(function (s) {\n      var r = { name: s.name, tag: s.tag, L: s.L, rad: 0, gas: 0, sup: 0, foam: 0, nsup: 0 };\n      // TODO: 구간별 열유입(W) 계산 - rad 복사, gas 잔류가스, sup 지지대, foam 폼, nsup 지지대 개수\n      r.Q = r.rad + r.gas + r.sup + r.foam;\n      return r;\n    });\n    var parts = p.parts.map(function (x) {\n      return { type: x.type, qty: x.qty, w: x.w, Q: 0 /* TODO: 부품 열유입(W) */ };\n    });\n    var sum = function (a, k) { return a.reduce(function (t, x) { return t + x[k]; }, 0); };\n    var Qp = sum(parts, 'Q'), Qr = sum(segs, 'rad'), Qg = sum(segs, 'gas'), Qs = sum(segs, 'sup'), Qf = sum(segs, 'foam');\n    var Q = Qp + Qr + Qg + Qs + Qf, L = sum(segs, 'L');\n    return {\n      segs: segs, parts: parts,\n      Q: Q, perM: L > 0 ? Q / L : 0,\n      bogDay: 0, bogYr: 0, loss: 0,   // TODO: 일일 증발량 kg/일, 연간 증발량 kg/년, 연간 손실액 원/년\n      Qp: Qp, Qr: Qr, Qg: Qg, Qs: Qs, Qf: Qf\n    };\n  }\n};\n";
function initCalc(){
  var code = lsGet(CALC_SRC_KEY);
  if(code){
    try{ runCalcSource(code, lsGet(CALC_NAME_KEY) || '올린 계산 파일'); return; }
    catch(e){ calc.err = '저장된 계산 파일을 실행하지 못했습니다: ' + (e && e.message || e); }
  }
  if(window.NexergyCalc && typeof window.NexergyCalc.core === 'function'){
    try{ useCalcObj(window.NexergyCalc, 'url', 'nexergy-calc.js'); return; }
    catch(e){ calc.err = 'nexergy-calc.js를 쓰지 못했습니다: ' + (e && e.message || e); }
  }
  var url = lsGet(CALC_URL_KEY) || CALC_URL_DEFAULT;
  if(url) loadCalcUrl(url, function(err){ if(err){ calc.err = err.message; afterCalcChange('계산 파일 주소를 불러오지 못해 예시 계산으로 보여 줍니다.'); } else afterCalcChange(); });
}
document.addEventListener('change', function(e){
  if(e.target.id !== 'calc-file' || !e.target.files || !e.target.files[0]) return;
  var f = e.target.files[0], rd = new FileReader();
  rd.onload = function(){
    var code = String(rd.result);
    try{
      runCalcSource(code, f.name);
      var kept = lsSet(CALC_SRC_KEY, code); lsSet(CALC_NAME_KEY, calc.name);
      afterCalcChange('계산 파일을 반영했습니다: ' + calc.name + (kept ? '' : ' (이 화면에서는 저장이 막혀 새로고침하면 사라집니다)'));
    }catch(err){ calc = {mode:'sample', name:'', fn:null, err:'파일을 실행하지 못했습니다: ' + (err && err.message || err)}; afterCalcChange('계산 파일을 반영하지 못했습니다.'); }
  };
  rd.readAsText(f, 'utf-8');
});
function partDesc(parts){
  var types=[], seen={};
  parts.forEach(function(x){ if(x.qty>0 && !seen[x.type]){seen[x.type]=1;types.push(x.type);} });
  var q=parts.reduce(function(s,x){return s+(x.qty||0);},0);
  return {short:(types.join('·')||'부품')+' '+q+'개', list:parts.filter(function(x){return x.qty>0;}).map(function(x){return x.type+' '+x.qty;}).join(', ')||'없음'};
}
function methodLabel(p){ return p.method==='foam'?'폼 단열':p.method==='vac'?'진공만':'진공+MLI '+p.N+'층'; }
function paths(r){
  var p=r.p, pd=partDesc(r.parts), out=[];
  out.push({k:'parts',name:'부품',det:pd.short,detLong:pd.list,Q:r.Qp,color:COLORS.parts});
  if(p.method==='foam'){
    out.push({k:'foam',name:'단열재 전도',det:'폼 '+fLen(p.foamT*1000)+' mm',detLong:'폼 '+fLen(p.foamT*1000)+' mm, k '+p.foamK+' W/m·K',Q:r.Qf,color:COLORS.foam});
  } else {
    out.push({k:'rad',name:'복사',det:p.method==='mli'?'MLI '+p.N+'층':'MLI 없음',Q:r.Qr,color:COLORS.rad});
    out.push({k:'sup',name:'지지대',det:p.supMat+' '+r.nsup+'개',Q:r.Qs,color:COLORS.sup});
    out.push({k:'gas',name:'잔류가스 전도',det:sciOf(p.P),Q:r.Qg,color:COLORS.gas});
  }
  out.forEach(function(x){x.pct=r.Q>0?x.Q/r.Q*100:0; if(!x.detLong) x.detLong=x.det;});
  return out;
}

/* =========================================================
   6. 공통 조각
   ========================================================= */
var TABS=[['input','입력'],['result','결과'],['compare','단열 비교'],['payback','회수기간'],['report','리포트']];
function topbarHTML(){
  return '<header class="topbar"><span class="wordmark">Nexergy</span><nav class="tabs" role="tablist">'+
    TABS.map(function(t){return '<button type="button" role="tab" class="tab'+(state.ui.tab===t[0]?' on':'')+'" data-act="tab" data-v="'+t[0]+'" aria-selected="'+(state.ui.tab===t[0])+'">'+t[1]+'</button>';}).join('')+
    '</nav><div class="tb-right">'+calcChipHTML()+'<span class="proj" id="tb-proj" title="'+esc(state.project.name)+'">'+esc(state.project.name||'이름 없는 프로젝트')+'</span><span class="saved" id="saved-box">'+ic(STORE_OK?'check':'warn',14)+'<span id="saved-txt">'+saveLabel()+'</span></span></div></header>';
}
function pageHead(title,desc,actions,extra){
  return '<div class="page-head"><div class="ph-text"><h1>'+title+'</h1><p class="desc">'+desc+'</p>'+(extra||'')+'</div><div class="actions">'+(actions||'')+'</div></div>';
}
/* 화면 아래 이전/다음 흐름 버튼 */
function flowNav(tab){
  var i=VIEWS.indexOf(tab), prev=TABS[i-1], next=TABS[i+1];
  return '<nav class="flow-nav" aria-label="화면 이동">'+
    (prev?'<button type="button" class="btn" data-act="tab" data-v="'+prev[0]+'">'+ic('left')+prev[1]+'(으)로</button>':'<span></span>')+
    '<span class="step"><b>'+(i+1)+'</b> / '+TABS.length+' 단계</span>'+
    (next?'<button type="button" class="btn primary" data-act="tab" data-v="'+next[0]+'">다음: '+next[1]+ic('right')+'</button>':'<button type="button" class="btn" data-act="tab" data-v="input">'+ic('reset')+'처음 화면으로</button>')+
    '</nav>';
}
function disclaimer(t){ return '<p class="disclaimer">'+ic('info',16,1.8)+(t||'설계 검토용 추정치입니다. 제조사 사양과 실측으로 확인하세요.')+'</p>'; }
function issueHTML(it){ return '<div class="issue '+it.lvl+'">'+ic(it.lvl==='err'?'err':'warn')+'<div><b>'+GNAME[it.g]+'</b><span>'+esc(it.sum)+'</span></div></div>'; }
function blocked(v){
  return '<div class="empty"><span class="badge danger">계산 멈춤</span><h2>입력에 고칠 곳이 '+v.errs.length+'개 있습니다</h2><p>아래 항목을 고치면 바로 다시 계산합니다.</p><div class="issues">'+v.list.map(issueHTML).join('')+'</div><button type="button" class="btn primary" data-act="tab" data-v="input">'+ic('edit')+'입력으로 가기</button></div>';
}
function patDefs(id){
  return '<defs><pattern id="'+id+'-sup" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#D08A2E"/><rect width="2" height="6" fill="#FFFFFF" fill-opacity=".75"/></pattern><pattern id="'+id+'-gas" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#8DBBEA"/><circle cx="2.5" cy="2.5" r="1" fill="#22303F"/></pattern><pattern id="'+id+'-scb" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#7F98B6"/><rect width="2" height="6" fill="#FFFFFF" fill-opacity=".7"/></pattern><pattern id="'+id+'-foam" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#5F7C9E"/><rect width="6" height="1.5" fill="#FFFFFF" fill-opacity=".6"/></pattern></defs>';
}
function fillFor(k,pat){ if(pat&&(k==='sup'||k==='gas'||k==='foam')) return 'url(#'+pat+'-'+k+')'; return COLORS[k]; }
var uid=0;
function stackBar(ps,w,h,rx,pat){
  var id='sb'+(++uid), x=0, total=ps.reduce(function(s,p){return s+p.Q;},0)||1, gap=2, n=ps.filter(function(p){return p.Q>0;}).length;
  var avail=w-gap*Math.max(0,n-1), rects='';
  ps.forEach(function(p){ if(p.Q<=0) return; var ww=avail*p.Q/total; rects+='<rect x="'+x.toFixed(2)+'" y="0" width="'+ww.toFixed(2)+'" height="'+h+'" fill="'+fillFor(p.k,pat?id:null)+'"/>'; x+=ww+gap; });
  return '<svg class="chart" width="100%" height="'+h+'" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img" aria-label="열유입 구성: '+ps.map(function(p){return p.name+' '+p.pct.toFixed(1)+'%';}).join(', ')+'">'+(pat?patDefs(id):'')+'<clipPath id="'+id+'-c"><rect width="'+w+'" height="'+h+'" rx="'+rx+'"/></clipPath><g clip-path="url(#'+id+'-c)">'+rects+'</g></svg>';
}
function swatch(k,pat){
  if(pat&&(k==='sup'||k==='gas'||k==='foam')){ var id='sw'+(++uid); return '<svg class="sw" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">'+patDefs(id)+'<rect width="12" height="12" rx="3" fill="url(#'+id+'-'+k+')"/></svg>'; }
  return '<span class="sw" style="background:'+COLORS[k]+';width:12px;height:12px"></span>';
}
function compTable(ps,cls,pat){
  return '<table class="'+cls+'"><thead><tr><th>경로</th><th class="r">열유입 W</th><th class="r">비율</th></tr></thead><tbody>'+
    ps.map(function(p){return '<tr><td><span class="lg">'+swatch(p.k,pat)+'<b>'+p.name+'</b><em>'+esc(p.det)+'</em></span></td><td class="r">'+fW(p.Q)+'</td><td class="r">'+fPct(p.pct)+'</td></tr>';}).join('')+'</tbody></table>';
}
function itemRows(r){
  var rows=r.segs.map(function(s){return {name:'구간 '+s.name,kind:'배관',amt:fLen(s.L)+' m',Q:s.Q,perM:s.Q/s.L};})
    .concat(r.parts.filter(function(x){return x.qty>0;}).map(function(x){return {name:x.type,kind:'부품',amt:x.qty+'개',Q:x.Q,perM:NaN};}));
  rows.sort(function(a,b){return b.Q-a.Q;});
  var max=rows.length?rows[0].Q:1, f=r.p.hours*3600/(r.p.latent*1000);
  rows.forEach(function(x){x.bog=x.Q*f; x.share=r.Q>0?x.Q/r.Q*100:0; x.bar=max>0?x.Q/max*100:0;});
  return rows;
}

/* =========================================================
   7. ① 입력
   ========================================================= */
function fld(o){
  var cls='field'+(o.span2?' span2':''), ctl;
  if(o.select){
    ctl='<div class="ctl" data-ctl="'+o.key+'"><select data-k="'+o.key+'" aria-label="'+o.label+'">'+o.select.map(function(op){var v=Array.isArray(op)?op[0]:op,l=Array.isArray(op)?op[1]:op;return '<option value="'+esc(v)+'"'+(String(v)===String(o.value)?' selected':'')+'>'+esc(l)+'</option>';}).join('')+'</select><span class="chev">'+ic('chev',16,1.8)+'</span></div>';
  } else {
    ctl='<div class="ctl'+(o.ro?' ro':'')+'" data-ctl="'+o.key+'"><input '+(o.ro?'readonly tabindex="-1" ':'')+'type="'+(o.type||'text')+'"'+(o.type?'':' inputmode="'+(o.text?'text':'decimal')+'"')+' class="'+(o.text?'l':'r')+'" data-k="'+o.key+'"'+(o.comma?' data-comma="1"':'')+' value="'+esc(o.value)+'" placeholder="'+esc(o.placeholder||'')+'" aria-label="'+o.label+'">'+(o.unit?'<span class="u">'+o.unit+'</span>':'')+'</div>';
  }
  return '<div class="'+cls+'" data-field="'+o.key+'"><label class="lab">'+o.label+'</label>'+ctl+'<span class="help" data-help="'+esc(o.help||'')+'" data-msg="'+o.key+'">'+(o.help||'')+'</span></div>';
}
function panel(g,title,sub,body,reset){
  return '<section class="panel grp" id="grp-'+g+'"><div class="panel-head"><h2>'+title+'</h2><span class="sub">'+sub+'</span><span class="right">'+(reset?'<button type="button" class="btn ghost" data-act="reset" data-v="'+g+'">'+ic('reset')+'기본값으로 되돌리기</button>':'')+'</span></div><div class="panel-body">'+body+'</div></section>';
}
function segTable(){
  var rows=state.segs.map(function(s,i){
    function c(f,r){return '<td><div class="cell'+(r?' r':'')+'" data-ctl="seg.'+i+'.'+f+'"><input type="text" inputmode="'+(r?'decimal':'text')+'" data-seg="'+i+'" data-f="'+f+'" value="'+esc(s[f])+'" aria-label="'+f+'"></div></td>';}
    return '<tr>'+c('name',false)+c('len',true)+c('iod',true)+c('it',true)+c('ood',true)+c('ot',true)+
      '<td><div class="cell sel"><select data-seg="'+i+'" data-f="mat" aria-label="재질">'+PIPEMATS.map(function(m){return '<option'+(m===s.mat?' selected':'')+'>'+m+'</option>';}).join('')+'</select>'+ic('chev',14,1.8)+'</div></td>'+
      '<td><span class="row-act"><button type="button" class="icon-btn" title="복제" data-act="dup-seg" data-v="'+i+'">'+ic('copy',16,1.8)+'</button><button type="button" class="icon-btn" title="삭제" data-act="del-seg" data-v="'+i+'"'+(state.segs.length<=1?' disabled':'')+'>'+ic('trash',16,1.8)+'</button></span></td></tr>';
  }).join('');
  return '<div class="et-wrap"><table class="et"><colgroup><col style="width:24%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:15%"><col style="width:11%"></colgroup>'+
    '<thead><tr><th rowspan="2">구간명</th><th rowspan="2" class="r">길이 <span class="hu">m</span></th><th colspan="2" class="grp-h">내관 <span class="hu">mm</span></th><th colspan="2" class="grp-h">외관 <span class="hu">mm</span></th><th rowspan="2">재질</th><th rowspan="2"></th></tr>'+
    '<tr><th class="r sub-h">외경</th><th class="r sub-h">두께</th><th class="r sub-h">외경</th><th class="r sub-h">두께</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="tbl-msgs" id="seg-msgs"></div>'+
    '<div class="tfoot"><button type="button" class="btn ghost" data-act="add-seg">'+ic('plus')+'구간 추가</button><span class="tsum" id="seg-sum"></span></div>';
}
function partTable(){
  var rows=state.parts.map(function(p,i){
    var types=Object.keys(PARTTYPES); if(types.indexOf(p.type)<0) types.push(p.type);
    return '<tr><td><div class="cell sel"><select data-part="'+i+'" data-f="type" aria-label="종류">'+types.map(function(t){return '<option'+(t===p.type?' selected':'')+'>'+esc(t)+'</option>';}).join('')+'</select>'+ic('chev',14,1.8)+'</div></td>'+
      '<td><div class="cell r" data-ctl="part.'+i+'.qty"><input type="text" inputmode="numeric" data-part="'+i+'" data-f="qty" value="'+esc(p.qty)+'" aria-label="수량"></div></td>'+
      '<td><div class="cell r" data-ctl="part.'+i+'.w"><input type="text" inputmode="decimal" data-part="'+i+'" data-f="w" value="'+esc(p.w)+'" aria-label="개당 열유입"></div></td>'+
      '<td><div class="cell r ro" data-psum="'+i+'"></div></td>'+
      '<td><span class="row-act"><button type="button" class="icon-btn" title="복제" data-act="dup-part" data-v="'+i+'">'+ic('copy',16,1.8)+'</button><button type="button" class="icon-btn" title="삭제" data-act="del-part" data-v="'+i+'">'+ic('trash',16,1.8)+'</button></span></td></tr>';
  }).join('');
  return '<div class="et-wrap"><table class="et"><colgroup><col style="width:34%"><col style="width:16%"><col style="width:20%"><col style="width:19%"><col style="width:11%"></colgroup>'+
    '<thead><tr><th>종류</th><th class="r">수량 <span class="hu">개</span></th><th class="r">개당 열유입 <span class="hu">W</span></th><th class="r">합계 <span class="hu">W</span></th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="tbl-msgs" id="part-msgs"></div>'+
    '<div class="tfoot"><button type="button" class="btn ghost" data-act="add-part">'+ic('plus')+'부품 추가</button><span class="tsum" id="part-sum"></span></div>';
}
function insBody(){
  var m=state.ins.method, h='<div class="fgrid"><div class="field span2"><span class="lab">단열 방식</span><div class="seg" role="radiogroup">'+
    [['mli','진공+MLI'],['vac','진공만'],['foam','폼']].map(function(o){return '<span role="radio" tabindex="0" aria-checked="'+(m===o[0])+'" class="'+(m===o[0]?'on':'')+'" data-act="method" data-v="'+o[0]+'">'+o[1]+'</span>';}).join('')+
    '</div><span class="help">'+(m==='foam'?'폼 단열은 진공층과 지지대 없이 폼 두께와 열전도도로 계산합니다.':'폼을 고르면 MLI 층수와 진공도 대신 폼 두께와 열전도도를 입력합니다.')+'</span></div><div></div>';
  if(m==='foam'){
    h+=fld({key:'ins.foamT',label:'폼 두께',value:state.ins.foamT,unit:'mm',help:'내관 바깥에 감는 두께입니다.'});
    h+=fld({key:'ins.foamK',label:'열전도도',value:state.ins.foamK,unit:'W/m·K',help:'극저온 평균값을 넣으세요.'});
  } else {
    if(m==='mli') h+=fld({key:'ins.mli',label:'MLI 층수',value:state.ins.mli,unit:'층'});
    h+='<div class="field" data-field="ins.vac"><span class="lab">진공도</span><div class="ctl sci" data-ctl="ins.vac"><input class="mant" type="text" inputmode="decimal" data-k="ins.vm" value="'+esc(state.ins.vm)+'" aria-label="진공도 앞자리"><span class="times">× 10</span><span class="exp"><input type="text" inputmode="numeric" data-k="ins.ve" value="'+esc(String(state.ins.ve).replace('-','−'))+'" aria-label="진공도 지수"></span><span class="u">Pa</span></div><span class="help" data-help="작을수록 좋은 진공입니다." data-msg="ins.vac">작을수록 좋은 진공입니다.</span></div>';
  }
  return h+'</div>';
}
function supBody(){
  if(state.ins.method==='foam') return '<p class="help">폼 단열에는 진공층을 가로지르는 지지대가 없어 지지대 열유입을 계산하지 않습니다.</p>';
  var s=state.sup;
  return '<div class="fgrid">'+
    fld({key:'sup.mat',label:'재질',value:s.mat,select:Object.keys(SUPMAT)})+
    fld({key:'sup.spacing',label:'설치 간격',value:s.spacing,unit:'m'})+
    fld({key:'sup.count',label:'개수',value:'',unit:'개',ro:true,help:'구간 길이와 간격으로 자동 계산합니다.'})+
    '</div><div class="disclosure'+(state.ui.adv?' open':'')+'" data-act="adv" role="button" tabindex="0" aria-expanded="'+state.ui.adv+'">'+ic('right')+'<b>고급 설정</b><span>단면적과 길이는 재질별 기본값을 씁니다.</span></div>'+
    '<div class="adv fgrid"'+(state.ui.adv?'':' hidden')+'>'+
    fld({key:'sup.area',label:'지지대 단면적',value:s.area,unit:'mm²'})+
    fld({key:'sup.len',label:'열전달 길이',value:s.len,unit:'mm'})+'</div>';
}
function renderInput(){
  var o=state.op, pj=state.project;
  var nav='<nav class="gindex" aria-label="입력 그룹">'+GROUPS.map(function(g,i){return '<button type="button" class="gi'+(i===0?' on':'')+'" data-act="nav" data-v="'+g[0]+'">'+g[1]+'<span class="cnt" data-cnt="'+g[0]+'" hidden></span></button>';}).join('')+'</nav>';
  var form='<div class="form-col">'+
    panel('project','프로젝트','리포트 표지에 그대로 들어갑니다.','<div class="fgrid">'+
      fld({key:'project.name',label:'프로젝트명',value:pj.name,span2:true,text:true})+
      fld({key:'project.author',label:'작성자',value:pj.author,text:true})+
      fld({key:'project.date',label:'작성일',value:pj.date,type:'date',text:true})+
      fld({key:'project.memo',label:'메모',value:pj.memo,span2:true,text:true,placeholder:'검토 회의에서 함께 볼 메모를 남기세요'})+'</div>',false)+
    panel('op','운전 조건','유체와 운전 환경, 손실액 계산에 쓸 단가입니다.','<div class="fgrid">'+
      fld({key:'op.fluid',label:'유체',value:o.fluid,select:Object.keys(FLUIDS).map(function(k){return [k,FLUIDS[k].label];})})+
      fld({key:'op.pressure',label:'운전 압력',value:o.pressure,unit:'barg'})+
      fld({key:'op.ambient',label:'외기 온도',value:o.ambient,unit:'°C'})+
      fld({key:'op.hours',label:'연간 운전시간',value:o.hours,unit:'h/년',comma:true,help:'쉬지 않고 운전하면 8,760 h입니다.'})+
      fld({key:'op.price',label:'유체 단가',value:o.price,unit:'원/kg',comma:true,help:'연간 손실액 계산에 씁니다.'})+
      fld({key:'op.recovery',label:'BOG 회수율',value:o.recovery,unit:'%',help:'0 %면 증발한 양을 모두 손실로 봅니다.'})+'</div>',true)+
    panel('seg','배관 구간','구간마다 길이와 내관·외관 규격을 넣습니다.',segTable(),true)+
    panel('ins','단열 구성','방식에 따라 입력 칸이 바뀝니다.',insBody(),true)+
    panel('sup','지지대','내관을 받치는 부품으로, 진공층을 가로질러 열이 새는 길입니다.',supBody(),true)+
    panel('parts','부품','개당 열유입은 제조사 사양값을 넣으세요.',partTable(),true)+'</div>';
  var rail='<aside class="rail" id="rail" aria-live="polite"></aside>';
  document.getElementById('view-input').innerHTML='<main class="page">'+pageHead('배관 사양','모든 칸은 기본값으로 채워져 있습니다. 값을 바꾸면 오른쪽 요약이 바로 다시 계산됩니다.')+'<div class="input-layout">'+nav+form+rail+'</div>'+flowNav('input')+'</main>';
  updateInput();
}
function railHTML(v,r){
  var h='<div class="rail-head"><h2>요약</h2>'+(v.ok?'<span class="status">'+ic('check',14)+'방금 계산함</span>':'<span class="badge danger">계산 멈춤</span>')+'</div>';
  if(!v.ok){
    h+='<p class="rail-lead">아래 '+v.errs.length+'개를 고치면 바로 다시 계산합니다.</p><div class="issues">'+v.list.map(issueHTML).join('')+'</div>';
    h+=['총 열유입','증발량 BOG','연간 손실액'].map(function(k){return '<div class="rk off"><span class="k">'+k+'</span><span class="v">–</span></div>';}).join('');
    return h+'<button type="button" class="btn primary block disabled" disabled>결과 보기</button>';
  }
  if(v.warns.length) h+='<div class="issues">'+v.warns.map(issueHTML).join('')+'</div>';
  var m=moneyParts(r.loss), ps=paths(r);
  h+='<div class="rk"><span class="k">총 열유입</span><span class="v">'+fW(r.Q)+'<span class="u">W</span></span><span class="s">단위 길이당 '+fWm(r.perM)+' W/m</span></div>';
  h+='<div class="rk"><span class="k">증발량 BOG</span><span class="v">'+fs3(r.bogYr)+'<span class="u">kg/년</span></span><span class="s">하루 '+fs3(r.bogDay)+' kg</span></div>';
  h+='<div class="rk"><span class="k">연간 손실액</span><span class="v">'+m.v+'<span class="u">'+m.u+'</span></span><span class="s">단가 '+comma(r.p.price)+'원/kg, 회수율 '+r.p.rec+' %</span></div>';
  h+='<div class="rail-comp"><span class="k">열유입 구성</span>'+stackBar(ps,278,10,3)+'<div class="mlegend">'+ps.map(function(p){return '<span class="ml"><span class="sw" style="background:'+p.color+';width:10px;height:10px"></span>'+(p.k==='gas'?'잔류가스':p.name)+'<b>'+fW(p.Q)+'</b></span>';}).join('')+'</div></div>';
  return h+'<button type="button" class="btn primary block" data-act="tab" data-v="result">결과 보기</button><p class="rail-foot">값을 바꾸면 계산 버튼 없이 바로 다시 계산합니다.</p>';
}
function updateInput(){
  var root=document.getElementById('view-input'); if(!root.firstChild) return;
  var v=validate(state), r=v.ok?core(params(state)):null;
  root.querySelectorAll('[data-ctl]').forEach(function(el){
    var it=v.by[el.getAttribute('data-ctl')];
    el.classList.toggle('err',!!it&&it.lvl==='err'); el.classList.toggle('warn',!!it&&it.lvl==='warn');
  });
  root.querySelectorAll('[data-msg]').forEach(function(el){
    var it=v.by[el.getAttribute('data-msg')];
    if(it){ el.className='msg '+it.lvl; el.innerHTML=ic(it.lvl==='err'?'err':'warn')+'<span>'+esc(it.msg)+'</span>'; }
    else { el.className='help'; el.textContent=el.getAttribute('data-help')||''; }
  });
  function tblMsgs(id,prefix){
    var box=document.getElementById(id); if(!box) return;
    box.innerHTML=v.list.filter(function(x){return x.key.indexOf(prefix)===0;}).map(function(x){return '<p class="msg '+x.lvl+'">'+ic(x.lvl==='err'?'err':'warn')+'<span>'+esc(x.msg)+'</span></p>';}).join('');
  }
  tblMsgs('seg-msgs','seg.'); tblMsgs('part-msgs','part.');
  var tot=0, ex=[];
  state.segs.forEach(function(s,i){var L=num(s.len); if(isFinite(L)&&L>0) tot+=L; else ex.push('구간 '+segTag(s,i));});
  var ss=document.getElementById('seg-sum'); if(ss) ss.textContent='총 길이 '+tot.toFixed(1)+' m'+(ex.length?', '+ex.join('·')+' 제외':'');
  var ptot=0;
  state.parts.forEach(function(p,i){var q=num(p.qty),w=num(p.w),el=root.querySelector('[data-psum="'+i+'"]'); var t=q*w; if(isFinite(t)) ptot+=t; if(el) el.textContent=isFinite(t)?t.toFixed(1):'–';});
  var ps=document.getElementById('part-sum'); if(ps) ps.textContent='부품 합계 '+ptot.toFixed(1)+' W';
  var cnt=root.querySelector('[data-k="sup.count"]');
  if(cnt){ var sp=num(state.sup.spacing), n=0, okc=sp>0; state.segs.forEach(function(s){var L=num(s.len); if(isFinite(L)&&L>0&&okc) n+=Math.max(1,Math.floor(L/sp+1e-9));}); cnt.value=okc?n:'–'; }
  GROUPS.forEach(function(g){
    var el=root.querySelector('[data-cnt="'+g[0]+'"]'); if(!el) return;
    var e=v.list.filter(function(x){return x.g===g[0]&&x.lvl==='err';}).length, w=v.list.filter(function(x){return x.g===g[0]&&x.lvl==='warn';}).length;
    if(e||w){ el.hidden=false; el.className='cnt '+(e?'err':'warn'); el.textContent=e||w; } else el.hidden=true;
  });
  document.getElementById('rail').innerHTML=railHTML(v,r);
  var tp=document.getElementById('tb-proj'); if(tp){ tp.textContent=state.project.name||'이름 없는 프로젝트'; tp.title=state.project.name; }
}

/* =========================================================
   8. ② 결과
   ========================================================= */
function netBig(r){
  var ps=paths(r), byK={}; ps.forEach(function(p){byK[p.k]=p;});
  var foam=r.p.method==='foam';
  var rows=foam?[[byK.foam,110,false],[byK.parts,250,false]]:[[byK.rad,70,true],[byK.gas,134,true],[byK.sup,222,false],[byK.parts,290,false]];
  var maxQ=Math.max.apply(null,ps.map(function(p){return p.Q;}))||1;
  var s='<svg class="chart net" width="1310" height="340" viewBox="0 0 1310 340" role="img" aria-label="열저항망: 외기 '+r.p.Ta+'도에서 '+fW(r.Q)+' W가 '+r.p.fluid.short+'로 들어와 하루 '+fs3(r.bogDay)+' kg 증발">';
  s+='<rect x="0" y="130" width="124" height="100" rx="10" fill="#FBF2E4" stroke="#E3B679"/><text x="18" y="164" class="nlab heat">외기</text><text x="18" y="194" class="nval">'+r.p.Ta+' °C</text><text x="18" y="216" class="nsub">ΔT '+Math.round(r.dT)+' K</text>';
  var y0=rows[0][1], y1=rows[rows.length-1][1];
  s+='<line x1="124" y1="180" x2="160" y2="180" stroke="#5F6B76" stroke-width="2"/><line x1="160" y1="'+y0+'" x2="160" y2="'+y1+'" stroke="#5F6B76" stroke-width="2"/><line x1="640" y1="'+y0+'" x2="640" y2="'+y1+'" stroke="#5F6B76" stroke-width="2"/><line x1="640" y1="180" x2="676" y2="180" stroke="#5F6B76" stroke-width="2"/>';
  if(!foam) s+='<rect x="174" y="26" width="452" height="142" rx="10" fill="none" stroke="#AEB9C4" stroke-dasharray="5 4"/><rect x="188" y="18" width="150" height="16" fill="#FFFFFF"/><text x="194" y="30" class="glab">진공층: 두 경로가 나란히</text>';
  rows.forEach(function(row){
    var p=row[0], y=row[1], sw=Math.max(1.6,11*p.Q/maxQ), R=p.Q>0?r.dT/p.Q:Infinity;
    s+='<line x1="160" y1="'+y+'" x2="640" y2="'+y+'" stroke="'+p.color+'" stroke-width="'+sw.toFixed(1)+'"/>';
    s+='<rect x="358" y="'+(y-11)+'" width="68" height="22" rx="3" fill="#FFFFFF" stroke="'+p.color+'" stroke-width="2"/>';
    s+='<text x="194" y="'+(y-13)+'" class="llab">'+p.name+'<tspan class="ldet" dx="8">'+esc(p.detLong)+'</tspan></text>';
    s+='<text x="624" y="'+(y-13)+'" text-anchor="end" class="lval">'+fW(p.Q)+' W</text>';
    s+='<text x="392" y="'+(y+27)+'" text-anchor="middle" class="rlab">R '+(isFinite(R)?fs3(R):'∞')+' K/W</text>';
    if(sw>=6){ s+='<path d="M219,'+(y-5)+' L227,'+y+' L219,'+(y+5)+'" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><path d="M561,'+(y-5)+' L569,'+y+' L561,'+(y+5)+'" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>'; }
  });
  var m=moneyParts(r.loss);
  s+='<rect x="676" y="124" width="160" height="112" rx="10" fill="#E8F0FA" stroke="#A9C6EA"/><text x="694" y="156" class="nlab cold">'+r.p.fluid.short+'</text><text x="694" y="184" class="nval">'+(r.p.Tf<0?'−'+Math.abs(r.p.Tf):r.p.Tf)+' °C</text><line x1="694" y1="196" x2="818" y2="196" stroke="#A9C6EA"/><text x="694" y="220" class="nsum">합계 '+fW(r.Q)+' W</text>';
  s+='<line x1="836" y1="180" x2="914" y2="180" stroke="#5F6B76" stroke-width="2"/><path d="M912,174 L922,180 L912,186 z" fill="#5F6B76"/><text x="879" y="206" text-anchor="middle" class="conv">÷ 증발잠열</text><text x="879" y="224" text-anchor="middle" class="conv b">'+r.p.latent+' kJ/kg</text>';
  s+='<rect x="922" y="124" width="150" height="112" rx="10" fill="#FFFFFF" stroke="#C6CED6"/><text x="938" y="156" class="nlab">증발량 BOG</text><text x="938" y="184" class="nval">'+fs3(r.bogDay)+' kg/일</text><text x="938" y="220" class="nsub">연 '+fs3(r.bogYr)+' kg</text>';
  s+='<line x1="1072" y1="180" x2="1151" y2="180" stroke="#5F6B76" stroke-width="2"/><path d="M1149,174 L1159,180 L1149,186 z" fill="#5F6B76"/><text x="1115.5" y="206" text-anchor="middle" class="conv">× 단가'+(r.p.rec>0?' × (1−회수율)':'')+'</text><text x="1115.5" y="224" text-anchor="middle" class="conv b">'+comma(r.p.price)+'원/kg</text>';
  s+='<rect x="1159" y="124" width="150" height="112" rx="10" fill="#FFFFFF" stroke="#16202A" stroke-width="1.5"/><text x="1175" y="156" class="nlab">연간 손실액</text><text x="1175" y="184" class="nval">'+m.v+m.u+'</text><text x="1175" y="220" class="nsub">'+fWonFull(r.loss)+'</text>';
  return s+'</svg>';
}
function assumeItems(r){
  var p=r.p, a=[['외기 온도',p.Ta+' °C'],[p.fluid.short+' 온도',(p.Tf<0?'−'+Math.abs(p.Tf):p.Tf)+' °C'],['증발잠열',p.latent+' kJ/kg'],['연간 운전',comma(p.hours)+' h']];
  if(p.method==='foam') a.push(['폼 두께',fLen(p.foamT*1000)+' mm'],['열전도도',p.foamK+' W/m·K']);
  else { a.push(['MLI',p.method==='mli'?p.N+'층':'없음'],['진공도',sciOf(p.P)],['지지대',p.supMat+', '+p.spacing.toFixed(1)+' m 간격']); }
  a.push(['부품 열유입','제조사 사양 입력값']);
  return a;
}
function chipsHTML(r){
  var p=r.p, c=[p.fluid.short+', '+p.pressure+' barg','배관 '+r.segs.length+'개 구간 '+r.L.toFixed(1)+' m',methodLabel(p)];
  if(p.method!=='foam'){ c.push('진공도 '+sciOf(p.P)); c.push('지지대 '+p.supMat+' '+r.nsup+'개'); } else c.push('폼 '+fLen(p.foamT*1000)+' mm');
  c.push('부품 '+r.partQty+'개');
  return '<div class="chips">'+c.map(function(x){return '<span class="chip">'+esc(x)+'</span>';}).join('')+'</div>';
}
function renderResult(animCalc){
  var el=document.getElementById('view-result'), v=validate(state);
  var head=pageHead('분석 결과','열이 어디로 얼마나 들어오고, 그 열로 매년 얼마를 잃는지 보여 줍니다.',
    '<button type="button" class="btn" data-act="tab" data-v="input">'+ic('edit')+'입력 수정</button><button type="button" class="btn" data-act="tab" data-v="compare">'+ic('plus')+'비교에 추가</button><button type="button" class="btn primary" data-act="tab" data-v="report">'+ic('doc')+'리포트 출력</button>',
    v.ok?chipsHTML(core(params(state))):'');
  if(!v.ok){ el.innerHTML='<main class="page">'+head+blocked(v)+flowNav('result')+'</main>'; return; }
  var r=core(params(state)), ps=paths(r), m=moneyParts(r.loss), rows=itemRows(r);
  var h='<section class="kpis">'+
    '<div class="kpi"><span class="k">총 열유입</span><span class="v">'+fW(r.Q)+'<span class="u">W</span></span><span class="s">배관 '+r.L.toFixed(1)+' m와 부품 '+r.partQty+'개</span></div>'+
    '<div class="kpi"><span class="k">단위 길이당 열유입</span><span class="v">'+fWm(r.perM)+'<span class="u">W/m</span></span><span class="s">총 열유입 ÷ 배관 길이</span></div>'+
    '<div class="kpi"><span class="k">증발량 BOG</span><span class="v">'+fs3(r.bogDay)+'<span class="u">kg/일</span></span><span class="s">연 '+fs3(r.bogYr)+' kg</span></div>'+
    '<div class="kpi"><span class="k">연간 손실액</span><span class="v">'+m.v+'<span class="u">'+m.u+'/년</span></span><span class="s">단가 '+comma(r.p.price)+'원/kg, 회수율 '+r.p.rec+' %</span></div></section>';
  h+='<div class="result-grid"><section class="panel"><div class="panel-head"><h2>열유입 구성</h2><span class="right total">합계 <b>'+fW(r.Q)+' W</b></span></div><div class="panel-body">'+stackBar(ps,526,28,4)+compTable(ps,'dt comp')+'</div></section>';
  h+='<section class="panel"><div class="panel-head"><h2>구간·부품별 결과</h2><span class="right sortby">'+ic('sort',16,1.8)+'열유입 큰 순</span></div><div class="panel-body tight"><div class="dt-wrap"><table class="dt res"><colgroup><col style="width:26%"><col style="width:9%"><col style="width:11%"><col style="width:12%"><col style="width:10%"><col style="width:13%"><col style="width:19%"></colgroup>'+
    '<thead><tr><th>이름</th><th>구분</th><th class="r">길이·수량</th><th class="r">열유입 W</th><th class="r">W/m</th><th class="r">BOG kg/년</th><th>비중</th></tr></thead><tbody>'+
    rows.map(function(x){return '<tr><td>'+esc(x.name)+'</td><td class="kind">'+x.kind+'</td><td class="r">'+x.amt+'</td><td class="r strong">'+fW(x.Q)+'</td><td class="r">'+(isFinite(x.perM)?fWm(x.perM):'<span class="na" title="부품은 길이가 없어 W/m을 내지 않습니다">–</span>')+'</td><td class="r">'+fs3(x.bog)+'</td><td><span class="share"><span class="bar"><i style="width:'+x.bar.toFixed(1)+'%"></i></span><span class="pct">'+fPct(x.share)+'</span></span></td></tr>';}).join('')+
    '</tbody><tfoot><tr><td>합계</td><td></td><td class="r">'+fLen(r.L)+' m, '+r.partQty+'개</td><td class="r">'+fW(r.Q)+'</td><td class="r">'+fWm(r.perM)+'</td><td class="r">'+fs3(r.bogYr)+'</td><td></td></tr></tfoot></table></div></div></section></div>';
  var open=state.ui.calcOpen;
  h+='<section class="panel calc'+(open?' open':'')+'" id="calc"><div class="calc-toggle" data-act="calc" role="button" tabindex="0" aria-expanded="'+open+'" aria-controls="calc-body">'+ic('right',18)+'<b>계산 과정 '+(open?'접기':'보기')+'</b><span>열이 들어오는 경로를 열저항망 그림과 계산 가정으로 펼쳐 봅니다.</span></div>'+
    '<div class="calc-body'+(open&&animCalc?' anim':'')+'" id="calc-body"'+(open?'':' hidden')+'><div class="chart-wrap">'+netBig(r)+'</div><div class="calc-foot"><div class="howto"><h3>읽는 법</h3><p>온도차는 전압, 열유입(W)은 전류, 단열층은 저항처럼 그렸습니다. 선이 굵을수록 열이 많이 들어오는 경로이고, R은 그 경로의 등가 열저항입니다.</p></div>'+
    '<div class="assume"><h3>계산 가정</h3><dl>'+assumeItems(r).map(function(a){return '<div><dt>'+a[0]+'</dt><dd>'+esc(a[1])+'</dd></div>';}).join('')+'</dl></div></div></div></section>';
  el.innerHTML='<main class="page">'+head+h+disclaimer()+flowNav('result')+'</main>';
}

/* =========================================================
   9. ③ 단열 비교
   ========================================================= */
function scenarios(){
  var p=params(state), out={};
  ['A','B','C'].forEach(function(k){ out[k]=core(scenParams(state,k)); });
  var cur=p.method;
  out.A.title='폼 단열'; out.A.desc=cur==='foam'?'현재 입력 그대로':'단열 방식을 폼으로 바꾼 안';
  out.B.title='진공만'; out.B.desc=cur==='vac'?'현재 입력 그대로':cur==='mli'?'MLI '+p.N+'층을 뺀 안':'폼 대신 진공만 쓴 안';
  out.C.title=methodLabel(p); out.C.desc='현재 입력 그대로';
  return out;
}
function tile(k,size){ var t=TILE[k]; return '<span class="tile'+(size?' '+size:'')+(t.dark?' dark':'')+'" style="background:'+t.bg+'">'+k+'</span>'; }
function metricOf(r,m){ return m==='heat'?r.Q:m==='bog'?r.bogYr:r.loss; }
function metricFmt(v,m){ return m==='heat'?fW(v)+' W':m==='bog'?fs3(v)+' kg/년':fMoney(v)+'/년'; }
function cmpCards(sc){
  var base=state.ui.base, bq=sc[base].Q;
  return ['A','B','C'].map(function(k){
    var r=sc[k], isB=k===base, red=(r.Q-bq)/bq*100;
    return '<div class="sc'+(isB?' is-base':'')+'"><div class="sc-head">'+tile(k)+'<h3>'+esc(r.title)+'</h3>'+(isB?'<span class="badge neutral">기준안</span>':'<span class="badge accent">'+fRed(red)+'</span>')+'<span class="sc-more">'+(isB?'':'<button type="button" class="mk-base" data-act="base" data-v="'+k+'">기준안으로</button>')+'</span></div>'+
      '<p class="sc-diff">'+esc(r.desc)+'</p><dl class="sc-m"><div><dt>열유입</dt><dd><b>'+fW(r.Q)+'</b> W</dd></div><div><dt>증발량 BOG</dt><dd>'+fs3(r.bogYr)+' kg/년</dd></div><div><dt>손실액</dt><dd>'+fMoney(r.loss)+'/년</dd></div></dl></div>';
  }).join('');
}
function cmpBars(sc){
  var m=state.ui.metric, base=state.ui.base, vals={}, max=0;
  ['A','B','C'].forEach(function(k){vals[k]=metricOf(sc[k],m); max=Math.max(max,vals[k]);});
  return '<div class="tabset" role="tablist">'+[['heat','열유입'],['bog','증발량 BOG'],['loss','손실액']].map(function(t){return '<span role="tab" tabindex="0" class="'+(m===t[0]?'on':'')+'" data-act="metric" data-v="'+t[0]+'">'+t[1]+'</span>';}).join('')+'</div>'+
    '<div class="cb">'+['A','B','C'].map(function(k){var red=(vals[k]-vals[base])/vals[base]*100; return '<div class="cb-row"><span class="cb-name">'+tile(k,'sm')+esc(sc[k].title)+'</span><span class="cb-track"><i style="width:'+(max>0?vals[k]/max*100:0).toFixed(1)+'%;background:'+TILE[k].bg+'"></i></span><span class="cb-val">'+metricFmt(vals[k],m)+'</span><span class="cb-red'+(k===base?' base':'')+'">'+(k===base?'기준':fRed(red))+'</span></div>';}).join('')+'</div>'+
    '<p class="caption">감소율은 기준안 '+base+'와 비교한 값입니다.</p>';
}
function sensChart(sc){
  var W=750,H=360,x0=52,x1=732,yT=16,yB=314, lx0=-4,lx1=2, logY=state.ui.logY;
  var pB=scenParams(state,'B'), pC=params(state), curP=pC.method==='foam'?1e-3:pC.P;
  var pts=[],i; for(i=0;i<=60;i++) pts.push(Math.pow(10,lx0+(lx1-lx0)*i/60));
  var cB=pts.map(function(P){var q=Object.assign({},pB,{P:P}); return core(q).Q;});
  var cC=pts.map(function(P){var q=Object.assign({},pC,{P:P}); return core(q).Q;});
  var A=sc.A.Q, all=cB.concat(cC,[A]);
  var mn=Math.min.apply(null,all), mx=Math.max.apply(null,all), yLo,yHi,yf,ticks=[],minor=[];
  if(logY){
    var d0=Math.floor(Math.log10(mn)), d1=Math.ceil(Math.log10(mx)); if(d1===d0) d1++;
    yLo=Math.pow(10,d0); yHi=Math.pow(10,d1);
    yf=function(v){return yB-(Math.log10(v)-d0)/(d1-d0)*(yB-yT);};
    for(i=d0;i<=d1;i++){ ticks.push(Math.pow(10,i)); if(i<d1) [2,3,5].forEach(function(f){minor.push(f*Math.pow(10,i));}); }
  } else {
    var step=niceStep(mx/4); yLo=0; yHi=Math.ceil(mx/step)*step;
    yf=function(v){return yB-v/yHi*(yB-yT);};
    for(var t=0;t<=yHi+1e-9;t+=step) ticks.push(t);
  }
  var xf=function(P){return x0+(Math.log10(P)-lx0)/(lx1-lx0)*(x1-x0);};
  var s='<svg class="chart" width="100%" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="진공도에 따른 열유입 변화">';
  var xl=xf(CFG.VAC_LIMIT);
  if(xl<x1) s+='<rect x="'+Math.max(x0,xl).toFixed(1)+'" y="'+yT+'" width="'+(x1-Math.max(x0,xl)).toFixed(1)+'" height="'+(yB-yT)+'" fill="#FFF5DE" fill-opacity=".55"/>';
  for(i=lx0;i<=lx1;i++){ var xx=xf(Math.pow(10,i)); s+='<line x1="'+xx.toFixed(1)+'" y1="'+yT+'" x2="'+xx.toFixed(1)+'" y2="'+yB+'" stroke="#E3E8EC"/><text x="'+xx.toFixed(1)+'" y="334" text-anchor="middle" class="tick">10'+supStr(i)+'</text>'; }
  minor.forEach(function(v){var y=yf(v); s+='<line x1="'+x0+'" y1="'+y.toFixed(1)+'" x2="'+x1+'" y2="'+y.toFixed(1)+'" stroke="#EEF1F4"/>';});
  ticks.forEach(function(v){var y=yf(v); s+='<line x1="'+x0+'" y1="'+y.toFixed(1)+'" x2="'+x1+'" y2="'+y.toFixed(1)+'" stroke="#DCE2E7"/><text x="44" y="'+(y+4).toFixed(1)+'" text-anchor="end" class="tick">'+comma(v)+'</text>';});
  s+='<line x1="'+x0+'" y1="'+yB+'" x2="'+x1+'" y2="'+yB+'" stroke="#9AA6B2" stroke-width="1.2"/><text x="'+x1+'" y="354" text-anchor="end" class="axis">진공도 Pa, 오른쪽일수록 진공이 나쁨</text><text x="44" y="10" text-anchor="end" class="axis">W</text>';
  if(xl>x0&&xl<x1) s+='<line x1="'+xl.toFixed(1)+'" y1="'+yT+'" x2="'+xl.toFixed(1)+'" y2="'+yB+'" stroke="#C7922F" stroke-width="1.5" stroke-dasharray="4 4"/><text x="'+(xl+8).toFixed(1)+'" y="32" class="note warn">기준값 '+sciOf(CFG.VAC_LIMIT)+'보다 나쁘면 주의</text>';
  var ya=yf(A); s+='<line x1="'+x0+'" y1="'+ya.toFixed(1)+'" x2="'+x1+'" y2="'+ya.toFixed(1)+'" stroke="#97A3AF" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/><text x="60" y="'+(ya-8).toFixed(1)+'" class="note">A 폼 단열 '+fW(A)+' W (진공과 무관)</text>';
  function line(c,stroke,w,dash){ return '<path d="'+c.map(function(v,j){return (j?'L':'M')+xf(pts[j]).toFixed(1)+','+yf(v).toFixed(1);}).join(' ')+'" fill="none" stroke="'+stroke+'" stroke-width="'+w+'"'+(dash?' stroke-dasharray="'+dash+'"':'')+' stroke-linejoin="round"/>'; }
  s+=line(cB,'#5F7C9E',2.5,'7 5')+line(cC,'#1E63B5',3);
  var cp=Math.min(Math.max(curP,1e-4),1e2), cx=xf(cp);
  var qB=core(Object.assign({},pB,{P:cp})).Q, qC=core(Object.assign({},pC,{P:cp})).Q, yb=yf(qB), yc=yf(qC);
  s+='<circle cx="'+cx.toFixed(1)+'" cy="'+yb.toFixed(1)+'" r="5.5" fill="#5F7C9E" stroke="#fff" stroke-width="2"/>';
  s+='<circle cx="'+cx.toFixed(1)+'" cy="'+yc.toFixed(1)+'" r="6.5" fill="#1E63B5" stroke="#fff" stroke-width="2"/>';
  var lbx=Math.min(Math.max(cx,110),x1-70);
  if(Math.abs(yb-yc)>24) s+='<text x="'+(cx+10).toFixed(1)+'" y="'+(yb-10).toFixed(1)+'" class="note">B '+fW(qB)+' W</text>';
  var ly=yc+26>yB-6?yc-30:yc+26;
  s+='<text x="'+lbx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" class="note strong">현재 설계 C '+fW(qC)+' W</text><text x="'+lbx.toFixed(1)+'" y="'+(ly+17).toFixed(1)+'" text-anchor="middle" class="note">'+sciOf(curP)+'</text>';
  return s+'</svg>';
}
function niceStep(raw){ if(!(raw>0)) return 1; var e=Math.pow(10,Math.floor(Math.log10(raw))), f=raw/e; return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*e; }
function renderCompare(){
  var el=document.getElementById('view-compare'), v=validate(state);
  var head=pageHead('단열 비교','최대 3개 안을 나란히 놓고 기준안보다 열유입·증발량·손실액이 얼마나 줄어드는지 봅니다.',
    '<button type="button" class="btn disabled" disabled>'+ic('plus')+'안 추가 3/3</button><button type="button" class="btn primary" data-act="tab" data-v="payback">회수기간 계산</button>');
  if(!v.ok){ el.innerHTML='<main class="page">'+head+blocked(v)+flowNav('compare')+'</main>'; return; }
  var sc=scenarios(), p=params(state), foam=p.method==='foam';
  var sl='';
  if(!foam){
    if(p.method==='mli') sl+='<div class="sl"><div class="sl-top"><span>MLI 층수</span><b id="sl-mli-v">'+p.N+'층</b></div><input class="rng" type="range" min="1" max="40" step="1" value="'+Math.min(40,p.N)+'" data-range="mli" aria-label="MLI 층수"><div class="sl-range"><span>1</span><span>40층</span></div></div>';
    sl+='<div class="sl"><div class="sl-top"><span>지지대 간격</span><b id="sl-sp-v">'+p.spacing.toFixed(1)+' m</b></div><input class="rng" type="range" min="1" max="4" step="0.1" value="'+Math.min(4,Math.max(1,p.spacing))+'" data-range="spacing" aria-label="지지대 간격"><div class="sl-range"><span>1.0 m</span><span>4.0 m</span></div></div>';
  } else sl='<p class="help">현재 입력이 폼 단열이라 조정할 진공층 값이 없습니다. 입력에서 단열 방식을 바꾸면 여기서 조정할 수 있습니다.</p>';
  var h='<div class="scen" id="cmp-cards">'+cmpCards(sc)+'</div><div class="compare-grid"><div class="cmp-left">'+
    '<section class="panel"><div class="panel-head"><h2>안별 비교</h2></div><div class="panel-body" id="cmp-bars">'+cmpBars(sc)+'</div></section>'+
    '<section class="panel"><div class="panel-head"><h2>C안 조정</h2><span class="sub">끌면 카드와 그래프가 바로 바뀝니다. 입력값에도 반영됩니다.</span></div><div class="panel-body stack">'+sl+'</div></section></div>'+
    '<section class="panel"><div class="panel-head"><h2>진공도 민감도</h2><span class="sub">진공이 나빠지면 열유입이 얼마나 뛰는지</span><span class="right switch" data-act="logy" role="switch" tabindex="0" aria-checked="'+state.ui.logY+'"><span class="tog'+(state.ui.logY?' on':'')+'"><span class="knob"></span></span>세로축 로그</span></div>'+
    '<div class="panel-body"><div class="legend"><span><i class="ln a"></i>A 폼 단열</span><span><i class="ln b"></i>B 진공만</span><span><i class="ln c"></i>C '+esc(sc.C.title)+'</span><span><i class="dot"></i>현재 설계</span><span><i class="ln t"></i>기준값</span></div><div id="cmp-chart">'+sensChart(sc)+'</div></div></section></div>';
  el.innerHTML='<main class="page">'+head+h+disclaimer()+flowNav('compare')+'</main>';
  syncRanges(el);
}
function refreshCompare(){
  var sc=scenarios(), p=params(state);
  if(!document.getElementById('cmp-cards')){ renderCompare(); return; }
  document.getElementById('cmp-cards').innerHTML=cmpCards(sc);
  document.getElementById('cmp-bars').innerHTML=cmpBars(sc);
  document.getElementById('cmp-chart').innerHTML=sensChart(sc);
  var a=document.getElementById('sl-mli-v'); if(a) a.textContent=p.N+'층';
  var b=document.getElementById('sl-sp-v'); if(b) b.textContent=p.spacing.toFixed(1)+' m';
  syncRanges(document.getElementById('view-compare'));
}
function syncRanges(root){ root.querySelectorAll('input[type=range]').forEach(function(r){ var p=(r.value-r.min)/(r.max-r.min)*100; r.style.setProperty('--p',p+'%'); }); }

/* =========================================================
   10. ④ 절감액·회수기간
   ========================================================= */
function payback(sc,priceOverride){
  var p=params(state), price=priceOverride!=null?priceOverride:p.price, rec=p.rec, inv=num(state.ui.invest);
  var b=sc[state.ui.pbBase], a=sc[state.ui.pbAlt];
  var dkg=b.bogYr-a.bogYr, save=sig3v(dkg)*price*(1-rec/100), yrs=save>0&&inv>=0?inv/save:NaN;
  return {base:state.ui.pbBase, alt:state.ui.pbAlt, dkg:dkg, save:save, yrs:yrs, inv:inv, price:price, rec:rec};
}
function cumChart(pb,small){
  var W=small?682:556,H=small?150:300,x0=small?50:58,x1=small?668:536,yT=small?12:34,yB=small?120:260,cls=small?' sm':'';
  var horizon=(!isFinite(pb.yrs)||pb.yrs<=1)?2:Math.min(40,Math.ceil(pb.yrs*1.5));
  var saveM=Math.max(0,pb.save)/1e4, invM=pb.inv/1e4, endM=saveM*horizon, mx=Math.max(invM,endM,1);
  var step=niceStep(mx/3), yMax=Math.ceil(mx/step)*step;
  var yf=function(v){return yB-v/yMax*(yB-yT);}, xf=function(t){return x0+t/horizon*(x1-x0);};
  var s='<svg class="chart" width="100%" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="누적 절감액과 추가 투자비">';
  for(var v=0;v<=yMax+1e-9;v+=step){ var y=yf(v); s+='<line x1="'+x0+'" y1="'+y.toFixed(1)+'" x2="'+x1+'" y2="'+y.toFixed(1)+'" stroke="'+(v===0?'#9AA6B2':'#E3E8EC')+'" stroke-width="'+(v===0?1.2:1)+'"/><text x="'+(x0-8)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" class="tick'+cls+'">'+comma(v)+'</text>'; }
  var tickStep=horizon<=2?0.5:horizon<=6?1:Math.ceil(horizon/5);
  for(var t=0;t<=horizon+1e-9;t+=tickStep){ var lab=t===0?'0':(t<1?Math.round(t*12)+'개월':(Math.abs(t-Math.round(t))<1e-9?Math.round(t)+'년':Math.floor(t)+'년 '+Math.round((t-Math.floor(t))*12)+'개월')); s+='<text x="'+xf(t).toFixed(1)+'" y="'+(small?135:278)+'" text-anchor="'+(t===0?'start':t>=horizon-1e-9?'end':'middle')+'" class="tick'+cls+'">'+lab+'</text>'; }
  var yi=yf(invM);
  s+='<line x1="'+x0+'" y1="'+yi.toFixed(1)+'" x2="'+x1+'" y2="'+yi.toFixed(1)+'" stroke="#C47F21" stroke-width="2" stroke-dasharray="6 4"/>';
  s+='<line x1="'+x0+'" y1="'+yB+'" x2="'+x1+'" y2="'+yf(endM).toFixed(1)+'" stroke="#1E63B5" stroke-width="'+(small?2.5:3)+'"/>';
  if(isFinite(pb.yrs)&&pb.yrs<=horizon){
    var px=xf(pb.yrs), txt=fPayback(pb.yrs).txt;
    s+='<line x1="'+px.toFixed(1)+'" y1="'+yi.toFixed(1)+'" x2="'+px.toFixed(1)+'" y2="'+yB+'" stroke="#1E63B5" stroke-width="1.2" stroke-dasharray="3 3"/><circle cx="'+px.toFixed(1)+'" cy="'+yi.toFixed(1)+'" r="'+(small?5:6)+'" fill="#1E63B5" stroke="#fff" stroke-width="2"/>';
    var left=px>x0+80;
    s+='<text x="'+(left?px-10:px+10).toFixed(1)+'" y="'+(yi-12).toFixed(1)+'" text-anchor="'+(left?'end':'start')+'" class="note'+cls+' strong">회수 시점 '+txt+'</text>';
  }
  s+='<text x="'+(x1-4)+'" y="'+(yi+18).toFixed(1)+'" text-anchor="end" class="note'+cls+' amber">추가 투자비 '+fMoney(pb.inv)+'</text>';
  if(small) s+='<text x="'+(x1-4)+'" y="'+(yf(endM)+18).toFixed(1)+'" text-anchor="end" class="note sm blue">누적 절감액</text>';
  else s+='<text x="'+(x0-8)+'" y="14" text-anchor="end" class="axis">만원</text>';
  return s+'</svg>';
}
function pbResults(sc){
  var pb=payback(sc), pf=fPayback(pb.yrs), sm=moneyParts(pb.save);
  var warn=pb.base===pb.alt?'기준안과 대안이 같습니다. 다른 안을 고르세요.':(pb.dkg<=0?'대안의 증발량이 기준안보다 적지 않아 절감액이 생기지 않습니다.':'');
  var h='<section class="kpis three">'+
    '<div class="kpi"><span class="k">연간 절감량</span><span class="v">'+(pb.dkg>0?fs3(pb.dkg):'0')+'<span class="u">kg/년</span></span><span class="s">기준안 '+pb.base+'보다 덜 증발하는 양</span></div>'+
    '<div class="kpi"><span class="k">연간 절감액</span><span class="v">'+(pb.save>0?sm.v:'0')+'<span class="u">'+(pb.save>0?sm.u:'원')+'/년</span></span><span class="s">단가 '+comma(pb.price)+'원/kg, 회수율 '+pb.rec+' %</span></div>'+
    '<div class="kpi hl"><span class="k">회수기간</span><span class="v">'+pf.v+'<span class="u">'+pf.u+'</span></span><span class="s">'+(isFinite(pb.yrs)?pb.yrs.toFixed(3)+'년, ':'')+'추가 투자비 '+fMoney(pb.inv)+'</span></div></section>';
  if(warn) h+='<div class="issue warn">'+ic('warn')+'<div><b>회수기간</b><span>'+warn+'</span></div></div>';
  var base=pb.price>0?pb.price:10000, list=[base*0.5,base,base*1.5];
  h+='<div class="pb-charts"><section class="panel"><div class="panel-head"><h2>누적 절감액</h2><span class="sub">투자비 선을 넘는 곳이 회수 시점입니다</span></div><div class="panel-body"><div class="legend"><span><i class="ln c"></i>누적 절감액</span><span><i class="ln inv"></i>추가 투자비</span></div>'+cumChart(pb,false)+'</div></section>'+
    '<section class="panel"><div class="panel-head"><h2>단가 민감도</h2></div><div class="panel-body tight"><table class="dt sens"><thead><tr><th class="r">단가 원/kg</th><th class="r">연간 절감액</th><th class="r">회수기간</th></tr></thead><tbody>'+
    list.map(function(pr,i){var q=payback(sc,pr), f=fPayback(q.yrs); return '<tr class="'+(i===1&&pb.price>0?'cur':'')+'"><td class="r">'+comma(pr)+(i===1&&pb.price>0?'<span class="badge accent sm">현재</span>':'')+'</td><td class="r">'+(q.save>0?fMoney(q.save):'–')+'</td><td class="r"><b>'+f.txt+'</b><em>'+(isFinite(q.yrs)?q.yrs.toFixed(3)+'년':'')+'</em></td></tr>';}).join('')+
    '</tbody></table><p class="caption pad">단가가 오를수록 회수기간이 짧아집니다.</p></div></section></div>';
  return h;
}
function renderPayback(){
  var el=document.getElementById('view-payback'), v=validate(state);
  var head=pageHead('절감액·회수기간','더 좋은 단열에 더 들인 돈을 몇 달 만에 되찾는지 계산합니다.','<button type="button" class="btn primary" data-act="tab" data-v="report">'+ic('doc')+'리포트 출력</button>');
  if(!v.ok){ el.innerHTML='<main class="page">'+head+blocked(v)+flowNav('payback')+'</main>'; return; }
  var sc=scenarios(), opts=['A','B','C'].map(function(k){return [k,k+' '+sc[k].title];});
  var price=num(state.op.price), pmax=Math.max(20000,Math.ceil((price||0)*2/1000)*1000);
  var cond='<section class="panel"><div class="panel-head"><h2>조건</h2></div><div class="panel-body stack">'+
    fld({key:'ui.pbBase',label:'기준안',value:state.ui.pbBase,select:opts})+
    fld({key:'ui.pbAlt',label:'대안',value:state.ui.pbAlt,select:opts})+
    fld({key:'ui.invest',label:'추가 투자비',value:state.ui.invest,unit:'원',comma:true,help:'대안을 고르면 더 드는 비용, '+fMoney(num(state.ui.invest))})+
    '<div class="field"><span class="lab">유체 단가</span><div class="slider-row"><input class="rng" type="range" min="0" max="'+pmax+'" step="500" value="'+(isFinite(price)?price:0)+'" data-range="price" aria-label="유체 단가"><div class="ctl" data-ctl="op.price"><input type="text" inputmode="decimal" class="r" data-k="op.price" data-comma="1" value="'+esc(state.op.price)+'" aria-label="유체 단가"><span class="u">원/kg</span></div></div><div class="sl-range"><span>0</span><span>'+comma(pmax)+'원/kg</span></div></div>'+
    fld({key:'op.recovery',label:'BOG 회수율',value:state.op.recovery,unit:'%',help:'회수해 다시 쓰는 비율만큼 절감액이 줄어듭니다.'})+
    '</div></section>';
  var formula='<section class="formula"><div><span class="fk">연간 절감액</span><span class="fv">= (기준안 BOG − 대안 BOG) × 단가 × (1 − 회수율)</span></div><div><span class="fk">회수기간</span><span class="fv">= 추가 투자비 ÷ 연간 절감액</span></div><p>'+ic('info',16,1.8)+'단가와 회수율은 입력값 기준 추정입니다.</p></section>';
  el.innerHTML='<main class="page">'+head+'<div class="payback-grid">'+cond+'<div class="pb-right"><div id="pb-res" style="display:flex;flex-direction:column;gap:16px">'+pbResults(sc)+'</div>'+formula+'</div></div>'+flowNav('payback')+'</main>';
  syncRanges(el);
}
function refreshPayback(){
  var el=document.getElementById('view-payback'), v=validate(state), box=document.getElementById('pb-res');
  if(!box) return;
  el.querySelectorAll('[data-ctl]').forEach(function(c){var it=v.by[c.getAttribute('data-ctl')]; c.classList.toggle('err',!!it&&it.lvl==='err');});
  var inv=num(state.ui.invest), invEl=el.querySelector('[data-ctl="ui.invest"]'); if(invEl) invEl.classList.toggle('err',!(inv>=0));
  var h=el.querySelector('[data-msg="ui.invest"]'); if(h) h.textContent=inv>=0?'대안을 고르면 더 드는 비용, '+fMoney(inv):'0 이상으로 입력하세요.';
  var rm=el.querySelector('[data-msg="op.recovery"]'); if(rm){ var it=v.by['op.recovery']; rm.className=it?'msg err':'help'; rm.innerHTML=it?ic('err')+'<span>'+esc(it.msg)+'</span>':'회수해 다시 쓰는 비율만큼 절감액이 줄어듭니다.'; }
  if(!v.ok||!(inv>=0)){ box.innerHTML='<div class="issue err">'+ic('err')+'<div><b>계산 멈춤</b><span>'+(v.ok?'추가 투자비를 확인하세요.':esc(v.errs[0].sum))+'</span></div></div>'; return; }
  box.innerHTML=pbResults(scenarios());
}

/* =========================================================
   11. ⑤ 리포트
   ========================================================= */
function rpFileName(){
  var n=(state.project.name||'프로젝트').replace(/\([^)]*\)/g,'').trim().split(/\s+/).pop()||'프로젝트';
  n=n.replace(/[\\/:*?"<>|]/g,'');
  return 'Nexergy_'+n+'_'+String(state.project.date||'').replace(/-/g,'')+'.pdf';
}
function nowStr(){ var d=new Date(), z=function(n){return (n<10?'0':'')+n;}; return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+' '+z(d.getHours())+':'+z(d.getMinutes()); }
function netSmall(r,id){
  var ps=paths(r), byK={}; ps.forEach(function(p){byK[p.k]=p;});
  var foam=r.p.method==='foam', rows=foam?[[byK.foam,44],[byK.parts,132]]:[[byK.rad,24],[byK.gas,66],[byK.sup,112],[byK.parts,152]];
  var dash={gas:'2 3',sup:'6 3'}, maxQ=Math.max.apply(null,ps.map(function(p){return p.Q;}))||1;
  var s='<svg class="chart" width="682" height="168" viewBox="0 0 682 168" role="img" aria-label="열저항망 축소판">'+patDefs(id);
  s+='<rect x="0" y="54" width="78" height="68" rx="6" fill="#FFFFFF" stroke="#16202A"/><text x="10" y="78" class="nlab sm">외기</text><text x="10" y="102" class="nval sm">'+r.p.Ta+' °C</text>';
  var y0=rows[0][1], y1=rows[rows.length-1][1];
  s+='<line x1="78" y1="88" x2="100" y2="88" stroke="#16202A" stroke-width="1.2"/><line x1="100" y1="'+y0+'" x2="100" y2="'+y1+'" stroke="#16202A" stroke-width="1.2"/><line x1="520" y1="'+y0+'" x2="520" y2="'+y1+'" stroke="#16202A" stroke-width="1.2"/><line x1="520" y1="88" x2="542" y2="88" stroke="#16202A" stroke-width="1.2"/>';
  rows.forEach(function(row){var p=row[0],y=row[1],sw=Math.max(1.4,7.8*p.Q/maxQ);
    s+='<line x1="100" y1="'+y+'" x2="520" y2="'+y+'" stroke="'+p.color+'" stroke-width="'+sw.toFixed(1)+'"'+(dash[p.k]?' stroke-dasharray="'+dash[p.k]+'"':'')+'/><rect x="296" y="'+(y-8)+'" width="48" height="16" rx="2" fill="#FFFFFF" stroke="'+p.color+'" stroke-width="1.5"/><text x="112" y="'+(y-7)+'" class="llab sm">'+p.name+'</text><text x="510" y="'+(y-7)+'" text-anchor="end" class="lval sm">'+fW(p.Q)+' W</text>';});
  s+='<rect x="542" y="54" width="140" height="68" rx="6" fill="#FFFFFF" stroke="#16202A" stroke-width="1.5"/><text x="552" y="78" class="nlab sm">'+r.p.fluid.short+' '+(r.p.Tf<0?'−'+Math.abs(r.p.Tf):r.p.Tf)+' °C</text><text x="552" y="102" class="nval sm">합계 '+fW(r.Q)+' W</text>';
  return s+'</svg>';
}
function reportPages(pfx){
  var r=core(params(state)), p=r.p, ps=paths(r), rows=itemRows(r), rep=state.ui.rep, sc=scenarios(), stamp=nowStr();
  var mats=[]; p.segs.forEach(function(s){if(mats.indexOf(s.mat)<0) mats.push(s.mat);});
  var insTxt=p.method==='foam'?'폼 '+fLen(p.foamT*1000)+' mm, '+p.foamK+' W/m·K':methodLabel(p)+', '+sciOf(p.P);
  var supTxt=p.method==='foam'?'해당 없음 (폼 단열)':p.supMat+', '+p.spacing.toFixed(1)+' m 간격, '+r.nsup+'개';
  var top='<div class="rp-top"><span class="rp-word">Nexergy</span><span class="rp-doc">'+p.fluid.short+' 배관 열유입 분석 리포트</span></div>';
  var hasP2=rep.cmp||rep.pb||rep.asm, total=hasP2?2:1;
  var foot=function(n){return '<div class="rp-foot"><span>Nexergy</span><span>'+n+' / '+total+'</span><span>출력 '+stamp+'</span></div>';};
  var p1='<div class="rp">'+top+'<h1 class="rp-title">'+esc(state.project.name)+'</h1><div class="rp-meta"><span>작성자 '+esc(state.project.author)+'</span><span>작성일 '+esc(state.project.date)+'</span></div>'+
    (state.project.memo?'<p class="rp-line" style="margin-top:8px;color:var(--ink-2)">메모: '+esc(state.project.memo)+'</p>':'')+
    '<section class="rp-sec"><h3><span class="n">1</span>입력 조건</h3><table class="rp-kv"><tr><th>유체</th><td>'+p.fluid.short+', 운전 압력 '+p.pressure+' barg</td><th>외기 온도</th><td>'+p.Ta+' °C</td></tr><tr><th>연간 운전</th><td>'+comma(p.hours)+' h/년</td><th>유체 단가</th><td>'+comma(p.price)+'원/kg, 회수율 '+p.rec+' %</td></tr><tr><th>배관</th><td>'+r.segs.length+'개 구간, 총 '+r.L.toFixed(1)+' m, '+mats.join('·')+'</td><th>단열</th><td>'+esc(insTxt)+'</td></tr><tr><th>지지대</th><td>'+esc(supTxt)+'</td><th>부품</th><td>'+esc(partDesc(r.parts).list)+'</td></tr></table></section>'+
    '<section class="rp-sec"><h3><span class="n">2</span>결과 요약</h3><div class="rp-kpis">'+
      '<div><span class="k">총 열유입</span><span class="v">'+fW(r.Q)+' W</span><span class="s">배관 '+r.L.toFixed(1)+' m와 부품 '+r.partQty+'개</span></div>'+
      '<div><span class="k">단위 길이당</span><span class="v">'+fWm(r.perM)+' W/m</span><span class="s">총 열유입 ÷ 배관 길이</span></div>'+
      '<div><span class="k">증발량 BOG</span><span class="v">'+fs3(r.bogDay)+' kg/일</span><span class="s">연 '+fs3(r.bogYr)+' kg</span></div>'+
      '<div><span class="k">연간 손실액</span><span class="v">'+fWonFull(r.loss)+'</span><span class="s">단가 '+comma(p.price)+'원/kg</span></div></div></section>'+
    '<section class="rp-sec"><h3><span class="n">3</span>열유입 구성</h3>'+stackBar(ps,682,20,2,true)+compTable(ps,'rp-t legend-t',true)+
    '<table class="rp-t"><thead><tr><th>구간·부품</th><th class="r">길이·수량</th><th class="r">열유입 W</th><th class="r">W/m</th><th class="r">BOG kg/년</th></tr></thead><tbody>'+
    rows.map(function(x){return '<tr><td>'+esc(x.name)+'</td><td class="r">'+x.amt+'</td><td class="r">'+fW(x.Q)+'</td><td class="r">'+(isFinite(x.perM)?fWm(x.perM):'–')+'</td><td class="r">'+fs3(x.bog)+'</td></tr>';}).join('')+
    '</tbody><tfoot><tr><td>합계</td><td class="r">'+fLen(r.L)+' m, '+r.partQty+'개</td><td class="r">'+fW(r.Q)+'</td><td class="r">'+fWm(r.perM)+'</td><td class="r">'+fs3(r.bogYr)+'</td></tr></tfoot></table></section>'+foot(1)+'</div>';
  if(!hasP2) return [fixW(p1)];
  var n=4, p2='<div class="rp">'+top, first=true;
  function sec(t){ var h='<section class="rp-sec'+(first?' first':'')+'"><h3><span class="n">'+(n++)+'</span>'+t+'</h3>'; first=false; return h; }
  if(rep.cmp){
    var base=state.ui.base, maxQ=Math.max(sc.A.Q,sc.B.Q,sc.C.Q), id=pfx+'rb';
    p2+=sec('단열 비교')+'<table class="rp-t"><thead><tr><th>안</th><th class="r">열유입 W</th><th class="r">BOG kg/년</th><th class="r">손실액 원/년</th><th class="r">'+base+' 대비</th></tr></thead><tbody>'+
      ['A','B','C'].map(function(k){var x=sc[k]; return '<tr><td>'+k+' '+esc(x.title)+(k===base?' (기준안)':'')+'</td><td class="r">'+fW(x.Q)+'</td><td class="r">'+fs3(x.bogYr)+'</td><td class="r">'+comma(sig3v(x.loss))+'</td><td class="r">'+(k===base?'기준':fRed((x.Q-sc[base].Q)/sc[base].Q*100))+'</td></tr>';}).join('')+'</tbody></table>'+
      '<svg class="chart" width="682" height="78" viewBox="0 0 682 78" role="img" aria-label="안별 열유입 막대">'+patDefs(id)+
      ['A','B','C'].map(function(k,i){var w=Math.max(2,520*sc[k].Q/maxQ), y=2+26*i, f=k==='A'?'#BCC5CE':k==='B'?'url(#'+id+'-scb)':'#1E63B5'; return '<text x="0" y="'+(y+12)+'" class="llab sm">'+k+'</text><rect x="22" y="'+y+'" width="'+w.toFixed(1)+'" height="16" rx="2" fill="'+f+'"/><text x="'+(30+w).toFixed(1)+'" y="'+(y+13)+'" class="lval sm">'+fW(sc[k].Q)+' W</text>';}).join('')+'</svg></section>';
  }
  if(rep.pb){
    var pb=payback(sc), pf=fPayback(pb.yrs);
    p2+=sec('절감액·회수기간')+'<p class="rp-line">기준안 '+pb.base+' '+esc(sc[pb.base].title)+'에서 대안 '+pb.alt+' '+esc(sc[pb.alt].title)+'으로 바꾸고 '+comma(pb.inv)+'원을 더 들이는 경우</p>'+
      '<div class="rp-kpis three"><div><span class="k">연간 절감량</span><span class="v">'+(pb.dkg>0?fs3(pb.dkg):'0')+' kg/년</span></div><div><span class="k">연간 절감액</span><span class="v">'+(pb.save>0?comma(sig3v(pb.save)):'0')+'원</span></div><div><span class="k">회수기간</span><span class="v">'+(isFinite(pb.yrs)?pb.yrs.toFixed(3)+'년':'회수 안 됨')+'</span><span class="s">'+(isFinite(pb.yrs)?pf.txt:'')+'</span></div></div>'+cumChart(pb,true)+'</section>';
  }
  if(rep.asm){
    p2+=sec('계산 가정과 열저항망')+netSmall(r,pfx+'nc')+'<dl class="rp-dl">'+[['외기 온도',p.Ta+' °C'],[p.fluid.short+' 온도',(p.Tf<0?'−'+Math.abs(p.Tf):p.Tf)+' °C'],['증발잠열',p.latent+' kJ/kg'],['연간 운전',comma(p.hours)+' h'],['단가',comma(p.price)+'원/kg'],['회수율',p.rec+' %']].map(function(a){return '<div><dt>'+a[0]+'</dt><dd>'+a[1]+'</dd></div>';}).join('')+'</dl></section>';
  }
  p2+='<p class="rp-notice">설계 검토용 추정치입니다. 제조사 사양과 실측으로 확인하세요. 단가와 회수율은 입력값 기준 추정입니다.</p>'+foot(2)+'</div>';
  return [p1,p2].map(fixW);
}
function fixW(h){ return h.replace(/width="100%"/g,'width="682"'); }
function renderReport(){
  var el=document.getElementById('view-report'), v=validate(state);
  var head=pageHead('리포트','검토 회의에 들고 갈 A4 PDF를 미리 보고 내려받습니다.','<button type="button" class="btn" data-act="print"'+(v.ok?'':' disabled')+'>'+ic('print')+'인쇄</button><button type="button" class="btn primary" data-act="pdf"'+(v.ok?'':' disabled')+'>'+ic('down')+'PDF 다운로드</button>');
  if(!v.ok){ el.innerHTML='<main class="page">'+head+blocked(v)+flowNav('report')+'</main>'; return; }
  var rep=state.ui.rep;
  function cb(key,title,desc,locked){ var on=locked||rep[key]; return '<div class="cbx'+(locked?' locked-row':'')+'"'+(locked?'':' data-act="rep" data-v="'+key+'" role="checkbox" tabindex="0" aria-checked="'+on+'"')+'><span class="box'+(on?' on':'')+(locked?' locked':'')+'">'+(on?ic('check',14,2.6):'')+'</span><div><b>'+title+'</b><span>'+desc+'</span></div></div>'; }
  var hasP2=rep.cmp||rep.pb||rep.asm;
  var side='<aside class="panel rset"><div class="panel-head"><h2>넣을 항목</h2></div><div class="panel-body">'+
    cb('sum','결과 요약','입력 조건, KPI 4개, 열유입 구성. 항상 들어갑니다.',true)+
    cb('cmp','단열 비교','A·B·C 안 비교 표와 막대')+
    cb('pb','절감액·회수기간',state.ui.pbBase+'에서 '+state.ui.pbAlt+'로 바꿀 때의 회수기간')+
    cb('asm','계산 가정과 열저항망','2쪽 아래에 축소판으로')+
    '<dl class="rmeta"><div><dt>용지</dt><dd>A4 세로, '+(hasP2?2:1)+'쪽</dd></div><div><dt>파일 이름</dt><dd>'+esc(rpFileName())+'</dd></div></dl>'+
    '<button type="button" class="btn primary block" data-act="pdf">'+ic('down')+'PDF 다운로드</button></div></aside>';
  var z=state.ui.zoom;
  var pv='<section class="pv" id="pv"><div class="pv-bar"><span class="pv-title">미리보기</span><span class="pv-pages">'+(hasP2?'1–2쪽':'1쪽')+'</span><span class="pv-zoom"><select data-zoom aria-label="배율">'+[['fit','맞춤'],['0.5','50%'],['0.75','75%'],['1','100%']].map(function(o){return '<option value="'+o[0]+'"'+(z===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></span></div>'+
    '<div class="pv-pages-row">'+reportPages('pv').map(function(pg){return '<div class="pv-page">'+pg+'</div>';}).join('')+'</div></section>';
  el.innerHTML='<main class="page">'+head+'<div class="report-grid">'+side+pv+'</div>'+flowNav('report')+'</main>';
  applyZoom();
}
function applyZoom(){
  var pv=document.getElementById('pv'); if(!pv) return;
  var pages=pv.querySelectorAll('.pv-page'), z=state.ui.zoom, val;
  if(z==='fit'){ var avail=pv.clientWidth-48-(pages.length-1)*24; val=Math.min(1,Math.max(0.3,avail/(794*pages.length))); }
  else val=Number(z);
  pages.forEach(function(p){p.style.zoom=val;});
}
function stagePages(){
  var stage=document.createElement('div'); stage.className='pdf-stage';
  stage.innerHTML=reportPages('pd'+Date.now()).join('');
  document.body.appendChild(stage); return stage;
}
function doPrint(){
  var root=document.getElementById('print-root');
  root.innerHTML=reportPages('pr').join('');
  window.print();
}
function doPdf(){
  if(!window.html2canvas||!window.jspdf){ toast('PDF 모듈을 불러오지 못해 인쇄 창으로 엽니다. "PDF로 저장"을 고르세요.'); doPrint(); return; }
  toast('PDF를 만드는 중입니다…');
  var y0=window.scrollY; window.scrollTo(0,0);
  var stage=stagePages(), pages=[].slice.call(stage.querySelectorAll('.rp'));
  var pdf=new window.jspdf.jsPDF({unit:'mm',format:'a4',orientation:'portrait'});
  var chain=Promise.resolve();
  pages.forEach(function(pg,i){
    chain=chain.then(function(){
      return window.html2canvas(pg,{scale:2,useCORS:true,backgroundColor:'#ffffff',scrollX:0,scrollY:0,width:794,height:1122,windowWidth:1440}).then(function(cv){
        if(i>0) pdf.addPage();
        pdf.addImage(cv.toDataURL('image/jpeg',0.95),'JPEG',0,0,210,297);
      });
    });
  });
  chain.then(function(){ pdf.save(rpFileName()); stage.remove(); window.scrollTo(0,y0); toast('PDF를 내려받았습니다.'); })
    .catch(function(){ stage.remove(); window.scrollTo(0,y0); toast('PDF 생성에 실패해 인쇄 창으로 엽니다.'); doPrint(); });
}
var toastTimer;
function toast(t){ var el=document.getElementById('toast'); el.textContent=t; el.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(function(){el.hidden=true;},2600); }

/* =========================================================
   12. 클릭형 프로토타입: 화면 이동 / 주소(#) 연동 / 클릭 영역 표시
   ========================================================= */
var VIEWS=['input','result','compare','payback','report'];
var lastDir=1;
function protobarHTML(){
  var i=VIEWS.indexOf(state.ui.tab);
  return '<button type="button" data-act="proto-prev" title="이전 화면 (←)"'+(i<=0?' disabled':'')+'>'+ic('left')+'이전</button>'+
    '<span class="pos"><em>'+(i+1)+' / '+VIEWS.length+'</em>'+TABS[i][1]+'</span>'+
    '<span class="dots">'+VIEWS.map(function(v,j){return '<i class="'+(j===i?'on':'')+'" data-act="tab" data-v="'+v+'" title="'+TABS[j][1]+'"></i>';}).join('')+'</span>'+
    '<button type="button" data-act="proto-next" title="다음 화면 (→)"'+(i>=VIEWS.length-1?' disabled':'')+'>다음'+ic('right')+'</button>'+
    '<span class="sep"></span>'+
    '<button type="button" data-act="hs" class="'+(state.ui.hs?'on':'')+'" title="클릭할 수 있는 곳을 표시합니다" aria-pressed="'+state.ui.hs+'">'+ic('tap')+'클릭 영역</button>';
}
function renderAll(){
  document.getElementById('topbar').innerHTML=topbarHTML();
  paintSaved();
  document.getElementById('protobar').innerHTML=protobarHTML();
  document.body.classList.toggle('hs-show',!!state.ui.hs);
  VIEWS.forEach(function(v){ document.getElementById('view-'+v).hidden=state.ui.tab!==v; });
  var t=state.ui.tab;
  if(t==='input') renderInput(); else if(t==='result') renderResult(); else if(t==='compare') renderCompare(); else if(t==='payback') renderPayback(); else renderReport();
}
function playEnter(){
  var el=document.getElementById('view-'+state.ui.tab);
  el.classList.remove('enter','back'); void el.offsetWidth;
  el.classList.add('enter'); if(lastDir<0) el.classList.add('back');
}
function setHash(tab){
  try{ if(location.hash!=='#'+tab) history.pushState(null,'','#'+tab); }catch(e){}
}
function go(tab){
  if(VIEWS.indexOf(tab)<0) return;
  lastDir=VIEWS.indexOf(tab)>=VIEWS.indexOf(state.ui.tab)?1:-1;
  state.ui.tab=tab; save(); setHash(tab); renderAll(); playEnter(); window.scrollTo(0,0);
}
function hashTab(){ var h=(location.hash||'').replace('#',''); return VIEWS.indexOf(h)>=0?h:null; }
function onHash(){
  var h=hashTab(); if(!h||h===state.ui.tab) return;
  lastDir=VIEWS.indexOf(h)>=VIEWS.indexOf(state.ui.tab)?1:-1;
  state.ui.tab=h; save(); renderAll(); playEnter(); window.scrollTo(0,0);
}
window.addEventListener('popstate',onHash);
window.addEventListener('hashchange',onHash);

function setPath(path,val){ var ks=path.split('.'), o=state; for(var i=0;i<ks.length-1;i++) o=o[ks[i]]; o[ks[ks.length-1]]=val; }
function onValueChange(){ save(); var t=state.ui.tab; if(t==='input') updateInput(); else if(t==='compare') refreshCompare(); else if(t==='payback') refreshPayback(); }

document.addEventListener('input',function(e){
  var t=e.target, d=t.dataset;
  if(d.k){
    var val=t.value;
    if(d.k==='ins.ve') val=val.replace(/[−–]/g,'-');
    setPath(d.k,val);
    if(d.k==='sup.mat'&&SUPMAT[val]){ state.sup.area=String(SUPMAT[val].area); state.sup.len=String(SUPMAT[val].len); state.sup.kint=String(SUPMAT[val].kint);
      ['area','len','kint'].forEach(function(k){var i=document.querySelector('[data-k="sup.'+k+'"]'); if(i) i.value=state.sup[k];}); }
    if(d.k==='op.price'){ var rg=document.querySelector('[data-range="price"]'); if(rg&&isFinite(num(val))){ rg.value=num(val); syncRanges(rg.parentNode); } }
    if(d.k==='ui.pbBase'||d.k==='ui.pbAlt'){ save(); refreshPayback(); return; }
    onValueChange(); return;
  }
  if(d.seg!==undefined){ state.segs[+d.seg][d.f]=t.value; onValueChange(); return; }
  if(d.part!==undefined){
    var p=state.parts[+d.part]; p[d.f]=t.value;
    if(d.f==='type'&&PARTTYPES[t.value]!=null){ p.w=String(PARTTYPES[t.value]); var wi=document.querySelector('[data-part="'+d.part+'"][data-f="w"]'); if(wi) wi.value=p.w; }
    onValueChange(); return;
  }
  if(d.range){
    var v=t.value; syncRanges(t.parentNode);
    if(d.range==='mli') state.ins.mli=String(v);
    else if(d.range==='spacing') state.sup.spacing=Number(v).toFixed(1);
    else if(d.range==='price'){ state.op.price=comma(Number(v)); var pi=document.querySelector('#view-payback [data-k="op.price"]'); if(pi) pi.value=state.op.price; }
    onValueChange(); return;
  }
  if(t.hasAttribute('data-zoom')){ state.ui.zoom=t.value; save(); applyZoom(); }
});
document.addEventListener('change',function(e){ if(e.target.hasAttribute('data-zoom')){ state.ui.zoom=e.target.value; save(); applyZoom(); } });
document.addEventListener('focusout',function(e){
  var t=e.target; if(t.dataset&&t.dataset.comma){ var n=num(t.value); if(isFinite(n)){ t.value=comma(n, Math.abs(n%1)>0?2:0); setPath(t.dataset.k,t.value); save(); } }
});
function act(el){
  var a=el.getAttribute('data-act'), v=el.getAttribute('data-v'), D=defaults();
  switch(a){
    case 'calc-open': openCalcModal(); break;
    case 'calc-close': closeCalcModal(); break;
    case 'calc-template': downloadText('nexergy-calc.js', CALC_TEMPLATE, 'text/javascript;charset=utf-8'); toast('빈 계산 파일을 내려받았습니다.'); break;
    case 'calc-reset': lsSet(CALC_SRC_KEY, null); lsSet(CALC_NAME_KEY, null); lsSet(CALC_URL_KEY, null); calc = {mode:'sample', name:'', fn:null, err:''}; afterCalcChange('예시 계산으로 되돌렸습니다.'); break;
    case 'calc-url':
      var u = (document.getElementById('calc-url').value || '').trim();
      if(!/^https?:\/\//.test(u)){ toast('http:// 또는 https://로 시작하는 주소를 넣어 주세요.'); break; }
      loadCalcUrl(u, function(err){
        if(err){ calc = {mode:'sample', name:'', fn:null, err:err.message}; afterCalcChange('주소를 연결하지 못했습니다.'); return; }
        lsSet(CALC_SRC_KEY, null); lsSet(CALC_NAME_KEY, null); lsSet(CALC_URL_KEY, u);
        afterCalcChange('계산 파일 주소를 연결했습니다: ' + calc.name);
      });
      break;
    case 'tab': go(v); break;
    case 'proto-prev': var ip=VIEWS.indexOf(state.ui.tab); if(ip>0) go(VIEWS[ip-1]); break;
    case 'proto-next': var inx=VIEWS.indexOf(state.ui.tab); if(inx<VIEWS.length-1) go(VIEWS[inx+1]); break;
    case 'hs': state.ui.hs=!state.ui.hs; save(); document.body.classList.toggle('hs-show',state.ui.hs); document.getElementById('protobar').innerHTML=protobarHTML(); toast(state.ui.hs?'클릭할 수 있는 곳을 파란 테두리로 표시합니다.':'클릭 영역 표시를 껐습니다.'); break;
    case 'nav':
      var sec=document.getElementById('grp-'+v); if(sec) sec.scrollIntoView({behavior:'smooth',block:'start'});
      setNav(v); break;
    case 'reset':
      if(v==='op') state.op=D.op; else if(v==='seg') state.segs=D.segs; else if(v==='ins') state.ins=D.ins; else if(v==='sup') state.sup=D.sup; else if(v==='parts') state.parts=D.parts;
      save(); renderInput(); toast(GNAME[v]+'을(를) 기본값으로 되돌렸습니다.'); break;
    case 'add-seg':
      var letter=String.fromCharCode(65+state.segs.length%26), last=state.segs[state.segs.length-1]||D.segs[1];
      state.segs.push({name:letter+' 새 구간',len:'',iod:last.iod,it:last.it,ood:last.ood,ot:last.ot,mat:last.mat}); save(); renderInput();
      var ni=document.querySelector('[data-seg="'+(state.segs.length-1)+'"][data-f="len"]'); if(ni) ni.focus(); break;
    case 'dup-seg': var c=Object.assign({},state.segs[+v]); c.name=c.name+' 복사'; state.segs.splice(+v+1,0,c); save(); renderInput(); break;
    case 'del-seg': if(state.segs.length>1){ state.segs.splice(+v,1); save(); renderInput(); } break;
    case 'add-part': state.parts.push({type:'기타',qty:'1',w:String(PARTTYPES['기타'])}); save(); renderInput(); break;
    case 'dup-part': state.parts.splice(+v+1,0,Object.assign({},state.parts[+v])); save(); renderInput(); break;
    case 'del-part': state.parts.splice(+v,1); save(); renderInput(); break;
    case 'method': state.ins.method=v; save(); renderInput(); break;
    case 'adv': state.ui.adv=!state.ui.adv; save(); renderInput(); break;
    case 'calc':
      state.ui.calcOpen=!state.ui.calcOpen; save(); renderResult(true);
      var cs=document.getElementById('calc');
      if(cs&&state.ui.calcOpen){ setTimeout(function(){ cs.scrollIntoView({behavior:'smooth',block:'start'}); },60); }
      break;
    case 'metric': state.ui.metric=v; save(); refreshCompare(); break;
    case 'base': state.ui.base=v; save(); refreshCompare(); break;
    case 'logy': state.ui.logY=!state.ui.logY; save(); renderCompare(); break;
    case 'rep': state.ui.rep[v]=!state.ui.rep[v]; save(); renderReport(); break;
    case 'print': doPrint(); break;
    case 'pdf': doPdf(); break;
  }
}
var flashTimer;
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-act]');
  if(el&&!el.disabled){ act(el); return; }
  /* 빈 곳을 누르면 클릭 가능한 곳을 잠깐 깜빡여 알려 줌 (피그마 프로토타입 방식) */
  if(state.ui.hs) return;
  if(!e.target.closest('.app')) return;
  if(e.target.closest('input,select,textarea,button,a,label')) return;
  document.body.classList.remove('hs-flash'); void document.body.offsetWidth;
  document.body.classList.add('hs-flash');
  clearTimeout(flashTimer); flashTimer=setTimeout(function(){document.body.classList.remove('hs-flash');},700);
});
document.addEventListener('keydown',function(e){
  if(calcModalOpen()){ if(e.key==='Escape') closeCalcModal(); return; }
  var tag=(e.target.tagName||'').toLowerCase(), typing=tag==='input'||tag==='select'||tag==='textarea';
  if(!typing&&!e.altKey&&!e.ctrlKey&&!e.metaKey){
    var i=VIEWS.indexOf(state.ui.tab);
    if(e.key==='ArrowRight'&&i<VIEWS.length-1){ e.preventDefault(); go(VIEWS[i+1]); return; }
    if(e.key==='ArrowLeft'&&i>0){ e.preventDefault(); go(VIEWS[i-1]); return; }
    if(/^[1-5]$/.test(e.key)){ go(VIEWS[+e.key-1]); return; }
  }
  if(e.key!=='Enter'&&e.key!==' ') return;
  var el=e.target.closest('[data-act]'); if(el&&el.tagName!=='BUTTON'){ e.preventDefault(); act(el); }
});
function setNav(g){ document.querySelectorAll('.gi').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-v')===g);}); }
window.addEventListener('scroll',function(){
  if(state.ui.tab!=='input') return;
  var cur=GROUPS[0][0];
  GROUPS.forEach(function(g){ var s=document.getElementById('grp-'+g[0]); if(s&&s.getBoundingClientRect().top<140) cur=g[0]; });
  if((window.innerHeight+window.scrollY)>=document.body.scrollHeight-4) cur=GROUPS[GROUPS.length-1][0];
  setNav(cur);
},{passive:true});
window.addEventListener('resize',applyZoom);
window.addEventListener('beforeprint',function(){ var root=document.getElementById('print-root'); if(!root.innerHTML && validate(state).ok) root.innerHTML=reportPages('pr').join(''); });
window.addEventListener('afterprint',function(){ document.getElementById('print-root').innerHTML=''; });

// 테스트용 노출
window.Nexergy={calcTemplate:CALC_TEMPLATE, state:function(){return state;}, core:core, params:params, validate:validate, go:go, reset:function(){try{localStorage.removeItem(STORE_KEY);}catch(e){} state=defaults(); renderAll();}};

/* 주소에 #result 같은 화면 이름이 있으면 그 화면으로 시작 */
(function(){
  var h=hashTab();
  if(h) state.ui.tab=h;
  else { try{ history.replaceState(null,'','#'+state.ui.tab); }catch(e){} }
})();
initCalc();
renderAll();
if(!STORE_OK) setTimeout(function(){ toast('지금 화면에서는 브라우저 저장이 막혀 있어 자동 저장이 되지 않습니다. 파일을 크롬·엣지에서 직접 열어 주세요.'); },600);
})();

