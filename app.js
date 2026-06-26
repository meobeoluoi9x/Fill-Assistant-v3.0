const KEY = "fill_assistant_v2_production";
const OLD_KEYS = [
  "fill_assistant_v2",
  "fill_assistant_v1",
  "fill_assistant_v1_edit_undo",
  "fill_assistant_v0"
];

let deferredPrompt = null;
let lastAction = null;
let editing = null;
let orderSummaryText = "";

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

function todayISO(){
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
}

function viDate(d=new Date()){
  return d.toLocaleDateString("vi-VN", {weekday:"long", day:"2-digit", month:"2-digit", year:"numeric"});
}

function unique(arr){ return [...new Set(arr)].filter(Boolean); }

function config(){
  return window.FILL_CONFIG || {products:{}, machines:[], slots:[], initialCabin:[]};
}

function normalizeState(s){
  s ||= {};
  s.fillLogs ||= [];
  s.nccLogs ||= [];
  s.adjustLogs ||= [];
  return s;
}

function loadState(){
  const saved = localStorage.getItem(KEY);
  if(saved) return normalizeState(JSON.parse(saved));

  for(const k of OLD_KEYS){
    const old = localStorage.getItem(k);
    if(old){
      const parsed = normalizeState(JSON.parse(old));
      localStorage.setItem(KEY, JSON.stringify(parsed));
      return parsed;
    }
  }

  const initial = normalizeState(window.FILL_STATE || {});
  localStorage.setItem(KEY, JSON.stringify(initial));
  return initial;
}

let state = loadState();

function saveState(){
  localStorage.setItem(KEY, JSON.stringify(state));
  renderAll();
}

function makeId(){
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function productInfo(product){
  const lower = String(product || "").toLowerCase();
  return (config().products || {})[product] || {pack: lower.includes("aqua") ? 28 : 24, minPacks: 1};
}

function unitName(product){
  return String(product || "").toLowerCase().includes("aqua") ? "chai" : "lon";
}

function packText(qty, product){
  const info = productInfo(product);
  const packs = Math.ceil(Number(qty || 0) / info.pack);
  return {packs, qty: packs * info.pack, unit: unitName(product), packSize: info.pack};
}

function suggestOrder(qty, product){
  const info = productInfo(product);
  const lower = String(product || "").toLowerCase();
  if(lower.includes("aqua")){
    return Number(qty || 0) >= 28 ? info.pack * 2 : info.pack * 3;
  }
  return Number(qty || 0) > 12 ? info.pack : info.pack * 2;
}

function currentCabin(){
  const map = {};
  const add = (machine, product, qty) => {
    if(!machine || !product) return;
    const k = `${machine}||${product}`;
    map[k] = (map[k] || 0) + Number(qty || 0);
  };

  (config().initialCabin || []).forEach(x => add(x.machine, x.product, x.qty));
  state.nccLogs.forEach(x => add(x.machine, x.product, x.qty));
  state.adjustLogs.forEach(x => add(x.machine, x.product, x.qty));
  state.fillLogs.forEach(x => add(x.machine, x.product, -x.qty));
  return map;
}

function displayCabin(){
  const raw = currentCabin();
  const out = {};
  Object.entries(raw).forEach(([k,v]) => out[k] = Math.max(0, Number(v || 0)));
  return out;
}

function negativeCabinItems(){
  return Object.entries(currentCabin())
    .filter(([k,v]) => Number(v || 0) < 0)
    .map(([k,v]) => {
      const [machine, product] = k.split("||");
      return {machine, product, raw: Number(v), shortage: Math.abs(Number(v))};
    });
}

function getCabinQty(machine, product){
  return Math.max(0, Number(currentCabin()[`${machine}||${product}`] || 0));
}

function getRecentFill(product, machine, days){
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return state.fillLogs
    .filter(x => x.product === product && x.machine === machine && new Date(x.date) >= cutoff)
    .reduce((s,x)=>s+Number(x.qty||0),0);
}

function setupTabs(){
  $$(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      $$(".tab").forEach(b=>b.classList.remove("active"));
      $$(".view").forEach(v=>v.classList.remove("active"));
      btn.classList.add("active");
      $("#" + btn.dataset.view).classList.add("active");
      window.scrollTo({top:0, behavior:"smooth"});
    });
  });
}

