const KEY = "fill_assistant_v0";
let deferredPrompt = null;

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

function todayISO(){
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
}

function loadState(){
  const saved = localStorage.getItem(KEY);
  if(saved) return JSON.parse(saved);
  return window.FILL_INITIAL_STATE || { fillLogs: [], nccLogs: [] };
}
function saveState(){ localStorage.setItem(KEY, JSON.stringify(state)); renderAll(); }
let state = loadState();
state.fillLogs ||= [];
state.nccLogs ||= [];
state.adjustLogs ||= [];

function unique(arr){ return [...new Set(arr)].filter(Boolean); }
function config(){ return window.FILL_CONFIG; }

function productInfo(product){
  return config().products[product] || { pack: 24, minPacks: 1 };
}

function currentCabin(){
  const map = {};
  const add = (machine, product, qty) => {
    const k = `${machine}||${product}`;
    map[k] = (map[k] || 0) + Number(qty || 0);
  };
  config().initialCabin.forEach(x => add(x.machine, x.product, x.qty));
  state.nccLogs.forEach(x => add(x.machine, x.product, x.qty));
  state.adjustLogs.forEach(x => add(x.machine, x.product, x.qty));
  state.fillLogs.forEach(x => add(x.machine, x.product, -x.qty));
  return map;
}

function displayCabin(){
  const raw = currentCabin();
  const display = {};
  Object.entries(raw).forEach(([k,v]) => display[k] = Math.max(0, Number(v || 0)));
  return display;
}

function negativeCabinItems(){
  const raw = currentCabin();
  return Object.entries(raw)
    .filter(([k,v]) => Number(v || 0) < 0)
    .map(([k,v]) => {
      const [machine, product] = k.split("||");
      return {machine, product, raw: Number(v), shortage: Math.abs(Number(v))};
    });
}

function getCabinQty(machine, product){
  const raw = currentCabin()[`${machine}||${product}`] || 0;
  return Math.max(0, Number(raw));
}


function getRecentFill(product, machine, days){
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return state.fillLogs
    .filter(x => x.product === product && x.machine === machine && new Date(x.date) >= cutoff)
    .reduce((s,x)=>s+Number(x.qty||0),0);
}

function suggestOrder(qty, product){
  const info = productInfo(product);
  const name = String(product || "").toLowerCase();

  // Quy tắc đã chốt:
  // - Sản phẩm thường: tồn cabin > 12 đặt 1 quy cách, <= 12 đặt 2 quy cách.
  // - Aqua/Aquafina: tồn cabin >= 28 đặt 2 quy cách, < 28 đặt 3 quy cách.
  // Lưu ý: đây là số lượng gợi ý đặt NCC, không tự cộng vào tồn cabin.
  if(name.includes("aqua")){
    return qty >= 28 ? info.pack * 2 : info.pack * 3;
  }
  return qty > 12 ? info.pack : info.pack * 2;
}

