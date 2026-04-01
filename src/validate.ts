import ts from "typescript";

// Relative import path that any atom uses to reference another atom:
// from a/xx/yy/<rest>.ts → ../../<xx>/<yy>/<rest>.ts
const ATOM_IMPORT_RE =
  /^\.\.\/\.\.\/[a-z0-9]{2}\/[a-z0-9]{2}\/[a-z0-9]{21}\.ts$/;

export type ValidationError = { message: string };

export const MAX_TOKENS = 768;

/** Count non-comment, non-whitespace tokens using the TypeScript scanner. */
export function countTokens(source: string): number {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  );
  let count = 0;
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    const kind = scanner.getToken();
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia ||
      kind === ts.SyntaxKind.NewLineTrivia ||
      kind === ts.SyntaxKind.WhitespaceTrivia
    ) continue;
    count++;
  }
  return count;
}

export function validateAtom(
  source: string,
): ValidationError | null {
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

  // Token count check (comments excluded)
  const tokens = countTokens(source);
  if (tokens > MAX_TOKENS) {
    const isTest = isTestAtom(source);

    if (isTest) {
      errors.push(
        `Test atom is ${tokens} tokens; limit is ${MAX_TOKENS}. ` +
          `Comments don't count. Split into smaller atoms instead.`,
      );
    } else {
      errors.push(
        `Atom is ${tokens} tokens; limit is ${MAX_TOKENS}. ` +
          `This probably means you are trying to build too much, even if ` +
          `you've only slightly exceeded the limit. Smaller atoms are ` +
          `better. Split the design at natural boundaries and narrow your ` +
          `scope to only one of the subatoms. Remember: build ONE ` +
          `well-tested value atom only.`,
      );
    }
  }

  return errors.length > 0 ? { message: errors.join("; ") } : null;
}

/** Check if the atom's single value export is a class named Test. */
export function isTestAtom(source: string): boolean {
  const file = ts.createSourceFile(
    "atom.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of file.statements) {
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === "Test" &&
      ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export
    ) {
      return true;
    }
  }
  return false;
}

/** Extract the static name string from a Test class, if present. */
export function extractTestName(source: string): string | null {
  const file = ts.createSourceFile(
    "atom.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of file.statements) {
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === "Test" &&
      ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export
    ) {
      for (const member of node.members) {
        if (
          ts.isPropertyDeclaration(member) &&
          member.name && ts.isIdentifier(member.name) &&
          member.name.text === "name" &&
          ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static &&
          member.initializer && ts.isStringLiteral(member.initializer)
        ) {
          return member.initializer.text;
        }
      }
    }
  }
  return null;
}
