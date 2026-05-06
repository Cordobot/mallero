// Estado global
let scheduleData = [];
let selectedFile = null;
let activeAlarms = new Set();
let currentProcessingId = 0; // Cancela procesos de imagen si el usuario usa Opción 2

// Elementos DOM
const clockElement = document.getElementById('digital-clock');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('excel-upload');
const fileNameDisplay = document.getElementById('file-name-display');
const uploadActions = document.getElementById('upload-actions');
const progressBar = document.getElementById('upload-progress');
const processBtn = document.getElementById('process-btn');
const scheduleContainer = document.getElementById('schedule-container');
const scheduleBody = document.getElementById('schedule-body');
const clearBtn = document.getElementById('clear-data');
const alarmToast = document.getElementById('alarm-notification');
const alarmTitle = document.getElementById('alarm-title');
const alarmDesc = document.getElementById('alarm-desc');
const closeAlarmBtn = document.getElementById('close-alarm');

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
    setInterval(checkAlarms, 30000); 

    console.log('Aplicación lista. Esperando imagen...');
    
    // Eventos
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

    // WhatsApp button
    const waBtn = document.getElementById('wa-btn');
    if (waBtn) {
        waBtn.addEventListener('click', () => {
            const msg = encodeURIComponent(alarmDesc.textContent);
            window.open(`https://wa.me/573238087188?text=${msg}`, '_blank');
        });
    }

    // Guardar ediciones manuales
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const rows = scheduleBody.querySelectorAll('tr');
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
            localStorage.setItem('mallero_data', JSON.stringify(scheduleData));
            saveBtn.style.display = 'none';
            showToast('✅ Cambios guardados correctamente');
            renderSchedule();
        });
    }

    const savedData = localStorage.getItem('mallero_data');
    if (savedData) {
        scheduleData = JSON.parse(savedData);
        renderSchedule();
    }

    if ("Notification" in window) {
        Notification.requestPermission();
    }
}

function updateClock() {
    const now = new Date();
    updateCountdown(now);
}

function updateCountdown(now) {
    const countdownDisplay = document.getElementById('countdown-display');
    if (!scheduleData || scheduleData.length === 0) {
        countdownDisplay.textContent = 'Sube tu malla para ver la cuenta regresiva';
        return;
    }

    // Buscamos el próximo turno
    const todayIdx = (now.getDay() + 6) % 7; // 0=Lun, 6=Dom
    let targetShift = null;
    let daysDiff = 0;

    // Buscar a partir de hoy (por si aún no ha empezado el turno de hoy)
    for (let i = 0; i < 7; i++) {
        const checkIdx = (todayIdx + i) % 7;
        const shift = scheduleData[checkIdx];
        
        if (shift && shift.ini !== 'Descanso') {
            const [hours, minutes] = shift.ini.split(':').map(Number);
            const shiftDate = new Date(now);
            shiftDate.setDate(now.getDate() + i);
            shiftDate.setHours(hours, minutes, 0, 0);

            if (shiftDate > now) {
                targetShift = shiftDate;
                break;
            }
        }
    }

    if (targetShift) {
        const diff = targetShift - now;
        const totalSeconds = Math.floor(diff / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        countdownDisplay.innerHTML = `Próximo turno en: <span style="color: var(--accent-light); font-weight: bold;">${timeStr}</span>`;
    } else {
        countdownDisplay.textContent = 'No hay turnos próximos programados';
    }
}

// --- Manejo de Imagenes ---

async function prepareUpload(file) {
    selectedFile = file;
    fileNameDisplay.innerHTML = `Imagen detectada: <strong>${file.name || 'image.png'}</strong>`;
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
        // Solo mostrar error si este proceso no fue cancelado por Opción 2
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
        
        // Log para depuración interna y visual en pantalla
        console.log('LECTURA CRUDA:', text);
        const debugArea = document.getElementById('debug-text');
        if (debugArea) debugArea.value = text;
        
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
    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    
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
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            allDates.push(`${day}/${month}/${d.getFullYear()}`);
        }
        console.log('Fechas generadas para semana actual:', allDates);
    }

    // 3. Mapeo inteligente para Malla Horizontal
    // Tu imagen tiene 7 columnas. El Sábado está vacío.
    // Lunes a Viernes (5 días * 4 = 20 tiempos)
    // Sábado (0 tiempos)
    // Domingo (4 tiempos)
    // Breaks (aprox 6-7 tiempos al final)

    scheduleData = days.map((dayName, index) => {
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

    localStorage.setItem('mallero_data', JSON.stringify(scheduleData));
    renderSchedule();
}

// --- Renderizado ---

function renderSchedule() {
    scheduleBody.innerHTML = '';
    scheduleContainer.style.display = 'block';

    const now = new Date();
    let closestShiftIndex = -1;
    let minDiff = Infinity;
    
    // Encontrar el próximo turno más cercano
    scheduleData.forEach((row, index) => {
        if (row.ini !== 'Descanso' && row.fecha !== '---') {
            try {
                const [d, m, y] = row.fecha.split('/').map(Number);
                const [hIni, mIni] = row.ini.split(':').map(Number);
                const start = new Date(y, m - 1, d, hIni, mIni);
                if (start > now) {
                    const diff = start - now;
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestShiftIndex = index;
                    }
                }
            } catch(e) {}
        }
    });

    // Función para normalizar fechas (quitar ceros a la izquierda para comparar)
    const normalizeDate = (str) => {
        if (!str || str === '---') return '';
        return str.split('/').map(p => parseInt(p)).join('/');
    };

    const todayStr = normalizeDate(`${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`);

    scheduleData.forEach((row, index) => {
        const tr = document.createElement('tr');
        
        // Resaltar fila del día actual (normalizando ambos para que 6/5 == 06/05)
        if (normalizeDate(row.fecha) === todayStr) {
            tr.classList.add('row-today');
        }

        let status = 'Siguiente turno';
        let badgeClass = 'status-badge upcoming';

        if (row.ini === 'Descanso' || row.ini === '---' || !row.ini) {
            status = 'Libre';
            badgeClass = 'status-badge free';
        } else if (row.fecha !== '---') {
            try {
                const [d, m, y] = row.fecha.split('/').map(Number);
                const [hIni, mIni] = row.ini.split(':').map(Number);
                const [hFin, mFin] = row.fin.split(':').map(Number);

                const start = new Date(y, m - 1, d, hIni, mIni);
                const end = new Date(y, m - 1, d, hFin, mFin);
                if (end < start) end.setDate(end.getDate() + 1);

                if (now > end) {
                    status = 'Terminado';
                    badgeClass = 'status-badge completed';
                } else if (now >= start && now <= end) {
                    status = 'Trabajando';
                    badgeClass = 'status-badge active';
                } else {
                    if (index === closestShiftIndex) {
                        status = 'Próximo turno';
                        badgeClass = 'status-badge next-closest';
                    } else {
                        status = 'Siguiente turno';
                        badgeClass = 'status-badge upcoming';
                    }
                }
            } catch (e) {
                status = 'Error';
            }
        }

        tr.innerHTML = `
            <td>${row.fecha}</td>
            <td>${row.dia}</td>
            <td contenteditable="true" class="editable">${row.ini}</td>
            <td contenteditable="true" class="editable">${row.fin}</td>
            <td contenteditable="true" class="editable">${row.iniInter}</td>
            <td contenteditable="true" class="editable">${row.finInter}</td>
            <td contenteditable="true" class="editable">${row.break}</td>
            <td><span class="${badgeClass}">${status}</span></td>
        `;
        scheduleBody.appendChild(tr);
    });

    // Detectar cambios manuales en la tabla
    const editableCells = scheduleBody.querySelectorAll('.editable');
    editableCells.forEach(cell => {
        cell.addEventListener('input', () => {
            document.getElementById('save-btn').style.display = 'inline-block';
        });
    });
}

