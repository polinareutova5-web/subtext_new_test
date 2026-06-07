const API_URL = "https://script.google.com/macros/s/AKfycbx_OSE6tAobFnkIghGGs66JFt6Am16dz-i2H9FMTGy22lcNvi8d9vAyw9Lq-I1PgFFD/exec";
const SESSION_KEY = "subtextTeacherSession";

let loginMode = "password";
let teacherSession = null;
let teacherData = emptyTeacherData();
let activeSection = "dashboard";
let editingStudentId = "";

const sectionTitles = {
  dashboard: "Главная панель",
  students: "Ученики",
  lessons: "Уроки",
  materials: "Материалы",
  shop: "Магазин",
  slots: "Слоты",
  groups: "Групповые занятия",
  homework: "Домашние задания",
  support: "Поддержка",
  purchases: "Покупки",
  achievements: "Достижения",
  tools: "Рассылка и монеты",
  stats: "Статистика",
};

const editableResources = {
  lessons: {
    title: "урок",
    fields: [
      ["num", "Номер урока", "number"],
      ["link", "Ссылка на урок", "url"],
      ["hwLink", "Ссылка на ДЗ", "url"],
      ["levels", "Уровни", "text"],
    ],
    columns: [["num", "Номер"], ["link", "Урок"], ["hwLink", "ДЗ"], ["levels", "Уровни"], ["subject", "Предмет"]],
  },
  materials: {
    title: "материал",
    fields: [["title", "Название", "text"], ["link", "Ссылка", "url"]],
    columns: [["title", "Название"], ["link", "Ссылка"], ["subject", "Предмет"]],
  },
  shop: {
    title: "товар",
    fields: [["image", "Картинка", "url"], ["title", "Название", "text"], ["price", "Цена", "number"]],
    columns: [["image", "Картинка"], ["title", "Название"], ["price", "Цена"], ["subject", "Предмет"]],
  },
  slots: {
    title: "слот",
    fields: [["date", "Дата", "date"], ["time", "Время", "time"], ["status", "Статус", "text"]],
    columns: [["date", "Дата"], ["time", "Время"], ["status", "Статус"], ["subject", "Предмет"]],
  },
  groups: {
    title: "группу",
    fields: [["date", "Дата", "date"], ["time", "Время", "time"], ["title", "Название", "text"], ["capacity", "Количество мест", "number"]],
    columns: [["date", "Дата"], ["time", "Время"], ["title", "Название"], ["capacity", "Мест"], ["subject", "Предмет"]],
  },
  achievements: {
    title: "ачивку",
    fields: [["level", "Уровень", "text"], ["title", "Название", "text"], ["image", "Картинка", "url"]],
    columns: [["level", "Уровень"], ["title", "Название"], ["image", "Картинка"], ["subject", "Предмет"]],
  },
};

function emptyTeacherData() {
  return {
    dashboard: {}, students: [], lessons: [], materials: [], shop: [], slots: [], groups: [],
    homework: [], support: [], purchases: [], achievements: [], stats: {},
  };
}

function escapeHtml(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function normalizeSubject(subject = "") {
  return String(subject || "").trim().toLowerCase();
}

function currentSubject() {
  return normalizeSubject(teacherSession?.subject || teacherSession?.subjects?.[0] || "");
}

function buildUrl(params = {}) {
  const url = new URL(API_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function apiGet(params) {
  const response = await fetch(buildUrl({ ...params, subject: params.subject || currentSubject() }));
  return response.json();
}

async function apiPost(payload) {
  const response = await fetch(API_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, subject: payload.subject || currentSubject() }),
  });
  return response.json();
}

function showStatus(message, kind = "info") {
  const status = document.getElementById("app-status");
  if (!status) return;
  status.textContent = message;
  status.classList.remove("hidden");
  status.dataset.kind = kind;
  window.setTimeout(() => status.classList.add("hidden"), 4000);
}

function setLoginMode(mode) {
  loginMode = mode;
  document.getElementById("tab-password")?.classList.toggle("active", mode === "password");
  document.getElementById("tab-code")?.classList.toggle("active", mode === "code");
  document.getElementById("password-login-fields")?.classList.toggle("hidden", mode !== "password");
  document.getElementById("code-login-fields")?.classList.toggle("hidden", mode !== "code");
}

