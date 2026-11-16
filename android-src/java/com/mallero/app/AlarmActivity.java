package com.mallero.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Pantalla completa sobre la pantalla de bloqueo con el reto (challenge.html).
 * No se puede cerrar con "atrás" ni bajar el volumen: solo superando el reto o posponiendo.
 */
public class AlarmActivity extends AppCompatActivity {
    private WebView webView;
    private boolean handled = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();

        webView = new WebView(this);
        setContentView(webView);

        // Sirve los archivos de la app por https para que funcionen los sensores (agitar)
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true; // la pantalla de reto no navega a ningún lado
            }
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        webView.addJavascriptInterface(new Bridge(), "MalleroNative");

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Ignorado: hay que superar el reto
            }
        });

        load(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handled = false;
        load(intent);
    }

    private void load(Intent intent) {
        String json = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM);
        Uri.Builder url = Uri.parse("https://appassets.androidplatform.net/assets/public/challenge.html").buildUpon();
        try {
            JSONObject alarm = new JSONObject(json != null ? json : "{}");
            JSONArray types = alarm.optJSONArray("challengeTypes");
            StringBuilder typeList = new StringBuilder();
            if (types != null) {
                for (int i = 0; i < types.length(); i++) {
                    if (i > 0) typeList.append(',');
                    typeList.append(types.optString(i));
                }
            }
            url.appendQueryParameter("title", alarm.optString("title", "Alarma"))
                    .appendQueryParameter("body", alarm.optString("body", ""))
                    .appendQueryParameter("types", typeList.length() > 0 ? typeList.toString() : "math")
                    .appendQueryParameter("diff", alarm.optString("difficulty", "medium"))
                    .appendQueryParameter("ch", alarm.optBoolean("challenge", true) ? "1" : "0")
                    .appendQueryParameter("snooze", String.valueOf(alarm.optInt("snoozeMinutes", 0)))
                    .appendQueryParameter("left", String.valueOf(alarm.optInt("snoozesLeft", 0)));
        } catch (Exception ignored) {
        }
        webView.loadUrl(url.build().toString());
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Los botones de volumen no silencian la alarma
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP
                || keyCode == KeyEvent.KEYCODE_VOLUME_MUTE) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void finishWith(String action) {
        if (handled) return;
        handled = true;
        startService(new Intent(this, AlarmService.class).setAction(action));
        finishAndRemoveTask();
    }

    private class Bridge {
        @JavascriptInterface
        public void dismiss() {
            runOnUiThread(() -> finishWith(AlarmService.ACTION_DISMISS));
        }

        @JavascriptInterface
        public void snooze() {
            runOnUiThread(() -> finishWith(AlarmService.ACTION_SNOOZE));
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("MalleroNative");
            webView.destroy();
        }
        super.onDestroy();
    }
}
