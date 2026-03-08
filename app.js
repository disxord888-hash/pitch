let audioCtx;
let analyser;
let source;
let stream;
let animationId;
const fftSize = 4096;
const bufferLength = fftSize;
const dataArray = new Float32Array(bufferLength);

const noteDisplay = document.getElementById('note-display');
const freqValue = document.getElementById('freq-value');
const vocalRange = document.getElementById('vocal-range');
const offsetSlider = document.getElementById('offset-slider');
const offsetValue = document.getElementById('offset-value');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusBadge = document.getElementById('status-badge');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');

const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// オフセット（半音）
let pitchOffset = 0;

offsetSlider.addEventListener('input', (e) => {
    pitchOffset = parseInt(e.target.value);
    offsetValue.textContent = (pitchOffset >= 0 ? '+' : '') + pitchOffset;
});

startBtn.addEventListener('click', async () => {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = fftSize;

        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusBadge.textContent = 'ACTIVE';
        statusBadge.classList.add('active');

        draw();
        detectPitch();
    } catch (err) {
        console.error('Error accessing microphone:', err);
        alert('マイクへのアクセスが拒否されました。設定を確認してください。');
    }
});

stopBtn.addEventListener('click', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (audioCtx) {
        audioCtx.close();
    }
    cancelAnimationFrame(animationId);

    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusBadge.textContent = 'READY';
    statusBadge.classList.remove('active');

    noteDisplay.textContent = '--';
    freqValue.textContent = '0.00';
    vocalRange.textContent = '---';
});

function detectPitch() {
    analyser.getFloatTimeDomainData(dataArray);

    let freq = autoCorrelate(dataArray, audioCtx.sampleRate);

    // 高周波（2000Hz以上など）や自己相関で取れなかった場合のFFT補完
    if (freq === -1 || freq > 2000) {
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);
        let maxVal = -1;
        let maxIdx = -1;
        for (let i = 0; i < freqData.length; i++) {
            if (freqData[i] > maxVal) {
                maxVal = freqData[i];
                maxIdx = i;
            }
        }
        if (maxVal > 100) { // 一定以上の強さがある場合
            const fftFreq = maxIdx * audioCtx.sampleRate / analyser.fftSize;
            // 自己相関の結果が著しく違う場合はFFT側を優先（超高域対応のため）
            if (freq === -1 || Math.abs(freq - fftFreq) > fftFreq * 0.2) {
                freq = fftFreq;
            }
        }
    }

    if (freq !== -1 && freq <= 22000) {
        const adjustedFreq = freq * Math.pow(2, pitchOffset / 12);

        freqValue.textContent = adjustedFreq.toFixed(2);

        const noteNum = 12 * (Math.log(adjustedFreq / 440) / Math.log(2)) + 69;

        if (!isNaN(noteNum) && isFinite(noteNum)) {
            const noteIndex = Math.round(noteNum) % 12;
            noteDisplay.textContent = noteStrings[(noteIndex + 12) % 12] || '--';
            vocalRange.textContent = getJapaneseVocalRange(Math.round(noteNum));
        }
    } else {
        // 音が検出されない場合
        // noteDisplay.textContent = '--';
        // freqValue.textContent = '0.00';
    }

    animationId = requestAnimationFrame(detectPitch);
}

// 自己相関関数（Autocorrelation）の最適化版
function autoCorrelate(buf, sampleRate) {
    let SIZE = buf.length;
    let rms = 0;

    for (let i = 0; i < SIZE; i++) {
        const val = buf[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);

    if (rms < 0.005) return -1; // ノイズ閾値を下げてより繊細に

    let r1 = 0, r2 = SIZE - 1;
    let thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
        if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    }

    buf = buf.slice(r1, r2);
    SIZE = buf.length;

    // 自己相関の計算（ラグを制限して高速化）
    // 20Hzまで対応する場合、44.1kHzでラグは約2205までで良い
    const maxLag = Math.min(SIZE, Math.floor(sampleRate / 20));
    const c = new Float32Array(maxLag).fill(0);
    for (let i = 0; i < maxLag; i++) {
        for (let j = 0; j < SIZE - i; j++) {
            c[i] = c[i] + buf[j] * buf[j + i];
        }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < maxLag; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }

    if (maxpos === -1) return -1;

    let T0 = maxpos;

    // 放物線補間
    if (T0 > 0 && T0 < maxLag - 1) {
        const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
        const a = (x1 + x3 - 2 * x2) / 2;
        const b = (x3 - x1) / 2;
        if (a) T0 = T0 - b / (2 * a);
    }

    return sampleRate / T0;
}

function getJapaneseVocalRange(noteNum) {
    const octave = Math.floor(noteNum / 12) - 1;
    const noteName = noteStrings[(noteNum % 12 + 12) % 12];

    const rangeMap = {
        "-1": "lowlowlowlow",
        "0": "lowlowlow",
        "1": "lowlow",
        "2": "low",
        "3": "mid",
        "4": "hi",
        "5": "hihi",
        "6": "hihihi",
        "7": "hihihihi",
        "8": "hihihihihi",
        "9": "hihihihihihi"
    };

    let prefix = rangeMap[octave] || (octave < -1 ? "LOWLOWLOWLOW" : "hihihihihi");

    return `${prefix}${noteName}/${noteName}${octave}`;
}

function draw() {
    const drawVisual = requestAnimationFrame(draw);

    // 波形データ
    analyser.getFloatTimeDomainData(dataArray);

    // 周波数データ（スペクトラム）
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);

    canvasCtx.fillStyle = '#0a0a0c';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    // スペクトラム（背景として薄く表示）
    const barWidth = (canvas.width / analyser.frequencyBinCount) * 2.5;
    let barHeight;
    let x_freq = 0;

    for (let i = 0; i < analyser.frequencyBinCount; i++) {
        barHeight = (freqData[i] / 255) * canvas.height;
        canvasCtx.fillStyle = `hsla(${260 + freqData[i] / 3}, 100%, 50%, 0.2)`;
        canvasCtx.fillRect(x_freq, canvas.height - barHeight, barWidth, barHeight);
        x_freq += barWidth + 1;
    }

    // 波形描画
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#00f2ff';
    canvasCtx.shadowBlur = 10;
    canvasCtx.shadowColor = '#00f2ff';
    canvasCtx.beginPath();

    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] * 0.8; // 少し抑えめに
        const y = canvas.height / 2 + v * canvas.height / 2;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0;
}

// キャンバスサイズの初期化
function resizeCanvas() {
    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
