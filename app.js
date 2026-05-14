import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  remove,
  onValue,
  onChildAdded,
  off,
  runTransaction,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const $ = (id) => document.getElementById(id);
const SUITS = {
  S: { sym: "♠", name: "黑桃", color: "black", order: 4 },
  H: { sym: "♥", name: "紅心", color: "red", order: 3 },
  D: { sym: "♦", name: "方塊", color: "red", order: 2 },
  C: { sym: "♣", name: "梅花", color: "black", order: 1 },
  NT: { sym: "無王", name: "無王", color: "black", order: 5 }
};
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const POINT_RANKS = new Set(["A", "K", "Q", "J"]);
const BOT_NAMES = ["海豚", "燈塔", "浪花", "信風", "海鷗", "珊瑚"];
const PHASE = {
  BIDDING: "bidding",
  TRUMP: "trump",
  EXCHANGE: "exchange",
  SECRETARY: "secretary",
  PLAY: "play",
  ROUND_END: "round_end"
};
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDbOGwdYNY4mFG8Sgy8w_QdJpziWVoNx10",
  authDomain: "napoleon-secretary-3.firebaseapp.com",
  databaseURL: "https://napoleon-secretary-3-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "napoleon-secretary-3",
  storageBucket: "napoleon-secretary-3.firebasestorage.app",
  messagingSenderId: "189925612153",
  appId: "1:189925612153:web:a6db7ea4dc1e8945c152a8"
};

const STORAGE = {
  name: "napoleon.player.name.v1"
};

const appState = {
  firebaseApp: null,
  auth: null,
  db: null,
  uid: null,
  roomCode: null,
  room: null,
  roomUnsub: null,
  autoJoinCode: null,
  actionsAttached: false,
  actionQueue: [],
  processingActions: false,
  botTimer: null,
  presenceKey: null,
  selectedExchange: new Set(),
  connected: false
};

function init() {
  const savedName = localStorage.getItem(STORAGE.name);
  $("playerName").value = savedName || randomGuestName();
  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) {
    appState.autoJoinCode = roomFromUrl.toUpperCase();
    $("roomCode").value = appState.autoJoinCode;
  }

  $("btnConnect").addEventListener("click", connectFirebase);
  $("btnCreateRoom").addEventListener("click", createRoom);
  $("btnJoinRoom").addEventListener("click", joinRoomFromInput);
  $("btnLeave").addEventListener("click", leaveRoom);
  $("btnCopyLink").addEventListener("click", copyInviteLink);
  $("btnAddBot").addEventListener("click", () => hostAddBot());
  $("btnRemoveBot").addEventListener("click", () => hostRemoveBot());
  $("btnStartGame").addEventListener("click", hostStartGame);
  $("btnRules").addEventListener("click", () => $("rulesDialog").showModal());
  $("closeRules").addEventListener("click", () => $("rulesDialog").close());
  $("difficulty").addEventListener("input", () => {
    $("difficultyLabel").textContent = $("difficulty").value;
    syncLobbySettingsSoon();
  });
  for (const id of ["buriedMode", "leadMode", "trumpMode", "jokerLowLast3", "summonJokers", "allowSelfSecretary"]) {
    $(id).addEventListener("change", syncLobbySettingsSoon);
  }
  renderConnectState();
  window.setTimeout(() => connectFirebase(), 250);
}

function randomGuestName() {
  return `旅人${Math.floor(100 + Math.random() * 900)}`;
}

function sanitizeName(name) {
  const cleaned = String(name || "").trim().replace(/[<>]/g, "").slice(0, 12);
  return cleaned || randomGuestName();
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 2200);
}

function setStatus(message) {
  $("connectStatus").textContent = message;
}

function parseFirebaseConfig() {
  const config = { ...FIREBASE_CONFIG };
  for (const key of ["apiKey", "authDomain", "databaseURL", "projectId", "appId"]) {
    if (!config[key]) throw new Error(`Firebase 設定缺少 ${key}。`);
  }
  return config;
}

