import {Readable} from 'stream';
import {TemplateReplaceStream} from '.';
import {describe, expect, it} from "@jest/globals";

class FixedChunkSizeReadStream extends Readable {

  private readonly _chunkSize: number;
  private readonly _buffer: Buffer;
  private _current: number;

  constructor(data: Buffer | string, chunkSize: number, encoding: BufferEncoding = 'utf8') {
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

async function streamToString(stream: Readable) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

describe('FixedChunkSizeReadStream', () => {
  it('should read a buffer in fixed size chunks', async () => {
    const sourceString = 'Hello, World!';
    const expectedChunks = sourceString.split('');
    const chunks = [] as string[];
    const buffer = Buffer.from(sourceString);
    const stream: Readable = new FixedChunkSizeReadStream(buffer, 1);

    stream.on('data', (chunk) => chunks.push(chunk.toString()));
    await new Promise((resolve) => stream.on('end', resolve));

    expect(chunks).toEqual(expectedChunks);
  });
});

describe('TemplateReplacerStream', () => {
  it('should replace variables in a stream', async () => {
    // Arrange
    const templateString = 'Hello, ${{ name }}!';
    const variableMap = new Map([['name', 'World']]);
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = new TemplateReplaceStream(variableMap);

    // Act
    const result = await streamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe('Hello, World!');
  });

  it('should not modify the stream if there are no template variables', async () => {
    // Arrange
    const templateString = 'Hello, World!';
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = new TemplateReplaceStream(new Map());

    // Act
    const result = await streamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe(templateString);
  });

  it('should not modify the string if the template variables are not in the map', async () => {
    // Arrange
    const templateString = 'Hello, ${{ name }}!';
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = new TemplateReplaceStream(new Map());

    // Act
    const result = await streamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe(templateString);
  });
});