import {StringSource, TemplateReplaceStream} from "../src";
import fs from "fs";
import path from "path";
import sloc from "sloc"

const rootDir = path.join(__dirname, "..");
const exampleFiles = ["javascript-example.js", "typescript-example.ts", "create-readme.ts"];

const loc = sloc(fs.readFileSync(path.join(rootDir, "src", "template-replace-stream.ts"), "utf8"), "ts").total;

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
  return fs.createReadStream(path.join(__dirname, file)).pipe(replaceStream);
}

// the map of example files and their read streams and further template variables
const templateMap = new Map<string, StringSource>(exampleFiles.map((file) => [file, openExampleStream(file)]));
templateMap.set("loc", loc.toString());

// create the streams
const readmeReadStream = fs.createReadStream(path.join(rootDir, "README.template.md"));
const readmeWriteStream = fs.createWriteStream(path.join(rootDir, "README.md"));

// connect the streams and put the template replace stream in the middle
readmeReadStream.pipe(new TemplateReplaceStream(templateMap)).pipe(readmeWriteStream);
readmeWriteStream.on("finish", () => console.log("Finished writing README.md"));