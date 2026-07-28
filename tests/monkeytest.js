const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');
const pad2 = n => String(n).padStart(2, '0');
const now = new Date();
const ymdOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ds = ymdOf(now);
const plus = n => ymdOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));

const base = { time: '', endTime: '', repeat: 'none', repeatN: 1, repeatEnd: '',
  notifyBefore: 0, priority: 'normal', accuracy: null, categoryId: null, desc: '', completed: false };

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.URL.createObjectURL = () => 'blob:test'; // jsdom lacks it; real browsers have it
    w.URL.revokeObjectURL = () => {};
    w.localStorage.setItem('sched_v1', JSON.stringify([
      { id: 'a', title: '일정A', isTodo: false, date: ds, time: '09:00', endTime: '10:00', ...base, scope: null, endDate: '' },
      { id: 'b', title: '할일B', isTodo: true, date: ds, ...base, scope: null, endDate: '' },
      { id: 'c', title: '기간C', isTodo: false, date: ds, endDate: plus(4), ...base, scope: null },
      { id: 'd', title: '반복D', isTodo: true, date: '2026-01-01', ...base, repeat: 'daily', scope: null, endDate: '' },
      { id: 'm', title: '월간M', isTodo: true, date: ds, ...base, scope: 'month', endDate: '' },
    ]));
    w.localStorage.setItem('sched_habits_v1', JSON.stringify([{ id: 'h', name: '습관H', color: '#06B6D4', categoryId: 'c1' }]));
    w.localStorage.setItem('sched_categories_v1', JSON.stringify([{ id: 'c1', name: '카테고리', color: '#10B981', parentId: null, weeklyGoalH: 3 }]));
    w.localStorage.setItem('sched_timelog_v1', JSON.stringify({ [ds]: { b: 30, h: 20 } }));
    w.localStorage.setItem('sched_blocks_v1', JSON.stringify({ [ds]: { '09:00': 'b', '09:10': 'h' } }));
    w.localStorage.setItem('sched_blockmin_v1', JSON.stringify({ [ds]: { '09:00': 3 } }));
    w.localStorage.setItem('sched_dayratings_v1', JSON.stringify({ [ds]: 7 }));
  },
});
const { window } = dom;
const doc = window.document;
const errors = [];
window.addEventListener('error', e => errors.push((e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || '')));

setTimeout(() => {
  let clicks = 0;
  const clickAll = (sel, limit) => {
    [...doc.querySelectorAll(sel)].slice(0, limit).forEach(el => {
      try { el.click(); clicks++; } catch (e) { errors.push(sel + ' → ' + e.message); }
    });
  };

  try {
    // pass 1: confirm 거절 (비파괴)
    window.confirm = () => false;
    for (const v of ['month', 'week', 'day', 'habit', 'todo', 'stats']) {
      window.switchView(v);
      clickAll('.tab', 6);
      clickAll('#prevBtn, #nextBtn, #todayBtn, #sidebarBtn, #themeBtn', 5);
      clickAll('.event-chip, .span-bar', 6);           // opens edit modal
      clickAll('#evCancelBtn', 1);
      clickAll('.dday-item, .pt-item, .wh-item', 8);   // rows (start/stop timers etc.)
      clickAll('.pt-circle, .todo-check, .hb-cell, .picker-check', 10);
      clickAll('.pt-edit', 2);
      clickAll('#evCancelBtn, #habitCancelBtn', 2);
      clickAll('.tb-cell', 4);
      clickAll('.todo-section-title', 4);              // collapse toggles
      clickAll('#statsToggle button', 4);
      clickAll('.rate-star', 3);
      clickAll('#eraserBtn, #recordBtn, #dayNewTaskBtn, #pickTaskBtn', 4);
      clickAll('#pickerCloseBtn, #evCancelBtn, #dayCloseBtn, #catCloseBtn, #searchCloseBtn', 5);
    }
    // 모달 정리 후 파괴 경로: confirm 승인
    doc.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    window.confirm = () => true;
    window.switchView('day');
    window.openEdit(JSON.parse(window.localStorage.getItem('sched_v1'))[1]);
    clickAll('#evDeleteBtn', 1);
    window.openHabitModal(JSON.parse(window.localStorage.getItem('sched_habits_v1'))[0]);
    clickAll('#habitDeleteBtn', 1);
    window.openCatModal();
    doc.querySelector('#catList .day-event-row') && doc.querySelector('#catList .day-event-row').click();
    clickAll('#catDeleteBtn', 1);
    clickAll('#catCloseBtn', 1);
    // 삭제 후 모든 뷰 재순회
    for (const v of ['month', 'week', 'day', 'habit', 'todo', 'stats']) window.switchView(v);

    console.log(`몽키 테스트: ${clicks}회 클릭 완료`);
    const real = errors.filter(e => !/Not implemented/.test(e));
    console.log('오류:', real.length ? real.slice(0, 5) : 'NONE');
  } catch (e) {
    console.log('OUTER-EX:', e.message);
  }
  process.exit(0);
}, 700);
