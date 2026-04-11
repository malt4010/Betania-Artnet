const socket = io();

// State management
let state = {
    config: { ip: '192.168.10.150', universe: 1, enabled: false },
    dimmers: {}, 
    frontMaster: 255,
    rgb: { r: 255, g: 255, b: 255, master: 0 }
};

const TOTAL_FIXTURES = 39;

function dmxToPercent(val) {
    return Math.round((val / 255) * 100);
}

function saveFrontStateLocally() {
    localStorage.setItem('artnetFrontlysUI', JSON.stringify({
        master: state.frontMaster,
        dimmers: state.dimmers
    }));
}

function saveRGBStateLocally() {
    localStorage.setItem('artnetRgbUI', JSON.stringify({
        master: state.rgb.master,
        r: state.rgb.r,
        g: state.rgb.g,
        b: state.rgb.b,
        store: rgbStore
    }));
}

// UI Elements
const statusDot = document.getElementById('status-indicator');
const controllerToggle = document.getElementById('controller-enable');
const toggleText = document.getElementById('toggle-text');
const dimmerGrid = document.getElementById('dimmer-grid');
const masterFadeInput = document.getElementById('master-fade-time');
const modalStatus = document.getElementById('modal-status');

// Modal Elements
const settingsModal = document.getElementById('settings-modal');
const modalBackdrop = document.getElementById('modal-backdrop');
const btnSettings = document.getElementById('btn-settings');
const btnCloseModal = document.getElementById('close-modal');
const ipInput = document.getElementById('node-ip');
const universeInput = document.getElementById('node-universe');
const saveBtn = document.getElementById('save-config');

// Initialize 10 Dimmers (19-28)
const frontMasterSlider = document.getElementById('front-master-dimmer');
const toggleSubmastersBtn = document.getElementById('toggle-submasters');
const dimmersExtendedPanel = document.getElementById('dimmers-extended-panel');
const toggleRgbBtn = document.getElementById('toggle-rgb-panel');
const rgbExtendedPanel = document.getElementById('rgb-extended-panel');
const btnRgbFullOn = document.getElementById('btn-rgb-full-on');
const btnRgbBlackout = document.getElementById('btn-rgb-blackout');

// Hide submasters by default
dimmersExtendedPanel.style.display = 'none';
rgbExtendedPanel.style.display = 'none';

toggleSubmastersBtn.addEventListener('click', () => {
    if (dimmersExtendedPanel.style.display === 'none') {
        dimmersExtendedPanel.style.display = 'block';
        toggleSubmastersBtn.textContent = 'SKJUL ALLE DIMMERS';
        toggleSubmastersBtn.style.color = '#fff';
        toggleSubmastersBtn.style.borderColor = 'rgba(255,255,255,0.5)';
    } else {
        dimmersExtendedPanel.style.display = 'none';
        toggleSubmastersBtn.textContent = 'VIS ALLE DIMMERS';
        toggleSubmastersBtn.style.color = '#808494';
        toggleSubmastersBtn.style.borderColor = '#333';
    }
});

toggleRgbBtn.addEventListener('click', () => {
    if (rgbExtendedPanel.style.display === 'none') {
        rgbExtendedPanel.style.display = 'block';
        toggleRgbBtn.textContent = 'SKJUL FARVEVALG';
        toggleRgbBtn.style.color = '#fff';
        toggleRgbBtn.style.borderColor = 'rgba(255,255,255,0.5)';
    } else {
        rgbExtendedPanel.style.display = 'none';
        toggleRgbBtn.textContent = 'VÆLG FARVE & OVERSTYRING';
        toggleRgbBtn.style.color = '#808494';
        toggleRgbBtn.style.borderColor = '#333';
    }
});

frontMasterSlider.addEventListener('input', (e) => {
    state.frontMaster = parseInt(e.target.value);
    e.target.nextElementSibling.textContent = dmxToPercent(state.frontMaster) + '%';

    if(state.frontMaster > 0) e.target.nextElementSibling.classList.add('active');
    else e.target.nextElementSibling.classList.remove('active');
    
    updateAllDimmers();
    saveFrontStateLocally();
    socket.emit('ui-sync', { type: 'frontMaster', value: state.frontMaster });
});

