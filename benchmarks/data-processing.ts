import { Framework, FRAMEWORKS, Measurement } from "./types";
import fs from "node:fs";
import path from "path";

const plotDir = path.join(__dirname, "plots");
if (!fs.existsSync(plotDir)) {
  fs.mkdirSync(plotDir);
}

declare type Line = (string | number)[];

function getLines(firstHeader: string) {
  return [[firstHeader, ...FRAMEWORKS]] as Line[];
}

export function toMiB(bytes: number) {
  return bytes / (1024 * 1024);
}

/**
 * Calculate throughput in GiB/s
 * @param dataSize The size of the data in MiB
 * @param duration The duration in milliseconds
 */
function toThroughput(dataSize: number, duration: number) {
  return dataSize / (duration / 1e3);
}

function writeDataToCsv(name: string, lines: Line[]) {
  const writeStream = fs.createWriteStream(path.join(plotDir, name + ".csv"));
  for (const line of lines) {
    writeStream.write(line.join(",") + "\n");
  }
  writeStream.end();
}

export function saveThroughputVsDataSize(
  results: Map<number, Map<Framework, Measurement>>,
  name: string
) {
  const lines = getLines("size-in-mib");

  for (const [size, frameworks] of results) {
    const line = [size] as Line;
    for (const framework of FRAMEWORKS) {
      const measurement = frameworks.get(framework);
      if (measurement) {
        line.push(toThroughput(measurement.sourceDataSize, measurement.duration));
      } else {
        line.push("");
      }
    }
    lines.push(line);
  }

  writeDataToCsv("throughput-vs-data-size-" + name, lines);
}

export function saveSizeVsDuration(
  results: Map<number, Map<Framework, Measurement>>,
  name: string
) {
  const lines = getLines("size-in-mib");

  for (const [size, frameworks] of results) {
    const line = [size] as Line;
    for (const framework of FRAMEWORKS) {
      const measurement = frameworks.get(framework);
      if (measurement) {
        line.push(measurement.duration);
      } else {
        line.push("");
      }
    }
    lines.push(line);
  }

  writeDataToCsv("size-vs-duration-" + name, lines);
}
