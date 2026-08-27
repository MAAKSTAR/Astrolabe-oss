/**
 * MotionCompiler.ts — Extension Host Orchestrator for Astrolabe Motion Studio
 *
 * Coordinates state capture, worker thread execution, WorkspaceEdit application, and formatting.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { processMotionCompile, WorkerResponse } from './MotionWorker';

import { MotionOnboarding } from './MotionOnboarding';
import { IBrainCoordinator } from '../types/shared';

export class MotionCompiler {
  private static instance: MotionCompiler;

  public static getInstance(): MotionCompiler {
    if (!MotionCompiler.instance) {
      MotionCompiler.instance = new MotionCompiler();
    }
    return MotionCompiler.instance;
  }

  /**
   * Compiles Theatre.js JSON state and applies the generated GSAP/R3F code to the target file.
   */
  public async compileAndApply(targetUri?: vscode.Uri, rawTheatreJson?: any, brainCoordinator?: IBrainCoordinator): Promise<boolean> {
    try {
      // 1. Run Onboarding & Brain AST Indexer Inspection
      const onboardingStatus = await MotionOnboarding.inspectWorkspace(brainCoordinator);
      
      let effectiveUri = targetUri;
      if (!effectiveUri || !onboardingStatus.isReady) {
        const resolvedUri = await MotionOnboarding.runOnboardingFlow(onboardingStatus);
        if (resolvedUri) {
          effectiveUri = resolvedUri;
        } else if (!effectiveUri) {
          vscode.window.showErrorMessage('Astrolabe Motion Studio: No target 3D Scene file available.');
          return false;
        }
      }

      const document = await vscode.workspace.openTextDocument(effectiveUri);
      const fileContent = document.getText();

      // Process compilation (worker thread or inline execution)
      const result: WorkerResponse = processMotionCompile({
        targetFilePath: effectiveUri.fsPath,
        fileContent,
        rawTheatreJson: rawTheatreJson || {}
      });

      if (!result.success || !result.newText) {
        vscode.window.showErrorMessage(`Astrolabe Motion Studio Compile Error: ${result.error}`);
        return false;
      }

      // Check non-destructive recompile safety policy (Component F)
      if (result.hasManualEdits) {
        const choice = await vscode.window.showWarningMessage(
          `Astrolabe Motion Studio: Manual edits detected in existing scene code. Do you want to replace it with the new compiled motion?`,
          { modal: true },
          'Replace Code',
          'Cancel'
        );

        if (choice !== 'Replace Code') {
          vscode.window.showInformationMessage('Motion compilation cancelled to preserve manual edits.');
          return false;
        }
      }

      // Component G — Apply WorkspaceEdit
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(fileContent.length)
      );

      edit.replace(effectiveUri!, fullRange, result.newText);
      const applied = await vscode.workspace.applyEdit(edit);

      if (!applied) {
        vscode.window.showErrorMessage('Failed to apply Motion Studio edits to workspace.');
        return false;
      }

      // Component H — Format inserted range
      const editor = await vscode.window.showTextDocument(effectiveUri!);
      await editor.document.save();
      await vscode.commands.executeCommand('editor.action.formatDocument');

      vscode.window.showInformationMessage('✨ Astrolabe Motion Studio: Successfully compiled motion to code!');
      return true;

    } catch (err: any) {
      vscode.window.showErrorMessage(`Astrolabe Motion Studio Error: ${err.message || err}`);
      return false;
    }
  }

  public async compileCssAndApply(targetFilePath: string, lineStr: string, styles: Record<string, string>): Promise<boolean> {
    try {
      const lineNum = parseInt(lineStr, 10); // 1-indexed for ts-morph
      const targetUri = vscode.Uri.file(targetFilePath);
      const document = await vscode.workspace.openTextDocument(targetUri);
      const fileContent = document.getText();
      
      const { Project, SyntaxKind } = require('ts-morph');
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(targetFilePath, fileContent);
      
      const validStyles = Object.entries(styles).filter(([_, v]) => v !== undefined && v !== null && v !== '');
      if (validStyles.length === 0) return true;

      const jsxElements = [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
      ];
      
      const targetElement = jsxElements.find((node: any) => node.getStartLineNumber() === lineNum);
      
      if (!targetElement) {
         vscode.window.showErrorMessage('Astrolabe Motion Studio: Could not find JSX tag on line ' + lineNum);
         return false;
      }
      
      const styleAttr = targetElement.getAttribute('style');
      let newStylesObj: Record<string, string> = {};
      
      if (styleAttr && styleAttr.getKind() === SyntaxKind.JsxAttribute) {
        const initializer = styleAttr.getInitializer();
        if (initializer && initializer.getKind() === SyntaxKind.JsxExpression) {
            const expr = initializer.getExpression();
            if (expr && expr.getKind() === SyntaxKind.ObjectLiteralExpression) {
                expr.getProperties().forEach((prop: any) => {
                    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
                        const name = prop.getName();
                        let val = prop.getInitializer()?.getText() || '';
                        if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
                            val = val.substring(1, val.length - 1);
                        }
                        newStylesObj[name] = val;
                    }
                });
            }
        }
        styleAttr.remove();
      }
      
      validStyles.forEach(([k, v]) => {
          newStylesObj[k] = v;
      });
      
      const styleEntriesStr = Object.entries(newStylesObj).map(([k, v]) => `${k}: '${v}'`).join(', ');
      
      targetElement.addAttribute({
          name: 'style',
          initializer: `{{ ${styleEntriesStr} }}`
      });
      
      const newText = sourceFile.getFullText();

      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(fileContent.length)
      );
      edit.replace(targetUri, fullRange, newText);
      
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        await document.save();
        const editor = await vscode.window.showTextDocument(targetUri);
        await vscode.commands.executeCommand('editor.action.formatDocument');
        return true;
      }
      return false;
    } catch (e: any) {
      vscode.window.showErrorMessage(`Astrolabe Motion Studio Compile CSS Error: ${e.message}`);
      return false;
    }
  }
}