function setupForms(){
  const machineNames = config().machines.map(m=>m.name);
  const products = unique([
    ...Object.keys(config().products),
    ...config().slots.map(s=>s.product),
    ...config().initialCabin.map(c=>c.product)
  ]);

  $$('input[type="date"]').forEach(i => { if(!i.value) i.value = todayISO(); });

  $$('select[name="machine"]').forEach(sel => {
    sel.innerHTML = machineNames.map(m=>`<option>${m}</option>`).join("");
  });

  const nccProduct = $('#nccForm select[name="product"]');
  nccProduct.innerHTML = products.map(p=>`<option>${p}</option>`).join("");

  const adjustProduct = $('#adjustForm select[name="product"]');
  if(adjustProduct) adjustProduct.innerHTML = products.map(p=>`<option>${p}</option>`).join("");

  const stocktakeProduct = $('#stocktakeForm select[name="product"]');
  if(stocktakeProduct) stocktakeProduct.innerHTML = products.map(p=>`<option>${p}</option>`).join("");

  updateSlotOptions();
  $('#fillForm select[name="machine"]').addEventListener("change", updateSlotOptions);
  $('#fillForm select[name="slot"]').addEventListener("change", updateProductFromSlot);

  $('#fillForm').addEventListener("submit", e=>{
    e.preventDefault();
    const f = e.target;
    const newItem = {
      id: editing && editing.type === "fill" ? editing.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      date: f.date.value,
      machine: f.machine.value,
      slot: Number(f.slot.value),
      product: f.product.value,
      qty: Number(f.qty.value)
    };
    if(editing && editing.type === "fill"){
      state.fillLogs[editing.index] = newItem;
      lastAction = {type:"editFill", index: editing.index, oldItem: editing.oldItem};
      editing = null;
      f.querySelector('button[type="submit"]').textContent = "Lưu fill";
      showToast("Đã cập nhật Fill.", true);
    }else{
      state.fillLogs.push(newItem);
      showToast("Đã lưu Fill.");
    }
    f.qty.value = "";
    saveState();
  });

  $('#nccForm').addEventListener("submit", e=>{
    e.preventDefault();
    const f = e.target;
    const newItem = {
      id: editing && editing.type === "ncc" ? editing.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      date: f.date.value,
      machine: f.machine.value,
      product: f.product.value,
      qty: Number(f.qty.value)
    };
    if(editing && editing.type === "ncc"){
      state.nccLogs[editing.index] = newItem;
      lastAction = {type:"editNcc", index: editing.index, oldItem: editing.oldItem};
      editing = null;
      f.querySelector('button[type="submit"]').textContent = "Lưu NCC";
      showToast("Đã cập nhật NCC.", true);
    }else{
      state.nccLogs.push(newItem);
      showToast("Đã lưu NCC thực nhận.");
    }
    f.qty.value = "";
    saveState();
  });

  $('#adjustForm')?.addEventListener("submit", e=>{
    e.preventDefault();
    const f = e.target;
    const newItem = {
      id: editing && editing.type === "adjust" ? editing.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      date: f.date.value,
      machine: f.machine.value,
      product: f.product.value,
      qty: Number(f.qty.value),
      reason: f.reason.value
    };
    if(editing && editing.type === "adjust"){
      state.adjustLogs[editing.index] = newItem;
      lastAction = {type:"editAdjust", index: editing.index, oldItem: editing.oldItem};
      editing = null;
      f.querySelector('button[type="submit"]').textContent = "Lưu điều chỉnh";
      showToast("Đã cập nhật điều chỉnh.", true);
    }else{
      state.adjustLogs.push(newItem);
      showToast("Đã lưu điều chỉnh cabin.");
    }
    f.qty.value = "";
    saveState();
  });

  $('#stocktakeForm')?.addEventListener("submit", e=>{
    e.preventDefault();
    const f = e.target;
    const machine = f.machine.value;
    const product = f.product.value;
    const actual = Number(f.actual.value);
    const current = getCabinQty(machine, product);
    const diff = actual - current;
    if(diff === 0){
      showToast("Không có chênh lệch. Không cần điều chỉnh.");
      return;
    }
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      date: f.date.value,
      machine,
      product,
      qty: diff,
      reason: "Kiểm kê"
    };
    state.adjustLogs.push(item);
    lastAction = {type:"deleteAdjust", index: state.adjustLogs.length - 1, item};
    f.actual.value = "";
    saveState();
    showToast(`Đã tạo điều chỉnh ${diff > 0 ? "+" : ""}${diff} cho ${machine} - ${product}.`, true);
  });

  $('#resetDemo').addEventListener("click", ()=>{
    if(confirm("Xóa toàn bộ dữ liệu fill/NCC đã nhập trên thiết bị này?")){
      state = { fillLogs: [], nccLogs: [], adjustLogs: [] };
      saveState();
    }
  });

  $('#exportBtn').addEventListener("click", exportJSON);
  $('#importInput').addEventListener("change", importJSON);
}

function updateSlotOptions(){
  const machine = $('#fillForm select[name="machine"]').value;
  const slots = config().slots.filter(s=>s.machine===machine);
  $('#fillForm select[name="slot"]').innerHTML = slots.map(s=>`<option value="${s.slot}">${s.slot}</option>`).join("");
  updateProductFromSlot();
}
function updateProductFromSlot(){
  const machine = $('#fillForm select[name="machine"]').value;
  const slot = Number($('#fillForm select[name="slot"]').value);
  const found = config().slots.find(s=>s.machine===machine && s.slot===slot);
  $('#fillForm input[name="product"]').value = found ? found.product : "";
}

