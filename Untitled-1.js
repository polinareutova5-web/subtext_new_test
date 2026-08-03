// Copy this file to Google Apps Script and deploy it as a Web App.
// This script is the API layer between the student cabinet and Google Sheets.
const USERS_SHEET_ID = '10_fVJ9HHIjbMGoC2CULBj8Ak91sTh_6zh-bk7NAL5Bg';
const COURSE_TABLES = {
  english: '1qe3P8lpnpfRgrYpBdNreTsv7wdO3lsCgUfsOK3lwPog',
  physics: '1yWDAwuiIC44l_CFNMoW_SvoolD5EAAC2EajwoPr-v6M',
  french : '1guk31UBwUuLHoMIKm5bQ0-_t58VGfsofaokIest3Z-A',
  biology:'1Tp8AgjBG__X3hwoMKfMNqZb33B2rIx3FeDQqg_nj1KI',
  español: '1guk31UBwUuLHoMIKm5bQ0-_t58VGfsofaokIest3Z-A',
  chemistry: '1Bx8in9m1NIRobRIHeM7SdMEE4eB2PM-ceRQ1B3kVDVg'
};
const COURSE_FORM_LINKS = {
  english: 'https://docs.google.com/forms/d/e/1FAIpQLSdyaEIut7zciiAfhbNexWHxXLy6eE1IoEwpprm-x8I-penPrw/viewform',
  physics: 'https://docs.google.com/forms/d/e/ССЫЛКА_НА_ФОРМУ_ФИЗИКИ/viewform',
  french: 'https://docs.google.com/forms/d/e/1FAIpQLSfdiRbWSD0T5KXx0oT7pi9B65qwlXZXH0g-pGpbisnyketAiw/viewform',
  biology: 'https://docs.google.com/forms/d/e/1FAIpQLSddRnIm_yXH21Z4asGY7ylNY9I3g_oScgV_wu5Ufx_iL3He-w/viewform',
  español: 'https://docs.google.com/forms/d/e/1FAIpQLSfdiRbWSD0T5KXx0oT7pi9B65qwlXZXH0g-pGpbisnyketAiw/viewform',
  chemistry: 'https://docs.google.com/forms/d/e/1FAIpQLScPwnne8jObiTRcYoOueho7FQtxhg5EVMEaLsuf8MVX43DsTg/viewform?usp=publish-editor'
};

