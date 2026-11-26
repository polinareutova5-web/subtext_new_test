// Copy this file to Google Apps Script and deploy it as a Web App.
// This script is the API layer between the student cabinet and Google Sheets.
const SPREADSHEET_ID = '1jht0DzSZpECR--i-2JauGXknH4Zn48m4Sx5V0xQctdo';
const USERS_SHEET_ID = SPREADSHEET_ID;
// One subject per installation. Change these two values for another tutor.
const SUBJECT_KEY = 'english';
const SUBJECT_LABEL = 'Английский';
const API_VERSION = 'sales-demo-single-sheet-1';


function removeLegacyColumn_(sheet, headerName) {
  if (!sheet || sheet.getLastColumn() < 1) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(v => String(v).trim());
  const index = headers.indexOf(headerName);
  if (index >= 0) sheet.deleteColumn(index + 1);
}

function setupTemplateSheets() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf('ВСТАВЬТЕ_') === 0) throw new Error('Сначала укажите ID Google-таблицы в SPREADSHEET_ID.');
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  const tabs={
    'Лист1':['userId','username','lessonsRemaining','lesson_link','schedule','subject','avatarUrl'],
    'Прогресс':['userId','progress','level','schoolRank','schoolTopText'],
    'Уроки':['lessonNum','link','hwLink','userIds','subject'],
    'Материалы':['title','link','sort'],
    'Слоты':['id','date','time','status','userId','username','bookingDate'],
    'Группы':['id','date','time','title','capacity','booked','userIds','usernames'],
    'ДЗ':['userId','username','text','submittedAt','lessonNum','fileName','fileUrl','fileId'],
  };
  Object.keys(tabs).forEach(name=>{let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0){sh.getRange(1,1,1,tabs[name].length).setValues([tabs[name]]);sh.setFrozenRows(1);sh.getRange(1,1,1,tabs[name].length).setFontWeight('bold');}});
  removeLegacyColumn_(ss.getSheetByName('Лист1'), 'progress');
  removeLegacyColumn_(ss.getSheetByName('Слоты'), 'contact');
  removeLegacyColumn_(ss.getSheetByName('ДЗ'), 'status');
  ensureHomeworkColumns_();
  getHomeworkFolder_(); // Создаём общую папку и сохраняем её ID в свойствах проекта.
  return 'Готово: листы созданы, папка «Домашние задания» подготовлена.';
}