function renderToday(){
  const day = new Date().getDay(); // 0 CN
  const route = day === 0 ? "Nghỉ / kiểm tra nhẹ" : (day === 6 ? "B - Trong Ga / Ngoài Ga / Ga Giáp Bát" : "A - D3 / D8 / D9 / Thư Viện");
  const machines = day === 6
    ? ["Trong Ga","Ngoài Ga","Ga Giáp Bát"]
    : ["D3","D8","D9","Thư Viện"];
  $('#routeBox').innerHTML = `
    <p class="muted">Tuyến gợi ý theo lịch làm việc</p>
    <div class="big">${route}</div>
    <div class="grid">${machines.map(m=>`<div class="pill green"><b>${m}</b><span class="small">Theo tuyến</span></div>`).join("")}</div>
  `;
}

function renderOrders(){
  const cab = displayCabin();
  let rows = [];
  Object.entries(cab).forEach(([k, qty])=>{
    const [machine, product] = k.split("||");
    const order = suggestOrder(qty, product);
    if(order > 0){
      rows.push({machine, product, qty, order});
    }
  });
  rows.sort((a,b)=>b.order-a.order);
  $('#orderBox').innerHTML = rows.length ? rows.map(r=>`
    <div class="pill red">
      <b>${r.machine} - ${r.product}</b>
      <div>Tồn cabin: ${r.qty} | Gợi ý NCC: ${r.order} lon/chai</div>
    </div>
  `).join("") : `<p class="muted">Chưa có sản phẩm nào cần đặt theo ngưỡng hiện tại.</p>`;
}

function renderSlow(){
  const pairs = unique(config().slots.map(s=>`${s.machine}||${s.product}`));
  let html = pairs.map(k=>{
    const [machine, product] = k.split("||");
    const total30 = getRecentFill(product, machine, 30);
    const count = state.fillLogs.filter(x=>x.machine===machine && x.product===product).length;
    let cls = "blue", status = `Đang học (${count}/5 lần fill)`;
    if(count >= 5 && total30 <= 5){ cls="yellow"; status = "Bán chậm 30 ngày"; }
    if(count >= 5 && total30 > 30){ cls="green"; status = "Bán tốt"; }
    return `<div class="pill ${cls}"><b>${machine} - ${product}</b><div>${status} | Fill 30 ngày: ${total30}</div></div>`;
  }).join("");
  $('#slowBox').innerHTML = html;
}

function renderCabin(){
  const cab = displayCabin();
  let grouped = {};
  Object.entries(cab).forEach(([k, qty])=>{
    const [machine, product] = k.split("||");
    grouped[machine] ||= [];
    grouped[machine].push({product, qty});
  });
  $('#cabinBox').innerHTML = Object.keys(grouped).sort().map(machine=>`
    <div class="machineTitle">${machine}</div>
    ${grouped[machine].sort((a,b)=>a.product.localeCompare(b.product,'vi')).map(x=>{
      const raw = currentCabin()[`${machine}||${x.product}`] || 0;
      const cls = raw < 0 ? "red" : x.qty < 12 ? "red" : x.qty < productInfo(x.product).pack ? "yellow" : "green";
      const warn = raw < 0 ? `<br><span class="small">⚠ Lệch ${Math.abs(raw)} lon/chai</span>` : "";
      return `<div class="row ${cls}"><span>${x.product}${warn}</span><b>${x.qty}</b></div>`;
    }).join("")}
  `).join("");
}


let lastAction = null;
let editing = null;

