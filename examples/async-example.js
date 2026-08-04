import { TemplateReplaceStream } from "template-replace-stream";

const template = "Hello, this library is {{ replace-me }} :)";
const variables = new Map([["replace-me", "really fast"]]);

// resolves to a string; the input may be a string, Buffer, or Readable
console.log(await TemplateReplaceStream.replaceStringAsync(template, variables));

// same, but resolves to a Buffer (e.g. for binary templates)
const buffer = await TemplateReplaceStream.replaceAsync(template, variables);
console.log(buffer.toString());
