const {TemplateReplaceStream} = require("template-replace-stream");
const fs = require("node:fs");
const path = require("node:path");

// create a map of variables to replace. This will replace "{{replace-me}}" with "really fast"
const variables = new Map([["replace-me", "really fast"]]);

// create the streams
const readStream = fs.createReadStream(path.join(__dirname, "template.txt"));
const writeStream = fs.createWriteStream(path.join(__dirname, "example.txt"));
const templateReplaceStream = new TemplateReplaceStream(variables);

// connect the streams and put the template replace stream in the middle
readStream.pipe(templateReplaceStream).pipe(writeStream);
writeStream.on("finish", () => console.log("Finished writing example.txt"));