/**********************
 * ババ抜き大会管理 *
 **********************/

/* ====== 定数・グローバル変数 ====== */

// GAS（Google Apps Script）通信URL
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyfrLl2JNBYWEgQ7JK6m-lUiQCX08XwExf2fbnNArsXV4OKcIu-7Jf7fNAy0ljuBVg/exec';

// ポーリング間隔（20秒）
const POLL_INTERVAL_MS = 20000;

// QRコードスキャン連続読み取り防止猶予（1.5秒）
const SCAN_COOLDOWN_MS = 1500;

// カメラ、QRリーダー、状態管理用変数
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

// 座席マップ（座席ID → プレイヤーID配列）
let seatMap = {};

// プレイヤーデータ（プレイヤーID → 各種情報）
let playerData = {};

// 操作履歴（Undo用）
let actionHistory = [];

// メッセージ表示タイマー
let msgTimer = null;


/* ====== ユーティリティ関数 ====== */

/**
 * 指定ミリ秒待機
 * @param {number} ms 
 * @returns Promise<void>
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function loadAppScript() {
  init();
}

/**
 * 画面のメッセージ表示・非表示制御
 * @param {string} msg 
 */
function displayMessage(msg) {
  const area = document.getElementById('messageArea');
  if (!area) return;
  area.textContent = msg;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { area.textContent = ''; }, 3000);
}


/* ====== カメラ操作関連 ====== */

/**
 * 通常スキャン用カメラ停止
 */
async function stopCamera() {
  if (qrReader && qrActive) {
    await qrReader.stop();
    qrReader.clear();
    qrReader = null;
    qrActive = false;
  }
}

/**
 * 順位登録用カメラ停止
 */
async function stopRankingCamera() {
  if (rankingQrReader && rankingQrActive) {
    await rankingQrReader.stop();
    rankingQrReader.clear();
    rankingQrReader = null;
    rankingQrActive = false;
  }
}

/**
 * 両方のカメラ停止
 */
async function stopAllCameras() {
  await stopCamera();
  await stopRankingCamera();
}

/**
 * 通常スキャンモードのカメラ初期化・起動
 */
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
      errorMessage => { }
    );
    qrActive = true;
    displayMessage('📷 カメラ起動中（スキャンモード）');
  } catch (err) {
    console.error("QRコード初期化エラー:", err);
    displayMessage("❌ カメラ起動に失敗しました");
  }
}

/**
 * 順位登録モード用カメラ起動
 */
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

      } else if (decodedText.startsWith('player')) {
        handleRankingMode(decodedText);
      } else {
        displayMessage('⚠ 座席またはプレイヤーQRのみ有効です');
      }
    },
    errorMessage => { }
  ).then(() => {
    rankingQrActive = true;
    displayMessage('📷 カメラ起動中（順位登録モード）');
  }).catch(err => {
    console.error(err);
    displayMessage('❌ 順位登録用カメラ起動失敗');
  });
}


/* ====== QRコード読み取り処理 ====== */

/**
 * 通常スキャンモードのQRコード読み取り処理
 * @param {string} decodedText 
 */