function initDimmers() {
    for (let ch = 19; ch <= 28; ch++) {
        state.dimmers[ch] = { value: 0 };
        
        const container = document.createElement('div');
        container.className = 'fader-container';
        if (ch === 23) container.style.marginRight = '4rem'; // Center Split Gap
        
        container.innerHTML = `
            <label>CH ${ch}</label>
            <input type="range" id="fader-${ch}" min="0" max="255" value="0">
            <span class="fader-value" id="val-${ch}">0</span>
            <button class="btn-toggle-channel" id="flash-${ch}">FLASH</button>
        `;
        dimmerGrid.appendChild(container);

        const fader = container.querySelector('input');
        const valueDisplay = container.querySelector('.fader-value');
        const flashBtn = container.querySelector('button');

        fader.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.dimmers[ch].value = val;
            updateDimmerOutput(ch);
            
            valueDisplay.textContent = dmxToPercent(val) + '%';
            if (val > 0) valueDisplay.classList.add('active');
            else valueDisplay.classList.remove('active');
            saveFrontStateLocally();
        });

        // Flash Button (Momentary Override to 255 - Always Instant)
        flashBtn.addEventListener('mousedown', () => {
            flashBtn.classList.add('active');
            socket.emit('update-channel', { channel: ch, value: 255, fadeTime: 0 });
        });
        flashBtn.addEventListener('mouseup', () => {
            flashBtn.classList.remove('active');
            updateDimmerOutput(ch, 0); // Return to submaster mix instantly
        });
        flashBtn.addEventListener('mouseleave', () => {
            flashBtn.classList.remove('active');
            updateDimmerOutput(ch, 0);
        });
        // For touch screens
        flashBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            flashBtn.classList.add('active');
            socket.emit('update-channel', { channel: ch, value: 255, fadeTime: 0 });
        });
        flashBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            flashBtn.classList.remove('active');
            updateDimmerOutput(ch, 0);
        });
    }
}

function updateDimmerOutput(channel, customFade = null) {
    if (!state.dimmers[channel]) return;
    const rawVal = state.dimmers[channel].value;
    const masterScale = state.frontMaster / 255;
    const finalVal = Math.round(rawVal * masterScale);
    
    // Use custom fade (for Flash) or Global Fade in seconds
    const fadeTime = customFade !== null ? customFade : ((parseFloat(masterFadeInput.value) || 0) * 1000);
    
    socket.emit('update-channel', { channel, value: finalVal, fadeTime });
}

function updateAllDimmers() {
    for (let ch = 19; ch <= 28; ch++) {
        updateDimmerOutput(ch);
    }
}

// RGB Group Logic
let rgbSelectionMode = 'ALL';
let isInternalUpdate = false; // Prevents Art-Net jumping on UI sync

const rgbStore = {
    'ALL': { r: 255, g: 255, b: 255 },
    'ODD': { r: 255, g: 255, b: 255 },
    'EVEN': { r: 255, g: 255, b: 255 }
};

const segBtns = document.querySelectorAll('.seg-btn');
segBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        segBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rgbSelectionMode = btn.getAttribute('data-sel');
        socket.emit('ui-sync', { type: 'selectionMode', value: rgbSelectionMode });
        
        // Restore UI State based on memory
        const mem = rgbStore[rgbSelectionMode];
        state.rgb.r = mem.r;
        state.rgb.g = mem.g;
        state.rgb.b = mem.b;
        
        // Update colorpicker visually without throwing event
        isInternalUpdate = true;
        colorPicker.color.set({r: mem.r, g: mem.g, b: mem.b});
        setTimeout(() => { isInternalUpdate = false; }, 50);
        
        syncManualSliders();
    });
});

let isAppInit = true; // Lock events during startup

const pickerSize = window.innerWidth <= 600 ? 200 : 260;
const colorPicker = new iro.ColorPicker("#color-picker-container", {
    width: pickerSize,
    color: "#fff",
    layout: [
        { component: iro.ui.Wheel }
    ]
});

