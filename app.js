/**********************
 * ババ抜き大会管理 *
 **********************/
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyItVPS9GN4ePrx6Jj20WagXRq2z73wEKOPKEn6dImrovIAwXoersSwUixxUJSpddU/exec'; // ← あなたのGAS公開URLを入れてください
const POLL_INTERVAL_MS = 20000; // 20秒間隔で他端末変更をチェック
const SCAN_COOLDOWN_MS = 1500;  // 同じQRを連続読みしない猶予
/* ====== グローバル状態 ====== */
let pollTimer = null;
let isSaving = false;

let qrReader = null;
let rankingQrReader = null;
let qrActive = false;
let rankingQrActive = false;
let isRankingMode = false;

let currentSeatId = null;
let rankingSeatId = null;

let lastScanTime = 0;
let lastScannedText = '';

let seatMap = {};       // { table01: [player01, player02, ...] }
let playerData = {};    // { playerId: { nickname, rate, lastRank, bonus, title } }
let actionHistory = [];// 操作履歴（undo用）

let msgTimer = null;

/* ====== ユーティリティ ====== */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function displayMessage(msg) {
  const area = document.getElementById('messageArea');
  if (!area) return;
  area.textContent = msg;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { area.textContent = ''; }, 3000);
}

/* ====== カメラ操作 ====== */
async function stopCamera() {
  if (qrReader && qrActive) {
    await qrReader.stop();
    qrReader.clear();
    qrReader = null;
    qrActive = false;
  }
}

async function stopRankingCamera() {
  if (rankingQrReader && rankingQrActive) {
    await rankingQrReader.stop();
    rankingQrReader.clear();
    rankingQrReader = null;
    rankingQrActive = false;
  }
}

async function stopAllCameras() {
  await stopCamera();
  await stopRankingCamera();
}

async function initCamera() {
  const qrRegion = document.getElementById('reader');
  if (!qrRegion) return;

  if (typeof Html5Qrcode === 'undefined') {
    console.error("Html5Qrcodeが読み込まれていません");
    displayMessage("QRコードライブラリの読み込みに失敗しました");
    return;
  }

  await stopAllCameras();

  try {
    qrReader = new Html5Qrcode("reader");
    await qrReader.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      qrCodeMessage => {
        handleScanSuccess(qrCodeMessage);
      },
      errorMessage => {}
    );
    qrActive = true;
    displayMessage('📷 カメラ起動中（スキャンモード）');
  } catch (err) {
    console.error("QRコード初期化エラー:", err);
    displayMessage("❌ カメラ起動に失敗しました");
  }
}

async function startRankingCamera() {
  if (rankingQrActive) return;

  await stopAllCameras();

  rankingQrReader = new Html5Qrcode('rankingReader');
  rankingQrReader.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 250 },
    decodedText => {
      if (decodedText.startsWith('table')) {
        rankingSeatId = decodedText;
        displayMessage(`✅ 座席 ${decodedText} 読み取り成功`);

        populateRankingList(rankingSeatId);

        // 順位確定まで停止しない設計
      } else if (decodedText.startsWith('player')) {
        handleRankingMode(decodedText);
      } else {
        displayMessage('⚠ 座席またはプレイヤーQRのみ有効です');
      }
    },
    errorMessage => {}
  ).then(() => {
    rankingQrActive = true;
    displayMessage('📷 カメラ起動中（順位登録モード）');
  }).catch(err => {
    console.error(err);
    displayMessage('❌ 順位登録用カメラ起動失敗');
  });
}

/* ====== QRコード読み取り処理 ====== */
function handleScanSuccess(decodedText) {
  const now = Date.now();
  if (decodedText === lastScannedText && now - lastScanTime < SCAN_COOLDOWN_MS) {
    return;
  }
  lastScannedText = decodedText;
  lastScanTime = now;

  if (decodedText.startsWith('table')) {
    currentSeatId = decodedText;
    if (!seatMap[currentSeatId]) seatMap[currentSeatId] = [];
    displayMessage(`✅ 座席セット: ${currentSeatId}`);
  } else if (decodedText.startsWith('player')) {
    if (!currentSeatId) {
      displayMessage('⚠ 先に座席QRを読み込んでください');
      return;
    }
    if (seatMap[currentSeatId].includes(decodedText)) {
      displayMessage('⚠ 既に登録済みのプレイヤーです');
      return;
    }
    if (seatMap[currentSeatId].length >= 6) {
      displayMessage('⚠ この座席は6人まで登録可能です');
      return;
    }

    seatMap[currentSeatId].push(decodedText);
    playerData[decodedText] ??= { nickname: decodedText, rate: 50, lastRank: null, bonus: 0, title: null };
    actionHistory.push({ type: 'addPlayer', seatId: currentSeatId, playerId: decodedText });
    saveActionHistory();
    displayMessage(`✅ プレイヤー追加: ${decodedText}`);
    saveToLocalStorage();
    renderSeats();
  }
}

