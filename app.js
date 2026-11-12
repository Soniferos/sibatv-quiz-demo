import { CHECKED, MODELS, COMMON, CUSTOM, QUESTIONS, FINANCE, PLACES, COLORS, SEGMENTS, img, imgFull } from './data.js';

/* ---------- helpers ---------- */
const app = document.querySelector('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Math.round(n).toLocaleString('ru-RU');
const rub = (n) => `${num(n)} ₽`;
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many;
};
const modelsWord = (n) => `${n} ${plural(n, 'модель', 'модели', 'моделей')}`;
const byId = (id) => MODELS.find((m) => m.id === id);
const seatsLabel = (m) => (m.seats[0] === m.seats[1] ? `${m.seats[1]}` : m.seats[0] === 1 ? `до ${m.seats[1]}` : `${m.seats[0]}–${m.seats[1]}`);

/* ---------- storage: only this browser, never contacts ---------- */
const KEY = 'sibatv-demo:v2:';
const mem = {};
const store = {
  get(k, d) {
    try { const v = localStorage.getItem(KEY + k); return v == null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch { return k in mem ? mem[k] : d; }
  },
  set(k, v) { mem[k] = v; try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* storage is optional */ } },
};

let answers = store.get('answers', {});
let favs = new Set(store.get('favs', []).filter(byId));
let calc = store.get('calc', null);
let catalogFilter = 'all';
let catalogSort = 'price';
let compareFavsOnly = false;

const sid = (() => {
  try {
    let v = sessionStorage.getItem(KEY + 'sid');
    if (!v) { v = Math.random().toString(36).slice(2, 10); sessionStorage.setItem(KEY + 'sid', v); }
    return v;
  } catch { return Math.random().toString(36).slice(2, 10); }
})();

function track(name, data = {}) {
  const events = store.get('events', []);
  events.push({ t: Date.now(), s: sid, n: name, d: data });
  store.set('events', events.slice(-3000));
}

/* ---------- source of the visit: whitelisted URL parameters only ---------- */
const source = (() => {
  const out = {};
  try {
    const p = new URLSearchParams(location.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'yclid', 'gclid']) {
      const v = p.get(k);
      if (v) out[k] = v.slice(0, 120);
    }
    const seg = p.get('seg');
    if (seg && Object.hasOwn(SEGMENTS, seg)) out.seg = seg;
  } catch { /* no parameters */ }
  return out;
})();
const segment = source.seg ? SEGMENTS[source.seg] : null;

/* ---------- matching ---------- */
function fit(m, a = answers) {
  const pros = [], cons = [];
  let score = 0;
  if (a.use && m.uses[a.use]) { score += 3; pros.push(m.uses[a.use]); }
  if (a.terrain && m.terrain[a.terrain]) { score += 2; pros.push(m.terrain[a.terrain]); }
  const load = a.load && QUESTIONS[2].options.find((o) => o.id === a.load);
  if (load) {
    if (load.seats) {
      if (m.seats[1] >= load.seats) { score += 1; pros.push(`Мест: ${seatsLabel(m)}`); }
      else cons.push(`Мест ${seatsLabel(m)} — меньше, чем вам нужно`);
    }
    if (load.kg) {
      if (m.load >= load.kg) { score += 2; pros.push(`Грузоподъёмность ${m.load} кг`); }
      else cons.push(`Грузоподъёмность ${m.load} кг — меньше ${load.kg} кг`);
    }
    if (m.bonus[load.id]) { score += 1; pros.push(m.bonus[load.id]); }
  }
  const budget = a.budget && QUESTIONS[3].options.find((o) => o.id === a.budget);
  if (budget && budget.limit) {
    if (m.price <= budget.limit) pros.push(`В бюджете: от ${rub(m.price)}`);
    else cons.push(`Выше бюджета на ${rub(m.price - budget.limit)}`);
  }
  return { score, pros, cons, ok: cons.length === 0 };
}

function ranked(a = answers) {
  return MODELS.map((m) => ({ m, f: fit(m, a) })).sort((x, y) => (y.f.ok - x.f.ok) || (y.f.score - x.f.score) || (x.m.price - y.m.price));
}
const okCount = (a) => MODELS.filter((m) => fit(m, a).ok).length;
const answered = () => QUESTIONS.every((q) => answers[q.id]);
const firstOpen = () => { const i = QUESTIONS.findIndex((q) => !answers[q.id]); return i === -1 ? QUESTIONS.length : i; };
const answerOpt = (q) => q.options.find((o) => o.id === answers[q.id]);

/* ---------- money ---------- */
function calcDefaults() {
  const mode = answers.buy === 'leasing' || answers.buy === 'org' ? 'leasing' : 'credit';
  const f = FINANCE[mode];
  return { mode, down: f.downDefault, months: f.monthsDefault, rate: '' };
}
function payment(price, c) {
  const down = Math.round(price * c.down / 100);
  const body = price - down;
  const r = Number(String(c.rate).replace(',', '.')) / 1200;
  const monthly = r > 0 ? body * r / (1 - Math.pow(1 + r, -c.months)) : body / c.months;
  return { down, body, monthly, withRate: r > 0 };
}
const NOTE_RATE = 'Аннуитетный платёж по введённой ставке.';
const NOTE_PLAIN = 'Без процентов: остаток цены, разделённый на срок. Ставку назначает банк или лизинговая компания.';

/* ---------- pieces ---------- */
const heart = (on) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 20.5 4.6 13.4a4.9 4.9 0 0 1 0-7 5 5 0 0 1 7 0l.4.4.4-.4a5 5 0 0 1 7 0 4.9 4.9 0 0 1 0 7z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

