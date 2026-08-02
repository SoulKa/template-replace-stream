import { Readable, Transform, TransformCallback, TransformOptions } from "node:stream";

/**
 * Options for the template replace stream.
 */
export type TemplateReplaceStreamOptions = {
  /** Default: `false`. If true, the stream creates logs on debug level */
  log: boolean;
  /**
   * Default: `false`. If `true`, an unmatched template variable — one that has no replacement value —
   * makes the stream fail with an {@link UnmatchedVariableError} (emitted on the stream, or thrown by
   * the `replace*Async` helpers) instead of leaving the template untouched in the output.
   */
  throwOnUnmatchedTemplate: boolean;
  /**
   * Default: `100`. The maximum length of a variable name between a start and end pattern including
   * whitespaces around it. Any variable name longer than this length is ignored, i.e. the search
   * for the end pattern canceled and the stream looks for the next start pattern.
   * Note that a shorter length improves performance but may not find all variables.
   */
  maxVariableNameLength: number;
  /** Default: `'{{'`. The start pattern of a template string either as string or buffer */
  startPattern: string | Buffer;
  /** Default: `'}}'`. The end pattern of a template string either as string or buffer */
  endPattern: string | Buffer;
  /** Any options for the lower level {@link Transform} stream. Do not replace transform or flush */
  streamOptions?: TransformOptions;
};

export type StringContent = string | Buffer | Readable;
export type StringSource = StringContent | Promise<StringContent>;

/** A function that resolves a variable name to its value */
export type VariableResolverFunction = (variable: string) => StringSource | undefined;

/** A map or function that resolves variable names to their values */
export type VariableResolver = Map<string, StringSource> | VariableResolverFunction;

/**
 * The stable error codes set on {@link TemplateReplaceStreamError.code}. Prefer matching on these over
 * the (human-readable) error message, and over `instanceof` when errors may cross package-copy or
 * serialization boundaries.
 *
 * - `ERR_INVALID_OPTION`: an invalid option was passed to the {@link TemplateReplaceStream} constructor.
 * - `ERR_VARIABLE_NAME_TOO_LONG`: a template variable name exceeded {@link TemplateReplaceStreamOptions.maxVariableNameLength}.
 * - `ERR_UNMATCHED_VARIABLE`: a template variable had no replacement value (see {@link UnmatchedVariableError}).
 */
export type TemplateReplaceStreamErrorCode =
  "ERR_INVALID_OPTION" | "ERR_VARIABLE_NAME_TOO_LONG" | "ERR_UNMATCHED_VARIABLE";

/**
 * The error thrown by the {@link TemplateReplaceStream} for all errors it raises itself, e.g. invalid
 * options passed to the constructor or an unmatched template variable when
 * {@link TemplateReplaceStreamOptions.throwOnUnmatchedTemplate} is enabled. Use `instanceof` or the
 * stable {@link TemplateReplaceStreamError.code} to distinguish it from other errors emitted on the
 * stream. The `code` is only `undefined` when wrapping a foreign non-`Error` value thrown downstream.
 */
export class TemplateReplaceStreamError extends Error {
  constructor(
    message: string,
    readonly code?: TemplateReplaceStreamErrorCode,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "TemplateReplaceStreamError";
  }
}

/**
 * The error thrown when a template variable has no replacement value and
 * {@link TemplateReplaceStreamOptions.throwOnUnmatchedTemplate} is enabled. The name of the
 * unmatched variable is available via {@link UnmatchedVariableError.variableName}, and its
 * {@link TemplateReplaceStreamError.code} is always `"ERR_UNMATCHED_VARIABLE"`.
 */
export class UnmatchedVariableError extends TemplateReplaceStreamError {
  constructor(
    readonly variableName: string,
    options?: ErrorOptions
  ) {
    super(
      `Variable "${variableName}" not found in the variable map`,
      "ERR_UNMATCHED_VARIABLE",
      options
    );
    this.name = "UnmatchedVariableError";
  }
}

enum State {
  SEARCHING_START_PATTERN,
  PROCESSING_VARIABLE,
  SEARCHING_END_PATTERN,
}