// ================= ОСНОВНОЙ РОУТЕР (doGet) =================
function doGet(e) {
  try {
    const p = e.parameter || {};
    const action = p.action || '';
    
    // 2. ДЕЙСТВИЯ УЧЕНИКА (требуют userId)
    const userId = p.userId;
    if (!userId) {
      return error('userId не указан. Откройте личный кабинет по персональной ссылке.');
    }

    const user = getUser(userId);
    if (!user) return error('Пользователь не найден');
    const course = SUBJECT_KEY;

    if (action === 'check_user') return json({ success: true });
    if (action === 'get_slots') return json({ success: true, slots: getSlots(course) });
    if (action === 'get_group_slots') return json({ success: true, slots: getGroupSlots(course) });
    if (action === 'book_slot') return bookSlot(userId, p.slotId, course);
    if (action === 'book_group_slot') return bookGroupSlot(userId, p.slotId, course);

    const agg = { lessons: getLessonsByUser(userId, SUBJECT_KEY), materials: getMaterialsByUser(SUBJECT_KEY) };

    return json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        progress: user.progress,
        link: user.link,
        schedule: user.schedule,
        lessonsRemaining: user.lessonsRemaining,
        paidLessons: user.paidLessons,
        remainingLessons: user.lessonsRemaining,
        levels: user.levels,
        ranks: user.ranks,
        avatarUrl: user.avatarUrl,
        courses: user.courses,
        subject: SUBJECT_LABEL,
      },
      lessons: agg.lessons,
      materials: agg.materials,
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
      if (!user) return error('Ученик не найден. Перезагрузите личный кабинет.');
      return handleHomework(data, user, SUBJECT_KEY);
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

function normalizeSubjectValue(value) { return String(value || '').trim().toLowerCase().replace(/ё/g, 'е'); }
function splitSubjectList(value) { return String(value || '').split(/[\n,;|]+/).map(normalizeSubjectValue).filter(Boolean); }
function lessonSubjectMatchesCourse() { return true; }

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
  const linkCol = findHeaderIndex(headers, ['lesson_link', 'link', 'ссылка'], 5);
  const scheduleCol = findHeaderIndex(headers, ['schedule', 'расписание'], 6);
  const subjectCol = findHeaderIndex(headers, ['subject', 'subjects', 'course', 'courses', 'предмет'], 7);
  const avatarCol = findHeaderIndex(headers, ['аватар', 'avatar', 'avatarUrl', 'avatar_url'], 8);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(getCell(row, userIdCol)).trim() === String(userId).trim()) {
      const courses = [SUBJECT_KEY];
      const stats = getUserCourseStats(userId);
      return {
        id: getCell(row, userIdCol),
        username: getCell(row, usernameCol),
        progress: stats.progress,
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
  if (userIdCol === -1) return { progress: {}, levels: {}, ranks: {} };
  const stats = { progress: {}, levels: {}, ranks: {} };
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[userIdCol]).trim() !== String(userId).trim()) continue;
    const course = courseCol >= 0 ? normalizeCourse(row[courseCol]) : SUBJECT_KEY;
    if (course && course !== SUBJECT_KEY) continue;
    if (progressCol >= 0) stats.progress[course] = Math.max(0, Math.min(Number(row[progressCol]) || 0, 100));
    if (levelCol >= 0) stats.levels[course] = row[levelCol] || '';
    stats.ranks[course] = topTextCol >= 0 && row[topTextCol] ? row[topTextCol] : (rankCol >= 0 ? row[rankCol] || '' : '');
  }
  return stats;
}

