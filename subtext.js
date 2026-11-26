const API_URL = window.APP_CONFIG.apiUrl;
let userId = "";
let username = "";
let currentCourse = "";
let cabinetData = null;
let lessonCalendar = null;
const OTHER_MATERIALS_GROUP = "Другое";
const selectedMaterialsSort = {};

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


function inferScheduleCourse(line = "", fallback = "") {
  const subjects = [
    ["english2", ["английский 2", "english 2", "english2", "english_2", "english-2"]],
    ["english", ["английский", "англ", "english"]],
    ["physics", ["физика", "физику", "physics"]],
    ["math", ["математика", "математику", "math"]],
    ["biology", ["биология", "биологию", "biology"]],
    ["chemistry", ["химия", "химию", "chemistry"]],
    ["french2", ["французский 2", "french 2", "french2", "french_2", "french-2"]],
    ["french", ["французский", "французскому", "french"]],
    ["spanish", ["испанский", "испанскому", "spanish"]],
  ];

  // Для 2+ предметов предмет обязан стоять перед двоеточием.
  const prefix = String(line).split(":")[0].trim().toLowerCase();
  const explicit = subjects.find(([, aliases]) =>
    aliases.some(alias => prefix === alias)
  );
  if (explicit) return explicit[0];

  // Старый формат одного предмета: название предмета отсутствует,
  // поэтому используем fallback только если он явно передан.
  return normalizeCourseName(fallback);
}

function inferScheduleSubject(line = "", fallback = getCourseLabel(getCurrentCourse())) {
  return getCourseLabel(inferScheduleCourse(line, fallback));
}

