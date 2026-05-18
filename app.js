let initializeApp;
let getAuth;
let signInAnonymously;
let getDatabase;
let ref;
let set;
let get;
let update;
let push;
let remove;
let onValue;
let onChildAdded;
let off;
let runTransaction;
let onDisconnect;
let serverTimestamp;

async function loadFirebaseSdk() {
  if (initializeApp) return;
  const [appMod, authMod, dbMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js")
  ]);
  initializeApp = appMod.initializeApp;
  getAuth = authMod.getAuth;
  signInAnonymously = authMod.signInAnonymously;
  getDatabase = dbMod.getDatabase;
  ref = dbMod.ref;
  set = dbMod.set;
  get = dbMod.get;
  update = dbMod.update;
  push = dbMod.push;
  remove = dbMod.remove;
  onValue = dbMod.onValue;
  onChildAdded = dbMod.onChildAdded;
  off = dbMod.off;
  runTransaction = dbMod.runTransaction;
  onDisconnect = dbMod.onDisconnect;
  serverTimestamp = dbMod.serverTimestamp;
}

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
    await loadFirebaseSdk();
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

async function hostReturnToLobby() {
  if (!isHost()) return;
  if (appState.offline) {
    leaveRoom(false);
    return;
  }
  await update(roomRef(), {
    "meta/status": "lobby",
    "meta/updatedAt": Date.now(),
    game: null
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
    trickHistory: [],
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
  if (!Array.isArray(game.trickHistory)) game.trickHistory = [];
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

function illegalPlayReason(game, seat, card) {
  if (!game || seat === null || seat === undefined) return "目前不在牌局中。";
  if (game.phase !== PHASE.PLAY) return "目前不是出牌階段。";
  if (game.pendingClear) return "本墩剛結束，請等牌桌清空後再出牌。";
  if (game.currentPlayer !== seat) return "還沒輪到你出牌。";
  const hand = game.players?.[seat]?.hand || [];
  if (!card || !hand.some((c) => c.id === card.id)) return "這張牌不在你的手牌中。";
  const legalIds = new Set(legalCardsFor(game, seat).map((c) => c.id));
  if (legalIds.has(card.id)) return "這張牌可以出。";
  if (game.requestedId && hand.some((c) => c.id === game.requestedId)) {
    const requested = findCardById(game.requestedId);
    return `目前有人召 ${cardLong(requested)}，你手上有這張牌，必須先打出。`;
  }
  const leadSuit = effectiveLeadSuit(game.trick);
  if (leadSuit) {
    const hasLeadSuit = hand.some((c) => !c.joker && c.suit === leadSuit);
    if (hasLeadSuit && (card.joker || card.suit !== leadSuit)) {
      return `本墩首引花色是${suitName(leadSuit)}，你手上有${suitName(leadSuit)}，必須先跟牌。`;
    }
  }
  return "這張牌目前不能出，請選擇亮起的合法牌。";
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
  game.trickHistory = [
    ...(Array.isArray(game.trickHistory) ? game.trickHistory : []),
    {
      trickNo: game.trickNo,
      leadSuit,
      winner,
      heads,
      plays: game.trick.map((p) => ({ seat: p.seat, card: p.card, leadSuit: p.leadSuit || null }))
    }
  ].slice(-12);
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

function aiPersonality(seat) {
  const types = [
    { type: "balanced", bidBias: 0, risk: 0, feed: 0, block: 0 },
    { type: "conservative", bidBias: -0.55, risk: -0.34, feed: 0.15, block: 0.12 },
    { type: "aggressive", bidBias: 0.48, risk: 0.38, feed: -0.06, block: 0.25 },
    { type: "support", bidBias: -0.18, risk: -0.08, feed: 0.38, block: 0.05 },
    { type: "blocker", bidBias: 0.05, risk: 0.12, feed: -0.02, block: 0.42 }
  ];
  return types[Math.abs(Number(seat) || 0) % types.length];
}

function aiBidAction(game, seat) {
  const player = game.players[seat];
  const highest = game.bidding?.highest || null;
  const difficulty = Number(game.settings?.difficulty || 10);
  const personality = aiPersonality(seat);
  const profile = aiEvaluateBidProfile(player.hand, game.settings, difficulty);
  const legalAll = legalBidsAbove(highest, game.settings);
  if (!legalAll.length) return { uid: player.uid, seat, type: "pass", payload: {} };

  const safeLegal = legalAll.filter((b) => b.amount <= profile.ceiling);
  const minimumNeeded = legalAll[0];
  const marginal = profile.ceiling <= minimumNeeded.amount;
  const currentPressure = highest ? Math.max(0, bidValue(highest) - bidValue({ amount: 9, suit: "C" })) / 80 : 0;
  const expectedGap = profile.expectedHeads - (highest ? highest.amount : 9);
  const passDiscipline = aiClamp(
    0.10 + (21 - difficulty) * 0.018 + currentPressure * 0.12 + (marginal ? 0.22 : 0)
      - personality.bidBias * 0.12 - aiClamp(expectedGap, -2, 3) * 0.035,
    0.04,
    0.68
  );

  // 弱牌、牌型不集中、或只是勉強能蓋過目前叫品時，高難度電腦會更願意 Pass。
  if (!safeLegal.length || profile.confidence < 0.24 || profile.expectedHeads < minimumNeeded.amount - 0.75 || (marginal && Math.random() < passDiscipline)) {
    return { uid: player.uid, seat, type: "pass", payload: {} };
  }

  const byAmount = new Map();
  safeLegal.forEach((b) => {
    if (!byAmount.has(b.amount)) byAmount.set(b.amount, []);
    byAmount.get(b.amount).push(b);
  });
  const legalAmounts = [...byAmount.keys()].sort((a, b) => a - b);
  let chosenAmount = legalAmounts[0];

  // 真正牌力強時才跳叫；否則以最低安全叫品為主，避免電腦亂衝。
  const roomAbove = profile.ceiling - chosenAmount;
  const jumpIntent = aiClamp((profile.confidence - 0.58) * 0.55 + (difficulty - 12) * 0.018 + roomAbove * 0.045 + personality.bidBias * 0.08, 0, 0.50);
  if (roomAbove >= 2 && Math.random() < jumpIntent) chosenAmount = Math.min(profile.ceiling, chosenAmount + 1);
  if (roomAbove >= 4 && profile.confidence > 0.76 && difficulty >= 17 && Math.random() < 0.18) chosenAmount = Math.min(profile.ceiling, chosenAmount + 1);
  if (!byAmount.has(chosenAmount)) chosenAmount = legalAmounts.filter((n) => n <= chosenAmount).pop() || legalAmounts[0];

  const candidates = byAmount.get(chosenAmount) || safeLegal;
  const bid = candidates
    .map((b) => ({ bid: b, score: aiBidSuitScore(profile, b) + (Math.random() - 0.5) * Math.max(0.02, (21 - difficulty) / 95) }))
    .sort((a, b) => b.score - a.score)[0].bid;

  return { uid: player.uid, seat, type: "bid", payload: bid };
}

function aiEvaluateBidProfile(hand, settings, difficulty = 10) {
  const suits = allowedBidSuits(settings);
  const suitScores = aiSuitScores(hand);
  const suitDetails = aiSuitDetails(hand);
  const points = countPoints(hand);
  const jokers = hand.filter((c) => c.joker).length;
  const hasBigJoker = hand.some((c) => c.id === "BJ");
  const hasSmallJoker = hand.some((c) => c.id === "RJ");
  const aces = hand.filter((c) => c.rank === "A").length;
  const kings = hand.filter((c) => c.rank === "K").length;
  const queens = hand.filter((c) => c.rank === "Q").length;
  const jacks = hand.filter((c) => c.rank === "J").length;
  const suitEntries = Object.entries(suitDetails).filter(([s]) => suits.includes(s));
  const bestSuit = suitEntries.sort((a, b) => b[1].bidScore - a[1].bidScore)[0] || ["S", suitDetails.S];
  const longest = Math.max(...Object.values(suitDetails).map((d) => d.count));
  const voids = Object.values(suitDetails).filter((d) => d.count === 0).length;
  const singletons = Object.values(suitDetails).filter((d) => d.count === 1).length;
  const balancedPenalty = Math.max(0, 3 - longest) * 0.28;
  const concentration = bestSuit[1].count * 0.25 + bestSuit[1].pointCount * 0.58 + bestSuit[1].topCount * 0.34;
  const controls = jokers * 1.18 + (hasBigJoker ? 0.24 : 0) + (hasSmallJoker ? 0.16 : 0) + aces * 0.25 + kings * 0.12 + queens * 0.05;
  const headPower = points * 0.31 + Math.max(0, points - 4) * 0.12;
  const shape = Math.max(0, longest - 3) * 0.22 + voids * 0.08 - singletons * 0.03;
  const ntBonus = settings?.trumpMode === "allowNoTrump" ? aiNoTrumpBidScore(hand, suitDetails, points, jokers) : -99;
  if (suits.includes("NT")) {
    suitScores.NT = ntBonus * 12;
  }
  const expectedBySuit = aiExpectedHeadProfile(hand, settings, suitDetails);
  const bestExpected = Math.max(...Object.values(expectedBySuit).filter((v) => Number.isFinite(v)));
  const rawShapePower = 8.05 + headPower + controls + concentration + shape - balancedPenalty + difficulty / 115;
  // 期望頭數模型：高難度叫牌會更接近「實際可拿幾頭」，低難度仍帶一些冒險與誤判。
  const expectedHeads = aiClamp(bestExpected + difficulty / 85, 7.2, 15.8);
  const raw = rawShapePower * 0.45 + expectedHeads * 0.55;
  const randomRisk = (Math.random() - 0.5) * Math.max(0.04, (21 - difficulty) * 0.038);
  const ceiling = Math.max(8, Math.min(16, Math.floor(raw + randomRisk)));
  const confidence = aiClamp((raw - 8.35) / 5.35, 0, 1);
  return { ceiling, confidence, suitScores, suitDetails, bestSuit: bestSuit[0], points, jokers, raw, expectedHeads, expectedBySuit };
}

function aiExpectedHeadProfile(hand, settings, suitDetails = aiSuitDetails(hand)) {
  const suits = allowedBidSuits(settings);
  const jokers = hand.filter((c) => c.joker).length;
  const bigJoker = hand.some((c) => c.id === "BJ") ? 0.55 : 0;
  const smallJoker = hand.some((c) => c.id === "RJ") ? 0.42 : 0;
  const totalHeads = countPoints(hand);
  const aces = hand.filter((c) => c.rank === "A").length;
  const kings = hand.filter((c) => c.rank === "K").length;
  const queens = hand.filter((c) => c.rank === "Q").length;
  const jacks = hand.filter((c) => c.rank === "J").length;
  const map = {};
  for (const suit of ["S", "H", "D", "C"]) {
    const d = suitDetails[suit];
    const trumpHeads = d.pointCount;
    const longTrump = Math.max(0, d.count - 3);
    const topTrump = d.topCount;
    const shortSide = Object.entries(suitDetails).filter(([s]) => s !== suit).reduce((n, [, x]) => n + (x.count <= 1 ? 1 : 0), 0);
    const isolatedHeads = Object.entries(suitDetails).filter(([s]) => s !== suit).reduce((n, [, x]) => n + (x.count <= 1 ? x.pointCount : 0), 0);
    map[suit] = 8.15
      + totalHeads * 0.36
      + trumpHeads * 0.62
      + longTrump * 0.48
      + topTrump * 0.30
      + jokers * 0.78 + bigJoker + smallJoker
      + aces * 0.18 + kings * 0.08 + queens * 0.03
      + shortSide * 0.16
      - isolatedHeads * 0.17
      + SUITS[suit].order * 0.03;
  }
  if (suits.includes("NT")) {
    const counts = Object.values(suitDetails).map((d) => d.count);
    const balanced = counts.filter((n) => n >= 2).length;
    const voids = counts.filter((n) => n === 0).length;
    const singletons = counts.filter((n) => n === 1).length;
    map.NT = 7.85 + totalHeads * 0.32 + jokers * 0.95 + aces * 0.26 + kings * 0.14 + queens * 0.05 + balanced * 0.18 - voids * 0.9 - singletons * 0.32;
  }
  return map;
}

function aiBidSuitScore(profile, bid) {
  const detail = profile.suitDetails[bid.suit];
  const expectedFit = (profile.expectedBySuit?.[bid.suit] || 0) - bid.amount;
  if (bid.suit === "NT") return (profile.suitScores.NT || 0) + bid.amount * 0.04 + expectedFit * 1.15;
  return (profile.suitScores[bid.suit] || 0)
    + (detail?.count || 0) * 0.95
    + (detail?.pointCount || 0) * 1.4
    + (detail?.topCount || 0) * 0.72
    + expectedFit * 1.25
    + SUITS[bid.suit].order * 0.05
    - Math.max(0, bid.amount - profile.ceiling) * 8;
}

function aiSuitDetails(hand) {
  const details = {
    S: { count: 0, pointCount: 0, topCount: 0, rankSum: 0, bidScore: 0 },
    H: { count: 0, pointCount: 0, topCount: 0, rankSum: 0, bidScore: 0 },
    D: { count: 0, pointCount: 0, topCount: 0, rankSum: 0, bidScore: 0 },
    C: { count: 0, pointCount: 0, topCount: 0, rankSum: 0, bidScore: 0 }
  };
  for (const card of hand) {
    if (!card.suit || card.joker) continue;
    const d = details[card.suit];
    d.count += 1;
    d.rankSum += card.value;
    if (isHeadCard(card)) d.pointCount += 1;
    if (["A", "K", "Q"].includes(card.rank)) d.topCount += 1;
  }
  for (const [suit, d] of Object.entries(details)) {
    d.bidScore = d.count * 2.2 + d.pointCount * 3.2 + d.topCount * 1.5 + d.rankSum * 0.18 + SUITS[suit].order * 0.12;
  }
  return details;
}

function aiNoTrumpBidScore(hand, suitDetails, points, jokers) {
  const counts = Object.values(suitDetails).map((d) => d.count);
  const longest = Math.max(...counts);
  const voids = counts.filter((n) => n === 0).length;
  const singletons = counts.filter((n) => n === 1).length;
  const highControls = hand.filter((c) => c.joker || c.rank === "A" || c.rank === "K").length;
  return jokers * 1.25 + highControls * 0.42 + points * 0.18 - longest * 0.08 - voids * 0.75 - singletons * 0.25;
}

function aiSuitScores(hand) {
  const scores = { S: 0, H: 0, D: 0, C: 0, NT: 0 };
  const details = aiSuitDetails(hand);
  const jokers = hand.filter((c) => c.joker).length;
  for (const suit of ["S", "H", "D", "C"]) {
    const d = details[suit];
    scores[suit] = d.bidScore + jokers * 3.8 + d.count * 0.35;
  }
  scores.NT = aiNoTrumpBidScore(hand, details, countPoints(hand), jokers) * 8;
  return scores;
}

function estimateHand(hand, settings) {
  return aiEvaluateBidProfile(hand, settings, settings?.difficulty || 10).raw;
}

function aiChooseTrump(game, seat) {
  const scores = aiSuitScores(game.players[seat].hand);
  return Object.entries(scores)
    .filter(([s]) => allowedBidSuits(game.settings).includes(s))
    .sort((a, b) => b[1] - a[1])[0][0];
}

function aiChooseBuried(game, seat) {
  const hand = game.players[seat].hand || [];
  if (hand.length <= 4) return hand.map((c) => c.id);

  // V6: 拿破崙換底牌改用組合評分。不是只丟單張最低分，而是考慮能否清短門、保留王牌控制、避免把頭送進底牌。
  let best = null;
  for (let a = 0; a < hand.length - 3; a += 1) {
    for (let b = a + 1; b < hand.length - 2; b += 1) {
      for (let c = b + 1; c < hand.length - 1; c += 1) {
        for (let d = c + 1; d < hand.length; d += 1) {
          const combo = [hand[a], hand[b], hand[c], hand[d]];
          const score = aiBurialComboScore(game, seat, combo);
          if (!best || score < best.score) best = { combo, score };
        }
      }
    }
  }
  return (best?.combo || [...hand].sort((a, b) => aiDiscardValue(a, game, seat) - aiDiscardValue(b, game, seat)).slice(0, 4)).map((card) => card.id);
}

function aiBurialComboScore(game, seat, combo) {
  const hand = game.players?.[seat]?.hand || [];
  const kept = hand.filter((card) => !combo.some((x) => x.id === card.id));
  const buriedMode = game.settings?.buriedMode || "addContract";
  const trump = game.trump;
  let score = combo.reduce((sum, card) => sum + aiDiscardValue(card, game, seat), 0);
  const buriedHeads = countPoints(combo);
  const buriedTrump = combo.filter((c) => trump && trump !== "NT" && c.suit === trump).length;
  const buriedJokers = combo.filter((c) => c.joker).length;

  // 多數玩法底牌頭會增加成約或讓防家收益，所以高難度拿破崙不輕易蓋牌頭。
  if (buriedMode === "addContract") score += buriedHeads * 9;
  else if (buriedMode === "defenders") score += buriedHeads * 14;
  else score += buriedHeads * 3;
  score += buriedJokers * 80 + buriedTrump * 10;

  for (const suit of ["S", "H", "D", "C"]) {
    const before = hand.filter((c) => c.suit === suit).length;
    const after = kept.filter((c) => c.suit === suit).length;
    const buriedSuitHeads = combo.filter((c) => c.suit === suit && isHeadCard(c)).length;
    const suitIsTrump = trump && trump !== "NT" && suit === trump;
    if (!suitIsTrump && before > 0 && after === 0 && buriedSuitHeads === 0) score -= 11; // 清短門，之後可切牌。
    if (!suitIsTrump && before <= 2 && after === 0) score -= 3;
    if (suitIsTrump && after < 2 && before >= 3) score += 9; // 不把王牌控制清太薄。
    if (!suitIsTrump && buriedSuitHeads > 0 && before <= 2) score += 5; // 避免短門頭牌埋掉讓成約變硬。
  }

  // 保留至少一張低牌作為出牌退路，不要手上只剩高頭牌與王牌。
  const lowExitCards = kept.filter((c) => !c.joker && !isHeadCard(c) && !(trump && trump !== "NT" && c.suit === trump) && c.value <= 9).length;
  if (lowExitCards === 0) score += 8;
  else if (lowExitCards >= 3) score -= 2;

  return score;
}

function aiDiscardValue(card, game, seat) {
  let value = card.value * 0.65;
  const buriedMode = game.settings?.buriedMode || "addContract";
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  const hand = game.players?.[seat]?.hand || [];
  const sameSuitCount = card.suit ? hand.filter((c) => c.suit === card.suit).length : 0;

  if (isHeadCard(card)) value += buriedMode === "ignore" ? 12 : 22;
  if (card.id === game.secretaryCardId) value += 120;
  if (card.joker) value += 55;
  if (isTrump) value += 18 + (isHeadCard(card) ? 6 : 0);
  if (card.rank === "A") value += 11;
  if (card.rank === "K") value += 7;
  if (card.rank === "Q") value += 4;
  if (sameSuitCount <= 2 && !isHeadCard(card) && !isTrump) value -= 2.2; // 順手清短門。
  if (sameSuitCount >= 4 && !isHeadCard(card) && card.value <= 8) value -= 1.1; // 長門小牌可蓋掉。
  return value;
}

function aiChooseSecretary(game, seat) {
  const own = new Set(game.players[seat].hand.map((c) => c.id));
  const buried = new Set((game.buried || []).map((c) => c.id));
  const allowSolo = Boolean(game.settings?.allowSelfSecretary && aiShouldConsiderSolo(game, seat));
  const candidates = makeDeck().filter((c) => !buried.has(c.id) && (allowSolo || !own.has(c.id)));
  const preferred = candidates
    .map((card) => ({ card, score: cardSecretaryValue(card, game, seat, own) + aiSecretarySynergy(card, game, seat) }))
    .sort((a, b) => b.score - a.score);
  return (preferred[0]?.card || candidates[0]).id;
}

function aiSecretarySynergy(card, game, seat) {
  if (!card) return 0;
  const hand = game.players?.[seat]?.hand || [];
  const profile = aiEvaluateBidProfile(hand, game.settings, game.settings?.difficulty || 10);
  const sameSuit = card.suit ? hand.filter((c) => c.suit === card.suit).length : 0;
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  let score = 0;
  // 高叫品需要更可靠的秘書牌；低叫品可偏向補弱門。
  if (getBidAmount(game) >= 12 && (card.joker || isTrump || card.rank === "A")) score += 10;
  if (sameSuit <= 1 && card.suit && isHeadCard(card)) score += 7;
  if (sameSuit === 0 && card.suit && !isTrump) score += 3;
  if (profile.expectedBySuit?.[card.suit] && profile.expectedBySuit[card.suit] < profile.expectedHeads - 1.2 && isHeadCard(card)) score += 4;
  if (card.rank === "J" && !isTrump && getBidAmount(game) >= 12) score -= 2;
  return score;
}

function aiShouldConsiderSolo(game, seat) {
  const profile = aiEvaluateBidProfile(game.players[seat].hand, game.settings, game.settings?.difficulty || 10);
  const jokers = game.players[seat].hand.filter((c) => c.joker).length;
  return profile.ceiling >= Math.max(12, getBidAmount(game) + 1) && profile.points >= 6 && jokers >= 1;
}

function cardSecretaryValue(card, game, seat = null, own = new Set()) {
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  const ownPenalty = own.has(card.id) ? 34 : 0;
  let value = 0;
  if (card.joker) value += card.bigJoker ? 140 : 126;
  if (isTrump) value += 34;
  if (isHeadCard(card)) value += 30;
  if (card.rank === "A") value += 24;
  else if (card.rank === "K") value += 17;
  else if (card.rank === "Q") value += 10;
  else if (card.rank === "J") value += 7;
  value += card.value * 0.75;

  // 若某花色自己很短，選該花色大牌當秘書，常能讓秘書在防家以為安全時突然出現。
  if (seat !== null && card.suit) {
    const ownSuitCount = game.players?.[seat]?.hand?.filter((c) => c.suit === card.suit).length || 0;
    if (ownSuitCount <= 1 && isHeadCard(card)) value += 8;
    if (ownSuitCount >= 4 && !isTrump) value -= 4;
  }
  return value - ownPenalty;
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
  const scored = legal.map((card) => {
    const baseScore = aiScorePlayCard(game, seat, card, context);
    const advancedScore = aiAdvancedPlayAdjustment(game, seat, card, context, legal);
    return { card, score: baseScore + advancedScore };
  });
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
  const seatsAfter = aiSeatsStillToAct(game, seat);
  const opponentsAfter = seatsAfter.filter((s) => aiTeamView(game, s, seat) !== myTeam).length;
  const alliesAfter = seatsAfter.length - opponentsAfter;
  const actingLast = seatsAfter.length === 0;
  const late = (game.trickNo || 0) >= 7;
  const midLate = (game.trickNo || 0) >= 5;
  const player = game.players?.[seat] || { hand: [] };
  const handHeads = countPoints(player.hand || []);
  const trumpCount = game.trump && game.trump !== "NT" ? (player.hand || []).filter((c) => c.suit === game.trump || c.joker).length : 0;
  const napUrgency = aiClamp(napNeeds / Math.max(1, remainingHeads + pointsOnTable), 0, 1.6);
  const defenderUrgency = aiClamp((4 - napNeeds) / 4, 0, 1.5);
  const remainingBySuit = aiRemainingBySuit(game, seat);
  const memory = aiBuildCardMemory(game, seat);
  const secretaryGuess = aiInferSecretaryOwner(game, seat, memory);
  const contractMode = aiContractMode(game, seat, totals, pointsOnTable, remainingHeads, napNeeds, myTeam);
  const personality = aiPersonality(seat);
  const trumpState = aiTrumpControlState(game, seat, memory);
  const suitPlan = aiSuitPlan(game, seat, myTeam, memory);
  return {
    totals,
    pointsOnTable,
    remainingHeads,
    capturedHeads,
    napNeeds,
    napUrgency,
    defenderUrgency,
    myTeam,
    currentWinner,
    currentWinnerTeam,
    seatsAfter,
    opponentsAfter,
    alliesAfter,
    actingLast,
    late,
    midLate,
    handHeads,
    trumpCount,
    difficulty: Number(game.settings?.difficulty || 10),
    leadSuit: effectiveLeadSuit(game.trick),
    remainingBySuit,
    memory,
    secretaryGuess,
    contractMode,
    personality,
    trumpState,
    suitPlan,
    handSize: player.hand?.length || 0
  };
}

function aiScorePlayCard(game, seat, card, ctx) {
  const trickLen = game.trick?.length || 0;
  return trickLen === 0
    ? aiScoreLeadCard(game, seat, card, ctx)
    : aiScoreFollowCard(game, seat, card, ctx);
}

function aiSeatsStillToAct(game, seat) {
  const count = Math.max(0, 4 - (game.trick?.length || 0));
  const seats = [];
  let current = (seat + 1) % 5;
  for (let i = 0; i < count; i += 1) {
    seats.push(current);
    current = (current + 1) % 5;
  }
  return seats;
}

function aiRemainingBySuit(game, seat) {
  const remaining = { S: 13, H: 13, D: 13, C: 13, JOKER: 2 };
  const seen = [];
  (game.players?.[seat]?.hand || []).forEach((c) => seen.push(c));
  (game.trick || []).forEach((p) => seen.push(p.card));
  (game.captured || []).flat().forEach((c) => seen.push(c));
  if (seat === game.napoleon) (game.buried || []).forEach((c) => seen.push(c));
  seen.forEach((c) => {
    if (c?.joker) remaining.JOKER -= 1;
    else if (c?.suit) remaining[c.suit] -= 1;
  });
  return remaining;
}

function aiBuildCardMemory(game, observerSeat) {
  const voids = Array.from({ length: 5 }, () => ({ S: false, H: false, D: false, C: false }));
  const voidConfidence = Array.from({ length: 5 }, () => ({ S: 0, H: 0, D: 0, C: 0 }));
  const knownIds = new Set();
  const playedIds = new Set();
  const addKnown = (card, played = false) => {
    if (!card?.id) return;
    knownIds.add(card.id);
    if (played) playedIds.add(card.id);
  };

  (game.players?.[observerSeat]?.hand || []).forEach((c) => addKnown(c, false));
  (game.trick || []).forEach((p) => addKnown(p.card, true));
  (game.captured || []).flat().forEach((c) => addKnown(c, true));
  if (observerSeat === game.napoleon) (game.buried || []).forEach((c) => addKnown(c, false));

  const histories = Array.isArray(game.trickHistory) ? game.trickHistory : [];
  const currentAsHistory = (game.trick || []).length
    ? [{ leadSuit: effectiveLeadSuit(game.trick), plays: game.trick }]
    : [];
  for (const trick of [...histories, ...currentAsHistory]) {
    const plays = trick.plays || [];
    const leadSuit = trick.leadSuit || aiLeadSuitFromPlays(plays);
    if (!leadSuit) continue;
    for (const play of plays.slice(1)) {
      const card = play.card;
      if (!card || card.joker) continue;
      if (card.suit && card.suit !== leadSuit && voids[play.seat]) {
        voids[play.seat][leadSuit] = true;
        voidConfidence[play.seat][leadSuit] = aiClamp((voidConfidence[play.seat][leadSuit] || 0) + 0.5, 0, 1);
      }
    }
  }

  const remaining = makeDeck().filter((c) => !knownIds.has(c.id));
  const remainingBySuit = { S: 0, H: 0, D: 0, C: 0, JOKER: 0 };
  const remainingHeadsBySuit = { S: 0, H: 0, D: 0, C: 0 };
  const playedBySuit = { S: 0, H: 0, D: 0, C: 0, JOKER: 0 };
  const playedHeadsBySuit = { S: 0, H: 0, D: 0, C: 0 };
  for (const card of remaining) {
    if (card.joker) remainingBySuit.JOKER += 1;
    else if (card.suit) {
      remainingBySuit[card.suit] += 1;
      if (isHeadCard(card)) remainingHeadsBySuit[card.suit] += 1;
    }
  }
  for (const id of playedIds) {
    const card = findCardById(id);
    if (!card) continue;
    if (card.joker) playedBySuit.JOKER += 1;
    else if (card.suit) {
      playedBySuit[card.suit] += 1;
      if (isHeadCard(card)) playedHeadsBySuit[card.suit] += 1;
    }
  }

  return {
    voids,
    voidConfidence,
    remaining,
    remainingBySuit,
    remainingHeadsBySuit,
    playedBySuit,
    playedHeadsBySuit,
    bigJokerSeen: playedIds.has("BJ"),
    smallJokerSeen: playedIds.has("RJ"),
    secretarySeen: game.secretaryCardId ? playedIds.has(game.secretaryCardId) : false
  };
}

function aiInferSecretaryOwner(game, observerSeat, memory = null) {
  if (!game || game.secretaryRevealed || !game.secretaryCardId || game.secretaryOwner === null || game.secretaryOwner === undefined) return null;
  const secret = findCardById(game.secretaryCardId);
  if (!secret) return null;
  const observerHand = game.players?.[observerSeat]?.hand || [];
  if (observerHand.some((c) => c.id === secret.id)) return { seat: observerSeat, confidence: 1, reason: "self" };
  if (observerSeat === game.napoleon) return { seat: game.secretaryOwner, confidence: 0.92, reason: "napoleon-knowledge" };

  const mem = memory || aiBuildCardMemory(game, observerSeat);
  const scores = Array.from({ length: 5 }, (_, seat) => ({ seat, score: seat === game.napoleon ? -99 : 0, eliminated: seat === game.napoleon }));
  for (const item of scores) {
    if (item.eliminated) continue;
    if (secret.suit && mem.voids?.[item.seat]?.[secret.suit]) {
      item.eliminated = true;
      item.score = -99;
    }
  }

  const histories = Array.isArray(game.trickHistory) ? game.trickHistory : [];
  for (const trick of histories) {
    const plays = trick.plays || [];
    const leadSuit = trick.leadSuit || aiLeadSuitFromPlays(plays);
    let bestSoFar = plays[0] || null;
    for (let i = 1; i < plays.length; i += 1) {
      const play = plays[i];
      const item = scores[play.seat];
      if (!item || item.eliminated || play.seat === game.napoleon) continue;
      const beforeWinner = bestSoFar?.seat;
      const beforeNap = beforeWinner === game.napoleon;
      const beforeStrength = bestSoFar ? cardStrength(bestSoFar.card, game, leadSuit) : -1;
      const ownStrength = cardStrength(play.card, game, leadSuit);
      const winsNow = ownStrength > beforeStrength;
      const isPoint = isHeadCard(play.card);
      if (beforeNap && !winsNow && isPoint) item.score += 2.2;
      if (beforeNap && winsNow) item.score -= 1.6;
      if (!beforeNap && beforeWinner !== null && !winsNow && isPoint && trick.winner === game.napoleon) item.score += 1.2;
      if (trick.winner === play.seat && trick.heads >= 2) item.score -= 0.35;
      if (winsNow) bestSoFar = play;
    }
  }

  // 持有秘書牌的人在秘書牌花色被領出時通常會跟牌；若一直沒出現但某人尚未被排除，給一點機率而不是偷看。
  const possible = scores.filter((x) => !x.eliminated).sort((a, b) => b.score - a.score);
  if (!possible.length) return null;
  const best = possible[0];
  const second = possible[1]?.score ?? -1.5;
  const gap = best.score - second;
  const difficulty = Number(game.settings?.difficulty || 10);
  const confidence = aiClamp(0.26 + gap * 0.12 + (5 - possible.length) * 0.08 + difficulty * 0.012, 0.18, 0.88);
  if (possible.length === 1) return { seat: best.seat, confidence: Math.max(confidence, 0.72), reason: "elimination" };
  if (confidence < 0.56) return null;
  return { seat: best.seat, confidence, reason: "behavior" };
}

function aiLeadSuitFromPlays(plays) {
  if (!plays?.length) return null;
  const first = plays[0];
  if (first.leadSuit) return first.leadSuit;
  if (first.card?.joker) return null;
  return first.card?.suit || null;
}

function aiContractMode(game, seat, totals, pointsOnTable, remainingHeads, napNeeds, myTeam) {
  const stillAvailable = Math.max(1, remainingHeads + pointsOnTable);
  const ratio = aiClamp(napNeeds / stillAvailable, 0, 2);
  if (myTeam === "nap") {
    if (napNeeds <= 0 || ratio <= 0.24) return { team: "nap", mode: "protect", ratio, label: "保約" };
    if (ratio >= 0.62 || napNeeds >= Math.max(4, stillAvailable - 1)) return { team: "nap", mode: "chase", ratio, label: "搶約" };
    return { team: "nap", mode: "balanced", ratio, label: "穩打" };
  }
  if (napNeeds <= 2 || ratio <= 0.28) return { team: "def", mode: "block", ratio, label: "擋約" };
  if (ratio >= 0.72) return { team: "def", mode: "conserve", ratio, label: "守成" };
  return { team: "def", mode: "balanced", ratio, label: "防守" };
}

function aiLikelyVoid(ctx, seat, suit) {
  if (!suit || seat === null || seat === undefined) return false;
  return Boolean(ctx?.memory?.voids?.[seat]?.[suit]);
}

function aiCountLikelyVoids(ctx, seats, suit) {
  if (!suit) return 0;
  return (seats || []).filter((seat) => aiLikelyVoid(ctx, seat, suit)).length;
}

function aiSeatCanOvertake(game, observerSeat, targetSeat, strength, leadSuit, memory) {
  const unseen = memory?.remaining || aiUnseenCards(game, observerSeat);
  const voids = memory?.voids || [];
  const targetVoidLead = leadSuit ? Boolean(voids[targetSeat]?.[leadSuit]) : false;
  return unseen.some((card) => {
    if (cardStrength(card, game, leadSuit) <= strength) return false;
    if (!leadSuit) return true;
    if (card.id === game.secretaryCardId || card.joker) return true;
    if (card.suit === leadSuit) return !targetVoidLead;
    if (game.trump && game.trump !== "NT" && card.suit === game.trump && card.suit !== leadSuit) return targetVoidLead;
    return false;
  });
}

function aiFutureOvertakeRisk(game, seat, card, ctx) {
  if (ctx.actingLast) return 0;
  const leadSuit = ctx.leadSuit || (game.trick?.[0]?.leadSuit ?? game.trick?.[0]?.card?.suit ?? card.suit ?? null);
  const strength = cardStrength(card, game, leadSuit);
  let danger = 0;
  for (const futureSeat of ctx.seatsAfter) {
    if (aiTeamView(game, futureSeat, seat) === ctx.myTeam) continue;
    if (aiSeatCanOvertake(game, seat, futureSeat, strength, leadSuit, ctx.memory)) {
      danger += aiLikelyVoid(ctx, futureSeat, leadSuit) ? 1.35 : 1;
    }
  }
  return aiClamp(danger / Math.max(1, ctx.seatsAfter.length), 0, 0.96);
}

function aiPotentialOvertakeRisk(game, seat, card, ctx) {
  if (ctx.actingLast) return 0;
  const leadSuit = ctx.leadSuit || (game.trick?.[0]?.leadSuit ?? game.trick?.[0]?.card?.suit ?? card.suit ?? null);
  const strength = cardStrength(card, game, leadSuit);
  const unseen = ctx.memory?.remaining || aiUnseenCards(game, seat);
  const stronger = unseen.filter((c) => cardStrength(c, game, leadSuit) > strength).length;
  const rawDeckRisk = stronger / Math.max(1, unseen.length);
  const seatRisk = aiFutureOvertakeRisk(game, seat, card, ctx);
  return aiClamp(rawDeckRisk * ctx.seatsAfter.length * 0.9 + seatRisk * 0.78, 0, 0.96);
}

function aiCardSuitCount(game, seat, card) {
  if (!card?.suit) return 0;
  return (game.players?.[seat]?.hand || []).filter((c) => c.suit === card.suit).length;
}

function aiIsLikelyMaster(game, seat, card, leadSuit = null, memory = null) {
  const suit = leadSuit || card.suit || null;
  const strength = cardStrength(card, game, suit);
  const unseen = memory?.remaining || aiUnseenCards(game, seat);
  return unseen.every((c) => cardStrength(c, game, suit) <= strength);
}

function aiTrumpControlState(game, seat, memory = null) {
  const trump = game.trump;
  const hand = game.players?.[seat]?.hand || [];
  if (!trump || trump === "NT") {
    return { enabled: false, myCount: hand.filter((c) => c.joker).length, unseenCount: memory?.remainingBySuit?.JOKER || 0, playedCount: memory?.playedBySuit?.JOKER || 0, myHighCount: hand.filter((c) => c.joker).length, opponentsLikelyHave: 0 };
  }
  const mem = memory || aiBuildCardMemory(game, seat);
  const myTrumpCards = hand.filter((c) => c.joker || c.suit === trump);
  const myHighCount = myTrumpCards.filter((c) => c.joker || c.value >= 11).length;
  const unseenTrump = (mem.remaining || []).filter((c) => c.joker || c.suit === trump);
  const playedTrump = (mem.playedBySuit?.[trump] || 0) + (mem.playedBySuit?.JOKER || 0);
  return {
    enabled: true,
    myCount: myTrumpCards.length,
    myHighCount,
    unseenCount: unseenTrump.length,
    highUnseenCount: unseenTrump.filter((c) => c.joker || c.value >= 11).length,
    playedCount: playedTrump,
    opponentsLikelyHave: Math.max(0, unseenTrump.length - myTrumpCards.length)
  };
}

function aiSuitPlan(game, seat, myTeam, memory = null) {
  const hand = game.players?.[seat]?.hand || [];
  const mem = memory || aiBuildCardMemory(game, seat);
  const plan = {};
  for (const suit of ["S", "H", "D", "C"]) {
    const cards = hand.filter((c) => c.suit === suit);
    const lowCards = cards.filter((c) => !isHeadCard(c) && c.value <= 9).length;
    const heads = cards.filter((c) => isHeadCard(c)).length;
    const masters = cards.filter((c) => aiIsLikelyMaster(game, seat, c, suit, mem)).length;
    plan[suit] = {
      count: cards.length,
      heads,
      lowCards,
      masters,
      remaining: mem.remainingBySuit?.[suit] || 0,
      remainingHeads: mem.remainingHeadsBySuit?.[suit] || 0,
      voidOpponents: Array.from({ length: 5 }, (_, s) => s).filter((s) => s !== seat && aiTeamView(game, s, seat) !== myTeam && mem.voids?.[s]?.[suit]).length,
      voidAllies: Array.from({ length: 5 }, (_, s) => s).filter((s) => s !== seat && aiTeamView(game, s, seat) === myTeam && mem.voids?.[s]?.[suit]).length
    };
  }
  return plan;
}

function aiOpeningLeadAdjustment(game, seat, card, ctx) {
  if ((game.trickNo || 0) > 1 || !card?.suit || card.joker) return 0;
  const suitPlan = ctx.suitPlan?.[card.suit];
  if (!suitPlan) return 0;
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  const isPoint = isHeadCard(card);
  let score = 0;

  // 前兩墩：高難度更會用低牌探花色，不一開始就把不安全的頭牌送出去。
  if (!isTrump && !isPoint && suitPlan.count >= 3) score += 4.2;
  if (!isTrump && !isPoint && suitPlan.count === 1) score += 2.4; // 清短門。
  if (!isTrump && isPoint && suitPlan.remaining > 5 && suitPlan.masters === 0) score -= 6.5;
  if (isTrump && ctx.trumpState?.myCount <= 2) score -= 5.5;
  if (ctx.myTeam === "nap" && isTrump && ctx.trumpState?.myCount >= 5 && ctx.contractMode.mode !== "protect") score += 4.8; // 王牌長時可先抽王牌。
  if (ctx.myTeam === "def" && isTrump && game.napoleon !== seat && ctx.contractMode.mode !== "block") score -= 4.5; // 防家少替拿破崙抽王牌。
  return score;
}

function aiTrumpControlAdjustment(game, seat, card, ctx, candidateWins, pointsWithCard) {
  const st = ctx.trumpState;
  if (!st?.enabled) return 0;
  const isTrump = Boolean(card.joker || card.suit === game.trump);
  if (!isTrump) return 0;
  let score = 0;
  const isPoint = isHeadCard(card);
  const early = (game.trickNo || 0) <= 4;
  const hasControl = st.myCount >= 4 || st.myHighCount >= 2;

  if (ctx.myTeam === "nap") {
    if (hasControl && (ctx.contractMode.mode === "chase" || ctx.napUrgency > 0.55)) score += candidateWins ? 5.5 : 1.5;
    if (ctx.contractMode.mode === "protect" && early && !isPoint && !candidateWins) score -= 5;
  } else {
    if (early && !candidateWins && pointsWithCard === 0) score -= 6;
    if (ctx.contractMode.mode === "block" && candidateWins && pointsWithCard >= 1) score += 7;
    if (ctx.defenderUrgency < 0.35 && early) score -= 3.5;
  }
  if (st.myCount <= 1 && !ctx.actingLast && !ctx.late && pointsWithCard <= 1) score -= 8;
  if (card.joker && game.settings?.jokerLowLast3 && game.trickNo === 6) score += card.id === "RJ" ? 7 : 3;
  return score;
}

function aiEndgamePlanAdjustment(game, seat, card, ctx, candidateWins, pointsWithCard) {
  const remainingTricks = Math.max(1, 10 - (game.trickNo || 0));
  const hand = game.players?.[seat]?.hand || [];
  if (remainingTricks > 4 && hand.length > 4) return 0;
  const isPoint = isHeadCard(card);
  const master = card.suit ? aiIsLikelyMaster(game, seat, card, card.suit, ctx.memory) : Boolean(card.joker || card.id === game.secretaryCardId);
  let score = 0;

  // 殘局：可穩收的頭牌要收，不能穩收的頭牌要藏，沒用的低牌優先脫手。
  if (master && isPoint) score += 12;
  if (master && !isPoint && ctx.handHeads >= remainingTricks) score += 4;
  if (!master && isPoint && !candidateWins) score -= 12;
  if (!isPoint && !candidateWins && ctx.pointsOnTable === 0) score += 4;
  if (ctx.myTeam === "nap" && ctx.napNeeds <= pointsWithCard && candidateWins) score += 18;
  if (ctx.myTeam === "def" && ctx.napNeeds <= pointsWithCard + 1 && candidateWins) score += 16;
  return score;
}

function aiCooperationAdjustment(game, seat, card, ctx, candidateWins, pointsWithCard) {
  let score = 0;
  const isPoint = isHeadCard(card);
  const currentAllyWinning = ctx.currentWinnerTeam === ctx.myTeam;
  const currentEnemyWinning = ctx.currentWinnerTeam && ctx.currentWinnerTeam !== ctx.myTeam;
  const futureAllies = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) === ctx.myTeam);
  const futureOpponents = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) !== ctx.myTeam);
  const suit = ctx.leadSuit || card.suit || null;

  if (currentAllyWinning && !candidateWins && isPoint && futureOpponents.length === 0) score += 10;
  if (currentAllyWinning && candidateWins && pointsWithCard <= 1) score -= 9;
  if (currentEnemyWinning && candidateWins && pointsWithCard >= 1) score += 6;

  // 若後手盟友已缺門，低牌引導切牌；若後手敵人缺門，頭牌更保守。
  if (suit && !card.joker && !(game.trump && game.trump !== "NT" && card.suit === game.trump)) {
    const allyVoid = aiCountLikelyVoids(ctx, futureAllies, suit);
    const oppVoid = aiCountLikelyVoids(ctx, futureOpponents, suit);
    if (allyVoid > 0 && !isPoint && !candidateWins) score += 4 * allyVoid;
    if (oppVoid > 0 && isPoint && !candidateWins) score -= 7 * oppVoid;
  }
  return score;
}

