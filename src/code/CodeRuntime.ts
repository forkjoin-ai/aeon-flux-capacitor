/**
 * CodeRuntime — Inference-based "imagined execution"
 *
 * When the editor detects code, it adapts: line numbers appear,
 * code-specific tools surface, and the inference runtime shows
 * predicted outputs inline — like Jest codelens but for ANY language.
 *
 * Language-agnostic. Even made-up languages. Even binary.
 * Because it's all embeddings underneath — agents write in embeddings,
 * humans write in text, and code is just another projection.
 */

// ── Types ───────────────────────────────────────────────────────────

/** A detected code function/symbol */
export interface CodeSymbol {
  /** Symbol name */
  readonly name: string;
  /** Symbol type */
  readonly kind:
    | 'function'
    | 'class'
    | 'method'
    | 'variable'
    | 'block'
    | 'unknown';
  /** Start line (1-indexed) */
  readonly startLine: number;
  /** End line (1-indexed) */
  readonly endLine: number;
  /** The raw source text */
  readonly source: string;
  /** Detected or declared language */
  readonly language: string;
}

/** An imagined execution result */
export interface ImaginedResult {
  /** The symbol this result is for */
  readonly symbolName: string;
  /** Block ID in the document */
  readonly blockId: string;
  /** Line number where the codelens appears */
  readonly line: number;
  /** The imagined output */
  readonly output: string;
  /** Confidence (0-1) */
  readonly confidence: number;
  /** Whether this is streaming */
  readonly streaming: boolean;
  /** Status */
  status: 'idle' | 'running' | 'complete' | 'error';
  /** Latency in ms */
  readonly latencyMs?: number;
  /** Error message */
  readonly error?: string;
}

/** Code block metadata */
export interface CodeBlockMeta {
  /** Block ID */
  readonly blockId: string;
  /** Detected language (or 'unknown') */
  readonly language: string;
  /** Line count */
  readonly lineCount: number;
  /** Extracted symbols */
  readonly symbols: CodeSymbol[];
  /** Whether this looks like executable code vs config/data */
  readonly isExecutable: boolean;
}

/** Code-specific action */
export interface CodeAction {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly applicable: (meta: CodeBlockMeta) => boolean;
}

// ── Code Runtime ────────────────────────────────────────────────────

export class CodeRuntime {
  private results: Map<string, ImaginedResult> = new Map();
  private readonly inferFn: (prompt: string) => Promise<string>;

  /**
   * @param inferFn — The inference function (ESI-backed).
   *   Takes a prompt, returns the imagined result.
   *   Language-agnostic: the LLM figures out what it is.
   */
  constructor(inferFn: (prompt: string) => Promise<string>) {
    this.inferFn = inferFn;
  }

  // ── Analysis ──────────────────────────────────────────────────

  /**
   * Analyze a code block — detect language, extract symbols,
   * add line numbers. Language detection is fuzzy: the embedding
   * tells us more than syntax ever could.
   */
  analyzeBlock(
    blockId: string,
    code: string,
    declaredLanguage?: string
  ): CodeBlockMeta {
    const lines = code.split('\n');
    const language = declaredLanguage || this.detectLanguage(code);
    const symbols = this.extractSymbols(code, language);
    const isExecutable = this.looksExecutable(code, language);

    return {
      blockId,
      language,
      lineCount: lines.length,
      symbols,
      isExecutable,
    };
  }

  /**
   * Format code with line numbers.
   */
  addLineNumbers(code: string): string {
    const lines = code.split('\n');
    const pad = String(lines.length).length;
    return lines
      .map((line, i) => {
        const num = String(i + 1).padStart(pad, ' ');
        return `${num} │ ${line}`;
      })
      .join('\n');
  }

  // ── Imagined Execution ────────────────────────────────────────

