import { Transform, TransformCallback } from 'node:stream';

const START_PATTERN = '${{'.split('').map(char => char.charCodeAt(0));
const END_PATTERN = '}}'.split('').map(char => char.charCodeAt(0));
const MAX_VARIABLE_NAME_LENGTH = 100;
const MAX_FULL_PATTERN_LENGTH = START_PATTERN.length + MAX_VARIABLE_NAME_LENGTH + END_PATTERN.length;

/**
 * A stream that replaces template variables in a stream with values from a map.
 * It only works with buffers and does not support string encoding.
 */
export class TemplateReplaceStream extends Transform {

  private _stack = Buffer.alloc(0);
  private _isMatching = false;
  private _matchCount = 0;
  private readonly _variables: Map<string, string>;

  /**
   * Creates a new instance of the template replacer stream.
   *
   * @param variables The map of variables to replace. The keys are the variable
   * names and the values are the replacements.
   */
  constructor(variables: Map<string, string>) {
    super({});
    this._variables = variables;
  }

  _transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback) {
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
        }
      }
    } else {
      this.push(chunk);
    }

    callback();
  }

  _flush(callback: TransformCallback) {
    if (this._stack.length > 0) {
      this.push(this._stack);
    }
    callback();
  }

  /**
   * Finds the start of a variable in the stack.
   *
   * @returns True if the start of a variable was found, false otherwise.
   */
  private findStartOfVariable() {
    const index = this.findIndex(START_PATTERN);
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
   * Finds the end of a variable in the stack.
   *
   * @returns True if the end of a variable was found, false otherwise.
   */
  private findEndOfVariable() {
    const index = this.findIndex(END_PATTERN, START_PATTERN.length, MAX_FULL_PATTERN_LENGTH - START_PATTERN.length);
    if (index === -1) {
      if (this._stack.length >= MAX_FULL_PATTERN_LENGTH) {
        this.releaseStack(MAX_FULL_PATTERN_LENGTH);
        this.changeState();
      }
      return false;
    } else if (index !== -1) {
      const variableBuffer = this._stack.subarray(START_PATTERN.length, index);
      const value = this.getValueOfVariable(variableBuffer);
      if (value) {
        this.push(value);
        this._stack = this._stack.subarray(index + END_PATTERN.length);
      } else {
        this.releaseStack(index + END_PATTERN.length);
      }
      this.changeState();
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
  private findIndex(pattern: number[], offset = 0, maxLength = 0) {
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
    const value = this._variables.get(variableName);
    if (value === undefined) {
      console.debug(`Unmatched variable "${variableName}"`);
    } else {
      console.debug(`Replacing variable "${variableName}" with "${value}"`);
      return Buffer.from(value);
    }
  }
}