# Mantém a ponte JavascriptInterface intacta no build de release
-keepattributes JavascriptInterface
-keepattributes *Annotation*

-keepclassmembers class com.luminatv.player.** {
    @android.webkit.JavascriptInterface <methods>;
}

# OkHttp 4.x
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
