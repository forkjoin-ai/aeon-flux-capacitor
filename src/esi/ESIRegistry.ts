/**
 * ESI Tag Registry — First-party ESI tag support
 *
 * Registers embeddable ESI tags for on-demand inference
 * within the editor. Each tag maps to an inference endpoint
 * and renders inline or as a block.
 */

// ── Types ───────────────────────────────────────────────────────────

/** ESI tag definition */
export interface ESITagDefinition {
  /** Tag name (e.g., 'summarize', 'translate', 'generate') */
  readonly name: string;
  /** Display label */
  readonly label: string;
  /** Description */
  readonly description: string;
  /** Whether this renders inline or as a block */
  readonly display: 'inline' | 'block';
  /** Required props */
  readonly requiredProps: string[];
  /** Optional props with defaults */
  readonly optionalProps?: Record<string, unknown>;
  /** The inference endpoint path */
  readonly endpoint: string;
  /** HTTP method */
  readonly method: 'GET' | 'POST';
  /** Maximum cache TTL in seconds */
  readonly cacheTTL?: number;
  /** Whether this tag can stream responses */
  readonly streaming?: boolean;
}

/** ESI tag invocation */
export interface ESIInvocation {
  /** The tag name */
  readonly tag: string;
  /** Props passed to the tag */
  readonly props: Record<string, unknown>;
  /** The block ID this tag is embedded in */
  readonly blockId: string;
  /** Current status */
  status: 'pending' | 'loading' | 'complete' | 'error';
  /** The result (once complete) */
  result?: string;
  /** Error message */
  error?: string;
}

/** ESI service configuration */
export interface ESIConfig {
  /** Base URL for ESI endpoints */
  readonly baseUrl: string;
  /** Auth token provider */
  readonly getToken: () => Promise<string>;
  /** Default model */
  readonly defaultModel?: string;
}

// ── Registry ────────────────────────────────────────────────────────

export class ESIRegistry {
  private tags: Map<string, ESITagDefinition> = new Map();
  private invocations: Map<string, ESIInvocation> = new Map();
  private config: ESIConfig;

  constructor(config: ESIConfig) {
    this.config = config;
    this.registerBuiltinTags();
  }

  /** Register a custom ESI tag */
  register(definition: ESITagDefinition): void {
    this.tags.set(definition.name, definition);
  }

  /** Get a tag definition */
  getTag(name: string): ESITagDefinition | undefined {
    return this.tags.get(name);
  }

  /** List all registered tags */
  listTags(): ESITagDefinition[] {
    return Array.from(this.tags.values());
  }

  /**
   * Invoke an ESI tag — make the inference request.
   */
  async invoke(
    tag: string,
    props: Record<string, unknown>,
    blockId: string
  ): Promise<string> {
    const definition = this.tags.get(tag);
    if (!definition) throw new Error(`Unknown ESI tag: ${tag}`);

    // Validate required props
    for (const prop of definition.requiredProps) {
      if (!(prop in props)) {
        throw new Error(`Missing required prop "${prop}" for ESI tag "${tag}"`);
      }
    }

    const invocationId = `${blockId}:${tag}:${Date.now()}`;
    const invocation: ESIInvocation = {
      tag,
      props: { ...definition.optionalProps, ...props },
      blockId,
      status: 'loading',
    };
    this.invocations.set(invocationId, invocation);

    try {
      const token = await this.config.getToken();
      const url = `${this.config.baseUrl}${definition.endpoint}`;

      const response = await fetch(url, {
        method: definition.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body:
          definition.method === 'POST'
            ? JSON.stringify({
                ...invocation.props,
                model: this.config.defaultModel,
              })
            : undefined,
      });

      if (!response.ok) {
        throw new Error(`ESI ${tag} failed: ${response.status}`);
      }

      const data = await response.json();
      const result =
        data.choices?.[0]?.message?.content ||
        data.result ||
        JSON.stringify(data);

      invocation.status = 'complete';
      invocation.result = result;

      return result;
    } catch (err) {
      invocation.status = 'error';
      invocation.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Get an invocation by ID */
  getInvocation(id: string): ESIInvocation | undefined {
    return this.invocations.get(id);
  }

  /** Get all invocations for a block */
  getInvocationsForBlock(blockId: string): ESIInvocation[] {
    return Array.from(this.invocations.values()).filter(
      (inv) => inv.blockId === blockId
    );
  }

  // ── Built-in Tags ──────────────────────────────────────────────

  private registerBuiltinTags(): void {
    this.register({
      name: 'summarize',
      label: 'Summarize',
      description: 'Generate a concise summary',
      display: 'block',
      requiredProps: ['text'],
      endpoint: '/v1/chat/completions',
      method: 'POST',
      cacheTTL: 3600,
      streaming: true,
    });

    this.register({
      name: 'translate',
      label: 'Translate',
      description: 'Translate text to another language',
      display: 'inline',
      requiredProps: ['text', 'target_language'],
      endpoint: '/v1/chat/completions',
      method: 'POST',
      cacheTTL: 86400,
    });

    this.register({
      name: 'rewrite',
      label: 'Rewrite',
      description: 'Rewrite text with a different style or tone',
      display: 'block',
      requiredProps: ['text'],
      optionalProps: { style: 'clearer' },
      endpoint: '/v1/chat/completions',
      method: 'POST',
      streaming: true,
    });

    this.register({
      name: 'embed',
      label: 'Embed',
      description: 'Generate embedding vector for text',
      display: 'inline',
      requiredProps: ['text'],
      endpoint: '/v1/embeddings',
      method: 'POST',
      cacheTTL: 86400,
    });

    this.register({
      name: 'classify',
      label: 'Classify',
      description: 'Classify text topic and sentiment',
      display: 'inline',
      requiredProps: ['text'],
      endpoint: '/v1/chat/completions',
      method: 'POST',
      cacheTTL: 3600,
    });

    this.register({
      name: 'entities',
      label: 'Extract Entities',
      description: 'Extract named entities from text',
      display: 'inline',
      requiredProps: ['text'],
      endpoint: '/v1/chat/completions',
      method: 'POST',
      cacheTTL: 3600,
    });

    this.register({
      name: 'voice-analyze',
      label: 'Analyze Voice',
      description:
        'Analyze writing tone, style, and voice characteristics from embeddings',
      display: 'block',
      requiredProps: ['embeddings'],
      endpoint: '/v1/chat/completions',
      method: 'POST',
      cacheTTL: 1800,
    });

    this.register({
      name: 'voice-generate',
      label: 'Generate In-Voice',
      description:
        'Generate text matching a trained voice/tone model derived from embeddings',
      display: 'block',
      requiredProps: ['voice_model', 'prompt'],
      optionalProps: { temperature: 0.7 },
      endpoint: '/v1/chat/completions',
      method: 'POST',
      streaming: true,
    });
  }
}
