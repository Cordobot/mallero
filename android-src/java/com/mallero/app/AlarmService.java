package com.mallero.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

/**
 * Hace sonar la alarma (sonido en bucle + vibración) hasta que la pantalla de reto
 * la apague o la posponga. Muestra la pantalla de reto sobre la pantalla de bloqueo.
 */
public class AlarmService extends Service {
    static final String ACTION_RING = "com.mallero.app.RING";
    static final String ACTION_DISMISS = "com.mallero.app.DISMISS";
    static final String ACTION_SNOOZE = "com.mallero.app.SNOOZE";
    private static final String CHANNEL_ID = "mallero_alarm";
    private static final int NOTIFICATION_ID = 4711;
    private static final long MAX_RING_MS = 20 * 60_000L; // deja de sonar sola a los 20 minutos

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private String currentAlarm;
    private int originalVolume = -1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable volumeUp = new Runnable() {
        @Override
        public void run() {
            // Sube el volumen poco a poco, como Alarmy
            AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            int max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            int cur = audio.getStreamVolume(AudioManager.STREAM_ALARM);
            if (cur < max) {
                audio.setStreamVolume(AudioManager.STREAM_ALARM, cur + 1, 0);
                handler.postDelayed(this, 4000);
            }
        }
    };
    private final Runnable timeout = this::stopRinging;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_SNOOZE.equals(action)) {
            if (currentAlarm != null) AlarmScheduler.snooze(this, currentAlarm);
            stopRinging();
            return START_NOT_STICKY;
        }
        if (ACTION_DISMISS.equals(action) || intent == null) {
            stopRinging();
            return START_NOT_STICKY;
        }

        currentAlarm = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM);
        if (currentAlarm == null) currentAlarm = "{}";
        startForegroundWithAlarm();
        startSound();
        startVibration();
        acquireWakeLock();
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, MAX_RING_MS);

        // Si la pantalla está encendida y la app tiene permiso, abre el reto directamente
        try {
            startActivity(challengeIntent());
        } catch (Exception ignored) {
        }
        return START_NOT_STICKY;
    }

    private Intent challengeIntent() {
        return new Intent(this, AlarmActivity.class)
                .putExtra(AlarmScheduler.EXTRA_ALARM, currentAlarm)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
    }

    private void startForegroundWithAlarm() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Alarmas de turno", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Alarmas de Mallero con reto para apagarlas");
            channel.setSound(null, null); // el sonido lo pone el servicio
            channel.enableVibration(false);
            channel.setBypassDnd(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(channel);
        }

        String title = "Alarma";
        String body = "";
        try {
            JSONObject alarm = new JSONObject(currentAlarm);
            title = alarm.optString("title", title);
            body = alarm.optString("body", body);
        } catch (Exception ignored) {
        }

        PendingIntent open = PendingIntent.getActivity(this, 1, challengeIntent(),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body.isEmpty() ? "Toca para apagar la alarma" : body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body + "\nToca para apagar la alarma"))
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .build();
        notification.flags |= Notification.FLAG_INSISTENT | Notification.FLAG_NO_CLEAR;

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void startSound() {
        releasePlayer();
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();

            AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (originalVolume < 0) originalVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM);
            int max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            // Empieza a media potencia (o más, si ya estaba más alto) y va subiendo
            audio.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(originalVolume, max / 2), 0);
            handler.removeCallbacks(volumeUp);
            handler.postDelayed(volumeUp, 4000);

            player.start();
        } catch (Exception e) {
            releasePlayer();
        }
    }

    private void startVibration() {
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long[] pattern = {0, 800, 500};
        if (Build.VERSION.SDK_INT >= 26) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0),
                    new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        } else {
            vibrator.vibrate(pattern, 0);
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mallero:alarm");
        wakeLock.acquire(MAX_RING_MS + 60_000L);
    }

    private void stopRinging() {
        handler.removeCallbacksAndMessages(null);
        releasePlayer();
        if (vibrator != null) vibrator.cancel();
        if (originalVolume >= 0) {
            AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            audio.setStreamVolume(AudioManager.STREAM_ALARM, originalVolume, 0);
            originalVolume = -1;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        currentAlarm = null;
        stopForeground(true);
        stopSelf();
    }

    private void releasePlayer() {
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
            }
            player.release();
            player = null;
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        releasePlayer();
        if (vibrator != null) vibrator.cancel();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }
}
