const APP_VERSION = "2.1.0";
const STORAGE_KEY = "fill_assistant_v21";
const OLD_KEYS = ["fill_assistant_v2_production","fill_assistant_v2","fill_assistant_v1","fill_assistant_v1_edit_undo","fill_assistant_v0"];

let deferredPrompt = null;
let lastAction = null;
let editing = null;
let orderSummaryText = "";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function viDate(d = new Date()) {
  return d.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

function config() {
  return window.FILL_CONFIG || { products: {}, machines: [], slots: [], initialCabin: [] };
}

function unique(list) {
  return [...new Set(list)].filter(Boolean);
}

function normalizeState(state) {
  state ||= {};
  state.fillLogs ||= [];
  state.nccLogs ||= [];
  state.adjustLogs ||= [];
  return state;
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return normalizeState(JSON.parse(saved));

  for (const key of OLD_KEYS) {
    const old = localStorage.getItem(key);
    if (old) {
      const migrated = normalizeState(JSON.parse(old));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  }

  const initial = normalizeState(window.FILL_STATE || {});
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function productInfo(product) {
  const lower = String(product || "").toLowerCase();
  return config().products?.[product] || { pack: lower.includes("aqua") ? 28 : 24, minPacks: 1 };
}

function unitName(product) {
  return String(product || "").toLowerCase().includes("aqua") ? "chai" : "lon";
}

function packText(qty, product) {
  const info = productInfo(product);
  const packs = Math.ceil(Number(qty || 0) / info.pack);
  return { packs, qty: packs * info.pack, unit: unitName(product), packSize: info.pack };
}

function suggestOrder(qty, product) {
  const info = productInfo(product);
  const lower = String(product || "").toLowerCase();

  if (lower.includes("aqua")) {
    return Number(qty || 0) >= 28 ? info.pack * 2 : info.pack * 3;
  }
  return Number(qty || 0) > 12 ? info.pack : info.pack * 2;
}

function currentCabin() {
  const map = {};
  const add = (machine, product, qty) => {
    if (!machine || !product) return;
    const key = `${machine}||${product}`;
    map[key] = (map[key] || 0) + Number(qty || 0);
  };

  config().initialCabin?.forEach(x => add(x.machine, x.product, x.qty));
  state.nccLogs.forEach(x => add(x.machine, x.product, x.qty));
  state.adjustLogs.forEach(x => add(x.machine, x.product, x.qty));
  state.fillLogs.forEach(x => add(x.machine, x.product, -x.qty));
  return map;
}

function displayCabin() {
  const raw = currentCabin();
  const result = {};
  Object.entries(raw).forEach(([key, value]) => {
    result[key] = Math.max(0, Number(value || 0));
  });
  return result;
}

function negativeCabinItems() {
  return Object.entries(currentCabin())
    .filter(([, value]) => Number(value || 0) < 0)
    .map(([key, value]) => {
      const [machine, product] = key.split("||");
      return { machine, product, raw: Number(value), shortage: Math.abs(Number(value)) };
    });
}

function getCabinQty(machine, product) {
  return Math.max(0, Number(currentCabin()[`${machine}||${product}`] || 0));
}

function getRecentFill(product, machine, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return state.fillLogs
    .filter(log => log.product === product && log.machine === machine && new Date(log.date) >= cutoff)
    .reduce((sum, log) => sum + Number(log.qty || 0), 0);
}

function setupTabs() {
  $$(".tab").forEach(button => {
    button.addEventListener("click", () => {
      $$(".tab").forEach(tab => tab.classList.remove("active"));
      $$(".view").forEach(view => view.classList.remove("active"));
      button.classList.add("active");
      $("#" + button.dataset.view).classList.add("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function setupSelects() {
  $$('input[type="date"]').forEach(input => { if (!input.value) input.value = todayISO(); });

  const machines = config().machines.map(machine => machine.name);
  const products = unique([
    ...Object.keys(config().products || {}),
    ...config().slots.map(slot => slot.product),
    ...config().initialCabin.map(item => item.product)
  ]).sort((a, b) => a.localeCompare(b, "vi"));

  $$('select[name="machine"]').forEach(select => {
    select.innerHTML = machines.map(machine => `<option>${machine}</option>`).join("");
  });

  $$("#nccForm select[name='product'], #adjustForm select[name='product'], #stocktakeForm select[name='product']").forEach(select => {
    select.innerHTML = products.map(product => `<option>${product}</option>`).join("");
  });

  const quickMachine = $("#quickMachine");
  quickMachine.innerHTML = machines.map(machine => `<option>${machine}</option>`).join("");
  quickMachine.addEventListener("change", renderQuickFill);

  updateSlotOptions();
}

function setupForms() {
  setupSelects();

  $("#fillForm select[name='machine']").addEventListener("change", updateSlotOptions);
  $("#fillForm select[name='slot']").addEventListener("change", updateProductFromSlot);

  $("#fillForm").addEventListener("submit", event => {
    event.preventDefault();
    saveFillFromForm(event.target);
  });

  $("#nccForm").addEventListener("submit", event => {
    event.preventDefault();
    saveNccFromForm(event.target);
  });

  $("#adjustForm").addEventListener("submit", event => {
    event.preventDefault();
    saveAdjustFromForm(event.target);
  });

  $("#stocktakeForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.target;
    const machine = form.machine.value;
    const product = form.product.value;
    const actual = Number(form.actual.value);
    const current = getCabinQty(machine, product);
    const diff = actual - current;

    if (diff === 0) {
      showToast("Không có chênh lệch.");
      return;
    }

    const item = { id: makeId(), date: form.date.value, machine, product, qty: diff, reason: "Kiểm kê" };
    state.adjustLogs.push(item);
    lastAction = { type: "deleteAdjust", index: state.adjustLogs.length - 1, item };
    form.actual.value = "";
    saveState();
    showToast(`Đã tạo điều chỉnh ${diff > 0 ? "+" : ""}${diff}.`, true);
  });

  $("#resetBtn").addEventListener("click", () => {
    if (confirm("Reset về dữ liệu gốc? Dữ liệu nhập trên thiết bị này sẽ bị xóa.")) {
      state = normalizeState(window.FILL_STATE || {});
      saveState();
    }
  });

  $("#exportBtn").addEventListener("click", exportJSON);
  $("#importInput").addEventListener("change", importJSON);
  $("#copyOrderBtn").addEventListener("click", copyOrderSummary);
}

function updateSlotOptions() {
  const machine = $("#fillForm select[name='machine']").value;
  const slots = config().slots
    .filter(slot => slot.machine === machine)
    .sort((a, b) => Number(a.slot) - Number(b.slot));

  $("#fillForm select[name='slot']").innerHTML = slots
    .map(slot => `<option value="${slot.slot}">${slot.slot}</option>`)
    .join("");

  updateProductFromSlot();
}

function updateProductFromSlot() {
  const machine = $("#fillForm select[name='machine']").value;
  const slot = Number($("#fillForm select[name='slot']").value);
  const found = config().slots.find(item => item.machine === machine && Number(item.slot) === slot);
  $("#fillForm input[name='product']").value = found ? found.product : "";
}

function confirmLargeQty(qty, kind) {
  if (qty >= 100) return confirm(`Bạn vừa nhập ${qty}. Số lượng khá lớn, có chắc không?`);
  if (kind === "fill" && qty > 50) return confirm(`Bạn vừa fill ${qty}. Có chắc không?`);
  return true;
}

function saveFillFromForm(form) {
  const qty = Number(form.qty.value);
  if (!confirmLargeQty(qty, "fill")) return;

  const item = {
    id: editing?.type === "fill" ? editing.id : makeId(),
    date: form.date.value,
    machine: form.machine.value,
    slot: Number(form.slot.value),
    product: form.product.value,
    qty
  };

  if (editing?.type === "fill") {
    state.fillLogs[editing.index] = item;
    lastAction = { type: "editFill", index: editing.index, oldItem: editing.oldItem };
    editing = null;
    form.querySelector("button[type='submit']").textContent = "Lưu fill";
    showToast("Đã cập nhật Fill.", true);
  } else {
    state.fillLogs.push(item);
    showToast("Đã lưu Fill.");
  }

  form.qty.value = "";
  saveState();
}

function saveNccFromForm(form) {
  const qty = Number(form.qty.value);
  if (!confirmLargeQty(qty, "ncc")) return;

  const item = {
    id: editing?.type === "ncc" ? editing.id : makeId(),
    date: form.date.value,
    machine: form.machine.value,
    product: form.product.value,
    qty
  };

  if (editing?.type === "ncc") {
    state.nccLogs[editing.index] = item;
    lastAction = { type: "editNcc", index: editing.index, oldItem: editing.oldItem };
    editing = null;
    form.querySelector("button[type='submit']").textContent = "Lưu NCC";
    showToast("Đã cập nhật NCC.", true);
  } else {
    state.nccLogs.push(item);
    showToast("Đã lưu NCC thực nhận.");
  }

  form.qty.value = "";
  saveState();
}

function saveAdjustFromForm(form) {
  const item = {
    id: editing?.type === "adjust" ? editing.id : makeId(),
    date: form.date.value,
    machine: form.machine.value,
    product: form.product.value,
    qty: Number(form.qty.value),
    reason: form.reason.value
  };

  if (editing?.type === "adjust") {
    state.adjustLogs[editing.index] = item;
    lastAction = { type: "editAdjust", index: editing.index, oldItem: editing.oldItem };
    editing = null;
    form.querySelector("button[type='submit']").textContent = "Lưu điều chỉnh";
    showToast("Đã cập nhật điều chỉnh.", true);
  } else {
    state.adjustLogs.push(item);
    showToast("Đã lưu điều chỉnh.");
  }

  form.qty.value = "";
  saveState();
}

function setupQuickPads() {
  document.querySelectorAll(".quickPad").forEach(pad => {
    const target = pad.dataset.target;
    pad.innerHTML = [1,2,5,10,12,24,28]
      .map(n => `<button type="button" class="quick-btn" data-val="${n}">+${n}</button>`)
      .join("") + `<button type="button" class="quick-btn clear" data-clear="1">Xóa</button>`;

    pad.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      const input = document.querySelector(`#${target} input[name='qty']`);
      if (button.dataset.clear) input.value = "";
      else input.value = Number(input.value || 0) + Number(button.dataset.val);
      input.focus();
    });
  });

  document.querySelectorAll(".adjustPad").forEach(pad => {
    const target = pad.dataset.target;
    pad.innerHTML = `
      <div class="pad-title">Thiếu</div>
      ${[1,2,5,10,12,24,28].map(n => `<button type="button" class="quick-btn danger" data-val="-${n}">-${n}</button>`).join("")}
      <div class="pad-title">Dư</div>
      ${[1,2,5,10,12,24,28].map(n => `<button type="button" class="quick-btn" data-val="${n}">+${n}</button>`).join("")}
      <button type="button" class="quick-btn clear" data-clear="1">Xóa</button>
    `;

    pad.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      const input = document.querySelector(`#${target} input[name='qty']`);
      if (button.dataset.clear) input.value = "";
      else input.value = Number(input.value || 0) + Number(button.dataset.val);
      input.focus();
    });
  });
}

function showToast(message, undoable = false) {
  let toast = $("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }

  toast.innerHTML = `${message}${undoable ? ' <button id="undoBtn">Hoàn tác</button>' : ""}`;
  toast.className = "show";

  if (undoable) $("#undoBtn").onclick = undoLastAction;

  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.className = "", 5000);
}

function undoLastAction() {
  if (!lastAction) return;

  if (lastAction.type === "deleteFill") state.fillLogs.splice(lastAction.index, 0, lastAction.item);
  if (lastAction.type === "deleteNcc") state.nccLogs.splice(lastAction.index, 0, lastAction.item);
  if (lastAction.type === "deleteAdjust") state.adjustLogs.splice(lastAction.index, 0, lastAction.item);
  if (lastAction.type === "editFill") state.fillLogs[lastAction.index] = lastAction.oldItem;
  if (lastAction.type === "editNcc") state.nccLogs[lastAction.index] = lastAction.oldItem;
  if (lastAction.type === "editAdjust") state.adjustLogs[lastAction.index] = lastAction.oldItem;

  lastAction = null;
  saveState();
  showToast("Đã hoàn tác.");
}

function editFill(id) {
  const index = state.fillLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.fillLogs[index];
  editing = { type: "fill", id, index, oldItem: { ...item } };

  const form = $("#fillForm");
  form.date.value = item.date;
  form.machine.value = item.machine;
  updateSlotOptions();
  form.slot.value = String(item.slot);
  updateProductFromSlot();
  form.qty.value = item.qty;
  form.querySelector("button[type='submit']").textContent = "Cập nhật fill";
  $('[data-view="fill"]').click();
}

function deleteFill(id) {
  const index = state.fillLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.fillLogs[index];
  if (!confirm(`Xóa Fill ${item.machine} - ${item.product} - ${item.qty}?`)) return;

  state.fillLogs.splice(index, 1);
  lastAction = { type: "deleteFill", index, item };
  saveState();
  showToast("Đã xóa Fill.", true);
}

function editNcc(id) {
  const index = state.nccLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.nccLogs[index];
  editing = { type: "ncc", id, index, oldItem: { ...item } };

  const form = $("#nccForm");
  form.date.value = item.date;
  form.machine.value = item.machine;
  form.product.value = item.product;
  form.qty.value = item.qty;
  form.querySelector("button[type='submit']").textContent = "Cập nhật NCC";
  $('[data-view="ncc"]').click();
}

function deleteNcc(id) {
  const index = state.nccLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.nccLogs[index];
  if (!confirm(`Xóa NCC ${item.machine} - ${item.product} - ${item.qty}?`)) return;

  state.nccLogs.splice(index, 1);
  lastAction = { type: "deleteNcc", index, item };
  saveState();
  showToast("Đã xóa NCC.", true);
}

function editAdjust(id) {
  const index = state.adjustLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.adjustLogs[index];
  editing = { type: "adjust", id, index, oldItem: { ...item } };

  const form = $("#adjustForm");
  form.date.value = item.date;
  form.machine.value = item.machine;
  form.product.value = item.product;
  form.qty.value = item.qty;
  form.reason.value = item.reason || "Đếm lại";
  form.querySelector("button[type='submit']").textContent = "Cập nhật điều chỉnh";
  $('[data-view="adjust"]').click();
}

function deleteAdjust(id) {
  const index = state.adjustLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.adjustLogs[index];
  if (!confirm(`Xóa điều chỉnh ${item.machine} - ${item.product} - ${item.qty}?`)) return;

  state.adjustLogs.splice(index, 1);
  lastAction = { type: "deleteAdjust", index, item };
  saveState();
  showToast("Đã xóa điều chỉnh.", true);
}

function buildOrderRows() {
  const cab = displayCabin();
  const rows = [];

  Object.entries(cab).forEach(([key, qty]) => {
    const [machine, product] = key.split("||");
    const order = suggestOrder(qty, product);
    if (order > 0) rows.push({ machine, product, qty, order, pack: packText(order, product) });
  });

  rows.sort((a, b) => a.machine.localeCompare(b.machine, "vi") || a.product.localeCompare(b.product, "vi"));
  return rows;
}

function renderRoute() {
  $("#todayText").textContent = viDate();

  const day = new Date().getDay();
  const isB = day === 6;
  const machines = isB ? ["Trong Ga", "Ngoài Ga", "Ga Giáp Bát"] : ["D3", "D8", "D9", "Thư Viện"];

  $("#routeBadge").textContent = isB ? "Tuyến B" : "Tuyến A";
  $("#routeMachines").innerHTML = machines.map(machine => `<span class="chip">${machine}</span>`).join("");
}

function renderSummary() {
  const cab = displayCabin();
  const negatives = negativeCabinItems().length;
  const orders = buildOrderRows();

  let low = 0;
  Object.values(cab).forEach(qty => { if (Number(qty) <= 12) low++; });

  $("#summaryBox").innerHTML = [
    ["Cabin cần chú ý", low],
    ["Gợi ý NCC", orders.length],
    ["Lỗi dữ liệu", negatives],
    ["Fill đã ghi", state.fillLogs.length],
    ["NCC đã ghi", state.nccLogs.length],
    ["Điều chỉnh", state.adjustLogs.length]
  ].map(([label, value]) => `<div class="summary-card"><span>${label}</span><b>${value}</b></div>`).join("");
}

function renderOrders() {
  const rows = buildOrderRows();

  $("#orderBox").innerHTML = rows.length ? rows.map(row => {
    const level = row.pack.packs >= 3 ? "red" : row.pack.packs === 2 ? "orange" : "yellow";
    return `
      <div class="pill ${level} order-card">
        <div>
          <b>${row.machine} - ${row.product}</b>
          <small>Tồn cabin: ${row.qty} ${unitName(row.product)}</small>
        </div>
        <div class="order-qty">
          <span>${"📦".repeat(Math.min(row.pack.packs, 4))}</span>
          <strong>${row.pack.packs} thùng</strong>
          <small>${row.pack.qty} ${row.pack.unit}</small>
        </div>
      </div>
    `;
  }).join("") : `<p class="muted">Chưa có sản phẩm nào cần đặt theo ngưỡng hiện tại.</p>`;

  const summary = {};
  rows.forEach(row => {
    summary[row.product] ||= { packs: 0, qty: 0, unit: unitName(row.product) };
    summary[row.product].packs += row.pack.packs;
    summary[row.product].qty += row.pack.qty;
  });

  const items = Object.entries(summary).sort((a, b) => a[0].localeCompare(b[0], "vi"));
  orderSummaryText = items.map(([product, s]) => `${product}: ${s.packs} thùng (${s.qty} ${s.unit})`).join("\n");

  $("#orderSummaryBox").innerHTML = items.length ? `
    <div class="order-summary-list">
      ${items.map(([product, s]) => `
        <div class="summary-line">
          <span>${product}</span>
          <b>${s.packs} thùng</b>
          <small>${s.qty} ${s.unit}</small>
        </div>
      `).join("")}
    </div>
  ` : `<p class="muted">Chưa có đơn NCC cần tổng hợp.</p>`;
}

function copyOrderSummary() {
  if (!orderSummaryText) {
    showToast("Chưa có đơn NCC để copy.");
    return;
  }

  const text = `Đơn NCC hôm nay:\n${orderSummaryText}`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast("Đã copy đơn NCC."));
  } else {
    showToast(text);
  }
}

function renderSlow() {
  const pairs = unique(config().slots.map(slot => `${slot.machine}||${slot.product}`));

  $("#slowBox").innerHTML = pairs.map(key => {
    const [machine, product] = key.split("||");
    const total30 = getRecentFill(product, machine, 30);
    const count = state.fillLogs.filter(log => log.machine === machine && log.product === product).length;

    let cls = "blue";
    let status = `Đang học (${count}/5 lần fill)`;

    if (count >= 5 && total30 <= 5) {
      cls = "yellow";
      status = "Bán chậm 30 ngày";
    }

    if (count >= 5 && total30 > 30) {
      cls = "green";
      status = "Bán tốt";
    }

    return `<div class="pill ${cls}"><b>${machine} - ${product}</b><div class="small">${status} | Fill 30 ngày: ${total30}</div></div>`;
  }).join("") || `<p class="muted">Chưa có dữ liệu slot.</p>`;
}

function renderCabin() {
  const cab = displayCabin();
  const grouped = {};

  Object.entries(cab).forEach(([key, qty]) => {
    const [machine, product] = key.split("||");
    grouped[machine] ||= [];
    grouped[machine].push({ product, qty });
  });

  $("#cabinBox").innerHTML = Object.keys(grouped).sort((a, b) => a.localeCompare(b, "vi")).map(machine => `
    <div class="machine-title">${machine}</div>
    ${grouped[machine].sort((a, b) => a.product.localeCompare(b.product, "vi")).map(item => {
      const raw = currentCabin()[`${machine}||${item.product}`] || 0;
      const cls = raw < 0 ? "red" : item.qty < 12 ? "red" : item.qty < productInfo(item.product).pack ? "yellow" : "green";
      const warn = raw < 0 ? `<br><span class="small warn-text">⚠ Lệch ${Math.abs(raw)} ${unitName(item.product)}</span>` : "";
      return `<div class="row qty-row ${cls}"><span>${item.product}${warn}</span><b class="qty-num">${item.qty}</b></div>`;
    }).join("")}
  `).join("");
}

function renderHistory() {
  const recent = arr => [...arr].reverse().slice(0, 40);

  $("#fillHistory").innerHTML = recent(state.fillLogs).map(item => `
    <div class="row">
      <span>${item.date}<br><span class="small">${item.machine} - Slot ${item.slot} - ${item.product}</span></span>
      <b>${item.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editFill('${item.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteFill('${item.id}')">Xóa</button>
      </span>
    </div>
  `).join("") || `<p class="muted">Chưa có dữ liệu Fill.</p>`;

  $("#nccHistory").innerHTML = recent(state.nccLogs).map(item => `
    <div class="row">
      <span>${item.date}<br><span class="small">${item.machine} - ${item.product}</span></span>
      <b>${item.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editNcc('${item.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteNcc('${item.id}')">Xóa</button>
      </span>
    </div>
  `).join("") || `<p class="muted">Chưa có dữ liệu NCC.</p>`;

  $("#adjustHistory").innerHTML = recent(state.adjustLogs).map(item => `
    <div class="row">
      <span>${item.date}<br><span class="small">${item.machine} - ${item.product} - ${item.reason || ""}</span></span>
      <b>${item.qty > 0 ? "+" + item.qty : item.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editAdjust('${item.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteAdjust('${item.id}')">Xóa</button>
      </span>
    </div>
  `).join("") || `<p class="muted">Chưa có dữ liệu điều chỉnh.</p>`;
}

function renderAudit() {
  const negatives = negativeCabinItems();

  $("#auditBox").innerHTML = negatives.length ? negatives.map(item => `
    <div class="pill red">
      <b>${item.machine} - ${item.product}</b>
      <div class="small">Tồn tính toán: ${item.raw} | Hiển thị: 0 | Lệch: ${item.shortage}</div>
      <button class="mini" onclick="quickFixNegative('${item.machine}','${item.product}',${item.shortage})">Tạo điều chỉnh +${item.shortage}</button>
    </div>
  `).join("") : `<div class="pill green"><b>Dữ liệu ổn</b><div class="small">Không có cabin nào bị âm.</div></div>`;
}

function quickFixNegative(machine, product, qty) {
  if (!confirm(`Tạo điều chỉnh +${qty} cho ${machine} - ${product}?`)) return;

  const item = { id: makeId(), date: todayISO(), machine, product, qty: Number(qty), reason: "Sửa cabin âm" };
  state.adjustLogs.push(item);
  lastAction = { type: "deleteAdjust", index: state.adjustLogs.length - 1, item };
  saveState();
  showToast("Đã tạo điều chỉnh.", true);
}

function renderQuickFill() {
  const machine = $("#quickMachine").value;
  const slots = config().slots
    .filter(slot => slot.machine === machine)
    .sort((a, b) => Number(a.slot) - Number(b.slot));

  $("#quickFillBox").innerHTML = slots.map(slot => `
    <div class="slot-card" data-machine="${slot.machine}" data-slot="${slot.slot}" data-product="${slot.product}">
      <div class="slot-head">
        <div><b>Slot ${slot.slot}</b><br><span>${slot.product}</span></div>
        <span>Max ${slot.max || ""}</span>
      </div>
      <div class="slot-controls">
        <input type="number" min="0" step="1" inputmode="numeric" placeholder="Đã fill" />
        <div class="slot-actions">
          ${[1,2,5,10,12,24,28].map(n => `<button type="button" data-val="${n}">+${n}</button>`).join("")}
          <button type="button" data-clear="1">Xóa</button>
          <button type="button" class="save">Lưu Slot ${slot.slot}</button>
        </div>
      </div>
    </div>
  `).join("") || `<p class="muted">Máy này chưa có slot.</p>`;

  $$(".slot-card").forEach(card => {
    const input = $("input", card);

    card.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;

      if (button.dataset.clear) {
        input.value = "";
        return;
      }

      if (button.dataset.val) {
        input.value = Number(input.value || 0) + Number(button.dataset.val);
        return;
      }

      if (button.classList.contains("save")) {
        const qty = Number(input.value || 0);

        if (qty <= 0) {
          showToast("Chưa nhập số lượng fill.");
          return;
        }

        if (!confirmLargeQty(qty, "fill")) return;

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

function renderAll() {
  renderRoute();
  renderSummary();
  renderOrders();
  renderSlow();
  renderCabin();
  renderHistory();
  renderAudit();
  renderQuickFill();
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ version: APP_VERSION, config: config(), state }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fill-assistant-backup-${todayISO()}.json`;
  a.click();
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.state) {
        showToast("File không đúng định dạng.");
        return;
      }
      state = normalizeState(data.state);
      saveState();
      showToast("Đã nhập dữ liệu.");
    } catch {
      showToast("Không đọc được JSON.");
    }
  };
  reader.readAsText(file);
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  $("#installBtn").classList.remove("hidden");
});

$("#installBtn")?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  $("#installBtn").classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

setupTabs();
setupForms();
setupQuickPads();
renderAll();