function clearData() {
    localStorage.removeItem('mallero_data');
    scheduleData = [];
    selectedFile = null;
    scheduleContainer.style.display = 'none';
    fileNameDisplay.innerHTML = 'Arrastra o Pega (Ctrl+V) captura aquí';
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

// --- Sistema de Alarmas (Recordatorio 10:00 PM del día anterior) ---

function checkAlarms() {
    if (scheduleData.length === 0) return;

    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();

    // Solo activar a las 10:00 PM (22:00)
    if (hours === 22 && minutes === 0) {
        // Obtenemos el índice de mañana (0=Lun, 6=Dom)
        const todayIdx = (now.getDay() + 6) % 7; 
        const tomorrowIdx = (todayIdx + 1) % 7;
        const tomorrowSchedule = scheduleData[tomorrowIdx];

        if (tomorrowSchedule) {
            const alarmKey = `reminder-${now.toDateString()}`;
            if (!activeAlarms.has(alarmKey)) {
                triggerNightlyAlarm(tomorrowSchedule);
                activeAlarms.add(alarmKey);
                setTimeout(() => activeAlarms.delete(alarmKey), 61000);
            }
        }
    }
}

function triggerNightlyAlarm(nextDayRow) {
    const dia = nextDayRow.dia;
    const horario = nextDayRow.ini === 'Descanso' ? 'Mañana tienes día libre 🛌' : `Mañana entras a las ${nextDayRow.ini} hasta las ${nextDayRow.fin}`;
    const msgText = `🔔 Mallero - Recordatorio de turno:\n${horario}\n📅 Día: ${dia} (${nextDayRow.fecha})`;
    
    alarmTitle.textContent = 'Recordatorio de Mañana';
    alarmDesc.textContent = msgText;
    alarmToast.style.display = 'block';

    // Enviar WhatsApp automáticamente a las 10pm
    const waUrl = `https://wa.me/573238087188?text=${encodeURIComponent(msgText)}`;
    window.open(waUrl, '_blank');

    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Mallero: Recordatorio de Turno", {
            body: horario,
        });
    }

    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.play().catch(() => {});
}


init();