function picture(p, alt, sizes, eager) {
  return `<img src="${img(p, 960)}" srcset="${img(p, 480)} 480w, ${img(p, 960)} 960w, ${img(p, 1600)} 1600w" sizes="${sizes}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" data-full="${imgFull(p)}">`;
}

function routeSheet(current, linked = true) {
  const open = firstOpen();
  const items = QUESTIONS.map((q, i) => {
    const opt = answerOpt(q);
    const state = i === current ? 'now' : opt ? 'done' : 'todo';
    const inner = `<span class="wp-dot" aria-hidden="true"></span><span class="wp-label">${q.label}</span><span class="wp-val">${opt ? esc(opt.short) : '—'}</span>`;
    const reachable = linked && i <= open && i !== current;
    return `<li class="wp wp-${state}">${reachable ? `<a class="wp-in" href="#/quiz/${i + 1}" aria-label="${q.label}: изменить ответ">${inner}</a>` : `<span class="wp-in"${i === current ? ' aria-current="step"' : ''}>${inner}</span>`}</li>`;
  }).join('');
  const done = current === -1;
  return `<ol class="route">${items}<li class="wp wp-finish ${done ? 'wp-done' : 'wp-todo'}"><span class="wp-in"><span class="wp-dot" aria-hidden="true"></span><span class="wp-label">Финиш</span><span class="wp-val">${done ? 'Подборка' : '—'}</span></span></li></ol>`;
}

function fitList(f, limit = 4) {
  if (!f.pros.length && !f.cons.length) return '';
  return `<ul class="fit">${f.cons.map((t) => `<li class="fit-no">${esc(t)}</li>`).join('')}${f.pros.slice(0, limit).map((t) => `<li class="fit-yes">${esc(t)}</li>`).join('')}</ul>`;
}

function favButton(m) {
  const on = favs.has(m.id);
  return `<button class="fav${on ? ' is-on' : ''}" data-act="fav" data-id="${m.id}" aria-pressed="${on}" aria-label="${on ? 'Убрать из избранного' : 'В избранное'}: ${esc(m.name)}">${heart(on)}</button>`;
}

function card(m, f, opts = {}) {
  const tag = opts.best ? '<span class="card-tag">Лучшее совпадение</span>' : (f && !f.ok ? '<span class="card-tag card-tag-near">Есть расхождение</span>' : '');
  return `<article class="card${opts.best ? ' card-best' : ''}${f && !f.ok ? ' card-near' : ''}">
    <div class="card-photo"><a href="#/model/${m.id}" tabindex="-1" aria-hidden="true">${picture(m.photos[0], `Вездеход ${m.name}`, opts.best ? '(min-width: 900px) 55vw, 100vw' : '(min-width: 900px) 33vw, 100vw', opts.best)}</a>${tag}${favButton(m)}</div>
    <div class="card-body">
      <p class="mono card-code">${esc(m.code)}</p>
      <h3 class="card-name"><a href="#/model/${m.id}">${esc(m.name)}</a></h3>
      <p class="card-tagline">${esc(m.tagline)}</p>
      ${f ? fitList(f, opts.best ? 5 : 3) : ''}
      <dl class="passport">
        <div><dt>Грузоподъёмность</dt><dd>${m.load} кг</dd></div>
        <div><dt>Мест</dt><dd>${seatsLabel(m)}</dd></div>
        <div><dt>Мощность</dt><dd>${esc(m.power)}</dd></div>
      </dl>
      <div class="card-foot">
        <p class="price"><span>от</span> ${rub(m.price)}</p>
        <div class="card-actions">
          <button class="btn btn-primary" data-act="request" data-intent="calc" data-ids="${m.id}">Получить расчёт</button>
          <a class="link" href="#/model/${m.id}">Подробнее</a>
        </div>
      </div>
    </div>
  </article>`;
}

function customTile() {
  return `<article class="custom">
    <p class="mono">Индивидуальный заказ</p>
    <h3 class="card-name">${CUSTOM.name}</h3>
    <p>${CUSTOM.text}</p>
    <p class="price"><span>от</span> ${rub(CUSTOM.price)}</p>
    <button class="btn btn-ghost" data-act="request" data-intent="custom" data-ids="">Обсудить заказ</button>
  </article>`;
}

function lineup(list, title) {
  return `<section class="lineup">
    <div class="section-head"><h2 class="display-sm">${title}</h2><a class="link" href="#/compare">Сравнить характеристики</a></div>
    <ul class="lineup-list">${list.map((m) => `<li><a href="#/model/${m.id}">${picture(m.photos[0], `Вездеход ${m.name}`, '(min-width: 900px) 20vw, 60vw')}<span class="lineup-name">${esc(m.name)}</span><span class="mono">от ${rub(m.price)}</span></a></li>`).join('')}</ul>
  </section>`;
}

