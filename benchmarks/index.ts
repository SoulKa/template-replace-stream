import {TemplateReplaceStream} from "../src";
import {getDurationFromNow, getSteadyTimestamp} from "../tests/time-util";
import {consumeStream, FixedLengthReadStream, getChunk} from "../tests/stream";
import {Readable} from "node:stream";
import streamReplaceString from "stream-replace-string";

declare type Framework =
    "native"
    | "template-replace-stream"
    | "stream-replace-string"
    | "replace-stream";

declare type Mesaurement = {
  framework: Framework;
  duration: number;
  sourceDataSize: number;
  replacementDataSize: number;
  numReplacements: number;
};

const TEMPLATE_VARIABLE = 't';
const TEMPLATE_STRING = `{{${TEMPLATE_VARIABLE}}`;
const TEMPLATE_REPLACE_MAP = new Map([[TEMPLATE_VARIABLE, '']]);

const DATA_SIZES_MiB = [1, 10, 50, 100];
const BYTE_PER_MiB = 1024 * 1024;

const FRAMEWORKS = ['native', 'template-replace-stream', 'stream-replace-string', 'replace-stream'] as const;

const RESULTS = new Map<Framework, Mesaurement[]>();

function storeResult(framework: Framework, duration: number, sourceDataSize: number, replacementDataSize: number, numReplacements: number) {
  const result = {framework, duration, sourceDataSize, replacementDataSize, numReplacements};
  const results = RESULTS.get(framework) ?? [];
  results.push(result);
  RESULTS.set(framework, results);
}

async function getReplaceStream(framework: Framework, sourceStream: Readable, replacements: Map<string, string | Readable>) {
  const replaceStream = (await import('replacestream')).default;
  switch (framework) {
    case "native":
      return sourceStream;
    case "template-replace-stream":
      return sourceStream.pipe(new TemplateReplaceStream(replacements));
    case "stream-replace-string":
      for (const [key, value] of replacements) {
        sourceStream = sourceStream.pipe(streamReplaceString(key, value));
      }
      return sourceStream;
    case "replace-stream":
      for (const [key, value] of replacements) {
        if (value instanceof Readable) throw new Error('ReplaceStream does not support streams as replacement values');
        sourceStream = sourceStream.pipe(replaceStream(key, value));
      }
      return sourceStream;
    default:
      throw new Error(`Unknown framework: ${framework}`);
  }
}


async function benchmark() {
  for (const sizeMiB of DATA_SIZES_MiB) {
    let frameworks = FRAMEWORKS.slice();
    if (sizeMiB > 100) frameworks = ["native", "template-replace-stream"]; // only fast frameworks for large data
    for (const framework of frameworks) {
      // prepare source stream
      const firstChunk = getChunk(TEMPLATE_STRING);
      const otherChunk = getChunk('');
      const sourceStream = new FixedLengthReadStream(
          i => i === 0 ? firstChunk : otherChunk,
          sizeMiB * BYTE_PER_MiB
      );

      // run benchmark
      console.log(`Running benchmark for ${framework} with ${sizeMiB}MiB of source data...`);
      const now = getSteadyTimestamp();
      await consumeStream(await getReplaceStream(framework, sourceStream, TEMPLATE_REPLACE_MAP));
      const elapsed = getDurationFromNow(now, "ms");
      console.log(`Elapsed time: ${elapsed}ms`);

      // store result
      storeResult(framework, elapsed, sizeMiB, 0, 1);
    }
  }

  console.log('Results:', RESULTS);
}

benchmark().then(() => console.log('Done')).catch(console.error);