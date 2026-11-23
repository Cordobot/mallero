// Estado global
let scheduleData = [];
let selectedFile = null;
let currentProcessingId = 0; // Cancela procesos de imagen si el usuario usa otra opción
let currentUserId = localStorage.getItem('mallero_user_id') || '';
let audioCtx = null;
let lastRefreshMinute = ''; // Minuto del último refresco de la tabla

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const BREAK_MINUTES = 15; // Duración asumida de cada break (para el calendario)
const ALARM_GRACE_MS = 3 * 60 * 1000; // Margen por si el navegador congela la pestaña en segundo plano
const DEFAULT_ALARM_SETTINGS = {
    types: { entrada: true, almuerzo: true, break: true, salida: true, noche: true },
    lead: 5,
    wa: '',
    // Retos para apagar la alarma (estilo Alarmy)
    challengeOn: { entrada: true, almuerzo: true, break: true, salida: true, noche: false },
    challengeTypes: { math: true, pattern: true, shake: true, phrase: true },
    difficulty: 'medium',
    snoozeMinutes: 5, // 0 = no se puede posponer
    snoozeMax: 2
};

// App Android (Capacitor): las alarmas las programa el sistema y suenan con la app cerrada
const nativeAlarm = (() => {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    try {
        return cap.registerPlugin ? cap.registerPlugin('MalleroAlarm') : (cap.Plugins && cap.Plugins.MalleroAlarm) || null;
    } catch (e) {
        return null;
    }
})();
let lastNativeSync = '';
if (nativeAlarm) document.documentElement.classList.add('native-app');

// Configuración de Base de Datos (Placeholder para el usuario)
const DB_CONFIG = {
    url: 'https://dfnztpxdyaiefbmwodtv.supabase.co',
    key: 'sb_publishable_xHOtRDSkjIn5wxipIkxrww_aofKZFKv' // clave pública: es seguro tenerla en la página
};
let currentPin = localStorage.getItem('mallero_pin') || '';

let supabase = null;
if (DB_CONFIG.url && DB_CONFIG.key && window.supabase) {
    // La librería vive en window.supabase; la variable local guarda el cliente
    supabase = window.supabase.createClient(DB_CONFIG.url, DB_CONFIG.key);
}

// Elementos DOM
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('excel-upload');
const fileNameDisplay = document.getElementById('file-name-display');
const xlsxDropZone = document.getElementById('xlsx-drop-zone');
const xlsxInput = document.getElementById('xlsx-upload');
const xlsxNameDisplay = document.getElementById('xlsx-name-display');
const uploadActions = document.getElementById('upload-actions');
const progressBar = document.getElementById('upload-progress');
const processBtn = document.getElementById('process-btn');
const scheduleContainer = document.getElementById('schedule-container');
const scheduleBody = document.getElementById('schedule-body');
const alarmSection = document.getElementById('alarm-section');
const clearBtn = document.getElementById('clear-data');
const alarmToast = document.getElementById('alarm-notification');
const alarmTitle = document.getElementById('alarm-title');
const alarmDesc = document.getElementById('alarm-desc');
const closeAlarmBtn = document.getElementById('close-alarm');

// --- Utilidades ---

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const pad2 = (n) => String(n).padStart(2, '0');

function formatHM(minutesOrDate) {
    if (minutesOrDate instanceof Date) return `${pad2(minutesOrDate.getHours())}:${pad2(minutesOrDate.getMinutes())}`;
    const mins = ((minutesOrDate % 1440) + 1440) % 1440;
    return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

// "8:00", "08:00" o "8.00" -> minutos desde medianoche (null si no es una hora)
function parseHM(str) {
    const match = String(str ?? '').match(/(\d{1,2})[:.](\d{2})/);
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
}

// "13:45/18:45" -> [825, 1125]
function parseTimes(str) {
    return (String(str ?? '').match(/\d{1,2}[:.]\d{2}/g) || []).map(parseHM).filter((m) => m !== null);
}

// "dd/mm/yyyy" -> Date a medianoche (null si no es válida)
function parseDateStr(str) {
    const parts = String(str ?? '').split('/').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return null;
    const [d, m, y] = parts;
    return new Date(y, m - 1, d);
}

function formatDate(date) {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function isRestDay(row) {
    return parseHM(row.ini) === null;
}

// --- Modal de Confirmación personalizado ---

function showConfirm() {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-overlay');
        overlay.classList.add('visible');

        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        function close(result) {
            overlay.classList.remove('visible');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(result);
        }

        const onOk = () => close(true);
        const onCancel = () => close(false);

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(false);
        }, { once: true });
    });
}

// --- Inicialización ---

function init() {
    updateClock();
    setInterval(updateClock, 1000);
    if (nativeAlarm) setInterval(checkAlarms, 10000);

    // Al volver a la página (pestaña dormida, app en segundo plano o restaurada desde caché)
    // se refresca todo para no mostrar el día anterior
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshView();
            // Al volver de los ajustes de Android se actualiza el estado de los permisos
            if (nativeAlarm) updatePermissionStatus();
            // Al volver a la app/pestaña se trae lo último de la nube
            fetchCloudData();
        }
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) refreshView();
    });
    window.addEventListener('focus', refreshView);

    // Identidad para sincronizar: cédula + PIN
    const userIdInput = document.getElementById('user-id');
    const pinInput = document.getElementById('user-pin');
    userIdInput.value = currentUserId;
    pinInput.value = currentPin;
    const connect = (showErrors) => {
        currentUserId = userIdInput.value.trim();
        currentPin = pinInput.value.replace(/\D/g, '');
        pinInput.value = currentPin;
        localStorage.setItem('mallero_user_id', currentUserId);
        localStorage.setItem('mallero_pin', currentPin);
        if (!currentUserId || currentPin.length < 4) {
            if (showErrors) {
                alert(!currentUserId ? 'Por favor ingresa tu cédula.' : 'Escribe un PIN de 4 a 6 dígitos. Usa el mismo en la web y en la app.');
                (!currentUserId ? userIdInput : pinInput).focus();
            }
            setSyncStatus('Escribe tu cédula y un PIN para sincronizar la web y la app.');
            return;
        }
        connectCloud(true);
    };
    userIdInput.addEventListener('change', () => connect(false));
    pinInput.addEventListener('change', () => connect(false));
    document.getElementById('load-btn').addEventListener('click', () => connect(true));

    const savedData = localStorage.getItem('mallero_data');
    if (savedData) {
        const parsedData = JSON.parse(savedData);
        if (isFromCurrentWeek(parsedData)) {
            scheduleData = parsedData;
            renderSchedule();
        } else {
            console.log('Datos expirados (semana anterior). Limpiando...');
            localStorage.removeItem('mallero_data');
        }
    }

    // Traer de la nube lo último (malla y ajustes)
    connectCloud(false);

    // Eventos: Excel
    xlsxDropZone.addEventListener('click', () => xlsxInput.click());
    xlsxDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        xlsxDropZone.classList.add('dragover');
    });
    xlsxDropZone.addEventListener('dragleave', () => xlsxDropZone.classList.remove('dragover'));
    xlsxDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        xlsxDropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleExcelFile(file);
    });
    xlsxInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleExcelFile(file);
        xlsxInput.value = ''; // Permite volver a elegir el mismo archivo
    });

    // Eventos: Imagen
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) prepareUpload(file);
        else if (file && isExcelFile(file)) handleExcelFile(file);
    });
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) prepareUpload(file);
    });
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData.items;
        let imageDetected = false;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();

                // Feedback visual: Hacer que la zona de carga brille un momento
                dropZone.style.borderColor = '#6366f1';
                dropZone.style.background = 'rgba(99, 102, 241, 0.15)';
                setTimeout(() => {
                    dropZone.style.borderColor = '';
                    dropZone.style.background = '';
                }, 400);

                prepareUpload(blob);
                imageDetected = true;
                break;
            }
        }

        if (imageDetected && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
        }
    });
    processBtn.addEventListener('click', handleUpload);
    clearBtn.addEventListener('click', async () => {
        const ok = await showConfirm();
        if (ok) clearData();
    });
    closeAlarmBtn.addEventListener('click', () => alarmToast.style.display = 'none');

    // Pegar desde Excel directamente
    const processTextBtn = document.getElementById('process-text-btn');
    if (processTextBtn) {
        processTextBtn.addEventListener('click', () => {
            const text = document.getElementById('excel-paste').value;
            if (!text || text.trim() === '') {
                alert('Por favor pega los datos de Excel en la caja de texto.');
                return;
            }
            // Cancelar cualquier OCR en curso (invalida el processingId)
            currentProcessingId++;
            selectedFile = null;
            parseOCRText(text);
            document.getElementById('excel-paste').value = '';
        });
    }

    // WhatsApp: se abre solo con un clic del usuario (los navegadores bloquean ventanas automáticas)
    const waBtn = document.getElementById('wa-btn');
    if (waBtn) {
        waBtn.addEventListener('click', () => {
            const msg = encodeURIComponent(alarmDesc.textContent);
            const number = getAlarmSettings().wa.replace(/\D/g, '');
            window.open(`https://wa.me/${number}?text=${msg}`, '_blank');
        });
    }

    // Guardar ediciones manuales
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            saveData(true); // Forzar guardado manual con feedback
        });
    }

    initAlarmSettings();
    initUploadModal();
    // Sin malla todavía: se abre el popup para cargarla
    if (scheduleData.length === 0) openUploadModal();

    // El audio solo puede sonar después de una interacción del usuario
    document.addEventListener('pointerdown', unlockAudio, { once: true });
}

