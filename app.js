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
  name: "napoleon.player.name.v1",
  logVisible: "napoleon.log.visible.v1",
  theme: "napoleon.theme.v1"
};
const THEME_OPTIONS = ["auto", "ocean", "eye-care", "e-ink", "forest", "grassland", "sakura", "twilight"];
const THEME_PALETTE = THEME_OPTIONS.filter((theme) => theme !== "auto");

const appState = {
  firebaseApp: null,
  auth: null,
  db: null,
  uid: null,
  firebaseUid: null,
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
  connected: false,
  offline: false,
  offlineTimer: null,
  currentRoundResultKey: null,
  dismissedRoundResultKey: null
};

function init() {
  applyTheme(loadTheme());
  watchSystemTheme();
  const savedName = localStorage.getItem(STORAGE.name);
  $("playerName").value = savedName || randomGuestName();
  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) {
    appState.autoJoinCode = roomFromUrl.toUpperCase();
    $("roomCode").value = appState.autoJoinCode;
  }

  $("btnStartOffline").addEventListener("click", startOfflineGame);
  $("btnConnect").addEventListener("click", connectFirebase);
  $("btnCreateRoom").addEventListener("click", createRoom);
  $("btnJoinRoom").addEventListener("click", joinRoomFromInput);
  $("btnLeave").addEventListener("click", leaveRoom);
  $("btnGameExit").addEventListener("click", leaveRoom);
  $("btnCopyLink").addEventListener("click", copyInviteLink);
  $("btnToggleLog").addEventListener("click", toggleLogVisibility);
  applyLogVisibility(getLogVisible());
  $("btnAddBot").addEventListener("click", () => hostAddBot());
  $("btnRemoveBot").addEventListener("click", () => hostRemoveBot());
  $("btnStartGame").addEventListener("click", hostStartGame);
  $("btnRules").addEventListener("click", () => $("rulesDialog").showModal());
  $("closeRules").addEventListener("click", () => $("rulesDialog").close());
  $("themeSelect").addEventListener("change", (event) => applyTheme(event.target.value, true));
  $("resultClose").addEventListener("click", hideRoundResultOverlay);
  $("difficulty").addEventListener("input", () => {
    $("difficultyLabel").textContent = $("difficulty").value;
    syncLobbySettingsSoon();
  });
  for (const id of ["buriedMode", "leadMode", "trumpMode", "jokerLowLast3", "summonJokers", "allowSelfSecretary"]) {
    $(id).addEventListener("change", syncLobbySettingsSoon);
  }
  renderConnectState();
  if (appState.autoJoinCode) {
    window.setTimeout(() => connectFirebase(), 250);
  }
}

function loadTheme() {
  const stored = localStorage.getItem(STORAGE.theme);
  return THEME_OPTIONS.includes(stored) ? stored : "ocean";
}

function resolveTheme(theme) {
  const safeTheme = THEME_OPTIONS.includes(theme) ? theme : "ocean";
  if (safeTheme !== "auto") return safeTheme;
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "twilight" : "ocean";
}

function applyTheme(theme, persist = false) {
  const safeTheme = THEME_OPTIONS.includes(theme) ? theme : "ocean";
  const actualTheme = resolveTheme(safeTheme);
  document.body.dataset.themeChoice = safeTheme;
  document.body.dataset.theme = actualTheme;
  const select = $("themeSelect");
  if (select) select.value = safeTheme;
  if (persist) localStorage.setItem(STORAGE.theme, safeTheme);
}

