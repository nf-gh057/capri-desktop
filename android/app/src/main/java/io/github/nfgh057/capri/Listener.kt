package io.github.nfgh057.capri

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONArray
import org.json.JSONObject

// Her notes while you're away from all your PCs (Claude Code needs you, it's done, it crashed), on your phone
// even with her app closed: a service in the background holds a light stream to her page on one of your PCs
// over Tailscale (another one if that one's away), signed in with her listening key (Keys), which hears her
// notes and nothing else. No server in between: her PCs and your phone only. Each note shows once (its id).
class Listener : Service() {
    @Volatile private var running = false
    private var worker: Thread? = null
    private var api: Api? = null

    companion object {
        private const val QUIET = "listening"
        private const val NOTES = "notes"
        @Volatile var appOpen = false // her app on screen: it shows her notes itself

        fun start(context: Context) {
            val prefs = context.getSharedPreferences("capri", MODE_PRIVATE)
            if (prefs.getString("origin", null) == null || !Keys.hasListen()) return
            runCatching { context.startForegroundService(Intent(context, Listener::class.java)) }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        channels()
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val ongoing = Notification.Builder(this, QUIET)
            .setSmallIcon(R.drawable.ic_capri)
            .setContentTitle(getString(R.string.listening_title))
            .setContentText(getString(R.string.listening_text))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        // (its kind, "remote messaging", is known from Android 14 on)
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        else startForeground(1, ongoing)
        if (!running) {
            running = true
            worker = Thread { loop() }.also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        Thread { runCatching { api?.hangUp() } }.start()
        super.onDestroy()
    }

    private fun channels() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(QUIET, getString(R.string.channel_listen), NotificationManager.IMPORTANCE_MIN))
        nm.createNotificationChannel(NotificationChannel(NOTES, getString(R.string.channel_notes), NotificationManager.IMPORTANCE_HIGH).apply {
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE // on a locked phone: that she wrote, not what
        })
    }

    private val prefs by lazy { getSharedPreferences("capri", MODE_PRIVATE) }

    // her page on your PCs: the one her app talks to first, then the others it knows
    private fun places(): List<String> {
        val first = prefs.getString("origin", null)
        val known = runCatching { JSONArray(prefs.getString("pcs", "[]")) }.getOrDefault(JSONArray())
        val others = (0 until known.length()).map { known.getJSONObject(it).optString("url") }
        return (listOfNotNull(first) + others).filter { it.startsWith("https://") }.distinct()
    }

    private fun loop() {
        var pause = 5_000L
        var turn = 0
        while (running) {
            val all = places()
            if (all.isEmpty() || !Keys.hasListen()) return stopSelf()
            val here = Api(all[turn % all.size])
            api = here
            val heard = runCatching {
                val asked = here.get("/api/listen")
                val challenge = asked.getString("challenge")
                Widget.online(this, asked.optInt("online", 0)) // how many PCs of your swarm answer: on her widget
                here.post("/api/listen", JSONObject().put("challenge", challenge).put("sig", Keys.signListen(challenge)))
                pause = 5_000L
                here.listen(prefs.getLong("since", System.currentTimeMillis()), { running }) { event, data -> if (event == "note") note(data) }
            }
            if (!running) return
            if (heard.isFailure || heard.getOrNull() != 200) turn++ // this PC is away: the next one
            Thread.sleep(pause)
            pause = minOf(pause * 2, 60_000L)
        }
    }

    // a note, once: on screen (unless her app shows it), and on her widget
    private fun note(n: JSONObject) {
        val id = n.optString("id")
        val seen = prefs.getString("seen", "").orEmpty().split(',').filter { it.isNotEmpty() }
        if (id.isEmpty() || id in seen) return
        prefs.edit().putString("seen", (seen + id).takeLast(50).joinToString(",")).putLong("since", n.optLong("at")).apply()
        val title = n.optString("project").ifEmpty { "Capri" }
        val text = listOf(n.optString("line"), n.optString("quote")).filter { it.isNotEmpty() }.joinToString("\n")
        Widget.add(this, false, "$title · ${n.optString("line")}")
        if (appOpen) return
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val shown = Notification.Builder(this, NOTES)
            .setSmallIcon(R.drawable.ic_capri)
            .setContentTitle(title)
            .setContentText(n.optString("line"))
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPublicVersion(Notification.Builder(this, NOTES).setSmallIcon(R.drawable.ic_capri).setContentTitle("Capri").build())
            .build()
        getSystemService(NotificationManager::class.java).notify(id.hashCode(), shown)
    }
}