function parseScheduleText(scheduleText = "", fallbackCourse = "") {
  const courseLabel = fallbackCourse ? getCourseLabel(fallbackCourse) : "";

  // В много-предметном расписании записи могут храниться одной строкой:
  // "English: 07.10.2026 в 16:30, French: 06.10.2026 в 15:20".
  // Поэтому разделяем не только перед датой, но и перед названием предмета.
  return String(scheduleText)
    // Основной формат 2+ предметов:
    // "English: 07.10.2026 в 16:30, French: 08.10.2026 в 15:20"
    // Каждая запись отделяется по запятой именно перед следующим
    // "Предмет:".
    .split(/\n|;|,(?=\s*(?:(?:[^,;\n:]+)\s*:\s*)?\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?)/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const explicitDate = parseDateParts(line);
      const time = parseTimeParts(line.replace(/\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?/, ""));
      const weekday = parseWeekday(line);
      const date = explicitDate || (weekday === null ? null : nextDateForWeekday(weekday));
      const startDate = combineDateAndTime(date, time);
      if (!startDate) return null;

      // Явная календарная дата всегда является фактической датой урока.
      // Исторические занятия нельзя переносить в будущее: они нужны для истории.
      // Только записи без даты (по дню недели) рассчитываются относительно текущей недели.
      if (startDate < new Date() && weekday !== null && !explicitDate) {
        startDate.setDate(startDate.getDate() + 7);
      }

      const title = line
        .replace(/\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?/, "")
        .replace(/\d{1,2}[:.]\d{2}/, "")
        .replace(/понедельник(?:ам)?|вторник(?:ам)?|сред[ауам]*|четверг(?:ам)?|пятниц[ауам]*|суббот[ауам]*|воскресенье|воскресеньям|пн|вт|ср|чт|пт|сб|вс/gi, "")
        .replace(/^[^:]+:\s*/, "")
        .replace(/^в\s+/i, "")
        .replace(/[—–-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const explicitCourse = inferScheduleCourse(line, "");
      const scheduleCourse = explicitCourse || normalizeCourseName(fallbackCourse);
      const subject = explicitCourse
        ? getCourseLabel(explicitCourse)
        : (fallbackCourse ? getCourseLabel(fallbackCourse) : "Предмет");

      return {
        id: `schedule-${index}-${startDate.getTime()}`,
        title: title || subject,
        subject,
        course: scheduleCourse,
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

function collectScheduleItems({ courseFilter = false } = {}) {
  const user = cabinetData?.user || {};
  const courses = Array.isArray(user.courses) ? user.courses : [];
  
  // ВАЖНО: расписание всегда разбирается независимо от currentCourse.
  // При 2+ предметах нельзя передавать выбранную вкладку как fallback,
  // иначе один и тот же урок превращается то в English, то в French.
  const fallbackCourse = courses.length === 1 ? courses[0] : "";
  const parsedSchedule = user.schedule
    ? parseScheduleText(user.schedule, fallbackCourse)
    : [];

  if (!courseFilter) return parsedSchedule;

  return parsedSchedule.filter(item =>
    normalizeCourseName(item.course) === normalizeCourseName(getCurrentCourse())
  );
}

function getNextLesson() {
  const now = new Date();

  // Один и тот же глобальный массив расписания используется независимо
  // от выбранной вкладки предмета.
  return collectScheduleItems({ courseFilter: false })
    .filter(item => item.startDate instanceof Date && item.startDate.getTime() >= now.getTime())
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] || null;
}

function renderNextLesson() {
  const container = document.getElementById("next-lesson-card");
  if (!container) return;

  const lesson = getNextLesson();
  if (!lesson) {
    container.innerHTML = '<p style="color:var(--muted);line-height:1.7">Ближайший урок пока не назначен.</p>';
    return;
  }

  const rows = [
    `<div class="next-lesson-row"><small>Дата</small>${formatDate(lesson.startDate)}</div>`,
    `<div class="next-lesson-row"><small>Время</small>${formatTime(lesson.startDate)}</div>`
  ];

  // Предмет показываем только когда у ученика несколько предметов.
  if (shouldShowScheduleSubject()) {
    rows.push(`<div class="next-lesson-row"><small>Предмет</small>${escapeHtml(lesson.subject)}</div>`);
  }

  container.innerHTML = rows.join("");
}

function shouldShowScheduleSubject() {
  return (cabinetData?.user?.courses || []).length > 1;
}

function getScheduleDisplayTitle(item) {
  return shouldShowScheduleSubject()
    ? String(item.subject || item.title || "Урок").trim()
    : "Урок";
}

function openLessonCard(eventId) {
  const lesson = collectScheduleItems({ courseFilter: false })
    .find(item => item.id === String(eventId));
  if (!lesson) return;

  const dateTime = `${formatDate(lesson.startDate)} в ${formatTime(lesson.startDate)}`;
  alert(shouldShowScheduleSubject()
    ? `${lesson.subject}: ${dateTime}`
    : dateTime);
}

function renderCalendar() {
  const calendarEl = document.getElementById("lesson-calendar");
  const upcomingEl = document.getElementById("upcoming-lessons");
  if (!calendarEl || !upcomingEl) return;

  const items = collectScheduleItems({ courseFilter: false })
    .sort((a, b) => a.startDate - b.startDate);

  const events = items.map(item => ({
    id: item.id,
    title: getScheduleDisplayTitle(item),
    start: item.startDate.toISOString()
  }));

  if (window.FullCalendar) {
    if (lessonCalendar) lessonCalendar.destroy();

    lessonCalendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      height: 245,
      contentHeight: 210,
      locale: "ru",
      firstDay: 1,
      dayMaxEvents: 2,
      headerToolbar: { left: "prev,next", center: "title", right: "today" },
      events,
      eventClick(info) {
        openLessonCard(info.event.id);
      },
    });

    lessonCalendar.render();
  } else {
    calendarEl.innerHTML = '<p style="padding:1rem;color:var(--muted)">Календарь временно недоступен</p>';
  }

  // Под календарём показываем только будущие записи.
  // Исторические уроки остаются в календаре, но не дублируются в списке ниже.
  const now = new Date();
  const scheduleList = items.filter(item =>
    item.startDate instanceof Date &&
    !isNaN(item.startDate.getTime()) &&
    item.startDate.getTime() >= now.getTime()
  );

  upcomingEl.innerHTML = scheduleList.length
    ? scheduleList.map(item => `
      <button type="button" class="upcoming-item" onclick="openLessonCard('${escapeAttr(item.id)}')">
        <span class="upcoming-mark"></span>
        <span>
          <span class="upcoming-date">${formatDate(item.startDate)}</span><br>
          <span class="upcoming-time">${formatTime(item.startDate)}</span>
        </span>
        ${shouldShowScheduleSubject()
          ? `<span class="upcoming-title">${escapeHtml(item.subject)}</span>`
          : ""}
      </button>
    `).join("")
    : '<p style="color:var(--muted);line-height:1.7">Ближайших занятий пока нет.</p>';
}

// ================= UI =================
function logoutCabinet() {
  window.location.href = "index.html";
}

function showSection(sectionId) {
  document.querySelectorAll(".section").forEach(el => el.classList.add("hidden"));
  const el = document.getElementById(sectionId);
  if (el) el.classList.remove("hidden");
  if (sectionId === "schedule") loadSlots();
}

function setCourse() { return; }
function renderCourseTabs() { }

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
    // Проверка пользователя уже выполнена на странице входа. Повторный запрос
    // check_user здесь был лишней точкой отказа: при изменении Apps Script он
    // мог не дать открыть кабинет, хотя основной ответ кабинета доступен.
    await loadCabinet();
  } catch (e) {
    console.error(e);
    setText("loading", "❌ Ошибка соединения: " + (e.message || "проверьте подключение"));
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
    setText("lessons-remaining", getLessonsRemainingText());
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
    

    const avatarImg = document.getElementById("avatar-img");
    if (avatarImg) avatarImg.src = u.avatarUrl || "https://via.placeholder.com/120/2e7d32/FFFFFF?text=👤";

    renderCourseTabs();
    renderCourseData();
    // Загрузка домашних заданий встроена непосредственно в кабинет.
 
    document.getElementById("loading")?.classList.add("hidden");
    document.getElementById("main")?.classList.remove("hidden");
    renderNextLesson();
    renderCalendar();
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

function buildMaterialGroups(materials = []) {
  const filledGroups = [];
  const otherItems = [];
  const groupsByKey = new Map();

  materials.forEach(material => {
    const rawValue = material.sort || material.sorting || material.group || material.category || material["Сортировка"] || "";
    const trimmedValue = String(rawValue || "").trim();

    if (!trimmedValue) {
      otherItems.push(material);
      return;
    }

    const key = normalizeMaterialsSort(trimmedValue);
    if (!groupsByKey.has(key)) {
      const group = { key, label: trimmedValue, items: [] };
      groupsByKey.set(key, group);
      filledGroups.push(group);
    }

    groupsByKey.get(key).items.push(material);
  });

  if (otherItems.length) {
    filledGroups.push({ key: "__other", label: OTHER_MATERIALS_GROUP, items: otherItems });
  }

  return filledGroups;
}

function setMaterialsSortFilter(course, key) {
  selectedMaterialsSort[course] = key;
  renderCourseData();
}
window.setMaterialsSortFilter = setMaterialsSortFilter;

function renderMaterialCard(material) {
  return `<div class="lesson-card">
    <strong>${escapeHtml(material.title)}</strong><br>
    <a href="${escapeAttr(material.link)}" target="_blank" rel="noopener" class="lesson-btn">Открыть</a>
  </div>`;
}

function renderCourseData() {
  if (!cabinetData) return;
  const course = getCurrentCourse();
  


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
    const chips = document.getElementById("materials-sort-chips");
    const searchInput = document.getElementById("materials-search");
    const query = normalizeCourseName(searchInput?.value || "");
    const allMaterials = (cabinetData.materials || []).filter(m => m.course === course);
    const hasSorting = allMaterials.some(m => normalizeMaterialsSort(m.sort || m.sorting || m.group || m.category || m["Сортировка"] || ""));
    const groups = buildMaterialGroups(allMaterials);
    const availableKeys = groups.map(group => group.key);
    const selectedKey = availableKeys.includes(selectedMaterialsSort[course]) ? selectedMaterialsSort[course] : "all";
    selectedMaterialsSort[course] = selectedKey;

    if (chips) {
      chips.innerHTML = hasSorting
        ? [{ key: "all", label: "Все" }, ...groups].map(group => `
            <button
              type="button"
              class="materials-sort-chip${selectedKey === group.key ? " active" : ""}"
              onclick="setMaterialsSortFilter(decodeURIComponent('${encodeURIComponent(course)}'), decodeURIComponent('${encodeURIComponent(group.key)}'))"
            >${escapeHtml(group.label)}</button>`).join("")
        : "";
      chips.classList.toggle("hidden", !hasSorting);
    }

    if (!hasSorting) {
      const list = query
        ? allMaterials.filter(m => normalizeCourseName(m.title).includes(query))
        : allMaterials;
      materials.classList.add("lessons-grid");
      materials.innerHTML = list.length
        ? list.map(renderMaterialCard).join("")
        : `<p>${query ? "По этому запросу материалы не найдены." : "Материалы пока не добавлены."}</p>`;
      return;
    }

    const selectedGroup = groups.find(group => group.key === selectedKey);
    const visibleMaterials = selectedKey === "all" ? allMaterials : (selectedGroup?.items || []);
    const list = query
      ? visibleMaterials.filter(m => normalizeCourseName(m.title).includes(query))
      : visibleMaterials;

    materials.classList.add("lessons-grid");
    materials.innerHTML = list.length
      ? list.map(renderMaterialCard).join("")
      : `<p>${query ? "По этому запросу материалы не найдены." : "Материалы пока не добавлены."}</p>`;
  }


}

// ================= ЗАГРУЗКА ДОМАШНЕГО ЗАДАНИЯ =================
const MAX_HOMEWORK_UPLOAD_BYTES = 10 * 1024 * 1024;

function handleHomeworkFileChange(input) {
  const file = input?.files?.[0];
  const nameEl = document.getElementById("homework-file-name");
  if (!nameEl) return;
  if (!file) {
    nameEl.textContent = "";
    return;
  }
  if (file.size > MAX_HOMEWORK_UPLOAD_BYTES) {
    input.value = "";
    nameEl.textContent = "Файл больше 10 МБ. Пожалуйста, выберите файл меньшего размера.";
    return;
  }
  nameEl.textContent = file.name + " · " + (file.size / (1024 * 1024)).toFixed(2) + " МБ";
}
window.handleHomeworkFileChange = handleHomeworkFileChange;

async function submitHomework(event) {
  event.preventDefault();
  const form = document.getElementById("homework-upload-form");
  const lessonInput = document.getElementById("homework-lesson");
  const commentInput = document.getElementById("homework-comment");
  const fileInput = document.getElementById("homework-file");
  const button = document.getElementById("homework-submit-btn");
  const status = document.getElementById("homework-upload-status");
  const file = fileInput?.files?.[0];

  if (!userId) {
    status.textContent = "Не удалось определить ученика. Перезагрузите кабинет.";
    return;
  }
  if (!lessonInput?.value.trim()) {
    status.textContent = "Укажите номер урока.";
    lessonInput?.focus();
    return;
  }
  if (!file) {
    status.textContent = "Прикрепите файл с домашним заданием.";
    return;
  }
  if (file.size > MAX_HOMEWORK_UPLOAD_BYTES) {
    status.textContent = "Файл больше 10 МБ. Выберите файл меньшего размера.";
    return;
  }

  button.disabled = true;
  status.textContent = "Загружаем файл…";
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
      reader.readAsDataURL(file);
    });
    const fileBase64 = dataUrl.split(",")[1];
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        action: "submit_homework",
        userId,
        lessonNum: lessonInput.value.trim(),
        text: commentInput?.value.trim() || "",
        fileName: file.name,
        fileBase64
      })
    });
    const result = await response.json();
    if (!result.success) throw new Error(result.error || "Не удалось отправить домашнее задание.");
    status.textContent = "Готово! Домашнее задание отправлено преподавателю.";
    form.reset();
    const fileNameEl = document.getElementById("homework-file-name");
    if (fileNameEl) fileNameEl.textContent = "";
  } catch (err) {
    console.error(err);
    status.textContent = err.message || "Ошибка при отправке. Попробуйте ещё раз.";
  } finally {
    button.disabled = false;
  }
}
window.submitHomework = submitHomework;

