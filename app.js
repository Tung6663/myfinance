import {CURS, ITER, deriveKey, seal, unseal, rand, b64, unb64, emptyData, normalize, makeBackup, readBackup, summarize, money, toTWD, loanInfo, reminders} from './core.js';

/* ---------- IndexedDB：只存 salt 與密文 ---------- */
const idb = () => new Promise((res, rej) => { const q = indexedDB.open('myfinance', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
async function tx(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', mode);
  const out = fn(t.objectStore('kv')); t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); }); }
const dbGet = k => tx('readonly', s => s.get(k));
const dbPutMany = o => tx('readwrite', s => { let r; for (const k in o) r = s.put(o[k], k); return r; });
const dbClear = () => tx('readwrite', s => s.clear());

/* ---------- 狀態 ---------- */
let S = null, KEY = null, tab = 'home', hiddenAt = 0;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const uid = () => b64(rand(9)).replace(/[+/=]/g, 'x');
const fmt = (n, c) => (c === 'TWD' ? 'NT$' : c) + ' ' + (+n).toLocaleString('en-US', {maximumFractionDigits: 2});
const save = async () => dbPutMany({vault: await seal(KEY, S)});   // 寫入前一律先加密
function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); }
const MIN_PW = 8;

/* ---------- 解鎖 / 設定密碼 ---------- */
async function boot() {
  navigator.storage?.persist?.();
  const meta = await dbGet('meta');
  lockScreen(!meta);
}
function lockScreen(first) {
  KEY = null; S = null; $('tabs').hidden = true; $('sheet').hidden = true;
  $('app').innerHTML = `<div class="lock"><h1>MyFinance</h1><p>${first ? '建立主密碼。資料會加密後只存在這支手機。' : '輸入主密碼解鎖'}</p>
  <input id="pw" type="password" placeholder="主密碼" autocomplete="${first ? 'new-password' : 'current-password'}">
  ${first ? '<input id="pw2" type="password" placeholder="再輸入一次" style="margin-top:10px" autocomplete="new-password"><div class="warn-box" style="color:var(--ink)">主密碼無法找回。忘記密碼時，只能用加密備份檔還原。</div>' : ''}
  <button class="btn" id="go">${first ? '建立並開始' : '解鎖'}</button><div class="err" id="err"></div></div>`;
  const go = async () => {
    const pw = $('pw').value, err = m => $('err').textContent = m; err('');
    if (first && pw.length < MIN_PW) return err(`密碼至少 ${MIN_PW} 個字元`);
    if (first && pw !== $('pw2').value) return err('兩次輸入的密碼不一致');
    $('go').disabled = true; $('go').textContent = '處理中…';
    try {
      if (first) { const salt = rand(16); KEY = await deriveKey(pw, salt); S = emptyData();
        await dbPutMany({meta: {salt: b64(salt), iter: ITER}, vault: await seal(KEY, S)}); }
      else { const m = await dbGet('meta'), v = await dbGet('vault'); KEY = await deriveKey(pw, unb64(m.salt), m.iter);
        S = normalize(await unseal(KEY, v)); }
      tab = 'home'; $('tabs').hidden = false; render();
    } catch { KEY = null; err('密碼錯誤，無法解密'); $('go').disabled = false; $('go').textContent = '解鎖'; }
  };
  $('go').onclick = go; $('pw').focus();
}
document.addEventListener('visibilitychange', () => {   // 離開超過 60 秒自動上鎖
  if (document.hidden) hiddenAt = Date.now();
  else if (KEY && hiddenAt && Date.now() - hiddenAt > 60000) lockScreen(false);
});

