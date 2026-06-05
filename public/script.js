// 1. Socket & State
const socket = io();

let me = null;
let gameState = null;
let myId = '';

console.log("[SYSTEM] Connected to server");

window.onload = () => {
    initVFX();
    // Safety: Force hide loader
    setTimeout(() => {
        const loader = document.getElementById('loading-overlay');
        if (loader) loader.classList.add('hidden');
    }, 3000);
    console.log("[INIT] Wizards ready");
};

function initVFX() {
    const candlesCont = document.getElementById('candles');
    if(!candlesCont) return;
    const positions = [{l:'8%', t:'20%'}, {l:'88%', t:'15%'}, {l:'5%', t:'60%'}, {l:'92%', t:'55%'}, {l:'20%', t:'80%'}, {l:'75%', t:'85%'}];
    positions.forEach(pos => {
        const c = document.createElement('div');
        c.className = 'candle'; c.style.left = pos.l; c.style.top = pos.t;
        const f = document.createElement('div'); f.className = 'candle-flame';
        c.appendChild(f); candlesCont.appendChild(c);
    });
}

// --- Socket Handlers ---
socket.on('init', (data) => { 
    myId = data.myId; gameState = data.gameState; updateUI(); 
    document.getElementById('loading-overlay').classList.add('hidden'); 
});

socket.on('updateGameState', (data) => { 
    gameState = data; updateUI(); 
    if(gameState.config) syncBalanceInputs();
});

socket.on('updatePlayers', (ps) => { 
    gameState.players = ps; me = ps[myId]; 
    updateUI(); updateAdminList(); 
});

socket.on('azkabanExile', () => { showNotice('아즈카반으로 유배되셨습니다.', true); });
socket.on('notification', (m) => showNotice(m));
socket.on('error', (m) => showNotice(m, true));
socket.on('newHint', (d) => { if(me && me.house === d.house) showProphecy(d.text); });

// --- Core Actions ---
function joinGame() {
    console.log("[ACTION] Join Button Clicked");
    const input = document.getElementById('nickname-input');
    const n = input ? input.value.trim() : "";
    if(!n) return showNotice('성함을 기입해주셔야 입학이 가능합니다.');
    
    socket.emit('join', n);
    const loginScreen = document.getElementById('login-screen');
    const gameScreen = document.getElementById('game-screen');
    
    if (loginScreen && gameScreen) {
        loginScreen.classList.remove('active');
        loginScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        gameScreen.classList.add('active');
    }
}

function updateUI() {
    if(!gameState) return;
    const dayEl = document.getElementById('stat-day');
    if(dayEl) dayEl.innerText = `제 ${gameState.day}일`;
    
    let topScore = -1, leaderId = null;
    for(let h in gameState.houses) {
        if(gameState.houses[h].score > topScore) { topScore = gameState.houses[h].score; leaderId = h; }
    }

    for(let h in gameState.houses) {
        const d = gameState.houses[h], totem = document.getElementById(`house-${h}`);
        if(totem) {
            const scoreVal = totem.querySelector('.points-val');
            if(scoreVal) scoreVal.innerText = d.score;
            totem.classList.toggle('winner', h === leaderId && d.score > 0);
        }
    }

    if(me) {
        document.getElementById('stat-name').innerText = me.nickname + (me.isEliminated ? ' (아즈카반)' : '');
        document.getElementById('stat-house').innerText = getKRHouse(me.house);
        const roleEl = document.getElementById('stat-role');
        if(me.role === 'de') {
            roleEl.innerText = '죽음을 먹는 자'; roleEl.style.background = '#8b0000';
            const deScore = document.getElementById('de-team-score');
            if(deScore) deScore.innerText = gameState.deTeamScore;
            document.getElementById('de-panel').classList.toggle('hidden', me.isEliminated);
        } else {
            roleEl.innerText = '학 생'; roleEl.style.background = '#7A5C2E';
            document.getElementById('de-panel').classList.add('hidden');
        }
    }
}

function getKRHouse(h) { return { Gryffindor: '그리핀도르', Slytherin: '슬리데린', Ravenclaw: '레번클로', Hufflepuff: '후플푸프' }[h] || '배정 대기 중'; }

function showNotice(msg, isError = false) {
    console.log(`[NOTICE] ${msg}`);
    const modal = document.getElementById('ministry-modal');
    const msgEl = document.getElementById('notice-msg');
    if(!modal || !msgEl) return;
    msgEl.innerText = msg;
    msgEl.style.color = isError ? '#8b0000' : '#2C241D';
    modal.classList.remove('hidden');
}
function closeNotice() { document.getElementById('ministry-modal').classList.add('hidden'); }

function showProphecy(text) {
    const modal = document.getElementById('prophecy-modal');
    const textEl = document.getElementById('prophecy-text');
    if(!modal || !textEl) return;
    modal.classList.remove('hidden');
    textEl.innerHTML = ''; let i = 0;
    const typing = setInterval(() => { if(i < text.length) textEl.innerHTML += text[i++]; else clearInterval(typing); }, 50);
}
function closeProphecy() { document.getElementById('prophecy-modal').classList.add('hidden'); }

