// Copy this file to Google Apps Script and deploy it as a Web App.
// This script is the API layer between the student cabinet and Google Sheets.
const USERS_SHEET_ID = '10_fVJ9HHIjbMGoC2CULBj8Ak91sTh_6zh-bk7NAL5Bg';
const COURSE_TABLES = {
  english: '1qe3P8lpnpfRgrYpBdNreTsv7wdO3lsCgUfsOK3lwPog',
  english2: '1glsFbjoquUo7WVyDuKl1q_UsTW_Htp2poTZoYoEmt-g',
  physics: '1yWDAwuiIC44l_CFNMoW_SvoolD5EAAC2EajwoPr-v6M',
  french : '1guk31UBwUuLHoMIKm5bQ0-_t58VGfsofaokIest3Z-A',
  french2: '1CWczRXL3Xzy2LZWoXSICbwzGHI0wIioK8cPhm2LA-3I',
  biology:'1Tp8AgjBG__X3hwoMKfMNqZb33B2rIx3FeDQqg_nj1KI',
  español: '1guk31UBwUuLHoMIKm5bQ0-_t58VGfsofaokIest3Z-A',
  chemistry: '1Bx8in9m1NIRobRIHeM7SdMEE4eB2PM-ceRQ1B3kVDVg'
};
const API_VERSION = '2026-11-26-homework-drive';


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
    if (action === "health" || action === "version") {
      return json({ success: true, version: API_VERSION });
    }


    // 2. ДЕЙСТВИЯ УЧЕНИКА (требуют userId)
    const userId = p.userId;
    if (!userId) {
      return error('userId не указан');
    }

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
        lessonsRemaining: user.lessonsRemaining,
        paidLessons: user.paidLessons,
        remainingLessons: user.lessonsRemaining,
        levels: user.levels,
        ranks: user.ranks,
        avatarUrl: user.avatarUrl,
        courses: user.courses,
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
      const userId = String(data.userId || '').trim();
      if (!userId) return error('Не удалось определить ученика. Перезагрузите кабинет.');
      const user = getUser(userId);
      if (!user) return error('Ученик не найден. Перезагрузите личный кабинет.');

      const course = normalizeCourse(data.course || user.courses[0] || '');
      if (!COURSE_TABLES[course]) return error('Выбранный предмет не найден.');
      const allowedCourses = (user.courses || []).map(normalizeCourse);
      if (!allowedCourses.includes(course)) return error('Этот предмет не привязан к вашему аккаунту.');

      return handleHomework(data, user, course);
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

const COURSE_ALIASES = {
  english: ['english', 'английский', 'англ', 'английский язык'],
  english2: ['english2', 'english 2', 'english_2', 'english-2', 'английский 2', 'английский 2 язык'], 
  physics: ['physics', 'физика', 'физику'],
  math: ['math', 'математика', 'математику'],
  biology: ['biology', 'биология', 'биологию'],
  chemistry: ['chemistry', 'химия', 'химию'],
  french: ['french', 'французский', 'французский язык', 'французскому'],
  french2: ['french2', 'french 2', 'french_2', 'french-2', 'французский 2', 'французский 2 язык'], 
  español: ['español', 'spanish', 'испанский', 'испанский язык', 'испанскому'],
};

