import { TemplateReplaceStream, type StringSource } from "template-replace-stream";
import fs from "node:fs";
import path from "node:path";

// template.txt contains the text: Hello, this library is {{ replace-me }} :)
const templateFilePath = path.join(import.meta.dirname, "template.txt");
const outputFilePath = path.join(import.meta.dirname, "example.txt");

// instead of a Map, a resolver function computes a replacement value per variable name.
// It receives each name found in the template and may return a string, Buffer, Readable, or a
// Promise of those (the StringSource type). Return undefined to leave a variable unmatched.
function resolveVariable(variableName: string): StringSource {
  console.log(`Resolving variable "${variableName}"`);
  return "really fast";
}

// read the template, replace the variables while streaming, and write the result
fs.createReadStream(templateFilePath)
  .pipe(new TemplateReplaceStream(resolveVariable))
  .pipe(fs.createWriteStream(outputFilePath))
  .on("finish", () => console.log(`Wrote "Hello, this library is really fast :)" to example.txt`));
