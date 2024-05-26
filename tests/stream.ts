import {Readable} from "stream";

export class FixedChunkSizeReadStream extends Readable {

  private readonly _chunkSize: number;
  private readonly _buffer: Buffer;
  private _current: number;

  constructor(data: Buffer | string, chunkSize = data.length, encoding: BufferEncoding = 'utf8') {
    super();
    this._buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);
    this._chunkSize = chunkSize;
    this._current = 0;
  }

  _read() {
    if (this._current >= this._buffer.length) {
      this.push(null);
    } else {
      this.push(this._buffer.subarray(this._current, this._current += this._chunkSize));
    }
  }
}

export class FixedLengthReadStream extends Readable {

  private readonly _chunk: Buffer;
  private _byteLength: number;

  constructor(chunk: Buffer | string, byteLength: number, encoding: BufferEncoding = 'utf8') {
    super();
    this._chunk = chunk instanceof Buffer ? chunk : Buffer.from(chunk, encoding);
    this._byteLength = byteLength;
  }

  _read() {
    if (this._byteLength >= this._chunk.length) {
      this.push(this._chunk);
      this._byteLength -= this._chunk.length;
    } else if (this._byteLength !== 0) {
      this.push(this._chunk.subarray(0, this._byteLength));
      this._byteLength = 0;
    } else {
      this.push(null);
    }
  }
}

/**
 * Returns a buffer with the specified content and size.
 *
 * @param content The content of the buffer that should be at the start of the chunk
 * @param chunkSize The size of chunk. It fills up the remaining space with spaces.
 */
export function getChunk(content = '', chunkSize = 16 * 1024) {
  return Buffer.from(content + ' '.repeat(chunkSize - content.length));
}

/**
 * Consumes a stream and returns the number of bytes read.
 * @param stream The stream to consume
 */
export function consumeStream(stream: Readable) {
  return new Promise<number>((resolve, reject) => {
    let bytesRead = 0;
    stream.on('end', () => resolve(bytesRead));
    stream.on('error', reject);
    stream.on('data', chunk => bytesRead += chunk.length);
  });
}