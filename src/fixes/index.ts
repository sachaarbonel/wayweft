import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import type { FixPlan, FixResult, Finding, TextEdit } from "../types.js";

export function applySafeFixes(findings: Finding[], apply: boolean): FixResult {
  const safeFindings = findings.filter((finding) => finding.fix?.safe);
  const plans = buildFixPlans(safeFindings);

  if (apply) {
    for (const plan of plans) {
      applyPlan(plan);
    }
  }

  return {
    applied: apply,
    plans,
    preview: renderPreview(plans),
  };
}

export function buildFixPlans(findings: Finding[]): FixPlan[] {
  const files = [...new Set(findings.map((finding) => finding.filePath))];
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
    },
  });
  files.forEach((filePath) => project.addSourceFileAtPathIfExists(filePath));

  const plans: FixPlan[] = [];
  for (const filePath of files) {
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
      continue;
    }

    const edits: TextEdit[] = [];
    for (const ifStatement of sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement)) {
      const elseStatement = ifStatement.getElseStatement();
      if (!elseStatement) {
        continue;
      }
      const thenText = ifStatement.getThenStatement().getText().replace(/\s+/g, " ").trim();
      const elseText = elseStatement.getText().replace(/\s+/g, " ").trim();
      if (thenText === "{ return true; }" && elseText === "{ return false; }") {
        edits.push({
          filePath,
          start: ifStatement.getStart(),
          end: ifStatement.getEnd(),
          newText: `return ${ifStatement.getExpression().getText()};`,
        });
      }
    }

    for (const conditional of sourceFile.getDescendantsOfKind(SyntaxKind.ConditionalExpression)) {
      const conditionText = conditional.getCondition().getText();
      const whenTrue = conditional.getWhenTrue().getText();
      const whenFalse = conditional.getWhenFalse().getText();
      const nullishMatch = conditionText.match(/^(.+?)\s*===\s*null\s*\|\|\s*\1\s*===\s*undefined$/);
      if (nullishMatch && whenFalse === nullishMatch[1].trim()) {
        edits.push({
          filePath,
          start: conditional.getStart(),
          end: conditional.getEnd(),
          newText: `${whenFalse} ?? ${whenTrue}`,
        });
      }

      const optionalChainMatch = conditionText.match(/^(.+?)\s*==\s*null$/);
      if (optionalChainMatch && whenTrue === "undefined") {
        const receiver = optionalChainMatch[1].trim();
        if (whenFalse.startsWith(`${receiver}.`)) {
          edits.push({
            filePath,
            start: conditional.getStart(),
            end: conditional.getEnd(),
            newText: `${receiver}?.${whenFalse.slice(receiver.length + 1)}`,
          });
        }
      }
    }

    if (edits.length > 0) {
      plans.push({
        ruleId: "safe-rewrites",
        edits,
      });
    }
  }

  return plans;
}

function applyPlan(plan: FixPlan): void {
  const fileGroups = new Map<string, TextEdit[]>();
  for (const edit of plan.edits) {
    const entries = fileGroups.get(edit.filePath) ?? [];
    entries.push(edit);
    fileGroups.set(edit.filePath, entries);
  }

  for (const [filePath, edits] of fileGroups.entries()) {
    const original = readFileSync(filePath, "utf8");
    const updated = applyEdits(original, edits);
    writeFileSync(filePath, updated, "utf8");
  }
}

function applyEdits(content: string, edits: TextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((current, edit) => current.slice(0, edit.start) + edit.newText + current.slice(edit.end), content);
}

function renderPreview(plans: FixPlan[]): string {
  if (plans.length === 0) {
    return "No safe fixes available for the selected findings.";
  }
  return plans
    .map((plan) => `${plan.ruleId}: ${plan.edits.length} edits across ${new Set(plan.edits.map((edit) => path.dirname(edit.filePath))).size} dirs`)
    .join("\n");
}
