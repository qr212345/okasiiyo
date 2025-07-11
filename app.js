import { loadJson, saveJson, makeSig }
from "https://github.com/qr212345/okasiiyo/tree/main/qr212345/okasiiyo/raw/tree-save";// ESM import

window.addEventListener("DOMContentLoaded", () => {
  const $btnL = document.getElementById("btnLoad");
  const $btnS = document.getElementById("btnSave");
  const $status = document.getElementById("status");
  const $view = document.getElementById("view");

  let db = { rev: 0, data: { msg: "Hello" }, sig: "" };

  function show(msg, ok = true) {
    $status.textContent = msg;
    $status.style.color = ok ? "green" : "red";
  }

  function render() {
    $view.textContent = JSON.stringify(db, null, 2);
  }

  async function refresh() {
    try {
      db = await load();
      render();
      show("✅ 読み取り成功 rev=" + db.rev);
    } catch (err) {
      show("❌ 読み取り失敗: " + err, false);
    }
  }

  async function store() {
    try {
      db.data.msg = prompt("新メッセージを入力", db.data.msg);
      if (db.data.msg === null) return;
      db.sig = await makeSig(db.data);
      db = await save(db.data, db.rev, db.sig);
      render();
      show("✅ 保存成功 rev=" + db.rev);
    } catch (err) {
      show("❌ 保存失敗: " + err, false);
    }
  }

  $btnL.onclick = refresh;
  $btnS.onclick = store;

  refresh();
});
// --- グローバル変数 ---
let currentSeatId = null;
let seatMap = {}; // 例: { table01: ["player01", "player02", ...] }
let playerData = {}; // プレイヤーIDに紐づくレートなど
let actionHistory = []; // Undo用履歴
const SCAN_COOLDOWN_MS = 1500;
let lastScanTime = 0;
let lastScannedText = "";
let rankingQrScanner = null;
// ---ステータス表示 ---
function showStatus(text, ok = true) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? 'green' : 'red';
}

// --- スキャン処理 ---
function handleScanSuccess(decodedText, decodedResult) {
  const now = Date.now();
  if (decodedText === lastScannedText && now - lastScanTime < SCAN_COOLDOWN_MS) return;
  lastScannedText = decodedText;
  lastScanTime = now;

  if (decodedText.startsWith("table")) {
    currentSeatId = decodedText;
    if (!seatMap[currentSeatId]) {
      seatMap[currentSeatId] = [];
    }
    displayMessage(`✅ 座席セット: ${currentSeatId}`);
  } else if (decodedText.startsWith("player")) {
    if (!currentSeatId) {
      displayMessage("⚠ 先に座席QRを読み込んでください");
      return;
    }
    const playerId = decodedText;
    if (seatMap[currentSeatId].includes(playerId)) {
      displayMessage("⚠ このプレイヤーはすでに登録されています");
      return;
    }
    if (seatMap[currentSeatId].length >= 6) {
      displayMessage("⚠ この座席には6人までしか登録できません");
      return;
    }

    seatMap[currentSeatId].push(playerId);
    playerData[playerId] ||= {
      nickname: playerId,
      rate: 50,
      lastRank: null,
      bonus: 0
    };
    actionHistory.push({ type: "addPlayer", seatId: currentSeatId, playerId });
    displayMessage(`✅ ${playerId} を ${currentSeatId} に追加`);
    saveToLocalStorage();
    renderSeats();
  }

  handleRankingMode(decodedText);
}
// --- 座席＋生徒一覧の描画 ---
function renderSeats() {
  const seatList = document.getElementById("seatList");
  seatList.innerHTML = "";

  Object.keys(seatMap).forEach(seatId => {
    const block = document.createElement("div");
    block.className = "seat-block";

    // 座席タイトルと削除ボタン
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

    // 各プレイヤーを描画
    seatMap[seatId].forEach(playerId => {
      const player = playerData[playerId] || {};
      const titleText = player.title || "";
      const titleBadge = titleText
        ? `<span class="title-badge title-${titleText}">${titleText}</span>`
        : "";

      const rateChange = player.bonus ?? 0;
      const rateBadge = `
        <span class="rate-change ${
          rateChange > 0 ? "rate-up" : rateChange < 0 ? "rate-down" : "rate-zero"
        }">
          ${rateChange > 0 ? "↑" : rateChange < 0 ? "↓" : "±"}${Math.abs(rateChange)}
        </span>
      `;

      const playerDiv = document.createElement("div");
      playerDiv.className = "player-entry";

      playerDiv.innerHTML = `
        <div>
          <strong>${playerId}</strong>
          ${titleBadge}
          <span style="margin-left: 10px; color: #888;">Rate: ${player.rate ?? "??"}</span>
          ${rateBadge}
        </div>
        <span class="remove-button" onclick="removePlayer('${seatId}', '${playerId}')">✖</span>
      `;

      block.appendChild(playerDiv);
    });

    seatList.appendChild(block);
  });
}


