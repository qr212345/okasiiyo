/* tiny SDK – ESM */
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbySlkjBYNpG8NAbOBXPMO4BbQGwA7RjRdR-i5fv-SffnV1ngpiLVkSYSOizx7z_YDiE/exec';
const SECRET   = 'kosen-brain-super-secret';                       // 同じ鍵

export async function loadJson() {
  const r = await fetch(`${ENDPOINT}?action=get`, { cache:'no-store' });
  const j = await r.json();
  if (j.error) throw j.error;
  return j;                                         // {rev,data,sig}
}

export async function saveJson(nextData, baseRev, sig, retry = 3) {
  try {
    const body = { data: nextData, rev: baseRev, sig };
    const r = await fetch(ENDPOINT, {
      method : 'POST',
      headers: { 'Content-Type':'application/json' },
      body   : JSON.stringify(body)
    });
    const j = await r.json();
    if (j.error) throw j.error;
    return j;                                       // 新しい rev
  } catch (e) {
    if (e === 'conflict' && retry) {                // 衝突 → リロード後に再送
      await delay(200 * (4 - retry));               // 指数バックオフ
      const latest = await loadJson();
      return saveJson(nextData, latest.rev, latest.sig, retry - 1);
    }
    throw e;
  }
}

/* === 署名関数 (ブラウザ側) === */
export async function makeSig(data) {
  const enc = new TextEncoder().encode(JSON.stringify(data));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/* 小さなユーティリティ */
const delay = ms => new Promise(res => setTimeout(res, ms));
