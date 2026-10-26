// 한 칸 두 작업: 10분 칸 하나에 서로 다른 할일이 함께 남는지 (칠하기·지우개·타이머·삭제·저장)
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

const pad2 = n => String(n).padStart(2, '0');
const now = new Date();
const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    // 모든 칸을 폭 100px 로 본다 -> clientX 의 십의 자리 = 칸 안의 분
    w.HTMLElement.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, width: 100, height: 26, right: 100, bottom: 26 };
    };
    w.localStorage.setItem('startScreenOff', '1'); // 시작 화면이 UI를 가리지 않게
    w.localStorage.setItem('sched_v1', JSON.stringify([
      { id: 'A', title: '공부', date: ds, isTodo: true, color: '#448361', priority: 'normal' },
      { id: 'B', title: '운동', date: ds, isTodo: true, color: '#D44C47', priority: 'normal' },
      { id: 'C', title: '독서', date: ds, isTodo: true, color: '#337EA9', priority: 'normal' },
    ]));
  },
});
const { window } = dom;
const doc = window.document;
let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const errors = [];
window.addEventListener('error', e => errors.push(e.message));

// 기준 시각을 고정한다 (타이머 시작 표시가 검사하는 칸에 끼어들지 않도록 새벽으로)
function at(h, m) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 30);
  const Real = Date;
  window.Date = class extends Real {
    constructor(...a) { return a.length ? new Real(...a) : new Real(d); }
    static now() { return d.getTime(); }
  };
  window.Date.prototype = Real.prototype;
}

