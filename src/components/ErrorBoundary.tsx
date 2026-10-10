import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 出错时的回退界面标题 */
  title?: string;
}

interface State {
  error: Error | null;
}

/**
 * React 错误边界。
 * 任何渲染异常（例如 Three.js 渲染失败）都会被拦截，页面不会变成空白。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Minecube] 渲染出错：', error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-fallback">
        <h2>{this.props.title ?? '出现了一个错误'}</h2>
        <p className="error-fallback__message">{error.message}</p>
        <div className="error-fallback__actions">
          <button type="button" className="btn btn--primary" onClick={this.handleReset}>
            重试
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}
