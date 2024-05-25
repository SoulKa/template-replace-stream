# template-replace-stream

A high performance `{{ template }}` replace stream working on binary or string streams.

## Install

`npm install template-replace-stream`

## Usage

You create a `TemplateReplaceStream` by passing a source of template variables and their replacement values to the constructor. This may either be a map containing key-value pairs, or a function that returns a replacement value for a given template string.

### JavaScript

```js
const {TemplateReplaceStream} = require("template-replace-stream");
const fs = require("node:fs");
const path = require("node:path");

// create a map of variables to replace. This will replace "{{replace-me}}" with "really fast"
const variables = new Map([["replace-me", "really fast"]]);

// create the streams
const readStream = fs.createReadStream(path.join(__dirname, "template.txt"));
const writeStream = fs.createWriteStream(path.join(__dirname, "example.txt"));
const templateReplaceStream = new TemplateReplaceStream(variables);

// connect the streams and put the template replace stream in the middle
readStream.pipe(templateReplaceStream).pipe(writeStream);
writeStream.on("finish", () => console.log("Finished writing example.txt"));
```

### TypeScript

```ts
import {TemplateReplaceStream} from "template-replace-stream";
import fs from "node:fs";
import path from "node:path";

// create a map of variables to replace. This will replace "{{replace-me}}" with "really fast"
const variables = new Map([["replace-me", "really fast"]]);

// create the streams
const readStream = fs.createReadStream(path.join(__dirname, "template.txt"));
const writeStream = fs.createWriteStream(path.join(__dirname, "example.txt"));
const templateReplaceStream = new TemplateReplaceStream(variables);

// connect the streams and put the template replace stream in the middle
readStream.pipe(templateReplaceStream).pipe(writeStream);
writeStream.on("finish", () => console.log("Finished writing example.txt"));
```

### Advanced

#### Readable Stream as Replacement Value Source
It's also possible to pass another `Readable` as replacement value source to the `TemplateReplaceStream`. In fact, the README you are just reading was created using this feature. This makes it possible to replace template variables with whole files without reading them into a stream before.

<details>
<summary>Advanced Example Code</summary>

```ts
import {TemplateReplaceStream} from "template-replace-stream";
import fs from "fs";
import path from "path";

const dir = path.join(__dirname, "..");
const exampleFiles = ["javascript-example.js", "typescript-example.ts", "create-readme.ts"];

/**
 * Opens a file stream and replaces the import paths in the examples. This is used to
 * have module imports in the README but still local imports in the examples.
 *
 * @param file The file to read.
 */
function openExampleStream(file: string) {
  const replaceStream = new TemplateReplaceStream(
      new Map([
        [`../src`, `"template-replace-stream"`],
        [`../dist`, `"template-replace-stream"`]
      ]),
      {
        startPattern: '"',
        endPattern: '"'
      }
  );
  return fs.createReadStream(file).pipe(replaceStream);
}

// the map of example files and their read streams
const codeExamples = new Map(exampleFiles.map((file) => [file, openExampleStream(file)]));

// create the streams
const readmeReadStream = fs.createReadStream(path.join(dir, "README.template.md"));
const readmeWriteStream = fs.createWriteStream(path.join(dir, "README.md"));

// connect the streams and put the template replace stream in the middle
readmeReadStream.pipe(new TemplateReplaceStream(codeExamples)).pipe(readmeWriteStream);
readmeWriteStream.on("finish", () => console.log("Finished writing README.md"));
```
</details>

### Options

```ts
type TemplateReplaceStreamOptions = {
  /** Default: `false`. If true, the stream creates logs on debug level */
  log: boolean;
  /** Default: `false`. If true, the stream throws an error when a variable is missing */
  throwOnMissingVariable: boolean;
  /** Default: `100`. The maximum length of a variable name including whitespaces around it */
  maxVariableNameLength: number;
  /** Default: `'{{'`. The start pattern of a variable either as string or buffer */
  startPattern: string | Buffer;
  /** Default: `'}}'`. The end pattern of a variable either as string or buffer */
  endPattern: string | Buffer;
  /** The options for the lower level {@link Transform} stream. Do not replace transform or flush */
  streamOptions?: TransformOptions;
}
```