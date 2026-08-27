/**
 * MotionOnboarding.ts — Onboarding & Workspace AST Inspector for Astrolabe Motion Studio
 *
 * Implements Section 16 of the CUCUMBER Blueprint:
 * - Detects missing dependencies (@theatre/core, @theatre/r3f, gsap, @gsap/react).
 * - Queries Brain Coordinator index for R3F <Canvas> scenes across the workspace.
 * - Scaffolds starting R3F scene files when no <Canvas> exists in the workspace.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IBrainCoordinator } from '../types/shared';

export interface OnboardingStatus {
  hasTheatreCore: boolean;
  hasTheatreR3f: boolean;
  hasGsap: boolean;
  r3fCanvasFiles: string[];
  isReady: boolean;
}

export class MotionOnboarding {

  /**
   * Scans package.json and queries Brain Coordinator for R3F scenes.
   */
  public static async inspectWorkspace(brainCoordinator?: IBrainCoordinator): Promise<OnboardingStatus> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return {
        hasTheatreCore: false,
        hasTheatreR3f: false,
        hasGsap: false,
        r3fCanvasFiles: [],
        isReady: false
      };
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const packageJsonPath = path.join(rootPath, 'package.json');

    let hasTheatreCore = false;
    let hasTheatreR3f = false;
    let hasGsap = false;

    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        hasTheatreCore = Boolean(allDeps['@theatre/core']);
        hasTheatreR3f = Boolean(allDeps['@theatre/r3f']);
        hasGsap = Boolean(allDeps['gsap']);
      } catch (e) {
        console.error('[MotionOnboarding] Error reading package.json:', e);
      }
    }

    // Query Brain Coordinator index for <Canvas> files across the workspace
    const r3fCanvasFiles = (brainCoordinator as any)?.findR3FCanvasFiles ? (brainCoordinator as any).findR3FCanvasFiles() : [];

    const isReady = hasTheatreCore && hasTheatreR3f && hasGsap && r3fCanvasFiles.length > 0;

    return {
      hasTheatreCore,
      hasTheatreR3f,
      hasGsap,
      r3fCanvasFiles,
      isReady
    };
  }

  /**
   * Prompts user to install missing dependencies or scaffold a new R3F scene.
   */
  public static async runOnboardingFlow(status: OnboardingStatus): Promise<vscode.Uri | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;
    const rootUri = workspaceFolders[0].uri;

    // 1. Missing Dependencies check
    if (!status.hasTheatreCore || !status.hasTheatreR3f || !status.hasGsap) {
      const missing: string[] = [];
      if (!status.hasTheatreCore) missing.push('@theatre/core');
      if (!status.hasTheatreR3f) missing.push('@theatre/r3f');
      if (!status.hasGsap) missing.push('gsap @gsap/react');

      const action = await vscode.window.showInformationMessage(
        `Astrolabe Motion Studio requires dependencies: ${missing.join(', ')}. Would you like to add them to package.json?`,
        'Add Dependencies',
        'Cancel'
      );

      if (action === 'Add Dependencies') {
        await this.addDependenciesToPackageJson(rootUri.fsPath, missing);
      }
    }

    // 2. Check for R3F Canvas in workspace
    if (status.r3fCanvasFiles.length === 0) {
      const scaffoldChoice = await vscode.window.showInformationMessage(
        `No React Three Fiber <Canvas> detected in your workspace by Astrolabe Brain. Would you like to scaffold a starter 3D Scene file?`,
        'Scaffold MotionScene.tsx',
        'Cancel'
      );

      if (scaffoldChoice === 'Scaffold MotionScene.tsx') {
        return await this.scaffoldStarterScene(rootUri);
      }
      return null;
    } else {
      // Pick existing canvas file or use active editor
      return vscode.Uri.file(status.r3fCanvasFiles[0]);
    }
  }

  private static async addDependenciesToPackageJson(rootPath: string, missing: string[]) {
    const pkgPath = path.join(rootPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.dependencies = pkg.dependencies || {};

      if (!pkg.dependencies['@theatre/core']) pkg.dependencies['@theatre/core'] = '^0.7.0';
      if (!pkg.dependencies['@theatre/r3f']) pkg.dependencies['@theatre/r3f'] = '^0.7.0';
      if (!pkg.dependencies['gsap']) pkg.dependencies['gsap'] = '^3.12.5';
      if (!pkg.dependencies['@gsap/react']) pkg.dependencies['@gsap/react'] = '^2.1.0';

      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      vscode.window.showInformationMessage('Updated package.json with Motion Studio dependencies. Please run `npm install`.');
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to update package.json: ${e}`);
    }
  }

  private static async scaffoldStarterScene(rootUri: vscode.Uri): Promise<vscode.Uri> {
    const scenePath = path.join(rootUri.fsPath, 'src', 'components', 'MotionScene.tsx');
    const dir = path.dirname(scenePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const starterCode = `import React, { useRef } from 'react';
import { Canvas } from '@react-three/fiber';

export function MotionScene() {
  const boxRef = useRef<any>(null);

  return (
    <div id="motionScene-container" style={{ width: '100vw', height: '100vh' }}>
      <Canvas camera={{ position: [0, 0, 5] }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} />
        <mesh ref={boxRef} position={[0, 0, 0]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="mediumpurple" />
        </mesh>
      </Canvas>
    </div>
  );
}

export default MotionScene;
`;

    fs.writeFileSync(scenePath, starterCode, 'utf8');
    const docUri = vscode.Uri.file(scenePath);
    await vscode.window.showTextDocument(docUri);
    vscode.window.showInformationMessage('✨ Created starter 3D Scene: MotionScene.tsx');
    return docUri;
  }
}
