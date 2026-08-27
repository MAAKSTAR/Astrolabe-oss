import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

export class WorkspacePreparer {
    public static async prepareWorkspace(workspaceRoot: string): Promise<void> {
        const pkgPath = path.join(workspaceRoot, 'package.json');
        if (!fs.existsSync(pkgPath)) return; // Not a Node project, nothing to prepare

        let pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        } catch (e) {
            console.error('Failed to parse package.json', e);
            return;
        }

        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const hasPlugin = !!deps['code-inspector-plugin'];

        if (!hasPlugin) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Astrolabe: Preparing workspace for click-to-edit...",
                cancellable: false
            }, async () => {
                await this.installPlugin(workspaceRoot);
            });
        }

        if (deps['vite']) {
            await this.injectViteConfig(workspaceRoot);
        } else if (deps['next']) {
            await this.injectNextConfig(workspaceRoot);
        }
    }

    private static installPlugin(cwd: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const isYarn = fs.existsSync(path.join(cwd, 'yarn.lock'));
            const isPnpm = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'));
            
            let cmd = 'npm install -D code-inspector-plugin';
            if (isYarn) cmd = 'yarn add -D code-inspector-plugin';
            else if (isPnpm) cmd = 'pnpm add -D code-inspector-plugin';

            cp.exec(cmd, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    console.error('Failed to install code-inspector-plugin', stderr);
                    resolve(); // Resolve anyway to not block startup completely
                } else {
                    resolve();
                }
            });
        });
    }

    private static async injectViteConfig(cwd: string): Promise<void> {
        const viteConfigPaths = ['vite.config.ts', 'vite.config.js'];
        for (const file of viteConfigPaths) {
            const fullPath = path.join(cwd, file);
            if (fs.existsSync(fullPath)) {
                let content = fs.readFileSync(fullPath, 'utf8');
                if (!content.includes('code-inspector-plugin') && !content.includes('CodeInspectorPlugin')) {
                    // Try to inject
                    const importStatement = `import { CodeInspectorPlugin } from 'code-inspector-plugin';\n`;
                    const requireStatement = `const { CodeInspectorPlugin } = require('code-inspector-plugin');\n`;
                    
                    const isModule = content.includes('import ') || content.includes('export default');
                    const injection = isModule ? importStatement : requireStatement;
                    
                    // Simple injection: add import at top, add to plugins array
                    content = injection + content;
                    
                    // Find plugins: [ ... ]
                    if (content.includes('plugins: [')) {
                        content = content.replace('plugins: [', 'plugins: [\n    CodeInspectorPlugin({ bundler: "vite" }),');
                    } else if (content.includes('defineConfig({')) {
                        content = content.replace('defineConfig({', 'defineConfig({\n  plugins: [CodeInspectorPlugin({ bundler: "vite" })],');
                    }
                    fs.writeFileSync(fullPath, content, 'utf8');
                    console.log('Injected code-inspector-plugin into Vite config');
                }
                break;
            }
        }
    }

    private static async injectNextConfig(cwd: string): Promise<void> {
        const nextConfigPaths = ['next.config.mjs', 'next.config.js', 'next.config.ts'];
        for (const file of nextConfigPaths) {
            const fullPath = path.join(cwd, file);
            if (fs.existsSync(fullPath)) {
                let content = fs.readFileSync(fullPath, 'utf8');
                if (!content.includes('code-inspector-plugin') && !content.includes('CodeInspectorPlugin')) {
                    // Injecting into Next.js config is harder, we'll try a basic approach
                    const isESM = file.endsWith('.mjs') || content.includes('export default');
                    
                    const importStatement = `import { CodeInspectorPlugin } from 'code-inspector-plugin';\n`;
                    const requireStatement = `const { CodeInspectorPlugin } = require('code-inspector-plugin');\n`;
                    const injection = isESM ? importStatement : requireStatement;
                    
                    content = injection + content;
                    
                    // Find webpack(config, options)
                    if (content.includes('webpack: (config, options) => {') || content.includes('webpack(config, options) {')) {
                        content = content.replace(
                            /webpack[\s\S]*?\{/, 
                            `$& \n    config.plugins.push(CodeInspectorPlugin({ bundler: "webpack" }));`
                        );
                    } else if (content.includes('nextConfig = {')) {
                        content = content.replace(
                            'nextConfig = {',
                            `nextConfig = {\n  webpack: (config, options) => {\n    config.plugins.push(CodeInspectorPlugin({ bundler: "webpack" }));\n    return config;\n  },`
                        );
                    }
                    fs.writeFileSync(fullPath, content, 'utf8');
                    console.log('Injected code-inspector-plugin into Next.js config');
                }
                break;
            }
        }
    }
}
