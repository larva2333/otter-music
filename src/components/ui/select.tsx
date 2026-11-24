"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 非模态下拉选择器。
 *
 * 原先用 @radix-ui/react-select：它展开时会给 <body> 加 pointer-events: none（模态行为），
 * 下拉开着的时候点其他控件、拖动页面全部无响应，必须先把下拉关掉才能点第二次。
 * 这里改成基于 Popover 的非模态实现：点外部只负责收起，同一次点击会照常落到下面的控件上。
 */
type SelectContextValue = {
  value?: string;
  setValue: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  labels: Map<string, React.ReactNode>;
  disabled?: boolean;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext(component: string) {
  const context = React.useContext(SelectContext);
  if (!context) {
    throw new Error(`${component} 必须放在 <Select> 内部使用`);
  }
  return context;
}

type AnyProps = { children?: React.ReactNode; value?: unknown };

/** 从 <SelectContent> 子树里收集 value → 展示内容，供 <SelectValue> 在收起状态下显示 */
function collectLabels(
  node: React.ReactNode,
  labels: Map<string, React.ReactNode>
) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as AnyProps;
    if (child.type === SelectItem) {
      if (props.value !== undefined) {
        labels.set(String(props.value), props.children);
      }
      return;
    }
    if (props.children) collectLabels(props.children, labels);
  });
}

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

function Select({
  value,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled,
  children,
}: SelectProps) {
  const [innerValue, setInnerValue] = React.useState<string | undefined>(
    defaultValue
  );
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen);

  const isValueControlled = value !== undefined;
  const currentValue = isValueControlled ? value : innerValue;
  const isOpenControlled = openProp !== undefined;
  const open = isOpenControlled ? openProp : innerOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isOpenControlled) setInnerOpen(next);
      onOpenChange?.(next);
    },
    [isOpenControlled, onOpenChange]
  );

  const setValue = React.useCallback(
    (next: string) => {
      if (!isValueControlled) setInnerValue(next);
      onValueChange?.(next);
    },
    [isValueControlled, onValueChange]
  );

  const labels = React.useMemo(() => {
    const map = new Map<string, React.ReactNode>();
    collectLabels(children, map);
    return map;
  }, [children]);

  const contextValue = React.useMemo<SelectContextValue>(
    () => ({
      value: currentValue,
      setValue,
      open,
      setOpen,
      labels,
      disabled,
    }),
    [currentValue, setValue, open, setOpen, labels, disabled]
  );

  return (
    <SelectContext.Provider value={contextValue}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
        {children}
      </PopoverPrimitive.Root>
    </SelectContext.Provider>
  );
}

function SelectValue({
  className,
  placeholder,
  children,
  ...props
}: React.ComponentProps<"span"> & { placeholder?: React.ReactNode }) {
  const { value, labels } = useSelectContext("SelectValue");
  const label = value !== undefined ? labels.get(String(value)) : undefined;
  // 显式传 children 时优先用它：收起态可以显示短文案（如「无损」），
  // 展开列表里仍然是完整标签（「无损 (999kbps)」）
  const content = children ?? label ?? value ?? placeholder;

  return (
    <span
      data-slot="select-value"
      data-placeholder={label || value ? undefined : ""}
      className={cn(
        "line-clamp-1 flex items-center gap-2 data-[placeholder]:text-placeholder",
        className
      )}
      {...props}
    >
      {content}
    </span>
  );
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<"button"> & { size?: "sm" | "default" }) {
  const { open, disabled } = useSelectContext("SelectTrigger");

  return (
    <PopoverPrimitive.Trigger asChild disabled={disabled}>
      <button
        type="button"
        data-slot="select-trigger"
        data-size={size}
        data-state={open ? "open" : "closed"}
        aria-expanded={open}
        className={cn(
          "group border-input data-[placeholder]:text-placeholder [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-xs whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...props}
      >
        {children}
        {/* 收起/展开时箭头翻转（打开 = 朝上，收起 = 朝下） */}
        <ChevronDownIcon className="size-4 opacity-50 transition-transform duration-200 ease-out group-data-[state=open]:rotate-180" />
      </button>
    </PopoverPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="select-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        // 不抢焦点：手机上展开下拉时不要弹键盘、也不要因为 focus 把页面滚走
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-popover-content-available-height) min-w-[var(--radix-popover-trigger-width)] origin-(--radix-popover-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md outline-hidden",
          className
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

function SelectGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-group"
      role="group"
      className={className}
      {...props}
    />
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  value,
  disabled,
  ...props
}: Omit<React.ComponentProps<"button">, "value"> & { value: string }) {
  const context = useSelectContext("SelectItem");
  const selected =
    context.value !== undefined && String(context.value) === String(value);

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-slot="select-item"
      data-state={selected ? "checked" : "unchecked"}
      disabled={disabled ?? context.disabled}
      onClick={() => {
        if (!selected) context.setValue(String(value));
        context.setOpen(false);
      }}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-left text-xs outline-hidden select-none transition-colors",
        // 选中项固定高亮（原先靠展开时的焦点高亮，收起/移开后就没底了）
        selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-4 items-center justify-center">
        {selected && <CheckIcon className="size-4 text-accent-foreground" />}
      </span>
      {children}
    </button>
  );
}

function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

/** 兼容旧导出：自定义下拉不再需要滚动箭头（原生滚动即可） */
function SelectScrollUpButton() {
  return null;
}

function SelectScrollDownButton() {
  return null;
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
