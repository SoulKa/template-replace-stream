import {describe, it} from "@jest/globals";
import {TemplateReplaceStream} from "../src";
import {getDurationFromNow, getSteadyTimestamp} from "./time-util";
import {FixedChunkSizeReadStream, FixedLengthReadStream, getChunk} from "./stream";

const TEMPLATE_VARIABLE = 't';
const TEMPLATE_STRING = `{{${TEMPLATE_VARIABLE}}`;

const DATA_SIZES_MiB = [1, 10, 50, 100, 500];
const BYTE_PER_MiB = 1024 * 1024;

describe('Benchmark', () => {
  it.each(DATA_SIZES_MiB)('runs a benchmark without any replacements on %pMiB data', async (sizeMib) => {
    // Arrange
    const sourceStream = new FixedLengthReadStream(getChunk(''), sizeMib * BYTE_PER_MiB);
    const replaceStream = new TemplateReplaceStream(new Map());

    // Act
    console.log(`Consuming data...`);
    const now = getSteadyTimestamp();
    sourceStream.pipe(replaceStream).resume();
    await new Promise<void>(resolve => replaceStream.on('end', resolve));
    const elapsed = getDurationFromNow(now, "ms");

    console.log(`Elapsed time: ${elapsed}ms`);
  });

  it.each(DATA_SIZES_MiB)('runs a benchmark with 10 thousand replacements on %pMB data', async (sizeMib) => {
    // Arrange
    const sourceStream = new FixedLengthReadStream(getChunk(TEMPLATE_STRING), sizeMib * BYTE_PER_MiB);
    const replaceStream = new TemplateReplaceStream(new Map([[TEMPLATE_VARIABLE, '']]));

    // Act
    console.log(`Consuming data...`);
    const now = getSteadyTimestamp();
    sourceStream.pipe(replaceStream).resume();
    await new Promise<void>(resolve => replaceStream.on('end', resolve));
    const elapsed = getDurationFromNow(now, "ms");

    console.log(`Elapsed time: ${elapsed}ms`);
  });

  it.each(DATA_SIZES_MiB)('should replace a small string by %pMB stream content', async (sizeMib) => {
    // Arrange
    const sourceStream = new FixedChunkSizeReadStream(getChunk(TEMPLATE_STRING));
    const valueStream = new FixedLengthReadStream(getChunk(''), sizeMib * BYTE_PER_MiB);
    const replaceStream = new TemplateReplaceStream(new Map([[TEMPLATE_VARIABLE, valueStream]]));

    // Act
    console.log(`Consuming data...`);
    const now = getSteadyTimestamp();
    await new Promise<void>(resolve => sourceStream.pipe(replaceStream).resume().on('end', resolve));
    const elapsed = getDurationFromNow(now, "ms");

    console.log(`Elapsed time: ${elapsed}ms`);
  });
});