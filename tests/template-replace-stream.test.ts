import {Readable} from 'stream';
import {TemplateReplaceStream} from '../src';
import {describe, expect, it} from "@jest/globals";
import {consumeStream, FixedChunkSizeReadStream, FixedLengthReadStream, getChunk} from "./stream";

async function streamToString(stream: Readable) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

describe('TemplateReplaceStream', () => {
  it('should replace variables in a stream', async () => {
    // Arrange
    const templateString = 'Hello, {{ name }}!';
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

  it('should not modify the string if the template variables are unresolved', async () => {
    // Arrange
    const templateString = 'Hello, {{ name }}!';
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = new TemplateReplaceStream(new Map());

    // Act
    const result = await streamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe(templateString);
  });

  it('should replace variables in a stream using another string as replace value source', async () => {
    // Arrange
    const templateString = 'Hello, {{ name }}!';
    const replaceValueSourceStream = new FixedChunkSizeReadStream('Universe', 1).pause();
    const variableMap = new Map([['name', replaceValueSourceStream]]);
    const transformStream = new TemplateReplaceStream(variableMap);
    const templateStream = new FixedChunkSizeReadStream(templateString);

    // Act
    const result = await streamToString(templateStream.pipe(transformStream));

    // Assert
    expect(result).toBe('Hello, Universe!');
  });

  it('should replace a small string by a large stream content', async () => {
    // Arrange
    const valueStreamLength = 25 * 1e6;
    const sourceStream = new FixedChunkSizeReadStream('{{ t }}');
    const valueStream = new FixedLengthReadStream(getChunk(), valueStreamLength);
    const replaceStream = new TemplateReplaceStream(new Map([['t', valueStream]]));

    // Act
    const bytesRead = await consumeStream(sourceStream.pipe(replaceStream));

    // Assert
    expect(bytesRead).toBe(valueStreamLength);
  });
});