function fillSelects(){
  $$('input[type="date"]').forEach(i=>{ if(!i.value) i.value = todayISO(); });

  const machineNames = (config().machines || []).map(m=>m.name);
  const products = unique([
    ...Object.keys(config().products || {}),
    ...(config().slots || []).map(s=>s.product),
    ...(config().initialCabin || []).map(c=>c.product)
  ]).sort((a,b)=>a.localeCompare(b,"vi"));

  $$('select[name="machine"]').forEach(sel=>{
    sel.innerHTML = machineNames.map(m=>`<option>${m}</option>`).join("");
  });

  $$('#nccForm select[name="product"], #adjustForm select[name="product"], #stocktakeForm select[name="product"]').forEach(sel=>{
    sel.innerHTML = products.map(p=>`<option>${p}</option>`).join("");
  });

  const quickMachine = $("#quickMachine");
  if(quickMachine){
    quickMachine.innerHTML = machineNames.map(m=>`<option>${m}</option>`).join("");
    quickMachine.addEventListener("change", renderQuickFill);
  }

  updateSlotOptions();
}

function setupForms(){
  fillSelects();

  $('#fillForm select[name="machine"]').addEventListener("change", updateSlotOptions);
  $('#fillForm select[name="slot"]').addEventListener("change", updateProductFromSlot);

  $('#fillForm').addEventListener("submit", e=>{
    e.preventDefault();
    saveFillFromForm(e.target);
  });

  $('#nccForm').addEventListener("submit", e=>{
    e.preventDefault();
    saveNccFromForm(e.target);
  });

  $('#adjustForm').addEventListener("submit", e=>{
    e.preventDefault();
    saveAdjustFromForm(e.target);
  });

  $('#stocktakeForm').addEventListener("submit", e=>{
    e.preventDefault();
    const f = e.target;
    const machine = f.machine.value;
    const product = f.product.value;
    const actual = Number(f.actual.value);
    const current = getCabinQty(machine, product);
    const diff = actual - current;
    if(diff === 0){
      showToast("Không có chênh lệch.");
      return;
    }
    const item = {id: makeId(), date: f.date.value, machine, product, qty: diff, reason: "Kiểm kê"};
    state.adjustLogs.push(item);
    lastAction = {type:"deleteAdjust", index: state.adjustLogs.length - 1, item};
    f.actual.value = "";
    saveState();
    showToast(`Đã tạo điều chỉnh ${diff > 0 ? "+" : ""}${diff}.`, true);
  });

  $("#resetDemo").addEventListener("click", ()=>{
    if(confirm("Reset về dữ liệu gốc? Dữ liệu nhập trên thiết bị này sẽ bị xóa.")){
      state = normalizeState(window.FILL_STATE || {});
      saveState();
    }
  });

  $("#exportBtn").addEventListener("click", exportJSON);
  $("#importInput").addEventListener("change", importJSON);
  $("#copyOrderBtn").addEventListener("click", copyOrderSummary);
}

function updateSlotOptions(){
  const machine = $('#fillForm select[name="machine"]').value;
  const slots = (config().slots || [])
    .filter(s => s.machine === machine)
    .sort((a,b)=>Number(a.slot)-Number(b.slot));
  $('#fillForm select[name="slot"]').innerHTML = slots.map(s=>`<option value="${s.slot}">${s.slot}</option>`).join("");
  updateProductFromSlot();
}

function updateProductFromSlot(){
  const machine = $('#fillForm select[name="machine"]').value;
  const slot = Number($('#fillForm select[name="slot"]').value);
  const found = (config().slots || []).find(s => s.machine === machine && Number(s.slot) === slot);
  $('#fillForm input[name="product"]').value = found ? found.product : "";
}

