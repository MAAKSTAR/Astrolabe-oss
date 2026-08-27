import * as vscode from 'vscode';
import { EventEmitter } from 'vscode';

export class PlanReviewProvider implements vscode.TextDocumentContentProvider {
    static scheme = 'exovon-plan';
    
    private _onDidChange = new EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;
    
    private currentPlanMarkdown: string = '';
    
    public updatePlan(markdown: string) {
        this.currentPlanMarkdown = markdown;
        this._onDidChange.fire(vscode.Uri.parse(`${PlanReviewProvider.scheme}:Implementation_Plan.md`));
    }
    
    public getPlan(): string {
        return this.currentPlanMarkdown;
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.currentPlanMarkdown;
    }
}
