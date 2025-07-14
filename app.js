/**********************
 *  ババ抜き大会管理  *
 **********************/
let qrReader;
/* ======== 定数 ======== */
const ENDPOINT = "https://script.google.com/macros/s/AKfycbyW6Rnjq_3F9QtiOZmuDAh94-WW8FX69SGuq_rOgRZGV0CVZkQgHPG_1MaKoV52F4I/exec";
const FILE_ID = '1YGb-2yW2JTFtB4MqWnbkb9Ut_kNLsv2R';
const SECRET   = "kosen-brain-super-secret";
const SCAN_COOLDOWN_MS = 1500;
const POLL_INTERVAL_MS = 20_000;
/* ======== グローバル状態 ======== */
let currentSeatId   = null;
let seatMap         = {};      // { table01: [player01, …] }
let playerData      = {};      // { playerId: {rate,…} }
let actionHistory   = [];

let qrActive = false;         // ← グローバル保持して二重起動防止
let rankingQrReader = null;

let isRankingMode   = false;
let rankingSeatId   = null;

let lastScanTime    = 0;
let lastScannedText = "";
let msgTimer        = null;

let pollTimer = null;
let isSaving = false;
/* ======== ユーティリティ ======== */
const delay = ms => new Promise(res => setTimeout(res, ms));

function displayMessage(msg) {
  const area = document.getElementById("messageArea");
  if (!area) return;
  area.textContent = msg;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (area.textContent = ""), 3000);
}

/* ======== QR 読み取りコールバック ======== */
function handleScanSuccess(decodedText) {
  const now = Date.now();
  if (decodedText === lastScannedText && now - lastScanTime < SCAN_COOLDOWN_MS) return;
  lastScannedText = decodedText;
  lastScanTime = now;

  if (decodedText.startsWith("table")) {
    currentSeatId = decodedText;
    seatMap[currentSeatId] ??= [];
    displayMessage(`✅ 座席セット: ${currentSeatId}`);
  } else if (decodedText.startsWith("player")) {
    if (!currentSeatId)                  { displayMessage("⚠ 先に座席QRを読み込んでください"); return; }
    if (seatMap[currentSeatId].includes(decodedText)) { displayMessage("⚠ 既に登録済み"); return; }
    if (seatMap[currentSeatId].length >= 6)           { displayMessage("⚠ この座席は6人まで"); return; }

    seatMap[currentSeatId].push(decodedText);
    playerData[decodedText] ??= { nickname: decodedText, rate: 50, lastRank: null, bonus: 0 };
    actionHistory.push({ type: "addPlayer", seatId: currentSeatId, playerId: decodedText });
    displayMessage(`✅ ${decodedText} 追加`);
    saveToLocalStorage();
    renderSeats();
  }

  handleRankingMode(decodedText);
}

/* ======== カメラ起動 ======== */
function initCamera() {
  // 既にスキャン中なら再起動しない
  if (qrActive) {
    console.log("QR リーダーはすでに起動中です");
    return;
  }

  // インスタンス未生成なら作成
  if (!qrReader) qrReader = new Html5Qrcode("reader");

  qrReader.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 250 },
    handleScanSuccess
  ).then(() => {
    qrActive = true;  // 起動成功したらフラグを立てる
  }).catch(err => {
    console.error(err);
    displayMessage("❌ カメラの起動に失敗しました");
  });
}

