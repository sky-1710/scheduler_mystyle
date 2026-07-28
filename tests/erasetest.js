const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

// figure out "today" the same way the app does (local time)
const pad2 = n => String(n).padStart(2, '0');
const now = new Date();
const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(window) {
    window.HTMLElement.prototype.scrollIntoView = function () {}; // jsdom lacks it
    // seed app data before the script runs
    window.localStorage.setItem('sched_v1', JSON.stringify([
      { id: 'T1', title: '테스트', isTodo: true, date: ds, time: '', endTime: '',
        repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0,
        color: '#5C6BC0', priority: 'normal', accuracy: null,
        categoryId: null, desc: '', completed: false },
    ]));
    window.localStorage.setItem('sched_blocks_v1', JSON.stringify({ [ds]: { '10:00': 'T1', '10:10': 'T1' } }));
    window.localStorage.setItem('sched_blockmin_v1', JSON.stringify({ [ds]: { '10:00': 10, '10:10': 10 } }));
    window.localStorage.setItem('sched_timelog_v1', JSON.stringify({ [ds]: { T1: 20 } }));
  },
});

const { window } = dom;
const doc = window.document;

function fire(el, type, x, y) {
  const ev = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  el.dispatchEvent(ev);
}

const errors = [];
window.addEventListener('error', e => errors.push(e.message));

setTimeout(() => {
  try {
    window.switchView('day');

    // 1) select the eraser via real UI click
    doc.getElementById('eraserBtn').click();

    // 2) erase the 10:00 cell
    const cell = doc.querySelector('.tb-cell[data-k="10:00"]');
    console.log('cell exists:', !!cell);
    fire(cell, 'pointerdown', 5, 5);
    fire(window, 'pointerup', 5, 5);

    const blocksAfter = JSON.parse(window.localStorage.getItem('sched_blocks_v1'));
    const logAfter = JSON.parse(window.localStorage.getItem('sched_timelog_v1'));
    console.log('ERASE: 10:00 gone =', !(blocksAfter[ds] && blocksAfter[ds]['10:00']),
      '| 10:10 kept =', !!(blocksAfter[ds] && blocksAfter[ds]['10:10']),
      '| ledger T1 =', (logAfter[ds] || {}).T1, '(want 10)');

    // 3) paint a new cell by clicking the task row then a cell
    //    (row click starts the timer AND selects the task for painting)
    const row = doc.querySelector('#plannerTodo .pt-item');
    console.log('todo row exists:', !!row);
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const cell2 = doc.querySelector('.tb-cell[data-k="11:00"]');
    fire(cell2, 'pointerdown', 0, 0); // rect is 0-width in jsdom → m clamps to >=1
    fire(window, 'pointerup', 0, 0);

    const blocks2 = JSON.parse(window.localStorage.getItem('sched_blocks_v1'));
    const bm2 = JSON.parse(window.localStorage.getItem('sched_blockmin_v1'));
    const log2 = JSON.parse(window.localStorage.getItem('sched_timelog_v1'));
    console.log('PAINT: 11:00 owner =', blocks2[ds] && blocks2[ds]['11:00'],
      '| min =', bm2[ds] && bm2[ds]['11:00'],
      '| ledger T1 =', (log2[ds] || {}).T1);

    console.log('runtime errors:', errors.length ? errors : 'NONE');
  } catch (e) {
    console.log('TEST-EXCEPTION:', e.message);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  }
  process.exit(0);
}, 600);