function normalizeSubjectValue(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function splitSubjectList(value) {
  return String(value || '')
    .split(/[\n,;|]+/)
    .map(normalizeSubjectValue)
    .filter(Boolean);
}

function getCourseAliases(course) {
  const normalizedCourse = normalizeSubjectValue(course);
  return [normalizedCourse, ...(COURSE_ALIASES[normalizedCourse] || [])]
    .map(normalizeSubjectValue)
    .filter(Boolean);
}

function lessonSubjectMatchesCourse(subjectValue, course) {
  const subjects = splitSubjectList(subjectValue);
  if (!subjects.length) return true;
  const aliases = getCourseAliases(course);
  return subjects.some(subject => aliases.includes(subject));
}

function openUsersSheet(sheetName) {
  const sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Лист "${sheetName}" не найден в главной таблице`);
  return sheet;
}

function normalizeHeaderName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
}

function findHeaderIndex(headers, aliases, fallbackIndex) {
  const normalizedAliases = aliases.map(normalizeHeaderName).filter(Boolean);
  const index = headers.findIndex(header => {
    const normalizedHeader = normalizeHeaderName(header);
    return normalizedAliases.some(alias => normalizedHeader === alias || normalizedHeader.includes(alias));
  });
  return index >= 0 ? index : fallbackIndex;
}

function getCell(row, index, fallback = '') {
  return index >= 0 ? row[index] : fallback;
}

function getUser(userId) {
  const sheet = openUsersSheet('Лист1');
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return null;

  const headers = rows[0].map(h => String(h).trim());
  const userIdCol = findHeaderIndex(headers, ['userId', 'user_id', 'id'], 0);
  const usernameCol = findHeaderIndex(headers, ['username', 'name', 'имя'], 1);
  const lessonsRemainingCol = findHeaderIndex(headers, [
    'lessons_remaining',
    'remaining_lessons',
    'paid_lessons',
    'lessons_left',
    'lessonsleft',
    'lessons paid',
    'оплаченные уроки',
    'оплачено уроков',
    'оплаченных уроков',
    'остаток уроков',
    'осталось уроков',
    'количество уроков',
    'уроков осталось',
    'уроки осталось',
  ], 2);
  const progressCol = findHeaderIndex(headers, ['progress'], -1);
  const coinsCol = findHeaderIndex(headers, ['coins', 'монеты'], 3);
  const linkCol = findHeaderIndex(headers, ['lesson_link', 'link', 'ссылка'], 5);
  const scheduleCol = findHeaderIndex(headers, ['schedule', 'расписание'], 6);
  const subjectCol = findHeaderIndex(headers, ['subject', 'subjects', 'course', 'courses', 'предмет'], 7);
  const avatarCol = findHeaderIndex(headers, ['аватар', 'avatar', 'avatarUrl', 'avatar_url'], 8);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(getCell(row, userIdCol)).trim() === String(userId).trim()) {
      const coursesStr = String(getCell(row, subjectCol) || '').toLowerCase();
      const courses = coursesStr.split(',').map(c => normalizeCourse(c)).filter(Boolean);
      const stats = getUserCourseStats(userId);
      const progressFallback = progressCol >= 0 && progressCol !== lessonsRemainingCol ? getCell(row, progressCol, 0) : 0;
      return {
        id: getCell(row, userIdCol),
        username: getCell(row, usernameCol),
        progress: Object.keys(stats.progress).length ? stats.progress : progressFallback,
        coins: getCell(row, coinsCol, 0) || 0,
        link: getCell(row, linkCol) || '',
        schedule: getCell(row, scheduleCol) || '',
        lessonsRemaining: getCell(row, lessonsRemainingCol, ''),
        paidLessons: getCell(row, lessonsRemainingCol, ''),
        levels: stats.levels,
        ranks: stats.ranks,
        avatarUrl: getCell(row, avatarCol) || null,
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
    const ids = String(rows[i][3] || '').split(/[\n,;|]+/).map(x => x.trim()).filter(Boolean);
    const lessonSubject = rows[i][4] || '';
    if ((ids.length === 0 || ids.includes(String(userId))) && lessonSubjectMatchesCourse(lessonSubject, course)) {
      res.push({ num: rows[i][0], link: rows[i][1], hwLink: rows[i][2], subject: lessonSubject, course });
    }
  }
  return res;
}

function getMaterialsByUser(course) {
  const rows = openCourseSheet(course, 'Материалы').getDataRange().getValues();
  return rows.slice(1).filter(r => r[0] || r[1] || r[2]).map(r => ({
    title: r[0] || 'Без названия',
    link: r[1] || '',
    sort: r[2] || '',
    course
  }));
}

function getShopItems(course) {
  const rows = openCourseSheet(course, 'Магазин').getDataRange().getValues();
  return rows.slice(1).map(r => ({ image: r[0] || '', name: r[1] || 'Товар', price: Number(r[2]) || 0, course }));
}

function getAchievements(userId, course) {
  const rows = openCourseSheet(course, 'Ачивки').getDataRange().getValues();
  return rows.slice(1).filter(r => String(r[0] || '').split(',').map(id => id.trim()).includes(String(userId))).map(r => ({ title: r[1] || 'Ачивка', image: r[2] || '', course }));
}

function stripDisplaySeconds(value) {
  return String(value || '').trim().replace(/(\b\d{1,2}[:.]\d{2})[:.]\d{2}(\b)/g, '$1');
}

function normalizeSlotTimeColumn(sheet) {
  const range = sheet.getDataRange();
  const displayRows = range.getDisplayValues();
  for (let i = 1; i < displayRows.length; i++) {
    const currentTime = displayRows[i][2];
    const normalizedTime = stripDisplaySeconds(currentTime);
    if (normalizedTime && normalizedTime !== currentTime) {
      sheet.getRange(i + 1, 3).setNumberFormat('@').setValue(normalizedTime);
    }
  }
}

function getSlots(course) {
  const sheet = openCourseSheet(course, 'Слоты');
  normalizeSlotTimeColumn(sheet);
  const rows = sheet.getDataRange().getDisplayValues();
  return rows.slice(1).map(r => ({
    id: r[0],
    date: r[1],
    time: stripDisplaySeconds(r[2]),
    status: r[3],
    userId: r[4],
    username: r[5],
    contact: r[6],
    bookingDate: r[7]
  }));
}

function getGroupSlots(course) {
  const sheet = openCourseSheet(course, 'Группы');
  normalizeSlotTimeColumn(sheet);
  const rows = sheet.getDataRange().getDisplayValues();
  return rows.slice(1).map(r => ({
    id: r[0],
    date: r[1],
    time: stripDisplaySeconds(r[2]),
    title: r[3],
    capacity: Number(r[4]) || 1,
    bookedCount: Number(r[5]) || 0,
    userIds: r[6] || '',
    usernames: r[7] || ''
  }));
}

const MAX_HOMEWORK_FILE_BYTES = 10 * 1024 * 1024;
const HOMEWORK_ROOT_FOLDER_PROPERTY = 'HOMEWORK_UPLOAD_ROOT_FOLDER_ID';

function getHomeworkCourseLabel_(course) {
  const labels = {
    english: 'Английский',
    english2: 'Английский 2',
    physics: 'Физика',
    math: 'Математика',
    biology: 'Биология',
    chemistry: 'Химия',
    french: 'Французский',
    french2: 'Французский 2',
    español: 'Испанский'
  };
  return labels[course] || String(course || 'Другой предмет');
}

function getOrCreateHomeworkFolder_(name, propertyKey, parentFolder) {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty(propertyKey);
  if (savedId) {
    try {
      const savedFolder = DriveApp.getFolderById(savedId);
      if (!parentFolder || savedFolder.getParents().hasNext()) return savedFolder;
    } catch (e) {
      props.deleteProperty(propertyKey);
    }
  }

  const folder = parentFolder
    ? parentFolder.createFolder(name)
    : DriveApp.createFolder(name);
  props.setProperty(propertyKey, folder.getId());
  return folder;
}

function setupHomeworkDriveFolders() {
  const root = getOrCreateHomeworkFolder_(
    'Subtext — Домашние задания',
    HOMEWORK_ROOT_FOLDER_PROPERTY,
    null
  );

  Object.keys(COURSE_TABLES).forEach(courseKey => {
    const label = getHomeworkCourseLabel_(courseKey);
    const safeKey = String(courseKey).replace(/[^a-zA-Z0-9_-]/g, '_');
    getOrCreateHomeworkFolder_(
      label,
      'HOMEWORK_COURSE_FOLDER_' + safeKey,
      root
    );
  });

  return 'Папки домашних заданий для всех предметов Subtext созданы или уже существуют.';
}

function getHomeworkCourseFolder_(course) {
  setupHomeworkDriveFolders();
  const requestedKey = String(course).replace(/[^a-zA-Z0-9_-]/g, '_');
  const requestedId = PropertiesService.getScriptProperties()
    .getProperty('HOMEWORK_COURSE_FOLDER_' + requestedKey);
  if (!requestedId) throw new Error('Не удалось подготовить папку для выбранного предмета.');
  return DriveApp.getFolderById(requestedId);
}

function getOrCreateHomeworkSheet_(course) {
  const spreadsheet = SpreadsheetApp.openById(COURSE_TABLES[course]);
  let sheet = spreadsheet.getSheetByName('ДЗ');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('ДЗ');
    sheet.getRange(1, 1, 1, 6).setValues([[
      'userId', 'username', 'text', 'submittedAt', 'lessonNum', 'status'
    ]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureHomeworkColumns_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(value => String(value).trim());
  if (!headers.some(Boolean)) {
    headers = ['userId', 'username', 'text', 'submittedAt', 'lessonNum', 'status'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  ['fileName', 'fileUrl', 'fileId', 'course'].forEach(name => {
    if (!headers.includes(name)) {
      headers.push(name);
      sheet.getRange(1, headers.length).setValue(name);
    }
  });
  return headers;
}

function handleHomework(data, user, course) {
  const lessonNum = String(data.lessonNum || '').trim().slice(0, 40);
  const comment = String(data.text || '').trim().slice(0, 1000);
  const originalName = String(data.fileName || '').trim();
  const base64 = String(data.fileBase64 || '').replace(/^data:[^,]*,/, '');

  if (!lessonNum) return error('Укажите номер урока.');
  if (!originalName || !base64) return error('Прикрепите файл с домашним заданием.');

  const estimatedBytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (estimatedBytes <= 0 || estimatedBytes > MAX_HOMEWORK_FILE_BYTES) {
    return error('Размер файла должен быть не больше 10 МБ.');
  }

  const extensionMatch = originalName.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  const extension = extensionMatch ? extensionMatch[1] : '';
  const mimeByExtension = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png'
  };
  const mimeType = mimeByExtension[extension];
  if (!mimeType) return error('Поддерживаются PDF, DOC, DOCX, PPT, PPTX, JPG и PNG.');

  const safeStudent = String(user.username || 'Ученик').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'Ученик';
  const safeLesson = lessonNum.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_').slice(0, 30) || 'без_номера';
  const safeCourse = getHomeworkCourseLabel_(course).replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const fileName = 'ДЗ_' + safeCourse + '_' + safeStudent + '_Урок' + safeLesson + '_' + stamp + '.' + extension;

  let file = null;
  try {
    const bytes = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    file = getHomeworkCourseFolder_(course).createFile(blob);

    const homeworkSheet = getOrCreateHomeworkSheet_(course);
    const headers = ensureHomeworkColumns_(homeworkSheet);
    const row = new Array(headers.length).fill('');
    const valuesByHeader = {
      userId: user.id,
      username: user.username,
      text: comment,
      submittedAt: new Date(),
      lessonNum: lessonNum,
      status: 'На проверке',
      fileName: fileName,
      fileUrl: file.getUrl(),
      fileId: file.getId(),
      course: course
    };
    headers.forEach((header, index) => {
      const key = String(header || '').trim();
      if (Object.prototype.hasOwnProperty.call(valuesByHeader, key)) row[index] = valuesByHeader[key];
    });
    homeworkSheet.appendRow(row);

    return json({ success: true, fileName: fileName, fileUrl: file.getUrl(), course: course });
  } catch (err) {
    if (file) {
      try { file.setTrashed(true); } catch (cleanupError) {}
    }
    return error('Не удалось сохранить работу: ' + err.message);
  }
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
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return error('Сейчас много записей. Подождите несколько секунд и попробуйте снова.');
  try {
    const user = getUser(userId);
    if (!user) return error('Пользователь не найден');
    const sheet = openCourseSheet(course, 'Слоты');
    normalizeSlotTimeColumn(sheet);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(slotId)) continue;
      if (String(rows[i][3]).trim().toLowerCase() !== 'free') return error('Слот уже занят. Обновите список доступных занятий.');
      sheet.getRange(i + 1, 4).setValue('booked');
      sheet.getRange(i + 1, 5).setValue(userId);
      sheet.getRange(i + 1, 6).setValue(user.username || '');
      sheet.getRange(i + 1, 8).setValue(new Date());
      SpreadsheetApp.flush();
      const displayRows = sheet.getDataRange().getDisplayValues();
      addSchedule(userId, displayRows[i][1], stripDisplaySeconds(displayRows[i][2]), course);
      return json({ success: true });
    }
    return error('Слот не найден. Возможно, его уже удалили или изменили.');
  } finally { lock.releaseLock(); }
}

function bookGroupSlot(userId, slotId, course) {
  if (!slotId) return error('slotId не указан');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return error('Сейчас много записей. Подождите несколько секунд и попробуйте снова.');
  try {
    const user = getUser(userId);
    if (!user) return error('Пользователь не найден');
    const sheet = openCourseSheet(course, 'Группы');
    normalizeSlotTimeColumn(sheet);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(slotId)) continue;
      const capacity = Math.max(1, Number(rows[i][4]) || 1);
      const bookedCount = Math.max(0, Number(rows[i][5]) || 0);
      const ids = String(rows[i][6] || '').split(',').map(value => value.trim()).filter(Boolean);
      if (ids.includes(String(userId))) return error('Вы уже записаны на это занятие.');
      if (bookedCount >= capacity || ids.length >= capacity) return error('Мест больше нет. Обновите список групповых занятий.');
      const nextIds = [...ids, String(userId)];
      const names = String(rows[i][7] || '').split(',').map(value => value.trim()).filter(Boolean);
      if (user.username && !names.includes(String(user.username))) names.push(String(user.username));
      sheet.getRange(i + 1, 6).setValue(Math.max(bookedCount + 1, nextIds.length));
      sheet.getRange(i + 1, 7).setValue(nextIds.join(','));
      sheet.getRange(i + 1, 8).setValue(names.join(', '));
      SpreadsheetApp.flush();
      const displayRows = sheet.getDataRange().getDisplayValues();
      addSchedule(userId, displayRows[i][1], stripDisplaySeconds(displayRows[i][2]), course);
      return json({ success: true });
    }
    return error('Групповое занятие не найдено. Возможно, его уже удалили или изменили.');
  } finally { lock.releaseLock(); }
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

function addSchedule(userId, date, time, course) {
  const dateText = String(date || '').trim();
  const timeText = stripDisplaySeconds(time);
  const formattedDateTime = [dateText, timeText].filter(Boolean).join(' в ');
  if (!formattedDateTime) return;

  const sheet = openUsersSheet('Лист1');
  const rows = sheet.getDataRange().getValues();
  if (!rows.length) throw new Error('Главная таблица не содержит строки заголовков.');
  const headers = rows[0].map(header => String(header).trim());
  const userIdCol = findHeaderIndex(headers, ['userId', 'user_id', 'id'], 0);
  const scheduleCol = findHeaderIndex(headers, ['schedule', 'расписание'], 6);
  const subjectCol = findHeaderIndex(headers, ['subject', 'subjects', 'course', 'courses', 'предмет', 'предметы'], -1);

  for (let i = 1; i < rows.length; i++) {
    if (String(getCell(rows[i], userIdCol)).trim() !== String(userId).trim()) continue;
    const rawSubjects = subjectCol >= 0 ? String(getCell(rows[i], subjectCol) || '').trim() : '';
    const courses = splitSubjectList(rawSubjects);
    const scheduleEntry = courses.length > 1 ? `${String(course || '').trim()}: ${formattedDateTime}` : formattedDateTime;
    const currentSchedule = String(getCell(rows[i], scheduleCol) || '').trim();
    // Поддерживаем старые записи с запятыми и новые записи с переносами строк.
    const existingEntries = currentSchedule
      ? currentSchedule.split(/\r?\n|;\s*|,(?=\s*(?:(?:[^,;:\n]+)\s*:\s*)?\d{1,2}[.\/-]\d{1,2})/)
          .map(value => value.trim()).filter(Boolean)
      : [];
    const normalizeEntry = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const alreadyExists = existingEntries.some(value => normalizeEntry(value) === normalizeEntry(scheduleEntry));
    if (!alreadyExists) {
      const updatedSchedule = currentSchedule ? `${currentSchedule}\n${scheduleEntry}` : scheduleEntry;
      sheet.getRange(i + 1, scheduleCol + 1).setValue(updatedSchedule);
      SpreadsheetApp.flush();
    }
    return;
  }
  throw new Error('Не удалось найти ученика в главной таблице для обновления расписания.');
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

