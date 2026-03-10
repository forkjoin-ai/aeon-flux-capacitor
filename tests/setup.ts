/**
 * Test setup — global mocks and environment
 */

// Mock performance.now for deterministic tests
if (typeof performance === 'undefined') {
  (globalThis as any).performance = { now: () => Date.now() };
}

// Mock ResizeObserver
if (typeof ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    trigger(entries: any[]) {
      this.callback(entries, this);
    }
  };
}

// Mock MediaRecorder for VoiceInterface tests
if (typeof MediaRecorder === 'undefined') {
  (globalThis as any).MediaRecorder = class MockMediaRecorder {
    stream: any;
    state = 'inactive';
    ondataavailable: ((e: any) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(stream: any, _options?: any) {
      this.stream = stream;
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['mock']) });
      this.onstop?.();
    }
    static isTypeSupported() {
      return true;
    }
  };
}

// Mock navigator.mediaDevices for VoiceInterface tests
if (typeof navigator !== 'undefined' && !navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => {} }],
      }),
    },
  });
}

// Mock speechSynthesis for VoiceInterface TTS tests
if (typeof speechSynthesis === 'undefined') {
  (globalThis as any).speechSynthesis = {
    speak: () => {},
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    getVoices: () => [],
    speaking: false,
    paused: false,
    pending: false,
  };
}

// Mock SpeechSynthesisUtterance
if (typeof SpeechSynthesisUtterance === 'undefined') {
  (globalThis as any).SpeechSynthesisUtterance = class MockUtterance {
    text = '';
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: any = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text?: string) {
      this.text = text ?? '';
    }
  };
}

// Mock Audio for playback tests
if (typeof Audio === 'undefined') {
  (globalThis as any).Audio = class MockAudio {
    src = '';
    play() {
      return Promise.resolve();
    }
    pause() {}
    load() {}
  };
}