function safeQtyWarning(qty, kind){
  if(qty >= 100){
    return confirm(`Bạn vừa nhập ${qty}. Số lượng khá lớn, có chắc không?`);
  }
  if(kind === "fill" && qty > 50){
    return confirm(`Bạn vừa fill ${qty}. Có chắc không?`);
  }
  return true;
}

function saveFillFromForm(f){
  const qty = Number(f.qty.value);
  if(!safeQtyWarning(qty, "fill")) return;
  const item = {
    id: editing?.type === "fill" ? editing.id : makeId(),
    date: f.date.value,
    machine: f.machine.value,
    slot: Number(f.slot.value),
    product: f.product.value,
    qty
  };

  if(editing?.type === "fill"){
    state.fillLogs[editing.index] = item;
    lastAction = {type:"editFill", index:editing.index, oldItem:editing.oldItem};
    editing = null;
    f.querySelector("button[type=submit]").textContent = "Lưu fill";
    showToast("Đã cập nhật Fill.", true);
  }else{
    state.fillLogs.push(item);
    showToast("Đã lưu Fill.");
  }
  f.qty.value = "";
  saveState();
}

function saveNccFromForm(f){
  const qty = Number(f.qty.value);
  if(!safeQtyWarning(qty, "ncc")) return;
  const item = {
    id: editing?.type === "ncc" ? editing.id : makeId(),
    date: f.date.value,
    machine: f.machine.value,
    product: f.product.value,
    qty
  };

  if(editing?.type === "ncc"){
    state.nccLogs[editing.index] = item;
    lastAction = {type:"editNcc", index:editing.index, oldItem:editing.oldItem};
    editing = null;
    f.querySelector("button[type=submit]").textContent = "Lưu NCC";
    showToast("Đã cập nhật NCC.", true);
  }else{
    state.nccLogs.push(item);
    showToast("Đã lưu NCC thực nhận.");
  }
  f.qty.value = "";
  saveState();
}

function saveAdjustFromForm(f){
  const item = {
    id: editing?.type === "adjust" ? editing.id : makeId(),
    date: f.date.value,
    machine: f.machine.value,
    product: f.product.value,
    qty: Number(f.qty.value),
    reason: f.reason.value
  };

  if(editing?.type === "adjust"){
    state.adjustLogs[editing.index] = item;
    lastAction = {type:"editAdjust", index:editing.index, oldItem:editing.oldItem};
    editing = null;
    f.querySelector("button[type=submit]").textContent = "Lưu điều chỉnh";
    showToast("Đã cập nhật điều chỉnh.", true);
  }else{
    state.adjustLogs.push(item);
    showToast("Đã lưu điều chỉnh.");
  }
  f.qty.value = "";
  saveState();
}

function setupQuickPads(){
  document.querySelectorAll(".quickPad").forEach(pad=>{
    const target = pad.dataset.target;
    pad.innerHTML = [1,2,5,10,12,24,28]
      .map(n=>`<button type="button" class="quickBtn" data-val="${n}">+${n}</button>`)
      .join("") + `<button type="button" class="quickBtn clear" data-clear="1">Xóa</button>`;

    pad.addEventListener("click", e=>{
      const btn = e.target.closest("button");
      if(!btn) return;
      const input = document.querySelector(`#${target} input[name="qty"]`);
      if(btn.dataset.clear) input.value = "";
      else input.value = Number(input.value || 0) + Number(btn.dataset.val);
      input.focus();
    });
  });

  document.querySelectorAll(".adjustPad").forEach(pad=>{
    const target = pad.dataset.target;
    pad.innerHTML = `
      <div class="padTitle">Thiếu</div>
      ${[1,2,5,10,12,24,28].map(n=>`<button type="button" class="quickBtn danger" data-val="-${n}">-${n}</button>`).join("")}
      <div class="padTitle">Dư</div>
      ${[1,2,5,10,12,24,28].map(n=>`<button type="button" class="quickBtn" data-val="${n}">+${n}</button>`).join("")}
      <button type="button" class="quickBtn clear" data-clear="1">Xóa</button>
    `;

    pad.addEventListener("click", e=>{
      const btn = e.target.closest("button");
      if(!btn) return;
      const input = document.querySelector(`#${target} input[name="qty"]`);
      if(btn.dataset.clear) input.value = "";
      else input.value = Number(input.value || 0) + Number(btn.dataset.val);
      input.focus();
    });
  });
}

