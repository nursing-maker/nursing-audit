const DB_NAME = "JCITracerLocalV03";
const DB_VERSION = 4;
const APP_VERSION = "0.6.0";
const DEFAULT_DB = "./JCI_Tracer_Workflow_Pilot_DB_v0_7.json";
const roleAllowed = { SN: ["SN"], CN: ["SN", "CN"], HN: ["SN", "CN", "HN"] };
const modeLabels = { quick: "General Round", general: "Core Questions", situation: "Patient / Situation", chapter: "By Chapter", manual: "Manual Session", saved: "Saved Session" };
const interviewResults = ["Understood", "Partial", "Not Understood", "Not Asked"];
const observationResults = ["Compliant", "Partial", "Non-Compliant", "N/A"];

let master = null;
let currentScreen = "setupScreen";
let routeStack = [];
let noteTimer = null;
let busy = false;
let state = freshState();

function freshState() {
  return {
    unit: null, role: null, mode: null, tags: [], chapters: [], requestedCount: 8,
    staffId: "", session: [], responses: {}, pendingStart: null, sourceType: "", sourceName: "",
    bankSelected: [], bankOrigin: "flow", savedRoleFilter: null, lastInterview: null,
    obsUnit: null, obsArea: null, obsRound: null, lastRound: null,
  };
}

