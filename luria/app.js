// Luria voice test harness
// BUILD: LURIA-WEB-STARS-v4
//
// Goals of this version:
// - use the current documented Rive Web API
// - keep the state machine actively rendering
// - force AlwaysDraw when the installed runtime exposes it
// - keep scripted/GPU-canvas stars advancing in browser
// - bind microphone/manual input to View Model number `voiceLevel`
//
// Expected Rive setup:
// - assets/luria.riv
// - State Machine: "Luria State Machine"
// - Default View Model / Default Instance bound to the artboard
// - Number property: voiceLevel (0..3)
//
// IMPORTANT:
// GPU Canvas support is part of the current full Rive runtime.
// There is no `enableGPUCanvas` constructor option in the current Web API.
// Use @rive-app/webgl2 (not a lite runtime).

const BUILD_ID = "LURIA-WEB-STARS-v4";
const RIVE_FILE = "./assets/luria.riv";
const STATE_MACHINE = "Luria State Machine";
const VOICE_PROPERTY = "voiceLevel";

console.log(BUILD_ID);

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

// Runtime diagnostics.
let advanceFrames = 0;
let advanceSeconds = 0;
let lastAdvanceReportAt = performance.now();
let renderingWatchdog = null;

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  const line = `[${stamp}] ${message}`;

  console.log("[Luria]", message);

  if (diagnostics) {
    diagnostics.textContent = `${line}\n${diagnostics.textContent}`;
  }
}

