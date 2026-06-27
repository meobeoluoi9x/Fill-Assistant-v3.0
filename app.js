const APP_VERSION = "3.5.1";
const STORAGE_KEY = "fill_assistant_v32";
const OLD_KEYS = ["fill_assistant_v31","fill_assistant_v30","fill_assistant_v24","fill_assistant_v23","fill_assistant_v22","fill_assistant_v21","fill_assistant_v2_production","fill_assistant_v2","fill_assistant_v1","fill_assistant_v1_edit_undo","fill_assistant_v0"];
const SYNC_CONFIG_KEY = "fill_assistant_supabase_config";
const DEVICE_ID_KEY = "fill_assistant_device_id";
const DEFAULT_SUPABASE_URL = "https://ylopccoxnbhtmrghldpn.supabase.co";
// Paste the public browser key here. Never paste sb_secret/service_role keys.
// Optional light obfuscation: use "b64:" + base64 encoded publishable key.
const DEFAULT_SUPABASE_KEY = "sb_publishable_uBeJmMkH-kjYBsT09ToR4w__JDc48K2";

let deferredPrompt = null;
let lastAction = null;
let editing = null;
let orderSummaryText = "";
let activeOrderMachine = null;
let activeDashboardMachine = localStorage.getItem("fill_assistant_active_machine") || null;
let syncClient = null;
let syncUser = null;
let syncBusy = false;
let syncStatusText = "Chưa cấu hình";

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

function deviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = makeId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function syncConfig() {
  const defaults = {
    url: DEFAULT_SUPABASE_URL,
    key: decodeSupabaseKey(DEFAULT_SUPABASE_KEY),
    source: DEFAULT_SUPABASE_URL && DEFAULT_SUPABASE_KEY ? "built-in" : "local"
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || "{}");
    return {
      url: saved.url || defaults.url || "",
      key: saved.key || defaults.key || "",
      source: saved.url && saved.key ? "local" : defaults.source
    };
  } catch {
    return defaults;
  }
}

function saveSyncConfig(config) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config || {}));
}

function decodeSupabaseKey(value) {
  if (!value) return "";
  if (value.startsWith("b64:")) {
    try {
      return atob(value.slice(4));
    } catch {
      return "";
    }
  }
  return value;
}

function markStatePending() {
  const now = new Date().toISOString();
  const id = deviceId();
  ["fillLogs", "nccLogs", "adjustLogs"].forEach(key => {
    state[key].forEach(item => {
      item.created_at ||= now;
      item.updated_at = now;
      item.device_id ||= id;
      item._sync = "pending";
    });
  });
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
  markStatePending();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
  queueAutoSync();
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function productInfo(product) {
  return config().products?.[product] || { pack: isAquaProduct(product) ? 28 : 24, minPacks: 1 };
}

function isAquaProduct(product) {
  const lower = String(product || "").toLowerCase();
  return lower.includes("aqua") || lower.includes("aquafina");
}

function unitName(product) {
  return "sản phẩm";
}

function packText(qty, product) {
  const info = productInfo(product);
  const packs = Math.ceil(Number(qty || 0) / info.pack);
  return { packs, qty: packs * info.pack, unit: unitName(product), packSize: info.pack };
}

function suggestOrder(qty, product) {
  const info = productInfo(product);
  const stock = Number(qty || 0);

  // Aqua/Aquafina giữ quy tắc cũ:
  // - Tồn >= 28: đặt 2 thùng = 56 chai
  // - Tồn < 28: đặt 3 thùng = 84 chai
  if (isAquaProduct(product)) {
    return stock >= 28 ? info.pack * 2 : info.pack * 3;
  }

  // Sản phẩm thường:
  // - Tồn > 12: không đặt
  // - Tồn 3-12: đặt 1 thùng = 24
  // - Tồn dưới 3: đặt 2 thùng = 48
  if (stock > 12) return 0;
  if (stock >= 3) return info.pack;
  return info.pack * 2;
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
    select.innerHTML = machines.map(machine => `<option>${machine}</option>`).join("\n\n");
  });

  $$($("#nccForm select[name='product'], #adjustForm select[name='product'], #stocktakeForm select[name='product']")).forEach(select => {
    select.innerHTML = products.map(product => `<option>${product}</option>`).join("");
  });

  const quickMachine = $("#quickMachine");
  quickMachine.innerHTML = machines.map(machine => `<option>${machine}</option>`).join("");
  quickMachine.addEventListener("change", renderQuickFill);

  // Populate select trong tab Kiểm tra
  const auditStocktakeMachine = $("#auditStocktakeMachine");
  if (auditStocktakeMachine) {
    auditStocktakeMachine.innerHTML = machines.map(machine => `<option>${machine}</option>`).join("");
    auditStocktakeMachine.addEventListener("change", renderAuditStocktake);
  }

  // Populate select trong tab adjust (cũ, giữ lại để tương thích)
  const stocktakeMachine = $("#stocktakeMachine");
  if (stocktakeMachine) {
    stocktakeMachine.innerHTML = machines.map(machine => `<option>${machine}</option>`).join("");
    stocktakeMachine.addEventListener("change", renderStocktakeBox);
  }

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
  $("#showCabinAuditBtn")?.addEventListener("click", () => {
    $("#dashboardCabinAuditCard").classList.remove("hidden");
    renderDashboardCabinAudit();
  });
  $("#hideCabinAuditBtn")?.addEventListener("click", () => {
    $("#dashboardCabinAuditCard").classList.add("hidden");
  });
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
    form.querySelector("button[type='submit']").textContent = "Cập nhật điều chỉnh";
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