/* ---------- views ---------- */
function viewStart() {
  const s = segment;
  const hero = MODELS[s ? s.hero : 4];
  const h1 = s ? s.h1 : ['Вездеход', 'под ваш', 'маршрут'];
  const lead = s ? s.lead : 'Пять вопросов о задаче, местности и грузе — и вы увидите, какие модели подходят, сколько они стоят и каким будет платёж.';
  const minPrice = Math.min(...MODELS.map((m) => m.price));
  return `<section class="hero">
    <div class="hero-photo">${picture(hero.photos[0], `Вездеход ${hero.name} на снегу`, '(min-width: 900px) 70vw, 100vw', true)}</div>
    <div class="hero-text">
      <p class="mono eyebrow">Сделано в Сибири — работает везде</p>
      <h1 class="display">${h1.map((l, i) => `<span${i === h1.length - 1 ? ' class="accent"' : ''}>${esc(l)}</span>`).join(' ')}</h1>
      <p class="lead">${esc(lead)}</p>
      <div class="hero-actions">
        <button class="btn btn-primary btn-lg" data-act="start">${answered() ? 'Открыть мою подборку' : firstOpen() > 0 ? 'Продолжить подбор' : 'Подобрать вездеход'}</button>
        <a class="link" href="#/catalog">Весь каталог: ${modelsWord(MODELS.length)} от ${rub(minPrice)}</a>
      </div>
    </div>
  </section>
  <section class="brief">
    <p class="mono">Маршрутный лист · пять вопросов, около минуты</p>
    ${routeSheet(null, false)}
  </section>
  ${lineup(MODELS, 'Линейка')}
  <p class="facts mono"><span>Более 1152 вездеходов построено</span><span>Более 8 лет опыта</span><span>Дилеры в 8 регионах</span><span>Кредит, рассрочка, лизинг</span></p>`;
}

function viewQuiz(n) {
  const i = Math.min(Math.max(n - 1, 0), QUESTIONS.length - 1, firstOpen());
  const q = QUESTIONS[i];
  const hard = q.id === 'load' || q.id === 'budget';
  const now = okCount(answers);
  return `<section class="quiz">
    <aside class="quiz-side">
      <p class="mono">Маршрутный лист</p>
      ${routeSheet(i)}
      <p class="quiz-count mono" aria-live="polite">В подборке сейчас <b>${now} из ${MODELS.length}</b></p>
    </aside>
    <div class="quiz-main">
      <p class="mono step">Вопрос ${i + 1} из ${QUESTIONS.length}</p>
      <h1 class="display-md" id="q-title">${esc(q.title)}</h1>
      <p class="hint">${esc(q.hint)}</p>
      <div class="options" role="group" aria-labelledby="q-title">
        ${q.options.map((o) => {
          const n2 = hard ? okCount({ ...answers, [q.id]: o.id }) : null;
          return `<button class="option${answers[q.id] === o.id ? ' is-on' : ''}" data-act="answer" data-q="${q.id}" data-o="${o.id}" aria-pressed="${answers[q.id] === o.id}">
            <span class="option-text">${esc(o.text)}</span>
            ${hard ? `<span class="mono option-count">${n2 ? modelsWord(n2) : 'нет точных'}</span>` : ''}
          </button>`;
        }).join('')}
      </div>
      <div class="quiz-nav">
        ${i > 0 ? `<a class="link" href="#/quiz/${i}">← Назад</a>` : '<a class="link" href="#/">← На первый экран</a>'}
        ${answers[q.id] ? `<a class="link" href="#/${i + 1 < QUESTIONS.length ? `quiz/${i + 2}` : 'results'}">Дальше →</a>` : ''}
      </div>
    </div>
  </section>`;
}

function viewResults() {
  const list = ranked();
  const ok = list.filter((x) => x.f.ok);
  const near = list.filter((x) => !x.f.ok);
  const best = ok.length && ok[0].f.score > 0 ? ok[0] : null;
  const rest = best ? ok.slice(1) : ok;
  const okIds = ok.map((x) => x.m.id).join(',');
  const head = ok.length
    ? `<h1 class="display-md">Под ваш маршрут ${plural(ok.length, 'подходит', 'подходят', 'подходит')} ${modelsWord(ok.length)}</h1><p class="lead">Сначала проверили жёсткие условия — места, груз и бюджет, затем расставили модели по задаче и местности. Причины указаны в каждой карточке.</p>`
    : `<h1 class="display-md">Точного совпадения нет</h1><p class="lead">Ни одна модель не проходит сразу по всем условиям. Ниже — ближайшие варианты: в каждой карточке отмечено, что не совпало. Можно изменить ответ в маршрутном листе или обсудить индивидуальный заказ.</p>`;
  return `<section class="results">
    <div class="results-head">
      <p class="mono eyebrow">Маршрутный лист заполнен</p>
      ${head}
      ${routeSheet(-1)}
    </div>
    ${best ? `<div class="best">${card(best.m, best.f, { best: true })}</div>` : ''}
    ${rest.length ? `<h2 class="display-sm">${best ? 'Тоже подходят' : 'Подходят по условиям'}</h2><div class="cards">${rest.map((x) => card(x.m, x.f)).join('')}</div>` : ''}
    ${near.length ? `<h2 class="display-sm">Близкие варианты</h2><p class="section-note">Не проходят по части ваших условий — расхождения отмечены в карточке первыми.</p>` : ''}
    <div class="cards">${near.map((x) => card(x.m, x.f)).join('')}${customTile()}</div>
    <div class="results-cta">
      <div>
        <h2 class="display-sm">Сомневаетесь между моделями?</h2>
        <p>Отправьте подборку менеджеру: он получит ваши ответы и модели, подскажет по наличию и комплектации.</p>
      </div>
      <div class="results-cta-actions">
        ${ok.length ? `<button class="btn btn-primary btn-lg" data-act="request" data-intent="set" data-ids="${okIds}">Отправить подборку менеджеру</button>` : ''}
        <a class="btn btn-ghost btn-lg" href="#/compare">Сравнить характеристики</a>
        <button class="link" data-act="reset">Пройти подбор заново</button>
      </div>
    </div>
  </section>`;
}

