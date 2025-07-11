// app.js
import { Html5Qrcode } from "https://unpkg.com/html5-qrcode?module";

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbwckDY2AlG4ItnrqM-7-VkQ6tgPHMTwCZ0JjPW7MfPNWEYgzY3AHTiPn3uNEDQbnD-R/exec';
const SECRET   = 'kosen-brain-super-secret';

let currentSeatId = null;
let seatMap = {};
let playerData = {};
let actionHistory = [];
const SCAN_COOLDOWN_MS = 1500;
let lastScanTime = 0;
let lastScannedText = "";
let rankingQrScanner = null;
let isRankingMode = false;
let rankingSeatId = null;
let displayMessageTimeout = null;

// --- ステータス表示 ---
function showStatus(text, ok = true) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? 'green' : 'red';
}

// --- メッセージ表示 ---
function displayMessage(msg) {
  const area = document.getElementById('messageArea');
  if (!area) return;
  area.textContent = msg;
  if (displayMessageTimeout) clearTimeout(displayMessageTimeout);
  displayMessageTimeout = setTimeout(() => (area.textContent = ''), 3000);
}

// --- QRコード読み取り成功時 ---
function handleScanSuccess(decodedText) {
  const now = Date.now();
  if (decodedText === lastScannedText && now - lastScanTime < SCAN_COOLDOWN_MS) return;
  lastScannedText = decodedText;
  lastScanTime = now;

  if (decodedText.startsWith("table")) {
    currentSeatId = decodedText;
    if (!seatMap[currentSeatId]) seatMap[currentSeatId] = [];
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

// --- 座席＋プレイヤー一覧描画 ---
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

    seatMap[seatId].forEach(playerId => {
      const player = playerData[playerId] || {};
      const titleText = player.title || "";
      const titleBadge = titleText ? `<span class="title-badge title-${titleText}">${titleText}</span>` : "";
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
          <span style="margin-left:10px;color:#888;">Rate: ${player.rate ?? "??"}</span>
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

// --- Undo処理 ---
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

// --- 画面切替 ---
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
        (err) => { /* 無視 */ }
      ).catch(err => {
        displayMessage("カメラの起動に失敗しました（順位登録）");
        console.error(err);
      });
    }
  } else {
    isRankingMode = false;
    if (rankingQrScanner) {
      rankingQrScanner.stop().then(() => {
        rankingQrScanner.clear();
        rankingQrScanner = null;
      });
    }
  }
}

// --- 外部サイトへ遷移 ---
function navigateToExternal(url) {
  window.open(url, "_blank");
}

// --- 順位登録モード処理 ---
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

// --- ドラッグ＆ドロップ機能 ---
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

// --- 順位確定 ---
function confirmRanking() {
  if (!rankingSeatId) return;
  const ordered = Array.from(document.getElementById("rankingList").children)
    .map(li => li.dataset.playerId);

  ordered.forEach((playerId, index) => {
    const player = playerData[playerId];
    if (player) player.lastRank = index + 1;
  });

  calculateRate(ordered);
  displayMessage("✅ 順位を保存しました");
  saveToLocalStorage();
}

// --- レート計算 ---
function calculateRate(rankedPlayerIds) {
  const points = rankedPlayerIds.map((id, i) => {
    const player = playerData[id];
    const prevRank = player.lastRank || rankedPlayerIds.length;
    let baseChange = prevRank - (i + 1);
    let bonus = 0;
    let point = baseChange * 2;

    if (prevRank === 1 && i + 1 === rankedPlayerIds.length) point = -8;
    else if (prevRank === rankedPlayerIds.length && i + 1 === 1) point = 8;

    if (player.rate >= 80) point = Math.floor(point * 0.8);

    const currentTop = getTopRatedPlayerId();
    if (currentTop && player.rate <= playerData[currentTop].rate && i + 1 < playerData[currentTop].lastRank) {
      bonus += 2;
    }

    const newRate = Math.max(30, player.rate + point + bonus);
    player.bonus = point + bonus;
    player.rate = newRate;

    return { id, rate: newRate, bonus: point + bonus };
  });

  assignTitles();
}

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

function assignTitles() {
  const sorted = Object.entries(playerData)
    .sort((a, b) => b[1].rate - a[1].rate)
    .map(([id]) => id);
  sorted.forEach((id, idx) => {
    const player = playerData[id];
    player.title = idx === 0 ? "👑 王者" : idx === 1 ? "🥈 挑戦者" : idx === 2 ? "🥉 鬼気迫る者" : null;
  });
}

// --- CSV保存 ---
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

// --- Google Drive 連携 ---

async function loadJson() {
  const r = await fetch(`${ENDPOINT}?action=get`, { cache: "no-store" });
  const j = await r.json();
  if (j.error) throw j.error;
  return j;
}

async function saveJson(nextData, baseRev, sig, retry = 3) {
  try {
    const body = { data: nextData, rev: baseRev, sig };
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.error) throw j.error;
    return j;
  } catch (e) {
    if (e === "conflict" && retry) {
      await delay(200 * (4 - retry));
      const latest = await loadJson();
      return saveJson(nextData, latest.rev, latest.sig, retry - 1);
    }
    throw e;
  }
}

async function makeSig(data) {
  const enc = new TextEncoder().encode(JSON.stringify(data));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function refresh() {
  try {
    const { data } = await loadJson();
    seatMap = data.seatMap || {};
    playerData = data.playerData || {};
    renderSeats();
    displayMessage("☁ データ読み込み成功");
  } catch (e) {
    displayMessage("❌ 読み込み失敗: " + e);
  }
}

async function store() {
  try {
    const next = { seatMap, playerData };
    const sig = await makeSig(next);
    await saveJson(next, 0, sig);
    displayMessage("✅ データ保存成功");
  } catch (e) {
    displayMessage("❌ 保存失敗: " + e);
  }
}

// --- カメラ起動 ---
function initCamera() {
  const qrReader = new Html5Qrcode("reader");
  qrReader
    .start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, handleScanSuccess)
    .catch((err) => {
      displayMessage("カメラの起動に失敗しました");
      console.error(err);
    });
}

// --- ボタンイベント設定 ---
function bindButtons() {
  document.getElementById("btnSave").addEventListener("click", store);
  document.getElementById("btnLoad").addEventListener("click", refresh);
}

// --- DOM読み込み後初期化 ---
document.addEventListener("DOMContentLoaded", () => {
  initCamera();
  loadFromLocalStorage();
  renderSeats();
  bindButtons();
});

// --- windowに公開 ---
window.navigate = navigate;
window.navigateToExternal = navigateToExternal;
window.undoAction = undoAction;
window.saveToCSV = saveToCSV;
window.confirmRanking = confirmRanking;
window.removePlayer = removePlayer;