colorPicker.on('color:change', (color) => {
    if (isAppInit || isInternalUpdate) return; // Prevent ghosting and jumps
    
    state.rgb.r = color.rgb.r;
    state.rgb.g = color.rgb.g;
    state.rgb.b = color.rgb.b;
    
    // Save to memory storage
    rgbStore[rgbSelectionMode] = { r: state.rgb.r, g: state.rgb.g, b: state.rgb.b };
    if (rgbSelectionMode === 'ALL') {
        rgbStore['ODD'] = { r: state.rgb.r, g: state.rgb.g, b: state.rgb.b };
        rgbStore['EVEN'] = { r: state.rgb.r, g: state.rgb.g, b: state.rgb.b };
    }
    
    syncManualSliders();
    updateRGBGroup();
    saveRGBStateLocally();
    socket.emit('ui-sync', { 
        type: 'rgbManual', 
        r: state.rgb.r, 
        g: state.rgb.g, 
        b: state.rgb.b, 
        master: state.rgb.master,
        mode: rgbSelectionMode 
    });
});

const rgbMaster = document.getElementById('rgb-master-dimmer');
const rgbR = document.getElementById('rgb-r');
const rgbG = document.getElementById('rgb-g');
const rgbB = document.getElementById('rgb-b');

btnRgbFullOn.addEventListener('click', () => {
    state.rgb.master = 255;
    rgbMaster.value = 255;
    rgbMaster.nextElementSibling.textContent = '100%';
    rgbMaster.nextElementSibling.classList.add('active');
    updateRGBGroup();
    saveRGBStateLocally();
});

btnRgbBlackout.addEventListener('click', () => {
    state.rgb.master = 0;
    rgbMaster.value = 0;
    rgbMaster.nextElementSibling.textContent = '0%';
    rgbMaster.nextElementSibling.classList.remove('active');
    updateRGBGroup();
    saveRGBStateLocally();
});

function syncManualSliders() {
    [rgbR, rgbG, rgbB].forEach((slider, idx) => {
        const val = [state.rgb.r, state.rgb.g, state.rgb.b][idx];
        slider.value = val;
        slider.nextElementSibling.textContent = val;
        if(val > 0) slider.nextElementSibling.classList.add('active');
        else slider.nextElementSibling.classList.remove('active');
    });
}

[rgbMaster, rgbR, rgbG, rgbB].forEach(slider => {
    slider.addEventListener('input', () => {
        if (isAppInit) return; // Prevent ghosting
        state.rgb.master = parseInt(rgbMaster.value);
        state.rgb.r = parseInt(rgbR.value);
        state.rgb.g = parseInt(rgbG.value);
        state.rgb.b = parseInt(rgbB.value);
        
        if (slider.id !== 'rgb-master-dimmer') {
            // Memory store for colors
            rgbStore[rgbSelectionMode] = { r: state.rgb.r, g: state.rgb.g, b: state.rgb.b };
            if (rgbSelectionMode === 'ALL') {
                rgbStore['ODD'] = { r: state.rgb.r, g: state.rgb.g, b: state.rgb.b };
                rgbStore['EVEN'] = { r: state.rgb.r, g: state.rgb.g, b: state.rgb.b };
            }
            // Update color picker visually without triggering change event
            isInternalUpdate = true;
            colorPicker.color.set({ r: state.rgb.r, g: state.rgb.g, b: state.rgb.b });
            setTimeout(() => { isInternalUpdate = false; }, 50);
        }
        
        if (slider.id === 'rgb-master-dimmer') {
            slider.nextElementSibling.textContent = dmxToPercent(parseInt(slider.value)) + '%';
        } else {
            slider.nextElementSibling.textContent = slider.value;
        }
        if(parseInt(slider.value) > 0) slider.nextElementSibling.classList.add('active');
        else slider.nextElementSibling.classList.remove('active');

        updateRGBGroup();
        saveRGBStateLocally();
        socket.emit('ui-sync', { 
            type: 'rgbManual', 
            r: state.rgb.r, 
            g: state.rgb.g, 
            b: state.rgb.b, 
            master: state.rgb.master,
            mode: rgbSelectionMode 
        });
    });
});

function updateRGBGroup() {
    let fadeTime = 0;
    const fadeInput = document.getElementById('master-fade-time');
    if (fadeInput) fadeTime = (parseFloat(fadeInput.value) || 0) * 1000;

    // fixtures starting at 50 (8 channel offset)
    for (let i = 0; i < TOTAL_FIXTURES; i++) {
        const fixtureNum = i + 1; // 1-indexed for logical odd/even
        const isOdd = (fixtureNum % 2 !== 0);
        
        let active = true;
        if (rgbSelectionMode === 'ODD' && !isOdd) active = false;
        if (rgbSelectionMode === 'EVEN' && isOdd) active = false;
        
        if (active) {
            const startCh = 50 + (i * 8);
            socket.emit('update-channel', { channel: startCh, value: state.rgb.master, fadeTime }); 
            socket.emit('update-channel', { channel: startCh + 1, value: state.rgb.r, fadeTime });
            socket.emit('update-channel', { channel: startCh + 2, value: state.rgb.g, fadeTime });
            socket.emit('update-channel', { channel: startCh + 3, value: state.rgb.b, fadeTime });
        }
    }
}

