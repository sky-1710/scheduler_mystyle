const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

const pad2 = n => String(n).padStart(2, '0');
const now = new Date();
const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

const seed = {
  sched_v1: [
    { id: 'e1', title: '회의', isTodo: false, date: ds, time: '10:00', endTime: '11:30',
      repeat: 'weekly', repeatN: 1, repeatEnd: '', notifyBefore: 10, color: '#EF4444',
      priority: 'high', accuracy: null, categoryId: 'c2', scope: null, desc: '', completed: false },
    { id: 't1', title: '문제풀이', isTodo: true, date: ds, time: '', endTime: '',
      repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#5C6BC0',
      priority: 'normal', accuracy: 90, categoryId: 'c2', scope: null, desc: '', completed: false },
    { id: 'r1', title: '아침운동', isTodo: true, date: '2026-01-01', time: '', endTime: '',
      repeat: 'everyN', repeatN: 2, repeatEnd: '', notifyBefore: 0, color: '#10B981',
      priority: 'low', accuracy: null, categoryId: 'c1', scope: null, desc: '', completed: false },
    { id: 'm1', title: '책3권', isTodo: true, date: ds, time: '', endTime: '',
      repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#F59E0B',
      priority: 'high', accuracy: null, categoryId: null, scope: 'month', desc: '', completed: false },
    { id: 'w1', title: '보고서', isTodo: true, date: ds, time: '', endTime: '',
      repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#8B5CF6',
      priority: 'normal', accuracy: null, categoryId: null, scope: 'week', desc: '', completed: false },
    { id: 'old1', title: '옛완료', isTodo: true, date: '2026-05-01', time: '', endTime: '',
      repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#64748B',
      priority: 'low', accuracy: null, categoryId: null, scope: null, desc: '',
      completed: true, completedAt: '2026-05-02' },
  ],
  sched_blocks_v1: { [ds]: { '09:00': 't1', '09:10': 'h1' } },
  sched_blockmin_v1: { [ds]: { '09:00': 4 } },
  sched_timelog_v1: { [ds]: { t1: 4, h1: 10 } },
  sched_daytasks_v1: { [ds]: ['m1'] },
  sched_daygoals_v1: { [ds]: '집중!' },
  sched_daymemos_v1: { [ds]: '오늘 메모' },
  sched_habits_v1: [{ id: 'h1', name: '물2L', color: '#06B6D4', categoryId: 'c1' }],
  sched_habitchecks_v1: { [ds]: ['h1'] },
  sched_tododone_v1: { [ds]: ['r1'] },
  sched_categories_v1: [
    { id: 'c1', name: '건강', color: '#10B981', parentId: null, weeklyGoalH: 5 },
    { id: 'c2', name: '공부', color: '#5C6BC0', parentId: null, weeklyGoalH: 10 },
  ],
};

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, JSON.stringify(v));
  },
});
const { window } = dom;
const doc = window.document;
const errors = [];
window.addEventListener('error', e => errors.push(e.message));

setTimeout(() => {
  const step = (name, fn) => {
    try { fn(); console.log('OK :', name); }
    catch (e) { console.log('FAIL:', name, '→', e.message); }
  };
  try {
    // walk every view
    ['month', 'week', 'day', 'habit', 'todo', 'stats'].forEach(v =>
      step('view ' + v, () => window.switchView(v)));

    // stats all periods
    ['week', 'month', 'year'].forEach(p => step('stats ' + p, () => {
      doc.querySelector(`#statsToggle button[data-period="${p}"]`).click();
    }));

    // modals
    step('openAdd + save', () => {
      window.openAdd(ds, '14:00');
      doc.getElementById('evTitle').value = '새 일정';
      doc.getElementById('evSaveBtn').click();
    });
    step('openEdit scoped todo', () => {
      window.openEdit(JSON.parse(window.localStorage.getItem('sched_v1')).find(e => e.id === 'm1'));
      doc.getElementById('evCancelBtn').click();
    });
    step('picker open/toggle', () => {
      window.switchView('day');
      window.openPicker(ds);
      const row = doc.querySelector('#pickerList .picker-row:not(.auto)');
      if (row) row.click();
      doc.getElementById('pickerCloseBtn').click();
    });
    step('habit modal save', () => {
      window.openHabitModal(null);
      doc.getElementById('habitName').value = '독서';
      doc.getElementById('habitSaveBtn').click();
    });
    step('category modal save child', () => {
      window.openCatModal();
      doc.getElementById('catName').value = '영어';
      doc.getElementById('catParent').value = 'c2';
      doc.getElementById('catGoal').value = '3';
      doc.getElementById('catSaveBtn').click();
      doc.getElementById('catCloseBtn').click();
    });
    step('search', () => {
      window.openSearch();
      window.runSearch('책');
      const hit = doc.querySelector('#searchResults .day-event-row');
      if (!hit) throw new Error('no result for 월간 할일');
      window.closeSearch();
    });
    step('carry-over button hidden this month (no prev items)', () => {
      window.switchView('month');
      if (doc.querySelector('.carry-btn')) throw new Error('unexpected carry button');
    });

    // delete cleanup: t1 has blocks/timeLog entries
    step('deleteEventById cleans all maps', () => {
      window.deleteEventById('t1');
      const b = JSON.parse(window.localStorage.getItem('sched_blocks_v1'));
      const tl = JSON.parse(window.localStorage.getItem('sched_timelog_v1'));
      const bm = JSON.parse(window.localStorage.getItem('sched_blockmin_v1'));
      if ((b[ds] || {})['09:00']) throw new Error('block left');
      if ((tl[ds] || {}).t1) throw new Error('timeLog left');
      if ((bm[ds] || {})['09:00']) throw new Error('blockMin left');
    });
    step('deleteHabitById cleans all maps', () => {
      window.deleteHabitById('h1');
      const hc = JSON.parse(window.localStorage.getItem('sched_habitchecks_v1'));
      const tl = JSON.parse(window.localStorage.getItem('sched_timelog_v1'));
      if ((hc[ds] || []).includes('h1')) throw new Error('check left');
      if ((tl[ds] || {}).h1) throw new Error('timeLog left');
    });

    console.log('\nruntime errors:', errors.length ? errors : 'NONE');
  } catch (e) {
    console.log('OUTER-EX:', e.message);
  }
  process.exit(0);
}, 700);
