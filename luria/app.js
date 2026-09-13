// Luria voice test harness
//
// Expected Rive setup:
// - assets/luria.riv
// - State Machine: "Luria State Machine"
// - Default View Model / Default Instance bound to the artboard
// - Number property: voiceLevel (0..3)
//
// If your state machine has another name, change STATE_MACHINE below.

const RIVE_FILE = "./assets/luria.riv";
const STATE_MACHINE = "Luria State Machine";
const VOICE_PROPERTY = "voiceLevel";

const canvas = document.getElementById("rive-canvas");
const loading = document.getElementById("loading");
const riveStatus = document.getElementById("rive-status");
const diagnostics = document.getElementById("diagnostics");

const micButton = document.getElementById("mic-button");
const stopButton = document.getElementById("stop-button");
const manualSlider = document.getElementById("manual-level");
const manualOutput = document.getElementById("manual-output");
const voiceValue = document.getElementById("voice-value");
const voiceMeter = document.getElementById("voice-meter");

const sensitivitySlider = document.getElementById("sensitivity");
const sensitivityOutput = document.getElementById("sensitivity-output");
const gateSlider = document.getElementById("noise-gate");
const gateOutput = document.getElementById("gate-output");
const attackSlider = document.getElementById("attack");
const attackOutput = document.getElementById("attack-output");
const releaseSlider = document.getElementById("release");
const releaseOutput = document.getElementById("release-output");

let r = null;
let voiceProp = null;

let mediaStream = null;
let audioContext = null;
let analyser = null;
let timeData = null;
let micRAF = null;
let micActive = false;
let smoothedLevel = 0;

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  diagnostics.textContent = `[${stamp}] ${message}\n` + diagnostics.textContent;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setVoiceLevel(value, source = "manual") {
  const v = clamp(Number(value) || 0, 0, 3);

  voiceValue.textContent = v.toFixed(2);
  voiceMeter.style.width = `${(v / 3) * 100}%`;

  if (source === "mic") {
    manualSlider.value = v.toFixed(2);
    manualOutput.textContent = v.toFixed(2);
  }

  if (voiceProp) {
    voiceProp.value = v;
  }
}

function updateControlLabels() {
  sensitivityOutput.textContent = `${Number(sensitivitySlider.value).toFixed(2)}×`;
  gateOutput.textContent = Number(gateSlider.value).toFixed(3);
  attackOutput.textContent = Number(attackSlider.value).toFixed(2);
  releaseOutput.textContent = Number(releaseSlider.value).toFixed(2);
}

[sensitivitySlider, gateSlider, attackSlider, releaseSlider].forEach((el) => {
  el.addEventListener("input", updateControlLabels);
});
updateControlLabels();

manualSlider.addEventListener("input", () => {
  const v = Number(manualSlider.value);
  manualOutput.textContent = v.toFixed(2);
  if (!micActive) setVoiceLevel(v, "manual");
});

function bindVoiceProperty() {
  const vmi = r?.viewModelInstance;

  if (!vmi) {
    riveStatus.textContent = "No bound View Model";
    riveStatus.className = "badge error";
    log(
      "No View Model Instance was auto-bound. In Rive, assign the Luria View Model to the artboard and mark an instance as Default."
    );
    return;
  }

  try {
    voiceProp = vmi.number(VOICE_PROPERTY);
  } catch (err) {
    voiceProp = null;
    log(`Could not access Number property "${VOICE_PROPERTY}": ${err}`);
  }

  if (!voiceProp) {
    riveStatus.textContent = "voiceLevel missing";
    riveStatus.className = "badge error";
    log(
      `The bound View Model exists, but Number property "${VOICE_PROPERTY}" was not found.`
    );
    return;
  }

  riveStatus.textContent = "Rive connected";
  riveStatus.className = "badge ok";
  log(`Bound runtime property: ${VOICE_PROPERTY}`);
  setVoiceLevel(Number(manualSlider.value), "manual");
}

function loadRive() {
  diagnostics.textContent = "Loading Rive…";

  try {
    r = new rive.Rive({
      src: RIVE_FILE,
      canvas,
      autoplay: true,
      autoBind: true,
      stateMachines: STATE_MACHINE,
      onLoad: () => {
        r.resizeDrawingSurfaceToCanvas();
        loading.classList.add("hidden");
        log(`Loaded ${RIVE_FILE}`);
        bindVoiceProperty();
      },
      onLoadError: (err) => {
        riveStatus.textContent = "Rive load error";
        riveStatus.className = "badge error";
        loading.textContent = "Could not load assets/luria.riv";
        log(`Rive load error: ${String(err)}`);
      },
    });

    window.addEventListener("resize", () => {
      r?.resizeDrawingSurfaceToCanvas();
    });
  } catch (err) {
    riveStatus.textContent = "Rive init error";
    riveStatus.className = "badge error";
    loading.textContent = "Rive initialization failed";
    log(`Rive init error: ${err}`);
  }
}

async function startMicrophone() {
  if (micActive) return;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      video: false,
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);

    timeData = new Float32Array(analyser.fftSize);
    micActive = true;
    smoothedLevel = Number(manualSlider.value) || 0;

    micButton.disabled = true;
    stopButton.disabled = false;
    micButton.textContent = "Microphone active";
    log("Microphone enabled.");

    tickMicrophone();
  } catch (err) {
    log(`Microphone error: ${err}`);
    alert(
      "Microphone permission failed. Use HTTPS (GitHub Pages works) or localhost, then allow microphone access."
    );
  }
}

function tickMicrophone() {
  if (!micActive || !analyser) return;

  analyser.getFloatTimeDomainData(timeData);

  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i++) {
    const sample = timeData[i];
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / timeData.length);

  const gate = Number(gateSlider.value);
  const sensitivity = Number(sensitivitySlider.value);

  // Tuned as a practical speech mapping rather than a raw dB meter:
  // silence -> 0, normal speech -> roughly 1–2.5, strong speech -> up to 3.
  const aboveGate = Math.max(0, rms - gate);
  const normalized = clamp(aboveGate * 15 * sensitivity, 0, 1);
  const target = Math.pow(normalized, 0.72) * 3;

  const attack = Number(attackSlider.value);
  const release = Number(releaseSlider.value);
  const follow = target > smoothedLevel ? attack : release;

  smoothedLevel += (target - smoothedLevel) * follow;

  if (smoothedLevel < 0.015) smoothedLevel = 0;

  setVoiceLevel(smoothedLevel, "mic");

  micRAF = requestAnimationFrame(tickMicrophone);
}

async function stopMicrophone() {
  micActive = false;

  if (micRAF) {
    cancelAnimationFrame(micRAF);
    micRAF = null;
  }

  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;

  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }

  analyser = null;
  timeData = null;

  micButton.disabled = false;
  stopButton.disabled = true;
  micButton.textContent = "Enable microphone";

  const manual = Number(manualSlider.value);
  setVoiceLevel(manual, "manual");
  log("Microphone stopped; returned to manual control.");
}

micButton.addEventListener("click", startMicrophone);
stopButton.addEventListener("click", stopMicrophone);

loadRive();