// --- プレイヤー削除 ---
function removePlayer(seatId, playerId) {
  if (!seatMap[seatId]) return;
  const index = seatMap[seatId].indexOf(playerId);
  if (index !== -1) {
    seatMap[seatId].splice(index, 1);
    actionHistory.push({ type: "removePlayer", seatId, playerId, index });
    saveToLocalStorage();
    renderSeats();
  }
}

// --- Undo処理（最大3段階）---
function undoAction() {
  if (actionHistory.length === 0) {
    displayMessage("操作履歴がありません");
    return;
  }

  const last = actionHistory.pop();
  switch (last.type) {
    case "addPlayer":
      seatMap[last.seatId] = seatMap[last.seatId].filter(p => p !== last.playerId);
      break;
    case "removePlayer":
  if (!seatMap[last.seatId]) seatMap[last.seatId] = [];
  seatMap[last.seatId].splice(last.index, 0, last.playerId);
  break;
    case "removeSeat":
      seatMap[last.seatId] = last.players;
      break;
  }

  displayMessage("↩ 元に戻しました");
  saveToLocalStorage();
  renderSeats();
}

// --- ローカル保存・読み込み ---
function saveToLocalStorage() {
  localStorage.setItem("seatMap", JSON.stringify(seatMap));
  localStorage.setItem("playerData", JSON.stringify(playerData));
}

function loadFromLocalStorage() {
  seatMap = JSON.parse(localStorage.getItem("seatMap") || "{}");
  playerData = JSON.parse(localStorage.getItem("playerData") || "{}");
}
let isRankingMode = false;
let rankingSeatId = null;

// サイドバーからの画面切り替え
function navigate(section) {
  document.getElementById("scanSection").style.display = section === "scan" ? "block" : "none";
  document.getElementById("rankingSection").style.display = section === "ranking" ? "block" : "none";

  if (section === "ranking") {
    isRankingMode = true;
    rankingSeatId = null;
    document.getElementById("rankingList").innerHTML = "";
    displayMessage("座席QRを読み込んでください（順位登録モード）");

    if (!rankingQrScanner) {
      rankingQrScanner = new Html5Qrcode("rankingReader");
      rankingQrScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          if (decodedText.startsWith("table")) {
            handleRankingMode(decodedText);
            displayMessage(`✅ 座席QR読み取り成功: ${decodedText}`);

            rankingQrScanner.stop().then(() => {
              rankingQrScanner.clear();
              rankingQrScanner = null;
            });
          } else {
            displayMessage("⚠ 座席コードのみ読み取り可能です");
          }
        },
        (err) => {
          // 無視
        }
      ).catch(err => {
        displayMessage("カメラの起動に失敗しました（順位登録）");
        console.error(err);
      });
    }
  } else {
    isRankingMode = false;

    // ←ここが重要！ カメラ停止
    if (rankingQrScanner) {
      rankingQrScanner.stop().then(() => {
        rankingQrScanner.clear();
        rankingQrScanner = null;
      });
    }
  }
}


// 外部サイトへ遷移
function navigateToExternal(url) {
  window.open(url, "_blank");
}

// QR読み取り処理内に追加（座席QR読み取り時）
function handleRankingMode(decodedText) {
  if (decodedText.startsWith("table") && isRankingMode) {
    rankingSeatId = decodedText;
    const players = seatMap[rankingSeatId] || [];
    const list = document.getElementById("rankingList");
    list.innerHTML = "";

    players.forEach(playerId => {
      const li = document.createElement("li");
      li.textContent = playerId;
      li.dataset.playerId = playerId;
      list.appendChild(li);
    });

    makeListDraggable(list);
    displayMessage(`座席 ${rankingSeatId} の順位を並び替えてください`);
  }
}

// ドラッグ＆ドロップ機能追加
function makeListDraggable(list) {
  let dragging = null;

  list.querySelectorAll("li").forEach(li => {
    li.draggable = true;

    li.ondragstart = () => {
      dragging = li;
      li.classList.add("dragging");
    };

    li.ondragend = () => {
      dragging = null;
      li.classList.remove("dragging");
    };

    li.ondragover = e => {
      e.preventDefault();
      const target = e.target;
      if (target && target !== dragging && target.nodeName === "LI") {
        const rect = target.getBoundingClientRect();
        const next = (e.clientY - rect.top) > rect.height / 2;
        target.parentNode.insertBefore(dragging, next ? target.nextSibling : target);
      }
    };
  });
}

