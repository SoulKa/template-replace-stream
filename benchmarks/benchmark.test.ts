import { Readable } from "stream";
import { describe, expect, it } from "@jest/globals";
import { FixedChunkSizeReadStream } from "../tests/stream";

async function stringStreamToString(stream: Readable) {
  return await new Promise<string>((resolve, reject) => {
    let string = "";
    stream.on("data", (chunk: string) => (string += chunk));
    stream.on("end", () => resolve(string));
    stream.on("error", reject);
  });
}

describe("replacestream", () => {
  it("should replace variables in a stream", async () => {
    // Arrange
    const replaceStream = (await import("replacestream")).default;
    const templateString = "Hello, {{ name }}!";
    const variableMap = new Map([["name", "World"]]);
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = replaceStream(
      new RegExp(`\\{\\{(.*)}}`),
      (match, key) => variableMap.get(key.trim()) ?? match
    );

    // Act
    const result = await stringStreamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe("Hello, World!");
  });

  it("should not modify the stream if there are no template variables", async () => {
    // Arrange
    const replaceStream = (await import("replacestream")).default;
    const templateString = "Hello, World!";
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = replaceStream(new RegExp(`\\{\\{(.*)}}`), (match, key) => match);

    // Act
    const result = await stringStreamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe(templateString);
  });

  it("should not modify the string if the template variables are unresolved", async () => {
    // Arrange
    const replaceStream = (await import("replacestream")).default;
    const templateString = "Hello, {{ name }}!";
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = replaceStream(new RegExp(`\\{\\{(.*)}}`), (match, key) => match);

    // Act
    const result = await stringStreamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe(templateString);
  });
});
