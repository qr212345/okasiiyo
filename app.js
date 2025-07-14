import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

/* --- #1 Supabase 初期化 --- */
const SUPABASE_URL = "https://esddtjbpcisqhfdapgpx.supabase.co";
const SUPABASE_KEY = "YOUR_ANON_KEY_HERE";
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const GAS_ENDPOINT = "https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec";

const SCAN_COOLDOWN_MS = 1500;
const POLL_INTERVAL_MS = 20000;

let seatMap = {};
let playerData = {};
let actionHistory = [];

let qrReaderScan, qrReaderRanking;
let qrActiveScan = false;
let qrActiveRanking = false;

let lastText = "";
let lastScan = 0;

let currentSeatId = null;

/* #3 QRコードスキャン (通常登録用) */
function onScan(text) {
  const now = Date.now();
  if(text === lastText && now - lastScan < SCAN_COOLDOWN_MS) return;
  lastText = text; lastScan = now;

  if(text.startsWith("table")) {
    seatMap[text] ??= [];
    currentSeatId = text;
    message(`✅ 座席セット: ${text}`);
    renderSeats();
  } else if(text.startsWith("player")) {
    if(!currentSeatId) { message("⚠ 先に座席QRを読み込んでください"); return; }
    if(seatMap[currentSeatId].includes(text)) { message("⚠ 登録済みのプレイヤーです"); return; }
    seatMap[currentSeatId].push(text);
    playerData[text] ??= { nickname:text, rate:50, last_rank:null, bonus:0, title:null };
    actionHistory.push({ type:"add", seat:currentSeatId, pid:text });
    renderSeats();
    message(`✅ プレイヤー追加: ${text}`);
  }
}

/* #4 カメラ起動（スキャン用） */
export function initCamera(){
  if(qrActiveScan) return;
  qrReaderScan ??= new Html5Qrcode("reader");
  qrReaderScan.start({ facingMode:"environment" }, { fps:10, qrbox:250 }, onScan)
    .then(() => qrActiveScan = true)
    .catch(() => message("❌ カメラ起動失敗"));
}

/* #5 座席・プレイヤー表示 */
function renderSeats() {
  const root = document.getElementById("seatList");
  if(!root) return;
  root.innerHTML = "";
  for(const seat in seatMap){
    const div = document.createElement("div");
    div.className = "seat-block";
    div.innerHTML = `<h3>${seat} <span class="remove-button" onclick="window.removeSeat('${seat}')">✖</span></h3>`;
    seatMap[seat].forEach(pid => {
      const p = playerData[pid] || {};
      div.insertAdjacentHTML("beforeend", `
        <div class="player-entry">
          <span>${pid} (rate:${p.rate ?? 50}) ${p.title ?? ""}</span>
          <span class="remove-button" onclick="window.removePlayer('${seat}','${pid}')">✖</span>
        </div>`);
    });
    root.appendChild(div);
  }
}

/* 削除系 */
window.removePlayer = (seat,pid) => {
  const idx = seatMap[seat]?.indexOf(pid);
  if(idx >= 0){
    seatMap[seat].splice(idx, 1);
    actionHistory.push({ type:"delPlayer", seat, pid, idx });
    renderSeats();
  }
};
window.removeSeat = seat => {
  if(confirm(`${seat} を丸ごと削除しますか？`)){
    actionHistory.push({ type:"delSeat", seat, players:[...seatMap[seat]] });
    delete seatMap[seat];
    renderSeats();
  }
};

/* #6 Undo */
window.undoAction = () => {
  const act = actionHistory.pop();
  if(!act){ message("操作履歴なし"); return; }
  switch(act.type){
    case "add":
      seatMap[act.seat] = seatMap[act.seat].filter(x => x !== act.pid);
      break;
    case "delPlayer":
      seatMap[act.seat].splice(act.idx, 0, act.pid);
      break;
    case "delSeat":
      seatMap[act.seat] = act.players;
      break;
  }
  renderSeats();
  message("↩ Undoしました");
};

/* #7 順位登録用QRコード読み取り */
function onRankingScan(text){
  if(!text.startsWith("table")){
    message("順位登録は座席コードのみ読み込み");
    return;
  }
  if(!seatMap[text]){
    message("未登録の座席です");
    return;
  }
  currentSeatId = text;
  // 順位登録リスト初期化
  const rankingList = document.getElementById("rankingList");
  rankingList.innerHTML = "";
  seatMap[text].forEach(pid => {
    const li = document.createElement("li");
    li.textContent = pid;
    rankingList.appendChild(li);
  });
  makeListDraggable(rankingList);
  message(`✅ ${text} の順位登録モード`);
}

/* カメラ起動（順位登録用） */
function initRankingCamera(){
  if(qrActiveRanking) return;
  qrReaderRanking ??= new Html5Qrcode("rankingReader");
  qrReaderRanking.start({ facingMode:"environment" }, { fps:10, qrbox:250 }, onRankingScan)
    .then(() => qrActiveRanking = true)
    .catch(() => message("❌ 順位登録カメラ起動失敗"));
}