function viewCatalog() {
  const hasRoute = answered();
  const uses = QUESTIONS[0].options;
  let list = MODELS.map((m) => ({ m, f: hasRoute ? fit(m) : null }));
  if (catalogFilter !== 'all') list = list.filter((x) => x.m.uses[catalogFilter]);
  const sorters = {
    price: (a, b) => a.m.price - b.m.price,
    load: (a, b) => (b.m.load - a.m.load) || (b.m.seats[1] - a.m.seats[1]),
    route: (a, b) => (b.f.ok - a.f.ok) || (b.f.score - a.f.score) || (a.m.price - b.m.price),
  };
  const sort = catalogSort === 'route' && !hasRoute ? 'price' : catalogSort;
  list.sort(sorters[sort]);
  return `<section class="catalog">
    <div class="page-head">
      <p class="mono eyebrow">Каталог · цены на ${CHECKED}</p>
      <h1 class="display-md">Вездеходы на шинах низкого давления</h1>
    </div>
    ${hasRoute
      ? `<p class="banner">Учтён ваш маршрут: ${QUESTIONS.slice(0, 4).map((q) => esc(answerOpt(q).short)).join(' · ')}. <a class="link" href="#/results">Открыть подборку</a></p>`
      : `<p class="banner">Не знаете, какую модель выбрать? <button class="link" data-act="start">Ответьте на пять вопросов</button> — покажем подходящие.</p>`}
    <div class="toolbar">
      <div class="chips" role="group" aria-label="Задача">
        <button class="chip${catalogFilter === 'all' ? ' is-on' : ''}" data-act="filter" data-v="all" aria-pressed="${catalogFilter === 'all'}">Все</button>
        ${uses.map((o) => `<button class="chip${catalogFilter === o.id ? ' is-on' : ''}" data-act="filter" data-v="${o.id}" aria-pressed="${catalogFilter === o.id}">${esc(o.short)}</button>`).join('')}
      </div>
      <label class="sort mono">Сортировка
        <select data-act="sort">
          <option value="price"${sort === 'price' ? ' selected' : ''}>по цене</option>
          <option value="load"${sort === 'load' ? ' selected' : ''}>по грузу и местам</option>
          ${hasRoute ? `<option value="route"${sort === 'route' ? ' selected' : ''}>по моему маршруту</option>` : ''}
        </select>
      </label>
    </div>
    <div class="cards">${list.map((x) => card(x.m, x.f)).join('')}${customTile()}</div>
    <p class="section-note">Цена «от» — базовая комплектация с учётом максимальной выгоды, как указано на сайте производителя. Наличие и итоговую стоимость подтверждает менеджер.</p>
  </section>`;
}

function passportRows(m) {
  return [
    ['Грузоподъёмность', `${m.load} кг`],
    ['Мест', seatsLabel(m)],
    ['Двигатель', m.engine],
    ['Мощность', m.power + (m.powerNote ? `, ${m.powerNote}` : '')],
    ['Масса', m.weight],
    ['Габариты Д × Ш × В', m.dims],
    ['Шины в базе', m.tyres],
    ['Топливный бак', m.tank],
    ['Раздаточная коробка', m.transfer],
    ['Грузовая площадка', m.cargo],
    ...(m.extra || []),
  ];
}

function calcBlock(m) {
  if (!calc) calc = calcDefaults();
  const f = FINANCE[calc.mode];
  const p = payment(m.price, calc);
  return `<section class="calc" id="calc" data-price="${m.price}">
    <h2 class="display-sm">Примерный платёж</h2>
    <div class="seg" role="group" aria-label="Способ покупки">
      ${Object.entries(FINANCE).map(([k, v]) => `<button data-act="calc-mode" data-mode="${k}" aria-pressed="${calc.mode === k}" class="${calc.mode === k ? 'is-on' : ''}">${v.title}</button>`).join('')}
    </div>
    <p class="calc-facts">${f.title} ${f.who}. ${f.facts}</p>
    <label class="field-range"><span>Первоначальный взнос <output id="calc-down">${calc.down}% · ${rub(p.down)}</output></span>
      <input type="range" name="down" min="${f.downMin}" max="${f.downMax}" step="5" value="${calc.down}"></label>
    <label class="field-range"><span>Срок <output id="calc-months">${calc.months} мес.</output></span>
      <input type="range" name="months" min="${f.monthsMin}" max="${f.monthsMax}" step="6" value="${calc.months}"></label>
    <label class="field-inline"><span>Ставка, % годовых</span>
      <input type="text" inputmode="decimal" name="rate" value="${esc(calc.rate)}" placeholder="если знаете" maxlength="5"></label>
    <div class="calc-out">
      <p class="mono">Платёж в месяц</p>
      <p class="calc-sum" id="calc-sum">${rub(p.monthly)}</p>
      <p class="calc-note" id="calc-note">${p.withRate ? NOTE_RATE : NOTE_PLAIN}</p>
    </div>
    <button class="btn btn-primary btn-block" data-act="request" data-intent="calc" data-ids="${m.id}" data-with-calc="1">Получить точный расчёт</button>
    <p class="fine">Ориентир для сравнения, не оферта. Считаем от цены базовой комплектации ${rub(m.price)}.</p>
  </section>`;
}