  /**
   * Run an imagined execution on a symbol.
   * Uses the inference engine to predict what this code would output.
   * Works for any language — even made-up ones.
   */
  async imagine(blockId: string, symbol: CodeSymbol): Promise<ImaginedResult> {
    const key = `${blockId}:${symbol.name}`;

    const result: ImaginedResult = {
      symbolName: symbol.name,
      blockId,
      line: symbol.startLine,
      output: '',
      confidence: 0,
      streaming: false,
      status: 'running',
    };
    this.results.set(key, result);

    const startTime = Date.now();

    try {
      const prompt = this.buildImaginePrompt(symbol);
      const output = await this.inferFn(prompt);

      const completed: ImaginedResult = {
        ...result,
        output: output.trim(),
        confidence: 0.7, // base confidence; could be refined
        status: 'complete',
        latencyMs: Date.now() - startTime,
      };
      this.results.set(key, completed);
      return completed;
    } catch (err) {
      const failed: ImaginedResult = {
        ...result,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
      this.results.set(key, failed);
      return failed;
    }
  }

  /**
   * Imagine all symbols in a code block.
   */
  async imagineAll(meta: CodeBlockMeta): Promise<ImaginedResult[]> {
    const executableSymbols = meta.symbols.filter(
      (s) => s.kind === 'function' || s.kind === 'method' || s.kind === 'block'
    );
    return Promise.all(
      executableSymbols.map((symbol) => this.imagine(meta.blockId, symbol))
    );
  }

  /** Get cached result */
  getResult(blockId: string, symbolName: string): ImaginedResult | undefined {
    return this.results.get(`${blockId}:${symbolName}`);
  }

  /** Get all results for a block */
  getResultsForBlock(blockId: string): ImaginedResult[] {
    return Array.from(this.results.values()).filter(
      (r) => r.blockId === blockId
    );
  }

  /** Clear cached results */
  clearResults(blockId?: string): void {
    if (blockId) {
      for (const [key, result] of this.results) {
        if (result.blockId === blockId) this.results.delete(key);
      }
    } else {
      this.results.clear();
    }
  }

  // ── Code Actions ──────────────────────────────────────────────

  /**
   * Get code-specific actions available for a block.
   * These surface automatically when a code block is detected.
   */
  getActions(meta: CodeBlockMeta): CodeAction[] {
    return CODE_ACTIONS.filter((action) => action.applicable(meta));
  }

  // ── Private ───────────────────────────────────────────────────

  private detectLanguage(code: string): string {
    // Heuristic detection — embeddings give us better signal
    // but these quick checks handle the obvious cases
    const indicators: Array<[RegExp, string]> = [
      [/^\s*(import|export|const|let|var|function|class)\s/m, 'javascript'],
      [/^\s*(def |class |import |from |print\()/m, 'python'],
      [/^\s*(fn |let |use |pub |impl |struct |enum )/m, 'rust'],
      [/^\s*(func |package |import ")/m, 'go'],
      [/^\s*(<\?php|namespace |use |function )/m, 'php'],
      [/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\s/im, 'sql'],
      [/^\s*[01]{8}/m, 'binary'],
      [/^\s*\{[\s\S]*"[\w]+":/m, 'json'],
      [/^\s*<[a-zA-Z][\s\S]*>/m, 'html'],
      [/^\s*#!\//m, 'shell'],
    ];

    for (const [pattern, lang] of indicators) {
      if (pattern.test(code)) return lang;
    }

    return 'unknown';
  }

  private extractSymbols(code: string, language: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const lines = code.split('\n');

    // Universal function detection (works across most languages)
    const patterns: Array<[RegExp, 'function' | 'class' | 'method']> = [
      // JS/TS: function name(, const name =, export function
      [/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, 'function'],
      [/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g, 'function'],
      // Python: def name(
      [/def\s+(\w+)\s*\(/g, 'function'],
      // Rust: fn name(
      [/(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g, 'function'],
      // Go: func name(
      [/func\s+(\w+)/g, 'function'],
      // Classes
      [/class\s+(\w+)/g, 'class'],
      [/struct\s+(\w+)/g, 'class'],
      [/impl\s+(\w+)/g, 'class'],
    ];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      for (const [pattern, kind] of patterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          // Find end of symbol (simplified: look for closing brace or dedent)
          let endLine = lineIdx;
          let braceDepth = 0;
          for (let j = lineIdx; j < lines.length; j++) {
            for (const ch of lines[j]) {
              if (ch === '{') braceDepth++;
              if (ch === '}') braceDepth--;
            }
            endLine = j;
            if (braceDepth <= 0 && j > lineIdx) break;
          }

          symbols.push({
            name: match[1],
            kind,
            startLine: lineIdx + 1,
            endLine: endLine + 1,
            source: lines.slice(lineIdx, endLine + 1).join('\n'),
            language,
          });
        }
      }
    }

    // If no symbols found, treat the whole block as one
    if (symbols.length === 0 && code.trim().length > 0) {
      symbols.push({
        name: '<block>',
        kind: 'block',
        startLine: 1,
        endLine: lines.length,
        source: code,
        language,
      });
    }

    return symbols;
  }

  private looksExecutable(code: string, language: string): boolean {
    const nonExecutable = [
      'json',
      'yaml',
      'toml',
      'xml',
      'html',
      'css',
      'markdown',
      'text',
    ];
    if (nonExecutable.includes(language)) return false;
    // Check for function calls, assignments, control flow
    return /[\(\)=;{}]/.test(code);
  }

  private buildImaginePrompt(symbol: CodeSymbol): string {
    return [
      `You are an inference-based code runtime. Given the following ${symbol.language} code,`,
      `predict what the output or return value would be if executed.`,
      `If the language is unknown or made-up, use best judgment based on patterns.`,
      `Be concise — just the output, no explanation.`,
      ``,
      `\`\`\`${symbol.language}`,
      symbol.source,
      `\`\`\``,
      ``,
      `Predicted output:`,
    ].join('\n');
  }
}

// ── Built-in Code Actions ───────────────────────────────────────────

const CODE_ACTIONS: CodeAction[] = [
  {
    id: 'imagine-run',
    label: '▶ Imagine Run',
    icon: '▶',
    applicable: (meta) => meta.isExecutable,
  },
  {
    id: 'imagine-all',
    label: '▶▶ Imagine All',
    icon: '⏩',
    applicable: (meta) => meta.isExecutable && meta.symbols.length > 1,
  },
  {
    id: 'explain',
    label: 'Explain Code',
    icon: '💡',
    applicable: () => true,
  },
  {
    id: 'refactor',
    label: 'Refactor',
    icon: '🔧',
    applicable: (meta) => meta.isExecutable,
  },
  {
    id: 'test-generate',
    label: 'Generate Tests',
    icon: '🧪',
    applicable: (meta) =>
      meta.isExecutable && meta.symbols.some((s) => s.kind === 'function'),
  },
  {
    id: 'translate-language',
    label: 'Translate to...',
    icon: '🔄',
    applicable: () => true,
  },
  {
    id: 'optimize',
    label: 'Optimize',
    icon: '⚡',
    applicable: (meta) => meta.isExecutable,
  },
  {
    id: 'security-scan',
    label: 'Security Scan',
    icon: '🛡️',
    applicable: (meta) => meta.isExecutable,
  },
  {
    id: 'type-check',
    label: 'Infer Types',
    icon: '📐',
    applicable: (meta) =>
      meta.isExecutable &&
      ['javascript', 'python', 'unknown'].includes(meta.language),
  },
];
