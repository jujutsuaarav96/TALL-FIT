import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      let details = "";

      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error) {
            errorMessage = "Database Connection Error";
            details = parsed.error;
          }
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-bg flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-white border border-border p-10 shadow-sm">
            <h1 className="font-serif text-3xl mb-4 text-text">Oops!</h1>
            <p className="text-muted mb-6">{errorMessage}</p>
            {details && (
              <div className="bg-bg p-4 mb-6 text-left overflow-auto max-h-40">
                <code className="text-[10px] text-muted break-all">{details}</code>
              </div>
            )}
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-text text-bg text-[10px] tracking-widest uppercase font-bold hover:bg-accent-dark transition-colors"
            >
              Reload Application
            </button>
            <p className="mt-8 text-[10px] text-muted uppercase tracking-widest">
              If the problem persists, please check your Firebase configuration and security rules.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
