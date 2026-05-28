import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import * as THREE from "three";
import { Midi } from "@tonejs/midi";
import * as Tone from "tone";

type VoiceId = "V1" | "V2" | "V3" | "V4";

type NoteEvent = {
  pitch: number;
  start: number;
  duration: number;
};

type ThemeWindow = {
  start: number;
  end: number;
};

type VisualNote = {
  voice: VoiceId;
  start: number;
  end: number;
  isTheme: boolean;
  baseColor: THREE.Color;
  material: THREE.MeshStandardMaterial;
  mesh: THREE.Mesh;
  glowMaterial: THREE.MeshBasicMaterial;
  glowMesh: THREE.Mesh;
};

const VOICES: VoiceId[] = ["V1", "V2", "V3", "V4"];

const BASE_COLORS: Record<VoiceId, string> = {
  V1: "#ff7878",
  V2: "#ffd166",
  V3: "#7bd88f",
  V4: "#7aa6ff",
};

function buildDemoData(): Record<VoiceId, NoteEvent[]> {
  return {
    V1: [
      { pitch: 74, start: 0, duration: 1 },
      { pitch: 76, start: 1, duration: 1 },
      { pitch: 77, start: 2, duration: 1 },
      { pitch: 79, start: 3, duration: 2 },
      { pitch: 77, start: 5, duration: 1 },
      { pitch: 76, start: 6, duration: 1 },
      { pitch: 74, start: 7, duration: 2 },
      { pitch: 72, start: 9, duration: 1 },
      { pitch: 74, start: 10, duration: 1 },
      { pitch: 76, start: 11, duration: 2 },
      { pitch: 77, start: 13, duration: 3 },
    ],
    V2: [
      { pitch: 67, start: 2, duration: 1 },
      { pitch: 69, start: 3, duration: 1 },
      { pitch: 71, start: 4, duration: 1 },
      { pitch: 72, start: 5, duration: 2 },
      { pitch: 71, start: 7, duration: 1 },
      { pitch: 69, start: 8, duration: 2 },
      { pitch: 67, start: 10, duration: 2 },
      { pitch: 65, start: 12, duration: 1 },
      { pitch: 67, start: 13, duration: 1 },
      { pitch: 69, start: 14, duration: 2 },
    ],
    V3: [
      { pitch: 60, start: 4, duration: 1 },
      { pitch: 62, start: 5, duration: 1 },
      { pitch: 64, start: 6, duration: 1 },
      { pitch: 65, start: 7, duration: 2 },
      { pitch: 64, start: 9, duration: 1 },
      { pitch: 62, start: 10, duration: 1.5 },
      { pitch: 60, start: 11.5, duration: 1.5 },
      { pitch: 59, start: 13, duration: 1 },
      { pitch: 60, start: 14, duration: 1 },
      { pitch: 62, start: 15, duration: 2 },
    ],
    V4: [
      { pitch: 48, start: 6, duration: 1 },
      { pitch: 50, start: 7, duration: 1 },
      { pitch: 52, start: 8, duration: 1 },
      { pitch: 53, start: 9, duration: 2 },
      { pitch: 52, start: 11, duration: 2 },
      { pitch: 50, start: 13, duration: 1 },
      { pitch: 48, start: 14, duration: 2 },
      { pitch: 47, start: 16, duration: 2 },
    ],
  };
}

function normalizeVoiceData(data: Record<VoiceId, NoteEvent[]>): Record<VoiceId, NoteEvent[]> {
  const allNotes = Object.values(data).flat();
  if (allNotes.length === 0) {
    return { V1: [], V2: [], V3: [], V4: [] };
  }
  const normalized: Record<VoiceId, NoteEvent[]> = { V1: [], V2: [], V3: [], V4: [] };

  VOICES.forEach((voice) => {
    normalized[voice] = data[voice]
      .filter((note) => note.duration > 0.02)
      .map((note) => ({
        pitch: note.pitch,
        start: note.start,
        duration: note.duration,
      }))
      .sort((a, b) => a.start - b.start);
  });

  return normalized;
}

