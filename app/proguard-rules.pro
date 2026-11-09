# Mantém a ponte JavascriptInterface e controladores nativos intactos no build de release
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepattributes Signature, InnerClasses, EnclosingMethod

-keep class com.luminatv.player.** { *; }
-keepclassmembers class com.luminatv.player.** {
    @android.webkit.JavascriptInterface <methods>;
}

# Media3 / ExoPlayer 1.3.1
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# OkHttp 4.x
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
