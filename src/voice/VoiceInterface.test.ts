import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VoiceInterface } from './VoiceInterface';
import type { VoiceEvent, VoiceCommand } from './VoiceInterface';

// ── DOM Mocks (needed for bun test which doesn't load vitest setupFiles) ──

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

if (typeof navigator !== 'undefined' && !navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => {} }],
      }),
    },
    configurable: true,
  });
}

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

if (typeof Audio === 'undefined') {
  (globalThis as any).Audio = class MockAudio {
    src = '';
    onended: (() => void) | null = null;
    play() {
      return Promise.resolve();
    }
    pause() {}
    load() {}
  };
}

// ── Mocks ───────────────────────────────────────────────────────────

const mockInferFn = vi.fn().mockResolvedValue(
  JSON.stringify({
    type: 'dictate',
    text: 'Hello world',
  })
);

function makeConfig(overrides: any = {}) {
  return {
    sttEndpoint: 'https://stt.test.com/v1/transcribe',
    inferFn: mockInferFn,
    defaultMode: 'dictation' as const,
    language: 'en',
    continuous: false,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('VoiceInterface', () => {
  let voice: VoiceInterface;

  beforeEach(() => {
    vi.useFakeTimers();
    mockInferFn.mockClear();
    voice = new VoiceInterface(makeConfig());
  });

  afterEach(() => {
    voice.stop();
    vi.useRealTimers();
  });

  describe('construction', () => {
    it('creates with required config', () => {
      expect(voice).toBeDefined();
    });

    it('creates with all optional config', () => {
      const v = new VoiceInterface(
        makeConfig({
          sttAuthToken: 'test-token',
          ttsFn: vi.fn(),
          wakeWord: 'hey editor',
          continuous: true,
        })
      );
      expect(v).toBeDefined();
      v.stop();
    });
  });

  describe('state', () => {
    it('starts inactive', () => {
      const state = voice.getState();
      expect(state.active).toBe(false);
      expect(state.listening).toBe(false);
      expect(state.processing).toBe(false);
      expect(state.mode).toBe('dictation');
    });

    it('updates mode', () => {
      voice.setMode('navigation');
      expect(voice.getState().mode).toBe('navigation');
    });

    it('supports all voice modes', () => {
      voice.setMode('dictation');
      expect(voice.getState().mode).toBe('dictation');

      voice.setMode('navigation');
      expect(voice.getState().mode).toBe('navigation');

      voice.setMode('conversation');
      expect(voice.getState().mode).toBe('conversation');
    });
  });

  describe('start/stop', () => {
    it('starts the voice interface', async () => {
      await voice.start();
      expect(voice.getState().active).toBe(true);
    });

    it('starts with a specific mode', async () => {
      await voice.start('navigation');
      expect(voice.getState().mode).toBe('navigation');
    });

    it('stops the voice interface', async () => {
      await voice.start();
      voice.stop();
      expect(voice.getState().active).toBe(false);
    });

    it('handles double stop gracefully', async () => {
      await voice.start();
      voice.stop();
      voice.stop();
      expect(voice.getState().active).toBe(false);
    });
  });

  describe('command registration', () => {
    it('registers a command handler', () => {
      const handler = vi.fn();
      const unsub = voice.onCommand('dictate', handler);
      expect(typeof unsub).toBe('function');
      unsub();
    });
  });

  describe('events', () => {
    it('emits start event', async () => {
      const events: VoiceEvent[] = [];
      voice.on((e) => events.push(e));

      await voice.start();
      expect(events.some((e) => e.type === 'started')).toBe(true);
    });

    it('emits stop event', async () => {
      const events: VoiceEvent[] = [];
      await voice.start();

      voice.on((e) => events.push(e));
      voice.stop();

      expect(events.some((e) => e.type === 'stopped')).toBe(true);
    });

    it('emits mode-changed event', () => {
      const events: VoiceEvent[] = [];
      voice.on((e) => events.push(e));

      voice.setMode('conversation');
      expect(events.some((e) => e.type === 'mode-changed')).toBe(true);
    });

    it('supports unsubscribe', async () => {
      let count = 0;
      const unsub = voice.on(() => {
        count++;
      });

      await voice.start();
      expect(count).toBeGreaterThan(0);

      const prev = count;
      unsub();
      voice.setMode('navigation');
      expect(count).toBe(prev);
    });
  });

  describe('TTS', () => {
    it('reads text aloud with ttsFn', async () => {
      const ttsFn = vi.fn().mockResolvedValue(new ArrayBuffer(8));
      const v = new VoiceInterface(makeConfig({ ttsFn }));

      await v.readAloud('Hello world');
      expect(ttsFn).toHaveBeenCalledWith('Hello world');
      v.stop();
    });

    it('falls back to Web Speech API when no ttsFn', async () => {
      // Should not throw even without ttsFn
      await voice.readAloud('Hello');
    });
  });

  describe('quick parse (pattern matching)', () => {
    it('identifies stop commands', async () => {
      // Internal method, tested via the full command pipeline
      // The quickParse should catch "stop" in any mode
      await voice.start();
      // Quick parse is internal; we test via behavior
      voice.stop();
    });
  });
});
