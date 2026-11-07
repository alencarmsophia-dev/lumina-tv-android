package com.luminatv.player

import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.webkit.WebView

/**
 * Converte as teclas do controle remoto da Fire TV / Android TV / Google TV
 * para os keyCodes esperados por app/js/core/keys.js sem alterar o JS do app.
 */
class KeyBridge(private val webView: WebView) {

    companion object {
        const val JS_KEY_LEFT = 37
        const val JS_KEY_UP = 38
        const val JS_KEY_RIGHT = 39
        const val JS_KEY_DOWN = 40
        const val JS_KEY_OK = 13
        const val JS_KEY_BACK = 27
        const val JS_KEY_CH_UP = 427
        const val JS_KEY_CH_DOWN = 428
        const val JS_KEY_PLAY = 415
        const val JS_KEY_PAUSE = 19
        const val JS_KEY_STOP = 413
        const val JS_KEY_REWIND = 412
        const val JS_KEY_FAST_FORWARD = 417
        const val JS_KEY_RED = 403
        const val JS_KEY_GREEN = 404
        const val JS_KEY_YELLOW = 405
        const val JS_KEY_BLUE = 406

        private const val MENU_LONG_PRESS_MS = 2000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private var menuDownValid = false
    private var menuLongPressTriggered = false

    private val menuDiagRunnable = Runnable {
        if (menuDownValid && !menuLongPressTriggered) {
            menuLongPressTriggered = true
            dispatchDiagnosticColorSequence()
        }
    }

    fun handleKeyEvent(event: KeyEvent): Boolean {
        val keyCode = event.keyCode
        val action = event.action
        val isRepeat = event.repeatCount > 0

        // Atalho Fire TV: segurar o botão MENU por 2 segundos dispara 403 -> 404 -> 405 -> 406 (Painel de Diagnóstico)
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            when (action) {
                KeyEvent.ACTION_DOWN -> {
                    if (!isRepeat) {
                        menuDownValid = true
                        menuLongPressTriggered = false
                        handler.removeCallbacks(menuDiagRunnable)
                        handler.postDelayed(menuDiagRunnable, MENU_LONG_PRESS_MS)
                    }
                    return true
                }
                KeyEvent.ACTION_UP -> {
                    handler.removeCallbacks(menuDiagRunnable)
                    val wasLongPress = menuLongPressTriggered
                    menuDownValid = false
                    menuLongPressTriggered = false
                    // Toque curto no Menu na Fire TV envia Amarelo (405 - Favoritar), pois o controle Fire TV não tem teclas coloridas
                    if (!wasLongPress) {
                        dispatchJsKey(JS_KEY_YELLOW, isDown = true, isRepeat = false)
                        dispatchJsKey(JS_KEY_YELLOW, isDown = false, isRepeat = false)
                    }
                    return true
                }
            }
            return true
        }

        // Botão Play/Pause único da Fire TV: verifica o estado atual do LuminaPlayer no JS
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            if (action == KeyEvent.ACTION_DOWN && !isRepeat) {
                dispatchSmartPlayPause()
            }
            return true
        }

        val mappedJsCode = mapAndroidKeyToJs(keyCode) ?: return false

        // Setas (37..40) e Enter/OK (13) também podem ser roteados diretamente via JS para garantir
        // consistência em 100% dos controles Bluetooth/CEC e evitar foco nativo perdido do WebView
        if (action == KeyEvent.ACTION_DOWN) {
            // Para OK, BACK, PLAY, PAUSE, STOP e cores, ignora repetição como em keys.js
            if (isRepeat && isNonRepeatableKey(mappedJsCode)) {
                return true
            }
            dispatchJsKey(mappedJsCode, isDown = true, isRepeat = isRepeat)
            return true
        } else if (action == KeyEvent.ACTION_UP) {
            dispatchJsKey(mappedJsCode, isDown = false, isRepeat = false)
            return true
        }