const $ = id => document.getElementById(id);
const screens = [...document.querySelectorAll(".screen")];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const now = () => new Date().toISOString();
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const stores = [
        ["kv", { keyPath: "key" }], ["reviews", { keyPath: "key" }], ["staff", { keyPath: "id" }],
        ["sessions", { keyPath: "id", autoIncrement: true }], ["templates", { keyPath: "id", autoIncrement: true }],
        ["observations", { keyPath: "id", autoIncrement: true }], ["rounds", { keyPath: "id" }],
      ];
      for (const [name, options] of stores) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(store, key) { const db = await openIDB(); return new Promise((res, rej) => { const r = db.transaction(store, "readonly").objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbPut(store, value) { const db = await openIDB(); return new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => res(value); tx.onerror = () => rej(tx.error); }); }
async function idbAdd(store, value) { const db = await openIDB(); return new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); const r = tx.objectStore(store).add(value); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbAll(store) { const db = await openIDB(); return new Promise((res, rej) => { const r = db.transaction(store, "readonly").objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbClear(store) { const db = await openIDB(); return new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).clear(); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }

function show(id, options = {}) {
  if (!$(id)) return;
  if (!options.replace && currentScreen !== id) routeStack.push(currentScreen);
  currentScreen = id;
  screens.forEach(s => s.classList.toggle("active", s.id === id));
  $("headerBack").classList.toggle("hidden", ["homeScreen", "setupScreen"].includes(id));
  if (!options.replace) history.pushState({ screen: id }, "");
  window.scrollTo({ top: 0, behavior: "auto" });
}
function goBack() { const previous = routeStack.pop(); if (previous && $(previous)) show(previous, { replace: true }); else show("homeScreen", { replace: true }); }
function goHome() { routeStack = []; show("homeScreen", { replace: true }); }
function toast(message) { $("toast").textContent = message; $("toast").classList.remove("hidden"); setTimeout(() => $("toast").classList.add("hidden"), 1800); }
async function guarded(fn) { if (busy) return; busy = true; try { await fn(); } finally { setTimeout(() => { busy = false; }, 250); } }

function unit(id) { return master?.units?.find(x => x.id === id); }
function unitName(id) { return unit(id)?.name || id || ""; }
function roleName(role) { return role === "SN" ? "Staff Nurse" : role === "CN" ? "Charge Nurse" : "Head Nurse"; }
function qById(id) { return master?.questions?.find(q => q.id === id); }
function obsByKey(key) { return master?.observation?.items?.find(x => x.key === key); }
function eligible(q, unitId, role) { return q.units?.includes(unitId) && roleAllowed[role]?.includes(q.roleByUnit?.[unitId]); }
function statusFor(q, unitId) { return q.scopeStatusByUnit?.[unitId]?.status || ""; }
function activeOrConditional(q, unitId) { return ["ACTIVE", "CONDITIONAL"].includes(statusFor(q, unitId)); }
function questionTags(q) { return [...new Set([...(q.patientTags || []), ...(q.legacyPatientTags || [])])]; }
function situationAliases(tag) { return tag === "Hemodialysis" ? ["Hemodialysis", "Dialysis"] : [tag]; }
function matchesSituation(q, tag) { return situationAliases(tag).some(t => questionTags(q).includes(t)); }
function shuffle(items) { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function loadMaster() {
  const saved = await idbGet("kv", "master");
  if (saved?.value?.schemaVersion >= 7) return saved.value;
  try {
    const response = await fetch(DEFAULT_DB, { cache: "no-store" });
    if (!response.ok) throw new Error("database unavailable");
    const bundled = await response.json();
    if (!bundled.questions || !bundled.observation || bundled.schemaVersion < 7) throw new Error("invalid database");
    await idbPut("kv", { key: "master", value: bundled, imported: now(), migration: "v0.6.1-to-v0.7-preserve-local-stores" });
    return bundled;
  } catch (_) { return saved?.value || null; }
}
async function init() {
  master = await loadMaster();
  if ("serviceWorker" in navigator) try { const reg = await navigator.serviceWorker.register("./service-worker.js"); reg.update(); } catch (_) {}
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch (_) {}
  if (!master) { renderDbStatus(); show("setupScreen", { replace: true }); return; }
  $("bankChapter").innerHTML = `<option value="">All chapters</option>${master.chapters.map(c => `<option>${esc(c)}</option>`).join("")}`;
  renderAllUnitGrids(); await renderResumeActions(); show("homeScreen", { replace: true });
}
function renderDbStatus() { $("dbStatus").innerHTML = master ? `<b>Database ready</b><br>${esc(master.databaseVersion)}` : "<b>Database unavailable.</b><br>Import JCI_Tracer_Workflow_Pilot_DB_v0_7.json."; }
async function importMaster(file) { const data = JSON.parse(await file.text()); if (!data.questions || !data.units || !data.observation || data.schemaVersion < 7) throw new Error("invalid database"); master = data; await idbPut("kv", { key: "master", value: data, imported: now() }); $("bankChapter").innerHTML = `<option value="">All chapters</option>${master.chapters.map(c => `<option>${esc(c)}</option>`).join("")}`; renderAllUnitGrids(); goHome(); }

async function renderResumeActions() {
  document.querySelectorAll(".resumeChoice").forEach(x => x.remove());
  const i = await idbGet("kv", "activeInterview"), o = await idbGet("kv", "activeObservationRound");
  if (i?.value?.session?.length) { const b = document.createElement("button"); b.className = "resumeChoice"; b.innerHTML = `<b>Resume Interview</b><small>${esc(unitName(i.value.unit))} • ${esc(i.value.staffId)}</small>`; b.onclick = () => { Object.assign(state, i.value); renderInterviewRun(); show("interviewRunScreen"); }; $("homeScreen").appendChild(b); }
  if (o?.value?.id) { const b = document.createElement("button"); b.className = "resumeChoice observationResume"; b.innerHTML = `<b>Resume Unit Round</b><small>${esc(unitName(o.value.unit))}</small>`; b.onclick = () => { state.obsRound = o.value; state.obsUnit = o.value.unit; renderObservationAreas(); show("observationAreaScreen"); }; $("homeScreen").appendChild(b); }
}

function unitButtons(target, handler, kind) {
  $(target).innerHTML = master.units.map(u => { const summary = master.unitSummary?.[u.id] || {}, unavailable = kind === "observation" && !summary.observationChecks, count = kind === "interview" ? `${summary.cleanInterviewBank ?? 0} Q` : unavailable ? "No checklist yet" : `${summary.observationChecks} Checks`; return `<button class="unitCard ${unavailable ? "disabled" : ""}" data-family="${esc(u.family || "")}" data-unit="${esc(u.id)}" ${unavailable ? "disabled" : ""}><b>${esc(u.name)}</b><span class="countBadge">${esc(count)}</span></button>`; }).join("");
  document.querySelectorAll(`#${target} [data-unit]:not([disabled])`).forEach(button => button.onclick = () => handler(button.dataset.unit));
}
function renderAllUnitGrids() { unitButtons("interviewUnitGrid", selectInterviewUnit, "interview"); unitButtons("observationUnitGrid", selectObservationUnit, "observation"); }

// Interview setup
function selectInterviewUnit(unitId) { Object.assign(state, { unit: unitId, role: null, mode: null, tags: [], chapters: [], requestedCount: 8, bankSelected: [] }); $("interviewRoleHeading").textContent = `${unitName(unitId)} — Choose Role`; show("interviewRoleScreen"); }
function openInterviewModes() { $("interviewContext").textContent = `${unitName(state.unit)} • ${roleName(state.role)}`; show("interviewModeScreen"); }
function situationTags(unitId, role) { const candidates = new Set(master.patientTagsByUnit?.[unitId] || []); for (const q of master.questions) if (eligible(q, unitId, role) && activeOrConditional(q, unitId)) questionTags(q).forEach(t => candidates.add(t)); return [...candidates].filter(tag => master.questions.some(q => eligible(q, unitId, role) && activeOrConditional(q, unitId) && matchesSituation(q, tag))).sort(); }
async function notRelevantIds(unitId) { const reviews = await idbAll("reviews"); return new Set(reviews.filter(r => r.key?.startsWith(`UNIT|${unitId}|`) && r.status === "Not Relevant").map(r => r.key.split("|")[2])); }
async function generatedPool() { const hidden = await notRelevantIds(state.unit); let pool = master.questions.filter(q => eligible(q, state.unit, state.role) && activeOrConditional(q, state.unit) && !hidden.has(q.id)); if (state.mode === "general") pool = pool.filter(q => q.generalCore); if (state.mode === "situation") pool = pool.filter(q => state.tags.some(t => matchesSituation(q, t))); if (state.mode === "chapter") pool = pool.filter(q => state.chapters.includes(q.chapter)); return pool; }
function chooseMode(mode) { state.mode = mode; state.tags = []; state.chapters = []; state.requestedCount = 8; if (["quick", "general"].includes(mode)) return prepareGeneratedStart(); if (mode === "more") return show("moreInterviewScreen"); renderBuilder(mode); show("builderScreen"); }
function renderBuilder(mode) { const isSituation = mode === "situation"; $("builderTitle").textContent = isSituation ? "Patient / Situation" : "By Chapter"; const values = isSituation ? situationTags(state.unit, state.role) : master.chapters; $("builderGrid").innerHTML = values.length ? values.map(v => `<button class="choice builderOption" data-value="${esc(v)}">${esc(v)}</button>`).join("") : `<div class="notice">No supported options are available for this unit and role.</div>`; $("builderCount").value = "8"; $("builderStatus").textContent = ""; document.querySelectorAll(".builderOption").forEach(button => button.onclick = () => { button.classList.toggle("selected"); const selected = [...document.querySelectorAll(".builderOption.selected")].map(x => x.dataset.value); if (isSituation) state.tags = selected; else state.chapters = selected; $("builderStatus").textContent = `${selected.length} selected`; }); }
async function prepareGeneratedStart() { const pool = await generatedPool(); if (!pool.length) return alert("No matching questions are available."); state.pendingStart = { kind: "generated" }; prepareStaffConfirm(); }
function pendingDescription() { const n = `${state.requestedCount} Q`; if (state.pendingStart?.kind === "template") return `${state.pendingStart.template.name} • ${state.pendingStart.template.qids.length} Q`; if (state.pendingStart?.kind === "manual") return `Manual Session • ${state.bankSelected.length} Q`; const focus = state.tags.length ? ` • ${state.tags.join(" / ")}` : state.chapters.length ? ` • ${state.chapters.join(", ")}` : ""; return `${modeLabels[state.mode]} • ${n}${focus}`; }
function prepareStaffConfirm(keepStaff = state.keepStaffNext || false) { state.keepStaffNext = false; if (!keepStaff) state.staffId = ""; $("staffConfirmId").value = state.staffId; $("staffConfirmContext").textContent = `${unitName(state.unit)} • ${roleName(state.role)} • ${pendingDescription()}`; $("changeQuestionCount").classList.toggle("hidden", ["manual", "saved"].includes(state.mode) || ["manual", "template"].includes(state.pendingStart?.kind)); show("staffConfirmScreen"); }
async function askedIds(staffId) { if (!staffId) return new Set(); const staff = await idbGet("staff", staffId); return new Set((staff?.asked || []).map(x => x.qid)); }
function prioritized(pool, count, asked) { return [...shuffle(pool.filter(q => !asked.has(q.id))), ...shuffle(pool.filter(q => asked.has(q.id)))].slice(0, count); }
function balanced(pool, count, asked) { const selected = [], used = new Set(); const add = (items, number) => prioritized(items.filter(x => !used.has(x.id)), number, asked).forEach(q => { used.add(q.id); selected.push(q); }); add(pool.filter(q => q.generalCore), Math.ceil(count * .5)); add(pool.filter(q => statusFor(q, state.unit) === "ACTIVE"), Math.ceil(count * .3)); add(pool, count - selected.length); return selected.slice(0, count); }
async function startInterview() {
  const staffId = $("staffConfirmId").value.trim(); if (!staffId) return alert("Enter Staff ID."); state.staffId = staffId; const asked = await askedIds(staffId); let chosen = [];
  if (state.pendingStart?.kind === "template") chosen = state.pendingStart.template.qids.map(qById).filter(q => q && eligible(q, state.unit, state.role));
  else if (state.pendingStart?.kind === "manual") chosen = state.bankSelected.map(qById).filter(Boolean);
  else { const pool = await generatedPool(); chosen = state.mode === "quick" ? balanced(pool, Math.min(state.requestedCount, pool.length), asked) : prioritized(pool, Math.min(state.requestedCount, pool.length), asked); }
  if (!chosen.length) return alert("No questions are available for this session.");
  state.session = chosen.map(q => q.id); state.responses = {}; state.sourceType = state.pendingStart?.kind === "template" ? "Saved" : state.pendingStart?.kind === "manual" ? "Manual" : "Generated"; state.sourceName = state.pendingStart?.kind === "template" ? state.pendingStart.template.name : modeLabels[state.mode]; await saveActiveInterview(); renderInterviewRun(); show("interviewRunScreen");
}
async function saveActiveInterview() { await idbPut("kv", { key: "activeInterview", value: { unit: state.unit, role: state.role, mode: state.mode, tags: state.tags, chapters: state.chapters, requestedCount: state.requestedCount, staffId: state.staffId, session: state.session, responses: state.responses, pendingStart: state.pendingStart, sourceType: state.sourceType, sourceName: state.sourceName } }); }
function topicFor(q) { return q?.tags?.[0] || q?.patientTags?.[0] || q?.chapter || "Question"; }
function resultClass(result) { return result?.toLowerCase().replaceAll(" ", "").replaceAll("/", "") || ""; }
function renderInterviewRun(openId = null) {
  const completed = state.session.filter(id => state.responses[id]?.result).length; $("interviewRunContext").textContent = `${unitName(state.unit)} • ${state.staffId} • ${roleName(state.role)} • ${state.sourceName}`; $("interviewProgress").textContent = `${completed} of ${state.session.length} completed`; $("interviewProgressFill").style.width = `${state.session.length ? completed / state.session.length * 100 : 0}%`;
  $("interviewQuestionList").innerHTML = state.session.map((id, index) => { const q = qById(id), response = state.responses[id] || {}, result = response.result || "Not assessed"; return `<article class="accordion ${openId === id ? "open" : ""}" data-id="${esc(id)}"><button class="accordionHeader"><span class="accordionNumber">${index + 1}</span><span><span class="accordionTitle">${esc(topicFor(q))}</span><span class="accordionMeta">${esc(q?.chapter)} • ${esc(q?.standard)} ${esc(q?.me)}</span></span><span class="statusBadge ${resultClass(result)}">${esc(result)}</span></button><div class="accordionBody"><div class="questionFull">${esc(q?.question).replace(/\n/g, "<br>")}</div><div class="resultButtons">${interviewResults.map(r => `<button class="${resultClass(r)} ${response.result === r ? "active" : ""}" data-result="${esc(r)}">${esc(r)}</button>`).join("")}</div><label>Staff note (optional)</label><textarea data-note placeholder="Add note">${esc(response.note || "")}</textarea><div class="detailActions"><button data-details>Details</button><button data-pin>${response.pin ? "Unpin" : "Pin"}</button><button data-flag>${response.flag ? "Unflag" : "Flag"}</button></div></div></article>`; }).join(""); bindInterviewCards();
}
function bindInterviewCards() { document.querySelectorAll("#interviewQuestionList .accordion").forEach(card => { const id = card.dataset.id; card.querySelector(".accordionHeader").onclick = () => card.classList.toggle("open"); card.querySelectorAll("[data-result]").forEach(button => button.onclick = async () => { state.responses[id] = { ...(state.responses[id] || {}), result: button.dataset.result }; await saveActiveInterview(); renderInterviewRun(id); }); card.querySelector("[data-note]").oninput = event => { clearTimeout(noteTimer); state.responses[id] = { ...(state.responses[id] || {}), note: event.target.value }; noteTimer = setTimeout(saveActiveInterview, 250); }; card.querySelector("[data-details]").onclick = () => showQuestionDetails(qById(id)); card.querySelector("[data-pin]").onclick = async () => { state.responses[id] = { ...(state.responses[id] || {}), pin: !state.responses[id]?.pin }; await saveActiveInterview(); renderInterviewRun(id); }; card.querySelector("[data-flag]").onclick = async () => { state.responses[id] = { ...(state.responses[id] || {}), flag: !state.responses[id]?.flag }; await saveActiveInterview(); renderInterviewRun(id); }; }); }
function showQuestionDetails(q) { const refs = (q.sourceRefs || []).map(r => `<div class="sourceBlock"><b>${esc(r.standard)} ${esc(r.me)}</b><p>${esc(r.standardStatement || "")}</p><p>${esc(r.meText || "")}</p></div>`).join(""); openModal("Question Details", `<div class="sourceBlock"><b>JCI Expected Answer</b><p>${esc(q.expected || "").replace(/\n/g, "<br>")}</p></div><div class="sourceBlock"><b>Local Policy Answer</b><p>${q.policy ? esc(q.policy).replace(/\n/g, "<br>") : "Pending Verification"}</p><p class="micro">${esc(q.policyRef || "")}</p></div>${refs || `<div class="sourceBlock"><b>Standard / ME</b><p>${esc(q.standard)} ${esc(q.me)}</p></div>`}`, true); }
async function finishInterview() { const record = { date: now(), unit: state.unit, staffId: state.staffId, role: state.role, mode: state.mode, sourceType: state.sourceType, sourceName: state.sourceName, qids: [...state.session], responses: state.session.map(qid => ({ qid, ...(state.responses[qid] || {}) })) }; record.id = await idbAdd("sessions", record); let staff = await idbGet("staff", state.staffId) || { id: state.staffId, asked: [] }; for (const r of record.responses) if (r.result && r.result !== "Not Asked" && !staff.asked.some(x => x.qid === r.qid)) staff.asked.push({ qid: r.qid, unit: state.unit, role: state.role, date: record.date }); await idbPut("staff", staff); await idbPut("kv", { key: "activeInterview", value: null }); state.lastInterview = record; renderInterviewSummary(record); show("interviewSummaryScreen"); await renderResumeActions(); }
function countsFor(responses, options) { const c = Object.fromEntries(options.map(x => [x, 0])); for (const r of responses) if (r.result in c) c[r.result]++; return c; }
function stackedBar(counts, total, labels) { return `<div class="stackedBar">${labels.map(([key, cls]) => `<span class="${cls}" style="width:${total ? counts[key] / total * 100 : 0}%"></span>`).join("")}</div><div class="legend">${labels.map(([key, cls]) => `<span><i class="${cls}"></i>${esc(key)} ${counts[key] || 0}</span>`).join("")}</div>`; }
function renderInterviewSummary(record) { const c = countsFor(record.responses, interviewResults), completed = record.responses.filter(r => r.result && r.result !== "Not Asked").length, gaps = record.responses.filter(r => ["Partial", "Not Understood"].includes(r.result)); $("interviewSummary").innerHTML = `<div class="contextLine">${esc(unitName(record.unit))} • Staff ${esc(record.staffId)} • ${esc(roleName(record.role))} • ${esc(record.sourceName)} • ${new Date(record.date).toLocaleString()}</div><div class="summaryCards"><div class="summaryCard"><b>${record.responses.length}</b><span>Questions</span></div><div class="summaryCard"><b>${completed}</b><span>Completed</span></div><div class="summaryCard"><b>${c.Partial}</b><span>Partial</span></div><div class="summaryCard"><b>${c["Not Understood"]}</b><span>Not Understood</span></div></div>${stackedBar(c, record.responses.length, [["Understood", "barGreen"], ["Partial", "barAmber"], ["Not Understood", "barRed"], ["Not Asked", "barGray"]])}<h3>Needs Follow-up</h3><div class="followList">${gaps.length ? gaps.map(r => `<button class="followItem textBtn" data-gap="${esc(r.qid)}"><b>${esc(topicFor(qById(r.qid)))}</b> — ${esc(r.result)}</button>`).join("") : `<div class="muted">No follow-up gaps recorded.</div>`}</div>`; document.querySelectorAll("[data-gap]").forEach(b => b.onclick = () => showQuestionDetails(qById(b.dataset.gap))); }

// Manual bank and templates
function openManualBank() { state.mode = "manual"; state.bankOrigin = "flow"; state.bankSelected = []; $("bankSearch").value = ""; $("bankChapter").value = ""; renderBank(); show("bankScreen"); }
function renderBank() { const search = ($("bankSearch").value || "").toLowerCase(), chapter = $("bankChapter").value || ""; const pool = master.questions.filter(q => eligible(q, state.unit, state.role) && activeOrConditional(q, state.unit) && (!chapter || q.chapter === chapter) && (!search || `${q.question} ${q.chapter} ${topicFor(q)}`.toLowerCase().includes(search))); $("bankHeading").textContent = `${unitName(state.unit)} — Manual Bank`; $("bankCount").textContent = `${pool.length} questions`; $("selectedCount").textContent = `${state.bankSelected.length} selected`; $("bankList").innerHTML = pool.map(q => `<label class="bankRow"><input type="checkbox" data-qid="${esc(q.id)}" ${state.bankSelected.includes(q.id) ? "checked" : ""}><span class="bankQuestion"><b>${esc(topicFor(q))}</b><br>${esc(q.question)}</span><span class="micro">${esc(q.chapter)}</span></label>`).join(""); document.querySelectorAll("#bankList [data-qid]").forEach(input => input.onchange = () => { state.bankSelected = input.checked ? [...new Set([...state.bankSelected, input.dataset.qid])] : state.bankSelected.filter(x => x !== input.dataset.qid); $("selectedCount").textContent = `${state.bankSelected.length} selected`; }); }
function renderSelection() { $("selectionList").innerHTML = state.bankSelected.map((id, i) => { const q = qById(id); return `<div class="historyCard"><b>${i + 1}. ${esc(topicFor(q))}</b><div class="micro">${esc(q.chapter)} • ${esc(q.id)}</div><p>${esc(q.question)}</p></div>`; }).join(""); }
function manualToStaff() { if (!state.bankSelected.length) return alert("Select at least one question."); state.pendingStart = { kind: "manual" }; prepareStaffConfirm(); }
async function saveTemplateAndStart() { if (!state.bankSelected.length) return alert("Select at least one question."); const name = prompt("Session name"); if (!name?.trim()) return; await idbAdd("templates", { name: name.trim(), unit: state.unit, role: state.role, qids: [...state.bankSelected], created: now() }); toast("Saved Session created"); manualToStaff(); }
async function renderSavedList() { const templates = (await idbAll("templates")).filter(t => t.unit === state.unit && t.role === state.role); $("savedContext").textContent = `${unitName(state.unit)} • ${roleName(state.role)}`; $("savedList").innerHTML = templates.length ? templates.map(t => `<button class="savedCard choice" data-template="${t.id}"><span class="savedTitle">${esc(t.name)}</span><span class="savedMeta">${t.qids.length} questions</span></button>`).join("") : `<div class="notice">No Saved Sessions for this unit and role.</div>`; document.querySelectorAll("[data-template]").forEach(b => b.onclick = () => { const t = templates.find(x => String(x.id) === b.dataset.template); state.mode = "saved"; state.pendingStart = { kind: "template", template: t }; prepareStaffConfirm(); }); }

// Observation round
function displayArea(area) { return master.observation?.areaDisplayNames?.[area] || area; }
function areaCatalogue(unitId) { const map = new Map(); for (const item of master.observation.items.filter(x => x.unit === unitId && x.scopeStatus !== "HIDDEN")) for (const area of item.areas || []) { if (!map.has(area)) map.set(area, []); map.get(area).push(item.key); } const route = master.observation.areaRoute || []; return [...map.entries()].map(([key, keys]) => ({ key, name: displayArea(key), keys: [...new Set(keys)] })).sort((a, b) => { const ai = route.indexOf(a.key), bi = route.indexOf(b.key); return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.name.localeCompare(b.name); }); }
async function selectObservationUnit(unitId) { state.obsUnit = unitId; const saved = await idbGet("kv", "activeObservationRound"); if (saved?.value?.unit === unitId && saved.value.status === "IN_PROGRESS") state.obsRound = saved.value; else state.obsRound = { id: uid("ROUND"), unit: unitId, started: now(), status: "IN_PROGRESS", areas: {} }; await saveRound(); renderObservationAreas(); show("observationAreaScreen"); }
async function saveRound() { if (state.obsRound) await idbPut("kv", { key: "activeObservationRound", value: state.obsRound }); }
function areaState(key) { return state.obsRound.areas[key] || { status: "NOT_STARTED", reason: "", responses: {} }; }
function renderObservationAreas() { const areas = areaCatalogue(state.obsUnit); $("observationAreaHeading").textContent = `${unitName(state.obsUnit)} — Choose Area`; const done = areas.filter(a => ["COMPLETED", "SKIPPED"].includes(areaState(a.key).status)).length; $("observationRoundProgress").textContent = `${done} of ${areas.length} areas completed or skipped`; $("obsSourceGap").classList.toggle("hidden", !!areas.length); if (!areas.length) $("obsSourceGap").textContent = "No checklist yet."; $("observationAreaGrid").innerHTML = areas.map(area => { const a = areaState(area.key), label = a.status === "NOT_STARTED" ? "Not Started" : a.status === "IN_PROGRESS" ? "In Progress" : a.status === "COMPLETED" ? "Completed" : `Skipped: ${a.reason}`; return `<div class="areaCardWrap"><button class="areaCard" data-area="${esc(area.key)}"><b>${esc(area.name)}</b><span><span class="countBadge">${area.keys.length} Checks</span><span class="areaStatus">${esc(label)}</span></span></button>${a.status === "NOT_STARTED" ? `<button class="skipArea textBtn" data-skip="${esc(area.key)}">Skip Area</button>` : ""}</div>`; }).join(""); $("finishRoundWrap").classList.toggle("hidden", !areas.length); document.querySelectorAll("[data-area]").forEach(b => b.onclick = () => openObservationArea(b.dataset.area)); document.querySelectorAll("[data-skip]").forEach(b => b.onclick = () => chooseSkipReason(b.dataset.skip)); }
async function openObservationArea(areaKey) { state.obsArea = areaKey; const a = areaState(areaKey); if (a.status === "NOT_STARTED") a.status = "IN_PROGRESS"; state.obsRound.areas[areaKey] = a; await saveRound(); renderObservationRun(); show("observationRunScreen"); }
function chooseSkipReason(areaKey) { openModal("Skip Area", ["Not Available", "Closed", "No Patient / No Activity", "Not Visited"].map(r => `<button class="choice skipReason" data-reason="${esc(r)}">${esc(r)}</button>`).join(""), true); document.querySelectorAll(".skipReason").forEach(b => b.onclick = async () => { state.obsRound.areas[areaKey] = { status: "SKIPPED", reason: b.dataset.reason, responses: {} }; await saveRound(); closeModal(); renderObservationAreas(); }); }
function observationChecks(areaKey) { const area = areaCatalogue(state.obsUnit).find(a => a.key === areaKey); return (area?.keys || []).map(obsByKey).filter(Boolean); }
function renderObservationRun(openKey = null) { const checks = observationChecks(state.obsArea), area = areaState(state.obsArea), completed = checks.filter(x => area.responses[x.key]?.result).length; $("observationRunTitle").textContent = displayArea(state.obsArea); $("observationRunContext").textContent = `${unitName(state.obsUnit)} • ${displayArea(state.obsArea)}`; $("observationProgress").textContent = `${completed} of ${checks.length} completed`; $("observationProgressFill").style.width = `${checks.length ? completed / checks.length * 100 : 0}%`; $("observationCheckList").innerHTML = checks.map((item, index) => { const response = area.responses[item.key] || {}, result = response.result || "Not assessed"; return `<article class="accordion ${openKey === item.key ? "open" : ""}" data-key="${esc(item.key)}"><button class="accordionHeader"><span class="accordionNumber">${index + 1}</span><span><span class="accordionTitle">${esc(item.section || "Observation Check")}</span><span class="accordionMeta">${esc(item.itemId)} • ${esc(item.standards || "")}</span></span><span class="statusBadge ${resultClass(result)}">${esc(result)}</span></button><div class="accordionBody"><div class="questionFull">${esc(item.check)}</div><div class="resultButtons">${observationResults.map(r => `<button class="${resultClass(r)} ${response.result === r ? "active" : ""}" data-result="${esc(r)}">${esc(r)}</button>`).join("")}</div><label>Finding / Note (optional)</label><textarea data-note placeholder="Add finding">${esc(response.note || "")}</textarea><div class="detailActions"><button data-details>Details</button></div></div></article>`; }).join(""); document.querySelectorAll("#observationCheckList .accordion").forEach(card => { const key = card.dataset.key; card.querySelector(".accordionHeader").onclick = () => card.classList.toggle("open"); card.querySelectorAll("[data-result]").forEach(button => button.onclick = async () => { area.responses[key] = { ...(area.responses[key] || {}), result: button.dataset.result }; await saveRound(); renderObservationRun(key); }); card.querySelector("[data-note]").oninput = event => { clearTimeout(noteTimer); area.responses[key] = { ...(area.responses[key] || {}), note: event.target.value }; noteTimer = setTimeout(saveRound, 250); }; card.querySelector("[data-details]").onclick = () => showObservationDetails(obsByKey(key)); }); }
function showObservationDetails(item) { const refs = (item.jciRefs || []).map(r => `<div class="sourceBlock"><b>${esc(r.standard)} ${esc(r.me)}</b><p>${esc(r.standardStatement || "")}</p><p>${esc(r.meText || "")}</p></div>`).join(""); openModal("Observation Details", `<div class="sourceBlock"><b>How to Check</b><p>${esc(item.howToCheck || "")}</p></div><div class="sourceBlock"><b>Evidence / Ask Who</b><p>${esc(item.evidenceAskWho || "")}</p></div>${refs || `<div class="sourceBlock"><b>JCI Standard / ME</b><p>${esc(item.standards || "")} • ${esc(item.mes || "")}</p></div>`}<div class="sourceBlock"><b>Local Expected Evidence</b><p>${esc(item.localExpectedEvidence || "Pending Verification")}</p></div><div class="sourceBlock"><b>Local Policy</b><p>${esc(item.localPolicy || "Pending Verification")}</p><p class="micro">Source: ${esc(item.policySource || "Not linked")} • Status: ${esc(item.policyVerificationStatus || "PENDING_VERIFICATION")}</p></div>`, true); }
async function completeArea() { const area = areaState(state.obsArea); area.status = "COMPLETED"; area.completed = now(); state.obsRound.areas[state.obsArea] = area; await saveRound(); const responses = Object.values(area.responses), c = countsFor(responses, observationResults); $("areaCompleteSummary").innerHTML = `<div class="contextLine">${esc(unitName(state.obsUnit))} • ${esc(displayArea(state.obsArea))}</div><div class="summaryCards"><div class="summaryCard"><b>${c.Compliant}</b><span>Compliant</span></div><div class="summaryCard"><b>${c.Partial}</b><span>Partial</span></div><div class="summaryCard"><b>${c["Non-Compliant"]}</b><span>Non-Compliant</span></div><div class="summaryCard"><b>${c["N/A"]}</b><span>N/A</span></div></div>`; show("areaCompleteScreen"); }
function nextArea() { const areas = areaCatalogue(state.obsUnit), current = areas.findIndex(a => a.key === state.obsArea), next = [...areas.slice(current + 1), ...areas.slice(0, current)].find(a => !["COMPLETED", "SKIPPED"].includes(areaState(a.key).status)); if (next) openObservationArea(next.key); else finishRound(); }
async function finishRound() { const areas = areaCatalogue(state.obsUnit), record = JSON.parse(JSON.stringify(state.obsRound)); record.completed = now(); record.status = "COMPLETED"; await idbPut("rounds", record); await idbPut("kv", { key: "activeObservationRound", value: null }); state.obsRound = record; state.lastRound = record; renderRoundSummary(record, areas); show("observationSummaryScreen"); await renderResumeActions(); }
function flattenedRound(record) { const rows = []; for (const [areaKey, area] of Object.entries(record.areas || {})) for (const [key, response] of Object.entries(area.responses || {})) rows.push({ areaKey, key, ...response }); return rows; }
function renderRoundSummary(record, areas = areaCatalogue(record.unit)) { const rows = flattenedRound(record), c = countsFor(rows, observationResults), visited = areas.filter(a => record.areas?.[a.key]?.status === "COMPLETED"), skipped = areas.filter(a => record.areas?.[a.key]?.status === "SKIPPED"), remaining = areas.filter(a => !["COMPLETED", "SKIPPED"].includes(record.areas?.[a.key]?.status)), expectedChecks = visited.reduce((n, a) => n + a.keys.length, 0), assessed = rows.filter(r => r.result).length, notAssessed = Math.max(0, expectedChecks - assessed), findings = rows.filter(r => ["Partial", "Non-Compliant"].includes(r.result)); c["Not assessed"] = notAssessed; $("observationSummary").innerHTML = `<div class="contextLine">${esc(unitName(record.unit))} • ${esc(record.id)} • ${new Date(record.completed || record.started).toLocaleString()}</div><div class="summaryCards"><div class="summaryCard"><b>${visited.length}</b><span>Areas completed</span></div><div class="summaryCard"><b>${skipped.length}</b><span>Areas skipped</span></div><div class="summaryCard"><b>${remaining.length}</b><span>Areas remaining</span></div><div class="summaryCard"><b>${assessed}</b><span>Checks assessed</span></div></div>${stackedBar(c, expectedChecks, [["Compliant", "barGreen"], ["Partial", "barAmber"], ["Non-Compliant", "barRed"], ["N/A", "barGray"], ["Not assessed", "barGray"]])}${skipped.length ? `<h3>Skipped Areas</h3><div class="followList">${skipped.map(a => `<div class="followItem"><b>${esc(a.name)}</b> — ${esc(record.areas[a.key].reason)}</div>`).join("")}</div>` : ""}<h3>Findings Requiring Action</h3><div class="followList">${findings.length ? findings.map(r => { const item = obsByKey(r.key); return `<button class="followItem textBtn" data-finding="${esc(r.key)}"><b>${esc(displayArea(r.areaKey))}</b> — ${esc(item?.section || item?.itemId)} — ${esc(r.result)}</button>`; }).join("") : `<div class="muted">No action findings recorded.</div>`}</div>`; document.querySelectorAll("[data-finding]").forEach(b => b.onclick = () => showObservationDetails(obsByKey(b.dataset.finding))); }

// History, menu and data
async function renderHistory(tab = "interviews") { document.querySelectorAll("[data-historytab]").forEach(b => b.classList.toggle("selected", b.dataset.historytab === tab)); if (tab === "interviews") { const rows = (await idbAll("sessions")).sort((a, b) => String(b.date).localeCompare(String(a.date))); $("historyList").innerHTML = rows.length ? rows.map(s => `<div class="historyCard"><div class="historyTitle">${esc(unitName(s.unit))} • Staff ${esc(s.staffId)}</div><div class="historyMeta">${new Date(s.date).toLocaleString()} • ${esc(roleName(s.role))} • ${esc(s.sourceName)} • ${(s.responses || []).length} questions</div></div>`).join("") : `<div class="notice">No completed interviews yet.</div>`; } else { const rows = (await idbAll("rounds")).sort((a, b) => String(b.completed || b.started).localeCompare(String(a.completed || a.started))), legacy = await idbAll("observations"); $("historyList").innerHTML = rows.length || legacy.length ? rows.map(r => `<div class="historyCard"><div class="historyTitle">${esc(unitName(r.unit))} • Unit Round</div><div class="historyMeta">${new Date(r.completed || r.started).toLocaleString()} • ${Object.keys(r.areas || {}).length} areas</div></div>`).join("") + legacy.map(r => `<div class="historyCard"><div class="historyTitle">${esc(unitName(r.unit))} • ${esc(r.area || "Legacy Area")}</div><div class="historyMeta">Legacy observation • ${new Date(r.date).toLocaleString()}</div></div>`).join("") : `<div class="notice">No completed observation rounds yet.</div>`; } }
async function openData() { const sessions = await idbAll("sessions"), rounds = await idbAll("rounds"), templates = await idbAll("templates"), legacy = await idbAll("observations"); $("dataSummary").innerHTML = `<b>App</b>: v${APP_VERSION}<br><b>Database</b>: ${esc(master.databaseVersion)}<br><b>Questions</b>: ${master.questions.length}<br><b>Interview sessions</b>: ${sessions.length}<br><b>Observation rounds</b>: ${rounds.length + legacy.length}<br><b>Saved Sessions</b>: ${templates.length}<br><b>Policy verification</b>: ${esc(master.policyVerificationStatus || "Pending")}`; show("dataScreen"); }
async function exportBackup() { const payload = { app: "JCITracerLocalV06", exported: now(), masterInfo: { schemaVersion: master.schemaVersion, databaseVersion: master.databaseVersion }, reviews: await idbAll("reviews"), staff: await idbAll("staff"), sessions: await idbAll("sessions"), templates: await idbAll("templates"), observations: await idbAll("observations"), rounds: await idbAll("rounds"), activeInterview: (await idbGet("kv", "activeInterview"))?.value || null, activeObservationRound: (await idbGet("kv", "activeObservationRound"))?.value || null }; download(JSON.stringify(payload, null, 2), "application/json", `JCI_Tracer_Backup_${now().slice(0, 10)}.json`); }
async function restoreBackup(file) { const payload = JSON.parse(await file.text()); if (!["JCITracerLocalV03", "JCITracerLocalV04", "JCITracerLocalV05", "JCITracerLocalV06"].includes(payload.app)) throw new Error("invalid backup"); for (const store of ["reviews", "staff", "sessions", "templates", "observations", "rounds"]) await idbClear(store); for (const x of payload.reviews || []) await idbPut("reviews", x); for (const x of payload.staff || []) await idbPut("staff", x); for (const x of payload.sessions || []) { const y = { ...x }; delete y.id; await idbAdd("sessions", y); } for (const x of payload.templates || []) { const y = { ...x }; delete y.id; await idbAdd("templates", y); } for (const x of payload.observations || []) { const y = { ...x }; delete y.id; await idbAdd("observations", y); } for (const x of payload.rounds || []) await idbPut("rounds", x); await idbPut("kv", { key: "activeInterview", value: payload.activeInterview || null }); await idbPut("kv", { key: "activeObservationRound", value: payload.activeObservationRound || null }); toast("Backup restored"); await renderResumeActions(); }
async function exportInterviewCsv() { const rows = [["Date", "Unit", "Staff ID", "Role", "Session Type", "Question ID", "Chapter", "Question", "Result", "Note"]]; for (const s of await idbAll("sessions")) for (const r of s.responses || []) { const q = qById(r.qid); rows.push([s.date, unitName(s.unit), s.staffId, s.role, s.sourceName, r.qid, q?.chapter || "", q?.question || "", r.result || "", r.note || ""]); } csv(rows, "JCI_Interview_Results.csv"); }
async function exportObservationCsv() { const rows = [["Round ID", "Date", "Unit", "Area", "Check ID", "Observation Check", "Result", "Finding", "Standard", "ME"]]; for (const round of await idbAll("rounds")) for (const r of flattenedRound(round)) { const x = obsByKey(r.key); rows.push([round.id, round.completed || round.started, unitName(round.unit), displayArea(r.areaKey), x?.itemId || "", x?.check || "", r.result || "", r.note || "", x?.standards || "", x?.mes || ""]); } csv(rows, "JCI_Observation_Results.csv"); }
function csv(rows, filename) { download("\ufeff" + rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv;charset=utf-8", filename); }
function download(content, type, filename) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function openModal(title, body, html = false) { $("modalTitle").textContent = title; $("modalBody").innerHTML = html ? body : esc(body).replace(/\n/g, "<br>"); $("modal").classList.remove("hidden"); }
function closeModal() { $("modal").classList.add("hidden"); }

// Events
$("headerBack").onclick = () => history.back();
$("menuBtn").onclick = () => show("utilityScreen");
$("startInterview").onclick = () => { renderAllUnitGrids(); show("interviewUnitScreen"); };
$("startObservation").onclick = () => { renderAllUnitGrids(); show("observationUnitScreen"); };
document.querySelectorAll(".interviewRole").forEach(button => button.onclick = () => { state.role = button.dataset.role; openInterviewModes(); });
document.querySelectorAll(".interviewMode").forEach(button => button.onclick = () => chooseMode(button.dataset.mode));
$("openSavedFromFlow").onclick = async () => { await renderSavedList(); show("savedScreen"); };
$("openManualFromFlow").onclick = openManualBank;
$("builderContinue").onclick = async () => { state.requestedCount = Number($("builderCount").value); if (state.mode === "situation" && !state.tags.length) return alert("Choose a patient or situation."); if (state.mode === "chapter" && !state.chapters.length) return alert("Choose at least one chapter."); await prepareGeneratedStart(); };
$("changeQuestionCount").onclick = () => { openModal("Question Number", [5, 8, 12, 20].map(n => `<button class="choice countChoice" data-count="${n}">${n} Questions</button>`).join(""), true); document.querySelectorAll(".countChoice").forEach(b => b.onclick = () => { state.requestedCount = Number(b.dataset.count); closeModal(); prepareStaffConfirm(true); }); };
$("staffConfirmStart").onclick = () => guarded(startInterview);
$("finishInterview").onclick = () => guarded(finishInterview);
$("bankBack").onclick = () => show("moreInterviewScreen");
$("bankSearch").oninput = renderBank;
$("bankChapter").onchange = renderBank;
$("reviewSelection").onclick = () => { if (!state.bankSelected.length) return alert("Select at least one question."); renderSelection(); show("selectionScreen"); };
$("selectionBack").onclick = () => show("bankScreen");
$("startManual").onclick = manualToStaff;
$("saveAndStart").onclick = saveTemplateAndStart;
$("savedChange").onclick = () => show("moreInterviewScreen");
$("nextStaffSameSetup").onclick = () => { state.staffId = ""; state.session = []; state.responses = {}; prepareStaffConfirm(); };
$("sameStaffNewQuestions").onclick = () => { state.session = []; state.responses = {}; state.pendingStart = null; state.keepStaffNext = true; openInterviewModes(); };
$("sameUnitNewSetup").onclick = () => { state.role = null; $("interviewRoleHeading").textContent = `${unitName(state.unit)} — Choose Role`; show("interviewRoleScreen"); };
$("changeInterviewUnit").onclick = () => show("interviewUnitScreen");
$("reviewInterviewGaps").onclick = () => document.querySelector("[data-gap]")?.click();
$("obsChangeUnit").onclick = () => show("observationUnitScreen");
$("completeObservationArea").onclick = () => guarded(completeArea);
$("nextObservationArea").onclick = nextArea;
$("chooseObservationArea").onclick = () => { renderObservationAreas(); show("observationAreaScreen"); };
$("finishRoundFromArea").onclick = () => guarded(finishRound);
$("changeUnitFromArea").onclick = () => show("observationUnitScreen");
$("finishObservationRound").onclick = () => guarded(finishRound);
$("reviewObservationFindings").onclick = () => document.querySelector("[data-finding]")?.click();
$("continueObservationAreas").onclick = () => { state.obsRound.status = "IN_PROGRESS"; saveRound(); renderObservationAreas(); show("observationAreaScreen"); };
$("newRoundSameUnit").onclick = async () => { state.obsRound = { id: uid("ROUND"), unit: state.obsUnit, started: now(), status: "IN_PROGRESS", areas: {} }; await saveRound(); renderObservationAreas(); show("observationAreaScreen"); };
$("chooseAreaSameUnit").onclick = () => { renderObservationAreas(); show("observationAreaScreen"); };
$("changeObservationUnit").onclick = () => show("observationUnitScreen");
document.querySelectorAll("[data-home]").forEach(b => b.onclick = goHome);
$("menuHistory").onclick = async () => { await renderHistory(); show("historyScreen"); };
$("menuSaved").onclick = () => { alert("Choose an Interview unit and role, then More → Saved Session."); show("interviewUnitScreen"); };
$("menuBank").onclick = () => { alert("Choose an Interview unit and role, then More → Manual Bank."); show("interviewUnitScreen"); };
$("menuData").onclick = openData;
document.querySelectorAll("[data-historytab]").forEach(b => b.onclick = () => renderHistory(b.dataset.historytab));
$("exportBackupBtn").onclick = exportBackup;
$("importBackupBtn").onclick = () => $("backupFile").click();
$("replaceMasterBtn").onclick = () => $("dbFile").click();
$("exportInterviewCsv").onclick = exportInterviewCsv;
$("exportObservationCsv").onclick = exportObservationCsv;
$("importDbBtn").onclick = () => $("dbFile").click();
$("dbFile").onchange = async e => { try { if (e.target.files[0]) await importMaster(e.target.files[0]); } catch (_) { alert("Invalid v0.7 workflow database."); } e.target.value = ""; };
$("backupFile").onchange = async e => { try { if (e.target.files[0]) await restoreBackup(e.target.files[0]); } catch (_) { alert("Invalid backup file."); } e.target.value = ""; };
$("modalClose").onclick = closeModal;
$("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
window.addEventListener("popstate", goBack);
init();
