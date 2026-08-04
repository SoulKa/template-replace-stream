import { TemplateReplaceStream } from "template-replace-stream";
import fs from "node:fs";
import path from "node:path";

// template.txt contains the text: Hello, this library is {{ replace-me }} :)
const templateFilePath = path.join(import.meta.dirname, "template.txt");
const outputFilePath = path.join(import.meta.dirname, "example.txt");

// map template variable names to their replacement values:
// every "{{ replace-me }}" in the template becomes "really fast"
const variables = new Map([["replace-me", "really fast"]]);

// read the template, replace the variables while streaming, and write the result
fs.createReadStream(templateFilePath)
  .pipe(new TemplateReplaceStream(variables))
  .pipe(fs.createWriteStream(outputFilePath))
  .on("finish", () => console.log(`Wrote "Hello, this library is really fast :)" to example.txt`));
