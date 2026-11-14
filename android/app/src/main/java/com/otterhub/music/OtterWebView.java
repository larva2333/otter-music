package com.otterhub.music;

import android.content.Context;
import android.util.AttributeSet;
import android.util.Log;
import com.getcapacitor.CapacitorWebView;

/**
 * HyperOS「点状态栏回到顶部」的接入点。
 *
 * 系统侧（{@code ViewRootImplStubImpl$MutableViewRootImplStubImpl$ScrollToTopListener}）
 * 收到状态栏点击后，会通过反射在顶层可滚动 View 上按方法名查找入口，参数固定为 {@code (int)}，
 * 调用时传 0：
 * <ul>
 *   <li>普通距离：{@code smoothScrollToPosition} / {@code smoothScrollTo} / {@code scrollToPosition}</li>
 *   <li>长距离：{@code scrollToPosition} / {@code setSelection}</li>
 * </ul>
 * 标准 WebView 没有这些方法，系统只会打一行 {@code Get Scroll Method ... failed} 然后放弃，
 * 这就是之前「点状态栏没反应」的真正原因（触摸事件本身在 SystemUI 就被消费了，
 * 应用根本收不到，所以不能靠 dispatchTouchEvent）。
 *
 * 这里补齐同名方法，把动作转发给网页层（监听 {@code otter:scroll-to-top}），
 * 由网页把带 {@code data-page-scroll} 的容器滚回顶部。
 * 返回类型必须是 void、参数必须是 int，否则反射查找不到。
 */
public class OtterWebView extends CapacitorWebView {

    private static final String TAG = "OtterTapTop";

    public OtterWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    /** 普通距离滚动的首选入口 */
    public void smoothScrollToPosition(int position) {
        scrollToTopFromSystem("smoothScrollToPosition");
    }

    /** 普通距离滚动的备选入口 */
    public void smoothScrollTo(int position) {
        scrollToTopFromSystem("smoothScrollTo");
    }

    /** 长距离滚动的入口 */
    public void scrollToPosition(int position) {
        scrollToTopFromSystem("scrollToPosition");
    }

    /** 长距离滚动的备选入口 */
    public void setSelection(int position) {
        scrollToTopFromSystem("setSelection");
    }

    private void scrollToTopFromSystem(String method) {
        Log.d(TAG, "system scroll-to-top via " + method + "()");
        post(() -> evaluateJavascript("window.dispatchEvent(new CustomEvent('otter:scroll-to-top'))", null));
    }
}
