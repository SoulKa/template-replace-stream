import {Readable, Transform, TransformCallback, TransformOptions} from 'node:stream';

/**
 * Options for the template replace stream.
 */
export type TemplateReplaceStreamOptions = {
  /** Default: `false`. If true, the stream creates logs on debug level */
  log: boolean;
  /**
   * Default: `false`. If true, the stream throws an error when a template variable has no
   * replacement value
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
}

export type StringSource = string | Buffer | Readable;

/** A function that resolves a variable name to its value */
export type VariableResolverFunction = (variable: string) => StringSource | undefined;

/** A map or function that resolves variable names to their values */
export type VariableResolver = Map<string, StringSource> | VariableResolverFunction;

enum State {
  SEARCHING_START_PATTERN,
  PROCESSING_VARIABLE,
  SEARCHING_END_PATTERN
}

const DEFAULT_OPTIONS: TemplateReplaceStreamOptions = {
  log: false,
  throwOnUnmatchedTemplate: false,
  maxVariableNameLength: 100,
  startPattern: Buffer.from('{{', 'ascii'),
  endPattern: Buffer.from('}}', 'ascii'),
  streamOptions: undefined
}

/**
 * A stream that replaces template variables in a stream with values from a map or resolver function.
 */
export class TemplateReplaceStream extends Transform {

  private _stack = Buffer.alloc(0);
  private _state = State.SEARCHING_START_PATTERN;
  private _matchCount = 0;
  private _stackIndex = 0;

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
    const _options = {...DEFAULT_OPTIONS, ...options};
    if (_options.maxVariableNameLength <= 0) {
      throw new Error('The maximum variable name length must be greater than 0');
    } else if (_options.startPattern.length === 0) {
      throw new Error('The start pattern must not be empty');
    } else if (_options.endPattern.length === 0) {
      throw new Error('The end pattern must not be empty');
    }

    super(_options.streamOptions);

    this._options = _options;
    this._startPattern = this.toBuffer(_options.startPattern);
    this._endPattern = this.toBuffer(_options.endPattern);
    this._resolveVariable = variables instanceof Map ? variables.get.bind(variables) : variables;
  }

  async _transform(chunk: Buffer | string | object, encoding: BufferEncoding, callback: TransformCallback) {
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, encoding);

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
              const variableNameBuffer = this._stack.subarray(this._startPattern.length, this._stackIndex - this._endPattern.length);
              const value = this.getValueOfVariable(variableNameBuffer);
              if (value) {
                await this.writeToOutput(value); // replace the template string with the value
                this._stack = this._stack.subarray(this._stackIndex); // discard the template string
              } else {
                this.releaseStack(this._stackIndex); // write the original template string
              }
            }
            break;
        }
      }
    } else {
      if (this._options.throwOnUnmatchedTemplate) {
        throw new Error('Cannot replace variables in non-string-link streams');
      } else if (this._options.log) {
        console.warn('Received non-buffer chunk. Will not modify it.');
      }
      this.push(chunk);
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
    for (; this._matchCount < this._startPattern.length; this._matchCount++ & this._stackIndex++) {
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
    for (; this._stackIndex < this._options.maxVariableNameLength + this._startPattern.length; this._stackIndex++) {
      if (this._stackIndex >= this._stack.length) return; // end of stack reached, need more data
      const char = this._stack[this._stackIndex];
      if (char === this._endPattern[0]) {
        this._state = State.SEARCHING_END_PATTERN;
        this._matchCount = 1;
        this._stackIndex++;
        return;
      } else if (char === this._startPattern[0]) {
        this._state = State.SEARCHING_START_PATTERN;
        this._matchCount = 1;
        this._stackIndex++;
        this.releaseStack(this._stackIndex - this._matchCount);
        return;
      }
    }

    // not found within the maximum length
    if (this._options.throwOnUnmatchedTemplate) throw new Error('Variable name processing reached limit');
    if (this._options.log) console.debug('Variable name processing reached limit, skipping');
    this._state = State.SEARCHING_START_PATTERN;
    this.releaseStack(this._stackIndex);
  }

  /**
   * Finds the end of a variable in the stack
   *
   * @returns True if the end of a variable was found, false otherwise. Note that there can still be
   * a match when continuing the search with the next chunk.
   */
  private findEndPattern() {
    for (; this._matchCount < this._endPattern.length; this._matchCount++ & this._stackIndex++) {
      if (this._stackIndex >= this._stack.length) return false; // end of stack reached, need more data
      if (this._stack[this._stackIndex] !== this._endPattern[this._matchCount]) {
        this.releaseStack(this._stackIndex);
        this._matchCount = 0;
        this._state = State.SEARCHING_START_PATTERN;
        return false; // no match
      }
    }
    this._state = State.SEARCHING_START_PATTERN;
    return true; // match found
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
  private getValueOfVariable(variableBuffer: Buffer) {
    const variableName = variableBuffer.toString().trim();
    const value = this._resolveVariable(variableName);
    if (value === undefined) {
      if (this._options.throwOnUnmatchedTemplate) {
        throw new Error(`Variable "${variableName}" not found in the variable map`);
      } else if (this._options.log) {
        console.debug(`Unmatched variable "${variableName}"`);
      }
    } else {
      if (this._options.log) console.debug(`Replacing variable "${variableName}"`);
      return value;
    }
  }

  /**
   * Writes the given string source to the output stream. If the source is a readable stream, it is
   * piped to the output stream. Otherwise, the source is written directly to the output stream.
   *
   * @param stringSource The source to write to the output stream
   */
  private async writeToOutput(stringSource: StringSource) {
    if (stringSource instanceof Readable) {
      for await (const chunk of stringSource) this.push(chunk);
    } else {
      this.push(this.toBuffer(stringSource));
    }
  }

  private toBuffer(stringLike: string | Buffer) {
    return stringLike instanceof Buffer ? stringLike : Buffer.from(stringLike);
  }
}