// ------------------------------------------------------------
// LURIA IMMERSIVE WEB DEMO
// ------------------------------------------------------------
//
// Flow:
//   Load Luria -> Load audio -> ask for microphone + sound
//   -> Listening
//   -> Thinking
//   -> Speaking
//   -> Listening again
//
// Background ambience:
//   bg-ambient.mp3 starts after the user enables microphone + sound,
//   loops at 20% volume, pauses while the page is hidden, and resumes
//   when the user returns.
//
// Short prompt:
//   Plays once per session only when the user has not started
//   speaking after the configured listening delay.
//
// Long response:
//   Plays after the user's turn + thinking delay. Its live audio
//   level drives Rive's luriaVoiceLevel property.
// ------------------------------------------------------------
const RIVE_RENDER_DPR = 1.25;

const BUILD_ID = "LURIA-IMMERSIVE-v2-VOICE-GATE";

const RIVE_FILE = "./assets/luria.riv?v=20260923-1";
const SHORT_AUDIO_FILE = "./assets/Luria-Short.mp3";
const LONG_AUDIO_FILE = "./assets/Luria-Long.mp3";
const BACKGROUND_AUDIO_FILE = "./assets/bg-ambient.mp3";
const BACKGROUND_VOLUME = 0.08;

const ARTBOARD = "Final";
const STATE_MACHINE = "Luria State Machine";

const STATE_PROPERTY = "state";
const USER_VOICE_PROPERTY = "userVoiceLevel";
const LURIA_VOICE_PROPERTY = "luriaVoiceLevel";

// ------------------------------------------------------------
// CONVERSATION TUNING
// ------------------------------------------------------------
// These are the main values to fine-tune later.

// How long Luria waits for the user to begin speaking
// before playing the one-time short nudge.
const SHORT_PROMPT_DELAY_MS = 4000;

// Silence after USER finishes speaking before Luria starts Thinking.
// Previously: 6500
const SILENCE_TO_THINK_MS = 3000;

// How long Luria stays in Thinking before answering.
const THINKING_DURATION_MS = 7000;

// Pause after Luria finishes speaking before returning to Listening.
// Previously: 3500
const POST_SPEECH_PAUSE_MS = 2000;

// Voice activity detection lives entirely in web JS. Rive only receives
// the resulting state + voice level for visuals.
//
// Listening is intentionally more sensitive than Thinking. While the
// one-time short nudge is playing, use a stronger gate so Luria's own
// speaker output is much less likely to be mistaken for the user.

const LISTENING_ACTIVITY_LEVEL = 0.38;
const LISTENING_ACTIVITY_HOLD_MS = 220;

// During Thinking we require MUCH clearer/louder speech
// before allowing the user to interrupt Luria.
//
// Previously: 0.46
// +0.30 = 0.76
const THINKING_ACTIVITY_LEVEL = 0.76;
// Also require the sound to persist slightly longer,
// so a bang/click/door/etc. doesn't interrupt Thinking.
const THINKING_ACTIVITY_HOLD_MS = 350;

// While the short Luria nudge is playing.
const SHORT_NUDGE_ACTIVITY_LEVEL = 0.76;
const SHORT_NUDGE_ACTIVITY_HOLD_MS = 350;

// Very low residual room noise should not animate Luria's user-voice
// visuals even though we continue analysing the microphone internally.
const USER_VISUAL_GATE_LEVEL = 0.12;

// Reset is treated as a fresh demo session. Set false if Reset should
// preserve the "short prompt already used" memory.
const RESET_STARTS_NEW_SESSION = true;

// ------------------------------------------------------------
// AUDIO LEVEL TUNING
// ------------------------------------------------------------

const MIC_NOISE_GATE = 0.014;
const MIC_GAIN = 14.0;
const MIC_POWER = 0.72;

const LURIA_AUDIO_NOISE_GATE = 0.004;
const LURIA_AUDIO_GAIN = 8.5;
const LURIA_AUDIO_POWER = 0.66;

// ------------------------------------------------------------
// DOM
// ------------------------------------------------------------

const canvas = document.getElementById("rive-canvas");

const loading = document.getElementById("loading");
const loaderPercent = document.getElementById("loader-percent");
const loaderTitle = document.getElementById("loader-title");
const loaderDetail = document.getElementById("loader-detail");
const loaderBar = document.getElementById("loader-bar");
const loaderStepLuria = document.getElementById("loader-step-luria");
const loaderStepAudio = document.getElementById("loader-step-audio");

const permissionGate = document.getElementById("permission-gate");
const startExperienceButton = document.getElementById("start-experience");
const permissionStatus = document.getElementById("permission-status");

const experienceHud = document.getElementById("experience-hud");
const sessionIndicator = document.querySelector(".session-indicator");
const stateLabel = document.getElementById("state-label");
const micDot = document.getElementById("mic-dot");
const resetButton = document.getElementById("reset-demo");
const experienceStatus = document.getElementById("experience-status");

