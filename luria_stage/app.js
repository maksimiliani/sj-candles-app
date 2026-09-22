// Luria compact state + voice test harness
// BUILD: LURIA-WEB-STATES-v1
//
// Expected Rive setup:
// - assets/luria.riv
// - State Machine: "Luria State Machine"
// - Default View Model / Default Instance bound to the artboard
// - Enum:   state = Idle | Listening | Thinking | Speaking
// - Number: userVoiceLevel  = 0..3
// - Number: luriaVoiceLevel = 0..3
//
// The tester intentionally surfaces only 3 modes:
// - User speaking  -> Rive state "Listening"
// - Thinking       -> Rive state "Thinking"
// - Luria speaking -> Rive state "Speaking"

const BUILD_ID = "LURIA-WEB-STATES-v1";
const RIVE_FILE = "./assets/luria.riv";
const STATE_MACHINE = "Luria State Machine";

const STATE_PROPERTY = "state";
const USER_VOICE_PROPERTY = "userVoiceLevel";
const LURIA_VOICE_PROPERTY = "luriaVoiceLevel";

const canvas = document.getElementById("rive-canvas");
const loading = document.getElementById("loading");
const riveStatus = document.getElementById("rive-status");

const modeButtons = [...document.querySelectorAll(".mode-button")];

const userPanel = document.getElementById("user-panel");
const thinkingPanel = document.getElementById("thinking-panel");
const luriaPanel = document.getElementById("luria-panel");

const userSlider = document.getElementById("user-level");
const userOutput = document.getElementById("user-output");
const luriaSlider = document.getElementById("luria-level");
const luriaOutput = document.getElementById("luria-output");

const userMicButton = document.getElementById("user-mic");
const luriaMicButton = document.getElementById("luria-mic");
const micStatus = document.getElementById("mic-status");

let r = null;
let stateProp = null;
let userVoiceProp = null;
let luriaVoiceProp = null;

let currentMode = "Listening";

let mediaStream = null;
let audioContext = null;
let analyser = null;
let timeData = null;
let micRAF = null;
let micTarget = null; // "user" | "luria" | null
let smoothedMicLevel = 0;
let renderingWatchdog = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setRiveStatus(type, title) {
  if (!riveStatus) return;
  riveStatus.className = `status-dot ${type || ""}`.trim();
  riveStatus.title = title;
}

function keepRiveAwake() {
  if (!r) return;
  try {
    r.startRendering();
  } catch (err) {
    console.warn("[Luria] startRendering:", err);
  }
}

function updateUserVoice(value, fromMic = false) {
  const v = clamp(Number(value) || 0, 0, 3);

  if (userOutput) userOutput.textContent = v.toFixed(2);

  if (fromMic && userSlider) {
    userSlider.value = v.toFixed(2);
  }

  if (userVoiceProp) {
    userVoiceProp.value = v;
    keepRiveAwake();
  }
}

function updateLuriaVoice(value, fromMic = false) {
  const v = clamp(Number(value) || 0, 0, 3);

  if (luriaOutput) luriaOutput.textContent = v.toFixed(2);

  if (fromMic && luriaSlider) {
    luriaSlider.value = v.toFixed(2);
  }

  if (luriaVoiceProp) {
    luriaVoiceProp.value = v;
    keepRiveAwake();
  }
}

function setState(value) {
  if (!stateProp) return;

  try {
    stateProp.value = value;
    keepRiveAwake();
  } catch (err) {
    console.error(`[Luria] Could not set state="${value}"`, err);
    setRiveStatus("error", `Could not set Rive state: ${value}`);
  }
}

async function setMode(mode) {
  if (!["Listening", "Thinking", "Speaking"].includes(mode)) return;

  // A microphone session is tied to one voice property.
  // Stop it when changing mode so it can never drive the wrong signal.
  if (micTarget) {
    await stopMicrophone();
  }

  currentMode = mode;

  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  userPanel?.classList.toggle("hidden", mode !== "Listening");
  thinkingPanel?.classList.toggle("hidden", mode !== "Thinking");
  luriaPanel?.classList.toggle("hidden", mode !== "Speaking");

  // Prevent stale voice values from leaking into other visual states.
  if (mode === "Listening") {
    updateLuriaVoice(0);
  } else if (mode === "Thinking") {
    updateUserVoice(0);
    updateLuriaVoice(0);
  } else if (mode === "Speaking") {
    updateUserVoice(0);
  }

  setState(mode);
}

