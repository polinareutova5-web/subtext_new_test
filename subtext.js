const API_URL = "https://script.google.com/macros/s/AKfycbyLLQkd1zfsGuHT01LCa0GdenQdnL_Mu9BwtFRBep4zIAAunPKomS1-L0Qu85t7VNNU/exec";
let userId = "";
let username = "";
let currentCourse = "";
let cabinetData = null;
let notificationsCache = [];
let notificationsLoadedOnce = false;
let notificationsTimer = null;
let soundUnlocked = false;
let lessonCalendar = null;
// true = сначала пробуем Apps Script action=ai_chat, при ошибке остаётся локальный помощник.
const REMOTE_AI_ENABLED = true;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getCurrentCourse() {
  return currentCourse || cabinetData?.user?.courses?.[0] || "english";
}

function buildUrl(params) {
  const url = new URL(API_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function escapeHtml(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function normalizeNotification(raw = {}, index = 0) {
  if (typeof raw === "string") {
    return {
      id: `text-${index}-${raw}`,
      title: "Уведомление",
      text: raw,
      date: "",
      read: false,
      sound: true,
    };
  }

  return {
    id: String(raw.id || raw.date || raw.title || raw.text || raw.message || index),
    title: raw.title || raw.Заголовок || "Уведомление",
    text: raw.text || raw.message || raw.Текст || raw.Сообщение || "",
    date: raw.date || raw.Дата || raw.createdAt || "",
    read: raw.read === true || raw.read === "TRUE" || raw.status === "read" || raw.Статус === "прочитано",
    sound: raw.sound !== false && raw.sound !== "FALSE" && raw.sound !== "нет",
  };
}
function normalizeCourseName(course = "") {
  return String(course || "").trim().toLowerCase();
}

function getCourseLabel(course = "") {
  const labels = {
    english: "Английский",
    physics: "Физика",
    math: "Математика",
    biology: "Биология",
    chemistry: "Химия",
    french: "Французский",
    spanish: "Испанский",
  };
  const normalized = normalizeCourseName(course);
  return labels[normalized] || String(course || "Предмет").trim();
}

function getCourseMappedValue(source, course, fallback = "") {
  if (source === undefined || source === null || source === "") return fallback;
  if (typeof source !== "object" || Array.isArray(source)) return source;

  const normalized = normalizeCourseName(course);
  const candidates = [
    course,
    normalized,
    `progress_${normalized}`,
    `level_${normalized}`,
    `${normalized}_progress`,
    `${normalized}_level`,
  ].filter(Boolean);

  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== "") {
      return source[key];
    }
  }

  return fallback;
}

function getCourseProgress(course = getCurrentCourse()) {
  const user = cabinetData?.user || {};
  const progressSource = user.progressByCourse || user.progresses || user.courseProgress || user.progress;
  return Math.max(0, Math.min(Number(getCourseMappedValue(progressSource, course, 0)) || 0, 100));
}

function getCourseRank(course = getCurrentCourse()) {
  const user = cabinetData?.user || {};
  const normalized = normalizeCourseName(course);
  const sources = [user.ranks, user.rankings, user.schoolRanks, user.courseRanks, user.rank];

  for (const source of sources) {
    const value = getCourseMappedValue(source, course, "");
    if (value !== undefined && value !== null && value !== "") return value;
  }

  if (user[`rank_${normalized}`] !== undefined) return user[`rank_${normalized}`];
  if (user[`schoolRank_${normalized}`] !== undefined) return user[`schoolRank_${normalized}`];
  return "";
}

function getMappedLink(source, course) {
  if (!source) return "";

  const normalized = normalizeCourseName(course);
  const readLink = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value !== "object" || Array.isArray(value)) return "";
    return String(value.link || value.url || value.form || value.formUrl || "").trim();
  };

  if (Array.isArray(source)) {
    const item = source.find(entry => normalizeCourseName(entry?.course || entry?.subject || entry?.name || entry?.title) === normalized);
    return readLink(item);
  }

  if (typeof source === "object") {
    const candidates = [course, normalized, `form_${normalized}`, `${normalized}_form`].filter(Boolean);
    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const link = readLink(source[key]);
        if (link) return link;
      }
    }
  }

  return readLink(source);
}

function getSubmissionFormLink(course = getCurrentCourse()) {
  const data = cabinetData || {};
  const user = data.user || {};
  const sources = [
    data.submissionForms,
    data.formLinks,
    data.forms,
    data.courseForms,
    data.subjectForms,
    user.submissionForms,
    user.formLinks,
    user.forms,
    user.courseForms,
    user.subjectForms,
  ];

  for (const source of sources) {
    const link = getMappedLink(source, course);
    if (link) return link;
  }

  return "";
}

function renderSubmissionFormLink(course = getCurrentCourse()) {
  const linkEl = document.getElementById("submission-form-link");
  const emptyEl = document.getElementById("submission-form-empty");
  if (!linkEl) return;

  const link = getSubmissionFormLink(course);
  if (link) {
    linkEl.href = link;
    linkEl.classList.remove("hidden");
    if (emptyEl) emptyEl.classList.add("hidden");
  } else {
    linkEl.removeAttribute("href");
    linkEl.classList.add("hidden");
    if (emptyEl) emptyEl.classList.remove("hidden");
  }
}