async function connectFirebase() {
  try {
    const config = parseFirebaseConfig();
    const name = sanitizeName($("playerName").value);
    $("playerName").value = name;
    localStorage.setItem(STORAGE.name, name);
    setStatus("連線中...");
    if (!appState.firebaseApp) {
      appState.firebaseApp = initializeApp(config);
      appState.auth = getAuth(appState.firebaseApp);
      appState.db = getDatabase(appState.firebaseApp);
    }
    const credential = await signInAnonymously(appState.auth);
    appState.uid = credential.user.uid;
    appState.connected = true;
    renderConnectState();
    $("btnConnect").textContent = "已連線 Firebase";
    setStatus(`已連線：${name}`);
    toast("Firebase 已連線");
    if (appState.autoJoinCode && !appState.roomCode) {
      const code = appState.autoJoinCode;
      appState.autoJoinCode = null;
      $("roomCode").value = code;
      setStatus(`已連線，正在加入房間 ${code}...`);
      await joinRoom(code);
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Firebase 連線失敗。");
    toast("連線失敗，請檢查設定與網路");
  }
}

function renderConnectState() {
  $("btnCreateRoom").disabled = !appState.connected;
  $("btnJoinRoom").disabled = !appState.connected;
}

function roomRef(path = "") {
  return ref(appState.db, `rooms/${appState.roomCode}${path ? "/" + path : ""}`);
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

async function createRoom() {
  if (!appState.connected) return toast("請先連線 Firebase");
  const name = sanitizeName($("playerName").value);
  localStorage.setItem(STORAGE.name, name);
  let code = generateRoomCode();
  for (let i = 0; i < 8; i += 1) {
    const snap = await get(ref(appState.db, `rooms/${code}`));
    if (!snap.exists()) break;
    code = generateRoomCode();
  }
  const now = Date.now();
  const room = {
    meta: {
      code,
      hostUid: appState.uid,
      status: "lobby",
      createdAt: now,
      updatedAt: now
    },
    lobby: {
      dealer: 0,
      settings: readSettingsFromUI(),
      seats: {
        0: makeHumanSeat(0, appState.uid, name)
      }
    },
    game: null
  };
  appState.roomCode = code;
  await set(roomRef(), room);
  await enterRoom(code);
  toast(`已建立房間 ${code}`);
}

function makeHumanSeat(seat, uid, name) {
  return { seat, uid, name, type: "human", joinedAt: Date.now(), online: true, score: 0 };
}

function makeBotSeat(seat, index = seat) {
  return {
    seat,
    uid: `bot-${seat}-${Date.now()}`,
    name: BOT_NAMES[index % BOT_NAMES.length],
    type: "bot",
    joinedAt: Date.now(),
    online: true,
    score: 0
  };
}

async function joinRoomFromInput() {
  if (!appState.connected) return toast("請先連線 Firebase");
  const code = $("roomCode").value.trim().toUpperCase();
  if (!code) return toast("請輸入房號，或按建立新房");
  await joinRoom(code);
}

async function joinRoom(code) {
  const roomPath = ref(appState.db, `rooms/${code}`);
  const snap = await get(roomPath);
  if (!snap.exists()) return toast("找不到房間");
  const room = snap.val();
  if (room.meta?.status !== "lobby") return toast("這個房間已開局，暫不支援中途加入");
  const name = sanitizeName($("playerName").value);
  localStorage.setItem(STORAGE.name, name);
  const seatsRef = ref(appState.db, `rooms/${code}/lobby/seats`);
  const result = await runTransaction(seatsRef, (seats) => {
    seats = seats || {};
    for (const key of Object.keys(seats)) {
      if (seats[key]?.uid === appState.uid) {
        seats[key].name = name;
        seats[key].online = true;
        return seats;
      }
    }
    for (let seat = 0; seat < 5; seat += 1) {
      if (!seats[seat]) {
        seats[seat] = makeHumanSeat(seat, appState.uid, name);
        return seats;
      }
    }
    return undefined;
  });
  if (!result.committed) return toast("房間已滿");
  await update(ref(appState.db, `rooms/${code}/meta`), { updatedAt: Date.now() });
  await enterRoom(code);
  toast(`已加入房間 ${code}`);
}

async function enterRoom(code) {
  detachRoom();
  appState.roomCode = code;
  $("roomCode").value = code;
  const params = new URLSearchParams(location.search);
  params.set("room", code);
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
  $("connectView").classList.add("hidden");
  $("btnLeave").classList.remove("hidden");
  appState.roomUnsub = onValue(roomRef(), (snapshot) => {
    appState.room = snapshot.val();
    if (!appState.room) {
      toast("房間已不存在");
      leaveRoom(false);
      return;
    }
    markOnlinePresence();
    renderRoom();
    scheduleHostAutomation();
  });
  attachActionListener();
}

function detachRoom() {
  if (appState.roomUnsub) appState.roomUnsub();
  if (appState.db && appState.roomCode && appState.actionsAttached) {
    off(ref(appState.db, `rooms/${appState.roomCode}/actions`));
  }
  appState.actionsAttached = false;
  appState.roomUnsub = null;
  appState.room = null;
  appState.actionQueue = [];
  appState.processingActions = false;
  appState.presenceKey = null;
  clearTimeout(appState.botTimer);
}

async function leaveRoom(updateSeat = true) {
  if (updateSeat && appState.roomCode && appState.room) {
    const seat = myLobbySeat();
    if (seat !== null && appState.room.meta?.status === "lobby") {
      await remove(roomRef(`lobby/seats/${seat}`)).catch(() => {});
    }
  }
  detachRoom();
  appState.roomCode = null;
  appState.selectedExchange.clear();
  history.replaceState(null, "", location.pathname);
  $("connectView").classList.remove("hidden");
  $("lobbyView").classList.add("hidden");
  $("gameView").classList.add("hidden");
  $("btnLeave").classList.add("hidden");
}

function markOnlinePresence() {
  const seat = myLobbySeat();
  if (seat === null || !appState.roomCode) return;
  const key = `${appState.roomCode}:${seat}`;
  if (appState.presenceKey === key) return;
  appState.presenceKey = key;
  const seatRef = roomRef(`lobby/seats/${seat}`);
  update(seatRef, { online: true, lastSeen: serverTimestamp() }).catch(() => {});
  onDisconnect(seatRef).update({ online: false, lastSeen: serverTimestamp() }).catch(() => {});
}

function myLobbySeat() {
  const seats = appState.room?.lobby?.seats || {};
  for (const [seat, value] of Object.entries(seats)) {
    if (value?.uid === appState.uid) return Number(seat);
  }
  return null;
}

function myGameSeat(game = appState.room?.game) {
  if (!game?.players) return null;
  const found = game.players.find((p) => p?.uid === appState.uid);
  return found ? found.seat : null;
}

function isHost() {
  return appState.room?.meta?.hostUid === appState.uid;
}

function renderRoom() {
  const status = appState.room?.meta?.status;
  if (status === "lobby") {
    $("lobbyView").classList.remove("hidden");
    $("gameView").classList.add("hidden");
    renderLobby();
  } else {
    $("lobbyView").classList.add("hidden");
    $("gameView").classList.remove("hidden");
    renderGame();
  }
}

function renderLobby() {
  const room = appState.room;
  $("lobbyRoomCode").textContent = room.meta.code;
  const inviteUrl = buildInviteLink(room.meta.code);
  $("lobbyShare").textContent = `房號 ${room.meta.code}：分享連結或掃描 QR Code 加入。`;
  $("inviteLinkText").textContent = inviteUrl;
  $("inviteQr").src = buildQrCodeUrl(inviteUrl);
  $("inviteQr").alt = `房間 ${room.meta.code} 加入連結 QR Code`;
  const seats = room.lobby?.seats || {};
  const ordered = Array.from({ length: 5 }, (_, i) => seats[i] || null);
  $("lobbySeats").innerHTML = ordered.map((seat, i) => {
    if (!seat) return `<div class="lobby-seat"><div><b>座位 ${i + 1}</b><small>空位</small></div><span class="tag">等待</span></div>`;
    const mine = seat.uid === appState.uid ? "（你）" : "";
    const type = seat.type === "bot" ? "電腦" : "真人";
    const online = seat.online === false ? "離線" : "在線";
    return `<div class="lobby-seat"><div><b>${escapeHtml(seat.name)}${mine}</b><small>座位 ${i + 1}・${type}・${online}</small></div><span class="tag ${seat.type === "bot" ? "gold" : ""}">${seat.score || 0} 分</span></div>`;
  }).join("");

  applySettingsToUI(room.lobby?.settings || defaultSettings());
  const host = isHost();
  document.querySelectorAll(".host-only").forEach((el) => el.classList.toggle("hidden", !host));
  for (const id of ["difficulty", "buriedMode", "leadMode", "trumpMode", "jokerLowLast3", "summonJokers", "allowSelfSecretary"]) {
    $(id).disabled = !host;
  }
  const filled = ordered.filter(Boolean).length;
  $("btnStartGame").disabled = !host || filled !== 5;
  $("lobbyNotice").textContent = host
    ? (filled === 5 ? "座位已滿，可以開始。" : `目前 ${filled}/5 人，可等待朋友或補電腦。`)
    : "等待房主調整規則並開始。";
}

function defaultSettings() {
  return {
    difficulty: 10,
    buriedMode: "addContract",
    leadMode: "next",
    trumpMode: "suitOnly",
    jokerLowLast3: true,
    summonJokers: true,
    allowSelfSecretary: false
  };
}

function readSettingsFromUI() {
  return {
    difficulty: Number($("difficulty").value),
    buriedMode: $("buriedMode").value,
    leadMode: $("leadMode").value,
    trumpMode: $("trumpMode").value,
    jokerLowLast3: $("jokerLowLast3").checked,
    summonJokers: $("summonJokers").checked,
    allowSelfSecretary: $("allowSelfSecretary").checked
  };
}

function applySettingsToUI(settings) {
  $("difficulty").value = settings.difficulty ?? 10;
  $("difficultyLabel").textContent = settings.difficulty ?? 10;
  $("buriedMode").value = settings.buriedMode || "addContract";
  $("leadMode").value = settings.leadMode || "next";
  $("trumpMode").value = settings.trumpMode || "suitOnly";
  $("jokerLowLast3").checked = settings.jokerLowLast3 !== false;
  $("summonJokers").checked = settings.summonJokers !== false;
  $("allowSelfSecretary").checked = !!settings.allowSelfSecretary;
}

let settingsTimer = null;
function syncLobbySettingsSoon() {
  if (!isHost() || appState.room?.meta?.status !== "lobby") return;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    update(roomRef("lobby/settings"), readSettingsFromUI()).catch(console.error);
  }, 180);
}