function aiScoreLeadCard(game, seat, card, ctx) {
  const base = cardPlayValue(card, game);
  const isPoint = isHeadCard(card);
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  const isJoker = Boolean(card.joker);
  const likelyWin = aiLikelyLeadWin(game, seat, card);
  const suitCount = aiCardSuitCount(game, seat, card);
  const master = aiIsLikelyMaster(game, seat, card, card.suit || null, ctx.memory);
  const leadSuitForCard = card.joker ? null : card.suit;
  const futureOpponents = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) !== ctx.myTeam);
  const futureAllies = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) === ctx.myTeam);
  const opponentVoids = aiCountLikelyVoids(ctx, futureOpponents, leadSuitForCard);
  const allyVoids = aiCountLikelyVoids(ctx, futureAllies, leadSuitForCard);
  const vulnerableLead = Boolean(leadSuitForCard && !isTrump && opponentVoids > 0);
  let score = 0;
  score += aiOpeningLeadAdjustment(game, seat, card, ctx);

  // 領牌原則：早期先探牌與建立長門；中後期才積極收頭。
  score -= base * 0.18;
  if (!isPoint && !isTrump && !isJoker) score += 3.2;
  if (suitCount >= 4 && !isJoker) score += 3.2;
  if (suitCount === 1 && !isPoint && !isTrump) score += 1.6; // 清短門，之後可切王牌。
  if (isPoint && likelyWin < 0.66) score -= 14;
  if (isPoint && likelyWin >= 0.78) score += 7;
  if (master && (isPoint || ctx.late || ctx.handHeads >= 3)) score += 7;
  if (isTrump && game.trickNo <= 3 && ctx.trumpCount <= 2) score -= 7; // 王牌少時不要早早耗掉。
  if (isJoker && game.trickNo <= 4 && ctx.pointsOnTable === 0) score -= 10;
  if (ctx.late) score += base * 0.24 + (isPoint ? 5 : 0) + (master ? 4 : 0);

  // 記牌與缺門推測：若後手對手已露出該花色缺門，領頭牌容易被切；若盟友缺門，領低牌可能創造切牌機會。
  if (vulnerableLead && isPoint) score -= 8 + opponentVoids * 5;
  if (vulnerableLead && !isPoint && ctx.contractMode.mode === "block") score += 2 + opponentVoids;
  if (allyVoids > 0 && !isTrump && !isJoker && !isPoint) score += allyVoids * (ctx.contractMode.mode === "chase" ? 4.2 : 2.4);
  if (allyVoids > 0 && isPoint && !master) score -= allyVoids * 3.2;

  if (ctx.secretaryGuess && ctx.myTeam === "def" && ctx.secretaryGuess.confidence >= 0.62 && seat !== ctx.secretaryGuess.seat) {
    if (!isPoint && !isTrump && !isJoker && card.suit && aiLikelyVoid(ctx, ctx.secretaryGuess.seat, card.suit)) score += 4.5;
    if (isPoint && card.suit && aiLikelyVoid(ctx, ctx.secretaryGuess.seat, card.suit)) score -= 5.5;
  }

  if (ctx.personality?.type === "aggressive" && likelyWin >= 0.62) score += 2.6;
  if (ctx.personality?.type === "conservative" && isPoint && likelyWin < 0.86) score -= 3.4;
  if (ctx.personality?.type === "blocker" && ctx.myTeam === "def" && likelyWin >= 0.65) score += 2.8;

  if (ctx.contractMode.mode === "protect") {
    if (likelyWin >= 0.78) score += 6 + (master ? 3 : 0);
    if (isPoint && likelyWin < 0.86) score -= 8;
    if (vulnerableLead) score -= 4;
    if (isTrump && ctx.trumpCount <= 2 && !master) score -= 4;
  } else if (ctx.contractMode.mode === "chase") {
    if (likelyWin >= 0.68) score += 7 + (isPoint ? 7 : 0) + (isTrump || isJoker ? 4 : 0);
    if (master) score += 6;
    if (!isPoint && likelyWin < 0.4 && ctx.handHeads >= 2) score -= 4;
  } else if (ctx.contractMode.mode === "block") {
    if (likelyWin >= 0.72) score += 8 + (isTrump || isJoker ? 4 : 0);
    if (master) score += 5;
    if (isPoint && likelyWin < 0.82) score -= 10;
  } else if (ctx.contractMode.mode === "conserve") {
    if ((isTrump || isJoker) && !master && !ctx.late) score -= 8;
    if (isPoint && likelyWin < 0.8) score -= 7;
  }

  if (ctx.myTeam === "nap") {
    const pressure = 8 + ctx.handHeads * 1.7 + ctx.napUrgency * 20;
    score += likelyWin * pressure;
    if (ctx.napUrgency > 0.82 && likelyWin >= 0.7) score += 9;
    if (isPoint && likelyWin >= 0.72) score += 8 + ctx.napUrgency * 6;
    if (isTrump && ctx.trumpCount >= 3) score += 5 + likelyWin * 4.5;
    if (aiCanSummonUsefulJoker(game, seat, card)) score += 7 + ctx.difficulty * 0.42;
  } else {
    const blockPressure = 4 + ctx.defenderUrgency * 14;
    score += likelyWin * blockPressure;
    if (isPoint && likelyWin < 0.8) score -= 16;
    if (!isPoint && !isTrump && !isJoker && likelyWin < 0.48) score += 5;
    if (ctx.defenderUrgency > 0.7 && likelyWin > 0.75) score += 7;
    if (ctx.defenderUrgency < 0.35 && isTrump && game.trickNo < 6) score -= 5;
  }

  if (!game.secretaryRevealed && card.id === game.secretaryCardId) {
    score -= game.trickNo < 5 ? 24 : 9;
    if (ctx.myTeam === "nap" && (ctx.napUrgency > 0.8 || ctx.handHeads >= 3 || ctx.late)) score += 15;
  }

  if (game.settings?.jokerLowLast3 && card.joker && game.trickNo >= 5 && game.trickNo < 7) {
    score += card.bigJoker ? 10 : 5;
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
  const headWeight = 7 + ctx.difficulty * 0.56 + (ctx.myTeam === "nap" ? ctx.napUrgency * 11 : ctx.defenderUrgency * 11);
  const overtakeRisk = candidateWins ? aiPotentialOvertakeRisk(game, seat, card, ctx) : 0;
  const futureOpponents = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) !== ctx.myTeam);
  const futureAllies = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) === ctx.myTeam);
  const opponentVoidLead = aiCountLikelyVoids(ctx, futureOpponents, ctx.leadSuit);
  const allyVoidLead = aiCountLikelyVoids(ctx, futureAllies, ctx.leadSuit);
  const voidCutDanger = opponentVoidLead > 0 && !ctx.actingLast;
  let score = 0;

  if (allyWinning) {
    if (candidateWins) {
      // 盟友已經贏墩時，不蓋隊友；只有末手保險或秘書牌特殊情況才例外。
      score -= 22 + base * 0.36;
      if (ctx.actingLast && isPoint) score -= 8;
      if (!ctx.actingLast && overtakeRisk > 0.55 && pointsWithCard >= 2) score += 4; // 防止後面被對方超車。
    } else {
      score += 9;
      const feedSafe = ctx.actingLast || ctx.opponentsAfter === 0 || (!voidCutDanger && opponentVoidLead === 0);
      const feedBonus = feedSafe ? 30 : Math.max(0, 10 - ctx.opponentsAfter * 5 - opponentVoidLead * 7);
      if (isPoint) score += feedBonus;
      if (ctx.contractMode.mode === "protect" && isPoint && feedSafe) score += 9;
      if (ctx.contractMode.mode === "chase" && isPoint && feedSafe) score += 7;
      if (isTrump || isJoker) score -= 6;
      score -= base * 0.13;
      if (!feedSafe && isPoint) score -= 10 + opponentVoidLead * 5;
      if (!feedSafe && isPoint && pointsWithCard >= 3) score -= 7;
    }
  } else {
    if (candidateWins) {
      // 對方暫時贏墩：以最小成本吃回來；但如果後面還很多人，需考慮被超車風險。
      score += 16 + pointsWithCard * headWeight;
      if (ctx.myTeam === "nap") score += ctx.napUrgency * 13;
      else score += ctx.defenderUrgency * 14;
      score -= base * 0.30;
      score -= overtakeRisk * (10 + Math.max(0, 3 - pointsWithCard) * 3);
      if (isPoint) score += 5;
      if (ctx.actingLast) score += 5;
      if (pointsWithCard >= 2 && overtakeRisk < 0.45) score += 9;
      if (ctx.late && pointsWithCard >= 1) score += 5;
    } else {
      // 吃不回來：不要把頭送給對方，盡量丟低牌；若盟友還在後面，保留可餵牌機會。
      score += 3;
      if (isPoint) score -= 20 + headWeight;
      if (isTrump || isJoker) score -= 4;
      score -= base * 0.10;
      if (ctx.alliesAfter > 0 && isPoint && ctx.pointsOnTable === 0) score -= 5;
    }
  }

  // 推測秘書：防家若懷疑某人是秘書，會避免把頭送給他，必要時也更願意攔截。
  if (ctx.secretaryGuess && ctx.myTeam === "def" && ctx.secretaryGuess.confidence >= 0.62) {
    if (ctx.currentWinner === ctx.secretaryGuess.seat && !candidateWins && isPoint) score -= 13 * ctx.secretaryGuess.confidence;
    if (ctx.currentWinner === ctx.secretaryGuess.seat && candidateWins) score += 9 * ctx.secretaryGuess.confidence;
    if (ctx.seatsAfter.includes(ctx.secretaryGuess.seat) && isPoint && !candidateWins) score -= 5 * ctx.secretaryGuess.confidence;
  }

  if (ctx.personality?.type === "support" && allyWinning && !candidateWins && isPoint && !voidCutDanger) score += 5;
  if (ctx.personality?.type === "aggressive" && candidateWins && !allyWinning) score += 3.5;
  if (ctx.personality?.type === "conservative" && (isTrump || isJoker) && !ctx.late && !ctx.actingLast) score -= 3.5;
  if (ctx.personality?.type === "blocker" && ctx.myTeam === "def" && candidateWins) score += 4;

  // 保約 / 擋約模式：局勢越接近成敗線，越明確搶頭或防守。
  if (ctx.contractMode.mode === "protect") {
    if (allyWinning && !candidateWins && isPoint && !voidCutDanger) score += 10;
    if (!allyWinning && candidateWins && pointsWithCard > 0 && overtakeRisk < 0.55) score += 10;
    if ((isTrump || isJoker) && pointsWithCard === 0 && !ctx.late) score -= 5;
  } else if (ctx.contractMode.mode === "chase") {
    if (!allyWinning && candidateWins) score += 10 + pointsWithCard * 5;
    if (allyWinning && !candidateWins && isPoint && !voidCutDanger) score += 8;
    if (!candidateWins && !allyWinning && isPoint) score -= 16;
  } else if (ctx.contractMode.mode === "block") {
    if (!allyWinning && candidateWins) score += 12 + pointsWithCard * 6;
    if (!candidateWins && !allyWinning && isPoint) score -= 18;
    if (candidateWins && overtakeRisk < 0.35) score += 5;
  } else if (ctx.contractMode.mode === "conserve") {
    if ((isTrump || isJoker) && !candidateWins && !ctx.late) score -= 8;
    if (candidateWins && pointsWithCard === 0 && !ctx.actingLast) score -= 4;
  }

  // 若後手盟友已知缺首引花色，可以期待他切牌；若後手對手缺門，送頭要更保守。
  if (allyVoidLead > 0 && !candidateWins && !isPoint && ctx.myTeam === "nap") score += 2.5 * allyVoidLead;
  if (voidCutDanger && isPoint && !candidateWins) score -= 8 + opponentVoidLead * 5;

  // 若自己是末家，判斷更果斷：能吃有頭墩就吃；盟友已吃就放心餵頭。
  if (ctx.actingLast) {
    if (candidateWins && !allyWinning && pointsWithCard > 0) score += 12 + pointsWithCard * 5;
    if (!candidateWins && allyWinning && isPoint) score += 12;
    if (!candidateWins && !allyWinning && isPoint) score -= 12;
  }

  if (!game.secretaryRevealed && card.id === game.secretaryCardId) {
    if (candidateWins && (!allyWinning || pointsWithCard >= 2 || ctx.late || ctx.napUrgency > 0.75)) {
      score += 20 + pointsWithCard * 8;
    } else {
      score -= game.trickNo < 6 ? 27 : 11;
    }
  }

  if (game.settings?.jokerLowLast3 && card.joker) {
    if (game.trickNo >= 7) score -= card.bigJoker ? 4 : 9;
    else if (game.trickNo <= 4 && ctx.pointsOnTable === 0 && !candidateWins) score -= 8;
    else if (game.trickNo === 6 && card.id === "RJ") score += 8;
  }

  return score;
}


