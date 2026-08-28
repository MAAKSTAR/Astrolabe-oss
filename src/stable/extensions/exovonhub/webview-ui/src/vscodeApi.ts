import type { VsCodeApi } from './types';

declare function acquireVsCodeApi(): VsCodeApi;

let vscodeApi: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi | undefined {
  if (vscodeApi) {
    return vscodeApi;
  }

  try {
    vscodeApi = acquireVsCodeApi();
  } catch {
    // Ignore in standard browser environment
  }

  return vscodeApi;
}
