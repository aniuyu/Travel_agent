"use client";

/**
 * 通用错误边界：捕获子组件渲染/生命周期抛出的异常，避免整个页面白屏。
 * 用于包裹 TravelMap 等依赖第三方 SDK 的脆弱组件。
 */

import { Component, type ReactNode } from "react";

interface Props {
  fallback?: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, message: error?.message || String(error) };
  }

  componentDidCatch(error: any, info: any) {
    console.error("[ErrorBoundary] 捕获到渲染错误", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
          ⚠️ 组件渲染出错
          {this.state.message && (
            <p className="mt-2 text-xs text-amber-600">{this.state.message}</p>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