function isExcelFile(file) {
    return /\.(xlsx|xlsm|xls)$/i.test(file.name || '');
}

// --- Popup "Subir malla" ---

function openUploadModal() {
    const overlay = document.getElementById('upload-overlay');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeUploadModal() {
    const overlay = document.getElementById('upload-overlay');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function initUploadModal() {
    const overlay = document.getElementById('upload-overlay');
    document.getElementById('open-upload-btn').addEventListener('click', openUploadModal);
    document.getElementById('upload-close-btn').addEventListener('click', closeUploadModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeUploadModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeUploadModal(); });
}

function applySchedule(data) {
    closeUploadModal();
    scheduleData = data;
    localStorage.setItem('mallero_data', JSON.stringify(scheduleData));
    markLocalChange();
    renderSchedule();
    syncCloudData();
}

function saveData(manual = false) {
    if (!currentUserId) {
        alert('Debes ingresar tu cédula para guardar los datos.');
        document.getElementById('user-id').focus();
        return;
    }

    const rows = scheduleBody.querySelectorAll('tr');
    if (rows.length === 0) return;

    scheduleData = Array.from(rows).map((tr) => {
        const cells = tr.querySelectorAll('td');
        return {
            fecha: cells[0].innerText.trim(),
            dia: cells[1].innerText.trim(),
            ini: cells[2].innerText.trim(),
            fin: cells[3].innerText.trim(),
            iniInter: cells[4].innerText.trim(),
            finInter: cells[5].innerText.trim(),
            break: cells[6].innerText.trim()
        };
    });

    // Guardar localmente siempre y subir a la nube
    localStorage.setItem('mallero_data', JSON.stringify(scheduleData));
    markLocalChange();
    syncCloudData();

    // Si es manual, mostrar feedback y refrescar (para badges de estado)
    if (manual) {
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) saveBtn.style.display = 'none';
        showToast('✅ Cambios guardados correctamente');
        renderSchedule();
    } else {
        renderUpcomingAlarms();
    }
}

function isFromCurrentWeek(data) {
    if (!data || data.length === 0) return false;

    const dates = data.map(row => row.fecha).filter(f => f && f !== '---');
    if (dates.length === 0) return true;

    const now = new Date();
    // Obtener el lunes de esta semana (0=Dom, 1=Lun)
    const currentMonday = new Date(now);
    const dow = now.getDay();
    const diff = now.getDate() - (dow === 0 ? 6 : dow - 1);
    currentMonday.setDate(diff);
    currentMonday.setHours(0, 0, 0, 0);

    // Si la fecha más lejana en la tabla es igual o superior al lunes de esta semana, es válida.
    const latestDate = dates.reduce((max, curr) => {
        const d = parseDateStr(curr) || new Date(0);
        return d > max ? d : max;
    }, new Date(0));

    return latestDate >= currentMonday;
}

// --- Lectura del Excel de malla ---

const normalizeText = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

// Las tildes a veces llegan dañadas ("Mi�rcoles"), por eso se acepta cualquier carácter en su lugar
const DAY_PATTERNS = [/^lunes$/, /^martes$/, /^mi.?rcoles$/, /^jueves$/, /^viernes$/, /^s.?bado$/, /^domingo$/];

function dayIndexFromText(value) {
    const text = normalizeText(value);
    return DAY_PATTERNS.findIndex((pattern) => pattern.test(text));
}

// Celda de hora: número de Excel (fracción del día) o texto como "13:45/18:45"
function excelTimeValue(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
        return formatHM(Math.round((value % 1) * 1440));
    }
    const times = parseTimes(value);
    return times.length ? times.map(formatHM).join('/') : null;
}

