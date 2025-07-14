/* ------------------------------------------------------
 *  Babanki Manager – Google Drive + GAS Backup Only
 * ---------------------------------------------------- */

/* 固定 UUID 1 行保存 */
const FIXED_ID = "00000000-0000-0000-0000-000000000001";

/* Google Apps Script WebApp URL（デプロイ URL を貼る） */
const GAS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbwNOprh0wPgeq9Ln911oyW1trYqjZPPjotdorA6PUdceF4-t2t-yTrblvg5UD-9_So/exec";  // ★実 URL

/* === アプリ定数 ========================================== */
const SCAN_COOLDOWN_MS = 1500;

/* === ローカル状態 ========================================= */
let seatMap = {};          // { table01 : [...] }
let playerData = {};       // { player01 : {...} }
let actionHistory = [];    // Undo 用

/* === QR / カメラ状態 ====================================== */
let qrReaderScan, qrReaderRanking;
let qrActiveScan = false, qrActiveRanking = false;
let lastText = "", lastScan = 0;
let currentSeatId = null;

/* ====== ユーティリティ =================================== */
const $ = id => document.getElementById(id);
const message = txt => { const m=$("messageArea"); if(m){m.textContent=txt; setTimeout(()=>m.textContent="",3000);} };

/* === #3  QRスキャン（登録用） ============================= */
function onScan(text){
  const now = Date.now();
  if(text === lastText && now-lastScan < SCAN_COOLDOWN_MS) return;
  lastText = text; lastScan = now;

  if(text.startsWith("table")){
    seatMap[text] ??= [];
    currentSeatId = text;
    message(`✅ 座席セット: ${text}`);
  }else if(text.startsWith("player")){
    if(!currentSeatId) return message("⚠ 先に座席QRを");
    if(seatMap[currentSeatId].includes(text)) return message("⚠ 既に登録済み");
    seatMap[currentSeatId].push(text);
    playerData[text] ??= { nickname:text, rate:50, last_rank:null, bonus:0, title:null };
    actionHistory.push({type:"add", seat:currentSeatId, pid:text});
    message(`✅ 追加: ${text}`);
  }
  renderSeats();
}

/* === #4  カメラ起動 ======================================= */
function initCamera(){
  if(qrActiveScan) return;
  qrReaderScan ??= new Html5Qrcode("reader");
  qrReaderScan.start({facingMode:"environment"},{fps:10,qrbox:250},onScan)
              .then(()=>qrActiveScan=true)
              .catch(()=>message("❌ カメラ起動失敗"));
}

/* === #5  座席描画 ======================================== */
function renderSeats(){
  const root = $("seatList"); if(!root) return;
  root.innerHTML = "";
  Object.keys(seatMap).forEach(seat=>{
    const div=document.createElement("div");
    div.className="seat-block";
    div.innerHTML=`<h3>${seat}<span class="remove-button" onclick="window.removeSeat('${seat}')">✖</span></h3>`;
    seatMap[seat].forEach(pid=>{
      const p=playerData[pid]||{};
      div.insertAdjacentHTML("beforeend",`
        <div class="player-entry">
          <span>${pid} (rate:${p.rate}) ${p.title??""}</span>
          <span class="remove-button" onclick="window.removePlayer('${seat}','${pid}')">✖</span>
        </div>`);
    });
    root.appendChild(div);
  });
}

/* === #6  Undo / 削除 ===================================== */
window.removePlayer=(seat,pid)=>{
  const i=seatMap[seat].indexOf(pid);
  if(i>-1){ seatMap[seat].splice(i,1); actionHistory.push({type:"delPlayer",seat,pid,idx:i}); renderSeats();}
};
window.removeSeat = seat=>{
  if(confirm("丸ごと削除？")){
    actionHistory.push({type:"delSeat",seat,players:[...seatMap[seat]]});
    delete seatMap[seat]; renderSeats();
  }
};
window.undoAction = ()=>{
  const act=actionHistory.pop(); if(!act) return message("履歴なし");
  if(act.type==="add") seatMap[act.seat]=seatMap[act.seat].filter(x=>x!==act.pid);
  if(act.type==="delPlayer") seatMap[act.seat].splice(act.idx,0,act.pid);
  if(act.type==="delSeat") seatMap[act.seat]=act.players;
  renderSeats(); message("↩ 戻しました");
};

/* === #7  順位登録カメラ & UI ============================== */
function onRankingScan(text) {
  if (!text.startsWith("table")) {
    message("順位登録は座席コードのみ読み込み");
    return;
  }
  if (!seatMap[text]) {
    message("未登録の座席です");
    return;
  }

  currentSeatId = text;

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

/* === #8  レート計算 ====================================== */
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
  saveGame();  // GAS 保存
  message("✅ 順位確定しました");
  // 順位登録UI非表示
  $("rankingSection").style.display = "none";
  // スキャン画面表示
  $("scanSection").style.display = "block";
  // 順位登録カメラ停止
  if(qrReaderRanking && qrActiveRanking) {
    qrReaderRanking.stop();
    qrActiveRanking = false;
  }
  // スキャンカメラ起動
  initCamera();
};

/* === #9, #10 保存と読込（Google Apps Script 経由） ======= */
async function saveGame() {
  await fetch(GAS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seatMap, playerData })
  }).catch(e => message("❌ Drive保存失敗:" + e.message));
}

async function loadGame() {
  try {
    const r = await fetch(GAS_ENDPOINT, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    seatMap = d.seatMap ?? {};
    playerData = d.playerData ?? {};
  } catch (e) {
    message("❌ Drive読込失敗:" + e.message);
    seatMap = {};
    playerData = {};
  }
}

/* === #11  CSV 出力 ======================================== */
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

/* === #12  ボタン紐付け =================================== */
function bindButtons(){
  $("btnSave")?.addEventListener("click", async () => {
    await saveGame();
    message("☁ 保存完了");
  });
  $("btnLoad")?.addEventListener("click", async () => {
    await loadGame();
    renderSeats();
    message("☁ 読込完了");
  });
}

/* === #13  初期ロード ===================================== */
window.addEventListener("DOMContentLoaded", async () => {
  await loadGame();
  renderSeats();
  bindButtons();
  initCamera();
});

/* === 画面切替・外部遷移 ================================== */
window.navigate = mode => {
  $("scanSection").style.display = mode === "scan" ? "block" : "none";
  $("rankingSection").style.display = mode === "ranking" ? "block" : "none";
  if (mode === "scan") {
    if (qrActiveRanking) { qrReaderRanking.stop(); qrActiveRanking = false; }
    initCamera();
  }
  if (mode === "ranking") {
    if (qrActiveScan) { qrReaderScan.stop(); qrActiveScan = false; }
    initRankingCamera();
  }
};
window.navigateToExternal = url => window.open(url, "_blank");
