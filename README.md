Subtext cabinet setup

## Главная таблица учеников
Сейчас фронтенд ожидает, что Apps Script вернет данные ученика в объекте `user`. Базовый лист `Лист1` может оставаться таким:

| userId | username | progress | coins | joined | lesson_link | schedule | level_english | level_physics | subject | аватар |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |


- `userId` — ID, который вводится на странице входа.
- `username` — имя, которое показывается в профиле.
- `progress` — старый общий процент прогресса от `0` до `100`; можно оставить для совместимости, но для нескольких предметов лучше использовать отдельный лист `Прогресс` ниже.
- `coins` — общий баланс монет.
- `lesson_link` — ссылка на урок, которую API должен вернуть фронтенду как `user.link`.
- `schedule` — расписание, которое API должен вернуть как `user.schedule`.
- `- `level_english` и `level_physics` — старые колонки для обратной совместимости. Для новых предметов такие колонки больше не добавляем.
- `subject` — список предметов пользователя через запятую, например `english,physics,math,french`, по которому API должен сформировать `user.courses`.
- `аватар` — ссылка на картинку, которую API должен вернуть как `user.avatarUrl`.

Итог по первому листу: структуру `Лист1` можно оставить ровно такой, как она есть сейчас. Для новых предметов **не нужно** добавлять `level_french`, `level_math`, `progress_french`, `rank_french` и похожие колонки в `Лист1`; все предметные уровни, прогресс и места по школе теперь ведутся строками на листе `Прогресс`.
## Прогресс, уровень и место по школе по каждому предмету

Лучший вариант — не добавлять бесконечно много колонок `progress_math`, `level_math`, `rank_math` в `Лист1`, а сделать отдельный лист в главной таблице: `Прогресс`.

Рекомендуемые заголовки листа `Прогресс`:

| userId | course | progress | level | schoolRank | schoolTopText |
| --- | --- | --- | --- | --- | --- |
| 12345 | english | 82 | B1 | 7 | 7 место по школе |
| 12345 | physics | 64 | Средний | 3 | Топ 3 в школе |

Как заполнять:

- `userId` — ID ученика из `Лист1`.
- `course` — техническое имя предмета, точно такое же, как в `COURSE_TABLES` Apps Script и в колонке `subject`: `english`, `physics`, `math`, `biology` и т.д.
- `progress` — число от `0` до `100`; именно оно заполняет бар в личном кабинете.
- `level` — уровень ученика по этому предмету.
- `schoolRank` — числовое место по школе, например `7`; сайт покажет `7 место по школе · Английский`.
- `schoolTopText` — необязательный красивый текст вместо числа, например `Топ 3 в школе`; если он есть, можно отдавать его в API как рейтинг.

Фронтенд уже умеет читать предметный прогресс из ответа API в любом из этих форматов:

```json
{
  "user": {
    "progress": { "english": 82, "physics": 64 },
    "levels": { "english": "B1", "physics": "Средний" },
    "ranks": { "english": "7", "physics": "Топ 3 в школе" }
  }
}
```

или так:

```json
{
  "user": {
    "progressByCourse": { "english": 82, "physics": 64 },
    "courseRanks": { "english": "7 место по школе", "physics": "Топ 3 в школе" }
  }
}
```

Если Apps Script пока возвращает старый `progress: 50` одним числом, сайт продолжит работать, но это будет один и тот же прогресс для всех предметов.

### Что поменять в Apps Script для листа `Прогресс`

Добавьте функцию чтения предметной статистики из главной таблицы:

Во второй вкладке этой же таблицы должен быть лист `поддержка` с заголовками в первой строке:
```js
function getUserCourseStats(userId) {
  const sheet = SpreadsheetApp.openById(USERS_SHEET_ID).getSheetByName('Прогресс');
  if (!sheet) return { progress: {}, levels: {}, ranks: {} };

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(String);
  const userIdCol = headers.indexOf('userId');
  const courseCol = headers.indexOf('course');
  const progressCol = headers.indexOf('progress');
  const levelCol = headers.indexOf('level');
  const rankCol = headers.indexOf('schoolRank');
  const topTextCol = headers.indexOf('schoolTopText');

  const stats = { progress: {}, levels: {}, ranks: {} };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[userIdCol]).trim() !== String(userId).trim()) continue;

    const course = String(row[courseCol] || '').trim().toLowerCase();
    if (!course) continue;

    stats.progress[course] = Number(row[progressCol]) || 0;
    stats.levels[course] = levelCol >= 0 ? row[levelCol] || '' : '';
    stats.ranks[course] = topTextCol >= 0 && row[topTextCol]
      ? row[topTextCol]
      : (rankCol >= 0 ? row[rankCol] || '' : '');
  }

  return stats;
}
```

В `getUser(userId)` после нахождения строки ученика получите статистику:

```js
const stats = getUserCourseStats(userId);
```

И верните ее в объекте пользователя так:

```js
return {
  id: rows[i][0],
  username: rows[i][1],
  progress: Object.keys(stats.progress).length ? stats.progress : (rows[i][2] || 0),
  coins: rows[i][3] || 0,
  link: rows[i][5] || '',
  schedule: rows[i][6] || '',
  levels: Object.keys(stats.levels).length
    ? stats.levels
    : { english: rows[i][7] || '', physics: rows[i][8] || '' },
  ranks: stats.ranks,
  avatarUrl: rows[i][10] || null,
  courses: coursesStr.split(',').map(c => c.trim()).filter(Boolean),
};
```

## Как добавить новые предметы

Для каждого нового предмета нужно сделать две вещи.

1. Создать отдельную Google-таблицу курса с такими же листами, как у английского/физики: `Уроки`, `Материалы`, `Магазин`, `Ачивки`, `Слоты`, `Группы`, `ДЗ`, `Заказы`.
2. Добавить ID таблицы в `COURSE_TABLES` Apps Script:

```js
const COURSE_TABLES = {
  english: '...',
  physics: '...',
  math: 'ID_ТАБЛИЦЫ_МАТЕМАТИКИ',
  biology: 'ID_ТАБЛИЦЫ_БИОЛОГИИ',
};
```

После этого в `Лист1` в колонке `subject` у ученика можно писать `english,physics,math,biology`, а в листе `Прогресс` добавить строки по каждому предмету.

Важно: если добавляете новый предмет только в Google Sheets, но не добавляете его в `COURSE_TABLES`, Apps Script вернет ошибку `Курс "..." не найден`.

## Поддержка

Создайте в главной таблице лист `Поддержка` с заголовками в первой строке:

| Дата | userId | Вопрос | Ответ |
| --- | --- | --- | --- |

Важные соответствия для API:

- `get_support` должен вернуть массив `messages`, где `Вопрос` попадает в `question`, а `Ответ` — в `answer`.
- `send_support` должен записывать новый вопрос пользователя в колонку `Вопрос`, а `Ответ` может оставаться пустым до ответа преподавателя.

#### Таблицы курсов

Если предмет вынесен в отдельную Google-таблицу, Apps Script должен читать из нее эти листы и возвращать данные в формате, который ожидает `subtext.js`.

#### `Уроки`

| num | link | hwLink | assigned_ids | subject |
| --- | --- | --- | --- | --- |

- `subject` — необязательная колонка E для случаев, когда одна предметная таблица используется сразу для нескольких предметов. Если ячейка пустая, урок работает по-старому и показывается всем подходящим ученикам этой таблицы. Если в ячейке указан предмет, урок показывается только при выборе такого же предмета в личном кабинете; можно указывать несколько предметов через запятую, `;`, `|` или перенос строки.

> Важно: если в таблице сейчас написано `ssigned_ids`, это похоже на опечатку. Если Apps Script ищет `assigned_ids`, из-за пропущенной буквы `a` уроки для ученика не найдутся.

#### `Материалы`

| Название | Ссылка |
| --- | --- |

#### `магазин`

| товар | описание | цена |
| --- | --- | --- |

#### `слоты`

| id | date | time | status | userId | username | contact | bookingDate |
| --- | --- | --- | --- | --- | --- | --- | --- |

#### `группы`

| id | date | time | title | capacity | bookedCount | userIds | usernames |
| --- | --- | --- | --- | --- | --- | --- | --- |

#### `ачивки`

Ачивки больше не должны начисляться по уровню. В каждой таблице предмета должен быть свой лист `Ачивки`, и строки в нем привязываются к ID ученика. Так у английского, физики, математики и других предметов могут быть разные наборы достижений для одного и того же ученика.

Рекомендуемый формат, если одна строка — одна ачивка одного ученика:

| userId | название | иконка |
| --- | --- | --- |
| 12345 | First speaking win | https://example.com/speaking.png |

Если одну ачивку нужно выдать нескольким ученикам одной строкой, можно использовать список ID через запятую, точку с запятой или перенос строки:

| assigned_ids | название | иконка |
| --- | --- | --- |
| 12345,67890 | Grammar hero | https://example.com/grammar.png |

Apps Script должен читать лист `Ачивки` именно из таблицы выбранного предмета и возвращать только ачивки текущего `userId`, либо возвращать поле `userId`/`assigned_ids`, чтобы фронтенд дополнительно отфильтровал лишние достижения. Поле `уровень` для начисления ачивок больше не используется. Пример фильтрации на стороне Apps Script:

```js
function idListContains(value, userId) {
  return String(value || '')
    .split(/[\n,;|]+/)
    .map(id => id.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(userId).trim().toLowerCase());
}