function aiAdvancedPlayAdjustment(game, seat, card, ctx, legal) {
  if (!legal?.length) return 0;
  const difficulty = ctx.difficulty || Number(game.settings?.difficulty || 10);
  const skill = aiClamp((difficulty - 9) / 11, 0, 1);
  if (skill <= 0) return 0;

  const trickLen = game.trick?.length || 0;
  const candidateWins = trickLen > 0 ? wouldWin(game, card) : aiLikelyLeadWin(game, seat, card) >= 0.72;
  const isPoint = isHeadCard(card);
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  const isJoker = Boolean(card.joker);
  const leadSuit = ctx.leadSuit || card.suit || null;
  const currentEnemyWinning = trickLen > 0 && ctx.currentWinnerTeam && ctx.currentWinnerTeam !== ctx.myTeam;
  const currentAllyWinning = trickLen > 0 && ctx.currentWinnerTeam === ctx.myTeam;
  const pointsWithCard = ctx.pointsOnTable + (isPoint ? 1 : 0);
  const legalWinning = trickLen > 0
    ? legal.filter((c) => wouldWin(game, c)).sort((a, b) => cardPlayValue(a, game) - cardPlayValue(b, game))
    : legal.filter((c) => aiLikelyLeadWin(game, seat, c) >= 0.72).sort((a, b) => cardPlayValue(a, game) - cardPlayValue(b, game));
  const cheapWinner = legalWinning[0] || null;
  const bestLoser = legal
    .filter((c) => trickLen === 0 ? aiLikelyLeadWin(game, seat, c) < 0.72 : !wouldWin(game, c))
    .sort((a, b) => cardPlayValue(b, game) - cardPlayValue(a, game))[0] || null;

  let score = 0;

  // 高難度電腦會用「最低成本吃牌」：能吃回來就盡量用最小的贏牌，避免過度浪費鬼牌、王牌或秘書牌。
  if (candidateWins && cheapWinner) {
    const cheapest = cheapWinner.id === card.id;
    const overpay = Math.max(0, cardPlayValue(card, game) - cardPlayValue(cheapWinner, game));
    if (currentEnemyWinning || pointsWithCard >= 2 || ctx.actingLast || ctx.late) {
      if (cheapest) score += (5.5 + pointsWithCard * 1.8) * skill;
      else if (pointsWithCard <= 1 && !ctx.actingLast) score -= aiClamp(overpay / 5, 0, 8) * skill;
    }
    if (!currentEnemyWinning && !ctx.late && pointsWithCard === 0 && !cheapest) score -= aiClamp(overpay / 4, 0, 7) * skill;
  }

  // 如果盟友已經穩吃，本家不應該把關鍵控制牌蓋上去；但可以安全餵頭。
  if (currentAllyWinning) {
    const allyCanBeOvertaken = ctx.currentWinner !== null
      ? aiFutureOvertakeRisk(game, seat, game.trick.find((p) => p.seat === ctx.currentWinner)?.card || card, ctx) > 0.55
      : false;
    if (candidateWins && !allyCanBeOvertaken) score -= (10 + cardPlayValue(card, game) * 0.18) * skill;
    if (!candidateWins && isPoint && (ctx.actingLast || ctx.opponentsAfter === 0)) score += 8 * skill;
  }

  // 關鍵控制牌保留：非必要時保留大鬼、小鬼、秘書牌、最後一張王牌或已知最大牌，讓後面保約/擋約更有工具。
  const control = aiControlCardValue(game, seat, card, ctx);
  if (control > 0 && !ctx.late) {
    const urgent = ctx.contractMode.mode === "chase" || ctx.contractMode.mode === "block" || pointsWithCard >= 2;
    if (!candidateWins || (!urgent && pointsWithCard === 0)) score -= control * (0.52 + skill * 0.42);
    if (candidateWins && urgent) score += control * 0.22 * skill;
  }

  // 高難度會看末段手牌計畫：剩 4 張以內時，能確定收頭的 master 牌要及早兌現；不能安全出的頭牌要避免送出。
  if ((ctx.handSize || 0) <= 4) {
    const master = aiIsLikelyMaster(game, seat, card, leadSuit, ctx.memory);
    if (master && (isPoint || pointsWithCard > 0)) score += (9 + pointsWithCard * 3) * skill;
    if (!master && isPoint && !candidateWins && !currentAllyWinning) score -= 10 * skill;
    if (bestLoser?.id === card.id && !isPoint && !isTrump && !isJoker) score += 3.5 * skill;
  }

  // 缺門推測加強：如果後手對手已缺首引花色，墊頭或領頭牌要更保守；若後手盟友缺門，則可用低牌引導切牌。
  if (leadSuit && !isTrump && !isJoker) {
    const futureOpponents = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) !== ctx.myTeam);
    const futureAllies = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) === ctx.myTeam);
    const oppVoids = aiCountLikelyVoids(ctx, futureOpponents, leadSuit);
    const allyVoids = aiCountLikelyVoids(ctx, futureAllies, leadSuit);
    if (oppVoids > 0 && isPoint && !candidateWins) score -= (6 + oppVoids * 4) * skill;
    if (allyVoids > 0 && !isPoint && !candidateWins && ctx.myTeam === "nap") score += (3 + allyVoids * 2) * skill;
  }

  // 擋約/保約再細化：臨界局面下，不只是看當前一墩，而是看「剩餘可取得頭數」。
  const nearLine = ctx.myTeam === "nap" ? ctx.napNeeds <= Math.max(2, pointsWithCard + 1) : ctx.napNeeds <= Math.max(3, pointsWithCard + 2);
  if (nearLine) {
    if (ctx.myTeam === "nap") {
      if (candidateWins && pointsWithCard > 0) score += (9 + pointsWithCard * 5) * skill;
      if (!candidateWins && isPoint && !currentAllyWinning) score -= 12 * skill;
    } else {
      if (currentEnemyWinning && candidateWins) score += (11 + pointsWithCard * 5) * skill;
      if (currentEnemyWinning && !candidateWins && isPoint) score -= 13 * skill;
    }
  }

  score += aiTrumpControlAdjustment(game, seat, card, ctx, candidateWins, pointsWithCard) * skill;
  score += aiEndgamePlanAdjustment(game, seat, card, ctx, candidateWins, pointsWithCard) * skill;
  score += aiCooperationAdjustment(game, seat, card, ctx, candidateWins, pointsWithCard) * skill;
  score += aiV7RiskTempoAdjustment(game, seat, card, ctx, legal, candidateWins, pointsWithCard) * skill;
  score += aiV7SecretarySignalAdjustment(game, seat, card, ctx, candidateWins, pointsWithCard) * skill;

  return score;
}


