/**********************
 *  ババ抜き大会管理  *
 **********************/

/* ======== 定数 ======== */
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbyp_pxgcnKPscZXcLAFzLSEp_RDaWAZH7LX5_VFvsNyEz3yGExU-1jDdU-z6AHE1G8l/exec';
const SECRET   = 'kosen-brain-super-secret';
const SCAN_COOLDOWN_MS = 1500;
const POLL_INTERVAL_MS = 20_000;

/* ======== グローバル状態 ======== */
let qrReader, rankingQrReader;
let qrActive       = false;
let isRankingMode  = false;
let isSaving       = false;
let pollTimer      = null;
let currentSeatId  = null;
let rankingSeatId  = null;
let lastScanTime   = 0;
let lastScannedText = '';
let msgTimer       = null;

let seatMap       = {};      // { table01: [player01,…] }
let playerData    = {};      // { playerId: {…} }
let actionHistory = [];

/* ======== ユーティリティ ======== */
const delay = ms => new Promise(res => setTimeout(res, ms));

function displayMessage(msg) {
  const area = document.getElementById('messageArea');
  if (!area) return;
  area.textContent = msg;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (area.textContent = ''), 3000);
}

/* ======================================================
 *  QR スキャン
 * ==================================================== */
function handleScanSuccess(decodedText) {
  const now = Date.now();
  if (decodedText === lastScannedText && now - lastScanTime < SCAN_COOLDOWN_MS) return;

  lastScannedText = decodedText;
  lastScanTime    = now;

  if (decodedText.startsWith('table')) {
    currentSeatId = decodedText;
    seatMap[currentSeatId] ??= [];
    displayMessage(`✅ 座席セット: ${currentSeatId}`);
  } else if (decodedText.startsWith('player')) {
    if (!currentSeatId) {
      displayMessage('⚠ 先に座席QRを読み込んでください');
      return;
    }
    if (seatMap[currentSeatId].includes(decodedText)) {
      displayMessage('⚠ 既に登録済み');
      return;
    }
    if (seatMap[currentSeatId].length >= 6) {
      displayMessage('⚠ この座席は6人まで');
      return;
    }

    seatMap[currentSeatId].push(decodedText);
    playerData[decodedText] ??= { nickname: decodedText, rate: 50, lastRank: null, bonus: 0 };
    actionHistory.push({ type: 'addPlayer', seatId: currentSeatId, playerId: decodedText });
    displayMessage(`✅ ${decodedText} 追加`);
    saveToLocalStorage();
    renderSeats();
  }

  handleRankingMode(decodedText);
}

function initCamera() {
  if (qrActive) return;
  if (!qrReader) qrReader = new Html5Qrcode('reader');

  qrReader
    .start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, handleScanSuccess)
    .then(() => (qrActive = true))
    .catch(err => {
      console.error(err);
      displayMessage('❌ カメラの起動に失敗しました');
    });
}

/* ======================================================
 *  座席表示 & 操作
 * ==================================================== */
function renderSeats() {
  const seatList = document.getElementById('seatList');
  seatList.innerHTML = '';

  Object.keys(seatMap).forEach(seatId => {
    const block = document.createElement('div');
    block.className = 'seat-block';

    /* 見出し */
    const title = document.createElement('h3');
    title.textContent = `座席: ${seatId}`;
    const removeSeat = document.createElement('span');
    removeSeat.textContent = '✖';
    removeSeat.className = 'remove-button';
    removeSeat.onclick = () => {
      if (confirm(`座席 ${seatId} を削除しますか？`)) {
        actionHistory.push({ type: 'removeSeat', seatId, players: seatMap[seatId] });
        delete seatMap[seatId];
        saveToLocalStorage();
        renderSeats();
      }
    };
    title.appendChild(removeSeat);
    block.appendChild(title);

    /* プレイヤー */
    seatMap[seatId].forEach(pid => {
      const p  = playerData[pid];
      const rc = p.bonus ?? 0;
      block.insertAdjacentHTML(
        'beforeend',
        `
        <div class="player-entry">
          <div>
            <strong>${pid}</strong>
            ${p.title ? `<span class="title-badge title-${p.title}">${p.title}</span>` : ''}
            <span style="margin-left:10px;color:#888;">Rate: ${p.rate}</span>
            <span class="rate-change ${rc > 0 ? 'rate-up' : rc < 0 ? 'rate-down' : 'rate-zero'}">
              ${rc > 0 ? '↑' : rc < 0 ? '↓' : '±'}${Math.abs(rc)}
            </span>
          </div>
          <span class="remove-button" onclick="removePlayer('${seatId}','${pid}')">✖</span>
        </div>
      `
      );
    });

    seatList.appendChild(block);
  });
}

