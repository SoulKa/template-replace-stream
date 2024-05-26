export type Framework =
    "native"
    | "template-replace-stream"
    | "stream-replace-string"
    | "replace-stream";

export type Mesaurement = {
  framework: Framework;
  duration: number;
  sourceDataSize: number;
  replacementDataSize: number;
  numReplacements: number;
};