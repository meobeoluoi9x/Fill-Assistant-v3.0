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
  return { fillLogs: [], nccLogs: [] };
}
function saveState(){ localStorage.setItem(KEY, JSON.stringify(state)); renderAll(); }
let state = loadState();

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
  state.fillLogs.forEach(x => add(x.machine, x.product, -x.qty));
  return map;
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
  const target = info.pack * info.minPacks;
  if(product.toLowerCase().includes("aqua")){
    if(qty < target) return target - qty;
    return 0;
  }
  if(qty < 12) return info.pack;
  if(qty >= 12 && qty < target) return info.pack * 2;
  return 0;
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

  updateSlotOptions();
  $('#fillForm select[name="machine"]').addEventListener("change", updateSlotOptions);
  $('#fillForm select[name="slot"]').addEventListener("change", updateProductFromSlot);

  $('#fillForm').addEventListener("submit", e=>{
    e.preventDefault();
    const f = e.target;
    state.fillLogs.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      date: f.date.value,
      machine: f.machine.value,
      slot: Number(f.slot.value),
      product: f.product.value,
      qty: Number(f.qty.value)
    });
    f.qty.value = "";
    saveState();
    alert("Đã lưu fill.");
  });

  $('#nccForm').addEventListener("submit", e=>{
    e.preventDefault();
    const f = e.target;
    state.nccLogs.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      date: f.date.value,
      machine: f.machine.value,
      product: f.product.value,
      qty: Number(f.qty.value)
    });
    f.qty.value = "";
    saveState();
    alert("Đã lưu NCC thực nhận.");
  });

  $('#resetDemo').addEventListener("click", ()=>{
    if(confirm("Xóa toàn bộ dữ liệu fill/NCC đã nhập trên thiết bị này?")){
      state = { fillLogs: [], nccLogs: [] };
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
  const cab = currentCabin();
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
  const cab = currentCabin();
  let grouped = {};
  Object.entries(cab).forEach(([k, qty])=>{
    const [machine, product] = k.split("||");
    grouped[machine] ||= [];
    grouped[machine].push({product, qty});
  });
  $('#cabinBox').innerHTML = Object.keys(grouped).sort().map(machine=>`
    <div class="machineTitle">${machine}</div>
    ${grouped[machine].sort((a,b)=>a.product.localeCompare(b.product,'vi')).map(x=>{
      const cls = x.qty < 12 ? "red" : x.qty < productInfo(x.product).pack ? "yellow" : "green";
      return `<div class="row ${cls}"><span>${x.product}</span><b>${x.qty}</b></div>`;
    }).join("")}
  `).join("");
}

function renderHistory(){
  const f = [...state.fillLogs].reverse().slice(0,20);
  $('#fillHistory').innerHTML = f.length ? f.map(x=>`
    <div class="row"><span>${x.date}<br><span class="small">${x.machine} - Slot ${x.slot} - ${x.product}</span></span><b>${x.qty}</b></div>
  `).join("") : `<p class="muted">Chưa có dữ liệu fill.</p>`;

  const n = [...state.nccLogs].reverse().slice(0,20);
  $('#nccHistory').innerHTML = n.length ? n.map(x=>`
    <div class="row"><span>${x.date}<br><span class="small">${x.machine} - ${x.product}</span></span><b>${x.qty}</b></div>
  `).join("") : `<p class="muted">Chưa có dữ liệu NCC.</p>`;
}

function renderAll(){
  renderToday();
  renderOrders();
  renderSlow();
  renderCabin();
  renderHistory();
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