function watchSystemTheme() {
  if (!window.matchMedia) return;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const refresh = () => {
    if (loadTheme() === "auto") applyTheme("auto", false);
  };
  if (media.addEventListener) media.addEventListener("change", refresh);
  else if (media.addListener) media.addListener(refresh);
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
    appState.firebaseUid = credential.user.uid;
    if (!appState.offline) appState.uid = appState.firebaseUid;
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
  $("btnStartOffline").disabled = false;
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

function startOfflineGame() {
  detachRoom();
  appState.offline = true;
  appState.uid = "offline-human";
  appState.roomCode = "OFFLINE";
  appState.selectedExchange.clear();
  const name = sanitizeName($("playerName").value);
  $("playerName").value = name;
  localStorage.setItem(STORAGE.name, name);
  const settings = {
    ...defaultSettings(),
    difficulty: Number($("offlineDifficulty").value || 10)
  };
  const seats = {
    0: makeHumanSeat(0, appState.uid, name),
    1: makeBotSeat(1, 1),
    2: makeBotSeat(2, 2),
    3: makeBotSeat(3, 3),
    4: makeBotSeat(4, 4)
  };
  const players = Array.from({ length: 5 }, (_, seat) => seats[seat]);
  appState.room = {
    meta: {
      code: "OFFLINE",
      hostUid: appState.uid,
      status: "game",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode: "offline"
    },
    lobby: { dealer: 0, settings, seats },
    game: createGame(players, settings, 0, [0, 0, 0, 0, 0])
  };
  history.replaceState(null, "", location.pathname);
  $("connectView").classList.add("hidden");
  $("lobbyView").classList.add("hidden");
  $("gameView").classList.remove("hidden");
  $("btnLeave").classList.remove("hidden");
  document.body.classList.add("in-game", "offline-game");
  renderGame();
  scheduleHostAutomation();
  toast("已開始單人離線局");
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
  clearTimeout(appState.offlineTimer);
}

async function leaveRoom(updateSeat = true) {
  if (appState.offline) {
    detachRoom();
    appState.offline = false;
    appState.uid = appState.firebaseUid || appState.uid;
    appState.roomCode = null;
    appState.selectedExchange.clear();
    document.body.classList.remove("in-game", "offline-game");
    history.replaceState(null, "", location.pathname);
    $("connectView").classList.remove("hidden");
    $("lobbyView").classList.add("hidden");
    $("gameView").classList.add("hidden");
    $("btnLeave").classList.add("hidden");
    renderConnectState();
    return;
  }
  if (updateSeat && appState.roomCode && appState.room) {
    const seat = myLobbySeat();
    if (seat !== null && appState.room.meta?.status === "lobby") {
      await remove(roomRef(`lobby/seats/${seat}`)).catch(() => {});
    }
  }
  detachRoom();
  appState.roomCode = null;
  appState.selectedExchange.clear();
  document.body.classList.remove("in-game", "offline-game");
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
  if (appState.offline) return true;
  return appState.room?.meta?.hostUid === appState.uid;
}

function renderRoom() {
  const status = appState.room?.meta?.status;
  const inGame = status !== "lobby" && !!appState.room;
  document.body.classList.toggle("in-game", inGame);
  document.body.classList.toggle("offline-game", !!appState.offline && inGame);
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
  if (appState.offline) {
    appState.room.lobby.dealer = nextDealer;
    scores.forEach((score, seat) => { if (appState.room.lobby.seats[seat]) appState.room.lobby.seats[seat].score = score; });
    appState.room.game = game;
    appState.room.meta.status = "game";
    appState.room.meta.updatedAt = Date.now();
    renderRoom();
    scheduleHostAutomation();
    return;
  }
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
    pendingClear: null,
    bidding: { highest: null, turn: dealer, consecutivePasses: 0, passesWithoutBid: 0 },
    log: [`第 ${dealer + 1} 家先叫牌。最低 9 頭，叫品為「數字＋花色」，同數字依橋牌花色大小 ♣ < ♦ < ♥ < ♠ 比較。`],
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
  const game = normalizeGame(appState.room?.game);
  const seat = myGameSeat(game);
  if (seat === null) return toast("你不在此局中");
  const action = {
    uid: appState.uid,
    seat,
    type,
    payload,
    createdAt: Date.now()
  };
  if (appState.offline) {
    const changed = applyAction(game, action);
    if (changed) await saveGame(game);
    return;
  }
  await push(ref(appState.db, `rooms/${appState.roomCode}/actions`), action);
}

function normalizeGame(game) {
  if (!game) return game;
  if (!Array.isArray(game.trick)) game.trick = [];
  if (!Array.isArray(game.buried)) game.buried = [];
  if (!Array.isArray(game.kitty)) game.kitty = [];
  if (!Array.isArray(game.log)) game.log = [];
  if (!Array.isArray(game.players)) game.players = [];
  if (game.pendingClear && (!game.pendingClear.until || !Array.isArray(game.trick))) game.pendingClear = null;
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
  if (game.pendingClear) return false;

  if (game.phase === PHASE.BIDDING && game.currentPlayer === seat) {
    if (action.type === "pass") return passBid(game, seat);
    if (action.type === "bid") return makeBid(game, seat, action.payload);
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

function allowedBidSuits(settings) {
  const suits = ["C", "D", "H", "S"];
  if (settings?.trumpMode === "allowNoTrump") suits.push("NT");
  return suits;
}

function bidValue(bid) {
  if (!bid) return 0;
  const amount = Number(bid.amount || 0);
  const suit = bid.suit || bid.trump || null;
  const order = SUITS[suit]?.order || 0;
  return amount * 10 + order;
}

function normalizeBidPayload(payload) {
  if (!payload) return null;
  if (typeof payload === "number") return { amount: payload, suit: "S" };
  const amount = Number(payload.amount);
  const suit = payload.suit || payload.trump;
  if (!Number.isInteger(amount) || amount < 9 || amount > 16 || !SUITS[suit]) return null;
  return { amount, suit };
}

function formatBid(bid) {
  if (!bid) return "-";
  const amount = Number(bid.amount || bid);
  const suit = bid.suit || bid.trump || null;
  return suit ? `${amount} ${suitName(suit)}` : `${amount} 頭`;
}

function getBidAmount(game) {
  if (typeof game.bid === "number") return game.bid;
  return Number(game.bid?.amount || game.bidAmount || game.bidding?.highest?.amount || 0);
}

function legalBidsAbove(highest, settings) {
  const suits = allowedBidSuits(settings);
  const highValue = bidValue(highest);
  const bids = [];
  for (let amount = 9; amount <= 16; amount += 1) {
    for (const suit of suits) {
      const bid = { amount, suit };
      if (bidValue(bid) > highValue) bids.push(bid);
    }
  }
  return bids;
}

function passBid(game, seat) {
  const p = game.players[seat];
  if (!game.bidding) game.bidding = { highest: null, turn: game.currentPlayer, consecutivePasses: 0, passesWithoutBid: 0 };
  p.lastBid = "Pass";
  if (game.bidding.highest) game.bidding.consecutivePasses = (game.bidding.consecutivePasses || 0) + 1;
  else game.bidding.passesWithoutBid = (game.bidding.passesWithoutBid || 0) + 1;
  appendLog(game, `${p.name} Pass。`);

  if (game.bidding.highest && game.bidding.consecutivePasses >= 4) return finishBidding(game);
  if (!game.bidding.highest && game.bidding.passesWithoutBid >= 5) {
    game.phase = PHASE.ROUND_END;
    game.currentPlayer = null;
    appendLog(game, "全部 Pass，本局流局。房主可開始下一局。");
    return true;
  }
  return advanceBidding(game);
}

function makeBid(game, seat, payload) {
  if (!game.bidding) game.bidding = { highest: null, turn: game.currentPlayer, consecutivePasses: 0, passesWithoutBid: 0 };
  const bid = normalizeBidPayload(payload);
  if (!bid) return false;
  if (!allowedBidSuits(game.settings).includes(bid.suit)) return false;
  if (bidValue(bid) <= bidValue(game.bidding.highest)) return false;
  const p = game.players[seat];
  p.lastBid = formatBid(bid);
  game.bidding.highest = { seat, amount: bid.amount, suit: bid.suit };
  game.bidding.consecutivePasses = 0;
  appendLog(game, `${p.name} 叫 ${formatBid(bid)}。`);
  return advanceBidding(game);
}

function advanceBidding(game) {
  const next = (game.currentPlayer + 1) % 5;
  game.currentPlayer = next;
  game.bidding.turn = next;
  return true;
}

function finishBidding(game) {
  const high = game.bidding.highest;
  if (!high) return false;
  game.napoleon = high.seat;
  game.bid = { amount: high.amount, suit: high.suit };
  game.bidAmount = high.amount;
  game.trump = high.suit;
  game.phase = PHASE.EXCHANGE;
  game.currentPlayer = high.seat;
  const player = game.players[high.seat];
  player.hand = sortHand([...player.hand, ...(game.kitty || [])]);
  game.players.forEach((p) => { p.passed = false; });
  appendLog(game, `${player.name} 成為拿破崙，叫 ${formatBid(high)}，${suitName(high.suit)} 為王牌，拿起 4 張底牌。`);
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
  game.contract = Math.min(16, getBidAmount(game) + (game.settings?.buriedMode === "addContract" ? buriedHeads : 0));
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
  game.pendingClear = {
    until: Date.now() + 3000,
    winner,
    heads,
    bestCardId: best.card.id,
    trickNo: game.trickNo
  };
  game.currentPlayer = null;
  appendLog(game, `${game.players[winner].name} 以 ${cardLong(best.card)} 吃下第 ${game.trickNo + 1} 墩，取得 ${heads} 張頭。3 秒後清空牌桌。`);
}

function clearPendingTrickIfReady(game) {
  if (!game?.pendingClear) return false;
  if (Date.now() < game.pendingClear.until) return false;
  const winner = game.pendingClear.winner;
  game.trick = [];
  game.requestedId = null;
  game.pendingClear = null;
  game.trickNo += 1;
  if (game.trickNo >= 10) {
    endRound(game);
  } else {
    game.leader = winner;
    game.currentPlayer = winner;
  }
  return true;
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
  const totals = calculateHeadTotals(game);
  const teamHeads = totals.teamHeads;
  const defenderHeads = totals.defenderHeads;
  const buriedHeads = totals.buriedHeads;
  const contract = totals.contract;
  game.contract = contract;

  const made = teamHeads >= contract;
  const diff = Math.abs(teamHeads - contract);
  const solo = game.secretaryOwner === game.napoleon;
  const base = (solo ? 160 : 100) + diff * 10;
  const napDelta = made ? base : -base;
  const secDelta = made ? Math.round(base / 2) : -Math.round(base / 2);
  const defDelta = made ? -Math.round(base / 2) : Math.round(base / 2);
  const scoreDeltas = [0, 0, 0, 0, 0];
  game.players.forEach((p) => {
    let delta = defDelta;
    if (p.seat === game.napoleon) delta = napDelta;
    else if (p.seat === game.secretaryOwner) delta = secDelta;
    p.score += delta;
    scoreDeltas[p.seat] = delta;
  });
  game.roundResult = {
    made,
    winningTeam: made ? "nap" : "def",
    teamHeads,
    defenderHeads,
    buriedHeads,
    contract,
    scoreDeltas,
    endedAt: Date.now()
  };
  game.phase = PHASE.ROUND_END;
  game.currentPlayer = null;
  game.secretaryRevealed = true;
  appendLog(game, `${made ? "拿破崙軍達標" : "聯合國守成"}：拿破崙軍 ${teamHeads} 頭，成約 ${contract} 頭。`);
}

async function saveGame(game) {
  if (appState.offline) {
    appState.room.game = game;
    appState.room.meta.updatedAt = Date.now();
    if (game.phase === PHASE.ROUND_END) {
      game.players.forEach((p) => {
        if (appState.room.lobby?.seats?.[p.seat]) appState.room.lobby.seats[p.seat].score = p.score || 0;
      });
    }
    renderRoom();
    scheduleHostAutomation();
    return;
  }
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
  if (game.pendingClear) {
    const delay = Math.max(0, game.pendingClear.until - Date.now()) + 60;
    appState.botTimer = setTimeout(async () => {
      const latest = appState.offline ? normalizeGame(appState.room?.game) : normalizeGame((await get(roomRef("game"))).val());
      if (!latest) return;
      const changed = clearPendingTrickIfReady(latest);
      if (changed) await saveGame(latest);
    }, delay);
    return;
  }
  const action = getBotAction(game);
  if (!action) return;
  const difficulty = game.settings?.difficulty || 10;
  const delay = game.phase === PHASE.BIDDING
    ? 1100 + difficulty * 45 + Math.random() * 700
    : 650 + Math.random() * 550;
  appState.botTimer = setTimeout(async () => {
    const latest = appState.offline ? normalizeGame(appState.room?.game) : normalizeGame((await get(roomRef("game"))).val());
    const botAction = getBotAction(latest);
    if (!botAction) return;
    const changed = applyAction(latest, botAction);
    if (changed) await saveGame(latest);
  }, delay);
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
  const highest = game.bidding?.highest || null;
  const difficulty = game.settings?.difficulty || 10;
  const estimate = estimateHand(player.hand, game.settings);
  const caution = (21 - difficulty) * 0.035;
  const noise = (Math.random() - 0.5) * Math.max(0.15, (21 - difficulty) / 18);
  const ceiling = Math.max(8, Math.min(16, Math.floor(estimate - caution + noise)));
  if (ceiling < 9) return { uid: player.uid, seat, type: "pass", payload: {} };

  const suitScores = aiSuitScores(player.hand);
  const legal = legalBidsAbove(highest, game.settings).filter((b) => b.amount <= ceiling);
  if (!legal.length) return { uid: player.uid, seat, type: "pass", payload: {} };

  const preferredSuit = Object.entries(suitScores)
    .filter(([s]) => allowedBidSuits(game.settings).includes(s))
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "S";

  // 叫品現在是「數字＋花色」：電腦先找最低可蓋過目前叫品的安全叫品，
  // 再偏好自己牌型較好的花色；高難度且牌力充足時才小幅跳叫。
  let candidates = legal.filter((b) => b.amount === legal[0].amount);
  let bid = candidates.find((b) => b.suit === preferredSuit) || candidates.sort((a, b) => suitScores[b.suit] - suitScores[a.suit])[0];
  if (difficulty >= 15 && ceiling >= bid.amount + 2 && Math.random() < (difficulty - 12) / 20) {
    const jumpAmount = Math.min(ceiling, bid.amount + 1);
    const jump = legal.find((b) => b.amount === jumpAmount && b.suit === preferredSuit) || legal.find((b) => b.amount === jumpAmount);
    if (jump) bid = jump;
  }

  return { uid: player.uid, seat, type: "bid", payload: bid };
}

function aiSuitScores(hand) {
  const scores = { S: 0, H: 0, D: 0, C: 0, NT: 0 };
  for (const card of hand) {
    if (card.joker) scores.NT += 3.4;
    else scores[card.suit] += card.value + (card.point ? 2.5 : 0);
  }
  return scores;
}

function estimateHand(hand, settings) {
  const points = countPoints(hand);
  const jokers = hand.filter((c) => c.joker).length;
  const suitScores = { S: 0, H: 0, D: 0, C: 0 };
  const suitCounts = { S: 0, H: 0, D: 0, C: 0 };
  hand.forEach((c) => {
    if (!c.suit) return;
    suitCounts[c.suit] += 1;
    suitScores[c.suit] += c.value + (c.point ? 2 : 0);
  });
  const bestSuitScore = Math.max(...Object.values(suitScores));
  const longest = Math.max(...Object.values(suitCounts));
  const aces = hand.filter((c) => c.rank === "A").length;
  const kings = hand.filter((c) => c.rank === "K").length;
  const queens = hand.filter((c) => c.rank === "Q").length;
  const weakSuitPenalty = Object.values(suitCounts).filter((n) => n === 0 || n === 1).length * 0.18;
  return 7.55
    + points * 0.34
    + jokers * 1.15
    + Math.min(2.0, bestSuitScore / 34)
    + Math.max(0, longest - 3) * 0.18
    + aces * 0.22
    + kings * 0.12
    + queens * 0.05
    - weakSuitPenalty
    + (settings?.difficulty || 10) / 80;
}

function aiChooseTrump(game, seat) {
  const scores = aiSuitScores(game.players[seat].hand);
  return Object.entries(scores)
    .filter(([s]) => allowedBidSuits(game.settings).includes(s))
    .sort((a, b) => b[1] - a[1])[0][0];
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
  if (!legal.length) return null;
  const difficulty = Number(game.settings?.difficulty || 10);
  const sortedLow = [...legal].sort((a, b) => cardPlayValue(a, game) - cardPlayValue(b, game));
  const myTeam = aiTeamView(game, seat, seat);

  // 低難度保留一點失誤；中高難度改由完整局勢評分決定。
  if (difficulty <= 5 && Math.random() < 0.18) return randomItem(legal);

  // 若啟用「末三輪鬼牌變小」，小鬼會在第 8 墩起失去威力。
  // 因此電腦會在進入末三輪前評估是否先打出，尤其第 7 墩是最後機會。
  const timelySmallJoker = aiConsiderSmallJokerBeforeLast3(game, seat, legal, sortedLow, myTeam, difficulty);
  if (timelySmallJoker) return timelySmallJoker;

  const context = aiBuildPlayContext(game, seat);
  const scored = legal.map((card) => ({ card, score: aiScorePlayCard(game, seat, card, context) }));
  return aiPickScoredCard(scored, difficulty);
}

function aiBuildPlayContext(game, seat) {
  const totals = calculateHeadTotals(game) || { teamHeads: 0, defenderHeads: 0, contract: getBidAmount(game) || 9 };
  const trickCards = (game.trick || []).map((p) => p.card);
  const pointsOnTable = countPoints(trickCards);
  const capturedHeads = totals.teamHeads + totals.defenderHeads;
  const remainingHeads = Math.max(0, 16 - capturedHeads - pointsOnTable);
  const napNeeds = Math.max(0, (totals.contract || getBidAmount(game) || 9) - totals.teamHeads);
  const myTeam = aiTeamView(game, seat, seat);
  const currentWinner = currentTrickWinner(game);
  const currentWinnerTeam = currentWinner === null ? null : aiTeamView(game, currentWinner, seat);
  const seatsAfterMe = Math.max(0, 4 - (game.trick?.length || 0));
  const actingLast = (game.trick?.length || 0) === 4;
  const late = (game.trickNo || 0) >= 7;
  const player = game.players?.[seat] || { hand: [] };
  const handHeads = countPoints(player.hand || []);
  const trumpCount = game.trump && game.trump !== "NT" ? (player.hand || []).filter((c) => c.suit === game.trump).length : 0;
  const napUrgency = aiClamp(napNeeds / Math.max(1, remainingHeads + pointsOnTable), 0, 1.6);
  const defenderUrgency = aiClamp((5 - napNeeds) / 5, 0, 1.4);
  return {
    totals,
    pointsOnTable,
    remainingHeads,
    napNeeds,
    myTeam,
    currentWinner,
    currentWinnerTeam,
    seatsAfterMe,
    actingLast,
    late,
    handHeads,
    trumpCount,
    difficulty: Number(game.settings?.difficulty || 10),
    leadSuit: effectiveLeadSuit(game.trick)
  };
}

function aiScorePlayCard(game, seat, card, ctx) {
  const trickLen = game.trick?.length || 0;
  return trickLen === 0
    ? aiScoreLeadCard(game, seat, card, ctx)
    : aiScoreFollowCard(game, seat, card, ctx);
}

function aiScoreLeadCard(game, seat, card, ctx) {
  const player = game.players?.[seat] || { hand: [] };
  const base = cardPlayValue(card, game);
  const isPoint = isHeadCard(card);
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  const isJoker = Boolean(card.joker);
  const likelyWin = aiLikelyLeadWin(game, seat, card);
  let score = 0;

  // 領牌預設保守：不隨便裸丟頭牌、王牌、鬼牌；越後期越可以釋放大牌。
  score -= base * 0.22;
  if (isPoint) score -= 8;
  if (isTrump) score -= 3.5;
  if (isJoker) score -= 10;
  if (ctx.late) score += base * 0.24 + (isPoint ? 4 : 0);

  if (ctx.myTeam === "nap") {
    // 拿破崙軍需要達標：缺頭越多、手上頭越多，越傾向先建立主動權。
    const pressure = 8 + ctx.handHeads * 1.8 + ctx.napUrgency * 18;
    score += likelyWin * pressure;
    if (isPoint && likelyWin >= 0.72) score += 8 + ctx.napUrgency * 5;
    if (isTrump && ctx.trumpCount >= 3) score += 4 + likelyWin * 4;
    if (aiCanSummonUsefulJoker(game, seat, card)) score += 8 + ctx.difficulty * 0.45;
  } else {
    // 聯合國領牌以不送頭為先；拿破崙已接近成約時，會更積極用安全大牌攔截。
    const blockPressure = 4 + ctx.defenderUrgency * 13;
    score += likelyWin * blockPressure;
    if (isPoint && likelyWin < 0.8) score -= 13;
    if (!isPoint && !isTrump && !isJoker) score += 4;
    if (ctx.defenderUrgency > 0.7 && likelyWin > 0.75) score += 5;
  }

  // 秘書牌是全局最大；暗秘書不宜無意義早早曝光，但必要時可搶頭。
  if (!game.secretaryRevealed && card.id === game.secretaryCardId) {
    score -= game.trickNo < 5 ? 22 : 8;
    if (ctx.myTeam === "nap" && (ctx.napUrgency > 0.8 || ctx.handHeads >= 3)) score += 12;
  }

  // 末三輪鬼牌變小時，大鬼也不宜拖到太晚。
  if (game.settings?.jokerLowLast3 && card.joker && game.trickNo >= 5 && game.trickNo < 7) {
    score += card.bigJoker ? 10 : 4;
  }
  return score;
}

function aiScoreFollowCard(game, seat, card, ctx) {
  const base = cardPlayValue(card, game);
  const isPoint = isHeadCard(card);
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  const isJoker = Boolean(card.joker);
  const candidateWins = wouldWin(game, card);
  const allyWinning = ctx.currentWinnerTeam === ctx.myTeam;
  const pointsWithCard = ctx.pointsOnTable + (isPoint ? 1 : 0);
  const headWeight = 7 + ctx.difficulty * 0.55 + (ctx.myTeam === "nap" ? ctx.napUrgency * 10 : ctx.defenderUrgency * 10);
  let score = 0;

  if (allyWinning) {
    if (candidateWins) {
      // 盟友已經贏墩時，除非特殊需要，不要浪費更大的牌去蓋隊友。
      score -= 18 + base * 0.34;
      if (ctx.actingLast && isPoint) score -= 7;
    } else {
      // 盟友贏墩：可以墊頭；但若後面還有對手未出，墊頭會比較保守。
      score += 9;
      const feedBonus = ctx.actingLast ? 26 : Math.max(4, 16 - ctx.seatsAfterMe * 4);
      if (isPoint) score += feedBonus;
      if (isTrump || isJoker) score -= 5;
      score -= base * 0.14;
    }
  } else {
    if (candidateWins) {
      // 對方暫時贏墩：桌上頭越多、越接近勝負關鍵，越該用最小成本吃回來。
      score += 15 + pointsWithCard * headWeight;
      if (ctx.myTeam === "nap") score += ctx.napUrgency * 12;
      else score += ctx.defenderUrgency * 13;
      score -= base * 0.30; // 在能吃的牌裡偏好最小牌。
      if (isPoint) score += 5; // 自己的頭也會被一起收走。
      if (ctx.actingLast) score += 4;
    } else {
      // 吃不回來：不要把頭送給對方，盡量丟低牌。
      score += 3;
      if (isPoint) score -= 18 + headWeight;
      if (isTrump || isJoker) score -= 3;
      score -= base * 0.09;
    }
  }

  if (!game.secretaryRevealed && card.id === game.secretaryCardId) {
    if (candidateWins && (!allyWinning || pointsWithCard >= 2 || ctx.late || ctx.napUrgency > 0.75)) {
      score += 18 + pointsWithCard * 8;
    } else {
      score -= game.trickNo < 6 ? 25 : 10;
    }
  }

  // 末三輪鬼牌變小：進入末三輪後不再把鬼牌當作超強王牌；末三輪前則避免浪費大鬼。
  if (game.settings?.jokerLowLast3 && card.joker) {
    if (game.trickNo >= 7) score -= card.bigJoker ? 4 : 8;
    else if (game.trickNo <= 4 && ctx.pointsOnTable === 0 && !candidateWins) score -= 7;
  }

  return score;
}

function aiPickScoredCard(scored, difficulty) {
  const spread = Math.max(0.8, (21 - difficulty) * 1.55);
  const withNoise = scored.map((item) => ({
    card: item.card,
    score: item.score + (Math.random() - 0.5) * spread
  })).sort((a, b) => b.score - a.score);

  if (difficulty <= 8 && withNoise.length > 1 && Math.random() < 0.14) {
    return randomItem(withNoise.slice(0, Math.min(3, withNoise.length))).card;
  }
  if (difficulty <= 13 && withNoise.length > 1 && Math.random() < 0.06) {
    return withNoise[1].card;
  }
  return withNoise[0].card;
}

function aiLikelyLeadWin(game, seat, card) {
  if (card.id === game.secretaryCardId) return 1;
  if (card.joker && !(game.settings?.jokerLowLast3 && game.trickNo >= 7)) return card.bigJoker ? 0.96 : 0.9;
  const leadSuit = card.joker ? null : card.suit;
  const strength = cardStrength(card, game, leadSuit);
  const unseen = aiUnseenCards(game, seat);
  const stronger = unseen.filter((c) => cardStrength(c, game, leadSuit) > strength);
  if (!stronger.length) return 0.92;

  // 不是精算，只估計「後面 4 家剛好有更大牌且願意出」的風險。
  const risk = aiClamp(stronger.length / Math.max(1, unseen.length), 0, 0.9);
  const followers = 4;
  return aiClamp(1 - risk * followers * 1.25, 0.08, 0.86);
}

function aiUnseenCards(game, seat) {
  const known = new Set();
  (game.players?.[seat]?.hand || []).forEach((c) => known.add(c.id));
  (game.trick || []).forEach((p) => known.add(p.card?.id));
  (game.captured || []).flat().forEach((c) => known.add(c.id));
  // 底牌通常只有拿破崙知道；為避免電腦過度作弊，非拿破崙不把底牌視為已知。
  if (seat === game.napoleon) (game.buried || []).forEach((c) => known.add(c.id));
  return makeDeck().filter((c) => !known.has(c.id));
}

function aiTeamView(game, targetSeat, observerSeat) {
  if (targetSeat === null || targetSeat === undefined) return null;
  if (targetSeat === game.napoleon) return "nap";
  if (game.secretaryRevealed) return teamOf(game, targetSeat);
  // 拿破崙知道秘書是誰；秘書本人也知道自己同隊。其他電腦不偷看暗秘書。
  if (observerSeat === game.napoleon || targetSeat === observerSeat) return teamOf(game, targetSeat);
  return "def";
}

function aiCanSummonUsefulJoker(game, seat, card) {
  const target = summonTargetForLead(game, card);
  if (!target) return false;
  const handIds = new Set((game.players?.[seat]?.hand || []).map((c) => c.id));
  return !handIds.has(target);
}

function aiClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function aiConsiderSmallJokerBeforeLast3(game, seat, legal, sortedLow, myTeam, difficulty) {
  if (!game.settings?.jokerLowLast3) return null;
  if (game.trickNo >= 7) return null;
  const smallJoker = legal.find((c) => c.id === "RJ");
  if (!smallJoker) return null;

  const tricksUntilLow = 7 - game.trickNo; // 1 表示本墩是變小前最後機會。
  const isLastChance = tricksUntilLow <= 1;
  const urgency = Math.max(0, 4 - tricksUntilLow); // 越接近末三輪越高。
  const pointCount = countPoints(game.trick.map((p) => p.card));
  const currentWinner = currentTrickWinner(game);
  const winnerTeam = currentWinner === null ? null : aiTeamView(game, currentWinner, seat);
  const smallWins = wouldWin(game, smallJoker);
  const hasCheapAlternative = sortedLow.some((c) => c.id !== "RJ" && !c.point && !wouldWin(game, c));

  if (game.trick.length === 0) {
    // 領出時若手上有小鬼，越接近末三輪越傾向先確保它發揮威力。
    const leadChance = isLastChance ? 0.92 : Math.min(0.58, 0.10 + urgency * 0.14 + difficulty / 85);
    return Math.random() < leadChance ? smallJoker : null;
  }

  if (smallWins) {
    // 對方暫時吃墩、或桌上已有頭時，小鬼提早出手的價值較高。
    if (winnerTeam !== myTeam) return smallJoker;
    if (pointCount > 0 && (isLastChance || Math.random() < 0.25 + difficulty / 80)) return smallJoker;
    if (isLastChance && Math.random() < 0.68) return smallJoker;
  }

  // 最後機會且小鬼已無法贏時，如果能用低成本把小鬼脫手，避免留到末三輪變小。
  if (isLastChance && !smallWins && hasCheapAlternative && Math.random() < 0.48 + difficulty / 70) {
    return smallJoker;
  }

  return null;
}

function cardPlayValue(card, game) {
  let v = card.value;
  if (card.point) v += 12;
  if (card.joker) {
    if (game.settings?.jokerLowLast3 && game.trickNo >= 7) {
      v += card.bigJoker ? 3 : 1;
    } else {
      v += card.bigJoker ? 45 : 40;
    }
  }
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

function calculateHeadTotals(game) {
  const bidAmount = getBidAmount(game);
  const buriedHeads = countPoints(game?.buried || []);
  const rawContract = game?.settings?.buriedMode === "addContract"
    ? bidAmount + buriedHeads
    : (Number(game?.contract || 0) || bidAmount);
  const contract = Math.min(16, rawContract);
  const teamSeats = new Set([game.napoleon]);
  if (game.secretaryOwner !== null && game.secretaryOwner !== undefined) teamSeats.add(game.secretaryOwner);
  let teamHeads = 0;
  let defenderHeads = 0;
  (game.captured || []).forEach((cards, seat) => {
    const heads = countPoints(cards || []);
    if (teamSeats.has(Number(seat))) teamHeads += heads;
    else defenderHeads += heads;
  });
  if (game.settings?.buriedMode === "defenders") defenderHeads += buriedHeads;
  else if (game.settings?.buriedMode !== "addContract") teamHeads += buriedHeads;
  return { teamHeads, defenderHeads, buriedHeads, contract };
}

function calculateRoundResult(game) {
  if (!game || game.napoleon === null || game.napoleon === undefined) return null;
  const totals = calculateHeadTotals(game);
  if (!totals.contract) return null;
  const made = totals.teamHeads >= totals.contract;
  return {
    made,
    winningTeam: made ? "nap" : "def",
    teamHeads: totals.teamHeads,
    defenderHeads: totals.defenderHeads,
    buriedHeads: totals.buriedHeads,
    contract: totals.contract,
    scoreDeltas: game.roundResult?.scoreDeltas || [],
    endedAt: game.roundResult?.endedAt || game.createdAt || Date.now()
  };
}

function roundResultKey(game, result) {
  return [appState.roomCode || "room", game.createdAt || "game", result.endedAt || "end", result.winningTeam, result.teamHeads, result.defenderHeads, result.contract].join(":");
}

function hideRoundResultOverlay() {
  const overlay = $("resultOverlay");
  if (!overlay) return;
  overlay.classList.remove("show", "win", "lose");
  overlay.classList.add("hidden");
  if (appState.currentRoundResultKey) appState.dismissedRoundResultKey = appState.currentRoundResultKey;
}

function renderRoundResultAnimation(game) {
  const overlay = $("resultOverlay");
  if (!overlay) return;
  if (game.phase !== PHASE.ROUND_END) {
    overlay.classList.remove("show", "win", "lose");
    overlay.classList.add("hidden");
    appState.currentRoundResultKey = null;
    return;
  }
  const seat = myGameSeat(game);
  // 永遠從實際吃牌與底牌重新計算頭數；舊版 roundResult 只保留分數與時間，避免顯示成 2/11 這類舊統計錯誤。
  const result = calculateRoundResult(game) || game.roundResult;
  if (seat === null || !result) {
    overlay.classList.remove("show", "win", "lose");
    overlay.classList.add("hidden");
    return;
  }
  const key = roundResultKey(game, result);
  if (appState.dismissedRoundResultKey === key) {
    overlay.classList.remove("show", "win", "lose");
    overlay.classList.add("hidden");
    return;
  }

  const playerTeam = teamOf(game, seat);
  const playerWon = result.winningTeam === playerTeam;
  const delta = result.scoreDeltas?.[seat] ?? 0;
  const teamName = playerTeam === "nap" ? "拿破崙軍" : "聯合國";
  const winnerName = result.winningTeam === "nap" ? "拿破崙軍" : "聯合國";
  $("resultTitle").textContent = playerWon ? "勝利！" : "失敗…";
  $("resultSubtitle").textContent = playerWon ? `你的陣營「${teamName}」贏得本局。` : `你的陣營「${teamName}」本局失利。`;
  $("resultStats").innerHTML = `
    <div><span>勝方</span><b>${winnerName}</b></div>
    <div><span>拿破崙軍</span><b>${result.teamHeads} / ${result.contract} 頭</b></div>
    <div><span>聯合國</span><b>${result.defenderHeads} 頭</b></div>
    <div><span>本局分數</span><b>${delta >= 0 ? "+" : ""}${delta}</b></div>
  `;

  overlay.classList.remove("hidden", "win", "lose", "show");
  overlay.classList.add(playerWon ? "win" : "lose");
  void overlay.offsetWidth;
  overlay.classList.add("show");
  appState.currentRoundResultKey = key;
}

function renderGame() {
  const game = appState.room?.game;
  if (!game) return;
  normalizeGame(game);
  renderPhase(game);
  renderContract(game);
  renderTableTrump(game);
  renderTableTeamHeads(game);
  renderScores(game);
  renderSeats(game);
  renderTrick(game);
  renderHand(game);
  renderActions(game);
  renderLog(game);
  renderRoundResultAnimation(game);
}

function renderPhase(game) {
  const titles = {
    [PHASE.BIDDING]: "叫牌",
    [PHASE.TRUMP]: "確認王牌",
    [PHASE.EXCHANGE]: "換底牌",
    [PHASE.SECRETARY]: "指定秘書牌",
    [PHASE.PLAY]: "出牌",
    [PHASE.ROUND_END]: "本局結算"
  };
  $("phaseTitle").textContent = titles[game.phase] || "牌局";
  if (game.pendingClear) {
    const winner = game.players[game.pendingClear.winner]?.name || "勝方";
    $("phaseHelp").textContent = `第 ${game.trickNo + 1} 墩完成，由 ${winner} 吃下；牌桌會停留 3 秒再清空。`;
    return;
  }
  const current = game.currentPlayer !== null && game.currentPlayer !== undefined ? game.players[game.currentPlayer]?.name : "";
  const helps = {
    [PHASE.BIDDING]: `輪到 ${current} 叫牌。叫「數字＋花色」，同數字依 ♣ < ♦ < ♥ < ♠ 比較；叫牌後其他 4 家都 Pass 才結束。`,
    [PHASE.TRUMP]: `拿破崙 ${current} 選擇王牌。`,
    [PHASE.EXCHANGE]: "拿破崙已依最高叫品決定王牌並拿起底牌，請選 4 張蓋牌棄出。",
    [PHASE.SECRETARY]: "拿破崙指定一張秘書牌；持有者暗中同隊。",
    [PHASE.PLAY]: `第 ${game.trickNo + 1} 墩，輪到 ${current} 出牌。`,
    [PHASE.ROUND_END]: "本局已結束，房主可開始下一局。"
  };
  $("phaseHelp").textContent = helps[game.phase] || "";
}

function renderTableTrump(game) {
  const el = $("tableTrump");
  if (!el) return;
  const hasTrump = game.napoleon !== null && game.napoleon !== undefined && game.trump;
  if (!hasTrump) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const suit = game.trump;
  const suitMeta = SUITS[suit] || {};
  const bidText = formatBid(game.bid || game.bidding?.highest);
  el.className = `table-trump ${suitMeta.color === "red" ? "red" : "black"} ${suit === "NT" ? "no-trump" : ""}`;
  el.innerHTML = `
    <span>王牌</span>
    <b>${escapeHtml(suitName(suit))}</b>
    <small>叫品 ${escapeHtml(bidText)}</small>
  `;
}

function renderTableTeamHeads(game) {
  const el = $("tableTeamHeads");
  if (!el) return;
  const hasNapoleon = game.napoleon !== null && game.napoleon !== undefined;
  if (!hasNapoleon || game.phase === PHASE.BIDDING) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }

  const napoleonHeads = countPoints(game.captured?.[game.napoleon] || []);
  const secretaryKnown = Boolean(game.secretaryRevealed && game.secretaryOwner !== null && game.secretaryOwner !== undefined);
  const shownSeats = new Set([game.napoleon]);
  if (secretaryKnown) shownSeats.add(game.secretaryOwner);
  const shownHeads = Array.from(shownSeats).reduce((sum, seat) => sum + countPoints(game.captured?.[seat] || []), 0);
  const target = game.contract ? ` / ${game.contract}` : "";
  const label = secretaryKnown
    ? (game.secretaryOwner === game.napoleon ? "拿破崙獨裁" : "拿破崙＋秘書")
    : "拿破崙已吃";
  const hint = secretaryKnown ? "秘書已公開，顯示合計頭數" : "秘書未公開，只顯示拿破崙個人頭數";

  el.className = `table-heads ${secretaryKnown ? "secret-open" : "secret-hidden"}`;
  el.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <b>${shownHeads}${target} 頭</b>
    <small>${escapeHtml(hint)}</small>
  `;
}

function renderContract(game) {
  if (game.napoleon === null || game.napoleon === undefined) {
    if (game.phase === PHASE.BIDDING) {
      const high = game.bidding?.highest || null;
      const highPlayer = high ? game.players?.[high.seat]?.name : null;
      const current = game.currentPlayer !== null && game.currentPlayer !== undefined ? game.players?.[game.currentPlayer]?.name : null;
      $("contractInfo").innerHTML = `
        <div class="bid-mini">
          <span>輪到叫牌</span><b>${escapeHtml(current || "-")}</b>
        </div>
        <div class="bid-mini emphasized">
          <span>目前最高叫品</span><b>${escapeHtml(formatBid(high))}</b>
          ${highPlayer ? `<small>${escapeHtml(highPlayer)} 領先</small>` : `<small>尚未有人叫牌</small>`}
        </div>
      `;
    } else {
      $("contractInfo").innerHTML = "尚未叫牌";
    }
    return;
  }
  const secretaryCard = game.secretaryCardId ? findCardById(game.secretaryCardId) : null;
  const secretaryText = game.secretaryRevealed && game.secretaryOwner !== null && game.secretaryOwner !== undefined
    ? `${game.players[game.secretaryOwner].name}（${cardLong(secretaryCard)}）`
    : (secretaryCard ? `${cardLong(secretaryCard)}（未公開）` : "未指定");
  $("contractInfo").innerHTML = `
    <div><b>拿破崙：</b>${escapeHtml(game.players[game.napoleon].name)}</div>
    <div><b>叫牌／成約：</b>${formatBid(game.bid || game.bidding?.highest)} / ${game.contract || "-"} 頭</div>
    <div><b>王牌：</b>${suitName(game.trump)}</div>
    <div><b>秘書：</b>${secretaryText}</div>
    <div><b>底牌頭：</b>${countPoints(game.buried || [])}</div>
  `;
}

function renderScores(game) {
  const scoreBoard = document.querySelector(".scoreboard");
  const hideDuringGame = game.phase !== PHASE.ROUND_END;
  if (scoreBoard) scoreBoard.classList.toggle("hidden", hideDuringGame);
  if (hideDuringGame) {
    $("scoreList").innerHTML = "";
    return;
  }

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
  const biddingHighest = game.phase === PHASE.BIDDING ? (game.bidding?.highest || null) : null;
  for (let seat = 0; seat < 5; seat += 1) {
    const p = game.players[seat];
    const el = $(`seat${seat}`);
    const current = game.currentPlayer === seat ? "current" : "";
    const isMine = mine === seat ? "mine" : "";
    const biddingTurn = game.phase === PHASE.BIDDING && game.currentPlayer === seat ? "bidding-turn" : "";
    const bidLeader = biddingHighest && biddingHighest.seat === seat ? "bid-leader" : "";
    el.className = `seat seat-${seat} ${current} ${isMine} ${biddingTurn} ${bidLeader}`;
    const tags = [];
    const capturedHeads = countPoints(game.captured?.[seat] || []);
    tags.push(`<span class="tag">${p.hand?.length || 0} 張</span>`);
    tags.push(`<span class="tag">吃 ${capturedHeads} 頭</span>`);
    if (p.type === "bot") tags.push(`<span class="tag gold">電腦</span>`);
    if (game.phase === PHASE.BIDDING && game.currentPlayer === seat) tags.push(`<span class="tag call-active">輪到叫牌</span>`);
    if (biddingHighest && biddingHighest.seat === seat) tags.push(`<span class="tag call-high">最高 ${escapeHtml(formatBid(biddingHighest))}</span>`);
    if (p.seat === game.napoleon) tags.push(`<span class="tag danger">拿破崙</span>`);
    if (p.seat === game.secretaryOwner && game.secretaryRevealed) tags.push(`<span class="tag gold">秘書</span>`);
    if (game.phase === PHASE.BIDDING && p.lastBid !== null && p.lastBid !== undefined && (!biddingHighest || biddingHighest.seat !== seat || p.lastBid === "Pass")) tags.push(`<span class="tag">${escapeHtml(p.lastBid)}</span>`);
    el.innerHTML = `<div class="player-name">${escapeHtml(p.name)}${mine === seat ? "（你）" : ""}</div><div class="player-meta">${tags.join("")}</div>`;
  }
}

function renderTrick(game) {
  if (game.phase === PHASE.BIDDING) {
    for (let seat = 0; seat < 5; seat += 1) {
      const holder = $(`play${seat}`);
      if (!holder) continue;
      holder.innerHTML = "";
      holder.classList.add("empty");
      holder.classList.remove("leading");
    }
    $("trickArea").innerHTML = renderBiddingStatus(game);
    $("kittyArea").textContent = `底牌：${game.kitty?.length || 4} 張`;
    return;
  }

  const bestPlay = currentBestTrickPlay(game);
  for (let seat = 0; seat < 5; seat += 1) {
    const holder = $(`play${seat}`);
    if (!holder) continue;
    const play = (game.trick || []).find((item) => item.seat === seat);
    if (play) {
      const isBest = bestPlay && bestPlay.seat === play.seat && bestPlay.card?.id === play.card?.id;
      const bestLabel = game.pendingClear ? "本墩最大" : "目前最大";
      holder.innerHTML = `
        <div class="trick-card ${isBest ? "leading" : ""}">
          ${isBest ? `<div class="lead-badge">${bestLabel}</div>` : ""}
          <div class="play-card ${cardClass(play.card)}">${cardLabel(play.card)}</div>
          <small>${escapeHtml(game.players[seat].name)}</small>
        </div>`;
      holder.classList.remove("empty");
      holder.classList.toggle("leading", Boolean(isBest));
    } else {
      holder.innerHTML = "";
      holder.classList.add("empty");
      holder.classList.remove("leading");
    }
  }

  let centerText = "等待出牌";
  if (game.pendingClear) {
    const winner = game.players[game.pendingClear.winner]?.name || "勝方";
    centerText = `${winner} 吃下本墩：${game.pendingClear.heads || 0} 頭`;
  } else if ((game.trick || []).length) {
    centerText = `第 ${game.trickNo + 1} 墩，已出 ${game.trick.length}/5 張`;
  }
  $("trickArea").innerHTML = `<div class="table-status">${escapeHtml(centerText)}</div>`;
  const kittyText = game.phase === PHASE.EXCHANGE && game.napoleon === myGameSeat(game)
    ? `你已拿起底牌，請蓋掉 4 張。`
    : (game.buried?.length ? `底牌已蓋牌：${game.buried.length} 張` : `底牌：${game.kitty?.length || 4} 張`);
  $("kittyArea").textContent = kittyText;
}

function renderBiddingStatus(game) {
  const current = game.currentPlayer !== null && game.currentPlayer !== undefined ? game.players?.[game.currentPlayer]?.name : "-";
  const high = game.bidding?.highest || null;
  const highPlayer = high ? game.players?.[high.seat]?.name : null;
  const passCount = high ? (game.bidding?.consecutivePasses || 0) : (game.bidding?.passesWithoutBid || 0);
  const passNeed = high ? 4 : 5;
  return `
    <div class="bid-status">
      <div class="bid-current">
        <span>現在輪到</span>
        <b>${escapeHtml(current)}</b>
        <em>叫牌</em>
      </div>
      <div class="bid-highlight">
        <span>目前最高叫品</span>
        <strong>${escapeHtml(formatBid(high))}</strong>
        <small>${highPlayer ? `${escapeHtml(highPlayer)} 領先` : "尚未有人叫牌"}</small>
      </div>
      <div class="bid-pass-count">連續 Pass：${passCount}/${passNeed}</div>
    </div>
  `;
}


function currentBestTrickPlay(game) {
  const trick = game?.trick || [];
  if (!trick.length) return null;
  const leadSuit = effectiveLeadSuit(trick);
  let best = trick[0];
  for (const play of trick.slice(1)) {
    if (cardStrength(play.card, game, leadSuit) > cardStrength(best.card, game, leadSuit)) best = play;
  }
  return best;
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
  if (game.pendingClear) {
    const winner = game.players[game.pendingClear.winner]?.name || "勝方";
    el.innerHTML = `<p class="hint">${escapeHtml(winner)} 吃下本墩，牌桌保留 3 秒後清空。</p>`;
    return;
  }
  if (game.phase === PHASE.ROUND_END) {
    el.innerHTML = isHost()
      ? `<button id="btnNextRound" class="primary">開始下一局</button>`
      : `<p class="hint">等待房主開始下一局。</p>`;
    $("btnNextRound")?.addEventListener("click", hostNextRound);
    return;
  }
  if (!myTurn) {
    if (game.phase === PHASE.BIDDING) {
      el.innerHTML = `<div class="action-bid-banner">${renderBiddingStatus(game)}</div><p class="hint">等待 ${escapeHtml(game.players[game.currentPlayer]?.name || "其他玩家")} 叫牌。</p>`;
    } else {
      el.innerHTML = `<p class="hint">等待 ${escapeHtml(game.players[game.currentPlayer]?.name || "其他玩家")} 操作。</p>`;
    }
    return;
  }
  if (game.phase === PHASE.BIDDING) {
    const bids = legalBidsAbove(game.bidding?.highest || null, game.settings);
    const options = bids.map((b) => `<option value="${b.amount}|${b.suit}">${formatBid(b)}</option>`);
    const bidControl = options.length
      ? `<label class="field"><span>叫牌</span><select id="bidSelect">${options.join("")}</select></label><button id="btnBid" class="primary">叫牌</button>`
      : `<p class="hint">已是最高叫品，只能 Pass。</p>`;
    el.innerHTML = `<div class="action-bid-banner">${renderBiddingStatus(game)}</div><p class="hint">同數字花色大小：♣ < ♦ < ♥ < ♠${game.settings?.trumpMode === "allowNoTrump" ? " < 無王" : ""}。</p><div class="inline">${bidControl}<button id="btnPass" class="ghost">Pass</button></div>`;
    $("btnBid")?.addEventListener("click", () => {
      const [amount, suit] = $("bidSelect").value.split("|");
      submitAction("bid", { amount: Number(amount), suit });
    });
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

function getLogVisible() {
  return localStorage.getItem(STORAGE.logVisible) === "1";
}

function applyLogVisibility(visible) {
  const gameView = $("gameView");
  if (!gameView) return;
  gameView.classList.toggle("log-collapsed", !visible);
  const btn = $("btnToggleLog");
  if (btn) {
    btn.textContent = visible ? "隱藏紀錄" : "顯示紀錄";
    btn.setAttribute("aria-expanded", visible ? "true" : "false");
  }
}

function toggleLogVisibility() {
  const next = !getLogVisible();
  localStorage.setItem(STORAGE.logVisible, next ? "1" : "0");
  applyLogVisibility(next);
  renderLog(appState.room?.game || { log: [] });
}

function renderLog(game) {
  const entries = game.log || [];
  $("log").innerHTML = entries.map((msg) => `<div class="log-entry">${escapeHtml(msg)}</div>`).join("");
  applyLogVisibility(getLogVisible());
  const summary = $("logSummary");
  if (summary) {
    summary.textContent = entries.length ? `已隱藏 ${entries.length} 筆紀錄，需要時可展開查看。` : "牌局紀錄已隱藏。";
  }
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

function isHeadCard(card) {
  if (!card) return false;
  if (card.point === true) return true;
  if (POINT_RANKS.has(card.rank)) return true;
  const id = String(card.id || "");
  return /^(S|H|D|C)(A|K|Q|J)$/.test(id);
}

function countPoints(cards) {
  return (cards || []).filter(isHeadCard).length;
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
