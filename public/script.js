const socket = io();

// State management
let state = {
    config: { ip: '192.168.10.150', universe: 1, enabled: false },
    dimmers: {}, 
    frontMaster: 255,
    rgb: { r: 255, g: 255, b: 255, master: 0 }
};

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
    e.target.nextElementSibling.textContent = state.frontMaster;
    
    if(state.frontMaster > 0) e.target.nextElementSibling.classList.add('active');
    else e.target.nextElementSibling.classList.remove('active');
    
    updateAllDimmers();
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
            
            valueDisplay.textContent = val;
            if (val > 0) valueDisplay.classList.add('active');
            else valueDisplay.classList.remove('active');
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
    
    // Use custom fade (for Flash) or Global Fade
    const fadeTime = customFade !== null ? customFade : (parseInt(masterFadeInput.value) || 0);
    
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

const colorPicker = new iro.ColorPicker("#color-picker-container", {
    width: 260,
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
});

const rgbMaster = document.getElementById('rgb-master-dimmer');
const rgbR = document.getElementById('rgb-r');
const rgbG = document.getElementById('rgb-g');
const rgbB = document.getElementById('rgb-b');

btnRgbFullOn.addEventListener('click', () => {
    state.rgb.master = 255;
    rgbMaster.value = 255;
    rgbMaster.nextElementSibling.textContent = '255';
    rgbMaster.nextElementSibling.classList.add('active');
    updateRGBGroup();
});

btnRgbBlackout.addEventListener('click', () => {
    state.rgb.master = 0;
    rgbMaster.value = 0;
    rgbMaster.nextElementSibling.textContent = '0';
    rgbMaster.nextElementSibling.classList.remove('active');
    updateRGBGroup();
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
        } else {
            slider.nextElementSibling.textContent = slider.value;
            if(slider.value > 0) slider.nextElementSibling.classList.add('active');
            else slider.nextElementSibling.classList.remove('active');
        }
        
        updateRGBGroup();
    });
});

function updateRGBGroup() {
    let fadeTime = 0;
    const fadeInput = document.getElementById('master-fade-time');
    if (fadeInput) fadeTime = parseInt(fadeInput.value) || 0;

    // 38 fixtures starting at 50 (8 channel offset)
    for (let i = 0; i < 38; i++) {
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
        // For simplicity, we assume Master is at 255 so the individual dimmers can accurately reflect the DMX array.
        state.frontMaster = 255;
        frontMasterSlider.value = 255;
        frontMasterSlider.nextElementSibling.textContent = '255';
        frontMasterSlider.nextElementSibling.classList.add('active');
        
        for (let ch = 19; ch <= 28; ch++) {
            const serverVal = data.targetDmx[ch - 1] || 0;
            state.dimmers[ch].value = serverVal;
            const faderDOM = document.getElementById(`fader-${ch}`);
            const dispDOM = document.getElementById(`val-${ch}`);
            
            if(faderDOM) faderDOM.value = serverVal;
            if(dispDOM) {
                dispDOM.textContent = serverVal;
                if(serverVal > 0) dispDOM.classList.add('active');
                else dispDOM.classList.remove('active');
            }
        }
        
        // --- Restore RGB Group --- //
        // Fixture starts at channel 50, so Master is index 49
        const serverRgbMaster = data.targetDmx[49] || 0;
        const serverR = data.targetDmx[50] || 255;
        const serverG = data.targetDmx[51] || 255;
        const serverB = data.targetDmx[52] || 255;
        
        state.rgb.master = serverRgbMaster;
        state.rgb.r = serverR;
        state.rgb.g = serverG;
        state.rgb.b = serverB;
        
        // Sync the ODD/EVEN memory to current server state to prevent "jumping" when switching after reload
        rgbStore['ALL'] = { r: serverR, g: serverG, b: serverB };
        rgbStore['ODD'] = { r: serverR, g: serverG, b: serverB };
        rgbStore['EVEN'] = { r: serverR, g: serverG, b: serverB };
        
        rgbMaster.value = serverRgbMaster;
        rgbMaster.nextElementSibling.textContent = serverRgbMaster;
        if(serverRgbMaster > 0) rgbMaster.nextElementSibling.classList.add('active');
        else rgbMaster.nextElementSibling.classList.remove('active');
        
        syncManualSliders();
        colorPicker.color.set({ r: serverR, g: serverG, b: serverB });
        setTimeout(() => { isAppInit = false; }, 300);
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
            rgbMaster.nextElementSibling.textContent = '255';
            rgbMaster.nextElementSibling.classList.add('active');
            updateRGBGroup();
        }
    });
});

function allOff() {
    allDimmersOff();
    rgbMaster.value = 0;
    state.rgb.master = 0;
    rgbMaster.nextElementSibling.textContent = '0';
    rgbMaster.nextElementSibling.classList.remove('active');
    updateRGBGroup();
}

function allDimmersOff() {
    for (let ch = 19; ch <= 28; ch++) {
        state.dimmers[ch].value = 0;
        updateDimmerOutput(ch);
        
        document.getElementById(`fader-${ch}`).value = 0;
        const valDisp = document.getElementById(`val-${ch}`);
        valDisp.textContent = '0';
        valDisp.classList.remove('active');
    }
}

function allDimmersFull() {
    for (let ch = 19; ch <= 28; ch++) {
        state.dimmers[ch].value = 255;
        updateDimmerOutput(ch);
        
        document.getElementById(`fader-${ch}`).value = 255;
        const valDisp = document.getElementById(`val-${ch}`);
        valDisp.textContent = '255';
        valDisp.classList.add('active');
    }
}

// Init
initDimmers();
updateStatusUI();

// Restore local preferences
const globalFadeInput = document.getElementById('master-fade-time');
if (globalFadeInput) {
    const savedFade = localStorage.getItem('artnetFadeTime');
    if (savedFade) globalFadeInput.value = savedFade;
    
    globalFadeInput.addEventListener('change', () => {
        localStorage.setItem('artnetFadeTime', globalFadeInput.value);
    });
}