// ------------------------------------------------------------
// RIVE
// ------------------------------------------------------------

let r = null;
let stateProp = null;
let userVoiceProp = null;
let luriaVoiceProp = null;
let continuousRenderRAF = null;
let tabSuspended = false;

// ------------------------------------------------------------
// SESSION / STATE
// ------------------------------------------------------------

let currentMode = "Listening";
let experienceStarted = false;
let conversationGeneration = 0;

let shortPromptPlayed = false;
let shortPromptEligible = true;
let userHasEverSpoken = false;
let hasSpeechInCurrentTurn = false;
let lastUserVoiceAt = 0;
let activityCandidateSince = 0;

let shortPromptTimer = null;
let thinkingTimer = null;
let postSpeechTimer = null;

// ------------------------------------------------------------
// MICROPHONE / WEB AUDIO
// ------------------------------------------------------------

let audioContext = null;
let mediaStream = null;
let micSource = null;
let micAnalyser = null;
let micData = null;
let micRAF = null;
let smoothedMicLevel = 0;

// ------------------------------------------------------------
// LURIA MP3 AUDIO
// ------------------------------------------------------------

const audioAssets = {
  short: {
    url: SHORT_AUDIO_FILE,
    objectUrl: null,
    element: null,
    source: null,
    analyser: null,
    data: null,
  },
  long: {
    url: LONG_AUDIO_FILE,
    objectUrl: null,
    element: null,
    source: null,
    analyser: null,
    data: null,
  },
};

let activeAudio = null;
let luriaAudioRAF = null;
let smoothedLuriaLevel = 0;

// ------------------------------------------------------------
// BACKGROUND AMBIENCE
// ------------------------------------------------------------

let backgroundAudio = null;
let backgroundAudioObjectUrl = null;
let backgroundWasPlayingBeforeHide = false;

// ============================================================
// GENERIC HELPERS
// ============================================================

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setLiveStatus(message) {
  if (experienceStatus) {
    experienceStatus.textContent = message;
  }
}

function clearTimer(timerName) {
  if (timerName === "short" && shortPromptTimer !== null) {
    clearTimeout(shortPromptTimer);
    shortPromptTimer = null;
  }

  if (timerName === "thinking" && thinkingTimer !== null) {
    clearTimeout(thinkingTimer);
    thinkingTimer = null;
  }

  if (timerName === "post" && postSpeechTimer !== null) {
    clearTimeout(postSpeechTimer);
    postSpeechTimer = null;
  }
}

function clearConversationTimers() {
  clearTimer("short");
  clearTimer("thinking");
  clearTimer("post");
}

// ============================================================
// LOADER
// ============================================================

function setLoaderProgress(percent, title, detail, step) {
  const safePercent = clamp(Number(percent) || 0, 0, 100);

  if (loaderPercent) {
    loaderPercent.textContent = `${Math.round(safePercent)}%`;
  }

  if (loaderBar) {
    loaderBar.style.transform = `scaleX(${safePercent / 100})`;
  }

  if (loaderTitle && title) {
    loaderTitle.textContent = title;
  }

  if (loaderDetail && detail) {
    loaderDetail.textContent = detail;
  }

  loaderStepLuria?.classList.toggle("active", step === "luria");
  loaderStepAudio?.classList.toggle("active", step === "audio");

  loaderStepLuria?.classList.toggle("done", step === "audio" || safePercent >= 100);
  loaderStepAudio?.classList.toggle("done", safePercent >= 100);
}

