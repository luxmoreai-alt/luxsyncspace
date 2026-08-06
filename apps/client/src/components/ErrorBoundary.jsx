import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, details) {
    console.error("LuxSyncspace render error", error, details);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error">
        <span><AlertTriangle size={28} /></span>
        <h1>We couldn’t open this page</h1>
        <p>Your information is safe. Refresh the workspace to continue.</p>
        <button className="button button-primary" onClick={() => window.location.reload()}><RefreshCw size={17} /> Refresh workspace</button>
      </main>
    );
  }
}
