import { Readable } from "stream";
import {
  TemplateReplaceStream,
  TemplateReplaceStreamError,
  UnmatchedVariableError,
} from "template-replace-stream";
import { describe, expect, it } from "vitest";
import {
  consumeStream,
  DEFAULT_CHUNK_SIZE,
  FixedChunkSizeReadStream,
  FixedLengthReadStream,
  getChunk,
  streamToString,
} from "./stream";

describe("TemplateReplaceStream", () => {
  it("should throw if maxVariableNameLength is 0", () => {
    expect(
      () =>
        new TemplateReplaceStream(new Map(), {
          maxVariableNameLength: 0,
        })
    ).toThrowError("The maximum variable name length must be greater than 0");
  });

  it("should throw if maxVariableNameLength is negative", () => {
    expect(
      () =>
        new TemplateReplaceStream(new Map(), {
          maxVariableNameLength: -5,
        })
    ).toThrowError("The maximum variable name length must be greater than 0");
  });

  it("should throw if startPattern is empty", () => {
    expect(
      () =>
        new TemplateReplaceStream(new Map(), {
          startPattern: "",
        })
    ).toThrowError("The start pattern must not be empty");
  });

  it("should throw if endPattern is empty", () => {
    expect(
      () =>
        new TemplateReplaceStream(new Map(), {
          endPattern: "",
        })
    ).toThrowError("The end pattern must not be empty");
  });

  it("should throw a TemplateReplaceStreamError with code ERR_INVALID_OPTION for invalid options", () => {
    let error: unknown;
    try {
      new TemplateReplaceStream(new Map(), { maxVariableNameLength: 0 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TemplateReplaceStreamError);
    expect((error as TemplateReplaceStreamError).code).toBe("ERR_INVALID_OPTION");
  });

  it("should throw an UnmatchedVariableError exposing the variable name and code when throwOnUnmatchedTemplate is set", async () => {
    // Arrange
    const readable = new FixedChunkSizeReadStream("{{ missing }}", 1);
    const transformStream = new TemplateReplaceStream(new Map(), {
      throwOnUnmatchedTemplate: true,
    });

    // Act
    const error = await streamToString(readable.pipe(transformStream)).catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(UnmatchedVariableError);
    expect(error).toBeInstanceOf(TemplateReplaceStreamError);
    expect(error.variableName).toBe("missing");
    expect(error.code).toBe("ERR_UNMATCHED_VARIABLE");
  });

  it("should replace variables in a stream", async () => {
    // Arrange
    const templateString = "{{ greeting }}, {{ name }}!";
    const variableMap = new Map([
      ["greeting", "Hello"],
      ["name", "World"],
    ]);
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = new TemplateReplaceStream(variableMap);

    // Act
    const result = await streamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe("Hello, World!");
  });

  it("should replace variables in a large stream", async () => {
    // Arrange
    const streamLength = 25 * 1024 * 1024;
    const variableName = "name";
    const template = `{{ ${variableName} }}`;
    const replacement = "you";
    const expectedStart = `Hello, ${replacement}!`;
    const variableMap = new Map([[variableName, replacement]]);
    const readable: Readable = new FixedLengthReadStream(
      getChunk(expectedStart.replace(replacement, template)),
      streamLength
    );
    const transformStream = new TemplateReplaceStream(variableMap);

    // Act
    const result = await streamToString(readable.pipe(transformStream));

    // Assert
    expect(result.length).toBe(
      streamLength -
        Math.ceil(streamLength / DEFAULT_CHUNK_SIZE) * (template.length - replacement.length)
    );
    expect(result.substring(0, expectedStart.length)).toBe(expectedStart);
  });

  it("should not modify the stream if there are no template variables", async () => {
    // Arrange
    const templateString = "Hello, World!";
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = new TemplateReplaceStream(new Map());

    // Act
    const result = await streamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe(templateString);
  });

  it("should not modify the string if the template variables are unresolved", async () => {
    // Arrange
    const templateString = "Hello, {{ name }}!";
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = new TemplateReplaceStream(new Map());

    // Act
    const result = await streamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe(templateString);
  });

  it("should remove the template when the variable resolves to an empty string", async () => {
    // Arrange
    const templateString = "Hello, {{ name }}!";
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = new TemplateReplaceStream(new Map([["name", ""]]));

    // Act
    const result = await streamToString(readable.pipe(transformStream));

    // Assert
    expect(result).toBe("Hello, !");
  });

  it("should replace variables in a stream using another stream as replace value source", async () => {
    // Arrange
    const templateString = "Hello, {{ name }}!";
    const replaceValueSourceStream = new FixedChunkSizeReadStream("Universe", 1);
    const variableMap = new Map([["name", replaceValueSourceStream]]);
    const transformStream = new TemplateReplaceStream(variableMap);
    const templateStream = new FixedChunkSizeReadStream(templateString);

    // Act
    const result = await streamToString(templateStream.pipe(transformStream));

    // Assert
    expect(result).toBe("Hello, Universe!");
  });

  it("should replace a small string by a large stream content", async () => {
    // Arrange
    const valueStreamLength = 25 * 1e6;
    const sourceStream = new FixedChunkSizeReadStream("{{ t }}");
    const valueStream = new FixedLengthReadStream(getChunk(), valueStreamLength);
    const replaceStream = new TemplateReplaceStream(new Map([["t", valueStream]]));

    // Act
    const bytesRead = await consumeStream(sourceStream.pipe(replaceStream));

    // Assert
    expect(bytesRead).toBe(valueStreamLength);
  });

  it("should replace variables in a stream using other streams as replace value source", async () => {
    // Arrange
    const templateStream = new FixedChunkSizeReadStream("{{ one }} {{ two }} {{ three }}");
    const transformStream = new TemplateReplaceStream((key) => new FixedChunkSizeReadStream(key));

    // Act
    const result = await streamToString(templateStream.pipe(transformStream));

    // Assert
    expect(result).toBe("one two three");
  });

  it("should replace variables in a single character stream chunks using other streams as replace value source", async () => {
    // Arrange
    const templateStream = new FixedChunkSizeReadStream("{{ one }} {{ two }} {{ three }}", 1);
    const transformStream = new TemplateReplaceStream((key) => new FixedChunkSizeReadStream(key));

    // Act
    const result = await streamToString(templateStream.pipe(transformStream));

    // Assert
    expect(result).toBe("one two three");
  });

  it("should throw an error if a template variable is not found", async () => {
    // Arrange
    const templateString = "Hello, {{ name }}!";
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const transformStream = new TemplateReplaceStream(new Map(), {
      throwOnUnmatchedTemplate: true,
    });

    // Act & Assert
    await expect(streamToString(readable.pipe(transformStream))).rejects.toThrow(
      'Variable "name" not found in the variable map'
    );
  });

  it("should replace variables in a string using a variable map", async () => {
    // Arrange
    const templateString = "Hello, {{ name }}!";
    const variableMap = new Map([["name", "World"]]);
    const transformStream = new TemplateReplaceStream(variableMap);

    // Act
    const result = await streamToString(
      new FixedChunkSizeReadStream(templateString, 1).pipe(transformStream)
    );

    // Assert
    expect(result).toBe("Hello, World!");
  });

  it(":replaceAsync() should replace variables in a stream", async () => {
    // Arrange
    const templateString = "Hello, {{ name }}!";
    const readable: Readable = new FixedChunkSizeReadStream(templateString, 1);
    const variableMap = new Map([
      ["greeting", "Hello"],
      ["name", "World"],
    ]);

    // Act
    const result = await TemplateReplaceStream.replaceStringAsync(readable, variableMap);

    // Assert
    expect(result).toBe("Hello, World!");
  });

  it(":replaceStringAsync() should replace variables in a string", async () => {
    // Arrange
    const templateString = "{{ greeting }}, {{ name }}!";
    const variableMap = new Map([
      ["greeting", "Hello"],
      ["name", "World"],
    ]);

    // Act
    const result = await TemplateReplaceStream.replaceStringAsync(templateString, variableMap);

    // Assert
    expect(result).toBe("Hello, World!");
  });
});

describe("TemplateReplaceStream with varying start/end pattern lengths", () => {
  // Each config uses distinct first bytes for start and end so the two patterns never collide.
  const PATTERN_CONFIGS = [
    { label: "single-byte", start: "[", end: "]" },
    { label: "two-byte (default)", start: "{{", end: "}}" },
    { label: "three-byte", start: "<<<", end: ">>>" },
    { label: "asymmetric start=1/end=2", start: "@", end: "##" },
    { label: "asymmetric start=3/end=1", start: "{{{", end: "%" },
  ];
  // 1 byte forces the state machine across a chunk boundary between every byte.
  const CHUNK_SIZES = [1, 4, DEFAULT_CHUNK_SIZE];

  describe.each(PATTERN_CONFIGS)("$label patterns ($start … $end)", ({ start, end }) => {
    const options = { startPattern: start, endPattern: end };

    it.each(CHUNK_SIZES)("replaces a simple variable (chunk size %i)", async (chunkSize) => {
      const template = `Hello, ${start} name ${end}!`;
      const readable = new FixedChunkSizeReadStream(template, chunkSize);
      const transformStream = new TemplateReplaceStream(new Map([["name", "World"]]), options);

      const result = await streamToString(readable.pipe(transformStream));

      expect(result).toBe("Hello, World!");
    });

    it.each(CHUNK_SIZES)("leaves an unmatched variable untouched (chunk size %i)", async (chunkSize) => {
      const template = `Hello, ${start} name ${end}!`;
      const readable = new FixedChunkSizeReadStream(template, chunkSize);
      const transformStream = new TemplateReplaceStream(new Map(), options);

      const result = await streamToString(readable.pipe(transformStream));

      expect(result).toBe(template);
    });

    it.each(CHUNK_SIZES)(
      "removes the template when the value is an empty string (chunk size %i)",
      async (chunkSize) => {
        const template = `Hello, ${start} name ${end}!`;
        const readable = new FixedChunkSizeReadStream(template, chunkSize);
        const transformStream = new TemplateReplaceStream(new Map([["name", ""]]), options);

        const result = await streamToString(readable.pipe(transformStream));

        expect(result).toBe("Hello, !");
      }
    );

    // A partial end match is only possible for a multi-byte end pattern; a single-byte end
    // pattern can never appear inside a variable name.
    if (end.length >= 2) {
      const variableName = `a${end[0]}b`;
      it.each(CHUNK_SIZES)(
        `replaces a variable whose name contains the end pattern's first byte "${end[0]}" (chunk size %i)`,
        async (chunkSize) => {
          const template = `Hello, ${start} ${variableName} ${end}!`;
          const readable = new FixedChunkSizeReadStream(template, chunkSize);
          const transformStream = new TemplateReplaceStream(
            new Map([[variableName, "World"]]),
            options
          );

          const result = await streamToString(readable.pipe(transformStream));

          expect(result).toBe("Hello, World!");
        }
      );
    }
  });
});
