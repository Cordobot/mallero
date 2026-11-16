// Pantalla de reto para apagar la alarma.
// La usan la app Android (dentro de AlarmActivity, puente window.MalleroNative)
// y la web (en un iframe; avisa al padre con postMessage).
(function () {
    'use strict';

    const params = new URLSearchParams(location.search);
    const ALL_TYPES = ['math', 'pattern', 'shake', 'phrase'];
    const config = {
        title: params.get('title') || 'Alarma',
        body: params.get('body') || '',
        types: (params.get('types') || 'math').split(',').filter((t) => ALL_TYPES.includes(t)),
        difficulty: ['easy', 'medium', 'hard'].includes(params.get('diff')) ? params.get('diff') : 'medium',
        challenge: params.get('ch') !== '0',
        snoozeMinutes: Math.max(0, parseInt(params.get('snooze') || '0', 10) || 0),
        snoozesLeft: Math.max(0, parseInt(params.get('left') || '0', 10) || 0)
    };
    if (config.types.length === 0) config.types = ['math'];

    const stage = document.getElementById('stage');
    const snoozeBtn = document.getElementById('snooze-btn');
    document.getElementById('title').textContent = config.title;
    document.getElementById('body').textContent = config.body;

    const pad2 = (n) => String(n).padStart(2, '0');
    function tick() {
        const d = new Date();
        document.getElementById('clock').textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
    tick();
    setInterval(tick, 1000);

    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const level = { easy: 0, medium: 1, hard: 2 }[config.difficulty];

    // --- Comunicación con quien abrió la alarma ---
    let finished = false;
    function send(action) {
        if (finished) return;
        finished = true;
        if (window.MalleroNative && typeof window.MalleroNative[action] === 'function') {
            window.MalleroNative[action]();
        } else if (window.parent !== window) {
            window.parent.postMessage({ mallero: action }, '*');
        }
    }

    function dismiss() {
        stopSensors();
        stage.innerHTML = '<div class="done">✅</div><div class="title">¡Alarma apagada!</div>';
        snoozeBtn.style.display = 'none';
        setTimeout(() => send('dismiss'), 600);
    }

    if (config.snoozeMinutes > 0 && config.snoozesLeft > 0) {
        snoozeBtn.style.display = 'block';
        snoozeBtn.textContent = `😴 Posponer ${config.snoozeMinutes} min (quedan ${config.snoozesLeft})`;
        snoozeBtn.addEventListener('click', () => {
            stopSensors();
            send('snooze');
        });
    }

    // --- Retos ---

    function header(label, progress) {
        return `<div class="label">${label}</div>${progress ? `<div class="progress">${progress}</div>` : ''}`;
    }

    // Matemáticas: varias operaciones seguidas, más difíciles según el nivel
    function mathChallenge(done) {
        const total = [2, 3, 4][level];
        let solved = 0;

        function makeProblem() {
            if (level === 0) {
                const a = rand(2, 20), b = rand(2, 20);
                return Math.random() < 0.5 ? { q: `${a} + ${b}`, a: a + b } : { q: `${Math.max(a, b)} − ${Math.min(a, b)}`, a: Math.abs(a - b) };
            }
            if (level === 1) {
                const kind = rand(0, 2);
                if (kind === 0) { const a = rand(12, 99), b = rand(12, 99); return { q: `${a} + ${b}`, a: a + b }; }
                if (kind === 1) { const a = rand(3, 12), b = rand(3, 12); return { q: `${a} × ${b}`, a: a * b }; }
                const a = rand(40, 99), b = rand(11, 39); return { q: `${a} − ${b}`, a: a - b };
            }
            const kind = rand(0, 1);
            if (kind === 0) { const a = rand(6, 15), b = rand(6, 15), c = rand(10, 99); return { q: `${a} × ${b} + ${c}`, a: a * b + c }; }
            const a = rand(12, 25), b = rand(3, 9), c = rand(5, 50); return { q: `${a} × ${b} − ${c}`, a: a * b - c };
        }

        function render() {
            const p = makeProblem();
            stage.innerHTML = `
                ${header('🧮 Resuelve', `${solved + 1} de ${total}`)}
                <div class="question">${p.q} = ?</div>
                <input class="answer" id="ans" type="text" inputmode="numeric" autocomplete="off">
                <button class="btn" id="ok">Comprobar</button>`;
            const input = document.getElementById('ans');
            const check = () => {
                if (input.value.trim() !== '' && Number(input.value.trim()) === p.a) {
                    solved++;
                    if (solved >= total) done(); else render();
                } else {
                    input.classList.remove('wrong');
                    void input.offsetWidth;
                    input.classList.add('wrong');
                    input.value = '';
                }
            };
            document.getElementById('ok').addEventListener('click', check);
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
            input.focus();
        }
        render();
    }

    // Patrón: memoriza la secuencia de casillas iluminadas y repítela
    function patternChallenge(done) {
        const size = [3, 4, 4][level];
        const length = [4, 5, 7][level];
        let sequence = [];
        let input = [];
        let showing = false;

        function render(message) {
            stage.innerHTML = `
                ${header('🧩 Repite el patrón', message || 'Mira la secuencia…')}
                <div class="grid" id="grid" style="grid-template-columns: repeat(${size}, 1fr); max-width: ${size * 72}px;">
                    ${Array.from({ length: size * size }, (_, i) => `<div class="cell" data-i="${i}"></div>`).join('')}
                </div>
                <button class="btn secondary" id="replay">👀 Ver de nuevo</button>`;
            document.querySelectorAll('.cell').forEach((cell) => cell.addEventListener('click', () => tap(Number(cell.dataset.i), cell)));
            document.getElementById('replay').addEventListener('click', () => start(false));
        }

        function flash(i, cls, ms) {
            const cell = document.querySelector(`.cell[data-i="${i}"]`);
            if (!cell) return;
            cell.classList.add(cls);
            setTimeout(() => cell.classList.remove(cls), ms);
        }

        function start(newPattern) {
            if (newPattern || sequence.length === 0) {
                sequence = [];
                for (let k = 0; k < length; k++) {
                    let next;
                    do { next = rand(0, size * size - 1); } while (next === sequence[sequence.length - 1]);
                    sequence.push(next);
                }
            }
            input = [];
            showing = true;
            render();
            const speed = [700, 600, 480][level];
            sequence.forEach((i, k) => setTimeout(() => flash(i, 'on', speed * 0.7), 500 + k * speed));
            setTimeout(() => {
                showing = false;
                const progress = document.querySelector('.progress');
                if (progress) progress.textContent = `Tu turno: 0 de ${length}`;
            }, 500 + sequence.length * speed);
        }

        function tap(i) {
            if (showing) return;
            if (sequence[input.length] === i) {
                input.push(i);
                flash(i, 'ok', 250);
                document.querySelector('.progress').textContent = `Tu turno: ${input.length} de ${length}`;
                if (input.length === sequence.length) setTimeout(done, 300);
            } else {
                flash(i, 'bad', 400);
                showing = true;
                document.querySelector('.progress').textContent = '❌ Fallaste. Nuevo patrón…';
                setTimeout(() => start(true), 900);
            }
        }

        start(true);
    }

    // Agitar el teléfono N veces
    let motionHandler = null;
    function stopSensors() {
        if (motionHandler) window.removeEventListener('devicemotion', motionHandler);
        motionHandler = null;
    }

    function shakeChallenge(done, fallback) {
        const target = [15, 30, 50][level];
        let count = 0;
        let lastShake = 0;
        let sawSensor = false;

        stage.innerHTML = `
            ${header('📳 Agita el teléfono')}
            <div class="big" id="count">0</div>
            <div class="hint">de ${target} sacudidas</div>
            <div class="meter"><div id="bar"></div></div>
            <div class="hint" id="sensor-hint"></div>`;

        motionHandler = (e) => {
            const a = e.accelerationIncludingGravity || e.acceleration;
            if (!a || a.x === null) return;
            sawSensor = true;
            const g = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
            const now = Date.now();
            // ~9.8 en reposo; una sacudida pasa claramente de ese valor
            if (Math.abs(g - 9.8) > 9 && now - lastShake > 220) {
                lastShake = now;
                count++;
                document.getElementById('count').textContent = count;
                document.getElementById('bar').style.width = `${Math.min(100, (count / target) * 100)}%`;
                if (navigator.vibrate) navigator.vibrate(30);
                if (count >= target) { stopSensors(); done(); }
            }
        };

        const startListening = () => {
            window.addEventListener('devicemotion', motionHandler);
            // Sin acelerómetro (ej. computador): se cambia a otro reto
            setTimeout(() => {
                if (!sawSensor && motionHandler) {
                    stopSensors();
                    document.getElementById('sensor-hint').textContent = 'Este dispositivo no tiene sensor de movimiento.';
                    setTimeout(fallback, 1200);
                }
            }, 3500);
        };
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            // iOS pide permiso con un toque
            stage.insertAdjacentHTML('beforeend', '<button class="btn" id="perm">Permitir sensor</button>');
            document.getElementById('perm').addEventListener('click', async () => {
                try { if (await DeviceMotionEvent.requestPermission() === 'granted') startListening(); } catch (e) {}
                document.getElementById('perm').remove();
            });
        } else {
            startListening();
        }

    }

    // Escribir una frase exactamente
    const PHRASES = [
        ['Ya estoy despierto', 'Hoy es un buen día', 'Me levanto ahora', 'Voy a trabajar'],
        ['Me levanto ahora mismo para llegar a tiempo', 'Hoy voy a tener un turno excelente', 'La puntualidad es parte de mi trabajo'],
        ['Me levanto de inmediato, me organizo y salgo con tiempo de sobra hacia mi turno', 'Cada mañana que llego puntual es una pequeña victoria para mí', 'No voy a volver a la cama porque hoy tengo cosas importantes que hacer']
    ];
    const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, '').replace(/\s+/g, ' ').trim();

    function phraseChallenge(done) {
        const phrase = pick(PHRASES[level]);
        stage.innerHTML = `
            ${header('✍️ Escribe la frase')}
            <div class="phrase">${phrase}</div>
            <textarea class="answer" id="ans" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
            <button class="btn" id="ok">Comprobar</button>`;
        const input = document.getElementById('ans');
        input.addEventListener('paste', (e) => e.preventDefault());
        const check = () => {
            if (normalize(input.value) === normalize(phrase)) done();
            else { input.classList.remove('wrong'); void input.offsetWidth; input.classList.add('wrong'); }
        };
        input.addEventListener('input', () => { if (normalize(input.value) === normalize(phrase)) done(); });
        document.getElementById('ok').addEventListener('click', check);
        input.focus();
    }

    // --- Inicio ---
    function runChallenge(types) {
        const type = pick(types);
        const others = types.filter((t) => t !== type && t !== 'shake');
        if (type === 'math') mathChallenge(dismiss);
        else if (type === 'pattern') patternChallenge(dismiss);
        else if (type === 'phrase') phraseChallenge(dismiss);
        else shakeChallenge(dismiss, () => runChallenge(others.length ? others : ['math']));
    }

    if (config.challenge) {
        runChallenge(config.types);
    } else {
        stage.innerHTML = '<button class="btn danger" id="off">Apagar alarma</button>';
        document.getElementById('off').addEventListener('click', dismiss);
    }
})();