async function loginTeacher(event) {
  event.preventDefault();
  const loginError = document.getElementById("login-error");
  loginError.textContent = "";
  const payload = loginMode === "password"
    ? { action: "teacher_login", mode: "password", login: document.getElementById("teacher-login").value.trim(), password: document.getElementById("teacher-password").value }
    : { action: "teacher_login", mode: "code", code: document.getElementById("teacher-code").value.trim() };

  if ((loginMode === "password" && (!payload.login || !payload.password)) || (loginMode === "code" && !payload.code)) {
    loginError.textContent = "Заполните данные для входа";
    return;
  }

  try {
    const data = await apiPost(payload);
    if (!data.success) throw new Error(data.error || "Неверные данные входа");
    teacherSession = normalizeTeacherSession(data.teacher || data);
    localStorage.setItem(SESSION_KEY, JSON.stringify(teacherSession));
    await openApp();
  } catch (error) {
    loginError.textContent = error.message || "Ошибка входа";
  }
}

function normalizeTeacherSession(raw = {}) {
  const subjects = Array.isArray(raw.subjects)
    ? raw.subjects.map(normalizeSubject).filter(Boolean)
    : String(raw.subjects || raw.subject || "").split(/[,;|\n]+/).map(normalizeSubject).filter(Boolean);
  return {
    id: raw.id || raw.teacherId || raw.login || "",
    name: raw.name || raw.username || raw.login || "Преподаватель",
    token: raw.token || raw.sessionToken || "",
    subject: subjects[0] || normalizeSubject(raw.subject),
    subjects,
  };
}

async function openApp() {
  document.getElementById("login-page")?.classList.add("hidden");
  document.getElementById("app-page")?.classList.remove("hidden");
  renderTeacherHeader();
  initEditableForms();
  await refreshCurrentSubject();
}

