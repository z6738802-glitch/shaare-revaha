'use strict';

const TZ = 'Asia/Jerusalem';

// המרת timestamp (שניות unix) לאובייקט Date, או עכשיו אם לא ניתן
function toDate(apiTime) {
  if (apiTime) {
    const ts = parseInt(apiTime);
    if (!isNaN(ts)) return new Date(ts * 1000);
  }
  return new Date();
}

// תאריך לפי ישראל (YYYY-MM-DD)
function todayIL(apiTime) {
  return toDate(apiTime).toLocaleDateString('en-CA', { timeZone: TZ });
}

// שעה נוכחית בישראל כ-HH:MM
function nowTimeIL(apiTime) {
  return toDate(apiTime).toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// המרת HH:MM למספר דקות מתחילת היום
function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// בדיקה האם ניתן להזמין נסיעה (לפי חלון זמן)
function canBook(departureTime, windowMinutes, apiTime) {
  const now = timeToMinutes(nowTimeIL(apiTime));
  const dep = timeToMinutes(departureTime);
  const diff = dep - now;
  return diff >= 5 && diff <= windowMinutes;
}

// בדיקה האם ניתן לבטל (לפחות 5 דקות לפני הנסיעה)
function canCancel(departureTime, apiTime) {
  const now = timeToMinutes(nowTimeIL(apiTime));
  const dep = timeToMinutes(departureTime);
  return dep - now >= 5;
}

module.exports = { todayIL, nowTimeIL, timeToMinutes, canBook, canCancel, toDate };
