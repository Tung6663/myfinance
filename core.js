// MyFinance 核心：加密、備份、計算（瀏覽器與 Node 共用，不含任何網路功能）
const enc = new TextEncoder(), dec = new TextDecoder();
export const ITER = 600000;
export const CURS = ['TWD','USD','JPY'];   // 介面僅提供這三種；舊資料中的其他幣別仍可正常換算
export const DEFAULT_RATES = {TWD:1,USD:32,JPY:0.21,EUR:35,CNY:4.4,HKD:4.1,GBP:41,AUD:21,CAD:23,CHF:38,SGD:24};
export const b64 = u => { let s=''; for (const x of new Uint8Array(u)) s+=String.fromCharCode(x); return btoa(s); };
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const rand = n => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(pw, salt, iter = ITER) {
  const m = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations:iter}, m,
    {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
export async function seal(key, obj) {            // 每次加密使用全新隨機 IV
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(JSON.stringify(obj)));
  return {iv:b64(iv), ct:b64(ct)};
}
export async function unseal(key, {iv, ct}) {
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(iv)}, key, unb64(ct));
  return JSON.parse(dec.decode(pt));
}
export const emptyData = () => ({accounts:[], cards:[], assets:[], debts:[], rates:{...DEFAULT_RATES}});
export function normalize(d) {
  const e = emptyData();
  for (const k of ['accounts','cards','assets','debts']) e[k] = Array.isArray(d?.[k]) ? d[k] : [];
  e.rates = {...DEFAULT_RATES, ...(d?.rates||{}), TWD:1};
  return e;
}
// 備份檔：只含 salt / iv / 密文，不含密碼與金鑰
export async function makeBackup(data, pw) {
  const salt = rand(16), key = await deriveKey(pw, salt);
  return JSON.stringify({app:'MyFinance', version:1, kdf:'PBKDF2-SHA256', iter:ITER, cipher:'AES-256-GCM',
    created:new Date().toISOString(), salt:b64(salt), ...await seal(key, data)});
}
export async function readBackup(text, pw) {      // 失敗只丟錯誤，不動任何現有資料
  let j; try { j = JSON.parse(text); } catch { throw new Error('FORMAT'); }
  if (j?.app!=='MyFinance' || !j.ct || !j.iv || !j.salt || !(j.iter>=1e5 && j.iter<=5e6)) throw new Error('FORMAT');
  const key = await deriveKey(pw, unb64(j.salt), j.iter);
  try { return normalize(await unseal(key, j)); } catch { throw new Error('PASSWORD'); }
}
// 計算（全部換算成 TWD）
export const toTWD = (v, c, r) => c==='TWD' ? v : v*(r[c]||0);
export function summarize(d) {
  const r = d.rates;
  const val = x => toTWD(+(x.bal ?? x.val) || 0, x.cur, r);
  const bank = d.accounts.filter(a=>a.cur==='TWD').reduce((s,x)=>s+val(x),0);
  const fx = d.accounts.filter(a=>a.cur!=='TWD').reduce((s,x)=>s+val(x),0);
  const sec = d.assets.filter(a=>['股票','ETF'].includes(a.type)).reduce((s,x)=>s+val(x),0);
  const other = d.assets.filter(a=>!['股票','ETF'].includes(a.type)).reduce((s,x)=>s+val(x),0);
  const loans = d.debts.reduce((s,x)=>s+val(x),0);
  const card = d.cards.filter(c=>!c.paid).reduce((s,c)=>s+(+c.amt||0),0);
  return {bank, fx, sec, other, loans, card, assets:bank+fx+sec+other, net:bank+fx+sec+other-loans-card};
}
export const money = n => (n<0?'-':'') + 'NT$ ' + Math.round(Math.abs(n)).toLocaleString('en-US');
// 貸款試算與繳款提醒（純本機計算）
export const daysBetween = (a, b) => Math.round((b - a) / 864e5);
const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
export function loanInfo(d) {   // 每月利息 = 餘額 × 年利率 ÷ 12；剩餘期數 = 依目前餘額、利率、每月還款額估算
  const B = +d.val, P = +d.pay, out = {};
  if (d.rate != null) out.interest = B * (+d.rate) / 100 / 12;
  if (d.pay != null && P > 0 && B > 0) {
    const r = (+d.rate || 0) / 1200;
    if (r === 0) out.months = Math.ceil(B / P);
    else if (P > B * r) out.months = Math.ceil(-Math.log(1 - r * B / P) / Math.log(1 + r));
    else out.insufficient = true;
  }
  return out;
}
export function nextDue(day, now = new Date()) {   // 下一次「每月 N 日」；月底不足時取該月最後一天
  const y = now.getFullYear(), m = now.getMonth(), t = new Date(y, m, now.getDate());
  const dom = (yy, mm) => Math.min(day, new Date(yy, mm + 1, 0).getDate());
  let c = new Date(y, m, dom(y, m)); if (c < t) c = new Date(y, m + 1, dom(y, m + 1));
  return c;
}
export function reminders(d, now = new Date(), within = 7) {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate()), out = [];
  for (const c of d.cards) { if (c.paid) continue; const dt = ymd(c.due); if (!dt) continue; const days = daysBetween(t, dt);
    if (days <= within) out.push({kind: 'card', name: [c.bank, c.name].filter(Boolean).join(' '), date: dt, days, amt: +c.amt || 0, cur: 'TWD'}); }
  for (const x of d.debts) { if (!x.day) continue; const dt = nextDue(+x.day, t), days = daysBetween(t, dt);
    if (days <= within) out.push({kind: 'debt', name: x.name, date: dt, days, amt: x.pay != null ? +x.pay : null, cur: x.cur}); }
  return out.sort((a, b) => a.days - b.days);
}