function renderTeacherHeader() {
  document.getElementById("teacher-name").textContent = teacherSession?.name || "Преподаватель";
  document.getElementById("teacher-subject").textContent = currentSubject() || "subject";
  const switcher = document.getElementById("subject-switcher");
  const subjects = teacherSession?.subjects || [];
  if (switcher && subjects.length > 1) {
    switcher.innerHTML = subjects.map(subject => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("");
    switcher.value = currentSubject();
    switcher.classList.remove("hidden");
  }
}

async function refreshCurrentSubject() {
  if (!teacherSession) return;
  showStatus(`Загружаем данные предмета ${currentSubject()}...`);
  const data = await loadTeacherData();
  teacherData = applySubjectFilter(data);
  renderAll();
  showStatus(`Данные предмета ${currentSubject()} обновлены`);
}

async function loadTeacherData() {
  try {
    const data = await apiGet({ action: "teacher_bootstrap", token: teacherSession.token });
    if (data.success) return { ...emptyTeacherData(), ...data };
    showStatus(data.error || "API пока не вернул данные преподавателя", "warning");
  } catch (error) {
    showStatus("Не удалось подключиться к Apps Script API. Показаны пустые разделы.", "warning");
  }
  return emptyTeacherData();
}

function applySubjectFilter(data) {
  const subject = currentSubject();
  const next = { ...emptyTeacherData(), ...data };
  Object.keys(next).forEach(key => {
    if (Array.isArray(next[key])) {
      next[key] = next[key].filter(item => !item.subject || normalizeSubject(item.subject) === subject);
    }
  });
  return next;
}

function initEditableForms() {
  Object.entries(editableResources).forEach(([resource, config]) => {
    const form = document.getElementById(`${resource}-form`);
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "true";
    form.innerHTML = config.fields.map(([name, label, type]) => `<label>${label}<input name="${name}" type="${type}" /></label>`).join("")
      + `<input name="id" type="hidden"><button class="primary-btn" type="submit">Сохранить ${config.title}</button>`;
    form.addEventListener("submit", event => saveResource(event, resource));
  });
}

function renderAll() {
  renderDashboard();
  renderStudents();
  Object.keys(editableResources).forEach(renderEditableResource);
  renderHomework();
  renderSupport();
  renderPurchases();
  renderStats();
}

function renderDashboard() {
  const students = teacherData.students || [];
  const bookings = [...(teacherData.slots || []), ...(teacherData.groups || [])].filter(item => item.status === "booked" || Number(item.bookedCount) > 0).length;
  const supportOpen = (teacherData.support || []).filter(item => !isDone(item)).length;
  const purchases = teacherData.purchases || [];
  document.getElementById("metric-students").textContent = students.length;
  document.getElementById("metric-bookings").textContent = bookings;
  document.getElementById("metric-support").textContent = supportOpen;
  document.getElementById("metric-purchases").textContent = purchases.length;
  document.getElementById("latest-purchases").innerHTML = compactList(purchases.slice(-5).reverse(), item => `${item.date || item["Дата"] || ""} · ${item.student || item.username || item["Ученик"] || item["Имя"] || "Ученик"}<br><strong>${item.item || item.product || item["Товар"] || "Товар"}</strong>`);
  document.getElementById("latest-homework").innerHTML = compactList((teacherData.homework || []).slice(-5).reverse(), item => `${item.date || item["Дата"] || ""} · ${item.student || item.username || item["ученик"] || "Ученик"}<br><strong>${item.link || item.text || item["ссылка"] || "ДЗ"}</strong>`);
}

function compactList(items, mapper) {
  return items.length ? items.map(item => `<div class="compact-item">${mapper(item)}</div>`).join("") : `<div class="compact-item">Пока нет данных</div>`;
}

function renderStudents() {
  const query = String(document.getElementById("student-search")?.value || "").trim().toLowerCase();
  const students = (teacherData.students || []).filter(student => JSON.stringify(student).toLowerCase().includes(query));
  document.getElementById("students-table").innerHTML = makeTable(
    students,
    [["id", "ID"], ["name", "Имя"], ["level", "Уровень"], ["points", "Баллы"], ["coins", "Монеты"], ["subject", "Предмет"], ["schedule", "Расписание"]],
    student => `<button class="small-btn" onclick="openStudentCard(${jsArg(student.id || student.userId)})">Карточка</button>`
  );
}

function renderEditableResource(resource) {
  const config = editableResources[resource];
  const table = document.getElementById(`${resource}-table`);
  if (!table) return;
  table.innerHTML = makeTable(teacherData[resource] || [], config.columns, item => `
    <button class="small-btn" onclick="editResource(${jsArg(resource)},${jsArg(item.id || item.num || item.title || item.date || "")})">Изменить</button>
    <button class="small-btn danger" onclick="deleteResource(${jsArg(resource)},${jsArg(item.id || item.num || item.title || item.date || "")})">Удалить</button>`);
}

function makeTable(rows, columns, actionsRenderer) {
  if (!rows.length) return `<div class="compact-item">Нет записей для предмета ${escapeHtml(currentSubject())}</div>`;
  const header = columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("") + `<th>Действия</th>`;
  const body = rows.map(row => `<tr>${columns.map(([key]) => `<td>${formatCell(row[key] ?? row[aliasKey(key)] ?? "")}</td>`).join("")}<td><div class="row-actions">${actionsRenderer ? actionsRenderer(row) : ""}</div></td></tr>`).join("");
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function aliasKey(key) {
  return { id: "userId", name: "username", title: "Название", link: "Ссылка", image: "Картинка", price: "Цена", date: "Дата", subject: "Предмет" }[key] || key;
}

function formatCell(value) {
  const text = escapeHtml(value);
  if (/^https?:\/\//i.test(String(value))) return `<a href="${text}" target="_blank" rel="noopener">Ссылка</a>`;
  return text;
}

async function saveResource(event, resource) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.subject = currentSubject();
  try {
    const data = await apiPost({ action: "teacher_save", resource, token: teacherSession.token, item: payload });
    if (!data.success) throw new Error(data.error || "Не удалось сохранить");
    form.reset();
    await refreshCurrentSubject();
  } catch (error) {
    showStatus(error.message || "Ошибка сохранения", "error");
  }
}

function editResource(resource, id) {
  const form = document.getElementById(`${resource}-form`);
  const item = (teacherData[resource] || []).find(row => String(row.id || row.num || row.title || row.date || "") === String(id));
  if (!form || !item) return;
  Object.entries(item).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
  if (form.elements.id) form.elements.id.value = item.id || id;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteResource(resource, id) {
  if (!confirm("Удалить запись?")) return;
  try {
    const data = await apiPost({ action: "teacher_delete", resource, token: teacherSession.token, id, subject: currentSubject() });
    if (!data.success) throw new Error(data.error || "Не удалось удалить");
    await refreshCurrentSubject();
  } catch (error) {
    showStatus(error.message || "Ошибка удаления", "error");
  }
}

function openStudentCard(id) {
  editingStudentId = id;
  const student = (teacherData.students || []).find(item => String(item.id || item.userId) === String(id));
  if (!student) return;
  const fields = [
    ["id", "ID", "text"], ["name", "Имя", "text"], ["level", "Уровень", "text"], ["points", "Баллы", "number"],
    ["coins", "Монеты", "number"], ["avatar", "Аватар", "url"], ["lessonLink", "Ссылка на урок", "url"], ["schedule", "Расписание", "text"],
  ];
  document.getElementById("student-card-fields").innerHTML = fields.map(([name, label, type]) => `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(student[name] ?? student[aliasKey(name)] ?? "")}" ${name === "id" ? "readonly" : ""}></label>`).join("");
  document.getElementById("student-dialog")?.showModal();
}

async function saveStudentCard(event) {
  event.preventDefault();
  const item = Object.fromEntries(new FormData(event.currentTarget).entries());
  item.id = item.id || editingStudentId;
  item.subject = currentSubject();
  try {
    const data = await apiPost({ action: "teacher_save_student", token: teacherSession.token, item });
    if (!data.success) throw new Error(data.error || "Не удалось сохранить ученика");
    document.getElementById("student-dialog")?.close();
    await refreshCurrentSubject();
  } catch (error) {
    showStatus(error.message || "Ошибка сохранения ученика", "error");
  }
}

function renderHomework() {
  document.getElementById("homework-table").innerHTML = makeTable(teacherData.homework || [], [["student", "Ученик"], ["date", "Дата"], ["link", "Ссылка"], ["comment", "Комментарий"], ["status", "Статус"]], item => `
    <button class="small-btn" onclick="commentHomework(${jsArg(item.id || item.date || item.link)})">Комментарий</button>
    <button class="small-btn" onclick="markHomework(${jsArg(item.id || item.date || item.link)})">Проверено</button>`);
}

function renderSupport() {
  document.getElementById("support-table").innerHTML = makeTable(teacherData.support || [], [["student", "Ученик"], ["date", "Дата"], ["question", "Текст вопроса"], ["answer", "Ответ"], ["status", "Статус"]], item => `
    <button class="small-btn" onclick="answerSupport(${jsArg(item.id || item.date || item.question)})">Ответить</button>
    <button class="small-btn" onclick="closeSupport(${jsArg(item.id || item.date || item.question)})">Обработано</button>`);
}

function renderPurchases() {
  const filter = String(document.getElementById("purchase-filter")?.value || "").trim().toLowerCase();
  const rows = (teacherData.purchases || []).filter(item => !filter || JSON.stringify(item).toLowerCase().includes(filter));
  document.getElementById("purchases-table").innerHTML = makeTable(rows, [["date", "Дата"], ["student", "Ученик"], ["item", "Товар"], ["price", "Стоимость"], ["status", "Статус"]], item => `
    <button class="small-btn" onclick="changePurchaseStatus(${jsArg(item.id || item.date || item.item)})">Изменить статус</button>`);
}

function renderStats() {
  const stats = teacherData.stats || {};
  const students = teacherData.students || [];
  const avgProgress = stats.averageProgress ?? average(students.map(s => Number(s.progress || s.points || 0)));
  document.getElementById("stat-progress").textContent = `${Math.round(avgProgress || 0)}%`;
  document.getElementById("stat-purchases").textContent = stats.purchases ?? (teacherData.purchases || []).length;
  document.getElementById("stat-attended").textContent = stats.attendedLessons ?? stats.attended ?? 0;
  document.getElementById("stat-homework").textContent = stats.completedHomework ?? (teacherData.homework || []).filter(isDone).length;
}

function average(values) {
  const clean = values.filter(value => Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function isDone(item) {
  return [item.status, item.checked, item.done, item.processed].some(value => value === true || String(value).toLowerCase() === "true" || String(value).toLowerCase() === "проверено" || String(value).toLowerCase() === "обработано");
}

async function commentHomework(id) {
  const comment = prompt("Комментарий к домашнему заданию");
  if (comment === null) return;
  await quickAction("teacher_comment_homework", { id, comment });
}

async function markHomework(id) {
  await quickAction("teacher_check_homework", { id, status: "checked" });
}

async function answerSupport(id) {
  const answer = prompt("Ответ ученику");
  if (answer === null) return;
  await quickAction("teacher_answer_support", { id, answer });
}

async function closeSupport(id) {
  await quickAction("teacher_close_support", { id, status: "processed" });
}

async function changePurchaseStatus(id) {
  const status = prompt("Новый статус заказа");
  if (!status) return;
  await quickAction("teacher_update_purchase", { id, status });
}

async function quickAction(action, payload) {
  try {
    const data = await apiPost({ action, token: teacherSession.token, ...payload });
    if (!data.success) throw new Error(data.error || "Не удалось выполнить действие");
    await refreshCurrentSubject();
  } catch (error) {
    showStatus(error.message || "Ошибка действия", "error");
  }
}

async function sendBroadcast() {
  const message = document.getElementById("broadcast-message").value.trim();
  if (!message) return showStatus("Введите текст рассылки", "warning");
  await quickAction("teacher_broadcast", { message, target: "subject" });
  document.getElementById("broadcast-message").value = "";
}

async function grantCoins() {
  const target = document.getElementById("coins-target").value;
  const students = document.getElementById("coins-students").value;
  const amount = Number(document.getElementById("coins-amount").value) || 0;
  if (amount <= 0) return showStatus("Укажите положительное количество монет", "warning");
  await quickAction("teacher_grant_coins", { target, students, amount });
}

function switchSection(section) {
  activeSection = section;
  document.querySelectorAll(".section").forEach(el => el.classList.toggle("active-section", el.id === section));
  document.querySelectorAll("#teacher-nav button").forEach(button => button.classList.toggle("active", button.dataset.section === section));
  document.getElementById("section-title").textContent = sectionTitles[section] || "Кабинет";
}

function logoutTeacher() {
  localStorage.removeItem(SESSION_KEY);
  teacherSession = null;
  teacherData = emptyTeacherData();
  document.getElementById("app-page")?.classList.add("hidden");
  document.getElementById("login-page")?.classList.remove("hidden");
}

window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("teacher-login-form")?.addEventListener("submit", loginTeacher);
  document.getElementById("student-card-form")?.addEventListener("submit", saveStudentCard);
  document.getElementById("student-search")?.addEventListener("input", renderStudents);
  document.getElementById("purchase-filter")?.addEventListener("input", renderPurchases);
  document.getElementById("teacher-nav")?.addEventListener("click", event => {
    const button = event.target.closest("button[data-section]");
    if (button) switchSection(button.dataset.section);
  });
  document.getElementById("subject-switcher")?.addEventListener("change", async event => {
    teacherSession.subject = normalizeSubject(event.target.value);
    localStorage.setItem(SESSION_KEY, JSON.stringify(teacherSession));
    renderTeacherHeader();
    await refreshCurrentSubject();
  });

  try {
    teacherSession = normalizeTeacherSession(JSON.parse(localStorage.getItem(SESSION_KEY) || "null") || {});
    if (teacherSession.subject) await openApp();
  } catch (error) {
    localStorage.removeItem(SESSION_KEY);
  }
});
