# template-replace-stream

A high performance `{{ template }}` replace stream working on binary or string streams.

This module is written in pure TypeScript, consists of only {{loc}} lines of code and has no other dependencies.

## Install

`npm install template-replace-stream`

This module can be imported via `require()` or `import` in JavaScript

## Usage

You create a `TemplateReplaceStream` by passing a source of template variables and their replacement values to the constructor. This may either be a map containing key-value pairs, or a function that returns a replacement value for a given template string.

### JavaScript

```js
{{ javascript-example.js }}
```

### TypeScript

```ts
{{ typescript-example.ts }}
```

### Advanced

#### Readable Stream as Replacement Value Source
It's also possible to pass another `Readable` as replacement value source to the `TemplateReplaceStream`. In fact, the README you are just reading was created using this feature. This makes it possible to replace template variables with whole files without reading them into a stream before.

<details>
<summary>Advanced Example Code</summary>

```ts
{{ create-readme.ts }}
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

## Benchmarks

> Coming soon