function bindViewModel() {
  const vmi = r?.viewModelInstance;

  if (!vmi) {
    setRiveStatus("error", "No bound View Model instance");
    console.error(
      "[Luria] No auto-bound View Model Instance. " +
      "Assign the Luria View Model to the artboard and mark an instance as Default."
    );
    return false;
  }

  try {
    stateProp = vmi.enum(STATE_PROPERTY);
  } catch (err) {
    console.error(`[Luria] Enum "${STATE_PROPERTY}" unavailable`, err);
  }

  try {
    userVoiceProp = vmi.number(USER_VOICE_PROPERTY);
  } catch (err) {
    console.error(`[Luria] Number "${USER_VOICE_PROPERTY}" unavailable`, err);
  }

  try {
    luriaVoiceProp = vmi.number(LURIA_VOICE_PROPERTY);
  } catch (err) {
    console.error(`[Luria] Number "${LURIA_VOICE_PROPERTY}" unavailable`, err);
  }

  if (!stateProp || !userVoiceProp || !luriaVoiceProp) {
    setRiveStatus("error", "One or more View Model properties are missing");
    return false;
  }

  // Initial tester state.
  updateUserVoice(Number(userSlider?.value || 0));
  updateLuriaVoice(Number(luriaSlider?.value || 0));
  setState(currentMode);

  setRiveStatus("ok", "Rive connected");
  return true;
}

function cleanupRive() {
  stateProp = null;
  userVoiceProp = null;
  luriaVoiceProp = null;

  if (renderingWatchdog) {
    clearInterval(renderingWatchdog);
    renderingWatchdog = null;
  }

  if (r) {
    try {
      r.cleanup();
    } catch (err) {
      console.warn("[Luria] cleanup:", err);
    }
    r = null;
  }
}

function loadRive() {
  cleanupRive();

  loading?.classList.remove("hidden");
  setRiveStatus("", "Loading Rive");

  if (!window.rive?.Rive) {
    setRiveStatus("error", "Rive WebGL2 runtime did not load");
    if (loading) {
      loading.querySelector("strong").textContent = "Unable to load Rive";
      loading.querySelector("span").textContent = "WebGL2 runtime is unavailable.";
    }
    return;
  }

  const params = {
    src: RIVE_FILE,
    canvas,
    artboard: "Final",
    stateMachines: "Luria State Machine",
    autoplay: true,
    autoBind: true,
    useOffscreenRenderer: false,
    enablePerfMarks: true,

    onLoad: () => {
      r.resizeDrawingSurfaceToCanvas();

      try {
        r.play();
      } catch (_) {}

      keepRiveAwake();

      const bound = bindViewModel();

      // Let the first bound frame render before fading out the loader.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (bound) loading?.classList.add("hidden");
        });
      });

      renderingWatchdog = window.setInterval(() => {
        if (r && document.visibilityState === "visible") {
          keepRiveAwake();
        }
      }, 1000);

      console.log(`[Luria] ${BUILD_ID} loaded`);
    },

    onLoadError: (err) => {
      console.error("[Luria] Rive load error:", err);
      setRiveStatus("error", "Could not load assets/luria.riv");

      if (loading) {
        loading.querySelector("strong").textContent = "Luria could not load";
        loading.querySelector("span").textContent = "Check assets/luria.riv.";
      }
    },
  };

  // Scripted/procedural effects need continuous drawing.
  if (
    window.rive.DrawOptimizationOptions &&
    window.rive.DrawOptimizationOptions.AlwaysDraw !== undefined
  ) {
    params.drawingOptions = window.rive.DrawOptimizationOptions.AlwaysDraw;
  }

  try {
    r = new window.rive.Rive(params);
  } catch (err) {
    console.error("[Luria] Rive init error:", err);
    setRiveStatus("error", "Rive initialization failed");

    if (loading) {
      loading.querySelector("strong").textContent = "Luria could not start";
      loading.querySelector("span").textContent = "Rive initialization failed.";
    }
  }
}

// -----------------------
// Microphone
// -----------------------