// Modal & Config Handling
function openModal() {
    ipInput.value = state.config.ip;
    universeInput.value = state.config.universe;
    settingsModal.classList.add('show');
    modalBackdrop.classList.add('show');
}

function closeModal() {
    settingsModal.classList.remove('show');
    modalBackdrop.classList.remove('show');
}

btnSettings.addEventListener('click', openModal);
btnCloseModal.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);

saveBtn.addEventListener('click', () => {
    const newConfig = {
        ip: ipInput.value || '192.168.10.150',
        universe: parseInt(universeInput.value) || 1,
        enabled: controllerToggle.checked
    };
    socket.emit('update-config', newConfig);
    closeModal();
});

controllerToggle.addEventListener('change', () => {
    const config = { enabled: controllerToggle.checked };
    socket.emit('update-config', config);
    updateStatusUI();
});

function updateStatusUI() {
    const online = controllerToggle.checked;
    statusDot.classList.toggle('online', online);
    toggleText.textContent = online ? 'ON' : 'OFF';
    toggleText.style.color = online ? 'var(--accent-color)' : 'var(--danger)';
    modalStatus.textContent = online ? 'Lytter på netværk' : 'Slukket';
}

// Socket communication
socket.on('connect', () => {
    statusDot.style.background = '#ff8800'; // Connected to server but maybe controller is off
});

socket.on('init', (data) => {
    state.config = data.config;
    controllerToggle.checked = state.config.enabled;
    updateStatusUI();
    
    // Restore UI positioning from Server's memory when reloading the page
    if(data.targetDmx) {
        
        // --- Restore Frontlys --- //
        const localStr = localStorage.getItem('artnetFrontlysUI');
        let localState = null;
        if (localStr) {
            try { localState = JSON.parse(localStr); } catch(e) {}
        }
        
        if (localState && localState.master !== undefined && localState.dimmers) {
            state.frontMaster = localState.master;
            frontMasterSlider.value = localState.master;
            frontMasterSlider.nextElementSibling.textContent = dmxToPercent(localState.master) + '%';
            if (localState.master > 0) frontMasterSlider.nextElementSibling.classList.add('active');
            else frontMasterSlider.nextElementSibling.classList.remove('active');

            for (let ch = 19; ch <= 28; ch++) {
                if (localState.dimmers[ch]) {
                    const savedVal = localState.dimmers[ch].value;
                    state.dimmers[ch].value = savedVal;
                    const faderDOM = document.getElementById(`fader-${ch}`);
                    const dispDOM = document.getElementById(`val-${ch}`);
                    if (faderDOM) faderDOM.value = savedVal;
                    if (dispDOM) {
                        dispDOM.textContent = dmxToPercent(savedVal) + '%';
                        if (savedVal > 0) dispDOM.classList.add('active');
                        else dispDOM.classList.remove('active');
                    }
                }
            }
        } else {
            // Fallback: Assume Master is 255
            state.frontMaster = 255;
            frontMasterSlider.value = 255;
            frontMasterSlider.nextElementSibling.textContent = '100%';
            frontMasterSlider.nextElementSibling.classList.add('active');

            for (let ch = 19; ch <= 28; ch++) {
                const serverVal = data.targetDmx[ch - 1] || 0;
                state.dimmers[ch].value = serverVal;
                const faderDOM = document.getElementById(`fader-${ch}`);
                const dispDOM = document.getElementById(`val-${ch}`);

                if(faderDOM) faderDOM.value = serverVal;
                if(dispDOM) {
                    dispDOM.textContent = dmxToPercent(serverVal) + '%';
                    if(serverVal > 0) dispDOM.classList.add('active');
                    else dispDOM.classList.remove('active');
                }
            }
        }
        
        // --- Restore RGB Group --- //
        const localRgbStr = localStorage.getItem('artnetRgbUI');
        let localRgb = null;
        if (localRgbStr) {
            try { localRgb = JSON.parse(localRgbStr); } catch(e) {}
        }
        
        let serverRgbMaster = data.targetDmx[49] || 0;
        let setR = 255, setG = 255, setB = 255;
        
        if (localRgb && localRgb.master !== undefined) {
            serverRgbMaster = localRgb.master;
            setR = localRgb.r;
            setG = localRgb.g;
            setB = localRgb.b;
            if (localRgb.store) {
                rgbStore['ALL'] = localRgb.store['ALL'] || {r:setR, g:setG, b:setB};
                rgbStore['ODD'] = localRgb.store['ODD'] || {r:setR, g:setG, b:setB};
                rgbStore['EVEN'] = localRgb.store['EVEN'] || {r:setR, g:setG, b:setB};
            }
        } else {
            const scaledR = data.targetDmx[50] || 255;
            const scaledG = data.targetDmx[51] || 255;
            const scaledB = data.targetDmx[52] || 255;
            setR = scaledR; setG = scaledG; setB = scaledB;
            rgbStore['ALL'] = { r: setR, g: setG, b: setB };
            rgbStore['ODD'] = { r: setR, g: setG, b: setB };
            rgbStore['EVEN'] = { r: setR, g: setG, b: setB };
        }
        
        state.rgb.master = serverRgbMaster;
        state.rgb.r = setR;
        state.rgb.g = setG;
        state.rgb.b = setB;
        
        rgbMaster.value = serverRgbMaster;
        rgbMaster.nextElementSibling.textContent = dmxToPercent(serverRgbMaster) + '%';
        if(serverRgbMaster > 0) rgbMaster.nextElementSibling.classList.add('active');
        else rgbMaster.nextElementSibling.classList.remove('active');
        
        // Restore RGB UI
        syncManualSliders();
        colorPicker.color.set({ r: setR, g: setG, b: setB });
        setTimeout(() => { isAppInit = false; }, 300);
    }
});

