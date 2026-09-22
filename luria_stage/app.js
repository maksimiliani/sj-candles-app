// ------------------------------------------------------------
// LURIA WEB DEMO
// Final artboard + GPUCanvas / WGSL
// ------------------------------------------------------------

const BUILD_ID = "LURIA-GPU-v6";

const RIVE_FILE =
  "./assets/luria.riv?v=20260922-6";

const ARTBOARD =
  "Final";

const STATE_MACHINE =
  "Luria State Machine";


// ------------------------------------------------------------
// VIEW MODEL PROPERTY NAMES
// ------------------------------------------------------------

const STATE_PROPERTY =
  "state";

const USER_VOICE_PROPERTY =
  "userVoiceLevel";

const LURIA_VOICE_PROPERTY =
  "luriaVoiceLevel";


// ------------------------------------------------------------
// DOM
// ------------------------------------------------------------

const canvas =
  document.getElementById("rive-canvas");

const loading =
  document.getElementById("loading");

const riveStatus =
  document.getElementById("rive-status");


const modeButtons =
  [...document.querySelectorAll(".mode-button")];


const userPanel =
  document.getElementById("user-panel");

const thinkingPanel =
  document.getElementById("thinking-panel");

const luriaPanel =
  document.getElementById("luria-panel");


const userSlider =
  document.getElementById("user-level");

const userOutput =
  document.getElementById("user-output");


const luriaSlider =
  document.getElementById("luria-level");

const luriaOutput =
  document.getElementById("luria-output");


const userMicButton =
  document.getElementById("user-mic");

const luriaMicButton =
  document.getElementById("luria-mic");

const micStatus =
  document.getElementById("mic-status");


// ------------------------------------------------------------
// RIVE
// ------------------------------------------------------------

let r = null;

let stateProp = null;
let userVoiceProp = null;
let luriaVoiceProp = null;


// ------------------------------------------------------------
// CURRENT MODE
// ------------------------------------------------------------

let currentMode =
  "Listening";


// ------------------------------------------------------------
// CONTINUOUS GPU RENDER LOOP
// ------------------------------------------------------------
//
// Important for GPUCanvas / procedural shader content.
//
// We intentionally keep asking Rive to render while the
// page is visible.
//
// This prevents the high-level runtime from going idle when
// Final's authored state appears "unchanged" even though
// the Node Script / shader has time-based movement.
// ------------------------------------------------------------

let continuousRenderRAF = null;


function startContinuousRiveRendering() {

  stopContinuousRiveRendering();


  const tick = () => {

    if (
      r &&
      document.visibilityState === "visible"
    ) {

      try {

        r.startRendering();

      } catch (_) {

        // Ignore transient startup frames.
      }
    }


    continuousRenderRAF =
      requestAnimationFrame(
        tick
      );
  };


  continuousRenderRAF =
    requestAnimationFrame(
      tick
    );
}


function stopContinuousRiveRendering() {

  if (continuousRenderRAF !== null) {

    cancelAnimationFrame(
      continuousRenderRAF
    );

    continuousRenderRAF = null;
  }
}


// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


function setRiveStatus(
  type,
  title
) {

  if (!riveStatus) {
    return;
  }


  riveStatus.className =
    `status-dot ${type || ""}`.trim();


  riveStatus.title =
    title;
}


function wakeRive() {

  if (!r) {
    return;
  }


  try {

    r.startRendering();

  } catch (err) {

    console.warn(
      "[Luria] startRendering:",
      err
    );
  }
}


// ------------------------------------------------------------
// USER VOICE
// ------------------------------------------------------------

function updateUserVoice(
  value,
  fromMic = false
) {

  const v =
    clamp(
      Number(value) || 0,
      0,
      3
    );


  if (userOutput) {

    userOutput.textContent =
      v.toFixed(2);
  }


  if (
    fromMic &&
    userSlider
  ) {

    userSlider.value =
      v.toFixed(2);
  }


  if (userVoiceProp) {

    userVoiceProp.value =
      v;

    wakeRive();
  }
}


// ------------------------------------------------------------
// LURIA VOICE
// ------------------------------------------------------------

function updateLuriaVoice(
  value,
  fromMic = false
) {

  const v =
    clamp(
      Number(value) || 0,
      0,
      3
    );


  if (luriaOutput) {

    luriaOutput.textContent =
      v.toFixed(2);
  }


  if (
    fromMic &&
    luriaSlider
  ) {

    luriaSlider.value =
      v.toFixed(2);
  }


  if (luriaVoiceProp) {

    luriaVoiceProp.value =
      v;

    wakeRive();
  }
}