function aiV7RiskTempoAdjustment(game, seat, card, ctx, legal, candidateWins, pointsWithCard) {
  const trickLen = game.trick?.length || 0;
  const isPoint = isHeadCard(card);
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  const isJoker = Boolean(card.joker);
  const cardSuit = card.joker ? null : card.suit;
  const currentEnemyWinning = trickLen > 0 && ctx.currentWinnerTeam && ctx.currentWinnerTeam !== ctx.myTeam;
  const currentAllyWinning = trickLen > 0 && ctx.currentWinnerTeam === ctx.myTeam;
  const futureOpponents = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) !== ctx.myTeam);
  const futureAllies = ctx.seatsAfter.filter((s) => aiTeamView(game, s, seat) === ctx.myTeam);
  const futureRisk = candidateWins ? aiV7FutureDanger(game, seat, card, ctx, futureOpponents) : 0;
  const master = cardSuit ? aiIsLikelyMaster(game, seat, card, cardSuit, ctx.memory) : Boolean(card.joker || card.id === game.secretaryCardId);
  const likelyWin = trickLen === 0 ? aiLikelyLeadWin(game, seat, card) : (candidateWins ? aiClamp(1 - futureRisk, 0, 1) : 0);
  let score = 0;

  // 高難度加入「剩餘大牌推估」：非 master 的頭牌，若後手敵方仍可能有更大牌或切牌，就不要太早送。
  if (isPoint && !master && !ctx.actingLast) {
    const strongerLeft = aiV7StrongerUnseenCount(game, seat, card, ctx.leadSuit || cardSuit);
    score -= aiClamp(strongerLeft * 2.8 + futureRisk * 12, 0, 18);
    if (currentAllyWinning) score += 3; // 盟友吃墩時可稍微放寬。
  }

  // 安全兌現：已知 master 或近似 master 的頭牌，在保約/擋約臨界時要敢收。
  if ((master || likelyWin >= 0.86) && isPoint) {
    if (ctx.contractMode.mode === "protect" || ctx.contractMode.mode === "block") score += 8 + pointsWithCard * 2.5;
    if (ctx.contractMode.mode === "chase") score += 10 + ctx.napUrgency * 5;
    if (ctx.handSize <= 4) score += 7;
  }

  // tempo：還沒必要時保留唯一控制牌；但如果這墩有 2 頭以上或接近成敗線，就要拿出來。
  const control = aiControlCardValue(game, seat, card, ctx);
  const importantTrick = pointsWithCard >= 2 || ctx.napNeeds <= Math.max(2, pointsWithCard + 1) || ctx.handSize <= 3;
  if (control >= 14 && !importantTrick && !ctx.late) score -= 9;
  if (control >= 14 && importantTrick && (candidateWins || likelyWin >= 0.82)) score += 7;

  // 敵我風險矩陣：後手對手已推測缺門或可能切王牌時，降低非安全頭牌；後手隊友缺門時，低牌引導切牌。
  const relevantSuit = ctx.leadSuit || cardSuit;
  if (relevantSuit && !isTrump && !isJoker) {
    const enemyVoidPressure = aiV7VoidPressure(ctx, futureOpponents, relevantSuit);
    const allyVoidPressure = aiV7VoidPressure(ctx, futureAllies, relevantSuit);
    if (enemyVoidPressure > 0 && isPoint && !candidateWins) score -= 10 * enemyVoidPressure;
    if (enemyVoidPressure > 0.45 && candidateWins && !ctx.actingLast) score -= 5 * enemyVoidPressure;
    if (allyVoidPressure > 0 && !isPoint && !candidateWins && ctx.myTeam === "nap") score += 5 * allyVoidPressure;
  }

  // 出牌節奏：若目前隊友穩吃且後面沒有敵方，頭牌加分；如果隊友可能被超車，別急著餵太多頭。
  if (currentAllyWinning && isPoint && !candidateWins) {
    const allyPlay = game.trick?.find((p) => p.seat === ctx.currentWinner);
    const allyRisk = allyPlay ? aiV7FutureDanger(game, seat, allyPlay.card, ctx, futureOpponents) : 0;
    if (allyRisk < 0.28) score += 9 + pointsWithCard;
    else score -= 7 * allyRisk;
  }

  // 防家在擋約時避免「幫拿破崙清路」；拿破崙軍搶約時則更願意用王牌/鬼牌控場。
  if (ctx.myTeam === "def" && ctx.contractMode.mode !== "block" && trickLen === 0 && isTrump && game.napoleon !== seat) score -= 8;
  if (ctx.myTeam === "nap" && (ctx.contractMode.mode === "chase" || ctx.napUrgency > 0.75) && (isTrump || isJoker) && candidateWins) score += 8;

  return score;
}