function reorderVoicesByRegister(data: Record<VoiceId, NoteEvent[]>): Record<VoiceId, NoteEvent[]> {
  const ranked = VOICES.map((voice) => {
    const notes = data[voice];
    const avgPitch = notes.length > 0 ? notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length : -Infinity;
    return { voice, notes, avgPitch };
  }).sort((a, b) => b.avgPitch - a.avgPitch);

  return {
    V1: ranked[0]?.notes ?? [],
    V2: ranked[1]?.notes ?? [],
    V3: ranked[2]?.notes ?? [],
    V4: ranked[3]?.notes ?? [],
  };
}

function splitSingleTrackIntoVoices(notes: NoteEvent[]): Record<VoiceId, NoteEvent[]> {
  const voices: Record<VoiceId, NoteEvent[]> = { V1: [], V2: [], V3: [], V4: [] };
  const sorted = notes.slice().sort((a, b) => (a.start === b.start ? b.pitch - a.pitch : a.start - b.start));

  const state: Record<VoiceId, { lastPitch: number; lastEnd: number; noteCount: number }> = {
    V1: { lastPitch: 76, lastEnd: -Infinity, noteCount: 0 },
    V2: { lastPitch: 67, lastEnd: -Infinity, noteCount: 0 },
    V3: { lastPitch: 60, lastEnd: -Infinity, noteCount: 0 },
    V4: { lastPitch: 52, lastEnd: -Infinity, noteCount: 0 },
  };

  const registerAnchor: Record<VoiceId, number> = { V1: 74, V2: 67, V3: 60, V4: 52 };

  sorted.forEach((note) => {
    let bestVoice: VoiceId = "V1";
    let bestScore = Number.POSITIVE_INFINITY;

    VOICES.forEach((voice) => {
      const voiceState = state[voice];
      const overlap = note.start < voiceState.lastEnd - 0.01;
      const pitchReference = voiceState.noteCount === 0 ? registerAnchor[voice] : voiceState.lastPitch;
      const jumpPenalty = Math.abs(note.pitch - pitchReference);
      const overlapPenalty = overlap ? 100 : 0;
      const emptyVoicePenalty = voiceState.noteCount === 0 ? 8 : 0;
      const score = jumpPenalty + overlapPenalty + emptyVoicePenalty;

      if (score < bestScore) {
        bestScore = score;
        bestVoice = voice;
      }
    });

    voices[bestVoice].push(note);
    state[bestVoice] = {
      lastPitch: note.pitch,
      lastEnd: note.start + note.duration,
      noteCount: state[bestVoice].noteCount + 1,
    };
  });

  return voices;
}

function mapMidiToVoices(arrayBuffer: ArrayBuffer): Record<VoiceId, NoteEvent[]> {
  const midi = new Midi(arrayBuffer);
  const tracks = midi.tracks
    .map((track) =>
      track.notes.map((note) => ({
        pitch: note.midi,
        start: note.time,
        duration: note.duration,
      }))
    )
    .filter((notes) => notes.length > 0);

  if (tracks.length === 0) {
    throw new Error("В этом MIDI не найдено нот.");
  }

  const mapped: Record<VoiceId, NoteEvent[]> = { V1: [], V2: [], V3: [], V4: [] };

  if (tracks.length >= 2) {
    const rankedTracks = tracks
      .map((notes) => ({
        notes,
        avgPitch: notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length,
      }))
      .sort((a, b) => b.avgPitch - a.avgPitch)
      .slice(0, 4);

    rankedTracks.forEach((item, index) => {
      mapped[VOICES[index]] = item.notes;
    });
  } else {
    const split = splitSingleTrackIntoVoices(tracks[0]);
    VOICES.forEach((voice) => {
      mapped[voice] = split[voice];
    });
  }

  return reorderVoicesByRegister(normalizeVoiceData(mapped));
}