function totalPacks(rows) {
  return rows.reduce((sum, row) => sum + Number(row.pack?.packs || 0), 0);
}


function machineHealth(machine) {
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const hasNegative = negativeCabinItems().some(item => item.machine === machine);

  if (hasNegative) return { cls: "red", label: "Lỗi" };
  if (rows.some(row => row.pack.packs >= 3)) return { cls: "red", label: "Thiếu nặng" };
  if (rows.length > 0) return { cls: "yellow", label: "Cần đặt" };
  return { cls: "green", label: "Ổn" };
}

function renderRoute() {
  $("#todayText").textContent = viDate();

  const machines = config().machines.map(machine => machine.name);
  if (!activeDashboardMachine || !machines.includes(activeDashboardMachine)) {
    activeDashboardMachine = machines[0] || null;
  }

  $("#routeBadge").textContent = activeDashboardMachine || "Theo máy";
  $("#routeMachines").innerHTML = machines.map(machine => {
    const health = machineHealth(machine);
    return `<button class="machine-dashboard-tab ${machine === activeDashboardMachine ? "active" : ""} ${health.cls}" data-machine="${machine}">
      <span>${machine}</span>
      <small>${health.label}</small>
    </button>`;
  }).join("");

  $$(".machine-dashboard-tab").forEach(button => {
    button.addEventListener("click", () => {
      activeDashboardMachine = button.dataset.machine;
      activeOrderMachine = activeDashboardMachine;
      localStorage.setItem("fill_assistant_active_machine", activeDashboardMachine);
      renderAll();
    });
  });
}

function groupOrdersByMachine(rows) {
  const groups = {};
  rows.forEach(row => {
    groups[row.machine] ||= [];
    groups[row.machine].push(row);
  });
  return groups;
}

function formatMachineOrder(machine, rows) {
  const lines = [`${machine}`];
  rows.forEach(row => {
    lines.push(`- ${row.product}: ${row.pack.packs} thùng (${row.pack.qty} ${row.pack.unit})`);
  });
  return lines.join("\\n");
}

function copyText(text, message) {
  if (!text) {
    showToast("Chưa có đơn NCC để copy.");
    return;
  }

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast(message || "Đã copy."));
  } else {
    showToast(text);
  }
}