/* 順位ドラッグ＆ドロップサポート */
function makeListDraggable(ul){
  let dragging = null;
  ul.querySelectorAll("li").forEach(li=>{
    li.draggable = true;
    li.ondragstart = () => { dragging = li; li.classList.add("dragging"); };
    li.ondragend = () => { dragging = null; li.classList.remove("dragging"); };
    li.ondragover = e => {
      e.preventDefault();
      const tgt = e.target;
      if(tgt && tgt !== dragging && tgt.nodeName === "LI"){
        const r = tgt.getBoundingClientRect();
        tgt.parentNode.insertBefore(dragging, (e.clientY - r.top) > r.height / 2 ? tgt.nextSibling : tgt);
      }
    };
  });
}

/* #8 レート計算 */
function getTopRatedPlayerId(){
  let maxRate = -Infinity, maxId = null;
  for(const [id, p] of Object.entries(playerData)){
    if(p.rate > maxRate){
      maxRate = p.rate; maxId = id;
    }
  }
  return maxId;
}

function assignTitles(){
  Object.values(playerData).forEach(p => p.title = null);
  Object.entries(playerData)
    .sort((a,b) => b[1].rate - a[1].rate)
    .slice(0,3)
    .forEach(([pid], i) => playerData[pid].title = ["👑","🥈","🥉"][i]);
}

function calculateRate(ranked){
  ranked.forEach((pid, i) => {
    const p = playerData[pid];
    const prev = p.last_rank ?? ranked.length;
    let diff = prev - (i + 1);
    let pt = diff * 2;
    if(prev === 1 && i === ranked.length - 1) pt = -8;
    if(prev === ranked.length && i === 0) pt = 8;
    if(p.rate >= 80) pt = Math.floor(pt * 0.8);
    const top = getTopRatedPlayerId();
    if(top && p.rate <= playerData[top].rate && i + 1 < (playerData[top].last_rank ?? ranked.length)) pt += 2;
    p.bonus = pt;
    p.rate = Math.max(30, p.rate + pt);
    p.last_rank = i + 1;
  });
  assignTitles();
}

/* 順位確定ボタン */
window.confirmRanking = () => {
  const order = [...document.querySelectorAll("#rankingList li")].map(li => li.textContent);
  calculateRate(order);
  renderSeats();
  saveGame();  // Supabase 保存
  message("✅ 順位確定しました");
  // 順位登録UI非表示
  document.getElementById("rankingSection").style.display = "none";
  // スキャン画面表示
  document.getElementById("scanSection").style.display = "block";
  // 順位登録カメラ停止
  if(qrReaderRanking && qrActiveRanking) {
    qrReaderRanking.stop();
    qrActiveRanking = false;
  }
  // スキャンカメラ起動
  initCamera();
};

/* #9 Supabase保存 (例) */
async function saveGame(){
  // supabaseにseatMapとplayerData保存
  const { error } = await supabase.from("game_data").upsert([{ id: "singleton", seatMap, playerData }]);
  if(error) throw error;
}

/* #10 Drive復元 */
async function loadGame(){
  const r = await fetch(GAS_ENDPOINT, {cache: "no-store"});
  if(!r.ok) throw new Error("Driveから読み込み失敗");
  const d = await r.json();
  return d;
}

/* #11 CSV保存 */
window.saveFullCSV = () => {
  const rows = [["ID","Nickname","Rate","PrevRank","Bonus","Title"]];
  for(const id in playerData){
    const p = playerData[id];
    rows.push([id, p.nickname ?? "", p.rate, p.last_rank ?? "", p.bonus ?? 0, p.title ?? ""]);
  }
  const blob = new Blob([rows.map(r => r.join(",")).join("\n")], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "babanuki_players.csv";
  a.click();
};

/* #12 ボタンバインド */
function bindButtons(){
  document.getElementById("btnSave").addEventListener("click", async () => {
    try {
      await saveGame();
      message("✅ Supabaseに保存しました");
    } catch(e) {
      message("❌ 保存失敗");
    }
  });
  document.getElementById("btnLoad").addEventListener("click", async () => {
    try {
      const d = await loadGame();
      seatMap = d.seatMap ?? {};
      playerData = d.playerData ?? {};
      renderSeats();
      message("✅ Driveから復元しました");
    } catch {
      message("❌ Driveから復元失敗");
    }
  });
  // UndoボタンはHTMLでonclickで呼ばれるのでここでは不要
  // CSV保存は window.saveFullCSV() で連動済み
}

/* #13 初期化 */
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const d = await loadGame();
    seatMap = d.seatMap ?? {};
    playerData = d.playerData ?? {};
    message("✅ データ読み込み成功");
  } catch {
    message("⚠ 新規データ");
  }
  initCamera();
  renderSeats();
  bindButtons();
});

function message(t){ const m=document.getElementById("messageArea"); if(m){m.textContent=t; setTimeout(()=>m.textContent="",3000);} }
