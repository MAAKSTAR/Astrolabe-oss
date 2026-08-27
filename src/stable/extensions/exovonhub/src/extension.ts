import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExovonSidebarProvider } from './ExovonSidebarProvider';
import { SettingsProvider } from './SettingsProvider';
import { BrainCoordinator } from './brain/BrainCoordinator';
import { LlamaEngine } from './agent/copilot/LlamaEngine';
import { CopilotProvider } from './agent/copilot/CopilotProvider';
import { AuthService } from './auth/AuthService';
import { PlanReviewProvider } from './agent/PlanReviewProvider';
import { PlanCommentController } from './agent/PlanCommentController';
import { ProblemCodeActionProvider } from './ProblemCodeActionProvider';
import { ApiService } from './agent/ApiService';

import { EngineStatusBarManager } from './agent/EngineStatusBarManager';
import { DaemonManager } from './agent/DaemonManager';

let sidebarProvider: ExovonSidebarProvider | undefined;
let brainCoordinator: BrainCoordinator | undefined;
let authService: AuthService | undefined;
let engineStatusBar: EngineStatusBarManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
	try {
		console.log('Exovon Hub Suite is now active.');

	// Initialize Engine Status Bar & Management QuickPick Menu
	engineStatusBar = EngineStatusBarManager.initialize(context);

	// Auto-start Local Inference Daemon
	DaemonManager.getInstance().startDaemon(context).catch(e => {
		console.warn('Initial daemon startup:', e);
	});

	// Auto-set default theme on first run
	const isFirstRun = context.globalState.get<boolean>('astrolabe.isFirstThemeRun', true);
	if (isFirstRun) {
		const config = vscode.workspace.getConfiguration('workbench');
		await config.update('colorTheme', 'Astrolabe Deep Space', vscode.ConfigurationTarget.Global);
		await context.globalState.update('astrolabe.isFirstThemeRun', false);
	}

	// Initialize Auth Service
	authService = new AuthService(context);
	authService.initialize().catch(e => console.error('Failed to init auth:', e));

	// Initialize Plan Review System
	const planReviewProvider = new PlanReviewProvider();
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(PlanReviewProvider.scheme, planReviewProvider));
	const planCommentController = new PlanCommentController(context);

	// Setup Status Bar Item for Brain
	const brainStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	brainStatusBar.text = '$(database) Brain: Initializing...';
	brainStatusBar.command = 'exovon.showBrainDetails';
	brainStatusBar.show();
	context.subscriptions.push(brainStatusBar);

	const updateBrainStatusBar = async () => {
		if (!brainCoordinator) {
			brainStatusBar.text = '$(error) Brain: Offline';
			brainStatusBar.color = new vscode.ThemeColor('errorForeground');
			brainStatusBar.tooltip = 'Exovon Brain is offline. Click for diagnostics.';
			return;
		}
		if (brainCoordinator.isSyncing) {
			brainStatusBar.text = `$(sync~spin) Brain: Indexing...`;
			brainStatusBar.color = new vscode.ThemeColor('charts.orange');
			brainStatusBar.tooltip = 'Exovon Brain is actively indexing workspace files...';
			return;
		}
		const currentBranch = brainCoordinator.currentBranch || 'main';
		const stats = await brainCoordinator.getStats();
		if (stats.status === 'failed' || stats.lastError) {
			brainStatusBar.text = `$(error) Brain: Failed`;
			brainStatusBar.color = new vscode.ThemeColor('errorForeground');
			brainStatusBar.tooltip = `Exovon Brain Error: ${stats.lastError || 'Unknown failure'}\nClick to inspect or rebuild database.`;
			return;
		}
		const entities = stats.entities > 1000 ? (stats.entities / 1000).toFixed(1) + 'k' : stats.entities;
		const size = stats.sizeMB;
		const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		if (stats.entities === 0) {
			brainStatusBar.text = `$(circle-slash) Brain: 0 entities | ${size} MB`;
			brainStatusBar.color = new vscode.ThemeColor('descriptionForeground');
			brainStatusBar.tooltip = `Brain has 0 indexed symbols (Branch: ${currentBranch})\nLast Check: ${time}\nClick to index workspace.`;
		} else {
			brainStatusBar.text = `$(database) Brain: ${entities} entities | ${size} MB`;
			brainStatusBar.color = undefined;
			brainStatusBar.tooltip = `Branch: ${currentBranch}\nIndexed Symbols: ${stats.entities}\nDatabase: ${size} MB\nLast Sync: ${time}\nClick for Brain diagnostics.`;
		}
	};

	// Register interactive Brain diagnostics command
	context.subscriptions.push(
		vscode.commands.registerCommand('exovon.showBrainDetails', async () => {
			if (!brainCoordinator) {
				vscode.window.showErrorMessage('Exovon Brain is not initialized.');
				return;
			}
			const stats = await brainCoordinator.getStats();
			const items: vscode.QuickPickItem[] = [];

			if (stats.status === 'failed' || stats.lastError) {
				items.push({
					label: '$(error) Brain Status: Failed / Corrupted',
					description: stats.lastError || 'Unknown Error',
					detail: `Database path: ${stats.dbPath}`
				});
			} else {
				items.push({
					label: stats.entities > 0 ? '$(database) Brain Status: Healthy' : '$(info) Brain Status: Empty (0 Entities)',
					description: `${stats.entities} indexed symbols | ${stats.sizeMB} MB`,
					detail: `Branch: ${brainCoordinator.currentBranch || 'main'} | Database: ${stats.dbPath}`
				});
			}

			items.push({
				label: '$(sync) Force Re-index Workspace',
				description: 'Scan all project files and update symbol embeddings'
			});
			items.push({
				label: '$(trash) Wipe & Rebuild Brain Cache',
				description: 'Drop SQLite index tables and re-index from scratch'
			});
			if (fs.existsSync(stats.dbPath)) {
				items.push({
					label: '$(folder-opened) Reveal Brain Database in File Explorer',
					description: stats.dbPath
				});
			}

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Exovon Brain Diagnostics & Controls'
			});

			if (!selected) return;

			if (selected.label.includes('Force Re-index')) {
				vscode.window.showInformationMessage('Exovon Brain: Re-indexing workspace...');
				await brainCoordinator.seedWorkspace();
				await updateBrainStatusBar();
			} else if (selected.label.includes('Wipe & Rebuild')) {
				vscode.window.showInformationMessage('Exovon Brain: Wiping database and rebuilding index...');
				try {
					await brainCoordinator.rebuildBrain();
					await updateBrainStatusBar();
					vscode.window.showInformationMessage('Exovon Brain rebuilt successfully!');
				} catch (err: any) {
					vscode.window.showErrorMessage(`Rebuild failed: ${err.message}`);
				}
			} else if (selected.label.includes('Reveal Brain Database')) {
				vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(stats.dbPath));
			}
		})
	);

	// Auto-ignore .exovon-shadow to prevent git status clutter
	if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
		const gitignorePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.gitignore');
		fs.promises.readFile(gitignorePath, 'utf-8').then(content => {
			if (!content.includes('.exovon-shadow')) {
				return fs.promises.appendFile(gitignorePath, '\n# Exovon Workspace Sandbox\n.exovon-shadow/\n');
			}
		}).catch((e) => {
			if (e.code === 'ENOENT') {
				fs.promises.writeFile(gitignorePath, '# Exovon Workspace Sandbox\n.exovon-shadow/\n').catch(err => {
					console.error('Failed to write .gitignore:', err);
				});
			} else {
				console.error('Failed to read .gitignore:', e);
			}
		});

		// Hide from VS Code Explorer so users do not mistake unapproved drafts for real files
		const config = vscode.workspace.getConfiguration('files');
		const exclude = config.get<Record<string, boolean>>('exclude') || {};
		if (!exclude['**/.exovon-shadow']) {
			const newExclude = { ...exclude, '**/.exovon-shadow': true };
			config.update('exclude', newExclude, vscode.ConfigurationTarget.Workspace).then(undefined, () => {});
		}
	}

	// Initialize Project Brain (Offline vector/graph)
	brainCoordinator = new BrainCoordinator(context, () => {
		updateBrainStatusBar();
	});

	// Git Integration (GIT-1)
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (gitExtension) {
		const git = gitExtension.getAPI(1);
		git.onDidOpenRepository((repo: any) => {
			const branch = repo.state.HEAD?.name || 'main';
			if (brainCoordinator) { brainCoordinator.currentBranch = branch; }
			updateBrainStatusBar();
			
			let lastCommit = repo.state.HEAD?.commit;

			repo.state.onDidChange(() => {
				const newBranch = repo.state.HEAD?.name || 'main';
				const newCommit = repo.state.HEAD?.commit;
				
				if (newBranch !== brainCoordinator?.currentBranch) {
					if (brainCoordinator) {
						const oldBranch = brainCoordinator.currentBranch;
						brainCoordinator.currentBranch = newBranch;
						brainCoordinator.differentialBranchSwitch(oldBranch, newBranch, lastCommit, newCommit);
					}
					updateBrainStatusBar();
					lastCommit = newCommit;
				} else if (newCommit !== lastCommit) {
					lastCommit = newCommit;
					if (brainCoordinator && newCommit) {
						brainCoordinator.recordCommit(newBranch, newCommit);
					}
				}
			});
		});
	}

	// Start initial workspace seed
	if (brainCoordinator) {
		brainCoordinator.seedWorkspace().then(() => {
			updateBrainStatusBar();
		});
	}

	// Instantiate and register our sidebar view provider
	sidebarProvider = new ExovonSidebarProvider(context, authService, brainCoordinator, planReviewProvider, planCommentController);
	const viewDisposable = vscode.window.registerWebviewViewProvider(
		ExovonSidebarProvider.viewType,
		sidebarProvider,
		{ webviewOptions: { retainContextWhenHidden: true } }
	);
	context.subscriptions.push(viewDisposable);

	// Register ProblemCodeActionProvider
	if (sidebarProvider) {
		context.subscriptions.push(
			vscode.languages.registerCodeActionsProvider('*', new ProblemCodeActionProvider(sidebarProvider), {
				providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
			})
		);
	}

	// Hellworld command registers as secondary action
	const commandDisposable = vscode.commands.registerCommand('exovonhub.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Exovon Hub Suite!');
	});

	context.subscriptions.push(commandDisposable);

	// Command to reopen the sidebar from Editor Title
	const openSidebarDisposable = vscode.commands.registerCommand('exovonhub.openSidebar', () => {
		vscode.commands.executeCommand('exovonhub.sidebar.focus');
	});
	context.subscriptions.push(openSidebarDisposable);

	// Command to change Inspector Port
	const changeInspectorPortDisposable = vscode.commands.registerCommand('exovonhub.changeInspectorPort', () => {
		sidebarProvider?.resetInspectorPort();
	});
	context.subscriptions.push(changeInspectorPortDisposable);

	// Command to open the Settings Webview Panel
	const openSettingsDisposable = vscode.commands.registerCommand('exovon.openSettings', () => {
		sidebarProvider?.postMessage({ type: 'openSettings' });
		// Also show SettingsApp
		SettingsProvider.createOrShow(context);
	});
	context.subscriptions.push(openSettingsDisposable);

	const openHistoryDisposable = vscode.commands.registerCommand('exovon.openHistory', () => {
		vscode.commands.executeCommand('exovonhub.sidebar.focus');
		sidebarProvider?.postMessage({ type: 'openHistory' });
	});
	context.subscriptions.push(openHistoryDisposable);

	const toggleAutoModeDisposable = vscode.commands.registerCommand('exovon.toggleAutoMode', () => {
		vscode.commands.executeCommand('exovonhub.sidebar.focus');
		sidebarProvider?.postMessage({ type: 'toggleAutoMode' });
	});
	context.subscriptions.push(toggleAutoModeDisposable);

	// Command to request state sync for Settings Webview
	const triggerSettingsStateDisposable = vscode.commands.registerCommand('exovonhub.triggerSettingsState', () => {
		sidebarProvider?.broadcastStateToSettings();
	});
	context.subscriptions.push(triggerSettingsStateDisposable);

	// Keybinding: Focus Agent Input
	const focusInputDisposable = vscode.commands.registerCommand('exovon.focusAgentInput', () => {
		vscode.commands.executeCommand('exovonhub.sidebar.focus');
		sidebarProvider?.postMessage({ type: 'focusInput' });
	});
	context.subscriptions.push(focusInputDisposable);

	// Keybinding: Cancel Agent
	const cancelAgentDisposable = vscode.commands.registerCommand('exovon.cancelAgent', () => {
		sidebarProvider?.postMessage({ type: 'cancelAgentShortcut' });
	});
	context.subscriptions.push(cancelAgentDisposable);

	// Send All Problems Command
	const sendAllProblemsDisposable = vscode.commands.registerCommand('exovon.sendAllProblemsToAgent', () => {
		vscode.commands.executeCommand('exovonhub.sidebar.focus');
		sidebarProvider?.postMessage({ type: 'appendInput', text: '@problems ' });
	});
	context.subscriptions.push(sendAllProblemsDisposable);

	// Send Specific Problem Command
	const sendProblemDisposable = vscode.commands.registerCommand('exovon.sendProblemToAgent', (uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) => {
		if (uri && diagnostics && diagnostics.length > 0) {
			const filename = path.basename(uri.fsPath);
			vscode.commands.executeCommand('exovonhub.sidebar.focus');
			sidebarProvider?.postMessage({ type: 'appendInput', text: `@problems ${filename} ` });
		}
	});
	context.subscriptions.push(sendProblemDisposable);

	// Login Command
	const loginDisposable = vscode.commands.registerCommand('exovon.login', async () => {
		if (authService) {
			await authService.login();
		}
	});
	context.subscriptions.push(loginDisposable);

	// Logout Command
	const logoutDisposable = vscode.commands.registerCommand('exovon.logout', async () => {
		if (authService) {
			await authService.logout();
		}
	});
	context.subscriptions.push(logoutDisposable);

	// Clear KV Cache / Agent Context Command
	const clearKvCacheDisposable = vscode.commands.registerCommand('exovon.clearKvCache', async () => {
		sidebarProvider?.postMessage({ type: 'contextCleared' });
		vscode.window.showInformationMessage('Exovon Engine: KV Cache and Agent Context Cleared.');
	});
	context.subscriptions.push(clearKvCacheDisposable);

	// Paste Auth Token Fallback Command
	const pasteTokenDisposable = vscode.commands.registerCommand('exovon.pasteAuthToken', async () => {
		const token = await vscode.window.showInputBox({
			prompt: 'Paste your Exovon Auth Token here',
			password: true,
			ignoreFocusOut: true
		});
		if (token && authService) {
			// Simulate the callback URI logic
			const dummyUri = vscode.Uri.parse(`vscodium://exovon.exovonhub/auth?token=${token}`);
			await authService.handleUri(dummyUri);
		}
	});
	context.subscriptions.push(pasteTokenDisposable);

	// Cashfree Buy Pro Pass Command
	const buyProPassDisposable = vscode.commands.registerCommand('exovon.buyProPass', async (tier?: string) => {
		vscode.window.showInformationMessage('Generating secure checkout session...');
		
		const token = await context.secrets.get('EXOVON_PAT');
		if (!token) {
			vscode.window.showErrorMessage('You must be logged in to upgrade your workspace.');
			return;
		}

		try {
			const session = await ApiService.createSubscriptionLink(token, tier || 'pro');
			if (session && session.payment_session_id) {
				// Use the dynamic portal URL if it was returned, otherwise default
				const portalUrl = 'https://exovon.in/payments';
				vscode.env.openExternal(vscode.Uri.parse(`${portalUrl}?session_id=${session.payment_session_id}`));
			} else {
				vscode.window.showErrorMessage('Failed to generate checkout session. Please try again later.');
			}
		} catch (error) {
			vscode.window.showErrorMessage('Error connecting to Exovon billing servers.');
		}
	});
	context.subscriptions.push(buyProPassDisposable);

	// Native Diff Approval Commands
	const acceptDiffDisposable = vscode.commands.registerCommand('exovon.acceptFileDiff', async (uri?: vscode.Uri) => {
		// VS Code passes the resource URI when executed from editor/title menu
		if (uri && sidebarProvider) {
			const relativePath = vscode.workspace.asRelativePath(uri).replace('.exovon-shadow/', '');
			await sidebarProvider.commitShadowFile(relativePath);
			vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		} else {
			vscode.window.showErrorMessage('No diff file selected to accept.');
		}
	});
	context.subscriptions.push(acceptDiffDisposable);

	const rejectDiffDisposable = vscode.commands.registerCommand('exovon.rejectFileDiff', async (uri?: vscode.Uri) => {
		if (uri && sidebarProvider) {
			const relativePath = vscode.workspace.asRelativePath(uri).replace('.exovon-shadow/', '');
			await sidebarProvider.revertShadowFile(relativePath);
			vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		} else {
			vscode.window.showErrorMessage('No diff file selected to reject.');
		}
	});
	context.subscriptions.push(rejectDiffDisposable);

	const compileMotionDisposable = vscode.commands.registerCommand('exovon.compileMotion', async (uri?: vscode.Uri, rawTheatreJson?: any) => {
		const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
		const { MotionCompiler } = require('./motion/MotionCompiler');
		await MotionCompiler.getInstance().compileAndApply(targetUri, rawTheatreJson || {}, brainCoordinator);
	});
	context.subscriptions.push(compileMotionDisposable);

	const openMotionStudioDisposable = vscode.commands.registerCommand('exovon.openMotionStudio', async () => {
		const { MotionStudioServer } = require('./motion/MotionStudioServer');
		const server = MotionStudioServer.getInstance();
		server.setBrainCoordinator(brainCoordinator);
		await server.startAndOpen();
	});
	context.subscriptions.push(openMotionStudioDisposable);

	// Incremental Graph/Vector indexer on save
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
		const validLangs = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python', 'go', 'rust', 'swift', 'java', 'c', 'cpp'];
		if (brainCoordinator && validLangs.includes(doc.languageId)) {
			try {
				await brainCoordinator.indexFile(doc.uri.fsPath, doc.getText());
				
				// Re-fetch graph if it's the active file
				if (vscode.window.activeTextEditor?.document.uri.fsPath === doc.uri.fsPath) {
					const elements = brainCoordinator.getGraphForFile(doc.uri.fsPath);
					sidebarProvider?.postMessage({ type: 'cortexGraphUpdate', elements });
				}
			} catch(e) {
				console.error('Brain background index failed', e);
			}
		}
	}));

	// Real-time Brain eviction on file delete
	context.subscriptions.push(vscode.workspace.onDidDeleteFiles(async (event) => {
		if (brainCoordinator) {
			for (const fileUri of event.files) {
				try {
					brainCoordinator.removeFile(fileUri.fsPath);
				} catch (e) {
					console.error('[BrainIndexer] Error evicting deleted file:', e);
				}
			}
		}
	}));

	// Real-time Brain update on file rename
	context.subscriptions.push(vscode.workspace.onDidRenameFiles(async (event) => {
		if (brainCoordinator) {
			for (const file of event.files) {
				try {
					brainCoordinator.renameFile(file.oldUri.fsPath, file.newUri.fsPath);
				} catch (e) {
					console.error('[BrainIndexer] Error handling renamed file:', e);
				}
			}
		}
	}));

	// Cortex Graph active file loop
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor && brainCoordinator && sidebarProvider) {
			const elements = brainCoordinator.getGraphForFile(editor.document.uri.fsPath);
			sidebarProvider.postMessage({ type: 'cortexGraphUpdate', elements });
		}
	}));

	// Setup Local exovon agent Engine (Ghost Text / Inline Autocomplete)
	const enableGhost = vscode.workspace.getConfiguration('exovonhub').get<boolean>('enableGhostText', false);

	if (enableGhost) {
		try {
			const llamaEngine = new LlamaEngine(context.globalStorageUri);
			// Start initialization in background so it doesn't block extension activation
			llamaEngine.initialize().catch(e => {
				console.error('exovon agent init failed', e);
			});

			const copilotProvider = new CopilotProvider(llamaEngine);
			const copilotDisposable = vscode.languages.registerInlineCompletionItemProvider(
				{ pattern: '**' }, // Trigger for all files
				copilotProvider
			);
			context.subscriptions.push(copilotDisposable);
		} catch (e) {
			console.error('Failed to construct exovon agent engine:', e);
		}
	}
	
	} catch (err: any) {
		vscode.window.showErrorMessage(`Exovon Activation Error: ${err.message || String(err)}`);
		console.error('Activation Error:', err);
	}
}

export function deactivate() {
	// Cleanup shadow workspace on extension deactivation to prevent disk bloat
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceRoot) {
		const shadowPath = path.resolve(workspaceRoot, '.exovon-shadow');
		if (fs.existsSync(shadowPath)) {
			try {
				fs.rmSync(shadowPath, { recursive: true, force: true });
			} catch (e) {
				// Best-effort cleanup
			}
		}
	}
	
	if (brainCoordinator) {
		brainCoordinator.shutdown();
		brainCoordinator = undefined;
	}

	// Stop Inference Engine to prevent zombie processes
	try {
		const { DaemonManager } = require('./agent/DaemonManager');
		DaemonManager.getInstance().stopDaemon();
	} catch (e) {
		// Ignore if not loaded
	}

	sidebarProvider = undefined;
}
