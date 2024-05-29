import {StringSource, TemplateReplaceStream} from "template-replace-stream";
import fs from "node:fs";
import path from "node:path";
import sloc from "sloc";
import {Project, ts} from "ts-morph";

const rootDir = path.join(__dirname, "..");
const exampleFiles = ["javascript-example.js", "typescript-example.ts", "generate-readme.ts"];

const outputFilePath = path.join(rootDir, "README.md");
const sourceFilePath = path.join(rootDir, "index.ts");
const codeInfo = sloc(fs.readFileSync(sourceFilePath, "utf8"), "ts");
const loc = codeInfo.total - codeInfo.comment - codeInfo.empty;
const optionsDefinition = extractTypeDefinition("TemplateReplaceStreamOptions", sourceFilePath);

// the map of example files and their read streams and further template variables
const templateMap = new Map<string, StringSource>(exampleFiles.map((file) => [file, openExampleStream(file)]));
templateMap.set("loc", loc.toString());
templateMap.set("options-definition", optionsDefinition);

// create the streams
const readmeReadStream = fs.createReadStream(path.join(rootDir, "template.md"));
const readmeWriteStream = fs.createWriteStream(outputFilePath);

// connect the streams and put the template replace stream in the middle
readmeReadStream.pipe(new TemplateReplaceStream(templateMap)).pipe(readmeWriteStream);
readmeWriteStream.on("finish", () => console.log(`Created ${outputFilePath}`));

/**
 * Opens a file stream to the given source file.
 *
 * @param file The file to read.
 */
function openExampleStream(file: string) {
  return fs.createReadStream(path.join(__dirname, file));
}

/**
 * Extracts the type definition from the given source file.
 *
 * @param typeName The name of the type to extract.
 * @param filePath The full path to the source file.
 */
function extractTypeDefinition(typeName: string, filePath: string) {
  const sourceFile = new Project().addSourceFileAtPath(filePath);
  const typeNode = sourceFile.getTypeAlias(typeName)?.compilerNode;
  if (!typeNode) throw new Error(`Type alias ${typeName} not found.`);
  const printer = ts.createPrinter({removeComments: false});
  return printer.printNode(ts.EmitHint.Unspecified, typeNode, sourceFile.compilerNode);
}