function aiV7SecretarySignalAdjustment(game, seat, card, ctx, candidateWins, pointsWithCard) {
  if (game.secretaryRevealed || !game.secretaryCardId) return 0;
  const isSecretCard = card.id === game.secretaryCardId;
  const isPoint = isHeadCard(card);
  const guess = ctx.secretaryGuess;
  let score = 0;

  // 暗秘書本人：不是關鍵墩時少曝光；但保約/搶約或能收多頭時要敢亮。
  if (isSecretCard) {
    const keyMoment = pointsWithCard >= 2 || ctx.contractMode.mode === "chase" || ctx.contractMode.mode === "protect" || ctx.handSize <= 4;
    if (candidateWins && keyMoment) score += 22;
    else if (!keyMoment) score -= 18;
  }

  // 防家：若某人疑似秘書，避免讓他吃到頭；若他在後手，少送容易被餵的頭牌。
  if (ctx.myTeam === "def" && guess && guess.confidence >= 0.58) {
    const secretAfter = ctx.seatsAfter.includes(guess.seat);
    const secretWinning = ctx.currentWinner === guess.seat;
    if (secretWinning && !candidateWins && isPoint) score -= 14 * guess.confidence;
    if (secretWinning && candidateWins) score += 11 * guess.confidence;
    if (secretAfter && isPoint && !candidateWins) score -= 7 * guess.confidence;
  }

  // 拿破崙本人：秘書還沒公開時，避免過度逼秘書曝光；若已經需要頭數，才用能引出秘書的花色。
  if (seat === game.napoleon && !isSecretCard && card.suit) {
    const secret = findCardById(game.secretaryCardId);
    if (secret?.suit === card.suit && ctx.contractMode.mode !== "chase" && (game.trickNo || 0) < 5) score -= 5;
    if (secret?.suit === card.suit && ctx.contractMode.mode === "chase") score += 5;
  }

  return score;
}