function showToast(message, undoable=false){
  let toast = document.getElementById("toast");
  if(!toast){
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.innerHTML = `${message}${undoable ? ' <button id="undoBtn">Hoàn tác</button>' : ''}`;
  toast.className = "show";
  if(undoable) document.getElementById("undoBtn").onclick = undoLastAction;
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(()=>toast.className="", 5000);
}

function undoLastAction(){
  if(!lastAction) return;
  if(lastAction.type === "deleteFill") state.fillLogs.splice(lastAction.index, 0, lastAction.item);
  if(lastAction.type === "deleteNcc") state.nccLogs.splice(lastAction.index, 0, lastAction.item);
  if(lastAction.type === "deleteAdjust") state.adjustLogs.splice(lastAction.index, 0, lastAction.item);
  if(lastAction.type === "editFill") state.fillLogs[lastAction.index] = lastAction.oldItem;
  if(lastAction.type === "editNcc") state.nccLogs[lastAction.index] = lastAction.oldItem;
  if(lastAction.type === "editAdjust") state.adjustLogs[lastAction.index] = lastAction.oldItem;
  lastAction = null;
  saveState();
  showToast("Đã hoàn tác.");
}

function editFill(id){
  const idx = state.fillLogs.findIndex(x=>x.id===id);
  if(idx < 0) return;
  const item = state.fillLogs[idx];
  editing = {type:"fill", id, index:idx, oldItem:{...item}};
  const f = $("#fillForm");
  f.date.value = item.date;
  f.machine.value = item.machine;
  updateSlotOptions();
  f.slot.value = String(item.slot);
  updateProductFromSlot();
  f.qty.value = item.qty;
  f.querySelector("button[type=submit]").textContent = "Cập nhật fill";
  $('[data-view="fill"]').click();
}

function deleteFill(id){
  const idx = state.fillLogs.findIndex(x=>x.id===id);
  if(idx < 0) return;
  const item = state.fillLogs[idx];
  if(!confirm(`Xóa Fill ${item.machine} - ${item.product} - ${item.qty}?`)) return;
  state.fillLogs.splice(idx,1);
  lastAction = {type:"deleteFill", index:idx, item};
  saveState();
  showToast("Đã xóa Fill.", true);
}

function editNcc(id){
  const idx = state.nccLogs.findIndex(x=>x.id===id);
  if(idx < 0) return;
  const item = state.nccLogs[idx];
  editing = {type:"ncc", id, index:idx, oldItem:{...item}};
  const f = $("#nccForm");
  f.date.value = item.date;
  f.machine.value = item.machine;
  f.product.value = item.product;
  f.qty.value = item.qty;
  f.querySelector("button[type=submit]").textContent = "Cập nhật NCC";
  $('[data-view="ncc"]').click();
}

function deleteNcc(id){
  const idx = state.nccLogs.findIndex(x=>x.id===id);
  if(idx < 0) return;
  const item = state.nccLogs[idx];
  if(!confirm(`Xóa NCC ${item.machine} - ${item.product} - ${item.qty}?`)) return;
  state.nccLogs.splice(idx,1);
  lastAction = {type:"deleteNcc", index:idx, item};
  saveState();
  showToast("Đã xóa NCC.", true);
}

function editAdjust(id){
  const idx = state.adjustLogs.findIndex(x=>x.id===id);
  if(idx < 0) return;
  const item = state.adjustLogs[idx];
  editing = {type:"adjust", id, index:idx, oldItem:{...item}};
  const f = $("#adjustForm");
  f.date.value = item.date;
  f.machine.value = item.machine;
  f.product.value = item.product;
  f.qty.value = item.qty;
  f.reason.value = item.reason || "Đếm lại";
  f.querySelector("button[type=submit]").textContent = "Cập nhật điều chỉnh";
  $('[data-view="adjust"]').click();
}

function deleteAdjust(id){
  const idx = state.adjustLogs.findIndex(x=>x.id===id);
  if(idx < 0) return;
  const item = state.adjustLogs[idx];
  if(!confirm(`Xóa điều chỉnh ${item.machine} - ${item.product} - ${item.qty}?`)) return;
  state.adjustLogs.splice(idx,1);
  lastAction = {type:"deleteAdjust", index:idx, item};
  saveState();
  showToast("Đã xóa điều chỉnh.", true);
}

function renderRoute(){
  $("#todayText").textContent = viDate();
  const day = new Date().getDay();
  const isB = day === 6;
  const machines = isB ? ["Trong Ga","Ngoài Ga","Ga Giáp Bát"] : ["D3","D8","D9","Thư Viện"];
  $("#routeBadge").textContent = isB ? "Tuyến B" : "Tuyến A";
  $("#routeMachines").innerHTML = machines.map(m=>`<span class="chip">${m}</span>`).join("");
}

function buildOrderRows(){
  const cab = displayCabin();
  const rows = [];
  Object.entries(cab).forEach(([k, qty])=>{
    const [machine, product] = k.split("||");
    const order = suggestOrder(qty, product);
    if(order > 0){
      rows.push({machine, product, qty, order, pack: packText(order, product)});
    }
  });
  rows.sort((a,b)=>a.machine.localeCompare(b.machine,"vi") || a.product.localeCompare(b.product,"vi"));
  return rows;
}

function renderSummary(){
  const cab = displayCabin();
  const negatives = negativeCabinItems().length;
  let low = 0;
  Object.values(cab).forEach(q=>{ if(Number(q) <= 12) low++; });
  const rows = buildOrderRows();
  $("#summaryBox").innerHTML = [
    ["Cabin cần chú ý", low],
    ["Gợi ý NCC", rows.length],
    ["Lỗi dữ liệu", negatives],
    ["Fill đã ghi", state.fillLogs.length],
    ["NCC đã ghi", state.nccLogs.length],
    ["Điều chỉnh", state.adjustLogs.length]
  ].map(([t,v])=>`<div class="summaryCard"><span>${t}</span><b>${v}</b></div>`).join("");
}

function renderOrders(){
  const rows = buildOrderRows();
  $("#orderBox").innerHTML = rows.length ? rows.map(r=>{
    const level = r.pack.packs >= 3 ? "red" : r.pack.packs === 2 ? "orange" : "yellow";
    return `
      <div class="pill ${level} orderCard">
        <div>
          <b>${r.machine} - ${r.product}</b>
          <small>Tồn cabin: ${r.qty} ${unitName(r.product)}</small>
        </div>
        <div class="orderQty">
          <span>${"📦".repeat(Math.min(r.pack.packs,4))}</span>
          <strong>${r.pack.packs} thùng</strong>
          <small>${r.pack.qty} ${r.pack.unit}</small>
        </div>
      </div>
    `;
  }).join("") : `<p class="muted">Chưa có sản phẩm nào cần đặt theo ngưỡng hiện tại.</p>`;

  const summary = {};
  rows.forEach(r=>{
    summary[r.product] ||= {packs:0, qty:0, unit:unitName(r.product)};
    summary[r.product].packs += r.pack.packs;
    summary[r.product].qty += r.pack.qty;
  });

  const items = Object.entries(summary).sort((a,b)=>a[0].localeCompare(b[0],"vi"));
  orderSummaryText = items.map(([p,s])=>`${p}: ${s.packs} thùng (${s.qty} ${s.unit})`).join("\n");
  $("#orderSummaryBox").innerHTML = items.length ? `
    <div class="orderSummaryList">
      ${items.map(([p,s])=>`
        <div class="summaryLine">
          <span>${p}</span>
          <b>${s.packs} thùng</b>
          <small>${s.qty} ${s.unit}</small>
        </div>
      `).join("")}
    </div>
  ` : `<p class="muted">Chưa có đơn NCC cần tổng hợp.</p>`;
}

function copyOrderSummary(){
  if(!orderSummaryText){
    showToast("Chưa có đơn NCC để copy.");
    return;
  }
  const text = `Đơn NCC hôm nay:\n${orderSummaryText}`;
  if(navigator.clipboard){
    navigator.clipboard.writeText(text).then(()=>showToast("Đã copy đơn NCC."));
  }else{
    showToast(text);
  }
}

function renderSlow(){
  const pairs = unique((config().slots || []).map(s=>`${s.machine}||${s.product}`));
  $("#slowBox").innerHTML = pairs.map(k=>{
    const [machine, product] = k.split("||");
    const total30 = getRecentFill(product, machine, 30);
    const count = state.fillLogs.filter(x=>x.machine===machine && x.product===product).length;
    let cls = "blue", status = `Đang học (${count}/5 lần fill)`;
    if(count >= 5 && total30 <= 5){ cls = "yellow"; status = "Bán chậm 30 ngày"; }
    if(count >= 5 && total30 > 30){ cls = "green"; status = "Bán tốt"; }
    return `<div class="pill ${cls}"><b>${machine} - ${product}</b><div class="small">${status} | Fill 30 ngày: ${total30}</div></div>`;
  }).join("") || `<p class="muted">Chưa có dữ liệu slot.</p>`;
}

function renderCabin(){
  const cab = displayCabin();
  const grouped = {};
  Object.entries(cab).forEach(([k, qty])=>{
    const [machine, product] = k.split("||");
    grouped[machine] ||= [];
    grouped[machine].push({product, qty});
  });

  $("#cabinBox").innerHTML = Object.keys(grouped).sort((a,b)=>a.localeCompare(b,"vi")).map(machine=>`
    <div class="machineTitle">${machine}</div>
    ${grouped[machine].sort((a,b)=>a.product.localeCompare(b.product,"vi")).map(x=>{
      const raw = currentCabin()[`${machine}||${x.product}`] || 0;
      const cls = raw < 0 ? "red" : x.qty < 12 ? "red" : x.qty < productInfo(x.product).pack ? "yellow" : "green";
      const warn = raw < 0 ? `<br><span class="small warnText">⚠ Lệch ${Math.abs(raw)} ${unitName(x.product)}</span>` : "";
      return `<div class="row qtyRow ${cls}"><span>${x.product}${warn}</span><b class="qtyNum">${x.qty}</b></div>`;
    }).join("")}
  `).join("");
}

function renderHistory(){
  const recent = arr => [...arr].reverse().slice(0,40);

  $("#fillHistory").innerHTML = recent(state.fillLogs).map(x=>`
    <div class="row">
      <span>${x.date}<br><span class="small">${x.machine} - Slot ${x.slot} - ${x.product}</span></span>
      <b>${x.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editFill('${x.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteFill('${x.id}')">Xóa</button>
      </span>
    </div>
  `).join("") || `<p class="muted">Chưa có dữ liệu Fill.</p>`;

  $("#nccHistory").innerHTML = recent(state.nccLogs).map(x=>`
    <div class="row">
      <span>${x.date}<br><span class="small">${x.machine} - ${x.product}</span></span>
      <b>${x.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editNcc('${x.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteNcc('${x.id}')">Xóa</button>
      </span>
    </div>
  `).join("") || `<p class="muted">Chưa có dữ liệu NCC.</p>`;

  $("#adjustHistory").innerHTML = recent(state.adjustLogs).map(x=>`
    <div class="row">
      <span>${x.date}<br><span class="small">${x.machine} - ${x.product} - ${x.reason || ""}</span></span>
      <b>${x.qty > 0 ? "+" + x.qty : x.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editAdjust('${x.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteAdjust('${x.id}')">Xóa</button>
      </span>
    </div>
  `).join("") || `<p class="muted">Chưa có dữ liệu điều chỉnh.</p>`;
}

function renderAudit(){
  const negatives = negativeCabinItems();
  $("#auditBox").innerHTML = negatives.length ? negatives.map(x=>`
    <div class="pill red">
      <b>${x.machine} - ${x.product}</b>
      <div class="small">Tồn tính toán: ${x.raw} | Hiển thị: 0 | Lệch: ${x.shortage}</div>
      <button class="mini" onclick="quickFixNegative('${x.machine}','${x.product}',${x.shortage})">Tạo điều chỉnh +${x.shortage}</button>
    </div>
  `).join("") : `<div class="pill green"><b>Dữ liệu ổn</b><div class="small">Không có cabin nào bị âm.</div></div>`;
}

function quickFixNegative(machine, product, qty){
  if(!confirm(`Tạo điều chỉnh +${qty} cho ${machine} - ${product}?`)) return;
  const item = {id: makeId(), date: todayISO(), machine, product, qty: Number(qty), reason: "Sửa cabin âm"};
  state.adjustLogs.push(item);
  lastAction = {type:"deleteAdjust", index:state.adjustLogs.length - 1, item};
  saveState();
  showToast("Đã tạo điều chỉnh.", true);
}

function renderQuickFill(){
  const machine = $("#quickMachine").value;
  const slots = (config().slots || [])
    .filter(s=>s.machine === machine)
    .sort((a,b)=>Number(a.slot)-Number(b.slot));

  $("#quickFillBox").innerHTML = slots.map(s=>`
    <div class="slotCard" data-machine="${s.machine}" data-slot="${s.slot}" data-product="${s.product}">
      <div class="slotHead">
        <div><b>Slot ${s.slot}</b><br><span>${s.product}</span></div>
        <span>Max ${s.max || ""}</span>
      </div>
      <div class="slotControls">
        <input type="number" min="0" step="1" inputmode="numeric" placeholder="Đã fill" />
        <div class="slotActions">
          ${[1,2,5,10,12,24,28].map(n=>`<button type="button" data-val="${n}">+${n}</button>`).join("")}
          <button type="button" data-clear="1">Xóa</button>
          <button type="button" class="save">Lưu Slot ${s.slot}</button>
        </div>
      </div>
    </div>
  `).join("") || `<p class="muted">Máy này chưa có slot.</p>`;

  $$(".slotCard").forEach(card=>{
    const input = $("input", card);
    card.addEventListener("click", e=>{
      const btn = e.target.closest("button");
      if(!btn) return;
      if(btn.dataset.clear) input.value = "";
      else if(btn.dataset.val) input.value = Number(input.value || 0) + Number(btn.dataset.val);
      else if(btn.classList.contains("save")){
        const qty = Number(input.value || 0);
        if(qty <= 0){
          showToast("Chưa nhập số lượng fill.");
          return;
        }
        if(!safeQtyWarning(qty, "fill")) return;
        state.fillLogs.push({
          id: makeId(),
          date: todayISO(),
          machine: card.dataset.machine,
          slot: Number(card.dataset.slot),
          product: card.dataset.product,
          qty
        });
        input.value = "";
        saveState();
        showToast(`Đã lưu ${card.dataset.machine} - Slot ${card.dataset.slot}: ${qty}`);
      }
    });
  });
}

function renderAll(){
  renderRoute();
  renderSummary();
  renderOrders();
  renderSlow();
  renderCabin();
  renderHistory();
  renderAudit();
  renderQuickFill();
}

function exportJSON(){
  const blob = new Blob([JSON.stringify({version:"2.0", config: config(), state}, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fill-assistant-backup-${todayISO()}.json`;
  a.click();
}

function importJSON(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const data = JSON.parse(reader.result);
      if(data.state){
        state = normalizeState(data.state);
        saveState();
        showToast("Đã nhập dữ liệu.");
      }else{
        showToast("File không đúng định dạng.");
      }
    }catch(err){
      showToast("Không đọc được JSON.");
    }
  };
  reader.readAsText(file);
}

window.addEventListener("beforeinstallprompt", e=>{
  e.preventDefault();
  deferredPrompt = e;
  $("#installBtn").classList.remove("hidden");
});

$("#installBtn")?.addEventListener("click", async()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  $("#installBtn").classList.add("hidden");
});

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js");
}

setupTabs();
setupForms();
setupQuickPads();
renderAll();