// 順位確定処理
function confirmRanking() {
  if (!rankingSeatId) return;

  const ordered = Array.from(document.getElementById("rankingList").children)
    .map(li => li.dataset.playerId);

  ordered.forEach((playerId, index) => {
    const player = playerData[playerId];
    if (player) {
      player.lastRank = index + 1;
    }
  });

  calculateRate(ordered);
  displayMessage("✅ 順位を保存しました");
  saveToLocalStorage();
}
function calculateRate(rankedPlayerIds) {
  const points = rankedPlayerIds.map((id, i) => {
    const player = playerData[id];
    const prevRank = player.lastRank || rankedPlayerIds.length;
    let baseChange = prevRank - (i + 1); // 順位変動ベース
    let bonus = 0;

    // 基本ポイント（順位変動）
    let point = baseChange * 2;

    // 特殊ルール
    if (prevRank === 1 && i + 1 === rankedPlayerIds.length) {
      point = -8; // 1位→最下位
    } else if (prevRank === rankedPlayerIds.length && i + 1 === 1) {
      point = +8; // 最下位→1位
    }

    // 高レート補正
    if (player.rate >= 80) {
      point = Math.floor(point * 0.8);
    }

    // 総合1位を超えた？
    const currentTop = getTopRatedPlayerId();
    if (currentTop && player.rate <= playerData[currentTop].rate && i + 1 < playerData[currentTop].lastRank) {
      bonus += 2;
    }

    // レート計算と制限
    const newRate = Math.max(30, player.rate + point + bonus);
    player.bonus = point + bonus;
    player.rate = newRate;

    return {
      id,
      rate: newRate,
      bonus: point + bonus
    };
  });

  assignTitles(); // 称号更新
}

// 総合レート1位のIDを取得
function getTopRatedPlayerId() {
  let topId = null;
  let topRate = -1;
  for (const id in playerData) {
    if (playerData[id].rate > topRate) {
      topRate = playerData[id].rate;
      topId = id;
    }
  }
  return topId;
}

// 称号付与（1位〜3位に称号、自動更新）
function assignTitles() {
  const sorted = Object.entries(playerData)
    .sort((a, b) => b[1].rate - a[1].rate)
    .map(([id]) => id);

  sorted.forEach((id, idx) => {
    const player = playerData[id];
    player.title = idx === 0 ? "👑 王者" : idx === 1 ? "🥈 挑戦者" : idx === 2 ? "🥉 鬼気迫る者" : null;
  });
}
function saveToCSV() {
  const rows = [["ID", "ニックネーム", "レート", "前回順位", "ボーナス", "称号"]];
  for (const id in playerData) {
    const p = playerData[id];
    rows.push([id, p.nickname, p.rate, p.lastRank, p.bonus, p.title || ""]);
  }

  const csvContent = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "player_ranking.csv";
  a.click();
}
/* --- グローバル変数・既存ロジックはそのまま --- */
/* --- store / refresh --- */
async function refresh() {
  try {
    const { data } = await loadJson();
    seatMap    = data.seatMap  || {};
    playerData = data.playerData || {};
    renderSeats();
    displayMessage('☁ データ読み込み成功');
  } catch (e) {
    displayMessage('❌ 読み込み失敗: ' + e);
  }
}

async function store() {
  try {
    const next = { seatMap, playerData };
    const sig  = await makeSig(next);
    await saveJson(next, 0, sig);        // rev は save 内で自動更新
    displayMessage('✅ データ保存成功');
  } catch (e) {
    displayMessage('❌ 保存失敗: ' + e);
  }
}

/* --- 画面ロード時の初期化を 1 箇所に --- */
document.addEventListener('DOMContentLoaded', () => {
  initCamera();           // ① カメラ起動
  loadFromLocalStorage(); // ② ローカル復元
  renderSeats();          // ③ 画面に描画
  bindButtons();          // ④ ボタンの click ハンドラ登録
});

function initCamera() {
  const qrReader = new Html5Qrcode('reader');
  qrReader.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 250 },
    handleScanSuccess
  ).catch(err => {
    displayMessage('カメラの起動に失敗しました');
    console.error(err);
  });
}

function bindButtons() {
  document.getElementById('btnSave').addEventListener('click', store);
  document.getElementById('btnLoad').addEventListener('click', refresh);
}

window.displayMessage = function(msg) {
  const area = document.getElementById('messageArea');
  area.textContent = msg;
  setTimeout(() => (area.textContent = ''), 3000);
};
window.navigate = navigate;
window.navigateToExternal = navigateToExternal;
window.undoAction = undoAction;
window.saveToCSV = saveToCSV;
window.confirmRanking = confirmRanking;
window.removePlayer = removePlayer;