// ------------------------------------------------------------
// STATE
// ------------------------------------------------------------

function setState(
  value
) {

  if (!stateProp) {
    return;
  }


  try {

    stateProp.value =
      value;

    wakeRive();

  } catch (err) {

    console.error(
      `[Luria] Could not set state="${value}"`,
      err
    );


    setRiveStatus(
      "error",
      `Could not set Rive state: ${value}`
    );
  }
}


// ------------------------------------------------------------
// MODE
// ------------------------------------------------------------

async function setMode(
  mode
) {

  if (
    ![
      "Listening",
      "Thinking",
      "Speaking"
    ].includes(mode)
  ) {

    return;
  }


  if (micTarget) {

    await stopMicrophone();
  }


  currentMode =
    mode;


  modeButtons.forEach(
    (button) => {

      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );
    }
  );


  userPanel?.classList.toggle(
    "hidden",
    mode !== "Listening"
  );


  thinkingPanel?.classList.toggle(
    "hidden",
    mode !== "Thinking"
  );


  luriaPanel?.classList.toggle(
    "hidden",
    mode !== "Speaking"
  );


  // Clear irrelevant voice signal.

  if (mode === "Listening") {

    updateLuriaVoice(0);

  } else if (mode === "Thinking") {

    updateUserVoice(0);
    updateLuriaVoice(0);

  } else if (mode === "Speaking") {

    updateUserVoice(0);
  }


  setState(
    mode
  );
}


// ------------------------------------------------------------
// VIEW MODEL
// ------------------------------------------------------------

function bindViewModel() {

  const vmi =
    r?.viewModelInstance;


  if (!vmi) {

    setRiveStatus(
      "error",
      "No bound View Model instance"
    );


    console.error(
      "[Luria] No auto-bound View Model instance."
    );


    return false;
  }


  try {

    stateProp =
      vmi.enum(
        STATE_PROPERTY
      );

  } catch (err) {

    console.error(
      `[Luria] Enum "${STATE_PROPERTY}" unavailable`,
      err
    );
  }


  try {

    userVoiceProp =
      vmi.number(
        USER_VOICE_PROPERTY
      );

  } catch (err) {

    console.error(
      `[Luria] Number "${USER_VOICE_PROPERTY}" unavailable`,
      err
    );
  }


  try {

    luriaVoiceProp =
      vmi.number(
        LURIA_VOICE_PROPERTY
      );

  } catch (err) {

    console.error(
      `[Luria] Number "${LURIA_VOICE_PROPERTY}" unavailable`,
      err
    );
  }


  if (
    !stateProp ||
    !userVoiceProp ||
    !luriaVoiceProp
  ) {

    setRiveStatus(
      "error",
      "View Model properties missing"
    );

    return false;
  }


  // Initial tester values.

  updateUserVoice(
    Number(
      userSlider?.value || 0
    )
  );


  updateLuriaVoice(
    Number(
      luriaSlider?.value || 0
    )
  );


  setState(
    currentMode
  );


  setRiveStatus(
    "ok",
    "Rive connected"
  );


  return true;
}


// ------------------------------------------------------------
// CLEANUP
// ------------------------------------------------------------

function cleanupRive() {

  stopContinuousRiveRendering();


  stateProp = null;
  userVoiceProp = null;
  luriaVoiceProp = null;


  if (r) {

    try {

      r.cleanup();

    } catch (err) {

      console.warn(
        "[Luria] cleanup:",
        err
      );
    }


    r = null;
  }
}


// ------------------------------------------------------------
// LOAD RIVE
// ------------------------------------------------------------