// ================= ОСНОВНОЙ РОУТЕР (doGet) =================
function doGet(e) {
  try {
    const p = e.parameter || {};
    const action = p.action || '';
    
    // 1. ДЕЙСТВИЯ ПРЕПОДАВАТЕЛЯ (проверяем ПЕРВЫМИ, до проверки userId)
    if (action === 'teacher_login') return teacherLogin(p.login, p.password);
    if (action === 'teacher_get_sheets') return teacherGetSheets(p.tableType, p.course, p.access);
    if (action === 'teacher_get_data') return teacherGetData(p.tableType, p.course, p.sheetName, p.access);
    if (action === 'teacher_update_cell') return teacherUpdateCell(p.tableType, p.course, p.sheetName, p.row, p.col, p.value, p.access);
    if (action === 'teacher_add_row') return teacherAddRow(p.tableType, p.course, p.sheetName, p.rowIndex, p.rowData ? JSON.parse(p.rowData) : [], p.access);
    if (action === 'teacher_delete_row') return teacherDeleteRow(p.tableType, p.course, p.sheetName, p.rowIndex, p.access);
    if (action === 'teacher_add_column') return teacherAddColumn(p.tableType, p.course, p.sheetName, p.colIndex, p.access);
    if (action === 'teacher_delete_column') return teacherDeleteColumn(p.tableType, p.course, p.sheetName, p.colIndex, p.access);
    if (action === 'teacher_save_sheet') return teacherSaveSheet(p.tableType, p.course, p.sheetName, JSON.parse(p.changes), p.access);
    if (action === "ai_chat" || action === "qwen_chat") {
      const message = p.message;
      if (!message) return error("Сообщение не указано");

      return json(handleQwenChat({
        message,
        context: p.context || "",
        history: p.history || ""
      }));
    }

    // 2. ДЕЙСТВИЯ УЧЕНИКА (требуют userId)
    const userId = p.userId;
    if (!userId) return error('userId не указан');

    const user = getUser(userId);
    if (!user) return error('Пользователь не найден');
    if (!user.courses.length) return error('У пользователя не указаны курсы');

    const course = normalizeCourse(p.course || user.courses[0]);
    if (!COURSE_TABLES[course]) return error(`Курс "${course}" не найден`);

    if (action === 'check_user') return json({ success: true });
    if (action === 'get_support') return json({ success: true, messages: getSupport(userId) });
    if (action === 'send_support') return sendSupport(userId, p.text || '');
    if (action === 'get_slots') return json({ success: true, slots: getSlots(course) });
    if (action === 'get_notifications') return json(getNotifications(userId));
    if (action === 'mark_notifications_read') return json(markNotificationsRead(userId));
    if (action === 'get_group_slots') return json({ success: true, slots: getGroupSlots(course) });
    if (action === 'book_slot') return bookSlot(userId, p.slotId, course);
    if (action === 'book_group_slot') return bookGroupSlot(userId, p.slotId, course);
    if (action === 'buy_item') return handleBuy(userId, Number(p.lessonNum), course);

    const agg = { lessons: [], materials: [], shop: [], achievements: [] };
    for (const c of user.courses) {
      const normalizedCourse = normalizeCourse(c);
      if (!COURSE_TABLES[normalizedCourse]) continue;
      agg.lessons.push(...getLessonsByUser(userId, normalizedCourse));
      agg.materials.push(...getMaterialsByUser(normalizedCourse));
      agg.shop.push(...getShopItems(normalizedCourse));
      agg.achievements.push(...getAchievements(userId, normalizedCourse));
    }

    return json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        progress: user.progress,
        coins: user.coins,
        link: user.link,
        schedule: user.schedule,
        levels: user.levels,
        ranks: user.ranks,
        avatarUrl: user.avatarUrl,
        courses: user.courses,
        formLinks: getFormLinksForUser(user.courses),
      },
      lessons: agg.lessons,
      materials: agg.materials,
      shop: agg.shop,
      achievements: agg.achievements,
    });
  } catch (err) {
    return error('GET ошибка: ' + err.message);
  }
}

function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) return error('Пустой POST');
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'submit_homework') {
      const user = getUser(data.userId);
      const course = normalizeCourse(data.course || (user && user.courses[0]) || 'english');
      return handleHomework(data, course);
    }
    return error('Неизвестное POST-действие');
  } catch (err) {
    return error('POST ошибка: ' + err.message);
  }
}

// ================= ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =================
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function error(message) {
  return json({ success: false, error: message });
}

function normalizeCourse(course) {
  return String(course || '').trim().toLowerCase();
}

function getFormLinksForUser(courses) {
  const links = {};
  for (const course of courses || []) {
    const normalizedCourse = normalizeCourse(course);
    if (COURSE_FORM_LINKS[normalizedCourse]) {
      links[normalizedCourse] = COURSE_FORM_LINKS[normalizedCourse];
    }
  }
  return links;
}

