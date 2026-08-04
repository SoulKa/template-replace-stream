import { Readable } from "node:stream";
import { TemplateReplaceStream, UnmatchedVariableError } from "template-replace-stream";

// With throwOnUnmatchedTemplate enabled, a variable that has no replacement value fails the
// operation. Every error carries a stable `code` (prefer it over the human-readable message).
function logError(error: unknown) {
  if (error instanceof UnmatchedVariableError) {
    console.error(`Unmatched variable "${error.variableName}" (code: ${error.code})`);
  }
}

// the async helpers reject the returned promise
try {
  await TemplateReplaceStream.replaceStringAsync("Hello {{ name }}", new Map(), {
    throwOnUnmatchedTemplate: true,
  });
} catch (error) {
  logError(error);
}

// used directly as a stream, the same error is emitted on the "error" event instead
Readable.from("Hello {{ name }}")
  .pipe(new TemplateReplaceStream(new Map(), { throwOnUnmatchedTemplate: true }))
  .on("error", logError);
