import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="crash">
        <h1>这个视图出错了</h1>
        <p>数据还在浏览器内存里，可以重试，或从顶部返回其他页面。</p>
        <pre>{error.message}</pre>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          重试
        </button>
      </section>
    );
  }
}