function copyOrderSummary() {
  if (!orderSummaryText) {
    showToast("Máy này chưa có đơn NCC để copy.");
    return;
  }
  copyText(`Đơn NCC ${activeDashboardMachine}:\n${orderSummaryText}`, `Đã copy đơn ${activeDashboardMachine}.`);
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

// ─── Kiểm kê cabin trong tab Audit ──────────────────────────────────────────

function renderAuditStocktake() {
  const box = $("#auditStocktakeBox");
  if (!box) return;

  const machine = $("#auditStocktakeMachine")?.value;
  if (!machine) return;

  const cab = displayCabin();
  const items = Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      return { machine: m, product, qty };
    })
    .filter(item => item.machine === machine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));

  if (!items.length) {
    box.innerHTML = `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;
    return;
  }

  const date = $("#auditStocktakeDate")?.value || todayISO();

  box.innerHTML = `
    <div class="cabin-audit-list">
      ${items.map(item => `
        <div class="cabin-audit-row" data-machine="${item.machine}" data-product="${item.product}" data-current="${item.qty}">
          <div>
            <b>${item.product}</b>
            <span>Hệ thống: <strong>${item.qty}</strong> ${unitName(item.product)}</span>
          </div>
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="${item.qty}" />
        </div>
      `).join("")}
    </div>
    <div class="quick-fill-footer">
      <div>
        <b id="auditStocktakePending">Nhập tồn thực tế rồi bấm lưu</b>
      </div>
      <div class="quick-fill-footer-actions">
        <button type="button" id="clearAuditStocktakeBtn" class="btn ghost">Xóa hết</button>
        <button type="button" id="saveAuditStocktakeBtn" class="btn primary">Lưu kiểm kê</button>
      </div>
    </div>
  `;

  box.oninput = event => {
    if (event.target.matches(".cabin-audit-row input")) updateAuditStocktakePending();
  };

  box.onclick = event => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.id === "clearAuditStocktakeBtn") {
      $$(".cabin-audit-row input", box).forEach(input => { input.value = ""; });
      updateAuditStocktakePending();
      return;
    }

    if (button.id === "saveAuditStocktakeBtn") {
      saveAuditStocktakeBatch(date);
    }
  };

  updateAuditStocktakePending();
}

function updateAuditStocktakePending() {
  const box = $("#auditStocktakeBox");
  if (!box) return;
  const entries = getAuditStocktakeEntries();
  const label = $("#auditStocktakePending");
  if (label) {
    if (!entries.length) {
      label.textContent = "Nhập tồn thực tế rồi bấm lưu";
    } else {
      const diffs = entries.filter(e => e.diff !== 0);
      label.textContent = diffs.length
        ? `${diffs.length} sản phẩm có chênh lệch`
        : `${entries.length} sản phẩm đã nhập, không có chênh lệch`;
    }
  }
}

function getAuditStocktakeEntries() {
  return $$(".cabin-audit-row", $("#auditStocktakeBox"))
    .map(row => ({
      row,
      machine: row.dataset.machine,
      product: row.dataset.product,
      current: Number(row.dataset.current || 0),
      actual: $("input", row).value === "" ? null : Number($("input", row).value)
    }))
    .filter(e => e.actual !== null)
    .map(e => ({ ...e, diff: e.actual - e.current }));
}

function saveAuditStocktakeBatch(date) {
  const entries = getAuditStocktakeEntries();

  if (!entries.length) {
    showToast("Chưa nhập tồn thực tế cho sản phẩm nào.");
    return;
  }

  const changed = entries.filter(e => e.diff !== 0);

  if (!changed.length) {
    showToast("Tất cả sản phẩm đều khớp, không cần điều chỉnh.");
    return;
  }

  const preview = changed.slice(0, 3).map(e => `${e.product}: ${e.diff > 0 ? "+" : ""}${e.diff}`).join(", ");
  const more = changed.length > 3 ? ` và ${changed.length - 3} sản phẩm khác` : "";
  if (!confirm(`Tạo ${changed.length} điều chỉnh: ${preview}${more}?`)) return;

  changed.forEach(e => {
    const item = {
      id: makeId(),
      date: date || todayISO(),
      machine: e.machine,
      product: e.product,
      qty: e.diff,
      reason: "Kiểm kê"
    };
    state.adjustLogs.push(item);
  });

  lastAction = null; // batch không hỗ trợ undo đơn lẻ
  saveState();
  showToast(`Đã lưu ${changed.length} điều chỉnh từ kiểm kê.`, false);

  // Reset các input đã nhập
  $$(".cabin-audit-row input", $("#auditStocktakeBox")).forEach(input => { input.value = ""; });
  updateAuditStocktakePending();
}

// ─── Kiểm kê cabin trong tab adjust (cũ, giữ để tương thích) ────────────────

function renderStocktakeBox() {
  const box = $("#stocktakeBox");
  if (!box) return;

  const machine = $("#stocktakeMachine")?.value;
  if (!machine) return;

  const cab = displayCabin();
  const items = Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      return { machine: m, product, qty };
    })
    .filter(item => item.machine === machine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));

  box.innerHTML = items.length ? `
    <div class="cabin-audit-list">
      ${items.map(item => `
        <div class="cabin-audit-row" data-machine="${item.machine}" data-product="${item.product}" data-current="${item.qty}">
          <div>
            <b>${item.product}</b>
            <span>Hệ thống: <strong>${item.qty}</strong> ${unitName(item.product)}</span>
          </div>
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="${item.qty}" />
          <button class="mini save-audit">Lưu</button>
        </div>
      `).join("")}
    </div>
  ` : `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;

  $$(".save-audit", box).forEach(button => {
    button.addEventListener("click", () => {
      const row = button.closest(".cabin-audit-row");
      const machine = row.dataset.machine;
      const product = row.dataset.product;
      const current = Number(row.dataset.current || 0);
      const actual = Number($("input", row).value || 0);
      const diff = actual - current;

      if (diff === 0) {
        showToast(`${product}: không có chênh lệch.`);
        return;
      }

      const item = {
        id: makeId(),
        date: $("#stocktakeDate")?.value || todayISO(),
        machine,
        product,
        qty: diff,
        reason: "Kiểm kê"
      };

      state.adjustLogs.push(item);
      lastAction = { type: "deleteAdjust", index: state.adjustLogs.length - 1, item };
      saveState();
      showToast(`Đã điều chỉnh ${product}: ${diff > 0 ? "+" : ""}${diff}.`, true);
    });
  });
}