function loadRive() {

  cleanupRive();


  loading?.classList.remove(
    "hidden"
  );


  setRiveStatus(
    "",
    "Loading Rive"
  );


  if (!window.rive?.Rive) {

    setRiveStatus(
      "error",
      "Rive WebGL2 runtime unavailable"
    );


    return;
  }


  const params = {

    src:
      RIVE_FILE,

    canvas,

    // Important:
    // explicitly load the shader wrapper artboard.
    artboard:
      ARTBOARD,

    // State machine now lives on Final.
    stateMachines:
      STATE_MACHINE,

    autoplay:
      true,

    autoBind:
      true,

    // Required for context:gpuCanvas().
    enableGPUCanvas:
      true,

    // GPUCanvas requires this off.
    useOffscreenRenderer:
      false,


    onLoad: () => {

      console.log(
        `[Luria] ${BUILD_ID} loaded`
      );


      r.resizeDrawingSurfaceToCanvas();


      try {

        // Explicitly play the Final SM.
        r.play(
          STATE_MACHINE
        );

      } catch (err) {

        console.warn(
          "[Luria] play:",
          err
        );
      }


      // Start immediately.
      wakeRive();


      // Critical:
      // keep GPUCanvas rendering alive.
      startContinuousRiveRendering();


      const bound =
        bindViewModel();


      requestAnimationFrame(
        () => {

          requestAnimationFrame(
            () => {

              if (bound) {

                loading?.classList.add(
                  "hidden"
                );
              }
            }
          );
        }
      );
    },


    onLoadError: (err) => {

      console.error(
        "FULL RIVE LOAD ERROR:",
        err
      );


      setRiveStatus(
        "error",
        "Rive load failed"
      );


      if (loading) {

        loading
          .querySelector("strong")
          .textContent =
          "Luria could not load";


        loading
          .querySelector("span")
          .textContent =
          String(
            err?.data ||
            err ||
            "Unknown Rive runtime error"
          );
      }
    },
  };


  // ----------------------------------------------------------
  // FORCE DRAWING EVEN WHEN THE ARTBOARD LOOKS UNCHANGED
  // ----------------------------------------------------------

  if (
    window.rive.DrawOptimizationOptions &&
    window.rive.DrawOptimizationOptions.AlwaysDraw !== undefined
  ) {

    params.drawingOptions =
      window.rive
        .DrawOptimizationOptions
        .AlwaysDraw;
  }


  try {

    r =
      new window.rive.Rive(
        params
      );

  } catch (err) {

    console.error(
      "[Luria] Rive init error:",
      err
    );


    setRiveStatus(
      "error",
      "Rive initialization failed"
    );
  }
}


// ============================================================
// MICROPHONE
// ============================================================

let mediaStream = null;

let audioContext = null;

let analyser = null;

let timeData = null;

let micRAF = null;

let micTarget = null;

let smoothedMicLevel = 0;


// ------------------------------------------------------------
// START MICROPHONE
// ------------------------------------------------------------

async function startMicrophone(
  target
) {

  if (
    ![
      "user",
      "luria"
    ].includes(target)
  ) {

    return;
  }


  if (micTarget) {
    return;
  }


  if (
    !navigator.mediaDevices
      ?.getUserMedia
  ) {

    if (micStatus) {

      micStatus.textContent =
        "Microphone is not supported.";
    }

    return;
  }


  try {

    mediaStream =
      await navigator.mediaDevices
        .getUserMedia({

          audio: {

            echoCancellation:
              true,

            noiseSuppression:
              true,

            autoGainControl:
              false,
          },

          video:
            false,
        });


    audioContext =
      new (
        window.AudioContext ||
        window.webkitAudioContext
      )();


    if (
      audioContext.state ===
      "suspended"
    ) {

      await audioContext.resume();
    }


    const source =
      audioContext
        .createMediaStreamSource(
          mediaStream
        );


    analyser =
      audioContext
        .createAnalyser();


    analyser.fftSize =
      1024;


    analyser.smoothingTimeConstant =
      0;


    source.connect(
      analyser
    );


    timeData =
      new Float32Array(
        analyser.fftSize
      );


    micTarget =
      target;


    smoothedMicLevel =
      target === "user"
        ? Number(
            userSlider?.value || 0
          )
        : Number(
            luriaSlider?.value || 0
          );


    refreshMicButtons();


    if (micStatus) {

      micStatus.textContent =
        target === "user"
          ? "Microphone → userVoiceLevel"
          : "Microphone → luriaVoiceLevel";
    }


    wakeRive();

    tickMicrophone();

  } catch (err) {

    console.error(
      "[Luria] Microphone error:",
      err
    );


    if (micStatus) {

      micStatus.textContent =
        "Microphone permission failed.";
    }
  }
}


// ------------------------------------------------------------
// MICROPHONE LOOP
// ------------------------------------------------------------

