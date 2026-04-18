/**
 * CustomElementHost component for dynamically loading and rendering custom React components.
 * 
 * This component provides an iframe/React slot for arbitrary user-authored UI components
 * mounted inside chat bubbles. Components are dynamically imported from the custom/ directory.
 */

import React, { useState, useEffect, Suspense } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';

interface CustomElementProps {
  /** Component name to load */
  name: string;
  /** Props to pass to the custom component */
  props?: Record<string, any>;
  /** Optional height constraint */
  height?: string;
  /** Error boundary fallback */
  onError?: (error: Error) => void;
}

interface CustomComponentModule {
  default: React.ComponentType<any>;
}

// Registry of loaded components (cache)
const componentCache = new Map<string, Promise<React.ComponentType<any>>>();

// List of available custom components (in practice, this would be populated from backend)
const availableComponents = new Set([
  'ExampleWidget',
  'UserCard',
  'DataChart', 
  'FormBuilder',
  'CodeEditor',
  'ImageGallery',
  'ChatEmbed'
]);

/**
 * Dynamically import a custom component with error handling
 */
const loadCustomComponent = async (name: string): Promise<React.ComponentType<any>> => {
  // Check cache first
  if (componentCache.has(name)) {
    return componentCache.get(name)!;
  }

  // Validate component name
  if (!availableComponents.has(name)) {
    throw new Error(`Unknown custom component: ${name}. Available: ${Array.from(availableComponents).join(', ')}`);
  }

  try {
    // Dynamic import with error handling
    const importPromise = import(`../components/custom/${name}`)
      .then((module: CustomComponentModule) => {
        if (!module.default) {
          throw new Error(`Component ${name} does not export a default component`);
        }
        return module.default;
      })
      .catch((error) => {
        // Remove from cache on error
        componentCache.delete(name);
        throw new Error(`Failed to load component ${name}: ${error.message}`);
      });

    // Cache the promise
    componentCache.set(name, importPromise);
    return importPromise;
  } catch (error) {
    componentCache.delete(name);
    throw error;
  }
};

/**
 * Error boundary for custom components
 */
class CustomElementErrorBoundary extends React.Component<
  { children: React.ReactNode; componentName: string; onError?: (error: Error) => void },
  { hasError: boolean; error?: Error }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`Custom component ${this.props.componentName} crashed:`, error, errorInfo);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Alert variant="destructive" className="m-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-medium">Custom component error</div>
            <div className="text-sm text-muted-foreground">
              Component "{this.props.componentName}" failed to render: {this.state.error?.message}
            </div>
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}

/**
 * Loading fallback component
 */
const LoadingFallback: React.FC<{ name: string; height?: string }> = ({ name, height }) => (
  <div 
    className="flex items-center justify-center p-4 bg-muted rounded-lg"
    style={{ height: height || '200px' }}
  >
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>Loading {name}...</span>
    </div>
  </div>
);

/**
 * Main CustomElementHost component
 */
export const CustomElementHost: React.FC<CustomElementProps> = ({
  name,
  props = {},
  height,
  onError
}) => {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadComponent = async () => {
      setLoading(true);
      setError(null);

      try {
        const CustomComponent = await loadCustomComponent(name);
        
        if (mounted) {
          setComponent(() => CustomComponent);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setError(errorMessage);
          setLoading(false);
          onError?.(err instanceof Error ? err : new Error(errorMessage));
        }
      }
    };

    loadComponent();

    return () => {
      mounted = false;
    };
  }, [name, onError]);

  // Loading state
  if (loading) {
    return <LoadingFallback name={name} height={height} />;
  }

  // Error state
  if (error) {
    return (
      <Alert variant="destructive" className="m-2">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <div className="font-medium">Failed to load custom component</div>
          <div className="text-sm text-muted-foreground">{error}</div>
        </AlertDescription>
      </Alert>
    );
  }

  // Component loaded successfully
  if (Component) {
    return (
      <CustomElementErrorBoundary componentName={name} onError={onError}>
        <div 
          className="custom-element-container"
          style={{ height: height || 'auto' }}
        >
          <Suspense fallback={<LoadingFallback name={name} height={height} />}>
            <Component {...props} />
          </Suspense>
        </div>
      </CustomElementErrorBoundary>
    );
  }

  // Should not reach here, but just in case
  return null;
};

/**
 * Utility function to register additional custom components at runtime
 */
export const registerCustomComponent = (name: string): void => {
  availableComponents.add(name);
};

/**
 * Get list of available custom components
 */
export const getAvailableComponents = (): string[] => {
  return Array.from(availableComponents);
};

/**
 * Clear component cache (useful for development/hot reload)
 */
export const clearComponentCache = (): void => {
  componentCache.clear();
};

export default CustomElementHost;