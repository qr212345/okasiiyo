/****************************************************************
 *  ババ抜き大会管理 – Supabase ＋ GoogleDrive(バックアップ)版   *
 *  コード全体に #1 – #13 の機能ブロック番号をコメントで明示      *
 ****************************************************************/
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

/*================================================================
 #1  Supabase 初期化
================================================================*/
const SUPABASE_URL = "https://esddtjbpcisqhfdapgpx.supabase.co";      // ←自分の URL
const SUPABASE_KEY = "YOUR_ANON_KEY_HERE";                            // ←anon key
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* 予備バックアップ先 (Google Apps Script WebApps) */
const GAS_ENDPOINT = "https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec";

/*================================================================
 アプリ共通設定
================================================================*/
const SCAN_COOLDOWN_MS = 1500;
const POLL_INTERVAL_MS = 20_000;

/*================================================================
 #2  ローカル状態
================================================================*/
let seatMap    = {};        // { table01 : [player01,…] }
let playerData = {};        // { player01: { rate:50,… } }
let actionHistory = [];     // ★NEW  Undo用

/*================================================================
 QR 関連の一時状態
================================================================*/
let qrReader, qrActive = false;
let lastText = "", lastScan = 0;

/*================================================================
 #3  QR 処理
================================================================*/
function onScan(text){
  const now = Date.now();
  if(text === lastText && now - lastScan < SCAN_COOLDOWN_MS) return;
  lastText = text; lastScan = now;

  if(text.startsWith("table")){
    seatMap[text] ??= [];
    message(`✅ 座席セット: ${text}`);
    currentSeatId = text;                        // ★NEW
  }else if(text.startsWith("player")){
    if(!currentSeatId){ message("⚠ 先に座席QR!"); return; }
    if(seatMap[currentSeatId].includes(text)){ message("⚠ 登録済み"); return; }

    seatMap[currentSeatId].push(text);
    playerData[text] ??= { nickname:text, rate:50, last_rank:null, bonus:0, title:null };
    actionHistory.push({ type:"add", seat:currentSeatId, pid:text });   // ★NEW
    renderSeats();
    message(`✅ ${text} 追加`);
  }
}

/*================================================================
 #4  カメラ起動
================================================================*/
export function initCamera(){
  if(qrActive) return;
  qrReader ??= new Html5Qrcode("reader");
  qrReader.start({ facingMode:"environment" }, { fps:10, qrbox:250 }, onScan)
          .then(()=> qrActive=true)
          .catch(()=> message("❌ カメラ起動失敗"));
}

/*================================================================
 #5  座席表示
================================================================*/
function renderSeats(){
  const root = document.getElementById("seatList"); if(!root) return;
  root.innerHTML = "";
  for(const seat in seatMap){
    const div = document.createElement("div");
    div.className = "seat-block";
    div.innerHTML =
      `<h3>${seat}<span class="remove-button" onclick="window.removeSeat('${seat}')">✖</span></h3>`;
    seatMap[seat].forEach(pid=>{
      const p = playerData[pid] || {};
      div.insertAdjacentHTML("beforeend",`
        <div class="player-entry">
          <span>${pid} (rate:${p.rate??50}) ${p.title??""}</span>
          <span class="remove-button" onclick="window.removePlayer('${seat}','${pid}')">✖</span>
        </div>`);
    });
    root.appendChild(div);
  }
}

// --- 削除 + Undo 登録 ---------------------------------------- //
window.removePlayer = (seat,pid)=>{
  const idx = seatMap[seat].indexOf(pid);
  if(idx>-1){
    seatMap[seat].splice(idx,1);
    actionHistory.push({ type:"delPlayer", seat, pid, idx });
    renderSeats();
  }
};
window.removeSeat = seat =>{
  if(confirm(`${seat} を丸ごと削除?`)){
    actionHistory.push({ type:"delSeat", seat, players:[...seatMap[seat]] });
    delete seatMap[seat];
    renderSeats();
  }
};

/*================================================================
 #6  Undo
================================================================*/
window.undoAction = ()=>{
  const act = actionHistory.pop();
  if(!act){ message("操作履歴なし"); return; }
  switch(act.type){
    case "add":
      seatMap[act.seat] = seatMap[act.seat].filter(x=>x!==act.pid); break;
    case "delPlayer":
      seatMap[act.seat].splice(act.idx,0,act.pid); break;
    case "delSeat":
      seatMap[act.seat] = act.players; break;
  }
  renderSeats(); message("↩ Undo");
};

/*================================================================
 #7  ランキング UI（簡易版）
================================================================*/
let currentSeatId=null;
function makeListDraggable(ul){      // Drag & Drop ヘルパ
  let dragging=null;
  ul.querySelectorAll("li").forEach(li=>{
    li.draggable=true;
    li.ondragstart = ()=>{dragging=li; li.classList.add("dragging");};
    li.ondragend   = ()=>{dragging=null; li.classList.remove("dragging");};
    li.ondragover  = e=>{
      e.preventDefault();
      const tgt=e.target;
      if(tgt && tgt!==dragging && tgt.nodeName==="LI"){
        const r=tgt.getBoundingClientRect();
        tgt.parentNode.insertBefore(dragging,(e.clientY-r.top)>r.height/2 ? tgt.nextSibling : tgt);
      }
    };
  });
}

