"use client";

import { forwardRef } from "react";
import { PageHeader } from "./PageHeader";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface PageLayoutProps {
  title: string;
  onBack?: () => void;
  onHome?: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** 底部 tab 页传 false 隐藏侧边返回图标（不影响系统返回键） */
  showBack?: boolean;
}

/** ref 转发到根容器，供横滑跟手时连同标题栏一起平移（标题与内容不分头） */
export const PageLayout = forwardRef<HTMLDivElement, PageLayoutProps>(
  function PageLayout(
    { title, onBack, action, children, className, showBack = true },
    ref
  ) {
    const navigate = useNavigate();

    const handleBack = () => {
      if (onBack) {
        onBack();
      } else {
        navigate(-1);
      }
    };

    return (
      <div ref={ref} className={cn("flex flex-col h-full", className)}>
        <PageHeader
          title={title}
          onBack={handleBack}
          action={action}
          showBack={showBack}
        />
        {children}
      </div>
    );
  }
);
