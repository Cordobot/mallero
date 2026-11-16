package com.mallero.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Guarda la lista de alarmas que envía la página y la programa en AlarmManager.
 * La lista se conserva para volver a programarla tras reiniciar el teléfono.
 */
public final class AlarmScheduler {
    static final String ACTION_FIRE = "com.mallero.app.ALARM_FIRE";
    static final String EXTRA_ALARM = "alarm";
    private static final String PREFS = "mallero_alarms";
    private static final String KEY_CONFIG = "config";
    private static final String KEY_IDS = "ids";

    private AlarmScheduler() {}

    static void saveConfig(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY_CONFIG, json).apply();
    }

    /** Cancela lo programado antes y programa las alarmas futuras de la configuración guardada. */
    static int scheduleAll(Context ctx) {
        SharedPreferences prefs = prefs(ctx);
        cancelStored(ctx, prefs.getString(KEY_IDS, "[]"));

        JSONArray ids = new JSONArray();
        int count = 0;
        try {
            JSONObject config = new JSONObject(prefs.getString(KEY_CONFIG, "{}"));
            JSONArray alarms = config.optJSONArray("alarms");
            long now = System.currentTimeMillis();
            if (alarms != null) {
                for (int i = 0; i < alarms.length(); i++) {
                    JSONObject src = alarms.getJSONObject(i);
                    if (src.optLong("at") <= now) continue;
                    JSONObject alarm = new JSONObject(src.toString());
                    alarm.put("challengeTypes", config.optJSONArray("challengeTypes"));
                    alarm.put("difficulty", config.optString("difficulty", "medium"));
                    alarm.put("snoozeMinutes", config.optInt("snoozeMinutes", 0));
                    alarm.put("snoozesLeft", config.optInt("snoozeMax", 0));
                    ids.put(scheduleOne(ctx, alarm));
                    count++;
                }
            }
        } catch (Exception ignored) {
        }
        prefs.edit().putString(KEY_IDS, ids.toString()).apply();
        return count;
    }

    /** Programa una alarma y devuelve su código de solicitud. */
    static int scheduleOne(Context ctx, JSONObject alarm) {
        int requestCode = alarm.optString("key").hashCode();
        long at = alarm.optLong("at");
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent fire = firePendingIntent(ctx, requestCode, alarm.toString());

        if (MalleroAlarmPlugin.canScheduleExact(ctx)) {
            // setAlarmClock: suena exacto incluso en reposo y muestra el icono de alarma en la barra
            Intent open = new Intent(ctx, MainActivity.class);
            PendingIntent show = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), fire);
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
        }
        return requestCode;
    }

    /** Vuelve a programar la misma alarma dentro de N minutos, con un aplazamiento menos. */
    static void snooze(Context ctx, String alarmJson) {
        try {
            JSONObject alarm = new JSONObject(alarmJson);
            int minutes = Math.max(1, alarm.optInt("snoozeMinutes", 5));
            alarm.put("snoozesLeft", Math.max(0, alarm.optInt("snoozesLeft", 0) - 1));
            alarm.put("at", System.currentTimeMillis() + minutes * 60_000L);
            alarm.put("key", alarm.optString("key") + "|snooze");
            scheduleOne(ctx, alarm);
        } catch (Exception ignored) {
        }
    }

    private static void cancelStored(Context ctx, String idsJson) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        try {
            JSONArray ids = new JSONArray(idsJson);
            for (int i = 0; i < ids.length(); i++) {
                PendingIntent pi = firePendingIntent(ctx, ids.getInt(i), "{}");
                am.cancel(pi);
                pi.cancel();
            }
        } catch (Exception ignored) {
        }
    }

    private static PendingIntent firePendingIntent(Context ctx, int requestCode, String alarmJson) {
        Intent intent = new Intent(ctx, AlarmReceiver.class)
                .setAction(ACTION_FIRE)
                .putExtra(EXTRA_ALARM, alarmJson);
        return PendingIntent.getBroadcast(ctx, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