// Celda de fecha: número serial de Excel o texto "dd/mm/yyyy"
function excelDateValue(value) {
    if (typeof value === 'number' && value > 1) {
        const parsed = XLSX.SSF.parse_date_code(value);
        return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
    if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const match = String(value ?? '').match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (!match) return null;
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return new Date(year, Number(match[2]) - 1, Number(match[1]));
}

function columnRole(label) {
    const text = normalizeText(label);
    if (text.includes('inter') && text.includes('ini')) return 'iniInter';
    if (text.includes('inter') && text.includes('fin')) return 'finInter';
    if (text.includes('inicio')) return 'ini';
    if (text.includes('fin')) return 'fin';
    return null;
}

/**
 * Busca la fila de la cédula en la malla. Formato esperado:
 *   fila N-2: nombre del día sobre cada bloque y el grupo "Break"
 *   fila N-1: fecha de cada día
 *   fila N:   encabezados (Cedula, Nombre, Hora Inicio, Inter Ini, Inter Fin, Hora Fin, ...)
 * Devuelve null si no reconoce el formato, { schedule: null } si no encuentra la cédula.
 */
function parseExcelSchedule(workbook, cedula) {
    const target = String(cedula).replace(/\D/g, '');
    let formatFound = false;

    for (const sheetName of workbook.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
        const headerIdx = rows.findIndex((r) => r && r.some((c) => normalizeText(c) === 'cedula'));
        if (headerIdx < 2) continue;

        const header = rows[headerIdx];
        const dayRow = rows[headerIdx - 2] || [];
        const dateRow = rows[headerIdx - 1] || [];
        const cedulaCol = header.findIndex((c) => normalizeText(c) === 'cedula');
        const nameCol = header.findIndex((c) => normalizeText(c) === 'nombre');
        const breakCol = dayRow.findIndex((c) => normalizeText(c) === 'break');

        // Bloques de cada día: columna inicial con el nombre del día y sus 4 columnas de horario
        const blocks = [];
        const dayStarts = [];
        dayRow.forEach((cell, col) => {
            if (breakCol !== -1 && col >= breakCol) return;
            const dayIdx = dayIndexFromText(cell);
            if (dayIdx !== -1 && !dayStarts.some((d) => d.dayIdx === dayIdx)) dayStarts.push({ dayIdx, col });
        });
        dayStarts.forEach(({ dayIdx, col }, i) => {
            const limit = i + 1 < dayStarts.length ? dayStarts[i + 1].col : col + 4;
            const cols = {};
            for (let c = col; c < limit; c++) {
                const role = columnRole(header[c]);
                if (role && cols[role] === undefined) cols[role] = c;
            }
            blocks.push({ dayIdx, cols, date: excelDateValue(dateRow[col]) });
        });

        // Columnas de break por día (dentro del grupo "Break", hasta que empiece el siguiente grupo)
        const breakCols = {};
        if (breakCol !== -1) {
            for (let c = breakCol; c < header.length; c++) {
                if (c > breakCol && normalizeText(dayRow[c]) !== '') break;
                const dayIdx = dayIndexFromText(header[c]);
                if (dayIdx !== -1 && breakCols[dayIdx] === undefined) breakCols[dayIdx] = c;
            }
        }

        if (cedulaCol === -1 || blocks.length === 0) continue;
        formatFound = true;

        const person = rows.slice(headerIdx + 1).find((r) => r && String(r[cedulaCol] ?? '').replace(/\D/g, '') === target);
        if (!person) continue;

        // Completar fechas faltantes a partir de un día conocido
        const known = blocks.find((b) => b.date);
        const schedule = blocks.map((block) => {
            let date = block.date;
            if (!date && known) {
                date = new Date(known.date);
                date.setDate(date.getDate() + (block.dayIdx - known.dayIdx));
            }
            const cell = (role) => (block.cols[role] !== undefined ? excelTimeValue(person[block.cols[role]]) : null);
            const ini = cell('ini');
            const fin = cell('fin');
            const breakValue = breakCols[block.dayIdx] !== undefined ? excelTimeValue(person[breakCols[block.dayIdx]]) : null;
            const working = ini !== null || fin !== null;

            return {
                fecha: date ? formatDate(date) : '---',
                dia: DAY_NAMES[block.dayIdx],
                ini: working ? (ini || '---') : 'Descanso',
                fin: working ? (fin || '---') : 'Libre',
                iniInter: (working && cell('iniInter')) || '---',
                finInter: (working && cell('finInter')) || '---',
                break: (working && breakValue) || '---'
            };
        });

        schedule.sort((a, b) => (parseDateStr(a.fecha) || 0) - (parseDateStr(b.fecha) || 0));
        return { schedule, name: nameCol !== -1 ? String(person[nameCol] ?? '').trim() : '' };
    }

    return formatFound ? { schedule: null } : null;
}

async function handleExcelFile(file) {
    if (!isExcelFile(file)) {
        alert('Ese archivo no es un Excel (.xlsx o .xls).');
        return;
    }

    const userIdInput = document.getElementById('user-id');
    const cedula = userIdInput.value.trim();
    if (!cedula) {
        alert('Primero ingresa tu cédula para buscar tu fila en la malla.');
        userIdInput.focus();
        return;
    }
    currentUserId = cedula;
    localStorage.setItem('mallero_user_id', currentUserId);

    xlsxNameDisplay.innerHTML = `Leyendo <strong>${escapeHtml(file.name)}</strong>...`;

    try {
        const buffer = await file.arrayBuffer();
        // @ts-ignore - SheetJS se carga desde el CDN
        const workbook = XLSX.read(buffer, { type: 'array' });
        const result = parseExcelSchedule(workbook, cedula);

        if (!result) {
            xlsxNameDisplay.innerHTML = 'Arrastra aquí el archivo <span>.xlsx</span> o haz clic para elegirlo';
            alert('No reconocí el formato: no encontré la columna "Cedula" con los días y horarios encima.');
            return;
        }
        if (!result.schedule) {
            xlsxNameDisplay.innerHTML = 'Arrastra aquí el archivo <span>.xlsx</span> o haz clic para elegirlo';
            alert(`No encontré la cédula ${cedula} en este archivo.`);
            return;
        }

        // Cancelar cualquier OCR en curso
        currentProcessingId++;
        selectedFile = null;

        applySchedule(result.schedule);
        xlsxNameDisplay.innerHTML = `✅ <strong>${escapeHtml(file.name)}</strong> cargado. Puedes subir otro para reemplazarlo.`;
        const firstName = result.name.split(/\s+/)[0] || '';
        showToast(`✅ Malla cargada${firstName ? ` para ${firstName}` : ''}`);
        scheduleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        console.error('Error leyendo el Excel:', err);
        xlsxNameDisplay.innerHTML = 'Arrastra aquí el archivo <span>.xlsx</span> o haz clic para elegirlo';
        alert('No pude leer el archivo. Verifica que sea un Excel válido.');
    }
}

// --- Funciones de Sincronización en la Nube ---

// --- Sincronización en la nube (Supabase) ---
// La fila se identifica con un hash de cédula + PIN: en la nube no queda la cédula
// y nadie puede leer tu malla sabiendo solo tu cédula.

let cloudId = '';
let cloudChannel = null;

function setSyncStatus(text, color) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = color || 'var(--text-muted)';
}

async function computeCloudId() {
    if (!currentUserId || currentPin.length < 4) return '';
    const bytes = new TextEncoder().encode(`mallero:${currentUserId}:${currentPin}`);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function localUpdatedAt() {
    return Number(localStorage.getItem('mallero_updated_at') || 0);
}

function markLocalChange() {
    localStorage.setItem('mallero_updated_at', String(Date.now()));
}

// Aplica lo que llegó de la nube (malla y ajustes de alarmas)
function applyCloudContent(content) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        return false;
    }
    // Formato antiguo: solo la lista de días
    const schedule = Array.isArray(parsed) ? parsed : parsed.schedule;
    const updatedAt = Array.isArray(parsed) ? 0 : Number(parsed.updatedAt || 0);
    if (updatedAt && updatedAt <= localUpdatedAt()) return false;

    if (parsed.settings) {
        localStorage.setItem('mallero_alarm_settings', JSON.stringify(parsed.settings));
        refreshAlarmSettingsUI();
    }
    if (Array.isArray(schedule) && schedule.length && isFromCurrentWeek(schedule)) {
        scheduleData = schedule;
        localStorage.setItem('mallero_data', JSON.stringify(scheduleData));
        renderSchedule();
    }
    localStorage.setItem('mallero_updated_at', String(updatedAt || Date.now()));
    renderUpcomingAlarms();
    return true;
}

async function connectCloud(announce) {
    if (!supabase) return;
    const id = await computeCloudId();
    if (!id) {
        setSyncStatus('Escribe tu cédula y un PIN para sincronizar la web y la app.');
        return;
    }
    cloudId = id;
    await fetchCloudData(announce);
    subscribeToChanges();
}