async function startMicrophone(target) {
  if (!["user", "luria"].includes(target)) return;
  if (micTarget) return;

  const targetProp = target === "user" ? userVoiceProp : luriaVoiceProp;

  if (!targetProp) {
    console.warn("[Luria] Microphone requested before View Model was ready.");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    micStatus.textContent = "Microphone is not supported in this browser.";
    return;
  }

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

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(mediaStream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;

    source.connect(analyser);
    timeData = new Float32Array(analyser.fftSize);

    micTarget = target;
    smoothedMicLevel =
      target === "user"
        ? Number(userSlider?.value || 0)
        : Number(luriaSlider?.value || 0);

    refreshMicButtons();

    micStatus.textContent =
      target === "user"
        ? "Microphone → userVoiceLevel"
        : "Microphone → luriaVoiceLevel";

    keepRiveAwake();
    tickMicrophone();
  } catch (err) {
    console.error("[Luria] Microphone error:", err);
    micStatus.textContent =
      "Microphone permission failed. Use HTTPS or localhost and allow access.";
  }
}

function tickMicrophone() {
  if (!micTarget || !analyser || !timeData) return;

  analyser.getFloatTimeDomainData(timeData);

  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i++) {
    sumSquares += timeData[i] * timeData[i];
  }

  const rms = Math.sqrt(sumSquares / timeData.length);

  // Same practical mapping used by the previous tester:
  // quiet -> 0, normal speech -> roughly 1–2.5, strong speech -> 3.
  const noiseGate = 0.015;
  const aboveGate = Math.max(0, rms - noiseGate);
  const normalized = clamp(aboveGate * 15, 0, 1);
  const target = Math.pow(normalized, 0.72) * 3;

  const follow = target > smoothedMicLevel ? 0.28 : 0.09;

  smoothedMicLevel +=
    (target - smoothedMicLevel) * follow;

  if (smoothedMicLevel < 0.015) {
    smoothedMicLevel = 0;
  }

  if (micTarget === "user") {
    updateUserVoice(smoothedMicLevel, true);
  } else {
    updateLuriaVoice(smoothedMicLevel, true);
  }

  micRAF = requestAnimationFrame(tickMicrophone);
}

async function stopMicrophone() {
  if (micRAF) {
    cancelAnimationFrame(micRAF);
    micRAF = null;
  }

  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;

  if (audioContext) {
    try {
      await audioContext.close();
    } catch (_) {}
    audioContext = null;
  }

  analyser = null;
  timeData = null;
  micTarget = null;
  smoothedMicLevel = 0;

  refreshMicButtons();

  if (micStatus) {
    micStatus.textContent = "Microphone is off.";
  }
}

function refreshMicButtons() {
  const userOn = micTarget === "user";
  const luriaOn = micTarget === "luria";

  if (userMicButton) {
    userMicButton.classList.toggle("active", userOn);
    userMicButton.textContent = userOn ? "Stop microphone" : "Use microphone";
  }

  if (luriaMicButton) {
    luriaMicButton.classList.toggle("active", luriaOn);
    luriaMicButton.textContent = luriaOn ? "Stop microphone" : "Use microphone";
  }
}

// -----------------------
// UI events
// -----------------------

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
  });
});

userSlider?.addEventListener("input", () => {
  const value = Number(userSlider.value);
  if (userOutput) userOutput.textContent = value.toFixed(2);

  if (micTarget !== "user") {
    updateUserVoice(value);
  }
});

luriaSlider?.addEventListener("input", () => {
  const value = Number(luriaSlider.value);
  if (luriaOutput) luriaOutput.textContent = value.toFixed(2);

  if (micTarget !== "luria") {
    updateLuriaVoice(value);
  }
});

userMicButton?.addEventListener("click", async () => {
  if (micTarget === "user") {
    await stopMicrophone();
  } else if (!micTarget) {
    await startMicrophone("user");
  }
});

luriaMicButton?.addEventListener("click", async () => {
  if (micTarget === "luria") {
    await stopMicrophone();
  } else if (!micTarget) {
    await startMicrophone("luria");
  }
});

// Resume procedural Rive scripts after tab/browser suspension.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && r) {
    try {
      r.play();
    } catch (_) {}
    keepRiveAwake();
  }
});

window.addEventListener("focus", keepRiveAwake);

window.addEventListener(
  "resize",
  () => r?.resizeDrawingSurfaceToCanvas(),
  { passive: true }
);

window.addEventListener("beforeunload", () => {
  stopMicrophone();
  cleanupRive();
});

refreshMicButtons();
loadRive();