setTimeout(() => {
  const w = window;
  try {
    at(3, 5);
    w.switchView('day');

    const runs = key => w.cellSegs(ds, key).map(s => [s.id, s.off, s.len]);
    const log = () => { w.saveEvents(); return JSON.parse(w.localStorage.getItem('sched_timelog_v1') || '{}')[ds] || {}; };
    const cell = key => doc.querySelector(`.tb-cell[data-k="${key}"]`);
    const fire = (el, type, minute) => el.dispatchEvent(new w.MouseEvent(type,
      { bubbles: true, cancelable: true, clientX: minute * 10 + 5, clientY: 5 }));
    // 줄 클릭은 타이머도 켜므로 바로 끄고 선택만 남긴다
    const select = title => {
      const row = [...doc.querySelectorAll('#plannerTodo .pt-item')].find(r => r.textContent.includes(title));
      row.click();
      w.stopRecording();
    };
    const eraser = () => doc.getElementById('eraserBtn').click();
    const drag = (k1, m1, k2, m2) => {
      fire(cell(k1), 'pointerdown', m1);
      if (k2) {
        doc.elementFromPoint = () => cell(k2);
        fire(cell(k1), 'pointermove', m2);
      }
      fire(w, 'pointerup', m2 == null ? m1 : m2);
    };

    // ---- 1) 칠하기: 10:00~10:05 공부, 10:05~10:10 운동 ----
    select('공부');
    drag('10:00', 0, '10:00', 4);
    select('운동');
    drag('10:00', 5, '10:00', 9);
    check('한 칸에 두 작업이 모두 남음', runs('10:00'), [['A', 0, 5], ['B', 5, 5]]);
    check('장부 공부 5분 / 운동 5분', [log().A, log().B], [5, 5]);
    check('화면: 색 두 개', cell('10:00').querySelectorAll('.tb-fill').length, 2);
    check('화면: 이름표 두 개', [...cell('10:00').querySelectorAll('.tb-label')].map(l => l.textContent), ['공부', '운동']);
    check('툴팁에 두 작업', /공부.*운동/.test(cell('10:00').title), true);

    // ---- 2) 저장 -> 다시 읽기 ----
    w.saveEvents();
    w.loadEvents();
    check('다시 읽어도 두 작업 유지', runs('10:00'), [['A', 0, 5], ['B', 5, 5]]);

    // ---- 3) 지우개: 누른 구간만 지워진다 ----
    eraser();
    drag('10:00', 7);
    check('지우개로 운동만 지움', runs('10:00'), [['A', 0, 5]]);
    check('운동 장부 0 / 공부 5 유지', [log().B || 0, log().A], [0, 5]);

    // 지우개로 빈 곳을 누르면 예전처럼 칸 전체가 지워진다
    w.paintSpan(ds, 11 * 60, 11 * 60 + 3, 'A');
    w.renderDay();
    drag('11:00', 7);
    check('빈 곳 탭 -> 칸 비움', runs('11:00'), []);

    // ---- 4) 자기 칠을 다시 누르면 자기 것만 지워진다 ----
    select('운동');
    drag('10:00', 5, '10:00', 9);
    check('운동 다시 칠함', runs('10:00'), [['A', 0, 5], ['B', 5, 5]]);
    select('공부');
    drag('10:00', 2);
    check('공부 칸을 다시 누르면 공부만 지워짐', runs('10:00'), [['B', 5, 5]]);
    drag('10:00', 0, '10:00', 4);
    check('공부 다시 칠함', runs('10:00'), [['A', 0, 5], ['B', 5, 5]]);

    // ---- 5) 가운데만 덮으면 앞뒤가 남는다 ----
    w.paintSpan(ds, 12 * 60, 12 * 60 + 10, 'A');
    w.paintSpan(ds, 12 * 60 + 3, 12 * 60 + 5, 'B');
    check('가운데 덮기', runs('12:00'), [['A', 0, 3], ['B', 3, 2], ['A', 5, 5]]);

    // ---- 6) 드래그를 되돌리면 원래 칠이 돌아온다 ----
    w.paintSpan(ds, 13 * 60, 13 * 60 + 10, 'A');
    w.renderDay();
    const before = log();
    select('운동');
    fire(cell('13:00'), 'pointerdown', 2);
    doc.elementFromPoint = () => cell('13:10');
    fire(cell('13:00'), 'pointermove', 5);
    check('드래그 중: 13:00 일부 덮음', runs('13:00'), [['A', 0, 2], ['B', 2, 8]]);
    check('드래그 중: 13:10 칠함', runs('13:10'), [['B', 0, 6]]);
    doc.elementFromPoint = () => cell('13:00');
    fire(cell('13:00'), 'pointermove', 4);
    fire(w, 'pointerup', 4);
    check('되돌린 뒤 13:00 공부가 다시 살아남', runs('13:00'), [['A', 0, 2], ['B', 2, 3], ['A', 5, 5]]);
    check('되돌린 뒤 13:10 비움', runs('13:10'), []);
    check('장부: 공부 -3 / 운동 +3', [log().A - before.A, log().B - before.B], [-3, 3]);

    // ---- 7) 타이머: 칸 중간에 작업을 바꿔도 앞 작업이 남는다 ----
    const t0 = log();
    at(15, 0);
    w.startRecording('A');
    at(15, 4);
    w.recordTick();
    w.startRecording('B'); // 15:04 에 운동으로 전환
    at(15, 8);
    w.recordTick();
    w.stopRecording();
    check('타이머 전환: 두 작업 모두 남음', runs('15:00'), [['A', 0, 4], ['B', 4, 4]]);
    check('타이머 전환: 장부 각각 4분', [log().A - t0.A, log().B - t0.B], [4, 4]);

    // ---- 8) 할일 삭제: 같은 칸의 다른 작업은 남는다 ----
    w.paintSpan(ds, 16 * 60, 16 * 60 + 5, 'C');
    w.paintSpan(ds, 16 * 60 + 5, 16 * 60 + 10, 'A');
    w.deleteEventById('C');
    check('삭제 후 남은 작업', runs('16:00'), [['A', 5, 5]]);
    const off = JSON.parse(w.localStorage.getItem('sched_blockoff_v1') || '{}')[ds] || {};
    const extra = JSON.parse(w.localStorage.getItem('sched_blockextra_v1') || '{}')[ds] || {};
    check('삭제 후 첫 구간으로 올라오고 오프셋 5', off['16:00'], 5);
    check('삭제 후 추가 구간 정리', extra['16:00'], undefined);

    w.render();
    check('런타임 에러 없음', errors, []);
  } catch (e) {
    fails++;
    console.log('TEST-EXCEPTION:', e.message);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  }
  console.log(fails ? `\n${fails} FAILURES` : '\n모든 검증 통과');
  process.exit(fails ? 1 : 0);
}, 1200);