function renderCourseProgressMeta(course = getCurrentCourse()) {
  const progressValue = getCourseProgress(course);
  const rankValue = getCourseRank(course);
  const courseLabel = getCourseLabel(course);

  setText("progress", progressValue);
  renderProgress(progressValue);

  const rankEl = document.getElementById("course-rank");
  if (!rankEl) return;

  if (!rankValue) {
    rankEl.textContent = `Рейтинг по предмету «${courseLabel}» пока не указан`;
    return;
  }

  const rankText = String(rankValue).trim();
  const looksLikeNumber = /^\d+$/.test(rankText);
  rankEl.innerHTML = looksLikeNumber
    ? `<strong>${escapeHtml(rankText)} место</strong> по школе · ${escapeHtml(courseLabel)}`
    : `${escapeHtml(rankText)} · ${escapeHtml(courseLabel)}`;
}

function unlockNotificationSound() {
  soundUnlocked = true;
}

function playNotificationSound() {
  if (!soundUnlocked) return;

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    gain.connect(ctx.destination);

    [660, 880].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.14);
      osc.connect(gain);
      osc.start(ctx.currentTime + index * 0.14);
      osc.stop(ctx.currentTime + 0.45 + index * 0.14);
    });

    setTimeout(() => ctx.close(), 900);
  } catch (e) {
    console.warn("Notification sound is unavailable", e);
  }
}

function parseNotificationsValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  return String(value)
    .split(/\n|\|/)
    .map(item => item.trim())
    .filter(Boolean);
}

function collectNotificationsFromData(data = {}) {
  const u = data.user || {};
  const candidates = [
    data.notifications,
    data.messages,
    data.items,
    data.notification,
    data.уведомления,
    data.Уведомления,
    u.notifications,
    u.notification,
    u.уведомления,
    u.Уведомления,
    u.notice,
    u.notices,
  ];

  let results = [];

  for (const candidate of candidates) {
    if (!candidate) continue;

    // если массив объектов, фильтруем по userId
    if (Array.isArray(candidate)) {
      const filtered = candidate.filter(item => {
        const idsRaw = String(item.userId || item.userids || item.Получатели || "").trim();
        if (!idsRaw) return false;
        const ids = idsRaw.split(",").map(id => id.trim());
        return ids.includes(String(userId));
      });
      if (filtered.length) {
        results = filtered;
        break;
      }
    } else if (typeof candidate === "string") {
      const parsed = parseNotificationsValue(candidate);
      if (parsed.length) {
        results = parsed.map(text => ({ title: "Уведомление", text, read: false, sound: true }));
        break;
      }
    }
  }

  return results;
}


function renderNotifications(items = []) {
  const listEl = document.getElementById("notify-list");
  const countEl = document.getElementById("notify-count");
  if (!listEl || !countEl) return;

  notificationsCache = items.map(normalizeNotification);
  const unreadCount = notificationsCache.filter(item => !item.read).length;

  countEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  countEl.style.display = unreadCount ? "flex" : "none";

  listEl.innerHTML = notificationsCache.length
    ? notificationsCache.map(item => `
      <div class="notify-item ${item.read ? "" : "unread"}">
        <div class="notify-title">${escapeHtml(item.title)}</div>
        <div class="notify-text">${escapeHtml(item.text)}</div>
        ${item.date ? `<div class="notify-date">${escapeHtml(item.date)}</div>` : ""}
      </div>
    `).join("")
    : '<div class="notify-empty">Пока нет уведомлений</div>';
}

async function loadNotifications({ silent = false } = {}) {
  if (!userId) return;

  try {
    const res = await fetch(buildUrl({ action: "get_notifications", userId }));
    const data = await res.json();

    // ==== ИСПРАВЛЕНИЕ: получаем массив уведомлений прямо из API ====
    const rawNotifications = Array.isArray(data.notifications) ? data.notifications : [];

    if (!rawNotifications.length && data.success === false) {
      throw new Error(data.error || "Notifications action is unavailable");
    }

    if (!rawNotifications.length && notificationsCache.length) {
      notificationsLoadedOnce = true;
      return;
    }

    const nextNotifications = rawNotifications.map(normalizeNotification);
    const previousIds = new Set(notificationsCache.map(item => item.id));
    const hasNewSoundNotification = notificationsLoadedOnce
      && nextNotifications.some(item => !item.read && item.sound && !previousIds.has(item.id));

    renderNotifications(nextNotifications);

    if (!silent && hasNewSoundNotification) {
      playNotificationSound();
    }

    notificationsLoadedOnce = true;
  } catch (e) {
    const fallbackList = collectNotificationsFromData(cabinetData || {});

    if (fallbackList.length) {
      renderNotifications(fallbackList);
    }

    console.warn("Notifications API is unavailable", e);
  }
}
function startNotificationsPolling() {
  if (notificationsTimer) clearInterval(notificationsTimer);
  loadNotifications({ silent: true });
  notificationsTimer = setInterval(() => loadNotifications(), 60000);
}