function openCourseSheet(course, sheetName) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Лист "${sheetName}" не найден в таблице`);
  return sheet;
}

function getLessonsByUser(userId, course) {
  const rows = openCourseSheet(course, 'Уроки').getDataRange().getValues();
  const res = [];
  for (let i = 1; i < rows.length; i++) {
    const ids = String(rows[i][3] || '').split(/[\n,;|]+/).map(x => x.trim()).filter(Boolean);
    const lessonSubject = rows[i][4] || '';
    if (ids.length === 0 || ids.includes(String(userId))) {
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
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return [];
  const headers = values[0].map(v => String(v).trim());
  const col = name => headers.indexOf(name);
  return values.slice(1).map(r => ({
    id: r[col('id')], date: r[col('date')],
    time: stripDisplaySeconds(r[col('time')]), status: r[col('status')],
    userId: r[col('userId')], username: r[col('username')],
    bookingDate: col('bookingDate') >= 0 ? r[col('bookingDate')] : ''
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
const HOMEWORK_FOLDER_PROPERTY = 'HOMEWORK_UPLOAD_FOLDER_ID';

function ensureHomeworkColumns_() {
  const sheet = openCourseSheet(SUBJECT_KEY, 'ДЗ');
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(String);
  ['fileName', 'fileUrl', 'fileId'].forEach(name => {
    if (!headers.includes(name)) {
      const nextColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextColumn).setValue(name);
      headers.push(name);
    }
  });
}

function getHomeworkFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty(HOMEWORK_FOLDER_PROPERTY);
  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (e) {
      props.deleteProperty(HOMEWORK_FOLDER_PROPERTY);
    }
  }
  const folder = DriveApp.createFolder('Домашние задания');
  props.setProperty(HOMEWORK_FOLDER_PROPERTY, folder.getId());
  return folder;
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
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const fileName = 'ДЗ_' + safeStudent + '_Урок' + safeLesson + '_' + stamp + '.' + extension;

  try {
    const bytes = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    const file = getHomeworkFolder_().createFile(blob);
    try {
      const homeworkSheet = openCourseSheet(course, 'ДЗ');
      ensureHomeworkColumns_();
      const headers = homeworkSheet.getRange(1, 1, 1, homeworkSheet.getLastColumn()).getDisplayValues()[0].map(value => String(value).trim());
      const row = new Array(headers.length).fill('');
      const valuesByHeader = {
        userId: user.id, username: user.username, text: comment,
        submittedAt: new Date(), lessonNum, fileName,
        fileUrl: file.getUrl(), fileId: file.getId()
      };
      headers.forEach((header, index) => {
        if (Object.prototype.hasOwnProperty.call(valuesByHeader, header)) row[index] = valuesByHeader[header];
      });
      homeworkSheet.appendRow(row);
    } catch (sheetError) {
      file.setTrashed(true);
      throw sheetError;
    }
    return json({ success: true, fileName: fileName });
  } catch (err) {
    return error('Не удалось сохранить работу: ' + err.message);
  }
}

function bookSlot(userId, slotId, course) {
  if (!slotId) return error('slotId не указан');
  const user = getUser(userId);
  if (!user) return error('Пользователь не найден');
  const sheet = openCourseSheet(course, 'Слоты');
  normalizeSlotTimeColumn(sheet);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(slotId)) {
      if (rows[i][3] !== 'free') return error('Слот уже занят');
      const headers = rows[0].map(value => String(value).trim());
      const setByHeader = (name, value) => {
        const column = headers.indexOf(name);
        if (column >= 0) sheet.getRange(i + 1, column + 1).setValue(value);
      };
      setByHeader('status', 'booked');
      setByHeader('userId', userId);
      setByHeader('username', user.username);
      setByHeader('bookingDate', new Date());
      const displayRows = sheet.getDataRange().getDisplayValues();
      addSchedule(userId, displayRows[i][1], stripDisplaySeconds(displayRows[i][2]), course);
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
  normalizeSlotTimeColumn(sheet);
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
      const displayRows = sheet.getDataRange().getDisplayValues();
      addSchedule(userId, displayRows[i][1], stripDisplaySeconds(displayRows[i][2]), course);
      return json({ success: true });
    }
  }
  return error('Слот не найден');
}

function addSchedule(userId, date, time, course) {
  const dateText = String(date || '').trim();
  const timeText = stripDisplaySeconds(time);
  const fmt = [dateText, timeText].filter(Boolean).join(' в ');
  const sheet = openUsersSheet('Лист1');
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(h => String(h).trim());

  const userIdCol = findHeaderIndex(headers, ['userId', 'user_id', 'id'], 0);
  const scheduleCol = findHeaderIndex(headers, ['schedule', 'расписание'], 6);
  const subjectCol = findHeaderIndex(
    headers,
    ['subject', 'subjects', 'course', 'courses', 'предмет', 'предметы'],
    -1
  );

  for (let i = 1; i < rows.length; i++) {
    if (String(getCell(rows[i], userIdCol)).trim() !== String(userId).trim()) continue;

    const rawSubjects = subjectCol >= 0
      ? String(getCell(rows[i], subjectCol) || '').trim()
      : '';

    const courses = splitSubjectList(rawSubjects);

    // Один предмет: полностью сохраняем старый формат.
    // 2+ предметов: каждый урок явно получает свой предмет.
    const scheduleEntry = courses.length > 1
      ? `${String(course || '').trim()}: ${fmt}`
      : fmt;

    const currentSchedule = String(getCell(rows[i], scheduleCol) || '').trim();

    // Не добавляем один и тот же урок повторно.
    const existingEntries = currentSchedule
      ? currentSchedule.split(/\\n|,(?=\\s*(?:[^,]+):\\s*\\d{1,2}[.\\/-])|;\\s*/).map(x => x.trim()).filter(Boolean)
      : [];

    if (!existingEntries.includes(scheduleEntry)) {
      const updatedSchedule = currentSchedule
        ? `${currentSchedule}, ${scheduleEntry}`
        : scheduleEntry;
      sheet.getRange(i + 1, scheduleCol + 1).setValue(updatedSchedule);
    }

    break;
  }
}