/* ====== 順位登録モードでのプレイヤー読み取り処理 ====== */
function handleRankingMode(decodedText) {
  if (!rankingSeatId) {
    displayMessage('⚠ 先に座席QRを読み込んでください（順位登録モード）');
    return;
  }
  if (!decodedText.startsWith('player')) {
    displayMessage('⚠ プレイヤーQRコードのみ有効です');
    return;
  }

  const players = seatMap[rankingSeatId] || [];
  if (players.includes(decodedText)) {
    displayMessage('⚠ 既に登録済みのプレイヤーです');
    return;
  }
  if (players.length >= 6) {
    displayMessage('⚠ この座席は6人まで登録可能です');
    return;
  }

  players.push(decodedText);
  seatMap[rankingSeatId] = players;

  playerData[decodedText] ??= { nickname: decodedText, rate: 50, lastRank: null, bonus: 0, title: null };
  actionHistory.push({ type: 'addPlayer', seatId: rankingSeatId, playerId: decodedText });
  saveActionHistory();

  populateRankingList(rankingSeatId);
  displayMessage(`✅ 順位登録モードでプレイヤー追加: ${decodedText}`);
  saveToLocalStorage();
  renderSeats();
}
/* ====== ナビゲーション ====== */
function navigate(section) {
  document.getElementById('scanSection').style.display = (section === 'scan') ? 'block' : 'none';
  document.getElementById('rankingSection').style.display = (section === 'ranking') ? 'block' : 'none';

  if (section === 'ranking') {
    isRankingMode = true;
    rankingSeatId = null;
    document.getElementById('rankingList').innerHTML = '';
    displayMessage('📋 座席QRを読み込んでください（順位登録モード）');
    startRankingCamera();
  } else {
    isRankingMode = false;
    stopRankingCamera();
    initCamera();
  }
}

/* ====== 順位リスト作成とドラッグ可能にする ====== */
function populateRankingList(seatId) {
  const list = document.getElementById('rankingList');
  list.innerHTML = '';
  (seatMap[seatId] || []).forEach(pid => {
    const li = document.createElement('li');
    li.textContent = pid;
    li.dataset.playerId = pid;
    li.draggable = true;
    list.appendChild(li);
  });
  makeListDraggable(list);
  displayMessage(`📋 座席 ${seatId} の順位を並び替えてください`);
}

/* ====== ドラッグ＆ドロップによる並べ替え ====== */
function makeListDraggable(ul) {
  let dragging = null;

  ul.querySelectorAll('li').forEach(li => {
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
        const rect = tgt.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        tgt.parentNode.insertBefore(dragging, after ? tgt.nextSibling : tgt);
      }
    };
  });
}

/* ====== 順位確定とレート計算 ====== */
function confirmRanking() {
  if (!rankingSeatId) {
    alert('順位登録する座席を読み込んでください');
    return;
  }

  const ordered = Array.from(document.querySelectorAll('#rankingList li')).map(li => li.dataset.playerId);

  ordered.forEach((pid, i) => {
    if (playerData[pid]) playerData[pid].lastRank = i + 1;
  });

  calculateRate(ordered);
  displayMessage('✅ 順位を保存しました');
  saveToLocalStorage();
  renderSeats();

  stopRankingCamera();
  isRankingMode = false;
  rankingSeatId = null;
  navigate('scan');
}

/* ====== レート計算ロジック ====== */
function calculateRate(rankedIds) {
  rankedIds.forEach((pid, i) => {
    const p = playerData[pid];
    if (!p) return;

    const prevRank = p.lastRank ?? rankedIds.length;
    const diff = prevRank - (i + 1); // 上がったほど正の値

    let point = diff * 2;

    // 特殊ルール（王者が最下位に落ちたら大減点など）
    if (prevRank === 1 && i === rankedIds.length - 1) point = -8;
    if (prevRank === rankedIds.length && i === 0) point = 8;

    // 高レート補正
    if (p.rate >= 80) point = Math.floor(point * 0.8);

    // 王座奪取ボーナス
    const topId = getTopRatedPlayerId();
    if (topId && p.rate <= playerData[topId].rate && (i + 1) < playerData[topId].lastRank) {
      point += 2;
    }

    p.bonus = point;
    p.rate = Math.max(30, p.rate + point);
  });

  assignTitles();
}

