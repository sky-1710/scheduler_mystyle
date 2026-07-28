const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');
const pad2 = n => String(n).padStart(2, '0');
const now = new Date();
const ymdOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ds = ymdOf(now);
const plus = n => ymdOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.localStorage.setItem('sched_habits_v1', JSON.stringify([
      { id: 'h1', name: '스트레칭', color: '#06B6D4', categoryId: null },
    ]));
  },
});
const { window } = dom;
const doc = window.document;
const errors = [];
window.addEventListener('error', e => errors.push(e.message));
const get = () => JSON.parse(window.localStorage.getItem('sched_v1') || '[]');

setTimeout(() => {
  const step = (name, fn) => {
    try { const r = fn(); console.log(r ? 'PASS:' : 'FAIL:', name); }
    catch (e) { console.log('FAIL:', name, '→', e.message); }
  };

  // 1) everyN repeat via modal save
  step('everyN(3일마다) 저장 → 3일 뒤 O, 1일 뒤 X', () => {
    window.openAdd(ds, '');
    doc.getElementById('evTitle').value = '3일마다';
    doc.getElementById('evRepeat').value = 'everyN';
    doc.getElementById('evRepeat').onchange();
    doc.getElementById('evRepeatN').value = '3';
    doc.getElementById('evSaveBtn').click();
    const ev = get().find(e => e.title === '3일마다');
    return ev && window.evMatchesDate(ev, plus(3)) && !window.evMatchesDate(ev, plus(1)) && window.evMatchesDate(ev, plus(6));
  });

  // 2) accuracy clamp 150 → 100
  step('정확도 150 입력 → 100으로 클램프', () => {
    window.openAdd(ds, '');
    doc.getElementById('evTitle').value = '정확도테스트';
    doc.getElementById('evAccuracy').value = '150';
    doc.getElementById('evSaveBtn').click();
    return get().find(e => e.title === '정확도테스트').accuracy === 100;
  });

  // 3) scoped todo strips time/repeat on save
  step('월간 할일 저장 시 시간/반복 제거', () => {
    window.openAdd(ds, '10:00', true);
    doc.getElementById('evTitle').value = '월간목표';
    doc.getElementById('evScope').value = 'month';
    doc.getElementById('evScope').onchange();
    doc.getElementById('evRepeat').value = 'daily'; // sneak a repeat in
    doc.getElementById('evSaveBtn').click();
    const ev = get().find(e => e.title === '월간목표');
    return ev.scope === 'month' && ev.time === '' && ev.repeat === 'none' && ev.notifyBefore === 0;
  });

  // 4) keyboard shortcuts blocked while a modal is open
  step('모달 열림 중 숫자키 무시', () => {
    window.openAdd(ds, '');
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', bubbles: true }));
    const stillMonth = doc.querySelector('.tab.active').dataset.view === 'month';
    doc.getElementById('evCancelBtn').click();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', bubbles: true }));
    const nowWeek = doc.querySelector('.tab.active').dataset.view === 'week';
    return stillMonth && nowWeek;
  });

  // 5) week habit card checkbox toggles that date
  step('주간 습관 카드 체크', () => {
    window.switchView('week');
    const item = doc.querySelector('.wh-day .wh-item');
    item.click();
    const hc = JSON.parse(window.localStorage.getItem('sched_habitchecks_v1') || '{}');
    return Object.values(hc).some(a => a.includes('h1'));
  });

  // 6) habit monthly grid cell toggles
  step('습관 그리드 칸 토글', () => {
    window.switchView('habit');
    const before = JSON.stringify(window.localStorage.getItem('sched_habitchecks_v1'));
    const cell = doc.querySelector('.hb-cell');
    cell.click();
    const after = JSON.stringify(window.localStorage.getItem('sched_habitchecks_v1'));
    return before !== after;
  });

  // 7) day modal buttons navigate
  step('날짜 상세 → 타임블록/주간 이동', () => {
    window.switchView('month');
    window.openDayModal(ds, window.getEventsForDate(ds));
    doc.getElementById('dayBlockBtn').click();
    const toDay = doc.querySelector('.tab.active').dataset.view === 'day';
    window.openDayModal(ds, window.getEventsForDate(ds));
    doc.getElementById('dayWeekBtn').click();
    const toWeek = doc.querySelector('.tab.active').dataset.view === 'week';
    return toDay && toWeek;
  });

  // 8) editing an everyN event round-trips repeatN
  step('everyN 수정 시 주기 유지', () => {
    const ev = get().find(e => e.title === '3일마다');
    window.openEdit(ev);
    const nVal = doc.getElementById('evRepeatN').value;
    const visible = doc.getElementById('repeatNWrap').style.display !== 'none';
    doc.getElementById('evSaveBtn').click();
    const after = get().find(e => e.title === '3일마다');
    return nVal === '3' && visible && after.repeatN === 3;
  });

  console.log('runtime errors:', errors.length ? errors : 'NONE');
  process.exit(0);
}, 700);
