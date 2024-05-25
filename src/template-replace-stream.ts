import {Readable, Transform, TransformCallback, TransformOptions} from 'node:stream';

/**
 * Options for the template replace stream.
 */
export type TemplateReplaceStreamOptions = {
  /** Default: `false`. If true, the stream creates logs on debug level */
  log: boolean;
  /** Default: `false`. If true, the stream throws an error when a variable is missing */
  throwOnMissingVariable: boolean;
  /** Default: `100`. The maximum length of a variable name including whitespaces around it */
  maxVariableNameLength: number;
  /** Default: `'{{'`. The start pattern of a variable either as string or buffer */
  startPattern: string | Buffer;
  /** Default: `'}}'`. The end pattern of a variable either as string or buffer */
  endPattern: string | Buffer;
  /** The options for the lower level {@link Transform} stream. Do not replace transform or flush */
  streamOptions?: TransformOptions;
}

export type StringSource = string | Buffer | Readable;

/** A function that resolves a variable name to its value */
export type VariableResolverFunction = (variable: string) => StringSource | undefined;

/** A map or function that resolves variable names to their values */
export type VariableResolver = Map<string, StringSource> | VariableResolverFunction;

const DEFAULT_OPTIONS: TemplateReplaceStreamOptions = {
  log: false,
  throwOnMissingVariable: false,
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
  private _isMatching = false;
  private _matchCount = 0;
  private _variableName?: Buffer;

  private readonly _startPattern: Buffer;
  private readonly _endPattern: Buffer;
  private readonly _maxFullPatternLength: number;
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
    this._maxFullPatternLength = this._startPattern.length + _options.maxVariableNameLength + this._endPattern.length;
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

      // process the stack until it is empty or too small to contain a full pattern
      while (this._stack.length > 0) {
        if (!this._isMatching) {
          if (!this.findStartOfVariable()) break;
        } else if (!this.findEndOfVariable()) {
          break;
        } else if (this._variableName !== undefined) {
          const value = this.getValueOfVariable(this._variableName);
          const index = this._startPattern.length + this._variableName.length + this._endPattern.length;
          if (value) {
            await this.writeToOutput(value); // replace the template string with the value
            this._stack = this._stack.subarray(index); // discard the template string
          } else {
            this.releaseStack(index); // write the original template string
          }
          this._variableName = undefined;
          this.changeState();
        }
      }
    } else {
      if (this._options.throwOnMissingVariable) {
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
   * Finds the start of a variable in the stack.
   *
   * @returns True if the start of a variable was found, false otherwise.
   */
  private findStartOfVariable() {
    const index = this.findIndex(this._startPattern);
    if (index === -1) {
      this.releaseStack(this._stack.length - this._matchCount);
      return false;
    } else {
      this.releaseStack(index);
      this.changeState();
      return true;
    }
  }

  /**
   * Finds the end of a variable in the stack and
   *
   * @returns True if the end of a variable was found, false otherwise. Note that there can still be
   * a match when continuing the search with the next chunk.
   */
  private findEndOfVariable() {
    const index = this.findIndex(this._endPattern, this._startPattern.length, this._maxFullPatternLength - this._startPattern.length);
    if (index === -1) {
      if (this._stack.length >= this._maxFullPatternLength) {
        this.releaseStack(this._maxFullPatternLength);
        this.changeState();
      }
      return false;
    } else {
      this._variableName = this._stack.subarray(this._startPattern.length, index);
      return true;
    }
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
  }

  /**
   * Stateful function to find the index of a pattern in the stack. The function can
   * search over multiple chunks and continues incomplete matches in the next chunk.
   *
   * @param pattern The pattern to search for
   * @param offset The offset to start searching in the buffer
   * @param maxLength The maximum length to search in the buffer
   */
  private findIndex(pattern: Buffer, offset = 0, maxLength = 0) {
    const maxIndex = maxLength > 0 ? Math.min(this._stack.length, offset + this._matchCount + maxLength) : this._stack.length;
    for (let index = offset + this._matchCount; index < maxIndex; index++) {
      if (this._stack[index] === pattern[this._matchCount]) {
        if (++this._matchCount === pattern.length) {
          return index - pattern.length + 1;
        }
      } else {
        this._matchCount = 0;
      }
    }
    return -1;
  }

  /**
   * Changes the state of the pattern matching and resets the match count.
   */
  private changeState() {
    this._isMatching = !this._isMatching;
    this._matchCount = 0;
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
      if (this._options.throwOnMissingVariable) {
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