function getAchievementsForUser(course, userId) {
  const ss = SpreadsheetApp.openById(COURSE_TABLES[course]);
  const sheet = ss.getSheetByName('Ачивки');
  if (!sheet) return [];

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(String);
  const userIdCol = headers.indexOf('userId');
  const assignedIdsCol = headers.indexOf('assigned_ids');
  const titleCol = headers.indexOf('название');
  const iconCol = headers.indexOf('иконка');

  return rows.slice(1)
    .filter(row => {
      if (userIdCol >= 0 && String(row[userIdCol]).trim() === String(userId).trim()) return true;
      if (assignedIdsCol >= 0 && idListContains(row[assignedIdsCol], userId)) return true;
      return false;
    })
    .map(row => ({
      course,
      userId,
      title: titleCol >= 0 ? row[titleCol] : '',
      image: iconCol >= 0 ? row[iconCol] : '',
    }));
}
```

#### `ДЗ`

| userId | username | text | date | lessonNum | status |
| --- | --- | --- | --- | --- | --- |

#### `Заказы`

| Дата | UserID | Имя | Товар | Цена | Статус |
| --- | --- | --- | --- | --- | --- |

### Что проверить, если личный кабинет зависает на «Загрузка...»

1. В `index.html` и `subtext.js` должен стоять один и тот же актуальный Apps Script URL.
2. После замены Apps Script URL нужно сделать новый Deploy в Google Apps Script и выбрать доступ «Anyone/Anyone with the link».
3. После обновления файлов на хостинге нужно открыть страницу с очисткой кэша. В `lk.html` ссылка на `subtext.js` содержит версию `?v=20260531`, чтобы браузер не держал старый JS.
4. Если вход проходит, но `lk.html` не открывается дальше, проблема чаще всего в ответе API на запрос кабинета: `subtext.js` ожидает JSON с `success: true` и объектом `user`.

### Внутренние уведомления

Для уведомлений можно сделать отдельный лист `Уведомления` в главной таблице. Это удобнее, чем один столбик в `Лист1`, потому что можно хранить историю, дату и статус прочтения.

Рекомендуемые заголовки листа `Уведомления`:

| id | Дата | userId | Заголовок | Текст | Статус | sound |
| --- | --- | --- | --- | --- | --- | --- |

Как это должно работать в Apps Script:

- `userId` — ID конкретного ученика. Для уведомления всем ученикам можно договориться использовать значение `all`.
- `Заголовок` — короткий заголовок уведомления, например `Новые слоты`.
- `Текст` — основной текст, например `Я открыла запись на новые слоты, выберите удобное время.`
- `Статус` — можно хранить `new` / `read` или `прочитано`.
- `sound` — `TRUE`/`FALSE`, чтобы включать или выключать звук для конкретного уведомления.

Фронтенд уже умеет запрашивать уведомления так:

```text
?action=get_notifications&userId=ID_УЧЕНИКА
```

Ожидаемый JSON-ответ:

```json
{
  "success": true,
  "notifications": [
    {
      "id": "slot-2026-05-31-1",
      "title": "Новые слоты",
      "text": "Я открыла запись на новые слоты, выберите удобное время.",
      "date": "2026-05-31",
      "read": false,
      "sound": true
    }
  ]
}
```

После нажатия «прочитано» фронтенд вызывает:

```text
?action=mark_notifications_read&userId=ID_УЧЕНИКА
```

Если отдельный лист пока делать не хочется, можно временно добавить в `Лист1` столбик `notifications` и возвращать его из API как `user.notifications`. Несколько уведомлений в одной ячейке можно разделять символом `|`, но для нормальной работы со статусами прочтения лучше отдельный лист.

Важно: если просто добавить лист/столбик в Google Sheets, но не обновить Apps Script, сайт не сможет увидеть эти данные. Apps Script обязательно должен либо отдавать уведомления в общем ответе кабинета, либо поддерживать `action=get_notifications`.
