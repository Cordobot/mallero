package com.mallero.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

/** Recibe la alarma del sistema y arranca el servicio que hace sonar el teléfono. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!AlarmScheduler.ACTION_FIRE.equals(intent.getAction())) return;
        Intent service = new Intent(ctx, AlarmService.class)
                .setAction(AlarmService.ACTION_RING)
                .putExtra(AlarmScheduler.EXTRA_ALARM, intent.getStringExtra(AlarmScheduler.EXTRA_ALARM));
        ContextCompat.startForegroundService(ctx, service);
    }
}