function detectThemeWindows(data: Record<VoiceId, NoteEvent[]>): Record<VoiceId, ThemeWindow[]> {
  // 1. Динамическое определение длины темы по первому проведению в V1
  const allOtherNotes = Object.values(data).filter((_, i) => i !== 0).flat();
  const firstEntranceTime = allOtherNotes.length > 0 ? Math.min(...allOtherNotes.map(n => n.start)) : 8;
  const themeLength = Math.max(5, data.V1.filter(n => n.start < firstEntranceTime).length);

  const subject = data.V1.slice(0, themeLength);
  const targetIntervals = subject.slice(0, -1).map((n, i) => subject[i + 1].pitch - n.pitch);
  
  const result: Record<VoiceId, ThemeWindow[]> = { V1: [], V2: [], V3: [], V4: [] };

  VOICES.forEach((voice) => {
    const notes = data[voice];
    for (let i = 0; i <= notes.length - themeLength; i++) {
      const window = notes.slice(i, i + themeLength);
      const currentIntervals = window.slice(0, -1).map((n, j) => window[j + 1].pitch - n.pitch);

      // Более мягкое сравнение: разрешаем 2 полутона отклонения и 20% "ошибок"
      let diffs = 0;
      for (let j = 0; j < targetIntervals.length; j++) {
        if (Math.abs(currentIntervals[j] - targetIntervals[j]) > 2) diffs++;
      }

      if (diffs <= targetIntervals.length * 0.2) {
        result[voice].push({
          start: window[0].start,
          end: window[window.length - 1].start + window[window.length - 1].duration + 0.1,
        });
      }
    }
  });

  return result;
}

const useDeviceType = () => {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)"); // Увеличим порог для десктопов
    const listener = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    
    setIsDesktop(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  return isDesktop;
};