/* ====== タイトル付与 ====== */
function assignTitles() {
  Object.values(playerData).forEach(p => p.title = null);
  Object.entries(playerData)
    .sort((a, b) => b[1].rate - a[1].rate)
    .slice(0, 3)
    .forEach(([pid], idx) => {
      playerData[pid].title = ['👑 王者', '🥈 挑戦者', '🥉 鬼気迫る者'][idx];
    });
}

/* ====== 王者ID取得 ====== */
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

/* ====== UI表示更新 ====== */
function renderSeats() {
  const seatList = document.getElementById('seatList');
  if (!seatList) return;
  seatList.innerHTML = '';

  Object.keys(seatMap).forEach(seatId => {
    const block = document.createElement('div');
    block.className = 'seat-block';

    // 見出し
    const title = document.createElement('h3');
    title.textContent = `座席: ${seatId}`;
    const removeSeat = document.createElement('span');
    removeSeat.textContent = '✖';
    removeSeat.className = 'remove-button';
    removeSeat.style.cursor = 'pointer';
    removeSeat.onclick = () => {
      if (confirm(`座席 ${seatId} を削除しますか？`)) {
        actionHistory.push({ type: 'removeSeat', seatId, players: [...seatMap[seatId]] });
        saveActionHistory();
        delete seatMap[seatId];
        saveToLocalStorage();
        renderSeats();
      }
    };
    title.appendChild(removeSeat);
    block.appendChild(title);

    // プレイヤーリスト
    seatMap[seatId].forEach(pid => {
      const p = playerData[pid] || {};
      const rc = p.bonus ?? 0;

      const playerDiv = document.createElement('div');
      playerDiv.className = 'player-entry';

      playerDiv.innerHTML = `
        <div>
          <strong>${pid}</strong>
          ${p.title ? `<span class="title-badge title-${p.title}">${p.title}</span>` : ''}
          <span style="margin-left:10px;color:#888;">Rate: ${p.rate ?? '?'}</span>
          <span class="rate-change ${rc > 0 ? 'rate-up' : rc < 0 ? 'rate-down' : 'rate-zero'}">
            ${rc > 0 ? '↑' : rc < 0 ? '↓' : '±'}${Math.abs(rc)}
          </span>
        </div>
        <span class="remove-button" style="cursor:pointer;">✖</span>
      `;

      playerDiv.querySelector('.remove-button').onclick = () => removePlayer(seatId, pid);

      block.appendChild(playerDiv);
    });

    seatList.appendChild(block);
  });
}

/* ====== プレイヤー削除 ====== */
function removePlayer(seatId, playerId) {
  if (!seatMap[seatId]) return;
  const idx = seatMap[seatId].indexOf(playerId);
  if (idx === -1) return;
  seatMap[seatId].splice(idx, 1);
  actionHistory.push({ type: 'removePlayer', seatId, playerId, index: idx });
  saveActionHistory();
  saveToLocalStorage();
  renderSeats();
}

/* ====== 操作履歴で元に戻す ====== */
function undoAction() {
  if (actionHistory.length === 0) {
    displayMessage('操作履歴がありません');
    return;
  }
  const last = actionHistory.pop();
  saveActionHistory();

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
/* ====== ローカルストレージ操作 ====== */
function saveToLocalStorage() {
  localStorage.setItem('seatMap', JSON.stringify(seatMap));
  localStorage.setItem('playerData', JSON.stringify(playerData));
  localStorage.setItem('actionHistory', JSON.stringify(actionHistory));
}

function loadFromLocalStorage() {
  seatMap = JSON.parse(localStorage.getItem('seatMap') || '{}');
  playerData = JSON.parse(localStorage.getItem('playerData') || '{}');
  const hist = localStorage.getItem('actionHistory');
  try {
    actionHistory = hist ? JSON.parse(hist) : [];
  } catch {
    actionHistory = [];
  }
}

/* ====== 操作履歴共有 ====== */
async function sendActionHistoryToServer(actionHistory) {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'saveActionHistory', actionHistory }),
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    console.log('操作履歴保存成功:', data);
  } catch (e) {
    console.error('操作履歴共有失敗:', e);
  }
}

function saveActionHistory() {
  localStorage.setItem('actionHistory', JSON.stringify(actionHistory));
}

