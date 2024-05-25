import {TemplateReplaceStream} from "../src";
import fs from "fs";
import path from "path";

const dir = path.join(__dirname, "..");
const exampleFiles = ["javascript-example.js", "typescript-example.ts"];

// create a map of variables to replace in the templates
const codeExamples = new Map(exampleFiles.map((file) => [file, fs.readFileSync(file)]));
const importReplacer = new Map([["../src", "stream-template-replacer"], ["../dist", "stream-template-replacer"]]);

// create the streams
const readStream = fs.createReadStream(path.join(dir, "README.template.md"));
const writeStream = fs.createWriteStream(path.join(dir, "README.md"));

// connect the streams and put the template replace stream in the middle
readStream.pipe(new TemplateReplaceStream(codeExamples)).pipe(new TemplateReplaceStream(importReplacer)).pipe(writeStream);
writeStream.on("finish", () => console.log("Finished writing README.md"));