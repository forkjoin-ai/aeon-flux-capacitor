/**
 * VoiceInterface — Voice-first editing, navigation, and dictation
 *
 * NOBODY HAS BUILT THIS FOR WRITING.
 *
 * Like that coding service you talk to — but for writing.
 * The editor becomes a conversational surface:
 *   - "Go to the section about pricing"
 *   - "Read me paragraph 3"
 *   - "Delete the last two sentences"
 *   - "Make this more formal"
 *   - "Insert a transition after the introduction"
 *   - "What did I write about security?"
 *
 * Uses Edgework STT for transcription. All processing at the edge.
 *
 * Three modes:
 *   1. DICTATION — voice → text (speech becomes content)
 *   2. NAVIGATION — voice → commands (navigate, select, scroll)
 *   3. CONVERSATION — voice → AI interaction (ask questions, request edits)
 */

// ── Types ───────────────────────────────────────────────────────────

export type VoiceMode = 'dictation' | 'navigation' | 'conversation';

export interface VoiceCommand {
  /** The raw transcript */
  readonly transcript: string;
  /** Parsed intent */
  readonly intent: VoiceIntent;
  /** Confidence (0-1) */
  readonly confidence: number;
  /** Timestamp */
  readonly timestamp: string;
  /** Whether the command was executed */
  executed: boolean;
}

export type VoiceIntent =
  // Dictation
  | { type: 'dictate'; text: string }
  | { type: 'dictate-replace'; target: string; replacement: string }
  // Navigation
  | { type: 'goto-section'; query: string }
  | { type: 'goto-block'; blockId: string }
  | {
      type: 'scroll';
      direction: 'up' | 'down';
      amount: 'page' | 'half' | 'top' | 'bottom';
    }
  | { type: 'select'; target: string }
  // Editing
  | { type: 'delete'; target: 'selection' | 'sentence' | 'paragraph' | 'word' }
  | { type: 'undo' }
  | { type: 'redo' }
  // AI
  | { type: 'rewrite'; instruction: string }
  | { type: 'ask'; question: string }
  | {
      type: 'insert';
      instruction: string;
      position: 'before' | 'after' | 'here';
    }
  | { type: 'read-aloud'; target: 'selection' | 'paragraph' | 'document' }
  // Meta
  | { type: 'switch-mode'; mode: VoiceMode }
  | { type: 'stop' }
  | { type: 'unknown'; transcript: string };

export interface VoiceState {
  /** Whether voice is active */
  readonly active: boolean;
  /** Current mode */
  readonly mode: VoiceMode;
  /** Whether currently listening */
  readonly listening: boolean;
  /** Whether currently processing */
  readonly processing: boolean;
  /** Last transcript */
  readonly lastTranscript: string;
  /** Recent commands */
  readonly recentCommands: VoiceCommand[];
}

export interface VoiceInterfaceConfig {
  /** Edgework STT endpoint */
  readonly sttEndpoint: string;
  /** Edgework auth token */
  readonly sttAuthToken?: string;
  /** Inference function for intent parsing */
  readonly inferFn: (prompt: string) => Promise<string>;
  /** TTS function for read-aloud */
  readonly ttsFn?: (text: string) => Promise<ArrayBuffer>;
  /** Default mode */
  readonly defaultMode?: VoiceMode;
  /** Language (default: en-US) */
  readonly language?: string;
  /** Wake word (default: none — always listening when active) */
  readonly wakeWord?: string;
  /** Continuous dictation (default: true) */
  readonly continuous?: boolean;
}

// ── Voice Interface Engine ──────────────────────────────────────────

