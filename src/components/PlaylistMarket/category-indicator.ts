export interface CategoryIndicator {
  left: number;
  top: number;
  width: number;
}

/**
 * 计算顶部分类栏选中胶囊的位置。
 *
 * 页面被隐藏时（搜索结果盖住、tab 保活切走）按钮的 offsetWidth 为 0，
 * 此时必须返回 null：写入一个 0 宽的胶囊后，显示回来时没有尺寸变化可侦测，
 * 高亮就永久消失了。
 */
export function getCategoryIndicator(
  bar: HTMLElement | null,
  categoryId: string
): CategoryIndicator | null {
  const btn = bar?.querySelector<HTMLElement>(
    `[data-category-id="${categoryId}"]`
  );
  if (!bar || !btn || btn.offsetWidth === 0 || bar.clientWidth === 0) {
    return null;
  }
  return {
    left: btn.offsetLeft,
    top: btn.offsetTop,
    width: btn.offsetWidth,
  };
}