async function hostAddBot() {
  if (!isHost()) return;
  const seatsRef = roomRef("lobby/seats");
  await runTransaction(seatsRef, (seats) => {
    seats = seats || {};
    for (let seat = 0; seat < 5; seat += 1) {
      if (!seats[seat]) {
        seats[seat] = makeBotSeat(seat, seat);
        return seats;
      }
    }
    return seats;
  });
}

async function hostRemoveBot() {
  if (!isHost()) return;
  const seatsRef = roomRef("lobby/seats");
  await runTransaction(seatsRef, (seats) => {
    seats = seats || {};
    for (let seat = 4; seat >= 0; seat -= 1) {
      if (seats[seat]?.type === "bot") {
        delete seats[seat];
        return seats;
      }
    }
    return seats;
  });
}

async function hostStartGame() {
  if (!isHost()) return;
  const seats = appState.room?.lobby?.seats || {};
  const players = Array.from({ length: 5 }, (_, seat) => seats[seat]).filter(Boolean);
  if (players.length !== 5) return toast("需要剛好 5 位玩家或電腦");
  const dealer = appState.room?.lobby?.dealer || 0;
  const scores = Array.from({ length: 5 }, (_, seat) => seats[seat]?.score || 0);
  const game = createGame(players, appState.room.lobby.settings || defaultSettings(), dealer, scores);
  await update(roomRef(), {
    "meta/status": "game",
    "meta/updatedAt": Date.now(),
    game
  });
}

async function hostNextRound() {
  if (!isHost() || !appState.room?.game) return;
  const oldGame = appState.room.game;
  const scores = oldGame.players.map((p) => p.score || 0);
  const seats = appState.room.lobby?.seats || {};
  const players = Array.from({ length: 5 }, (_, seat) => seats[seat]).filter(Boolean);
  if (players.length !== 5) return toast("座位不足，請回大廳重新補人");
  const nextDealer = ((oldGame.dealer || 0) + 1) % 5;
  const game = createGame(players, appState.room.lobby.settings || oldGame.settings || defaultSettings(), nextDealer, scores);
  const scoreUpdates = {};
  scores.forEach((score, seat) => { scoreUpdates[`lobby/seats/${seat}/score`] = score; });
  await update(roomRef(), {
    ...scoreUpdates,
    "lobby/dealer": nextDealer,
    "meta/status": "game",
    "meta/updatedAt": Date.now(),
    game
  });
}

function makeDeck() {
  const cards = [];
  for (const suit of ["S", "H", "D", "C"]) {
    for (const rank of RANKS) {
      cards.push({ id: suit + rank, suit, rank, value: RANK_VALUE[rank], point: POINT_RANKS.has(rank), joker: false });
    }
  }
  cards.push({ id: "BJ", suit: null, rank: "大鬼", value: 16, point: false, joker: true, bigJoker: true });
  cards.push({ id: "RJ", suit: null, rank: "小鬼", value: 15, point: false, joker: true, smallJoker: true });
  return cards;
}

