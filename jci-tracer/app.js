const DB_NAME="JCITracerLocalV03", DB_VERSION=3, APP_VERSION="0.5.1";
const roleAllowed={SN:["SN"],CN:["SN","CN"],HN:["SN","CN","HN"]};
let master=null;
let state={
  unit:null,role:null,mode:null,tags:[],tiers:["E1"],chapters:[],requestedCount:8,
  staffId:"",session:[],index:0,responses:{},sourceType:"",sourceName:"",pendingStart:null,staffBackScreen:"interviewModeScreen",
  bankUnit:null,bankRole:"SN",bankSelected:[],bankOrigin:"standalone",
  savedUnit:null,savedRoleFilter:null,
  resultUnit:null,obsResultUnit:null,
  obsUnit:null,obsArea:null,obsSession:[],obsIndex:0,obsResponses:{}
};
const $=id=>document.getElementById(id), screens=[...document.querySelectorAll('.screen')];

function openIDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('kv'))db.createObjectStore('kv',{keyPath:'key'});if(!db.objectStoreNames.contains('reviews'))db.createObjectStore('reviews',{keyPath:'key'});if(!db.objectStoreNames.contains('staff'))db.createObjectStore('staff',{keyPath:'id'});if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions',{keyPath:'id',autoIncrement:true});if(!db.objectStoreNames.contains('templates'))db.createObjectStore('templates',{keyPath:'id',autoIncrement:true});if(!db.objectStoreNames.contains('observations'))db.createObjectStore('observations',{keyPath:'id',autoIncrement:true});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function idbGet(store,key){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbPut(store,obj){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(obj);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function idbAdd(store,obj){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite'),r=tx.objectStore(store).add(obj);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbDelete(store,key){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function idbAll(store){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbClear(store){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}

function show(id){screens.forEach(s=>s.classList.remove('active'));$(id).classList.add('active');window.scrollTo({top:0,behavior:'smooth'})}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function unitName(id){return master?.units?.find(x=>x.id===id)?.name||id}
function roleName(r){return r==='SN'?'Staff Nurse':r==='CN'?'Charge Nurse':'Head Nurse'}
function roleFor(q,u=state.unit){return q.roleByUnit?.[u]||''}
function eligibleRole(q,unit,role){return q.units?.includes(unit)&&roleAllowed[role]?.includes(roleFor(q,unit))}
function qById(id){return master?.questions?.find(q=>q.id===id)}
function obsByKey(key){return master?.observation?.items?.find(x=>x.key===key)}
function toast(msg){$('toast').textContent=msg;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),1700)}
function shuffle(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x}
function takePrioritized(pool,n,asked){const fresh=shuffle(pool.filter(q=>!asked.has(q.id))),old=shuffle(pool.filter(q=>asked.has(q.id)));return [...fresh,...old].slice(0,n)}
// The service menu and interview tags are distinct layers. Keep this alias narrow;
// legacy generic tags must not turn unrelated questions into situation questions.
function questionPatientTags(q){return q.patientTags||[]}
function matchesSituation(q,tag){return questionPatientTags(q).includes(tag)||(tag==='Hemodialysis'&&questionPatientTags(q).includes('Dialysis'))}
function interviewSituationTags(unit,role){
  const candidates=master?.patientTagsByUnit?.[unit]||[];
  return candidates.filter(tag=>master.questions.some(q=>eligibleRole(q,unit,role)&&matchesSituation(q,tag)))
}
function observationItems(unit){return (master?.observation?.items||[]).filter(x=>x.unit===unit)}
function unitReviewKey(unit,qid){return `UNIT|${unit}|${qid}`}
async function getReview(key){return await idbGet('reviews',key)}
async function getStaff(id=state.staffId){if(!id)return null;return (await idbGet('staff',id))||{id,asked:[]}}
function askedSet(staff){return new Set((staff?.asked||[]).map(x=>x.qid))}
async function markAsked(q,result){if(!state.staffId||!q||result==='Not Asked'||!result)return;let s=await getStaff();if(!s.asked.some(x=>x.qid===q.id))s.asked.push({qid:q.id,unit:state.unit,role:state.role,date:new Date().toISOString()});await idbPut('staff',s)}

