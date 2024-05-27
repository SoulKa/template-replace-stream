import {Readable} from "stream";

export const DEFAULT_CHUNK_SIZE = 16 * 1024;  // 16 KiB

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

export type BufferGenerator = (chunkIndex: number) => Buffer;

export class FixedLengthReadStream extends Readable {

  private readonly _chunkSource: Buffer | BufferGenerator;
  private _byteLength: number;
  private _chunkIndex = 0;

  constructor(chunkSource: Buffer | string | BufferGenerator, byteLength: number, encoding: BufferEncoding = 'utf8') {
    super();
    if (typeof chunkSource === 'function' || chunkSource instanceof Buffer) {
      this._chunkSource = chunkSource;
    } else {
      this._chunkSource = Buffer.from(chunkSource, encoding);
    }
    this._byteLength = byteLength;
  }

  _read() {
    const nextChunk = this.getChunk();
    if (this._byteLength >= nextChunk.length) {
      this.push(nextChunk);
      this._byteLength -= nextChunk.length;
    } else if (this._byteLength !== 0) {
      this.push(nextChunk.subarray(0, this._byteLength));
      this._byteLength = 0;
    } else {
      this.push(null);
    }
  }

  private getChunk() {
    if (typeof this._chunkSource === 'function') {
      return this._chunkSource(this._chunkIndex++);
    }
    return this._chunkSource;
  }
}

/**
 * Returns a buffer with the specified content and size.
 *
 * @param content The content of the buffer that should be at the start of the chunk
 * @param chunkSize The size of chunk. It fills up the remaining space with spaces.
 */
export function getChunk(content = '', chunkSize = DEFAULT_CHUNK_SIZE) {
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

export async function streamToString(stream: Readable) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}