function removePlayer(seatId, playerId) {
  const idx = seatMap[seatId]?.indexOf(playerId);
  if (idx === -1) return;
  seatMap[seatId].splice(idx, 1);
  actionHistory.push({ type: 'removePlayer', seatId, playerId, index: idx });
  saveToLocalStorage();
  renderSeats();
}

function undoAction() {
  if (!actionHistory.length) {
    displayMessage('操作履歴がありません');
    return;
  }
  const last = actionHistory.pop();
  switch (last.type) {
    case 'addPlayer':
      seatMap[last.seatId] = seatMap[last.seatId].filter(p => p !== last.playerId);
      break;
    case 'removePlayer':
      seatMap[last.seatId]?.splice(last.index, 0, last.playerId);
      break;
    case 'removeSeat':
      seatMap[last.seatId] = last.players;
      break;
  }
  displayMessage('↩ 元に戻しました');
  saveToLocalStorage();
  renderSeats();
}

/* ======== ローカルストレージ ======== */
function saveToLocalStorage() {
  localStorage.setItem('seatMap', JSON.stringify(seatMap));
  localStorage.setItem('playerData', JSON.stringify(playerData));
}
function loadFromLocalStorage() {
  seatMap    = JSON.parse(localStorage.getItem('seatMap')    || '{}');
  playerData = JSON.parse(localStorage.getItem('playerData') || '{}');
}

/* ======================================================
 *  画面遷移 & 順位登録
 * ==================================================== */
function navigate(section) {
  document.getElementById('scanSection').style.display    = section === 'scan'    ? 'block' : 'none';
  document.getElementById('rankingSection').style.display = section === 'ranking' ? 'block' : 'none';

  if (section === 'ranking') {
    isRankingMode  = true;
    rankingSeatId  = null;
    document.getElementById('rankingList').innerHTML = '';
    displayMessage('座席QR を読み込んでください（順位登録モード）');

    if (!rankingQrReader) {
      rankingQrReader = new Html5Qrcode('rankingReader');
      rankingQrReader
        .start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, decodedText => {
          if (decodedText.startsWith('table')) {
            handleRankingMode(decodedText);
            displayMessage(`✅ 座席 ${decodedText} 読み取り成功`);
            rankingQrReader.stop().then(() => {
              rankingQrReader.clear();
              rankingQrReader = null;
            });
          } else {
            displayMessage('⚠ 座席コードのみ読み取り可能です');
          }
        })
        .catch(err => {
          console.error(err);
          displayMessage('❌ カメラの起動に失敗しました（順位登録）');
        });
    }
  } else {
    isRankingMode = false;
    if (rankingQrReader) {
      rankingQrReader.stop().then(() => {
        rankingQrReader.clear();
        rankingQrReader = null;
      });
    }
    if (!qrActive && section === 'scan') initCamera();
  }
}

function handleRankingMode(tableCode) {
  if (!isRankingMode) return;
  rankingSeatId = tableCode;

  const list = document.getElementById('rankingList');
  list.innerHTML = '';
  (seatMap[tableCode] || []).forEach(pid => {
    const li = document.createElement('li');
    li.textContent      = pid;
    li.dataset.playerId = pid;
    list.appendChild(li);
  });

  makeListDraggable(list);
  displayMessage(`座席 ${tableCode} の順位を並び替えてください`);
}

