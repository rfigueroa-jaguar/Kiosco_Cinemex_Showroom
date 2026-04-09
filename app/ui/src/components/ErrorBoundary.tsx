import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, NonIdealState } from "@blueprintjs/core";
import "./ErrorBoundary.css";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message || "Error desconocido" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <NonIdealState
            icon="error"
            title="Algo salió mal"
            description={this.state.message}
            action={
              <Button
                intent="primary"
                text="Recargar aplicación"
                onClick={() => window.location.reload()}
              />
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
