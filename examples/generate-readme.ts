import {StringSource, TemplateReplaceStream} from "template-replace-stream";
import fs from "node:fs";
import path from "node:path";
import sloc from "sloc";

const rootDir = path.join(__dirname, "..");
const exampleFiles = ["javascript-example.js", "typescript-example.ts", "generate-readme.ts"];

const codeInfo = sloc(fs.readFileSync(path.join(rootDir, "index.ts"), "utf8"), "ts");
const loc = codeInfo.total - codeInfo.comment - codeInfo.empty;

/**
 * Opens a file stream to the given source file.
 *
 * @param file The file to read.
 */
function openExampleStream(file: string) {
  return fs.createReadStream(path.join(__dirname, file));
}

// the map of example files and their read streams and further template variables
const templateMap = new Map<string, StringSource>(exampleFiles.map((file) => [file, openExampleStream(file)]));
templateMap.set("loc", loc.toString());

// create the streams
const readmeReadStream = fs.createReadStream(path.join(rootDir, "template.md"));
const readmeWriteStream = fs.createWriteStream(path.join(rootDir, "README.md"));

// connect the streams and put the template replace stream in the middle
readmeReadStream.pipe(new TemplateReplaceStream(templateMap)).pipe(readmeWriteStream);
readmeWriteStream.on("finish", () => console.log("Finished writing README.md"));