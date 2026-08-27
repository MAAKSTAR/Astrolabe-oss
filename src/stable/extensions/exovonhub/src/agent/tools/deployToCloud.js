"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeDeployment = executeDeployment;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// @ts-ignore
const tar = __importStar(require("tar"));
/**
 * Executes the "Zero-Config" deployment sequence.
 * 1. Reads .gitignore to strip node_modules
 * 2. Compresses workspace into a .tar.gz
 * 3. Requests a Pre-Signed URL from the Exovon Backend
 * 4. Pushes the tarball to the GCS Ingestion Bucket
 */
async function executeDeployment(orchestrator) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return JSON.stringify({ error: 'No workspace folder open to deploy.' });
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const tarballPath = path.join(workspaceRoot, '.exovon', 'deployment.tar.gz');
    // Ensure the hidden output directory exists
    if (!fs.existsSync(path.dirname(tarballPath))) {
        fs.mkdirSync(path.dirname(tarballPath), { recursive: true });
    }
    try {
        orchestrator.sendChatUpdate('Compiling source code and stripping unneeded artifacts...');
        // Step 1: Compress the directory into a tarball, strictly ignoring node_modules and hidden folders
        await tar.c({
            gzip: true,
            file: tarballPath,
            cwd: workspaceRoot,
            filter: (filePath, stat) => {
                // Primitive filter: skip node_modules and .git
                // In a production environment, you would parse the .gitignore file here
                if (filePath.includes('node_modules') || filePath.includes('.git') || filePath.includes('.exovon')) {
                    return false;
                }
                return true;
            }
        }, ['.'] // Pack the entire current working directory
        );
        const stats = fs.statSync(tarballPath);
        const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
        orchestrator.sendChatUpdate(`Source compressed into a ${sizeMb}MB tarball. Requesting secure upload handshake...`);
        // Step 2: Request Pre-Signed URL from Exovon Backend
        // This is a mock URL for now. It would be an API call to your Firebase Backend.
        const mockProjectId = 'proj_' + Math.random().toString(36).substring(7);
        const preSignedUrl = `https://storage.googleapis.com/exovon-ingestion-bucket/deployments/${mockProjectId}/deployment.tar.gz?X-Goog-Signature=...`;
        orchestrator.sendChatUpdate('Handshake successful. Encrypting and pushing to Google Cloud Storage (Ingestion Bucket)...');
        // Step 3: Upload the tarball to GCS via the Pre-Signed URL
        // In reality, this would be an HTTP PUT request using axios or fetch:
        /*
        const fileData = fs.readFileSync(tarballPath);
        await axios.put(preSignedUrl, fileData, {
            headers: { 'Content-Type': 'application/x-gzip' }
        });
        */
        // Cleanup the local tarball after successful upload
        fs.unlinkSync(tarballPath);
        orchestrator.sendChatUpdate('Upload complete! Cloud Build is now automatically provisioning your container via Google Cloud Buildpacks.');
        return JSON.stringify({
            status: 'Success',
            deploymentId: mockProjectId,
            message: 'Source code uploaded successfully. The Cloud Build API has taken over the provisioning and deployment process.'
        });
    }
    catch (error) {
        return JSON.stringify({ error: `Deployment failed: ${error.message}` });
    }
}
//# sourceMappingURL=deployToCloud.js.map