function aiV7FutureDanger(game, observerSeat, card, ctx, futureOpponents) {
  if (!futureOpponents?.length) return 0;
  const leadSuit = ctx.leadSuit || (card.joker ? null : card.suit);
  const strength = cardStrength(card, game, leadSuit);
  const unseen = aiUnseenCards(game, observerSeat);
  let danger = 0;
  for (const opp of futureOpponents) {
    const voidBonus = leadSuit && ctx.memory?.voids?.[opp]?.[leadSuit] ? 0.28 + (ctx.memory?.voidConfidence?.[opp]?.[leadSuit] || 0) * 0.35 : 0;
    const canTrump = leadSuit && game.trump && game.trump !== "NT" && leadSuit !== game.trump && ctx.memory?.voids?.[opp]?.[leadSuit];
    const stronger = unseen.some((c) => {
      if (canTrump && (c.joker || c.suit === game.trump)) return true;
      return cardStrength(c, game, leadSuit) > strength;
    });
    if (stronger) danger += 0.22;
    danger += voidBonus;
  }
  if (card.joker && !(game.settings?.jokerLowLast3 && game.trickNo >= 7)) danger *= card.bigJoker ? 0.18 : 0.32;
  if (card.id === game.secretaryCardId) danger *= 0.2;
  return aiClamp(danger, 0, 1);
}