window.openRanking = ()=>{                   // ボタンで呼び出し
  const seat = prompt("順位登録したい座席コードを入力");    // ←簡易
  if(!seat || !seatMap[seat]){ message("座席なし"); return; }
  currentSeatId = seat;
  const listUl = document.getElementById("rankList");
  listUl.innerHTML="";
  seatMap[seat].forEach(pid=>{
    const li=document.createElement("li");
    li.textContent=pid; listUl.appendChild(li);
  });
  makeListDraggable(listUl);
  document.getElementById("rankingPane").style.display="block";
};

window.confirmRanking = ()=>{                // #7 順位確定
  const order = [...document.querySelectorAll("#rankList li")].map(li=>li.textContent);
  calculateRate(order);                      // #8 呼び出し
  document.getElementById("rankingPane").style.display="none";
  renderSeats(); saveGame();
  message("✅ 順位確定");
};

/*================================================================
 #8  レート計算
================================================================*/
function getTopRatedPlayerId(){
  let r=-Infinity,id=null;
  for(const [k,v] of Object.entries(playerData)){ if(v.rate>r){r=v.rate; id=k;} }
  return id;
}
function assignTitles(){
  Object.values(playerData).forEach(p=>p.title=null);
  Object.entries(playerData).sort((a,b)=>b[1].rate-a[1].rate).slice(0,3)
         .forEach(([pid],i)=> playerData[pid].title=["👑","🥈","🥉"][i]);
}

function calculateRate(ranked){
  ranked.forEach((pid,i)=>{
    const p=playerData[pid];
    const prev=p.last_rank ?? ranked.length;
    let diff=prev-(i+1);
    let pt=diff*2;
    if(prev===1 && i===ranked.length-1) pt=-8;
    if(prev===ranked.length && i===0)   pt= 8;
    if(p.rate>=80) pt=Math.floor(pt*0.8);
    const top=getTopRatedPlayerId();
    if(top && p.rate<=playerData[top].rate && i+1<(playerData[top].last_rank??ranked.length)) pt+=2;

    p.bonus=pt; p.rate=Math.max(30,p.rate+pt); p.last_rank=i+1;
  });
  assignTitles();
}

/*================================================================
 #9  Supabase CRUD — “players” 行単位（任意）
================================================================*/
async function upsertPlayersToTable(){        // 任意で呼ぶ
  const rows = Object.entries(playerData).map(([id,p])=>({ id, ...p }));
  const { error } = await supabase.from("players").upsert(rows);
  if(error) console.error(error);
}

/*================================================================
 #10 Drive ←→ Supabase 同期（復元）
================================================================*/
async function restoreFromDrive(){
  const r = await fetch(GAS_ENDPOINT,{cache:"no-store"});
  if(!r.ok) throw new Error("Drive読込失敗");
  const d = await r.json();
  seatMap=d.seatMap||{}; playerData=d.playerData||{};
  await saveGame();                    // Supabaseへ反映
  renderSeats(); message("✅ Drive復元");
}

/*================================================================
 #11 CSV 書出し（詳細）
================================================================*/
window.saveFullCSV = ()=>{
  const rows=[["ID","Nickname","Rate","PrevRank","Bonus","Title"]];
  for(const id in playerData){
    const p=playerData[id];
    rows.push([id,p.nickname??"",p.rate,p.last_rank??"",p.bonus??0,p.title??""]);
  }
  const blob=new Blob([rows.map(r=>r.join(",")).join("\n")],{type:"text/csv"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download="babanuki_players.csv"; a.click();
};

/*================================================================
 #12 ボタンバインド（Undo / Refresh / Store 追加）
================================================================*/
function bindButtons(){
  document.getElementById("btnUndo")  ?.addEventListener("click",undoAction);
  document.getElementById("btnSave")  ?.addEventListener("click",async()=>{try{await saveGame();message("✅ 保存");}catch(e){message("❌");}});
  document.getElementById("btnLoad")  ?.addEventListener("click",async()=>{const d=await loadGame();seatMap=d.seatMap;playerData=d.playerData;renderSeats();});
  document.getElementById("btnBackup")?.addEventListener("click",backupToDrive);
  document.getElementById("btnRestore")?.addEventListener("click",restoreFromDrive);
  document.getElementById("btnCSV")   ?.addEventListener("click",saveFullCSV);
  document.getElementById("btnRank")  ?.addEventListener("click",openRanking);
}

/*================================================================
 #13 初期化
================================================================*/
window.addEventListener("DOMContentLoaded",async()=>{
  try{
    const d = await loadGame();
    seatMap=d.seatMap; playerData=d.playerData;
    message("✅ Supabase読込完了");
  }catch{ message("⚠ データなし 新規"); }
  initCamera(); renderSeats(); bindButtons();

  // Live Poll
  setInterval(async()=>{
    try{
      const d=await loadGame();
      if(JSON.stringify(d.seatMap)!==JSON.stringify(seatMap)||
         JSON.stringify(d.playerData)!==JSON.stringify(playerData)){
        seatMap=d.seatMap; playerData=d.playerData; renderSeats();
        message("☁ 更新を反映");
      }
    }catch{}
  },POLL_INTERVAL_MS);
});

/*================================================================
 共通ユーティリティ
================================================================*/
function message(t){ const m=document.getElementById("messageArea"); if(m){m.textContent=t; setTimeout(()=>m.textContent="",3000);} }