/** Shared zero-length buffer used to represent an empty stack (avoids re-allocating on every reset). */
const EMPTY_BUFFER = Buffer.alloc(0);

const DEFAULT_OPTIONS: TemplateReplaceStreamOptions = {
  log: false,
  throwOnUnmatchedTemplate: false,
  maxVariableNameLength: 100,
  startPattern: Buffer.from("{{", "ascii"),
  endPattern: Buffer.from("}}", "ascii"),
  streamOptions: undefined,
};

/**
 * A stream that replaces template variables in a stream with values from a map or resolver function.
 *
 * Every error this stream raises is a {@link TemplateReplaceStreamError} (or its
 * {@link UnmatchedVariableError} subclass) carrying a stable {@link TemplateReplaceStreamErrorCode}.
 * Invalid options are thrown synchronously from the constructor (`ERR_INVALID_OPTION`). When
 * {@link TemplateReplaceStreamOptions.throwOnUnmatchedTemplate} is enabled, the stream also fails on a
 * variable name exceeding {@link TemplateReplaceStreamOptions.maxVariableNameLength}
 * (`ERR_VARIABLE_NAME_TOO_LONG`) and on a non-string/{@link Buffer} chunk, in addition to the
 * unmatched-variable case described on that option.
 */
export class TemplateReplaceStream extends Transform {
  private _stack: Buffer = EMPTY_BUFFER;
  private _state: State = State.SEARCHING_START_PATTERN;
  private _matchCount: number = 0;
  private _stackIndex: number = 0;
  private readonly _readWaiters: Array<() => void> = [];

  private readonly _startPattern: Buffer;
  private readonly _endPattern: Buffer;
  private readonly _resolveVariable: VariableResolverFunction;
  private readonly _options: TemplateReplaceStreamOptions;

  /**
   * Creates a new instance of the {@link TemplateReplaceStream}.
   *
   * @param variables The {@link VariableResolver} to resolve variables. If provided as a map, the
   * keys are the variable names and the values are the replacements (without surrounding whitespaces).
   * If provided as a function, the function is called with the variable name and should return the
   * replacement value.
   * @param options The options for the stream
   */
  constructor(variables: VariableResolver, options: Partial<TemplateReplaceStreamOptions> = {}) {
    const _options = { ...DEFAULT_OPTIONS, ...options };
    if (_options.maxVariableNameLength <= 0) {
      throw new TemplateReplaceStreamError(
        "The maximum variable name length must be greater than 0",
        "ERR_INVALID_OPTION"
      );
    } else if (_options.startPattern.length === 0) {
      throw new TemplateReplaceStreamError(
        "The start pattern must not be empty",
        "ERR_INVALID_OPTION"
      );
    } else if (_options.endPattern.length === 0) {
      throw new TemplateReplaceStreamError(
        "The end pattern must not be empty",
        "ERR_INVALID_OPTION"
      );
    }

    super(_options.streamOptions);

    this._options = _options;
    this._startPattern = this.toBuffer(_options.startPattern);
    this._endPattern = this.toBuffer(_options.endPattern);
    this._resolveVariable = variables instanceof Map ? variables.get.bind(variables) : variables;
  }