function aiV7VoidPressure(ctx, seats, suit) {
  if (!suit || !seats?.length) return 0;
  let pressure = 0;
  for (const s of seats) {
    if (ctx.memory?.voids?.[s]?.[suit]) pressure += 0.55 + (ctx.memory?.voidConfidence?.[s]?.[suit] || 0) * 0.45;
  }
  return aiClamp(pressure, 0, 1.6);
}

function aiV7StrongerUnseenCount(game, seat, card, leadSuit = null) {
  const suit = leadSuit || (card.joker ? null : card.suit);
  const strength = cardStrength(card, game, suit);
  return aiUnseenCards(game, seat).filter((c) => cardStrength(c, game, suit) > strength).length;
}

function aiControlCardValue(game, seat, card, ctx) {
  let value = 0;
  if (card.id === game.secretaryCardId) value += 18;
  if (card.joker) value += card.bigJoker ? 20 : 16;
  const isTrump = Boolean(game.trump && game.trump !== "NT" && card.suit === game.trump);
  if (isTrump) {
    const trumpInHand = (game.players?.[seat]?.hand || []).filter((c) => c.suit === game.trump || c.joker).length;
    value += card.value >= 12 ? 8 : 4;
    if (trumpInHand <= 2) value += 7;
  }
  if (card.suit && aiIsLikelyMaster(game, seat, card, card.suit, ctx.memory)) value += isHeadCard(card) ? 9 : 5;
  if (game.settings?.jokerLowLast3 && card.joker && game.trickNo >= 6) value *= card.id === "RJ" ? 0.55 : 0.75;
  return value;
}

