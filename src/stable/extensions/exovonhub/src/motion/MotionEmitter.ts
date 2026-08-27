/**
 * MotionEmitter.ts — ts-morph Code Generator for Astrolabe Motion Studio
 *
 * Emits clean, hand-crafted style R3F + GSAP ScrollTrigger code from MotionIR.
 * Includes mandatory cleanup logic to prevent memory leaks and dangling ScrollTriggers.
 */

import { MotionIR, MotionObject } from './MotionIR';
import { InsertionStrategy } from './InsertionResolver';

export interface EmitResult {
  filePath: string;
  newText: string;
  generatedBlock: string;
}

export function emitMotionCode(targetFilePath: string, fileContent: string, ir: MotionIR, strategy: InsertionStrategy): EmitResult {
  // Load target file into a single isolated in-memory ts-morph SourceFile
  const { Project } = require('ts-morph');
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(targetFilePath, fileContent);

  // 1. Ensure required imports
  ensureImports(sourceFile, strategy);

  // 2. Build the GSAP animation block text with astrolabe markers
  const generatedBlock = buildGsapBlock(ir);

  // 3. Insert or replace block in the source file
  if (strategy.existingSceneBlockRange) {
    const text = sourceFile.getFullText();
    const before = text.substring(0, strategy.existingSceneBlockRange.start);
    const after = text.substring(strategy.existingSceneBlockRange.end);
    sourceFile.replaceWithText(before + generatedBlock + after);
  } else {
    // Append inside the main component function or at the end of the file
    const defaultExport = sourceFile.getDefaultExportSymbol();
    const mainFunc = sourceFile.getFunctions()[0] || sourceFile.getVariableDeclarations()[0];

    if (mainFunc) {
      // Find return statement location and insert before return
      const fullText = sourceFile.getFullText();
      const returnIndex = fullText.lastIndexOf('return');
      if (returnIndex !== -1) {
        const before = fullText.substring(0, returnIndex);
        const after = fullText.substring(returnIndex);
        sourceFile.replaceWithText(before + '\n  ' + generatedBlock + '\n\n  ' + after);
      } else {
        sourceFile.addStatements('\n' + generatedBlock);
      }
    } else {
      sourceFile.addStatements('\n' + generatedBlock);
    }
  }

  return {
    filePath: targetFilePath,
    newText: sourceFile.getFullText(),
    generatedBlock
  };
}

function ensureImports(sourceFile: any, strategy: InsertionStrategy) {
  if (strategy.needsGsapImport) {
    sourceFile.addImportDeclaration({
      defaultImport: 'gsap',
      moduleSpecifier: 'gsap'
    });
  }

  if (strategy.needsScrollTriggerImport) {
    const gsapImport = sourceFile.getImportDeclaration((i: any) => i.getModuleSpecifierValue() === 'gsap');
    if (gsapImport) {
      gsapImport.addNamedImport('ScrollTrigger');
    } else {
      sourceFile.addImportDeclaration({
        namedImports: ['ScrollTrigger'],
        moduleSpecifier: 'gsap/ScrollTrigger'
      });
    }
  }

  if (strategy.needsUseGsapImport) {
    sourceFile.addImportDeclaration({
      namedImports: ['useGSAP'],
      moduleSpecifier: '@gsap/react'
    });
  }

  if (strategy.needsUseRefImport) {
    const reactImport = sourceFile.getImportDeclaration((i: any) => i.getModuleSpecifierValue() === 'react');
    if (reactImport) {
      if (!reactImport.getNamedImports().some((n: any) => n.getName() === 'useRef')) {
        reactImport.addNamedImport('useRef');
      }
    } else {
      sourceFile.addImportDeclaration({
        namedImports: ['useRef'],
        moduleSpecifier: 'react'
      });
    }
  }
}

function buildGsapBlock(ir: MotionIR): string {
  const lines: string[] = [];

  lines.push(`// @astrolabe-motion scene: ${ir.sceneId}`);
  lines.push(`  useGSAP(() => {`);
  lines.push(`    gsap.registerPlugin(ScrollTrigger);`);
  lines.push(`    const tl = gsap.timeline({`);

  let maxOffset = 0;
  for (const obj of ir.objects) {
    for (const kf of obj.keyframes || []) {
      const offset = (kf as any).pixelOffset ?? kf.time;
      if (offset > maxOffset) maxOffset = offset;
    }
  }

  const trigger = ir.triggers[0];
  if (trigger) {
    lines.push(`      scrollTrigger: {`);
    lines.push(`        trigger: "#${ir.sceneId}-container",`);
    lines.push(`        start: "${trigger.scrollStart}",`);
    // Use pixel offset for end if it's > 0, otherwise fallback to trigger.scrollEnd or "+=500"
    const endStr = maxOffset > 0 ? `+=${maxOffset}` : (trigger.scrollEnd || "+=500");
    lines.push(`        end: "${endStr}",`);
    lines.push(`        scrub: ${JSON.stringify(trigger.scrub)},`);
    lines.push(`        pin: ${trigger.pin}`);
    lines.push(`      }`);
  }

  lines.push(`    });`);
  lines.push(``);

  // Group keyframes by object
  for (const obj of ir.objects) {
    if (!obj.keyframes || obj.keyframes.length === 0) continue;

    let prevOffset = 0;
    for (let i = 0; i < obj.keyframes.length; i++) {
      const kf = obj.keyframes[i];
      const valStr = Array.isArray(kf.value) ? JSON.stringify(kf.value) : kf.value;
      const currentOffset = (kf as any).pixelOffset ?? kf.time;
      const duration = Math.max(0.001, currentOffset - prevOffset);

      lines.push(`    tl.to(${obj.refName}.current.${obj.property}, {`);
      lines.push(`      value: ${valStr},`);
      lines.push(`      duration: ${duration},`);
      lines.push(`      ease: "${kf.easing}"`);
      lines.push(`    }, ${prevOffset});`);

      prevOffset = currentOffset;
    }
  }

  lines.push(``);
  lines.push(`    // Mandatory Cleanup Routine (Prevents memory leaks & dangling triggers)`);
  lines.push(`    return () => {`);
  lines.push(`      ScrollTrigger.getAll().forEach(t => t.kill());`);
  lines.push(`      tl.kill();`);
  lines.push(`    };`);
  lines.push(`  }, []);`);
  lines.push(`// @astrolabe-motion end`);

  return lines.join('\n');
}