function setStatus(text, type = "") {
  if (!riveStatus) return;
  riveStatus.textContent = text;
  riveStatus.className = `badge ${type}`.trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function keepRiveAwake() {
  if (!r) return;

  try {
    // No-op if the internal render loop is already running.
    r.startRendering();
  } catch (err) {
    log(`startRendering warning: ${String(err)}`);
  }
}

function setVoiceLevel(value, source = "manual") {
  const v = clamp(Number(value) || 0, 0, 3);

  if (voiceValue) voiceValue.textContent = v.toFixed(2);
  if (voiceMeter) voiceMeter.style.width = `${(v / 3) * 100}%`;

  if (source === "mic" && manualSlider && manualOutput) {
    manualSlider.value = v.toFixed(2);
    manualOutput.textContent = v.toFixed(2);
  }

  if (voiceProp) {
    voiceProp.value = v;

    // A View Model update should unsettle the file itself, but explicitly
    // waking the high-level render loop makes browser testing more robust.
    keepRiveAwake();
  }
}

function updateControlLabels() {
  if (sensitivityOutput && sensitivitySlider) {
    sensitivityOutput.textContent =
      `${Number(sensitivitySlider.value).toFixed(2)}×`;
  }

  if (gateOutput && gateSlider) {
    gateOutput.textContent =
      Number(gateSlider.value).toFixed(3);
  }

  if (attackOutput && attackSlider) {
    attackOutput.textContent =
      Number(attackSlider.value).toFixed(2);
  }

  if (releaseOutput && releaseSlider) {
    releaseOutput.textContent =
      Number(releaseSlider.value).toFixed(2);
  }
}

[sensitivitySlider, gateSlider, attackSlider, releaseSlider]
  .filter(Boolean)
  .forEach((el) => {
    el.addEventListener("input", updateControlLabels);
  });

updateControlLabels();

if (manualSlider) {
  manualSlider.addEventListener("input", () => {
    const v = Number(manualSlider.value);

    if (manualOutput) {
      manualOutput.textContent = v.toFixed(2);
    }

    if (!micActive) {
      setVoiceLevel(v, "manual");
    }
  });
}

function bindVoiceProperty() {
  const vmi = r?.viewModelInstance;

  if (!vmi) {
    setStatus("No bound View Model", "error");
    log(
      "No View Model Instance was auto-bound. " +
      "Assign the Luria View Model to the artboard and mark an instance as Default."
    );
    return;
  }

  try {
    voiceProp = vmi.number(VOICE_PROPERTY);
  } catch (err) {
    voiceProp = null;
    log(`Could not access Number property "${VOICE_PROPERTY}": ${String(err)}`);
  }

  if (!voiceProp) {
    setStatus("voiceLevel missing", "error");
    log(
      `The bound View Model exists, but Number property ` +
      `"${VOICE_PROPERTY}" was not found.`
    );
    return;
  }

  setStatus("Rive connected", "ok");
  log(`Bound runtime property: ${VOICE_PROPERTY}`);

  setVoiceLevel(
    manualSlider ? Number(manualSlider.value) : 0,
    "manual"
  );
}

function reportRuntimeState() {
  if (!r) return;

  log(`Active artboard: ${r.activeArtboard || "(none)"}`);
  log(`State machines: ${JSON.stringify(r.stateMachineNames || [])}`);
  log(
    `Playing state machines: ` +
    `${JSON.stringify(r.playingStateMachineNames || [])}`
  );
  log(`Animations: ${JSON.stringify(r.animationNames || [])}`);
  log(`isPlaying: ${String(r.isPlaying)}`);
}

function handleAdvance(event) {
  advanceFrames += 1;

  const dt =
    typeof event?.data === "number"
      ? event.data
      : 0;

  advanceSeconds += dt;

  const now = performance.now();

  // Report about once every 2 seconds. This confirms the browser runtime
  // is continuously advancing the artboard, which the star Node requires.
  if (now - lastAdvanceReportAt >= 2000) {
    const elapsed = (now - lastAdvanceReportAt) / 1000;
    const fps = advanceFrames / elapsed;

    log(
      `Runtime advancing: ~${fps.toFixed(1)} frames/s` +
      (advanceSeconds > 0
        ? `, ${advanceSeconds.toFixed(2)}s advanced`
        : "")
    );

    advanceFrames = 0;
    advanceSeconds = 0;
    lastAdvanceReportAt = now;
  }
}

function cleanupRive() {
  voiceProp = null;

  if (renderingWatchdog) {
    clearInterval(renderingWatchdog);
    renderingWatchdog = null;
  }

  if (r) {
    try {
      r.cleanup();
    } catch (err) {
      console.warn("Rive cleanup:", err);
    }
    r = null;
  }
}

function loadRive() {
  if (diagnostics) {
    diagnostics.textContent = `${BUILD_ID}\nLoading Rive…`;
  }

  cleanupRive();

  if (!window.rive?.Rive) {
    setStatus("Rive runtime missing", "error");
    if (loading) {
      loading.textContent = "Rive WebGL2 runtime did not load";
    }
    log(
      "window.rive.Rive is unavailable. " +
      "Make sure index.html loads https://unpkg.com/@rive-app/webgl2 " +
      "before app.js."
    );
    return;
  }

  try {
    const params = {
      src: RIVE_FILE,
      canvas,

      // Current documented Rive Web API uses `stateMachines` (plural).
      stateMachines: STATE_MACHINE,

      autoplay: true,
      autoBind: true,

      // One Rive instance only. Keep the normal dedicated WebGL2 context.
      useOffscreenRenderer: false,

      enablePerfMarks: true,

      onLoad: () => {
        r.resizeDrawingSurfaceToCanvas();

        if (loading) {
          loading.classList.add("hidden");
        }

        log(`Loaded ${RIVE_FILE}`);

        reportRuntimeState();

        // Explicitly ensure the loaded state machine is running.
        // play() with no argument resumes the instantiated state machine.
        try {
          r.play();
        } catch (err) {
          log(`play() warning: ${String(err)}`);
        }

        keepRiveAwake();
        bindVoiceProperty();

        // Browser tabs/context changes can sometimes stop a WebGL render loop.
        // startRendering() is explicitly documented as safe/no-op if already running.
        renderingWatchdog = window.setInterval(() => {
          if (
            r &&
            document.visibilityState === "visible"
          ) {
            keepRiveAwake();
          }
        }, 1000);
      },

      onLoadError: (err) => {
        setStatus("Rive load error", "error");

        if (loading) {
          loading.textContent = "Could not load assets/luria.riv";
        }

        log(`Rive load error: ${String(err)}`);
      },

      onPlay: (event) => {
        log(`Play event: ${JSON.stringify(event?.data ?? event)}`);
      },

      onStateChange: (event) => {
        log(`State change: ${JSON.stringify(event?.data ?? event)}`);
      },

      onAdvance: handleAdvance,
    };

    // Current Rive defaults to DrawOnChanged. Our Luria star field is a
    // continuously procedural scripted GPU effect, so AlwaysDraw is safer
    // for this browser prototype.
    if (
      window.rive.DrawOptimizationOptions &&
      window.rive.DrawOptimizationOptions.AlwaysDraw !== undefined
    ) {
      params.drawingOptions =
        window.rive.DrawOptimizationOptions.AlwaysDraw;

      log("Drawing optimization: AlwaysDraw enabled.");
    } else {
      log(
        "DrawOptimizationOptions.AlwaysDraw is not exposed by this runtime; " +
        "continuing with the runtime default."
      );
    }

    r = new window.rive.Rive(params);

    window.addEventListener(
      "resize",
      () => {
        r?.resizeDrawingSurfaceToCanvas();
      },
      { passive: true }
    );
  } catch (err) {
    setStatus("Rive init error", "error");

    if (loading) {
      loading.textContent = "Rive initialization failed";
    }

    log(`Rive init error: ${err?.stack || String(err)}`);
  }
}

// Resume rendering after browser/tab suspension.
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    r
  ) {
    log("Page visible again; resuming Rive rendering.");

    try {
      r.play();
    } catch (_) {}

    keepRiveAwake();
  }
});

