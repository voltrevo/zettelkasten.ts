import ts from "typescript";
import { minify } from "./minify.ts";

// Relative import path that any atom uses to reference another atom:
// from a/xx/yy/<rest>.ts → ../../<xx>/<yy>/<rest>.ts
const ATOM_IMPORT_RE =
  /^\.\.\/\.\.\/[a-z0-9]{2}\/[a-z0-9]{2}\/[a-z0-9]{21}\.ts$/;

export type ValidationError = { message: string };

export const MAX_GZIP_BYTES = 768;

async function gzipSize(text: string): Promise<number> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(text));
  writer.close();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream.readable as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return chunks.reduce((n, c) => n + c.length, 0);
}

export async function validateAtom(
  source: string,
): Promise<ValidationError | null> {
  const file = ts.createSourceFile(
    "atom.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const errors: string[] = [];

  let exportCount = 0;

  for (const node of file.statements) {
    // Check imports
    if (ts.isImportDeclaration(node)) {
      const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
      if (!ATOM_IMPORT_RE.test(specifier)) {
        errors.push(
          `invalid import "${specifier}": imports must be relative atom paths (../../xx/yy/<21chars>.ts)`,
        );
      }
    }

    // Count and validate exports — type-only exports (type, interface) are
    // allowed in any number; only value exports are restricted to exactly one.
    if (ts.isExportAssignment(node)) {
      // export default — always a value export
      exportCount++;
    } else if (ts.isExportDeclaration(node)) {
      // export { ... } or export type { ... }
      if (!node.isTypeOnly) exportCount++;
    } else if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node)
    ) {
      // type-only declarations — do not count toward value export limit
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      const mods = ts.getCombinedModifierFlags(node as ts.Declaration);
      if (mods & ts.ModifierFlags.Export) exportCount++;
    } else if (ts.isVariableStatement(node)) {
      const mods = ts.getCombinedModifierFlags(
        node as unknown as ts.Declaration,
      );
      if (mods & ts.ModifierFlags.Export) {
        exportCount++;
        // Reject exported let (mutable)
        if (node.declarationList.flags & ts.NodeFlags.Let) {
          errors.push("exported let is not allowed: use const");
        }
      }
    }
  }

  if (exportCount === 0) {
    errors.push("atom must export exactly one symbol (none found)");
  }
  if (exportCount > 1) {
    errors.push(`atom must export exactly one symbol (found ${exportCount})`);
  }

  // Size check on minified+gzipped source
  const size = await gzipSize(minify(source));
  if (size > MAX_GZIP_BYTES) {
    errors.push(
      `atom too large: ${size} bytes gzipped (max ${MAX_GZIP_BYTES})`,
    );
  }

  return errors.length > 0 ? { message: errors.join("; ") } : null;
}