// Real-time sync from other devices
socket.on('channel-updated', ({ channel, value }) => {
    // Frontlys channels 19-28
    if (channel >= 19 && channel <= 28) {
        state.dimmers[channel] = state.dimmers[channel] || { value: 0 };
        const faderDOM = document.getElementById(`fader-${channel}`);
        const dispDOM = document.getElementById(`val-${channel}`);
        if (faderDOM) faderDOM.value = value;
        if (dispDOM) {
            dispDOM.textContent = dmxToPercent(value) + '%';
            if (value > 0) dispDOM.classList.add('active');
            else dispDOM.classList.remove('active');
        }
        return;
    }

    const relCh = channel - 50;
    if (relCh >= 0 && relCh < TOTAL_FIXTURES * 8) {
        const fixtureOffset = relCh % 8;
        if (fixtureOffset === 0 && relCh === 0) {
            state.rgb.master = value;
            rgbMaster.value = value;
            rgbMaster.nextElementSibling.textContent = dmxToPercent(value) + '%';
            if (value > 0) rgbMaster.nextElementSibling.classList.add('active');
            else rgbMaster.nextElementSibling.classList.remove('active');
        } else if (fixtureOffset === 1) state.rgb.r = value;
        else if (fixtureOffset === 2) state.rgb.g = value;
        else if (fixtureOffset === 3) state.rgb.b = value;
        
        if (fixtureOffset >= 1 && fixtureOffset <= 3 && relCh < 8) {
            syncManualSliders();
            isInternalUpdate = true;
            colorPicker.color.set({ r: state.rgb.r, g: state.rgb.g, b: state.rgb.b });
            setTimeout(() => { isInternalUpdate = false; }, 50);
        }
    }
});

