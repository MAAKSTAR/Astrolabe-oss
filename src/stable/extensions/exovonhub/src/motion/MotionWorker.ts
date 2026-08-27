/**
 * MotionWorker.ts — Worker Thread Entry Point for Motion Compiler
 *
 * Runs ts-morph AST generation in a worker thread to keep the VS Code UI responsive.
 */

import { parentPort, isMainThread } from 'worker_threads';
import { parseTheatreJsonToMotionIR } from './MotionIR';
import { analyzeInsertionStrategy } from './InsertionResolver';
import { emitMotionCode } from './MotionEmitter';
import { verifyRecompileSafety } from './RecompilePolicy';

export interface WorkerRequest {
  targetFilePath: string;
  fileContent: string;
  rawTheatreJson: any;
}

export interface WorkerResponse {
  success: boolean;
  filePath?: string;
  newText?: string;
  generatedBlock?: string;
  hasManualEdits?: boolean;
  existingContent?: string;
  error?: string;
}

export function processMotionCompile(request: WorkerRequest): WorkerResponse {
  try {
    const ir = parseTheatreJsonToMotionIR(request.rawTheatreJson);
    
    const { Project } = require('ts-morph');
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(request.targetFilePath, request.fileContent);

    const strategy = analyzeInsertionStrategy(sourceFile, ir);
    const emitResult = emitMotionCode(request.targetFilePath, request.fileContent, ir, strategy);

    let existingBlockText: string | undefined;
    if (strategy.existingSceneBlockRange) {
      existingBlockText = request.fileContent.substring(
        strategy.existingSceneBlockRange.start,
        strategy.existingSceneBlockRange.end
      );
    }

    const safetyCheck = verifyRecompileSafety(existingBlockText, emitResult.generatedBlock);

    return {
      success: true,
      filePath: emitResult.filePath,
      newText: emitResult.newText,
      generatedBlock: emitResult.generatedBlock,
      hasManualEdits: safetyCheck.hasManualEdits,
      existingContent: safetyCheck.existingContent
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

if (!isMainThread && parentPort) {
  parentPort.on('message', (request: WorkerRequest) => {
    const response = processMotionCompile(request);
    parentPort!.postMessage(response);
  });
}