// ─── Audit (Kiểm tra dữ liệu) ───────────────────────────────────────────────

function renderAudit() {
  const negatives = negativeCabinItems();

  $("#auditBox").innerHTML = negatives.length ? negatives.map(item => `
    <div class="pill red">
      <b>${item.machine} - ${item.product}</b>
      <div class="small">Tồn tính toán: ${item.raw} | Hiển thị: 0 | Lệch: ${item.shortage}</div>
      <button class="mini" onclick="quickFixNegative('${item.machine}','${item.product}',${item.shortage})">Tạo điều chỉnh +${item.shortage}</button>
    </div>
  `).join("") : `<div class="pill green"><b>Dữ liệu ổn</b><div class="small">Không có cabin nào bị âm.</div></div>`;

  // Render kiểm kê cabin nếu chưa có nội dung
  const auditStocktakeBox = $("#auditStocktakeBox");
  if (auditStocktakeBox && !auditStocktakeBox.innerHTML.trim()) {
    renderAuditStocktake();
  }
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

  if (!slots.length) {
    $("#quickFillBox").innerHTML = `<p class="muted">Máy này chưa có slot.</p>`;
    return;
  }

  $("#quickFillBox").innerHTML = `
    <div class="quick-fill-list">
      ${slots.map(slot => `
        <div class="slot-card" data-machine="${slot.machine}" data-slot="${slot.slot}" data-product="${slot.product}">
          <div class="quick-slot-info">
            <b>Slot ${slot.slot}</b>
            <span>${slot.product}${slot.max ? ` · Max ${slot.max}` : ""}</span>
          </div>
          <div class="slot-controls compact embedded">
            <div class="quick-qty-control">
              <input type="number" min="0" step="1" inputmode="numeric" placeholder="0" />
              <div class="slot-actions inline">
                ${[1,2,3,5].map(n => `<button type="button" data-val="${n}">+${n}</button>`).join("")}
              </div>
            </div>
            <button type="button" class="clear-slot" data-clear="1">Xóa</button>
          </div>
        </div>
      `).join("")}
    </div>
    <div class="quick-fill-footer">
      <div>
        <b id="quickFillPending">0 slot</b>
        <span>có số lượng chờ lưu</span>
      </div>
      <div class="quick-fill-footer-actions">
        <button type="button" id="clearQuickFillBtn" class="btn ghost">Xóa hết</button>
        <button type="button" id="saveQuickFillBtn" class="btn primary">Lưu các slot đã nhập</button>
      </div>
    </div>
  `;

  const box = $("#quickFillBox");

  box.oninput = event => {
    if (event.target.matches(".slot-card input")) updateQuickFillPending();
  };

  box.onclick = event => {
    const button = event.target.closest("button");
    if (!button) return;

    const card = button.closest(".slot-card");
    if (card && button.dataset.clear) {
      $("input", card).value = "";
      updateQuickFillPending();
      return;
    }

    if (card && button.dataset.val) {
      const input = $("input", card);
      input.value = Number(input.value || 0) + Number(button.dataset.val);
      updateQuickFillPending();
      return;
    }

    if (button.id === "clearQuickFillBtn") {
      $$(".slot-card input", box).forEach(input => { input.value = ""; });
      updateQuickFillPending();
      return;
    }

    if (button.id === "saveQuickFillBtn") {
      saveQuickFillBatch();
    }
  };

  updateQuickFillPending();
}