/* ======== 座席表示 ======== */
function renderSeats() {
  const seatList = document.getElementById("seatList");
  seatList.innerHTML = "";

  Object.keys(seatMap).forEach(seatId => {
    const block = document.createElement("div");
    block.className = "seat-block";

    /* --- 見出し --- */
    const title = document.createElement("h3");
    title.textContent = `座席: ${seatId}`;
    const removeSeat = document.createElement("span");
    removeSeat.textContent = "✖";
    removeSeat.className = "remove-button";
    removeSeat.onclick = () => {
      if (confirm(`座席 ${seatId} を削除しますか？`)) {
        actionHistory.push({ type: "removeSeat", seatId, players: seatMap[seatId] });
        delete seatMap[seatId];
        saveToLocalStorage();
        renderSeats();
      }
    };
    title.appendChild(removeSeat);
    block.appendChild(title);

    /* --- プレイヤー --- */
    seatMap[seatId].forEach(pid => {
      const p = playerData[pid];
      const rc = p.bonus ?? 0;
      block.insertAdjacentHTML("beforeend", `
        <div class="player-entry">
          <div>
            <strong>${pid}</strong>
            ${p.title ? `<span class="title-badge title-${p.title}">${p.title}</span>` : ""}
            <span style="margin-left:10px;color:#888;">Rate: ${p.rate}</span>
            <span class="rate-change ${rc>0?"rate-up":rc<0?"rate-down":"rate-zero"}">
              ${rc>0?"↑":rc<0?"↓":"±"}${Math.abs(rc)}
            </span>
          </div>
          <span class="remove-button" onclick="removePlayer('${seatId}','${pid}')">✖</span>
        </div>
      `);
    });

    seatList.appendChild(block);
  });
}

/* ======== プレイヤー削除・UNDO ======== */
function removePlayer(seatId, playerId) {
  const idx = seatMap[seatId]?.indexOf(playerId);
  if (idx === -1) return;
  seatMap[seatId].splice(idx, 1);
  actionHistory.push({ type: "removePlayer", seatId, playerId, index: idx });
  saveToLocalStorage();
  renderSeats();
}

function undoAction() {
  if (!actionHistory.length) { displayMessage("操作履歴がありません"); return; }
  const last = actionHistory.pop();
  switch (last.type) {
    case "addPlayer":    seatMap[last.seatId] = seatMap[last.seatId].filter(p => p !== last.playerId); break;
    case "removePlayer": seatMap[last.seatId]?.splice(last.index, 0, last.playerId);                   break;
    case "removeSeat":   seatMap[last.seatId] = last.players;                                         break;
  }
  displayMessage("↩ 元に戻しました");
  saveToLocalStorage();
  renderSeats();
}

/* ======== ローカルストレージ ======== */
function saveToLocalStorage() {
  localStorage.setItem("seatMap",    JSON.stringify(seatMap));
  localStorage.setItem("playerData", JSON.stringify(playerData));
}
function loadFromLocalStorage() {
  seatMap    = JSON.parse(localStorage.getItem("seatMap")    || "{}");
  playerData = JSON.parse(localStorage.getItem("playerData") || "{}");
}
/* ======================================================
 *  画面遷移 & 順位登録     ―  “ランキング” サブ画面の実装
 * ==================================================== */

/** サイドバー操作でメイン画面を切り替える */
function navigate(section) {
  // 表示切替
  document.getElementById("scanSection"   ).style.display = section === "scan"    ? "block" : "none";
  document.getElementById("rankingSection").style.display = section === "ranking" ? "block" : "none";

  /* ---- 順位登録モードに入るときだけカメラをもう 1 本起動 ---- */
  if (section === "ranking") {
    isRankingMode  = true;
    rankingSeatId  = null;
    document.getElementById("rankingList").innerHTML = "";
    displayMessage("座席QR を読み込んでください（順位登録モード）");

    if (!rankingQrReader) {
      rankingQrReader = new Html5Qrcode("rankingReader");
      rankingQrReader.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        decodedText => {
          if (decodedText.startsWith("table")) {
            handleRankingMode(decodedText);
            displayMessage(`✅ 座席 ${decodedText} 読み取り成功`);
            // 1 座席読めば十分なので即停止
            rankingQrReader.stop().then(() => {
              rankingQrReader.clear();
              rankingQrReader = null;
            });
          } else {
            displayMessage("⚠ 座席コードのみ読み取り可能です");
          }
        }
      ).catch(err => {
        console.error(err);
        displayMessage("❌ カメラの起動に失敗しました（順位登録）");
       });
    }
  } else {           /* --- “QR スキャン” 画面へ戻る --- */
    isRankingMode = false;
    if (rankingQrReader) {
      rankingQrReader.stop().then(() => {
        rankingQrReader.clear();
        rankingQrReader = null;
      });
    }
    if (!qrActive && section === "scan") initCamera();
  }
}

