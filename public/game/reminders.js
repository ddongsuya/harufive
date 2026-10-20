import { dateKey, addDays } from './game-core.js';

// Calendar reminders work after the game is closed once the player saves the
// recurring event in their calendar. Preparing a file is never treated as proof
// that a calendar accepted it or that device notifications have been enabled.
export const REMINDER_STORAGE_KEY = 'haru-five-calendar-reminder-v1';
export const GAME_URL = 'https://haru-five.limjm900202.chatgpt.site/#challenge';

export function freshReminder() {
  return { version: 1, time: '20:00', status: 'none', dismissedOn: null, uid: null, preparedAt: null, confirmedAt: null };
}

export function validReminderTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function normalizeReminder(value) {
  const initial = freshReminder();
  if (!value || value.version !== 1) return initial;
  const timestamp = input => typeof input === 'string' && Number.isFinite(Date.parse(input)) ? input : null;
  const status = ['none', 'prepared', 'confirmed'].includes(value.status) ? value.status : 'none';
  return {
    ...initial,
    time: validReminderTime(value.time) ? value.time : initial.time,
    status,
    dismissedOn: /^\d{4}-\d{2}-\d{2}$/.test(value.dismissedOn || '') ? value.dismissedOn : null,
    uid: typeof value.uid === 'string' && /^[A-Za-z0-9@._-]{1,160}$/.test(value.uid) ? value.uid : null,
    preparedAt: timestamp(value.preparedAt),
    confirmedAt: status === 'confirmed' ? timestamp(value.confirmedAt) : null,
  };
}

export function reminderTimeLabel(time) {
  if (!validReminderTime(time)) return '';
  const [hour, minute] = time.split(':').map(Number);
  return `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${String(minute).padStart(2, '0')}`;
}

export function shouldOfferReminder(preferences, today = dateKey()) {
  return preferences.status === 'none' && preferences.dismissedOn !== today;
}

function calendarText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

// RFC 5545: content lines use CRLF and fold at no more than 75 octets.
// Count encoded bytes so a Korean character is never split in the middle.
function foldLine(line) {
  const encoder = new TextEncoder();
  const lines = [];
  let current = '', bytes = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (bytes + width > 75) { lines.push(current); current = ' '; bytes = 1; }
    current += char; bytes += width;
  }
  lines.push(current);
  return lines.join('\r\n');
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function createCalendarReminder({ time = '20:00', now = new Date(), uid } = {}) {
  if (!validReminderTime(time)) throw new Error('알림 시간을 다시 선택해 주세요.');
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error('현재 날짜를 확인할 수 없어요.');
  if (typeof uid !== 'string' || !/^[A-Za-z0-9@._-]{1,160}$/.test(uid)) throw new Error('일정 식별자를 만들 수 없어요. 다시 시도해 주세요.');
  const firstDay = addDays(dateKey(instant), 1);
  const start = new Date(`${firstDay}T${time}:00+09:00`);
  const end = new Date(start.getTime() + 5 * 60000);
  const title = '하루다섯 · 오늘의 5문제';
  const description = `오늘의 다섯 문제가 기다리고 있어요.\n한국시간 기준으로 매일 새로운 도전이 열려요.\n게임 열기: ${GAME_URL}`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Haru Five//Daily Challenge//KO',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${utcStamp(instant)}`, `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`,
    'RRULE:FREQ=DAILY', `SUMMARY:${calendarText(title)}`, `DESCRIPTION:${calendarText(description)}`,
    `URL:${GAME_URL}`, 'STATUS:CONFIRMED', 'TRANSP:TRANSPARENT',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0S',
    `DESCRIPTION:${calendarText('하루다섯에서 오늘의 다섯 문제를 만나보세요.')}`,
    'END:VALARM', 'END:VEVENT', 'END:VCALENDAR',
  ];
  const manualText = `${title}\n시작: ${firstDay} ${time} (한국 시간)\n반복: 매일\n알림: 일정 시작 시각\n소요 시간: 5분\n${GAME_URL}`;
  return { content: lines.map(foldLine).join('\r\n') + '\r\n', firstDay, time, uid, title, manualText, createdAt: instant.toISOString(), filename: 'haru-five-daily-reminder.ics' };
}