function tickMicrophone() {

  if (
    !micTarget ||
    !analyser ||
    !timeData
  ) {

    return;
  }


  analyser.getFloatTimeDomainData(
    timeData
  );


  let sumSquares = 0;


  for (
    let i = 0;
    i < timeData.length;
    i++
  ) {

    sumSquares +=
      timeData[i] *
      timeData[i];
  }


  const rms =
    Math.sqrt(
      sumSquares /
      timeData.length
    );


  const noiseGate =
    0.015;


  const aboveGate =
    Math.max(
      0,
      rms - noiseGate
    );


  const normalized =
    clamp(
      aboveGate * 15,
      0,
      1
    );


  const target =
    Math.pow(
      normalized,
      0.72
    ) * 3;


  const follow =
    target > smoothedMicLevel
      ? 0.28
      : 0.09;


  smoothedMicLevel +=
    (
      target -
      smoothedMicLevel
    ) *
    follow;


  if (
    smoothedMicLevel <
    0.015
  ) {

    smoothedMicLevel =
      0;
  }


  if (
    micTarget === "user"
  ) {

    updateUserVoice(
      smoothedMicLevel,
      true
    );

  } else {

    updateLuriaVoice(
      smoothedMicLevel,
      true
    );
  }


  micRAF =
    requestAnimationFrame(
      tickMicrophone
    );
}


// ------------------------------------------------------------
// STOP MICROPHONE
// ------------------------------------------------------------

async function stopMicrophone() {

  if (micRAF) {

    cancelAnimationFrame(
      micRAF
    );

    micRAF = null;
  }


  mediaStream
    ?.getTracks()
    .forEach(
      (track) =>
        track.stop()
    );


  mediaStream =
    null;


  if (audioContext) {

    try {

      await audioContext.close();

    } catch (_) {}


    audioContext =
      null;
  }


  analyser =
    null;

  timeData =
    null;

  micTarget =
    null;

  smoothedMicLevel =
    0;


  refreshMicButtons();


  if (micStatus) {

    micStatus.textContent =
      "Microphone is off.";
  }
}


// ------------------------------------------------------------
// MIC BUTTON STATE
// ------------------------------------------------------------

function refreshMicButtons() {

  const userOn =
    micTarget === "user";


  const luriaOn =
    micTarget === "luria";


  if (userMicButton) {

    userMicButton.classList.toggle(
      "active",
      userOn
    );


    userMicButton.textContent =
      userOn
        ? "Stop microphone"
        : "Use microphone";
  }


  if (luriaMicButton) {

    luriaMicButton.classList.toggle(
      "active",
      luriaOn
    );


    luriaMicButton.textContent =
      luriaOn
        ? "Stop microphone"
        : "Use microphone";
  }
}


// ============================================================
// UI EVENTS
// ============================================================

modeButtons.forEach(
  (button) => {

    button.addEventListener(
      "click",
      () => {

        setMode(
          button.dataset.mode
        );
      }
    );
  }
);


userSlider
  ?.addEventListener(
    "input",
    () => {

      const value =
        Number(
          userSlider.value
        );


      if (userOutput) {

        userOutput.textContent =
          value.toFixed(2);
      }


      if (
        micTarget !== "user"
      ) {

        updateUserVoice(
          value
        );
      }
    }
  );


luriaSlider
  ?.addEventListener(
    "input",
    () => {

      const value =
        Number(
          luriaSlider.value
        );


      if (luriaOutput) {

        luriaOutput.textContent =
          value.toFixed(2);
      }


      if (
        micTarget !== "luria"
      ) {

        updateLuriaVoice(
          value
        );
      }
    }
  );


userMicButton
  ?.addEventListener(
    "click",
    async () => {

      if (
        micTarget === "user"
      ) {

        await stopMicrophone();

      } else if (!micTarget) {

        await startMicrophone(
          "user"
        );
      }
    }
  );


luriaMicButton
  ?.addEventListener(
    "click",
    async () => {

      if (
        micTarget === "luria"
      ) {

        await stopMicrophone();

      } else if (!micTarget) {

        await startMicrophone(
          "luria"
        );
      }
    }
  );


// ------------------------------------------------------------
// TAB / WINDOW RESUME
// ------------------------------------------------------------

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState ===
        "visible" &&
      r
    ) {

      wakeRive();

      startContinuousRiveRendering();
    }
  }
);


window.addEventListener(
  "focus",
  () => {

    wakeRive();

    startContinuousRiveRendering();
  }
);


// ------------------------------------------------------------
// RESIZE
// ------------------------------------------------------------

window.addEventListener(
  "resize",
  () => {

    r?.resizeDrawingSurfaceToCanvas();

    wakeRive();
  },
  {
    passive:
      true,
  }
);


// ------------------------------------------------------------
// CLEANUP
// ------------------------------------------------------------

window.addEventListener(
  "beforeunload",
  () => {

    stopMicrophone();

    cleanupRive();
  }
);


// ------------------------------------------------------------
// START
// ------------------------------------------------------------

refreshMicButtons();

loadRive();