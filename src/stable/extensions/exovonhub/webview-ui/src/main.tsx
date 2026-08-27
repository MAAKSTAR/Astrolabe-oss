import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import SettingsApp from './SettingsApp.tsx'
import PlanViewerApp from './PlanViewerApp.tsx'

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("React Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'red', fontFamily: 'sans-serif' }}>
          <h2>Exovon UI Crash</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.toString()}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '10px' }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

window.addEventListener('error', (event) => {
  document.body.innerHTML = `<div style="padding: 20px; color: red; font-family: sans-serif;">
    <h2>Exovon Fatal Load Error</h2>
    <pre>${event.error?.stack || event.message}</pre>
  </div>`;
});

const page = (window as unknown as { __EXOVON_PAGE__?: string }).__EXOVON_PAGE__ || new URLSearchParams(window.location.search).get('page');
const isSettings = page === 'settings';
const isPlan = page === 'plan';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isPlan ? <PlanViewerApp /> : isSettings ? <SettingsApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