/** 座席 QR が読み取られたらドラッグ可能な一覧を生成 */
function handleRankingMode(tableCode) {
  if (!isRankingMode) return;
  rankingSeatId = tableCode;

  const list    = document.getElementById("rankingList");
  list.innerHTML = "";
  (seatMap[tableCode] || []).forEach(pid => {
    const li = document.createElement("li");
    li.textContent     = pid;
    li.dataset.playerId = pid;
    list.appendChild(li);
  });

  makeListDraggable(list);
  displayMessage(`座席 ${tableCode} の順位を並び替えてください`);
}

/** HTML5 Drag & Drop で並び替えられる <ul> を作る */
function makeListDraggable(ul) {
  let dragging = null;

  ul.querySelectorAll("li").forEach(li => {
    li.draggable = true;

    li.ondragstart = () => { dragging = li; li.classList.add("dragging"); };
    li.ondragend   = () => { dragging = null; li.classList.remove("dragging"); };

    li.ondragover  = e => {
      e.preventDefault();
      const tgt = e.target;
      if (tgt && tgt !== dragging && tgt.nodeName === "LI") {
        const r   = tgt.getBoundingClientRect();
        const aft = (e.clientY - r.top) > r.height / 2;
        tgt.parentNode.insertBefore(dragging, aft ? tgt.nextSibling : tgt);
      }
    };
  });
}

/** 「順位決定」ボタン */
function confirmRanking() {
  if (!rankingSeatId) return;

  // li 順で ID を抽出
  const ordered = Array.from(document.querySelectorAll("#rankingList li"))
                    .map(li => li.dataset.playerId);

  ordered.forEach((pid, idx) => {
    if (playerData[pid]) playerData[pid].lastRank = idx + 1;
  });

  calculateRate(ordered);
  displayMessage("✅ 順位を保存しました");
  saveToLocalStorage();
}

/* ---------- レート計算まわり ---------- */
function calculateRate(rankedIds) {
  rankedIds.forEach((pid, i) => {
    const p        = playerData[pid];
    const prevRank = p.lastRank ?? rankedIds.length;
    let diff       = prevRank - (i + 1);          // ↑なら正

    // 基本ポイント
    let point = diff * 2;

    // 特殊ルール
    if (prevRank === 1 && i === rankedIds.length - 1) point = -8;
    if (prevRank === rankedIds.length && i === 0)      point =  8;

    // 高レート補正
    if (p.rate >= 80) point = Math.floor(point * 0.8);

    // 王座奪取ボーナス
    const topId = getTopRatedPlayerId();
    if (topId && p.rate <= playerData[topId].rate && i + 1 < playerData[topId].lastRank)
      point += 2;

    p.bonus = point;
    p.rate  = Math.max(30, p.rate + point);
  });

  assignTitles();
}

/** 称号を付与（👑🥈🥉） */
function assignTitles() {
  Object.values(playerData).forEach(p => (p.title = null));      // 一旦クリア
  Object.entries(playerData)
        .sort((a,b) => b[1].rate - a[1].rate)
        .slice(0,3)                                              // 上位 3 人
        .forEach(([pid], idx) => {
          playerData[pid].title = ["👑 王者", "🥈 挑戦者", "🥉 鬼気迫る者"][idx];
        });
}

function getTopRatedPlayerId() {
  let topId = null;
  let topRate = -Infinity;
  for (const [pid, pdata] of Object.entries(playerData)) {
    if (pdata.rate > topRate) {
      topRate = pdata.rate;
      topId = pid;
    }
  }
  return topId;
}

/* ======================================================
 *  Google Drive 連携 & CSV 出力
 * ==================================================== */