function viewModel(id) {
  const m = byId(id);
  if (!m) return viewCatalog();
  const f = answered() ? fit(m) : null;
  return `<section class="model">
    <button class="link back" data-act="back">← Назад</button>
    <div class="model-top">
      <div class="gallery">
        <div class="gallery-main">${picture(m.photos[0], `Вездеход ${m.name}`, '(min-width: 900px) 58vw, 100vw', true)}</div>
        <div class="gallery-thumbs">${m.photos.map((p, i) => `<button data-act="photo" data-i="${i}" aria-label="Фото ${i + 1} из ${m.photos.length}" aria-pressed="${i === 0}" class="${i === 0 ? 'is-on' : ''}"><img src="${img(p, 480)}" alt="" loading="lazy"></button>`).join('')}</div>
      </div>
      <div class="model-info">
        <p class="mono">${esc(m.code)}</p>
        <h1 class="display-md">${esc(m.name)}</h1>
        <p class="lead">${esc(m.tagline)}</p>
        <p class="price price-lg"><span>от</span> ${rub(m.price)}</p>
        <p class="fine">Базовая комплектация, с учётом максимальной выгоды. Цена с сайта производителя на ${CHECKED}.</p>
        ${f ? `<div class="why"><p class="mono">${f.ok ? 'Почему в вашей подборке' : 'Сверка с вашим маршрутом'}</p>${fitList(f, 6)}</div>` : ''}
        <div class="model-actions">
          <button class="btn btn-primary btn-lg" data-act="request" data-intent="calc" data-ids="${m.id}">Получить расчёт</button>
          <button class="btn btn-ghost btn-lg" data-act="request" data-intent="test" data-ids="${m.id}">Записаться на тест-драйв</button>
          ${favButton(m)}
        </div>
      </div>
    </div>
    <div class="model-grid">
      <section class="sheet">
        <h2 class="display-sm">Паспорт модели</h2>
        <dl class="passport passport-full">${passportRows(m).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <p class="fine"><a class="link" href="${m.url}" target="_blank" rel="noopener">Полная техкарта на sibatv.ru ↗</a></p>
      </section>
      <section class="sheet">
        <h2 class="display-sm">В базовой комплектации</h2>
        <ul class="ticks">${m.base.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <p class="mono sub">У всех моделей</p>
        <ul class="ticks ticks-muted">${COMMON.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>
      ${calcBlock(m)}
    </div>
    ${lineup(MODELS.filter((x) => x.id !== m.id), 'Другие модели')}
  </section>`;
}