function showToast(message, undoable=false){
  let toast = document.getElementById("toast");
  if(!toast){
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.innerHTML = `${message}${undoable ? ' <button id="undoBtn">Hoàn tác</button>' : ''}`;
  toast.className = "show";
  if(undoable){
    document.getElementById("undoBtn").onclick = undoLastAction;
  }
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(()=>toast.className="", 5000);
}

function undoLastAction(){
  if(!lastAction) return;
  if(lastAction.type === "deleteFill"){
    state.fillLogs.splice(lastAction.index, 0, lastAction.item);
  }
  if(lastAction.type === "deleteNcc"){
    state.nccLogs.splice(lastAction.index, 0, lastAction.item);
  }
  if(lastAction.type === "editFill"){
    state.fillLogs[lastAction.index] = lastAction.oldItem;
  }
  if(lastAction.type === "editNcc"){
    state.nccLogs[lastAction.index] = lastAction.oldItem;
  }
  if(lastAction.type === "deleteAdjust"){
    state.adjustLogs.splice(lastAction.index, 0, lastAction.item);
  }
  if(lastAction.type === "editAdjust"){
    state.adjustLogs[lastAction.index] = lastAction.oldItem;
  }
  lastAction = null;
  saveState();
  showToast("Đã hoàn tác.");
}

function findLogIndex(type, id){
  const arr = type === "fill" ? state.fillLogs : state.nccLogs;
  return arr.findIndex(x => x.id === id);
}

function editFill(id){
  const idx = findLogIndex("fill", id);
  if(idx < 0) return;
  const item = state.fillLogs[idx];
  editing = {type:"fill", id, index:idx, oldItem:{...item}};
  const f = document.getElementById("fillForm");
  f.date.value = item.date;
  f.machine.value = item.machine;
  updateSlotOptions();
  f.slot.value = String(item.slot);
  updateProductFromSlot();
  f.qty.value = item.qty;
  const btn = f.querySelector('button[type="submit"]');
  btn.textContent = "Cập nhật fill";
  document.querySelector('[data-view="fill"]').click();
  showToast("Đang sửa dòng Fill. Bấm Cập nhật để lưu.");
}

function deleteFill(id){
  const idx = findLogIndex("fill", id);
  if(idx < 0) return;
  const item = state.fillLogs[idx];
  if(!confirm(`Xóa dòng Fill ${item.machine} - ${item.product} - ${item.qty}?`)) return;
  state.fillLogs.splice(idx,1);
  lastAction = {type:"deleteFill", index:idx, item};
  saveState();
  showToast("Đã xóa dòng Fill.", true);
}

function editNcc(id){
  const idx = findLogIndex("ncc", id);
  if(idx < 0) return;
  const item = state.nccLogs[idx];
  editing = {type:"ncc", id, index:idx, oldItem:{...item}};
  const f = document.getElementById("nccForm");
  f.date.value = item.date;
  f.machine.value = item.machine;
  f.product.value = item.product;
  f.qty.value = item.qty;
  const btn = f.querySelector('button[type="submit"]');
  btn.textContent = "Cập nhật NCC";
  document.querySelector('[data-view="ncc"]').click();
  showToast("Đang sửa dòng NCC. Bấm Cập nhật để lưu.");
}

function deleteNcc(id){
  const idx = findLogIndex("ncc", id);
  if(idx < 0) return;
  const item = state.nccLogs[idx];
  if(!confirm(`Xóa dòng NCC ${item.machine} - ${item.product} - ${item.qty}?`)) return;
  state.nccLogs.splice(idx,1);
  lastAction = {type:"deleteNcc", index:idx, item};
  saveState();
  showToast("Đã xóa dòng NCC.", true);
}


function editAdjust(id){
  const idx = state.adjustLogs.findIndex(x => x.id === id);
  if(idx < 0) return;
  const item = state.adjustLogs[idx];
  editing = {type:"adjust", id, index:idx, oldItem:{...item}};
  const f = document.getElementById("adjustForm");
  f.date.value = item.date;
  f.machine.value = item.machine;
  f.product.value = item.product;
  f.qty.value = item.qty;
  f.reason.value = item.reason || "Đếm lại";
  const btn = f.querySelector('button[type="submit"]');
  btn.textContent = "Cập nhật điều chỉnh";
  document.querySelector('[data-view="adjust"]').click();
  showToast("Đang sửa dòng Điều chỉnh. Bấm Cập nhật để lưu.");
}

function deleteAdjust(id){
  const idx = state.adjustLogs.findIndex(x => x.id === id);
  if(idx < 0) return;
  const item = state.adjustLogs[idx];
  if(!confirm(`Xóa điều chỉnh ${item.machine} - ${item.product} - ${item.qty}?`)) return;
  state.adjustLogs.splice(idx,1);
  lastAction = {type:"deleteAdjust", index:idx, item};
  saveState();
  showToast("Đã xóa dòng Điều chỉnh.", true);
}

function renderHistory(){
  const f = [...state.fillLogs].reverse().slice(0,20);
  $('#fillHistory').innerHTML = f.length ? f.map(x=>`
    <div class="row logrow">
      <span>${x.date}<br><span class="small">${x.machine} - Slot ${x.slot} - ${x.product}</span></span>
      <b>${x.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editFill('${x.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteFill('${x.id}')">Xóa</button>
      </span>
    </div>
  `).join("") : `<p class="muted">Chưa có dữ liệu fill.</p>`;

  const n = [...state.nccLogs].reverse().slice(0,20);
  $('#nccHistory').innerHTML = n.length ? n.map(x=>`
    <div class="row logrow">
      <span>${x.date}<br><span class="small">${x.machine} - ${x.product}</span></span>
      <b>${x.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editNcc('${x.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteNcc('${x.id}')">Xóa</button>
      </span>
    </div>
  `).join("") : `<p class="muted">Chưa có dữ liệu NCC.</p>`;

  const a = [...state.adjustLogs].reverse().slice(0,20);
  const box = document.getElementById("adjustHistory");
  if(box){
    box.innerHTML = a.length ? a.map(x=>`
      <div class="row logrow">
        <span>${x.date}<br><span class="small">${x.machine} - ${x.product} - ${x.reason || ""}</span></span>
        <b>${x.qty > 0 ? "+" + x.qty : x.qty}</b>
        <span class="actions">
          <button class="mini" onclick="editAdjust('${x.id}')">Sửa</button>
          <button class="mini danger" onclick="deleteAdjust('${x.id}')">Xóa</button>
        </span>
      </div>
    `).join("") : `<p class="muted">Chưa có dữ liệu điều chỉnh.</p>`;
  }
}


function renderAudit(){
  const box = document.getElementById("auditBox");
  if(!box) return;
  const negatives = negativeCabinItems();
  if(!negatives.length){
    box.innerHTML = `<div class="pill green"><b>Dữ liệu ổn</b><div>Không có cabin nào bị âm.</div></div>`;
    return;
  }
  box.innerHTML = negatives.map(x=>`
    <div class="pill red">
      <b>${x.machine} - ${x.product}</b>
      <div>Tồn tính toán: ${x.raw} | Đang hiển thị: 0 | Lệch: ${x.shortage}</div>
      <button class="mini" onclick="quickFixNegative('${x.machine}','${x.product}',${x.shortage})">Tạo điều chỉnh +${x.shortage}</button>
    </div>
  `).join("");
}

function quickFixNegative(machine, product, qty){
  if(!confirm(`Tạo điều chỉnh +${qty} cho ${machine} - ${product}?`)) return;
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    date: todayISO(),
    machine,
    product,
    qty: Number(qty),
    reason: "Sửa cabin âm"
  };
  state.adjustLogs.push(item);
  lastAction = {type:"deleteAdjust", index: state.adjustLogs.length - 1, item};
  saveState();
  showToast(`Đã tạo điều chỉnh +${qty}.`, true);
}

function renderAll(){
  renderToday();
  renderOrders();
  renderSlow();
  renderCabin();
  renderHistory();
  renderAudit();
}

function exportJSON(){
  const blob = new Blob([JSON.stringify({config: config(), state}, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fill-assistant-backup-${todayISO()}.json`;
  a.click();
}
function importJSON(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(data.state){
        state = data.state;
        saveState();
        alert("Đã nhập dữ liệu.");
      }else{
        alert("File không đúng định dạng.");
      }
    }catch(err){ alert("Không đọc được file JSON."); }
  };
  reader.readAsText(file);
}

function setupTabs(){
  $$('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.tab').forEach(b=>b.classList.remove('active'));
      $$('.view').forEach(v=>v.classList.remove('active'));
      btn.classList.add('active');
      $('#' + btn.dataset.view).classList.add('active');
    });
  });
}

window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault();
  deferredPrompt = e;
  $('#installBtn').classList.remove('hidden');
});
$('#installBtn')?.addEventListener('click', async ()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  $('#installBtn').classList.add('hidden');
});

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js");
}

setupTabs();
setupForms();
renderAll();
