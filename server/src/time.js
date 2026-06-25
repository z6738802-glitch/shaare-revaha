'use strict';

const TZ = 'Asia/Jerusalem';

// תאריך היום בישראל (YYYY-MM-DD)
function todayIL() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

// שעה נוכחית בישראל כ-HH:MM
function nowTimeIL() {
  return new Date().toLocaleTimeString('en-GB', {
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
// windowMinutes = כמה דקות לפני הנסיעה ניתן להזמין
function canBook(departureTime, windowMinutes) {
  const now = timeToMinutes(nowTimeIL());
  const dep = timeToMinutes(departureTime);
  const diff = dep - now;
  // ניתן להזמין: לא פחות מ-5 דקות לפני, לא יותר מ-window לפני
  return diff >= 5 && diff <= windowMinutes;
}

// בדיקה האם ניתן לבטל (לפחות 5 דקות לפני הנסיעה)
function canCancel(departureTime) {
  const now = timeToMinutes(nowTimeIL());
  const dep = timeToMinutes(departureTime);
  return dep - now >= 5;
}

module.exports = { todayIL, nowTimeIL, timeToMinutes, canBook, canCancel };
