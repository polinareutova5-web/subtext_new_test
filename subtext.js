const API_URL = "https://script.google.com/macros/s/AKfycbwBd79RAFwvp8GFkvRC57g_rZjxLyB7lnuw5is9Oa2B_420h5fhntyoLvrBJhN_t5Dv/exec";
let userId = "";
let username = "";
let currentCourse = "";
let cabinetData = null;
let notificationsCache = [];
let notificationsLoadedOnce = false;
let notificationsTimer = null;
let soundUnlocked = false;
let lessonCalendar = null;
let availableSlotsCache = [];
let groupSlotsCache = [];

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






function parseFlexibleDateTime(dateValue = "", timeValue = "") {
  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) return dateValue;
  const dateText = String(dateValue || "").trim();
  const timeText = String(timeValue || "").trim();
  const combined = [dateText, timeText].filter(Boolean).join(" ").trim();
  const candidates = [combined, dateText].filter(Boolean);

  for (const candidate of candidates) {
    const direct = new Date(candidate);
    if (!isNaN(direct.getTime())) return direct;

    const match = candidate.match(/(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (match) {
      const [, dd, mm, yyyy, hh = "0", min = "0"] = match;
      const year = Number(yyyy.length === 2 ? `20${yyyy}` : yyyy);
      const parsed = new Date(year, Number(mm) - 1, Number(dd), Number(hh), Number(min));
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

const WEEKDAY_INDEX = {
  "пн": 1, "понедельник": 1,
  "вт": 2, "вторник": 2,
  "ср": 3, "среда": 3,
  "чт": 4, "четверг": 4,
  "пт": 5, "пятница": 5,
  "сб": 6, "суббота": 6,
  "вс": 0, "воскресенье": 0,
};

function nextDateForWeekday(weekday, timeText) {
  const timeMatch = String(timeText || "").match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) return null;
  const now = new Date();
  const date = new Date(now);
  const diff = (weekday - now.getDay() + 7) % 7;
  date.setDate(now.getDate() + diff);
  date.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  if (date < now) date.setDate(date.getDate() + 7);
  return date;
}

function scheduleTextToItems(scheduleText = "", course = getCurrentCourse()) {
  const text = String(scheduleText || "").trim();
  if (!text) return [];
  const parts = text.split(/[;\n|]+/).map(part => part.trim()).filter(Boolean);
  const items = [];

  parts.forEach((part, index) => {
    const explicit = parseFlexibleDateTime(part);
    if (explicit) {
      items.push({ id: `schedule-text-${index}`, title: getCourseLabel(course), subject: getCourseLabel(course), topic: "Урок по расписанию", startDate: explicit, date: explicit.toISOString(), time: explicit.toISOString(), duration: "60 минут", link: String(cabinetData?.user?.link || "").trim() });
      return;
    }

    const lower = part.toLowerCase();
    const dayKey = Object.keys(WEEKDAY_INDEX).find(key => new RegExp(`(^|[^а-яё])${key}([^а-яё]|$)`, "i").test(lower));
    const timeMatch = part.match(/(\d{1,2}:\d{2})/);
    if (dayKey && timeMatch) {
      const startDate = nextDateForWeekday(WEEKDAY_INDEX[dayKey], timeMatch[1]);
      if (startDate) items.push({ id: `schedule-text-${index}`, title: getCourseLabel(course), subject: getCourseLabel(course), topic: "Урок по расписанию", startDate, date: startDate.toISOString(), time: startDate.toISOString(), duration: "60 минут", link: String(cabinetData?.user?.link || "").trim() });
    }
  });

  return items;
}

function parseLessonDateTime(item = {}) {
  const rawStart = item.start || item.datetime || item.dateTime || item.date_time || item.begin || item["Дата и время"] || "";
  if (rawStart) {
    const d = parseFlexibleDateTime(rawStart);
    if (d) return d;
  }

  const rawDate = item.date || item.lessonDate || item["Дата"] || "";
  const rawTime = item.time || item.lessonTime || item["Время"] || "";
  if (rawDate || rawTime) {
    const d = parseFlexibleDateTime(rawDate, rawTime);
    if (d) return d;
  }
  return null;
}

function collectScheduleItems() {
  const data = cabinetData || {};
  const user = data.user || {};
  const sources = [data.scheduleEvents, data.events, data.calendar, data.scheduleItems, data.lessonsSchedule, user.scheduleEvents, user.events, user.calendar, user.nextLessons];
  const course = getCurrentCourse();
  const items = sources.find(source => Array.isArray(source) && source.length) || [];
  const textItems = scheduleTextToItems(user.schedule || user["Расписание"] || "", course);

  return items
    .filter(item => {
      const itemCourse = item.course || item.subjectKey || item.subject || item["Предмет"] || "";
      return !itemCourse || normalizeCourseName(itemCourse) === normalizeCourseName(course) || getCourseLabel(itemCourse) === getCourseLabel(course);
    })
    .map((item, index) => {
      const startDate = parseLessonDateTime(item);
      const title = item.title || item.subject || item["Предмет"] || getCourseLabel(course);
      return {
        id: String(item.id || item.lessonId || index),
        title: String(title || "Урок"),
        subject: String(item.subject || item["Предмет"] || title || getCourseLabel(course)),
        topic: String(item.topic || item.theme || item["Тема"] || "Тема уточняется"),
        startDate,
        date: item.date || item["Дата"] || (startDate ? startDate.toISOString() : ""),
        time: item.time || item["Время"] || (startDate ? startDate.toISOString() : ""),
        duration: item.duration || item["Продолжительность"] || "60 минут",
        link: String(item.link || item.url || item.meet || item["Ссылка"] || user.link || "").trim(),
      };
    })
    .filter(item => item.startDate)
    .concat(textItems);
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
    <div class="next-lesson-row"><small>Предмет</small>${escapeHtml(lesson.subject)}</div>
    <div class="next-lesson-row"><small>Тема</small>${escapeHtml(lesson.topic)}</div>
    <div class="next-lesson-row"><small>Дата</small>${formatDate(lesson.startDate)}</div>
    <div class="next-lesson-row"><small>Время</small>${formatTime(lesson.startDate)}</div>
    <div class="next-lesson-row"><small>Продолжительность</small>${escapeHtml(lesson.duration)}</div>
    ${lesson.link ? `<a href="${escapeAttr(lesson.link)}" target="_blank" rel="noopener" class="lesson-btn">Перейти к уроку</a>` : '<span style="color:var(--muted)">Ссылка появится позже</span>'}
  `;
}

function openLessonCard(eventId) {
  const lesson = collectScheduleItems().find(item => item.id === String(eventId));
  if (!lesson) return;
  alert(`${lesson.subject}\n${lesson.topic}\n${formatDate(lesson.startDate)} ${formatTime(lesson.startDate)}\n${lesson.duration}`);
}

function renderCalendar() {
  const calendarEl = document.getElementById("lesson-calendar");
  const upcomingEl = document.getElementById("upcoming-lessons");
  if (!calendarEl || !upcomingEl) return;
  const items = collectScheduleItems().sort((a, b) => a.startDate - b.startDate);
  const lessonEvents = items.map((item, index) => ({ id: item.id, title: item.title, start: item.startDate.toISOString(), backgroundColor: index % 2 ? "#35b779" : "#1677ff", borderColor: index % 2 ? "#35b779" : "#1677ff", extendedProps: { kind: "lesson" } }));
  const slotEvents = availableSlotsCache.map(slot => {
    const startDate = parseFlexibleDateTime(slot.date, slot.time);
    const isFree = slot.status === "free";
    return startDate ? { id: `slot-${slot.id}`, title: isFree ? "Свободный слот" : "Слот занят", start: startDate.toISOString(), backgroundColor: isFree ? "#ffb020" : "#9aa5b1", borderColor: isFree ? "#ffb020" : "#9aa5b1", extendedProps: { kind: "slot", slotId: slot.id, isFree } } : null;
  }).filter(Boolean);
  const groupEvents = groupSlotsCache.map(slot => {
    const startDate = parseFlexibleDateTime(slot.date, slot.time);
    const capacity = Number(slot.capacity) || 0;
    const bookedCount = Number(slot.bookedCount) || 0;
    const available = capacity - bookedCount > 0;
    return startDate ? { id: `group-slot-${slot.id}`, title: available ? `Группа: ${slot.title || "занятие"}` : "Группа заполнена", start: startDate.toISOString(), backgroundColor: available ? "#8b5cf6" : "#9aa5b1", borderColor: available ? "#8b5cf6" : "#9aa5b1", extendedProps: { kind: "groupSlot", slotId: slot.id, available } } : null;
  }).filter(Boolean);
  const events = lessonEvents.concat(slotEvents, groupEvents);

  if (window.FullCalendar) {
    if (lessonCalendar) lessonCalendar.destroy();
    lessonCalendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      height: "auto",
      locale: "ru",
      headerToolbar: { left: "prev,next", center: "title", right: "today" },
      events,
      eventClick(info) {
        const props = info.event.extendedProps || {};
        if (props.kind === "slot" && props.isFree) return bookSlot(props.slotId);
        if (props.kind === "groupSlot" && props.available) return bookGroupSlot(props.slotId);
        openLessonCard(info.event.id);
      },
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
  loadSlots();
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
    loadSlots();
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
    availableSlotsCache = slots;
    if (!slots.length) {
      container.textContent = "Нет доступных слотов";
      loadGroupSlots();
      renderCalendar();
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
    renderCalendar();
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
    groupSlotsCache = slots;
    if (!slots.length) {
      container.textContent = "Нет групповых занятий";
      renderCalendar();
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
    renderCalendar();
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

// ===== SUPPORT =====
function toggleSupport() {
  document.getElementById("support-chat")?.classList.toggle("hidden");
  loadSupport();
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

// ================= AI CHAT =================
async function sendToAI() {
  const input = document.getElementById("chat-input");
  const messagesContainer = document.getElementById("chat-messages");
  const userMessage = input.value.trim();
  
  if (!userMessage) {
    alert("Введите вопрос");
    return;
  }
  
  // 1. Добавляем сообщение пользователя
  const userMsgDiv = document.createElement("div");
  userMsgDiv.style.cssText = "margin-bottom: 12px; padding: 10px; background: #e3f2fd; border-radius: 8px; text-align: right;";
  userMsgDiv.innerHTML = `<strong>Вы:</strong><br>${escapeHtml(userMessage)}`;
  messagesContainer.appendChild(userMsgDiv);
  input.value = "";
  
  // 2. Индикатор загрузки
  const loadingDiv = document.createElement("div");
  loadingDiv.id = "ai-loading";
  loadingDiv.style.cssText = "margin-bottom: 12px; padding: 10px; background: #f5f5f5; border-radius: 8px; opacity: 0.7;";
  loadingDiv.innerHTML = "🤖 Нейросеть думает...";
  messagesContainer.appendChild(loadingDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
  try {
    // 3. Запрос идет через Google Apps Script (твой API_URL)
    const response = await fetch(buildUrl({ 
      action: "qwen_chat", 
      message: userMessage 
    }));
    
    const data = await response.json();
    document.getElementById("ai-loading")?.remove();
    
    if (data.success && data.reply) {
      const aiMsgDiv = document.createElement("div");
      aiMsgDiv.style.cssText = "margin-bottom: 12px; padding: 10px; background: #e8f5e9; border-radius: 8px;";
      const formattedReply = data.reply.replace(/\n/g, '<br>');
      aiMsgDiv.innerHTML = `<strong>🤖 ИИ-помощник:</strong><br>${formattedReply}`;
      messagesContainer.appendChild(aiMsgDiv);
    } else {
      throw new Error(data.error || "Не удалось получить ответ");
    }
  } catch (error) {
    document.getElementById("ai-loading")?.remove();
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = "margin-bottom: 12px; padding: 10px; background: #ffebee; border-radius: 8px; color: #c62828;";
    errorDiv.innerHTML = `❌ Ошибка: ${escapeHtml(error.message)}`;
    messagesContainer.appendChild(errorDiv);
  }
  
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Обработка нажатия Enter в поле ввода
document.addEventListener("DOMContentLoaded", () => {
  const chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") sendToAI();
    });
  }
});
// ================= INIT =================
window.addEventListener("DOMContentLoaded", () => {
   document.addEventListener("click", unlockNotificationSound, { once: true });
   loadData();
 });


