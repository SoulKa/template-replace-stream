import { TemplateReplaceStream } from "../";
import { getDurationFromNow, getSteadyTimestamp } from "../tests/time-util";
import {
  BufferGenerator,
  consumeStream,
  DEFAULT_CHUNK_SIZE,
  FixedLengthReadStream,
  getChunk,
} from "../tests/stream";
import { Readable, Transform } from "node:stream";
import { Benchmark, Framework, FRAMEWORKS, Measurement } from "./types";
import { saveSizeVsDuration, saveThroughputVsDataSize, toMiB } from "./data-processing";

const TEMPLATE_VARIABLE = "t";
const TEMPLATE_STRING = `{{${TEMPLATE_VARIABLE}}}`;

const DATA_SIZES_MiB = [1, 10, 50, 100];
const BYTE_PER_MiB = 1024 * 1024;

async function getReplaceStream(
  framework: Framework,
  sourceStream: Readable,
  replacements: Map<string, string | Readable>
) {
  console.log(
    `Creating replace stream for ${framework} with ${replacements.size} replacements as lookup map...`
  );
  const streamReplaceString = (await import("stream-replace-string")).default;
  const replaceStream = (await import("replacestream")).default;
  switch (framework) {
    case "native":
      return sourceStream.pipe(
        new Transform({ transform: (chunk, encoding, callback) => callback(null, chunk) })
      );
    case "template-replace-stream":
      return sourceStream.pipe(new TemplateReplaceStream(replacements));
    case "stream-replace-string":
      for (const [key, value] of replacements) {
        sourceStream = sourceStream.pipe(streamReplaceString("{{" + key + "}}", value));
      }
      return sourceStream;
    case "replacestream":
      sourceStream = sourceStream.pipe(
        replaceStream(new RegExp(`\\{\\{(.*)}}`), (match, key) => {
          const value = replacements.get(key.trim());
          if (value instanceof Readable)
            throw new Error("ReplaceStream does not support streams as replacement values");
          return value ?? match;
        })
      );
      return sourceStream;
    default:
      throw new Error(`Unknown framework: ${framework}`);
  }
}

async function runBenchmark(benchmark: Benchmark): Promise<Measurement> {
  let replaceStream: Readable;
  if (benchmark.getReplaceStream) {
    replaceStream = benchmark.getReplaceStream(benchmark);
  } else {
    const replacements = new Map(
      [...Array(benchmark.numReplacements).keys()].map((i) => [i.toString(), ""])
    );
    replaceStream = await getReplaceStream(
      benchmark.framework,
      benchmark.sourceStream,
      replacements
    );
  }

  console.log(
    `Running benchmark for ${benchmark.framework} with ${benchmark.sourceDataSize}MiB of source data...`
  );
  const now = getSteadyTimestamp();
  await consumeStream(replaceStream);
  const elapsed = getDurationFromNow(now, "ms");
  console.log(`Elapsed time: ${elapsed}ms`);

  return {
    framework: benchmark.framework,
    duration: elapsed,
    sourceDataSize: benchmark.sourceDataSize,
    replacementDataSize: benchmark.replacementDataSize,
    numReplacements: benchmark.numReplacements,
  };
}

async function forEachSizeAndFramework(
  callback: (sizeMiB: number, framework: Framework) => Promise<void>
) {
  for (const sizeMiB of DATA_SIZES_MiB) {
    let frameworks = FRAMEWORKS.slice();
    //if (sizeMiB > 100) frameworks = ["native", "template-replace-stream", "replacestream"]; // only fast frameworks for large data
    for (const framework of frameworks) {
      await callback(sizeMiB, framework);
    }
  }
}

async function benchmark() {
  const results = new Map<number, Map<Framework, Measurement>>();

  function addResult(measurement: Measurement) {
    const sizeResults =
      results.get(measurement.sourceDataSize) ?? new Map<Framework, Measurement>();
    sizeResults.set(measurement.framework, measurement);
    results.set(measurement.sourceDataSize, sizeResults);
  }

  await forEachSizeAndFramework(async (sizeMiB, framework) => {
    // prepare source stream
    const sizeBytes = sizeMiB * BYTE_PER_MiB;
    const sourceStream = new FixedLengthReadStream(getChunkProvider(1, sizeBytes), sizeBytes);

    // run benchmark
    addResult(
      await runBenchmark({
        framework,
        sourceDataSize: sizeMiB,
        replacementDataSize: 0,
        numReplacements: 1,
        sourceStream,
      })
    );
  });

  saveThroughputVsDataSize(results, "with-one-replacement");
  saveSizeVsDuration(results, "with-one-replacement");

  results.clear();
  await forEachSizeAndFramework(async (sizeMiB, framework) => {
    if (framework === "stream-replace-string") return;

    // prepare source stream
    const sizeBytes = sizeMiB * BYTE_PER_MiB;
    const numReplacements = 10000;
    const sourceStream = new FixedLengthReadStream(
      getChunkProvider(numReplacements, sizeBytes),
      sizeBytes
    );

    // run benchmark
    addResult(
      await runBenchmark({
        framework,
        sourceDataSize: sizeMiB,
        replacementDataSize: 0,
        numReplacements,
        sourceStream,
      })
    );
  });

  saveThroughputVsDataSize(results, "with-10k-replacement");
  saveSizeVsDuration(results, "with-10k-replacement");

  results.clear();
  await forEachSizeAndFramework(async (sizeMiB, framework) => {
    if (framework === "stream-replace-string" && sizeMiB >= 10) return;

    // prepare source stream
    const sizeBytes = sizeMiB * BYTE_PER_MiB;
    const chunkSize = DEFAULT_CHUNK_SIZE;
    const numChunks = Math.ceil(sizeBytes / chunkSize);
    const sourceStream = new FixedLengthReadStream(
      (i) => getChunk(`{{${i}}}`, chunkSize),
      sizeBytes
    );

    // run benchmark
    addResult(
      await runBenchmark({
        framework,
        sourceDataSize: sizeMiB,
        replacementDataSize: 0,
        numReplacements: numChunks,
        sourceStream,
      })
    );
  });

  saveThroughputVsDataSize(results, "with-one-variable-per-chunk");
  saveSizeVsDuration(results, "with-one-variable-per-chunk");
}

benchmark()
  .then(() => console.log("Done"))
  .catch(console.error);

function getChunkProvider(
  numReplacements: number,
  sourceDataSize: number,
  chunkSize = DEFAULT_CHUNK_SIZE
): BufferGenerator {
  let templatesPerChunk = numReplacements / (sourceDataSize / chunkSize);
  console.log(
    `Need ${templatesPerChunk} templates per chunk to replace ${numReplacements} times in ${toMiB(sourceDataSize)}MiB of data.`
  );
  templatesPerChunk = Math.ceil(templatesPerChunk);
  const templateChunk = getChunk(TEMPLATE_STRING.repeat(templatesPerChunk));
  const textChunk = getChunk("");
  let templateCount = 0;

  return () => {
    if (templateCount >= numReplacements) {
      return textChunk;
    } else if (templateCount + templatesPerChunk <= numReplacements) {
      templateCount += templatesPerChunk;
      return templateChunk;
    } else {
      const remaining = numReplacements - templateCount;
      templateCount += remaining;
      return getChunk(TEMPLATE_STRING.repeat(remaining), chunkSize);
    }
  };
}
