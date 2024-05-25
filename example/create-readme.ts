import {TemplateReplaceStream} from "../src";
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