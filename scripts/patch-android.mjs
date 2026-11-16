// Agrega al proyecto Android generado por Capacitor el código nativo de alarmas
// (android-src/) y los permisos que necesita. Se puede ejecutar varias veces.
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

const APP = 'android/app';
const JAVA_DIR = `${APP}/src/main/java/com/mallero/app`;
const MANIFEST = `${APP}/src/main/AndroidManifest.xml`;
const GRADLE = `${APP}/build.gradle`;

if (!existsSync(APP)) {
    console.error('No existe android/. Ejecuta primero: npx cap add android');
    process.exit(1);
}

// 1. Código Java
for (const file of readdirSync('android-src/java/com/mallero/app')) {
    cpSync(`android-src/java/com/mallero/app/${file}`, `${JAVA_DIR}/${file}`);
}

// 2. Permisos y componentes en el manifest
let manifest = readFileSync(MANIFEST, 'utf8');
const PERMISSIONS = `
    <!-- Mallero: alarmas -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
`;
const COMPONENTS = `
        <!-- Mallero: alarmas -->
        <activity
            android:name=".AlarmActivity"
            android:exported="false"
            android:showWhenLocked="true"
            android:turnScreenOn="true"
            android:launchMode="singleTask"
            android:excludeFromRecents="true"
            android:taskAffinity="com.mallero.app.alarm"
            android:screenOrientation="portrait"
            android:theme="@style/AppTheme.NoActionBar" />
        <service
            android:name=".AlarmService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
        <receiver android:name=".AlarmReceiver" android:exported="false" />
        <receiver android:name=".BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.intent.action.TIME_SET" />
                <action android:name="android.intent.action.TIMEZONE_CHANGED" />
                <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" />
            </intent-filter>
        </receiver>
`;
if (!manifest.includes('Mallero: alarmas')) {
    manifest = manifest.replace(/(<manifest[^>]*>)/, `$1\n${PERMISSIONS}`);
    manifest = manifest.replace('</application>', `${COMPONENTS}\n    </application>`);
    writeFileSync(MANIFEST, manifest);
}

// 3. Dependencia para servir la pantalla de reto por https dentro del WebView
let gradle = readFileSync(GRADLE, 'utf8');
if (!gradle.includes('androidx.webkit:webkit')) {
    gradle = gradle.replace(/dependencies\s*\{/, (m) => `${m}\n    implementation "androidx.webkit:webkit:1.12.1"`);
    writeFileSync(GRADLE, gradle);
}

console.log('Proyecto Android preparado con las alarmas de Mallero');
