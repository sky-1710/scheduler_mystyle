const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');
const pad2 = n => String(n).padStart(2, '0');
const now = new Date();
const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

function boot(seedFn) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = function () {};
      seedFn(w);
    },
  });
}

const baseEvent = {
  id: 't1', title: '공부', isTodo: true, date: ds, time: '', endTime: '',
  repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#5C6BC0',
  priority: 'normal', accuracy: null, categoryId: null, scope: null, desc: '', completed: false,
};

(async () => {
  // ---- 1) recording backfill: timer ran 30 min while page was closed ----
  await new Promise(res => {
    const dom = boot(w => {
      w.localStorage.setItem('sched_v1', JSON.stringify([baseEvent]));
      const start = Date.now() - 30 * 60000;
      w.localStorage.setItem('recording_v1', JSON.stringify({
        id: 't1', startedAt: start, lastMin: Math.floor(start / 60000),
      }));
    });
    setTimeout(() => {
      const w = dom.window;
      const tl = JSON.parse(w.localStorage.getItem('sched_timelog_v1') || '{}');
      const total = Object.values(tl).reduce((s, day) => s + (day.t1 || 0), 0);
      const blocks = JSON.parse(w.localStorage.getItem('sched_blocks_v1') || '{}');
      const painted = Object.values(blocks).reduce((s, day) =>
        s + Object.values(day).filter(id => id === 't1').length, 0);
      console.log(`[1] 백필: 30분 부재 → 장부 ${total}분 (want 29~31), 칠해진 블록 ${painted}개 (want 3~5)`);
      console.log('    →', total >= 29 && total <= 31 && painted >= 3 && painted <= 5 ? 'PASS' : 'FAIL');
      res();
    }, 1500);
  });

  // ---- 2) corrupted localStorage: app must still boot ----
  await new Promise(res => {
    const dom = boot(w => {
      w.localStorage.setItem('sched_v1', JSON.stringify([baseEvent]));
      w.localStorage.setItem('sched_blocks_v1', '{{{corrupt');
      w.localStorage.setItem('sched_habits_v1', 'not json at all');
    });
    const errs = [];
    dom.window.addEventListener('error', e => errs.push(e.message));
    setTimeout(() => {
      const w = dom.window;
      let ok = false;
      try {
        w.switchView('day');
        w.switchView('stats');
        ok = w.document.querySelectorAll('.tab').length === 6 && errs.length === 0;
      } catch (e) { console.log('    EX:', e.message); }
      console.log('[2] 손상된 저장 데이터로 부팅:', ok ? 'PASS (정상 기동, 에러 0)' : 'FAIL ' + errs.join(','));
      res();
    }, 800);
  });

  // ---- 3) partial import file: events missing title/color/priority ----
  await new Promise(res => {
    const dom = boot(() => {});
    setTimeout(async () => {
      const w = dom.window;
      const errs = [];
      w.addEventListener('error', e => errs.push(e.message));
      const payload = {
        version: 3,
        events: [
          { id: 'b1', isTodo: true, date: ds }, // no title/color/priority/repeat
          { id: 'b2', title: null, isTodo: false, date: ds, time: '09:00' },
        ],
      };
      const fakeDir = { getFileHandle: async () => ({ getFile: async () => ({ text: async () => JSON.stringify(payload) }) }) };
      let ok = false;
      try {
        await w.loadFromDataDir(fakeDir);
        ['month', 'week', 'day', 'todo', 'stats'].forEach(v => w.switchView(v));
        w.openSearch(); w.runSearch('a'); w.closeSearch();
        ok = errs.length === 0;
      } catch (e) { console.log('    EX:', e.message); }
      console.log('[3] 필드 빠진 가져오기 파일:', ok ? 'PASS (모든 뷰 렌더링됨)' : 'FAIL ' + errs.join(','));
      res();
    }, 800);
  });

  process.exit(0);
})();
