package com.luminatv.player

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout

class LuminaChromeClient(
    private val activity: Activity,
    private val webView: WebView,
    private val fullscreenContainer: FrameLayout
) : WebChromeClient() {

    private var customView: View? = null
    private var customViewCallback: CustomViewCallback? = null

    override fun getDefaultVideoPoster(): Bitmap {
        // Evita o ícone cinza padrão de vídeo antes do primeiro frame
        return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.BLACK)
        }
    }

    override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
        if (view == null) return
        if (customView != null) {
            callback?.onCustomViewHidden()
            return
        }
        customView = view
        customViewCallback = callback

        fullscreenContainer.addView(
            view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        fullscreenContainer.visibility = View.VISIBLE
        webView.visibility = View.INVISIBLE
    }

    override fun onHideCustomView() {
        val view = customView ?: return
        fullscreenContainer.visibility = View.GONE
        fullscreenContainer.removeView(view)
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        webView.visibility = View.VISIBLE
        webView.requestFocus()
    }

    fun isInCustomView(): Boolean = customView != null

    fun exitCustomView() {
        if (customView != null) {
            onHideCustomView()
        }
    }

    override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
        return super.onConsoleMessage(consoleMessage)
    }
}
