const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const ADMIN_PASSWORD = 'sein0903';
const DATA_FILE = path.join(__dirname, 'game_state.json');

// --- 데이터 영속성 관리 ---
function saveState() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(gameState)); } catch(e) {} }
function loadState() {
    try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e) {}
    return null;
}

let gameState = loadState() || {
    status: 'waiting', day: 1, maxDay: 10,
    houses: {
        Gryffindor: { score: 0, deRevealed: false },
        Slytherin: { score: 0, deRevealed: false },
        Ravenclaw: { score: 0, deRevealed: false },
        Hufflepuff: { score: 0, deRevealed: false }
    },
    deTeamScore: 0, deMultiplier: 1.3, deCaughtCount: 0,
    players: {}, garticLink: '',
    config: { hintPrice: 50, gameBasePoints: 100, stealCost: 0, stealAmount: 50 }
};

const activeSessions = {};

function mapHouseName(name) {
    const map = { 
        '그리핀도르': 'Gryffindor', '슬리데린': 'Slytherin',
        '레번클로': 'Ravenclaw', '후플푸프': 'Hufflepuff'
    };
    return map[name.trim()] || name.trim();
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

io.on('connection', (socket) => {
    console.log(`[IO] Wizard connected: ${socket.id}`);
    socket.emit('init', { gameState, myId: socket.id });

    socket.on('join', (nickname) => {
        if (gameState.status !== 'waiting') return socket.emit('error', '이미 연회가 시작되었습니다.');
        const trimmedNick = nickname.trim();
        if (!trimmedNick) return socket.emit('error', '성함을 입력해주세요.');
        const exists = Object.values(gameState.players).some(p => p.nickname === trimmedNick);
        if (exists) return socket.emit('error', '이미 재학 중인 이름입니다.');

        gameState.players[socket.id] = { 
            id: socket.id, nickname: trimmedNick, house: null, role: 'student', 
            isEliminated: false, hints: [], attempts: { timing: 0, reaction: 0, focus: 0, creature: 0 }
        };
        saveState();
        io.emit('updatePlayers', gameState.players);
    });

    socket.on('startMiniGame', (type) => {
        const p = gameState.players[socket.id];
        if (!p || gameState.status !== 'running' || p.isEliminated) return;
        if (p.attempts[type] >= 2) return socket.emit('error', '마력을 모두 소모했습니다.');

        if (type === 'creature') {
            if (!gameState.garticLink) return socket.emit('error', '교수님이 링크를 설정하지 않았습니다.');
            p.attempts[type]++;
            socket.emit('openGartic', gameState.garticLink);
            saveState(); io.emit('updatePlayers', gameState.players);
            return;
        }

        activeSessions[socket.id] = { type, startTime: Date.now() };
        p.attempts[type]++;
        saveState();
        
        if (type === 'focus') {
            let num = ''; for(let i=0; i<8; i++) num += Math.floor(Math.random()*10);
            activeSessions[socket.id].target = num;
            socket.emit('gameChallenge', { type, target: num });
        } else if (type === 'timing') {
            const delay = 1500 + Math.random() * 2500;
            socket.emit('gameChallenge', { type, action: 'WAIT' });
            setTimeout(() => {
                if (activeSessions[socket.id] && activeSessions[socket.id].type === 'timing') {
                    activeSessions[socket.id].signalTime = Date.now();
                    socket.emit('gameSignal', { action: 'NOW' });
                }
            }, delay);
        } else {
            socket.emit('gameChallenge', { type });
        }
        io.emit('updatePlayers', gameState.players);
    });

    socket.on('verifyMiniGame', (data) => {
        const session = activeSessions[socket.id];
        const p = gameState.players[socket.id];
        if (!session || !p) return;

        let points = 0;
        const base = gameState.config.gameBasePoints;
        if (session.type === 'timing' && session.signalTime) {
            const diff = Date.now() - session.signalTime;
            points = diff < 450 ? base : diff < 900 ? Math.floor(base*0.5) : Math.floor(base*0.2);
        } else if (session.type === 'focus') {
            const target = session.target;
            const answer = (data.answer || '').toString();
            let matches = 0;
            for(let i=0; i<target.length; i++) if(target[i] === answer[i]) matches++;
            const errors = target.length - matches;
            points = errors === 0 ? 100 : errors <= 2 ? 80 : errors <= 4 ? 60 : errors <= 6 ? 40 : 20;
        } else if (session.type === 'reaction') {
            points = Math.min(Math.floor(base*1.5), Math.floor(data.count * (base/25)));
        }

        delete activeSessions[socket.id];
        if (p.role === 'de') {
            const total = Math.floor(points * gameState.deMultiplier);
            const housePoints = Math.floor(total * 0.7);
            if(p.house) gameState.houses[p.house].score += housePoints;
            gameState.deTeamScore += (total - housePoints);
        } else if (p.house) {
            gameState.houses[p.house].score += points;
        }
        saveState(); io.emit('updateGameState', gameState);
        socket.emit('notification', `${points}점을 획득했습니다.`);
    });

    socket.on('adminAction', (data) => {
        if (data.password !== ADMIN_PASSWORD) return socket.emit('error', '주문이 틀렸습니다.');
        if (data.type === 'startGame') gameState.status = 'running';
        else if (data.type === 'updateConfig') gameState.config = { ...gameState.config, ...data.config };
        else if (data.type === 'setRole') { if(gameState.players[data.targetId]) gameState.players[data.targetId].role = data.role; }
        else if (data.type === 'setHouse') { if(gameState.players[data.targetId]) gameState.players[data.targetId].house = data.house; }
        else if (data.type === 'addHint') { if(gameState.players[data.targetId]) gameState.players[data.targetId].hints.push(data.hint); }
        else if (data.type === 'removeHint') { if(gameState.players[data.targetId]) gameState.players[data.targetId].hints.splice(data.index, 1); }
        else if (data.type === 'updateHouseScores') { for(let h in data.scores) { if(gameState.houses[h]) gameState.houses[h].score = parseInt(data.scores[h]) || 0; } }
        else if (data.type === 'nextDay') {
            gameState.day++;
            for(let id in gameState.players) gameState.players[id].attempts = { timing: 0, reaction: 0, focus: 0, creature: 0 };
            if (gameState.day > gameState.maxDay) gameState.status = 'ended';
        }
        else if (data.type === 'setGartic') gameState.garticLink = data.link;
        else if (data.type === 'reset') {
            gameState.status = 'waiting'; gameState.players = {}; gameState.day = 1;
            for(let h in gameState.houses) { gameState.houses[h].score = 0; gameState.houses[h].deRevealed = false; }
            if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
        }
        saveState(); io.emit('updateGameState', gameState); io.emit('updatePlayers', gameState.players);
    });

    socket.on('buyHint', () => {
        const p = gameState.players[socket.id];
        const price = gameState.config.hintPrice;
        if (!p || !p.house || p.isEliminated || gameState.houses[p.house].score < price) return;
        const allHints = [];
        for(let id in gameState.players) gameState.players[id].hints.forEach(text => allHints.push(text));
        if (allHints.length === 0) return socket.emit('error', '아직 예언이 없습니다.');
        gameState.houses[p.house].score -= price;
        saveState();
        io.emit('newHint', { text: allHints[Math.floor(Math.random() * allHints.length)], house: p.house });
        io.emit('updateGameState', gameState);
    });

    socket.on('report', (targetNick) => {
        const p = gameState.players[socket.id];
        if (!p || !p.house || p.isEliminated) return;
        const targetEntry = Object.entries(gameState.players).find(([id, pl]) => pl.nickname.toLowerCase() === targetNick.trim().toLowerCase());
        if (!targetEntry) return socket.emit('error', '존재하지 않는 마법사입니다.');
        const [targetId, target] = targetEntry;
        if (target.role === 'de' && target.house === p.house) {
            target.isEliminated = true;
            gameState.houses[p.house].deRevealed = true;
            gameState.deCaughtCount++; gameState.deMultiplier += 0.1;
            io.emit('notification', `${target.nickname} 검거 성공!`);
            io.to(targetId).emit('azkabanExile');
        } else {
            gameState.houses[p.house].score = Math.max(0, gameState.houses[p.house].score - 100);
            socket.emit('error', '오보입니다! 100점 감점');
        }
        saveState(); io.emit('updateGameState', gameState); io.emit('updatePlayers', gameState.players);
    });

    socket.on('deSteal', (rawHouse) => {
        const p = gameState.players[socket.id];
        const targetHouse = mapHouseName(rawHouse);
        if (p && p.role === 'de' && !p.isEliminated && gameState.houses[targetHouse]) {
            if (targetHouse === p.house) return socket.emit('error', '본인 기숙사 강탈 불가');
            const actualSteal = Math.min(gameState.houses[targetHouse].score, gameState.config.stealAmount);
            gameState.houses[targetHouse].score -= actualSteal;
            gameState.houses[p.house].score += actualSteal;
            saveState(); io.emit('updateGameState', gameState); socket.emit('notification', `${targetHouse} 강탈 성공!`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`[SERVER] Magic World open on ${PORT}`));
