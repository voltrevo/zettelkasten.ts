import ts from "typescript";

// Relative import path that any atom uses to reference another atom:
// from a/xx/yy/<rest>.ts → ../../<xx>/<yy>/<rest>.ts
const ATOM_IMPORT_RE = /^\.\.\/\.\.\/[a-z0-9]{2}\/[a-z0-9]{2}\/[a-z0-9]{21}\.ts$/;

export interface ValidationError {
  message: string;
}

export function validateAtom(source: string): ValidationError | null {
  const file = ts.createSourceFile("atom.ts", source, ts.ScriptTarget.Latest, true);

  const errors: string[] = [];

  let exportCount = 0;

  for (const node of file.statements) {
    // Check imports
    if (ts.isImportDeclaration(node)) {
      const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
      if (!ATOM_IMPORT_RE.test(specifier)) {
        errors.push(`invalid import "${specifier}": imports must be relative atom paths (../../xx/yy/<21chars>.ts)`);
      }
    }

    // Count and validate exports
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      exportCount++;
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      const mods = ts.getCombinedModifierFlags(node as ts.Declaration);
      if (mods & ts.ModifierFlags.Export) exportCount++;
    } else if (ts.isVariableStatement(node)) {
      const mods = ts.getCombinedModifierFlags(node);
      if (mods & ts.ModifierFlags.Export) {
        exportCount++;
        // Reject exported let (mutable)
        if (node.declarationList.flags & ts.NodeFlags.Let) {
          errors.push("exported let is not allowed: use const");
        }
      }
    }
  }

  if (exportCount === 0) errors.push("atom must export exactly one symbol (none found)");
  if (exportCount > 1) errors.push(`atom must export exactly one symbol (found ${exportCount})`);

  return errors.length > 0 ? { message: errors.join("; ") } : null;
}