function toggleNotifications() {
  unlockNotificationSound();
  document.getElementById("notify-panel")?.classList.toggle("hidden");
  loadNotifications({ silent: true });
}

async function markNotificationsRead() {
  renderNotifications(notificationsCache.map(item => ({ ...item, read: true })));

  try {
    await fetch(buildUrl({ action: "mark_notifications_read", userId }));
  } catch (e) {
    console.warn("Cannot mark notifications as read", e);
  }
}






const WEEKDAY_ALIASES = {
  0: ["воскресенье", "воскресеньям", "вс", "воск"],
  1: ["понедельник", "понедельникам", "пн"],
  2: ["вторник", "вторникам", "вт"],
  3: ["среда", "среду", "средам", "ср"],
  4: ["четверг", "четвергам", "чт"],
  5: ["пятница", "пятницу", "пятницам", "пт"],
  6: ["суббота", "субботу", "субботам", "сб"],
};

function parseWeekday(text = "") {
  const normalized = String(text).toLowerCase();
  for (const [day, aliases] of Object.entries(WEEKDAY_ALIASES)) {
    if (aliases.some(alias => new RegExp(`(^|[^а-яё])${alias}([^а-яё]|$)`, "i").test(normalized))) {
      return Number(day);
    }
  }
  return null;
}

function nextDateForWeekday(dayOfWeek) {
  const now = new Date();
  const result = new Date(now);
  result.setHours(0, 0, 0, 0);
  const daysAhead = (dayOfWeek - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + daysAhead);
  return result;
}

