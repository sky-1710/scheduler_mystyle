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
  beforeParse(w) { w.HTMLElement.prototype.scrollIntoView = function () {};
    w.localStorage.setItem('startScreenOff', '1'); // 시작 화면이 UI를 가리지 않게
  },
});
const { window } = dom;
const doc = window.document;
const errors = [];
window.addEventListener('error', e => errors.push(e.message));
const get = () => JSON.parse(window.localStorage.getItem('sched_v1') || '[]');

setTimeout(() => {
  const step = (name, fn) => {
    try { console.log(fn() ? 'PASS:' : 'FAIL:', name); }
    catch (e) { console.log('FAIL:', name, '→', e.message); }
  };

  // 1) create ranged event: today ~ +3
  step('기간 일정 저장 → 기간 내 매일 표시, 기간 밖 X', () => {
    window.openAdd(ds, '');
    doc.getElementById('evTitle').value = '시험기간';
    doc.getElementById('evEndDate').value = plus(3);
    doc.getElementById('evSaveBtn').click();
    const ev = get().find(e => e.title === '시험기간');
    return ev.endDate === plus(3) &&
      window.evMatchesDate(ev, ds) && window.evMatchesDate(ev, plus(2)) &&
      window.evMatchesDate(ev, plus(3)) && !window.evMatchesDate(ev, plus(4));
  });

  // 2) D-day badge uses end date + shows range
  step('D-day 종료일 기준 (D-3) + 범위 표시', () => {
    window.switchView('month');
    const item = [...doc.querySelectorAll('.dday-item')]
      .find(el => el.textContent.includes('시험기간'));
    if (!item) throw new Error('D-day 항목 없음');
    const badge = item.querySelector('.dday-badge').textContent;
    const hasRange = item.querySelector('.dday-date').textContent.includes('~');
    return badge === 'D-3' && hasRange;
  });

  // 3) reversed dates get swapped on save
  step('종료일 < 시작일 입력 시 자동 교정', () => {
    window.openAdd(plus(5), '');
    doc.getElementById('evTitle').value = '역순기간';
    doc.getElementById('evEndDate').value = plus(2);
    doc.getElementById('evSaveBtn').click();
    const ev = get().find(e => e.title === '역순기간');
    return ev.date === plus(2) && ev.endDate === plus(5);
  });

  // 4) repeat clears endDate
  step('반복 선택 시 종료일 제거 + 필드 숨김', () => {
    window.openAdd(ds, '');
    doc.getElementById('evTitle').value = '반복기간금지';
    doc.getElementById('evEndDate').value = plus(3);
    doc.getElementById('evRepeat').value = 'daily';
    doc.getElementById('evRepeat').onchange();
    const hidden = doc.getElementById('endDateWrap').style.display === 'none';
    doc.getElementById('evSaveBtn').click();
    const ev = get().find(e => e.title === '반복기간금지');
    return hidden && ev.endDate === '';
  });

  // 5) in-progress ranged todo lands in 오늘 section
  step('진행 중 기간 할일 → 할일 탭 "오늘"', () => {
    window.openAdd(plus(-1), '', true);
    doc.getElementById('evTitle').value = '기간과제';
    doc.getElementById('evEndDate').value = plus(1);
    doc.getElementById('evSaveBtn').click();
    window.switchView('todo');
    const sections = [...doc.querySelectorAll('.todo-section')];
    const todaySec = sections.find(s => s.textContent.includes('오늘'));
    return todaySec && todaySec.textContent.includes('기간과제');
  });

  // 6) ranged event renders as continuous span bar(s), not per-day chips
  step('월간 달력에 연속 막대로 표시 (개별 칩 없음)', () => {
    window.switchView('month');
    const bars = [...doc.querySelectorAll('.span-bar')]
      .filter(b => b.textContent.includes('시험기간'));
    const chips = [...doc.querySelectorAll('.event-chip')]
      .filter(c => c.textContent.includes('시험기간'));
    return bars.length >= 1 && chips.length === 0;
  });

  console.log('runtime errors:', errors.length ? errors : 'NONE');
  process.exit(0);
}, 700);