function openUsersSheet(sheetName) {
  const sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Лист "${sheetName}" не найден в главной таблице`);
  return sheet;
}

function getUser(userId) {
  const sheet = openUsersSheet('Лист1');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(userId).trim()) {
      const coursesStr = String(rows[i][9] || '').toLowerCase();
      const courses = coursesStr.split(',').map(c => normalizeCourse(c)).filter(Boolean);
      const stats = getUserCourseStats(userId);
      const fallbackLevels = { english: rows[i][7] || '', physics: rows[i][8] || '' };
      return {
        id: rows[i][0],
        username: rows[i][1],
        progress: Object.keys(stats.progress).length ? stats.progress : (rows[i][2] || 0),
        coins: rows[i][3] || 0,
        link: rows[i][5] || '',
        schedule: rows[i][6] || '',
        levels: Object.keys(stats.levels).length ? stats.levels : fallbackLevels,
        ranks: stats.ranks,
        avatarUrl: rows[i][10] || null,
        courses,
      };
    }
  }
  return null;
}

function getUserCourseStats(userId) {
  const sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName('Прогресс');
  if (!sheet) return { progress: {}, levels: {}, ranks: {} };
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { progress: {}, levels: {}, ranks: {} };
  const headers = rows[0].map(h => String(h).trim());
  const userIdCol = headers.indexOf('userId');
  const courseCol = headers.indexOf('course');
  const progressCol = headers.indexOf('progress');
  const levelCol = headers.indexOf('level');
  const rankCol = headers.indexOf('schoolRank');
  const topTextCol = headers.indexOf('schoolTopText');
  if (userIdCol === -1 || courseCol === -1) return { progress: {}, levels: {}, ranks: {} };
  const stats = { progress: {}, levels: {}, ranks: {} };
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[userIdCol]).trim() !== String(userId).trim()) continue;
    const course = normalizeCourse(row[courseCol]);
    if (!course) continue;
    if (progressCol >= 0) stats.progress[course] = Math.max(0, Math.min(Number(row[progressCol]) || 0, 100));
    if (levelCol >= 0) stats.levels[course] = row[levelCol] || '';
    stats.ranks[course] = topTextCol >= 0 && row[topTextCol] ? row[topTextCol] : (rankCol >= 0 ? row[rankCol] || '' : '');
  }
  return stats;
}

function openCourseSheet(course, sheetName) {
  const sheet = SpreadsheetApp.openById(COURSE_TABLES[course]).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Лист "${sheetName}" не найден в курсе "${course}"`);
  return sheet;
}

function getLessonsByUser(userId, course) {
  const rows = openCourseSheet(course, 'Уроки').getDataRange().getValues();
  const res = [];
  for (let i = 1; i < rows.length; i++) {
    const ids = String(rows[i][3] || '').split(',').map(x => x.trim()).filter(Boolean);
    if (ids.length === 0 || ids.includes(String(userId))) {
      res.push({ num: rows[i][0], link: rows[i][1], hwLink: rows[i][2], course });
    }
  }
  return res;
}

function getMaterialsByUser(course) {
  const rows = openCourseSheet(course, 'Материалы').getDataRange().getValues();
  return rows.slice(1).filter(r => r[0] || r[1]).map(r => ({ title: r[0] || 'Без названия', link: r[1] || '', course }));
}

function getShopItems(course) {
  const rows = openCourseSheet(course, 'Магазин').getDataRange().getValues();
  return rows.slice(1).map(r => ({ image: r[0] || '', name: r[1] || 'Товар', price: Number(r[2]) || 0, course }));
}

function getAchievements(userId, course) {
  const rows = openCourseSheet(course, 'Ачивки').getDataRange().getValues();
  return rows.slice(1).filter(r => String(r[0] || '').split(',').map(id => id.trim()).includes(String(userId))).map(r => ({ title: r[1] || 'Ачивка', image: r[2] || '', course }));
}

function getSlots(course) {
  const rows = openCourseSheet(course, 'Слоты').getDataRange().getValues();
  return rows.slice(1).map(r => ({ id: r[0], date: r[1], time: r[2], status: r[3], userId: r[4], username: r[5], contact: r[6], bookingDate: r[7] }));
}

function getGroupSlots(course) {
  const rows = openCourseSheet(course, 'Группы').getDataRange().getValues();
  return rows.slice(1).map(r => ({ id: r[0], date: r[1], time: r[2], title: r[3], capacity: Number(r[4]) || 1, bookedCount: Number(r[5]) || 0, userIds: r[6] || '', usernames: r[7] || '' }));
}

function handleHomework(data, course) {
  openCourseSheet(course, 'ДЗ').appendRow([data.userId, data.username, data.text, new Date(), data.lessonNum, 'На проверке']);
  return json({ success: true });
}

function handleBuy(userId, itemIndex, course) {
  const user = getUser(userId);
  if (!user) return error('Пользователь не найден');
  const item = getShopItems(course)[itemIndex];
  if (!item) return error('Товар не найден');
  if (Number(user.coins) < item.price) return error('Недостаточно монет');
  updateUserCoins(userId, Number(user.coins) - item.price);
  openCourseSheet(course, 'Заказы').appendRow([new Date(), userId, user.username || '', item.name, item.price, 'Новый']);
  return json({ success: true });
}