async function fetchAssetWithProgress(url, onProgress) {
  const response = await fetch(url, { cache: "force-cache" });

  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status})`);
  }

  const total = Number(response.headers.get("content-length")) || 0;

  if (!response.body?.getReader) {
    const blob = await response.blob();
    onProgress?.(1);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    received += value.byteLength;

    if (total > 0) {
      onProgress?.(clamp(received / total, 0, 1));
    }
  }

  onProgress?.(1);

  return new Blob(chunks, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}

async function warmRiveAsset() {
  setLoaderProgress(2, "Loading Luria", "Loading the visual experience…", "luria");

  await fetchAssetWithProgress(RIVE_FILE, (ratio) => {
    const p = 2 + ratio * 38;
    setLoaderProgress(p, "Loading Luria", "Loading the visual experience…", "luria");
  });
}

function makeAudioElement(blob, key) {
  const objectUrl = URL.createObjectURL(blob);
  const element = new Audio();

  element.preload = "auto";
  element.src = objectUrl;
  element.playsInline = true;

  audioAssets[key].objectUrl = objectUrl;
  audioAssets[key].element = element;

  return element;
}

function waitForAudioMetadata(element) {
  if (Number.isFinite(element.duration) && element.duration > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener("loadedmetadata", handleReady);
      element.removeEventListener("error", handleError);
    };

    const handleReady = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("Audio metadata could not be loaded."));
    };

    element.addEventListener("loadedmetadata", handleReady, { once: true });
    element.addEventListener("error", handleError, { once: true });
    element.load();
  });
}

async function loadAudioAssets() {
  setLoaderProgress(50, "Loading audio", "Loading audio • 1 of 3", "audio");

  const shortBlob = await fetchAssetWithProgress(SHORT_AUDIO_FILE, (ratio) => {
    setLoaderProgress(50 + ratio * 16, "Loading audio", "Loading audio • 1 of 3", "audio");
  });

  const shortElement = makeAudioElement(shortBlob, "short");
  await waitForAudioMetadata(shortElement);

  setLoaderProgress(67, "Loading audio", "Loading audio • 2 of 3", "audio");

  const longBlob = await fetchAssetWithProgress(LONG_AUDIO_FILE, (ratio) => {
    setLoaderProgress(67 + ratio * 16, "Loading audio", "Loading audio • 2 of 3", "audio");
  });

  const longElement = makeAudioElement(longBlob, "long");
  await waitForAudioMetadata(longElement);

  setLoaderProgress(84, "Loading audio", "Loading audio • 3 of 3", "audio");

  const backgroundBlob = await fetchAssetWithProgress(BACKGROUND_AUDIO_FILE, (ratio) => {
    setLoaderProgress(84 + ratio * 15, "Loading audio", "Loading audio • 3 of 3", "audio");
  });

  backgroundAudioObjectUrl = URL.createObjectURL(backgroundBlob);
  backgroundAudio = new Audio();
  backgroundAudio.preload = "auto";
  backgroundAudio.src = backgroundAudioObjectUrl;
  backgroundAudio.playsInline = true;
  backgroundAudio.loop = true;
  backgroundAudio.volume = BACKGROUND_VOLUME;

  await waitForAudioMetadata(backgroundAudio);

  setLoaderProgress(100, "Ready", "Luria is ready to listen.", "audio");
}

// ============================================================
// RIVE RENDERING
// ============================================================

function wakeRive() {
  if (!r) {
    return;
  }

  try {
    r.startRendering();
  } catch (_) {
    // Ignore transient rendering frames.
  }
}

function startContinuousRiveRendering() {
  stopContinuousRiveRendering();

  const tick = () => {
    if (r && document.visibilityState === "visible") {
      wakeRive();
    }

    continuousRenderRAF = requestAnimationFrame(tick);
  };

  continuousRenderRAF = requestAnimationFrame(tick);
}

function stopContinuousRiveRendering() {
  if (continuousRenderRAF !== null) {
    cancelAnimationFrame(continuousRenderRAF);
    continuousRenderRAF = null;
  }
}

function updateUserVoice(value) {
  const v = clamp(Number(value) || 0, 0, 3);

  if (userVoiceProp) {
    userVoiceProp.value = v;
    wakeRive();
  }
}

function updateLuriaVoice(value) {
  const v = clamp(Number(value) || 0, 0, 3);

  if (luriaVoiceProp) {
    luriaVoiceProp.value = v;
    wakeRive();
  }
}

function setRiveState(value) {
  if (!stateProp) {
    return;
  }

  try {
    stateProp.value = value;
    wakeRive();
  } catch (error) {
    console.error(`[Luria] Could not set Rive state "${value}"`, error);
  }
}

function bindViewModel() {
  const vmi = r?.viewModelInstance;

  if (!vmi) {
    throw new Error("No auto-bound Rive View Model instance was found.");
  }

  stateProp = vmi.enum(STATE_PROPERTY);
  userVoiceProp = vmi.number(USER_VOICE_PROPERTY);
  luriaVoiceProp = vmi.number(LURIA_VOICE_PROPERTY);

  if (!stateProp || !userVoiceProp || !luriaVoiceProp) {
    throw new Error("One or more required Rive View Model properties are missing.");
  }

  updateUserVoice(0);
  updateLuriaVoice(0);
  setRiveState("Listening");
}

function createRive() {
  return new Promise((resolve, reject) => {
    if (!window.rive?.Rive) {
      reject(new Error("Rive WebGL2 runtime is unavailable."));
      return;
    }

    const params = {
      src: RIVE_FILE,
      canvas,

      // IMPORTANT: keep the exact working Rive setup from the
      // previous demo. "Final" is the shader-wrapper artboard.
      artboard: ARTBOARD,
      stateMachines: STATE_MACHINE,

      // This was required in the working version. The state machine
      // must already be running for the Final artboard / scripted GPU
      // content to render correctly.
      autoplay: true,

      // Keep the View Model automatically bound exactly as before.
      autoBind: true,

      // Required by the GPUCanvas / WGSL content inside Luria.
      enableGPUCanvas: true,

      // GPUCanvas requires the offscreen renderer to remain disabled.
      useOffscreenRenderer: false,

      onLoad: () => {
        try {
          console.log(`[Luria] ${BUILD_ID} loaded`);

          // Keep the original working initialization order.
          r.resizeDrawingSurfaceToCanvas(RIVE_RENDER_DPR);

          try {
            // Explicitly play the state machine even though autoplay
            // is enabled. This is intentional and matches the previous
            // working setup.
            r.play(STATE_MACHINE);
          } catch (playError) {
            console.warn("[Luria] play:", playError);
          }

          // Wake the renderer immediately.
          wakeRive();

          // CRITICAL for the Node Script / GPUCanvas shader animation:
          // keep requesting frames even when the authored artboard looks
          // unchanged to the high-level runtime.
          startContinuousRiveRendering();

          // Bind state / userVoiceLevel / luriaVoiceLevel only after the
          // artboard + state machine are running.
          bindViewModel();

          // Give Rive two frames to finish the first visible GPU draw,
          // mirroring the previous working demo behavior.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              wakeRive();
              resolve();
            });
          });
        } catch (error) {
          console.error("[Luria] Rive onLoad setup failed:", error);
          reject(error);
        }
      },

      onLoadError: (error) => {
        console.error("FULL RIVE LOAD ERROR:", error);
        reject(new Error(String(error?.data || error || "Rive load failed")));
      },
    };

    // Force drawing exactly as in the previous working JS file.
    if (
      window.rive.DrawOptimizationOptions &&
      window.rive.DrawOptimizationOptions.AlwaysDraw !== undefined
    ) {
      params.drawingOptions =
        window.rive.DrawOptimizationOptions.AlwaysDraw;
    }

    try {
      r = new window.rive.Rive(params);
    } catch (error) {
      console.error("[Luria] Rive init error:", error);
      reject(error);
    }
  });
}

// ============================================================
// MODE / UI
// ============================================================

function setMode(mode) {
  if (!["Listening", "Thinking", "Speaking"].includes(mode)) {
    return;
  }

  currentMode = mode;

  if (sessionIndicator) {
    sessionIndicator.dataset.state = mode;
  }

  if (stateLabel) {
    stateLabel.textContent = mode;
  }

  if (micDot) {
    micDot.setAttribute(
      "aria-label",
      mode === "Listening" ? "Microphone active" : "Microphone monitoring"
    );
  }

  if (mode === "Listening") {
    updateLuriaVoice(0);
    setLiveStatus("Luria is listening.");
  } else if (mode === "Thinking") {
    updateUserVoice(0);
    updateLuriaVoice(0);
    setLiveStatus("Luria is thinking.");
  } else {
    updateUserVoice(0);
    setLiveStatus("Luria is speaking.");
  }

  setRiveState(mode);
}

// ============================================================
// SHARED WEB AUDIO CONTEXT
// ============================================================

async function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      throw new Error("Web Audio is not supported in this browser.");
    }

    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext;
}

function attachAudioGraph(key) {
  const asset = audioAssets[key];

  if (!asset?.element || !audioContext || asset.source) {
    return;
  }

  const source = audioContext.createMediaElementSource(asset.element);
  const analyser = audioContext.createAnalyser();

  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0;

  source.connect(analyser);
  analyser.connect(audioContext.destination);

  asset.source = source;
  asset.analyser = analyser;
  asset.data = new Float32Array(analyser.fftSize);
}

async function primeAudioElement(element) {
  if (!element) {
    return;
  }

  const previousMuted = element.muted;
  element.muted = true;

  try {
    await element.play();
    element.pause();
    element.currentTime = 0;
  } catch (_) {
    // The AudioContext user gesture is the primary unlock. Some browsers
    // may reject this muted prime and still allow later playback.
  } finally {
    element.muted = previousMuted;
  }
}

async function prepareAudioPlayback() {
  await ensureAudioContext();

  attachAudioGraph("short");
  attachAudioGraph("long");

  await Promise.all([
    primeAudioElement(audioAssets.short.element),
    primeAudioElement(audioAssets.long.element),
    primeAudioElement(backgroundAudio),
  ]);
}

async function startBackgroundAudio() {
  if (!backgroundAudio) {
    return;
  }

  backgroundAudio.loop = true;
  backgroundAudio.volume = BACKGROUND_VOLUME;
  backgroundAudio.muted = false;

  try {
    await backgroundAudio.play();
  } catch (error) {
    console.warn("[Luria] Background ambience could not start:", error);
  }
}

function pauseBackgroundAudio() {
  if (!backgroundAudio) {
    backgroundWasPlayingBeforeHide = false;
    return;
  }

  backgroundWasPlayingBeforeHide = !backgroundAudio.paused && !backgroundAudio.ended;

  try {
    backgroundAudio.pause();
  } catch (_) {}
}

async function resumeBackgroundAudio() {
  if (!backgroundAudio || !experienceStarted || !backgroundWasPlayingBeforeHide) {
    return;
  }

  backgroundAudio.volume = BACKGROUND_VOLUME;
  backgroundAudio.loop = true;
  backgroundAudio.muted = false;

  try {
    await backgroundAudio.play();
  } catch (error) {
    console.warn("[Luria] Background ambience could not resume:", error);
  }
}

function stopBackgroundAudio() {
  backgroundWasPlayingBeforeHide = false;

  if (!backgroundAudio) {
    return;
  }

  try {
    backgroundAudio.pause();
    backgroundAudio.currentTime = 0;
  } catch (_) {}
}

// ============================================================
// MICROPHONE
// ============================================================

async function enableMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable. Open this demo over HTTPS or localhost.");
  }

  if (mediaStream) {
    return;
  }

  await ensureAudioContext();

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
    video: false,
  });

  micSource = audioContext.createMediaStreamSource(mediaStream);
  micAnalyser = audioContext.createAnalyser();
  micAnalyser.fftSize = 1024;
  micAnalyser.smoothingTimeConstant = 0;
  micData = new Float32Array(micAnalyser.fftSize);

  micSource.connect(micAnalyser);

  smoothedMicLevel = 0;
  startMicrophoneLoop();
}

function rmsFromAnalyser(analyserNode, buffer) {
  analyserNode.getFloatTimeDomainData(buffer);

  let sumSquares = 0;

  for (let i = 0; i < buffer.length; i++) {
    sumSquares += buffer[i] * buffer[i];
  }

  return Math.sqrt(sumSquares / buffer.length);
}

function rmsToVoiceLevel(rms, noiseGate, gain, power) {
  const aboveGate = Math.max(0, rms - noiseGate);
  const normalized = clamp(aboveGate * gain, 0, 1);
  return Math.pow(normalized, power) * 3;
}

function startMicrophoneLoop() {
  if (micRAF !== null) {
    cancelAnimationFrame(micRAF);
  }

  const tick = () => {
    if (!micAnalyser || !micData) {
      return;
    }

    const rms = rmsFromAnalyser(micAnalyser, micData);
    const target = rmsToVoiceLevel(rms, MIC_NOISE_GATE, MIC_GAIN, MIC_POWER);

    const follow = target > smoothedMicLevel ? 0.30 : 0.085;
    smoothedMicLevel += (target - smoothedMicLevel) * follow;

    if (smoothedMicLevel < 0.012) {
      smoothedMicLevel = 0;
    }

    processMicrophoneLevel(smoothedMicLevel, performance.now());

    micRAF = requestAnimationFrame(tick);
  };

  micRAF = requestAnimationFrame(tick);
}

function processMicrophoneLevel(level, now) {
  if (!experienceStarted) {
    return;
  }

  if (currentMode === "Speaking") {
    // Luria's long response owns the speaking visuals. We still keep the
    // microphone stream alive, but do not let speaker leakage influence
    // userVoiceLevel or conversation state while she is speaking.
    updateUserVoice(0);
    activityCandidateSince = 0;
    return;
  }

  if (currentMode === "Listening") {
    const shortNudgeIsPlaying = activeAudio?.key === "short";
    const activityLevel = shortNudgeIsPlaying
      ? SHORT_NUDGE_ACTIVITY_LEVEL
      : LISTENING_ACTIVITY_LEVEL;
    const activityHold = shortNudgeIsPlaying
      ? SHORT_NUDGE_ACTIVITY_HOLD_MS
      : LISTENING_ACTIVITY_HOLD_MS;

    // Rive is visual-only: send a gated version of the microphone level so
    // tiny room noise does not make the character react visually.
    updateUserVoice(level >= USER_VISUAL_GATE_LEVEL ? level : 0);

    if (level >= activityLevel) {
      if (activityCandidateSince === 0) {
        activityCandidateSince = now;
      }

      if (now - activityCandidateSince >= activityHold) {
        lastUserVoiceAt = now;
        hasSpeechInCurrentTurn = true;

        if (!userHasEverSpoken) {
          userHasEverSpoken = true;
          shortPromptEligible = false;
          clearTimer("short");
        }

        // If the user begins speaking while the one-time nudge is already
        // playing, stop the nudge immediately and keep Listening active.
        if (activeAudio?.key === "short") {
          stopActiveAudio();
        }
      }
    } else {
      activityCandidateSince = 0;
    }

    if (
      hasSpeechInCurrentTurn &&
      lastUserVoiceAt > 0 &&
      now - lastUserVoiceAt >= SILENCE_TO_THINK_MS
    ) {
      beginThinking();
    }

    return;
  }

  if (currentMode === "Thinking") {
    updateUserVoice(0);

    if (level >= THINKING_ACTIVITY_LEVEL) {
      if (activityCandidateSince === 0) {
        activityCandidateSince = now;
      }

      if (now - activityCandidateSince >= THINKING_ACTIVITY_HOLD_MS) {
        interruptThinkingWithUserSpeech(now);
      }
    } else {
      activityCandidateSince = 0;
    }
  }
}

// ============================================================
// LURIA MP3 PLAYBACK + LEVEL -> RIVE
// ============================================================

function stopLuriaAudioLevelLoop() {
  if (luriaAudioRAF !== null) {
    cancelAnimationFrame(luriaAudioRAF);
    luriaAudioRAF = null;
  }

  smoothedLuriaLevel = 0;
  updateLuriaVoice(0);
}

function startLuriaAudioLevelLoop(asset) {
  stopLuriaAudioLevelLoop();

  if (!asset?.analyser || !asset.data) {
    return;
  }

  const tick = () => {
    if (!activeAudio || activeAudio.asset !== asset) {
      stopLuriaAudioLevelLoop();
      return;
    }

    const rms = rmsFromAnalyser(asset.analyser, asset.data);
    const target = rmsToVoiceLevel(
      rms,
      LURIA_AUDIO_NOISE_GATE,
      LURIA_AUDIO_GAIN,
      LURIA_AUDIO_POWER
    );

    const follow = target > smoothedLuriaLevel ? 0.38 : 0.10;
    smoothedLuriaLevel += (target - smoothedLuriaLevel) * follow;

    if (smoothedLuriaLevel < 0.015) {
      smoothedLuriaLevel = 0;
    }

    updateLuriaVoice(smoothedLuriaLevel);
    luriaAudioRAF = requestAnimationFrame(tick);
  };

  luriaAudioRAF = requestAnimationFrame(tick);
}

function stopActiveAudio() {
  if (!activeAudio) {
    stopLuriaAudioLevelLoop();
    return;
  }

  const { element, cleanup, resolve } = activeAudio;

  try {
    element.pause();
    element.currentTime = 0;
  } catch (_) {}

  cleanup?.();
  activeAudio = null;
  stopLuriaAudioLevelLoop();
  resolve?.("stopped");
}

function playManagedAudio(key) {
  const asset = audioAssets[key];
  const element = asset?.element;

  if (!asset || !element) {
    return Promise.reject(new Error(`Audio asset "${key}" is unavailable.`));
  }

  stopActiveAudio();

  element.currentTime = 0;
  element.muted = false;

  return new Promise((resolve, reject) => {
    const handleEnded = () => finish("ended");
    const handleError = () => finish("error");

    const cleanup = () => {
      element.removeEventListener("ended", handleEnded);
      element.removeEventListener("error", handleError);
    };

    const finish = (result) => {
      if (!activeAudio || activeAudio.element !== element) {
        return;
      }

      cleanup();
      activeAudio = null;
      stopLuriaAudioLevelLoop();

      if (result === "error") {
        reject(new Error(`Could not play ${key} audio.`));
      } else {
        resolve(result);
      }
    };

    activeAudio = {
      key,
      asset,
      element,
      cleanup,
      resolve,
    };

    element.addEventListener("ended", handleEnded, { once: true });
    element.addEventListener("error", handleError, { once: true });

    startLuriaAudioLevelLoop(asset);

    const playPromise = element.play();

    if (playPromise?.catch) {
      playPromise.catch((error) => {
        if (activeAudio?.element === element) {
          cleanup();
          activeAudio = null;
          stopLuriaAudioLevelLoop();
          reject(error);
        }
      });
    }
  });
}

// ============================================================
// CONVERSATION FLOW
// ============================================================

function scheduleShortPrompt() {
  clearTimer("short");

  if (
    !experienceStarted ||
    shortPromptPlayed ||
    !shortPromptEligible ||
    userHasEverSpoken
  ) {
    return;
  }

  const generation = conversationGeneration;

  shortPromptTimer = setTimeout(() => {
    shortPromptTimer = null;

    if (
      generation !== conversationGeneration ||
      currentMode !== "Listening" ||
      userHasEverSpoken ||
      shortPromptPlayed ||
      !shortPromptEligible
    ) {
      return;
    }

    playShortPrompt();
  }, SHORT_PROMPT_DELAY_MS);
}

async function playShortPrompt() {
  const generation = conversationGeneration;

  shortPromptPlayed = true;
  shortPromptEligible = false;
  activityCandidateSince = 0;

  // IMPORTANT:
  // The short MP3 is only a gentle nudge while Luria remains
  // in Listening mode. Do NOT switch the Rive state to Speaking.
  //
  // playManagedAudio("short") still drives luriaVoiceLevel from
  // the MP3 amplitude, so any subtle voice-reactive visual treatment
  // can respond without changing the main state.
  if (currentMode !== "Listening") {
    return;
  }

  setLiveStatus("Luria is listening.");

  try {
    await playManagedAudio("short");
  } catch (error) {
    console.error("[Luria] Short prompt audio failed:", error);
  }

  if (generation !== conversationGeneration || !experienceStarted) {
    return;
  }

  // If the user interrupted the nudge, preserve their active turn. The
  // microphone loop already stopped the short audio and marked speech.
  if (userHasEverSpoken || hasSpeechInCurrentTurn) {
    updateLuriaVoice(0);
    setLiveStatus("Luria is listening.");
    return;
  }

  // Nudge finished without user speech. Stay in Listening and wait.
  updateLuriaVoice(0);
  hasSpeechInCurrentTurn = false;
  lastUserVoiceAt = 0;
  activityCandidateSince = 0;
  setLiveStatus("Luria is listening.");
}

function beginThinking() {
  if (currentMode !== "Listening" || !hasSpeechInCurrentTurn) {
    return;
  }

  clearTimer("short");
  clearTimer("thinking");

  activityCandidateSince = 0;
  setMode("Thinking");

  const generation = conversationGeneration;

  thinkingTimer = setTimeout(() => {
    thinkingTimer = null;

    if (
      generation !== conversationGeneration ||
      currentMode !== "Thinking" ||
      !experienceStarted
    ) {
      return;
    }

    playLongResponse();
  }, THINKING_DURATION_MS);
}

function interruptThinkingWithUserSpeech(now) {
  if (currentMode !== "Thinking") {
    return;
  }

  clearTimer("thinking");

  userHasEverSpoken = true;
  shortPromptEligible = false;
  hasSpeechInCurrentTurn = true;
  lastUserVoiceAt = now;
  activityCandidateSince = 0;

  setMode("Listening");
}

async function playLongResponse() {
  const generation = conversationGeneration;

  clearTimer("thinking");
  activityCandidateSince = 0;
  setMode("Speaking");

  try {
    await playManagedAudio("long");
  } catch (error) {
    console.error("[Luria] Long response audio failed:", error);
  }

  if (generation !== conversationGeneration || !experienceStarted) {
    return;
  }

  updateLuriaVoice(0);

  clearTimer("post");
  postSpeechTimer = setTimeout(() => {
    postSpeechTimer = null;

    if (generation !== conversationGeneration || !experienceStarted) {
      return;
    }

    hasSpeechInCurrentTurn = false;
    lastUserVoiceAt = 0;
    activityCandidateSince = 0;

    setMode("Listening");
  }, POST_SPEECH_PAUSE_MS);
}

function resetSessionMemory() {
  shortPromptPlayed = false;
  shortPromptEligible = true;
  userHasEverSpoken = false;
}

function resetConversation() {
  conversationGeneration += 1;
  clearConversationTimers();
  stopActiveAudio();

  hasSpeechInCurrentTurn = false;
  lastUserVoiceAt = 0;
  activityCandidateSince = 0;
  smoothedMicLevel = 0;

  updateUserVoice(0);
  updateLuriaVoice(0);

  if (RESET_STARTS_NEW_SESSION) {
    resetSessionMemory();
  }

  // Keep the independent background ambience running through Reset.
  // Reset only restarts the conversation state, not the soundtrack.
  setMode("Listening");
  scheduleShortPrompt();
}

// ============================================================
// PAGE / TAB AUDIO LIFECYCLE
// ============================================================

function pauseRiveForBackground() {
  stopContinuousRiveRendering();

  if (!r) {
    return;
  }

  // Pause the state machine as well as rendering while the page is hidden.
  try {
    r.pause(STATE_MACHINE);
  } catch (_) {
    try {
      r.pause();
    } catch (_) {}
  }

  try {
    r.stopRendering();
  } catch (_) {}
}

async function resumeRiveFromBackground() {
  if (!r || document.visibilityState !== "visible") {
    return;
  }

  try {
    r.play(STATE_MACHINE);
  } catch (_) {
    try {
      r.play();
    } catch (_) {}
  }

  startContinuousRiveRendering();
  wakeRive();
}

function handlePageHidden() {
  if (tabSuspended) {
    return;
  }

  tabSuspended = true;

  // Invalidate all pending async conversation actions so a speech clip
  // cannot finish in the background and move the demo to another state.
  conversationGeneration += 1;
  clearConversationTimers();

  // Stop the managed speech clip immediately and pause the looping
  // background ambience at its current position.
  stopActiveAudio();
  pauseBackgroundAudio();

  // Clear live voice-driven visuals before freezing Rive.
  updateUserVoice(0);
  updateLuriaVoice(0);

  // If Luria was speaking/thinking when the page went away, resume from
  // a clean Listening state when the user returns.
  hasSpeechInCurrentTurn = false;
  lastUserVoiceAt = 0;
  activityCandidateSince = 0;

  pauseRiveForBackground();

  // Suspend the Web Audio graph used by mic + MP3 analysis/playback.
  // This does not revoke mic permission; it simply stops audio processing.
  if (audioContext && audioContext.state === "running") {
    audioContext.suspend().catch(() => {});
  }
}

async function handlePageVisible() {
  if (!tabSuspended) {
    if (r) {
      startContinuousRiveRendering();
      wakeRive();
    }
    return;
  }

  tabSuspended = false;

  if (experienceStarted && audioContext?.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (_) {}
  }

  await resumeRiveFromBackground();
  await resumeBackgroundAudio();

  if (experienceStarted) {
    setMode("Listening");

    // Only schedule the one-time nudge if it is still eligible.
    scheduleShortPrompt();
  }
}

// ============================================================
// START EXPERIENCE
// ============================================================

async function startExperience() {
  if (experienceStarted) {
    return;
  }

  startExperienceButton.disabled = true;
  permissionStatus?.classList.remove("error");

  if (permissionStatus) {
    permissionStatus.textContent = "Requesting microphone access…";
  }

  try {
    // The same user click unlocks our Web Audio context. It also gives the
    // page the user activation browsers require for later audible playback.
    await prepareAudioPlayback();
    await enableMicrophone();

    // Start the independent ambient soundtrack from the same user gesture.
    // It loops continuously at 20% volume until the page is hidden/closed.
    await startBackgroundAudio();

    // Start Rive only after the user has intentionally entered the audio
    // experience. This gives Rive's own background music / audio events the
    // best chance of being allowed by browser autoplay policies.
    r?.play(STATE_MACHINE);
    startContinuousRiveRendering();

    experienceStarted = true;
    resetSessionMemory();
    hasSpeechInCurrentTurn = false;
    lastUserVoiceAt = 0;
    activityCandidateSince = 0;

    setMode("Listening");
    scheduleShortPrompt();

    permissionGate?.classList.add("hidden");
    experienceHud?.classList.remove("hidden");

    setLiveStatus("Luria is listening.");
  } catch (error) {
    console.error("[Luria] Could not start experience:", error);

    startExperienceButton.disabled = false;

    if (permissionStatus) {
      permissionStatus.classList.add("error");

      if (error?.name === "NotAllowedError") {
        permissionStatus.textContent =
          "Microphone access was blocked. Allow it in your browser site settings, then try again.";
      } else {
        permissionStatus.textContent = error?.message || "Microphone access is required for this demo.";
      }
    }
  }
}

// ============================================================
// APP BOOT
// ============================================================

async function boot() {
  try {
    setLoaderProgress(0, "Loading Luria", "Preparing the experience…", "luria");

    // Warm the .riv file first so the first loader step tracks its download.
    await warmRiveAsset();

    setLoaderProgress(41, "Loading Luria", "Starting the Rive scene…", "luria");
    await createRive();
    setLoaderProgress(50, "Loading Luria", "Visual experience ready.", "luria");

    // Second loader stage contains both speech assets plus background ambience.
    await loadAudioAssets();

    await sleep(180);

    loading?.classList.add("hidden");
    permissionGate?.classList.remove("hidden");
  } catch (error) {
    console.error("[Luria] Boot failed:", error);

    setLoaderProgress(0, "Luria could not load", error?.message || "Unknown loading error", "luria");

    if (loaderPercent) {
      loaderPercent.textContent = "—";
    }
  }
}

// ============================================================
// EVENTS
// ============================================================

startExperienceButton?.addEventListener("click", startExperience);
resetButton?.addEventListener("click", resetConversation);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    handlePageHidden();
  } else {
    handlePageVisible();
  }
});

// pagehide also runs for tab/window close and page navigation in cases
// where beforeunload is skipped or delayed.
window.addEventListener("pagehide", () => {
  handlePageHidden();
});

window.addEventListener("focus", () => {
  if (document.visibilityState === "visible") {
    handlePageVisible();
  }
});

window.addEventListener(
  "resize",
  () => {
    r?.resizeDrawingSurfaceToCanvas(RIVE_RENDER_DPR);
    wakeRive();
  },
  { passive: true }
);

window.addEventListener("beforeunload", () => {
  clearConversationTimers();
  pauseRiveForBackground();
  stopActiveAudio();
  stopBackgroundAudio();
  stopContinuousRiveRendering();

  if (micRAF !== null) {
    cancelAnimationFrame(micRAF);
    micRAF = null;
  }

  mediaStream?.getTracks().forEach((track) => track.stop());

  try {
    audioContext?.close();
  } catch (_) {}

  Object.values(audioAssets).forEach((asset) => {
    if (asset.objectUrl) {
      URL.revokeObjectURL(asset.objectUrl);
    }
  });

  if (backgroundAudioObjectUrl) {
    URL.revokeObjectURL(backgroundAudioObjectUrl);
    backgroundAudioObjectUrl = null;
  }

  backgroundAudio = null;

  try {
    r?.cleanup();
  } catch (_) {}
});

boot();
