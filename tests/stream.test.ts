import {describe, expect, it} from "@jest/globals";
import {Readable} from "stream";
import {consumeStream, FixedChunkSizeReadStream, FixedLengthReadStream, getChunk} from "./stream";

describe('FixedChunkSizeReadStream', () => {
  it('should read a buffer in fixed size chunks', async () => {
    // Arrange
    const sourceString = 'Hello, World!';
    const expectedChunks = sourceString.split('');
    const chunks = [] as string[];
    const buffer = Buffer.from(sourceString);
    const stream: Readable = new FixedChunkSizeReadStream(buffer, 1);

    // Act
    stream.on('data', (chunk) => chunks.push(chunk.toString()));
    await new Promise((resolve) => stream.on('end', resolve));

    // Assert
    expect(chunks).toEqual(expectedChunks);
  });
});

describe('FixedLengthReadStream', () => {
  it('should provide exactly the specified amount of data', async () => {
    // Arrange
    const expectedLength = 25 * 1e6;
    const stream = new FixedLengthReadStream(getChunk(), expectedLength);

    // Act
    let length = await consumeStream(stream);

    // Assert
    expect(length).toBe(expectedLength);
  });
});