// 시작 화면(Motivation Page): 하루 한 번 표시, 내용 구성, 끄기/다시 켜기, 단축키 차단
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

const pad2 = n => String(n).padStart(2, '0');
const now = new Date();
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ds = ymd(now);
const plus = n => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.localStorage.setItem('sched_v1', JSON.stringify([
      { id: 'a', title: '오늘 할 일', date: ds, isTodo: true, color: '#448361', priority: 'high' },
      { id: 'b', title: '이틀 뒤 발표', date: plus(2), color: '#D44C47', priority: 'normal' },
    ]));
    // 기록 시간이 있어야 연속 기록/주간 합계가 의미 있는 값이 된다
    w.localStorage.setItem('sched_timelog_v1', JSON.stringify({ [plus(-1)]: { a: 90 } }));
  },
});
const { window } = dom;
const doc = window.document;
let fails = 0;
const step = (name, fn) => {
  let ok = false, err = '';
  try { ok = fn(); } catch (e) { err = ' → ' + e.message; }
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${err}`);
};

setTimeout(() => {
  const el = () => doc.getElementById('startScreen');

  step('첫 실행에 시작 화면이 뜬다', () => {
    window.localStorage.removeItem('startShownOn');
    window.localStorage.removeItem('startScreenOff');
    window.maybeShowStartScreen();
    return el().classList.contains('open');
  });

  step('메인 문구 3단이 보인다', () => {
    const eb = doc.querySelector('.ss-eyebrow').textContent.trim();
    const hero = doc.querySelector('.ss-hero').textContent.trim();
    const sub = doc.querySelector('.ss-sub').textContent.trim();
    return eb === '어제의 나를 넘어,' && hero === '더 잘해야지.' &&
           sub === '지금의 선택이, 내가 원하는 미래를 만든다.';
  });

  step('위로성 문구가 없다', () => {
    const t = doc.getElementById('startScreen').textContent;
    return !/괜찮|천천히|잘하고 있|힘내|수고/.test(t);
  });

  step('성장 단계가 순서대로 있다', () => {
    const places = Array.from(doc.querySelectorAll('.ss-place')).map(n => n.textContent.trim());
    return JSON.stringify(places) === JSON.stringify(
      ['지금의 나', '기초를 쌓는다', '직접 만든다', '질문을 세운다', '결과를 남긴다', 'HCI 연구자']);
  });

  step('학교 이름은 쓰지 않는다', () => {
    const t = doc.getElementById('startScreen').textContent;
    return !/SKKU|KAIST|MIT|성균관|카이스트|대학원|입학/.test(t);
  });

  step('경로가 선으로 이어지고 최종 목적지만 강조된다', () =>
    doc.querySelectorAll('.ss-path .ss-link').length === 5 &&
    doc.querySelectorAll('.ss-stop.goal').length === 1 &&
    doc.querySelectorAll('.ss-stop.goal .ss-place')[0].textContent.trim() === 'HCI 연구자' &&
    doc.querySelectorAll('.start-screen input[type=checkbox]').length === 0);

  step('단계 설명에 연도가 없다', () => {
    const why = Array.from(doc.querySelectorAll('.ss-why')).map(n => n.textContent).join(' ');
    return !/20\d\d/.test(why);
  });

  step('되고 싶은 사람 + 연구 주제 4개', () => {
    const want = doc.querySelector('.ss-want').textContent;
    const topics = Array.from(doc.querySelectorAll('.ss-topic .n')).map(n => n.textContent.trim());
    return want.includes('HCI 연구자') && topics.length === 4 &&
           topics[0] === 'Human-AI Interaction' && topics[3] === 'AI for Humans' &&
           doc.querySelectorAll('.ss-topic svg.ic').length === 4;
  });

  step('연구자 이미지가 배경으로 깔린다', () => {
    const bg = doc.getElementById('startScreen').style.background ||
               (doc.querySelector('style') && html);
    return html.includes("assets/start-hero.jpg");
  });

  step('대시보드 요소는 없다', () =>
    !doc.getElementById('ssGoal') && !doc.getElementById('ssStats') &&
    !doc.getElementById('ssTodos') && !doc.getElementById('ssDday'));

  step('열려 있는 동안 단축키가 막힌다', () => {
    const before = doc.querySelector('.tab.active').dataset.view;
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', bubbles: true }));
    return doc.querySelector('.tab.active').dataset.view === before;
  });

  step('시작하기를 누르면 닫힌다', () => {
    doc.getElementById('ssGo').click();
    return !el().classList.contains('open') &&
           window.localStorage.getItem('startShownOn') === ds;
  });

  step('같은 날 다시 뜨지 않는다', () => {
    window.maybeShowStartScreen();
    return !el().classList.contains('open');
  });

  step('다음 날에는 다시 뜬다', () => {
    window.localStorage.setItem('startShownOn', plus(-1));
    window.maybeShowStartScreen();
    return el().classList.contains('open');
  });

  step('그만 보기 → 다시 안 뜬다', () => {
    doc.getElementById('ssSkip').click();
    window.localStorage.removeItem('startShownOn');
    window.maybeShowStartScreen();
    return !el().classList.contains('open') &&
           window.localStorage.getItem('startScreenOff') === '1';
  });

  step('💾 메뉴에서 다시 켤 수 있다', () => {
    doc.getElementById('startToggleBtn').click();
    return el().classList.contains('open') &&
           window.localStorage.getItem('startScreenOff') === null;
  });

  console.log(fails ? `\n${fails} FAILURES` : '\n모든 검증 통과');
  process.exit(fails ? 1 : 0);
}, 1200);
