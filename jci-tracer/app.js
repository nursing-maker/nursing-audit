
const DB_NAME="JCITracerLocalV03", DB_VERSION=1;
const APP_VERSION="0.3.0";
const roleAllowed={SN:["SN"],CN:["SN","CN"],HN:["SN","CN","HN"]};
let master=null;
let state={unit:null,staffId:"",role:null,mode:null,tiers:["E1"],tags:[],chapters:[],session:[],index:0};

const $=id=>document.getElementById(id);
const screens=[...document.querySelectorAll(".screen")];

function openIDB(){
 return new Promise((resolve,reject)=>{
   const req=indexedDB.open(DB_NAME,DB_VERSION);
   req.onupgradeneeded=()=>{
     const db=req.result;
     if(!db.objectStoreNames.contains("kv"))db.createObjectStore("kv",{keyPath:"key"});
     if(!db.objectStoreNames.contains("reviews"))db.createObjectStore("reviews",{keyPath:"key"});
     if(!db.objectStoreNames.contains("staff"))db.createObjectStore("staff",{keyPath:"id"});
     if(!db.objectStoreNames.contains("sessions"))db.createObjectStore("sessions",{keyPath:"id",autoIncrement:true});
   };
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
}
async function idbGet(store,key){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,"readonly");const r=tx.objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbPut(store,obj){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).put(obj);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function idbAdd(store,obj){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).add(obj);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function idbAll(store){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,"readonly");const r=tx.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbClear(store){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).clear();tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}

function show(id){screens.forEach(s=>s.classList.remove("active"));$(id).classList.add("active");window.scrollTo({top:0,behavior:"smooth"})}
function unitName(id){return master?.units.find(x=>x.id===id)?.name||id}
function roleFor(q){return q.roleByUnit[state.unit]||""}
function eligible(q){return q.units.includes(state.unit)&&roleAllowed[state.role]?.includes(roleFor(q))}
function toast(msg){$("toast").textContent=msg;$("toast").classList.remove("hidden");setTimeout(()=>$("toast").classList.add("hidden"),1500)}
function reviewKey(kind,qid){return kind==="gc"?`GC|${qid}`:`UNIT|${state.unit}|${qid}`}
async function getReview(kind,qid){return await idbGet("reviews",reviewKey(kind,qid))}
async function setReview(kind,qid,status,note=""){await idbPut("reviews",{key:reviewKey(kind,qid),status,note,updated:new Date().toISOString()})}
async function getStaff(){if(!state.staffId)return null;return (await idbGet("staff",state.staffId))||{id:state.staffId,asked:[]}}
function askedSet(staff){return new Set((staff?.asked||[]).map(x=>x.qid))}
async function markAsked(q){let s=await getStaff();if(!s)return;if(!s.asked.some(x=>x.qid===q.id)){s.asked.push({qid:q.id,unit:state.unit,role:state.role,date:new Date().toISOString()});await idbPut("staff",s)}}

async function init(){
 const m=await idbGet("kv","master");
 master=m?.value||null;
 renderDbStatus();
 if("serviceWorker" in navigator){try{await navigator.serviceWorker.register("./service-worker.js");navigator.serviceWorker.ready.then(r=>r.update())}catch(e){}}
 try{if(navigator.storage?.persist)await navigator.storage.persist()}catch(e){}
}
function renderDbStatus(){
 if(master){
   $("dbStatus").innerHTML=`<b>Database ready</b><br>${master.databaseVersion}<br>${master.questionCount} questions • ${master.generalCoreCandidateCount} General Core candidates`;
   $("continueBtn").classList.remove("hidden");$("continueBtn").textContent="Start";
 }else{
   $("dbStatus").innerHTML=`<b>No question database imported yet.</b><br>Save the supplied Master DB JSON in iPad Files, then tap Import Master Database once.`;
   $("continueBtn").classList.add("hidden");
 }
}
$("importDbBtn").onclick=()=>$("dbFile").click();
$("dbFile").onchange=async e=>{
 const f=e.target.files[0];if(!f)return;
 try{
   const obj=JSON.parse(await f.text());
   if(!obj.questions||!obj.units||!obj.databaseVersion)throw new Error("Invalid database");
   master=obj;await idbPut("kv",{key:"master",value:obj,imported:new Date().toISOString()});
   renderDbStatus();toast("Master database imported");
 }catch(err){alert("This is not a valid JCI Tracer master database file.");}
 e.target.value="";
};
$("continueBtn").onclick=()=>{renderUnits();show("unitScreen")};

function renderUnits(){
 $("unitGrid").innerHTML=master.units.map(u=>{
   const c=master.questions.filter(q=>q.units.includes(u.id)).length;
   return `<button class="choice unitChoice" data-unit="${u.id}">${u.name}<small>${c} frozen questions</small></button>`;
 }).join("");
 document.querySelectorAll(".unitChoice").forEach(b=>b.onclick=()=>selectUnit(b.dataset.unit));
}
function selectUnit(u){
 state={...state,unit:u,staffId:"",role:null,mode:null,tiers:["E1"],tags:[],chapters:[],session:[],index:0};
 $("staffId").value="";document.querySelectorAll(".role").forEach(b=>b.classList.remove("selected"));
 $("staffStats").classList.add("hidden");$("staffHeading").textContent=`${unitName(u)} — Staff & Role`;show("staffScreen");
}
document.querySelectorAll(".role").forEach(b=>b.onclick=async()=>{state.role=b.dataset.role;document.querySelectorAll(".role").forEach(x=>x.classList.toggle("selected",x===b));await renderStaffStats()});
$("staffId").oninput=async()=>{state.staffId=$("staffId").value.trim();await renderStaffStats()};
async function renderStaffStats(){
 state.staffId=$("staffId").value.trim();
 if(!state.staffId||!state.role){$("staffStats").classList.add("hidden");return}
 const s=await getStaff(), asked=askedSet(s), all=master.questions.filter(eligible), gc=all.filter(q=>q.generalCore);
 const unitReviews=await idbAll("reviews");const reviewed=all.filter(q=>unitReviews.some(r=>r.key===`UNIT|${state.unit}|${q.id}`)).length;
 $("staffStats").innerHTML=`<div class="stat"><b>${asked.size}</b><span>Previously shown</span></div><div class="stat"><b>${gc.filter(q=>asked.has(q.id)).length}/${gc.length}</b><span>General Core shown</span></div><div class="stat"><b>${reviewed}/${all.length}</b><span>Unit practical review</span></div>`;
 $("staffStats").classList.remove("hidden");
}
$("staffContinue").onclick=()=>{
 state.staffId=$("staffId").value.trim();
 if(!state.staffId)return alert("Enter Staff ID.");
 if(!state.role)return alert("Choose a role.");
 $("roundContext").textContent=`${unitName(state.unit)} • Staff ${state.staffId} • ${state.role==="SN"?"Staff Nurse":state.role==="CN"?"Charge Nurse":"Head Nurse"}`;
 show("modeScreen");
};

document.querySelectorAll(".mode").forEach(b=>b.onclick=()=>chooseMode(b.dataset.mode));
async function chooseMode(mode){
 state.mode=mode;state.tiers=["E1"];state.tags=[];state.chapters=[];
 document.querySelectorAll(".tier").forEach(x=>x.classList.toggle("selected",x.dataset.tier==="E1"));
 $("generalBuilder").classList.toggle("hidden",mode!=="general");
 $("patientBuilder").classList.toggle("hidden",mode!=="patient");
 $("chapterBuilder").classList.toggle("hidden",mode!=="chapter");
 const titles={general:"General Core",patient:"Patient-Driven",chapter:"By Chapter",review:"Review Unreviewed"};
 const helps={
   general:"These are the 49 General Core candidates. Suggested E1/E2/E3 is not final until you approve it.",
   patient:"Choose the real patient situations/devices you see. The app pulls related questions from this unit.",
   chapter:"Choose one or more chapters.",
   review:"Continue reviewing questions that do not yet have a unit practical-review decision."
 };
 $("builderTitle").textContent=titles[mode];$("builderHelp").textContent=helps[mode];
 renderSelectors();await updateMatchSummary();show("builderScreen");
}
function renderSelectors(){
 if(master){
   $("tagGrid").innerHTML=master.tags.map(t=>`<button class="chip tag" data-tag="${t.replaceAll('"',"&quot;")}">${t}</button>`).join("");
   document.querySelectorAll(".tag").forEach(b=>b.onclick=async()=>{b.classList.toggle("selected");state.tags=b.classList.contains("selected")?[...new Set([...state.tags,b.dataset.tag])]:state.tags.filter(x=>x!==b.dataset.tag);await updateMatchSummary()});
   $("chapterGrid").innerHTML=master.chapters.map(c=>`<button class="chip chapter" data-chapter="${c}">${c}</button>`).join("");
   document.querySelectorAll(".chapter").forEach(b=>b.onclick=async()=>{b.classList.toggle("selected");state.chapters=b.classList.contains("selected")?[...new Set([...state.chapters,b.dataset.chapter])]:state.chapters.filter(x=>x!==b.dataset.chapter);await updateMatchSummary()});
 }
}
document.querySelectorAll(".tier").forEach(b=>b.onclick=async()=>{b.classList.toggle("selected");state.tiers=b.classList.contains("selected")?[...new Set([...state.tiers,b.dataset.tier])]:state.tiers.filter(x=>x!==b.dataset.tier);await updateMatchSummary()});
["gcDecisionFilter","questionCount","avoidAsked","hideNotRelevant"].forEach(id=>$(id).onchange=updateMatchSummary);

async function buildPool(){
 let p=master.questions.filter(eligible);
 const reviews=await idbAll("reviews");
 const rmap=new Map(reviews.map(x=>[x.key,x]));
 if($("hideNotRelevant").checked)p=p.filter(q=>rmap.get(`UNIT|${state.unit}|${q.id}`)?.status!=="Not Relevant");
 if(state.mode==="general"){
   p=p.filter(q=>q.generalCore&&state.tiers.includes(q.generalCore.tier));
   const f=$("gcDecisionFilter").value;
   if(f!=="all")p=p.filter(q=>{const s=rmap.get(`GC|${q.id}`)?.status||"Pending";return f==="approved"?s==="Approved General Core":s==="Pending"});
 }
 if(state.mode==="patient")p=p.filter(q=>state.tags.length&&q.tags.some(t=>state.tags.includes(t)));
 if(state.mode==="chapter")p=p.filter(q=>state.chapters.length&&state.chapters.includes(q.chapter));
 if(state.mode==="review")p=p.filter(q=>!rmap.has(`UNIT|${state.unit}|${q.id}`));
 return p;
}
async function updateMatchSummary(){
 const p=await buildPool(),s=await getStaff(),asked=askedSet(s),fresh=p.filter(q=>!asked.has(q.id)).length;
 $("matchSummary").innerHTML=`<b>${p.length}</b> matching questions • <b>${fresh}</b> not previously shown to this Staff ID`;
}
$("startSession").onclick=async()=>{
 if(state.mode==="general"&&!state.tiers.length)return alert("Choose at least one tier.");
 if(state.mode==="patient"&&!state.tags.length)return alert("Choose at least one patient/situation.");
 if(state.mode==="chapter"&&!state.chapters.length)return alert("Choose at least one chapter.");
 let p=await buildPool();if(!p.length)return alert("No questions match this selection.");
 const s=await getStaff(),asked=askedSet(s),reviews=await idbAll("reviews"),pins=new Set((await idbGet("kv","pins"))?.value||[]);
 p.sort((a,b)=>{
   if($("avoidAsked").checked){const aa=asked.has(a.id)?1:0,bb=asked.has(b.id)?1:0;if(aa!==bb)return aa-bb}
   const pa=pins.has(`${state.unit}|${a.id}`)?0:1,pb=pins.has(`${state.unit}|${b.id}`)?0:1;if(pa!==pb)return pa-pb;
   const tr=q=>q.generalCore?({E1:0,E2:1,E3:2}[q.generalCore.tier]??3):3;if(tr(a)!==tr(b))return tr(a)-tr(b);
   return master.chapters.indexOf(a.chapter)-master.chapters.indexOf(b.chapter);
 });
 state.session=p.slice(0,Number($("questionCount").value));state.index=0;show("questionScreen");await renderQuestion();
};

function currentQ(){return state.session[state.index]}
async function renderQuestion(){
 const q=currentQ();if(!q)return finishSession();
 const kind=state.mode==="general"?"gc":"unit",rv=await getReview(kind,q.id),s=await getStaff(),asked=askedSet(s),pins=new Set((await idbGet("kv","pins"))?.value||[]);
 let badges=[];
 if(q.generalCore)badges.push(`<span class="badge ${q.generalCore.tier.toLowerCase()}">${q.generalCore.tier} • ${q.generalCore.topic}</span>`);
 badges.push(`<span class="badge">${q.chapter}</span><span class="badge">${roleFor(q)}</span>`);
 if(asked.has(q.id))badges.push(`<span class="badge">Previously shown</span>`);
 $("questionBadges").innerHTML=badges.join("");
 $("questionContext").textContent=`${unitName(state.unit)} • Staff ${state.staffId} • ${state.index+1}/${state.session.length}`+(q.tags.length?` • ${q.tags.slice(0,3).join(" / ")}`:"");
 $("progressFill").style.width=((state.index+1)/state.session.length*100)+"%";$("questionText").textContent=q.question;
 $("reviewNote").value=rv?.note||"";$("reviewCurrent").textContent=rv?.status||"Pending";
 $("reviewLabel").textContent=kind==="gc"?"General Core Decision":"Unit Practical Review";
 renderReviewButtons(kind,rv?.status||"Pending");
 $("pinBtn").textContent=pins.has(`${state.unit}|${q.id}`)?"★ Pinned":"☆ Pin";
}
function renderReviewButtons(kind,status){
 const opts=kind==="gc"?
   [["Approved General Core","Approve Core","approved"],["Needs Rewrite","Needs Rewrite","rewrite"],["Not General Core","Not General","reject"],["Local Check","Local Check","local"]]:
   [["Approved","✓ Good","approved"],["Needs Rewrite","Needs Rewrite","rewrite"],["Not Relevant","Not Relevant","reject"],["Local Check","Local Check","local"]];
 $("reviewButtons").innerHTML=opts.map(o=>`<button class="${o[2]} ${status===o[0]?"active":""}" data-status="${o[0]}">${o[1]}</button>`).join("");
 document.querySelectorAll("#reviewButtons button").forEach(b=>b.onclick=async()=>{await setReview(state.mode==="general"?"gc":"unit",currentQ().id,b.dataset.status,$("reviewNote").value.trim());toast(b.dataset.status);await renderQuestion()});
}
$("pinBtn").onclick=async()=>{
 const k=`${state.unit}|${currentQ().id}`,rec=await idbGet("kv","pins"),pins=new Set(rec?.value||[]);
 pins.has(k)?pins.delete(k):pins.add(k);await idbPut("kv",{key:"pins",value:[...pins]});await renderQuestion()
};
async function persistNote(){
 const q=currentQ();if(!q)return;const kind=state.mode==="general"?"gc":"unit",rv=await getReview(kind,q.id);
 if(rv)await setReview(kind,q.id,rv.status,$("reviewNote").value.trim());
}
$("nextQuestion").onclick=async()=>{await persistNote();await markAsked(currentQ());if(state.index<state.session.length-1){state.index++;await renderQuestion()}else await finishSession()};
$("prevQuestion").onclick=async()=>{await persistNote();if(state.index>0){state.index--;await renderQuestion()}};
$("skipQuestion").onclick=async()=>{await markAsked(currentQ());if(state.index<state.session.length-1){state.index++;await renderQuestion()}else await finishSession()};

document.querySelectorAll(".info").forEach(b=>b.onclick=()=>showInfo(b.dataset.info));
function showInfo(kind){
 const q=currentQ();let title="",body="";
 if(kind==="expected"){title="JCI Expected Answer";body=q.expected||"No expected-answer text available."}
 if(kind==="policy"){title="Dallah Policy Answer";body=q.policy||"Policy verification pending / no Dallah policy answer currently populated.";if(q.policyRef)body+=`\n\nPolicy reference:\n${q.policyRef}`}
 if(kind==="standard"){
   title="Official Standard";
   if(q.sourceRefs?.length){const byStd=[];const seen=new Set();q.sourceRefs.forEach(r=>{if(r.standard&&!seen.has(r.standard)){seen.add(r.standard);byStd.push(`<div class="sourceBlock"><b>${escapeHtml(r.standard)}</b><br>${escapeHtml(r.standardStatement||"")}</div>`)}});body=byStd.join("")}
   else body=`${escapeHtml(q.standard||"No scored Standard")}`;
 }
 if(kind==="me"){
   title="Official Measurable Element";
   if(q.sourceRefs?.length){body=q.sourceRefs.map(r=>`<div class="sourceBlock"><b>${escapeHtml(r.standard)} — ${escapeHtml(r.me)}</b><br>${escapeHtml(r.meText||"")}<div class="micro">Manual p. ${escapeHtml(r.page||"—")}</div></div>`).join("")}
   else body=`${escapeHtml(q.me||"No scored ME")}`;
 }
 openModal(title,body,kind==="standard"||kind==="me");
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function openModal(title,body,isHtml=false){$("modalTitle").textContent=title;$("modalBody").innerHTML=isHtml?body:escapeHtml(body).replace(/\n/g,"<br>");$("modal").classList.remove("hidden")}
function closeModal(){$("modal").classList.add("hidden")}
$("modalClose").onclick=closeModal;$("modal").onclick=e=>{if(e.target.id==="modal")closeModal()};

async function finishSession(){
 await persistNote();for(const q of state.session)await markAsked(q);
 await idbAdd("sessions",{date:new Date().toISOString(),unit:state.unit,staffId:state.staffId,role:state.role,mode:state.mode,qids:state.session.map(q=>q.id)});
 let approved=0,rewrite=0,reject=0,local=0,pending=0;const kind=state.mode==="general"?"gc":"unit";
 for(const q of state.session){const r=await getReview(kind,q.id),s=r?.status||"Pending";if(s.startsWith("Approved"))approved++;else if(s==="Needs Rewrite")rewrite++;else if(s==="Not Relevant"||s==="Not General Core")reject++;else if(s==="Local Check")local++;else pending++}
 $("sessionSummary").innerHTML=`<div class="listRow"><b>Unit</b><span>${unitName(state.unit)}</span></div><div class="listRow"><b>Staff ID</b><span>${state.staffId}</span></div><div class="listRow"><b>Questions</b><span class="count">${state.session.length}</span></div><div class="listRow"><b>Approved / Good</b><span class="count">${approved}</span></div><div class="listRow"><b>Needs Rewrite</b><span class="count">${rewrite}</span></div><div class="listRow"><b>Rejected / Not Relevant</b><span class="count">${reject}</span></div><div class="listRow"><b>Local Check</b><span class="count">${local}</span></div><div class="listRow"><b>Pending</b><span class="count">${pending}</span></div>`;
 show("summaryScreen");
}
$("sameStaffNewSelection").onclick=()=>show("modeScreen");
$("newStaffRound").onclick=()=>selectUnit(state.unit);

document.querySelectorAll("[data-back]").forEach(b=>b.onclick=()=>show(b.dataset.back));
document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>{if(master){renderUnits();show(b.dataset.nav)}else show("setupScreen")});
$("quickGeneral").onclick=()=>{if(state.unit&&state.staffId&&state.role)chooseMode("general");else toast("Choose unit, Staff ID and role first")};
$("quickReview").onclick=()=>{if(state.unit&&state.staffId&&state.role)chooseMode("review");else toast("Choose unit, Staff ID and role first")};

$("dataBtn").onclick=openData;$("backupNav").onclick=openData;
async function openData(){
 const staff=await idbAll("staff"),reviews=await idbAll("reviews"),sessions=await idbAll("sessions");
 const msg=`App version: ${APP_VERSION}\nMaster database: ${master?.databaseVersion||"Not imported"}\nStaff IDs with history: ${staff.length}\nSaved review decisions: ${reviews.length}\nSaved sessions: ${sessions.length}\n\nAll operational data are stored locally on this device/browser. Export a backup regularly.`;
 openModal("Local Data & Backup",msg);
 $("modalBody").innerHTML=escapeHtml(msg).replace(/\n/g,"<br>")+`<div class="actions"><button class="primary grow" id="exportBtn">Export Backup</button><button class="secondary grow" id="importBackupBtn">Import Backup</button></div><div class="actions"><button class="secondary grow" id="replaceDbBtn">Replace Master Database</button></div>`;
 $("exportBtn").onclick=exportBackup;$("importBackupBtn").onclick=()=>$("backupFile").click();$("replaceDbBtn").onclick=()=>{$("dbFile").click();closeModal()};
}
async function exportBackup(){
 const out={app:"JCITracerLocalV03",exported:new Date().toISOString(),masterInfo:{databaseVersion:master?.databaseVersion||null},reviews:await idbAll("reviews"),staff:await idbAll("staff"),sessions:await idbAll("sessions"),pins:(await idbGet("kv","pins"))?.value||[]};
 const blob=new Blob([JSON.stringify(out,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`JCI_Tracer_Backup_${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast("Backup exported")
}
$("backupFile").onchange=async e=>{
 const f=e.target.files[0];if(!f)return;
 try{
   const obj=JSON.parse(await f.text());if(obj.app!=="JCITracerLocalV03")throw new Error("Invalid backup");
   await idbClear("reviews");await idbClear("staff");await idbClear("sessions");
   for(const x of obj.reviews||[])await idbPut("reviews",x);for(const x of obj.staff||[])await idbPut("staff",x);for(const x of obj.sessions||[])await idbAdd("sessions",x);await idbPut("kv",{key:"pins",value:obj.pins||[]});
   closeModal();toast("Backup restored");await renderStaffStats();
 }catch(err){alert("Invalid backup file.");}
 e.target.value="";
};

init();