function bookSlot(userId, slotId, course) {
  if (!slotId) return error('slotId не указан');
  const user = getUser(userId);
  if (!user) return error('Пользователь не найден');
  const sheet = openCourseSheet(course, 'Слоты');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(slotId)) {
      if (rows[i][3] !== 'free') return error('Слот уже занят');
      sheet.getRange(i + 1, 4).setValue('booked');
      sheet.getRange(i + 1, 5).setValue(userId);
      sheet.getRange(i + 1, 6).setValue(user.username);
      sheet.getRange(i + 1, 8).setValue(new Date());
      addSchedule(userId, rows[i][1], rows[i][2]);
      return json({ success: true });
    }
  }
  return error('Слот не найден');
}

function bookGroupSlot(userId, slotId, course) {
  if (!slotId) return error('slotId не указан');
  const user = getUser(userId);
  if (!user) return error('Пользователь не найден');
  const sheet = openCourseSheet(course, 'Группы');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(slotId)) {
      const cap = Number(rows[i][4]) || 1;
      const booked = Number(rows[i][5]) || 0;
      if (booked >= cap) return error('Мест больше нет');
      const ids = String(rows[i][6] || '').split(',').map(x => x.trim()).filter(Boolean);
      if (ids.includes(String(userId))) return error('Вы уже записаны');
      sheet.getRange(i + 1, 6).setValue(booked + 1);
      sheet.getRange(i + 1, 7).setValue(rows[i][6] ? rows[i][6] + ',' + userId : userId);
      sheet.getRange(i + 1, 8).setValue(rows[i][7] ? rows[i][7] + ', ' + user.username : user.username);
      addSchedule(userId, rows[i][1], rows[i][2]);
      return json({ success: true });
    }
  }
  return error('Слот не найден');
}

function getSupport(userId) {
  const sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName('Поддержка');
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  return rows.slice(1).filter(r => String(r[1]) === String(userId)).map(r => ({ question: r[2], answer: r[3] || '' }));
}

function sendSupport(userId, text) {
  if (!String(text).trim()) return error('Пустой вопрос');
  const sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName('Поддержка');
  if (!sheet) return error('Лист "Поддержка" не найден');
  sheet.appendRow([new Date(), userId, text, '']);
  return json({ success: true });
}

function updateUserCoins(userId, newCoins) {
  const sheet = openUsersSheet('Лист1');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(userId).trim()) {
      sheet.getRange(i + 1, 4).setValue(newCoins);
      return;
    }
  }
}

function addSchedule(userId, date, time) {
  const fmt = Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'dd.MM.yyyy') + ' в ' +
              Utilities.formatDate(new Date(time), Session.getScriptTimeZone(), 'HH:mm');
  const sheet = openUsersSheet('Лист1');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(userId).trim()) {
      const cur = rows[i][6] || '';
      sheet.getRange(i + 1, 7).setValue(cur ? cur + ', ' + fmt : fmt);
      break;
    }
  }
}

function getNotifications(userId) {
  if (!userId) return { success: false, error: 'Не указан userId', notifications: [] };
  const sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName('Уведомления');
  if (!sheet) return { success: true, notifications: [] };
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { success: true, notifications: [] };
  const headers = values[0].map(String);
  const rows = values.slice(1);
  const idCol = headers.indexOf('id');
  const dateCol = headers.indexOf('Дата');
  const userIdCol = headers.indexOf('userId');
  const titleCol = headers.indexOf('Заголовок');
  const textCol = headers.indexOf('Текст');
  const statusCol = headers.indexOf('Статус');
  const soundCol = headers.indexOf('sound');
  const readByCol = headers.indexOf('readBy');
  const notifications = rows.map((row, index) => {
    const targetUserId = String(row[userIdCol] || '').trim();
    const readBy = readByCol >= 0 ? String(row[readByCol] || '').split(',').map(item => item.trim()).filter(Boolean) : [];
    const status = statusCol >= 0 ? String(row[statusCol] || '').trim().toLowerCase() : '';
    const ids = targetUserId.split(',').map(x => x.trim()).filter(Boolean);
    const isForCurrentUser = targetUserId === 'all' || targetUserId === '*' || ids.includes(String(userId));
    if (!isForCurrentUser) return null;
    const id = String(row[idCol] || `notification-${index + 2}`).trim();
    const isRead = readBy.includes(String(userId)) || status === 'read' || status === 'прочитано';
    return {
      id,
      date: dateCol >= 0 ? formatSheetDate(row[dateCol]) : '',
      title: titleCol >= 0 ? String(row[titleCol] || 'Уведомление') : 'Уведомление',
      text: textCol >= 0 ? String(row[textCol] || '') : '',
      read: isRead,
      sound: soundCol >= 0 ? parseSheetBoolean(row[soundCol]) : true,
    };
  }).filter(Boolean).filter(item => item.text || item.title).reverse();
  return { success: true, notifications };
}

