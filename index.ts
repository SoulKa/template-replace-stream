import { once, Readable, Transform, TransformCallback, TransformOptions } from "node:stream";

/**
 * Options for the template replace stream.
 */
export type TemplateReplaceStreamOptions = {
  /** Default: `false`. If true, the stream creates logs on debug level */
  log: boolean;
  /**
   * Default: `false`. If true, the stream throws an error when a template variable has no
   * replacement value. Takes precedence over `removeUnmatchedTemplate`.
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

enum State {
  SEARCHING_START_PATTERN,
  PROCESSING_VARIABLE,
  SEARCHING_END_PATTERN,
}

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
 */
export class TemplateReplaceStream extends Transform {
  private _stack: Buffer = Buffer.alloc(0);
  private _state: State = State.SEARCHING_START_PATTERN;
  private _matchCount: number = 0;
  private _stackIndex: number = 0;

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
      throw new Error("The maximum variable name length must be greater than 0");
    } else if (_options.startPattern.length === 0) {
      throw new Error("The start pattern must not be empty");
    } else if (_options.endPattern.length === 0) {
      throw new Error("The end pattern must not be empty");
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
      if (chunk instanceof Buffer) {
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
              this.releaseStack(this._stackIndex - this._matchCount);
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
                if (value) {
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
      } else {
        this.handleUnknownChunkType(chunk);
      }
    } catch (e) {
      callback(e instanceof Error ? e : new Error(`${e}`));
      return;
    }

    callback();
  }

  _flush(callback: TransformCallback) {
    if (this._stack.length > 0) this.push(this._stack);
    callback();
  }

  /**
   * Stateful function to find the index of the start pattern in the stack. If the start pattern is
   * found, the stack is cropped to the start pattern and the state is set to processing variable.
   */
  private findStartPattern() {
    if (this._matchCount === 0) {
      if ((this._stackIndex = this._stack.indexOf(this._startPattern[0])) === -1) {
        this._stackIndex = this._stack.length;
        return; // no match found
      }
      this._matchCount++;
      this._stackIndex++;
    }

    // continue matching the start pattern
    for (; this._matchCount < this._startPattern.length; this._matchCount++, this._stackIndex++) {
      if (this._stackIndex >= this._stack.length) return; // end of stack reached, need more data
      if (this._stack[this._stackIndex] !== this._startPattern[this._matchCount]) {
        this._matchCount = 0;
        return; // no match
      }
    }
    this._state = State.PROCESSING_VARIABLE;
  }

  /**
   * Stateful function to find the end of a variable in the stack. If the end pattern is found, the
   * state is set to searching end pattern. If the maximum variable name length is reached, or a start
   * pattern symbol is found, the state is set to searching start pattern.
   */
  private findVariableEnd() {
    const nextEndIndex = this._stack.indexOf(this._endPattern[0], this._stackIndex);
    const nextStartIndex = this._stack.indexOf(this._startPattern[0], this._stackIndex);

    if (nextEndIndex === -1 && nextStartIndex === -1) {
      this._matchCount += this._stack.length - this._stackIndex;
      if (this._matchCount < this._options.maxVariableNameLength) {
        this._stackIndex = this._stack.length;
        return; // need more data
      }

      // not found within the maximum length
      this._state = State.SEARCHING_START_PATTERN;
      if (this._options.throwOnUnmatchedTemplate)
        throw new Error("Variable name processing reached limit");
      if (this._options.log) console.debug("Variable name processing reached limit, skipping");
      this.releaseStack(this._stack.length);
      return; // no match
    }

    // found a pattern
    if (nextStartIndex === -1 || nextStartIndex > nextEndIndex) {
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
   * Finds the end of a variable in the stack
   *
   * @returns True if the end of a variable was found, false otherwise. Note that there can still be
   * a match when continuing the search with the next chunk.
   */
  private findEndPattern() {
    let match = true;
    for (; this._matchCount < this._endPattern.length; this._matchCount++, this._stackIndex++) {
      if (this._stackIndex >= this._stack.length) return false; // end of stack reached, need more data
      if (this._stack[this._stackIndex] !== this._endPattern[this._matchCount]) {
        this.releaseStack(this._stackIndex);
        match = false; // no match
        break;
      }
    }
    this._matchCount = 0;
    this._state = State.SEARCHING_START_PATTERN;
    return match;
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
      this._stack = Buffer.alloc(0);
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

    if (value === undefined) {
      if (this._options.throwOnUnmatchedTemplate)
        throw new Error(`Variable "${variableName}" not found in the variable map`);
      if (this._options.log) console.debug(`Unmatched variable "${variableName}"`);
    } else {
      if (this._options.log) console.debug(`Replacing variable "${variableName}"`);
      return value;
    }
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
      if (!this.push(chunk)) await once(this, "drain");
    }
  }

  private toBuffer(stringLike: string | Buffer) {
    return stringLike instanceof Buffer ? stringLike : Buffer.from(stringLike);
  }

  private handleUnknownChunkType(chunk: any) {
    if (this._options.throwOnUnmatchedTemplate) {
      throw new Error("Cannot replace variables in non-string-link streams");
    } else if (this._options.log) {
      console.warn("Received non-buffer chunk. Will not modify it.");
    }
    this.push(chunk);
  }
}