/* ---------- 資料集設定 ---------- */
const BANKS = ['中國信託', '台灣銀行', '永豐銀行', '兆豐銀行', 'Richart', '國泰世華', '玉山銀行', '樂天銀行'];
const curSel = {k: 'cur', l: '幣別', t: 'select', o: CURS};
const SETS = {
  accounts: {name: '銀行帳戶', f: [{k: 'bank', l: '銀行帳戶名稱', t: 'text', list: BANKS}, curSel, {k: 'bal', l: '目前餘額', t: 'num'}, {k: 'rate', l: '活存利率（%）', t: 'num', opt: 1}]},
  cards: {name: '信用卡', f: [{k: 'bank', l: '發卡銀行', t: 'text', list: BANKS}, {k: 'name', l: '信用卡名稱', t: 'text'}, {k: 'amt', l: '本期帳單金額（TWD）', t: 'num'}, {k: 'due', l: '繳款截止日', t: 'date'}, {k: 'paid', l: '已繳款', t: 'check'}]},
  assets: {name: '資產', f: [{k: 'type', l: '類型', t: 'select', o: ['股票', 'ETF', '債券', '定存', '黃金', '房地產', '其他']}, {k: 'name', l: '名稱', t: 'text'}, curSel, {k: 'val', l: '目前價值', t: 'num'}]},
  debts: {name: '負債', f: [{k: 'type', l: '類型', t: 'select', o: ['房貸', '信貸', '其他負債']}, {k: 'name', l: '名稱', t: 'text'}, curSel, {k: 'val', l: '未償金額', t: 'num'}, {k: 'day', l: '每月還款日期', t: 'day', opt: 1}, {k: 'pay', l: '每月還款金額', t: 'num', opt: 1}, {k: 'rate', l: '貸款利率（年利率 %）', t: 'num', opt: 1}, {k: 'years', l: '貸款年限（年）', t: 'num', opt: 1}]},
};
function openForm(set, item) {
  const cfg = SETS[set]; let v = item || {cur: 'TWD'};
  if (set === 'accounts' && item?.name) v = {...item, bank: [item.bank, item.name].filter(Boolean).join(' ')};   // 舊資料：帳戶名稱併入銀行帳戶名稱
  const html = cfg.f.map(f => {
    const val = v[f.k] ?? '';
    if (f.t === 'select') return `<label>${f.l}</label><select name="${f.k}">${[...new Set([...f.o, ...(val ? [val] : [])])].map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    if (f.t === 'day') return `<label>${f.l}</label><select name="${f.k}"><option value="">未設定</option>${Array.from({length: 31}, (_, i) => i + 1).map(n => `<option value="${n}" ${n == val ? 'selected' : ''}>每月 ${n} 日</option>`).join('')}</select>`;
    if (f.t === 'check') return `<label><input type="checkbox" name="${f.k}" ${val ? 'checked' : ''}> ${f.l}</label>`;
    return `<label>${f.l}</label><input name="${f.k}" value="${esc(val)}" ${f.t === 'num' ? 'inputmode="decimal"' : f.t === 'date' ? 'type="date"' : ''} ${f.list ? 'list="dl"' : ''} autocomplete="off">`;
  }).join('') + `<datalist id="dl">${BANKS.map(b => `<option value="${b}">`).join('')}</datalist>`;
  sheet(`<form><h3>${item ? '編輯' : '新增'}${cfg.name}</h3>${html}<button class="btn">儲存</button>
    ${item ? '<button type="button" class="btn del" id="del">刪除</button>' : ''}<button type="button" class="btn alt" id="x">取消</button></form>`, async el => {
    el.querySelector('form').onsubmit = async e => {
      e.preventDefault(); const o = {...v, id: v.id || uid()};
      for (const f of cfg.f) { const n = el.querySelector(`[name=${f.k}]`);
        if (f.t === 'check') o[f.k] = n.checked;
        else if (f.t === 'num') { const raw = n.value.trim().replace(/,/g, ''); if (f.opt && raw === '') delete o[f.k]; else { const x = parseFloat(raw); if (isNaN(x)) return toast('請輸入正確的數字'); o[f.k] = x; } }
        else if (f.t === 'day') { if (n.value) o[f.k] = +n.value; else delete o[f.k]; }
        else o[f.k] = n.value.trim(); }
      if (!(o.name || o.bank)) return toast('請輸入名稱');
      if (set === 'accounts' || set === 'assets') o.upd = today();
      if (set === 'accounts') delete o.name;
      const i = S[set].findIndex(x => x.id === o.id); i < 0 ? S[set].push(o) : S[set][i] = o;
      await save(); closeSheet(); render(); toast('已儲存');
    };
    const d = el.querySelector('#del'); if (d) d.onclick = async () => {
      if (!confirm('確定刪除這筆資料？無法復原。')) return;
      S[set] = S[set].filter(x => x.id !== item.id); await save(); closeSheet(); render(); toast('已刪除'); };
  });
}
function sheet(html, after) { const s = $('sheet'); s.innerHTML = html.startsWith('<form') ? html : `<div class="box">${html}</div>`; s.hidden = false;
  s.onclick = e => { if (e.target === s) closeSheet(); }; const x = s.querySelector('#x'); if (x) x.onclick = closeSheet; after?.(s); }
const closeSheet = () => { $('sheet').hidden = true; $('sheet').innerHTML = ''; };

/* ---------- 畫面 ---------- */
function debtV(d) {
  const L = loanInfo(d); let h = fmt(d.val, d.cur);
  if (d.pay != null) h += `<div class="s">每月還款 ${fmt(d.pay, d.cur)}</div>`;
  if (L.interest != null) h += `<div class="s">每月利息約 ${fmt(Math.round(L.interest), d.cur)}</div>`;
  if (L.months) h += `<div class="s">剩餘約 ${L.months} 期（${Math.floor(L.months / 12)} 年 ${L.months % 12} 月）</div>`;
  if (L.insufficient) h += `<div class="s neg">還款金額低於每月利息</div>`;
  return h;
}
const TABS = [['home', '◎', '總覽'], ['acc', '▤', '帳戶'], ['card', '▭', '信用卡'], ['asset', '△', '資產負債'], ['set', '⚙', '設定']];
const list = (set, arr, line) => `<div class="card">${arr.length ? arr.map(x => `<button class="row" data-edit="${set}:${x.id}">${line(x)}</button>`).join('') : '<div class="empty">還沒有資料，點右下角新增</div>'}</div>`;
const item = (t, s, v, neg) => `<div><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div><div class="v num ${neg ? 'neg' : ''}">${v}</div>`;
function render() {
  $('tabs').innerHTML = TABS.map(([k, i, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}"><b>${i}</b>${n}</button>`).join('');
  const r = S.rates, m = summarize(S); let h = '', fab = '';
  if (tab === 'home') {
    const rem = reminders(S), rl = d => d < 0 ? `已逾期 ${-d} 天` : d === 0 ? '今天' : `${d} 天後`;
    const remHtml = rem.length ? `<h2 style="margin-top:6px">近期繳款提醒（7 天內）</h2><div class="card">${rem.map(x => `<div class="row">${item(x.name, `${x.kind === 'card' ? '信用卡' : '貸款'}・${x.date.getMonth() + 1}/${x.date.getDate()}`, `${x.amt != null ? fmt(x.amt, x.cur) : ''}<div><span class="chip ${x.days <= 0 ? 'warn' : ''}">${rl(x.days)}</span></div>`)}</div>`).join('')}</div>` : '';
    const parts = [['銀行存款', m.bank, '#7fd1a8'], ['外幣資產', m.fx, '#3fa37a'], ['股票及 ETF', m.sec, '#d9b55f'], ['其他資產', m.other, '#b9c9c0']];
    const pos = parts.map(p => [p[0], Math.max(p[1], 0), p[2], p[1]]), tot = pos.reduce((s, p) => s + p[1], 0);
    h = `<div class="hero"><small>家庭淨資產</small><div class="big num ${m.net < 0 ? 'neg' : ''}">${money(m.net)}</div>
      <div class="bar">${tot ? pos.map(p => `<span style="width:${p[1] / tot * 100}%;background:${p[2]}"></span>`).join('') : ''}</div>
      <div class="legend">${pos.map(p => `<span><i style="background:${p[2]}"></i>${p[0]} ${tot ? (p[1] / tot * 100).toFixed(1) : '0.0'}%</span>`).join('')}</div></div>
      <div class="pad">${remHtml}<div class="card">${[['銀行存款總額', m.bank], ['外幣資產總額（折合台幣）', m.fx], ['股票及 ETF 資產', m.sec], ['其他資產', m.other]].map(([a, b]) => `<div class="row"><span>${a}</span><span class="v num">${money(b)}</span></div>`).join('')}
      <div class="row"><span><b>資產合計</b></span><span class="v num">${money(m.assets)}</span></div></div>
      <h2>負債</h2><div class="card"><div class="row"><span>信用卡未繳金額</span><span class="v num neg">${money(m.card)}</span></div><div class="row"><span>貸款總額</span><span class="v num neg">${money(m.loans)}</span></div></div>
      <p class="note">匯率為你自行輸入的數值，請到「設定」更新。</p></div>`;
  } else if (tab === 'acc') {
    h = `<div class="top">銀行及現金帳戶</div><div class="pad">${list('accounts', S.accounts, a => item([a.bank, a.name].filter(Boolean).join(' '), `更新 ${a.upd || '-'}`, fmt(a.bal, a.cur) + (a.rate != null ? `<div class="s">活存利率 ${a.rate}%</div>` : '') + (a.cur !== 'TWD' ? `<div class="s">≈ ${money(toTWD(a.bal, a.cur, r))}</div>` : ''), a.bal < 0))}</div>`;
    fab = 'accounts';
  } else if (tab === 'card') {
    h = `<div class="top">信用卡</div><div class="pad"><div class="card"><div class="row"><span>未繳合計</span><span class="v num neg">${money(m.card)}</span></div></div><h2>卡片</h2>
      ${list('cards', S.cards, c => item(`${c.bank}　${c.name}`, `繳款截止 ${c.due || '-'}`, `${money(+c.amt)}<div><span class="chip ${c.paid ? '' : 'warn'}">${c.paid ? '已繳款' : '未繳款'}</span></div>`))}</div>`;
    fab = 'cards';
  } else if (tab === 'asset') {
    h = `<div class="top">資產與負債</div><div class="pad"><h2>資產</h2>${list('assets', S.assets, a => item(a.name, `${a.type}　更新 ${a.upd || '-'}`, fmt(a.val, a.cur) + (a.cur !== 'TWD' ? `<div class="s">≈ ${money(toTWD(a.val, a.cur, r))}</div>` : '')))}
      <button class="btn alt" data-add="assets">新增資產</button><h2>負債</h2>${list('debts', S.debts, d => item(d.name, [d.type, d.day && `每月 ${d.day} 日`, d.rate != null && `利率 ${d.rate}%`, d.years != null && `${d.years} 年`].filter(Boolean).join('・'), debtV(d), true))}<button class="btn alt" data-add="debts">新增負債</button></div>`;
  } else {
    h = `<div class="top">設定</div><div class="pad"><h2>匯率（1 單位外幣 = 多少新台幣）</h2><div class="card" style="padding:4px 16px 16px"><div class="rates">
      ${CURS.filter(c => c !== 'TWD').map(c => `<div><label>${c}</label><input data-rate="${c}" inputmode="decimal" value="${r[c]}"></div>`).join('')}</div></div>
      <h2>加密備份</h2><button class="btn" id="exp">匯出加密備份</button><button class="btn alt" id="imp">從備份檔還原</button><input type="file" id="file" accept=".json,application/json" hidden>
      <h2>安全</h2><button class="btn alt" id="chpw">變更主密碼</button><button class="btn alt" id="lock">立即上鎖</button><button class="btn del" id="wipe">清除本機所有資料</button>
      <p class="note">資料只存在本機並以 AES-256-GCM 加密；本程式不連線任何伺服器。清除 Safari 網站資料會刪除所有內容，請定期匯出備份。</p></div>`;
  }
  $('app').innerHTML = h + (fab ? `<button class="fab" data-add="${fab}">＋ 新增</button>` : '');
  if (tab === 'set') bindSettings();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-edit],[data-add]'); if (!t || !S) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); scrollTo(0, 0); }
  else if (t.dataset.add) openForm(t.dataset.add);
  else { const [s, id] = t.dataset.edit.split(':'); openForm(s, S[s].find(x => x.id === id)); }
});

