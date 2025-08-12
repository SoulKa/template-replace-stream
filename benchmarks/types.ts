import { Readable } from "node:stream";

export type Framework =
  | "native"
  | "template-replace-stream"
  | "stream-replace-string"
  | "replacestream";

export const FRAMEWORKS = [
  "native",
  "template-replace-stream",
  "stream-replace-string",
  "replacestream",
] as Framework[];

export type Measurement = {
  framework: Framework;
  /** In ms */
  duration: number;
  /** In MiB */
  sourceDataSize: number;
  /** In MiB */
  replacementDataSize: number;
  numReplacements: number;
};

export type ReadableGenerator = (framework: Framework, sizeMiB: number) => Readable;

export type Benchmark = {
  framework: Framework;
  /** In MiB */
  sourceDataSize: number;
  /** In MiB */
  replacementDataSize: number;
  numReplacements: number;
  sourceStream: Readable;
  getReplaceStream?: (benchmark: Benchmark) => Readable;
};
