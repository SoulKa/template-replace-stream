# template-replace-stream

[![GitHub Actions CI](https://github.com/SoulKa/template-replace-stream/actions/workflows/node.js.yml/badge.svg)](https://github.com/SoulKa/template-replace-stream/actions/workflows/node.js.yml)
[![codecov](https://codecov.io/github/SoulKa/template-replace-stream/graph/badge.svg?token=JFCFRHKVL3)](https://codecov.io/github/SoulKa/template-replace-stream)
[![npm version](https://badge.fury.io/js/template-replace-stream.svg)](https://www.npmjs.com/package/template-replace-stream)
[![Downloads](https://img.shields.io/npm/dm/template-replace-stream.svg)](https://www.npmjs.com/package/template-replace-stream)

A high performance `{{ template }}` replace stream working on binary or string streams.

This module is written in pure TypeScript, consists of only 284 lines of code (including type
definitions) and has no other dependencies. It is flexible and allows replacing an arbitrary wide
range of template variables while being extremely fast (we reached over 20GiB/s,
see [Benchmarks](#benchmarks)).

## Install

```bash
npm install template-replace-stream
```

This module is published as ESM only (`import`, no `require()`) and ships with TypeScript type
definitions. It requires Node.js `>=22`.

### Supported Node.js Versions

The following Node.js versions are tested to work with the package. Older versions are not tested but should still be able to use it.

| 22.x | 24.x |
| --- | --- |
| [![CI](https://github.com/SoulKa/template-replace-stream/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/SoulKa/template-replace-stream/actions/workflows/node.js.yml) | [![CI](https://github.com/SoulKa/template-replace-stream/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/SoulKa/template-replace-stream/actions/workflows/node.js.yml) |

## Usage

You create a `TemplateReplaceStream` by passing a source of template variables and their replacement
values to the constructor. This may either be a map containing key-value pairs, or a function that
returns a replacement value for a given template string.

### JavaScript

This example replaces the template variables from a `Map`. Every occurrence of `{{ replace-me }}`
in the template file is replaced with the value stored under the key `"replace-me"`:

```js
import { TemplateReplaceStream } from "template-replace-stream";
import fs from "node:fs";
import path from "node:path";

// template.txt contains the text: Hello, this library is {{ replace-me }} :)
const templateFilePath = path.join(import.meta.dirname, "template.txt");
const outputFilePath = path.join(import.meta.dirname, "example.txt");

// map template variable names to their replacement values:
// every "{{ replace-me }}" in the template becomes "really fast"
const variables = new Map([["replace-me", "really fast"]]);

// read the template, replace the variables while streaming, and write the result
fs.createReadStream(templateFilePath)
  .pipe(new TemplateReplaceStream(variables))
  .pipe(fs.createWriteStream(outputFilePath))
  .on("finish", () => console.log(`Wrote "Hello, this library is really fast :)" to example.txt`));

```

### TypeScript

The same works with a resolver function instead of a `Map`. It is called with each variable name
found in the template and returns the replacement value — a `string`, `Buffer`, `Readable`, or a
`Promise` of one of those:

```ts
import { TemplateReplaceStream, type StringSource } from "template-replace-stream";
import fs from "node:fs";
import path from "node:path";

// template.txt contains the text: Hello, this library is {{ replace-me }} :)
const templateFilePath = path.join(import.meta.dirname, "template.txt");
const outputFilePath = path.join(import.meta.dirname, "example.txt");

// instead of a map, a resolver function can compute replacement values on demand.
// It receives the variable name and may return a string, Buffer, Readable, or a Promise of those.
function resolveVariable(variableName: string): StringSource {
  console.log(`Resolving variable "${variableName}"`);
  return "really fast";
}

// read the template, replace the variables while streaming, and write the result
fs.createReadStream(templateFilePath)
  .pipe(new TemplateReplaceStream(resolveVariable))
  .pipe(fs.createWriteStream(outputFilePath))
  .on("finish", () => console.log(`Wrote "Hello, this library is really fast :)" to example.txt`));

```

### One-shot Replacement without Streams

If you just want the replaced result and don't need streaming, the static helpers
`replaceStringAsync()` (resolves to a `string`) and `replaceAsync()` (resolves to a `Buffer`) wrap
the whole pipeline in a single call. They hold the full output in memory, so avoid them for large
inputs:

```js
import { TemplateReplaceStream } from "template-replace-stream";

const template = "Hello, this library is {{ replace-me }} :)";
const variables = new Map([["replace-me", "really fast"]]);

// resolves to a string; the input may be a string, Buffer, or Readable
console.log(await TemplateReplaceStream.replaceStringAsync(template, variables));

// same, but resolves to a Buffer (e.g. for binary templates)
const buffer = await TemplateReplaceStream.replaceAsync(template, variables);
console.log(buffer.toString());

```

### Advanced

#### Readable Stream as Replacement Value Source

It's also possible to pass another `Readable` as replacement value source to
the `TemplateReplaceStream`. In fact, the README you are just reading was created using this
feature. This makes it possible to replace template variables with whole files without reading them
into a stream before.

<details>
<summary>Advanced Example Code</summary>

```ts
import { type StringSource, TemplateReplaceStream } from "template-replace-stream";
import fs from "node:fs";
import path from "node:path";
import sloc from "sloc";
import { Project, ts } from "ts-morph";

const rootDir = path.join(import.meta.dirname, "..");
const exampleFiles = [
  "javascript-example.js",
  "typescript-example.ts",
  "async-example.js",
  "generate-readme.ts",
];

const outputFilePath = path.join(rootDir, "README.md");
const sourceFilePath = path.join(rootDir, "index.ts");
const codeInfo = sloc(fs.readFileSync(sourceFilePath, "utf8"), "ts");
const loc = codeInfo.total - codeInfo.comment - codeInfo.empty;
const optionsDefinition = extractTypeDefinition("TemplateReplaceStreamOptions", sourceFilePath);

// the map of example files and their read streams and further template variables
const templateMap = new Map<string, StringSource>(
  exampleFiles.map((file) => [file, openExampleStream(file)])
);
templateMap.set("loc", loc.toString());
templateMap.set("options-definition", optionsDefinition);

// create the streams
const readmeReadStream = fs.createReadStream(path.join(rootDir, "template.md"));
const readmeWriteStream = fs.createWriteStream(outputFilePath);

// connect the streams and put the template replace stream in the middle
readmeReadStream.pipe(new TemplateReplaceStream(templateMap)).pipe(readmeWriteStream);
readmeWriteStream.on("finish", () => console.log(`Created ${outputFilePath}`));

/**
 * Opens a file stream to the given source file.
 *
 * @param file The file to read.
 */
function openExampleStream(file: string) {
  return fs.createReadStream(path.join(import.meta.dirname, file));
}

/**
 * Extracts the type definition from the given source file.
 *
 * @param typeName The name of the type to extract.
 * @param filePath The full path to the source file.
 */
function extractTypeDefinition(typeName: string, filePath: string) {
  const sourceFile = new Project().addSourceFileAtPath(filePath);
  const typeNode = sourceFile.getTypeAlias(typeName)?.compilerNode;
  if (!typeNode) throw new Error(`Type alias ${typeName} not found.`);
  const printer = ts.createPrinter({ removeComments: false });
  return printer.printNode(ts.EmitHint.Unspecified, typeNode, sourceFile.compilerNode);
}

```

</details>

### Options

```ts
/**
 * Options for the template replace stream.
 */
export type TemplateReplaceStreamOptions = {
    /** Default: `false`. If true, the stream creates logs on debug level */
    log: boolean;
    /**
     * Default: `false`. If `true`, an unmatched template variable — one that has no replacement value —
     * makes the stream fail with an {@link UnmatchedVariableError} (emitted on the stream, or thrown by
     * the `replace*Async` helpers) instead of leaving the template untouched in the output.
     */
    throwOnUnmatchedTemplate: boolean;
    /**
     * Default: `100`. The maximum length of a variable name between a start and end pattern including
     * whitespaces around it. Any variable name longer than this length is ignored, i.e. the search
     * for the end pattern canceled and the stream looks for the next start pattern.
     * Note that a shorter length improves performance but may not find all variables.
     */
    maxVariableNameLength: number;
    /** Default: `'{{'`. The start pattern of a template string either as string or buffer */
    startPattern: string | Buffer;
    /** Default: `'}}'`. The end pattern of a template string either as string or buffer */
    endPattern: string | Buffer;
    /** Any options for the lower level {@link Transform} stream. Do not replace transform or flush */
    streamOptions?: TransformOptions;
};
```

### Error Handling

Every error the stream raises is a `TemplateReplaceStreamError` (or its `UnmatchedVariableError`
subclass) carrying a stable `code`. Prefer matching on `code` over the (human-readable) message.

| `code` | Cause |
| --- | --- |
| `ERR_INVALID_OPTION` | An invalid option was passed to the constructor (thrown synchronously). |
| `ERR_VARIABLE_NAME_TOO_LONG` | A variable name exceeded `maxVariableNameLength` (only when `throwOnUnmatchedTemplate` is enabled). |
| `ERR_UNMATCHED_VARIABLE` | A variable had no replacement value (only when `throwOnUnmatchedTemplate` is enabled). The `UnmatchedVariableError` subclass also exposes the name via `.variableName`. |
| `ERR_INVALID_CHUNK_TYPE` | A written chunk was neither a string nor a `Buffer` (only when `throwOnUnmatchedTemplate` is enabled; otherwise the chunk is passed through unmodified). |

Constructor errors are thrown synchronously; all others are emitted on the stream (or rejected by the
`replace*Async` helpers).

```ts
import { TemplateReplaceStream, UnmatchedVariableError } from "template-replace-stream";

try {
  await TemplateReplaceStream.replaceStringAsync("{{ name }}", new Map(), {
    throwOnUnmatchedTemplate: true,
  });
} catch (e) {
  if (e instanceof UnmatchedVariableError) console.error(`Missing variable: ${e.variableName}`);
}
```

## Benchmarks

The benchmarks were run on my MacBook Pro with an Apple M1 Pro Chip. The data source were virtual
files generated from- and to memory to omit any bottleneck due to the file system. The "native" data
refers to reading a virtual file without doing anything else with it (native `fs.Readable` streams).
So they are the absolute highest possible.

## Replacing a single Template Variable in a large File

![Throughput vs. File Size when replacing a single Variable](benchmarks/plots/throughput-vs-data-size-with-one-replacement.png)

Like the raw file system stream, a `TemplateReplaceStream` becomes faster with an increasing source
file size. It is more than 20x faster than the `replace-stream` when processing large files. The
throughput of the `TemplateReplaceStream` was more than 20GiB/s when replacing a single variable in
a 100MiB file.

![Duration vs File Size when replacing a single Variable](benchmarks/plots/size-vs-duration-with-one-replacement.png)

Replacing a single variable in a 100MiB file takes only 6ms using a `TemplateReplaceStream`. Reading
the whole file from the disk alone takes already more than 1ms. The `stream-replace-string` packages
was omitted im this graph, as it took over 16s to process the 100MiB file.

## Replacing 10 thousand Template Variables in a large File

![Throughput vs. File Size when replacing a 10K Variables](benchmarks/plots/throughput-vs-data-size-with-10k-replacement.png)

You can see that the performance declines when working with more replacements. Note that one reason
is the virtually generated workload (see "native" in the graph). `TemplateReplaceStream` still
reaches 10GiB/s.

![Duration vs File Size when replacing a 10K Variables](benchmarks/plots/size-vs-duration-with-10k-replacement.png)

To replace ten thousand template variables in a 100MiB file, the `TemplateReplaceStream` takes
around 10ms. Since this duration is similar for smaller file sizes, we can see that it does not
perform too well in the 1MiB file. We will keep optimizing for that.

## Changelog

### 3.0.0

- **Breaking:** the package is now ESM only and requires Node.js `>=22`. CommonJS `require()` is no
  longer supported.
- Add typed errors: every failure is now a `TemplateReplaceStreamError` (or its
  `UnmatchedVariableError` subclass) carrying a stable `code` (`ERR_INVALID_OPTION`,
  `ERR_VARIABLE_NAME_TOO_LONG`, `ERR_UNMATCHED_VARIABLE`, `ERR_INVALID_CHUNK_TYPE`).
  `UnmatchedVariableError` exposes the offending name via `.variableName`
- Fix a deadlock when a `Readable` replacement value larger than the readable buffer was consumed
  slowly
- Fix over-long variable names resolving inconsistently depending on how the input was chunked
- Fix self-overlapping and repeated-prefix start/end patterns being missed
- Fix an empty string (`""`) replacement value being treated as an unmatched template

### 2.2.0

- Add `TemplateReplaceStream.replaceAsync()` that directly returns a `Promise<Buffer>` with the result
- Add `TemplateReplaceStream.replaceStringAsync()` that directly returns a `Promise<string>` with the result
- Drop support for Node.js 16 and 18 (EOL) and add support for 24

### 2.1.2

- Support `async` replacement value functions (`Promise<StringSource>` as return value)
- Add CI to repository
- Update README

### 2.1.1

- Fix stream ending when replacing a template with another stream during the last chunk of data
- Update README

### 2.1.0

- Further improve performance by using `Buffer.indexOf()` to find the end of a template variable,
  too
- Add more benchmarks

### 2.0.0

- Drastically improve performance (by ~10x) by using `Buffer.indexOf()` instead of iterating over
  the buffer myself
- Rename option `throwOnMissingVariable` to `throwOnUnmatchedTemplate`
- Add benchmarks

### 1.0.1

- Update README

### 1.0.0

- Initial Release