/* ---------- 設定頁 ---------- */
function bindSettings() {
  document.querySelectorAll('[data-rate]').forEach(i => i.onchange = async () => {
    const x = parseFloat(i.value); if (!(x > 0)) { i.value = S.rates[i.dataset.rate]; return toast('匯率必須大於 0'); }
    S.rates[i.dataset.rate] = x; await save(); toast('匯率已更新'); });
  $('lock').onclick = () => lockScreen(false);
  $('exp').onclick = () => pwSheet('匯出加密備份', '設定「備份密碼」。它可以和主密碼不同，且不會存進備份檔。請務必記住。', true, async pw => {
    const text = await makeBackup(S, pw), name = `MyFinance-backup-${today().replace(/-/g, '')}.json`;
    const file = new File([text], name, {type: 'application/json'});
    if (navigator.canShare?.({files: [file]})) { try { await navigator.share({files: [file]}); toast('請選「儲存到檔案」'); } catch (e) { if (e.name !== 'AbortError') throw e; } }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('備份已下載'); }
    closeSheet(); });
  $('imp').onclick = () => $('file').click();
  $('file').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const text = await f.text();
    pwSheet('還原備份', '⚠ 還原會「覆蓋」目前所有資料。輸入備份密碼後才會開始，密碼錯誤不會改動現有資料。', false, async pw => {
      let d; try { d = await readBackup(text, pw); } catch (er) { throw new Error(er.message === 'FORMAT' ? '這不是 MyFinance 備份檔' : '備份密碼錯誤，原有資料未變動'); }
      if (!confirm('資料將被備份內容覆蓋，確定還原？')) return;
      S = d; await save(); closeSheet(); render(); toast('還原完成'); }); };
  $('chpw').onclick = () => pwSheet('變更主密碼', '輸入新的主密碼。', true, async pw => {
    const salt = rand(16); KEY = await deriveKey(pw, salt); await dbPutMany({meta: {salt: b64(salt), iter: ITER}, vault: await seal(KEY, S)}); closeSheet(); toast('主密碼已變更'); });
  $('wipe').onclick = async () => { if (confirm('將永久刪除本機所有財務資料，確定？') && confirm('再次確認：沒有備份就無法復原。')) { await dbClear(); lockScreen(true); } };
}
function pwSheet(title, msg, confirmPw, run) {
  sheet(`<h3>${title}</h3><div class="note" style="margin:0">${msg}</div><label>密碼</label><input id="p1" type="password" autocomplete="off">
    ${confirmPw ? '<label>再輸入一次</label><input id="p2" type="password" autocomplete="off">' : ''}<div class="err" id="err" style="color:var(--red)"></div>
    <button class="btn" id="ok">確定</button><button class="btn alt" id="x">取消</button>`, el => {
    el.querySelector('#ok').onclick = async () => { const b = el.querySelector('#ok'), err = el.querySelector('#err'); err.textContent = '';
      const p = el.querySelector('#p1').value;
      if (confirmPw && p.length < MIN_PW) return err.textContent = `密碼至少 ${MIN_PW} 個字元`;
      if (confirmPw && p !== el.querySelector('#p2').value) return err.textContent = '兩次輸入的密碼不一致';
      if (!p) return err.textContent = '請輸入密碼';
      b.disabled = true; b.textContent = '處理中…';
      try { await run(p); } catch (e) { err.textContent = e.message; } b.disabled = false; b.textContent = '確定'; }; });
}

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
boot();