function markNotificationsRead(userId) {
  if (!userId) return { success: false, error: 'Не указан userId' };
  const sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName('Уведомления');
  if (!sheet) return { success: true };
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return { success: true };
  const headers = values[0].map(String);
  const userIdCol = headers.indexOf('userId');
  const statusCol = headers.indexOf('Статус');
  let readByCol = headers.indexOf('readBy');
  if (readByCol === -1) {
    readByCol = headers.length;
    sheet.getRange(1, readByCol + 1).setValue('readBy');
  }
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const targetUserId = String(row[userIdCol] || '').trim();
    const ids = targetUserId.split(',').map(x => x.trim()).filter(Boolean);
    const isForCurrentUser = targetUserId === 'all' || targetUserId === '' || ids.includes(String(userId));
    if (!isForCurrentUser) continue;
    if (targetUserId === 'all' || targetUserId === '') {
      const currentReadBy = String(row[readByCol] || '').split(',').map(item => item.trim()).filter(Boolean);
      if (!currentReadBy.includes(String(userId))) currentReadBy.push(String(userId));
      sheet.getRange(i + 1, readByCol + 1).setValue(currentReadBy.join(','));
    } else if (statusCol >= 0) {
      sheet.getRange(i + 1, statusCol + 1).setValue('read');
    }
  }
  return { success: true };
}

function parseSheetBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return !['false', '0', 'no', 'нет', 'выкл', 'off'].includes(normalized);
}

function formatSheetDate(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd.MM.yyyy');
  }
  return String(value);
}

// ================= TEACHER PLATFORM API =================
// (Все функции находятся в глобальной области видимости)

function teacherLogin(login, password) {
  const sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName('Доступ');
  if (!sheet) return error('Лист "Доступ" не найден');

  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (
      String(rows[i][0]).trim().toLowerCase() === String(login).trim().toLowerCase() &&
      String(rows[i][1]).trim() === String(password).trim()
    ) {
      const courses = String(rows[i][3])
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

      return json({
        success: true,
        token: Utilities.base64Encode(login + ':' + Date.now()),
        teacherName: rows[i][2],
        courses: courses,
        access: String(rows[i][4] || "teacher").trim().toLowerCase()
      });
    }
  }

  return error('Неверный логин или пароль');
}

function getTableId(tableType, course) {
  if (tableType === 'main') return USERS_SHEET_ID;
  if (COURSE_TABLES[course]) return COURSE_TABLES[course];
  throw new Error('Неизвестная таблица или курс');
}

function teacherGetSheets(tableType, course, access) {

  access = String(access || '')
    .trim()
    .toLowerCase();

  const ss = SpreadsheetApp.openById(getTableId(tableType, course));
  let sheets = ss.getSheets().map(s => s.getName());

  if (tableType === 'main' && access !== 'full') {

    const hiddenSheets = [
      'Доступ',
      'База данных учеников',
      'Бухгалтерия'
    ];

    sheets = sheets.filter(
      name => !hiddenSheets.includes(name)
    );
  }

  return json({
    success: true,
    sheets
  });
}