function viewCompare() {
  const only = compareFavsOnly && favs.size >= 2;
  const list = only ? MODELS.filter((m) => favs.has(m.id)) : MODELS;
  const rows = [['Цена от', (m) => rub(m.price)], ...passportRows(MODELS[0]).slice(0, 10).map(([k], i) => [k, (m) => passportRows(m)[i][1]])];
  return `<section class="compare">
    <div class="page-head">
      <p class="mono eyebrow">Сравнение · данные сайта на ${CHECKED}</p>
      <h1 class="display-md">Характеристики рядом</h1>
    </div>
    <div class="toolbar">
      <div class="chips" role="group" aria-label="Какие модели показать">
        <button class="chip${!only ? ' is-on' : ''}" data-act="cmp" data-v="all" aria-pressed="${!only}">Все модели</button>
        <button class="chip${only ? ' is-on' : ''}" data-act="cmp" data-v="favs" aria-pressed="${only}" ${favs.size < 2 ? 'disabled' : ''}>Только избранное${favs.size ? ` · ${favs.size}` : ''}</button>
      </div>
      ${favs.size < 2 ? '<p class="fine">Отметьте сердечком хотя бы две модели, чтобы сравнить только их.</p>' : ''}
    </div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Таблица сравнения, прокручивается по горизонтали">
      <table class="cmp">
        <thead><tr><th scope="col"><span class="mono">Модель</span></th>${list.map((m) => `<th scope="col"><a href="#/model/${m.id}">${picture(m.photos[0], '', '220px')}<span class="cmp-name">${esc(m.name)}</span></a>${favButton(m)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(([k, get]) => `<tr><th scope="row">${esc(k)}</th>${list.map((m) => `<td>${esc(get(m))}</td>`).join('')}</tr>`).join('')}
        <tr><th scope="row"></th>${list.map((m) => `<td><button class="btn btn-primary btn-sm" data-act="request" data-intent="calc" data-ids="${m.id}">Получить расчёт</button></td>`).join('')}</tr></tbody>
      </table>
    </div>
  </section>`;
}

function viewFavs() {
  const list = MODELS.filter((m) => favs.has(m.id));
  if (!list.length) {
    return `<section class="empty"><p class="mono eyebrow">Избранное</p><h1 class="display-md">Пока пусто</h1><p class="lead">Отмечайте модели сердечком в подборке или каталоге — они соберутся здесь, и их можно будет отправить менеджеру одним запросом.</p><div class="hero-actions"><button class="btn btn-primary btn-lg" data-act="start">Подобрать вездеход</button><a class="link" href="#/catalog">Открыть каталог</a></div></section>`;
  }
  const hasRoute = answered();
  return `<section class="catalog">
    <div class="page-head"><p class="mono eyebrow">Избранное · ${modelsWord(list.length)}</p><h1 class="display-md">Ваш короткий список</h1></div>
    <div class="cards">${list.map((m) => card(m, hasRoute ? fit(m) : null)).join('')}</div>
    <div class="results-cta">
      <div><h2 class="display-sm">Один запрос на все модели</h2><p>Менеджер получит список и ответит по наличию, комплектации и срокам сразу по каждой.</p></div>
      <div class="results-cta-actions">
        <button class="btn btn-primary btn-lg" data-act="request" data-intent="set" data-ids="${list.map((m) => m.id).join(',')}">Отправить список менеджеру</button>
        ${list.length >= 2 ? '<button class="btn btn-ghost btn-lg" data-act="cmp-favs">Сравнить избранное</button>' : ''}
      </div>
    </div>
  </section>`;
}

function leadCard(l) {
  const rows = [
    ['Запрос', l.intentLabel],
    ['Модели', l.models.join(', ') || '—'],
    ...(l.buyer ? [['Покупатель', l.buyer]] : []),
    ...l.answers,
    ...(l.calc ? [['Расчёт', l.calc]] : []),
    ...(l.color ? [['Цвет', l.color]] : []),
    ...(l.place ? [['Тест-драйв', l.place]] : []),
    ['Связь', l.channel],
    ...(l.name ? [['Имя', l.name], ['Контакт', l.contact]] : [['Контакты', 'в демо не сохраняются']]),
    ['Источник', Object.keys(l.source).length ? Object.entries(l.source).map(([k, v]) => `${k}=${v}`).join(' · ') : 'прямой заход'],
    ['Время', new Date(l.time).toLocaleString('ru-RU')],
  ];
  return `<dl class="passport passport-full lead-card">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function viewPanel() {
  const events = store.get('events', []);
  const leads = store.get('leads', []);
  const sessions = new Map();
  for (const e of events) {
    if (!sessions.has(e.s)) sessions.set(e.s, { names: new Set(), ans: {} });
    const s = sessions.get(e.s);
    s.names.add(e.n === 'answer' ? `answer:${e.d.q}` : e.n);
    if (e.n === 'answer') s.ans[e.d.q] = e.d.o;
  }
  const all = [...sessions.values()];
  const count = (n) => all.filter((s) => s.names.has(n)).length;
  const steps = [['Начали подбор', 'start'], ...QUESTIONS.map((q) => [`Ответили: ${q.label.toLowerCase()}`, `answer:${q.id}`]), ['Увидели подборку', 'results'], ['Открыли модель', 'model'], ['Открыли форму', 'request_open'], ['Отправили запрос', 'request_sent']];
  const top = Math.max(1, ...steps.map(([, n]) => count(n)));
  return `<section class="panel">
    <div class="page-head">
      <p class="mono eyebrow">Демо-панель · только этот браузер</p>
      <h1 class="display-md">Что видит маркетолог</h1>
      <p class="lead">Здесь собраны прохождения с этого устройства. В рабочей версии те же события уходят в общую аналитику, а запросы — менеджеру.</p>
    </div>
    <h2 class="display-sm">Воронка по сессиям</h2>
    ${all.length ? `<ol class="funnel">${steps.map(([label, n]) => { const c = count(n); return `<li><span>${label}</span><span class="funnel-bar"><i style="width:${Math.round(c / top * 100)}%"></i></span><b class="mono">${c}</b></li>`; }).join('')}</ol>` : '<p class="section-note">Пока нет данных. Пройдите подбор — события появятся здесь.</p>'}
    <h2 class="display-sm">Ответы</h2>
    <div class="dist">${QUESTIONS.map((q) => {
      const tally = q.options.map((o) => [o.short, all.filter((s) => s.ans[q.id] === o.id).length]);
      const total = tally.reduce((a, [, c]) => a + c, 0);
      return `<div><p class="mono">${q.label}</p>${total ? `<ul>${tally.map(([t, c]) => `<li><span>${esc(t)}</span><b class="mono">${c}</b></li>`).join('')}</ul>` : '<p class="fine">нет данных</p>'}</div>`;
    }).join('')}</div>
    <h2 class="display-sm">Запросы</h2>
    ${leads.length ? `<div class="leads">${leads.slice().reverse().map(leadCard).join('')}</div>` : '<p class="section-note">Запросов пока нет.</p>'}
    <p class="fine">Имя и телефон в демо не сохраняются и никуда не отправляются: в карточках остаётся только контекст запроса.</p>
    <button class="btn btn-ghost" data-act="panel-clear">Очистить данные демо</button>
  </section>`;
}

/* ---------- request dialog ---------- */
const INTENTS = {
  calc: { title: 'Расчёт и наличие', submit: 'Отправить запрос на расчёт', done: 'Запрос на расчёт собран' },
  test: { title: 'Запись на тест-драйв', submit: 'Отправить запрос на тест-драйв', done: 'Запрос на тест-драйв собран' },
  set: { title: 'Подборка для менеджера', submit: 'Отправить подборку', done: 'Подборка собрана' },
  custom: { title: 'Индивидуальный заказ', submit: 'Отправить запрос на заказ', done: 'Запрос на заказ собран' },
};
const dialog = document.querySelector('#request');
let req = null;

function openRequest(intent, ids, withCalc) {
  req = { intent, ids: ids.filter(byId), withCalc: Boolean(withCalc) && Boolean(calc) };
  const it = INTENTS[intent];
  const names = intent === 'custom' ? [CUSTOM.name] : req.ids.map((id) => byId(id).name);
  dialog.innerHTML = `<form novalidate>
    <button type="button" class="dialog-close" data-act="dialog-close" aria-label="Закрыть">×</button>
    <p class="mono eyebrow">Демо-форма</p>
    <h2 class="display-sm">${it.title}</h2>
    ${names.length ? `<p class="req-models">${names.map((n) => `<span>${esc(n)}</span>`).join('')}</p>` : ''}
    ${answered() ? '<p class="fine">К запросу приложим ваши ответы из подбора — менеджеру не придётся переспрашивать.</p>' : ''}
    <label class="field"><span>Как к вам обращаться</span><input name="name" autocomplete="given-name" maxlength="40" placeholder="Имя"><em class="err" data-for="name"></em></label>
    <label class="field"><span>Телефон</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="22" placeholder="+7 900 000-00-00"><em class="err" data-for="phone"></em></label>
    <fieldset class="field"><legend>Как удобнее связаться</legend>
      <div class="chips">${['Звонок', 'Telegram', 'MAX', 'WhatsApp'].map((c, i) => `<label class="chip chip-radio"><input type="radio" name="channel" value="${c}"${i === 0 ? ' checked' : ''}><span>${c}</span></label>`).join('')}</div>
    </fieldset>
    ${intent === 'test' ? `<label class="field"><span>Где удобно пройти тест-драйв</span><select name="place">${PLACES.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>` : ''}
    ${intent === 'calc' || intent === 'custom' ? `<fieldset class="field"><legend>Цвет из заводской палитры — если уже выбрали</legend>
      <div class="swatches">${COLORS.map((c) => `<label title="${esc(c.name)} · RAL ${c.ral}"><input type="radio" name="color" value="${esc(c.name)} (RAL ${c.ral})"><span style="background:${c.hex}"></span><b class="sr">${esc(c.name)}</b></label>`).join('')}</div>
      <p class="fine" id="color-name">Цвет на экране приблизительный.</p>
    </fieldset>` : ''}
    <label class="check"><input type="checkbox" name="agree"><span>Согласен на обработку данных. В демо данные не сохраняются и не передаются.</span></label><em class="err" data-for="agree"></em>
    <button class="btn btn-primary btn-lg btn-block">${it.submit}</button>
  </form>`;
  dialog.showModal();
  track('request_open', { intent, ids: req.ids });
}

function normalizePhone(raw) {
  const s = String(raw).trim();
  const d = s.replace(/\D/g, '');
  if (!s.startsWith('+')) {
    if (d.length === 10) return '+7' + d;
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
    return null;
  }
  if (d.length < 10 || d.length > 15) return null;
  return '+' + d;
}
const prettyPhone = (p) => (p.startsWith('+7') && p.length === 12 ? `+7 ${p.slice(2, 5)} ${p.slice(5, 8)}-${p.slice(8, 10)}-${p.slice(10)}` : p);

function submitRequest(form) {
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const phone = normalizePhone(data.get('phone') || '');
  const errors = {
    name: /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё \-']{1,39}$/.test(name) ? '' : 'Введите имя буквами, от двух символов.',
    phone: phone ? '' : 'Проверьте номер: для России — 10 цифр после +7, для других стран — с плюсом и кодом страны.',
    agree: data.get('agree') ? '' : 'Отметьте согласие, чтобы отправить запрос.',
  };
  let first = null;
  for (const [k, msg] of Object.entries(errors)) {
    form.querySelector(`.err[data-for="${k}"]`).textContent = msg;
    const input = form.elements[k];
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg && !first) first = input;
  }
  if (first) { first.focus(); return; }

  const it = INTENTS[req.intent];
  const buyOpt = answers.buy && QUESTIONS[4].options.find((o) => o.id === answers.buy);
  let calcText = '';
  if (req.withCalc && req.ids.length === 1) {
    const p = payment(byId(req.ids[0]).price, calc);
    calcText = `${FINANCE[calc.mode].title}: взнос ${calc.down}% (${rub(p.down)}), ${calc.months} мес., ${rub(p.monthly)} в мес.${p.withRate ? ` при ${calc.rate}%` : ' без процентов'}`;
  }
  const lead = {
    time: Date.now(),
    intentLabel: it.title,
    models: req.intent === 'custom' ? [CUSTOM.name] : req.ids.map((id) => byId(id).name),
    buyer: buyOpt ? buyOpt.buyer : '',
    answers: QUESTIONS.filter((q) => answers[q.id]).map((q) => [q.label, answerOpt(q).text]),
    calc: calcText,
    color: String(data.get('color') || ''),
    place: String(data.get('place') || ''),
    channel: String(data.get('channel') || 'Звонок'),
    source,
  };
  const leads = store.get('leads', []);
  leads.push(lead);
  store.set('leads', leads.slice(-50));
  track('request_sent', { intent: req.intent, ids: req.ids });

  dialog.innerHTML = `<div class="done">
    <button type="button" class="dialog-close" data-act="dialog-close" aria-label="Закрыть">×</button>
    <p class="mono eyebrow">Демо · никуда не отправлено</p>
    <h2 class="display-sm" tabindex="-1">${it.done}</h2>
    <p>Так выглядит карточка, которую в рабочей версии получает менеджер: не просто телефон, а задача, условия и выбранные модели.</p>
    ${leadCard({ ...lead, name, contact: prettyPhone(phone) })}
    <p class="fine">Имя и телефон показаны только на этом экране и не сохраняются. Остальное видно в <a class="link" href="#/panel" data-act="dialog-close">демо-панели</a>.</p>
    <button class="btn btn-primary btn-lg btn-block" data-act="dialog-close">Вернуться к моделям</button>
  </div>`;
  dialog.querySelector('h2').focus();
}

/* ---------- router ---------- */
function parse() {
  const [name = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { name, arg };
}
const go = (path) => { location.hash = '#/' + path; };
let lastKey = null;

function render() {
  const { name, arg } = parse();
  let html, title = 'Подбор вездехода';
  if (name === 'quiz') { html = viewQuiz(Number(arg) || 1); title = 'Подбор вездехода'; }
  else if (name === 'results') {
    if (!answered()) { go(`quiz/${firstOpen() + 1}`); return; }
    html = viewResults(); title = 'Ваша подборка';
  }
  else if (name === 'catalog') { html = viewCatalog(); title = 'Каталог'; }
  else if (name === 'model') { html = viewModel(arg); title = byId(arg) ? byId(arg).name : 'Каталог'; }
  else if (name === 'compare') { html = viewCompare(); title = 'Сравнение моделей'; }
  else if (name === 'favs') { html = viewFavs(); title = 'Избранное'; }
  else if (name === 'panel') { html = viewPanel(); title = 'Демо-панель'; }
  else html = viewStart();
  app.innerHTML = html;
  document.title = `${title} — SIBATV · демо`;
  const section = name === 'quiz' || name === 'results' ? 'quiz/1' : name;
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.getAttribute('href') === `#/${section}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  updateFavCount();
  const key = name + '/' + arg;
  if (key !== lastKey) {
    window.scrollTo(0, 0);
    if (name === 'results') track('results', { ok: okCount(answers) });
    if (name === 'model' && byId(arg)) track('model', { id: arg });
    const h = app.querySelector('h1');
    if (lastKey !== null && h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    lastKey = key;
  }
}

function updateFavCount() {
  const el = document.querySelector('#fav-count');
  el.textContent = favs.size ? String(favs.size) : '';
  el.hidden = !favs.size;
}

function updateCalc() {
  const box = document.querySelector('#calc');
  if (!box) return;
  const p = payment(Number(box.dataset.price), calc);
  box.querySelector('#calc-down').textContent = `${calc.down}% · ${rub(p.down)}`;
  box.querySelector('#calc-months').textContent = `${calc.months} мес.`;
  box.querySelector('#calc-sum').textContent = rub(p.monthly);
  box.querySelector('#calc-note').textContent = p.withRate ? NOTE_RATE : NOTE_PLAIN;
  store.set('calc', calc);
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'start') {
    if (segment && !answers.use) { answers.use = segment.use; store.set('answers', answers); }
    track('start', { seg: source.seg || '' });
    go(answered() ? 'results' : `quiz/${firstOpen() + 1}`);
  } else if (act === 'answer') {
    answers[el.dataset.q] = el.dataset.o;
    store.set('answers', answers);
    if (!store.get('events', []).some((x) => x.s === sid && x.n === 'start')) track('start', { seg: source.seg || '' });
    track('answer', { q: el.dataset.q, o: el.dataset.o });
    const i = QUESTIONS.findIndex((q) => q.id === el.dataset.q);
    go(i + 1 < QUESTIONS.length ? `quiz/${i + 2}` : 'results');
  } else if (act === 'reset') {
    answers = {}; store.set('answers', answers); calc = null; store.set('calc', null);
    go('quiz/1');
  } else if (act === 'fav') {
    const id = el.dataset.id;
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    store.set('favs', [...favs]);
    track('fav', { id, on: favs.has(id) });
    const { name } = parse();
    if (name === 'favs' || name === 'compare') render();
    else document.querySelectorAll(`.fav[data-id="${id}"]`).forEach((b) => { b.outerHTML = favButton(byId(id)); });
    updateFavCount();
    const again = document.querySelector(`.fav[data-id="${id}"]`);
    if (again && name !== 'favs') again.focus({ preventScroll: true });
  } else if (act === 'request') {
    openRequest(el.dataset.intent, (el.dataset.ids || '').split(',').filter(Boolean), el.dataset.withCalc);
  } else if (act === 'dialog-close') {
    dialog.close();
  } else if (act === 'photo') {
    const m = byId(parse().arg);
    const p = m.photos[Number(el.dataset.i)];
    document.querySelector('.gallery-main').innerHTML = picture(p, `Вездеход ${m.name}`, '(min-width: 900px) 58vw, 100vw', true);
    document.querySelectorAll('.gallery-thumbs button').forEach((b) => { const on = b === el; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
  } else if (act === 'calc-mode') {
    const f = FINANCE[el.dataset.mode];
    calc = { mode: el.dataset.mode, down: f.downDefault, months: f.monthsDefault, rate: calc ? calc.rate : '' };
    store.set('calc', calc);
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    const btn = document.querySelector(`[data-act="calc-mode"][data-mode="${calc.mode}"]`);
    if (btn) btn.focus({ preventScroll: true });
  } else if (act === 'filter') {
    catalogFilter = el.dataset.v; render();
  } else if (act === 'cmp') {
    compareFavsOnly = el.dataset.v === 'favs'; render();
  } else if (act === 'cmp-favs') {
    compareFavsOnly = true; go('compare');
  } else if (act === 'back') {
    if (history.length > 1) history.back(); else go('catalog');
  } else if (act === 'panel-clear') {
    store.set('events', []); store.set('leads', []); render();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.closest('#calc') && calc) {
    if (t.name === 'down') calc.down = Number(t.value);
    if (t.name === 'months') calc.months = Number(t.value);
    if (t.name === 'rate') { t.value = t.value.replace(/[^\d.,]/g, ''); calc.rate = t.value; }
    updateCalc();
  }
  if (t.name === 'name') { const v = t.value.replace(/[^A-Za-zА-Яа-яЁё \-']/g, ''); if (v !== t.value) t.value = v; }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.act === 'sort') { catalogSort = t.value; render(); }
  if (t.name === 'color') document.querySelector('#color-name').textContent = `${t.value}. Цвет на экране приблизительный.`;
});

document.addEventListener('focusout', (e) => {
  const t = e.target;
  if (t.name === 'phone') { const p = normalizePhone(t.value); if (p) t.value = prettyPhone(p); }
});

document.addEventListener('error', (e) => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.full && !t.dataset.fallback) {
    t.dataset.fallback = '1'; t.removeAttribute('srcset'); t.src = t.dataset.full;
  }
}, true);

dialog.addEventListener('submit', (e) => { e.preventDefault(); submitRequest(e.target); });
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

try { history.scrollRestoration = 'manual'; } catch { /* older browsers */ }
window.addEventListener('hashchange', render);
render();
