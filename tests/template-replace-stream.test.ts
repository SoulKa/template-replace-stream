import { Readable, Writable } from "stream";
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

  it("should not hang on an unclosed template longer than maxVariableNameLength", async () => {
    // Arrange
    const input = "{{" + "a".repeat(150);

    // Act
    const result = await TemplateReplaceStream.replaceStringAsync(input, new Map(), {
      maxVariableNameLength: 100,
    });

    // Assert
    expect(result).toBe(input);
  });

  it("should keep replacing valid templates after an over-long unclosed template", async () => {
    // Arrange
    const input = "{{" + "a".repeat(150) + "{{ name }}";
    const templateStream = new FixedChunkSizeReadStream(input, 1);
    const transformStream = new TemplateReplaceStream(new Map([["name", "X"]]), {
      maxVariableNameLength: 100,
    });

    // Act
    const result = await streamToString(templateStream.pipe(transformStream));

    // Assert
    expect(result).toBe("{{" + "a".repeat(150) + "X");
  });

  it("should not reject a variable name shorter than maxVariableNameLength as too long", async () => {
    // The variable-name-length counter must measure only the bytes after the start pattern, not
    // include the start pattern itself. A 9-byte name with a limit of 10 must not be rejected.
    const input = "{{" + "a".repeat(9);
    const result = await TemplateReplaceStream.replaceStringAsync(input, new Map(), {
      maxVariableNameLength: 10,
      throwOnUnmatchedTemplate: true,
    });
    expect(result).toBe(input);
  });

  it("should reject a variable name at or beyond maxVariableNameLength with ERR_VARIABLE_NAME_TOO_LONG", async () => {
    const input = "{{" + "a".repeat(10);
    const error = await TemplateReplaceStream.replaceStringAsync(input, new Map(), {
      maxVariableNameLength: 5,
      throwOnUnmatchedTemplate: true,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(TemplateReplaceStreamError);
    expect(error.code).toBe("ERR_VARIABLE_NAME_TOO_LONG");
  });

  it("should count the whole variable name toward maxVariableNameLength, including bytes before a lone end-pattern byte", async () => {
    // A single "}" does not complete the "}}" end pattern, but the bytes leading up to it still count
    // toward the name length. Name "aa}bbbbbb" is 9 bytes, exceeding the limit of 8. (Before the
    // length was tracked directly, an internal end-pattern byte reset the counter and this passed.)
    const input = "{{aa}" + "b".repeat(6);
    const error = await TemplateReplaceStream.replaceStringAsync(input, new Map(), {
      maxVariableNameLength: 8,
      throwOnUnmatchedTemplate: true,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(TemplateReplaceStreamError);
    expect(error.code).toBe("ERR_VARIABLE_NAME_TOO_LONG");
  });

  // Regression: `findVariableEnd` used `indexOf` to jump straight to the next boundary byte, but the
  // `maxVariableNameLength` check only ran in the no-boundary branch. A single chunk could therefore
  // jump past the limit to a closing end pattern and resolve an over-long name, while a chunk-split
  // stream abandoned the same name at the limit — the outcome depended on how the input was chunked.
  // The name (200 bytes) exceeds the limit (100), so it must be left untouched at every chunk size.
  it("does not resolve a variable name longer than maxVariableNameLength that closes with an end pattern", async () => {
    const name = "a".repeat(200);
    const input = `{{${name}}}`;
    const map = new Map([[name, "X"]]);
    for (const chunkSize of [1, 7, 50, 4096]) {
      const readable = new FixedChunkSizeReadStream(input, chunkSize);
      const stream = new TemplateReplaceStream(map, { maxVariableNameLength: 100 });
      expect(await streamToString(readable.pipe(stream))).toBe(input);
    }
  });

  it("throws ERR_VARIABLE_NAME_TOO_LONG in a single chunk for an over-long name that closes with an end pattern", async () => {
    // The same input as above but in a single chunk used to resolve silently instead of throwing.
    const name = "a".repeat(200);
    const error = await TemplateReplaceStream.replaceStringAsync(
      `{{${name}}}`,
      new Map([[name, "X"]]),
      { maxVariableNameLength: 100, throwOnUnmatchedTemplate: true }
    ).catch((e) => e);
    expect(error).toBeInstanceOf(TemplateReplaceStreamError);
    expect(error.code).toBe("ERR_VARIABLE_NAME_TOO_LONG");
  });

  it("still resolves a variable name just under maxVariableNameLength that closes with an end pattern", async () => {
    // Boundary guard: the length cap must not reject names within the limit. A 9-byte name with a
    // limit of 10 must still resolve in a single chunk.
    const name = "a".repeat(9);
    const result = await TemplateReplaceStream.replaceStringAsync(
      `{{${name}}}`,
      new Map([[name, "X"]]),
      { maxVariableNameLength: 10 }
    );
    expect(result).toBe("X");
  });

  it("abandons an over-long name that reopens a start pattern beyond the limit, consistently across chunk sizes", async () => {
    // The name "a".repeat(10) exceeds the limit (4) before the reopened "{{b}}"; the reopened template
    // still resolves and the outcome must not depend on chunking.
    const input = "{{" + "a".repeat(10) + "{{b}}";
    const map = new Map([["b", "B"]]);
    for (const chunkSize of [1, 3, 4096]) {
      const readable = new FixedChunkSizeReadStream(input, chunkSize);
      const stream = new TemplateReplaceStream(map, { maxVariableNameLength: 4 });
      expect(await streamToString(readable.pipe(stream))).toBe("{{" + "a".repeat(10) + "B");
    }
  });

  it("throws in a single chunk for an over-long name that reopens a start pattern beyond the limit", async () => {
    const error = await TemplateReplaceStream.replaceStringAsync(
      "{{" + "a".repeat(10) + "{{b}}",
      new Map([["b", "B"]]),
      { maxVariableNameLength: 4, throwOnUnmatchedTemplate: true }
    ).catch((e) => e);
    expect(error).toBeInstanceOf(TemplateReplaceStreamError);
    expect(error.code).toBe("ERR_VARIABLE_NAME_TOO_LONG");
  });

  it("should not let the internal buffer grow with the input on an unterminated end-byte run", async () => {
    // Stream "{{" then ~200KB of "}x". Every lone "}" leaves the name unterminated. The fix abandons
    // the over-long name and releases the buffer as it scans, so the residual stack observed between
    // chunks stays ~0; the pre-fix counter-reset never released and the residual grew to the whole
    // input. Assert the residual is a small fraction of the input (i.e. memory is sublinear).
    // White-box: peak residual buffering is not otherwise observable.
    const input = "{{" + "}x".repeat(100_000);
    const stream = new TemplateReplaceStream(new Map(), { maxVariableNameLength: 100 });
    let residualAfterChunk = 0;
    type Internals = { _transform: TemplateReplaceStream["_transform"]; _stack: Buffer };
    const internals = stream as unknown as Internals;
    const origTransform = internals._transform.bind(stream);
    internals._transform = (chunk, encoding, callback) =>
      origTransform(chunk, encoding, ((...args) => {
        if (internals._stack.length > residualAfterChunk)
          residualAfterChunk = internals._stack.length;
        (callback as (...a: unknown[]) => void)(...args);
      }) as typeof callback);
    const readable = new FixedChunkSizeReadStream(input, 64 * 1024);
    await streamToString(readable.pipe(stream));
    expect(residualAfterChunk).toBeLessThan(input.length / 8);
  });

  // Regression: an unterminated template that reopens the start pattern before any end-pattern byte
  // (e.g. "{{{") used to hang. In `findVariableEnd`, when no end byte remains (nextEndIndex === -1)
  // but a start byte does, taking the end branch set `_stackIndex = nextEndIndex + 1 = 0` and spun
  // the `_transform` loop forever. The guard now also requires `nextEndIndex !== -1`, so such input
  // is passed through (or the reopened template is resolved) instead of hanging.
  it("passes through an unterminated template that reopens the start pattern without hanging", async () => {
    expect(await TemplateReplaceStream.replaceStringAsync("{{{", new Map())).toBe("{{{");
    expect(await TemplateReplaceStream.replaceStringAsync("{{{{", new Map())).toBe("{{{{");
    expect(await TemplateReplaceStream.replaceStringAsync("{{ {{ ", new Map())).toBe("{{ {{ ");
    expect(await TemplateReplaceStream.replaceStringAsync("Hello {{name{{", new Map())).toBe(
      "Hello {{name{{"
    );
    // The reopened template wins; the abandoned prefix is emitted verbatim.
    expect(await TemplateReplaceStream.replaceStringAsync("{{a{{b}}", new Map([["b", "X"]]))).toBe(
      "{{aX"
    );
  });

  it("does not hang on a reopened start pattern split across single-byte chunks", async () => {
    const readable = new FixedChunkSizeReadStream("a{{b{{c}}", 1);
    const transformStream = new TemplateReplaceStream(new Map([["c", "Z"]]));
    expect(await streamToString(readable.pipe(transformStream))).toBe("a{{bZ");
  });

  // Regression: a Readable replacement value larger than the transform's readable highWaterMark
  // makes `push` return false; the code used to await `once(this, "drain")` — a writable-side event
  // that never fires for the already-flushed template — deadlocking under a slow consumer. The wait
  // is now released by the readable side's `_read`, so the pipeline drains and finishes.
  it("completes a large Readable replacement value behind a slow consumer", async () => {
    const CHUNK = Buffer.alloc(8 * 1024, 0x61);
    let produced = 0;
    const value = new Readable({
      read() {
        this.push(produced++ < 32 ? CHUNK : null);
      },
    });
    const trs = new TemplateReplaceStream(new Map([["a", value]]));
    let delivered = 0;
    const slow = new Writable({
      highWaterMark: 1024,
      write(chunk, _enc, cb) {
        delivered += chunk.length;
        setTimeout(cb, 1);
      },
    });
    const settled = new Promise<"finished" | "errored">((resolve) => {
      slow.on("finish", () => resolve("finished"));
      slow.on("error", () => resolve("errored"));
      trs.on("error", () => resolve("errored"));
    });
    trs.pipe(slow);
    trs.end("x{{a}}y");
    let timer: NodeJS.Timeout;
    const stalled = new Promise<"stalled">((resolve) => {
      timer = setTimeout(() => resolve("stalled"), 3000);
    });
    try {
      expect(await Promise.race([settled, stalled])).toBe("finished");
      // "x" + 32 * 8KiB value + "y"
      expect(delivered).toBe(1 + 32 * 8 * 1024 + 1);
    } finally {
      clearTimeout(timer!);
      trs.destroy();
      value.destroy();
      slow.destroy();
    }
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

    it.each(CHUNK_SIZES)(
      "leaves an unmatched variable untouched (chunk size %i)",
      async (chunkSize) => {
        const template = `Hello, ${start} name ${end}!`;
        const readable = new FixedChunkSizeReadStream(template, chunkSize);
        const transformStream = new TemplateReplaceStream(new Map(), options);

        const result = await streamToString(readable.pipe(transformStream));

        expect(result).toBe(template);
      }
    );

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

  // Self-overlapping end pattern — one whose first two bytes are equal, e.g. "]]>". A partial end
  // match must not skip the byte where the *real* end could begin: in "[[[a]]]>" the "]]" at offset
  // 4 fails on its third byte, but the genuine "]]>" starts one byte later at offset 5. The variable
  // name (trimmed) is "a]".
  it("handles a self-overlapping end pattern (overlapping partial match)", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "[[[a]]]>",
      new Map([["a]", "X"]]),
      { startPattern: "[[[", endPattern: "]]>" }
    );
    expect(result).toBe("X");
  });

  it("handles a self-overlapping end pattern across single-byte chunks", async () => {
    const readable = new FixedChunkSizeReadStream("[[[a]]]>", 1);
    const transformStream = new TemplateReplaceStream(new Map([["a]", "X"]]), {
      startPattern: "[[[",
      endPattern: "]]>",
    });
    const result = await streamToString(readable.pipe(transformStream));
    expect(result).toBe("X");
  });

  // Repeated-prefix end pattern "aab": in "[[[x.aaab" the run "aaa" produces a partial "aa" that
  // fails on its third byte, and the real end "aab" starts at the next 'a'. The variable name is
  // everything up to that end, i.e. "x.a".
  it("handles overlapping partial matches for a repeated-prefix end pattern", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "[[[x.aaab",
      new Map([["x.a", "X"]]),
      { startPattern: "[[[", endPattern: "aab" }
    );
    expect(result).toBe("X");
  });

  // Self-overlapping start pattern — one whose first two bytes are equal, e.g. "<<!". A partial start
  // match must not skip the byte where the *real* start could begin: in "<<<!name>>" the "<<" at
  // offset 0 fails on its third byte, but the genuine "<<!" starts one byte later at offset 1. The
  // leading "<" is emitted verbatim before the replacement.
  it("handles a self-overlapping start pattern (overlapping partial match)", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "<<<!name>>",
      new Map([["name", "X"]]),
      { startPattern: "<<!", endPattern: ">>" }
    );
    expect(result).toBe("<X");
  });

  it("handles a self-overlapping start pattern across single-byte chunks", async () => {
    const readable = new FixedChunkSizeReadStream("<<<!name>>", 1);
    const transformStream = new TemplateReplaceStream(new Map([["name", "X"]]), {
      startPattern: "<<!",
      endPattern: ">>",
    });
    const result = await streamToString(readable.pipe(transformStream));
    expect(result).toBe("<X");
  });

  // Repeated-prefix start pattern "aab": in "aaabNM>>" the run "aaa" produces a partial "aa" that
  // fails on its third byte, and the real start "aab" begins at the next 'a'. The leading "a" is
  // emitted verbatim before the replacement. (The variable name avoids the start byte 'a', which
  // would otherwise be treated as a new start candidate — a separate, intended behavior.)
  it("handles overlapping partial matches for a repeated-prefix start pattern", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "aaabNM>>",
      new Map([["NM", "X"]]),
      { startPattern: "aab", endPattern: ">>" }
    );
    expect(result).toBe("aX");
  });

  // The overlapping-start rewind must also work when the partial match spans a chunk boundary, i.e.
  // when `_matchCount` is carried into the next chunk before the mismatch is discovered.
  it("handles a repeated-prefix start pattern across single-byte chunks", async () => {
    const readable = new FixedChunkSizeReadStream("aaabNM>>", 1);
    const transformStream = new TemplateReplaceStream(new Map([["NM", "X"]]), {
      startPattern: "aab",
      endPattern: ">>",
    });
    const result = await streamToString(readable.pipe(transformStream));
    expect(result).toBe("aX");
  });
});