socket.on('ui-sync', (data) => {
    if (data.type === 'frontMaster') {
        state.frontMaster = data.value;
        frontMasterSlider.value = data.value;
        frontMasterSlider.nextElementSibling.textContent = dmxToPercent(data.value) + '%';
        if (data.value > 0) frontMasterSlider.nextElementSibling.classList.add('active');
        else frontMasterSlider.nextElementSibling.classList.remove('active');
    } else if (data.type === 'fadeTime') {
        globalFadeInput.value = data.value;
        updateFadeDisplay();
        localStorage.setItem('artnetFadeTime', data.value);
    } else if (data.type === 'rainbowSpeed') {
        rainbowSpeedSlider.value = data.value;
    } else if (data.type === 'bpm') {
        bpmSlider.value = data.value;
        bpmValDisplay.textContent = data.value;
        if (oddEvenInterval) { stopOddEven(false, false); startOddEven(false); }
    } else if (data.type === 'effect') {
        if (data.effect === 'rainbow') {
            if (data.state === 'start') startRainbow(false);
            else stopRainbow(false, false);
        } else if (data.effect === 'oddeven') {
            if (data.state === 'start') startOddEven(false);
            else stopOddEven(false, false);
        }
    } else if (data.type === 'selectionMode') {
        rgbSelectionMode = data.value;
        const btn = document.querySelector(`.seg-btn[data-sel="${data.value}"]`);
        if (btn) {
            segBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const mem = rgbStore[rgbSelectionMode];
            state.rgb.r = mem.r;
            state.rgb.g = mem.g;
            state.rgb.b = mem.b;
            syncManualSliders();
            isInternalUpdate = true;
            colorPicker.color.set({r: mem.r, g: mem.g, b: mem.b});
            setTimeout(() => { isInternalUpdate = false; }, 50);
        }
    } else if (data.type === 'rgbManual') {
        state.rgb.r = data.r;
        state.rgb.g = data.g;
        state.rgb.b = data.b;
        state.rgb.master = data.master;
        rgbSelectionMode = data.mode;
        
        // Update memory store
        rgbStore[rgbSelectionMode] = { r: data.r, g: data.g, b: data.b };
        
        syncManualSliders();
        rgbMaster.value = data.master;
        rgbMaster.nextElementSibling.textContent = dmxToPercent(data.master) + '%';
        if(data.master > 0) rgbMaster.nextElementSibling.classList.add('active');
        else rgbMaster.nextElementSibling.classList.remove('active');

        isInternalUpdate = true;
        colorPicker.color.set({ r: data.r, g: data.g, b: data.b });
        setTimeout(() => { isInternalUpdate = false; }, 50);
    }
});

socket.on('config-changed', (config) => {
    state.config = config;
    controllerToggle.checked = config.enabled;
    updateStatusUI();
});

// Presets
document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.id === 'all-blackout') {
            allOff();
            return;
        }
        const color = btn.getAttribute('data-color');
        if (color) {
            colorPicker.color.set(color);
            rgbMaster.value = 255;
            state.rgb.master = 255;
            rgbMaster.nextElementSibling.textContent = '100%';
            rgbMaster.nextElementSibling.classList.add('active');
            updateRGBGroup();
            
            socket.emit('ui-sync', { 
                type: 'rgbManual', 
                r: state.rgb.r, 
                g: state.rgb.g, 
                b: state.rgb.b, 
                master: state.rgb.master,
                mode: rgbSelectionMode 
            });
        }
    });
});

function allOff() {
    allDimmersOff();
    rgbMaster.value = 0;
    state.rgb.master = 0;
    rgbMaster.nextElementSibling.textContent = '0%';
    rgbMaster.nextElementSibling.classList.remove('active');
    updateRGBGroup();
}

function allDimmersOff() {
    for (let ch = 19; ch <= 28; ch++) {
        state.dimmers[ch].value = 0;
        updateDimmerOutput(ch);
        
        document.getElementById(`fader-${ch}`).value = 0;
        const valDisp = document.getElementById(`val-${ch}`);
        valDisp.textContent = '0%';
        valDisp.classList.remove('active');
    }
    saveFrontStateLocally();
}

function allDimmersFull() {
    for (let ch = 19; ch <= 28; ch++) {
        state.dimmers[ch].value = 255;
        updateDimmerOutput(ch);

        document.getElementById(`fader-${ch}`).value = 255;
        const valDisp = document.getElementById(`val-${ch}`);
        valDisp.textContent = '100%';
        valDisp.classList.add('active');
    }
    saveFrontStateLocally();
}

// Init
initDimmers();
updateStatusUI();

// Theme toggle
const themeBtns = document.querySelectorAll('.theme-btn');
const savedTheme = localStorage.getItem('artnetTheme') || 'dark';
if (savedTheme === 'light') {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
}
themeBtns.forEach(btn => {
    if (btn.dataset.theme === savedTheme) btn.classList.add('active');
    else btn.classList.remove('active');
    btn.addEventListener('click', () => {
        themeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const theme = btn.dataset.theme;
        document.body.classList.remove('dark-theme', 'light-theme');
        document.body.classList.add(theme + '-theme');
        localStorage.setItem('artnetTheme', theme);
    });
});