function teacherGetData(tableType, course, sheetName, access) {
  try {
    // Проверка доступа к листу
    if (tableType === 'main' && !canAccessSheet(sheetName, access)) {
      return error('Нет доступа к этому листу');
    }

    const ss = SpreadsheetApp.openById(getTableId(tableType, course));
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return error('Лист не найден');

    // Используем getDisplayValues() для корректного отображения дат и времени
    const data = sheet.getDataRange().getDisplayValues();
    
    // Если таблица полностью пустая, возвращаем пустой массив
    if (data.length === 0 || (data.length === 1 && data[0].every(cell => cell === ''))) {
      return json({ success: true, data: [] });
    }
    
    return json({ success: true, data: data });
  } catch (e) {
    return error('Ошибка получения данных: ' + e.message);
  }
}

function teacherUpdateCell(tableType, course, sheetName, row, col, value, access) {
  try {
    if (tableType === 'main' && !canAccessSheet(sheetName, access)) {
      return error('Нет доступа к редактированию этого листа');
    }

    const ss = SpreadsheetApp.openById(getTableId(tableType, course));
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return error('Лист не найден');
    
    sheet.getRange(Number(row) + 1, Number(col) + 1).setValue(value);
    return json({ success: true });
  } catch (e) {
    return error('Ошибка обновления: ' + e.message);
  }
}

function teacherAddRow(tableType, course, sheetName, rowIndex, rowData, access) {
  try {
    if (tableType === 'main' && !canAccessSheet(sheetName, access)) {
      return error('Нет доступа к редактированию этого листа');
    }

    const ss = SpreadsheetApp.openById(getTableId(tableType, course));
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return error('Лист не найден');

    try {
      // Если поле пустое, передано '' или -1 → добавляем в самый конец таблицы
      if (rowIndex === undefined || rowIndex === null || rowIndex === '' || Number(rowIndex) < 0) {
        const lastRow = sheet.getLastRow();
        sheet.insertRowAfter(lastRow);
        
        // Гарантированно заполняем первую ячейку пустой строкой, чтобы строка была видна
        const cols = sheet.getLastColumn() || 1;
        const emptyRow = new Array(cols).fill('');
        sheet.getRange(lastRow + 1, 1, 1, cols).setValues([emptyRow]);
        
        // Если есть данные для вставки, перезаписываем
        if (rowData && rowData.length > 0) {
          sheet.getRange(lastRow + 1, 1, 1, rowData.length).setValues([rowData]);
        }
      } else {
        // Иначе вставляем перед указанной строкой
        const targetRow = Number(rowIndex) + 1;
        sheet.insertRowBefore(targetRow);
        
        // Заполняем строку пустыми значениями
        const cols = sheet.getLastColumn() || 1;
        const emptyRow = new Array(cols).fill('');
        sheet.getRange(targetRow, 1, 1, cols).setValues([emptyRow]);
        
        if (rowData && rowData.length > 0) {
          sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
        }
      }
      return json({ success: true, message: 'Строка добавлена' });
    } catch (e) {
      return error('Ошибка добавления строки: ' + e.message);
    }
  } catch (e) {
    return error('Ошибка: ' + e.message);
  }
}

function teacherDeleteRow(tableType, course, sheetName, rowIndex, access) {
  try {
    if (tableType === 'main' && !canAccessSheet(sheetName, access)) {
      return error('Нет доступа к редактированию этого листа');
    }

    const ss = SpreadsheetApp.openById(getTableId(tableType, course));
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return error('Лист не найден');
    if (Number(rowIndex) + 1 <= 1) return error('Нельзя удалить первую строку (заголовки)');
    sheet.deleteRow(Number(rowIndex) + 1);
    return json({ success: true });
  } catch (e) {
    return error('Ошибка удаления строки: ' + e.message);
  }
}

function teacherAddColumn(tableType, course, sheetName, colIndex, access) {
  try {
    if (tableType === 'main' && !canAccessSheet(sheetName, access)) {
      return error('Нет доступа к редактированию этого листа');
    }

    const ss = SpreadsheetApp.openById(getTableId(tableType, course));
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return error('Лист не найден');

    // Если поле пустое или < 0 → добавляем столбец в самый конец
    if (colIndex === undefined || colIndex === null || colIndex === '' || Number(colIndex) < 0) {
      const lastCol = sheet.getLastColumn() || 1;
      sheet.insertColumnAfter(lastCol);
    } else {
      sheet.insertColumnAfter(Number(colIndex) + 1);
    }
    return json({ success: true });
  } catch (e) {
    return error('Ошибка добавления столбца: ' + e.message);
  }
}