export default function App() {
  const [voiceColors, setVoiceColors] = useState(BASE_COLORS);
  const isDesktop = useDeviceType();
  const [visualMode, setVisualMode] = useState<'colorful' | 'minimal'>('colorful');
  const mountRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef(0);
  const isPlayingRef = useRef(true);
  const speedRef = useRef(1);
  const focusVoicesRef = useRef<VoiceId[]>([]);
  const accentThemeRef = useRef(true);
  const uiTickRef = useRef(0);
  const audioCursorRef = useRef(0);
  const audioEnabledRef = useRef(false);
  const bitCrusherRef = useRef<Tone.BitCrusher | null>(null);
  const masterFilterRef = useRef<Tone.Filter | null>(null);
  const compressorRef = useRef<Tone.Compressor | null>(null);
  const limiterRef = useRef<Tone.Limiter | null>(null);
  const masterGainRef = useRef<Tone.Gain | null>(null);
  const synthsRef = useRef<Record<VoiceId, Tone.PolySynth<Tone.Synth>> | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [focusVoices, setFocusVoices] = useState<VoiceId[]>([]);
  const [accentTheme, setAccentTheme] = useState(true);
  const [displayTime, setDisplayTime] = useState(0);
  const [fugueData, setFugueData] = useState<Record<VoiceId, NoteEvent[]>>(() => buildDemoData());
  const [sourceLabel, setSourceLabel] = useState("Демо-данные");
  const [loadError, setLoadError] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  const themeWindows = useMemo(() => detectThemeWindows(fugueData), [fugueData]);
  const voiceCenterPitch = useMemo(() => {
    const defaults: Record<VoiceId, number> = { V1: 74, V2: 67, V3: 60, V4: 52 };
    const centers: Record<VoiceId, number> = { ...defaults };

    VOICES.forEach((voice) => {
      const notes = fugueData[voice];
      if (notes.length === 0) {
        return;
      }
      const sortedPitch = notes.map((note) => note.pitch).sort((a, b) => a - b);
      centers[voice] = sortedPitch[Math.floor(sortedPitch.length / 2)];
    });

    return centers;
  }, [fugueData]);

  const loopDuration = useMemo(() => {
    const all = Object.values(fugueData).flat();
    return Math.max(...all.map((note) => note.start + note.duration)) + 2;
  }, [fugueData]);

  const themeEntriesCount = useMemo(
    () => Object.values(themeWindows).reduce((total, windows) => total + windows.length, 0),
    [themeWindows]
  );

  const activeVoices = useMemo(
    () =>
      VOICES.map(
        (voice) =>
          fugueData[voice].some((note) => displayTime >= note.start && displayTime < note.start + note.duration)
      ),
    [displayTime, fugueData]
  );

  const BASE_VOICE_DB: Record<VoiceId, number> = {
    V1: -13,
    V2: -14,
    V3: -15,
    V4: -16,
  };

  const applyFocusVoiceMix = () => {
    if (!synthsRef.current) {
      return;
    }

    const hasFocus = focusVoicesRef.current.length > 0;
    VOICES.forEach((voice) => {
      const inFocus = focusVoicesRef.current.includes(voice);
      const targetDb = hasFocus ? (inFocus ? BASE_VOICE_DB[voice] + 3 : BASE_VOICE_DB[voice] - 14) : BASE_VOICE_DB[voice];
      synthsRef.current?.[voice].volume.rampTo(targetDb, 0.09);
    });
  };

  const ensureAudioGraph = () => {
    if (synthsRef.current) {
      return;
    }

    const crusher = new Tone.BitCrusher(6);
    const filter = new Tone.Filter({ type: "lowpass", frequency: 4200, rolloff: -24 });
    const compressor = new Tone.Compressor({ threshold: -22, ratio: 3, attack: 0.01, release: 0.22 });
    const limiter = new Tone.Limiter(-1);
    const gain = new Tone.Gain(0.1);

    crusher.connect(filter);
    filter.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(gain);
    gain.toDestination();

    const makeSynth = () =>
      new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "square" },
        envelope: {
          attack: 0.005,
          decay: 0.02,
          sustain: 0.9,
          release: 0.03,
        },
      }).connect(crusher);

    synthsRef.current = {
      V1: makeSynth(),
      V2: makeSynth(),
      V3: makeSynth(),
      V4: makeSynth(),
    };
    VOICES.forEach((voice) => {
      if (synthsRef.current) {
        synthsRef.current[voice].volume.value = BASE_VOICE_DB[voice];
      }
    });

    applyFocusVoiceMix();
    bitCrusherRef.current = crusher;
    masterFilterRef.current = filter;
    compressorRef.current = compressor;
    limiterRef.current = limiter;
    masterGainRef.current = gain;
  };

  const releaseAllVoices = () => {
    if (!synthsRef.current) {
      return;
    }
    VOICES.forEach((voice) => {
      synthsRef.current?.[voice].releaseAll();
    });
  };

  const toggleAudio = async () => {
    // 1. Сначала принудительно запускаем аудио-контекст
    await Tone.start();
    
    if (audioEnabledRef.current) {
      releaseAllVoices();
      audioEnabledRef.current = false;
      setAudioEnabled(false);
      return;
    }

    try {
      // 2. Инициализируем граф только после того, как Tone.start() подтвердил запуск
      ensureAudioGraph();
      
      // 3. Дополнительно: пробуем восстановить состояние контекста
      if (Tone.context.state !== 'running') {
        await Tone.context.resume();
      }
      
      audioEnabledRef.current = true;
      audioCursorRef.current = timeRef.current;
      setAudioEnabled(true);
      setAudioError("");
    } catch (error) {
      setAudioError("Ошибка аудио: нажмите кнопку еще раз");
    }
  };

  useEffect(() => {
    const handleFirstInteraction = async () => {
      // Инициализируем аудио при первом же клике по экрану
      await Tone.start();
      // Убираем слушатели сразу, чтобы они не висели
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
    };

    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('touchstart', handleFirstInteraction);

    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    focusVoicesRef.current = focusVoices;
    applyFocusVoiceMix();
  }, [focusVoices]);

  useEffect(() => {
    accentThemeRef.current = accentTheme;
  }, [accentTheme]);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  useEffect(() => {
    if (!isPlaying) {
      releaseAllVoices();
      audioCursorRef.current = timeRef.current;
    }
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      releaseAllVoices();
      if (synthsRef.current) {
        VOICES.forEach((voice) => {
          synthsRef.current?.[voice].dispose();
        });
      }
      bitCrusherRef.current?.dispose();
      masterFilterRef.current?.dispose();
      compressorRef.current?.dispose();
      limiterRef.current?.dispose();
      masterGainRef.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (isDesktop) {
      setPanelOpen(false); // Автоматически прячем панель при перевороте на альбомный/десктоп
    }
  }, [isDesktop]);
  useEffect(() => {
    const host = mountRef.current;
    if (!host) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0a0c10");
    scene.fog = new THREE.Fog("#0a0c10", 16, 96);

    const camera = new THREE.PerspectiveCamera(54, host.clientWidth / host.clientHeight, 0.1, 180);

    const setCameraPreset = () => {
      const mobile = window.matchMedia("(max-width: 768px)").matches;
      camera.fov = mobile ? 58 : 50;
      camera.position.set(mobile ? 9.4 : 12.6, mobile ? -1.2 : -0.9, mobile ? 19.6 : 25.8);
      camera.lookAt(0, -1.4, -28);
      camera.updateProjectionMatrix();
    };

    setCameraPreset();

    const mobileInit = window.matchMedia("(max-width: 768px)").matches;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobileInit ? 1.4 : 1.8));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight("#ffffff", 0.78));

    const topLight = new THREE.DirectionalLight("#eceff4", 1.05);
    topLight.position.set(2, 8, 6);
    scene.add(topLight);

    const backLight = new THREE.DirectionalLight("#c7ccd8", 0.45);
    backLight.position.set(-4, 6, -8);
    scene.add(backLight);

    const notesGroup = new THREE.Group();
    // Keep the highest voice away from the very top edge of the viewport.
    notesGroup.position.y = -3.2;
    scene.add(notesGroup);

    const timeScale = 6.2;
    const laneSpacing = 5.2;
    const semitoneStep = 0.32;
    const gridMaterial = new THREE.LineBasicMaterial({ color: "#222831", transparent: true, opacity: 0.42 });
    for (let beat = 0; beat <= loopDuration + 4; beat += 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-2.6, -3.8, -beat * timeScale),
        new THREE.Vector3(2.6, -3.8, -beat * timeScale),
      ]);
      notesGroup.add(new THREE.Line(geometry, gridMaterial));
    }

    const laneMaterial = new THREE.LineBasicMaterial({ color: "#303844", transparent: true, opacity: 0.65 });
    for (let i = 0; i < VOICES.length; i += 1) {
      const baseY = (VOICES.length - 1 - i) * laneSpacing - 6;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-2.8, baseY, 1),
        new THREE.Vector3(2.8, baseY, 1),
      ]);
      notesGroup.add(new THREE.Line(geometry, laneMaterial));

      const depthGuideGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, baseY, 1),
        new THREE.Vector3(0, baseY, -loopDuration * timeScale - 8),
      ]);
      notesGroup.add(new THREE.Line(depthGuideGeometry, laneMaterial));
    }

    const playheadGeometry = new THREE.PlaneGeometry(13.8, 9.2);
    //const playheadMaterial = new THREE.MeshBasicMaterial({ color: "#e5e7eb", transparent: true, opacity: 0 });
    //const playhead = new THREE.Mesh(playheadGeometry, playheadMaterial);
    //playhead.position.set(0, 0.4, 0.8);
    //scene.add(playhead);

    const visualNotes: VisualNote[] = [];
    VOICES.forEach((voice, voiceIndex) => {
      fugueData[voice].forEach((note) => {
        const depth = note.duration * 2.9;
        const geometry = new THREE.BoxGeometry(0.62, 0.62, depth);
        const baseColor = new THREE.Color(BASE_COLORS[voice]);

        const isTheme = themeWindows[voice].some((window) => {
  // Проверяем, находится ли нота целиком внутри диапазона темы
        return note.start >= window.start - 0.05 && (note.start + note.duration) <= window.end + 0.05;});

        const material = new THREE.MeshStandardMaterial({
          color: visualMode === 'colorful' ? baseColor : new THREE.Color("#1a1a1a"),
          transparent: false, // Убираем прозрачность
          metalness: 0.1,
          roughness: 0.4,
        });

        const mesh = new THREE.Mesh(geometry, material);
        const laneY = (VOICES.length - 1 - voiceIndex) * laneSpacing - 6;
        const y = laneY + (note.pitch - voiceCenterPitch[voice]) * semitoneStep;
        mesh.position.set(0, y, -note.start * timeScale - depth / 2);

        // Additive shell creates a clear "playing now" glow without post-processing.
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: baseColor,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const glowMesh = new THREE.Mesh(geometry.clone(), glowMaterial);
        glowMesh.position.set(mesh.position.x, mesh.position.y, mesh.position.z - 0.01);
        glowMesh.scale.set(1.06, 1.06, 1.01);

        notesGroup.add(mesh);
        notesGroup.add(glowMesh);

        visualNotes.push({
          voice,
          start: note.start,
          end: note.start + note.duration,
          isTheme,
          baseColor,
          material,
          mesh,
          glowMaterial,
          glowMesh,
        });
      });
    });

    const clock = new THREE.Clock();
    let raf = 0;

    const triggerNotesInRange = (rangeStart: number, rangeEnd: number) => {
      if (!audioEnabledRef.current || !synthsRef.current || Tone.context.state !== "running") {
        return;
      }

      VOICES.forEach((voice) => {
        const synth = synthsRef.current?.[voice];
        if (!synth) {
          return;
        }

        fugueData[voice].forEach((note) => {
          if (note.start >= rangeStart && note.start < rangeEnd) {
            const isThemeNote = themeWindows[voice].some((window) => 
            note.start >= window.start - 0.1 && note.start < window.end);
            const duration = Math.max(0.05, note.duration / Math.max(0.2, speedRef.current));
            const velocity = isThemeNote && accentThemeRef.current ? 0.82 : 0.68;
            synth.triggerAttackRelease(
              Tone.Frequency(note.pitch, "midi").toFrequency(),
              duration,
              Tone.now() + 0.01,
              velocity
            );
          }
        });
      });
    };

    const onResize = () => {
      if (!mountRef.current) {
        return;
      }
      setCameraPreset();
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();

      const mobile = window.matchMedia("(max-width: 768px)").matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.4 : 1.8));
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };

    const animate = () => {
      const delta = clock.getDelta();
      const previousTime = audioCursorRef.current;

      if (isPlayingRef.current) {
        timeRef.current += delta * speedRef.current;
        if (timeRef.current > loopDuration) timeRef.current = 0;
      }

      if (isPlayingRef.current && audioEnabledRef.current) {
        if (timeRef.current >= previousTime) {
          triggerNotesInRange(previousTime, timeRef.current);
        } else {
          triggerNotesInRange(previousTime, loopDuration + 0.0001);
          triggerNotesInRange(0, timeRef.current);
        }
      }
      audioCursorRef.current = timeRef.current;

      uiTickRef.current += delta;
      if (uiTickRef.current > 0.1) {
        setDisplayTime(timeRef.current);
        uiTickRef.current = 0;
      }

      notesGroup.position.z = timeRef.current * timeScale;

      // Управление фоном и сеткой
      const isMinimal = visualMode === 'minimal';
      scene.background = new THREE.Color(isMinimal ? "#000000" : "#0a0c10");
      notesGroup.children.forEach((child) => {
        if (child instanceof THREE.Line) child.visible = !isMinimal;
      });

      visualNotes.forEach((item) => {
  // Настройка временных рамок
  const attack = 0.15;
  const release = 0.25;
  
  // Расчет "энергии" ноты (0.0 - 1.0)
  let noteEnergy = 0;
  if (timeRef.current >= item.start - attack && timeRef.current <= item.end + release) {
    if (timeRef.current < item.start) {
      noteEnergy = (timeRef.current - (item.start - attack)) / attack;
    } else if (timeRef.current <= item.end) {
      noteEnergy = 1;
    } else {
      noteEnergy = Math.max(0, 1 - (timeRef.current - item.end) / release);
    }
  }

  const isThemeNow = item.isTheme && accentThemeRef.current;
  const hasFocus = focusVoicesRef.current.length === 0 || focusVoicesRef.current.includes(item.voice);
  const focusFactor = hasFocus ? 1 : 0.2;
  const backgroundDim = (isThemeNow || !accentThemeRef.current) ? 1.0 : 0.15;

  if (visualMode === 'minimal') {
    // 1. Убираем Z-fighting
    item.material.transparent = true;
    item.material.depthWrite = false; 
    item.material.alphaTest = 0.05; 
    
    item.mesh.visible = true;
    item.material.opacity = noteEnergy > 0 ? noteEnergy : 0; 
    item.material.emissive.set(noteEnergy > 0.1 ? "#ffffff" : "#000000");
    
    item.mesh.renderOrder = 1;
  } else {
    // Плотный цветной режим
    item.material.transparent = false;
    item.material.depthWrite = true; 
    item.material.opacity = 1.0;
    
    const intensity = noteEnergy * (isThemeNow ? 3.0 : 1.5);
    const currentColor = new THREE.Color(voiceColors[item.voice]);
    item.material.color.copy(currentColor).multiplyScalar(focusFactor * backgroundDim);
    item.material.emissive.copy(currentColor).multiplyScalar(intensity * focusFactor * backgroundDim);
    
    item.mesh.renderOrder = 0;
  }

  // Пульсация темы (вне if/else, но внутри цикла)
  const themeScale = isThemeNow ? 1.1 + Math.sin(timeRef.current * 8) * 0.04 : 1.0;
  item.mesh.scale.set(themeScale, themeScale * (1 + noteEnergy * 0.1), themeScale);

});
  
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    window.addEventListener("resize", onResize);
    raf = requestAnimationFrame(animate);

    // ВОТ ОН, ТВОЙ RETURN (ОЧИСТКА ПАМЯТИ)
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      visualNotes.forEach((item) => {
        item.mesh.geometry.dispose();
        item.material.dispose();
        item.glowMesh.geometry.dispose();
        item.glowMaterial.dispose();
      });
      playheadGeometry.dispose();
      //playheadMaterial.dispose();
      gridMaterial.dispose();
      laneMaterial.dispose();
      renderer.dispose();
      if (host.contains(renderer.domElement)) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [fugueData, loopDuration, themeWindows, voiceCenterPitch, visualMode, voiceColors]);

  const toggleFocus = (voice: VoiceId) => {
    setFocusVoices((prev) => {
      if (prev.includes(voice)) {
        return prev.filter((item) => item !== voice);
      }
      if (prev.length < 2) {
        return [...prev, voice];
      }
      return [prev[1], voice];
    });
  };

  const onMidiPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const parsedData = mapMidiToVoices(buffer);
      const noteCount = Object.values(parsedData).flat().length;
      if (noteCount < 8) {
        throw new Error("Слишком мало нот для стабильной визуализации.");
      }

      setFugueData(parsedData);
      setSourceLabel(file.name);
      setLoadError("");
      setFocusVoices([]);
      releaseAllVoices();
      timeRef.current = 0;
      audioCursorRef.current = 0;
      setDisplayTime(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось прочитать MIDI файл.";
      setLoadError(message);
    } finally {
      event.target.value = "";
    }
  };

  const resetPlayback = () => {
    releaseAllVoices();
    timeRef.current = 0;
    audioCursorRef.current = 0;
    setDisplayTime(0);
  };

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#0a0c10] text-zinc-100 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div ref={mountRef} className="absolute inset-0" />
      {visualMode !== 'minimal' && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/60" />
      )}

      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 flex items-start justify-between px-4 pt-4 sm:px-6"
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-400">Fuga Vision</p>
          <h1 className="mt-1 text-xl font-medium sm:text-2xl">{visualMode === 'minimal' ? "Минимализм" : "Fuga Vision"}</h1>
        </div>
        <div className="text-right text-xs text-zinc-300">
          <p>t {displayTime.toFixed(1)}s</p>
          <p>theme {themeEntriesCount}</p>
          <p className="max-w-36 truncate">{sourceLabel}</p>
          <div className="mt-1 flex justify-end gap-1">
            {activeVoices.map((isActive, index) => (
              <span
                key={`active-${VOICES[index]}`}
                className={`h-2 w-5 rounded-full transition ${isActive ? "bg-zinc-100" : "bg-zinc-600"}`}
              />
            ))}
          </div>
        </div>
      </motion.header>

      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={() => setPanelOpen((prev) => !prev)}
        className="fixed bottom-4 right-4 z-50 rounded-full border border-white/20 bg-black/50 px-4 py-2 text-sm lg:hidden"
      >
        {panelOpen ? "Скрыть" : "Панель"}
      </motion.button>

      <AnimatePresence>
        {(panelOpen || isDesktop) && (
          <motion.section
            initial={{ opacity: 0, y: isDesktop ? 16 : "100%" }} // На мобиле выезжает снизу вверх
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: isDesktop ? 16 : "100%" }}
            transition={{ duration: 0.32, ease: "easeOut" }}
            className={`fixed z-40 bg-black/95 backdrop-blur-2xl border-white/10
              ${isDesktop 
                ? "inset-x-0 bottom-0 mx-6 mb-6 max-w-4xl rounded-lg border" 
                : "inset-0 h-full w-full p-6 flex flex-col justify-center overflow-y-auto"}`} // ВОТ ЗДЕСЬ СЕКРЕТ
          >
            <div className="flex flex-wrap items-center gap-2">
              <label className="min-h-10 cursor-pointer rounded border border-white/20 px-4 text-sm leading-10">
                Загрузить MIDI
                <input type="file" accept=".mid,.midi,audio/midi" onChange={onMidiPicked} className="hidden" />
              </label>
              <button type="button" onClick={() => void toggleAudio()} className={`min-h-10 rounded px-4 text-sm ${audioEnabled ? "bg-white text-black" : "border border-white/20"}`}>
                8-bit {audioEnabled ? "вкл" : "выкл"}
              </button>
              <button type="button" onClick={() => setIsPlaying((prev) => !prev)} className="min-h-10 rounded border border-white/20 px-4 text-sm">
                {isPlaying ? "Пауза" : "Старт"}
              </button>
              <button type="button" onClick={resetPlayback} className="min-h-10 rounded border border-white/20 px-4 text-sm">С начала</button>
              <button type="button" onClick={() => setVisualMode((prev) => (prev === 'colorful' ? 'minimal' : 'colorful'))} className={`min-h-10 rounded px-4 text-sm ${visualMode === 'minimal' ? "bg-white text-black" : "border border-white/20"}`}>
                Режим: {visualMode === 'colorful' ? "Цветной" : "Минимализм"}
              </button>
              <button type="button" onClick={() => setAccentTheme((prev) => !prev)} className={`min-h-10 rounded px-4 text-sm ${accentTheme ? "bg-white text-black" : "border border-white/20"}`}>
                Тема: {accentTheme ? "вкл" : "выкл"}
              </button>
              <label className="ml-auto flex items-center gap-2 text-sm">
                Скорость
                <input type="range" min={0.4} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-24" />
                <span className="w-8 text-right">x{speed.toFixed(1)}</span>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {VOICES.map((voice, index) => (
                <button key={voice} type="button" onClick={() => toggleFocus(voice)} className={`min-h-9 rounded px-3 text-sm ${focusVoices.includes(voice) ? "bg-white text-black" : "border border-white/20"}`}>
                  Фокус {index + 1}
                </button>
              ))}
              <button type="button" onClick={() => setFocusVoices([])} className="min-h-9 rounded border border-white/20 px-3 text-sm">Сброс</button>
            </div>
            
            {(loadError || audioError) && <p className="mt-2 text-xs text-rose-300">{loadError || audioError}</p>}
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
