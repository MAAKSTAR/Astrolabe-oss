import * as vscode from 'vscode';
import { AgentOrchestrator } from './AgentOrchestrator';

export class PlanComment implements vscode.Comment {
    id: number;
    label: string | undefined;
    savedBody: string | vscode.MarkdownString; // for the Cancel button
    constructor(
        public body: string | vscode.MarkdownString,
        public mode: vscode.CommentMode,
        public author: vscode.CommentAuthorInformation,
        public parent?: vscode.CommentThread,
        public contextValue?: string
    ) {
        this.id = ++PlanComment.idCounter;
        this.savedBody = this.body;
    }
    static idCounter = 0;
}

export class PlanCommentController {
    private controller: vscode.CommentController;
    private activeOrchestrator?: AgentOrchestrator;

    constructor(context: vscode.ExtensionContext) {
        this.controller = vscode.comments.createCommentController('exovon-plan-comments', 'Exovon Plan Review');
        this.controller.commentingRangeProvider = {
            provideCommentingRanges: (document: vscode.TextDocument, token: vscode.CancellationToken) => {
                if (document.uri.scheme === 'exovon-plan') {
                    return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
                }
                return undefined;
            }
        };

        context.subscriptions.push(this.controller);
        
        // Commands for the comments
        context.subscriptions.push(vscode.commands.registerCommand('exovon.createComment', this.replyNote.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand('exovon.deleteCommentThread', this.deleteCommentThread.bind(this)));
    }

    public setActiveOrchestrator(orchestrator: AgentOrchestrator | undefined) {
        this.activeOrchestrator = orchestrator;
    }

    private replyNote(reply: vscode.CommentReply) {
        const thread = reply.thread;
        const newComment = new PlanComment(
            reply.text,
            vscode.CommentMode.Preview,
            { name: 'Developer', iconPath: vscode.Uri.parse('https://avatars.githubusercontent.com/u/1') },
            thread,
            'canDelete'
        );
        thread.comments = [...thread.comments, newComment];
        
        // Format feedback and auto-reject
        const lineNumber = thread.range ? thread.range.start.line + 1 : 'unknown';
        const feedbackText = `Regarding Line ${lineNumber}: ${reply.text}`;
        
        // Let the orchestrator know that the plan is rejected with feedback
        if (this.activeOrchestrator) {
            this.activeOrchestrator.resolvePlanApproval(false, feedbackText);
            
            // Clean up the thread since the plan will be refreshed anyway
            thread.dispose();
        } else {
            vscode.window.showWarningMessage('No active agent session found.');
        }
    }

    private deleteCommentThread(thread: vscode.CommentThread) {
        thread.dispose();
    }
}
