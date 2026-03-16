// Heuristic minifier: strips comments and collapses whitespace while preserving
// TypeScript syntax and literal contents. Not a correctness-preserving transform —
// intended only for size estimation (gzip budget enforcement).
import ts from "typescript";

// Returns true for nodes whose source text must be preserved verbatim
// (string/template spans/regex — whitespace inside is significant).
function isLiteralNode(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateHead:
    case ts.SyntaxKind.TemplateMiddle:
    case ts.SyntaxKind.TemplateTail:
      return true;
    default:
      return false;
  }
}

// Strip comments via TS printer, then collapse inter-token whitespace while
// preserving the exact text of all literal spans (strings, templates, regex).
export function minify(source: string): string {
  // Step 1: strip comments
  const file1 = ts.createSourceFile(
    "atom.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const printer = ts.createPrinter({ removeComments: true });
  const printed = printer.printFile(file1);

  // Step 2: collect literal spans from the re-parsed printed output
  const file2 = ts.createSourceFile(
    "atom.ts",
    printed,
    ts.ScriptTarget.Latest,
    true,
  );
  const literalSpans: [number, number][] = [];

  function collect(node: ts.Node) {
    if (isLiteralNode(node)) {
      literalSpans.push([node.getStart(file2, false), node.getEnd()]);
    }
    ts.forEachChild(node, collect);
  }
  collect(file2);
  literalSpans.sort((a, b) => a[0] - b[0]);

  // Step 3: walk the printed text, copy literal spans verbatim, collapse whitespace elsewhere
  let result = "";
  let i = 0;
  let spanIdx = 0;

  while (i < printed.length) {
    if (spanIdx < literalSpans.length && i === literalSpans[spanIdx][0]) {
      result += printed.slice(
        literalSpans[spanIdx][0],
        literalSpans[spanIdx][1],
      );
      i = literalSpans[spanIdx][1];
      spanIdx++;
      continue;
    }
    const ch = printed[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (result.length > 0 && result[result.length - 1] !== " ") result += " ";
      while (i < printed.length && /\s/.test(printed[i])) i++;
    } else {
      result += ch;
      i++;
    }
  }

  return result.trim();
}
