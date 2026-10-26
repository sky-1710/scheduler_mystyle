const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

const pad2 = n => String(n).padStart(2, '0');
const now = new Date();
const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(window) {
    window.HTMLElement.prototype.scrollIntoView = function () {};
    window.localStorage.setItem('startScreenOff', '1'); // 시작 화면이 UI를 가리지 않게
    // ONLY a completed month-scoped todo → D-day list will be empty
    window.localStorage.setItem('sched_v1', JSON.stringify([
      { id: 'M1', title: '책 3권 읽기', isTodo: true, scope: 'month', date: ds,
        time: '', endTime: '', repeat: 'none', repeatN: 1, repeatEnd: '',
        notifyBefore: 0, color: '#10B981', priority: 'high', accuracy: null,
        categoryId: null, desc: '', completed: false },
    ]));
  },
});

const { window } = dom;
const doc = window.document;

setTimeout(() => {
  try {
    // month view (default) → sidebar should show the scoped section
    const title = doc.getElementById('scopeTitle');
    const list = doc.getElementById('scopeList');
    console.log('month view: section visible =', title.style.display !== 'none',
      '| title =', doc.getElementById('scopeTitleText').textContent,
      '| has item =', list.textContent.includes('책 3권 읽기'));

    // scoped todo must NOT appear in the month grid as a chip
    const chips = [...doc.querySelectorAll('.event-chip')].map(c => c.textContent).join('');
    console.log('not in month grid =', !chips.includes('책 3권'));

    // week view → month-scoped item hidden, week section shown (empty)
    window.switchView('week');
    console.log('week view: title =', doc.getElementById('scopeTitleText').textContent,
      '| month item hidden =', !list.textContent.includes('책 3권 읽기'));

    // day view → section hidden
    window.switchView('day');
    console.log('day view: section hidden =', title.style.display === 'none');

    // check-circle toggles completion
    window.switchView('month');
    list.querySelector('.pt-circle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const saved = JSON.parse(window.localStorage.getItem('sched_v1'));
    console.log('circle click → completed =', saved[0].completed === true);
  } catch (e) {
    console.log('TEST-EXCEPTION:', e.message);
  }
  process.exit(0);
}, 600);