describe("TemplateReplaceStream edge cases", () => {
  it("replaces adjacent templates with no text between them", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "{{a}}{{b}}",
      new Map([
        ["a", "1"],
        ["b", "2"],
      ])
    );
    expect(result).toBe("12");
  });

  it("does not re-scan a replacement value that itself contains template syntax", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "{{a}}",
      new Map([
        ["a", "{{b}}"],
        ["b", "SHOULD_NOT_APPEAR"],
      ])
    );
    expect(result).toBe("{{b}}");
  });

  it("leaves an empty template {{}} untouched when the empty name is unmatched", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync("a{{}}b", new Map());
    expect(result).toBe("a{{}}b");
  });

  it("replaces an empty variable name when the map has an empty-string key", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync("{{}}", new Map([["", "Z"]]));
    expect(result).toBe("Z");
  });

  it("trims a whitespace-only variable name down to the empty-string key", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync("{{   }}", new Map([["", "Z"]]));
    expect(result).toBe("Z");
  });

  it("replaces using a Buffer value from the map", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "x{{a}}y",
      new Map([["a", Buffer.from("BUF")]])
    );
    expect(result).toBe("xBUFy");
  });

  it("replaces using a resolver function returning a Promise", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync("{{a}}", (name) =>
      name === "a" ? Promise.resolve("P") : undefined
    );
    expect(result).toBe("P");
  });

  it("replaces using a resolver function returning a Readable", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync("{{a}}", (name) =>
      name === "a" ? Readable.from("RS") : undefined
    );
    expect(result).toBe("RS");
  });

  it("removes the template when the value is an empty Readable stream", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "x{{a}}y",
      new Map([["a", Readable.from("")]])
    );
    expect(result).toBe("xy");
  });

  it("preserves a multi-byte UTF-8 replacement value", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "x{{a}}y",
      new Map([["a", "🎉"]])
    );
    expect(result).toBe("x🎉y");
  });

  it("resolves a variable name containing multi-byte UTF-8 characters", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "{{café}}",
      new Map([["café", "U"]])
    );
    expect(result).toBe("U");
  });

  // The stream operates on bytes; a multi-byte character split across chunk boundaries in the
  // passthrough text must be reassembled intact rather than corrupted.
  it("preserves a multi-byte character split across single-byte chunks", async () => {
    const readable = new FixedChunkSizeReadStream(Buffer.from("pp😀qq"), 1);
    const transformStream = new TemplateReplaceStream(new Map());
    const result = await streamToString(readable.pipe(transformStream));
    expect(result).toBe("pp😀qq");
  });

  it("flushes a lone unterminated start pattern at end of input", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "text {{a",
      new Map([["a", "1"]])
    );
    expect(result).toBe("text {{a");
  });

  // With the default {{ }} patterns, "{{{{a}}}}" resolves the inner {{a}} and leaves the outer pair.
  it("replaces the inner pair of nested-looking braces and keeps the outer braces", async () => {
    const result = await TemplateReplaceStream.replaceStringAsync(
      "{{{{a}}}}",
      new Map([["a", "1"]])
    );
    expect(result).toBe("{{1}}");
  });
});