function openGame(t) {
    console.log(`[ACTION] MiniGame Clicked: ${t}`);
    if(gameState.status !== 'running') return showNotice('학기가 시작되지 않았습니다.');
    if(me.isEliminated) return showNotice('이미 유배되셨습니다.', true);
    if(me.attempts[t] >= 2) return showNotice('마력을 모두 사용했습니다.');
    
    document.getElementById('game-overlay').classList.remove('hidden');
    document.getElementById('modal-content').innerHTML = '<h3>주문 영창 중...</h3>';
    socket.emit('startMiniGame', t);
}

socket.on('gameChallenge', (d) => {
    const c = document.getElementById('modal-content');
    if(!c) return;
    if(d.type === 'focus') {
        c.innerHTML = `<h3>정신 집중 (8자리)</h3><h1 class="metallic-gold" style="font-size:3rem;">${d.target}</h1>`;
        setTimeout(() => {
            c.innerHTML = `<h3>기억한 조각 기입</h3><input type="text" id="ans-focus" class="magic-input" style="background:white; color:black; width:100%; text-align:center; padding:10px; margin:20px 0;" maxlength="8" autofocus><br><button class="magic-book-btn" onclick="submitGame('focus')">제출</button>`;
        }, 5000);
    } else if(d.type === 'timing') {
        c.innerHTML = '<h3>지팡이를 겨누고 대기...</h3>';
    } else if(d.type === 'reaction') {
        let count = 0;
        c.innerHTML = `<h3>마력 방출!</h3><h1 id="count-disp" class="cinzel">0</h1><button id="orb-btn" class="mana-orb">TAP</button>`;
        const btn = document.getElementById('orb-btn');
        if(btn) btn.onclick = () => { count++; document.getElementById('count-disp').innerText = count; };
        setTimeout(() => { socket.emit('verifyMiniGame', { type: 'reaction', count }); document.getElementById('game-overlay').classList.add('hidden'); }, 5000);
    }
});

socket.on('gameSignal', (d) => {
    if(d.action === 'NOW') {
        const c = document.getElementById('modal-content');
        if(c) c.innerHTML = `<h3>지금!!!</h3><button class="wand-strike-btn" onclick="submitGame('timing')">STRIKE!</button>`;
    }
});

function submitGame(t) {
    const input = document.getElementById('ans-focus');
    socket.emit('verifyMiniGame', { type: t, answer: input ? input.value : null });
    document.getElementById('game-overlay').classList.add('hidden');
}

function buyHint() { if(confirm('예언의 서를 여시겠습니까?')) socket.emit('buyHint'); }
function openReport() { const n = prompt('고발할 마법사의 성함'); if(n) socket.emit('report', n); }
function deSteal() { const h = prompt('강탈할 기숙사명'); if(h) socket.emit('deSteal', h); }
function toggleAdmin() { 
    console.log("[ACTION] Admin Panel Toggled");
    const p = document.getElementById('admin-panel'); 
    if(p) p.classList.toggle('hidden'); 
}

function adminAction(type, targetId, extra = {}) {
    const password = document.getElementById('admin-pass').value;
    socket.emit('adminAction', { password, type, targetId, ...extra });
}

function applyBalance() {
    const config = { 
        hintPrice: parseInt(document.getElementById('cfg-hint-price').value), 
        gameBasePoints: parseInt(document.getElementById('cfg-game-points').value) 
    };
    adminAction('updateConfig', null, { config });
}

function applyHouseScores() {
    const scores = { 
        Gryffindor: document.getElementById('score-input-Gryffindor').value, 
        Slytherin: document.getElementById('score-input-Slytherin').value 
    };
    adminAction('updateHouseScores', null, { scores });
}

function syncBalanceInputs() {
    const hp = document.getElementById('cfg-hint-price');
    const gp = document.getElementById('cfg-game-points');
    if(hp && document.activeElement !== hp) hp.value = gameState.config.hintPrice;
    if(gp && document.activeElement !== gp) gp.value = gameState.config.gameBasePoints;
}

function syncScoreInputs() {
    for(let h in gameState.houses) {
        const el = document.getElementById(`score-input-${h}`);
        if(el && document.activeElement !== el) el.value = gameState.houses[h].score;
    }
}

function updateAdminList() {
    const list = document.getElementById('admin-player-list');
    if(!list) return;
    list.innerHTML = '';
    for(let id in gameState.players) {
        const p = gameState.players[id];
        const card = document.createElement('div');
        card.className = 'player-admin-card';
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${p.nickname}</strong>
                <div>
                    <select onchange="adminAction('setHouse', '${id}', {house: this.value})">
                        <option value="">기숙사</option>
                        <option value="Gryffindor" ${p.house==='Gryffindor'?'selected':''}>그리핀도르</option>
                        <option value="Slytherin" ${p.house==='Slytherin'?'selected':''}>슬리데린</option>
                    </select>
                    <select onchange="adminAction('setRole', '${id}', {role: this.value})">
                        <option value="student" ${p.role==='student'?'selected':''}>학생</option>
                        <option value="de" ${p.role==='de'?'selected':''}>죽먹자</option>
                    </select>
                </div>
            </div>
            <div style="margin-top:10px; display:flex; gap:5px;"><input type="text" id="hint-${id}" placeholder="힌트" style="flex:1;"><button onclick="const h=document.getElementById('hint-${id}').value; if(h){ adminAction('addHint', '${id}', {hint:h}); document.getElementById('hint-${id}').value=''; }">추가</button></div>
        `;
        list.appendChild(card);
    }
}