async function fetchCloudData(announce = false) {
    if (!supabase || !cloudId) return;
    try {
        setSyncStatus('🔄 Sincronizando…');
        const { data, error } = await supabase
            .from('malla_data')
            .select('content')
            .eq('id', cloudId)
            .maybeSingle();
        if (error) throw error;

        if (data && data.content && applyCloudContent(data.content)) {
            if (announce) showToast('☁️ Datos sincronizados');
        } else if (scheduleData.length) {
            // Lo de este dispositivo es más nuevo (o la nube está vacía): se sube
            await syncCloudData();
        }
        setSyncStatus('☁️ Sincronizado: la web y la app comparten tu malla y tus ajustes.', '#10b981');
    } catch (err) {
        console.error('Error al descargar datos de la nube:', err);
        setSyncStatus('⚠️ Sin conexión con la nube: se usan los datos guardados en este dispositivo.', '#f59e0b');
    }
}

async function syncCloudData() {
    if (!supabase) return;
    // La cédula puede cambiar al cargar un Excel: se recalcula la fila
    const id = await computeCloudId();
    if (!id) return;
    if (id !== cloudId) {
        cloudId = id;
        subscribeToChanges();
    }
    if (!localUpdatedAt()) markLocalChange();
    try {
        const { error } = await supabase
            .from('malla_data')
            .upsert({
                id: cloudId,
                content: JSON.stringify({ schedule: scheduleData, settings: getAlarmSettings(), updatedAt: localUpdatedAt() }),
                updated_at: new Date().toISOString()
            });
        if (error) throw error;
        setSyncStatus('☁️ Sincronizado: la web y la app comparten tu malla y tus ajustes.', '#10b981');
    } catch (err) {
        console.error('Error al sincronizar con la nube:', err);
        setSyncStatus('⚠️ No se pudo subir a la nube. Se reintentará con el próximo cambio.', '#f59e0b');
    }
}