  /**
   * Replaces template variables in a string-like source with values from a map or resolver function.
   * Note that this holds the full output in memory, you should not use this on large input.
   *
   * @param input The input string, buffer, or stream
   * @param variables The variables to replace
   * @param options The options for the stream
   * @returns A promise that resolves to the output buffer
   */
  public static async replaceAsync(
    input: string | Buffer | Readable,
    variables: VariableResolver,
    options?: Partial<TemplateReplaceStreamOptions>
  ) {
    const stream = new TemplateReplaceStream(variables, options);
    if (input instanceof Readable) {
      input.pipe(stream);
    } else {
      stream.end(input);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Replaces template variables in a string-like source with values from a map or resolver function.
   * Note that this holds the full output in memory, you should not use this on large input.
   *
   * @param input The input string, buffer, or stream
   * @param variables The variables to replace
   * @param options The options for the stream
   * @returns A promise that resolves to the output string
   */
  public static async replaceStringAsync(
    input: string | Buffer | Readable,
    variables: VariableResolver,
    options?: Partial<TemplateReplaceStreamOptions>
  ) {
    return (await this.replaceAsync(input, variables, options)).toString();
  }

  async _transform(
    chunk: Buffer | string | object,
    encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    if (typeof chunk === "string") chunk = Buffer.from(chunk, encoding);

    try {
      if (!(chunk instanceof Buffer)) {
        this.handleUnknownChunkType(chunk);
        return callback();
      }

      // if there is text left from last iteration, prepend it to the chunk
      if (this._stack.length === 0) {
        this._stack = chunk;
      } else {
        this._stack = Buffer.concat([this._stack, chunk]);
      }

      while (this._stackIndex < this._stack.length) {
        switch (this._state) {
          case State.SEARCHING_START_PATTERN:
            this.findStartPattern();
            break;
          case State.PROCESSING_VARIABLE:
            this.findVariableEnd();
            break;
          case State.SEARCHING_END_PATTERN:
            if (this.findEndPattern()) {
              const variableNameBuffer = this._stack.subarray(
                this._startPattern.length,
                this._stackIndex - this._endPattern.length
              );
              const value = await this.getValueOfVariable(variableNameBuffer);
              if (value !== undefined) {
                this._stack = this._stack.subarray(this._stackIndex); // discard the template string
                this._stackIndex = 0;
                await this.writeToOutput(value); // replace the template string with the value
              } else {
                this.releaseStack(this._stackIndex); // write the original template string
              }
            }
            break;
        }
      }
    } catch (e) {
      callback(
        e instanceof Error ? e : new TemplateReplaceStreamError(`${e}`, undefined, { cause: e })
      );
      return;
    }

    callback();
  }

  _flush(callback: TransformCallback) {
    if (this._stack.length > 0) this.push(this._stack);
    callback();
  }

  /**
   * Stateful function to find the index of the start pattern in the stack. Everything before the
   * (partial) start pattern is released so the pattern stays pinned at the front of the stack, which
   * lets {@link findVariableEnd} derive the variable-name length from `_stackIndex - _startPattern.length`
   * (the start pattern itself does not count towards
   * {@link TemplateReplaceStreamOptions.maxVariableNameLength}). On a full match the state is set to
   * processing variable and the match counter is reset for the next pattern search.
   */
  private findStartPattern() {
    if (this._matchCount === 0) {
      if ((this._stackIndex = this._stack.indexOf(this._startPattern[0])) === -1) {
        this._stackIndex = this._stack.length; // no match found
      } else {
        this._matchCount++;
        this._stackIndex++;
      }
    }

    // continue matching the remaining start-pattern bytes (also across chunk boundaries)
    while (this._matchCount > 0 && this._matchCount < this._startPattern.length) {
      if (this._stackIndex >= this._stack.length) break; // end of stack reached, need more data
      if (this._stack[this._stackIndex] !== this._startPattern[this._matchCount]) {
        // A false start pattern. Rewind to one byte past where this partial match began (its first
        // byte is at `_stackIndex - _matchCount`) so an overlapping start that begins inside it —
        // possible when the start pattern's first bytes repeat — is not skipped. The byte that
        // started the false match is released below.
        this._stackIndex -= this._matchCount - 1;
        this._matchCount = 0; // no match
        break;
      }
      this._matchCount++;
      this._stackIndex++;
    }

    // Drop everything before the (partial) start pattern. `_matchCount` still holds the number of
    // matched pattern bytes here, so `_stackIndex - _matchCount` is where the pattern begins.
    this.releaseStack(this._stackIndex - this._matchCount);

    if (this._matchCount === this._startPattern.length) {
      this._state = State.PROCESSING_VARIABLE;
      this._matchCount = 0;
    }
  }

  /**
   * Stateful function to find the end of a variable in the stack. If the end pattern is found, the
   * state is set to searching end pattern. If the maximum variable name length is reached, or a start
   * pattern symbol is found, the state is set to searching start pattern.
   *
   * A boundary byte (end- or start-pattern first byte) is only honored while the variable name is
   * still within {@link TemplateReplaceStreamOptions.maxVariableNameLength}: the start pattern stays
   * pinned at `_stack[0]`, so a boundary at index `>= _startPattern.length + maxVariableNameLength`
   * sits past the last byte a valid name may occupy and is ignored, abandoning the over-long name.
   * Capping the search this way is what makes the outcome independent of how the input was chunked —
   * a single chunk abandons at exactly the same byte a chunk-split stream does (which can only ever
   * see the name grow one boundary-free byte at a time until it hits the limit).
   */
  private findVariableEnd() {
    // The first stack index a valid variable name may no longer reach. `_stackIndex - _startPattern
    // .length` is the name length so far (the start pattern is pinned at `_stack[0]`), so a name is
    // over-long once its bytes reach this index.
    const overlongIndex = this._startPattern.length + this._options.maxVariableNameLength;
    let nextEndIndex = this._stack.indexOf(this._endPattern[0], this._stackIndex);
    let nextStartIndex = this._stack.indexOf(this._startPattern[0], this._stackIndex);
    // Ignore boundaries at or beyond the length limit; the name is abandoned before reaching them.
    if (nextEndIndex >= overlongIndex) nextEndIndex = -1;
    if (nextStartIndex >= overlongIndex) nextStartIndex = -1;

    if (nextEndIndex === -1 && nextStartIndex === -1) {
      // No boundary byte within the length limit. Either the whole limit window is present with no
      // boundary in it — the name is over-long and abandoned — or we simply need more data.
      this._stackIndex = this._stack.length;
      if (this._stackIndex < overlongIndex) {
        return; // need more data
      }
      this.abandonOverlongVariableName(overlongIndex);
      return; // no match
    }

    // A boundary byte was found. Take the end branch only when an end-pattern byte actually exists
    // and is not preceded by a start-pattern byte; otherwise (re)start at the start-pattern byte.
    // Guarding on `nextEndIndex !== -1` is essential: without it a start byte with no end byte ahead
    // (`nextEndIndex === -1`, e.g. the input "{{{") would take the end branch and set
    // `_stackIndex = nextEndIndex + 1 = 0`, spinning the `_transform` loop forever (a hard hang).
    if (nextEndIndex !== -1 && (nextStartIndex === -1 || nextEndIndex < nextStartIndex)) {
      this._state = State.SEARCHING_END_PATTERN;
      this._stackIndex = nextEndIndex + 1;
    } else {
      this._state = State.SEARCHING_START_PATTERN;
      this._stackIndex = nextStartIndex + 1;
      this.releaseStack(nextStartIndex);
    }
    this._matchCount = 1;
  }

  /**
   * Abandons the variable name currently being scanned because it reached
   * {@link TemplateReplaceStreamOptions.maxVariableNameLength} without a closing end pattern within
   * the limit. The start pattern and the name bytes up to `releaseIndex` are emitted verbatim and the
   * stream resumes searching for the next start pattern from there. `releaseIndex` is always the limit
   * position, so a single-chunk input abandons at the same byte a chunk-split stream would.
   *
   * `_matchCount` must be reset to 0 for the next {@link findStartPattern} (leaving it non-zero would
   * make the `_transform` loop spin forever — a synchronous hang).
   *
   * @param releaseIndex The number of leading stack bytes to emit verbatim before resuming the search
   */
  private abandonOverlongVariableName(releaseIndex: number) {
    this._state = State.SEARCHING_START_PATTERN;
    this._matchCount = 0;
    if (this._options.throwOnUnmatchedTemplate)
      throw new TemplateReplaceStreamError(
        "Variable name processing reached limit",
        "ERR_VARIABLE_NAME_TOO_LONG"
      );
    if (this._options.log) console.debug("Variable name processing reached limit, skipping");
    this._stackIndex = releaseIndex;
    this.releaseStack(releaseIndex);
  }

  /**
   * Finds the end of a variable in the stack
   *
   * @returns True if the end of a variable was found, false otherwise. Note that there can still be
   * a match when continuing the search with the next chunk.
   */
  private findEndPattern() {
    for (; this._matchCount < this._endPattern.length; this._matchCount++, this._stackIndex++) {
      if (this._stackIndex >= this._stack.length) return false; // end of stack reached, need more data
      if (this._stack[this._stackIndex] !== this._endPattern[this._matchCount]) {
        // A false end pattern. Keep the start pattern and look for the real end within the variable.
        // Rewind to one byte past where this partial match began (its first byte is at
        // `_stackIndex - _matchCount`) so an overlapping end that starts inside it — possible when
        // the end pattern's first bytes repeat — is not skipped.
        this._stackIndex -= this._matchCount - 1;
        this._matchCount = 1;
        this._state = State.PROCESSING_VARIABLE;
        return false; // no match
      }
    }
    this._matchCount = 0;
    this._state = State.SEARCHING_START_PATTERN;
    return true;
  }

  /**
   * Pushes a buffer to the stream and releases the stack up to the given index.
   *
   * @param index The index to release the stack up to
   */
  private releaseStack(index: number) {
    if (index <= 0) {
      return;
    } else if (index === this._stack.length) {
      this.push(this._stack);
      this._stack = EMPTY_BUFFER;
    } else {
      this.push(this._stack.subarray(0, index));
      this._stack = this._stack.subarray(index);
    }
    this._stackIndex -= index;
  }

  /**
   * Gets the value of a variable from the map by its name.
   *
   * @param variableBuffer The buffer containing the variable name
   * @returns The value of the variable as buffer or undefined if it was not found
   */
  private async getValueOfVariable(variableBuffer: Buffer) {
    const variableName = variableBuffer.toString().trim();
    let value = this._resolveVariable(variableName);
    if (value instanceof Promise) value = await value;

    if (value !== undefined) {
      if (this._options.log) console.debug(`Replacing variable "${variableName}"`);
      return value;
    }

    if (this._options.throwOnUnmatchedTemplate) throw new UnmatchedVariableError(variableName);
    if (this._options.log) console.debug(`Unmatched variable "${variableName}"`);
  }

  /**
   * Writes the given string source to the output stream. If the source is a readable stream, it is
   * piped to the output stream. Otherwise, the source is written directly to the output stream.
   *
   * If the source is a promise, it is awaited before writing.
   *
   * @param stringSource The source to write to the output stream
   */
  private async writeToOutput(stringSource: StringContent) {
    if (stringSource instanceof Readable) {
      await this.writeStreamToOutput(stringSource);
    } else {
      this.push(this.toBuffer(stringSource));
    }
  }

  private async writeStreamToOutput(stream: Readable) {
    for await (const chunk of stream) {
      // `push` feeds the readable side; when it returns false the readable buffer is full and the
      // signal to resume is the consumer's next `_read`, not a writable-side "drain" (which never
      // fires for the already-flushed template and would deadlock). Park until `_read` resolves us.
      if (!this.push(chunk)) {
        await new Promise<void>((resolve) => this._readWaiters.push(resolve));
      }
    }
  }

  /**
   * The readable side calls `_read` when the consumer can accept more data. Release any value-stream
   * writers parked in {@link writeStreamToOutput} on a full buffer, then delegate to the default
   * {@link Transform} read behavior.
   */
  _read(size: number) {
    while (this._readWaiters.length > 0) this._readWaiters.shift()!();
    super._read(size);
  }

  private toBuffer(stringLike: string | Buffer) {
    return stringLike instanceof Buffer ? stringLike : Buffer.from(stringLike);
  }

  private handleUnknownChunkType(chunk: any) {
    if (this._options.throwOnUnmatchedTemplate) {
      throw new TemplateReplaceStreamError("Cannot replace variables in non-string-link streams");
    } else if (this._options.log) {
      console.warn("Received non-buffer chunk. Will not modify it.");
    }
    this.push(chunk);
  }
}
