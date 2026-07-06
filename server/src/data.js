'use strict';

// נסיעות קבועות
const RIDES = [
  { id: 1, direction: 'beitar_hadassah', departure_time: '08:30', label: 'ביתר להדסה 08:30' },
  { id: 2, direction: 'beitar_hadassah', departure_time: '12:00', label: 'ביתר להדסה 12:00' },
  { id: 3, direction: 'beitar_hadassah', departure_time: '16:30', label: 'ביתר להדסה 16:30' },
  { id: 4, direction: 'beitar_hadassah', departure_time: '19:00', label: 'ביתר להדסה 19:00' },
  { id: 5, direction: 'hadassah_beitar', departure_time: '09:30', label: 'הדסה לביתר 09:30' },
  { id: 6, direction: 'hadassah_beitar', departure_time: '13:00', label: 'הדסה לביתר 13:00' },
  { id: 7, direction: 'hadassah_beitar', departure_time: '17:30', label: 'הדסה לביתר 17:30' },
  { id: 8, direction: 'hadassah_beitar', departure_time: '20:00', label: 'הדסה לביתר 20:00' },
];

// תחנות גבעה A
const STATIONS_A = [
  { id: 1,  name: 'הרמ"ז ליד בית כנסת סדיגורא' },
  { id: 2,  name: 'קניבסקי 5' },
  { id: 3,  name: 'בבא סאלי 17' },
  { id: 4,  name: 'בבא סאלי מול כולל סטור' },
  { id: 5,  name: 'בן זכאי מול חסד לאלפיים' },
  { id: 6,  name: 'בן זכאי מול פארק חזון יוסף' },
  { id: 7,  name: 'אלעזר המודעי מול יריד ביתר' },
  { id: 8,  name: 'אלעזר המודעי מול אהבת חסד' },
  { id: 9,  name: 'רבי עקיבא מול קידי שיק' },
  { id: 10, name: 'רבי עקיבא בית ברכה' },
  { id: 11, name: 'רבי עקיבא לציון ברינה' },
  { id: 12, name: 'אחרונה יציאה מביתר ליד הש"ג' },
];

// תחנות גבעה B
const STATIONS_B = [
  { id: 1,  name: 'עזרה ואחווה' },
  { id: 2,  name: 'מעזריטש מול 45 ליד בית כנסת רחמסטריווקא' },
  { id: 3,  name: 'מעזריטש מול תלמוד תורה אורחות חיים' },
  { id: 4,  name: 'מעזריטש ע"י מט"ח ירוק' },
  { id: 5,  name: 'החוזה מלובלין 16' },
  { id: 6,  name: 'החוזה מלובלין מול דרכי תורה' },
  { id: 7,  name: 'אדמורי ויזניץ 4' },
  { id: 8,  name: 'כנסת יחזקאל 31' },
  { id: 9,  name: 'כנסת יחזקאל 43' },
  { id: 10, name: 'כנסת יחזקאל מול שפע ברכת השם' },
  { id: 11, name: 'כנסת מרדכי פינת כנסת יחזקאל' },
  { id: 12, name: 'כנסת מרדכי פינת הרמ"ז' },
];

const TOTAL_SEATS = 16;
// חלון הזמנה (בדקות לפני הנסיעה)
// נפתח ב-OPEN דקות לפני, נסגר ב-CLOSE דקות לפני
const BOOKING_OPEN_BEITAR = 90;    // ביתר: נפתח 90 דק' לפני
const BOOKING_OPEN_HADASSAH = 60;  // הדסה: נפתח 60 דק' לפני
const BOOKING_CLOSE = 15;          // שני הכיוונים: נסגר 15 דק' לפני
// חלון ביטול לפני נסיעה (בדקות)
const CANCEL_WINDOW = 5;
// מקסימום מושבים לטלפון לנסיעה
const MAX_SEATS_PER_PHONE = 3;

module.exports = {
  RIDES,
  STATIONS_A,
  STATIONS_B,
  TOTAL_SEATS,
  BOOKING_OPEN_BEITAR,
  BOOKING_OPEN_HADASSAH,
  BOOKING_CLOSE,
  CANCEL_WINDOW,
  MAX_SEATS_PER_PHONE,
};