function subscribeToChanges() {
    if (!supabase || !cloudId) return;
    if (cloudChannel) supabase.removeChannel(cloudChannel);

    // Solo se escuchan los cambios de tu propia fila
    cloudChannel = supabase
        .channel(`malla_${cloudId.slice(0, 16)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'malla_data', filter: `id=eq.${cloudId}` }, (payload) => {
            if (payload.new && payload.new.content && applyCloudContent(payload.new.content)) {
                showToast('☁️ Cambios recibidos de tu otro dispositivo');
            }
        })
        .subscribe();
}

function updateClock() {
    const now = new Date();
    updateCurrentDate(now);
    updateCountdown(now);

    // Cada minuto (y al cambiar de día) se recalculan estados y el resaltado de "hoy"
    const minuteKey = `${formatDate(now)} ${formatHM(now)}`;
    if (minuteKey !== lastRefreshMinute) refreshView();
}

function updateCurrentDate(now) {
    const dateText = now.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeText = now.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true });
    document.getElementById('current-date').textContent =
        `📅 ${dateText.charAt(0).toUpperCase()}${dateText.slice(1)} · ${timeText}`;
}

function refreshView() {
    const now = new Date();
    lastRefreshMinute = `${formatDate(now)} ${formatHM(now)}`;

    // No interrumpir si el usuario está editando una celda
    if (document.activeElement && document.activeElement.classList.contains('editable')) return;

    // Releer lo guardado: puede haber cambiado en otra pestaña o haber vencido la semana
    let saved = [];
    try {
        saved = JSON.parse(localStorage.getItem('mallero_data') || '[]');
    } catch (e) {}

    if (saved.length > 0 && !isFromCurrentWeek(saved)) {
        console.log('Datos expirados (semana anterior). Limpiando...');
        clearData();
        return;
    }

    if (saved.length > 0) {
        scheduleData = saved;
        renderSchedule();
    } else if (scheduleData.length > 0) {
        clearData();
    }

    updateCountdown(now);
}

function updateCountdown(now) {
    const countdownDisplay = document.getElementById('countdown-display');
    if (!scheduleData || scheduleData.length === 0) {
        countdownDisplay.textContent = 'Sube tu malla para ver la cuenta regresiva';
        return;
    }

    // Próximo evento de la malla (entrada, almuerzo, break o salida) según su fecha real
    const nextEvent = buildEvents().find((ev) => ev.type !== 'noche' && ev.date > now);

    if (nextEvent) {
        const totalSeconds = Math.floor((nextEvent.date - now) / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const timeStr = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
        countdownDisplay.innerHTML = `${escapeHtml(nextEvent.title)} en: <span style="color: var(--accent-light); font-weight: bold;">${timeStr}</span>`;
    } else {
        countdownDisplay.textContent = 'No hay turnos próximos programados';
    }
}

// --- Manejo de Imagenes ---

async function prepareUpload(file) {
    selectedFile = file;
    fileNameDisplay.innerHTML = `Imagen detectada: <strong>${escapeHtml(file.name || 'image.png')}</strong>`;
    uploadActions.style.display = 'block';
    progressBar.style.width = '0%';
    // NO auto-procesamos. El usuario debe hacer clic en "Procesar Imagen".
}

async function handleUpload() {
    if (!selectedFile) return;

    const myId = ++currentProcessingId; // ID único para este proceso
    processBtn.disabled = true;
    processBtn.textContent = 'Procesando...';

    try {
        console.log('Paso 1: Optimizando imagen (Alta Resolución)...');
        const optimizedBlob = await resizeImage(selectedFile, 2500);

        // Si el usuario ya procesó texto mientras tanto, cancelar silenciosamente
        if (myId !== currentProcessingId) return;

        console.log('Paso 2: Escaneando...');
        await processImage(optimizedBlob);
    } catch (err) {
        // Solo mostrar error si este proceso no fue cancelado por otra opción
        if (myId === currentProcessingId) {
            console.error('Fallo en el proceso:', err);
            alert('Hubo un error al procesar la imagen.');
        }
    } finally {
        if (myId === currentProcessingId) {
            processBtn.disabled = false;
            processBtn.textContent = 'Procesar Imagen';
        }
    }
}

function resizeImage(file, maxWidth) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                let scale = 1;
                if (height < 300) {
                    scale = 2.5;
                }

                let targetWidth = width * scale;
                let targetHeight = height * scale;

                if (targetWidth > maxWidth) {
                    targetHeight = (maxWidth / targetWidth) * targetHeight;
                    targetWidth = maxWidth;
                }

                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                // Sin filtros CSS. Tesseract usa Otsu thresholding internamente.
                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function processImage(imageBlob) {
    const ocrStatus = document.getElementById('ocr-status');
    const ocrProgress = document.getElementById('ocr-progress');
    ocrStatus.style.display = 'block';
    ocrProgress.innerText = 'Cargando motor de inteligencia...';

    const timeout = setTimeout(() => {
        alert('El escaneo está tardando. Intenta con una captura más cercana de los horarios.');
    }, 30000);

    try {
        // @ts-ignore - Usar español y ingles para mejor reconocimiento
        const result = await Tesseract.recognize(
            imageBlob,
            'spa',
            {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const pct = Math.round(m.progress * 100);
                        ocrProgress.innerText = `Analizando malla: ${pct}%`;
                        progressBar.style.width = `${pct}%`;
                    }
                }
            }
        );

        clearTimeout(timeout);
        const text = result.data.text;

        // Log para depuración interna
        console.log('LECTURA CRUDA:', text);

        if (!text || text.trim().length < 10) {
            alert('El lector no pudo extraer texto. Intenta tomar una captura más clara.');
        }

        parseOCRText(text);
        ocrStatus.style.display = 'none';
    } catch (error) {
        clearTimeout(timeout);
        console.error('Error crítico OCR:', error);
        alert('Error al conectar con el motor de lectura. Revisa tu conexión.');
        ocrStatus.style.display = 'none';
    }
}

function parseOCRText(text) {
    // 1. Extraer Fechas primero para que no confundan al lector de horas
    const dateRegex = /\d{1,2}\s*[\/\-]\s*\d{1,2}\s*[\/\-]\s*\d{2,4}/g;
    const allDates = text.match(dateRegex) || [];

    let cleanText = text.replace(dateRegex, ' [FECHA] ');

    // Eliminar fechas mal leídas por el OCR (ej. a/05/2026) y años sueltos
    cleanText = cleanText.replace(/[a-zA-Z]?\/\d{2}\/\d{4}/g, ' ');
    cleanText = cleanText.replace(/\b202\d\b/g, ' ');

    // Limpieza de basura del OCR
    cleanText = cleanText.replace(/[\[\]\|\)\(“]/g, ' ');

    // Arreglar errores comunes del OCR para esta fuente
    cleanText = cleanText.replace(/\bs00\b/g, '8:00');
    cleanText = cleanText.replace(/1580/g, '15:30');
    cleanText = cleanText.replace(/1320/g, '13:30');
    cleanText = cleanText.replace(/\b75\b/g, '7:45'); // A veces 7:45 se lee como 75
    cleanText = cleanText.replace(/20\.0\)?/g, '20:00'); // Truncado
    cleanText = cleanText.replace(/10:5\)?/g, '10:45'); // Truncado
    cleanText = cleanText.replace(/12:0\)?/g, '12:30'); // Truncado

    // 2. Extraer Horarios. Quitamos los \b para que atrape números pegados como "123014301500" -> 12:30, 14:30, 15:00
    const timeRegex = /(\d{1,2})[:\.,]?(\d{2})/g;

    let allTimes = [];
    let match;
    while ((match = timeRegex.exec(cleanText)) !== null) {
        let h = parseInt(match[1]);
        let m = match[2];
        // Validar que sea una hora real (h < 24, m < 60)
        if (h < 24 && parseInt(m) < 60) {
            allTimes.push(`${h}:${m}`);
        }
    }

    console.log('Fechas extraídas:', allDates);
    console.log('Horarios limpios:', allTimes);

    // Si no se encontraron fechas (texto pegado sin fechas), generamos la semana actual
    if (allDates.length === 0) {
        const today = new Date();
        const dow = today.getDay(); // 0=Dom, 1=Lun...
        const monday = new Date(today);
        monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            allDates.push(formatDate(d));
        }
        console.log('Fechas generadas para semana actual:', allDates);
    }

    // 3. Mapeo inteligente para Malla Horizontal
    // Tu imagen tiene 7 columnas. El Sábado está vacío.
    // Lunes a Viernes (5 días * 4 = 20 tiempos)
    // Sábado (0 tiempos)
    // Domingo (4 tiempos)
    // Breaks (aprox 6-7 tiempos al final)

    const parsed = DAY_NAMES.map((dayName, index) => {
        let fecha = allDates[index] || '---';

        let dIni = 'Descanso', dFin = 'Libre', dIniInter = '---', dFinInter = '---', dBreak = '---';
        let mainTimes = [];

        if (index < 5) {
            mainTimes = allTimes.slice(index * 4, (index * 4) + 4);
        } else if (index === 6) {
            mainTimes = allTimes.slice(20, 24);
        }

        if (mainTimes.length >= 2) {
            dIni = mainTimes[0];
            dFin = mainTimes[mainTimes.length - 1];
            dIniInter = mainTimes[1] || '---';
            dFinInter = mainTimes[2] || '---';

            // Los breaks están al final. Si Sabado es vacío, Domingo es el index 29 (24 + 5)
            let breakIndex = index < 5 ? 24 + index : (index === 6 ? 29 : -1);
            dBreak = breakIndex !== -1 ? (allTimes[breakIndex] || '---') : '---';
        }

        return { fecha, dia: dayName, ini: dIni, fin: dFin, iniInter: dIniInter, finInter: dFinInter, break: dBreak };
    });

    applySchedule(parsed);
}

// --- Renderizado ---

function renderSchedule() {
    scheduleBody.innerHTML = '';
    scheduleContainer.style.display = 'block';
    // Las alarmas solo existen en la app Android; la web solo muestra la malla
    alarmSection.style.display = nativeAlarm ? 'block' : 'none';

    const now = new Date();
    let closestShiftIndex = -1;
    let minDiff = Infinity;

    // Encontrar el próximo turno más cercano
    scheduleData.forEach((row, index) => {
        const day = parseDateStr(row.fecha);
        const startMins = parseHM(row.ini);
        if (!day || startMins === null) return;
        const start = new Date(day);
        start.setHours(0, startMins, 0, 0);
        if (start > now && start - now < minDiff) {
            minDiff = start - now;
            closestShiftIndex = index;
        }
    });

    const todayStr = formatDate(now);

    scheduleData.forEach((row, index) => {
        const tr = document.createElement('tr');
        const day = parseDateStr(row.fecha);

        // Resaltar fila del día actual (normalizando para que 6/5 == 06/05)
        if (day && formatDate(day) === todayStr) {
            tr.classList.add('row-today');
        }

        let status = 'Siguiente turno';
        let badgeClass = 'status-badge upcoming';

        const startMins = parseHM(row.ini);
        const endMins = parseHM(row.fin);

        if (startMins === null) {
            status = 'Libre';
            badgeClass = 'status-badge free';
        } else if (day && endMins !== null) {
            const start = new Date(day);
            start.setHours(0, startMins, 0, 0);
            const end = new Date(day);
            end.setHours(0, endMins, 0, 0);
            if (end < start) end.setDate(end.getDate() + 1);

            if (now > end) {
                status = 'Terminado';
                badgeClass = 'status-badge completed';
            } else if (now >= start && now <= end) {
                status = 'Trabajando';
                badgeClass = 'status-badge active';
            } else if (index === closestShiftIndex) {
                status = 'Próximo turno';
                badgeClass = 'status-badge next-closest';
            }
        } else {
            status = 'Revisar';
        }

        tr.innerHTML = `
            <td>${escapeHtml(row.fecha)}</td>
            <td>${escapeHtml(row.dia)}</td>
            <td contenteditable="true" class="editable">${escapeHtml(row.ini)}</td>
            <td contenteditable="true" class="editable">${escapeHtml(row.fin)}</td>
            <td contenteditable="true" class="editable">${escapeHtml(row.iniInter)}</td>
            <td contenteditable="true" class="editable">${escapeHtml(row.finInter)}</td>
            <td contenteditable="true" class="editable">${escapeHtml(row.break)}</td>
            <td><span class="${badgeClass}">${status}</span></td>
        `;
        scheduleBody.appendChild(tr);
    });

    // Detectar cambios manuales en la tabla
    const editableCells = scheduleBody.querySelectorAll('.editable');
    editableCells.forEach(cell => {
        cell.addEventListener('input', () => {
            const saveBtn = document.getElementById('save-btn');
            if (saveBtn) saveBtn.style.display = 'inline-block';
        });

        // Auto-guardado al salir de la celda (blur)
        cell.addEventListener('blur', () => {
            saveData(false); // Guardado silencioso
        });
    });

    renderUpcomingAlarms();
}

function clearData() {
    localStorage.removeItem('mallero_data');
    scheduleData = [];
    selectedFile = null;
    scheduleContainer.style.display = 'none';
    alarmSection.style.display = 'none';
    fileNameDisplay.innerHTML = 'Arrastra o Pega (Ctrl+V) captura aquí';
    xlsxNameDisplay.innerHTML = 'Arrastra aquí el archivo <span>.xlsx</span> o haz clic para elegirlo';
    uploadActions.style.display = 'none';
    const excelPaste = document.getElementById('excel-paste');
    if (excelPaste) excelPaste.value = '';
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.style.display = 'none';
}

function showToast(msg) {
    const toast = document.getElementById('save-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// --- Eventos de la malla (base para alarmas, cuenta regresiva y calendario) ---

function buildEvents(data = scheduleData) {
    const events = [];

    data.forEach((row) => {
        const day = parseDateStr(row.fecha);
        if (!day) return;

        // Recordatorio a las 10:00 PM del día anterior (también avisa los días libres)
        const night = new Date(day);
        night.setDate(night.getDate() - 1);
        night.setHours(22, 0, 0, 0);
        events.push({ type: 'noche', icon: '🌙', title: 'Recordatorio de mañana', date: night, end: null, row });

        const start = parseHM(row.ini);
        if (start === null) return;

        // Horas menores a la entrada pertenecen al día siguiente (turnos que pasan la medianoche)
        const at = (mins) => {
            const d = new Date(day);
            d.setHours(0, mins < start ? mins + 1440 : mins, 0, 0);
            return d;
        };
        const add = (type, icon, title, mins, endMins = null) => {
            if (mins === null) return;
            events.push({ type, icon, title, date: at(mins), end: endMins !== null ? at(endMins) : null, row });
        };

        const end = parseHM(row.fin);
        const lunchStart = parseHM(row.iniInter);
        const lunchEnd = parseHM(row.finInter);
        const breaks = parseTimes(row.break);

        add('entrada', '🟢', 'Entrada al turno', start, end);
        add('almuerzo', '🍽️', 'Salida a almuerzo', lunchStart, lunchEnd);
        add('almuerzo', '↩️', 'Regreso de almuerzo', lunchEnd);
        breaks.forEach((b, i) => add('break', '☕', breaks.length > 1 ? `Break ${i + 1}` : 'Break', b, b + BREAK_MINUTES));
        add('salida', '🔴', 'Salida del turno', end);
    });

    return events.sort((a, b) => a.date - b.date);
}

function eventMessage(ev) {
    const { row } = ev;
    if (ev.type === 'noche') {
        const horario = isRestDay(row) ? 'Mañana tienes día libre 🛌' : `Mañana entras a las ${row.ini} hasta las ${row.fin}`;
        return `🔔 Mallero - Recordatorio de turno:\n${horario}\n📅 Día: ${row.dia} (${row.fecha})`;
    }
    return `🔔 Mallero - ${ev.title} a las ${formatHM(ev.date)}\n📅 ${row.dia} (${row.fecha}) · Turno ${row.ini} - ${row.fin}`;
}

// --- Configuración de alarmas ---

function getAlarmSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem('mallero_alarm_settings') || '{}');
        return {
            types: { ...DEFAULT_ALARM_SETTINGS.types, ...(saved.types || {}) },
            lead: Number.isFinite(saved.lead) ? saved.lead : DEFAULT_ALARM_SETTINGS.lead,
            wa: typeof saved.wa === 'string' ? saved.wa : DEFAULT_ALARM_SETTINGS.wa,
            challengeOn: { ...DEFAULT_ALARM_SETTINGS.challengeOn, ...(saved.challengeOn || {}) },
            challengeTypes: { ...DEFAULT_ALARM_SETTINGS.challengeTypes, ...(saved.challengeTypes || {}) },
            difficulty: ['easy', 'medium', 'hard'].includes(saved.difficulty) ? saved.difficulty : DEFAULT_ALARM_SETTINGS.difficulty,
            snoozeMinutes: Number.isFinite(saved.snoozeMinutes) ? saved.snoozeMinutes : DEFAULT_ALARM_SETTINGS.snoozeMinutes,
            snoozeMax: Number.isFinite(saved.snoozeMax) ? saved.snoozeMax : DEFAULT_ALARM_SETTINGS.snoozeMax
        };
    } catch (e) {
        return structuredClone(DEFAULT_ALARM_SETTINGS);
    }
}

let settingsSyncTimer = null;
function saveAlarmSettings(settings) {
    localStorage.setItem('mallero_alarm_settings', JSON.stringify(settings));
    markLocalChange();
    clearTimeout(settingsSyncTimer);
    settingsSyncTimer = setTimeout(syncCloudData, 800);
}

// Refleja en los controles los ajustes que llegaron de otro dispositivo
function refreshAlarmSettingsUI() {
    const settings = getAlarmSettings();
    document.querySelectorAll('[data-alarm]').forEach((c) => { c.checked = !!settings.types[c.dataset.alarm]; });
    document.querySelectorAll('[data-challenge-on]').forEach((c) => { c.checked = !!settings.challengeOn[c.dataset.challengeOn]; });
    document.querySelectorAll('[data-challenge-type]').forEach((c) => { c.checked = !!settings.challengeTypes[c.dataset.challengeType]; });
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
    set('alarm-lead', settings.lead);
    set('wa-number', settings.wa);
    set('challenge-difficulty', settings.difficulty);
    set('snooze-minutes', settings.snoozeMinutes);
    set('snooze-max', settings.snoozeMax);
    updateSnoozeVisibility();
}

function initAlarmSettings() {
    const settings = getAlarmSettings();

    document.querySelectorAll('[data-alarm]').forEach((checkbox) => {
        checkbox.checked = !!settings.types[checkbox.dataset.alarm];
        checkbox.addEventListener('change', () => {
            const current = getAlarmSettings();
            current.types[checkbox.dataset.alarm] = checkbox.checked;
            saveAlarmSettings(current);
            renderUpcomingAlarms();
        });
    });

    const leadSelect = document.getElementById('alarm-lead');
    leadSelect.value = String(settings.lead);
    leadSelect.addEventListener('change', () => {
        const current = getAlarmSettings();
        current.lead = Number(leadSelect.value);
        saveAlarmSettings(current);
        renderUpcomingAlarms();
    });

    // Ajustes de retos y posponer
    const bindCheckboxes = (selector, attr, key) => {
        document.querySelectorAll(selector).forEach((checkbox) => {
            checkbox.checked = !!settings[key][checkbox.dataset[attr]];
            checkbox.addEventListener('change', () => {
                const current = getAlarmSettings();
                current[key][checkbox.dataset[attr]] = checkbox.checked;
                // Siempre debe quedar al menos un tipo de reto
                if (key === 'challengeTypes' && !Object.values(current.challengeTypes).some(Boolean)) {
                    checkbox.checked = true;
                    current.challengeTypes[checkbox.dataset[attr]] = true;
                    showToast('Deja al menos un tipo de reto activo');
                }
                saveAlarmSettings(current);
                renderUpcomingAlarms();
            });
        });
    };
    bindCheckboxes('[data-challenge-on]', 'challengeOn', 'challengeOn');
    bindCheckboxes('[data-challenge-type]', 'challengeType', 'challengeTypes');

    const bindSelect = (id, key, toValue) => {
        const select = document.getElementById(id);
        select.value = String(settings[key]);
        select.addEventListener('change', () => {
            const current = getAlarmSettings();
            current[key] = toValue(select.value);
            saveAlarmSettings(current);
            updateSnoozeVisibility();
            renderUpcomingAlarms();
        });
    };
    bindSelect('challenge-difficulty', 'difficulty', (v) => v);
    bindSelect('snooze-minutes', 'snoozeMinutes', Number);
    bindSelect('snooze-max', 'snoozeMax', Number);
    updateSnoozeVisibility();

    document.getElementById('test-alarm-btn').addEventListener('click', testAlarm);

    const waInput = document.getElementById('wa-number');
    waInput.value = settings.wa;
    waInput.addEventListener('change', () => {
        const current = getAlarmSettings();
        current.wa = waInput.value.replace(/\D/g, '');
        waInput.value = current.wa;
        saveAlarmSettings(current);
    });

    document.getElementById('enable-alarms-btn').addEventListener('click', enableAlarms);
    document.getElementById('export-ics-btn').addEventListener('click', exportICS);
    updatePermissionStatus();
}

function updateSnoozeVisibility() {
    const wrap = document.getElementById('snooze-max-wrap');
    if (wrap) wrap.style.display = getAlarmSettings().snoozeMinutes > 0 ? '' : 'none';
}

async function enableAlarms() {
    if (nativeAlarm) {
        try {
            const { asked } = await nativeAlarm.askPermissions();
            const steps = { notifications: 'Permite las notificaciones', exactAlarms: 'Activa "Alarmas y recordatorios"', fullScreen: 'Activa "Notificaciones de pantalla completa"', battery: 'Permite que Mallero funcione sin restricción de batería' };
            showToast(asked === 'none' ? '✅ Todo listo' : `${steps[asked]} y vuelve a pulsar "Activar alarmas"`);
        } catch (e) {
            console.warn('Permisos de alarma', e);
        }
        lastNativeSync = '';
        await syncNativeAlarms();
        updatePermissionStatus();
        return;
    }
    unlockAudio();
    if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }
    playBeep();
    updatePermissionStatus();
}

async function updatePermissionStatus() {
    const status = document.getElementById('alarm-permission-status');
    if (nativeAlarm) {
        try {
            const p = await nativeAlarm.getStatus();
            const missing = [];
            if (!p.notifications) missing.push('notificaciones');
            if (!p.exactAlarms) missing.push('alarmas exactas');
            if (!p.fullScreen) missing.push('pantalla completa');
            if (!p.batteryUnrestricted) missing.push('batería sin restricción');
            if (missing.length === 0) {
                status.textContent = '✅ Alarmas del sistema activas: suenan aunque cierres la app.';
                status.style.color = '#10b981';
            } else {
                status.textContent = `⚠️ Falta permitir: ${missing.join(', ')}. Pulsa "Activar alarmas".`;
                status.style.color = '#f59e0b';
            }
        } catch (e) {
            status.textContent = 'No se pudo comprobar los permisos de alarma.';
        }
        return;
    }
    if (!('Notification' in window)) {
        status.textContent = 'Tu navegador no soporta notificaciones: las alarmas se mostrarán en la página con sonido.';
    } else if (Notification.permission === 'granted') {
        status.textContent = '✅ Alarmas activas mientras esta pestaña esté abierta.';
        status.style.color = '#10b981';
    } else if (Notification.permission === 'denied') {
        status.textContent = '⚠️ Bloqueaste las notificaciones. Actívalas en la configuración del sitio de tu navegador.';
    } else {
        status.textContent = 'Pulsa "Activar alarmas" para permitir notificaciones y sonido.';
    }
}

function renderUpcomingAlarms() {
    syncNativeAlarms();
    const list = document.getElementById('upcoming-alarms');
    if (!list) return;

    const settings = getAlarmSettings();
    const now = new Date();
    const upcoming = buildEvents()
        .filter((ev) => settings.types[ev.type])
        .map((ev) => ({ ev, alarmAt: alarmTime(ev, settings) }))
        .filter(({ alarmAt }) => alarmAt > now)
        .slice(0, 6);

    if (upcoming.length === 0) {
        list.innerHTML = '<li><span>No hay alarmas próximas.</span><span></span></li>';
        return;
    }

    list.innerHTML = upcoming.map(({ ev, alarmAt }) => `
        <li>
            <span>${ev.icon} ${escapeHtml(ev.title)} · ${escapeHtml(ev.row.dia)} ${formatHM(ev.date)}</span>
            <span>suena ${escapeHtml(ev.row.fecha === formatDate(alarmAt) ? '' : formatDate(alarmAt).slice(0, 5) + ' ')}${formatHM(alarmAt)}</span>
        </li>
    `).join('');
}

function alarmTime(ev, settings) {
    const lead = ev.type === 'noche' ? 0 : settings.lead;
    return new Date(ev.date.getTime() - lead * 60000);
}

// --- Alarmas nativas (Android) ---

function challengeTypesList(settings) {
    const types = Object.keys(settings.challengeTypes).filter((t) => settings.challengeTypes[t]);
    return types.length ? types : ['math'];
}

function alarmTitleFor(ev, settings) {
    const lead = ev.type === 'noche' ? 0 : settings.lead;
    return ev.type === 'noche' ? '🌙 Recordatorio de mañana' : `${ev.icon} ${ev.title}${lead > 0 ? ` en ${lead} min` : ''}`;
}

// Entrega al sistema Android la lista completa de alarmas futuras.
// Solo se envía cuando algo cambió (malla o ajustes).
async function syncNativeAlarms() {
    if (!nativeAlarm) return;
    const settings = getAlarmSettings();
    const now = Date.now();
    const alarms = buildEvents()
        .filter((ev) => settings.types[ev.type])
        .map((ev) => ({ ev, at: alarmTime(ev, settings).getTime() }))
        .filter(({ at }) => at > now)
        .slice(0, 100)
        .map(({ ev, at }) => ({
            key: `${ev.type}|${ev.title}|${ev.date.getTime()}`,
            at,
            title: alarmTitleFor(ev, settings),
            body: eventMessage(ev).split('\n').slice(1).join('\n'),
            challenge: !!settings.challengeOn[ev.type]
        }));
    const payload = {
        alarms,
        challengeTypes: challengeTypesList(settings),
        difficulty: settings.difficulty,
        snoozeMinutes: settings.snoozeMinutes,
        snoozeMax: settings.snoozeMax
    };
    const signature = JSON.stringify(payload);
    if (signature === lastNativeSync) return;
    lastNativeSync = signature;
    try {
        await nativeAlarm.schedule(payload);
    } catch (e) {
        lastNativeSync = '';
        console.error('No se pudieron programar las alarmas nativas', e);
    }
}

// --- Reto en la web (pantalla completa sobre la página) ---

let webChallenge = null;

function openChallenge({ title, body, challenge, snoozesLeft }, onSnooze) {
    // Los retos para apagar la alarma solo existen en la app Android
    if (!nativeAlarm) return;
    closeChallenge();
    const settings = getAlarmSettings();
    const params = new URLSearchParams({
        title,
        body,
        types: challengeTypesList(settings).join(','),
        diff: settings.difficulty,
        ch: challenge ? '1' : '0',
        snooze: String(settings.snoozeMinutes),
        left: String(snoozesLeft)
    });
    const overlay = document.createElement('div');
    overlay.className = 'challenge-overlay';
    overlay.innerHTML = `<iframe src="challenge.html?${params}" title="Alarma" allow="accelerometer"></iframe>`;
    document.body.appendChild(overlay);

    // Suena en bucle hasta superar el reto
    playBeep();
    const loop = setInterval(() => {
        playBeep();
        if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
    }, 2500);

    const onMessage = (e) => {
        if (!e.data || !e.data.mallero || e.source !== overlay.querySelector('iframe').contentWindow) return;
        const action = e.data.mallero;
        closeChallenge();
        if (action === 'snooze' && onSnooze) onSnooze();
    };
    window.addEventListener('message', onMessage);
    webChallenge = { overlay, loop, onMessage };
}

function closeChallenge() {
    if (!webChallenge) return;
    clearInterval(webChallenge.loop);
    window.removeEventListener('message', webChallenge.onMessage);
    webChallenge.overlay.remove();
    webChallenge = null;
}

function webAlarmWithChallenge(title, body, challenge, snoozesLeft) {
    const settings = getAlarmSettings();
    openChallenge({ title, body, challenge, snoozesLeft }, () => {
        showToast(`Pospuesta ${settings.snoozeMinutes} min`);
        setTimeout(() => webAlarmWithChallenge(title, body, challenge, snoozesLeft - 1), settings.snoozeMinutes * 60000);
    });
}

async function testAlarm() {
    const settings = getAlarmSettings();
    if (nativeAlarm) {
        try {
            await nativeAlarm.test({
                title: '⏰ Alarma de prueba',
                body: 'Así sonarán tus alarmas de turno',
                challenge: true,
                challengeTypes: challengeTypesList(settings),
                difficulty: settings.difficulty,
                snoozeMinutes: settings.snoozeMinutes,
                snoozeMax: settings.snoozeMax
            });
            showToast('La alarma de prueba sonará en 10 segundos. Puedes bloquear el teléfono.');
        } catch (e) {
            showToast('No se pudo programar la prueba: revisa los permisos');
        }
        return;
    }
    unlockAudio();
    webAlarmWithChallenge('⏰ Alarma de prueba', 'Así sonarán tus alarmas de turno', true, settings.snoozeMax);
}

// --- Sistema de Alarmas ---

function checkAlarms() {
    if (scheduleData.length === 0) return;
    // En la app Android suenan las alarmas del sistema; aquí solo se refresca la lista
    if (nativeAlarm) {
        renderUpcomingAlarms();
        return;
    }

    const settings = getAlarmSettings();
    const now = Date.now();
    let fired = {};
    try {
        fired = JSON.parse(localStorage.getItem('mallero_fired_alarms') || '{}');
    } catch (e) {}

    buildEvents().forEach((ev) => {
        if (!settings.types[ev.type]) return;
        const alarmAt = alarmTime(ev, settings).getTime();
        const key = `${ev.type}|${ev.title}|${ev.date.getTime()}`;
        // Disparar una sola vez, aunque la página se recargue
        if (now >= alarmAt && now - alarmAt < ALARM_GRACE_MS && !fired[key]) {
            fired[key] = now;
            triggerAlarm(ev, settings);
        }
    });

    // Olvidar alarmas de hace más de 2 días
    Object.keys(fired).forEach((key) => {
        if (now - fired[key] > 2 * 24 * 60 * 60 * 1000) delete fired[key];
    });
    localStorage.setItem('mallero_fired_alarms', JSON.stringify(fired));

    renderUpcomingAlarms();
}

function triggerAlarm(ev, settings) {
    const lead = ev.type === 'noche' ? 0 : settings.lead;
    const msgText = eventMessage(ev);

    alarmTitle.textContent = ev.type === 'noche'
        ? 'Recordatorio de Mañana'
        : `${ev.icon} ${ev.title}${lead > 0 ? ` en ${lead} min` : ''}`;
    alarmDesc.textContent = msgText;
    alarmToast.style.display = 'block';

    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`Mallero: ${ev.title}`, {
            body: msgText.split('\n').slice(1).join('\n'),
            icon: 'favicon.png',
            tag: `mallero-${ev.type}-${ev.date.getTime()}`,
            requireInteraction: true
        });
    }

    if (settings.challengeOn[ev.type]) {
        webAlarmWithChallenge(alarmTitleFor(ev, settings), msgText.split('\n').slice(1).join('\n'), true, settings.snoozeMax);
        return;
    }

    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    playBeep();
}

function unlockAudio() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
}

// Tres pitidos generados en el navegador (no depende de archivos externos)
function playBeep() {
    try {
        unlockAudio();
        if (!audioCtx) return;
        const t0 = audioCtx.currentTime;
        for (let i = 0; i < 3; i++) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            const start = t0 + i * 0.35;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(start);
            osc.stop(start + 0.3);
        }
    } catch (e) {}
}

// --- Exportación a calendario (.ics) ---

function exportICS() {
    const settings = getAlarmSettings();
    const events = buildEvents().filter((ev) => settings.types[ev.type]);
    if (events.length === 0) {
        alert('No hay eventos para exportar. Revisa que tu malla tenga horarios y alguna alarma activada.');
        return;
    }

    const toUTC = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}00Z`;
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    // Las líneas largas se dividen con salto + espacio (RFC 5545)
    const fold = (line) => {
        const chars = Array.from(line);
        const parts = [];
        for (let i = 0; i < chars.length; i += 60) parts.push(chars.slice(i, i + 60).join(''));
        return parts.join('\r\n ');
    };
    const stamp = toUTC(new Date());

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Mallero//Malla de turnos//ES',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Mallero'
    ];

    events.forEach((ev) => {
        const end = ev.end && ev.end > ev.date ? ev.end : new Date(ev.date.getTime() + 5 * 60000);
        const lead = ev.type === 'noche' ? 0 : settings.lead;
        const slug = normalizeText(ev.title).replace(/[^a-z0-9]+/g, '-');
        lines.push(
            'BEGIN:VEVENT',
            `UID:mallero-${slug}-${toUTC(ev.date)}@mallero`,
            `DTSTAMP:${stamp}`,
            `DTSTART:${toUTC(ev.date)}`,
            `DTEND:${toUTC(end)}`,
            `SUMMARY:${esc(`${ev.icon} ${ev.title}`)}`,
            `DESCRIPTION:${esc(eventMessage(ev))}`,
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            `DESCRIPTION:${esc(ev.title)}`,
            `TRIGGER:-PT${lead}M`,
            'END:VALARM',
            'END:VEVENT'
        );
    });
    lines.push('END:VCALENDAR');

    const blob = new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    const dates = scheduleData.map((r) => r.fecha).filter((f) => parseDateStr(f));
    const range = dates.length ? `${dates[0]}_${dates[dates.length - 1]}`.replace(/\//g, '-') : 'semana';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `mallero-${range}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast(`📆 ${events.length} eventos exportados`);
}


init();