function makeListDraggable(ul) {
  let dragging = null;
  ul.querySelectorAll('li').forEach(li => {
    li.draggable = true;
    li.ondragstart = () => {
      dragging = li;
      li.classList.add('dragging');
    };
    li.ondragend = () => {
      dragging = null;
      li.classList.remove('dragging');
    };
    li.ondragover = e => {
      e.preventDefault();
      const tgt = e.target;
      if (tgt && tgt !== dragging && tgt.nodeName === 'LI') {
        const r   = tgt.getBoundingClientRect();
        const aft = (e.clientY - r.top) > r.height / 2;
        tgt.parentNode.insertBefore(dragging, aft ? tgt.nextSibling : tgt);
      }
    };
  });
}

function confirmRanking() {
  if (!rankingSeatId) return;

  const ordered = Array.from(document.querySelectorAll('#rankingList li')).map(
    li => li.dataset.playerId
  );

  ordered.forEach((pid, idx) => {
    if (playerData[pid]) playerData[pid].lastRank = idx + 1;
  });

  calculateRate(ordered);
  displayMessage('✅ 順位を保存しました');
  saveToLocalStorage();
}

/* ======================================================
 *  レート計算
 * ==================================================== */
function calculateRate(rankedIds) {
  rankedIds.forEach((pid, i) => {
    const p        = playerData[pid];
    const prevRank = p.lastRank ?? rankedIds.length;
    let diff       = prevRank - (i + 1); // 上に行くほど正

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

function assignTitles() {
  Object.values(playerData).forEach(p => (p.title = null));
  Object.entries(playerData)
    .sort((a, b) => b[1].rate - a[1].rate)
    .slice(0, 3)
    .forEach(([pid], idx) => {
      playerData[pid].title = ['👑 王者', '🥈 挑戦者', '🥉 鬼気迫る者'][idx];
    });
}

function getTopRatedPlayerId() {
  let topId = null;
  let topRate = -Infinity;
  for (const [pid, pdata] of Object.entries(playerData)) {
    if (pdata.rate > topRate) {
      topRate = pdata.rate;
      topId   = pid;
    }
  }
  return topId;
}

/* ======================================================
 *  Google Drive 連携
 * ==================================================== */
async function pollDrive() {
  if (isSaving) return;

  const loaded = await loadJson();
  if (!loaded || !loaded.seatMap) return;

  const changed =
    JSON.stringify(seatMap)    !== JSON.stringify(loaded.seatMap) ||
    JSON.stringify(playerData) !== JSON.stringify(loaded.playerData);

  if (changed) {
    seatMap    = loaded.seatMap;
    playerData = loaded.playerData;
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
      displayMessage('最新データ取得に失敗しました');
      return;
    }
    const rev = current.rev || 0;
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

async function refresh() {
  const loaded = await loadJson();
  if (loaded && loaded.seatMap) {
    seatMap    = loaded.seatMap;
    playerData = loaded.playerData;
    renderSeats();
    displayMessage('☁ 最新データを読み込みました');
  }
}

/* ======================================================
 *  CSV エクスポート
 * ==================================================== */
function saveToCSV() {
  const rows = [['ID', 'ニックネーム', 'レート', '前回順位', 'ボーナス', '称号']];
  for (const id in playerData) {
    const p = playerData[id];
    rows.push([id, p.nickname, p.rate, p.lastRank ?? '', p.bonus ?? 0, p.title ?? '']);
  }
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'player_ranking.csv';
  a.click();
}

/* ======================================================
 *  ボタンバインド
 * ==================================================== */
function bindButtons() {
  document.getElementById('btnUndo')        ?.addEventListener('click', undoAction);
  document.getElementById('btnSaveCSV')     ?.addEventListener('click', saveToCSV);
  document.getElementById('btnConfirmRanking')?.addEventListener('click', confirmRanking);
  document.getElementById('btnRefresh')     ?.addEventListener('click', refresh);
  document.getElementById('btnStore')       ?.addEventListener('click', store);
  document.getElementById('btnSave')        ?.addEventListener('click', store);
  document.getElementById('btnLoad')        ?.addEventListener('click', refresh);
}

/* ======================================================
 *  初期化
 * ==================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  initCamera();
  loadFromLocalStorage();
  renderSeats();
  bindButtons();
  startPolling();
});

/* グローバル公開 */
Object.assign(window, {
  navigate,
  navigateToExternal: url => window.open(url, '_blank'),
  undoAction,
  saveToCSV,
  confirmRanking,
  removePlayer
});