// Restore local preferences
const globalFadeInput = document.getElementById('master-fade-time');
const fadeDisplay = document.getElementById('fade-display');
const fadeUpBtn = document.getElementById('fade-up');
const fadeDownBtn = document.getElementById('fade-down');

function updateFadeDisplay() {
    const val = parseFloat(globalFadeInput.value) || 0;
    fadeDisplay.innerHTML = val.toFixed(1) + '<small>s</small>';
}

function setFadeValue(val) {
    val = Math.max(0, Math.round(val * 10) / 10);
    globalFadeInput.value = val.toFixed(1);
    updateFadeDisplay();
    localStorage.setItem('artnetFadeTime', globalFadeInput.value);
    socket.emit('ui-sync', { type: 'fadeTime', value: globalFadeInput.value });
}

if (globalFadeInput) {
    const savedFade = localStorage.getItem('artnetFadeTime');
    if (savedFade) globalFadeInput.value = savedFade;
    updateFadeDisplay();

    fadeUpBtn.addEventListener('click', () => {
        setFadeValue(parseFloat(globalFadeInput.value) + 0.5);
    });
    fadeDownBtn.addEventListener('click', () => {
        setFadeValue(parseFloat(globalFadeInput.value) - 0.5);
    });
}

// ============================================================
// EFFECTS ENGINE
// ============================================================

function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// --- RAINBOW ---
let rainbowInterval = null;
let rainbowOffset = 0;
let rainbowSnapshot = null; // State saved before effect starts
const btnRainbow = document.getElementById('btn-rainbow');
const cardRainbow = document.getElementById('card-rainbow');
const rainbowSpeedSlider = document.getElementById('rainbow-speed');

function stopRainbow(broadcast = true, restoreState = true) {
    clearInterval(rainbowInterval);
    rainbowInterval = null;
    btnRainbow.textContent = 'START';
    btnRainbow.classList.remove('running');
    cardRainbow.classList.remove('active');

    if (broadcast) {
        socket.emit('ui-sync', { type: 'effect', effect: 'rainbow', state: 'stop' });
    }

    // Restore the color all fixtures had before rainbow started
    if (restoreState && rainbowSnapshot) {
        const { r, g, b, master } = rainbowSnapshot;
        const fadeTime = (parseFloat(masterFadeInput.value) || 0) * 1000;
        for (let i = 0; i < TOTAL_FIXTURES; i++) {
            const startCh = 50 + (i * 8);
            socket.emit('update-channel', { channel: startCh,     value: master, fadeTime });
            socket.emit('update-channel', { channel: startCh + 1, value: r, fadeTime });
            socket.emit('update-channel', { channel: startCh + 2, value: g, fadeTime });
            socket.emit('update-channel', { channel: startCh + 3, value: b, fadeTime });
        }
        state.rgb.r = r;
        state.rgb.g = g;
        state.rgb.b = b;
        syncManualSliders();
        isInternalUpdate = true;
        colorPicker.color.set({ r, g, b });
        setTimeout(() => { isInternalUpdate = false; }, 50);
        rainbowSnapshot = null;
    }
}

function startRainbow(broadcast = true) {
    stopOddEven(false); // Stop conflicting effect without restoring
    
    if (broadcast) {
        socket.emit('ui-sync', { type: 'effect', effect: 'rainbow', state: 'start' });
        // Snapshot current state locally to restore later
        rainbowSnapshot = { r: state.rgb.r, g: state.rgb.g, b: state.rgb.b, master: state.rgb.master };

        rainbowInterval = setInterval(() => {
            const speed = parseInt(rainbowSpeedSlider.value);
            rainbowOffset = (rainbowOffset + speed) % 360;
            for (let i = 0; i < TOTAL_FIXTURES; i++) {
                const hue = (rainbowOffset + (i * (360 / TOTAL_FIXTURES))) % 360;
                const rgb = hslToRgb(hue, 100, 50);
                const startCh = 50 + (i * 8);
                socket.emit('update-channel', { channel: startCh,     value: state.rgb.master, fadeTime: 0 });
                socket.emit('update-channel', { channel: startCh + 1, value: rgb.r, fadeTime: 0 });
                socket.emit('update-channel', { channel: startCh + 2, value: rgb.g, fadeTime: 0 });
                socket.emit('update-channel', { channel: startCh + 3, value: rgb.b, fadeTime: 0 });
            }
        }, 80);
    }
    
    btnRainbow.textContent = 'STOP';
    btnRainbow.classList.add('running');
    cardRainbow.classList.add('active');
}
btnRainbow.addEventListener('click', () => {
    if (rainbowInterval || btnRainbow.classList.contains('running')) stopRainbow();
    else startRainbow();
});