window.addEventListener("focus", () => {
  if (r) {
    keepRiveAwake();
  }
});

async function startMicrophone() {
  if (micActive) return;

  if (!voiceProp) {
    log(
      "Microphone not started because voiceLevel is not bound yet."
    );
    return;
  }

  try {
    mediaStream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });

    audioContext =
      new (window.AudioContext || window.webkitAudioContext)();

    // Some browsers create AudioContext suspended until a user gesture.
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source =
      audioContext.createMediaStreamSource(mediaStream);

    analyser =
      audioContext.createAnalyser();

    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;

    source.connect(analyser);

    timeData =
      new Float32Array(analyser.fftSize);

    micActive = true;
    smoothedLevel =
      manualSlider ? Number(manualSlider.value) || 0 : 0;

    if (micButton) {
      micButton.disabled = true;
      micButton.textContent = "Microphone active";
    }

    if (stopButton) {
      stopButton.disabled = false;
    }

    log("Microphone enabled.");

    keepRiveAwake();
    tickMicrophone();
  } catch (err) {
    log(`Microphone error: ${String(err)}`);

    alert(
      "Microphone permission failed. " +
      "Use HTTPS (GitHub Pages/raw.githack) or localhost, " +
      "then allow microphone access."
    );
  }
}

function tickMicrophone() {
  if (!micActive || !analyser || !timeData) return;

  analyser.getFloatTimeDomainData(timeData);

  let sumSquares = 0;

  for (let i = 0; i < timeData.length; i++) {
    const sample = timeData[i];
    sumSquares += sample * sample;
  }

  const rms =
    Math.sqrt(sumSquares / timeData.length);

  const gate =
    gateSlider ? Number(gateSlider.value) : 0.015;

  const sensitivity =
    sensitivitySlider
      ? Number(sensitivitySlider.value)
      : 1;

  // Practical speech mapping:
  // silence -> 0
  // normal speech -> approximately 1–2.5
  // strong speech -> up to 3
  const aboveGate =
    Math.max(0, rms - gate);

  const normalized =
    clamp(
      aboveGate * 15 * sensitivity,
      0,
      1
    );

  const target =
    Math.pow(normalized, 0.72) * 3;

  const attack =
    attackSlider
      ? Number(attackSlider.value)
      : 0.28;

  const release =
    releaseSlider
      ? Number(releaseSlider.value)
      : 0.09;

  const follow =
    target > smoothedLevel
      ? attack
      : release;

  smoothedLevel +=
    (target - smoothedLevel) * follow;

  if (smoothedLevel < 0.015) {
    smoothedLevel = 0;
  }

  setVoiceLevel(smoothedLevel, "mic");

  micRAF =
    requestAnimationFrame(tickMicrophone);
}

async function stopMicrophone() {
  micActive = false;

  if (micRAF) {
    cancelAnimationFrame(micRAF);
    micRAF = null;
  }

  mediaStream
    ?.getTracks()
    .forEach((track) => track.stop());

  mediaStream = null;

  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }

  analyser = null;
  timeData = null;

  if (micButton) {
    micButton.disabled = false;
    micButton.textContent = "Enable microphone";
  }

  if (stopButton) {
    stopButton.disabled = true;
  }

  const manual =
    manualSlider
      ? Number(manualSlider.value)
      : 0;

  setVoiceLevel(manual, "manual");

  log(
    "Microphone stopped; returned to manual control."
  );
}

micButton?.addEventListener(
  "click",
  startMicrophone
);

stopButton?.addEventListener(
  "click",
  stopMicrophone
);

loadRive();
