/**
 * InsertionResolver.ts — AST Insertion Strategy Analysis
 *
 * Analyzes a target source file AST to determine insertion points and reuse existing imports/hooks.
 */

import { MotionIR } from './MotionIR';

export interface InsertionStrategy {
  hasCanvas: boolean;
  needsGsapImport: boolean;
  needsScrollTriggerImport: boolean;
  needsUseGsapImport: boolean;
  needsUseRefImport: boolean;
  existingSceneBlockRange?: { start: number; end: number };
  targetComponentNode?: any;
}

export function analyzeInsertionStrategy(sourceFile: any, ir: MotionIR): InsertionStrategy {
  const text = sourceFile.getFullText();
  
  // 1. Check for R3F Canvas component or imports
  const hasCanvas = text.includes('<Canvas') || text.includes('@react-three/fiber');

  // 2. Check existing imports
  let needsGsapImport = true;
  let needsScrollTriggerImport = true;
  let needsUseGsapImport = true;
  let needsUseRefImport = true;

  const importDeclarations = sourceFile.getImportDeclarations();
  for (const imp of importDeclarations) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    if (moduleSpecifier === 'gsap') {
      const defaultImport = imp.getDefaultImport();
      if (defaultImport && defaultImport.getText() === 'gsap') {
        needsGsapImport = false;
      }
      const namedImports = imp.getNamedImports().map((n: any) => n.getName());
      if (namedImports.includes('ScrollTrigger')) {
        needsScrollTriggerImport = false;
      }
    } else if (moduleSpecifier === 'gsap/ScrollTrigger') {
      needsScrollTriggerImport = false;
    } else if (moduleSpecifier === '@gsap/react') {
      const namedImports = imp.getNamedImports().map((n: any) => n.getName());
      if (namedImports.includes('useGSAP')) {
        needsUseGsapImport = false;
      }
    } else if (moduleSpecifier === 'react') {
      const namedImports = imp.getNamedImports().map((n: any) => n.getName());
      if (namedImports.includes('useRef')) {
        needsUseRefImport = false;
      }
    }
  }

  // 3. Search for existing useGSAP / useEffect block referencing target refs or sceneId tag
  let existingSceneBlockRange: { start: number; end: number } | undefined;
  const targetRefNames = ir.objects.map(o => o.refName);
  
  // Tag marker comment used by Astrolabe Motion Studio: /* @astrolabe-motion scene: <sceneId> */
  const sceneTag = `@astrolabe-motion scene: ${ir.sceneId}`;
  
  if (text.includes(sceneTag)) {
    const tagIndex = text.indexOf(sceneTag);
    const blockStart = text.lastIndexOf('\n', tagIndex);
    const closeIndex = text.indexOf('// @astrolabe-motion end', tagIndex);
    if (closeIndex !== -1) {
      const blockEnd = text.indexOf('\n', closeIndex) + 1;
      existingSceneBlockRange = { start: blockStart, end: blockEnd };
    }
  }

  return {
    hasCanvas,
    needsGsapImport,
    needsScrollTriggerImport,
    needsUseGsapImport,
    needsUseRefImport,
    existingSceneBlockRange
  };
}
