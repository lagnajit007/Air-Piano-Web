class OptimizedHandGestureMIDI {
    constructor() {
        this.audioContext = null;
        this.hands = null;
        this.camera = null;
        this.isRunning = false;
        this.currentInstrument = 0;
        this.sustainTime = 1500;

        // Performance optimization
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
        this.processingFrame = false;
        this.maxFPS = 30;
        this.lastProcessTime = 0;

        // Audio optimization
        this.audioNodes = new Map();
        this.masterGain = null;
        this.compressor = null;
        this.reverbNode = null;

        // Chord definitions
        this.chords = {
            left: {
                thumb: [50, 54, 57],   // D-F#-A
                index: [52, 55, 59],   // E-G-B
                middle: [54, 57, 61],  // F#-A-C#
                ring: [55, 59, 62],    // G-B-D
                pinky: [57, 61, 64]    // A-C#-E
            },
            right: {
                thumb: [62, 66, 69],   // D-F#-A (octave higher)
                index: [64, 67, 71],   // E-G-B
                middle: [66, 69, 73],  // F#-A-C#
                ring: [67, 71, 74],    // G-B-D
                pinky: [69, 73, 76]    // A-C#-E
            }
        };

        this.prevStates = {
            left: { thumb: false, index: false, middle: false, ring: false, pinky: false },
            right: { thumb: false, index: false, middle: false, ring: false, pinky: false }
        };

        this.activeNotes = new Set();
        this.sustainTimeouts = new Map();

        // Enhanced instrument definitions
        this.instruments = [
            {
                name: "Piano",
                type: 'complex',
                attack: 0.005,
                decay: 0.3,
                sustain: 0.2,
                release: 1.2,
                harmonics: [1, 0.4, 0.2, 0.1, 0.05, 0.025],
                filterFreq: 4500,
                filterQ: 0.8,
                filterType: 'lowpass',
                volume: 0.6,
                hammerNoise: 0.02 // Subtle hammer strike noise
            },
            {
                name: "Guitar",
                type: 'plucked',
                attack: 0.002,
                decay: 0.15,
                sustain: 0.3,
                release: 1.8,
                harmonics: [1, 0.6, 0.25, 0.12, 0.06, 0.03],
                filterFreq: 2800,
                filterQ: 2.5,
                filterType: 'bandpass',
                volume: 0.65,
                modulation: { rate: 5.5, depth: 0.015 },
                pickNoise: 0.03 // String pluck noise
            },
            {
                name: "Violin",
                type: 'bowed',
                attack: 0.12,
                decay: 0.08,
                sustain: 0.95,
                release: 0.7,
                harmonics: [1, 0.85, 0.65, 0.45, 0.3, 0.2, 0.15],
                filterFreq: 3800,
                filterQ: 1.8,
                filterType: 'lowpass',
                volume: 0.5,
                vibrato: { rate: 6, depth: 0.025 },
                bowNoise: 0.01 // Subtle bow friction
            },
            {
                name: "Brass",
                type: 'brass',
                attack: 0.07,
                decay: 0.12,
                sustain: 0.85,
                release: 0.5,
                harmonics: [1, 0.7, 0.5, 0.35, 0.25, 0.15, 0.08],
                filterFreq: 2200,
                filterQ: 1.5,
                filterType: 'lowpass',
                volume: 0.55,
                brightness: 1.3,
                breathNoise: 0.02 // Breath articulation
            },
            {
                name: "Flute",
                type: 'wind',
                attack: 0.04,
                decay: 0.04,
                sustain: 0.9,
                release: 0.25,
                harmonics: [1, 0.15, 0.08, 0.04, 0.02],
                filterFreq: 5200,
                filterQ: 0.7,
                filterType: 'lowpass',
                volume: 0.45,
                breathNoise: 0.07,
                vibrato: { rate: 5, depth: 0.02 }
            }
        ];

        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        this.videoElement = document.getElementById('videoElement');
        this.canvasElement = document.getElementById('output_canvas');
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.instrumentSelect = document.getElementById('instrumentSelect');
        this.statusDisplay = document.getElementById('statusDisplay');
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.fpsDisplay = document.getElementById('fpsDisplay');
        this.activeNotesDisplay = document.getElementById('activeNotesDisplay');

        this.canvasCtx = this.canvasElement.getContext('2d');
        this.canvasCtx.imageSmoothingEnabled = false;
    }

    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.start());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.instrumentSelect.addEventListener('change', (e) => {
            this.stopAllNotes(); // Ensure all notes are stopped before switching
            this.currentInstrument = parseInt(e.target.value);
            this.updateStatus(`🎵 Instrument: ${this.instruments[this.currentInstrument].name}`, 'info');
        });
    }

    async initializeAudio() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.masterGain = this.audioContext.createGain();
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.reverbNode = await this.createReverbNode();

        this.compressor.threshold.setValueAtTime(-18, this.audioContext.currentTime);
        this.compressor.knee.setValueAtTime(20, this.audioContext.currentTime);
        this.compressor.ratio.setValueAtTime(8, this.audioContext.currentTime);
        this.compressor.attack.setValueAtTime(0.001, this.audioContext.currentTime);
        this.compressor.release.setValueAtTime(0.1, this.audioContext.currentTime);

        this.masterGain.connect(this.reverbNode);
        this.reverbNode.connect(this.compressor);
        this.compressor.connect(this.audioContext.destination);
        this.masterGain.gain.setValueAtTime(0.4, this.audioContext.currentTime);
    }

    async createReverbNode() {
        const convolver = this.audioContext.createConvolver();
        const length = this.audioContext.sampleRate * 1.5; // Reduced for performance
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 3);
                channelData[i] = (Math.random() * 2 - 1) * decay * 0.08;
            }
        }

        convolver.buffer = impulse;

        const wetGain = this.audioContext.createGain();
        const dryGain = this.audioContext.createGain();
        const outputGain = this.audioContext.createGain();

        wetGain.gain.setValueAtTime(0.2, this.audioContext.currentTime);
        dryGain.gain.setValueAtTime(0.8, this.audioContext.currentTime);

        const inputGain = this.audioContext.createGain();
        inputGain.connect(dryGain);
        inputGain.connect(convolver);
        convolver.connect(wetGain);
        dryGain.connect(outputGain);
        wetGain.connect(outputGain);

        return inputGain;
    }

    async start() {
        try {
            this.startBtn.disabled = true;
            this.loadingSpinner.style.display = 'inline-block';
            this.updateStatus('Initializing audio and camera...', 'info');

            await this.initializeAudio();

            this.hands = new Hands({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
            });

            this.hands.setOptions({
                maxNumHands: 2,
                modelComplexity: 0,
                minDetectionConfidence: 0.7,
                minTrackingConfidence: 0.5
            });

            this.hands.onResults((results) => this.onResults(results));

            this.camera = new Camera(this.videoElement, {
                onFrame: async () => {
                    const now = performance.now();
                    if (now - this.lastProcessTime >= 1000 / this.maxFPS && !this.processingFrame) {
                        this.processingFrame = true;
                        this.lastProcessTime = now;
                        try {
                            await this.hands.send({ image: this.videoElement });
                        } catch (error) {
                            console.warn('Frame processing error:', error);
                        } finally {
                            this.processingFrame = false;
                        }
                    }
                },
                width: 640,
                height: 480
            });

            await this.camera.start();

            this.isRunning = true;
            this.startBtn.disabled = false;
            this.stopBtn.disabled = false;
            this.loadingSpinner.style.display = 'none';
            this.updateStatus('🎵 Ready! Show your hands to make music!', 'success');
            this.startPerformanceMonitoring();
        } catch (error) {
            console.error('Error starting:', error);
            this.updateStatus('❌ Failed to start - Check camera permissions', 'error');
            this.startBtn.disabled = false;
            this.loadingSpinner.style.display = 'none';
        }
    }

    stop() {
        this.isRunning = false;

        if (this.camera) {
            this.camera.stop();
            this.camera = null;
        }

        if (this.hands) {
            this.hands.close();
            this.hands = null;
        }

        this.stopAllNotes();
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }

        for (let timeout of this.sustainTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.sustainTimeouts.clear();
        this.audioNodes.clear();

        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        this.updateStatus('⏹️ Stopped', 'info');
        this.clearCanvas();
        this.clearActiveChords();
        this.fpsDisplay.textContent = 'FPS: --';
        this.activeNotesDisplay.textContent = 'Active Notes: 0';
    }

    onResults(results) {
        if (!this.isRunning) return;

        this.updateFPS();
        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);

        // Mirror the canvas horizontally
        this.canvasCtx.scale(-1, 1); // Flip horizontally
        this.canvasCtx.translate(-this.canvasElement.width, 0); // Adjust for the flip

        if (results.image) {
            this.canvasCtx.drawImage(results.image, 0, 0, this.canvasElement.width, this.canvasElement.height);
        }

        if (results.multiHandLandmarks && results.multiHandedness) {
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const landmarks = results.multiHandLandmarks[i];
                const handedness = results.multiHandedness[i];
                this.drawHandLandmarks(landmarks);
                this.processHandGesture(landmarks, handedness.label);
            }
        }

        this.canvasCtx.restore();
        this.activeNotesDisplay.textContent = `Active Notes: ${this.activeNotes.size}`;
    }

    drawHandLandmarks(landmarks) {
        this.canvasCtx.strokeStyle = '#00FF00';
        this.canvasCtx.lineWidth = 2;
        this.canvasCtx.fillStyle = '#FF0000';

        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],
            [0, 5], [5, 6], [6, 7], [7, 8],
            [0, 9], [9, 10], [10, 11], [11, 12],
            [0, 13], [13, 14], [14, 15], [15, 16],
            [0, 17], [17, 18], [18, 19], [19, 20],
            [5, 9], [9, 13], [13, 17]
        ];

        this.canvasCtx.beginPath();
        connections.forEach(([start, end]) => {
            const startPoint = landmarks[start];
            const endPoint = landmarks[end];
            this.canvasCtx.moveTo(startPoint.x * this.canvasElement.width, startPoint.y * this.canvasElement.height);
            this.canvasCtx.lineTo(endPoint.x * this.canvasElement.width, endPoint.y * this.canvasElement.height);
        });
        this.canvasCtx.stroke();

        const keyPoints = [0, 4, 8, 12, 16, 20];
        keyPoints.forEach(i => {
            const point = landmarks[i];
            this.canvasCtx.beginPath();
            this.canvasCtx.arc(point.x * this.canvasElement.width, point.y * this.canvasElement.height, 4, 0, 2 * Math.PI);
            this.canvasCtx.fill();
        });
    }

    processHandGesture(landmarks, handLabel) {
        // Adjust hand type due to mirroring: MediaPipe's "Left" is user's right hand in mirrored view
        const handType = handLabel === "Left" ? "right" : "left";
        const fingerStates = this.getFingerStates(landmarks);
        const fingerNames = ['thumb', 'index', 'middle', 'ring', 'pinky'];

        fingerNames.forEach((finger, index) => {
            const isRaised = fingerStates[index];
            const wasRaised = this.prevStates[handType][finger];

            if (isRaised && !wasRaised) {
                this.playChord(handType, finger, landmarks);
                this.highlightChord(handType, finger, true);
            } else if (!isRaised && wasRaised) {
                this.scheduleChordOff(handType, finger);
                this.highlightChord(handType, finger, false);
            }

            this.prevStates[handType][finger] = isRaised;
        });
    }

    getFingerStates(landmarks) {
        const fingerStates = [];
        const thumbTip = landmarks[4];
        const thumbMcp = landmarks[2];
        fingerStates.push(Math.abs(thumbTip.x - thumbMcp.x) > 0.04);

        const fingerTips = [8, 12, 16, 20];
        const fingerPips = [6, 10, 14, 18];

        for (let i = 0; i < 4; i++) {
            const tipY = landmarks[fingerTips[i]].y;
            const pipY = landmarks[fingerPips[i]].y;
            fingerStates.push(tipY < pipY - 0.02);
        }

        return fingerStates;
    }

    playChord(handType, finger, landmarks) {
        const chordNotes = this.chords[handType][finger];
        const handCenter = this.getHandCenter(landmarks);
        const volume = Math.max(0.1, Math.min(0.8, 1.0 - handCenter.y));

        chordNotes.forEach(note => {
            this.playNoteOptimized(note, volume);
        });
    }

    playNoteOptimized(midiNote, volume = 0.5) {
        if (!this.audioContext || this.audioContext.state !== 'running') return;

        const frequency = this.midiToFreq(midiNote);
        const instrument = this.instruments[this.currentInstrument];
        const now = this.audioContext.currentTime;

        const audioNodes = this.createInstrumentVoice(frequency, instrument, volume, now);
        const noteKey = `${midiNote}-${Date.now()}`;
        this.audioNodes.set(noteKey, audioNodes);
        this.activeNotes.add(midiNote);

        setTimeout(() => {
            this.stopNoteOptimized(noteKey, instrument.release);
        }, this.sustainTime);
    }

    createInstrumentVoice(frequency, instrument, volume, startTime) {
        switch (instrument.type) {
            case 'complex':
                return this.createPianoVoice(frequency, instrument, volume, startTime);
            case 'plucked':
                return this.createGuitarVoice(frequency, instrument, volume, startTime);
            case 'bowed':
                return this.createViolinVoice(frequency, instrument, volume, startTime);
            case 'brass':
                return this.createBrassVoice(frequency, instrument, volume, startTime);
            case 'wind':
                return this.createFluteVoice(frequency, instrument, volume, startTime);
            default:
                return this.createSimpleVoice(frequency, instrument, volume, startTime);
        }
    }

    createPianoVoice(frequency, instrument, volume, startTime) {
        const oscillators = [];
        const gainNodes = [];
        const masterGain = this.audioContext.createGain();

        instrument.harmonics.forEach((harmonic, index) => {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency * (index + 1), startTime);

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(harmonic * volume * instrument.volume, startTime + instrument.attack);
            gain.gain.exponentialRampToValueAtTime(harmonic * volume * instrument.sustain * instrument.volume, startTime + instrument.attack + instrument.decay);

            osc.connect(gain);
            gain.connect(masterGain);
            osc.start(startTime);

            oscillators.push(osc);
            gainNodes.push(gain);
        });

        if (instrument.hammerNoise) {
            const noiseBuffer = this.createNoiseBuffer(0.1);
            const noiseSource = this.audioContext.createBufferSource();
            const noiseGain = this.audioContext.createGain();
            noiseSource.buffer = noiseBuffer;
            noiseGain.gain.setValueAtTime(instrument.hammerNoise * volume, startTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.05);
            noiseSource.connect(noiseGain);
            noiseGain.connect(masterGain);
            noiseSource.start(startTime);
            oscillators.push(noiseSource);
            gainNodes.push(noiseGain);
        }

        const filter = this.audioContext.createBiquadFilter();
        filter.type = instrument.filterType;
        filter.frequency.setValueAtTime(instrument.filterFreq, startTime);
        filter.Q.setValueAtTime(instrument.filterQ, startTime);

        masterGain.connect(filter);
        filter.connect(this.masterGain);

        return { oscillators, gainNodes, masterGain, filter };
    }

    createGuitarVoice(frequency, instrument, volume, startTime) {
        const oscillators = [];
        const gainNodes = [];
        const masterGain = this.audioContext.createGain();

        instrument.harmonics.forEach((harmonic, index) => {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();

            osc.type = 'sawtooth';
            const detune = (Math.random() - 0.5) * 4;
            osc.frequency.setValueAtTime(frequency * (index + 1), startTime);
            osc.detune.setValueAtTime(detune, startTime);

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(harmonic * volume * instrument.volume, startTime + instrument.attack);
            gain.gain.exponentialRampToValueAtTime(harmonic * volume * instrument.sustain * instrument.volume, startTime + instrument.attack + instrument.decay);

            if (instrument.modulation && index === 0) {
                const lfo = this.audioContext.createOscillator();
                const lfoGain = this.audioContext.createGain();
                lfo.frequency.setValueAtTime(instrument.modulation.rate, startTime);
                lfoGain.gain.setValueAtTime(instrument.modulation.depth, startTime);
                lfo.connect(lfoGain);
                lfoGain.connect(gain.gain);
                lfo.start(startTime);
                oscillators.push(lfo);
            }

            osc.connect(gain);
            gain.connect(masterGain);
            osc.start(startTime);

            oscillators.push(osc);
            gainNodes.push(gain);
        });

        if (instrument.pickNoise) {
            const noiseBuffer = this.createNoiseBuffer(0.05);
            const noiseSource = this.audioContext.createBufferSource();
            const noiseGain = this.audioContext.createGain();
            const noiseFilter = this.audioContext.createBiquadFilter();

            noiseSource.buffer = noiseBuffer;
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.setValueAtTime(frequency * 3, startTime);
            noiseGain.gain.setValueAtTime(instrument.pickNoise * volume, startTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.03);

            noiseSource.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(masterGain);
            noiseSource.start(startTime);

            oscillators.push(noiseSource);
            gainNodes.push(noiseGain);
        }

        const filter = this.audioContext.createBiquadFilter();
        filter.type = instrument.filterType;
        filter.frequency.setValueAtTime(instrument.filterFreq, startTime);
        filter.Q.setValueAtTime(instrument.filterQ, startTime);

        masterGain.connect(filter);
        filter.connect(this.masterGain);

        return { oscillators, gainNodes, masterGain, filter };
    }

    createViolinVoice(frequency, instrument, volume, startTime) {
        const oscillators = [];
        const gainNodes = [];
        const masterGain = this.audioContext.createGain();

        instrument.harmonics.forEach((harmonic, index) => {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(frequency * (index + 1), startTime);

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(harmonic * volume * instrument.volume, startTime + instrument.attack);
            gain.gain.setValueAtTime(harmonic * volume * instrument.sustain * instrument.volume, startTime + instrument.attack + instrument.decay);

            if (instrument.vibrato && index === 0) {
                const vibrato = this.audioContext.createOscillator();
                const vibratoGain = this.audioContext.createGain();
                vibrato.frequency.setValueAtTime(instrument.vibrato.rate, startTime);
                vibratoGain.gain.setValueAtTime(frequency * instrument.vibrato.depth, startTime);
                vibrato.connect(vibratoGain);
                vibratoGain.connect(osc.frequency);
                vibrato.start(startTime);
                oscillators.push(vibrato);
            }

            osc.connect(gain);
            gain.connect(masterGain);
            osc.start(startTime);

            oscillators.push(osc);
            gainNodes.push(gain);
        });

        if (instrument.bowNoise) {
            const noiseBuffer = this.createNoiseBuffer(0.2);
            const noiseSource = this.audioContext.createBufferSource();
            const noiseGain = this.audioContext.createGain();
            const noiseFilter = this.audioContext.createBiquadFilter();

            noiseSource.buffer = noiseBuffer;
            noiseFilter.type = 'bandpass';
            noiseFilter.frequency.setValueAtTime(frequency * 2, startTime);
            noiseGain.gain.setValueAtTime(instrument.bowNoise * volume, startTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);

            noiseSource.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(masterGain);
            noiseSource.start(startTime);

            oscillators.push(noiseSource);
            gainNodes.push(noiseGain);
        }

        const filter = this.audioContext.createBiquadFilter();
        filter.type = instrument.filterType;
        filter.frequency.setValueAtTime(instrument.filterFreq, startTime);
        filter.Q.setValueAtTime(instrument.filterQ, startTime);

        masterGain.connect(filter);
        filter.connect(this.masterGain);

        return { oscillators, gainNodes, masterGain, filter };
    }

    createBrassVoice(frequency, instrument, volume, startTime) {
        const oscillators = [];
        const gainNodes = [];
        const masterGain = this.audioContext.createGain();

        instrument.harmonics.forEach((harmonic, index) => {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(frequency * (index + 1), startTime);

            const brightness = instrument.brightness || 1;
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(harmonic * volume * brightness * instrument.volume, startTime + instrument.attack);
            gain.gain.exponentialRampToValueAtTime(harmonic * volume * instrument.sustain * instrument.volume, startTime + instrument.attack + instrument.decay);

            osc.connect(gain);
            gain.connect(masterGain);
            osc.start(startTime);

            oscillators.push(osc);
            gainNodes.push(gain);
        });

        if (instrument.breathNoise) {
            const noiseBuffer = this.createNoiseBuffer(0.15);
            const noiseSource = this.audioContext.createBufferSource();
            const noiseGain = this.audioContext.createGain();
            const noiseFilter = this.audioContext.createBiquadFilter();

            noiseSource.buffer = noiseBuffer;
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.setValueAtTime(frequency * 1.5, startTime);
            noiseGain.gain.setValueAtTime(instrument.breathNoise * volume, startTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);

            noiseSource.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(masterGain);
            noiseSource.start(startTime);

            oscillators.push(noiseSource);
            gainNodes.push(noiseGain);
        }

        const filter = this.audioContext.createBiquadFilter();
        filter.type = instrument.filterType;
        filter.frequency.setValueAtTime(instrument.filterFreq, startTime);
        filter.Q.setValueAtTime(instrument.filterQ, startTime);

        masterGain.connect(filter);
        filter.connect(this.masterGain);

        return { oscillators, gainNodes, masterGain, filter };
    }

    createFluteVoice(frequency, instrument, volume, startTime) {
        const oscillators = [];
        const gainNodes = [];
        const masterGain = this.audioContext.createGain();

        const mainOsc = this.audioContext.createOscillator();
        const mainGain = this.audioContext.createGain();

        mainOsc.type = 'sine';
        mainOsc.frequency.setValueAtTime(frequency, startTime);

        mainGain.gain.setValueAtTime(0, startTime);
        mainGain.gain.linearRampToValueAtTime(volume * instrument.volume, startTime + instrument.attack);
        mainGain.gain.setValueAtTime(volume * instrument.sustain * instrument.volume, startTime + instrument.attack + instrument.decay);

        if (instrument.vibrato) {
            const vibrato = this.audioContext.createOscillator();
            const vibratoGain = this.audioContext.createGain();
            vibrato.frequency.setValueAtTime(instrument.vibrato.rate, startTime);
            vibratoGain.gain.setValueAtTime(frequency * instrument.vibrato.depth, startTime);
            vibrato.connect(vibratoGain);
            vibratoGain.connect(mainOsc.frequency);
            vibrato.start(startTime);
            oscillators.push(vibrato);
        }

        mainOsc.connect(mainGain);
        mainGain.connect(masterGain);
        mainOsc.start(startTime);

        oscillators.push(mainOsc);
        gainNodes.push(mainGain);

        if (instrument.breathNoise) {
            const noiseBuffer = this.createNoiseBuffer(0.2);
            const noiseSource = this.audioContext.createBufferSource();
            const noiseGain = this.audioContext.createGain();
            const noiseFilter = this.audioContext.createBiquadFilter();

            noiseSource.buffer = noiseBuffer;
            noiseSource.loop = true;
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.setValueAtTime(frequency * 2.5, startTime);
            noiseGain.gain.setValueAtTime(volume * instrument.breathNoise, startTime);

            noiseSource.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(masterGain);
            noiseSource.start(startTime);

            oscillators.push(noiseSource);
            gainNodes.push(noiseGain);
        }

        const filter = this.audioContext.createBiquadFilter();
        filter.type = instrument.filterType;
        filter.frequency.setValueAtTime(instrument.filterFreq, startTime);
        filter.Q.setValueAtTime(instrument.filterQ, startTime);

        masterGain.connect(filter);
        filter.connect(this.masterGain);

        return { oscillators, gainNodes, masterGain, filter };
    }

    createNoiseBuffer(duration = 2) {
        const bufferSize = this.audioContext.sampleRate * duration;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        return buffer;
    }

    createSimpleVoice(frequency, instrument, volume, startTime) {
        const oscillators = [];
        const gainNodes = [];
        const masterGain = this.audioContext.createGain();

        instrument.harmonics.forEach((harmonic, index) => {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency * (index + 1), startTime);

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(harmonic * volume * instrument.volume, startTime + instrument.attack);
            gain.gain.exponentialRampToValueAtTime(harmonic * volume * instrument.sustain * instrument.volume, startTime + instrument.attack + instrument.decay);

            osc.connect(gain);
            gain.connect(masterGain);
            osc.start(startTime);

            oscillators.push(osc);
            gainNodes.push(gain);
        });

        const filter = this.audioContext.createBiquadFilter();
        filter.type = instrument.filterType;
        filter.frequency.setValueAtTime(instrument.filterFreq, startTime);
        filter.Q.setValueAtTime(instrument.filterQ, startTime);

        masterGain.connect(filter);
        filter.connect(this.masterGain);

        return { oscillators, gainNodes, masterGain, filter };
    }

    stopNoteOptimized(noteKey, releaseTime = 0.5) {
        const nodes = this.audioNodes.get(noteKey);
        if (nodes) {
            const now = this.audioContext.currentTime;
            nodes.gainNodes.forEach(gain => {
                gain.gain.cancelScheduledValues(now);
                gain.gain.setValueAtTime(gain.gain.value, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + releaseTime);
            });
            nodes.oscillators.forEach(osc => osc.stop(now + releaseTime));
            this.audioNodes.delete(noteKey);
            this.activeNotes.delete(parseInt(noteKey.split('-')[0]));
        }
    }

    scheduleChordOff(handType, finger) {
        const key = `${handType}-${finger}`;
        if (this.sustainTimeouts.has(key)) {
            clearTimeout(this.sustainTimeouts.get(key));
        }
        const timeout = setTimeout(() => {
            this.sustainTimeouts.delete(key);
        }, 100);
        this.sustainTimeouts.set(key, timeout);
    }

    stopAllNotes() {
        this.audioNodes.forEach((nodes, key) => {
            this.stopNoteOptimized(key, 0.1);
        });
        this.activeNotes.clear();
        this.sustainTimeouts.forEach(timeout => clearTimeout(timeout));
        this.sustainTimeouts.clear();
    }

    midiToFreq(midiNote) {
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    getHandCenter(landmarks) {
        const palmLandmarks = [0, 5, 9, 13, 17];
        let sumX = 0, sumY = 0;

        palmLandmarks.forEach(i => {
            sumX += landmarks[i].x;
            sumY += landmarks[i].y;
        });

        return {
            x: sumX / palmLandmarks.length,
            y: sumY / palmLandmarks.length
        };
    }

    highlightChord(handType, finger, active) {
        const element = document.getElementById(`${handType}-${finger}`);
        if (element) {
            element.classList.toggle('active', active);
        }
    }

    clearActiveChords() {
        document.querySelectorAll('.finger-chord.active').forEach(el => {
            el.classList.remove('active');
        });
    }

    clearCanvas() {
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }

    updateStatus(message, type) {
        this.statusDisplay.textContent = message;
        this.statusDisplay.className = `status ${type}`;
    }

    startPerformanceMonitoring() {
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
    }

    updateFPS() {
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime >= 1000) {
            const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
            this.fpsDisplay.textContent = `FPS: ${fps}`;
            this.frameCount = 0;
            this.lastFpsTime = now;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new OptimizedHandGestureMIDI();
});