async function loadJson() {
  try {
    const url = `${ENDPOINT}`;
    const res = await fetch(url, {
      method: "GET",
      mode: "cors", // ← 追加
      cache: "no-store"
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    displayMessage('データ読み込み成功');
    return json;
  } catch (e) {
    displayMessage(`読み込み失敗: ${e.message}`);
    console.error(e);
  }
}

async function saveJson(data, rev = 0) {
  try {
    const body = { data, rev };
    const url = `${ENDPOINT}`;
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors', // ← 追加
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    displayMessage('データ保存成功');
    return json;
  } catch (e) {
    displayMessage(`保存失敗: ${e.message}`);
    console.error(e);
  }
}

async function pollDrive() {
  
  if (isSaving) return;

  const loaded = await loadJson();
  if (!loaded || !loaded.data) return;

  
  const newSeatMap    = loaded.data.seatMap    || {};
  const newPlayerData = loaded.data.playerData || {};

  const changed =
      JSON.stringify(seatMap)    !== JSON.stringify(newSeatMap) ||
      JSON.stringify(playerData) !== JSON.stringify(newPlayerData);

  if (changed) {
    seatMap    = newSeatMap;
    playerData = newPlayerData;
    renderSeats();
    displayMessage('☁ 他端末の変更を反映しました');
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollDrive, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function store() {
  isSaving = true;
  stopPolling();

  try {
    const current = await loadJson();
    if (!current) {
      displayMessage("最新データ取得に失敗しました");
      return;
    }
    const rev = current.rev || 0;

    // 送信データは { seatMap, playerData }
    const saveResult = await saveJson({ seatMap, playerData }, rev);
    if (saveResult && saveResult.ok) {
      displayMessage(`✅ データ保存成功（rev: ${saveResult.rev}）`);
    }
  } catch (e) {
    displayMessage(`❌ 保存失敗: ${e.message}`);
    console.error(e);
  } finally {
    isSaving = false;
    startPolling();
  }
}

async function refresh(){
  const loaded = await loadJson();
  if(loaded && loaded.data){
    seatMap    = loaded.data.seatMap    || {};
    playerData = loaded.data.playerData || {};
    renderSeats();
    displayMessage('☁ 最新データを読み込みました');
  }
}

// 例: ページ読み込み時にデータを読み込み表示
window.addEventListener('DOMContentLoaded', async () => {
  const loaded = await loadJson();
  if (loaded && loaded.data) {
    console.log('取得データ:', loaded.data);
    // ここで画面に表示したり状態に反映したりする処理を書く
  }
});

// 例: ボタン押下時に現在の状態を保存する処理
document.getElementById('btnSave').addEventListener('click', async () => {
  // 例として簡単なデータを作成
  const dataToSave = {
    foo: 'bar',
    timestamp: Date.now()
  };
  
  // まず現在のrevを取得
  const current = await loadJson();
  if (!current) return;
  
  const rev = current.rev || 0;
  const result = await saveJson(dataToSave, rev);
  console.log('保存結果:', result);
});


/* --- CSV でダウンロード --- */
function saveToCSV() {
  const rows = [["ID","ニックネーム","レート","前回順位","ボーナス","称号"]];
  for (const id in playerData) {
    const p = playerData[id];
    rows.push([id, p.nickname, p.rate, p.lastRank ?? "", p.bonus ?? 0, p.title ?? ""]);
  }

  const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type:"text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = "player_ranking.csv";
  a.click();
}

function bindButtons() {
  document.getElementById("btnUndo")?.addEventListener("click", undoAction);
  document.getElementById("btnSaveCSV")?.addEventListener("click", saveToCSV);
  document.getElementById("btnConfirmRanking")?.addEventListener("click", confirmRanking);
  document.getElementById("btnRefresh")?.addEventListener("click", refresh);
  document.getElementById("btnStore")?.addEventListener("click", store);
    // Drive へ保存
  document.getElementById("btnSave")
          ?.addEventListener("click", store);

  // Drive から読み込み
  document.getElementById("btnLoad")
          ?.addEventListener("click", refresh);
}

/* ======== 初期化 ======== */
document.addEventListener("DOMContentLoaded", () => {
  initCamera();
  loadFromLocalStorage();
  renderSeats();
  bindButtons();
  /* ボタンへのイベント付与など既存の bindButtons() を呼び出す */
});

/* ======== window 公開 ======== */
Object.assign(window, {
  navigate,
  navigateToExternal: url => window.open(url, "_blank"),
  undoAction,
  saveToCSV,
  confirmRanking,
  removePlayer
});