function getQuickFillEntries() {
  return $$(".slot-card", $("#quickFillBox"))
    .map(card => ({
      card,
      machine: card.dataset.machine,
      slot: Number(card.dataset.slot),
      product: card.dataset.product,
      qty: Number($("input", card).value || 0)
    }))
    .filter(item => item.qty > 0);
}

function updateQuickFillPending() {
  const pending = getQuickFillEntries();
  const total = pending.reduce((sum, item) => sum + item.qty, 0);
  const label = $("#quickFillPending");
  if (label) label.textContent = `${pending.length} slot · ${total} món`;
}

function saveQuickFillBatch() {
  const entries = getQuickFillEntries();

  if (!entries.length) {
    showToast("Chưa nhập số lượng fill.");
    return;
  }

  const large = entries.filter(item => item.qty >= 100 || item.qty > 50);
  if (large.length) {
    const preview = large.map(item => `Slot ${item.slot}: ${item.qty}`).join(", ");
    if (!confirm(`Có số lượng khá lớn (${preview}). Lưu tất cả slot này?`)) return;
  }

  entries.forEach(item => {
    state.fillLogs.push({
      id: makeId(),
      date: todayISO(),
      machine: item.machine,
      slot: item.slot,
      product: item.product,
      qty: item.qty
    });
  });

  entries.forEach(item => { $("input", item.card).value = ""; });
  saveState();
  showToast(`Đã lưu ${entries.length} slot fill.`, true);
}

function renderSelectedCabin() {
  const machine = activeDashboardMachine;
  const cab = displayCabin();
  const items = Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      return { machine: m, product, qty, raw: currentCabin()[key] || 0 };
    })
    .filter(item => item.machine === machine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));

  const box = $("#selectedCabinBox");
  if (!box) return;

  box.innerHTML = items.length ? items.map(item => {
    const cls = item.raw < 0 ? "red" : item.qty < 12 ? "red" : item.qty < productInfo(item.product).pack ? "yellow" : "green";
    const warn = item.raw < 0 ? ` · Lệch ${Math.abs(item.raw)} ${unitName(item.product)}` : "";
    return `<div class="compact-info-row ${cls}"><b>${item.product}</b><span>${item.qty} ${unitName(item.product)}${warn}</span></div>`;
  }).join("") : `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;
}

function renderDashboardCabinAudit() {
  const machine = activeDashboardMachine;
  const cab = displayCabin();
  const items = Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      return { machine: m, product, qty };
    })
    .filter(item => item.machine === machine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));

  const box = $("#dashboardCabinAuditBox");
  if (!box) return;

  box.innerHTML = items.length ? `
    <div class="cabin-audit-list">
      ${items.map(item => `
        <div class="cabin-audit-row" data-machine="${item.machine}" data-product="${item.product}" data-current="${item.qty}">
          <div>
            <b>${item.product}</b>
            <span>Hiện tại: ${item.qty} ${unitName(item.product)}</span>
          </div>
          <input type="number" min="0" step="1" inputmode="numeric" value="${item.qty}" />
          <button class="mini save-audit">Lưu</button>
        </div>
      `).join("")}
    </div>
  ` : `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;

  $$(".save-audit", box).forEach(button => {
    button.addEventListener("click", () => {
      const row = button.closest(".cabin-audit-row");
      const machine = row.dataset.machine;
      const product = row.dataset.product;
      const current = Number(row.dataset.current || 0);
      const actual = Number($("input", row).value || 0);
      const diff = actual - current;

      if (diff === 0) {
        showToast(`${product}: không có chênh lệch.`);
        return;
      }

      const item = {
        id: makeId(),
        date: todayISO(),
        machine,
        product,
        qty: diff,
        reason: "Kiểm kê"
      };

      state.adjustLogs.push(item);
      lastAction = { type: "deleteAdjust", index: state.adjustLogs.length - 1, item };
      saveState();
      $("#dashboardCabinAuditCard").classList.remove("hidden");
      showToast(`Đã điều chỉnh ${product}: ${diff > 0 ? "+" : ""}${diff}.`, true);
    });
  });
}

