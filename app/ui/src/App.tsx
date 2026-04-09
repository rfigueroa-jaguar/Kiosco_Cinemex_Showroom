import { ErrorBoundary } from "@/components/ErrorBoundary";
import { KioskApp } from "@/KioskApp";

export default function App() {
  return (
    <ErrorBoundary>
      <KioskApp />
    </ErrorBoundary>
  );
}
