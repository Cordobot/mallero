package com.mallero.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * Puente entre la página de Mallero y las alarmas del sistema Android.
 * JS: MalleroAlarm.schedule(payload), test(alarm), getStatus(), askPermissions()
 */
@CapacitorPlugin(name = "MalleroAlarm")
public class MalleroAlarmPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            AlarmScheduler.saveConfig(getContext(), call.getData().toString());
            int count = AlarmScheduler.scheduleAll(getContext());
            JSObject result = new JSObject();
            result.put("scheduled", count);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("No se pudieron programar las alarmas", e);
        }
    }

    /** Alarma de prueba a los 10 segundos. */
    @PluginMethod
    public void test(PluginCall call) {
        try {
            JSONObject data = new JSONObject(call.getData().toString());
            JSONObject alarm = new JSONObject();
            alarm.put("key", "test|" + System.currentTimeMillis());
            alarm.put("at", System.currentTimeMillis() + 10_000L);
            alarm.put("title", data.optString("title", "Alarma de prueba"));
            alarm.put("body", data.optString("body", ""));
            alarm.put("challenge", data.optBoolean("challenge", true));
            alarm.put("challengeTypes", data.optJSONArray("challengeTypes"));
            alarm.put("difficulty", data.optString("difficulty", "medium"));
            alarm.put("snoozeMinutes", data.optInt("snoozeMinutes", 5));
            alarm.put("snoozesLeft", data.optInt("snoozeMax", 2));
            AlarmScheduler.scheduleOne(getContext(), alarm);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo programar la prueba", e);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject result = new JSObject();
        result.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        result.put("exactAlarms", canScheduleExact(ctx));
        result.put("fullScreen", canUseFullScreen(ctx));
        result.put("batteryUnrestricted", ignoresBattery(ctx));
        call.resolve(result);
    }

    /**
     * Pide el siguiente permiso que falte (uno por llamada, porque cada uno abre
     * una pantalla distinta). Devuelve cuál se pidió, o "none" si ya están todos.
     */
    @PluginMethod
    public void askPermissions(PluginCall call) {
        Context ctx = getContext();
        String asked = "none";

        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4711);
            asked = "notifications";
        } else if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
            openSettings(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName()));
            asked = "notifications";
        } else if (!canScheduleExact(ctx) && Build.VERSION.SDK_INT >= 31) {
            openSettings(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + ctx.getPackageName())));
            asked = "exactAlarms";
        } else if (!canUseFullScreen(ctx) && Build.VERSION.SDK_INT >= 34) {
            openSettings(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + ctx.getPackageName())));
            asked = "fullScreen";
        } else if (!ignoresBattery(ctx)) {
            openSettings(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName())));
            asked = "battery";
        }

        JSObject result = new JSObject();
        result.put("asked", asked);
        call.resolve(result);
    }

    private void openSettings(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
    }

    static boolean canScheduleExact(Context ctx) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    static boolean canUseFullScreen(Context ctx) {
        if (Build.VERSION.SDK_INT < 34) return true;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.canUseFullScreenIntent();
    }

    static boolean ignoresBattery(Context ctx) {
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
    }
}