function loadActionHistoryFromLocal() {
  const hist = localStorage.getItem('actionHistory');
  try {
    actionHistory = hist ? JSON.parse(hist) : [];
  } catch {
    actionHistory = [];
  }
}
/* ====== Google Drive連携（GAS） ====== */
async function pollDrive() {
  if (isSaving) return;
  const loaded = await loadJson();
  if (!loaded || !loaded.seatMap) return;

  const changed =
    JSON.stringify(seatMap) !== JSON.stringify(loaded.seatMap) ||
    JSON.stringify(playerData) !== JSON.stringify(loaded.playerData);

  if (changed) {
    seatMap = loaded.seatMap;
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

/* ====== データ保存 ====== */
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
    const saveResult = await saveJson({ seatMap, playerData }, '', rev);

    if (saveResult && saveResult.ok) {
      displayMessage(`✅ データ保存成功（rev: ${saveResult.rev}）`);
    } else {
      displayMessage(`⚠ 保存に失敗しました（競合またはエラー）`);
    }

  } catch (e) {
    displayMessage(`❌ 保存失敗: ${e.message}`);
    console.error(e);
  } finally {
    isSaving = false;
    startPolling();
  }
}
/* ====== 全データ送信（外部連携用） ====== */
async function sendAllSeatPlayers() {
  if (Object.keys(seatMap).length === 0) {
    alert("登録された座席とプレイヤーがありません");
    return;
  }

  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seatMap, playerData, time: new Date().toISOString() }),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.ok) {
      alert("✅ すべてのデータを保存しました！");
      loadData();
    } else {
      alert("⚠ 保存に失敗しました");
    }
  } catch (err) {
    alert("❌ 保存エラー: " + err.message);
  }
}

/* ====== データ読み込み ====== */
async function refresh() {
  const loaded = await loadJson();
  if (loaded && loaded.seatMap) {
    seatMap = loaded.seatMap;
    playerData = loaded.playerData;
    renderSeats();
    displayMessage('☁ 最新データを読み込みました');
  }
}
/* ====== 汎用読み込み ====== */
async function loadJson(mode = '') {
  try {
    const url = mode ? `${GAS_URL}?mode=${mode}` : GAS_URL;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`loadJson (${mode}) error:`, error);
    return null;
  }
}

/* ====== 通常データ保存 or 履歴保存 ====== */
async function saveJson(data, mode = '', rev = 0) {
  try {
    const url = mode ? `${GAS_URL}?mode=${mode}` : GAS_URL;
    const response = await fetch(url, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, rev }),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error(`saveJson (${mode}) error:`, err);
    return null;
  }
}

/* ====== 実データ読み込み処理（seatMap/playerData） ====== */
async function loadData() {
  const data = await loadJson(); // ← mode未指定なので通常データ読み込み
  if (!data) {
    document.getElementById('result').textContent = "読み込みエラー: データ取得に失敗しました";
    return;
  }

  if (data.seatMap) {
    seatMap = data.seatMap;
    playerData = data.playerData || {};
    renderSeats();
    displayMessage('☁ 最新データを読み込みました');
  }

  document.getElementById('result').textContent = JSON.stringify(data, null, 2);
}
/* ====== データ読み込み詳細表示 ====== */
async function loadData() {
  const data = await loadJson();
  if (!data) {
    document.getElementById('result').textContent = "読み込みエラー: データ取得に失敗しました";
    return;
  }
  if (data.seatMap) {
    seatMap = data.seatMap;
    playerData = data.playerData || {};
    renderSeats();
    displayMessage('☁ 最新データを読み込みました');
  }
  document.getElementById('result').textContent = JSON.stringify(data, null, 2);
}

function addPlayer(seatId, playerId) {
  // ここで履歴を追加
  actionHistory.push({ type: 'addPlayer', seatId, playerId });
  saveActionHistory();              // ローカルにも保存
  sendActionHistoryToServer(actionHistory); // サーバーにも保存
}

async function loadActionHistoryFromServer() {
  try {
    const response = await fetch(GAS_URL);
    if (!response.ok) throw new Error('Network response was not ok');
    const data = await response.json();
    // GASのレスポンスは { actionHistory: [...] } の形なので
    actionHistory = data.actionHistory || [];
    console.log('操作履歴をサーバーから取得:', actionHistory);
  } catch (error) {
    console.error('操作履歴の取得に失敗:', error);
    actionHistory = [];
  }
}

/* ====== 初期化 ====== */
async function init() {
  loadFromLocalStorage();
  await loadActionHistoryFromServer();
  renderSeats();
  displayMessage('📢 起動しました');
  await initCamera();
  startPolling();
  console.log('初期化完了、現在の操作履歴:', actionHistory);
}
  // ボタンイベント登録
  document.getElementById('btnSave').onclick = store;
  document.getElementById('btnLoad').onclick = refresh;
  document.getElementById('btnUndo').onclick = undoAction;
  document.getElementById('btnSendAll').onclick = sendAllSeatPlayers;
  document.getElementById('btnRankingMode').onclick = () => navigate('ranking');
  document.getElementById('btnScanMode').onclick = () => navigate('scan');
  document.getElementById('btnConfirmRanking').onclick = confirmRanking;

window.onload = init;