        return false
    }

    private fun mapAndroidKeyToJs(androidKeyCode: Int): Int? {
        return when (androidKeyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> JS_KEY_LEFT
            KeyEvent.KEYCODE_DPAD_UP -> JS_KEY_UP
            KeyEvent.KEYCODE_DPAD_RIGHT -> JS_KEY_RIGHT
            KeyEvent.KEYCODE_DPAD_DOWN -> JS_KEY_DOWN
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_BUTTON_A -> JS_KEY_OK

            KeyEvent.KEYCODE_BACK,
            KeyEvent.KEYCODE_ESCAPE,
            KeyEvent.KEYCODE_BUTTON_B -> JS_KEY_BACK

            KeyEvent.KEYCODE_MEDIA_PLAY -> JS_KEY_PLAY
            KeyEvent.KEYCODE_MEDIA_PAUSE -> JS_KEY_PAUSE
            KeyEvent.KEYCODE_MEDIA_STOP -> JS_KEY_STOP
            KeyEvent.KEYCODE_MEDIA_REWIND,
            KeyEvent.KEYCODE_BUTTON_L1 -> JS_KEY_REWIND
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
            KeyEvent.KEYCODE_BUTTON_R1 -> JS_KEY_FAST_FORWARD

            KeyEvent.KEYCODE_CHANNEL_UP,
            KeyEvent.KEYCODE_MEDIA_NEXT,
            KeyEvent.KEYCODE_PAGE_UP -> JS_KEY_CH_UP

            KeyEvent.KEYCODE_CHANNEL_DOWN,
            KeyEvent.KEYCODE_MEDIA_PREVIOUS,
            KeyEvent.KEYCODE_PAGE_DOWN -> JS_KEY_CH_DOWN

            KeyEvent.KEYCODE_PROG_RED -> JS_KEY_RED
            KeyEvent.KEYCODE_PROG_GREEN -> JS_KEY_GREEN
            KeyEvent.KEYCODE_PROG_YELLOW -> JS_KEY_YELLOW
            KeyEvent.KEYCODE_PROG_BLUE -> JS_KEY_BLUE

            else -> null
        }
    }

    private fun isNonRepeatableKey(jsCode: Int): Boolean {
        return jsCode == JS_KEY_OK ||
            jsCode == JS_KEY_BACK ||
            jsCode == JS_KEY_PLAY ||
            jsCode == JS_KEY_PAUSE ||
            jsCode == JS_KEY_STOP ||
            jsCode == JS_KEY_RED ||
            jsCode == JS_KEY_GREEN ||
            jsCode == JS_KEY_YELLOW ||
            jsCode == JS_KEY_BLUE
    }

    /**
     * Em app/js/player/osd.js:
     * - 'key:PLAY' (415) só chama togglePlayPause() se LuminaPlayer.getState() === 'PAUSED'
     * - 'key:PAUSE' (19) só chama togglePlayPause() se LuminaPlayer.getState() === 'PLAYING' ou 'BUFFERING'
     * Portanto, para a tecla física única KEYCODE_MEDIA_PLAY_PAUSE da Fire TV, consultamos o estado
     * atual do player e disparamos 415 quando pausado ou 19 quando reproduzindo.
     */
    private fun dispatchSmartPlayPause() {
        val js = """
        (function() {
          try {
            var st = (window.LuminaPlayer && window.LuminaPlayer.getState) ? window.LuminaPlayer.getState() : 'IDLE';
            var code = (st === 'PAUSED') ? 415 : 19;
            ${buildDispatchSnippet("code", isDown = true, isRepeat = false)}
            ${buildDispatchSnippet("code", isDown = false, isRepeat = false)}
          } catch (e) {}
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun dispatchDiagnosticColorSequence() {
        val js = """
        (function() {
          try {
            var seq = [403, 404, 405, 406];
            for (var i = 0; i < seq.length; i++) {
              var code = seq[i];
              ${buildDispatchSnippet("code", isDown = true, isRepeat = false)}
              ${buildDispatchSnippet("code", isDown = false, isRepeat = false)}
            }
          } catch (e) {}
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun dispatchJsKey(jsKeyCode: Int, isDown: Boolean, isRepeat: Boolean) {
        val js = """
        (function() {
          try {
            var code = $jsKeyCode;
            ${buildDispatchSnippet("code", isDown = isDown, isRepeat = isRepeat)}
          } catch (e) {}
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun buildDispatchSnippet(codeVar: String, isDown: Boolean, isRepeat: Boolean): String {
        val eventType = if (isDown) "keydown" else "keyup"
        val repeatBool = if (isRepeat) "true" else "false"
        return """
        var ev;
        try {
          ev = new KeyboardEvent('$eventType', { bubbles: true, cancelable: true, repeat: $repeatBool });
        } catch (err) {
          ev = document.createEvent('Event');
          ev.initEvent('$eventType', true, true);
        }
        Object.defineProperty(ev, 'keyCode', { get: function() { return $codeVar; } });
        Object.defineProperty(ev, 'which', { get: function() { return $codeVar; } });
        Object.defineProperty(ev, 'repeat', { get: function() { return $repeatBool; } });
        window.dispatchEvent(ev);
        """.trimIndent()
    }

    fun cleanup() {
        handler.removeCallbacks(menuDiagRunnable)
    }
}
