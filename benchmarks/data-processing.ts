import {Framework, Mesaurement} from "./types";
import fs from "node:fs";
import path from "path";

const plotDir = path.join(__dirname, "plots");
if (!fs.existsSync(plotDir)) {
  fs.mkdirSync(plotDir);
}

/**
 * Calculate throughput in MiB/s
 * @param dataSize The size of the data in MiB
 * @param duration The duration in milliseconds
 */
function toThroughput(dataSize: number, duration: number) {
  return dataSize / (duration / 1e3);
}

function writeDataToCsv(name: string, lines: string[][]) {
  const writeStream = fs.createWriteStream(path.join(plotDir, name + ".csv"));
  for (const line of lines) {
    writeStream.write(line.join(",") + "\n");
  }
  writeStream.end();
}

function getSizes(measurements: Map<Framework, Mesaurement[]>) {
  const sizes = new Set<number>();
  for (const [, benchmark] of measurements) {
    for (const {sourceDataSize} of benchmark) {
      sizes.add(sourceDataSize);
    }
  }
  return [...sizes].sort((a, b) => a - b);

}

export function saveThroughputVsDataSize(measurements: Map<Framework, Mesaurement[]>) {
  const sizes = getSizes(measurements);
  const lines = [] as string[][];
  lines.push(["size-in-mib", ...measurements.keys()]);

  for (const size of sizes) {
    const line = [size.toString()];
    for (const [, benchmark] of measurements) {
      const measurement = benchmark.find(m => m.sourceDataSize === size);
      if (measurement) {
        line.push(toThroughput(measurement.sourceDataSize, measurement.duration).toString());
      } else {
        line.push("");
      }
    }
    lines.push(line);
  }

  writeDataToCsv("throughput-vs-data-size", lines);
}