function createGame(lobbyPlayers, settings, dealer = 0, scores = [0, 0, 0, 0, 0]) {
  const deck = makeDeck();
  shuffle(deck);
  const kitty = deck.slice(50);
  const players = Array.from({ length: 5 }, (_, seat) => {
    const lp = lobbyPlayers.find((p) => Number(p.seat) === seat) || lobbyPlayers[seat];
    return {
      seat,
      uid: lp.uid,
      name: lp.name,
      type: lp.type,
      hand: sortHand(deck.slice(seat * 10, seat * 10 + 10)),
      passed: false,
      lastBid: null,
      score: scores[seat] || 0
    };
  });
  return {
    phase: PHASE.BIDDING,
    settings,
    dealer,
    players,
    kitty,
    buried: [],
    napoleon: null,
    secretaryOwner: null,
    secretaryCardId: null,
    secretaryRevealed: false,
    trump: null,
    bid: null,
    contract: null,
    currentPlayer: dealer,
    leader: dealer,
    trick: [],
    trickNo: 0,
    captured: [[], [], [], [], []],
    requestedId: null,
    bidding: { highest: null, turn: dealer },
    log: [`第 ${dealer + 1} 家先叫牌。最低 9 頭，最高者成為拿破崙。`],
    createdAt: Date.now()
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function sortHand(hand) {
  const suitOrder = { S: 4, H: 3, D: 2, C: 1, null: 9 };
  return [...hand].sort((a, b) => {
    const aj = a.joker ? 100 + (a.bigJoker ? 2 : 1) : 0;
    const bj = b.joker ? 100 + (b.bigJoker ? 2 : 1) : 0;
    if (aj || bj) return bj - aj;
    if (suitOrder[a.suit] !== suitOrder[b.suit]) return suitOrder[b.suit] - suitOrder[a.suit];
    return b.value - a.value;
  });
}

function appendLog(game, message) {
  game.log = [message, ...(game.log || [])].slice(0, 90);
}

function attachActionListener() {
  if (appState.actionsAttached) return;
  appState.actionsAttached = true;
  onChildAdded(ref(appState.db, `rooms/${appState.roomCode}/actions`), (snapshot) => {
    if (!isHost()) return;
    appState.actionQueue.push({ key: snapshot.key, action: snapshot.val() });
    processActionQueue();
  });
}

async function processActionQueue() {
  if (appState.processingActions || !isHost()) return;
  appState.processingActions = true;
  while (appState.actionQueue.length) {
    const item = appState.actionQueue.shift();
    const gameSnap = await get(roomRef("game"));
    const game = normalizeGame(gameSnap.val());
    let changed = false;
    if (game) changed = applyAction(game, item.action);
    if (changed) await saveGame(game);
    await remove(ref(appState.db, `rooms/${appState.roomCode}/actions/${item.key}`)).catch(() => {});
  }
  appState.processingActions = false;
}

async function submitAction(type, payload = {}) {
  const game = appState.room?.game;
  const seat = myGameSeat(game);
  if (seat === null) return toast("你不在此局中");
  await push(ref(appState.db, `rooms/${appState.roomCode}/actions`), {
    uid: appState.uid,
    seat,
    type,
    payload,
    createdAt: Date.now()
  });
}

function normalizeGame(game) {
  if (!game) return game;
  if (!Array.isArray(game.trick)) game.trick = [];
  if (!Array.isArray(game.buried)) game.buried = [];
  if (!Array.isArray(game.kitty)) game.kitty = [];
  if (!Array.isArray(game.log)) game.log = [];
  if (!Array.isArray(game.players)) game.players = [];
  game.players.forEach((p) => { if (p && !Array.isArray(p.hand)) p.hand = []; });
  ensureCaptured(game);
  return game;
}

function ensureCaptured(game) {
  if (!Array.isArray(game.captured)) game.captured = [];
  for (let i = 0; i < 5; i += 1) {
    if (!Array.isArray(game.captured[i])) game.captured[i] = [];
  }
}

function applyAction(game, action) {
  normalizeGame(game);
  const seat = Number(action.seat);
  const player = game.players?.[seat];
  if (!player) return false;
  if (player.type === "human" && player.uid !== action.uid) return false;

  if (game.phase === PHASE.BIDDING && game.currentPlayer === seat) {
    if (action.type === "pass") return passBid(game, seat);
    if (action.type === "bid") return makeBid(game, seat, Number(action.payload?.amount));
  }
  if (game.phase === PHASE.TRUMP && game.napoleon === seat && action.type === "chooseTrump") {
    return chooseTrump(game, seat, action.payload?.trump);
  }
  if (game.phase === PHASE.EXCHANGE && game.napoleon === seat && action.type === "exchange") {
    return exchangeCards(game, seat, action.payload?.cardIds || []);
  }
  if (game.phase === PHASE.SECRETARY && game.napoleon === seat && action.type === "chooseSecretary") {
    return chooseSecretary(game, seat, action.payload?.cardId);
  }
  if (game.phase === PHASE.PLAY && game.currentPlayer === seat && action.type === "playCard") {
    return playCard(game, seat, action.payload?.cardId, action.payload?.leadSuit || null);
  }
  return false;
}

function passBid(game, seat) {
  const p = game.players[seat];
  p.passed = true;
  p.lastBid = "Pass";
  appendLog(game, `${p.name} Pass。`);
  return advanceBidding(game);
}

function makeBid(game, seat, amount) {
  const high = game.bidding?.highest?.amount || 8;
  if (!Number.isInteger(amount) || amount < 9 || amount > 16 || amount <= high) return false;
  const p = game.players[seat];
  p.lastBid = amount;
  game.bidding.highest = { seat, amount };
  appendLog(game, `${p.name} 叫 ${amount} 頭。`);
  if (amount === 16) return finishBidding(game);
  return advanceBidding(game);
}

function advanceBidding(game) {
  const active = game.players.filter((p) => !p.passed);
  if (game.bidding.highest && active.length <= 1) return finishBidding(game);
  if (!game.bidding.highest && active.length === 0) {
    game.phase = PHASE.ROUND_END;
    game.currentPlayer = null;
    appendLog(game, "全部 Pass，本局流局。房主可開始下一局。");
    return true;
  }
  let next = (game.currentPlayer + 1) % 5;
  for (let guard = 0; guard < 5; guard += 1) {
    if (!game.players[next].passed) break;
    next = (next + 1) % 5;
  }
  game.currentPlayer = next;
  game.bidding.turn = next;
  return true;
}

function finishBidding(game) {
  const high = game.bidding.highest;
  if (!high) return false;
  game.napoleon = high.seat;
  game.bid = high.amount;
  game.phase = PHASE.TRUMP;
  game.currentPlayer = high.seat;
  game.players.forEach((p) => { p.passed = false; });
  appendLog(game, `${game.players[high.seat].name} 成為拿破崙，叫 ${high.amount} 頭。`);
  return true;
}

function chooseTrump(game, seat, trump) {
  const allowed = game.settings?.trumpMode === "allowNoTrump" ? ["S", "H", "D", "C", "NT"] : ["S", "H", "D", "C"];
  if (!allowed.includes(trump)) return false;
  game.trump = trump;
  const player = game.players[seat];
  player.hand = sortHand([...player.hand, ...(game.kitty || [])]);
  game.phase = PHASE.EXCHANGE;
  game.currentPlayer = seat;
  appendLog(game, `${player.name} 選擇 ${suitName(trump)} 為王牌，拿起 4 張底牌。`);
  return true;
}

function exchangeCards(game, seat, cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length !== 4 || new Set(cardIds).size !== 4) return false;
  const player = game.players[seat];
  const ids = new Set(cardIds);
  const buried = [];
  for (const id of ids) {
    const card = player.hand.find((c) => c.id === id);
    if (!card) return false;
    buried.push(card);
  }
  player.hand = sortHand(player.hand.filter((c) => !ids.has(c.id)));
  game.buried = buried;
  const buriedHeads = countPoints(buried);
  game.contract = Math.min(16, game.bid + (game.settings?.buriedMode === "addContract" ? buriedHeads : 0));
  game.phase = PHASE.SECRETARY;
  game.currentPlayer = seat;
  appendLog(game, `${player.name} 蓋掉 4 張底牌；底牌有 ${buriedHeads} 張頭，成約為 ${game.contract} 頭。`);
  return true;
}

function chooseSecretary(game, seat, cardId) {
  if (!cardId) return false;
  if (game.buried?.some((c) => c.id === cardId)) return false;
  const owner = game.players.find((p) => p.hand.some((c) => c.id === cardId));
  if (!owner) return false;
  if (!game.settings?.allowSelfSecretary && owner.seat === seat) return false;
  game.secretaryCardId = cardId;
  game.secretaryOwner = owner.seat;
  game.secretaryRevealed = owner.seat === seat;
  game.phase = PHASE.PLAY;
  game.leader = game.settings?.leadMode === "napoleon" ? seat : (seat + 1) % 5;
  game.currentPlayer = game.leader;
  game.trick = [];
  game.trickNo = 0;
  game.requestedId = null;
  const revealText = owner.seat === seat ? "拿破崙自己持有，進入獨裁局。" : "秘書身分先保密，打出秘書牌時公開。";
  appendLog(game, `${game.players[seat].name} 指定 ${cardLong(findCardById(cardId))} 為秘書牌；${revealText}`);
  return true;
}

function playCard(game, seat, cardId, chosenLeadSuit = null) {
  const player = game.players[seat];
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return false;
  const legal = legalCardsFor(game, seat).map((c) => c.id);
  if (!legal.includes(cardId)) return false;

  let leadSuit = null;
  if (game.trick.length === 0) {
    if (card.joker) {
      leadSuit = ["S", "H", "D", "C"].includes(chosenLeadSuit) ? chosenLeadSuit : null;
    } else {
      leadSuit = card.suit;
    }
    game.requestedId = summonTargetForLead(game, card);
    if (game.requestedId) appendLog(game, `${player.name} 以 ${cardLong(card)} 召 ${game.requestedId === "BJ" ? "大鬼" : "小鬼"}。`);
  }

  player.hand = sortHand(player.hand.filter((c) => c.id !== cardId));
  game.trick.push({ seat, card, leadSuit });
  if (card.id === game.secretaryCardId && !game.secretaryRevealed) {
    game.secretaryRevealed = true;
    appendLog(game, `${player.name} 打出秘書牌，秘書公開！`);
  }
  appendLog(game, `${player.name} 出 ${cardLong(card)}。`);

  if (game.trick.length === 5) {
    settleTrick(game);
  } else {
    game.currentPlayer = (seat + 1) % 5;
  }
  return true;
}

function summonTargetForLead(game, card) {
  if (!game.settings?.summonJokers) return null;
  if (game.trickNo >= 3) return null;
  if (!game.trump || game.trump === "NT") return null;
  if (card.suit !== game.trump) return null;
  if (card.rank === "3") return "BJ";
  if (card.rank === "2") return "RJ";
  return null;
}

function legalCardsFor(game, seat) {
  const hand = game.players[seat]?.hand || [];
  if (game.phase !== PHASE.PLAY || game.currentPlayer !== seat) return [];
  if (game.trick.length === 0) return hand;
  if (game.requestedId && hand.some((c) => c.id === game.requestedId)) {
    return hand.filter((c) => c.id === game.requestedId);
  }
  const leadSuit = effectiveLeadSuit(game.trick);
  if (!leadSuit) return hand;
  const suited = hand.filter((c) => !c.joker && c.suit === leadSuit);
  return suited.length ? suited : hand;
}

function effectiveLeadSuit(trick) {
  if (!trick?.length) return null;
  const first = trick[0];
  if (first.leadSuit) return first.leadSuit;
  if (first.card?.joker) return null;
  return first.card?.suit || null;
}

function settleTrick(game) {
  const leadSuit = effectiveLeadSuit(game.trick);
  let best = game.trick[0];
  for (const play of game.trick.slice(1)) {
    if (cardStrength(play.card, game, leadSuit) > cardStrength(best.card, game, leadSuit)) best = play;
  }
  const winner = best.seat;
  const heads = countPoints(game.trick.map((p) => p.card));
  game.captured[winner] = [...(game.captured[winner] || []), ...game.trick.map((p) => p.card)];
  appendLog(game, `${game.players[winner].name} 以 ${cardLong(best.card)} 吃下第 ${game.trickNo + 1} 墩，取得 ${heads} 張頭。`);
  game.trick = [];
  game.requestedId = null;
  game.trickNo += 1;
  if (game.trickNo >= 10) {
    endRound(game);
  } else {
    game.leader = winner;
    game.currentPlayer = winner;
  }
}

function cardStrength(card, game, leadSuit) {
  if (card.id === game.secretaryCardId) return 10000;
  if (card.joker) {
    if (game.settings?.jokerLowLast3 && game.trickNo >= 7) return card.bigJoker ? 20 : 10;
    return card.bigJoker ? 9000 : 8500;
  }
  if (game.trump && game.trump !== "NT" && card.suit === game.trump) return 5000 + card.value;
  if (leadSuit && card.suit === leadSuit) return 2000 + card.value;
  return card.value;
}

function endRound(game) {
  const teamSeats = new Set([game.napoleon]);
  if (game.secretaryOwner !== null && game.secretaryOwner !== undefined) teamSeats.add(game.secretaryOwner);
  let teamHeads = 0;
  let defenderHeads = 0;
  game.captured.forEach((cards, seat) => {
    const heads = countPoints(cards || []);
    if (teamSeats.has(seat)) teamHeads += heads;
    else defenderHeads += heads;
  });
  const buriedHeads = countPoints(game.buried || []);
  if (game.settings?.buriedMode === "defenders") defenderHeads += buriedHeads;
  else if (game.settings?.buriedMode !== "addContract") teamHeads += buriedHeads;

  const made = teamHeads >= game.contract;
  const diff = Math.abs(teamHeads - game.contract);
  const solo = game.secretaryOwner === game.napoleon;
  const base = (solo ? 160 : 100) + diff * 10;
  const napDelta = made ? base : -base;
  const secDelta = made ? Math.round(base / 2) : -Math.round(base / 2);
  const defDelta = made ? -Math.round(base / 2) : Math.round(base / 2);
  game.players.forEach((p) => {
    if (p.seat === game.napoleon) p.score += napDelta;
    else if (p.seat === game.secretaryOwner) p.score += secDelta;
    else p.score += defDelta;
  });
  game.phase = PHASE.ROUND_END;
  game.currentPlayer = null;
  game.secretaryRevealed = true;
  appendLog(game, `${made ? "拿破崙軍達標" : "聯合國守成"}：拿破崙軍 ${teamHeads} 頭，成約 ${game.contract} 頭。`);
}

async function saveGame(game) {
  await update(roomRef(), {
    game,
    "meta/updatedAt": Date.now()
  });
  if (game.phase === PHASE.ROUND_END) {
    const scoreUpdates = {};
    game.players.forEach((p) => { scoreUpdates[`lobby/seats/${p.seat}/score`] = p.score || 0; });
    await update(roomRef(), scoreUpdates).catch(() => {});
  }
}

function scheduleHostAutomation() {
  clearTimeout(appState.botTimer);
  if (!isHost()) return;
  const game = normalizeGame(appState.room?.game);
  if (!game || appState.room?.meta?.status !== "game") return;
  const action = getBotAction(game);
  if (!action) return;
  appState.botTimer = setTimeout(async () => {
    const snap = await get(roomRef("game"));
    const latest = normalizeGame(snap.val());
    const botAction = getBotAction(latest);
    if (!botAction) return;
    const changed = applyAction(latest, botAction);
    if (changed) await saveGame(latest);
  }, 650 + Math.random() * 550);
}

function getBotAction(game) {
  if (!game || game.phase === PHASE.ROUND_END) return null;
  const seat = game.currentPlayer;
  const player = game.players?.[seat];
  if (!player || player.type !== "bot") return null;
  if (game.phase === PHASE.BIDDING) return aiBidAction(game, seat);
  if (game.phase === PHASE.TRUMP && game.napoleon === seat) return { uid: player.uid, seat, type: "chooseTrump", payload: { trump: aiChooseTrump(game, seat) } };
  if (game.phase === PHASE.EXCHANGE && game.napoleon === seat) return { uid: player.uid, seat, type: "exchange", payload: { cardIds: aiChooseBuried(game, seat) } };
  if (game.phase === PHASE.SECRETARY && game.napoleon === seat) return { uid: player.uid, seat, type: "chooseSecretary", payload: { cardId: aiChooseSecretary(game, seat) } };
  if (game.phase === PHASE.PLAY) {
    const card = aiChoosePlay(game, seat);
    return { uid: player.uid, seat, type: "playCard", payload: { cardId: card.id, leadSuit: card.suit || aiBestSuit(game.players[seat].hand) } };
  }
  return null;
}

function aiBidAction(game, seat) {
  const player = game.players[seat];
  const high = game.bidding?.highest?.amount || 8;
  const estimate = estimateHand(player.hand, game.settings);
  const noise = (Math.random() - 0.5) * (22 - (game.settings?.difficulty || 10)) / 6;
  const target = Math.max(8, Math.min(16, Math.round(estimate + noise)));
  if (target > high && target >= 9) return { uid: player.uid, seat, type: "bid", payload: { amount: target } };
  return { uid: player.uid, seat, type: "pass", payload: {} };
}

function estimateHand(hand, settings) {
  const points = countPoints(hand);
  const jokers = hand.filter((c) => c.joker).length;
  const suitCounts = { S: 0, H: 0, D: 0, C: 0 };
  hand.forEach((c) => { if (c.suit) suitCounts[c.suit] += c.value >= 10 ? 1.5 : 1; });
  const longest = Math.max(...Object.values(suitCounts));
  const highCards = hand.filter((c) => c.joker || c.value >= 12).length;
  return 7 + points * 0.55 + jokers * 1.5 + longest * 0.25 + highCards * 0.28 + (settings?.difficulty || 10) / 30;
}

function aiChooseTrump(game, seat) {
  const hand = game.players[seat].hand;
  const scores = { S: 0, H: 0, D: 0, C: 0, NT: 0 };
  for (const card of hand) {
    if (card.joker) scores.NT += 2.5;
    else scores[card.suit] += card.value + (card.point ? 2 : 0);
  }
  let best = Object.entries(scores).filter(([s]) => game.settings?.trumpMode === "allowNoTrump" || s !== "NT").sort((a, b) => b[1] - a[1])[0][0];
  return best;
}

function aiChooseBuried(game, seat) {
  const hand = game.players[seat].hand;
  const sorted = [...hand].sort((a, b) => aiDiscardValue(a, game) - aiDiscardValue(b, game));
  return sorted.slice(0, 4).map((c) => c.id);
}

function aiDiscardValue(card, game) {
  let value = card.value;
  if (card.point) value += 8;
  if (card.id === game.secretaryCardId) value += 100;
  if (card.joker) value += 25;
  if (game.trump && card.suit === game.trump) value += 8;
  return value;
}

function aiChooseSecretary(game, seat) {
  const own = new Set(game.players[seat].hand.map((c) => c.id));
  const buried = new Set((game.buried || []).map((c) => c.id));
  const candidates = makeDeck().filter((c) => !buried.has(c.id) && (game.settings?.allowSelfSecretary || !own.has(c.id)));
  const preferred = candidates.filter((c) => c.joker || c.point || (game.trump !== "NT" && c.suit === game.trump)).sort((a, b) => cardSecretaryValue(b, game) - cardSecretaryValue(a, game));
  return (preferred[0] || candidates[0]).id;
}

function cardSecretaryValue(card, game) {
  if (card.joker) return card.bigJoker ? 100 : 90;
  return (game.trump !== "NT" && card.suit === game.trump ? 30 : 0) + card.value + (card.point ? 20 : 0);
}

function aiChoosePlay(game, seat) {
  const legal = legalCardsFor(game, seat);
  const player = game.players[seat];
  const difficulty = game.settings?.difficulty || 10;
  if (Math.random() > difficulty / 22) return randomItem(legal);
  const myTeam = teamOf(game, seat);
  const sortedLow = [...legal].sort((a, b) => cardPlayValue(a, game) - cardPlayValue(b, game));
  if (game.trick.length === 0) {
    const strong = [...legal].sort((a, b) => cardPlayValue(b, game) - cardPlayValue(a, game));
    if (player.hand.filter((c) => c.point).length >= 3 && Math.random() < difficulty / 25) return strong[0];
    return sortedLow[0];
  }
  const currentWinner = currentTrickWinner(game);
  const winnerTeam = currentWinner === null ? null : teamOf(game, currentWinner);
  if (winnerTeam === myTeam) {
    const point = sortedLow.find((c) => c.point && !wouldWin(game, c));
    return point || sortedLow[0];
  }
  const winners = sortedLow.filter((c) => wouldWin(game, c));
  if (winners.length) return winners[0];
  return sortedLow[0];
}

function cardPlayValue(card, game) {
  let v = card.value;
  if (card.point) v += 12;
  if (card.joker) v += card.bigJoker ? 45 : 40;
  if (game.trump && game.trump !== "NT" && card.suit === game.trump) v += 20;
  if (card.id === game.secretaryCardId) v += 100;
  return v;
}

function currentTrickWinner(game) {
  if (!game.trick?.length) return null;
  const leadSuit = effectiveLeadSuit(game.trick);
  let best = game.trick[0];
  for (const play of game.trick.slice(1)) {
    if (cardStrength(play.card, game, leadSuit) > cardStrength(best.card, game, leadSuit)) best = play;
  }
  return best.seat;
}

function wouldWin(game, card) {
  const hypothetical = { ...game, trick: [...game.trick, { seat: game.currentPlayer, card }] };
  return currentTrickWinner(hypothetical) === game.currentPlayer;
}

function teamOf(game, seat) {
  if (seat === game.napoleon || seat === game.secretaryOwner) return "nap";
  return "def";
}

function renderGame() {
  const game = appState.room?.game;
  if (!game) return;
  normalizeGame(game);
  renderPhase(game);
  renderContract(game);
  renderScores(game);
  renderSeats(game);
  renderTrick(game);
  renderHand(game);
  renderActions(game);
  renderLog(game);
}

function renderPhase(game) {
  const titles = {
    [PHASE.BIDDING]: "叫牌",
    [PHASE.TRUMP]: "選王牌",
    [PHASE.EXCHANGE]: "換底牌",
    [PHASE.SECRETARY]: "指定秘書牌",
    [PHASE.PLAY]: "出牌",
    [PHASE.ROUND_END]: "本局結算"
  };
  $("phaseTitle").textContent = titles[game.phase] || "牌局";
  const current = game.currentPlayer !== null && game.currentPlayer !== undefined ? game.players[game.currentPlayer]?.name : "";
  const helps = {
    [PHASE.BIDDING]: `輪到 ${current} 叫牌。最低 9 頭，須高於目前最高叫品。`,
    [PHASE.TRUMP]: `拿破崙 ${current} 選擇王牌。`,
    [PHASE.EXCHANGE]: "拿破崙拿起底牌後，選 4 張蓋牌棄出。",
    [PHASE.SECRETARY]: "拿破崙指定一張秘書牌；持有者暗中同隊。",
    [PHASE.PLAY]: `第 ${game.trickNo + 1} 墩，輪到 ${current} 出牌。`,
    [PHASE.ROUND_END]: "本局已結束，房主可開始下一局。"
  };
  $("phaseHelp").textContent = helps[game.phase] || "";
}

function renderContract(game) {
  if (game.napoleon === null || game.napoleon === undefined) {
    $("contractInfo").innerHTML = "尚未叫牌";
    return;
  }
  const secretaryCard = game.secretaryCardId ? findCardById(game.secretaryCardId) : null;
  const secretaryText = game.secretaryRevealed && game.secretaryOwner !== null && game.secretaryOwner !== undefined
    ? `${game.players[game.secretaryOwner].name}（${cardLong(secretaryCard)}）`
    : (secretaryCard ? `${cardLong(secretaryCard)}（未公開）` : "未指定");
  $("contractInfo").innerHTML = `
    <div><b>拿破崙：</b>${escapeHtml(game.players[game.napoleon].name)}</div>
    <div><b>叫牌／成約：</b>${game.bid || "-"} / ${game.contract || "-"} 頭</div>
    <div><b>王牌：</b>${suitName(game.trump)}</div>
    <div><b>秘書：</b>${secretaryText}</div>
    <div><b>底牌頭：</b>${countPoints(game.buried || [])}</div>
  `;
}

function renderScores(game) {
  $("scoreList").innerHTML = game.players.map((p) => {
    let role = "玩家";
    if (p.seat === game.napoleon) role = "拿破崙";
    else if (p.seat === game.secretaryOwner && game.secretaryRevealed) role = "秘書";
    else if (game.napoleon !== null && game.napoleon !== undefined) role = "聯合國";
    return `<div class="score-row"><div><b>${escapeHtml(p.name)}</b><div class="role">${role}</div></div><b>${p.score || 0}</b></div>`;
  }).join("");
}

function renderSeats(game) {
  const mine = myGameSeat(game);
  for (let seat = 0; seat < 5; seat += 1) {
    const p = game.players[seat];
    const el = $(`seat${seat}`);
    const current = game.currentPlayer === seat ? "current" : "";
    const isMine = mine === seat ? "mine" : "";
    el.className = `seat seat-${seat} ${current} ${isMine}`;
    const tags = [];
    tags.push(`<span class="tag">${p.hand?.length || 0} 張</span>`);
    if (p.type === "bot") tags.push(`<span class="tag gold">電腦</span>`);
    if (p.seat === game.napoleon) tags.push(`<span class="tag danger">拿破崙</span>`);
    if (p.seat === game.secretaryOwner && game.secretaryRevealed) tags.push(`<span class="tag gold">秘書</span>`);
    if (game.phase === PHASE.BIDDING && p.lastBid !== null && p.lastBid !== undefined) tags.push(`<span class="tag">${p.lastBid}</span>`);
    el.innerHTML = `<div class="player-name">${escapeHtml(p.name)}${mine === seat ? "（你）" : ""}</div><div class="player-meta">${tags.join("")}</div>`;
  }
}

function renderTrick(game) {
  const trickHtml = (game.trick || []).map((play) => {
    const card = play.card;
    return `<div class="trick-card"><div class="play-card ${cardClass(card)}">${cardLabel(card)}</div><small>${escapeHtml(game.players[play.seat].name)}</small></div>`;
  }).join("");
  $("trickArea").innerHTML = trickHtml || `<div class="hint" style="color:white">等待出牌</div>`;
  const kittyText = game.phase === PHASE.EXCHANGE && game.napoleon === myGameSeat(game)
    ? `你已拿起底牌，請蓋掉 4 張。`
    : (game.buried?.length ? `底牌已蓋牌：${game.buried.length} 張` : `底牌：${game.kitty?.length || 4} 張`);
  $("kittyArea").textContent = kittyText;
}

function renderHand(game) {
  const seat = myGameSeat(game);
  const hand = seat === null ? [] : (game.players[seat]?.hand || []);
  $("handCount").textContent = `${hand.length} 張`;
  const actionable = isMyTurn(game);
  const legalIds = new Set(legalCardsFor(game, seat).map((c) => c.id));
  $("hand").innerHTML = hand.map((card) => {
    const selectable = canSelectCardInHand(game, card, actionable, legalIds);
    const selected = appState.selectedExchange.has(card.id) ? "selected" : "";
    const illegal = actionable && game.phase === PHASE.PLAY && !legalIds.has(card.id) ? "illegal" : "";
    return `<button class="card-btn ${cardClass(card)} ${selected} ${illegal}" data-card="${card.id}" ${selectable ? "" : "disabled"}>${cardLabel(card)}</button>`;
  }).join("");
  document.querySelectorAll("#hand .card-btn").forEach((btn) => {
    btn.addEventListener("click", () => onHandCardClick(game, btn.dataset.card));
  });
  $("handHint").textContent = handHint(game, actionable);
}

function canSelectCardInHand(game, card, actionable, legalIds) {
  if (!actionable) return false;
  if (game.phase === PHASE.EXCHANGE) return true;
  if (game.phase === PHASE.PLAY) return legalIds.has(card.id);
  return false;
}

function handHint(game, actionable) {
  if (!actionable) return "等待其他玩家操作。";
  if (game.phase === PHASE.EXCHANGE) return `請選 4 張蓋牌，目前已選 ${appState.selectedExchange.size} 張。`;
  if (game.phase === PHASE.PLAY) return "請依規則出一張合法牌。";
  return "請使用左側操作區。";
}

function onHandCardClick(game, cardId) {
  if (!isMyTurn(game)) return;
  if (game.phase === PHASE.EXCHANGE) {
    if (appState.selectedExchange.has(cardId)) appState.selectedExchange.delete(cardId);
    else if (appState.selectedExchange.size < 4) appState.selectedExchange.add(cardId);
    renderHand(game);
    renderActions(game);
    return;
  }
  if (game.phase === PHASE.PLAY) {
    const card = game.players[myGameSeat(game)].hand.find((c) => c.id === cardId);
    const leadSuit = (game.trick.length === 0 && card?.joker) ? ($("leadSuitSelect")?.value || null) : null;
    submitAction("playCard", { cardId, leadSuit });
  }
}

function renderActions(game) {
  const seat = myGameSeat(game);
  const myTurn = isMyTurn(game);
  const el = $("actionPanel");
  if (game.phase === PHASE.ROUND_END) {
    el.innerHTML = isHost()
      ? `<button id="btnNextRound" class="primary">開始下一局</button>`
      : `<p class="hint">等待房主開始下一局。</p>`;
    $("btnNextRound")?.addEventListener("click", hostNextRound);
    return;
  }
  if (!myTurn) {
    el.innerHTML = `<p class="hint">等待 ${escapeHtml(game.players[game.currentPlayer]?.name || "其他玩家")} 操作。</p>`;
    return;
  }
  if (game.phase === PHASE.BIDDING) {
    const high = game.bidding?.highest?.amount || 8;
    const options = [];
    for (let i = high + 1; i <= 16; i += 1) options.push(`<option value="${i}">${i} 頭</option>`);
    el.innerHTML = `<label class="field"><span>叫牌</span><select id="bidSelect">${options.join("")}</select></label><div class="inline"><button id="btnBid" class="primary">叫牌</button><button id="btnPass" class="ghost">Pass</button></div>`;
    $("btnBid").addEventListener("click", () => submitAction("bid", { amount: Number($("bidSelect").value) }));
    $("btnPass").addEventListener("click", () => submitAction("pass"));
    return;
  }
  if (game.phase === PHASE.TRUMP) {
    const suits = game.settings?.trumpMode === "allowNoTrump" ? ["S", "H", "D", "C", "NT"] : ["S", "H", "D", "C"];
    el.innerHTML = `<p class="hint">選擇王牌花色。</p><div class="inline">${suits.map((s) => `<button class="ghost" data-trump="${s}">${suitName(s)}</button>`).join("")}</div>`;
    el.querySelectorAll("button[data-trump]").forEach((btn) => btn.addEventListener("click", () => submitAction("chooseTrump", { trump: btn.dataset.trump })));
    return;
  }
  if (game.phase === PHASE.EXCHANGE) {
    el.innerHTML = `<p class="hint">選 4 張蓋牌。已選 ${appState.selectedExchange.size}/4。</p><button id="btnExchange" class="primary" ${appState.selectedExchange.size === 4 ? "" : "disabled"}>確認蓋牌</button>`;
    $("btnExchange").addEventListener("click", () => {
      submitAction("exchange", { cardIds: [...appState.selectedExchange] });
      appState.selectedExchange.clear();
    });
    return;
  }
  if (game.phase === PHASE.SECRETARY) {
    const own = new Set(game.players[seat].hand.map((c) => c.id));
    const buried = new Set((game.buried || []).map((c) => c.id));
    const options = makeDeck()
      .filter((c) => !buried.has(c.id) && (game.settings?.allowSelfSecretary || !own.has(c.id)))
      .sort((a, b) => cardSecretaryValue(b, game) - cardSecretaryValue(a, game))
      .map((c) => `<option value="${c.id}">${cardLong(c)}</option>`);
    el.innerHTML = `<label class="field"><span>秘書牌</span><select id="secretarySelect">${options.join("")}</select></label><button id="btnSecretary" class="primary">指定秘書</button>`;
    $("btnSecretary").addEventListener("click", () => submitAction("chooseSecretary", { cardId: $("secretarySelect").value }));
    return;
  }
  if (game.phase === PHASE.PLAY) {
    const leadSuitSelect = game.trick.length === 0
      ? `<label class="field"><span>若首攻鬼牌，可指定要跟的花色</span><select id="leadSuitSelect"><option value="">不指定</option><option value="S">黑桃</option><option value="H">紅心</option><option value="D">方塊</option><option value="C">梅花</option></select></label>`
      : "";
    el.innerHTML = `${leadSuitSelect}<p class="hint">直接點擊手牌出牌。</p>`;
  }
}

function isMyTurn(game) {
  const seat = myGameSeat(game);
  return seat !== null && game.currentPlayer === seat;
}

function renderLog(game) {
  $("log").innerHTML = (game.log || []).map((msg) => `<div class="log-entry">${escapeHtml(msg)}</div>`).join("");
}

function cardLabel(card) {
  if (!card) return "";
  if (card.joker) return card.rank;
  return `${SUITS[card.suit].sym}${card.rank}`;
}

function cardLong(card) {
  if (!card) return "";
  if (card.joker) return card.rank;
  return `${SUITS[card.suit].name}${card.rank}`;
}

function cardClass(card) {
  if (card.joker) return "joker";
  return SUITS[card.suit]?.color === "red" ? "red" : "black";
}

function suitName(suit) {
  return SUITS[suit]?.name || "未定";
}

function countPoints(cards) {
  return (cards || []).filter((c) => c.point).length;
}

function findCardById(id) {
  return makeDeck().find((c) => c.id === id) || null;
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function aiBestSuit(hand) {
  const scores = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of hand || []) if (c.suit) scores[c.suit] += c.value;
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || "S";
}

function buildInviteLink(code = appState.roomCode) {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
}

function buildQrCodeUrl(url) {
  const size = 220;
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=12&data=${encodeURIComponent(url)}`;
}

async function copyInviteLink() {
  const url = buildInviteLink();
  try {
    await navigator.clipboard.writeText(url);
    toast("已複製邀請連結");
  } catch {
    toast(`邀請連結：${url}`);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();