export class VoiceInterface {
  private config: VoiceInterfaceConfig;
  private state: VoiceState;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private listeners: Set<(event: VoiceEvent) => void> = new Set();
  private commandHandlers: Map<string, (intent: VoiceIntent) => Promise<void>> =
    new Map();
  private silenceTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: VoiceInterfaceConfig) {
    this.config = config;
    this.state = {
      active: false,
      mode: config.defaultMode ?? 'dictation',
      listening: false,
      processing: false,
      lastTranscript: '',
      recentCommands: [],
    };
  }

  /**
   * Start the voice interface.
   */
  async start(mode?: VoiceMode): Promise<void> {
    if (this.state.active) return;

    if (mode) this.updateState({ mode });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: this.getSupportedMimeType(),
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        if (this.audioChunks.length > 0) {
          await this.processAudio();
        }
      };

      this.updateState({ active: true, listening: true });
      this.startListening();
      this.emit({ type: 'started', mode: this.state.mode });
    } catch (err) {
      this.emit({ type: 'error', error: 'Microphone access denied' });
    }
  }

  /**
   * Stop the voice interface.
   */
  stop(): void {
    if (!this.state.active) return;

    this.stopListening();

    if (this.mediaRecorder) {
      const tracks = this.mediaRecorder.stream.getTracks();
      tracks.forEach((t) => t.stop());
      this.mediaRecorder = null;
    }

    this.updateState({ active: false, listening: false, processing: false });
    this.emit({ type: 'stopped' });
  }

  /**
   * Switch voice mode.
   */
  setMode(mode: VoiceMode): void {
    this.updateState({ mode });
    this.emit({ type: 'mode-changed', mode });
  }

  /**
   * Register a handler for voice commands.
   */
  onCommand(
    intentType: string,
    handler: (intent: VoiceIntent) => Promise<void>
  ): () => void {
    this.commandHandlers.set(intentType, handler);
    return () => this.commandHandlers.delete(intentType);
  }

  /**
   * Read text aloud using TTS.
   */
  async readAloud(text: string): Promise<void> {
    if (this.config.ttsFn) {
      const audio = await this.config.ttsFn(text);
      const blob = new Blob([audio], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const player = new Audio(url);
      player.onended = () => URL.revokeObjectURL(url);
      await player.play();
    } else {
      // Fallback to Web Speech API
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.config.language ?? 'en-US';
      speechSynthesis.speak(utterance);
    }
  }

  /**
   * Get current state.
   */
  getState(): VoiceState {
    return { ...this.state };
  }

  /**
   * Listen for voice events.
   */
  on(listener: (event: VoiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Private: Recording & Transcription ────────────────────────

  private startListening(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'recording') return;

    this.audioChunks = [];
    this.mediaRecorder.start(250); // collect data every 250ms

    // Detect silence to know when a "sentence" is done
    this.resetSilenceDetection();
  }

  private stopListening(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
    }
  }

  private resetSilenceDetection(): void {
    if (this.silenceTimeout) clearTimeout(this.silenceTimeout);

    // After 2 seconds of no new data, process what we have
    this.silenceTimeout = setTimeout(() => {
      if (this.mediaRecorder?.state === 'recording') {
        this.mediaRecorder.stop();
        // Restart for continuous mode
        if (this.config.continuous !== false && this.state.active) {
          setTimeout(() => this.startListening(), 100);
        }
      }
    }, 2000);
  }

  private async processAudio(): Promise<void> {
    this.updateState({ processing: true });

    const audioBlob = new Blob(this.audioChunks, {
      type: this.getSupportedMimeType(),
    });
    this.audioChunks = [];

    try {
      // Send to Edgework STT
      const transcript = await this.transcribeViaEdgework(audioBlob);
      if (!transcript || transcript.trim().length === 0) {
        this.updateState({ processing: false });
        return;
      }

      this.updateState({ lastTranscript: transcript });
      this.emit({ type: 'transcript', text: transcript });

      // Parse intent based on mode
      const command = await this.parseCommand(transcript);
      this.addCommand(command);

      // Execute command
      await this.executeCommand(command);
    } catch (err) {
      this.emit({ type: 'error', error: `Transcription failed: ${err}` });
    }

    this.updateState({ processing: false });
  }

  private async transcribeViaEdgework(audioBlob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('language', this.config.language ?? 'en-US');

    const headers: Record<string, string> = {};
    if (this.config.sttAuthToken) {
      headers['Authorization'] = `Bearer ${this.config.sttAuthToken}`;
    }

    const response = await fetch(this.config.sttEndpoint, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) throw new Error(`STT error: ${response.status}`);

    const result = await response.json();
    return result.text ?? result.transcript ?? '';
  }

  private async parseCommand(transcript: string): Promise<VoiceCommand> {
    const mode = this.state.mode;
    let intent: VoiceIntent;

    // Quick pattern matching for common commands
    const quickIntent = this.quickParse(transcript, mode);
    if (quickIntent) {
      intent = quickIntent;
    } else if (mode === 'dictation') {
      // In dictation mode, everything is text unless it's a clear command
      intent = { type: 'dictate', text: transcript };
    } else {
      // Use inference for complex intents
      intent = await this.inferIntent(transcript, mode);
    }

    return {
      transcript,
      intent,
      confidence: quickIntent ? 0.95 : 0.7,
      timestamp: new Date().toISOString(),
      executed: false,
    };
  }

  private quickParse(transcript: string, mode: VoiceMode): VoiceIntent | null {
    const lower = transcript.toLowerCase().trim();

    // Mode switching
    if (lower === 'dictation mode' || lower === 'start dictating')
      return { type: 'switch-mode', mode: 'dictation' };
    if (lower === 'navigation mode' || lower === 'navigate')
      return { type: 'switch-mode', mode: 'navigation' };
    if (lower === 'conversation mode' || lower === "let's talk")
      return { type: 'switch-mode', mode: 'conversation' };
    if (lower === 'stop' || lower === 'stop listening') return { type: 'stop' };

    // Editing
    if (lower === 'undo') return { type: 'undo' };
    if (lower === 'redo') return { type: 'redo' };
    if (lower === 'delete that' || lower === 'delete selection')
      return { type: 'delete', target: 'selection' };
    if (lower === 'delete sentence')
      return { type: 'delete', target: 'sentence' };
    if (lower === 'delete paragraph')
      return { type: 'delete', target: 'paragraph' };

    // Navigation
    if (lower === 'scroll down')
      return { type: 'scroll', direction: 'down', amount: 'page' };
    if (lower === 'scroll up')
      return { type: 'scroll', direction: 'up', amount: 'page' };
    if (lower === 'go to top')
      return { type: 'scroll', direction: 'up', amount: 'top' };
    if (lower === 'go to bottom')
      return { type: 'scroll', direction: 'down', amount: 'bottom' };

    // Read aloud
    if (lower.startsWith('read ')) {
      if (lower.includes('paragraph'))
        return { type: 'read-aloud', target: 'paragraph' };
      if (lower.includes('selection'))
        return { type: 'read-aloud', target: 'selection' };
      if (lower.includes('document') || lower.includes('everything'))
        return { type: 'read-aloud', target: 'document' };
    }

    // "Go to" section
    if (lower.startsWith('go to ') && mode === 'navigation') {
      return { type: 'goto-section', query: transcript.slice(6) };
    }

    return null;
  }

  private async inferIntent(
    transcript: string,
    mode: VoiceMode
  ): Promise<VoiceIntent> {
    const response = await this.config.inferFn(
      `Parse this voice command for a document editor in ${mode} mode.
      Respond in JSON with ONE of these intent types:
      - { "type": "goto-section", "query": "..." }
      - { "type": "rewrite", "instruction": "..." }
      - { "type": "ask", "question": "..." }
      - { "type": "insert", "instruction": "...", "position": "before" | "after" | "here" }
      - { "type": "select", "target": "..." }
      - { "type": "dictate", "text": "..." }

      Voice command: "${transcript}"`
    );

    try {
      return JSON.parse(response);
    } catch {
      return { type: 'unknown', transcript };
    }
  }

  private async executeCommand(command: VoiceCommand): Promise<void> {
    const handler = this.commandHandlers.get(command.intent.type);
    if (handler) {
      await handler(command.intent);
      command.executed = true;
    }

    // Handle mode switching internally
    if (command.intent.type === 'switch-mode') {
      this.setMode(command.intent.mode);
      command.executed = true;
    }

    if (command.intent.type === 'stop') {
      this.stop();
      command.executed = true;
    }

    this.emit({ type: 'command', command });
  }

  // ── Helpers ───────────────────────────────────────────────────

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg',
      'audio/mp4',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'audio/webm';
  }

  private updateState(partial: Partial<VoiceState>): void {
    this.state = { ...this.state, ...partial };
  }

  private addCommand(command: VoiceCommand): void {
    const recent = [command, ...this.state.recentCommands].slice(0, 20);
    this.updateState({ recentCommands: recent });
  }

  private emit(event: VoiceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

// ── Events ──────────────────────────────────────────────────────────

export type VoiceEvent =
  | { type: 'started'; mode: VoiceMode }
  | { type: 'stopped' }
  | { type: 'mode-changed'; mode: VoiceMode }
  | { type: 'transcript'; text: string }
  | { type: 'command'; command: VoiceCommand }
  | { type: 'error'; error: string };
