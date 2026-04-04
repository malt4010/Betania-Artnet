const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const dgram = require('dgram');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Art-Net Settings
let config = {
    ip: '192.168.10.150',
    universe: 1,
    port: 6454,
    enabled: false
};

// DMX State
let currentDmxFloats = new Float32Array(512).fill(0); // For smooth fading
let currentDmx = Buffer.alloc(512, 0);
let targetDmx = Buffer.alloc(512, 0);
let fadeSpeeds = new Array(512).fill(0); // Value change per step

// Intervals
let updateInterval = 1000;
let timer = null;
let lastActiveTime = Date.now();
const ACTIVE_THRESHOLD = 2000;
let sequence = 1; // Art-Net sequence counter

// Controller Lock System
let activeController = null; // socket.id of whoever has control
let controllerName = null;   // display name

// UDP Socket
const udpClient = dgram.createSocket('udp4');

// Bind the port explicitly (sometimes needed for network permissions)
udpClient.on('error', (err) => console.error('UDP Socket Error:', err));
udpClient.bind(() => {
    udpClient.setBroadcast(true); // VERY IMPORTANT FOR MAC / ART-NET
    console.log('Art-Net UDP Socket ready for transmission (Broadcast enabled)');
});

/**
 * Construct an Art-Net (ArtDMX) packet
 */
function createArtDmxPacket(dmxData) {
    const header = Buffer.from('Art-Net\0', 'ascii');
    const opCode = Buffer.from([0x00, 0x50]); // OpOutput / ArtDMX
    const protocolVersion = Buffer.from([0x00, 0x0e]); // v14
    
    // Increment sequence (1 to 255, then back to 1. 0 means sequence disabled)
    sequence = (sequence % 255) + 1;
    const seq = Buffer.from([sequence]);
    
    const physical = Buffer.from([0x00]);
    const universe = Buffer.alloc(2);
    universe.writeUInt16LE(config.universe, 0); // Art-Net Universe is Low Byte First (LE)
    const length = Buffer.alloc(2);
    length.writeUInt16BE(512, 0); // DMX Data Length is Big Endian

    return Buffer.concat([header, opCode, protocolVersion, seq, physical, universe, length, dmxData]);
}

function sendArtNet() {
    if (!config.enabled) return;

    // Interpolation (Fades)
    let hasChanges = false;
    for (let i = 0; i < 512; i++) {
        if (Math.abs(currentDmxFloats[i] - targetDmx[i]) > 0.01) {
            hasChanges = true;
            if (fadeSpeeds[i] === 0) {
                currentDmxFloats[i] = targetDmx[i];
            } else {
                let diff = targetDmx[i] - currentDmxFloats[i];
                if (Math.abs(diff) <= Math.abs(fadeSpeeds[i])) {
                    currentDmxFloats[i] = targetDmx[i];
                } else {
                    currentDmxFloats[i] += fadeSpeeds[i];
                }
            }
            // Update the buffer for the actual UDP packet
            currentDmx[i] = Math.round(currentDmxFloats[i]);
        }
    }

    // Packet transmission
    const packet = createArtDmxPacket(currentDmx);
    udpClient.send(packet, config.port, config.ip, (err) => {
        if (err) console.error('UDP Send Error:', err);
    });

    // Throttled logging (once every 25 packets / approx 1 sec in active mode)
    if (sequence % 25 === 0) {
        console.log(`[Art-Net] Sending DMX to ${config.ip} on Universe ${config.universe} (ON: ${config.enabled})`);
    }

    // Check if we should switch interval
    const now = Date.now();
    if (hasChanges) lastActiveTime = now;

    const timeSinceLastActivity = now - lastActiveTime;
    const nextInterval = (hasChanges || timeSinceLastActivity < ACTIVE_THRESHOLD) ? 40 : 1000;

    if (nextInterval !== updateInterval) {
        updateInterval = nextInterval;
        resetTimer();
    }
}

function resetTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(sendArtNet, updateInterval);
}

// Start the Art-Net loop
resetTimer();

// SSE / WebSocket updates
io.on('connection', (socket) => {
    console.log('Client connected');
    
    // Send current state to new client
    socket.emit('init', {
        config,
        currentDmx: Array.from(currentDmx),
        targetDmx: Array.from(targetDmx),
        controller: activeController ? { id: activeController, name: controllerName } : null,
        myId: socket.id
    });

    // Claim exclusive control of the DMX board
    socket.on('claim-control', ({ name }) => {
        activeController = socket.id;
        controllerName = name || 'Ukendt enhed';
        console.log(`[Control] ${controllerName} tager styringen (${socket.id})`);
        io.emit('controller-changed', { id: activeController, name: controllerName });
    });

    // Release control voluntarily
    socket.on('release-control', () => {
        if (activeController === socket.id) {
            console.log(`[Control] ${controllerName} frigiver styringen`);
            activeController = null;
            controllerName = null;
            io.emit('controller-changed', null);
        }
    });

    socket.on('update-channel', ({ channel, value, fadeTime }) => {
        // Block updates from non-controller clients when a controller is active
        if (activeController && activeController !== socket.id) return;

        const index = channel - 1;
        if (index < 0 || index >= 512) return;

        // Ensure safe number
        value = Math.max(0, Math.min(255, parseInt(value) || 0));

        targetDmx[index] = value;
        
        // Calculate fade speed (steps per 40ms interval)
        if (fadeTime && fadeTime > 0) {
            const steps = fadeTime / 40;
            const diff = targetDmx[index] - currentDmxFloats[index];
            fadeSpeeds[index] = diff / steps;
        } else {
            fadeSpeeds[index] = 0;
        }

        lastActiveTime = Date.now();
        
        // Broadcast to all OTHER clients so their UI stays in sync
        socket.broadcast.emit('channel-updated', { channel, value });
    });

    socket.on('update-config', (newConfig) => {
        Object.assign(config, newConfig);
        console.log('Config Updated:', config);
        
        // If re-enabling, send state immediately
        if (config.enabled) {
            lastActiveTime = Date.now();
            sendArtNet();
        }
        
        io.emit('config-changed', config);
    });

    socket.on('all-off', () => {
        if (activeController && activeController !== socket.id) return;
        targetDmx.fill(0);
        fadeSpeeds.fill(0);
        lastActiveTime = Date.now();
    });

    socket.on('disconnect', () => {
        if (activeController === socket.id) {
            console.log(`[Control] Controller ${controllerName} afbrød forbindelsen – styringen frigivet.`);
            activeController = null;
            controllerName = null;
            io.emit('controller-changed', null);
        }
        console.log('Client disconnected');
    });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Art-Net Controller Server running on http://localhost:${PORT}`);
});