async function init(){
  const m=await idbGet('kv','master');master=m?.value||null;
  if('serviceWorker' in navigator){try{const reg=await navigator.serviceWorker.register('./service-worker.js');reg.update()}catch(e){}}
  try{if(navigator.storage?.persist)await navigator.storage.persist()}catch(e){}
  if(master){renderAllUnitGrids();show('homeScreen')}else{renderDbStatus();show('setupScreen')}
}
function renderDbStatus(){
  if(!master){$('dbStatus').innerHTML='<b>No pilot database imported yet.</b><br>Choose JCI_Tracer_Workflow_Pilot_DB_v0_6_1.json.';return}
  const obsCount=master.observation?.items?.length||0;
  $('dbStatus').innerHTML=`<b>Database ready</b><br>${escapeHtml(master.databaseVersion)}<br>${master.questionCount} interview questions • ${obsCount} operational observation rows<br><span class="micro">Policy verification: ${escapeHtml(master.policyVerificationStatus||'pending')}</span>`
}
$('importDbBtn').onclick=()=>$('dbFile').click();
$('dbFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());if(!obj.questions||!obj.units||!obj.observation)throw new Error('missing workflow data');master=obj;await idbPut('kv',{key:'master',value:obj,imported:new Date().toISOString()});renderDbStatus();renderAllUnitGrids();show('homeScreen');toast('Workflow pilot database imported')}catch(err){alert('Invalid workflow-pilot database file. Please use the supplied v0.6 JSON.')}e.target.value=''};

function unitButtons(target,handler,kind='interview'){
  $(target).innerHTML=master.units.map(u=>{
    const s=master.unitSummary?.[u.id]||{};
    let small='';
    if(kind==='interview')small=`${s.cleanInterviewBank??master.questions.filter(q=>q.units.includes(u.id)).length} scope-clean bank questions`;
    if(kind==='observation')small=s.observationChecks?`${s.observationChecks} checks • ${s.observationAreas||0} areas`:'No dedicated observation baseline';
    return `<button class="choice unitBtn" data-unit="${u.id}">${escapeHtml(u.name)}<small>${small}</small></button>`
  }).join('');
  document.querySelectorAll(`#${target} .unitBtn`).forEach(b=>b.onclick=()=>handler(b.dataset.unit))
}
function renderAllUnitGrids(){
  unitButtons('interviewUnitGrid',selectInterviewUnit,'interview');
  unitButtons('observationUnitGrid',selectObservationUnit,'observation');
  unitButtons('bankUnitGrid',selectBankUnit,'interview');
  unitButtons('savedUnitGrid',openSavedUnit,'interview');
  unitButtons('unitResultsUnitGrid',openUnitResults,'interview');
  unitButtons('obsResultsUnitGrid',openObsResults,'observation');
}

// HOME
$('startInterview').onclick=()=>{renderAllUnitGrids();show('interviewUnitScreen')};
$('startObservation').onclick=()=>{renderAllUnitGrids();show('observationUnitScreen')};

// INTERVIEW UNIT / ROLE / MODE
function selectInterviewUnit(u){state.unit=u;state.role=null;state.mode=null;state.tags=[];state.chapters=[];state.tiers=['E1'];document.querySelectorAll('.interviewRole').forEach(b=>b.classList.remove('selected'));$('interviewRoleHeading').textContent=`${unitName(u)} — Choose Role`;show('interviewRoleScreen')}
document.querySelectorAll('.interviewRole').forEach(b=>b.onclick=()=>{state.role=b.dataset.role;document.querySelectorAll('.interviewRole').forEach(x=>x.classList.toggle('selected',x===b))});
$('roleContinue').onclick=()=>{if(!state.role)return alert('Choose a role.');$('interviewContext').textContent=`${unitName(state.unit)} • ${roleName(state.role)}`;show('interviewModeScreen')};
document.querySelectorAll('.interviewMode').forEach(b=>b.onclick=()=>chooseInterviewMode(b.dataset.mode));

async function chooseInterviewMode(mode){
  state.mode=mode;state.tags=[];state.chapters=[];state.tiers=['E1'];
  if(mode==='saved'){state.savedUnit=state.unit;state.savedRoleFilter=state.role;await renderSavedList();show('savedScreen');return}
  if(mode==='manual'){openBank(state.unit,state.role,'interview');return}
  $('quickBuilder').classList.toggle('hidden',mode!=='quick');
  $('generalBuilder').classList.toggle('hidden',mode!=='general');
  $('situationBuilder').classList.toggle('hidden',mode!=='situation');
  $('chapterBuilder').classList.toggle('hidden',mode!=='chapter');
  document.querySelectorAll('.tier').forEach(x=>x.classList.toggle('selected',x.dataset.tier==='E1'));
  const titles={quick:'Quick Balanced',general:'General Core',situation:'Situation-Driven',chapter:'By Chapter'};
  const helps={
    quick:'Choose session size. Optionally add a real patient/device situation; the pilot will mix General Core, unit questions and that situation.',
    general:'Choose General Core tiers. These are common survey-preparation questions, not a separate JCI chapter.',
    situation:'Choose one or more situations/devices that are actually present. Only unit-allowed options are shown.',
    chapter:'Choose one or more JCI chapters for a focused interview.'
  };
  $('builderTitle').textContent=titles[mode];$('builderHelp').textContent=helps[mode];
  renderBuilderSelectors();await updateMatchSummary();show('builderScreen')
}
function renderBuilderSelectors(){
  const tags=interviewSituationTags(state.unit,state.role);
  for(const target of ['tagGrid','quickTagGrid']){
    $(target).innerHTML=tags.length?tags.map(t=>`<button class="chip builderTag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join(''):'<div class="muted">No controlled situation options for this unit.</div>'
  }
  document.querySelectorAll('.builderTag').forEach(b=>b.onclick=async()=>{b.classList.toggle('selected');const t=b.dataset.tag;state.tags=b.classList.contains('selected')?[...new Set([...state.tags,t])]:state.tags.filter(x=>x!==t);document.querySelectorAll('.builderTag').forEach(x=>{if(x.dataset.tag===t)x.classList.toggle('selected',state.tags.includes(t))});await updateMatchSummary()});
  $('chapterGrid').innerHTML=master.chapters.map(c=>`<button class="chip chapter" data-chapter="${c}">${c}</button>`).join('');
  document.querySelectorAll('.chapter').forEach(b=>b.onclick=async()=>{b.classList.toggle('selected');state.chapters=b.classList.contains('selected')?[...new Set([...state.chapters,b.dataset.chapter])]:state.chapters.filter(x=>x!==b.dataset.chapter);await updateMatchSummary()})
}
document.querySelectorAll('.tier').forEach(b=>b.onclick=async()=>{b.classList.toggle('selected');state.tiers=b.classList.contains('selected')?[...new Set([...state.tiers,b.dataset.tier])]:state.tiers.filter(x=>x!==b.dataset.tier);await updateMatchSummary()});
$('questionCount').onchange=async()=>{$('customCount').classList.toggle('hidden',$('questionCount').value!=='custom');await updateMatchSummary()};
$('customCount').oninput=updateMatchSummary;$('hideNotRelevant').onchange=updateMatchSummary;
function requestedCount(){const v=$('questionCount').value;if(v==='all')return 'all';if(v==='custom')return Math.max(1,Math.min(100,Number($('customCount').value||1)));return Number(v)}
async function reviewedNotRelevantIds(unit){const reviews=await idbAll('reviews');return new Set(reviews.filter(r=>r.key?.startsWith(`UNIT|${unit}|`)&&r.status==='Not Relevant').map(r=>r.key.split('|')[2]))}
async function generatedPool(){
  let p=master.questions.filter(q=>eligibleRole(q,state.unit,state.role));
  if($('hideNotRelevant').checked){const bad=await reviewedNotRelevantIds(state.unit);p=p.filter(q=>!bad.has(q.id))}
  if(state.mode==='general')p=p.filter(q=>q.generalCore&&state.tiers.includes(q.generalCore.tier));
  if(state.mode==='situation')p=p.filter(q=>state.tags.some(t=>matchesSituation(q,t)));
  if(state.mode==='chapter')p=p.filter(q=>state.chapters.includes(q.chapter));
  return p
}
async function updateMatchSummary(){
  if(state.mode==='situation'&&!state.tags.length){$('matchSummary').innerHTML=interviewSituationTags(state.unit,state.role).length?'Select at least one patient/situation.':'No interview questions are tagged for this unit and role yet. Use General Core, Chapter, or Manual Session.';return}
  if(state.mode==='chapter'&&!state.chapters.length){$('matchSummary').innerHTML='Select at least one chapter.';return}
  const p=await generatedPool(),req=requestedCount();
  if(state.mode==='quick'){
    const gen=p.filter(q=>q.generalCore).length,conditional=p.filter(q=>q.scopeStatusByUnit?.[state.unit]?.status==='CONDITIONAL').length;
    $('matchSummary').innerHTML=`<b>${p.length}</b> eligible questions in the clean bank • <b>${gen}</b> General Core candidates • <b>${conditional}</b> conditional/situation items.<br><span class="micro">The actual ${req==='all'?'matching':req} questions are generated only after Staff ID is entered.</span>`;
  }else $('matchSummary').innerHTML=`<b>${p.length}</b> matching questions. Requested: <b>${req==='all'?'all':req}</b>.<br><span class="micro">Final selection happens after Staff ID so repeat-prioritization can work.</span>`
}
$('builderContinue').onclick=async()=>{
  if(state.mode==='situation'&&!state.tags.length)return alert('Choose at least one patient/situation.');
  if(state.mode==='chapter'&&!state.chapters.length)return alert('Choose at least one chapter.');
  const pool=await generatedPool();if(!pool.length)return alert('No matching questions.');
  state.requestedCount=requestedCount();state.pendingStart={kind:'generated'};state.staffBackScreen='builderScreen';prepareStaffConfirm();
};

// STAFF ID LAST
function pendingDescription(){
  if(!state.pendingStart)return '';
  if(state.pendingStart.kind==='template')return `Saved Session: ${state.pendingStart.template.name} • ${state.pendingStart.template.qids.length} questions`;
  if(state.pendingStart.kind==='manual')return `Manual Session • ${state.bankSelected.length} selected questions`;
  const n=state.requestedCount==='all'?'All matching':`${state.requestedCount} questions`;
  const extra=state.tags.length?` • ${state.tags.join(' / ')}`:state.chapters.length?` • ${state.chapters.join(', ')}`:'';
  return `${state.mode==='quick'?'Quick Balanced':state.mode==='general'?'General Core':state.mode==='situation'?'Situation-Driven':'By Chapter'} • ${n}${extra}`
}
function prepareStaffConfirm(){state.staffId='';$('staffConfirmId').value='';$('staffConfirmStats').classList.add('hidden');$('staffConfirmContext').innerHTML=`<b>${escapeHtml(unitName(state.unit))}</b> • ${escapeHtml(roleName(state.role))}<br>${escapeHtml(pendingDescription())}`;show('staffConfirmScreen')}
$('staffConfirmBack').onclick=()=>show(state.staffBackScreen||'interviewModeScreen');
$('staffConfirmId').oninput=renderStaffConfirmStats;
async function renderStaffConfirmStats(){const id=$('staffConfirmId').value.trim();if(!id){$('staffConfirmStats').classList.add('hidden');return}const s=await getStaff(id),asked=askedSet(s);let exact=[];if(state.pendingStart?.kind==='template')exact=state.pendingStart.template.qids;else if(state.pendingStart?.kind==='manual')exact=[...state.bankSelected];const repeated=exact.filter(x=>asked.has(x)).length;$('staffConfirmStats').innerHTML=`<div class="stat"><b>${asked.size}</b><span>Previously asked overall</span></div><div class="stat"><b>${repeated}</b><span>Repeated in exact set</span></div><div class="stat"><b>${unitName(state.unit)}</b><span>Current unit</span></div>`;$('staffConfirmStats').classList.remove('hidden')}
$('staffConfirmStart').onclick=async()=>{const id=$('staffConfirmId').value.trim();if(!id)return alert('Enter Staff ID.');state.staffId=id;await startPendingInterview()};
async function startPendingInterview(){
  const s=await getStaff(),asked=askedSet(s);
  let chosen=[];
  if(state.pendingStart?.kind==='template'){
    const t=state.pendingStart.template;chosen=t.qids.map(qById).filter(q=>q&&eligibleRole(q,t.unit,t.role));const repeats=chosen.filter(q=>asked.has(q.id)).length;if(repeats&&!confirm(`${repeats} of ${chosen.length} questions were previously asked to this Staff ID. Start this exact Saved Session anyway?`))return;state.sourceType='Saved';state.sourceName=t.name;
  }else if(state.pendingStart?.kind==='manual'){
    chosen=state.bankSelected.map(qById).filter(Boolean);const repeats=chosen.filter(q=>asked.has(q.id)).length;if(repeats&&!confirm(`${repeats} of ${chosen.length} selected questions were previously asked to this Staff ID. Start anyway?`))return;state.sourceType='Manual';state.sourceName='Manual Session';
  }else{
    const pool=await generatedPool();const req=state.requestedCount==='all'?pool.length:Math.min(state.requestedCount,pool.length);chosen=state.mode==='quick'?buildQuickBalanced(pool,req,asked):takePrioritized(pool,req,$('avoidAsked').checked?asked:new Set());state.sourceType='Generated';state.sourceName=state.mode==='quick'?'Quick Balanced':state.mode==='general'?'General Core':state.mode==='situation'?'Situation-Driven':'By Chapter';
  }
  if(!chosen.length)return alert('No questions available for this session.');
  state.session=chosen;state.index=0;state.responses={};show('questionScreen');await renderQuestion()
}
function buildQuickBalanced(pool,n,asked){
  const avoid=$('avoidAsked').checked?asked:new Set();const selected=[];const seen=new Set();const add=(arr,k)=>{for(const q of takePrioritized(arr,k,avoid)){if(!seen.has(q.id)){seen.add(q.id);selected.push(q)}}};
  const situation=state.tags.length?pool.filter(q=>state.tags.some(t=>matchesSituation(q,t))):[];
  const general=pool.filter(q=>q.generalCore);
  const routine=pool.filter(q=>!q.generalCore&&q.scopeStatusByUnit?.[state.unit]?.status==='ACTIVE'&&!questionPatientTags(q).length);
  const situationN=state.tags.length?Math.max(1,Math.round(n*.25)):0;
  const generalN=Math.max(1,Math.round(n*.4));
  add(situation,situationN);add(general,Math.min(generalN,n-selected.length));add(routine,n-selected.length);
  add(pool,n-selected.length);return selected.slice(0,n)
}

// BANK + MANUAL + SAVED TEMPLATE CREATION
function selectBankUnit(u){state.bankUnit=u;state.bankSelected=[];state.bankOrigin='standalone';$('bankRoleHeading').textContent=`${unitName(u)} — Choose Role`;show('bankRoleScreen')}
document.querySelectorAll('.bankRoleChoice').forEach(b=>b.onclick=()=>openBank(state.bankUnit,b.dataset.role,'standalone'));
function openBank(unit,role,origin='standalone'){
  state.bankUnit=unit;state.bankRole=role;state.bankOrigin=origin;state.bankSelected=[];
  $('bankRole').value=role;$('bankType').value='ALL';$('bankSearch').value='';$('bankChapter').innerHTML='<option value="ALL">All Chapters</option>'+master.chapters.map(c=>`<option value="${c}">${c}</option>`).join('');
  $('bankHeading').textContent=`${unitName(unit)} — Interview Bank`;$('bankRole').disabled=origin==='interview';$('bankChange').textContent=origin==='interview'?'Back to Modes':'Change Unit';renderBank();show('bankScreen')
}
$('bankChange').onclick=()=>{if(state.bankOrigin==='interview')show('interviewModeScreen');else show('bankUnitScreen')};
$('bankRole').onchange=()=>{state.bankRole=$('bankRole').value;state.bankSelected=[];renderBank()};$('bankType').onchange=renderBank;$('bankChapter').onchange=renderBank;$('bankSearch').oninput=renderBank;
function renderBank(){
  let p=master.questions.filter(q=>eligibleRole(q,state.bankUnit,state.bankRole));const type=$('bankType').value,ch=$('bankChapter').value,s=$('bankSearch').value.trim().toLowerCase();if(type!=='ALL')p=p.filter(q=>q.typeByUnit?.[state.bankUnit]===type);if(ch!=='ALL')p=p.filter(q=>q.chapter===ch);if(s)p=p.filter(q=>[q.question,q.standard,q.me,q.chapter,(q.tags||[]).join(' '),(q.patientTags||[]).join(' '),q.generalCore?.topic||''].join(' ').toLowerCase().includes(s));
  $('bankCount').textContent=`${p.length} matching • ${master.questions.filter(q=>eligibleRole(q,state.bankUnit,state.bankRole)).length} total for ${roleName(state.bankRole)}`;$('selectedCount').textContent=`${state.bankSelected.length} selected`;
  let last='',html='';for(const q of p){if(q.chapter!==last){last=q.chapter;html+=`<div class="chapterHeader">${escapeHtml(last)}</div>`}const checked=state.bankSelected.includes(q.id)?'checked':'';const st=q.scopeStatusByUnit?.[state.bankUnit]?.status||'ACTIVE';html+=`<div class="bankRow"><input type="checkbox" class="bankCheck" data-qid="${q.id}" ${checked}><div><div class="bankQ">${escapeHtml(q.question)}</div><div class="miniBadges"><span class="miniBadge">${escapeHtml(roleFor(q,state.bankUnit))}</span><span class="miniBadge">${escapeHtml(q.typeByUnit?.[state.bankUnit]||'')}</span><span class="miniBadge">${escapeHtml(st)}</span>${q.generalCore?`<span class="miniBadge">${q.generalCore.tier} General</span>`:''}</div></div><button class="detailsBtn secondary" data-detail="${q.id}">Details</button></div>`}
  $('bankList').innerHTML=html||'<div class="muted">No matching questions.</div>';
  document.querySelectorAll('.bankCheck').forEach(chk=>chk.onchange=()=>{const id=chk.dataset.qid;if(chk.checked){if(!state.bankSelected.includes(id))state.bankSelected.push(id)}else state.bankSelected=state.bankSelected.filter(x=>x!==id);$('selectedCount').textContent=`${state.bankSelected.length} selected`});document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openQuestionDetails(b.dataset.detail,state.bankUnit))
}
$('reviewSelection').onclick=()=>{if(!state.bankSelected.length)return alert('Select at least one question.');renderSelection();show('selectionScreen')};
function renderSelection(){$('selectionList').innerHTML=state.bankSelected.map((id,i)=>{const q=qById(id);return `<div class="selectRow"><span class="selectNum">${i+1}</span><div><b>${escapeHtml(q?.chapter||'')}</b><div class="bankQ">${escapeHtml(q?.question||id)}</div></div><button class="orderBtn secondary" data-up="${i}">↑</button><button class="orderBtn secondary" data-down="${i}">↓</button><button class="orderBtn secondary" data-remove="${i}">×</button></div>`}).join('');document.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveSelected(Number(b.dataset.up),-1));document.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveSelected(Number(b.dataset.down),1));document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{state.bankSelected.splice(Number(b.dataset.remove),1);renderSelection()})}
function moveSelected(i,d){const j=i+d;if(j<0||j>=state.bankSelected.length)return;[state.bankSelected[i],state.bankSelected[j]]=[state.bankSelected[j],state.bankSelected[i]];renderSelection()}
async function saveCurrentTemplate(){const name=(prompt('Name this Saved Session:')||'').trim();if(!name)return null;const id=await idbAdd('templates',{name,unit:state.bankUnit,role:state.bankRole,qids:[...state.bankSelected],created:new Date().toISOString(),updated:new Date().toISOString()});toast('Saved Session created');return await idbGet('templates',id)}
$('startManual').onclick=()=>{state.unit=state.bankUnit;state.role=state.bankRole;state.pendingStart={kind:'manual'};state.staffBackScreen='selectionScreen';prepareStaffConfirm()};
$('saveAndStart').onclick=async()=>{const t=await saveCurrentTemplate();if(!t)return;state.unit=t.unit;state.role=t.role;state.pendingStart={kind:'template',template:t};state.staffBackScreen='selectionScreen';prepareStaffConfirm()};
$('saveTemplate').onclick=async()=>{const t=await saveCurrentTemplate();if(t){state.savedUnit=t.unit;state.savedRoleFilter=null;await renderSavedList();show('savedScreen')}};
function openQuestionDetails(qid,unit){const q=qById(qid);if(!q)return;const refs=(q.sourceRefs||[]).map(r=>`<div class="sourceBlock"><b>${escapeHtml(r.standard||'')} ${escapeHtml(r.me||'')}</b><br>${escapeHtml(r.meText||'').replace(/\n/g,'<br>')}<div class="micro">JCI Manual page ${escapeHtml(r.page||'—')}</div></div>`).join('');openModal('Question Details',`<div class="sourceBlock"><b>Question</b><br>${escapeHtml(q.question).replace(/\n/g,'<br>')}</div><div class="sourceBlock"><b>Unit status</b><br>${escapeHtml(q.scopeStatusByUnit?.[unit]?.status||'')}</div><div class="sourceBlock"><b>Standard / ME</b><br>${escapeHtml(q.standard||'')} • ${escapeHtml(q.me||'')}</div><div class="sourceBlock"><b>JCI Expected</b><br>${escapeHtml(q.expected||'—').replace(/\n/g,'<br>')}</div>${refs}`,true)}

// SAVED SESSIONS
async function openSavedUnit(u){state.savedUnit=u;state.savedRoleFilter=null;await renderSavedList();show('savedScreen')}
$('savedChangeUnit').onclick=()=>{state.savedRoleFilter=null;show('savedUnitScreen')};
async function renderSavedList(){
  $('savedHeading').textContent=`${unitName(state.savedUnit)} — Saved Sessions`;let t=(await idbAll('templates')).filter(x=>x.unit===state.savedUnit);if(state.savedRoleFilter)t=t.filter(x=>x.role===state.savedRoleFilter);t.sort((a,b)=>new Date(b.updated)-new Date(a.updated));$('savedCount').textContent=`${t.length} saved session${t.length===1?'':'s'}`;$('savedFilterNote').textContent=state.savedRoleFilter?`Interview flow filter: ${roleName(state.savedRoleFilter)}. Choose Start and Staff ID will be the final step.`:'Templates can be started, edited, duplicated or deleted.';
  $('savedList').innerHTML=t.length?t.map(x=>`<div class="savedCard"><div class="savedTitle">${escapeHtml(x.name)}</div><div class="savedMeta">${roleName(x.role)} • ${x.qids.length} questions • ${new Date(x.updated).toLocaleDateString()}</div><div class="savedActions"><button class="primary" data-starttemplate="${x.id}">Start</button><button class="secondary" data-edittemplate="${x.id}">Edit</button><button class="secondary" data-duptemplate="${x.id}">Duplicate</button><button class="secondary" data-deltemplate="${x.id}">Delete</button></div></div>`).join(''):'<div class="muted">No saved sessions here yet. Build one from Bank.</div>';
  document.querySelectorAll('[data-starttemplate]').forEach(b=>b.onclick=()=>prepareTemplateStart(Number(b.dataset.starttemplate)));document.querySelectorAll('[data-edittemplate]').forEach(b=>b.onclick=()=>editTemplate(Number(b.dataset.edittemplate)));document.querySelectorAll('[data-duptemplate]').forEach(b=>b.onclick=()=>duplicateTemplate(Number(b.dataset.duptemplate)));document.querySelectorAll('[data-deltemplate]').forEach(b=>b.onclick=()=>deleteTemplate(Number(b.dataset.deltemplate)))
}
async function prepareTemplateStart(id){const t=await idbGet('templates',id);if(!t)return;state.unit=t.unit;state.role=t.role;state.pendingStart={kind:'template',template:t};state.staffBackScreen='savedScreen';prepareStaffConfirm()}
async function editTemplate(id){const t=await idbGet('templates',id);if(!t)return;state.bankUnit=t.unit;state.bankRole=t.role;state.bankSelected=[...t.qids];state.bankOrigin='standalone';$('bankRole').disabled=false;$('bankRole').value=t.role;$('bankType').value='ALL';$('bankSearch').value='';$('bankChapter').innerHTML='<option value="ALL">All Chapters</option>'+master.chapters.map(c=>`<option value="${c}">${c}</option>`).join('');$('bankHeading').textContent=`${unitName(t.unit)} — Interview Bank`;renderBank();show('bankScreen');toast('Template loaded into Bank selection')}
async function duplicateTemplate(id){const t=await idbGet('templates',id);if(!t)return;const name=(prompt('Name the duplicate:',`${t.name} Copy`)||'').trim();if(!name)return;const copy={...t,name,created:new Date().toISOString(),updated:new Date().toISOString()};delete copy.id;await idbAdd('templates',copy);await renderSavedList();toast('Duplicated')}
async function deleteTemplate(id){const t=await idbGet('templates',id);if(!t||!confirm(`Delete Saved Session "${t.name}"?`))return;await idbDelete('templates',id);await renderSavedList()}

// INTERVIEW RUN
function currentQ(){return state.session[state.index]}
async function renderQuestion(){const q=currentQ();if(!q)return finishSession();const s=await getStaff(),asked=askedSet(s),pins=new Set((await idbGet('kv','pins'))?.value||[]),resp=state.responses[q.id]||{};let badges=[];if(q.generalCore)badges.push(`<span class="badge ${q.generalCore.tier.toLowerCase()}">${q.generalCore.tier} • ${escapeHtml(q.generalCore.topic)}</span>`);badges.push(`<span class="badge">${q.chapter}</span><span class="badge">${escapeHtml(roleFor(q,state.unit))}</span>`);const ss=q.scopeStatusByUnit?.[state.unit]?.status;if(ss==='CONDITIONAL')badges.push('<span class="badge conditionalBadge">Conditional</span>');if(asked.has(q.id))badges.push('<span class="badge">Previously asked</span>');$('questionBadges').innerHTML=badges.join('');$('questionContext').textContent=`${unitName(state.unit)} • Staff ${state.staffId} • ${state.sourceName} • ${state.index+1}/${state.session.length}`;$('progressFill').style.width=((state.index+1)/state.session.length*100)+'%';$('questionText').textContent=q.question;$('staffResultCurrent').textContent=resp.result||'Not scored';$('staffNote').value=resp.note||'';document.querySelectorAll('.resultButtons [data-result]').forEach(b=>b.classList.toggle('active',resp.result===b.dataset.result));$('pinBtn').textContent=pins.has(`${state.unit}|${q.id}`)?'★ Pinned':'☆ Pin';const ur=await getReview(unitReviewKey(state.unit,q.id));$('questionIssueSummary').textContent=ur?.status?`Flag: ${ur.status}`:'No local flag'}
document.querySelectorAll('.resultButtons [data-result]').forEach(b=>b.onclick=()=>{$('staffResultCurrent').textContent=b.dataset.result;document.querySelectorAll('.resultButtons [data-result]').forEach(x=>x.classList.toggle('active',x===b));state.responses[currentQ().id]={...(state.responses[currentQ().id]||{}),result:b.dataset.result,note:$('staffNote').value}});
$('staffNote').oninput=()=>{const q=currentQ();if(q)state.responses[q.id]={...(state.responses[q.id]||{}),note:$('staffNote').value}};
async function persistCurrentResponse(){const q=currentQ();if(!q)return;let r=state.responses[q.id]||{};r.note=$('staffNote').value;if(!r.result)r.result='Not Asked';state.responses[q.id]=r;await markAsked(q,r.result)}
$('nextQuestion').onclick=async()=>{await persistCurrentResponse();state.index++;await renderQuestion()};$('skipQuestion').onclick=async()=>{const q=currentQ();state.responses[q.id]={result:'Not Asked',note:$('staffNote').value};state.index++;await renderQuestion()};$('prevQuestion').onclick=async()=>{await persistCurrentResponse();if(state.index>0)state.index--;await renderQuestion()};
$('pinBtn').onclick=async()=>{const q=currentQ(),k=`${state.unit}|${q.id}`,row=await idbGet('kv','pins'),arr=row?.value||[],set=new Set(arr);set.has(k)?set.delete(k):set.add(k);await idbPut('kv',{key:'pins',value:[...set]});await renderQuestion()};
document.querySelectorAll('[data-info]').forEach(b=>b.onclick=()=>{const q=currentQ();if(!q)return;const type=b.dataset.info;if(type==='expected')openModal('JCI Expected',q.expected||'—');if(type==='policy')openModal('Local Policy — Workflow Pilot',`PENDING FULL POLICY VERIFICATION\n\n${q.policy||'No local policy answer loaded.'}\n\nPolicy source/reference: ${q.policyRef||'—'}`);if(type==='standard')openModal('JCI Standard',(q.sourceRefs||[]).map(r=>`${r.standard}\n${r.standardStatement||''}\nPage ${r.page||'—'}`).join('\n\n')||q.standard||'—');if(type==='me')openModal('JCI Measureable Element',(q.sourceRefs||[]).map(r=>`${r.standard} ${r.me}\n${r.meText||''}\nPage ${r.page||'—'}`).join('\n\n')||q.me||'—')});
$('questionIssueBtn').onclick=async()=>{const q=currentQ();if(!q)return;const old=await getReview(unitReviewKey(state.unit,q.id));const status=(prompt('Flag status: Needs Rewrite / Local Check / Hold / Not Relevant / Clear',old?.status||'Local Check')||'').trim();if(!status)return;const note=(prompt('Short note:',old?.note||'')||'').trim();if(status==='Clear')await idbDelete('reviews',unitReviewKey(state.unit,q.id));else await idbPut('reviews',{key:unitReviewKey(state.unit,q.id),status,note,updated:new Date().toISOString()});toast('Question flag saved');await renderQuestion()};
async function finishSession(){await persistCurrentResponse();const responses=state.session.map(q=>({qid:q.id,result:state.responses[q.id]?.result||'Not Asked',note:state.responses[q.id]?.note||''}));const session={date:new Date().toISOString(),unit:state.unit,staffId:state.staffId,role:state.role,sourceType:state.sourceType,sourceName:state.sourceName,qids:state.session.map(q=>q.id),responses};await idbAdd('sessions',session);let c={Understood:0,Partial:0,'Not Understood':0,'Not Asked':0};responses.forEach(r=>c[r.result]=(c[r.result]||0)+1);$('sessionSummary').innerHTML=`<div class="listRow"><b>Unit</b><span>${escapeHtml(unitName(state.unit))}</span></div><div class="listRow"><b>Staff ID</b><span>${escapeHtml(state.staffId)}</span></div><div class="listRow"><b>Session</b><span>${escapeHtml(state.sourceName)}</span></div><div class="listRow"><b>Questions</b><span class="count">${responses.length}</span></div><div class="listRow"><b>Understood</b><span class="count">${c.Understood||0}</span></div><div class="listRow"><b>Partial</b><span class="count">${c.Partial||0}</span></div><div class="listRow"><b>Not Understood</b><span class="count">${c['Not Understood']||0}</span></div><div class="listRow"><b>Not Asked</b><span class="count">${c['Not Asked']||0}</span></div>`;show('summaryScreen')}
$('sameStaffNewSelection').onclick=()=>{state.mode=null;state.pendingStart=null;$('interviewContext').textContent=`${unitName(state.unit)} • ${roleName(state.role)} • Staff ${state.staffId}`;show('interviewModeScreen')};$('anotherInterview').onclick=()=>{state.staffId='';state.pendingStart=null;renderAllUnitGrids();show('interviewUnitScreen')};

// OBSERVATION
function selectObservationUnit(u){state.obsUnit=u;state.obsArea=null;renderObservationAreas();show('observationAreaScreen')}
$('obsChangeUnit').onclick=()=>show('observationUnitScreen');
function renderObservationAreas(){
  $('observationAreaHeading').textContent=`${unitName(state.obsUnit)} — Where are you now?`;const items=observationItems(state.obsUnit);const gap=master.observation?.sourceGapByUnit?.[state.obsUnit];
  if(!items.length){$('obsSourceGap').classList.remove('hidden');$('obsSourceGap').innerHTML=`<b>Controlled source gap</b><br>${escapeHtml(gap?.reason||'No dedicated observation baseline exists for this operational profile in the current readiness workbook.')}<br><span class="micro">No checks were invented for this pilot.</span>`;$('observationAreaGrid').innerHTML='';return}
  $('obsSourceGap').classList.add('hidden');const map=new Map();items.forEach(x=>(x.areas||[]).forEach(a=>{if(!map.has(a))map.set(a,new Set());map.get(a).add(x.key)}));const list=[...map.entries()].map(([area,keys])=>({area,count:keys.size})).sort((a,b)=>a.area.localeCompare(b.area));$('observationAreaGrid').innerHTML=list.map(x=>`<button class="choice obsAreaBtn" data-area="${escapeHtml(x.area)}">${escapeHtml(x.area)}<small>${x.count} checks</small></button>`).join('');document.querySelectorAll('.obsAreaBtn').forEach(b=>b.onclick=()=>startObservationArea(b.dataset.area))
}
function startObservationArea(area){state.obsArea=area;const seen=new Set();state.obsSession=observationItems(state.obsUnit).filter(x=>(x.areas||[]).includes(area)).filter(x=>{if(seen.has(x.key))return false;seen.add(x.key);return true}).sort((a,b)=>priorityRank(a.priority)-priorityRank(b.priority)||a.section.localeCompare(b.section));state.obsIndex=0;state.obsResponses={};if(!state.obsSession.length)return alert('No checks in this area.');show('observationCheckScreen');renderObservationCheck()}
function priorityRank(p){return p==='High'?0:p==='Moderate'?1:2}
function currentObs(){return state.obsSession[state.obsIndex]}
function renderObservationCheck(){const x=currentObs();if(!x)return finishObservation();const resp=state.obsResponses[x.key]||{};$('obsBadges').innerHTML=`<span class="badge">${escapeHtml(x.section)}</span><span class="badge">${escapeHtml(x.priority||'')}</span>${x.scopeStatus==='CONDITIONAL'?'<span class="badge conditionalBadge">Conditional</span>':''}`;$('obsContext').textContent=`${unitName(state.obsUnit)} • ${state.obsArea} • ${state.obsIndex+1}/${state.obsSession.length}`;$('obsProgressFill').style.width=((state.obsIndex+1)/state.obsSession.length*100)+'%';$('obsCheckText').textContent=x.check;$('obsResultCurrent').textContent=resp.result||'Not scored';$('obsNote').value=resp.note||'';document.querySelectorAll('[data-obsresult]').forEach(b=>b.classList.toggle('active',resp.result===b.dataset.obsresult));$('obsHowBtn').onclick=()=>openModal('How to Check',x.howToCheck||'—');$('obsEvidenceBtn').onclick=()=>openModal('Evidence / Ask Who',x.evidenceAskWho||'—');$('obsStandardBtn').onclick=()=>openModal('Standard',x.standards||'—');$('obsMeBtn').onclick=()=>openModal('ME',x.mes||'—')}
document.querySelectorAll('[data-obsresult]').forEach(b=>b.onclick=()=>{const x=currentObs();state.obsResponses[x.key]={...(state.obsResponses[x.key]||{}),result:b.dataset.obsresult,note:$('obsNote').value};$('obsResultCurrent').textContent=b.dataset.obsresult;document.querySelectorAll('[data-obsresult]').forEach(y=>y.classList.toggle('active',y===b))});
$('obsNote').oninput=()=>{const x=currentObs();if(x)state.obsResponses[x.key]={...(state.obsResponses[x.key]||{}),note:$('obsNote').value}};
function persistObs(){const x=currentObs();if(!x)return;let r=state.obsResponses[x.key]||{};r.note=$('obsNote').value;if(!r.result)r.result='N/A';state.obsResponses[x.key]=r}
$('nextObs').onclick=()=>{persistObs();state.obsIndex++;renderObservationCheck()};$('skipObs').onclick=()=>{const x=currentObs();state.obsResponses[x.key]={result:'N/A',note:$('obsNote').value};state.obsIndex++;renderObservationCheck()};$('prevObs').onclick=()=>{persistObs();if(state.obsIndex>0)state.obsIndex--;renderObservationCheck()};
async function finishObservation(){persistObs();const responses=state.obsSession.map(x=>({key:x.key,itemId:x.itemId,result:state.obsResponses[x.key]?.result||'N/A',note:state.obsResponses[x.key]?.note||''}));await idbAdd('observations',{date:new Date().toISOString(),unit:state.obsUnit,area:state.obsArea,itemKeys:state.obsSession.map(x=>x.key),responses});let c={Compliant:0,Partial:0,'Non-Compliant':0,'N/A':0};responses.forEach(r=>c[r.result]=(c[r.result]||0)+1);$('observationSummary').innerHTML=`<div class="listRow"><b>Unit</b><span>${escapeHtml(unitName(state.obsUnit))}</span></div><div class="listRow"><b>Area</b><span>${escapeHtml(state.obsArea)}</span></div><div class="listRow"><b>Checks</b><span class="count">${responses.length}</span></div><div class="listRow"><b>Compliant</b><span class="count">${c.Compliant||0}</span></div><div class="listRow"><b>Partial</b><span class="count">${c.Partial||0}</span></div><div class="listRow"><b>Non-Compliant</b><span class="count">${c['Non-Compliant']||0}</span></div><div class="listRow"><b>N/A</b><span class="count">${c['N/A']||0}</span></div>`;show('observationSummaryScreen')}
$('nextObservationArea').onclick=()=>{renderObservationAreas();show('observationAreaScreen')};$('observationHome').onclick=()=>show('homeScreen');

// REVIEW
function openReviewHome(){show('reviewHomeScreen')}
document.querySelectorAll('.reviewMode').forEach(b=>b.onclick=()=>{const m=b.dataset.reviewmode;if(m==='staff')show('staffReviewScreen');if(m==='unit'){renderAllUnitGrids();show('unitResultsUnitScreen')}if(m==='observation'){renderAllUnitGrids();show('obsResultsUnitScreen')}});
$('loadStaffReview').onclick=loadStaffReview;async function loadStaffReview(){const id=$('staffReviewId').value.trim();if(!id)return;const sessions=(await idbAll('sessions')).filter(s=>s.staffId===id).sort((a,b)=>new Date(b.date)-new Date(a.date));let responses=[];sessions.forEach(s=>(s.responses||[]).forEach(r=>responses.push(r)));const unique=new Set(responses.filter(r=>r.result&&r.result!=='Not Asked').map(r=>r.qid));const counts={Understood:0,Partial:0,'Not Understood':0,'Not Asked':0};responses.forEach(r=>counts[r.result]=(counts[r.result]||0)+1);let html=`<div class="metricGrid"><div class="metric"><b>${sessions.length}</b><span>Sessions</span></div><div class="metric"><b>${unique.size}</b><span>Unique questions</span></div><div class="metric"><b>${counts.Understood||0}</b><span>Understood</span></div><div class="metric"><b>${(counts.Partial||0)+(counts['Not Understood']||0)}</b><span>Needs follow-up</span></div></div>`;html+=sessions.length?sessions.map(s=>`<div class="sessionCard"><div class="sessionTitle">${escapeHtml(s.sourceName||s.sourceType||'Session')}</div><div class="sessionMeta">${unitName(s.unit)} • ${new Date(s.date).toLocaleString()} • ${s.role||''}</div>${(s.responses||[]).map(r=>{const q=qById(r.qid);return `<div class="resultRow"><div>${escapeHtml(q?.question||r.qid)}${r.note?`<div class="micro">${escapeHtml(r.note)}</div>`:''}</div><span class="resultTag ${resultClass(r.result)}">${escapeHtml(r.result)}</span></div>`}).join('')}</div>`).join(''):'<div class="muted">No interview sessions found for this Staff ID.</div>';$('staffReviewOutput').innerHTML=html}
function resultClass(r){return r==='Understood'||r==='Compliant'?'rUnderstood':r==='Partial'?'rPartial':r==='Not Understood'||r==='Non-Compliant'?'rNotUnderstood':'rNotAsked'}
function periodStart(selectId){const p=$(selectId).value,now=new Date();if(p==='ALL')return null;if(p==='TODAY')return new Date(now.getFullYear(),now.getMonth(),now.getDate());return new Date(Date.now()-7*86400000)}
async function openUnitResults(u){state.resultUnit=u;$('unitResultsHeading').textContent=`${unitName(u)} — Interview Results`;await renderUnitResults();show('unitResultsScreen')}
$('unitResultsChangeUnit').onclick=()=>show('unitResultsUnitScreen');$('resultPeriod').onchange=renderUnitResults;async function filteredResultSessions(){const start=periodStart('resultPeriod');return (await idbAll('sessions')).filter(s=>s.unit===state.resultUnit&&(!start||new Date(s.date)>=start))}
async function renderUnitResults(){const sessions=await filteredResultSessions(),staff=new Set(sessions.map(s=>s.staffId)),responses=[];sessions.forEach(s=>(s.responses||[]).forEach(r=>{if(r.result&&r.result!=='Not Asked')responses.push({...r,session:s})}));const c={Understood:0,Partial:0,'Not Understood':0};responses.forEach(r=>c[r.result]=(c[r.result]||0)+1);const byQ={};responses.forEach(r=>{const x=byQ[r.qid]||(byQ[r.qid]={asked:0,Understood:0,Partial:0,'Not Understood':0});x.asked++;x[r.result]=(x[r.result]||0)+1});const weak=Object.entries(byQ).map(([qid,x])=>({qid,...x,gap:(x.Partial||0)+(x['Not Understood']||0)})).sort((a,b)=>b.gap-a.gap||b.asked-a.asked);let html=`<div class="metricGrid"><div class="metric"><b>${staff.size}</b><span>Staff assessed</span></div><div class="metric"><b>${sessions.length}</b><span>Sessions</span></div><div class="metric"><b>${responses.length}</b><span>Scored responses</span></div><div class="metric"><b>${(c.Partial||0)+(c['Not Understood']||0)}</b><span>Needs follow-up</span></div></div><div class="sectionLabel">Questions needing attention</div>`;html+=weak.length?weak.slice(0,30).map(x=>{const q=qById(x.qid);return `<div class="resultRow"><div><b>${q?.chapter||''}</b> — ${escapeHtml(q?.question||x.qid)}<div class="micro">Asked ${x.asked} • Partial ${x.Partial||0} • Not Understood ${x['Not Understood']||0}</div></div><span class="count">${x.gap}</span></div>`}).join(''):'<div class="muted">No scored interview responses in this period yet.</div>';$('unitResultsOutput').innerHTML=html}
$('exportUnitCsv').onclick=async()=>exportSessionsCsv(await filteredResultSessions(),`${state.resultUnit}_${$('resultPeriod').value}_Interview_Results`);

async function openObsResults(u){state.obsResultUnit=u;$('obsResultsHeading').textContent=`${unitName(u)} — Observation Results`;await renderObsResults();show('obsResultsScreen')}
$('obsResultsChangeUnit').onclick=()=>show('obsResultsUnitScreen');$('obsResultPeriod').onchange=renderObsResults;async function filteredObsSessions(){const start=periodStart('obsResultPeriod');return (await idbAll('observations')).filter(s=>s.unit===state.obsResultUnit&&(!start||new Date(s.date)>=start))}
async function renderObsResults(){const sessions=await filteredObsSessions(),responses=[];sessions.forEach(s=>(s.responses||[]).forEach(r=>{if(r.result&&r.result!=='N/A')responses.push({...r,session:s})}));const c={Compliant:0,Partial:0,'Non-Compliant':0};responses.forEach(r=>c[r.result]=(c[r.result]||0)+1);const byArea=defaultAreaCounts(sessions);let html=`<div class="metricGrid"><div class="metric"><b>${sessions.length}</b><span>Area rounds</span></div><div class="metric"><b>${responses.length}</b><span>Scored checks</span></div><div class="metric"><b>${c.Compliant||0}</b><span>Compliant</span></div><div class="metric"><b>${(c.Partial||0)+(c['Non-Compliant']||0)}</b><span>Findings</span></div></div><div class="sectionLabel">By area</div>`;html+=Object.entries(byArea).sort((a,b)=>b[1].findings-a[1].findings).map(([area,x])=>`<div class="resultRow"><div><b>${escapeHtml(area)}</b><div class="micro">Rounds ${x.rounds} • Scored ${x.scored}</div></div><span class="count">${x.findings} findings</span></div>`).join('')||'<div class="muted">No observation rounds in this period yet.</div>';$('obsResultsOutput').innerHTML=html}
function defaultAreaCounts(sessions){const o={};for(const s of sessions){const x=o[s.area]||(o[s.area]={rounds:0,scored:0,findings:0});x.rounds++;for(const r of s.responses||[]){if(r.result&&r.result!=='N/A'){x.scored++;if(r.result==='Partial'||r.result==='Non-Compliant')x.findings++}}}return o}
$('exportObsUnitCsv').onclick=async()=>exportObservationCsv(await filteredObsSessions(),`${state.obsResultUnit}_${$('obsResultPeriod').value}_Observation_Results`);

// DATA / BACKUP
async function openData(){const staff=await idbAll('staff'),reviews=await idbAll('reviews'),sessions=await idbAll('sessions'),templates=await idbAll('templates'),observations=await idbAll('observations');$('dataSummary').innerHTML=`<b>App</b>: v${APP_VERSION}<br><b>Pilot DB</b>: ${master?.databaseVersion||'Not imported'}<br><b>Policy verification</b>: ${escapeHtml(master?.policyVerificationStatus||'Pending')}<br><b>Staff IDs</b>: ${staff.length}<br><b>Interview sessions</b>: ${sessions.length}<br><b>Observation rounds</b>: ${observations.length}<br><b>Saved session templates</b>: ${templates.length}<br><b>Question flags</b>: ${reviews.length}`;show('dataScreen')}
$('exportBackupBtn').onclick=exportBackup;$('importBackupBtn').onclick=()=>$('backupFile').click();$('replaceMasterBtn').onclick=()=>$('dbFile').click();$('exportAllCsvBtn').onclick=async()=>exportSessionsCsv(await idbAll('sessions'),'All_Interview_Results');$('exportAllObsCsvBtn').onclick=async()=>exportObservationCsv(await idbAll('observations'),'All_Observation_Results');
async function exportBackup(){const out={app:'JCITracerLocalV05',exported:new Date().toISOString(),masterInfo:{databaseVersion:master?.databaseVersion||null},reviews:await idbAll('reviews'),staff:await idbAll('staff'),sessions:await idbAll('sessions'),templates:await idbAll('templates'),observations:await idbAll('observations'),pins:(await idbGet('kv','pins'))?.value||[]};downloadBlob(JSON.stringify(out,null,2),'application/json',`JCI_Tracer_Backup_${new Date().toISOString().slice(0,10)}.json`)}
$('backupFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());if(!['JCITracerLocalV05','JCITracerLocalV04','JCITracerLocalV03'].includes(obj.app))throw new Error();await idbClear('reviews');await idbClear('staff');await idbClear('sessions');await idbClear('templates');await idbClear('observations');for(const x of obj.reviews||[])await idbPut('reviews',x);for(const x of obj.staff||[])await idbPut('staff',x);for(const x of obj.sessions||[])await idbAdd('sessions',x);for(const x of obj.templates||[])await idbAdd('templates',x);for(const x of obj.observations||[])await idbAdd('observations',x);await idbPut('kv',{key:'pins',value:obj.pins||[]});toast('Backup restored');await openData()}catch(err){alert('Invalid backup file.')}e.target.value=''};
async function exportSessionsCsv(sessions,name){const rows=[['Date','Unit','Staff ID','Role','Session Type','Session Name','Question ID','Chapter','Question','Result','Note']];sessions.forEach(s=>(s.responses||[]).forEach(r=>{const q=qById(r.qid);rows.push([s.date,unitName(s.unit),s.staffId,s.role||'',s.sourceType||'',s.sourceName||'',r.qid,q?.chapter||'',q?.question||'',r.result||'',r.note||''])}));downloadCsv(rows,`JCI_${name}_${new Date().toISOString().slice(0,10)}.csv`)}
async function exportObservationCsv(sessions,name){const rows=[['Date','Unit','Area','Item ID','Section','Observation Check','Result','Finding / Note','Standard','ME']];sessions.forEach(s=>(s.responses||[]).forEach(r=>{const x=obsByKey(r.key);rows.push([s.date,unitName(s.unit),s.area,r.itemId||x?.itemId||'',x?.section||'',x?.check||'',r.result||'',r.note||'',x?.standards||'',x?.mes||''])}));downloadCsv(rows,`JCI_${name}_${new Date().toISOString().slice(0,10)}.csv`)}
function downloadCsv(rows,name){const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n');downloadBlob('\ufeff'+csv,'text/csv;charset=utf-8',name)}
function downloadBlob(content,type,name){const blob=new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

// MODAL / NAV
function openModal(title,body,isHtml=false){$('modalTitle').textContent=title;$('modalBody').innerHTML=isHtml?body:escapeHtml(body).replace(/\n/g,'<br>');$('modal').classList.remove('hidden')}
function closeModal(){$('modal').classList.add('hidden')}$('modalClose').onclick=closeModal;$('modal').onclick=e=>{if(e.target.id==='modal')closeModal()};
document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>show(b.dataset.back));
$('dataBtn').onclick=openData;
document.querySelectorAll('[data-mainnav]').forEach(b=>b.onclick=()=>{const n=b.dataset.mainnav;if(!master)return show('setupScreen');if(n==='home')show('homeScreen');if(n==='bank'){renderAllUnitGrids();show('bankUnitScreen')}if(n==='saved'){state.savedRoleFilter=null;renderAllUnitGrids();show('savedUnitScreen')}if(n==='review')openReviewHome();if(n==='data')openData()});
init();