rainbowSpeedSlider.addEventListener('input', () => {
    socket.emit('ui-sync', { type: 'rainbowSpeed', value: rainbowSpeedSlider.value });
});

// --- ODD/EVEN DIMFLASH ---
let oddEvenInterval = null;
let oddEvenPhase = false;
let oddEvenSnapshot = null; // master dimmer value saved before effect
const btnOddEven = document.getElementById('btn-oddeven');
const cardOddEven = document.getElementById('card-oddeven');
const bpmSlider = document.getElementById('oddeven-bpm');
const bpmValDisplay = document.getElementById('oddeven-bpm-val');

bpmSlider.addEventListener('input', () => {
    bpmValDisplay.textContent = bpmSlider.value;
    if (oddEvenInterval) { stopOddEven(false); startOddEven(); } // Local start emits its own ui-sync anyway so this is fine
    socket.emit('ui-sync', { type: 'bpm', value: bpmSlider.value });
});

function stopOddEven(broadcast = true, restoreState = true) {
    clearInterval(oddEvenInterval);
    oddEvenInterval = null;
    btnOddEven.textContent = 'START';
    btnOddEven.classList.remove('running');
    cardOddEven.classList.remove('active');

    if (broadcast) {
        socket.emit('ui-sync', { type: 'effect', effect: 'oddeven', state: 'stop' });
    }

    // Restore all fixtures to their pre-effect state (Master and Color)
    if (restoreState && oddEvenSnapshot !== null) {
        const { r, g, b, master } = oddEvenSnapshot;
        const fadeTime = (parseFloat(masterFadeInput.value) || 0) * 1000;
        for (let i = 0; i < TOTAL_FIXTURES; i++) {
            const startCh = 50 + (i * 8);
            socket.emit('update-channel', { channel: startCh,     value: master, fadeTime });
            socket.emit('update-channel', { channel: startCh + 1, value: r, fadeTime });
            socket.emit('update-channel', { channel: startCh + 2, value: g, fadeTime });
            socket.emit('update-channel', { channel: startCh + 3, value: b, fadeTime });
        }
        oddEvenSnapshot = null;
    }
}

function startOddEven(broadcast = true) {
    stopRainbow(false); // Stop conflicting effect without restoring
    
    if (broadcast) {
        socket.emit('ui-sync', { type: 'effect', effect: 'oddeven', state: 'start' });
        // Snapshot current color and master
        oddEvenSnapshot = { r: state.rgb.r, g: state.rgb.g, b: state.rgb.b, master: state.rgb.master };

        const bpm = parseInt(bpmSlider.value);
        const intervalMs = (60 / bpm) * 1000;
        oddEvenInterval = setInterval(() => {
            oddEvenPhase = !oddEvenPhase;
            for (let i = 0; i < TOTAL_FIXTURES; i++) {
                const isOdd = (i % 2 === 0);
                const dimVal = (isOdd !== oddEvenPhase) ? state.rgb.master : 0;
                const startCh = 50 + (i * 8);
                // Send both dimmer AND color to be safe
                socket.emit('update-channel', { channel: startCh,     value: dimVal, fadeTime: 0 });
                socket.emit('update-channel', { channel: startCh + 1, value: state.rgb.r, fadeTime: 0 });
                socket.emit('update-channel', { channel: startCh + 2, value: state.rgb.g, fadeTime: 0 });
                socket.emit('update-channel', { channel: startCh + 3, value: state.rgb.b, fadeTime: 0 });
            }
        }, intervalMs);
    }
    
    btnOddEven.textContent = 'STOP';
    btnOddEven.classList.add('running');
    cardOddEven.classList.add('active');
}

btnOddEven.addEventListener('click', () => {
    if (oddEvenInterval || btnOddEven.classList.contains('running')) stopOddEven();
    else startOddEven();
});