function parseDateParts(dateText = "") {
  const value = String(dateText).trim();
  const match = value.match(/(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const currentYear = new Date().getFullYear();
  const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : currentYear;
  const date = new Date(year, month, day);

  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

function parseTimeParts(timeText = "") {
  const match = String(timeText).match(/(?:^|[^\d.\/-])(\d{1,2})[:.](\d{2})(?![.\/-]\d)/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function combineDateAndTime(date, timeParts) {
  if (!date || !timeParts) return null;
  const result = new Date(date);
  result.setHours(timeParts.hours, timeParts.minutes, 0, 0);
  return result;
}

function parseLessonDateTime(item = {}) {
  if (item.startDate instanceof Date && !isNaN(item.startDate.getTime())) return item.startDate;

  const rawStart = item.start || item.datetime || item.dateTime || item.date_time || item.begin || item["Дата и время"] || "";
  if (rawStart) {
    const exactDate = parseDateParts(rawStart);
    const exactTime = parseTimeParts(String(rawStart).replace(/\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?/, ""));
    const combined = combineDateAndTime(exactDate, exactTime);
    if (combined) return combined;

    const d = new Date(rawStart);
    if (!isNaN(d.getTime()) && !/^\d{1,2}[:.]\d{2}$/.test(String(rawStart).trim())) return d;
  }

  const rawDate = item.date || item.lessonDate || item["Дата"] || "";
  const rawTime = item.time || item.lessonTime || item["Время"] || "";
  const date = parseDateParts(rawDate);
  const time = parseTimeParts(rawTime);
  const combined = combineDateAndTime(date, time);
  if (combined) return combined;

  if (rawDate && rawTime) {
    const d = new Date(`${rawDate} ${rawTime}`.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}


function inferScheduleSubject(line = "", fallback = getCourseLabel(getCurrentCourse())) {
  const subjects = [
    ["english", ["английский", "англ", "english"]],
    ["physics", ["физика", "физику", "physics"]],
    ["math", ["математика", "математику", "math"]],
    ["biology", ["биология", "биологию", "biology"]],
    ["chemistry", ["химия", "химию", "chemistry"]],
    ["french", ["французский", "французскому", "french"]],
    ["spanish", ["испанский", "испанскому", "spanish"]],
  ];
  const normalized = String(line).toLowerCase();
  const found = subjects.find(([, aliases]) => aliases.some(alias => normalized.includes(alias)));
  return found ? getCourseLabel(found[0]) : fallback;
}

function parseScheduleText(scheduleText = "") {
  const courseLabel = getCourseLabel(getCurrentCourse());

  return String(scheduleText)
    .split(/\n|;|,(?=\s*(?:\d{1,2}[.\/-]|пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье))/i)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const explicitDate = parseDateParts(line);
      const time = parseTimeParts(line.replace(/\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?/, ""));
      const weekday = parseWeekday(line);
      const date = explicitDate || (weekday === null ? null : nextDateForWeekday(weekday));
      const startDate = combineDateAndTime(date, time);
      if (!startDate) return null;

      const now = new Date();
      if (startDate < now && weekday !== null) {
        startDate.setDate(startDate.getDate() + 7);
      } else if (startDate < now && explicitDate && !/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/.test(line)) {
        startDate.setFullYear(startDate.getFullYear() + 1);
      }

      const title = line
        .replace(/\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?/, "")
        .replace(/\d{1,2}[:.]\d{2}/, "")
        .replace(/понедельник(?:ам)?|вторник(?:ам)?|сред[ауам]*|четверг(?:ам)?|пятниц[ауам]*|суббот[ауам]*|воскресенье|воскресеньям|пн|вт|ср|чт|пт|сб|вс/gi, "")
        .replace(/[—–-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const subject = inferScheduleSubject(line, courseLabel);

      return {
        id: `schedule-${index}-${startDate.getTime()}`,
        title: title || subject,
        subject,
        course: getCurrentCourse(),
        fromScheduleText: true,
        topic: title,
        startDate,
        date: line,
        time: line,
        duration: "",
        link: String(cabinetData?.user?.link || "").trim(),
      };
    })
    .filter(Boolean);
}

function collectScheduleItems() {
  const data = cabinetData || {};
  const user = data.user || {};
  const sources = [data.scheduleEvents, data.events, data.calendar, data.scheduleItems, data.lessonsSchedule, user.scheduleEvents, user.events, user.calendar, user.nextLessons];
  const course = getCurrentCourse();
  const items = sources.find(source => Array.isArray(source) && source.length) || parseScheduleText(user.schedule);

  return items
    .filter(item => {
      if (item.fromScheduleText) return true;
      const itemCourse = item.course || item.subjectKey || item["Предмет"] || "";
      return !itemCourse || normalizeCourseName(itemCourse) === normalizeCourseName(course) || getCourseLabel(itemCourse) === getCourseLabel(course);
    })
    .map((item, index) => {
      const startDate = parseLessonDateTime(item);
      const title = item.title || item.subject || item["Предмет"] || getCourseLabel(course);
      return {
        id: String(item.id || item.lessonId || index),
        title: String(title || "Урок"),
        subject: String(item.subject || item["Предмет"] || getCourseLabel(course)),
        topic: String(item.topic || item.theme || item["Тема"] || "Тема уточняется"),
        startDate,
        date: item.date || item["Дата"] || (startDate ? startDate.toISOString() : ""),
        time: item.time || item["Время"] || (startDate ? startDate.toISOString() : ""),
        duration: item.duration || item["Продолжительность"] || "60 минут",
        link: String(item.link || item.url || item.meet || item["Ссылка"] || user.link || "").trim(),
      };
    })
    .filter(item => item.startDate);
}

function getNextLesson() {
  const now = new Date();
  return collectScheduleItems().filter(item => item.startDate >= now).sort((a, b) => a.startDate - b.startDate)[0] || null;
}

function renderNextLesson() {
  const container = document.getElementById("next-lesson-card");
  if (!container) return;
  const lesson = getNextLesson();
  if (!lesson) {
    container.innerHTML = '<p style="color:var(--muted);line-height:1.7">Ближайший урок пока не назначен.</p>';
    return;
  }
  container.innerHTML = `
    <div class="next-lesson-row"><small>Дата</small>${formatDate(lesson.startDate)}</div>
    <div class="next-lesson-row"><small>Время</small>${formatTime(lesson.startDate)}</div>
    <div class="next-lesson-row"><small>Предмет</small>${escapeHtml(lesson.subject)}</div>
  `;
}

function openLessonCard(eventId) {
  const lesson = collectScheduleItems().find(item => item.id === String(eventId));
  if (!lesson) return;
  alert(`${lesson.subject}\n${formatDate(lesson.startDate)} ${formatTime(lesson.startDate)}`);
}

function renderCalendar() {
  const calendarEl = document.getElementById("lesson-calendar");
  const upcomingEl = document.getElementById("upcoming-lessons");
  if (!calendarEl || !upcomingEl) return;
  const items = collectScheduleItems().sort((a, b) => a.startDate - b.startDate);
  const events = items.map((item, index) => ({ id: item.id, title: item.title, start: item.startDate.toISOString(), backgroundColor: index % 2 ? "#35b779" : "#1677ff", borderColor: index % 2 ? "#35b779" : "#1677ff" }));

  if (window.FullCalendar) {
    if (lessonCalendar) lessonCalendar.destroy();
    lessonCalendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      height: 330,
      contentHeight: 280,
      locale: "ru",
      dayMaxEvents: 2,
      headerToolbar: { left: "prev,next", center: "title", right: "today" },
      events,
      eventClick(info) { openLessonCard(info.event.id); },
    });
    lessonCalendar.render();
  } else {
    calendarEl.innerHTML = '<p style="padding:1rem;color:var(--muted)">Календарь временно недоступен</p>';
  }

  upcomingEl.innerHTML = items.filter(item => item.startDate >= new Date()).slice(0, 4).map((item, index) => `
    <button type="button" class="upcoming-item" onclick="openLessonCard('${escapeAttr(item.id)}')">
      <span class="upcoming-mark" style="background:${index % 2 ? '#35b779' : '#1677ff'}"></span>
      <span><span class="upcoming-date">${formatDate(item.startDate)}</span><br><span class="upcoming-time">${formatTime(item.startDate)}</span></span>
      <span class="upcoming-title">${escapeHtml(item.subject)}</span>
    </button>
  `).join("") || '<p style="color:var(--muted);line-height:1.7">Ближайших занятий пока нет.</p>';
}

// ================= UI =================
function showSection(sectionId) {
  document.querySelectorAll(".section").forEach(el => el.classList.add("hidden"));
  const el = document.getElementById(sectionId);
  if (el) el.classList.remove("hidden");
  if (sectionId === "schedule") loadSlots();
}

function confirmBuy(index, name, price) {
  if (confirm(`Хотите купить?\n\n${name}\nЦена: ${price} монет`)) buyItem(index);
}

function setCourse(course) {
  currentCourse = course;
  window.currentCourse = course;
  const levels = cabinetData?.user?.levels || {};
   setText("level", getCourseMappedValue(levels, course, "—") || "—");
  renderCourseProgressMeta(course);
  renderCourseTabs();
  renderCourseData();
  renderSubmissionFormLink(course);
  renderNextLesson();
  renderCalendar();
}

function renderCourseTabs() {
  const courses = cabinetData?.user?.courses || [];
  const profile = document.getElementById("profile");
  if (!profile) return;
  let tabs = document.getElementById("course-tabs");
  if (!tabs) {
    tabs = document.createElement("div");
    tabs.id = "course-tabs";
    tabs.style.cssText = "display:flex; gap:8px; margin:10px 0; flex-wrap:wrap; justify-content:center;";
    profile.prepend(tabs);
  }
  if (courses.length <= 1) {
    tabs.innerHTML = "";
    return;
  }
  tabs.innerHTML = courses.map(c => 
    `<button class="buy-btn" style="opacity:${c === getCurrentCourse() ? '1' : '0.5'}" onclick="setCourse('${escapeAttr(c)}')">
          ${escapeHtml(getCourseLabel(c))}
     </button>`
  ).join("");
}

// ================= LOAD DATA =================
async function loadData() {
  const loadingEl = document.getElementById("loading");
  try {
    const params = new URLSearchParams(window.location.search);
    userId = params.get("id") || params.get("userId") || "";
    if (!userId) {
      setText("loading", "❌ Не указан ID");
      return;
    }
    const checkRes = await fetch(buildUrl({ action: "check_user", userId }));
    const checkData = await checkRes.json();
    if (!checkData.success) {
      setText("loading", checkData.error || "❌ Вы не зарегистрированы");
      return;
    }
    await loadCabinet();
  } catch (e) {
    console.error(e);
    setText("loading", "❌ Ошибка соединения");
  } finally {
    if (loadingEl) loadingEl.classList.add("hidden");
  }
}

async function loadCabinet() {
  try {
    const res = await fetch(buildUrl({ userId }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Ошибка загрузки кабинета");

    cabinetData = data;
    const u = data.user || {};
    username = u.username || "";
    currentCourse = u.courses?.[0] || "english";
    window.currentCourse = currentCourse;

    setText("username", u.username || "—");
    setText("level", getCourseMappedValue(u.levels, currentCourse, "—") || "—");
    setText("coins", u.coins || 0);
    renderCourseProgressMeta(currentCourse);
    const lessonLinkEl = document.getElementById("lesson-link");

if (lessonLinkEl) {
  if (u.link) {
    lessonLinkEl.innerHTML = `
      <a href="${u.link}"
         target="_blank"
         rel="noopener"
         class="lesson-btn">
         🎥 Подключиться к занятию
      </a>
    `;
  } else {
    lessonLinkEl.textContent = "Ссылка пока не назначена";
  }
}
    setText("lesson-schedule", u.schedule || "Не указано");

    const avatarImg = document.getElementById("avatar-img");
    if (avatarImg) avatarImg.src = u.avatarUrl || "https://via.placeholder.com/120/2e7d32/FFFFFF?text=👤";

    renderCourseTabs();
    renderCourseData();
    renderNotifications(collectNotificationsFromData(data));
    renderSubmissionFormLink(currentCourse);
 
    document.getElementById("loading")?.classList.add("hidden");
    document.getElementById("main")?.classList.remove("hidden");
    renderNextLesson();
    renderCalendar();
    startNotificationsPolling();
  } catch (e) {
    console.error(e);
    setText("loading", `❌ ${e.message}`);
   }
 }

function renderProgress(progress) {
  const progressValue = Math.min(Number(progress) || 0, 100);
  const xpFill = document.getElementById("xp-fill");
  if (!xpFill) return;
  xpFill.style.width = `${progressValue}%`;
  if (progressValue >= 100) {
    xpFill.style.background = "linear-gradient(90deg, gold, orange)";
    xpFill.style.boxShadow = "0 0 18px rgba(255,215,0,.9)";
  } else if (progressValue >= 75) {
    xpFill.style.background = "linear-gradient(90deg, #7b1fa2, #ba68c8)";
    xpFill.style.boxShadow = "0 0 14px rgba(186,104,200,.8)";
  } else {
    xpFill.style.background = "linear-gradient(90deg, #2e7d32, #66bb6a)";
    xpFill.style.boxShadow = "0 0 10px rgba(76,175,80,.6)";
  }
}

function getLessonHomeworkLink(lesson = {}) {
  return String(
    lesson.hwLink ||
    lesson.hwlink ||
    lesson.hw_link ||
    lesson.homeworkLink ||
    lesson.homework_link ||
    lesson.homework ||
    lesson.hw ||
    lesson.dzLink ||
    lesson.dzlink ||
    lesson.dz_link ||
    lesson.dz ||
    lesson["ДЗ"] ||
    lesson["дз"] ||
    lesson["ДЗ ссылка"] ||
    lesson["дз ссылка"] ||
    ""
  ).trim();
}

function renderCourseData() {
  if (!cabinetData) return;
  const course = getCurrentCourse();
  
  const achievements = document.getElementById("achievements-list");
  if (achievements) {
    const list = (cabinetData.achievements || []).filter(a => a.course === course);
    achievements.innerHTML = list.length
      ? list.map(a => `<div style="display:flex;flex-direction:column;align-items:center;width:100px;">
          <div style="width:80px;height:80px;border-radius:50%;overflow:hidden;box-shadow:0 6px 16px rgba(0,0,0,.15);background:#fff;display:flex;align-items:center;justify-content:center;margin-bottom:8px;">
            <img src="${escapeAttr(a.image)}" alt="${escapeAttr(a.title)}" style="width:100%;height:100%;object-fit:cover;">
          </div>
          <div style="font-size:0.8rem;text-align:center;font-weight:600;">${escapeHtml(a.title)}</div>
        </div>`).join("")
      : '<p style="opacity:.6">Пока нет достижений</p>';
  }

  const lessons = document.getElementById("lessons-list");
  if (lessons) {
    const list = (cabinetData.lessons || []).filter(l => l.course === course);
    lessons.innerHTML = list.length
     ? list.map(l => {
          const materialLink = String(l.link || "").trim();
          const homeworkLink = getLessonHomeworkLink(l);
          const actions = [
            materialLink ? `<a href="${escapeAttr(materialLink)}" target="_blank" rel="noopener" class="lesson-btn lesson-action-btn">Материалы</a>` : "",
            homeworkLink ? `<a href="${escapeAttr(homeworkLink)}" target="_blank" rel="noopener" class="lesson-btn lesson-action-btn">ДЗ</a>` : "",
          ].filter(Boolean).join("");

          return `<div class="lesson-card">
          <strong>Урок ${escapeHtml(l.num)}</strong>
          <div class="lesson-actions">${actions || '<span style="opacity:.6">Ссылки пока не добавлены</span>'}</div>
        </div>`;
        }).join("")
      : "<p>Нет доступных уроков.</p>";
  }

  const materials = document.getElementById("materials-list");
  if (materials) {
    const list = (cabinetData.materials || []).filter(m => m.course === course);
    materials.innerHTML = list.length
      ? list.map(m => `<div class="lesson-card">
          <strong>${escapeHtml(m.title)}</strong><br>
          <a href="${escapeAttr(m.link)}" target="_blank" rel="noopener" class="lesson-btn">Открыть</a>
        </div>`).join("")
      : "<p>Материалы пока не добавлены.</p>";
  }

  const shop = document.getElementById("shop-items");
  if (shop) {
    const list = (cabinetData.shop || []).filter(s => s.course === course);
    setText("shop-coins", cabinetData.user?.coins || 0);
    shop.innerHTML = list.length
      ? list.map((item, idx) => {
          const realIdx = cabinetData.shop.indexOf(item);
          return `<div class="shop-item">
            ${item.image ? `<div style="height:120px;display:flex;align-items:center;justify-content:center;margin-bottom:.5rem">
              <img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name)}" style="max-width:100%;max-height:100%;object-fit:contain">
            </div>` : ""}
            <h3>${escapeHtml(item.name)}</h3>
            <div class="price">${escapeHtml(item.price)} монет</div>
            <button class="buy-btn" onclick="confirmBuy(${realIdx}, '${escapeAttr(item.name)}', ${Number(item.price) || 0})">Купить</button>
          </div>`;
        }).join("")
      : "<p>Магазин пуст.</p>";
  }
}

// ================= СЛОТЫ =================
function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return escapeHtml(dateStr || "");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(timeStr) {
  const d = new Date(timeStr);
  if (isNaN(d.getTime())) return escapeHtml(timeStr || "");
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function loadSlots() {
  const container = document.getElementById("slots-container");
  if (!container) return;
  container.innerHTML = "Загрузка слотов...";
  try {
    const res = await fetch(buildUrl({ action: "get_slots", userId, course: getCurrentCourse() }));
    const data = await res.json();
    if (!data.success) {
      container.textContent = data.error || "Ошибка загрузки слотов";
      return;
    }
    const slots = data.slots || [];
    if (!slots.length) {
      container.textContent = "Нет доступных слотов";
      loadGroupSlots();
      return;
    }
    container.innerHTML = slots.map(slot => {
      const isFree = slot.status === "free";
      return `<div style="margin-bottom:.8rem;padding:.8rem;border-radius:12px;background:${isFree ? '#e8f5e9' : '#eee'}">
        <strong>${formatDate(slot.date)}</strong> ${formatTime(slot.time)}<br>
        ${isFree ? `<button class="buy-btn" onclick="bookSlot('${escapeAttr(slot.id)}')">Записаться</button>` : '<span style="opacity:.6">Занято</span>'}
      </div>`;
    }).join("");
    loadGroupSlots();
  } catch (e) {
    console.error(e);
    container.textContent = "Ошибка соединения";
  }
}

async function bookSlot(slotId) {
  if (!confirm("Записаться на этот слот?")) return;
  try {
    const res = await fetch(buildUrl({ action: "book_slot", userId, slotId, course: getCurrentCourse() }));
    const data = await res.json();
    if (data.success) {
      alert("✅ Вы записались!");
      loadSlots();
    } else {
      alert("❌ " + (data.error || "Не удалось записаться"));
    }
  } catch (e) {
    alert("❌ Ошибка соединения");
  }
}

async function loadGroupSlots() {
  const container = document.getElementById("group-slots-container");
  if (!container) return;
  container.innerHTML = "Загрузка...";
  try {
    const res = await fetch(buildUrl({ action: "get_group_slots", userId, course: getCurrentCourse() }));
    const data = await res.json();
    if (!data.success) {
      container.textContent = data.error || "Ошибка загрузки";
      return;
    }
    const slots = data.slots || [];
    if (!slots.length) {
      container.textContent = "Нет групповых занятий";
      return;
    }
    container.innerHTML = slots.map(slot => {
      const capacity = Number(slot.capacity) || 0;
      const bookedCount = Number(slot.bookedCount) || 0;
      const available = capacity - bookedCount > 0;
      return `<div style="margin-bottom:.8rem;padding:.8rem;border-radius:12px;background:${available ? '#e3f2fd' : '#eee'}">
        <strong>${escapeHtml(slot.title)}</strong><br>
        ${formatDate(slot.date)} ${formatTime(slot.time)}<br>
        ${available ? `<button class="buy-btn" onclick="bookGroupSlot('${escapeAttr(slot.id)}')">Записаться (${bookedCount}/${capacity})</button>` : `<span style="opacity:.6">Мест нет (${capacity}/${capacity})</span>`}
      </div>`;
    }).join("");
  } catch (e) {
    console.error(e);
    container.textContent = "Ошибка соединения";
  }
}

async function bookGroupSlot(slotId) {
  if (!confirm("Записаться на групповое занятие?")) return;
  try {
    const res = await fetch(buildUrl({ action: "book_group_slot", userId, slotId, course: getCurrentCourse() }));
    const data = await res.json();
    if (data.success) {
      alert("✅ Вы записались!");
      loadGroupSlots();
    } else {
      alert("❌ " + (data.error || "Не удалось записаться"));
    }
  } catch (e) {
    alert("❌ Ошибка соединения");
  }
}

// ================= SHOP =================
async function buyItem(index) {
  try {
    const res = await fetch(buildUrl({ action: "buy_item", userId, lessonNum: index, course: getCurrentCourse() }));
    const data = await res.json();
    if (data.success) {
      alert("✅ Куплено!");
      await loadCabinet();
    } else {
      alert("❌ " + (data.error || "Не удалось купить"));
    }
  } catch (e) {
    alert("❌ Ошибка соединения");
  }
}


// ===== AI CHAT =====
const aiChatMessages = [];

function showChatTab(tab = "ai") {
  const isAi = tab === "ai";
  document.getElementById("ai-chat-pane")?.classList.toggle("hidden", !isAi);
  document.getElementById("support-chat-pane")?.classList.toggle("hidden", isAi);
  document.getElementById("ai-chat-tab")?.classList.toggle("active", isAi);
  document.getElementById("support-chat-tab")?.classList.toggle("active", !isAi);

  if (!isAi) loadSupport();
}

function renderAiMessages() {
  const container = document.getElementById("ai-messages");
  if (!container) return;

  container.innerHTML = aiChatMessages.length
    ? aiChatMessages.map(message => `
      <div class="ai-message ${message.role === "user" ? "user" : "assistant"}">
        <strong>${message.role === "user" ? "Вы" : "ИИ-помощник"}:</strong><br>
        ${escapeHtml(message.text)}
      </div>
    `).join("")
    : '<div style="opacity:.6">ИИ-чат готов помочь с учебными вопросами.</div>';

  container.scrollTop = container.scrollHeight;
}

function getAiContext() {
  const user = cabinetData?.user || {};
  return [
    `Ученик: ${username || user.username || "не указан"}`,
    `Предмет: ${getCourseLabel(getCurrentCourse())}`,
    `Уровень: ${getCourseMappedValue(user.levels, getCurrentCourse(), "не указан") || "не указан"}`,
    `Прогресс: ${getCourseProgress(getCurrentCourse())}/100`,
    `Расписание: ${user.schedule || "не указано"}`,
  ].join("\n");
}

function buildLocalAiAnswer(question = "") {
  const normalizedQuestion = question.toLowerCase();
  const nextLesson = getNextLesson();
  const subject = getCourseLabel(getCurrentCourse());

  if (/когда|ближайш|следующ|расписан|урок/.test(normalizedQuestion)) {
    return nextLesson
      ? `Ближайший урок: ${subject}, ${formatDate(nextLesson.startDate)} в ${formatTime(nextLesson.startDate)}.`
      : `В расписании пока нет будущих уроков по предмету «${subject}». Проверьте раздел «Расписание» или напишите преподавателю в поддержку.`;
  }

  if (/дз|домаш|задан|сдать/.test(normalizedQuestion)) {
    const formLink = getSubmissionFormLink(getCurrentCourse());
    return formLink
      ? `Домашнее задание по предмету «${subject}» можно сдать в разделе «ДЗ» через кнопку «Открыть форму ДЗ».`
      : `Форма ДЗ по предмету «${subject}» пока не назначена. Уточните задание у преподавателя через вкладку «Поддержка».`;
  }

  if (/прогресс|балл|уров|рейтинг|мест/.test(normalizedQuestion)) {
    const user = cabinetData?.user || {};
    const level = getCourseMappedValue(user.levels, getCurrentCourse(), "не указан") || "не указан";
    const rank = getCourseRank(getCurrentCourse()) || "пока не указан";
    return `По предмету «${subject}»: прогресс ${getCourseProgress(getCurrentCourse())}/100, уровень — ${level}, рейтинг — ${rank}.`;
  }

  return `Я помогу с навигацией по кабинету: расписанием, ближайшим уроком, ДЗ, прогрессом и материалами. По самому учебному объяснению лучше написать преподавателю во вкладке «Поддержка», если подключенный ИИ-сервис сейчас недоступен.`;
}

function openAiChatFromNav() {
  const chat = document.getElementById("support-chat");
  chat?.classList.remove("hidden");
  showChatTab("ai");
  renderAiMessages();
}

async function sendAiMessage() {
  const input = document.getElementById("ai-input");
  const text = input?.value.trim();
  if (!text || !userId) return;

  aiChatMessages.push({ role: "user", text });
  aiChatMessages.push({ role: "assistant", text: "Думаю над ответом..." });
  renderAiMessages();
  input.value = "";

  if (!REMOTE_AI_ENABLED) {
    aiChatMessages[aiChatMessages.length - 1] = { role: "assistant", text: buildLocalAiAnswer(text) };
    renderAiMessages();
    return;
  }

  try {
    const recentMessages = aiChatMessages
      .filter(message => message.text !== "Думаю над ответом...")
      .slice(-8)
      .map(message => `${message.role}: ${message.text}`)
      .join("\n");

    const res = await fetch(buildUrl({
      action: "ai_chat",
      userId,
      course: getCurrentCourse(),
      message: text,
      context: getAiContext(),
      history: recentMessages,
    }));
    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const answer = data.answer || data.message || data.text || data.reply;
    if (!answer) throw new Error("API не вернул ответ ИИ");

    aiChatMessages[aiChatMessages.length - 1] = { role: "assistant", text: answer };
  } catch (e) {
    console.warn("Remote AI chat is unavailable, using local helper", e);
    aiChatMessages[aiChatMessages.length - 1] = {
      role: "assistant",
      text: buildLocalAiAnswer(text),
    };
  }

  renderAiMessages();
}

// ===== SUPPORT =====
function toggleSupport() {
  const chat = document.getElementById("support-chat");
  chat?.classList.toggle("hidden");
  if (!chat?.classList.contains("hidden")) {
    showChatTab("ai");
    renderAiMessages();
  }
}

async function loadSupport() {
  const container = document.getElementById("support-messages");
  if (!container || !userId) return;
  try {
    const res = await fetch(buildUrl({ action: "get_support", userId }));
    const data = await res.json();
    const messages = data.messages || [];
    container.innerHTML = messages.length
      ? messages.map(m => `<div style="margin-bottom:10px;padding:8px;border-radius:8px;background:#f1f8e9">
          <strong>Вы:</strong><br>${escapeHtml(m.question)}<br>
          ${m.answer ? `<div style="margin-top:6px;background:#e8f5e9;padding:6px;border-radius:6px"><strong>Ответ:</strong><br>${escapeHtml(m.answer)}</div>` : '<div style="margin-top:6px;font-style:italic;color:gray">Ожидает ответа...</div>'}
        </div>`).join("")
      : '<div style="opacity:.6">Сообщений пока нет</div>';
  } catch (e) {
    console.error(e);
    container.textContent = "Ошибка загрузки поддержки";
  }
}

async function sendSupport() {
  const input = document.getElementById("support-input");
  const text = input?.value.trim();
  if (!text) return;
  try {
    const res = await fetch(buildUrl({ action: "send_support", userId, text }));
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Не удалось отправить вопрос");
    input.value = "";
    loadSupport();
  } catch (e) {
    alert("❌ " + e.message);
  }
}

// ================= INIT =================
window.addEventListener("DOMContentLoaded", () => {
   document.addEventListener("click", unlockNotificationSound, { once: true });
   loadData();
 });