function dashboardAttentionRows(machine) {
  const cab = displayCabin();
  return Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      const raw = currentCabin()[key] || 0;
      const order = suggestOrder(qty, product);
      return { machine: m, product, qty, raw, order, pack: packText(order, product) };
    })
    .filter(item => item.machine === machine && (item.raw < 0 || item.qty <= 12 || item.order > 0))
    .sort((a, b) => {
      if (a.raw < 0 && b.raw >= 0) return -1;
      if (b.raw < 0 && a.raw >= 0) return 1;
      if (b.order !== a.order) return b.order - a.order;
      return a.qty - b.qty || a.product.localeCompare(b.product, "vi");
    });
}

function renderSummary() {
  const machine = activeDashboardMachine;
  const negatives = negativeCabinItems().filter(item => item.machine === machine).length;
  const orders = buildOrderRows().filter(row => row.machine === machine);
  const packs = totalPacks(orders);
  const attention = dashboardAttentionRows(machine);
  const health = machineHealth(machine);
  const priorityText = packs > 0
    ? `${machine}: cần đặt ${packs} thùng`
    : `${machine}: chưa cần đặt NCC`;

  $("#priorityBox").innerHTML = `
    <div>
      <span>Ưu tiên hôm nay</span>
      <b>${priorityText}</b>
    </div>
    <strong class="${health.cls}">${health.label}</strong>
  `;

  $("#summaryBox").innerHTML = [
    ["Thùng NCC", packs],
    ["Sản phẩm NCC", orders.length],
    ["Cần kiểm tra", attention.length],
    ["Lệch cabin", negatives]
  ].map(([label, value]) => `<div class="summary-card action-metric"><span>${label}</span><b>${value}</b></div>`).join("");
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nccMachinesWithOrders() {
  const machines = unique(buildOrderRows().map(row => row.machine));
  return machines.length ? machines : config().machines.map(machine => machine.name);
}

function selectedNccExportMachines() {
  return $$("#nccExportMachines input:checked").map(input => input.value);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportNccCsv() {
  const machines = selectedNccExportMachines();
  const rows = buildOrderRows().filter(row => machines.includes(row.machine));

  if (!machines.length) {
    showToast("Chưa chọn máy để xuất CSV.");
    return;
  }

  if (!rows.length) {
    showToast("Các máy đã chọn chưa có thùng NCC cần đặt.");
    return;
  }

  const grouped = groupOrdersByMachine(rows);
  const createdAt = new Date().toLocaleString("vi-VN");
  const csvRows = [];

  csvRows.push(["Đơn NCC - Fill Assistant"]);
  csvRows.push([`Xuất lúc: ${createdAt}`]);
  csvRows.push([]);
  csvRows.push(["Máy", "Sản phẩm", "Số thùng", "Quy đổi", "Đơn vị", "Tồn cabin"]);

  machines.forEach(machine => {
    const machineRows = grouped[machine] || [];
    if (!machineRows.length) return;

    machineRows.forEach(row => {
      csvRows.push([machine, row.product, row.pack.packs, row.pack.qty, row.pack.unit, row.qty]);
    });

    csvRows.push([`Tổng ${machine}`, "", totalPacks(machineRows), "", "", ""]);
    csvRows.push([]);
  });

  csvRows.push(["TỔNG TẤT CẢ", "", totalPacks(rows), "", "", ""]);

  const csv = "\ufeff" + csvRows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `don-ncc-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Đã xuất CSV ${machines.length} máy.`);
}

function renderOrders() {
  const machine = activeDashboardMachine;
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const attention = dashboardAttentionRows(machine);
  const packsTotal = totalPacks(rows);
  const exportMachines = nccMachinesWithOrders();

  orderSummaryText = rows.length ? `${formatMachineOrder(machine, rows)}\n\nTỔNG: ${packsTotal} THÙNG` : "";

  $("#orderSummaryBox").innerHTML = rows.length ? `
    <div class="dashboard-order-head">
      <div>
        <span>Đơn NCC ${machine}</span>
        <b>${packsTotal} thùng</b>
      </div>
      <small>${packsTotal} thùng cần đặt</small>
    </div>
    <div class="dashboard-order-list">
      ${rows.map(row => `
        <div class="dashboard-order-row">
          <span>${row.product}</span>
          <b>${row.pack.packs} thùng</b>
          <small>${row.pack.qty} ${row.pack.unit}</small>
        </div>
      `).join("")}
    </div>
    <div class="excel-export-box">
      <div class="excel-export-head">
        <b>Xuất CSV đơn NCC</b>
        <button type="button" id="selectAllNccMachines" class="mini">Chọn tất cả</button>
      </div>
      <div id="nccExportMachines" class="machine-check-list">
        ${exportMachines.map(name => `
          <label>
            <input type="checkbox" value="${htmlEscape(name)}" ${name === machine ? "checked" : ""} />
            <span>${name}</span>
          </label>
        `).join("")}
      </div>
      <button type="button" id="exportNccCsvBtn" class="btn primary">Xuất CSV mở bằng Excel</button>
    </div>
  ` : `<div class="empty-state"><b>${machine || "Máy này"} đang ổn</b><span>Chưa có sản phẩm nào cần đặt NCC.</span></div>`;

  $("#orderBox").innerHTML = attention.length ? `
    <div class="attention-list">
      ${attention.slice(0, 12).map(item => {
        const level = item.raw < 0 ? "red" : item.qty <= 2 ? "red" : item.qty <= 12 ? "yellow" : "blue";
        const action = item.order > 0 ? `${item.pack.packs} thùng` : "Kiểm tra";
        const warn = item.raw < 0 ? `Lệch ${Math.abs(item.raw)} ${unitName(item.product)}` : `Tồn ${item.qty} ${unitName(item.product)}`;
        return `
          <div class="attention-row ${level}">
            <div>
              <b>${item.product}</b>
              <span>${warn}</span>
            </div>
            <strong>${action}</strong>
          </div>
        `;
      }).join("")}
    </div>
  ` : `<div class="empty-state"><b>Không có tồn thấp</b><span>Máy này chưa có mục nào cần chú ý.</span></div>`;

  $$(".copy-machine").forEach(button => {
    button.addEventListener("click", () => copyOrderSummary());
  });

  $("#exportNccCsvBtn")?.addEventListener("click", exportNccCsv);
  $("#selectAllNccMachines")?.addEventListener("click", () => {
    const inputs = $$("#nccExportMachines input");
    const shouldCheck = inputs.some(input => !input.checked);
    inputs.forEach(input => { input.checked = shouldCheck; });
  });
}

function isSyncAdminMode() {
  return new URLSearchParams(location.search).get("admin") === "1";
}

function hasBuiltInSyncConfig() {
  return Boolean(DEFAULT_SUPABASE_URL && DEFAULT_SUPABASE_KEY);
}

function ensureHeaderSyncLogin() {
  if (!hasBuiltInSyncConfig() || $("#headerSyncLogin")) return;
  const header = $(".app-header");
  if (!header) return;
  const box = document.createElement("div");
  box.id = "headerSyncLogin";
  box.className = "header-sync-login";
  box.innerHTML = `
    <form id="headerSyncLoginForm" class="header-sync-form">
      <input name="email" type="email" autocomplete="email" placeholder="Email" />
      <input name="password" type="password" autocomplete="current-password" placeholder="M&#7853;t kh&#7849;u" />
      <button type="submit" class="btn small">&#272;&#259;ng nh&#7853;p</button>
    </form>
    <div id="headerSyncAccount" class="header-sync-account hidden">
      <span id="headerSyncEmail"></span>
      <button id="headerSyncNowBtn" class="btn small">Sync</button>
      <button id="headerSyncLogoutBtn" class="btn small ghost">Tho&#225;t</button>
    </div>
  `;
  header.insertBefore(box, $("#installBtn"));
}

function ensureSyncView() {
  document.querySe