function teacherDeleteColumn(tableType, course, sheetName, colIndex, access) {
  try {
    if (tableType === 'main' && !canAccessSheet(sheetName, access)) {
      return error('Нет доступа к редактированию этого листа');
    }

    const ss = SpreadsheetApp.openById(getTableId(tableType, course));
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return error('Лист не найден');
    if (Number(colIndex) + 1 <= 1) return error('Нельзя удалить первый столбец');
    sheet.deleteColumn(Number(colIndex) + 1);
    return json({ success: true });
  } catch (e) {
    return error('Ошибка удаления столбца: ' + e.message);
  }
}

function teacherSaveSheet(tableType, course, sheetName, changes, access) {
  try {
    if (tableType === 'main' && !canAccessSheet(sheetName, access)) {
      return error('Нет доступа к редактированию этого листа');
    }

    const ss = SpreadsheetApp.openById(getTableId(tableType, course));
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return error('Лист не найден');
    
    changes.forEach(change => {
      sheet.getRange(Number(change.row) + 1, Number(change.col) + 1).setValue(change.value);
    });
    
    return json({ success: true, message: 'Изменения сохранены' });
  } catch (e) {
    return error('Ошибка сохранения: ' + e.message);
  }
}

// Вспомогательная функция для проверки доступа к листу
function canAccessSheet(sheetName, access) {

  access = String(access || '')
    .trim()
    .toLowerCase();

  const restrictedSheets = [
    'Доступ',
    'Бухгалтерия',
    'База данных учеников'
  ];

  if (access === 'full') {
    return true;
  }

  return !restrictedSheets.includes(sheetName);
}

// ================= QWEN AI CHAT =================
function getQwenApiKey() {
  const scriptKey = PropertiesService.getScriptProperties().getProperty('QWEN_API_KEY');
  const fallbackKey = "sk-ws-H.XPDYDY.ZHWH.MEUCICxR4qL3x76D_zvVOQL8KKtIoaHaip3M8dU5d9PbIX9TAiEAi127LaL4y4dPPmkwUSeNc-0KkIWFmGIrtGbQV7gvQRk";
  return (scriptKey || fallbackKey || '').trim();
}

function handleQwenChat(request) {
  const QWEN_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
  const QWEN_API_KEY = getQwenApiKey();
  const message = String(request && request.message || '').trim();
  const context = String(request && request.context || '').trim();
  const history = String(request && request.history || '').trim();

  if (!message) {
    return { success: false, error: "Сообщение не указано" };
  }

  if (!QWEN_API_KEY) {
    return { success: false, error: "QWEN_API_KEY не задан в Script Properties" };
  }

  try {
    const systemPrompt = [
      "Ты — дружелюбный и полезный ИИ-помощник образовательной платформы Subtext.",
      "Отвечай ученику кратко, понятно и по существу.",
      "Если вопрос касается личного кабинета, учитывай переданный контекст ученика.",
      "Если данных недостаточно, честно скажи, что нужно уточнить у преподавателя или в поддержке."
    ].join(' ');

    const userContent = [
      context ? "Контекст ученика:\n" + context : "",
      history ? "Последние сообщения:\n" + history : "",
      "Вопрос ученика:\n" + message
    ].filter(Boolean).join("\n\n");

    const payload = {
      model: "qwen-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ]
    };

    const response = UrlFetchApp.fetch(QWEN_API_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + QWEN_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();
    const body = response.getContentText();
    const data = JSON.parse(body || '{}');

    if (status < 200 || status >= 300) {
      return {
        success: false,
        error: (data.error && (data.error.message || data.error.code)) || ("Qwen вернул HTTP " + status)
      };
    }

    const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!answer) {
      return { success: false, error: "Qwen не вернул текст ответа" };
    }

    return { success: true, answer: answer, reply: answer };
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : String(error) };
  }
}
