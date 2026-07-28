const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

// ---------- 1) STATIC PARITY: every dataset must appear in every save/restore spot ----------
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const DATASETS = ['events', 'blocks', 'blockMin', 'timeLog', 'dayTasks', 'dayGoals',
  'dayMemos', 'dayBad', 'dayRatings', 'sleepLog', 'habits', 'habitChecks', 'todoDone', 'categories', 'dayImages'];
const LS_KEYS = {
  events: 'sched_v1', blocks: 'sched_blocks_v1', blockMin: 'sched_blockmin_v1',
  timeLog: 'sched_timelog_v1', dayTasks: 'sched_daytasks_v1', dayGoals: 'sched_daygoals_v1',
  dayMemos: 'sched_daymemos_v1', dayBad: 'sched_daybad_v1', dayRatings: 'sched_dayratings_v1',
  sleepLog: 'sched_sleep_v1',
  habits: 'sched_habits_v1', habitChecks: 'sched_habitchecks_v1',
  todoDone: 'sched_tododone_v1', categories: 'sched_categories_v1',
};

let staticFail = 0;
// payloads (autoSync, download, backupBeforeImport) — all "version: 3 ..." object literals
const payloads = [...js.matchAll(/version: 3[^}]+/g)];
console.log(`payload spots found: ${payloads.length} (want 3: autoSync/download/beforeImport)`);
payloads.forEach((p, i) => DATASETS.forEach(k => {
  if (!p[0].includes(k)) { console.log(`  ✗ payload#${i} missing ${k}`); staticFail++; }
}));
// persistLocal + loadEvents localStorage keys (dayImages lives in IndexedDB)
for (const [name, key] of Object.entries(LS_KEYS)) {
  if ((js.match(new RegExp(`setItem\\('${key}'`, 'g')) || []).length < 1) { console.log(`  ✗ persistLocal missing ${name}`); staticFail++; }
  if ((js.match(new RegExp(`getItem\\('${key}'`, 'g')) || []).length < 1) { console.log(`  ✗ loadEvents missing ${name}`); staticFail++; }
}
// restore spots: importFile + loadFromDataDir must assign every dataset
const restoreSpots = [...js.matchAll(/data\.events;([\s\S]{0,900})/g)];
console.log(`restore spots found: ${restoreSpots.length} (want 2: import/loadFromDataDir)`);
restoreSpots.forEach((m, i) => DATASETS.filter(k => k !== 'events').forEach(k => {
  if (!m[1].includes(`data.${k}`)) { console.log(`  ✗ restore#${i} missing ${k}`); staticFail++; }
}));
// snapshot must exclude images
if (!js.includes('delete snapData.dayImages')) { console.log('  ✗ snapshot does not strip images'); staticFail++; }
console.log(staticFail ? `STATIC: ${staticFail} FAILURES` : 'STATIC: all save/restore spots complete ✓');

// ---------- 2) ROUND-TRIP: load a full v3 file, verify every byte lands in storage ----------
const payload = {
  version: 3, exported: 'test',
  events: [
    { id: 'e1', title: '일정1', isTodo: false, date: '2026-07-10', time: '10:00', endTime: '11:00',
      repeat: 'weekly', repeatN: 1, repeatEnd: '2026-12-31', notifyBefore: 10, color: '#EF4444',
      priority: 'high', accuracy: 90, categoryId: 'c2', scope: null, desc: '설명', completed: false },
    { id: 't1', title: '할일1', isTodo: true, date: '2026-07-06', time: '', endTime: '',
      repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#5C6BC0',
      priority: 'normal', accuracy: null, categoryId: null, scope: null, desc: '',
      completed: true, completedAt: '2026-07-01' },
    { id: 'r1', title: '반복할일', isTodo: true, date: '2026-07-01', time: '', endTime: '',
      repeat: 'daily', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#10B981',
      priority: 'low', accuracy: null, categoryId: 'c1', scope: null, desc: '', completed: false },
    { id: 'm1', title: '월간목표', isTodo: true, date: '2026-07-01', time: '', endTime: '',
      repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#F59E0B',
      priority: 'high', accuracy: null, categoryId: null, scope: 'month', desc: '', completed: false },
  ],
  blocks: { '2026-07-06': { '10:00': 't1', '10:10': 'h1' } },
  blockMin: { '2026-07-06': { '10:00': 7 } },
  timeLog: { '2026-07-06': { t1: 7, h1: 10 } },
  dayTasks: { '2026-07-06': ['m1'] },
  dayGoals: { '2026-07-06': '오늘의 목표' },
  dayMemos: { '2026-07-06': '메모 내용\n둘째 줄' },
  dayBad: { '2026-07-06': '늦잠' },
  dayRatings: { '2026-07-06': 8 },
  sleepLog: { '2026-07-06': { wake: '07:30', sleep: '23:40' } },
  habits: [{ id: 'h1', name: '물마시기', color: '#10B981', categoryId: 'c1' }],
  habitChecks: { '2026-07-06': ['h1'] },
  todoDone: { '2026-07-06': ['r1'] },
  categories: [
    { id: 'c1', name: '건강', color: '#10B981', parentId: null, weeklyGoalH: 5 },
    { id: 'c2', name: '수학', color: '#5C6BC0', parentId: 'c1', weeklyGoalH: null },
  ],
  dayImages: { '2026-07-06': ['data:image/jpeg;base64,QUJD'] },
};

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) { w.HTMLElement.prototype.scrollIntoView = function () {}; },
});
const { window } = dom;

setTimeout(async () => {
  try {
    const fakeDir = {
      getFileHandle: async () => ({
        getFile: async () => ({ text: async () => JSON.stringify(payload) }),
      }),
    };
    const loaded = await window.loadFromDataDir(fakeDir);
    console.log('\nROUND-TRIP: file loaded =', loaded);

    let rtFail = 0;
    for (const [name, key] of Object.entries(LS_KEYS)) {
      const got = window.localStorage.getItem(key);
      const want = JSON.stringify(payload[name]);
      if (got !== want) { console.log(`  ✗ ${name}: stored value differs`); rtFail++; }
    }
    console.log(rtFail ? `ROUND-TRIP: ${rtFail} FAILURES` : 'ROUND-TRIP: all 11 datasets stored byte-identical ✓');

    // 3) mutation → auto-persist: toggle a habit check, edit ledger, verify saved
    window.toggleHabit('h1', '2026-07-07');
    const hc = JSON.parse(window.localStorage.getItem('sched_habitchecks_v1'));
    console.log('mutation persists (habit check) =', (hc['2026-07-07'] || []).includes('h1'));
  } catch (e) {
    console.log('EX:', e.message);
  }
  process.exit(0);
}, 600);