function aiPickScoredCard(scored, difficulty) {
  const spread = Math.max(0.34, (21 - difficulty) * 1.32);
  const withNoise = scored.map((item) => ({
    card: item.card,
    score: item.score + (Math.random() - 0.5) * spread
  })).sort((a, b) => b.score - a.score);

  if (difficulty <= 8 && withNoise.length > 1 && Math.random() < 0.16) {
    return randomItem(withNoise.slice(0, Math.min(3, withNoise.length))).card;
  }
  if (difficulty <= 13 && withNoise.length > 1 && Math.random() < 0.055) {
    return withNoise[1].card;
  }
  return withNoise[0].card;
}

function aiLikelyLeadWin(game, seat, card) {
  if (card.id === game.secretaryCardId) return 1;
  if (card.joker && !(game.settings?.jokerLowLast3 && game.trickNo >= 7)) return card.bigJoker ? 0.97 : 0.91;
  const leadSuit = card.joker ? null : card.suit;
  const strength = cardStrength(card, game, leadSuit);
  const unseen = aiUnseenCards(game, seat);
  const stronger = unseen.filter((c) => cardStrength(c, game, leadSuit) > strength);
  if (!stronger.length) return 0.94;

  const remainingSuit = leadSuit ? aiRemainingBySuit(game, seat)[leadSuit] : unseen.length;
  const suitPressure = leadSuit ? aiClamp(remainingSuit / 13, 0.12, 0.95) : 0.8;
  const risk = aiClamp(stronger.length / Math.max(1, unseen.length), 0, 0.9);
  const followers = 4;
  return aiClamp(1 - risk * followers * (1.05 + suitPressure * 0.55), 0.06, 0.88);
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
  // 拿破崙與秘書本人知道自己的陣營；其他人只能靠行為與缺門推測。
  if (observerSeat === game.napoleon || targetSeat === observerSeat) return teamOf(game, targetSeat);
  const difficulty = Number(game.settings?.difficulty || 10);
  if (difficulty >= 14 && observerSeat !== null && observerSeat !== undefined) {
    const guess = aiInferSecretaryOwner(game, observerSeat);
    const threshold = difficulty >= 18 ? 0.58 : 0.68;
    if (guess && guess.seat === targetSeat && guess.confidence >= threshold) return "nap";
  }
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
    const reason = illegal ? illegalPlayReason(game, seat, card) : "";
    return `<button class="card-btn ${cardClass(card)} ${selected} ${illegal}" data-card="${card.id}" title="${escapeHtml(reason)}" ${selectable ? "" : "disabled"}>${cardLabel(card)}</button>`;
  }).join("");
  document.querySelectorAll("#hand .card-btn").forEach((btn) => {
    btn.addEventListener("click", () => onHandCardClick(game, btn.dataset.card));
  });
  $("handHint").textContent = handHint(game, actionable);
}

function canSelectCardInHand(game, card, actionable, legalIds) {
  if (!actionable) return false;
  if (game.phase === PHASE.EXCHANGE) return true;
  if (game.phase === PHASE.PLAY) return true;
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
    const seat = myGameSeat(game);
    const card = game.players[seat].hand.find((c) => c.id === cardId);
    const legalIds = new Set(legalCardsFor(game, seat).map((c) => c.id));
    if (!legalIds.has(cardId)) {
      const reason = illegalPlayReason(game, seat, card);
      toast(reason);
      $("handHint").textContent = reason;
      const ruleHint = $("playRuleHint");
      if (ruleHint) ruleHint.textContent = reason;
      return;
    }
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
      ? `<div class="inline"><button id="btnNextRound" class="primary">再玩一局</button><button id="btnReturnLobby" class="ghost">${appState.offline ? "回主畫面" : "返回大廳"}</button></div><p class="hint">再玩一局會保留目前分數並換下一位發牌；返回大廳可重新調整座位與規則。</p>`
      : `<p class="hint">等待房主選擇再玩一局或返回大廳。</p>`;
    $("btnNextRound")?.addEventListener("click", hostNextRound);
    $("btnReturnLobby")?.addEventListener("click", hostReturnToLobby);
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
    const reasonHint = game.trick.length
      ? `本墩首引：${suitName(effectiveLeadSuit(game.trick) || "")}。不能出的牌可點一下查看原因。`
      : "你是本墩首攻，可出任一張牌；若首攻鬼牌可先指定要跟的花色。";
    el.innerHTML = `${leadSuitSelect}<p id="playRuleHint" class="hint play-rule-hint">${escapeHtml(reasonHint)}</p><p class="hint">直接點擊手牌出牌。</p>`;
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

registerServiceWorker();

init();