// ================= СЛОТЫ =================
function formatDate(dateStr) {
  if (dateStr instanceof Date) {
    return `${dateStr.getFullYear()}-${String(dateStr.getMonth() + 1).padStart(2, "0")}-${String(dateStr.getDate()).padStart(2, "0")}`;
  }

  const value = String(dateStr || "").trim();
  if (!value) return "";
  if (/^\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?$/.test(value)) return escapeHtml(value);

  const d = new Date(value);
  if (isNaN(d.getTime())) return escapeHtml(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function stripDisplaySeconds(value = "") {
  return String(value || "").trim().replace(/(\b\d{1,2}[:.]\d{2})[:.]\d{2}(\b)/g, "$1");
}

function formatTime(timeStr) {
  if (timeStr instanceof Date) {
    return `${String(timeStr.getHours()).padStart(2, "0")}:${String(timeStr.getMinutes()).padStart(2, "0")}`;
  }

  const value = stripDisplaySeconds(timeStr);
  if (!value) return "";
  if (/^\d{1,2}[:.]\d{2}$/.test(value)) return escapeHtml(value);

  const d = new Date(value);
  if (isNaN(d.getTime())) return escapeHtml(value);
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
      return `<div class="slot-item">
        <div class="slot-info">
          <strong class="slot-date">${formatDate(slot.date)}</strong>
          <span class="slot-time">${formatTime(slot.time)}</span>
        </div>
        ${isFree ? `<button class="slot-book-btn" onclick="bookSlot('${escapeAttr(slot.id)}')">Записаться</button>` : '<span class="slot-status">Занято</span>'}
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
      return `<div class="slot-item">
        <div class="slot-info">
          <strong class="slot-date">${escapeHtml(slot.title)}</strong>
          <span class="slot-time">${formatDate(slot.date)} · ${formatTime(slot.time)}</span>
        </div>
        ${available ? `<button class="slot-book-btn" onclick="bookGroupSlot('${escapeAttr(slot.id)}')">Записаться · ${bookedCount}/${capacity}</button>` : `<span class="slot-status">Мест нет · ${capacity}/${capacity}</span>`}
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

// Store, coins and achievements are disabled in the sales template.

// ================= INIT =================
window.addEventListener("DOMContentLoaded", () => {
   loadData();
 });