function handleScanSuccess(decodedText) {
  const now = Date.now();
  if (decodedText === lastScannedText && now - lastScanTime < SCAN_COOLDOWN_MS) {
    return; // 連続読み取り防止
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

/**
 * 順位登録モードでのプレイヤー読み取り処理
 * @param {string} decodedText 
 */
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


/* ====== UI操作 ====== */

/**
 * モード切替（通常スキャン ⇔ 順位登録）
 * @param {string} section 'scan' or 'ranking'
 */
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

/**
 * 順位登録リストの生成・表示
 * @param {string} seatId 
 */
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

/**
 * ドラッグ＆ドロップで順位並べ替え可能にする処理
 * @param {HTMLElement} ul 
 */
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

/**
 * 順位確定ボタン処理 → 順位情報保存、レート計算、画面更新
 */
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


/* ====== 座席表示更新 ====== */

/**
 * 座席・プレイヤー一覧表示更新
 */
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

/**
 * プレイヤー削除処理（座席からの削除）
 * @param {string} seatId 
 * @param {string} playerId 
 */
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


/* ====== レート計算 ====== */

/**
 * プレイヤーのレート計算
 * @param {string[]} rankedIds 順位順プレイヤーID配列
 */
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

/**
 * 上位3名にタイトル付与
 */
function assignTitles() {
  Object.values(playerData).forEach(p => p.title = null);
  Object.entries(playerData)
    .sort((a, b) => b[1].rate - a[1].rate)
    .slice(0, 3)
    .forEach(([pid], idx) => {
      playerData[pid].title = ['👑 王者', '🥈 挑戦者', '🥉 鬼気迫る者'][idx];
    });
}

/**
 * 王者ID取得
 * @returns {string|null}
 */
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


/* ====== 操作履歴管理 ====== */

/**
 * Undo（元に戻す）機能
 */
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

/**
 * ローカルに操作履歴を保存
 */
function saveActionHistory() {
  localStorage.setItem('actionHistory', JSON.stringify(actionHistory));
}

/**
 * ローカルから操作履歴を読み込み
 */
function loadActionHistoryFromLocal() {
  const hist = localStorage.getItem('actionHistory');
  try {
    actionHistory = hist ? JSON.parse(hist) : [];
  } catch {
    actionHistory = [];
  }
}

/**
 * サーバーに操作履歴を送信（POST）
 * @param {Array} actionHistory 
 */
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

/**
 * サーバーから操作履歴を取得（GET）
 */
async function loadActionHistoryFromServer() {
  try {
    const res = await fetch(GAS_URL + '?mode=getActionHistory');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    actionHistory = data.actionHistory || [];
    saveActionHistory();
  } catch (e) {
    console.error('操作履歴読み込み失敗:', e);
  }
}


/* ====== ローカルストレージ連携 ====== */

/**
 * 座席マップ・プレイヤーデータ・操作履歴をローカル保存
 */
function saveToLocalStorage() {
  localStorage.setItem('seatMap', JSON.stringify(seatMap));
  localStorage.setItem('playerData', JSON.stringify(playerData));
  saveActionHistory();
}

/**
 * ローカルからデータ読み込み
 */
function loadFromLocalStorage() {
  try {
    const sm = localStorage.getItem('seatMap');
    const pd = localStorage.getItem('playerData');
    seatMap = sm ? JSON.parse(sm) : {};
    playerData = pd ? JSON.parse(pd) : {};
    loadActionHistoryFromLocal();
  } catch {
    seatMap = {};
    playerData = {};
    actionHistory = [];
  }
}


/* ====== GAS通信（JSONP + iframeハイブリッド） ====== */

/**
 * JSONPでデータをGET
 * @param {(data: any) => void} callback 
 */
function loadJsonP(callback) {
  const callbackName = 'jsonpCallback_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  window[callbackName] = function (data) {
    callback(data);
    delete window[callbackName];
    script.remove();
  };
  const script = document.createElement('script');
  const url = new URL(GAS_URL);
  url.searchParams.set('callback', callbackName);
  script.src = url.toString();
  document.body.appendChild(script);
}

/**
 * iframe経由POST送信
 * @param {string} url 
 * @param {any} data 
 * @param {(result:any) => void} onResult 
 */
function postViaIframe(url, data, onResult) {
  const iframeId = 'iframe-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.id = iframeId;
  document.body.appendChild(iframe);

  function receiveMessage(event) {
    if (event.source === iframe.contentWindow && event.data?.from === iframeId) {
      onResult(event.data.payload);
      window.removeEventListener('message', receiveMessage);
      setTimeout(() => document.body.removeChild(iframe), 0);
    }
  }

  window.addEventListener('message', receiveMessage);

  const form = document.createElement('form');
  form.style.display = 'none';
  form.method = 'POST';
  form.action = url;
  form.target = iframeId;

  const inputData = document.createElement('input');
  inputData.type = 'hidden';
  inputData.name = 'json';
  inputData.value = JSON.stringify(data);
  form.appendChild(inputData);

  const inputIframeId = document.createElement('input');
  inputIframeId.type = 'hidden';
  inputIframeId.name = '_iframeId';
  inputIframeId.value = iframeId;
  form.appendChild(inputIframeId);

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

/**
 * サーバーから最新データ取得（JSONP）
 * @returns Promise<void>
 */
function loadDataFromServer() {
  return new Promise((resolve, reject) => {
    loadJsonP(data => {
      if (!data) {
        reject(new Error('データ取得失敗'));
        return;
      }
      seatMap = data.seatMap || {};
      playerData = data.playerData || {};
      actionHistory = data.actionHistory || [];
      saveToLocalStorage();
      renderSeats();
      resolve();
    });
  });
}

/**
 * サーバーに全データ送信（iframe POST）
 */
function sendAllDataToServer() {
  if (isSaving) {
    displayMessage('現在保存処理中です');
    return;
  }
  isSaving = true;
  postViaIframe(GAS_URL, { seatMap, playerData, actionHistory }, result => {
    isSaving = false;
    if (result && result.ok) {
      displayMessage('✅ サーバーに全データを保存しました');
    } else {
      displayMessage('⚠ サーバー保存に失敗しました');
    }
  });
}


/* ====== ポーリング処理 ====== */

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (isSaving) return; // 多重起動防止
    try {
      await loadDataFromServer();
      displayMessage('☁ サーバーから最新データを取得しました');
    } catch (e) {
      console.error(e);
      displayMessage('⚠ サーバーデータ取得失敗');
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}


/* ====== 初期化処理 ====== */

/**
 * 初期化
 */
async function init() {
  // ローカルストレージからデータ読み込み
  loadFromLocalStorage();

  // UIレンダリング
  renderSeats();

  // カメラ起動（通常スキャンモード）
  await initCamera();

  // ポーリング開始
  startPolling();

  // ボタンイベント登録
  document.getElementById('btnSave').onclick = () => sendAllDataToServer();
  document.getElementById('btnLoad').onclick = () => loadDataFromServer().catch(() => displayMessage('サーバーデータ取得失敗'));
  document.getElementById('btnUndo').onclick = () => undoAction();
  document.getElementById('btnToggleMode').onclick = () => {
    if (isRankingMode) {
      navigate('scan');
    } else {
      navigate('ranking');
    }
  };
  document.getElementById('btnConfirmRanking').onclick = () => confirmRanking();

  displayMessage('🔰 初期化完了');
}

// ページロード後に初期化開始
window.addEventListener('load', () => {
  init();
});
